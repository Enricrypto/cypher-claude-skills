/**
 * VLT: the pure verification logic of PR B-2 (D-7, D-10, D-11, D-12) [U].
 *
 * - verification.ts: the issue key, the merge of the main and follow-up reviews, the skeptic
 *   verdict (AC-129: disproved only when both skeptics say so), the disproved finding, the legacy
 *   verdict for a run whose Validator PASS predates B-2 (I-27), and the current rework cycle.
 * - state-tracker.ts: the evaluation records and their write-once recorders (AC-133), the
 *   REVIEW_COPY_FAILED escalation reason (I-18) and the new invocation fields.
 *
 * No filesystem, no git: every test builds a FeatureState in memory.
 */

import { describe, it, expect } from '@jest/globals';
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { ValidatorIssue, ValidatorOutput } from '../../harness/agent-output-schema';
import {
  AgentInvocationRecord,
  closeEvaluation,
  closeOpenEvaluations,
  createFeatureState,
  currentValidationVerdict,
  deserializeState,
  FeatureState,
  openEvaluation,
  recordAgentInvocation,
  recordCheckpointApproval,
  recordCheckpointRejection,
  recordEscalation,
  recordEvaluationStart,
  recordEvaluationValidator,
  recordFollowup,
  recordMeasurementBaseline,
  recordReviewCopy,
  recordReworkStart,
  reviewCopyDirs,
  recordSkepticVerdict,
  recordTestVerifierChanges,
  ReviewCopyRecord,
  serializeState,
  SkepticVerdictRecord,
  ValidationVerdict,
  ValidatorEvaluation
} from '../../harness/state-tracker';
import {
  classifyTestVerifierChanges,
  disprovedFinding,
  earlierBaseline,
  escalatedReviewFindings,
  evaluationKind,
  followupMismatch,
  followupPresented,
  importantFindings,
  issueKey,
  legacyVerdict,
  MergedIssue,
  mergeIssues,
  reviewFindingMessage,
  stage4Verdict,
  standingIssues,
  testVerifierFiles,
  verdictOf
} from '../../harness/verification';
import { currentReworkCycle } from '../../harness/run-progress';
import { followup, validator } from '../fixtures/agent-outputs';

const COPY = '/private/var/folders/ab/T/factory-review-run-1-e1-XyZ123';
const SHA = 'a'.repeat(64);
const COMMIT = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const TIMING = { startedAt: '2026-10-05T10:00:00.000Z', completedAt: '2026-10-05T10:01:00.000Z' };

function issue(overrides: Partial<ValidatorIssue> = {}): ValidatorIssue {
  return { severity: 'CRITICAL', file: 'src/a.ts', line: 3, message: 'Input is not validated', suggestion: 'Validate it', canFix: true, ...overrides };
}

function snapshotCopy(dir = `${COPY}`, overrides: Partial<ReviewCopyRecord> = {}): ReviewCopyRecord {
  return {
    dir,
    source: { kind: 'snapshot', n: 1, ref: 'refs/factory/run-1/stage3-1', commit: COMMIT, tree: TREE },
    entries: 5,
    digest: SHA,
    madeAt: '2026-10-05T10:00:00.000Z',
    ...overrides
  };
}

/** A state with one open first-pass evaluation (e = 1) at cycle 0, round 0. */
function withOpenEvaluation(): FeatureState {
  return recordEvaluationStart(createFeatureState('f'), { cycle: 0, round: 0, kind: 'first-pass' });
}

function verdict(issueKeyValue: string, instance: 'A' | 'B', value: 'DISPROVED' | 'UPHELD', origin: SkepticVerdictRecord['origin'] = '07-validator'): SkepticVerdictRecord {
  return { issueKey: issueKeyValue, origin, instance, verdict: value, reason: `${instance} says ${value}`, document: `SKEPTIC_E1_${issueKeyValue}_${instance}.md`, recordedAt: '2026-10-05T10:02:00.000Z' };
}

const PASSED: ValidationVerdict = { passed: true, standing: [], disproved: [], recordedAt: '2026-10-05T10:03:00.000Z' };

// ---------------------------------------------------------------------------------------------
// verification.ts

describe('issueKey (D-10)', () => {
  it('D-10 issueKey is the first 12 hex digits of the sha256 of [origin, severity, file, line, message, suggestion]', () => {
    const subject = issue();
    const expected = createHash('sha256')
      .update(JSON.stringify(['07-validator', 'CRITICAL', 'src/a.ts', 3, 'Input is not validated', 'Validate it']))
      .digest('hex')
      .slice(0, 12);

    expect(issueKey('07-validator', subject)).toBe(expected);
    expect(issueKey('07-validator', { ...subject })).toBe(expected);
  });

  it('D-10 issueKey spells a missing file and line as null', () => {
    const subject = issue({ file: undefined, line: undefined });
    const expected = createHash('sha256')
      .update(JSON.stringify(['07-validator', 'CRITICAL', null, null, 'Input is not validated', 'Validate it']))
      .digest('hex')
      .slice(0, 12);

    expect(issueKey('07-validator', subject)).toBe(expected);
  });

  it.each<[string, Partial<ValidatorIssue>]>([
    ['the severity', { severity: 'IMPORTANT' }],
    ['the file', { file: 'src/b.ts' }],
    ['the line', { line: 4 }],
    ['the message', { message: 'Another message' }],
    ['the suggestion', { suggestion: 'Another suggestion' }]
  ])('D-10 issueKey changes with %s, and with the origin', (_, change) => {
    const base = issueKey('07-validator', issue());

    expect(issueKey('07-validator', issue(change))).not.toBe(base);
    expect(issueKey('07b-validator-followup', issue())).not.toBe(base);
    expect(issueKey('07-validator', issue({ canFix: false }))).toBe(base);
  });
});

