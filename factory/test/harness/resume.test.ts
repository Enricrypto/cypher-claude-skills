/**
 * Resume semantics (A-2, D-2 / D-3 / D-13), orchestrator-level [O].
 *
 * Step 2 lays the evidence a resume reads: every agent invocation timed and committed (D-13),
 * every builder loop-back committed with the failure the next attempt is briefed with (D-2), and
 * a builder's exhaustion recorded with the budget it exhausted (D-3 `exhaustedBuilder`).
 *
 * Step 6 is the resume itself: completed agents and approved checkpoints are skipped (AC-34),
 * ESCALATED runs reopen (AC-35), attempts come from state (AC-36), every gate for unfinished work
 * is evaluated again (AC-39), an exhausted builder needs a grant (AC-71, AC-72), a gate failure
 * invalidates the steps it judged (I-6), an approved document must be unchanged (I-7), and the
 * Gate 2 reference is the run's first passing count (MINOR-11).
 *
 * Step 7: an approved CP3 is hash-checked like CP1 and CP2 before the run ends on it (I-7), and a
 * resumed Validator records no IMPORTANT finding twice (MINOR-9).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { loadState, saveState } from '../../harness/state-store';
import { FeatureState } from '../../harness/state-tracker';
import { exhaustedBuilder, RunRefusedError } from '../../harness/run-lifecycle';
import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { treeSnapshot } from '../fixtures/factory-case-variant';
import { BASELINE_FILENAME } from '../../harness/regression-baseline';
import { MAX_BUILDER_ATTEMPTS } from '../../harness/loop-rules';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { backend, story, testVerifier, validator } from '../fixtures/agent-outputs';
import { executionAudit, recordingGates } from '../fixtures/gates';
import { fakeChangeTracker } from '../fixtures/changes';
import {
  decisions,
  killAt,
  passingScript,
  removeOnPersist,
  restoreSnapshot,
  runToEnd,
  scriptedInvoker,
  seedRun,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-resume-');
});

afterEach(() => {
  project.cleanup();
});

/** The state.json of the only run in the project, or undefined before its first commit. */
function onDisk(): FeatureState | undefined {
  const factoryDir = join(project.dir, '.factory');
  if (!existsSync(factoryDir)) return undefined;
  const runs = readdirSync(factoryDir).filter(name => existsSync(join(factoryDir, name, 'state.json')));
  return runs.length === 1 ? loadState(project.dir, runs[0]) : undefined;
}

/** Wrap an invoker so every call takes measurable wall-clock time. */
function slow(invoke: AgentInvoker, ms: number): AgentInvoker {
  return async call => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return invoke(call);
  };
}

/**
 * A full orchestrator run commits state.json (two fsyncs) at every transition, about 20-25 times;
 * under a parallel `npm test` that can pass Jest's 5 s default without anything being wrong.
 */
const RUN_TIMEOUT_MS = 30_000;

const issue = (): ValidatorIssue => ({
  severity: 'CRITICAL',
  file: 'src/a.ts',
  line: 1,
  message: 'Route has no auth check',
  suggestion: 'Add the guard',
  canFix: true
});

describe('D-13 per-agent timing', () => {
  it('TIMING every agent invocation is recorded in state.json with start, end and duration, and timePerStage is filled', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    /** What state.json held when each agent (after the first) was invoked. */
    const invocationsOnDiskAtCall: number[] = [];

    const invoke: AgentInvoker = async (call: AgentInvocation) => {
      const persisted = onDisk();
      if (persisted) invocationsOnDiskAtCall.push((persisted.agentInvocations ?? []).length);
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke: slow(invoke, 10) });

    expect(state.completionStatus).toBe('SUCCESS');
    const persisted = onDisk()!;
    const invocations = persisted.agentInvocations ?? [];

    // One record per invocation, in order, with the stage it ran in.
    expect(invocations.map(r => r.agent)).toEqual(invoker.agents());
    expect(invocations.map(r => r.stage)).toEqual(invoker.calls.map(c => c.stage));

    for (const record of invocations) {
      const start = Date.parse(record.startedAt);
      const end = Date.parse(record.completedAt);
      expect(Number.isNaN(start)).toBe(false);
      expect(Number.isNaN(end)).toBe(false);
      expect(record.durationMs).toBe(end - start);
      expect(record.durationMs).toBeGreaterThan(0);
    }

    // Committed per invocation: each agent after the first found every earlier invocation on disk.
    expect(invocationsOnDiskAtCall).toEqual(invocations.map((_record, index) => index));

    // timePerStage is the sum of that stage's invocations.
    const expected: Record<number, number> = {};
    for (const record of invocations) expected[record.stage] = (expected[record.stage] ?? 0) + record.durationMs;
    expect(persisted.metrics.timePerStage).toEqual(expected);

    // Each PASS step carries its invocation's real start, end and duration.
    for (const step of persisted.stageHistory.filter(s => s.status === 'PASS' && s.agent !== 'tier-1')) {
      const own = invocations.filter(r => r.agent === step.agent).at(-1)!;
      expect(step.startedAt).toBe(own.startedAt);
      expect(step.completedAt).toBe(own.completedAt);
      expect(step.durationMs).toBe(own.durationMs);
    }

    // Builder invocations carry their phase and attempt.
    const builderRecord = invocations.find(r => r.agent === '04-backend-builder')!;
    expect(builderRecord).toMatchObject({ stage: 3, phase: 'stage3', attempt: 1 });
  }, RUN_TIMEOUT_MS);
});

