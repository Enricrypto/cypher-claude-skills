/**
 * Stage 4 verification logic (PR B-2, D-10 to D-12). PURE: no filesystem, no git, no state writes.
 * The orchestrator runs the agents and records; this module says what their outputs mean.
 *
 * - issueKey: the stable key of one issue, bound to its content and to the review that reported it.
 * - mergeIssues: the main Validator's issues (paths mapped out of its review copy), then the
 *   follow-up's, with exact duplicates dropped (the first, main, wins). Routing, the Stage 4 gate
 *   and CHECKPOINT 3 all use this one list (AC-122).
 * - verdictOf: which merged CRITICAL issues stand, and which both skeptics disproved (AC-129).
 * - disprovedFinding: the IMPORTANT finding a disproved CRITICAL becomes (AC-130).
 * - legacyVerdict: the Stage 4 verdict for a run whose Validator PASS was recorded before B-2,
 *   from its raw issue list with no skeptics (I-27). Also the interim Stage 4 input until the
 *   orchestrator records evaluations (build steps 4 to 7).
 * - evaluationKind: what the next evaluation of a validator loop is (D-7, D-13).
 * - stage4Verdict: the verdict the Stage 4 gate judges (D-12, I-27).
 * - classifyTestVerifierChanges / earlierBaseline / testVerifierFiles: the Test Verifier's
 *   measurement (D-2, N-3, IMPORTANT-1): its classification, the baseline an evaluation inherits,
 *   and the test files the follow-up reviews.
 * - escalatedReviewFindings: the IMPORTANT issues of a reviewed evaluation that escalates (MINOR-5).
 * - reviewFindingMessage / importantFindings: the merged IMPORTANT issues as findings, grouped by
 *   the review that reported them, so an issue both reviews report is recorded once (AC-122).
 * - followupMismatch: the I-29 finding when the follow-up reviewed other files than it was given.
 * - standingIssues: the standing issues a decided evaluation routed, for a resumed round (D-12).
 * - followupPresented: whether CHECKPOINT 3 shows VALIDATION_FOLLOWUP.md (D-16).
 */

import { createHash } from 'crypto';

import type { ValidatorIssue, ValidatorOutput } from './agent-output-schema';
import { mapReviewPath } from './review-copy';
import { normalisePath } from './stage-context';
import { currentValidationVerdict, openEvaluation } from './state-tracker';
import type {
  FeatureState,
  IssueOrigin,
  MeasurementBaseline,
  SkepticVerdictRecord,
  TestVerifierChanges,
  ValidationVerdict,
  ValidatorEvaluation
} from './state-tracker';
import { splitByTestPath } from './test-paths';
import { criticalIssues, describeIssue } from './validator-routing';

export type { ValidationVerdict } from './state-tracker';

/** One issue of the merged list: its key, the review that reported it, and the issue (paths mapped). */
export interface MergedIssue {
  key: string;
  origin: IssueOrigin;
  issue: ValidatorIssue;
}

/** A merged CRITICAL both skeptics disproved, with each one's reason. */
export interface DisprovedIssue {
  merged: MergedIssue;
  reasons: { A: string; B: string };
}

/** How many hex digits of the sha256 an issue key keeps. */
const ISSUE_KEY_LENGTH = 12;

/**
 * The key of `issue` as reported by `origin` (D-10): the first 12 hex digits of the sha256 of
 * `JSON.stringify([origin, severity, file ?? null, line ?? null, message, suggestion])`. Stable
 * across runs and resumes, and bound to the issue's content, so a skeptic must echo it (C-4).
 */
export function issueKey(origin: IssueOrigin, issue: ValidatorIssue): string {
  const content = [origin, issue.severity, issue.file ?? null, issue.line ?? null, issue.message, issue.suggestion];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, ISSUE_KEY_LENGTH);
}

/** What makes two issues exact duplicates (D-10): severity, normalised file, line and message. */
function duplicateKey(issue: ValidatorIssue, cwd: string | undefined): string {
  const file = typeof issue.file === 'string' ? normalisePath(issue.file, cwd) : null;
  return JSON.stringify([issue.severity, file, issue.line ?? null, issue.message]);
}

/**
 * `issue` with its file mapped out of the review copy, or out of a copy it replaced (MINOR-2); a
 * path naming a copy root itself stays as it was.
 */
function mappedOutOfCopy(issue: ValidatorIssue, copyDirs: readonly string[]): ValidatorIssue {
  if (typeof issue.file !== 'string') return { ...issue };
  for (const copyDir of copyDirs) {
    const mapped = mapReviewPath(issue.file, copyDir);
    if (mapped !== issue.file) return { ...issue, file: mapped === '' ? issue.file : mapped };
  }
  return { ...issue };
}

