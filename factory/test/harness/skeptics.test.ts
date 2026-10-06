/**
 * The skeptic step, orchestrator-level [O] (PR B-2, D-4, D-11, D-12; build step 7).
 *
 * Every CRITICAL issue of the merged reviews is challenged by two blind, read-only skeptic
 * invocations (07c-validator-skeptic, instances A then B) before routing, in every evaluation.
 * Both must return DISPROVED, or the issue stands. A disproved CRITICAL becomes one IMPORTANT
 * finding, shown at CHECKPOINT 3 and never routed; the Stage 4 gate reads the typed verdict.
 * A skeptic that fails its schema, echoes another key, throws, or returns anything but PASS
 * escalates, and the issue is not disproved.
 *
 * Fake tracker and fake gates: no network, no child process, no git.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import { loadState } from '../../harness/state-store';
import { FeatureState } from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { issueKey } from '../../harness/verification';
import { echoedIssueKey, followup, skeptic, validator } from '../fixtures/agent-outputs';
import { fakeChangeTracker } from '../fixtures/changes';
import {
  evaluations,
  InvokerScript,
  passingScript,
  restoreSnapshot,
  runToEnd,
  scriptedInvoker,
  SimulatedKill,
  tempProject,
  TempProject
} from '../fixtures/harness-run';
import { until } from '../fixtures/barriers';

const RUN_TIMEOUT_MS = 30_000;

const VAL = '07-validator';
const FOLLOWUP = '07b-validator-followup';
const SKEPTIC = '07c-validator-skeptic';
const BUILDER = '04-backend-builder';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-skeptic-');
});

afterEach(() => {
  project.cleanup();
});

const findingsFrom = (state: FeatureState, source: string): string[] =>
  (state.importantFindings ?? []).filter(finding => finding.source === source).map(finding => finding.message);

/** The run's only live state.json. */
const onDisk = (state: FeatureState): FeatureState => loadState(project.dir, state.featureId)!;

const critical = (overrides: Partial<ValidatorIssue> = {}): ValidatorIssue => ({
  severity: 'CRITICAL',
  file: 'src/a.ts',
  line: 1,
  message: 'Route has no auth check',
  suggestion: 'Add the guard',
  canFix: true,
  ...overrides
});

/** A Validator that reports `issues` on its first call (status FAIL when one is CRITICAL), then passes. */
const reportsFirst = (issues: ValidatorIssue[]) => (_call: AgentInvocation, n: number) =>
  n === 1 ? validator({ status: issues.some(i => i.severity === 'CRITICAL') ? 'FAIL' : 'PASS', issues }) : validator();

/** A skeptic whose verdict depends on its instance (the "You are skeptic X." line). */
const byInstance = (verdicts: { A: 'DISPROVED' | 'UPHELD'; B: 'DISPROVED' | 'UPHELD' }) => (call: AgentInvocation) => {
  const instance = call.prompt.includes('You are skeptic A.') ? 'A' : 'B';
  return skeptic({ verdict: verdicts[instance], reason: `skeptic ${instance} reason: ${verdicts[instance]}` })(call);
};

/** The key the merged list gives a main-review issue whose file is project-relative. */
const mainKey = (issue: ValidatorIssue) => issueKey('07-validator', issue);

