/**
 * Stage 4 verification, orchestrator-level [O] (PR B-2, D-3 and D-7 to D-15; build step 6).
 *
 * The Test Verifier (real tree) and the main Validator (a read-only copy of the latest Stage 3
 * snapshot, outside the project) run in parallel; Gate 2 runs after both; validator rounds run
 * Gate 2 then the Validator alone on a fresh copy. Every step is recorded on an evaluation, so a
 * kill resumes only unfinished work.
 *
 * Fake tracker and fake gates: no network, no child process, no git (the real-git cases are in
 * snapshot.test.ts). Parallel starts are proven with barriers that wait at most 10 s, never with
 * sleeps (C-33). Step 7 adds the follow-up, the merge and the skeptics to this file.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, relative } from 'path';

import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import { FeatureState } from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { NOT_GIT_SNAPSHOT_REASON } from '../../harness/checkpoint-presentation';
import { backend, followup, skeptic, testVerifier, validator } from '../fixtures/agent-outputs';
import { FAKE_COPY_CONTENT, FAKE_COPY_FILE, FAKE_SNAPSHOT_COMMIT, FAKE_SNAPSHOT_TREE, fakeChangeTracker } from '../fixtures/changes';
import { executionAudit, recordingGates } from '../fixtures/gates';
import {
  decisions,
  evaluations,
  InvokerScript,
  killAt,
  onDisk,
  passingScript,
  removeTree,
  restoreSnapshot,
  runToEnd,
  scriptedInvoker,
  ScriptEntry,
  SimulatedKill,
  tempProject,
  TempProject
} from '../fixtures/harness-run';
import { signal, until, within } from '../fixtures/barriers';

const RUN_TIMEOUT_MS = 30_000;

const TV = '06-test-verifier';
const VAL = '07-validator';
const FOLLOWUP = '07b-validator-followup';
const SKEPTIC = '07c-validator-skeptic';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-verify-');
});

afterEach(() => {
  project.cleanup();
});

// ---------------------------------------------------------------------------------------------
// Helpers

/** The messages of the IMPORTANT findings recorded under `source`, in order. */
const findingsFrom = (state: FeatureState, source: string): string[] =>
  (state.importantFindings ?? []).filter(finding => finding.source === source).map(finding => finding.message);

/** Every regular file below `dir`, relative and sorted. */
function filesBelow(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (lstatSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out.sort();
}

/** The absolute paths a prompt names (each starts after whitespace), trailing punctuation removed. */
const absolutePathsIn = (prompt: string): string[] =>
  [...prompt.matchAll(/(?:^|\s)(\/[^\s]+)/gm)].map(match => match[1].replace(/[.,:;)]+$/, ''));

const criticalOn = (file: string): ValidatorIssue => ({
  severity: 'CRITICAL',
  file,
  line: 1,
  message: 'Route has no auth check',
  suggestion: 'Add the guard',
  canFix: true
});

/** A Validator that reports one CRITICAL issue in src/a.ts on its first call, then passes. */
const failingFirst = (_call: AgentInvocation, n: number) =>
  n === 1 ? validator({ status: 'FAIL', issues: [criticalOn('src/a.ts')] }) : validator();

/** Gates that also log `gate-1.5` / `gate-2` into `events`. */
function eventGates(events: string[], script: Parameters<typeof recordingGates>[0] = {}) {
  const recorded = recordingGates(script);
  return {
    auditInfrastructure: async (root: string) => {
      events.push('gate-1.5');
      return recorded.gates.auditInfrastructure(root);
    },
    auditExecution: async (root: string) => {
      events.push('gate-2');
      return recorded.gates.auditExecution(root);
    }
  };
}

/**
 * An invoker on one timeline with the gates: the FIRST Test Verifier and Validator calls each log
 * `start <agent>`, then wait (at most 10 s) until the other has started, and only then answer and
 * log `end <agent>` — so the run can only get past them if both started before either finished.
 */
function parallelBarrier(script: InvokerScript, events: string[]) {
  const base = scriptedInvoker(script, { cwd: project.dir });
  const started: Record<string, ReturnType<typeof signal>> = { [TV]: signal(), [VAL]: signal() };
  const first = new Set<string>([TV, VAL]);
  const invoke: AgentInvoker = async call => {
    if (first.delete(call.agent)) {
      events.push(`start ${call.agent}`);
      started[call.agent].resolve();
      const other = call.agent === TV ? VAL : TV;
      await within(started[other].promise, `${other} to start`);
      const output = await base.invoke(call);
      events.push(`end ${call.agent}`);
      return output;
    }
    events.push(call.agent);
    return base.invoke(call);
  };
  return { invoke, base };
}

/** An approver that logs `CP<n>` into `events`, then approves. */
const loggingApprover = (events: string[]) => async (request: CheckpointRequest) => {
  events.push(`CP${request.id}`);
  return true;
};

// ---------------------------------------------------------------------------------------------