/**
 * The merged issue list (D-10, AC-122): the main Validator's issues first, each `file` mapped out
 * of `copyDir` with mapReviewPath (an absolute path in the copy, or its /var twin, becomes
 * project-relative; a path naming the copy root itself is left as it was, so routing finds no owner
 * and escalates); then the follow-up's, unmapped (it reviewed the live project). An exact duplicate
 * (same severity, file after normalisePath against `cwd` when given, line and message) is dropped,
 * whichever review it is in: the first one, the main Validator's, wins. Keys are computed on the
 * mapped issue. The inputs are never mutated; a missing list is no issues. `previousCopyDirs` are
 * the copies `copyDir` replaced (MINOR-2): a Validator output recorded before a re-extraction
 * names paths in one of them, and they map the same way.
 */
export function mergeIssues(
  main: { issues: ValidatorIssue[]; copyDir?: string; previousCopyDirs?: readonly string[] },
  followup?: { issues: ValidatorIssue[] },
  cwd?: string
): MergedIssue[] {
  const listOf = (issues: ValidatorIssue[] | undefined) => (Array.isArray(issues) ? issues : []);
  const copyDirs = [...(main.copyDir !== undefined ? [main.copyDir] : []), ...(main.previousCopyDirs ?? [])];
  const candidates: MergedIssue[] = [
    ...listOf(main.issues).map(issue => ({ origin: '07-validator' as const, issue: mappedOutOfCopy(issue, copyDirs) })),
    ...listOf(followup?.issues).map(issue => ({ origin: '07b-validator-followup' as const, issue: { ...issue } }))
  ].map(({ origin, issue }) => ({ key: issueKey(origin, issue), origin, issue }));

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const duplicate = duplicateKey(candidate.issue, cwd);
    if (seen.has(duplicate)) return false;
    seen.add(duplicate);
    return true;
  });
}

/**
 * Which merged CRITICAL issues stand (D-11, D-12, AC-129). A CRITICAL is disproved only when BOTH
 * skeptic A and skeptic B returned DISPROVED for its key and origin; a split verdict, a missing
 * verdict, or a verdict for another issue leaves it standing. IMPORTANT and MINOR issues are never
 * judged and never stand. Both lists keep the merged order.
 */
export function verdictOf(
  merged: MergedIssue[],
  skeptics: readonly SkepticVerdictRecord[]
): { standing: MergedIssue[]; disproved: DisprovedIssue[] } {
  const standing: MergedIssue[] = [];
  const disproved: DisprovedIssue[] = [];
  for (const entry of merged) {
    if (entry.issue.severity !== 'CRITICAL') continue;
    const of = (instance: 'A' | 'B') =>
      skeptics.find(s => s.issueKey === entry.key && s.origin === entry.origin && s.instance === instance);
    const a = of('A');
    const b = of('B');
    if (a?.verdict === 'DISPROVED' && b?.verdict === 'DISPROVED') {
      disproved.push({ merged: entry, reasons: { A: a.reason, B: b.reason } });
    } else {
      standing.push(entry);
    }
  }
  return { standing, disproved };
}

/** The IMPORTANT finding a disproved CRITICAL is recorded as, once, under `07c-validator-skeptic` (AC-130). */
export function disprovedFinding(d: DisprovedIssue): string {
  return `CRITICAL disproved by both skeptics (kept as IMPORTANT): ${describeIssue(d.merged.issue)} | skeptic A: ${d.reasons.A} | skeptic B: ${d.reasons.B}`;
}

/**
 * The Stage 4 verdict from the main Validator's raw issue list, with no skeptics (I-27): passed
 * exactly when the list holds no CRITICAL; each raw CRITICAL stands under its key (origin
 * `07-validator`). Dated by the Validator's own timestamp, so it stays pure. Undefined with no
 * Validator output, so the gate fails closed as it did before B-2.
 */
export function legacyVerdict(validator: ValidatorOutput | undefined): ValidationVerdict | undefined {
  if (!validator) return undefined;
  const standing = criticalIssues(validator.details?.issues).map(issue => issueKey('07-validator', issue));
  return { passed: standing.length === 0, standing, disproved: [], recordedAt: validator.timestamp };
}

/** How a reviewer issue is recorded as a finding (MINOR-9): `[file:line] message`, the message alone without a file. */
export function reviewFindingMessage(issue: ValidatorIssue): string {
  const where = issue.file ? `[${issue.file}${issue.line !== undefined ? `:${issue.line}` : ''}] ` : '';
  return `${where}${issue.message}`;
}