describe('D-2 builder loop-backs are committed with their failure', () => {
  it('D-2 each failed builder attempt is on disk with its failure kind and error before the next attempt is invoked', async () => {
    const seen: Array<FeatureState['loopBacks']> = [];
    const noDetails = (call: AgentInvocation) => ({
      stage: call.stage,
      agent: call.agent,
      timestamp: new Date().toISOString(),
      status: 'PASS'
    });
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (call: AgentInvocation, n: number) => {
          if (n > 1) seen.push(onDisk()!.loopBacks.map(l => ({ ...l })));
          if (n === 1) return backend({ testsFailed: 1, failingError: 'expected 200, received 401' });
          if (n === 2) return noDetails(call);
          return backend();
        }
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(seen).toHaveLength(2);
    expect(seen[0].map(l => l.failure)).toEqual([{ kind: 'test', error: 'expected 200, received 401' }]);
    expect(seen[1].map(l => l.failure?.kind)).toEqual(['test', 'schema']);
    expect(seen[1][1].failure!.error).toMatch(/details/);
  }, RUN_TIMEOUT_MS);
});

describe('D-3 a builder exhaustion names the budget it exhausted', () => {
  it.each([
    ['Stage 3', { phase: 'stage3' as const }, 3],
    ['validator round 1', { phase: 'validator-round' as const, round: 1 }, 4]
  ])('D-3 MAX_LOOPS in %s records builderPhase, so exhaustedBuilder names the builder and phase', async (_label, at, stage) => {
    const failing = () => backend({ testsFailed: 1, failingError: 'still red' });
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) =>
          at.phase === 'stage3' || n > 1 ? failing() : backend(),
        '07-validator': (_call: AgentInvocation, n: number) =>
          n === 1 ? validator({ status: 'FAIL', issues: [issue()] }) : validator()
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    const persisted = onDisk()!;
    const last = persisted.escalations.at(-1)!;
    expect([last.stage, last.agent, last.reason]).toEqual([stage, '04-backend-builder', 'MAX_LOOPS']);
    expect(last.context.loopCount).toBe(MAX_BUILDER_ATTEMPTS);
    expect(last.context.builderPhase).toEqual(at);
    expect(exhaustedBuilder(persisted)).toEqual({ builder: '04-backend-builder', at });
  }, RUN_TIMEOUT_MS);
});

// ============================================================================================
// Step 6: the resume itself
// ============================================================================================

/** The bytes of the only run's state.json. */
function stateBytes(): string {
  const persisted = onDisk()!;
  return readFileSync(join(project.dir, '.factory', persisted.featureId, 'state.json'), 'utf8');
}

/** Every absolute document path a prompt names, sorted and de-duplicated. */
function documentPaths(prompt: string): string[] {
  return [...new Set(prompt.match(/\/\S+\.md\b/g) ?? [])].sort();
}

const stillRed = () => backend({ testsFailed: 1, failingError: 'still red' });

/** A story whose USER_STORY.md has no Given/When/Then: the story gate refuses it. */
function untestableStory() {
  const output = story();
  output.details.artifacts[0].content = '# User Story\n\nIt should just work, really.';
  return output;
}

/**
 * A run whose TECHNICAL_BRIEF.md is gone when the spec gate reads it, so the gate refuses it. The
 * Spec Writer returns a complete brief (MINOR-8 refuses one without its content at the schema);
 * the document is removed from the run directory right after the harness persists it.
 */
const briefMissingAtGate = () => removeOnPersist(project.dir, '03-spec-writer', 'TECHNICAL_BRIEF.md');

describe('AC-34 a killed run resumes where it stopped', () => {
  it('AC-34 resuming a run killed at the Backend Builder skips 01–03, CP1 and CP2, and the Backend Builder prompt names the same artifact paths a fresh run did', async () => {
    const fresh = scriptedInvoker(passingScript(), { cwd: project.dir });
    const kill = killAt(fresh.invoke, '04-backend-builder', 1, project.dir);
    /** The prompt the killed Backend Builder call was given: what a fresh run names. */
    let freshPrompt = '';
    await runToEnd({
      cwd: project.dir,
      invoke: call => {
        if (call.agent === '04-backend-builder') freshPrompt ||= call.prompt;
        return kill.invoke(call);
      }
    });
    const killed = restoreSnapshot(project.dir, kill.snapshot());

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const approver = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: killed,
      approveCheckpoint: approver.approve
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toEqual(['04-backend-builder', '06-test-verifier', '07-validator']);
    expect(approver.requests.map(r => r.id)).toEqual([3]);

    const freshPaths = documentPaths(freshPrompt);
    expect(freshPaths.length).toBeGreaterThan(0);
    expect(documentPaths(resumed.promptsFor('04-backend-builder')[0])).toEqual(freshPaths);
    for (const path of freshPaths) expect(existsSync(path)).toBe(true);
  }, RUN_TIMEOUT_MS);

  it('D-8 a resume does not capture a new change base: the base is recorded at a fresh start only', async () => {
    const fresh = scriptedInvoker(passingScript(), { cwd: project.dir });
    const kill = killAt(fresh.invoke, '06-test-verifier', 1, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    const baseBefore = killed.changeBase;

    const tracker = fakeChangeTracker({ base: { kind: 'none', reason: 'must never be captured on resume' } });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      resumeFromState: killed,
      changes: tracker
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(tracker.calls.map(c => c.method)).toEqual(['collect']);
    expect(state.changeBase).toEqual(baseBefore);
  }, RUN_TIMEOUT_MS);
});

describe('AC-35 an ESCALATED run reopens', () => {
  it('AC-35 resuming a run ESCALATED by the Test Verifier reopens it (IN_PROGRESS, completedAt and completionStatus cleared) and restarts at the Test Verifier', async () => {
    const first = scriptedInvoker({ ...passingScript(), '06-test-verifier': testVerifier({ failed: 1 }) }, { cwd: project.dir });
    const escalated = await runToEnd({ cwd: project.dir, invoke: first.invoke });
    expect(escalated.completionStatus).toBe('ESCALATED');

    let atFirstCall: FeatureState | undefined;
    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: async call => {
        atFirstCall ??= onDisk();
        return resumed.invoke(call);
      },
      resumeFromState: onDisk()!
    });

    expect(resumed.agents()).toEqual(['06-test-verifier', '07-validator']);
    expect(atFirstCall!.status).toBe('IN_PROGRESS');
    expect(atFirstCall!.completedAt).toBeUndefined();
    expect(atFirstCall!.completionStatus).toBeUndefined();
    expect(atFirstCall!.resumeHistory).toEqual([expect.objectContaining({ fromClass: 'ESCALATED', action: 'continue' })]);
    expect(atFirstCall!.escalations.at(-1)!.resolvedAt).toEqual(expect.any(String));
    expect(state.completionStatus).toBe('SUCCESS');
  }, RUN_TIMEOUT_MS);
});