describe('AC-116 parallel verification', () => {
  it('AC-116 the Test Verifier and the main Validator both start before either finishes, Gate 2 runs after the Test Verifier, then the follow-up, the merge, the skeptics and routing, then the Stage 4 gate', async () => {
    const events: string[] = [];
    const followupIssue: ValidatorIssue = { severity: 'IMPORTANT', file: 'test/a.test.ts', line: 2, message: 'The test asserts nothing', suggestion: 'Assert the code', canFix: true };
    const { invoke } = parallelBarrier(
      { ...passingScript(), [VAL]: failingFirst, [FOLLOWUP]: followup({ files: ['test/a.test.ts'], issues: [followupIssue] }) },
      events
    );

    const state = await runToEnd({
      cwd: project.dir,
      invoke,
      gates: eventGates(events),
      changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }),
      approveCheckpoint: loggingApprover(events),
      logger: message => {
        if (message.includes('Stage 4 passed')) events.push('stage-4-gate');
      }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    const from = events.indexOf('gate-1.5');
    const verification = events.slice(from);
    // Both started before either finished; Gate 2 after both.
    expect(verification.slice(0, 3)).toEqual(['gate-1.5', `start ${TV}`, `start ${VAL}`]);
    expect(new Set(verification.slice(3, 5))).toEqual(new Set([`end ${TV}`, `end ${VAL}`]));
    // Then Gate 2, the follow-up on the Test Verifier's file, the two skeptics on the CRITICAL
    // issue, the routed builder, the validator round (Gate 2 → Validator alone), the Stage 4 gate, CP3.
    expect(verification.slice(5)).toEqual([
      'gate-2',
      FOLLOWUP,
      SKEPTIC,
      SKEPTIC,
      '04-backend-builder',
      'gate-1.5',
      'gate-2',
      VAL,
      'stage-4-gate',
      'CP3'
    ]);
    // The merge: the follow-up's IMPORTANT issue is a finding under its own source.
    expect(findingsFrom(state, FOLLOWUP)).toEqual(['[test/a.test.ts:2] The test asserts nothing']);
    expect(state.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['FAIL', 'PASS']);
    expect(state.stageHistory.filter(s => s.agent === TV).map(s => s.status)).toEqual(['PASS']);
    expect(state.stageHistory.filter(s => s.agent === FOLLOWUP).map(s => s.status)).toEqual(['PASS']);
  }, RUN_TIMEOUT_MS);

  it('D-8 the Gate 2 reference is read before any agent of the evaluation runs: a corrupt baseline escalates with no Test Verifier or Validator invoked', async () => {
    mkdirSync(join(project.dir, '.factory'), { recursive: true });
    writeFileSync(join(project.dir, '.factory', 'baseline.json'), '{ "schemaVersion": 1, "testCount": ');
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].context.message).toMatch(/baseline\.json/);
    expect(invoker.agents()).not.toContain(TV);
    expect(invoker.agents()).not.toContain(VAL);
    expect(evaluations(state)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-117 AC-118 the review copy', () => {
  it('AC-117 AC-118 the Test Verifier is invoked in the real project tree and the main Validator in the copy, extracted from the latest snapshot, sealed read-only and recorded before either agent was invoked', async () => {
    const tracker = fakeChangeTracker();
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    let atTestVerifier: FeatureState | undefined;
    const invoke: AgentInvoker = async call => {
      if (call.agent === TV) atTestVerifier = onDisk(project.dir);
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const [evaluation] = evaluations(state);
    expect(evaluation).toMatchObject({ e: 1, cycle: 0, round: 0, kind: 'first-pass', closed: { outcome: 'decided' } });
    const copy = evaluation.copy!;
    expect(copy.source).toEqual({
      kind: 'snapshot',
      n: 1,
      ref: state.stage3Snapshots![0].status === 'written' ? state.stage3Snapshots![0].ref : '',
      commit: FAKE_SNAPSHOT_COMMIT,
      tree: FAKE_SNAPSHOT_TREE
    });
    expect(copy.entries).toBe(1);

    // AC-118: the Test Verifier in the project (no cwd), the Validator in the copy.
    const tvCall = invoker.calls.find(c => c.agent === TV)!;
    const valCall = invoker.calls.find(c => c.agent === VAL)!;
    expect(tvCall.cwd).toBeUndefined();
    expect(valCall.cwd).toBe(copy.dir);

    // The copy is outside the project, holds exactly the extracted tree and is read-only.
    expect(isAbsolute(copy.dir)).toBe(true);
    expect(relative(project.dir, copy.dir).startsWith('..')).toBe(true);
    expect(filesBelow(copy.dir)).toEqual([FAKE_COPY_FILE]);
    expect(readFileSync(join(copy.dir, FAKE_COPY_FILE), 'utf8')).toBe(FAKE_COPY_CONTENT);
    expect(lstatSync(copy.dir).mode & 0o222).toBe(0);
    expect(lstatSync(join(copy.dir, FAKE_COPY_FILE)).mode & 0o222).toBe(0);
    expect(tracker.reviewCalls.filter(c => c.method === 'extractSnapshot')).toEqual([
      { method: 'extractSnapshot', cwd: project.dir, snap: { ref: copy.source.kind === 'snapshot' ? copy.source.ref : '', commit: FAKE_SNAPSHOT_COMMIT, tree: FAKE_SNAPSHOT_TREE }, dest: copy.dir }
    ]);

    // D-14: the evaluation start and the copy were committed before the Test Verifier was invoked.
    expect(evaluations(atTestVerifier)).toHaveLength(1);
    expect(evaluations(atTestVerifier)[0].copy?.dir).toBe(copy.dir);
  }, RUN_TIMEOUT_MS);

  it('AC-117 a review copy is never in the CHECKPOINT 3 change and a builder claim inside it fails Gate 1 with HALLUCINATION_DETECTED', async () => {
    const approver = decisions(true, true, true);
    // A validator round whose builder claims the copy's file: the copy dir is read from the record.
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: failingFirst,
      '04-backend-builder': (_call: AgentInvocation, n: number) => {
        if (n === 1) return backend();
        const copyDir = evaluations(onDisk(project.dir))[0].copy!.dir;
        return backend({ files: ['src/a.ts', join(copyDir, FAKE_COPY_FILE)] });
      }
    };
    const tracker = fakeChangeTracker();

    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: approver.approve,
      changes: tracker
    });

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    const copyDir = evaluations(state)[0].copy!.dir;
    expect(escalation).toMatchObject({ stage: 4, agent: 'harness', reason: 'HALLUCINATION_DETECTED' });
    expect(escalation.context.message).toBe(
      `1 claimed file(s) inside a review copy, which only the harness writes: ${join(copyDir, FAKE_COPY_FILE)}`
    );
    // The CP3 change is collected from the project only: the copy is outside it, and never claimed.
    for (const call of tracker.calls) {
      if (call.method === 'collect') expect(call.cwd).toBe(project.dir);
    }
    expect(relative(project.dir, copyDir).startsWith('..')).toBe(true);
  }, RUN_TIMEOUT_MS);

  it('AC-120 at invocation every path the main Validator\'s prompt names exists and none is TEST_REPORT.md', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const named: Array<{ path: string; exists: boolean }> = [];
    let prompt = '';
    const invoke: AgentInvoker = async call => {
      if (call.agent === VAL) {
        prompt = call.prompt;
        for (const path of absolutePathsIn(call.prompt)) named.push({ path, exists: existsSync(path) });
      }
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const copyDir = evaluations(state)[0].copy!.dir;
    expect(prompt).toContain(`Review the implementation in ${copyDir}. It is a READ-ONLY SNAPSHOT`);
    expect(prompt).toContain(`Report file paths relative to ${copyDir}.`);
    expect(prompt).not.toContain('TEST_REPORT.md');
    expect(named.map(n => n.path)).toContain(copyDir);
    expect(named.filter(n => !n.exists)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-123 resume after a kill during parallel verification', () => {
  /** The first `agent` call waits until `ready(state on disk)`, then the process "dies": state.json as it was is returned. */
  function killWhen(agent: string, ready: (state: FeatureState | undefined) => boolean, script: InvokerScript = passingScript()) {
    const base = scriptedInvoker(script, { cwd: project.dir });
    let captured: FeatureState | undefined;
    let killed = false;
    const invoke: AgentInvoker = async call => {
      if (call.agent === agent && !killed) {
        killed = true;
        await until(() => ready(onDisk(project.dir)), `the state ${agent} is killed in`);
        captured = onDisk(project.dir);
        throw new SimulatedKill(agent, 1);
      }
      return base.invoke(call);
    };
    return { invoke, captured: () => structuredClone(captured!) };
  }

  const validatorRecorded = (state: FeatureState | undefined) => evaluations(state)[0]?.validator !== undefined;
  const testVerifierPassed = (state: FeatureState | undefined) =>
    (state?.stageHistory ?? []).some(step => step.agent === TV && step.status === 'PASS');

  it.each<[string, string, (state: FeatureState | undefined) => boolean, string]>([
    ['the Test Verifier killed after the Validator\'s output was recorded', TV, validatorRecorded, TV],
    ['the Validator killed after the Test Verifier\'s PASS', VAL, testVerifierPassed, VAL]
  ])('AC-123 a run killed during parallel verification resumes only the agent without a recorded result (%s)', async (_label, killedAgent, ready, rerun) => {
    const tracker = fakeChangeTracker();
    const kill = killWhen(killedAgent, ready);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke, changes: tracker });
    const killed = restoreSnapshot(project.dir, kill.captured());
    expect(evaluations(killed)).toHaveLength(1);
    expect(evaluations(killed)[0].closed).toBeUndefined();
    const extractions = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot').length;

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toEqual([rerun]);
    // The open evaluation was continued, its intact copy reused, and nothing was overwritten.
    expect(evaluations(state)).toHaveLength(1);
    expect(evaluations(state)[0].copy).toEqual(evaluations(killed)[0].copy);
    expect(tracker.reviewCalls.filter(c => c.method === 'extractSnapshot')).toHaveLength(extractions);
    if (killedAgent === TV) {
      // The Validator's recorded output is the one decided on: its 07 step carries its timing.
      const recorded = evaluations(killed)[0].validator!;
      const step = state.stageHistory.find(s => s.agent === VAL)!;
      expect(step).toMatchObject({ status: 'PASS', startedAt: recorded.timing.startedAt, completedAt: recorded.timing.completedAt });
    }
    expect(state.stageHistory.filter(s => s.agent === TV).map(s => s.status)).toEqual(['PASS']);
    expect(state.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['PASS']);
  }, RUN_TIMEOUT_MS);

  it('AC-123 a missing copy is re-extracted from the same recorded snapshot', async () => {
    const tracker = fakeChangeTracker();
    const kill = killWhen(VAL, testVerifierPassed);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke, changes: tracker });
    const killed = restoreSnapshot(project.dir, kill.captured());
    const before = evaluations(killed)[0].copy!;
    removeTree(before.dir);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const after = evaluations(state)[0].copy!;
    expect(after.source).toEqual(before.source);
    expect(after.dir).not.toBe(before.dir);
    const extractions = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot');
    expect(extractions).toHaveLength(2);
    expect(extractions[1]).toMatchObject({ snap: extractions[0].snap, dest: after.dir });
    expect(resumed.calls.find(c => c.agent === VAL)!.cwd).toBe(after.dir);
    expect(resumed.agents()).toEqual([VAL]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-124 one parallel agent fails while the other runs', () => {
  type Case = [string, InvokerScript, (state: FeatureState) => void];
  const cases: Case[] = [
    [
      'returns FAIL (the Test Verifier)',
      { ...passingScript(), [TV]: testVerifier({ status: 'FAIL' }) },
      state => {
        expect(state.escalations.map(e => [e.agent, e.reason])).toEqual([[TV, 'CRITICAL_ISSUE']]);
        expect(state.stageHistory.filter(s => s.agent === TV).map(s => s.status)).toEqual(['FAIL']);
      }
    ],
    [
      'returns ESCALATE (the Validator)',
      { ...passingScript(), [VAL]: validator({ status: 'ESCALATE' }) },
      state => {
        expect(state.escalations.map(e => [e.agent, e.reason])).toEqual([[VAL, 'CRITICAL_ISSUE']]);
        expect(state.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['ESCALATED']);
      }
    ],
    [
      'throws (the Test Verifier\'s invocation)',
      {
        ...passingScript(),
        [TV]: () => {
          throw new Error('SDK error: 529 overloaded\nretry later');
        }
      },
      state => {
        expect(state.escalations.map(e => [e.agent, e.reason])).toEqual([['orchestrator', 'MANUAL']]);
        expect(state.escalations[0].context.message).toBe('Orchestration error: SDK error: 529 overloaded\nretry later');
        const threw = state.agentInvocations!.find(i => i.agent === TV)!;
        expect(threw).toMatchObject({ outcome: 'threw', error: 'SDK error: 529 overloaded', evaluation: 1 });
      }
    ]
  ];

  it.each(cases)('AC-124 when one parallel agent %s while the other runs, the run waits, records both invocations, escalates under the existing rules and leaves no agent running', async (label, script, expectations) => {
    const failing = label.includes('Validator') ? VAL : TV;
    const other = failing === TV ? VAL : TV;
    const base = scriptedInvoker(script, { cwd: project.dir });
    const failed = signal();
    let running = 0;
    const settled: string[] = [];
    const invoke: AgentInvoker = async call => {
      running++;
      try {
        if (call.agent === other) {
          // The other agent is still running when the failing one settles; it answers only after.
          await within(failed.promise, `${failing} to settle`);
        }
        return await base.invoke(call);
      } finally {
        running--;
        settled.push(call.agent);
        if (call.agent === failing) failed.resolve();
      }
    };
    const gates = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke, gates: gates.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(running).toBe(0);
    expect(settled.slice(-2)).toEqual([failing, other]);
    // Both invocations are on record, with the evaluation they belonged to.
    const verifying = state.agentInvocations!.filter(i => i.agent === TV || i.agent === VAL);
    expect(verifying.map(i => i.agent).sort()).toEqual([TV, VAL]);
    expect(verifying.every(i => i.evaluation === 1)).toBe(true);
    // The escalation closed the evaluation, so a resume starts a new one.
    expect(evaluations(state)[0].closed?.outcome).toBe('escalated');
    expectations(state);
    if (failing === TV) expect(gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
  }, RUN_TIMEOUT_MS);
});

describe('AC-125 validator rounds and CP3 reworks', () => {
  it('AC-125 a validator round reviews a fresh copy of that round\'s snapshot and re-runs neither the Test Verifier nor the follow-up', async () => {
    const tracker = fakeChangeTracker();
    const invoker = scriptedInvoker({ ...passingScript(), [VAL]: failingFirst }, { cwd: project.dir });
    const events: string[] = [];
    const invoke: AgentInvoker = async call => {
      events.push(call.agent);
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: tracker, gates: eventGates(events) });

    expect(state.completionStatus).toBe('SUCCESS');
    const [first, round] = evaluations(state);
    expect(first).toMatchObject({ e: 1, kind: 'first-pass', round: 0, closed: { outcome: 'decided', verdict: { passed: false } } });
    expect(round).toMatchObject({ e: 2, kind: 'validator-round', round: 1, closed: { outcome: 'decided', verdict: { passed: true } } });
    expect(round.copy!.dir).not.toBe(first.copy!.dir);
    expect(first.copy!.source).toMatchObject({ kind: 'snapshot', n: 1 });
    expect(round.copy!.source).toMatchObject({ kind: 'snapshot', n: 2 });
    expect(round.testVerifierChanges).toBeUndefined();
    const extracted = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot').map(c => c.method === 'extractSnapshot' && c.snap.ref);
    expect(extracted.map(ref => String(ref).split('/').at(-1))).toEqual(['stage3-1', 'stage3-2']);
    // Only the first pass measures; the round runs Gate 2, then the Validator alone, in its copy.
    expect(tracker.reviewCalls.filter(c => c.method === 'changedSince')).toHaveLength(1);
    expect(invoker.agents().filter(a => a === TV)).toHaveLength(1);
    expect(invoker.agents()).not.toContain('07b-validator-followup');
    expect(events.slice(events.lastIndexOf('04-backend-builder'))).toEqual(['04-backend-builder', 'gate-1.5', 'gate-2', VAL]);
    expect(invoker.calls.filter(c => c.agent === VAL).map(c => c.cwd)).toEqual([first.copy!.dir, round.copy!.dir]);
  }, RUN_TIMEOUT_MS);

  it('AC-125 a CHECKPOINT 3 rework repeats the parallel verification on the rework\'s snapshot', async () => {
    const tracker = fakeChangeTracker();
    const rejected = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Use the existing rate limiter.' }).approve,
      changes: tracker
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    const events: string[] = [];
    const { invoke } = parallelBarrier(passingScript(), events);
    const state = await runToEnd({
      cwd: project.dir,
      invoke,
      resumeFromState: onDisk(project.dir),
      changes: tracker,
      gates: eventGates(events),
      approveCheckpoint: loggingApprover(events)
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(events).toEqual(['04-backend-builder', 'gate-1.5', `start ${TV}`, `start ${VAL}`, expect.any(String), expect.any(String), 'gate-2', 'CP3']);
    const rework = evaluations(state).filter(evaluation => evaluation.cycle === 1);
    expect(rework).toHaveLength(1);
    expect(rework[0]).toMatchObject({ kind: 'first-pass', closed: { outcome: 'decided', verdict: { passed: true } } });
    const reworkSnapshot = state.stage3Snapshots!.find(s => s.at.phase === 'rework')!;
    expect(rework[0].copy!.source).toMatchObject({ kind: 'snapshot', n: reworkSnapshot.status === 'written' ? reworkSnapshot.n : -1 });
  }, RUN_TIMEOUT_MS);
});

describe('AC-126 no snapshot', () => {
  it('AC-126 with no snapshot the main Validator reviews a filesystem copy of the working tree without .factory/, made before the Test Verifier started, recorded as such', async () => {
    const tracker = fakeChangeTracker({ base: { kind: 'none', reason: 'not a git work tree (fatal: not a git repository)' } });
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        // The Test Verifier writes a test file in the project while the Validator reviews its copy.
        [TV]: () => {
          mkdirSync(join(project.dir, 'test'), { recursive: true });
          writeFileSync(join(project.dir, 'test', 'two-factor.test.ts'), 'it("works", () => {});\n');
          return testVerifier();
        },
        [FOLLOWUP]: followup({ files: ['test/two-factor.test.ts'] })
      },
      { cwd: project.dir }
    );
    let atTestVerifier: FeatureState | undefined;
    const invoke: AgentInvoker = async call => {
      if (call.agent === TV) atTestVerifier = onDisk(project.dir);
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const [evaluation] = evaluations(state);
    const copy = evaluation.copy!;
    expect(copy.source).toEqual({ kind: 'working-tree', reason: NOT_GIT_SNAPSHOT_REASON });
    expect(evaluations(atTestVerifier)[0].copy).toEqual(copy);
    expect(tracker.reviewCalls).toEqual([]);
    // The builder's file is in the copy; .factory/ and the Test Verifier's file are not.
    expect(filesBelow(copy.dir)).toEqual(['src/a.ts']);
    expect(existsSync(join(copy.dir, '.factory'))).toBe(false);
    expect(invoker.calls.find(c => c.agent === VAL)!.prompt).toContain(
      `It is a read-only copy of the working tree made before the Test Verifier started (${NOT_GIT_SNAPSHOT_REASON}).`
    );
    // The fallback measurement compares the working tree with that copy.
    expect(evaluation.testVerifierChanges).toEqual({ kind: 'tests', files: ['test/two-factor.test.ts'] });
  }, RUN_TIMEOUT_MS);

  it('I-28 a missing working-tree copy after the Test Verifier ran in the evaluation escalates REVIEW_COPY_FAILED on resume', async () => {
    const tracker = fakeChangeTracker({ base: { kind: 'none', reason: 'not a git work tree' } });
    // First run: the Test Verifier FAILs, so the run escalates and evaluation 1 is closed.
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), [TV]: testVerifier({ status: 'FAIL' }) }, { cwd: project.dir }).invoke,
      changes: tracker
    });
    expect(first.completionStatus).toBe('ESCALATED');
    // A resumed evaluation in which the Test Verifier was invoked, killed while the Validator ran.
    const killer = (() => {
      const inner = scriptedInvoker(passingScript(), { cwd: project.dir });
      let captured: FeatureState | undefined;
      const invoke: AgentInvoker = async call => {
        if (call.agent === VAL) {
          await until(() => (onDisk(project.dir)?.agentInvocations ?? []).filter(i => i.agent === TV && i.evaluation === 2).length === 1, 'the Test Verifier to be recorded');
          captured = onDisk(project.dir);
          throw new SimulatedKill(VAL, 1);
        }
        return inner.invoke(call);
      };
      return { invoke, captured: () => structuredClone(captured!) };
    })();
    await runToEnd({ cwd: project.dir, invoke: killer.invoke, resumeFromState: onDisk(project.dir), changes: tracker });
    const killed = restoreSnapshot(project.dir, killer.captured());
    const open = evaluations(killed).find(evaluation => !evaluation.closed)!;
    expect(open.copy!.source.kind).toBe('working-tree');
    removeTree(open.copy!.dir);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'REVIEW_COPY_FAILED', severity: 'CRITICAL' });
    expect(state.escalations.at(-1)!.context.message).toMatch(/cannot be made again/);
    expect(resumed.agents()).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('REVIEW_COPY_FAILED and the measurement (I-18, N-3)', () => {
  it('I-18 an extraction that fails escalates REVIEW_COPY_FAILED with its error before any Stage 4 agent is invoked, and leaves no review directory', async () => {
    const tracker = fakeChangeTracker({ extract: async () => ({ kind: 'failed', error: 'the recorded snapshot ref no longer points at the recorded commit' }) });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: tracker });

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 4, agent: 'harness', reason: 'REVIEW_COPY_FAILED', severity: 'CRITICAL' });
    expect(escalation.context.message).toMatch(/could not be extracted from stage3-1 .*: the recorded snapshot ref no longer points at the recorded commit$/);
    expect(invoker.agents()).not.toContain(TV);
    expect(invoker.agents()).not.toContain(VAL);
    expect(evaluations(state)[0]).toMatchObject({ e: 1, closed: { outcome: 'escalated' } });
    expect(evaluations(state)[0].copy).toBeUndefined();
    expect(readdirSync(`${project.dir}-review`)).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('D-B2-2 an extraction whose entry count differs from the copy on disk escalates REVIEW_COPY_FAILED', async () => {
    const tracker = fakeChangeTracker({
      extract: async (_cwd, _snap, dest) => {
        writeFileSync(join(dest, 'a.ts'), 'a\n');
        return { kind: 'extracted', entries: 2 };
      }
    });

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, changes: tracker });

    expect(state.escalations.at(-1)).toMatchObject({ reason: 'REVIEW_COPY_FAILED' });
    expect(state.escalations.at(-1)!.context.message).toMatch(/reported 2 entries, but the copy holds 1/);
  }, RUN_TIMEOUT_MS);

  it('I-18 a measurement that fails escalates REVIEW_COPY_FAILED before Gate 2', async () => {
    const tracker = fakeChangeTracker({ changed: async () => ({ kind: 'failed', error: 'fatal: bad object' }) });
    const gates = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, changes: tracker, gates: gates.gates });

    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'REVIEW_COPY_FAILED' });
    expect(state.escalations.at(-1)!.context.message).toMatch(/could not be measured .*: fatal: bad object$/);
    expect(gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
  }, RUN_TIMEOUT_MS);

  it('AC-121 N-3 a Test Verifier change outside a test path escalates CRITICAL_ISSUE naming the files, before Gate 2, and the measurement is recorded', async () => {
    const tracker = fakeChangeTracker({ changed: ['src/a.ts', 'test/a.test.ts'] });
    const gates = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, changes: tracker, gates: gates.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 4, agent: TV, reason: 'CRITICAL_ISSUE' });
    expect(escalation.context.message).toBe('06-test-verifier changed 1 file(s) outside a test path: src/a.ts. Revert them or close the run.');
    expect(escalation.context.blockers).toEqual(['src/a.ts']);
    expect(evaluations(state)[0].testVerifierChanges).toEqual({ kind: 'outside-tests', files: ['src/a.ts', 'test/a.test.ts'], outside: ['src/a.ts'] });
    expect(gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
    expect(tracker.reviewCalls.filter(c => c.method === 'changedSince')).toEqual([
      { method: 'changedSince', cwd: project.dir, tree: FAKE_SNAPSHOT_TREE }
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-157 the verification-start marker', () => {
  it('AC-157 a run killed during the rework\'s Test Verifier resumes without re-evaluating the rework\'s Stage 3 gate and makes no snapshot call for that phase', async () => {
    const tracker = fakeChangeTracker();
    const rejected = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: tracker
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    const kill = killAt(scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, TV, 1, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke, resumeFromState: onDisk(project.dir), changes: tracker });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    const reworkEntry = killed.stage3Snapshots!.find(s => s.at.phase === 'rework')!;
    const open = evaluations(killed).find(evaluation => !evaluation.closed)!;
    expect(open).toMatchObject({ cycle: 1, kind: 'first-pass' });
    const snapshotsBefore = tracker.snapshotCalls.length;

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(tracker.snapshotCalls).toHaveLength(snapshotsBefore);
    expect(state.stage3Snapshots!.find(s => s.at.phase === 'rework')).toEqual(reworkEntry);
    // The open evaluation was continued; its copy came from the rework's snapshot.
    expect(evaluations(state).filter(evaluation => evaluation.cycle === 1)).toHaveLength(1);
    expect(open.copy!.source).toMatchObject({ kind: 'snapshot', n: reworkEntry.status === 'written' ? reworkEntry.n : -1 });
    expect(resumed.agents()).toEqual([TV, VAL]);
  }, RUN_TIMEOUT_MS);
});