/**
 * The merged IMPORTANT issues as findings, by the review that reported them (D-10, AC-122), each
 * list in merged order; an origin with none has an empty list. Duplicates were dropped by the
 * merge, so an issue both reviews report is in the main Validator's list only.
 */
export function importantFindings(merged: readonly MergedIssue[]): Record<IssueOrigin, string[]> {
  const of = (origin: IssueOrigin) =>
    merged
      .filter(entry => entry.origin === origin && entry.issue.severity === 'IMPORTANT')
      .map(entry => reviewFindingMessage(entry.issue));
  return { '07-validator': of('07-validator'), '07b-validator-followup': of('07b-validator-followup') };
}

/**
 * The I-29 finding when the follow-up's `filesReviewed` is not the list it was given, compared as
 * sets after normalisePath against `cwd`; undefined when they match. A `filesReviewed` that is not a
 * list counts as nothing reviewed. Not blocking: the caller records it as an IMPORTANT finding.
 */
export function followupMismatch(given: readonly string[], reviewed: unknown, cwd?: string): string | undefined {
  const reviewedList = Array.isArray(reviewed) ? reviewed.filter((path): path is string => typeof path === 'string') : [];
  const normalised = (paths: readonly string[]) => new Set(paths.map(path => normalisePath(path, cwd)));
  const a = normalised(given);
  const b = normalised(reviewedList);
  if (a.size === b.size && [...a].every(path => b.has(path))) return undefined;
  const list = (paths: readonly string[]) => (paths.length > 0 ? paths.join(', ') : 'nothing');
  return `07b-validator-followup reviewed ${list(reviewedList)} but was given ${list(given)}`;
}

/**
 * The issues evaluation `evaluation` routed when it was decided (D-12): its merged issues (the main
 * output's paths mapped out of its recorded copy, then the reviewed follow-up's) whose keys the
 * verdict kept standing, in merged order. Undefined unless it was decided NOT passed with a main
 * output on record. A resumed validator round routes these, exactly as the round was opened.
 */
export function standingIssues(evaluation: ValidatorEvaluation, cwd: string): ValidatorIssue[] | undefined {
  const closed = evaluation.closed;
  if (!evaluation.validator || closed?.outcome !== 'decided' || closed.verdict.passed) return undefined;
  const followup = evaluation.followup?.status === 'reviewed' ? { issues: evaluation.followup.output.details.issues } : undefined;
  const merged = mergeIssues(
    { issues: evaluation.validator.output.details?.issues, copyDir: evaluation.copy?.dir, previousCopyDirs: evaluation.previousCopyDirs },
    followup,
    cwd
  );
  const standing = new Set(closed.verdict.standing);
  return merged.filter(entry => standing.has(entry.key)).map(entry => entry.issue);
}

/**
 * Whether CHECKPOINT 3 presents VALIDATION_FOLLOWUP.md (D-16): the run's latest first-pass
 * evaluation reviewed files. Derived from state only, so the checkpoint, `--approve 3` and the I-7
 * re-check build the same text. The latest first pass is the one whose document is in the run
 * directory: a CP3 rework supersedes the document and runs a first pass of its own.
 */
export function followupPresented(state: FeatureState): boolean {
  const firstPasses = (state.validatorEvaluations ?? []).filter(evaluation => evaluation.kind === 'first-pass');
  return firstPasses[firstPasses.length - 1]?.followup?.status === 'reviewed';
}

/**
 * What evaluation `round` of a validator loop is (D-7, D-13), in cycle `cycle`:
 *  1. the kind of the open evaluation of (cycle, round), when one is being continued;
 *  2. else a first pass while the Test Verifier has no PASS (`testVerifierPassed` false: a fresh
 *     Stage 4, a CP3 rework, or after a Stage 4 gate failure invalidated it);
 *  3. else a validator round after a round fix (`afterRoundFix`), or once this cycle's first pass
 *     was decided;
 *  4. else a first pass (its Test Verifier already passed, e.g. resumed after Gate 2 escalated).
 */
export function evaluationKind(
  state: FeatureState,
  cycle: number,
  round: number,
  afterRoundFix: boolean,
  testVerifierPassed: boolean
): ValidatorEvaluation['kind'] {
  const open = openEvaluation(state, cycle, round);
  if (open) return open.kind;
  if (!testVerifierPassed) return 'first-pass';
  if (afterRoundFix) return 'validator-round';
  const firstPassDecided = (state.validatorEvaluations ?? []).some(
    evaluation => evaluation.cycle === cycle && evaluation.kind === 'first-pass' && evaluation.closed?.outcome === 'decided'
  );
  return firstPassDecided ? 'validator-round' : 'first-pass';
}