describe('IMPORTANT-1 a run recorded without a description (pre-A-2)', () => {
  /** An ESCALATED run whose state.json, like a pre-A-2 one, has no featureDescription. */
  async function escalatedWithoutDescription(): Promise<void> {
    const first = scriptedInvoker({ ...passingScript(), '06-test-verifier': testVerifier({ failed: 1 }) }, { cwd: project.dir });
    await runToEnd({ cwd: project.dir, invoke: first.invoke });
    const legacy = onDisk()!;
    delete legacy.featureDescription;
    saveState(project.dir, legacy);
  }

  it.each([[''], ['   ']])(
    'IMPORTANT-1 resuming it with no description (%j) is refused with DESCRIPTION_REQUIRED naming --feature, and nothing is written',
    async blank => {
      await escalatedWithoutDescription();
      const before = stateBytes();

      const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
      let refusal: unknown;
      try {
        await runToEnd({ cwd: project.dir, invoke: resumed.invoke, featureDescription: blank, resumeFromState: onDisk()! });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(RunRefusedError);
      expect(refusal).toMatchObject({ code: 'DESCRIPTION_REQUIRED' });
      expect((refusal as Error).message).toContain('--feature');
      expect(resumed.calls).toEqual([]);
      expect(stateBytes()).toBe(before);
    },
    RUN_TIMEOUT_MS
  );

  it('IMPORTANT-1 resuming it with a description saves that description in state before any agent runs, and briefs the agents with it', async () => {
    await escalatedWithoutDescription();

    let atFirstCall: FeatureState | undefined;
    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: async call => ((atFirstCall ??= onDisk()), resumed.invoke(call)),
      featureDescription: 'add TOTP two-factor login',
      resumeFromState: onDisk()!
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(atFirstCall!.featureDescription).toBe('add TOTP two-factor login');
    expect(state.featureDescription).toBe('add TOTP two-factor login');
    expect(resumed.promptsFor('06-test-verifier')[0]).toContain('add TOTP two-factor login');
  }, RUN_TIMEOUT_MS);
});

describe('AC-36 attempts come from state', () => {
  it('AC-36 a run killed during the 2nd Backend Builder attempt gets exactly 1 more attempt on resume, counted from state', async () => {
    const fresh = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': () => backend({ testsFailed: 1, failingError: 'expected 200, received 401' })
      },
      { cwd: project.dir }
    );
    const kill = killAt(fresh.invoke, '04-backend-builder', 2, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    expect(killed.builderAttempts?.['04-backend-builder']?.stage3).toBe(2);

    const resumed = scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    expect(resumed.agents()).toEqual(['04-backend-builder']);
    expect(state.builderAttempts?.['04-backend-builder']?.stage3).toBe(MAX_BUILDER_ATTEMPTS);
    expect([state.escalations.at(-1)!.agent, state.escalations.at(-1)!.reason]).toEqual(['04-backend-builder', 'MAX_LOOPS']);

    // The resumed attempt is attempt 3, briefed with the last committed failure (attempt 1's).
    const prompt = resumed.promptsFor('04-backend-builder')[0];
    expect(prompt).toMatch(/attempt 3 of 3\./);
    expect(prompt).toContain('expected 200, received 401');
  }, RUN_TIMEOUT_MS);

  it('MINOR-6 a resumed attempt after a builder returned status FAIL is briefed with that status failure', async () => {
    const unfinished = () => {
      const output = backend();
      return { ...output, status: 'FAIL', details: { ...output.details, summary: 'Ran out of room before the route.' } };
    };
    const fresh = scriptedInvoker({ ...passingScript(), '04-backend-builder': unfinished }, { cwd: project.dir });
    const kill = killAt(fresh.invoke, '04-backend-builder', 2, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke });
    const killed = restoreSnapshot(project.dir, kill.snapshot());

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    const prompt = resumed.promptsFor('04-backend-builder')[0];
    expect(prompt).toMatch(/attempt 3 of 3\./);
    expect(prompt).toContain('Builder returned status FAIL: Ran out of room before the route.');
    expect(state.completionStatus).toBe('SUCCESS');
  }, RUN_TIMEOUT_MS);

  it('D-2 a run killed inside validator round 1 resumes at that round\'s builder fix, then re-runs Gates 1, 3 and 1.5, Gate 2 and the Validator', async () => {
    const script = {
      ...passingScript(),
      '07-validator': (_call: AgentInvocation, n: number) =>
        n === 1 ? validator({ status: 'FAIL', issues: [issue()] }) : validator()
    };
    const fresh = scriptedInvoker(script, { cwd: project.dir });
    const kill = killAt(fresh.invoke, '04-backend-builder', 2, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    expect(killed.validatorRoundsCompleted).toBe(1);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const gates = recordingGates();
    const logs: string[] = [];
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: killed,
      gates: gates.gates,
      logger: message => logs.push(message)
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toEqual(['04-backend-builder', '07-validator']);
    expect(resumed.promptsFor('04-backend-builder')[0]).toContain('Route has no auth check');
    expect(state.builderAttempts?.['04-backend-builder']?.validatorRounds[1]).toBe(2);
    expect(gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditInfrastructure', 'auditExecution']);
    expect(logs.some(line => /artifacts verified to exist on disk/.test(line))).toBe(true);
    expect(state.executionGateHistory?.map(r => r.round)).toEqual([0, 1]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-39 gates are evaluated again on resume', () => {
  type Case = {
    first: () => { invoke: AgentInvoker; setup?: () => void };
    verify: (resumed: ReturnType<typeof scriptedInvoker>, state: FeatureState, gates: string[], logs: string[]) => void;
  };

  it.each<[string, Case]>([
    [
      'Gate 1.5, Gate 2 and the Stage 4 gate after a Validator ESCALATE',
      {
        first: () => ({
          invoke: scriptedInvoker(
            { ...passingScript(), '07-validator': (_c: AgentInvocation, n: number) => (n === 1 ? validator({ status: 'ESCALATE' }) : validator()) },
            { cwd: project.dir }
          ).invoke
        }),
        verify: (resumed, state, gates, logs) => {
          expect(resumed.agents()).toEqual(['07-validator']);
          expect(gates).toEqual(['auditInfrastructure', 'auditExecution']);
          expect(logs.some(line => /Stage 4 passed/.test(line))).toBe(true);
          expect(state.completionStatus).toBe('SUCCESS');
        }
      }
    ],
    [
      'Gate 1 and the Stage 3 gate after a Gate 1 failure',
      {
        // No cwd: the builder's claimed file is never written, so Gate 1 reports a hallucination.
        first: () => ({
          invoke: scriptedInvoker(passingScript()).invoke,
          setup: () => {
            mkdirSync(join(project.dir, 'src'), { recursive: true });
            writeFileSync(join(project.dir, 'src', 'a.ts'), 'export const a = 1;\n');
          }
        }),
        verify: (resumed, state, _gates, logs) => {
          expect(resumed.agents()).toEqual(['06-test-verifier', '07-validator']);
          expect(logs.some(line => /All 1 artifacts verified to exist on disk/.test(line))).toBe(true);
          expect(logs.some(line => /Stage 3 passed/.test(line))).toBe(true);
          expect(state.completionStatus).toBe('SUCCESS');
        }
      }
    ],
    [
      'the Stage 3 gate after a Stage 3 gate failure',
      {
        // The builder touched a file the approved FILE_LIST does not name: All Files Modified fails.
        first: () => ({
          invoke: scriptedInvoker({ ...passingScript(), '04-backend-builder': backend({ files: ['src/elsewhere.ts'] }) }, { cwd: project.dir }).invoke
        }),
        verify: (resumed, state) => {
          // Builders are never invalidated: the gate is judged again, on the same work, and fails again.
          expect(resumed.agents()).toEqual([]);
          const stage3Failures = state.escalations.filter(e => /^Stage 3 gate failed/.test(e.context.message));
          expect(stage3Failures).toHaveLength(2);
          expect(state.completionStatus).toBe('ESCALATED');
        }
      }
    ]
  ])('AC-39 on resume every gate for unfinished steps is evaluated again (%s)', async (_label, testCase) => {
    const { invoke, setup } = testCase.first();
    const first = await runToEnd({ cwd: project.dir, invoke });
    expect(first.completionStatus).toBe('ESCALATED');
    setup?.();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const gates = recordingGates();
    const logs: string[] = [];
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk()!,
      gates: gates.gates,
      logger: message => logs.push(message)
    });

    testCase.verify(resumed, state, gates.calls.map(c => c.gate), logs);
  }, RUN_TIMEOUT_MS);
});

describe('AC-71 / AC-72 an exhausted builder needs a grant', () => {
  it('AC-71 resuming a builder-exhausted run without --grant-attempts is refused naming --grant-attempts <n> and state.json is unchanged', async () => {
    const first = scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir });
    await runToEnd({ cwd: project.dir, invoke: first.invoke });
    const before = stateBytes();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    let refusal: unknown;
    try {
      await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()! });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'NEEDS_GRANT' });
    expect((refusal as Error).message).toContain('--grant-attempts <n>');
    expect(resumed.calls).toEqual([]);
    expect(stateBytes()).toBe(before);
  }, RUN_TIMEOUT_MS);

  it.each<[number, string, { phase: 'stage3' } | { phase: 'validator-round'; round: number }]>([
    [2, 'Stage 3', { phase: 'stage3' }],
    [1, 'validator round 1', { phase: 'validator-round', round: 1 }]
  ])('AC-72 --grant-attempts %i gives the exhausted builder exactly that many attempts, recorded with builder, n and timestamp (%s)', async (n, _label, at) => {
    const first = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, call: number) =>
          at.phase === 'stage3' || call > 1 ? stillRed() : backend(),
        '07-validator': (_call: AgentInvocation, call: number) =>
          call === 1 ? validator({ status: 'FAIL', issues: [issue()] }) : validator()
      },
      { cwd: project.dir }
    );
    await runToEnd({ cwd: project.dir, invoke: first.invoke });
    expect(exhaustedBuilder(onDisk()!)).toEqual({ builder: '04-backend-builder', at });

    const resumed = scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk()!,
      resume: { action: { kind: 'continue' }, grantAttempts: n }
    });

    expect(resumed.agents()).toEqual(Array(n).fill('04-backend-builder'));
    expect(state.attemptGrants).toEqual([{ builder: '04-backend-builder', attempts: n, at, grantedAt: expect.any(String) }]);
    expect(Number.isNaN(Date.parse(state.attemptGrants![0].grantedAt))).toBe(false);
    expect(state.resumeHistory?.at(-1)).toMatchObject({ fromClass: 'ESCALATED', grantedAttempts: n });

    const counts = state.builderAttempts!['04-backend-builder']!;
    expect(at.phase === 'stage3' ? counts.stage3 : counts.validatorRounds[1]).toBe(MAX_BUILDER_ATTEMPTS + n);
    expect([state.escalations.at(-1)!.agent, state.escalations.at(-1)!.reason]).toEqual(['04-backend-builder', 'MAX_LOOPS']);
    expect(state.escalations.at(-1)!.context.loopCount).toBe(MAX_BUILDER_ATTEMPTS + n);
  }, RUN_TIMEOUT_MS);

  it("AC-72 a granted attempt that passes is accepted by the Stage 3 gate's loop criterion and the run succeeds", async () => {
    const first = scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir });
    await runToEnd({ cwd: project.dir, invoke: first.invoke });

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk()!,
      resume: { action: { kind: 'continue' }, grantAttempts: 1 }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.promptsFor('04-backend-builder')[0]).toMatch(/attempt 4 of 4\./);
    expect(state.builderAttempts?.['04-backend-builder']?.stage3).toBe(MAX_BUILDER_ATTEMPTS + 1);
  }, RUN_TIMEOUT_MS);
});