describe('D-7 I-16 records', () => {
  it('I-16 an invocation that throws is recorded with outcome threw and the first line of its error, at most 500 characters, then the run escalates', async () => {
    const long = `x${'y'.repeat(600)}\nsecond line`;
    const invoker = scriptedInvoker({
      ...passingScript(),
      [VAL]: () => {
        throw new Error(long);
      }
    }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    const record = state.agentInvocations!.find(i => i.agent === VAL)!;
    expect(record.outcome).toBe('threw');
    expect(record.error).toBe(long.split('\n')[0].slice(0, 500));
    expect(record.error).toHaveLength(500);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(onDisk(project.dir)!.agentInvocations!.find(i => i.agent === VAL)?.outcome).toBe('threw');
    // The Test Verifier ran in parallel and was recorded too; the escalation closed the evaluation.
    expect(state.stageHistory.filter(s => s.agent === TV).map(s => s.status)).toEqual(['PASS']);
    expect(evaluations(state)[0].closed?.outcome).toBe('escalated');
  }, RUN_TIMEOUT_MS);

  it('D-7 I-6 a resume after an escalation starts a new evaluation and re-runs the Validator; the decided one keeps its verdict', async () => {
    const failingGate2 = recordingGates({ auditExecution: n => (n === 1 ? executionAudit({ failed: 1 }) : executionAudit()) });
    const first = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, gates: failingGate2.gates });
    expect(first.escalations.at(-1)?.reason).toBe('EXECUTION_FAILURE');
    expect(evaluations(first)[0].closed?.outcome).toBe('escalated');

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk(project.dir), gates: failingGate2.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    // The Test Verifier had passed; the Validator is re-run in a new first-pass evaluation.
    expect(resumed.agents()).toEqual([VAL]);
    expect(evaluations(state).map(evaluation => [evaluation.e, evaluation.kind, evaluation.closed?.outcome])).toEqual([
      [1, 'first-pass', 'escalated'],
      [2, 'first-pass', 'decided']
    ]);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Build step 7: the follow-up review, the merge, the decision and CHECKPOINT 3 (D-9, D-10, D-12, D-16)

describe('AC-121 the follow-up review', () => {
  type Case = [string, string[], (state: FeatureState, invoker: ReturnType<typeof scriptedInvoker>) => void];
  const cases: Case[] = [
    [
      'only test files changed: 07b reviews exactly them, with its own id, step and VALIDATION_FOLLOWUP.md',
      ['test/a.test.ts', 'src/__tests__/gone.test.ts'],
      (state, invoker) => {
        expect(state.completionStatus).toBe('SUCCESS');
        const calls = invoker.calls.filter(c => c.agent === FOLLOWUP);
        expect(calls).toHaveLength(1);
        // In the project (no cwd), on exactly the measured files, absolute; a deleted one named so.
        expect(calls[0].cwd).toBeUndefined();
        expect(calls[0].prompt).toContain(`  - ${join(project.dir, 'test/a.test.ts')}\n`);
        expect(calls[0].prompt).toContain(`  - ${join(project.dir, 'src/__tests__/gone.test.ts')} (deleted)\n`);
        expect(calls[0].prompt).toContain('`filesReviewed` lists exactly these project-relative paths: test/a.test.ts, src/__tests__/gone.test.ts.');
        const [evaluation] = evaluations(state);
        expect(evaluation.followup).toMatchObject({ status: 'reviewed', files: ['test/a.test.ts', 'src/__tests__/gone.test.ts'] });
        expect(state.stageHistory.filter(s => s.agent === FOLLOWUP).map(s => [s.stage, s.status])).toEqual([[4, 'PASS']]);
        const runDir = join(project.dir, '.factory', state.featureId);
        expect(readFileSync(join(runDir, 'VALIDATION_FOLLOWUP.md'), 'utf8')).toBe('# Validation Follow-up\n\nNo issues in the listed files.');
        expect(readFileSync(join(runDir, 'VALIDATION_REPORT.md'), 'utf8')).toBe('# Validation Report\n\nNo critical issues.');
        expect(findingsFrom(state, FOLLOWUP)).toEqual([]);
      }
    ],
    [
      'nothing changed: 07b is not invoked, and the follow-up is recorded skipped',
      [],
      (state, invoker) => {
        expect(state.completionStatus).toBe('SUCCESS');
        expect(invoker.agents()).not.toContain(FOLLOWUP);
        expect(evaluations(state)[0].followup).toEqual({ status: 'skipped', reason: 'the Test Verifier changed no file' });
        expect(existsSync(join(project.dir, '.factory', state.featureId, 'VALIDATION_FOLLOWUP.md'))).toBe(false);
      }
    ],
    [
      'a non-test file changed: the run escalates naming it, and 07b is not invoked',
      ['src/a.ts', 'test/a.test.ts'],
      (state, invoker) => {
        expect(state.completionStatus).toBe('ESCALATED');
        expect(state.escalations.at(-1)).toMatchObject({ agent: TV, reason: 'CRITICAL_ISSUE', context: { blockers: ['src/a.ts'] } });
        expect(invoker.agents()).not.toContain(FOLLOWUP);
        expect(evaluations(state)[0].followup).toBeUndefined();
      }
    ]
  ];

  it.each(cases)("AC-121 the harness measures the Test Verifier's changes against the reviewed snapshot: %s", async (_label, changed, expectations) => {
    mkdirSync(join(project.dir, 'test'), { recursive: true });
    writeFileSync(join(project.dir, 'test', 'a.test.ts'), 'it("a", () => {});\n');
    const invoker = scriptedInvoker({ ...passingScript(), [FOLLOWUP]: followup({ files: changed }) }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed }) });

    expectations(state, invoker);
  }, RUN_TIMEOUT_MS);

  it('AC-121 I-29 a follow-up that reviewed other files than it was given adds one IMPORTANT finding and does not block', async () => {
    const invoker = scriptedInvoker({ ...passingScript(), [FOLLOWUP]: followup({ files: ['test/other.test.ts'] }) }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }) });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(findingsFrom(state, FOLLOWUP)).toEqual(['07b-validator-followup reviewed test/other.test.ts but was given test/a.test.ts']);
  }, RUN_TIMEOUT_MS);

  it.each<[string, object, string, string]>([
    ['fails its schema', { ...followup({ files: ['test/a.test.ts'] }), details: { summary: 's', artifacts: [] } }, 'SCHEMA_VALIDATION', 'Follow-up output schema invalid'],
    ['returns ESCALATE', followup({ files: ['test/a.test.ts'], status: 'ESCALATE' }), 'CRITICAL_ISSUE', '07b-validator-followup escalated'],
    ['returns FAIL with no CRITICAL issue of its own (I-13)', followup({ files: ['test/a.test.ts'], status: 'FAIL' }), 'CRITICAL_ISSUE', '07b-validator-followup reported FAIL with no CRITICAL issue']
  ])('D-9 a follow-up that %s escalates, and the evaluation is not decided', async (_label, output, reason, message) => {
    const invoker = scriptedInvoker({ ...passingScript(), [FOLLOWUP]: output }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }) });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: FOLLOWUP, reason });
    expect(state.escalations.at(-1)!.context.message).toContain(message);
    expect(evaluations(state)[0].closed?.outcome).toBe('escalated');
    expect(state.stageHistory.some(s => s.agent === VAL)).toBe(false);
    expect(invoker.agents()).not.toContain(SKEPTIC);
  }, RUN_TIMEOUT_MS);

  it('AC-123 the follow-up never overwrites VALIDATION_REPORT.md or the main Validator\'s recorded output, and a resume never runs it twice', async () => {
    const intruder = followup({ files: ['test/a.test.ts'] });
    intruder.details.artifacts.push({ name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md', description: 'not mine', content: '# Overwritten\n' });
    const script: InvokerScript = { ...passingScript(), [VAL]: failingFirst, [FOLLOWUP]: intruder };
    const tracker = fakeChangeTracker({ changed: ['test/a.test.ts'] });
    // Killed at the first skeptic: the follow-up's review is on record, the decision is not.
    const kill = killAt(scriptedInvoker(script, { cwd: project.dir }).invoke, SKEPTIC, 1, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke, changes: tracker });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    const [open] = evaluations(killed);
    expect(open.closed).toBeUndefined();
    expect(open.followup?.status).toBe('reviewed');
    const runDir = join(project.dir, '.factory', killed.featureId);
    expect(readFileSync(join(runDir, 'VALIDATION_REPORT.md'), 'utf8')).toBe('# Validation Report\n\nNo critical issues.');

    const resumed = scriptedInvoker(script, { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).not.toContain(FOLLOWUP);
    expect(resumed.agents().slice(0, 2)).toEqual([SKEPTIC, SKEPTIC]);
    expect(evaluations(state)[0].validator).toEqual(open.validator);
    expect(evaluations(state)[0].followup).toEqual(open.followup);
    expect(readFileSync(join(runDir, 'VALIDATION_REPORT.md'), 'utf8')).toBe('# Validation Report\n\nNo critical issues.');
    expect(readFileSync(join(runDir, 'VALIDATION_FOLLOWUP.md'), 'utf8')).toBe('# Validation Follow-up\n\nNo issues in the listed files.');
  }, RUN_TIMEOUT_MS);
});