describe('AC-128 two blind skeptics per CRITICAL', () => {
  it.each<[string, InvokerScript, string[]]>([
    ['first pass', { ...passingScript(), [VAL]: reportsFirst([critical()]) }, [VAL, SKEPTIC, SKEPTIC, BUILDER, VAL]],
    [
      'validator round',
      {
        ...passingScript(),
        [VAL]: (_call: AgentInvocation, n: number) =>
          n === 1
            ? validator({ status: 'FAIL', issues: [critical()] })
            : n === 2
              ? validator({ status: 'FAIL', issues: [critical({ message: 'The guard is bypassable' })] })
              : validator()
      },
      [VAL, SKEPTIC, SKEPTIC, BUILDER, VAL, SKEPTIC, SKEPTIC, BUILDER, VAL]
    ]
  ])("AC-128 every merged CRITICAL gets two skeptic invocations before routing, and neither prompt holds the other's verdict (%s)", async (_label, script, sequence) => {
    const events: string[] = [];
    const base = scriptedInvoker({ ...script, [SKEPTIC]: skeptic({ reason: 'UNIQUE-REASON-OF-THIS-SKEPTIC' }) }, { cwd: project.dir });
    const invoke: AgentInvoker = async call => {
      events.push(call.agent);
      return base.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    // Each evaluation with a CRITICAL: the Validator, skeptic A then B, and only then the routed builder.
    expect(events.slice(events.indexOf(VAL))).toEqual(sequence);
    const skeptics = base.calls.filter(c => c.agent === SKEPTIC);
    const judged = evaluations(state).filter(ev => (ev.skeptics ?? []).length > 0);
    expect(judged.map(ev => ev.kind)).toEqual(sequence.filter(a => a === BUILDER).map((_, i) => (i === 0 ? 'first-pass' : 'validator-round')));
    for (const [i, evaluation] of judged.entries()) {
      const [a, b] = [skeptics[2 * i], skeptics[2 * i + 1]];
      expect(a.prompt).toContain('You are skeptic A.');
      // Blind: B's prompt is A's with the instance letter changed, and neither holds a verdict or reason.
      expect(b.prompt).toBe(a.prompt.replace('You are skeptic A.', 'You are skeptic B.'));
      for (const prompt of [a.prompt, b.prompt]) expect(prompt).not.toContain('UNIQUE-REASON-OF-THIS-SKEPTIC');
      expect(evaluation.skeptics!.map(v => [v.issueKey, v.instance, v.verdict])).toEqual([
        [echoedIssueKey(a.prompt), 'A', 'UPHELD'],
        [echoedIssueKey(b.prompt), 'B', 'UPHELD']
      ]);
    }
  }, RUN_TIMEOUT_MS);

  it('AC-128 IMPORTANT and MINOR issues are never sent to skeptics, and with no CRITICAL no skeptic runs', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        [VAL]: validator({
          issues: [
            { severity: 'IMPORTANT', file: 'src/a.ts', line: 2, message: 'Magic number', suggestion: 'Name it', canFix: true },
            { severity: 'MINOR', file: 'src/a.ts', line: 3, message: 'Typo', suggestion: 'Fix it', canFix: true }
          ]
        })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(invoker.agents()).not.toContain(SKEPTIC);
    expect(evaluations(state)[0].skeptics).toBeUndefined();
    expect(evaluations(state)[0].closed).toMatchObject({ outcome: 'decided', verdict: { passed: true, standing: [], disproved: [] } });
  }, RUN_TIMEOUT_MS);
});