describe('I-6 a gate failure invalidates the steps it judged', () => {
  it.each<[string, Partial<Record<string, object>>, string, string[], number[], (() => (message: string) => void) | undefined]>([
    ['story gate', { '02-story-writer': untestableStory() }, '02-story-writer', ['02-story-writer', '03-spec-writer', '04-backend-builder', '06-test-verifier', '07-validator'], [1, 2, 3], undefined],
    ['spec gate', {}, '03-spec-writer', ['03-spec-writer', '04-backend-builder', '06-test-verifier', '07-validator'], [2, 3], briefMissingAtGate]
  ])('I-6 a %s failure invalidates the agent it judged, so a resume re-runs it and asks its checkpoint', async (_gate, overrides, agent, rerun, asked, logger) => {
    const first = scriptedInvoker({ ...passingScript(), ...overrides }, { cwd: project.dir });
    await runToEnd({ cwd: project.dir, invoke: first.invoke, ...(logger ? { logger: logger() } : {}) });
    const escalated = onDisk()!;
    const judged = escalated.stageHistory.filter(step => step.agent === agent);
    expect(judged).toHaveLength(1);
    expect(judged[0].invalidated?.reason).toMatch(/gate failed/i);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const approver = decisions();
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: escalated, approveCheckpoint: approver.approve });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toEqual(rerun);
    expect(approver.requests.map(r => r.id)).toEqual(asked);
  }, RUN_TIMEOUT_MS);

  it('I-6 a Stage 4 gate failure invalidates the Test Verifier and the Validator, so a resume re-runs both', async () => {
    const first = scriptedInvoker(
      {
        ...passingScript(),
        '07-validator': (_call: AgentInvocation, n: number) =>
          n === 1 ? validator({ security: { authImplemented: false } }) : validator()
      },
      { cwd: project.dir }
    );
    const escalated = await runToEnd({ cwd: project.dir, invoke: first.invoke });
    expect(escalated.escalations.at(-1)!.context.message).toMatch(/^Stage 4 gate failed/);
    for (const agent of ['06-test-verifier', '07-validator']) {
      expect(escalated.stageHistory.filter(s => s.agent === agent).map(s => s.invalidated?.reason)).toEqual([
        expect.stringMatching(/Stage 4 gate failed/)
      ]);
    }
    expect(escalated.stageHistory.find(s => s.agent === '04-backend-builder')!.invalidated).toBeUndefined();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()! });

    expect(resumed.agents()).toEqual(['06-test-verifier', '07-validator']);
    expect(state.completionStatus).toBe('SUCCESS');
  }, RUN_TIMEOUT_MS);
});