describe('AC-122 the merged issues', () => {
  const shared: ValidatorIssue = { severity: 'IMPORTANT', file: 'src/a.ts', line: 7, message: 'Magic number 30', suggestion: 'Name it', canFix: true };

  it('AC-122 the Stage 4 gate, routing and CHECKPOINT 3 use the merged issues of both reviews, and an IMPORTANT issue both report is recorded once', async () => {
    // A clean run: both reviews report the same IMPORTANT issue (the Validator with its copy path).
    const requests: CheckpointRequest[] = [];
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: (call: AgentInvocation) => validator({ issues: [{ ...shared, file: join(call.cwd!, 'src/a.ts') }] }),
      [FOLLOWUP]: followup({ files: ['test/a.test.ts'], issues: [{ ...shared }] })
    };
    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }),
      approveCheckpoint: async request => {
        requests.push(request);
        return true;
      }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(findingsFrom(state, VAL)).toEqual(['[src/a.ts:7] Magic number 30']);
    expect(findingsFrom(state, FOLLOWUP)).toEqual([]);
    // CHECKPOINT 3 presents both documents in full, and its hash covers both.
    const cp3 = requests.find(r => r.id === 3)!;
    const runDir = join(project.dir, '.factory', state.featureId);
    expect(cp3.artifactPaths).toEqual([join(runDir, 'VALIDATION_REPORT.md'), join(runDir, 'VALIDATION_FOLLOWUP.md')]);
    expect(cp3.text).toContain('# Validation Report\n\nNo critical issues.\n\n---\n\n## VALIDATION_FOLLOWUP.md\n\n# Validation Follow-up\n\nNo issues in the listed files.\n\n---\n\n## IMPORTANT findings (1)');
    expect(cp3.text).toContain('- [Stage 4 · 07-validator] [src/a.ts:7] Magic number 30');
    expect(evaluations(state)[0].closed).toMatchObject({ outcome: 'decided', verdict: { passed: true, standing: [], disproved: [] } });

    // A second run: the follow-up's CRITICAL on the Test Verifier's file stands (skeptics uphold);
    // routing finds no builder that owns it, so the run escalates naming it and never passes the gate.
    const second = tempProject('ff-verify-merged-');
    try {
      const critical: ValidatorIssue = { severity: 'CRITICAL', file: 'test/a.test.ts', line: 3, message: 'The test can never fail', suggestion: 'Assert the result', canFix: true };
      const invoker = scriptedInvoker({ ...passingScript(), [FOLLOWUP]: followup({ files: ['test/a.test.ts'], issues: [critical] }) }, { cwd: second.dir });
      const failed = await runToEnd({ cwd: second.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }) });

      expect(failed.completionStatus).toBe('ESCALATED');
      expect(failed.escalations.at(-1)).toMatchObject({ stage: 4, agent: VAL, reason: 'CRITICAL_ISSUE' });
      expect(failed.escalations.at(-1)!.context.message).toBe('1 of 1 CRITICAL issue(s) cannot be routed to a builder');
      expect(failed.escalations.at(-1)!.context.issues).toEqual(['[test/a.test.ts:3] The test can never fail — Assert the result (unroutable: NOT_OWNED)']);
      expect(invoker.agents().filter(a => a === SKEPTIC)).toHaveLength(2);
      const [evaluation] = evaluations(failed);
      expect(evaluation.closed).toMatchObject({ outcome: 'decided', verdict: { passed: false, disproved: [] } });
      expect(evaluation.closed?.outcome === 'decided' && evaluation.closed.verdict.standing).toHaveLength(1);
      // The main Validator passed with no issue: the follow-up's CRITICAL alone failed the evaluation.
      expect(failed.stageHistory.filter(s => s.agent === VAL).map(s => s.status)).toEqual(['FAIL']);
    } finally {
      second.cleanup();
    }
  }, RUN_TIMEOUT_MS);

  it('D-16 CHECKPOINT 3 with the follow-up part keeps its hash on --approve 3, and without a follow-up it shows only the report', async () => {
    const tracker = fakeChangeTracker({ changed: ['test/a.test.ts'] });
    const script: InvokerScript = { ...passingScript(), [FOLLOWUP]: followup({ files: ['test/a.test.ts'] }) };
    const approver = decisions(true, true, { decision: 'PAUSE' });
    const paused = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(script, { cwd: project.dir }).invoke, changes: tracker, approveCheckpoint: approver.approve });
    expect(paused.pendingCheckpoint?.checkpointId).toBe(3);
    const cp3 = approver.requests[2];
    expect(cp3.text).toContain('## VALIDATION_FOLLOWUP.md');
    expect(paused.pendingCheckpoint?.artifactPaths).toEqual([
      join('.factory', paused.featureId, 'VALIDATION_REPORT.md'),
      join('.factory', paused.featureId, 'VALIDATION_FOLLOWUP.md')
    ]);

    const approved = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      changes: tracker,
      resumeFromState: paused,
      resume: { action: { kind: 'approve', checkpoint: 3 } }
    });

    expect(approved.completionStatus).toBe('SUCCESS');
    expect(approved.checkpointApprovals.at(-1)).toMatchObject({ checkpointId: 3, sha256: cp3.sha256 });

    // Without a follow-up review the CP3 text has no follow-up part.
    const plain = tempProject('ff-verify-plain-');
    try {
      const plainApprover = decisions(true, true, true);
      await runToEnd({ cwd: plain.dir, invoke: scriptedInvoker(passingScript(), { cwd: plain.dir }).invoke, approveCheckpoint: plainApprover.approve });
      expect(plainApprover.requests[2].text).not.toContain('VALIDATION_FOLLOWUP.md');
      expect(plainApprover.requests[2].artifactPaths).toHaveLength(1);
    } finally {
      plain.cleanup();
    }
  }, RUN_TIMEOUT_MS);

  it("D-12 a resumed validator round routes the opener's standing issues, its absolute copy paths mapped out of the copy", async () => {
    // The Validator reports its CRITICAL by its absolute path in the copy; the run is killed at the
    // round's builder fix, after the round was opened.
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: (call: AgentInvocation, n: number) =>
        n === 1 ? validator({ status: 'FAIL', issues: [criticalOn(join(call.cwd!, 'src/a.ts'))] }) : validator()
    };
    const kill = killAt(scriptedInvoker(script, { cwd: project.dir }).invoke, '04-backend-builder', 2, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke });
    const killed = restoreSnapshot(project.dir, kill.snapshot());
    expect(killed.validatorRoundsCompleted).toBe(1);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).toEqual(['04-backend-builder', VAL]);
    expect(resumed.promptsFor('04-backend-builder')[0]).toContain('[src/a.ts:1] Route has no auth check — Add the guard');
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// CHECKPOINT 3 fix round (B2_VALIDATION_REPORT IMPORTANT-1, IMPORTANT-2, MINOR-2, MINOR-5, MINOR-6)

