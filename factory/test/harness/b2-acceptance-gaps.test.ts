/**
 * Test Verifier (Agent 06) acceptance tests for PR B-2: the gaps the builders' own tests left.
 *
 * Each test here was written because a deliberate mutation of the implementation survived the
 * existing suite, or because an acceptance criterion had a branch no test reached. The mutation
 * each one kills is named in its comment. Fake tracker and fake gates only: no network, no git.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { copyWorkingTree, insideReviewCopies } from '../../harness/review-copy';
import { followupMismatch, issueKey, mergeIssues } from '../../harness/verification';
import { FeatureState } from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { backend, followup, placeholder, skeptic, testVerifier, validator } from '../fixtures/agent-outputs';
import { buildStageContext } from '../../harness/stage-context';
import { FAKE_COPY_FILE, fakeChangeTracker, writeFakeCopy } from '../fixtures/changes';
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
const BUILDER = '04-backend-builder';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-b2-gaps-');
});

afterEach(() => {
  project.cleanup();
});

// ---------------------------------------------------------------------------------------------
// Helpers

const criticalOn = (file: string, message = 'Route has no auth check'): ValidatorIssue => ({
  severity: 'CRITICAL',
  file,
  line: 1,
  message,
  suggestion: 'Add the guard',
  canFix: true
});

// ---------------------------------------------------------------------------------------------
// AC-124 / D-8: the fixed decision order after both parallel branches settled

describe('AC-124 D-8 the decision order after the parallel pair', () => {
  it('AC-124 when both parallel invocations throw, both are recorded and the Test Verifier\'s error is the one the run escalates on, even when the Validator threw first', async () => {
    // Kills: the rejected branches rethrown V before T. The Validator throws first in time here,
    // so only the fixed order (T before V) names the Test Verifier's error.
    const validatorThrew = signal();
    const passing = scriptedInvoker(passingScript(), { cwd: project.dir });
    const invoke: AgentInvoker = async call => {
      if (call.agent === VAL) {
        try {
          throw new Error('Validator SDK error');
        } finally {
          validatorThrew.resolve();
        }
      }
      if (call.agent === TV) {
        await within(validatorThrew.promise, 'the Validator to throw');
        throw new Error('Test Verifier SDK error');
      }
      return passing.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.agent, e.reason])).toEqual([['orchestrator', 'MANUAL']]);
    expect(state.escalations[0].context.message).toBe('Orchestration error: Test Verifier SDK error');
    // Both throws are recorded; the order of the two records is not what this test is about (it
    // rests on how many microtask hops each rejection takes), so they are compared by agent.
    const verifying = state.agentInvocations!.filter(i => i.agent === TV || i.agent === VAL);
    const byAgent = verifying.map(i => [i.agent, i.outcome, i.error, i.evaluation]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(byAgent).toEqual([
      [TV, 'threw', 'Test Verifier SDK error', 1],
      [VAL, 'threw', 'Validator SDK error', 1]
    ]);
    expect(evaluations(state)[0].closed?.outcome).toBe('escalated');
  }, RUN_TIMEOUT_MS);

  it('AC-124 D-8 a Test Verifier FAIL is decided before the Validator\'s schema failure: the run escalates on the Test Verifier, CRITICAL_ISSUE', async () => {
    // Kills: the Validator's schema failure checked before the Test Verifier's verdict.
    const invoker = scriptedInvoker(
      { ...passingScript(), [TV]: testVerifier({ status: 'FAIL' }), [VAL]: placeholder(4, VAL) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.agent, e.reason])).toEqual([[TV, 'CRITICAL_ISSUE']]);
    expect(state.stageHistory.filter(s => s.agent === TV).map(s => s.status)).toEqual(['FAIL']);
    expect(evaluations(state)[0].validator).toBeUndefined();
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-157 / D-14: the verification-start marker is committed before the copy

describe('AC-157 D-14 the verification-start marker', () => {
  it('AC-157 the evaluation start is on disk before the review copy is made, so a crash during the copy still leaves the marker', async () => {
    // Kills: recordEvaluationStart not committed (the start reached disk only with the copy record).
    let atExtraction: FeatureState | undefined;
    const tracker = fakeChangeTracker({
      extract: async (_cwd, _snap, dest) => {
        atExtraction = onDisk(project.dir);
        return writeFakeCopy(dest);
      }
    });

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const [started] = evaluations(atExtraction);
    expect(evaluations(atExtraction)).toHaveLength(1);
    expect(started).toMatchObject({ e: 1, cycle: 0, round: 0, kind: 'first-pass', startedAt: expect.any(String) });
    expect(started.copy).toBeUndefined();
    expect(started.closed).toBeUndefined();
    // No verifying agent had been invoked yet: the marker alone moves the run past the snapshot.
    expect((atExtraction?.agentInvocations ?? []).filter(i => i.stage === 4)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-126: the fallback copy for a run started before PR B-1

describe('AC-126 a run with a git base but no snapshot recorded', () => {
  it('AC-126 a run from before B-1 (git base, no snapshot recorded) reviews a working-tree copy recorded with the pre-B-1 reason, and nothing is extracted', async () => {
    // Kills: the fallback reason always "not a git work tree". The run is killed at the Test
    // Verifier's first call, and its record is then stripped of everything B-1 and B-2 added: the
    // snapshot list, the evaluations, and the branch and pre-existing changes on the change base
    // (a run recorded before PR B-1 has only the base commit).
    const tracker = fakeChangeTracker();
    const kill = killAt(scriptedInvoker(passingScript(), { cwd: project.dir }).invoke, TV, 1, project.dir);
    await runToEnd({ cwd: project.dir, invoke: kill.invoke, changes: tracker });
    const preB1 = kill.snapshot();
    expect(preB1.changeBase?.kind).toBe('git');
    delete preB1.stage3Snapshots;
    delete preB1.validatorEvaluations;
    if (preB1.changeBase?.kind === 'git') {
      delete preB1.changeBase.branch;
      delete preB1.changeBase.preExisting;
    }
    const killed = restoreSnapshot(project.dir, preB1);
    const extractionsBefore = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot').length;

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: killed, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const reason = 'no snapshot was recorded for this run (started before PR B-1)';
    const [evaluation] = evaluations(state);
    expect(evaluation.copy!.source).toEqual({ kind: 'working-tree', reason });
    expect(tracker.reviewCalls.filter(c => c.method === 'extractSnapshot')).toHaveLength(extractionsBefore);
    expect(resumed.calls.find(c => c.agent === VAL)!.prompt).toContain(
      `It is a read-only copy of the working tree made before the Test Verifier started (${reason}).`
    );
    expect(existsSync(join(evaluation.copy!.dir, '.factory'))).toBe(false);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-123: a missing copy is re-extracted from the evaluation's own recorded snapshot

describe('AC-123 re-extraction from the recorded source', () => {
  it('AC-123 a missing copy is re-extracted from the evaluation\'s recorded snapshot, never from a later one the run holds', async () => {
    // Kills: the re-extraction reading the run's latest snapshot instead of the evaluation's
    // recorded source (in a normal run the two coincide, so the existing test could not tell).
    // The record is crafted: a later written snapshot is added to the killed run's state. No run
    // reaches this state today (a later snapshot is written only by a validator round's or a
    // rework's Stage 3 gate, after this evaluation is decided), so this guards a future change.
    const tracker = fakeChangeTracker();
    const base = scriptedInvoker(passingScript(), { cwd: project.dir });
    let captured: FeatureState | undefined;
    let killed = false;
    const invoke: AgentInvoker = async call => {
      if (call.agent === VAL && !killed) {
        killed = true;
        await until(() => (onDisk(project.dir)?.stageHistory ?? []).some(s => s.agent === TV && s.status === 'PASS'), 'the Test Verifier PASS');
        captured = onDisk(project.dir);
        throw new SimulatedKill(VAL, 1);
      }
      return base.invoke(call);
    };
    await runToEnd({ cwd: project.dir, invoke, changes: tracker });
    const state0 = structuredClone(captured!);
    const recorded = evaluations(state0)[0].copy!;
    const first = state0.stage3Snapshots![0];
    if (first.status !== 'written') throw new Error('expected a written snapshot');
    state0.stage3Snapshots!.push({ ...first, n: 2, ref: first.ref.replace(/stage3-1$/, 'stage3-2'), commit: 'b'.repeat(40), tree: 'e'.repeat(40), at: { phase: 'validator-round', round: 9 } });
    const crafted = restoreSnapshot(project.dir, state0);
    removeTree(recorded.dir);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: crafted, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const extractions = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot');
    expect(extractions).toHaveLength(2);
    expect(extractions[1]).toMatchObject({ snap: extractions[0].snap });
    expect(evaluations(state)[0].copy!.source).toEqual(recorded.source);
    expect(resumed.agents()).toEqual([VAL]);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-132 / D-11: a skeptic reads an intact copy

describe('AC-132 the copy a skeptic reads is checked first', () => {
  it('AC-132 a review copy that disappeared after the Validator read it is re-extracted before the skeptics, which read the new copy', async () => {
    // Kills: the skeptic pointed at the recorded copy directory without the copyIntact check
    // (it would read a directory that no longer exists).
    const tracker = fakeChangeTracker();
    const skepticSaw: Array<{ cwd?: string; exists: boolean }> = [];
    const passing = scriptedInvoker(
      {
        ...passingScript(),
        [VAL]: (call: AgentInvocation, n: number) => {
          if (n > 1) return validator();
          // The OS temp cleaner removes the copy after the Validator read it.
          removeTree(call.cwd!);
          return validator({ status: 'FAIL', issues: [criticalOn('src/a.ts')] });
        }
      },
      { cwd: project.dir }
    );
    const invoke: AgentInvoker = async call => {
      if (call.agent === SKEPTIC) skepticSaw.push({ cwd: call.cwd, exists: call.cwd !== undefined && existsSync(join(call.cwd, FAKE_COPY_FILE)) });
      return passing.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: tracker });

    expect(state.completionStatus).toBe('SUCCESS');
    const [first] = evaluations(state);
    const extractions = tracker.reviewCalls.filter(c => c.method === 'extractSnapshot');
    // The first pass's copy, its re-extraction before the skeptics, and the validator round's copy.
    expect(extractions).toHaveLength(3);
    expect(extractions[1]).toMatchObject({ snap: extractions[0].snap, dest: first.copy!.dir });
    expect(skepticSaw).toEqual([
      { cwd: first.copy!.dir, exists: true },
      { cwd: first.copy!.dir, exists: true }
    ]);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-133 / I-11: a skeptic's document is the schema-named one, under its own name

describe('AC-133 I-11 the skeptic document', () => {
  it('AC-133 only the skeptic\'s SKEPTIC_REVIEW.md is kept, as SKEPTIC_E<e>_<key>_<A|B>.md; another document it returns is never written, and VALIDATION_REPORT.md is untouched', async () => {
    // Kills: the skeptic's artifacts not filtered to the schema-named document (the first
    // non-empty one, here an intruder, would be kept under the skeptic's name), and the skeptic's
    // whole artifact list persisted (INTRUDER.md would be written, and VALIDATION_REPORT.md
    // overwritten before the round's Validator writes its own).
    const issue = criticalOn('src/a.ts');
    const firstReport = '# Validation Report\n\nRound 1: one CRITICAL issue.';
    const intruding = (call: AgentInvocation) => {
      const output = skeptic()(call);
      output.details.artifacts.unshift(
        { name: 'INTRUDER.md', path: 'INTRUDER.md', description: 'not mine', content: '# Written by a skeptic\n' },
        { name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md', description: 'not mine', content: '# Overwritten by a skeptic\n' }
      );
      return output;
    };
    let reportAtRound: string | undefined;
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: (_call: AgentInvocation, n: number) => {
        if (n === 1) {
          const output = validator({ status: 'FAIL', issues: [issue] });
          output.details.artifacts.find(artifact => artifact.name === 'VALIDATION_REPORT.md')!.content = firstReport;
          return output;
        }
        // The round's Validator: both skeptics have returned, and its own report is not written yet.
        const featureId = onDisk(project.dir)?.featureId;
        reportAtRound = featureId && readFileSync(join(project.dir, '.factory', featureId, 'VALIDATION_REPORT.md'), 'utf8');
        return validator();
      },
      [SKEPTIC]: intruding
    };

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(script, { cwd: project.dir }).invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const runDir = join(project.dir, '.factory', state.featureId);
    const key = issueKey(VAL, issue);
    for (const instance of ['A', 'B']) {
      expect(readFileSync(join(runDir, `SKEPTIC_E1_${key}_${instance}.md`), 'utf8')).toBe('# Skeptic Review\n\nUPHELD: The issue stands as stated.');
    }
    expect(existsSync(join(runDir, 'INTRUDER.md'))).toBe(false);
    expect(reportAtRound).toBe(firstReport);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-117 / D-15: Gate 1 guards every recorded copy, not only the latest

describe('AC-117 D-15 Gate 1 and earlier review copies', () => {
  it('AC-117 a round-2 builder claim inside the FIRST evaluation\'s copy fails Gate 1 with HALLUCINATION_DETECTED', async () => {
    // Kills: the guard checking only the latest evaluation's copy.
    let evaluationsAtRound2: number | undefined;
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: (_call: AgentInvocation, n: number) =>
        n <= 2 ? validator({ status: 'FAIL', issues: [criticalOn('src/a.ts', `Round ${n}: route has no auth check`)] }) : validator(),
      [BUILDER]: (_call: AgentInvocation, n: number) => {
        if (n < 3) return backend();
        const all = evaluations(onDisk(project.dir));
        evaluationsAtRound2 = all.length;
        return backend({ files: ['src/a.ts', join(all[0].copy!.dir, FAKE_COPY_FILE)] });
      }
    };

    const state = await runToEnd({ cwd: project.dir, invoke: scriptedInvoker(script, { cwd: project.dir }).invoke, approveCheckpoint: decisions().approve });

    expect(state.completionStatus).toBe('ESCALATED');
    // The claim was made after a later evaluation, with its own copy, was recorded.
    expect(evaluationsAtRound2).toBeGreaterThanOrEqual(2);
    const copyDir = evaluations(state)[0].copy!.dir;
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'HALLUCINATION_DETECTED' });
    expect(state.escalations.at(-1)!.context.message).toBe(
      `1 claimed file(s) inside a review copy, which only the harness writes: ${join(copyDir, FAKE_COPY_FILE)}`
    );
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// AC-121 / AC-123 / D-12: the follow-up's step is part of what a failed gate or a CP3 rework re-runs

describe('AC-121 AC-123 the follow-up step on a gate failure and a CP3 rework', () => {
  it('AC-121 I-6 a Stage 4 gate failure invalidates the follow-up\'s step too, as it judged the follow-up\'s review', async () => {
    // Kills: 07b-validator-followup dropped from the Stage 4 gate's invalidation list.
    const script: InvokerScript = {
      ...passingScript(),
      [VAL]: validator({ security: { authImplemented: false } }),
      [FOLLOWUP]: followup({ files: ['test/a.test.ts'] })
    };

    const escalated = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      changes: fakeChangeTracker({ changed: ['test/a.test.ts'] })
    });

    expect(escalated.escalations.at(-1)!.context.message).toMatch(/^Stage 4 gate failed/);
    for (const agent of [TV, VAL, FOLLOWUP]) {
      expect({ agent, invalidated: escalated.stageHistory.filter(s => s.agent === agent).map(s => s.invalidated?.reason) }).toEqual({
        agent,
        invalidated: [expect.stringMatching(/Stage 4 gate failed/)]
      });
    }
  }, RUN_TIMEOUT_MS);

  it('AC-123 D-12 a CHECKPOINT 3 rework supersedes VALIDATION_FOLLOWUP.md and invalidates the follow-up\'s step', async () => {
    // Kills: VALIDATION_FOLLOWUP.md dropped from SUPERSEDED_ON_REWORK[3], and 07b dropped from
    // INVALIDATED_ON_REWORK[3].
    const script: InvokerScript = { ...passingScript(), [FOLLOWUP]: followup({ files: ['test/a.test.ts'] }) };
    const rejected = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(script, { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: fakeChangeTracker({ changed: ['test/a.test.ts'] })
    });
    expect(rejected.completionStatus).toBe('ESCALATED');
    const runDir = join(project.dir, '.factory', rejected.featureId);
    expect(existsSync(join(runDir, 'VALIDATION_FOLLOWUP.md'))).toBe(true);

    // The rework's Test Verifier changes nothing, so it has no follow-up of its own.
    const escalatedOnDisk = onDisk(project.dir);
    expect(escalatedOnDisk).toBeDefined();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      resumeFromState: escalatedOnDisk,
      changes: fakeChangeTracker()
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(readdirSync(join(runDir, '_superseded', '1')).sort()).toEqual(['TEST_REPORT.md', 'VALIDATION_FOLLOWUP.md', 'VALIDATION_REPORT.md']);
    expect(existsSync(join(runDir, 'VALIDATION_FOLLOWUP.md'))).toBe(false);
    expect(state.stageHistory.filter(s => s.agent === FOLLOWUP).map(s => [s.status, s.invalidated !== undefined])).toEqual([['PASS', true]]);
  }, RUN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Unit-level gaps: the merge, the follow-up check, the Gate 1 copy guard and the fallback copy

describe('AC-122 AC-121 AC-117 AC-126 unit gaps', () => {
  const COPY = '/private/var/folders/ab/T/factory-review-run-1-e1-XyZ123';

  it('AC-122 D-10 mergeIssues never maps a follow-up path, even one inside the copy, while it maps the main review\'s', () => {
    // Kills: the follow-up's issues mapped out of the main review's copy (it reviewed the live project).
    const inCopy = (file: string): ValidatorIssue => ({ ...criticalOn(`${COPY}/${file}`), message: `Issue in ${file}` });

    const merged = mergeIssues({ issues: [inCopy('src/a.ts')], copyDir: COPY }, { issues: [inCopy('test/b.test.ts')] }, '/p');

    expect(merged.map(m => [m.origin, m.issue.file])).toEqual([
      [VAL, 'src/a.ts'],
      [FOLLOWUP, `${COPY}/test/b.test.ts`]
    ]);
  });

  it('AC-121 I-29 followupMismatch reports a follow-up that reviewed as many files as it was given, but other ones', () => {
    // Kills: the I-29 check comparing only the sizes of the two sets.
    expect(followupMismatch(['test/a.test.ts', 'test/b.test.ts'], ['test/a.test.ts', 'test/c.test.ts'], '/p')).toBe(
      '07b-validator-followup reviewed test/a.test.ts, test/c.test.ts but was given test/a.test.ts, test/b.test.ts'
    );
  });

  it('AC-117 D-15 insideReviewCopies resolves a relative claim against the project directory it is given, not the process\'s', () => {
    // Kills: a relative claim resolved against process.cwd().
    const parent = dirname(COPY);
    const claim = 'factory-review-run-1-e1-XyZ123/src/a.ts';

    expect(insideReviewCopies([claim, 'src/a.ts'], [COPY], parent)).toEqual([claim]);
    expect(insideReviewCopies([claim], [COPY], '/Users/dev/project')).toEqual([]);
  });

  it('AC-126 I-5 copyWorkingTree skips .git and node_modules in any letter case, at any depth', () => {
    // Kills: the exclusions compared case-sensitively (on a case-insensitive file system .GIT is .git).
    const made: string[] = [];
    try {
      const src = mkdtempSync(join(tmpdir(), 'ff-b2-gaps-src-'));
      made.push(src);
      const dest = mkdtempSync(join(tmpdir(), 'ff-b2-gaps-dest-'));
      made.push(dest);
      const put = (path: string) => {
        mkdirSync(dirname(join(src, path)), { recursive: true });
        writeFileSync(join(src, path), 'x\n');
      };
      put('src/a.ts');
      put('Node_Modules/pkg/index.js');
      put('pkg/NODE_MODULES/dep/index.js');
      put('sub/.Git/config');
      put('.GIT/HEAD');

      const copied = copyWorkingTree(src, dest);

      // Leaves: src/a.ts, and pkg and sub, left empty by the exclusions.
      expect(copied.entries).toBe(3);
      expect(readdirSync(dest).sort()).toEqual(['pkg', 'src', 'sub']);
      expect(readdirSync(join(dest, 'pkg'))).toEqual([]);
      expect(readdirSync(join(dest, 'sub'))).toEqual([]);
    } finally {
      for (const dir of made) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-131 the Stage 4 context carries the typed verdict\'s standing and disproved counts as recorded', () => {
    // Kills: the standing count not carried into the Stage 4 metadata (the gate would then report
    // "did not pass" instead of naming how many CRITICAL issues stand).
    const ctx = buildStageContext({
      stage: 4,
      cwd: project.dir,
      outputs: { test: testVerifier(), validator: validator() },
      harness: { validation: { passed: false, standing: ['0123456789ab', '123456789abc'], disproved: ['23456789abcd'], recordedAt: '2026-10-05T00:00:00.000Z' } }
    });

    expect(ctx.metadata.validationVerdict).toEqual({ passed: false, standing: 2, disproved: 1 });
  });
});