describe('I-7 approved documents must be unchanged on resume', () => {
  it.each<[string, (path: string) => void]>([
    ['edited', path => appendFileSync(path, '\nOne more requirement nobody approved.\n')],
    ['removed', path => rmSync(path)]
  ])('I-7 a resume is refused with APPROVED_ARTIFACT_CHANGED when the approved USER_STORY.md was %s, and state.json is unchanged', async (_how, change) => {
    const first = scriptedInvoker(passingScript(), { cwd: project.dir });
    const escalated = await runToEnd({ cwd: project.dir, invoke: first.invoke, logger: briefMissingAtGate() });
    expect(escalated.checkpointApprovals.map(a => a.checkpointId)).toEqual([1]);

    change(join(project.dir, '.factory', escalated.featureId, 'USER_STORY.md'));
    const before = stateBytes();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    let refusal: unknown;
    try {
      await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()! });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'APPROVED_ARTIFACT_CHANGED' });
    expect((refusal as Error).message).toMatch(/CHECKPOINT 1/);
    expect((refusal as Error).message).toContain(`--close ${escalated.featureId}`);
    expect(resumed.calls).toEqual([]);
    expect(stateBytes()).toBe(before);
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-11 the Gate 2 reference after a resume', () => {
  it("MINOR-11 a resumed Gate 2 is judged against the run's first passing count", async () => {
    // Fresh run: the first Gate 2 detects no tests, blocks, and the run escalates.
    const firstGates = recordingGates({ auditExecution: executionAudit({ total: 0 }) });
    const first = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, gates: firstGates.gates });
    expect(first.executionGateHistory?.map(r => r.canAdvance)).toEqual([false]);

    // Resume: 10 tests pass, the Validator sends a round back, and the round's Gate 2 counts 8.
    const gates = recordingGates({ auditExecution: n => executionAudit({ total: n === 1 ? 10 : 8 }) });
    const resumed = scriptedInvoker(
      {
        ...passingScript(),
        '07-validator': (_call: AgentInvocation, n: number) =>
          n === 1 ? validator({ status: 'FAIL', issues: [issue()] }) : validator()
      },
      { cwd: project.dir }
    );
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()!, gates: gates.gates });

    const history = state.executionGateHistory!;
    expect(history.map(r => [r.round, r.passed + r.failed, r.canAdvance])).toEqual([
      [0, 0, false],
      [0, 10, true],
      [1, 8, true]
    ]);
    // Judged against the first PASSING count (10), not the blocking evaluation's 0.
    expect(history[2].referenceCount).toBe(10);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.context.message).toMatch(/^Stage 4 gate failed/);
  }, RUN_TIMEOUT_MS);
});

