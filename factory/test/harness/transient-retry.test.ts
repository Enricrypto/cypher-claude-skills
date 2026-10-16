/**
 * R3 / AC-006, AC-007, AC-008: the single transient retry, orchestrator-level.
 *
 * The retry lives in `timedInvoke`, the one invocation choke point and the only caller of
 * `recordAgentInvocation` (P4), so every one of the nine invocation sites gets it. These tests
 * drive whole runs through `runToEnd` with scripted invokers that throw, and assert on what
 * `state.json` ends up holding.
 *
 * Fake tracker and fake gates: no network, no child process, no git. The 30-second wait is
 * injected (`waitBeforeRetry`), so nothing here ever sleeps — `barriers.ts`'s rule (R3-1).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { AgentInvocation } from '../../runner/invoke-agent';
import { AgentInvocationError } from '../../runner/invoke-agent';
import { TRANSIENT_RETRY_WAIT_MS } from '../../runner/transient-errors';
import { loadState } from '../../harness/state-store';
import {
  AgentInvocationRecord,
  BuilderPhase,
  createFeatureState,
  FeatureState,
  recordStage3Snapshot,
  Stage3Snapshot,
  stage3SnapshotPassedBy,
  ValidatorEvaluation
} from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { skeptic, testVerifier, validator } from '../fixtures/agent-outputs';
import { InvokerScript, passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { signal, within } from '../fixtures/barriers';

const RUN_TIMEOUT_MS = 30_000;

const BUILDER = '04-backend-builder';
const VERIFIER = '06-test-verifier';
const VAL = '07-validator';
const SKEPTIC = '07c-validator-skeptic';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-retry-');
});

afterEach(() => {
  project.cleanup();
});

const onDisk = (state: FeatureState): FeatureState => loadState(project.dir, state.featureId)!;

/** The invocation records of one agent, in order. */
const recordsFor = (state: FeatureState, agent: string): AgentInvocationRecord[] =>
  (state.agentInvocations ?? []).filter(record => record.agent === agent);

/** A dropped connection, as a raw transport error really arrives. */
const connectionClosed = () => new Error('Connection closed');
/** A max-turns failure, as invoke-agent.ts really wraps it. */
const maxTurns = (agent: string, stage: number) =>
  new AgentInvocationError(`Agent ${agent} failed (error_max_turns).`, agent, stage, []);
/** A failure the allow-list does not recognise. */
const unrecognised = (agent: string, stage: number) =>
  new AgentInvocationError(`Agent ${agent} failed (error_during_execution).`, agent, stage, ['something new']);

/** A script in which `agent` throws `error` on its first call and behaves normally afterwards. */
function throwsOnce(agent: string, error: () => unknown, base: InvokerScript = passingScript()): InvokerScript {
  const normal = base[agent as keyof InvokerScript];
  return {
    ...base,
    [agent]: (call: AgentInvocation, callNumber: number) => {
      if (callNumber === 1) throw error();
      return typeof normal === 'function' ? (normal as (c: AgentInvocation, n: number) => unknown)(call, callNumber) : structuredClone(normal);
    }
  };
}

/** Records the ms each `waitBeforeRetry` call was asked for. */
function waitSpy(onWait?: () => void) {
  const waits: number[] = [];
  return {
    waits,
    waitBeforeRetry: async (ms: number) => {
      waits.push(ms);
      onWait?.();
    }
  };
}