describe('mergeIssues (D-10, AC-122)', () => {
  it('AC-122 mergeIssues puts the main issues first, then the follow-up\'s, each keyed by its own origin', () => {
    const main = [issue({ message: 'm1' }), issue({ severity: 'IMPORTANT', message: 'm2' })];
    const extra = [issue({ file: 'test/a.test.ts', message: 'f1' })];

    const merged = mergeIssues({ issues: main }, { issues: extra });

    expect(merged.map(m => [m.origin, m.issue.message])).toEqual([
      ['07-validator', 'm1'],
      ['07-validator', 'm2'],
      ['07b-validator-followup', 'f1']
    ]);
    expect(merged.map(m => m.key)).toEqual([
      issueKey('07-validator', main[0]),
      issueKey('07-validator', main[1]),
      issueKey('07b-validator-followup', extra[0])
    ]);
  });

  it('AC-122 mergeIssues maps the main Validator\'s copy paths (and the /var twin) to project paths, and keys the mapped issue', () => {
    const main = [
      issue({ file: `${COPY}/src/a.ts`, message: 'abs' }),
      issue({ file: `/var/folders/ab/T/factory-review-run-1-e1-XyZ123/src/b.ts`, message: 'twin' }),
      issue({ file: 'src/c.ts', message: 'relative' }),
      issue({ file: undefined, message: 'no file' })
    ];

    const merged = mergeIssues({ issues: main, copyDir: COPY });

    expect(merged.map(m => m.issue.file)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', undefined]);
    expect(merged[0].key).toBe(issueKey('07-validator', { ...main[0], file: 'src/a.ts' }));
    expect(merged[3].issue.file).toBeUndefined();
    // The input is never mutated.
    expect(main[0].file).toBe(`${COPY}/src/a.ts`);
  });

  it('D-10 mergeIssues leaves a path naming the copy root itself unmapped (it names no project file, so routing escalates it)', () => {
    const merged = mergeIssues({ issues: [issue({ file: COPY })], copyDir: COPY });

    expect(merged[0].issue.file).toBe(COPY);
  });

  it('D-10 mergeIssues maps nothing without a copy directory, and never maps the follow-up\'s paths', () => {
    const merged = mergeIssues({ issues: [issue({ file: `${COPY}/src/a.ts` })] }, { issues: [issue({ file: `${COPY}/src/b.ts` })] });

    expect(merged.map(m => m.issue.file)).toEqual([`${COPY}/src/a.ts`, `${COPY}/src/b.ts`]);
  });

  it('AC-122 mergeIssues drops an exact duplicate (same severity, normalised file, line and message), keeping the first (main)', () => {
    const main = [issue({ file: `${COPY}/src/a.ts`, suggestion: 'main suggestion' })];
    const extra = [
      issue({ file: './src/a.ts', suggestion: 'follow-up suggestion', canFix: false }),
      issue({ file: 'src/a.ts', line: 4 }),
      issue({ file: 'src/a.ts', severity: 'IMPORTANT' }),
      issue({ file: 'src/a.ts', message: 'Another' })
    ];

    const merged = mergeIssues({ issues: main, copyDir: COPY }, { issues: extra });

    expect(merged.map(m => [m.origin, m.issue.severity, m.issue.line, m.issue.message])).toEqual([
      ['07-validator', 'CRITICAL', 3, 'Input is not validated'],
      ['07b-validator-followup', 'CRITICAL', 4, 'Input is not validated'],
      ['07b-validator-followup', 'IMPORTANT', 3, 'Input is not validated'],
      ['07b-validator-followup', 'CRITICAL', 3, 'Another']
    ]);
    expect(merged[0].issue.suggestion).toBe('main suggestion');
  });

  it('D-10 mergeIssues drops a duplicate within one review too, and treats a missing file or line as its own value', () => {
    const merged = mergeIssues({
      issues: [
        issue(),
        issue(),
        issue({ file: undefined }),
        issue({ file: undefined }),
        issue({ line: undefined }),
        issue({ line: undefined })
      ]
    });

    expect(merged.map(m => [m.issue.file ?? null, m.issue.line ?? null])).toEqual([
      ['src/a.ts', 3],
      [null, 3],
      ['src/a.ts', null]
    ]);
  });

  it('D-10 mergeIssues with a cwd also drops a follow-up duplicate spelled as a project-absolute path', () => {
    const merged = mergeIssues({ issues: [issue()] }, { issues: [issue({ file: '/work/project/src/a.ts' })] }, '/work/project');

    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe('07-validator');
  });

  it('D-10 mergeIssues tolerates missing lists', () => {
    expect(mergeIssues({ issues: undefined as unknown as ValidatorIssue[] }, { issues: undefined as unknown as ValidatorIssue[] })).toEqual([]);
  });
});

describe('verdictOf and disprovedFinding (D-11, D-12, AC-129)', () => {
  const critical = issue();
  const merged: MergedIssue[] = mergeIssues({ issues: [critical, issue({ severity: 'IMPORTANT', message: 'minor-ish' })] });
  const key = merged[0].key;

  it.each<[string, SkepticVerdictRecord[], boolean]>([
    ['both DISPROVED', [verdict(key, 'A', 'DISPROVED'), verdict(key, 'B', 'DISPROVED')], true],
    ['A DISPROVED, B UPHELD', [verdict(key, 'A', 'DISPROVED'), verdict(key, 'B', 'UPHELD')], false],
    ['A UPHELD, B DISPROVED', [verdict(key, 'A', 'UPHELD'), verdict(key, 'B', 'DISPROVED')], false],
    ['both UPHELD', [verdict(key, 'A', 'UPHELD'), verdict(key, 'B', 'UPHELD')], false],
    ['only A recorded, DISPROVED', [verdict(key, 'A', 'DISPROVED')], false],
    ['no verdict recorded', [], false],
    ['both DISPROVED, but for another issue key', [verdict('000000000000', 'A', 'DISPROVED'), verdict('000000000000', 'B', 'DISPROVED')], false],
    ['both DISPROVED, but for the same key from the other origin', [verdict(key, 'A', 'DISPROVED', '07b-validator-followup'), verdict(key, 'B', 'DISPROVED', '07b-validator-followup')], false]
  ])('AC-129 a CRITICAL is disproved only when both skeptics return DISPROVED (%s)', (_, skeptics, disproved) => {
    const result = verdictOf(merged, skeptics);

    if (disproved) {
      expect(result.standing).toEqual([]);
      expect(result.disproved).toEqual([{ merged: merged[0], reasons: { A: 'A says DISPROVED', B: 'B says DISPROVED' } }]);
    } else {
      expect(result.standing).toEqual([merged[0]]);
      expect(result.disproved).toEqual([]);
    }
  });

  it('AC-129 IMPORTANT and MINOR issues are never standing, whatever the skeptics say', () => {
    const softer = mergeIssues({ issues: [issue({ severity: 'IMPORTANT' }), issue({ severity: 'MINOR' })] });

    expect(verdictOf(softer, [])).toEqual({ standing: [], disproved: [] });
  });

  it('AC-129 each CRITICAL is judged on its own verdicts, in merged order', () => {
    const two = mergeIssues({ issues: [issue({ message: 'one' })] }, { issues: [issue({ message: 'two' })] });
    const skeptics = [verdict(two[1].key, 'A', 'DISPROVED', '07b-validator-followup'), verdict(two[1].key, 'B', 'DISPROVED', '07b-validator-followup')];

    const result = verdictOf(two, skeptics);

    expect(result.standing).toEqual([two[0]]);
    expect(result.disproved.map(d => d.merged)).toEqual([two[1]]);
  });

  it('AC-130 disprovedFinding names the issue as describeIssue shows it and both reasons', () => {
    const [d] = verdictOf(merged, [verdict(key, 'A', 'DISPROVED'), verdict(key, 'B', 'DISPROVED')]).disproved;

    expect(disprovedFinding(d)).toBe(
      'CRITICAL disproved by both skeptics (kept as IMPORTANT): [src/a.ts:3] Input is not validated — Validate it | skeptic A: A says DISPROVED | skeptic B: B says DISPROVED'
    );
  });
});

describe('legacyVerdict (D-12, I-27)', () => {
  it('I-27 legacyVerdict is undefined with no Validator output (the gate then fails closed)', () => {
    expect(legacyVerdict(undefined)).toBeUndefined();
  });

  it('I-27 legacyVerdict passes a raw list with no CRITICAL, dated by the Validator\'s own timestamp', () => {
    const output = validator({ issues: [issue({ severity: 'IMPORTANT' }), issue({ severity: 'MINOR' })] });

    expect(legacyVerdict(output)).toEqual({ passed: true, standing: [], disproved: [], recordedAt: output.timestamp });
  });

  it('I-27 legacyVerdict fails on every raw CRITICAL, one standing key each, with no skeptics', () => {
    const one = issue({ message: 'one' });
    const two = issue({ message: 'two' });
    const output = validator({ status: 'FAIL', issues: [one, issue({ severity: 'IMPORTANT' }), two] });

    expect(legacyVerdict(output)).toEqual({
      passed: false,
      standing: [issueKey('07-validator', one), issueKey('07-validator', two)],
      disproved: [],
      recordedAt: output.timestamp
    });
  });

  it('I-27 legacyVerdict treats a missing issue list as no issues, as the Stage 4 context did', () => {
    const output = validator();
    delete (output.details as Partial<ValidatorOutput['details']>).issues;

    expect(legacyVerdict(output)?.passed).toBe(true);
  });
});

describe('currentReworkCycle (D-7)', () => {
  function rejected(checkpointId: 1 | 2 | 3): FeatureState {
    const state = createFeatureState('f');
    recordCheckpointRejection(state, {
      checkpointId,
      name: `CP${checkpointId}`,
      stage: checkpointId + 1,
      sha256: SHA,
      notes: '',
      artifactPaths: ['.factory/run-1/VALIDATION_REPORT.md'],
      reworkAgents: ['04-backend-builder'],
      source: 'approver'
    });
    return state;
  }

  it('D-7 currentReworkCycle is 0 with no rejection and while a rejection\'s rework has not started', () => {
    expect(currentReworkCycle(createFeatureState('f'))).toBe(0);
    expect(currentReworkCycle(rejected(3))).toBe(0);
  });

  it('D-7 currentReworkCycle is the cycle of an active CHECKPOINT 3 rework, and 0 for another checkpoint\'s', () => {
    const cp3 = recordReworkStart(rejected(3), 1, { supersededDir: '.factory/run-1/_superseded/1' });
    const cp2 = recordReworkStart(rejected(2), 1, { supersededDir: '.factory/run-1/_superseded/1' });

    expect(currentReworkCycle(cp3)).toBe(1);
    expect(currentReworkCycle(cp2)).toBe(0);
  });

  it('D-7 currentReworkCycle is 0 once CHECKPOINT 3 is approved after the rework started', () => {
    const state = recordReworkStart(rejected(3), 1, { supersededDir: '.factory/run-1/_superseded/1', startedAt: '2000-01-01T00:00:00.000Z' });
    recordCheckpointApproval(state, 4, 'CP3', undefined, undefined, { checkpointId: 3, sha256: SHA });

    expect(currentReworkCycle(state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// state-tracker.ts: evaluation records (D-7)

describe('evaluation records (D-7, AC-123, AC-133)', () => {
  it('D-7 recordEvaluationStart numbers evaluations run-wide from 1 and stamps the start; createFeatureState has none', () => {
    const state = createFeatureState('f');
    expect(state.validatorEvaluations).toBeUndefined();

    recordEvaluationStart(state, { cycle: 0, round: 0, kind: 'first-pass' });
    closeEvaluation(state, 1, { outcome: 'decided', verdict: PASSED });
    recordEvaluationStart(state, { cycle: 1, round: 0, kind: 'first-pass' });

    expect(state.validatorEvaluations?.map(ev => [ev.e, ev.cycle, ev.round, ev.kind])).toEqual([
      [1, 0, 0, 'first-pass'],
      [2, 1, 0, 'first-pass']
    ]);
    expect(Date.parse(state.validatorEvaluations![1].startedAt)).not.toBeNaN();
  });

  it('D-7 recordEvaluationStart refuses to open a second evaluation while one is open', () => {
    const state = withOpenEvaluation();

    expect(() => recordEvaluationStart(state, { cycle: 0, round: 1, kind: 'validator-round' })).toThrow(/open/);
    expect(state.validatorEvaluations).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ['a negative cycle', { cycle: -1, round: 0, kind: 'first-pass' }],
    ['a fractional round', { cycle: 0, round: 0.5, kind: 'first-pass' }],
    ['an unknown kind', { cycle: 0, round: 0, kind: 'second-pass' }]
  ])('D-7 recordEvaluationStart refuses %s', (_, at) => {
    const state = createFeatureState('f');

    expect(() => recordEvaluationStart(state, at as Parameters<typeof recordEvaluationStart>[1])).toThrow();
    expect(state.validatorEvaluations).toBeUndefined();
  });

  it('AC-123 openEvaluation finds only the open evaluation of the same (cycle, round)', () => {
    const state = withOpenEvaluation();

    expect(openEvaluation(state, 0, 0)?.e).toBe(1);
    expect(openEvaluation(state, 0, 1)).toBeUndefined();
    expect(openEvaluation(state, 1, 0)).toBeUndefined();
    closeEvaluation(state, 1, { outcome: 'decided', verdict: PASSED });
    expect(openEvaluation(state, 0, 0)).toBeUndefined();
  });

  it('AC-123 D-B2-2 recordReviewCopy stores the copy with its leaf count and digest, and may replace it only from the same source', () => {
    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy());

    recordReviewCopy(state, 1, snapshotCopy('/tmp/factory-review-run-1-e1-New', { madeAt: '2026-10-05T11:00:00.000Z' }));
    expect(state.validatorEvaluations![0].copy).toEqual(snapshotCopy('/tmp/factory-review-run-1-e1-New', { madeAt: '2026-10-05T11:00:00.000Z' }));

    expect(() =>
      recordReviewCopy(state, 1, snapshotCopy(COPY, { source: { kind: 'snapshot', n: 2, ref: 'refs/factory/run-1/stage3-2', commit: COMMIT, tree: TREE } }))
    ).toThrow(/source/);
    expect(() => recordReviewCopy(state, 1, snapshotCopy(COPY, { source: { kind: 'working-tree', reason: 'not a git work tree' } }))).toThrow(/source/);
    expect(state.validatorEvaluations![0].copy?.dir).toBe('/tmp/factory-review-run-1-e1-New');
  });

  it.each<[string, Partial<ReviewCopyRecord>]>([
    ['a relative directory', { dir: 'review/copy' }],
    ['a negative entry count', { entries: -1 }],
    ['a digest that is not 64 lowercase hex', { digest: 'abc' }],
    ['a snapshot source with a commit that is not an object id', { source: { kind: 'snapshot', n: 1, ref: 'refs/x', commit: 'HEAD', tree: TREE } }],
    ['a snapshot source with n 0', { source: { kind: 'snapshot', n: 0, ref: 'refs/x', commit: COMMIT, tree: TREE } }],
    ['a working-tree source with a blank reason', { source: { kind: 'working-tree', reason: ' ' } }],
    ['a blank madeAt', { madeAt: '' }]
  ])('D-7 recordReviewCopy refuses %s, never stored', (_, change) => {
    const state = withOpenEvaluation();

    expect(() => recordReviewCopy(state, 1, snapshotCopy(COPY, change))).toThrow();
    expect(state.validatorEvaluations![0].copy).toBeUndefined();
  });

  it('AC-133 the evaluation recorders refuse a second main output, follow-up, verdict for the same issue and skeptic, or closing', () => {
    const state = withOpenEvaluation();
    const main = validator();
    recordEvaluationValidator(state, 1, main, TIMING);
    recordFollowup(state, 1, { status: 'skipped', reason: 'the Test Verifier changed no file' });
    recordSkepticVerdict(state, 1, { issueKey: '0123456789ab', origin: '07-validator', instance: 'A', verdict: 'UPHELD', reason: 'real', document: 'SKEPTIC_E1_0123456789ab_A.md' });

    expect(() => recordEvaluationValidator(state, 1, validator({ status: 'FAIL' }), TIMING)).toThrow(/already/);
    expect(() => recordFollowup(state, 1, { status: 'reviewed', files: ['test/a.test.ts'], output: followup({ files: ['test/a.test.ts'] }), timing: TIMING })).toThrow(/already/);
    expect(() =>
      recordSkepticVerdict(state, 1, { issueKey: '0123456789ab', origin: '07-validator', instance: 'A', verdict: 'DISPROVED', reason: 'not real', document: 'SKEPTIC_E1_0123456789ab_A.md' })
    ).toThrow(/already/);

    // The other instance and another issue are their own slots.
    recordSkepticVerdict(state, 1, { issueKey: '0123456789ab', origin: '07-validator', instance: 'B', verdict: 'UPHELD', reason: 'real', document: 'SKEPTIC_E1_0123456789ab_B.md' });
    recordSkepticVerdict(state, 1, { issueKey: 'ba9876543210', origin: '07-validator', instance: 'A', verdict: 'DISPROVED', reason: 'no', document: 'SKEPTIC_E1_ba9876543210_A.md' });

    closeEvaluation(state, 1, { outcome: 'decided', verdict: PASSED });
    expect(() => closeEvaluation(state, 1, { outcome: 'escalated', at: '2026-10-05T12:00:00.000Z' })).toThrow(/already/);

    const ev = state.validatorEvaluations![0];
    expect(ev.validator).toEqual({ output: main, timing: TIMING });
    expect(ev.followup).toEqual({ status: 'skipped', reason: 'the Test Verifier changed no file' });
    expect(ev.skeptics?.map(s => [s.issueKey, s.instance, s.verdict])).toEqual([
      ['0123456789ab', 'A', 'UPHELD'],
      ['0123456789ab', 'B', 'UPHELD'],
      ['ba9876543210', 'A', 'DISPROVED']
    ]);
    expect(ev.closed).toEqual({ outcome: 'decided', verdict: PASSED });
  });

  it('AC-133 a closed evaluation takes no further record of any kind', () => {
    const state = withOpenEvaluation();
    closeEvaluation(state, 1, { outcome: 'escalated', at: '2026-10-05T12:00:00.000Z' });

    expect(() => recordReviewCopy(state, 1, snapshotCopy())).toThrow(/closed/);
    expect(() => recordEvaluationValidator(state, 1, validator(), TIMING)).toThrow(/closed/);
    expect(() => recordTestVerifierChanges(state, 1, { kind: 'none' })).toThrow(/closed/);
    expect(() => recordFollowup(state, 1, { status: 'skipped', reason: 'none' })).toThrow(/closed/);
    expect(() =>
      recordSkepticVerdict(state, 1, { issueKey: '0123456789ab', origin: '07-validator', instance: 'A', verdict: 'UPHELD', reason: 'r', document: 'd.md' })
    ).toThrow(/closed/);
    expect(Object.keys(state.validatorEvaluations![0]).sort()).toEqual(['closed', 'cycle', 'e', 'kind', 'round', 'startedAt']);
  });

  it('D-7 every evaluation recorder refuses an unknown evaluation number', () => {
    const state = withOpenEvaluation();

    expect(() => recordReviewCopy(state, 2, snapshotCopy())).toThrow(/evaluation 2/);
    expect(() => recordEvaluationValidator(state, 0, validator(), TIMING)).toThrow(/evaluation 0/);
    expect(() => recordTestVerifierChanges(state, 2, { kind: 'none' })).toThrow(/evaluation 2/);
    expect(() => recordFollowup(state, 2, { status: 'skipped', reason: 'none' })).toThrow(/evaluation 2/);
    expect(() => closeEvaluation(state, 2, { outcome: 'decided', verdict: PASSED })).toThrow(/evaluation 2/);
  });

  it.each<[string, () => void]>([
    ['a main output whose timing ends before it starts', () => recordEvaluationValidator(withOpenEvaluation(), 1, validator(), { startedAt: TIMING.completedAt, completedAt: TIMING.startedAt })],
    ['a main output from another agent', () => recordEvaluationValidator(withOpenEvaluation(), 1, { ...validator(), agent: '06-test-verifier' } as unknown as ValidatorOutput, TIMING)],
    ['a reviewed follow-up with no timing', () => recordFollowup(withOpenEvaluation(), 1, { status: 'reviewed', files: [], output: followup(), timing: undefined as unknown as typeof TIMING })],
    ['a reviewed follow-up whose files are not strings', () => recordFollowup(withOpenEvaluation(), 1, { status: 'reviewed', files: [1 as unknown as string], output: followup(), timing: TIMING })],
    ['a skipped follow-up with a blank reason', () => recordFollowup(withOpenEvaluation(), 1, { status: 'skipped', reason: '' })],
    ['a skeptic verdict with instance C', () => recordSkepticVerdict(withOpenEvaluation(), 1, { issueKey: 'k', origin: '07-validator', instance: 'C' as 'A', verdict: 'UPHELD', reason: 'r', document: 'd.md' })],
    ['a skeptic verdict that is neither DISPROVED nor UPHELD', () => recordSkepticVerdict(withOpenEvaluation(), 1, { issueKey: 'k', origin: '07-validator', instance: 'A', verdict: 'MAYBE' as 'UPHELD', reason: 'r', document: 'd.md' })],
    ['a skeptic verdict with a blank issue key', () => recordSkepticVerdict(withOpenEvaluation(), 1, { issueKey: ' ', origin: '07-validator', instance: 'A', verdict: 'UPHELD', reason: 'r', document: 'd.md' })],
    ['a skeptic verdict from an unknown origin', () => recordSkepticVerdict(withOpenEvaluation(), 1, { issueKey: 'k', origin: '06-test-verifier' as '07-validator', instance: 'A', verdict: 'UPHELD', reason: 'r', document: 'd.md' })],
    ['a skeptic verdict with a blank reason', () => recordSkepticVerdict(withOpenEvaluation(), 1, { issueKey: 'k', origin: '07-validator', instance: 'A', verdict: 'UPHELD', reason: '', document: 'd.md' })],
    ['a test verifier measurement of an unknown kind', () => recordTestVerifierChanges(withOpenEvaluation(), 1, { kind: 'some' } as unknown as { kind: 'none' })],
    ['a test verifier measurement whose files are not a list', () => recordTestVerifierChanges(withOpenEvaluation(), 1, { kind: 'tests', files: 'a.test.ts' as unknown as string[] })],
    ['a decided verdict that passes with a standing issue', () => closeEvaluation(withOpenEvaluation(), 1, { outcome: 'decided', verdict: { ...PASSED, standing: ['0123456789ab'] } })],
    ['a decided verdict that fails with nothing standing', () => closeEvaluation(withOpenEvaluation(), 1, { outcome: 'decided', verdict: { ...PASSED, passed: false } })],
    ['an escalated close with a blank time', () => closeEvaluation(withOpenEvaluation(), 1, { outcome: 'escalated', at: '' })],
    ['an unknown outcome', () => closeEvaluation(withOpenEvaluation(), 1, { outcome: 'abandoned' } as unknown as { outcome: 'escalated'; at: string })]
  ])('D-7 a malformed record is refused, never stored (%s)', (_, act) => {
    expect(act).toThrow();
  });

  it('D-2 D-17 recordTestVerifierChanges keeps only the latest measurement (a resume measures again)', () => {
    const state = withOpenEvaluation();

    recordTestVerifierChanges(state, 1, { kind: 'outside-tests', files: ['src/a.ts', 'test/a.test.ts'], outside: ['src/a.ts'] });
    recordTestVerifierChanges(state, 1, { kind: 'tests', files: ['test/a.test.ts'] });

    expect(state.validatorEvaluations![0].testVerifierChanges).toEqual({ kind: 'tests', files: ['test/a.test.ts'] });
  });

  it('D-7 I-6 closeOpenEvaluations closes every open evaluation as escalated and leaves a closed one as it was', () => {
    const state = withOpenEvaluation();
    closeEvaluation(state, 1, { outcome: 'decided', verdict: PASSED });
    recordEvaluationStart(state, { cycle: 0, round: 1, kind: 'validator-round' });

    closeOpenEvaluations(state, '2026-10-05T12:00:00.000Z');

    expect(state.validatorEvaluations!.map(ev => ev.closed)).toEqual([
      { outcome: 'decided', verdict: PASSED },
      { outcome: 'escalated', at: '2026-10-05T12:00:00.000Z' }
    ]);
    expect(closeOpenEvaluations(createFeatureState('f'), '2026-10-05T12:00:00.000Z').validatorEvaluations).toBeUndefined();
    expect(() => closeOpenEvaluations(state, ' ')).toThrow();
  });

  it('D-12 currentValidationVerdict is the cycle\'s latest decided verdict; open and escalated evaluations have none', () => {
    const failed: ValidationVerdict = { passed: false, standing: ['0123456789ab'], disproved: [], recordedAt: '2026-10-05T10:00:00.000Z' };
    const state = withOpenEvaluation();
    expect(currentValidationVerdict(state, 0)).toBeUndefined();

    closeEvaluation(state, 1, { outcome: 'decided', verdict: failed });
    recordEvaluationStart(state, { cycle: 0, round: 1, kind: 'validator-round' });
    expect(currentValidationVerdict(state, 0)).toEqual(failed);

    closeEvaluation(state, 2, { outcome: 'decided', verdict: PASSED });
    recordEvaluationStart(state, { cycle: 1, round: 0, kind: 'first-pass' });
    closeEvaluation(state, 3, { outcome: 'escalated', at: '2026-10-05T12:00:00.000Z' });

    expect(currentValidationVerdict(state, 0)).toEqual(PASSED);
    expect(currentValidationVerdict(state, 1)).toBeUndefined();
    expect(currentValidationVerdict(createFeatureState('f'), 0)).toBeUndefined();
  });

  it('D-7 an evaluation record survives serialisation unchanged', () => {
    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy());
    recordEvaluationValidator(state, 1, validator(), TIMING);
    recordTestVerifierChanges(state, 1, { kind: 'none' });
    recordSkepticVerdict(state, 1, { issueKey: '0123456789ab', origin: '07-validator', instance: 'A', verdict: 'UPHELD', reason: 'r', document: 'd.md' });

    expect(deserializeState(serializeState(state)).validatorEvaluations).toEqual(state.validatorEvaluations);
  });
});

describe('escalation reason and invocation fields (I-16, I-18)', () => {
  it('I-18 REVIEW_COPY_FAILED is a CRITICAL escalation', () => {
    const state = recordEscalation(createFeatureState('f'), 4, 'harness', 'REVIEW_COPY_FAILED', 'the copy could not be made');

    expect(state.escalations[0]).toMatchObject({ reason: 'REVIEW_COPY_FAILED', severity: 'CRITICAL' });
  });

  it('I-16 D-8 an invocation record keeps its evaluation, skeptic instance, and a throw\'s outcome and error', () => {
    const record: AgentInvocationRecord = {
      stage: 4,
      agent: '07c-validator-skeptic',
      startedAt: TIMING.startedAt,
      completedAt: TIMING.completedAt,
      durationMs: 60_000,
      evaluation: 1,
      instance: 'B',
      outcome: 'threw',
      error: 'SDK error: overloaded'
    };

    const state = recordAgentInvocation(createFeatureState('f'), record);

    expect(state.agentInvocations).toEqual([record]);
  });
});

// ---------------------------------------------------------------------------------------------
// verification.ts, build step 7: findings, the follow-up check, the resumed round, CP3

describe('the merged findings and the follow-up check (D-9, D-10, AC-122, I-29)', () => {
  it('MINOR-9 reviewFindingMessage is `[file:line] message`, `[file] message` without a line, and the message alone without a file', () => {
    expect(reviewFindingMessage(issue({ severity: 'IMPORTANT' }))).toBe('[src/a.ts:3] Input is not validated');
    expect(reviewFindingMessage(issue({ line: undefined }))).toBe('[src/a.ts] Input is not validated');
    expect(reviewFindingMessage(issue({ file: undefined, line: undefined }))).toBe('Input is not validated');
  });

  it('AC-122 importantFindings lists the merged IMPORTANT issues by origin, and never a CRITICAL or MINOR one', () => {
    const merged = mergeIssues(
      { issues: [issue({ severity: 'IMPORTANT', message: 'm1' }), issue({ message: 'c1' }), issue({ severity: 'MINOR', message: 'n1' })] },
      { issues: [issue({ severity: 'IMPORTANT', file: 'test/a.test.ts', message: 'f1' })] }
    );

    expect(importantFindings(merged)).toEqual({ '07-validator': ['[src/a.ts:3] m1'], '07b-validator-followup': ['[test/a.test.ts:3] f1'] });
    expect(importantFindings(mergeIssues({ issues: [issue()] }))).toEqual({ '07-validator': [], '07b-validator-followup': [] });
  });

  it('AC-122 an IMPORTANT issue both reviews report is one finding, under the main review', () => {
    const shared = issue({ severity: 'IMPORTANT', message: 'shared' });

    expect(importantFindings(mergeIssues({ issues: [shared] }, { issues: [{ ...shared }] }, '/p'))).toEqual({
      '07-validator': ['[src/a.ts:3] shared'],
      '07b-validator-followup': []
    });
  });

  it.each<[string, string[], unknown, string | undefined]>([
    ['the same files in another order', ['test/a.test.ts', 'test/b.test.ts'], ['test/b.test.ts', './test/a.test.ts'], undefined],
    ['a missing file', ['test/a.test.ts', 'test/b.test.ts'], ['test/a.test.ts'], '07b-validator-followup reviewed test/a.test.ts but was given test/a.test.ts, test/b.test.ts'],
    ['an extra file', ['test/a.test.ts'], ['test/a.test.ts', 'src/a.ts'], '07b-validator-followup reviewed test/a.test.ts, src/a.ts but was given test/a.test.ts'],
    ['nothing reviewed', ['test/a.test.ts'], [], '07b-validator-followup reviewed nothing but was given test/a.test.ts'],
    ['a list that is not one', ['test/a.test.ts'], 'test/a.test.ts', '07b-validator-followup reviewed nothing but was given test/a.test.ts']
  ])('I-29 followupMismatch with %s', (_label, given, reviewed, expected) => {
    expect(followupMismatch(given, reviewed, '/p')).toBe(expected);
  });
});

describe('standingIssues: the routing of a resumed validator round (D-12, AC-122)', () => {
  /** An evaluation decided not passed, with its main output (paths in `copyDir`) and an optional follow-up. */
  function decidedEvaluation(main: ValidatorIssue[], followupIssues?: ValidatorIssue[], copyDir = COPY) {
    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy(copyDir));
    recordEvaluationValidator(state, 1, validator({ status: 'FAIL', issues: main }), TIMING);
    if (followupIssues) recordFollowup(state, 1, { status: 'reviewed', files: ['test/a.test.ts'], output: followup({ files: ['test/a.test.ts'], issues: followupIssues }), timing: TIMING });
    const merged = mergeIssues({ issues: main, copyDir }, followupIssues ? { issues: followupIssues } : undefined, '/p');
    return { state, merged };
  }

  it('AC-122 the standing issues are the merged issues whose keys the verdict kept, with paths mapped out of the copy', () => {
    const main = [issue({ file: `${COPY}/src/a.ts`, message: 'kept' }), issue({ file: 'src/b.ts', message: 'disproved' })];
    const { state, merged } = decidedEvaluation(main, [issue({ file: 'test/a.test.ts', message: 'follow-up kept' })]);
    closeEvaluation(state, 1, {
      outcome: 'decided',
      verdict: { passed: false, standing: [merged[0].key, merged[2].key], disproved: [merged[1].key], recordedAt: TIMING.completedAt }
    });

    expect(standingIssues(state.validatorEvaluations![0], '/p')).toEqual([
      { ...main[0], file: 'src/a.ts' },
      { ...issue({ file: 'test/a.test.ts', message: 'follow-up kept' }) }
    ]);
  });

  it('D-12 an evaluation that is open, escalated, passed or has no main output has no standing issues to route', () => {
    const { state, merged } = decidedEvaluation([issue()]);
    expect(standingIssues(state.validatorEvaluations![0], '/p')).toBeUndefined();

    closeEvaluation(state, 1, { outcome: 'escalated', at: TIMING.completedAt });
    expect(standingIssues(state.validatorEvaluations![0], '/p')).toBeUndefined();

    const passed = withOpenEvaluation();
    recordEvaluationValidator(passed, 1, validator(), TIMING);
    closeEvaluation(passed, 1, { outcome: 'decided', verdict: PASSED });
    expect(standingIssues(passed.validatorEvaluations![0], '/p')).toBeUndefined();

    const bare = withOpenEvaluation();
    closeEvaluation(bare, 1, { outcome: 'decided', verdict: { passed: false, standing: [merged[0].key], disproved: [], recordedAt: TIMING.completedAt } });
    expect(standingIssues(bare.validatorEvaluations![0], '/p')).toBeUndefined();
  });
});

describe('followupPresented: whether CHECKPOINT 3 shows VALIDATION_FOLLOWUP.md (D-16, I-15)', () => {
  const reviewed = (state: FeatureState, e: number) =>
    recordFollowup(state, e, { status: 'reviewed', files: ['test/a.test.ts'], output: followup({ files: ['test/a.test.ts'] }), timing: TIMING });

  it('D-16 only when the latest first-pass evaluation reviewed files', () => {
    expect(followupPresented(createFeatureState('f'))).toBe(false);

    const state = withOpenEvaluation();
    expect(followupPresented(state)).toBe(false);
    reviewed(state, 1);
    expect(followupPresented(state)).toBe(true);

    // A validator round after it changes nothing: it never runs the follow-up.
    closeEvaluation(state, 1, { outcome: 'decided', verdict: { passed: false, standing: ['k'], disproved: [], recordedAt: TIMING.completedAt } });
    recordEvaluationStart(state, { cycle: 0, round: 1, kind: 'validator-round' });
    expect(followupPresented(state)).toBe(true);

    // A later first pass (a CP3 rework) that skipped the follow-up: its document was superseded.
    closeEvaluation(state, 2, { outcome: 'decided', verdict: PASSED });
    recordEvaluationStart(state, { cycle: 1, round: 1, kind: 'first-pass' });
    recordFollowup(state, 3, { status: 'skipped', reason: 'the Test Verifier changed no file' });
    expect(followupPresented(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// CHECKPOINT 3 fix round: the pure rules moved out of the orchestrator (MINOR-4), the measurement
// baseline (IMPORTANT-1, IMPORTANT-2), replaced copies (MINOR-2), escalated findings (MINOR-5)

const TREE_B = 'b'.repeat(40);

/** A state whose evaluations are given as (kind, cycle, closed?) in order, each with `extra` fields. */
function withEvaluations(...specs: Array<{ kind?: ValidatorEvaluation['kind']; cycle?: number; round?: number; closed?: ValidatorEvaluation['closed']; extra?: Partial<ValidatorEvaluation> }>): FeatureState {
  const state = createFeatureState('f');
  for (const spec of specs) {
    recordEvaluationStart(state, { cycle: spec.cycle ?? 0, round: spec.round ?? 0, kind: spec.kind ?? 'first-pass' });
    const evaluation = state.validatorEvaluations![state.validatorEvaluations!.length - 1];
    Object.assign(evaluation, spec.extra ?? {});
    if (spec.closed) evaluation.closed = spec.closed;
  }
  return state;
}

const ESCALATED: ValidatorEvaluation['closed'] = { outcome: 'escalated', at: '2026-10-06T10:00:00.000Z' };
const DECIDED: ValidatorEvaluation['closed'] = { outcome: 'decided', verdict: PASSED };
const TREE_BASELINE = { kind: 'tree' as const, tree: TREE, recordedAt: '2026-10-06T10:00:00.000Z' };

describe('evaluationKind (D-7, D-13, MINOR-4)', () => {
  it('MINOR-4 an open evaluation of (cycle, round) keeps its kind, whatever else holds', () => {
    const state = withEvaluations({ kind: 'validator-round', round: 1 });
    expect(evaluationKind(state, 0, 1, false, false)).toBe('validator-round');
  });

  it('MINOR-4 with no Test Verifier PASS it is a first pass, also after a round fix', () => {
    expect(evaluationKind(createFeatureState('f'), 0, 0, false, false)).toBe('first-pass');
    expect(evaluationKind(createFeatureState('f'), 0, 1, true, false)).toBe('first-pass');
  });

  it('MINOR-4 with a Test Verifier PASS it is a validator round after a round fix, or once the cycle\'s first pass was decided; else a first pass', () => {
    expect(evaluationKind(createFeatureState('f'), 0, 1, true, true)).toBe('validator-round');
    expect(evaluationKind(withEvaluations({ closed: DECIDED }), 0, 1, false, true)).toBe('validator-round');
    expect(evaluationKind(withEvaluations({ closed: ESCALATED }), 0, 0, false, true)).toBe('first-pass');
    // A first pass decided in another cycle does not count.
    expect(evaluationKind(withEvaluations({ closed: DECIDED }), 1, 0, false, true)).toBe('first-pass');
  });
});

describe('stage4Verdict (D-12, I-27, MINOR-4)', () => {
  it('MINOR-4 the cycle\'s latest decided verdict; none when the cycle has evaluations but none decided; the legacy verdict only for a cycle with none', () => {
    const decided = withEvaluations({ closed: DECIDED });
    expect(stage4Verdict(decided, 0, validator({ issues: [issue()] }))).toEqual(PASSED);

    const undecided = withEvaluations({ closed: ESCALATED });
    expect(stage4Verdict(undecided, 0, validator())).toBeUndefined();

    const legacy = stage4Verdict(createFeatureState('f'), 0, validator({ issues: [issue()] }));
    expect(legacy).toMatchObject({ passed: false, standing: [issueKey('07-validator', issue())] });
    expect(stage4Verdict(createFeatureState('f'), 0, undefined)).toBeUndefined();
    // Another cycle's evaluations do not count for this one.
    expect(stage4Verdict(decided, 1, validator())).toMatchObject({ passed: true, disproved: [] });
  });
});

describe('classifyTestVerifierChanges (D-2, N-3, MINOR-4)', () => {
  it.each<[string, string[], TestVerifierChangesShape]>([
    ['nothing', [], { kind: 'none' }],
    ['test files only', ['test/a.test.ts', 'src/b.spec.ts'], { kind: 'tests', files: ['test/a.test.ts', 'src/b.spec.ts'] }],
    ['a file outside a test path', ['test/a.test.ts', 'src/a.ts'], { kind: 'outside-tests', files: ['test/a.test.ts', 'src/a.ts'], outside: ['src/a.ts'] }]
  ])('MINOR-4 %s', (_label, files, expected) => {
    const input = [...files];
    expect(classifyTestVerifierChanges(input)).toEqual(expected);
    expect(input).toEqual(files);
  });
});

type TestVerifierChangesShape = ReturnType<typeof classifyTestVerifierChanges>;

describe('earlierBaseline and testVerifierFiles (IMPORTANT-1, IMPORTANT-2)', () => {
  it('IMPORTANT-2 the latest earlier first pass of the cycle with a baseline is passed on unless it was cleared', () => {
    const other = { kind: 'tree' as const, tree: TREE_B, recordedAt: '2026-10-06T10:00:00.000Z' };
    const unmeasured = withEvaluations({ closed: ESCALATED, extra: { baseline: TREE_BASELINE } }, {});
    expect(earlierBaseline(unmeasured.validatorEvaluations!, 0, 2)).toEqual({ baseline: TREE_BASELINE, cleared: false });

    const outside = withEvaluations({ closed: ESCALATED, extra: { baseline: TREE_BASELINE, testVerifierChanges: { kind: 'outside-tests', files: ['src/a.ts'], outside: ['src/a.ts'] } } }, {});
    expect(earlierBaseline(outside.validatorEvaluations!, 0, 2)).toEqual({ baseline: TREE_BASELINE, cleared: false });

    const cleared = withEvaluations(
      { closed: ESCALATED, extra: { baseline: other, testVerifierChanges: { kind: 'none' } } },
      { closed: ESCALATED, extra: { baseline: TREE_BASELINE, testVerifierChanges: { kind: 'tests', files: ['test/a.test.ts'] } } },
      { closed: ESCALATED },
      {}
    );
    expect(earlierBaseline(cleared.validatorEvaluations!, 0, 4)).toEqual({ baseline: TREE_BASELINE, cleared: true });
    expect(earlierBaseline(cleared.validatorEvaluations!, 0, 2)).toEqual({ baseline: other, cleared: true });
  });

  it('IMPORTANT-1 there is none before the first baseline, in another cycle, or for a validator round', () => {
    const state = withEvaluations(
      { cycle: 0, closed: ESCALATED, extra: { baseline: TREE_BASELINE } },
      { kind: 'validator-round', round: 1, closed: ESCALATED, extra: { baseline: TREE_BASELINE } },
      { cycle: 1 }
    );
    expect(earlierBaseline(state.validatorEvaluations!, 0, 1)).toBeUndefined();
    expect(earlierBaseline(state.validatorEvaluations!, 1, 3)).toBeUndefined();
    expect(earlierBaseline(state.validatorEvaluations!, 0, 3)).toEqual({ baseline: TREE_BASELINE, cleared: false });
  });

  it('IMPORTANT-1 testVerifierFiles is every test file the cycle\'s first passes measured up to e, in order, each once, never one outside a test path', () => {
    const state = withEvaluations(
      { closed: ESCALATED, extra: { testVerifierChanges: { kind: 'outside-tests', files: ['test/b.test.ts', 'src/a.ts'], outside: ['src/a.ts'] } } },
      { closed: ESCALATED, extra: { testVerifierChanges: { kind: 'tests', files: ['test/a.test.ts', 'test/b.test.ts'] } } },
      { closed: ESCALATED, extra: { testVerifierChanges: { kind: 'none' } } },
      { kind: 'validator-round', round: 1, closed: ESCALATED, extra: { testVerifierChanges: { kind: 'tests', files: ['test/round.test.ts'] } } },
      { cycle: 1, extra: { testVerifierChanges: { kind: 'tests', files: ['test/other-cycle.test.ts'] } } }
    );
    const all = state.validatorEvaluations!;
    expect(testVerifierFiles(all, 0, 3)).toEqual(['test/b.test.ts', 'test/a.test.ts']);
    expect(testVerifierFiles(all, 0, 1)).toEqual(['test/b.test.ts']);
    expect(testVerifierFiles(all, 1, 5)).toEqual(['test/other-cycle.test.ts']);
    expect(testVerifierFiles([], 0, 1)).toEqual([]);
  });
});

describe('recordMeasurementBaseline (IMPORTANT-1)', () => {
  it('IMPORTANT-1 records a tree or a copy baseline once, on an open first pass only', () => {
    const state = withOpenEvaluation();
    recordMeasurementBaseline(state, 1, TREE_BASELINE);
    expect(state.validatorEvaluations![0].baseline).toEqual(TREE_BASELINE);
    expect(() => recordMeasurementBaseline(state, 1, { ...TREE_BASELINE, tree: TREE_B })).toThrow(/never overwritten/);

    const copy = withOpenEvaluation();
    const baseline = { kind: 'copy' as const, dir: COPY, entries: 5, digest: SHA, recordedAt: '2026-10-06T10:00:00.000Z' };
    recordMeasurementBaseline(copy, 1, baseline);
    expect(copy.validatorEvaluations![0].baseline).toEqual(baseline);

    const round = recordEvaluationStart(createFeatureState('f'), { cycle: 0, round: 1, kind: 'validator-round' });
    expect(() => recordMeasurementBaseline(round, 1, TREE_BASELINE)).toThrow(/only a first pass/);
    const closed = withOpenEvaluation();
    closeEvaluation(closed, 1, ESCALATED!);
    expect(() => recordMeasurementBaseline(closed, 1, TREE_BASELINE)).toThrow(/closed/);
  });

  it.each<[string, unknown]>([
    ['a tree that is not an object id', { kind: 'tree', tree: 'HEAD', recordedAt: 't' }],
    ['a relative copy directory', { kind: 'copy', dir: 'copy', entries: 1, digest: SHA, recordedAt: 't' }],
    ['a copy digest that is not 64 hex', { kind: 'copy', dir: COPY, entries: 1, digest: 'abc', recordedAt: 't' }],
    ['a negative copy count', { kind: 'copy', dir: COPY, entries: -1, digest: SHA, recordedAt: 't' }],
    ['a blank time', { kind: 'tree', tree: TREE, recordedAt: '' }],
    ['an unknown kind', { kind: 'files', recordedAt: 't' }]
  ])('IMPORTANT-1 recordMeasurementBaseline refuses %s, never stored', (_label, baseline) => {
    const state = withOpenEvaluation();
    expect(() => recordMeasurementBaseline(state, 1, baseline as Parameters<typeof recordMeasurementBaseline>[2])).toThrow();
    expect(state.validatorEvaluations![0].baseline).toBeUndefined();
  });
});

describe('replaced copies (MINOR-2)', () => {
  it('MINOR-2 recordReviewCopy keeps the directories of the copies it replaced, and reviewCopyDirs lists the current one first', () => {
    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy(COPY));
    expect(state.validatorEvaluations![0].previousCopyDirs).toBeUndefined();
    expect(reviewCopyDirs(state.validatorEvaluations![0])).toEqual([COPY]);

    recordReviewCopy(state, 1, snapshotCopy('/tmp/factory-review-run-1-e1-Two'));
    recordReviewCopy(state, 1, snapshotCopy('/tmp/factory-review-run-1-e1-Three'));
    expect(state.validatorEvaluations![0].previousCopyDirs).toEqual([COPY, '/tmp/factory-review-run-1-e1-Two']);
    expect(reviewCopyDirs(state.validatorEvaluations![0])).toEqual(['/tmp/factory-review-run-1-e1-Three', COPY, '/tmp/factory-review-run-1-e1-Two']);
    expect(reviewCopyDirs(withOpenEvaluation().validatorEvaluations![0])).toEqual([]);
  });

  it('MINOR-2 mergeIssues maps a path in a replaced copy like one in the current copy, and standingIssues does too', () => {
    const old = '/tmp/factory-review-run-1-e1-Old';
    const merged = mergeIssues({ issues: [issue({ file: `${old}/src/a.ts` }), issue({ file: `${COPY}/src/b.ts` })], copyDir: COPY, previousCopyDirs: [old] }, undefined, '/p');
    expect(merged.map(entry => entry.issue.file)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(mergeIssues({ issues: [issue({ file: `${old}/src/a.ts` })], copyDir: COPY }, undefined, '/p')[0].issue.file).toBe(`${old}/src/a.ts`);

    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy(old));
    recordReviewCopy(state, 1, snapshotCopy(COPY));
    recordEvaluationValidator(state, 1, validator({ status: 'FAIL', issues: [issue({ file: `${old}/src/a.ts` })] }), TIMING);
    const key = issueKey('07-validator', issue({ file: 'src/a.ts' }));
    closeEvaluation(state, 1, { outcome: 'decided', verdict: { passed: false, standing: [key], disproved: [], recordedAt: TIMING.completedAt } });
    expect(standingIssues(state.validatorEvaluations![0], '/p')).toEqual([issue({ file: 'src/a.ts' })]);
  });
});

describe('escalatedReviewFindings (MINOR-5)', () => {
  it('MINOR-5 the IMPORTANT issues of every open evaluation with a recorded Validator output, mapped out of its copies; none from a closed one', () => {
    const state = withOpenEvaluation();
    recordReviewCopy(state, 1, snapshotCopy(COPY));
    recordEvaluationValidator(
      state,
      1,
      validator({ issues: [issue({ severity: 'IMPORTANT', file: `${COPY}/src/a.ts`, message: 'kept' }), issue({ message: 'a critical' }), issue({ severity: 'MINOR', message: 'minor' })] }),
      TIMING
    );
    expect(escalatedReviewFindings(state.validatorEvaluations!, '/p')).toEqual(['[src/a.ts:3] kept']);

    expect(escalatedReviewFindings(withOpenEvaluation().validatorEvaluations!, '/p')).toEqual([]);
    closeEvaluation(state, 1, ESCALATED!);
    expect(escalatedReviewFindings(state.validatorEvaluations!, '/p')).toEqual([]);
  });
});

describe('MINOR-3 the import graph', () => {
  it('MINOR-3 verification.ts imports nothing from run-progress.ts, which holds currentReworkCycle', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'harness', 'verification.ts'), 'utf8');
    expect(source).not.toMatch(/from '\.\/run-progress'/);
    expect(typeof currentReworkCycle).toBe('function');
  });

  it('MINOR-3 the harness modules import each other (values, not types) without a cycle', () => {
    const dir = join(__dirname, '..', '..', 'harness');
    const modules = readdirSync(dir).filter(name => name.endsWith('.ts'));
    const imports = new Map<string, string[]>();
    for (const name of modules) {
      const source = readFileSync(join(dir, name), 'utf8');
      const targets = [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'\.\/([^']+)'/gms)].map(match => `${match[1]}.ts`);
      imports.set(name, targets.filter(target => modules.includes(target)));
    }
    const cycles: string[] = [];
    const visiting: string[] = [];
    const done = new Set<string>();
    const visit = (name: string): void => {
      if (done.has(name)) return;
      const at = visiting.indexOf(name);
      if (at >= 0) {
        cycles.push([...visiting.slice(at), name].join(' -> '));
        return;
      }
      visiting.push(name);
      for (const target of imports.get(name) ?? []) visit(target);
      visiting.pop();
      done.add(name);
    };
    for (const name of modules) visit(name);
    expect(cycles).toEqual([]);
  });
});