/**
 * The verdict the Stage 4 gate's "Validation Passed" judges (D-12): the typed verdict of cycle
 * `cycle`'s latest decided evaluation; for a cycle with no evaluation at all (a Validator PASS
 * recorded before B-2), the legacy verdict from `validator`'s raw issue list (I-27); a cycle with
 * evaluations but none decided gives none, so the gate fails closed.
 */
export function stage4Verdict(state: FeatureState, cycle: number, validator: ValidatorOutput | undefined): ValidationVerdict | undefined {
  const evaluated = (state.validatorEvaluations ?? []).some(evaluation => evaluation.cycle === cycle);
  return currentValidationVerdict(state, cycle) ?? (evaluated ? undefined : legacyVerdict(validator));
}

/**
 * What the Test Verifier's changed `files` are (D-2, N-3): none; test files only (`tests`); or
 * some outside a test path (`outside-tests`, with those files). The lists are copies.
 */
export function classifyTestVerifierChanges(files: readonly string[]): TestVerifierChanges {
  if (files.length === 0) return { kind: 'none' };
  const { outside } = splitByTestPath([...files]);
  return outside.length === 0 ? { kind: 'tests', files: [...files] } : { kind: 'outside-tests', files: [...files], outside: [...outside] };
}

/**
 * The latest first-pass evaluation of cycle `cycle` before evaluation `e` that recorded a
 * measurement baseline (IMPORTANT-1), as its baseline and whether it was CLEARED: measured with no
 * change outside a test path. Undefined when there is none.
 *
 * One that was not cleared (its measurement failed, or it found a change outside a test path and
 * the run escalated N-3) passes its baseline on to the next first pass (IMPORTANT-2): the earlier
 * Test Verifier's writes are measured again, so they are flagged until they are reverted, also
 * where the next copy of the working tree would already hold them. A cleared one means the Test
 * Verifier's earlier changes are on record, and a later change is not its own.
 */
export function earlierBaseline(
  evaluations: readonly ValidatorEvaluation[],
  cycle: number,
  e: number
): { baseline: MeasurementBaseline; cleared: boolean } | undefined {
  const earlier = evaluations.filter(
    evaluation => evaluation.cycle === cycle && evaluation.kind === 'first-pass' && evaluation.e < e && evaluation.baseline !== undefined
  );
  const latest = earlier[earlier.length - 1];
  if (!latest) return undefined;
  const changes = latest.testVerifierChanges;
  return { baseline: latest.baseline!, cleared: changes !== undefined && changes.kind !== 'outside-tests' };
}

/**
 * The test files the Test Verifier changed in cycle `cycle`, up to and including evaluation `e`
 * (D-9, IMPORTANT-1): every first-pass evaluation's measured files that are under a test path,
 * in evaluation order and then measured order, each once. Each evaluation measures only its own Test Verifier run, so the
 * follow-up of a later first pass still reviews what an earlier run of the cycle wrote.
 */
export function testVerifierFiles(evaluations: readonly ValidatorEvaluation[], cycle: number, e: number): string[] {
  const files = new Set<string>();
  for (const evaluation of evaluations) {
    if (evaluation.cycle !== cycle || evaluation.kind !== 'first-pass' || evaluation.e > e) continue;
    const changes = evaluation.testVerifierChanges;
    if (changes === undefined || changes.kind === 'none') continue;
    const outside = new Set(changes.kind === 'outside-tests' ? changes.outside : []);
    for (const file of changes.files) if (!outside.has(file)) files.add(file);
  }
  return [...files];
}

/**
 * The IMPORTANT findings (source 07-validator) of every OPEN evaluation that has the main
 * Validator's output on record (MINOR-5): what an escalation closing it records, so they reach
 * CHECKPOINT 3 even though the evaluation is never decided. Paths are mapped out of its copies;
 * the run's record skips any it already holds.
 */
export function escalatedReviewFindings(evaluations: readonly ValidatorEvaluation[], cwd: string): string[] {
  return evaluations
    .filter(evaluation => !evaluation.closed && evaluation.validator !== undefined)
    .flatMap(evaluation =>
      importantFindings(
        mergeIssues(
          { issues: evaluation.validator!.output.details?.issues, copyDir: evaluation.copy?.dir, previousCopyDirs: evaluation.previousCopyDirs },
          undefined,
          cwd
        )
      )['07-validator']
    );
}