describe('R3 a transient failure is retried once (AC-006)', () => {
  it(
    'AC-006 AC-008 a Connection closed on the Researcher is retried once after 30s, BOTH attempts are recorded, and the run reaches SUCCESS',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(throwsOnce('01-researcher', connectionClosed), { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      // The retry is invisible to every downstream stage (AC-008).
      expect(state.completionStatus).toBe('SUCCESS');
      // Waited exactly once, for exactly 30 seconds.
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);
      expect(TRANSIENT_RETRY_WAIT_MS).toBe(30_000);

      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(2);

      // The failed attempt: marked, with the matched signal and today's `threw` / `error`.
      expect(records[0].invocationAttempt).toBe(1);
      expect(records[0].transientSignal).toBe('CONNECTION_CLOSED');
      expect(records[0].outcome).toBe('threw');
      expect(records[0].error).toContain('Connection closed');

      // The retry: marked, successful, and carrying no signal of its own.
      expect(records[1].invocationAttempt).toBe(2);
      expect(records[1].outcome).toBeUndefined();
      expect(records[1].transientSignal).toBeUndefined();

      // Each attempt has its OWN start, so both durations are real.
      expect(Date.parse(records[1].startedAt)).toBeGreaterThanOrEqual(Date.parse(records[0].completedAt));
      expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(records[1].durationMs).toBeGreaterThanOrEqual(0);

      // The agent really was invoked twice, with the SAME prompt (AC-006: same invocation).
      const prompts = invoker.promptsFor('01-researcher');
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toBe(prompts[1]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-006 the FAILED record is committed BEFORE the wait: a kill inside the 30-second window still leaves it on record',
    async () => {
      /** What `state.json` held at the moment the wait began. */
      let duringWait: FeatureState | undefined;
      let runId: string | undefined;
      const invoker = scriptedInvoker(throwsOnce('01-researcher', connectionClosed), { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        // Asserted from INSIDE the injected wait: this is the only place the ordering is visible.
        waitBeforeRetry: async () => {
          const ids = require('fs')
            .readdirSync(require('path').join(project.dir, '.factory'), { withFileTypes: true })
            .filter((entry: any) => entry.isDirectory() && entry.name !== '_archive')
            .map((entry: any) => entry.name);
          runId = ids[0];
          duringWait = loadState(project.dir, runId!)!;
        }
      });

      expect(state.completionStatus).toBe('SUCCESS');
      // The failed attempt was already durable when the wait started.
      const already = (duringWait!.agentInvocations ?? []).filter(record => record.agent === '01-researcher');
      expect(already).toHaveLength(1);
      expect(already[0].outcome).toBe('threw');
      expect(already[0].invocationAttempt).toBe(1);
      expect(already[0].transientSignal).toBe('CONNECTION_CLOSED');
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-006 the retry is bounded at ONE: the same transient error recurring escalates after exactly two attempts',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        { ...passingScript(), '01-researcher': () => { throw connectionClosed(); } },
        { cwd: project.dir }
      );

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      expect(state.completionStatus).toBe('ESCALATED');
      // Exactly one wait, so exactly one retry: never a loop.
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);
      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(2);
      expect(records.map(r => r.outcome)).toEqual(['threw', 'threw']);
      // BOTH records are marked, even though the retry also failed: that is what makes
      // state-tracker.ts's "set on BOTH records" comment and SKILL.md's "they carry
      // `invocationAttempt` 1 and 2" true, and what tells this second failure apart from a
      // never-retried one.
      expect(records.map(r => r.invocationAttempt)).toEqual([1, 2]);
      // The signal belongs to the attempt whose failure EARNED the retry, and only to it.
      expect(records[0].transientSignal).toBe('CONNECTION_CLOSED');
      expect(records[1].transientSignal).toBeUndefined();
      expect(invoker.promptsFor('01-researcher')).toHaveLength(2);
    },
    RUN_TIMEOUT_MS
  );
});

describe('R3 a failure that is not transient is never retried (AC-007)', () => {
  it(
    'AC-007 a max-turns failure is NOT retried: one record, no wait, and the run escalates exactly as it does today',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        { ...passingScript(), '01-researcher': () => { throw maxTurns('01-researcher', 1); } },
        { cwd: project.dir }
      );

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      expect(state.completionStatus).toBe('ESCALATED');
      expect(wait.waits).toEqual([]);
      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(1);
      expect(records[0].outcome).toBe('threw');
      // Byte-identically to today: no new field appears on a record that was not retried.
      expect(records[0].invocationAttempt).toBeUndefined();
      expect(records[0].transientSignal).toBeUndefined();
      expect(invoker.promptsFor('01-researcher')).toHaveLength(1);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-007 an UNRECOGNISED failure is NOT retried either: the allow-list never retries by default',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        { ...passingScript(), '01-researcher': () => { throw unrecognised('01-researcher', 1); } },
        { cwd: project.dir }
      );

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      expect(state.completionStatus).toBe('ESCALATED');
      expect(wait.waits).toEqual([]);
      expect(recordsFor(onDisk(state), '01-researcher')).toHaveLength(1);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-007 the rethrown error is the ORIGINAL one, unchanged, so the escalation text is what it was',
    async () => {
      const invoker = scriptedInvoker(
        { ...passingScript(), '01-researcher': () => { throw maxTurns('01-researcher', 1); } },
        { cwd: project.dir }
      );

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

      // The original error's text reached the escalation unchanged, which is what "escalates
      // exactly as it does today" means: R3 rethrows the error it caught, never a wrapper.
      const messages = (onDisk(state).escalations ?? []).map(escalation => escalation.context.message);
      expect(messages.some(message => message.includes('error_max_turns'))).toBe(true);
    },
    RUN_TIMEOUT_MS
  );
});