describe('D-A the Gate 2 reference can never drop on resume', () => {
  it('I-12 a resumed round 0 is judged against the baseline when it is higher than the run\'s first passing count', async () => {
    // Fresh run, no baseline: 8 tests pass at round 0, then the Stage 4 gate fails on security.
    const first = scriptedInvoker(
      { ...passingScript(), '07-validator': (_call: AgentInvocation, n: number) => (n === 1 ? validator({ security: { authImplemented: false } }) : validator()) },
      { cwd: project.dir }
    );
    const escalated = await runToEnd({ cwd: project.dir, invoke: first.invoke, gates: recordingGates({ auditExecution: executionAudit({ total: 8 }) }).gates });
    expect(escalated.executionGateHistory?.map(r => [r.round, r.passed + r.failed, r.referenceCount])).toEqual([[0, 8, undefined]]);

    // Meanwhile a baseline of 10 appears. The resumed round 0 is judged against 10, not 8.
    writeFileSync(join(project.dir, '.factory', BASELINE_FILENAME), JSON.stringify({ schemaVersion: 1, runId: 'other', testCount: 10, recordedAt: '2026-10-04T00:00:00.000Z' }));
    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      resumeFromState: onDisk()!,
      gates: recordingGates({ auditExecution: executionAudit({ total: 8 }) }).gates
    });

    expect(state.executionGateHistory!.map(r => [r.round, r.passed + r.failed, r.referenceCount])).toEqual([
      [0, 8, undefined],
      [0, 8, 10]
    ]);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.context.blockers?.join('\n')).toMatch(/No Regressions/);
  }, RUN_TIMEOUT_MS);
});

describe('D-6 an approved CP3 is the end of the run, idempotently', () => {
  it('D-6 resuming a run whose CP3 was approved but whose baseline write failed writes the baseline and finishes SUCCESS without invoking or asking anyone', async () => {
    const baselinePath = join(project.dir, '.factory', BASELINE_FILENAME);
    // Approving CP3 also plants a directory where the baseline goes, so its write fails.
    const approver = decisions(true, true, () => (mkdirSync(baselinePath), true));
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: approver.approve
    });
    expect(first.completionStatus).toBe('ESCALATED');
    expect(first.checkpointApprovals.map(a => a.checkpointId)).toEqual([1, 2, 3]);
    rmdirSync(baselinePath);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const gates = recordingGates();
    const again = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk()!,
      approveCheckpoint: again.approve,
      gates: gates.gates
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.calls).toEqual([]);
    expect(again.requests).toEqual([]);
    expect(gates.calls).toEqual([]);
    expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toMatchObject({ runId: state.featureId, testCount: 10 });
  }, RUN_TIMEOUT_MS);
});