/**
 * A fake git working tree for the measurement: the files changed since the fake snapshot, a tree
 * id per recorded baseline, and `changedSince` as the difference between now and that tree.
 */
function modelWorkingTree() {
  const changed = new Set<string>();
  const trees = new Map<string, string[]>([[FAKE_SNAPSHOT_TREE, []]]);
  let n = 0;
  const tracker = fakeChangeTracker({
    baseline: async () => {
      const tree = `b${++n}`.padEnd(40, '0');
      trees.set(tree, [...changed]);
      return { kind: 'tree', tree };
    },
    changed: async (_cwd, tree) => {
      const then = new Set(trees.get(tree) ?? []);
      const files = [...[...changed].filter(file => !then.has(file)), ...[...then].filter(file => !changed.has(file))];
      return { kind: 'files', files: files.sort() };
    }
  });
  return { tracker, changed };
}

const OUTSIDE_MESSAGE = (file: string) => `06-test-verifier changed 1 file(s) outside a test path: ${file}. Revert them or close the run.`;

describe('IMPORTANT-1 IMPORTANT-2 the Test Verifier is measured against a baseline recorded before it runs', () => {
  it('IMPORTANT-1 a hand fix to a non-test file after an escalation is not blamed on the Test Verifier', async () => {
    const { tracker, changed } = modelWorkingTree();
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), [TV]: testVerifier({ status: 'FAIL' }) }, { cwd: project.dir }).invoke,
      changes: tracker
    });
    expect(first.completionStatus).toBe('ESCALATED');
    expect(evaluations(first)[0]).toMatchObject({ baseline: { kind: 'tree', tree: 'b1'.padEnd(40, '0') }, testVerifierChanges: { kind: 'none' } });

    // The operator fixes src/x.ts by hand and resumes; the Test Verifier now writes a test and passes.
    changed.add('src/x.ts');
    const resumed = scriptedInvoker(
      {
        ...passingScript(),
        [TV]: () => {
          changed.add('test/x.test.ts');
          return testVerifier();
        },
        [FOLLOWUP]: followup({ files: ['test/x.test.ts'] })
      },
      { cwd: project.dir }
    );
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk(project.dir), changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const second = evaluations(state)[1];
    expect(second.baseline).toMatchObject({ kind: 'tree', tree: 'b2'.padEnd(40, '0') });
    expect(second.testVerifierChanges).toEqual({ kind: 'tests', files: ['test/x.test.ts'] });
    expect(second.followup).toMatchObject({ status: 'reviewed', files: ['test/x.test.ts'] });
    expect(state.escalations.filter(e => /outside a test path/.test(e.context.message))).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-1 the baseline is committed before the Test Verifier is invoked, and a continued evaluation keeps it', async () => {
    const tracker = fakeChangeTracker({ baseline: 'e'.repeat(40) });
    let atTestVerifier: FeatureState | undefined;
    const base = scriptedInvoker(passingScript(), { cwd: project.dir });
    const invoke: AgentInvoker = async call => {
      if (call.agent === TV) atTestVerifier = onDisk(project.dir);
      return base.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(evaluations(atTestVerifier)[0].baseline).toMatchObject({ kind: 'tree', tree: 'e'.repeat(40) });
    expect(evaluations(state)[0].baseline).toEqual(evaluations(atTestVerifier)[0].baseline);
    expect(tracker.baselineCalls).toEqual([{ cwd: project.dir }]);
    expect(tracker.reviewCalls.filter(c => c.method === 'changedSince')).toEqual([{ method: 'changedSince', cwd: project.dir, tree: 'e'.repeat(40) }]);
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-1 a baseline git cannot give escalates REVIEW_COPY_FAILED before the Test Verifier is invoked', async () => {
    const tracker = fakeChangeTracker({ baseline: async () => ({ kind: 'failed', error: 'fatal: index file corrupt' }) });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: tracker });

    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'REVIEW_COPY_FAILED' });
    expect(state.escalations.at(-1)!.context.message).toMatch(/could not be recorded: fatal: index file corrupt$/);
    expect(invoker.agents()).not.toContain(TV);
    expect(invoker.agents()).not.toContain(VAL);
  }, RUN_TIMEOUT_MS);

  it.each<[string, ScriptEntry]>([
    ['returns a failing verdict', testVerifier({ status: 'FAIL' })],
    ['fails its schema', { ...testVerifier(), details: { summary: 'no fields' } }],
    [
      'throws',
      () => {
        throw new Error('SDK error: 529 overloaded');
      }
    ]
  ])('IMPORTANT-1 a Test Verifier that %s after writing outside a test path escalates N-3 in that evaluation, naming the file', async (_label, answer) => {
    const invoker = scriptedInvoker({ ...passingScript(), [TV]: answer }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, changes: fakeChangeTracker({ changed: ['src/x.ts'] }) });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: TV, reason: 'CRITICAL_ISSUE' });
    expect(state.escalations.at(-1)!.context.message).toBe(OUTSIDE_MESSAGE('src/x.ts'));
    expect(evaluations(state)[0]).toMatchObject({
      testVerifierChanges: { kind: 'outside-tests', files: ['src/x.ts'], outside: ['src/x.ts'] },
      closed: { outcome: 'escalated' }
    });
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-2 without a snapshot, a Test Verifier write outside a test path is still flagged on the resume after its failure, until it is reverted', async () => {
    const tracker = fakeChangeTracker({ base: { kind: 'none', reason: 'not a git work tree' } });
    const foo = join(project.dir, 'src', 'foo.ts');
    const writesSrcAndFails = () => {
      mkdirSync(dirname(foo), { recursive: true });
      writeFileSync(foo, 'export const foo = 1;\n');
      return testVerifier({ status: 'FAIL' });
    };
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), [TV]: writesSrcAndFails }, { cwd: project.dir }).invoke,
      changes: tracker
    });
    expect(first.escalations.at(-1)!.context.message).toBe(OUTSIDE_MESSAGE('src/foo.ts'));

    // Resumed without reverting: the new evaluation's copy of the working tree already holds
    // src/foo.ts, but the Test Verifier is measured against the first evaluation's baseline.
    const second = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, resumeFromState: onDisk(project.dir), changes: tracker });
    expect(second.completionStatus).toBe('ESCALATED');
    expect(second.escalations.at(-1)!.context.message).toBe(OUTSIDE_MESSAGE('src/foo.ts'));
    const [e1, e2] = evaluations(second);
    expect(e1.baseline).toMatchObject({ kind: 'copy', dir: e1.copy!.dir });
    expect(e2.baseline).toEqual(e1.baseline);
    expect(filesBelow(e2.copy!.dir)).toContain('src/foo.ts');

    // Reverted: the run goes on.
    rmSync(foo);
    const third = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, resumeFromState: onDisk(project.dir), changes: tracker });
    expect(third.completionStatus).toBe('SUCCESS');
    expect(evaluations(third)[2].testVerifierChanges).toEqual({ kind: 'none' });
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-1 a Test Verifier that already passed is not measured again after an escalation: a later hand fix is not its change, and its test files still reach the follow-up', async () => {
    const { tracker, changed } = modelWorkingTree();
    const writesTest = () => {
      changed.add('test/a.test.ts');
      return testVerifier();
    };
    const gates = recordingGates({ auditExecution: n => (n === 1 ? executionAudit({ failed: 1 }) : executionAudit()) });
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), [TV]: writesTest }, { cwd: project.dir }).invoke,
      changes: tracker,
      gates: gates.gates
    });
    expect(first.escalations.at(-1)).toMatchObject({ reason: 'EXECUTION_FAILURE' });
    expect(evaluations(first)[0].testVerifierChanges).toEqual({ kind: 'tests', files: ['test/a.test.ts'] });

    changed.add('src/fix.ts');
    const resumed = scriptedInvoker({ ...passingScript(), [FOLLOWUP]: followup({ files: ['test/a.test.ts'] }) }, { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk(project.dir), changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents()).not.toContain(TV);
    const second = evaluations(state)[1];
    expect(second.baseline).toBeUndefined();
    expect(second.testVerifierChanges).toEqual({ kind: 'none' });
    expect(second.followup).toMatchObject({ status: 'reviewed', files: ['test/a.test.ts'] });
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-5 the Validator\'s IMPORTANT issues on an escalated first pass', () => {
  it('MINOR-5 a first pass that escalates after the Validator\'s output was recorded records its IMPORTANT issues once, under 07-validator, mapped out of the copy', async () => {
    const important = (cwd: string): ValidatorIssue => ({
      severity: 'IMPORTANT',
      file: join(cwd, 'src/a.ts'),
      line: 7,
      message: 'Magic number 30',
      suggestion: 'Name it',
      canFix: true
    });
    const script = (tv: ScriptEntry): InvokerScript => ({
      ...passingScript(),
      [TV]: tv,
      [VAL]: (call: AgentInvocation) => validator({ issues: [important(call.cwd!)] })
    });
    const first = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(script(testVerifier({ status: 'FAIL' })), { cwd: project.dir }).invoke });

    expect(first.completionStatus).toBe('ESCALATED');
    expect(evaluations(first)[0].validator).toBeDefined();
    expect(findingsFrom(first, VAL)).toEqual(['[src/a.ts:7] Magic number 30']);
    expect(findingsFrom(onDisk(project.dir)!, VAL)).toEqual(['[src/a.ts:7] Magic number 30']);

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(script(testVerifier()), { cwd: project.dir }).invoke, resumeFromState: onDisk(project.dir) });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(findingsFrom(state, VAL)).toEqual(['[src/a.ts:7] Magic number 30']);
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-6 the review root must be outside the project', () => {
  it.each<[string, () => string, RegExp]>([
    ['inside the project', () => join(project.dir, 'review-copies'), /is inside the project/],
    ['the project itself', () => project.dir, /is inside the project/]
  ])('MINOR-6 a review root %s escalates REVIEW_COPY_FAILED before anything is created or any Stage 4 agent runs', async (_label, root, message) => {
    const reviewRoot = root();
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, reviewRoot });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'REVIEW_COPY_FAILED' });
    expect(state.escalations.at(-1)!.context.message).toMatch(message);
    expect(invoker.agents()).not.toContain(TV);
    expect(invoker.agents()).not.toContain(VAL);
    expect(existsSync(join(project.dir, 'review-copies'))).toBe(false);
    const prefix = `factory-review-${state.featureId}-`;
    for (const dir of [project.dir, dirname(project.dir), tmpdir()]) {
      expect(readdirSync(dir).filter(name => name.startsWith(prefix))).toEqual([]);
    }
    expect(evaluations(state)[0].copy).toBeUndefined();
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-2 a re-extracted copy keeps the copies it replaced', () => {
  /** A run whose Test Verifier is killed once the Validator's output (a CRITICAL in its copy) is recorded; then the copy is removed. */
  async function killedWithCopyRemoved(script: InvokerScript) {
    const base = scriptedInvoker(script, { cwd: project.dir });
    let captured: FeatureState | undefined;
    let killed = false;
    const invoke: AgentInvoker = async call => {
      if (call.agent === TV && !killed) {
        killed = true;
        await until(() => evaluations(onDisk(project.dir))[0]?.validator !== undefined, 'the Validator to be recorded');
        captured = onDisk(project.dir);
        throw new SimulatedKill(TV, 1);
      }
      return base.invoke(call);
    };
    await runToEnd({ cwd: project.dir, invoke });
    const state = restoreSnapshot(project.dir, structuredClone(captured!));
    const first = evaluations(state)[0].copy!.dir;
    removeTree(first);
    return { state, first };
  }

  const reportsInCopy = (_call: AgentInvocation, n: number) =>
    n === 1 ? validator({ status: 'FAIL', issues: [criticalOn(join(_call.cwd!, 'src/a.ts'))] }) : validator();

  it('MINOR-2 after a re-extraction, the Validator\'s recorded paths into the replaced copy still map to project paths and route to their builder', async () => {
    const { state: killed, first } = await killedWithCopyRemoved({ ...passingScript(), [VAL]: reportsInCopy });

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    expect(state.completionStatus).toBe('SUCCESS');
    const [e1] = evaluations(state);
    expect(e1.previousCopyDirs).toEqual([first]);
    expect(e1.copy!.dir).not.toBe(first);
    expect(state.validatorRoundsCompleted).toBe(1);
    expect(resumed.promptsFor('04-backend-builder')[0]).toContain('[src/a.ts:1] Route has no auth check — Add the guard');
  }, RUN_TIMEOUT_MS);

  it('MINOR-2 Gate 1 refuses a builder claim inside a copy that was replaced', async () => {
    const { state: killed, first } = await killedWithCopyRemoved({ ...passingScript(), [VAL]: reportsInCopy });

    const claim = join(first, FAKE_COPY_FILE);
    const resumed = scriptedInvoker({ ...passingScript(), '04-backend-builder': backend({ files: ['src/a.ts', claim] }) }, { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'HALLUCINATION_DETECTED' });
    expect(state.escalations.at(-1)!.context.message).toBe(`1 claimed file(s) inside a review copy, which only the harness writes: ${claim}`);
  }, RUN_TIMEOUT_MS);
});