describe('AC-129 AC-130 AC-131 the verdict', () => {
  it('AC-129 a split verdict keeps the issue CRITICAL and it is routed as in Phase A', async () => {
    const issue = critical();
    const invoker = scriptedInvoker(
      { ...passingScript(), [VAL]: reportsFirst([issue]), [SKEPTIC]: byInstance({ A: 'DISPROVED', B: 'UPHELD' }) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const [first] = evaluations(state);
    expect(first.closed).toMatchObject({ outcome: 'decided', verdict: { passed: false, standing: [mainKey(issue)], disproved: [] } });
    expect(invoker.promptsFor(BUILDER)[1]).toContain('[src/a.ts:1] Route has no auth check — Add the guard');
    expect(state.validatorRoundsCompleted).toBe(1);
    expect(findingsFrom(state, SKEPTIC)).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-130 a disproved CRITICAL becomes one IMPORTANT finding with the issue and both reasons, is shown at CHECKPOINT 3, is not routed and is never dropped', async () => {
    const requests: CheckpointRequest[] = [];
    const issue = critical();
    const invoker = scriptedInvoker(
      { ...passingScript(), [VAL]: reportsFirst([issue]), [SKEPTIC]: byInstance({ A: 'DISPROVED', B: 'DISPROVED' }) },
      { cwd: project.dir }
    );

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: async request => {
        requests.push(request);
        return true;
      }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    const finding =
      'CRITICAL disproved by both skeptics (kept as IMPORTANT): [src/a.ts:1] Route has no auth check — Add the guard' +
      ' | skeptic A: skeptic A reason: DISPROVED | skeptic B: skeptic B reason: DISPROVED';
    expect(findingsFrom(state, SKEPTIC)).toEqual([finding]);
    expect(findingsFrom(onDisk(state), SKEPTIC)).toEqual([finding]);
    expect(requests.find(r => r.id === 3)!.text).toContain(`- [Stage 4 · ${SKEPTIC}] ${finding}`);
    // Not routed: the builder ran once (Stage 3), no round was opened, the 07 step is PASS.
    expect(invoker.agents().filter(a => a === BUILDER)).toHaveLength(1);
    expect(state.validatorRoundsCompleted ?? 0).toBe(0);
    expect(state.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['PASS']);
    expect(evaluations(state)[0].closed).toMatchObject({ outcome: 'decided', verdict: { passed: true, standing: [], disproved: [mainKey(issue)] } });
  }, RUN_TIMEOUT_MS);

  it('AC-131 one CRITICAL that both skeptics disproved passes the Stage 4 gate though the raw list still holds it, and an upheld one blocks', async () => {
    const issue = critical({ canFix: false });
    const disproving = scriptedInvoker(
      { ...passingScript(), [VAL]: reportsFirst([issue]), [SKEPTIC]: byInstance({ A: 'DISPROVED', B: 'DISPROVED' }) },
      { cwd: project.dir }
    );

    const passed = await runToEnd({ cwd: project.dir, invoke: disproving.invoke });

    // A FAIL whose CRITICALs were all disproved passes (I-13); the raw list still holds the CRITICAL.
    expect(passed.completionStatus).toBe('SUCCESS');
    const recorded = passed.stageHistory.find(s => s.agent === VAL)!;
    expect(recorded.status).toBe('PASS');
    expect((recorded.output as ReturnType<typeof validator>).status).toBe('FAIL');
    expect((recorded.output as ReturnType<typeof validator>).details.issues).toEqual([issue]);
    expect(passed.escalations).toEqual([]);

    // Upheld by one skeptic: the same CRITICAL stands; it cannot be fixed, so the run escalates,
    // and the Stage 4 gate is never passed on it.
    const upheld = tempProject('ff-skeptic-upheld-');
    try {
      const invoker = scriptedInvoker(
        { ...passingScript(), [VAL]: reportsFirst([issue]), [SKEPTIC]: byInstance({ A: 'DISPROVED', B: 'UPHELD' }) },
        { cwd: upheld.dir }
      );
      const blocked = await runToEnd({ cwd: upheld.dir, invoke: invoker.invoke });

      expect(blocked.completionStatus).toBe('ESCALATED');
      expect(blocked.escalations.at(-1)).toMatchObject({ stage: 4, agent: VAL, reason: 'CRITICAL_ISSUE' });
      expect(blocked.escalations.at(-1)!.context.issues).toEqual(['[src/a.ts:1] Route has no auth check — Add the guard (unroutable: CANNOT_FIX)']);
      expect(evaluations(blocked)[0].closed).toMatchObject({ outcome: 'decided', verdict: { passed: false, standing: [mainKey(issue)] } });
      expect(blocked.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['FAIL']);
    } finally {
      upheld.cleanup();
    }
  }, RUN_TIMEOUT_MS);
});

describe('AC-132 the tree a skeptic reads', () => {
  it('AC-132 a skeptic reads the tree its reviewer read: the copy for a Validator issue, the project for a follow-up issue', async () => {
    const mainIssue = critical();
    const followupIssue = critical({ file: 'test/a.test.ts', line: 4, message: 'The test can never fail', suggestion: 'Assert it' });
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        [VAL]: reportsFirst([mainIssue]),
        [FOLLOWUP]: followup({ files: ['test/a.test.ts'], issues: [followupIssue] }),
        [SKEPTIC]: byInstance({ A: 'DISPROVED', B: 'DISPROVED' })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }) });

    expect(state.completionStatus).toBe('SUCCESS');
    const copyDir = evaluations(state)[0].copy!.dir;
    const calls = invoker.calls.filter(c => c.agent === SKEPTIC);
    expect(calls.map(c => [echoedIssueKey(c.prompt), c.cwd])).toEqual([
      [mainKey(mainIssue), copyDir],
      [mainKey(mainIssue), copyDir],
      [issueKey('07b-validator-followup', followupIssue), undefined],
      [issueKey('07b-validator-followup', followupIssue), undefined]
    ]);
    expect(calls[0].prompt).toContain(`reported by 07-validator about the code in ${copyDir} (your working directory; read-only)`);
    expect(calls[2].prompt).toContain(`reported by 07b-validator-followup about the code in ${project.dir} (your working directory; read-only)`);
    expect(evaluations(state)[0].skeptics!.map(v => [v.origin, v.instance])).toEqual([
      ['07-validator', 'A'],
      ['07-validator', 'B'],
      ['07b-validator-followup', 'A'],
      ['07b-validator-followup', 'B']
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-133 recording and resume', () => {
  it('AC-133 each verdict is recorded per issue and per skeptic as it returns, and a resume skips recorded verdicts and never overwrites a Validator slot', async () => {
    const issue = critical();
    const script: InvokerScript = { ...passingScript(), [VAL]: reportsFirst([issue]) };
    const atSkepticCall: FeatureState[] = [];
    const base = scriptedInvoker(script, { cwd: project.dir });
    // Skeptic B is killed once A's verdict is on record (IMPORTANT-3: both start together, so B's
    // call waits for it): the process "dies" with A's verdict committed and B's not.
    let captured: FeatureState | undefined;
    const kill: AgentInvoker = async call => {
      if (call.agent !== SKEPTIC) return base.invoke(call);
      atSkepticCall.push(loadState(project.dir, onlyRunId())!);
      if (!call.prompt.includes('You are skeptic B.')) return base.invoke(call);
      await until(() => (evaluations(loadState(project.dir, onlyRunId()))[0]?.skeptics ?? []).length === 1, 'skeptic A\'s verdict on record');
      captured = loadState(project.dir, onlyRunId());
      throw new SimulatedKill(SKEPTIC, 2);
    };
    await runToEnd({ cwd: project.dir, invoke: kill });
    const killed = restoreSnapshot(project.dir, structuredClone(captured!));
    const [open] = evaluations(killed);
    expect(open.closed).toBeUndefined();
    expect(open.skeptics!.map(v => [v.issueKey, v.instance, v.verdict])).toEqual([[mainKey(issue), 'A', 'UPHELD']]);
    // At both calls nothing was recorded yet: they start together.
    expect(atSkepticCall.map(at => evaluations(at)[0].skeptics)).toEqual([undefined, undefined]);
    const runDir = join(project.dir, '.factory', killed.featureId);
    const documentA = `SKEPTIC_E1_${mainKey(issue)}_A.md`;
    expect(open.skeptics![0].document).toBe(join('.factory', killed.featureId, documentA));
    expect(readFileSync(join(runDir, documentA), 'utf8')).toBe('# Skeptic Review\n\nUPHELD: The issue stands as stated.');

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    expect(state.completionStatus).toBe('SUCCESS');
    // Only B re-ran; the Validator's slot and A's verdict are unchanged.
    expect(resumed.agents().slice(0, 1)).toEqual([SKEPTIC]);
    expect(resumed.calls[0].prompt).toContain('You are skeptic B.');
    expect(resumed.agents().filter(a => a === VAL)).toHaveLength(1); // the round's, not the first pass's
    const [first] = evaluations(state);
    expect(first.validator).toEqual(open.validator);
    expect(first.skeptics!.map(v => [v.instance, v.recordedAt])).toEqual([
      ['A', open.skeptics![0].recordedAt],
      ['B', expect.any(String)]
    ]);
    expect(existsSync(join(runDir, `SKEPTIC_E1_${mainKey(issue)}_B.md`))).toBe(true);
    // The kill left no record of B's first call (a killed process records nothing); the resume's B is.
    expect(state.agentInvocations!.filter(i => i.agent === SKEPTIC).map(i => [i.evaluation, i.instance])).toEqual([
      [1, 'A'],
      [1, 'B']
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('IMPORTANT-3 the skeptics start together', () => {
  it('IMPORTANT-3 neither skeptic is invoked after the other\'s verdict is on disk: both start before either is recorded, A first, and each verdict is recorded as it returns', async () => {
    const issues = [critical(), critical({ message: 'Second hole', line: 9 })];
    const base = scriptedInvoker({ ...passingScript(), [VAL]: reportsFirst(issues), [SKEPTIC]: byInstance({ A: 'UPHELD', B: 'DISPROVED' }) }, { cwd: project.dir });
    const seen: Array<{ instance: string; key: string; onDisk: string[] }> = [];
    const order: string[] = [];
    let releaseA: () => void = () => undefined;
    const invoke: AgentInvoker = async call => {
      if (call.agent !== SKEPTIC) return base.invoke(call);
      const instance = call.prompt.includes('You are skeptic A.') ? 'A' : 'B';
      const key = echoedIssueKey(call.prompt);
      // At call time: which verdicts on THIS issue are already on disk.
      const recorded = (evaluations(loadState(project.dir, onlyRunId()))[0]?.skeptics ?? []).filter(v => v.issueKey === key);
      seen.push({ instance, key, onDisk: recorded.map(v => v.instance) });
      order.push(`start ${instance}`);
      if (instance === 'A') {
        // A answers only after B has answered and been recorded: B's verdict must be on disk first.
        await new Promise<void>(done => (releaseA = done));
      } else {
        const answer = base.invoke(call);
        setImmediate(() => releaseA());
        order.push(`answer ${instance}`);
        return answer;
      }
      order.push(`answer ${instance}`);
      return base.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const keys = issues.map(mainKey);
    expect(seen).toEqual([
      { instance: 'A', key: keys[0], onDisk: [] },
      { instance: 'B', key: keys[0], onDisk: [] },
      { instance: 'A', key: keys[1], onDisk: [] },
      { instance: 'B', key: keys[1], onDisk: [] }
    ]);
    expect(order.slice(0, 2)).toEqual(['start A', 'start B']);
    // Recorded as each returned: B (answered first) before A.
    expect(evaluations(state)[0].skeptics!.map(v => [v.issueKey, v.instance])).toEqual([
      [keys[0], 'B'],
      [keys[0], 'A'],
      [keys[1], 'B'],
      [keys[1], 'A']
    ]);
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-3 when one skeptic fails, the other still runs to the end and is recorded, then the run escalates naming the failed one', async () => {
    const base = scriptedInvoker(
      {
        ...passingScript(),
        [VAL]: reportsFirst([critical()]),
        [SKEPTIC]: (call: AgentInvocation) =>
          call.prompt.includes('You are skeptic A.') ? skeptic({ verdict: 'DISPROVED', status: 'FAIL' })(call) : skeptic({ verdict: 'DISPROVED' })(call)
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: base.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: SKEPTIC, reason: 'CRITICAL_ISSUE' });
    expect(state.escalations.at(-1)!.context.message).toMatch(/^07c-validator-skeptic A returned FAIL on issue [0-9a-f]{12}: /);
    expect(evaluations(state)[0].skeptics!.map(v => [v.instance, v.verdict])).toEqual([['B', 'DISPROVED']]);
    expect(findingsFrom(state, SKEPTIC)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

/** The id of the only run in the project. */
function onlyRunId(): string {
  const factory = join(project.dir, '.factory');
  return readdirSync(factory).filter(name => name !== '_archive' && existsSync(join(factory, name, 'state.json')))[0];
}

describe('AC-134 a skeptic that does not answer', () => {
  type Case = [string, (call: AgentInvocation) => unknown, { agent: string; reason: string; message: RegExp }];
  const cases: Case[] = [
    [
      'fails its schema',
      call => ({ ...skeptic()(call), details: { ...skeptic()(call).details, verdict: 'MAYBE' } }),
      { agent: SKEPTIC, reason: 'SCHEMA_VALIDATION', message: /^Skeptic A output on issue [0-9a-f]{12} is invalid: Skeptic verdict must be one of DISPROVED, UPHELD/ }
    ],
    [
      'echoes another issue key',
      skeptic({ verdict: 'DISPROVED', issueKey: () => '000000000000' }),
      { agent: SKEPTIC, reason: 'SCHEMA_VALIDATION', message: /it echoed issue key "000000000000", but was given [0-9a-f]{12}$/ }
    ],
    [
      'throws',
      () => {
        throw new Error('SDK error: 529 overloaded');
      },
      { agent: 'orchestrator', reason: 'MANUAL', message: /^Orchestration error: SDK error: 529 overloaded$/ }
    ],
    [
      'returns ESCALATE',
      skeptic({ verdict: 'DISPROVED', status: 'ESCALATE' }),
      { agent: SKEPTIC, reason: 'CRITICAL_ISSUE', message: /^07c-validator-skeptic A returned ESCALATE on issue [0-9a-f]{12}: / }
    ],
    [
      'returns FAIL',
      skeptic({ verdict: 'DISPROVED', status: 'FAIL' }),
      { agent: SKEPTIC, reason: 'CRITICAL_ISSUE', message: /^07c-validator-skeptic A returned FAIL on issue [0-9a-f]{12}: / }
    ]
  ];

  it.each(cases)('AC-134 a skeptic that %s escalates and the issue is not treated as disproved', async (_label, answer, expected) => {
    const invoker = scriptedInvoker({ ...passingScript(), [VAL]: reportsFirst([critical()]), [SKEPTIC]: answer }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 4, agent: expected.agent, reason: expected.reason });
    expect(escalation.context.message).toMatch(expected.message);
    // Nothing was recorded as a verdict; the issue is neither disproved nor routed.
    const [evaluation] = evaluations(state);
    expect(evaluation.skeptics).toBeUndefined();
    expect(evaluation.closed?.outcome).toBe('escalated');
    expect(findingsFrom(state, SKEPTIC)).toEqual([]);
    // Both skeptics started together (IMPORTANT-3); both answered the same way, and A is reported.
    expect(invoker.agents().filter(a => a === SKEPTIC)).toHaveLength(2);
    expect(invoker.agents().filter(a => a === BUILDER)).toHaveLength(1);
    expect(state.stageHistory.some(s => s.agent === VAL && s.status === 'PASS')).toBe(false);
    // The invocations themselves are on record, with their evaluation and instance.
    expect(state.agentInvocations!.filter(i => i.agent === SKEPTIC).map(i => [i.evaluation, i.instance])).toEqual([
      [1, 'A'],
      [1, 'B']
    ]);
  }, RUN_TIMEOUT_MS);
});