describe('I-7 an approved CP3 must be unchanged before the run ends on it', () => {
  /** A run whose CP3 was approved but whose baseline write failed: what D-6 resumes idempotently. */
  async function approvedCp3ThenFailed(): Promise<FeatureState> {
    const baselinePath = join(project.dir, '.factory', BASELINE_FILENAME);
    const approver = decisions(true, true, () => (mkdirSync(baselinePath), true));
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: approver.approve
    });
    expect(first.checkpointApprovals.map(a => a.checkpointId)).toEqual([1, 2, 3]);
    rmdirSync(baselinePath);
    return first;
  }

  it.each<[string, (state: FeatureState) => Partial<Parameters<typeof runToEnd>[0]>]>([
    ['its change differs', () => ({ changes: fakeChangeTracker({ text: 'Somebody changed the code after CP3.\n' }) })],
    ['its VALIDATION_REPORT.md was edited', state => (appendFileSync(join(project.dir, '.factory', state.featureId, 'VALIDATION_REPORT.md'), '\nEdited.\n'), {})]
  ])('I-7 a resume of a run whose CP3 was approved is refused with APPROVED_ARTIFACT_CHANGED when %s, and state.json is unchanged', async (_how, change) => {
    const first = await approvedCp3ThenFailed();
    const overrides = change(first);
    const before = stateBytes();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    let refusal: unknown;
    try {
      await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()!, ...overrides });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'APPROVED_ARTIFACT_CHANGED' });
    expect((refusal as Error).message).toMatch(/CHECKPOINT 3/);
    expect(resumed.calls).toEqual([]);
    expect(stateBytes()).toBe(before);
    expect(existsSync(join(project.dir, '.factory', BASELINE_FILENAME))).toBe(false);
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-9 findings are recorded once across a resume', () => {
  it('MINOR-9 a resumed Validator does not record again an IMPORTANT finding the run already holds', async () => {
    const limiter: ValidatorIssue = { ...issue(), severity: 'IMPORTANT', message: 'Add rate limiting' };
    const first = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ issues: [limiter], security: { authImplemented: false } }) },
      { cwd: project.dir }
    );
    const escalated = await runToEnd({ cwd: project.dir, invoke: first.invoke });
    expect(escalated.escalations.at(-1)!.context.message).toMatch(/^Stage 4 gate failed/);

    const resumed = scriptedInvoker({ ...passingScript(), '07-validator': validator({ issues: [limiter] }) }, { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()! });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toContain('07-validator');
    expect((state.importantFindings ?? []).filter(f => f.source === '07-validator').map(f => f.message)).toEqual([
      '[src/a.ts:1] Add rate limiting'
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('D-3 a paused run resumed with a plain continue', () => {
  it('D-3 resuming a PAUSED run without a decision changes nothing and returns it as it is', async () => {
    const paused = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: decisions({ decision: 'PAUSE' }).approve
    });
    expect(paused.status).toBe('PAUSED');
    const before = stateBytes();

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const approver = decisions();
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk()!, approveCheckpoint: approver.approve });

    expect(state.status).toBe('PAUSED');
    expect(state.pendingCheckpoint?.checkpointId).toBe(1);
    expect(resumed.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
    expect(stateBytes()).toBe(before);
  }, RUN_TIMEOUT_MS);
});

// ============================================================================================
// PR B-1 step 6: the library makes every description refusal (AC-99), and a pre-A-2 MAX_LOOPS
// record has its builder phase inferred (AC-101).
// ============================================================================================

/** Run `start`, then hand back what a refused call must leave untouched: the tree and the agent log. */
async function refusedAfter(start: () => Promise<unknown>, resume: (invoke: AgentInvoker) => Promise<unknown>) {
  await start();
  const before = treeSnapshot(project.dir);
  const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
  let refusal: unknown;
  try {
    await resume(resumed.invoke);
  } catch (error) {
    refusal = error;
  }
  return { refusal, before, resumed };
}