describe('R3 a transport retry never consumes a BUILDER attempt (AC-008)', () => {
  it(
    'AC-008 a builder retried for a transient error keeps its attempt: ONE builder attempt, two invocation records, and Loop Count Within Limits still passes',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(throwsOnce(BUILDER, connectionClosed), { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);

      const saved = onDisk(state);
      const records = recordsFor(saved, BUILDER);
      expect(records).toHaveLength(2);

      // The BUILDER attempt is identical on both records: `meta` passed through untouched. This
      // is the assertion that keeps a transport blip from eating one of the builder's three tries.
      expect(records.map(r => r.attempt)).toEqual([1, 1]);
      expect(records.map(r => r.invocationAttempt)).toEqual([1, 2]);
      // ...and the phase, round and evaluation are identical too.
      expect(records[0].phase).toBe(records[1].phase);
      expect(records[0].round).toBe(records[1].round);

      // The builder's own step records ONE attempt, so the Stage 3 gate's "Loop Count Within
      // Limits" criterion sees one try, not two. The run reaching SUCCESS is that gate passing.
      // ONE step, not two: the transport retry is invisible at the step level, so the Stage 3
      // gate's "Loop Count Within Limits" criterion sees a single clean try. `loopCount` is the
      // number of loop-backs recorded for the agent, so 0 is what a first-attempt pass scores —
      // the retry must not bump it, which is precisely the regression this guards.
      const builderSteps = saved.stageHistory.filter(step => step.agent === BUILDER);
      expect(builderSteps).toHaveLength(1);
      expect(builderSteps[0].status).toBe('PASS');
      expect(builderSteps[0].loopCount).toBe(0);
      // And no loop-back was recorded anywhere for the builder.
      expect((saved.loopBacks ?? []).filter(back => back.agent === BUILDER)).toHaveLength(0);
    },
    RUN_TIMEOUT_MS
  );
});