describe('AC-99 the library makes the description refusals, after checkResumeRequest', () => {
  /** Drop featureDescription from the only run's state.json, as a pre-A-2 record. */
  const forgetDescription = () => {
    const legacy = onDisk()!;
    delete legacy.featureDescription;
    saveState(project.dir, legacy);
  };

  it.each<[string, string, () => Promise<unknown>, (invoke: AgentInvoker) => Promise<unknown>, RegExp]>([
    [
      'RUN_FINISHED for a finished run given a different description',
      'RUN_FINISHED',
      () => runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke }),
      invoke => runToEnd({ cwd: project.dir, invoke, featureDescription: 'add SMS login', resumeFromState: onDisk()! }),
      /already finished \(SUCCESS\)/
    ],
    [
      'NEEDS_GRANT for an exhausted-builder run given a different description',
      'NEEDS_GRANT',
      () => runToEnd({ cwd: project.dir, invoke: scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir }).invoke }),
      invoke => runToEnd({ cwd: project.dir, invoke, featureDescription: 'add SMS login', resumeFromState: onDisk()! }),
      /--grant-attempts <n>/
    ],
    [
      'DESCRIPTION_MISMATCH for a resumable run given a different description, with runFeatureFactory called directly',
      'DESCRIPTION_MISMATCH',
      () => runToEnd({ cwd: project.dir, invoke: scriptedInvoker({ ...passingScript(), '06-test-verifier': testVerifier({ failed: 1 }) }, { cwd: project.dir }).invoke }),
      invoke =>
        runFeatureFactory({
          featureName: 'fixture-run',
          featureDescription: 'add SMS login',
          cwd: project.dir,
          invoke,
          resumeFromState: onDisk()!,
          logger: () => {},
          approveCheckpoint: async () => true,
          gates: recordingGates().gates,
          changes: fakeChangeTracker()
        }),
      /--feature "add SMS login" does not match the description saved in run \S+ \("add 2FA"\)\. Omit --feature to resume it as it was started\./
    ],
    [
      'DESCRIPTION_REQUIRED for a run recorded without a description and given none',
      'DESCRIPTION_REQUIRED',
      async () => {
        await runToEnd({ cwd: project.dir, invoke: scriptedInvoker({ ...passingScript(), '06-test-verifier': testVerifier({ failed: 1 }) }, { cwd: project.dir }).invoke });
        forgetDescription();
      },
      invoke => runToEnd({ cwd: project.dir, invoke, featureDescription: undefined, resumeFromState: onDisk()! }),
      /recorded without a feature description.*--feature "<the description it was started with>"/
    ]
  ])('AC-99 the library refuses %s after checkResumeRequest and writes nothing', async (_label, code, start, resume, message) => {
    const { refusal, before, resumed } = await refusedAfter(start, resume);

    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code });
    expect((refusal as Error).message).toMatch(message);
    expect(resumed.calls).toEqual([]);
    expect(treeSnapshot(project.dir)).toEqual(before);
  }, RUN_TIMEOUT_MS);

  it.each([[undefined], [''], ['   ']])(
    'AC-99 a fresh run without a description (%j) is refused DESCRIPTION_REQUIRED before the run directory is prepared, and writes nothing',
    async description => {
      // A finished run that a fresh start would archive: refused first, so it stays where it is.
      seedRun(project.dir, 'SUCCESS');
      const before = treeSnapshot(project.dir);
      const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

      let refusal: unknown;
      try {
        await runToEnd({ cwd: project.dir, invoke: invoker.invoke, featureDescription: description });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(RunRefusedError);
      expect(refusal).toMatchObject({ code: 'DESCRIPTION_REQUIRED', message: 'A new run needs a feature description (--feature).' });
      expect(invoker.calls).toEqual([]);
      expect(treeSnapshot(project.dir)).toEqual(before);
    },
    RUN_TIMEOUT_MS
  );
});

describe('AC-101 a pre-A-2 MAX_LOOPS record (no builderPhase)', () => {
  it.each<[number, string, { phase: 'stage3' } | { phase: 'validator-round'; round: number }, number]>([
    [2, 'Stage 3', { phase: 'stage3' }, 3],
    [1, 'validator round 1', { phase: 'validator-round', round: 1 }, 4]
  ])('AC-101 a plain resume of a pre-A-2 MAX_LOOPS record is refused NEEDS_GRANT with state.json byte-identical, and --grant-attempts n gives exactly n attempts in the inferred phase (%i, %s)', async (n, _label, at, stage) => {
    const first = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, call: number) =>
          at.phase === 'stage3' || call > 1 ? stillRed() : backend(),
        '07-validator': (_call: AgentInvocation, call: number) =>
          call === 1 ? validator({ status: 'FAIL', issues: [issue()] }) : validator()
      },
      { cwd: project.dir }
    );
    await runToEnd({ cwd: project.dir, invoke: first.invoke });

    // Make it a pre-A-2 record: the exhaustion carries no builderPhase.
    const legacy = onDisk()!;
    const last = legacy.escalations.at(-1)!;
    expect([last.stage, last.agent, last.reason]).toEqual([stage, '04-backend-builder', 'MAX_LOOPS']);
    delete last.context.builderPhase;
    saveState(project.dir, legacy);
    expect(onDisk()!.escalations.at(-1)!.context.builderPhase).toBeUndefined();
    expect(exhaustedBuilder(onDisk()!)).toEqual({ builder: '04-backend-builder', at });
    const before = stateBytes();

    // A plain resume: refused, naming --grant-attempts, nothing written.
    const plain = scriptedInvoker(passingScript(), { cwd: project.dir });
    let refusal: unknown;
    try {
      await runToEnd({ cwd: project.dir, invoke: plain.invoke, resumeFromState: onDisk()! });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'NEEDS_GRANT' });
    expect((refusal as Error).message).toContain('--grant-attempts <n>');
    expect(plain.calls).toEqual([]);
    expect(stateBytes()).toBe(before);

    // --grant-attempts n: exactly n more attempts, in the inferred phase.
    const resumed = scriptedInvoker({ ...passingScript(), '04-backend-builder': stillRed }, { cwd: project.dir });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk()!,
      resume: { action: { kind: 'continue' }, grantAttempts: n }
    });

    expect(resumed.agents()).toEqual(Array(n).fill('04-backend-builder'));
    // Every resumed invocation ran in the inferred phase.
    const resumedInvocations = (state.agentInvocations ?? []).slice(-n);
    expect(resumedInvocations.map(record => record.agent)).toEqual(Array(n).fill('04-backend-builder'));
    for (const record of resumedInvocations) expect(record).toMatchObject(at);
    expect(state.attemptGrants).toEqual([{ builder: '04-backend-builder', attempts: n, at, grantedAt: expect.any(String) }]);
    const counts = state.builderAttempts!['04-backend-builder']!;
    expect(at.phase === 'stage3' ? counts.stage3 : counts.validatorRounds[1]).toBe(MAX_BUILDER_ATTEMPTS + n);
    expect(state.escalations.at(-1)!.context).toMatchObject({ loopCount: MAX_BUILDER_ATTEMPTS + n, builderPhase: at });
  }, RUN_TIMEOUT_MS);
});