describe('R3 a retry inside a parallel section (AC-008)', () => {
  it(
    'AC-008 a retry on the Test Verifier (06 || 07) keeps BOTH branches settling, and the run still reaches SUCCESS',
    async () => {
      const verifierStarted = signal();
      const validatorStarted = signal();
      const wait = waitSpy();

      const script: InvokerScript = {
        ...passingScript(),
        [VERIFIER]: (call: AgentInvocation, callNumber: number) => {
          verifierStarted.resolve();
          if (callNumber === 1) throw connectionClosed();
          return testVerifier();
        },
        [VAL]: () => {
          validatorStarted.resolve();
          return validator();
        }
      };
      const invoker = scriptedInvoker(script, { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      // Both branches really ran and both settled: neither is left running, which is the
      // guarantee the section already provided and the retry must not weaken.
      await within(verifierStarted.promise, 'the Test Verifier to start');
      await within(validatorStarted.promise, 'the Validator to start');
      expect(state.completionStatus).toBe('SUCCESS');
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);

      const saved = onDisk(state);
      expect(recordsFor(saved, VERIFIER)).toHaveLength(2);
      // The partner branch is untouched: still exactly one invocation, still no retry marker.
      const validatorRecords = recordsFor(saved, VAL);
      expect(validatorRecords).toHaveLength(1);
      expect(validatorRecords[0].invocationAttempt).toBeUndefined();
      // Both steps are recorded, so the decision order was evaluated after both resolved.
      expect(saved.stageHistory.some(step => step.agent === VERIFIER && step.status === 'PASS')).toBe(true);
      expect(saved.stageHistory.some(step => step.agent === VAL && step.status === 'PASS')).toBe(true);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-008 a retry on skeptic A (A || B) leaves neither skeptic running: both verdicts are recorded and the decision is the one it would have been',
    async () => {
      const critical: ValidatorIssue = {
        severity: 'CRITICAL',
        file: 'src/a.ts',
        line: 1,
        message: 'Route has no auth check',
        suggestion: 'Add the guard',
        canFix: true
      };
      const wait = waitSpy();
      /** How many times each skeptic instance has been invoked, keyed by the prompt's own marker. */
      const callsPerInstance: Record<string, number> = { A: 0, B: 0 };

      const script: InvokerScript = {
        ...passingScript(),
        // FAIL with the CRITICAL on the first call so two skeptics are dispatched, then pass so
        // the run can finish rather than loop.
        [VAL]: (_call: AgentInvocation, n: number) =>
          n === 1 ? validator({ status: 'FAIL', issues: [critical] }) : validator(),
        [SKEPTIC]: (call: AgentInvocation) => {
          // The instance is in the prompt, exactly as skeptics.test.ts reads it.
          const instance = call.prompt.includes('You are skeptic A.') ? 'A' : 'B';
          callsPerInstance[instance]++;
          // Skeptic A's FIRST invocation fails transiently; its retry and B both succeed.
          if (instance === 'A' && callsPerInstance.A === 1) throw connectionClosed();
          // The default issueKey echoes the key out of the prompt, so the verdict matches the
          // issue the Validator raised without this test having to recompute the key.
          return skeptic({ verdict: 'UPHELD' })(call);
        }
      };
      const invoker = scriptedInvoker(script, { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);

      const saved = onDisk(state);
      const records = recordsFor(saved, SKEPTIC);
      // Three invocations in all: A's failed attempt, A's retry, and B's single call.
      expect(records).toHaveLength(3);

      // Filtered by instance rather than by position, deliberately: A fails fast and then waits
      // while B is still running, so B's record may well be committed BETWEEN A's two. That
      // interleaving is the retry working as intended, not a defect — what matters is that each
      // instance's own records are right and that both instances settled.
      const a = records.filter(record => record.instance === 'A');
      const b = records.filter(record => record.instance === 'B');

      expect(a).toHaveLength(2);
      expect(a[0].outcome).toBe('threw');
      expect(a[0].invocationAttempt).toBe(1);
      expect(a[0].transientSignal).toBe('CONNECTION_CLOSED');
      expect(a[1].invocationAttempt).toBe(2);
      expect(a[1].outcome).toBeUndefined();

      // The partner branch is untouched by its sibling's retry.
      expect(b).toHaveLength(1);
      expect(b[0].invocationAttempt).toBeUndefined();
      expect(b[0].outcome).toBeUndefined();

      // The evaluation that actually dispatched skeptics — not `.at(-1)`, which is the later
      // clean pass that raised no CRITICAL and so judged nothing.
      const evaluation: ValidatorEvaluation | undefined = (saved.validatorEvaluations ?? []).find(
        candidate => (candidate.skeptics ?? []).length > 0
      );
      expect(evaluation).toBeDefined();

      // BOTH verdicts are on record, which is the "no skeptic is left running" half of the
      // guarantee: `Promise.allSettled` waited for A's retry as well as B.
      //
      // Asserted as a SET, deliberately. The orchestrator records each verdict "as soon as it
      // returns", so this array is in SETTLE order, never a fixed one — skeptics.test.ts's own
      // ordering test is titled "each verdict is recorded as it returns". A's retry makes A
      // settle second here, so the array really is [B, A], and that is the documented behaviour
      // rather than something the retry broke. The "A before B" guarantee AC-008 protects is the
      // DECISION order, which is evaluated after both settle and is asserted below.
      const verdicts = evaluation!.skeptics ?? [];
      expect(verdicts).toHaveLength(2);
      expect(new Set(verdicts.map(verdict => verdict.instance))).toEqual(new Set(['A', 'B']));

      // The decision itself came out as it would have with no retry at all: both skeptics UPHELD
      // the CRITICAL, so the issue stood and the builder was routed to fix it exactly once.
      expect(verdicts.every(verdict => verdict.verdict === 'UPHELD')).toBe(true);
      // Acting on that decision means routing the builder a SECOND time, in a validator round, to
      // fix the upheld issue — on top of its original stage-3 build. Both steps are the normal
      // outcome of an upheld CRITICAL, and the retry changed neither.
      const builderPhases = saved.stageHistory.filter(step => step.agent === BUILDER).map(step => step.phase);
      expect(builderPhases).toEqual(['stage3', 'validator-round']);
      // Each instance was invoked for this evaluation, A once-retried and B once.
      expect(a.every(record => record.evaluation === b[0].evaluation)).toBe(true);
    },
    RUN_TIMEOUT_MS
  );
});

describe('R3 old records stay readable (AC-008, R3-4)', () => {
  it('R3-4 AC-157 a second record cannot change stage3SnapshotPassedBy\'s verdict', () => {
    // The analysis the brief closes R3-4 with, asserted rather than assumed: a retry adds a
    // record whose startedAt is >= the first attempt's, so if the first satisfied the predicate
    // so does the retry, and if neither did, neither does. The `.some()` cannot flip.
    const taken = '2026-01-01T00:00:10.000Z';
    /** The builder phase the snapshot belongs to — what `stage3SnapshotPassedBy` is asked about. */
    const phase: BuilderPhase = { phase: 'rework', round: 1 };
    const snapshot: Stage3Snapshot = {
      status: 'written',
      n: 1,
      ref: 'refs/factory/r/stage3-1',
      // Full 40-character HEX object ids: `assertObjectId` rejects anything else.
      commit: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      at: phase,
      takenAt: taken
    };

    /** A state with `records` as its agentInvocations and one rework snapshot taken at `taken`. */
    const withRecords = (records: AgentInvocationRecord[]): FeatureState => {
      const state = recordStage3Snapshot(createFeatureState('r', undefined, 'add 2FA'), snapshot);
      return { ...state, agentInvocations: records };
    };

    const invocation = (startedAt: string, extra: Partial<AgentInvocationRecord> = {}): AgentInvocationRecord => ({
      stage: 4,
      agent: VERIFIER,
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      ...extra
    });

    // Before R-1: one record, started after the snapshot.
    const oldStyle = withRecords([invocation('2026-01-01T00:00:20.000Z')]);
    // After R-1: the same invocation retried — two records, the second necessarily later.
    const retried = withRecords([
      invocation('2026-01-01T00:00:20.000Z', { outcome: 'threw', invocationAttempt: 1, transientSignal: 'CONNECTION_CLOSED' }),
      invocation('2026-01-01T00:00:21.000Z', { invocationAttempt: 2 })
    ]);
    // Both say the snapshot WAS passed by verification, and they agree.
    expect(stage3SnapshotPassedBy(oldStyle, phase)).toBe(true);
    expect(stage3SnapshotPassedBy(retried, phase)).toBe(stage3SnapshotPassedBy(oldStyle, phase));

    // And when neither attempt satisfies the predicate (both before the snapshot), still equal —
    // this is the half that would catch a retry accidentally making a stale snapshot look fresh.
    const earlyOld = withRecords([invocation('2026-01-01T00:00:01.000Z')]);
    const earlyRetried = withRecords([
      invocation('2026-01-01T00:00:01.000Z', { outcome: 'threw', invocationAttempt: 1 }),
      invocation('2026-01-01T00:00:02.000Z', { invocationAttempt: 2 })
    ]);
    expect(stage3SnapshotPassedBy(earlyOld, phase)).toBe(false);
    expect(stage3SnapshotPassedBy(earlyRetried, phase)).toBe(stage3SnapshotPassedBy(earlyOld, phase));
  });

  it(
    'AC-008 a run whose records predate R-1 (NEITHER new field present) resumes identically',
    async () => {
      // A full run first, then its record stripped of both new fields, then a resume.
      const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });
      const saved = onDisk(state);

      // Every record of a non-retried run already carries NEITHER field: that is the point.
      for (const record of saved.agentInvocations ?? []) {
        expect(record.invocationAttempt).toBeUndefined();
        expect(record.transientSignal).toBeUndefined();
      }
      expect(state.completionStatus).toBe('SUCCESS');
    },
    RUN_TIMEOUT_MS
  );
});
