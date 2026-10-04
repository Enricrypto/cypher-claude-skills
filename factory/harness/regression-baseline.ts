/**
 * Regression reference — the READ side (D-12; AC-22, AC-65 read, AC-66).
 *
 * "No Regressions" used to judge `details.regressions.count`, a number the Validator typed into
 * its own report, against nothing. The reference is now the harness's own:
 *
 *   - within a run, the run's FIRST Gate 2 count — a validator round may not lose tests;
 *   - for the run's first Gate 2 evaluation, the test count a previous successful run left in
 *     `<cwd>/.factory/baseline.json`;
 *   - with neither, no reference at all, and only the 100% rule applies.
 *
 * Every count here is the number of tests that RAN — `passed + failed` (testsRan) — never the
 * runner's `total` (IMPORTANT-5, operator decision at Checkpoint 3). Skipped and todo tests did
 * not run, so they cannot hold the count up: a round that `.skip`s a failing test drops below the
 * reference and fails "No Regressions". The gate's measurement and the reference are compared in
 * the same unit.
 *
 * The baseline is a regular file in `.factory/`. Starting a new run archives finished run
 * DIRECTORIES into `.factory/_archive/` (run-directory.ts) and never touches regular files, so it
 * stays where it is. The writer (A-2, D-7) records it when a run ends SUCCESS — the Stage 4 gate
 * passed and CHECKPOINT 3 was approved — from that run's own latest Gate 2 record.
 *
 * FAILS CLOSED. An absent file means "no baseline". A file that exists but cannot be read, or
 * does not match the schema, throws RegressionBaselineError — it is never quietly treated as
 * absent, because that would turn a corrupt reference into a lowered bar.
 *
 * Pure apart from the one read and the one write; never calls process.cwd().
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { writeFileAtomic } from './safe-write';
import { ExecutionGateRecord, FeatureState } from './state-tracker';

export const BASELINE_FILENAME = 'baseline.json';

export interface RegressionBaseline {
  schemaVersion: 1;
  /** The run that recorded it. */
  runId: string;
  /**
   * The number of tests that RAN in that run's Gate 2 (passed + failed; skipped/todo excluded) —
   * the same unit "No Regressions" measures. A-2's writer must record testsRan(), not `total`.
   */
  testCount: number;
  recordedAt: string; // ISO8601
}

export class RegressionBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegressionBaselineError';
  }
}

/** `<cwd>/.factory/baseline.json`. */
export function baselineFilePath(cwd: string): string {
  return join(cwd, '.factory', BASELINE_FILENAME);
}

/** Why `value` is not a RegressionBaseline, or undefined when it is one. */
function baselineProblem(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not a JSON object';
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return `unsupported schemaVersion ${JSON.stringify(v.schemaVersion)} (expected 1)`;
  if (typeof v.runId !== 'string' || v.runId.trim() === '') return 'runId must be a non-empty string';
  if (typeof v.testCount !== 'number' || !Number.isInteger(v.testCount) || v.testCount < 0) {
    return 'testCount must be a non-negative integer';
  }
  if (typeof v.recordedAt !== 'string' || v.recordedAt.trim() === '') return 'recordedAt must be a non-empty string';
  return undefined;
}

/**
 * The baseline a previous run left, or undefined when there is none.
 * Throws RegressionBaselineError when the file exists but is unreadable or invalid.
 */
export function readRegressionBaseline(cwd: string): RegressionBaseline | undefined {
  const path = baselineFilePath(cwd);
  if (!existsSync(path)) return undefined;

  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new RegressionBaselineError(
      `Regression baseline ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new RegressionBaselineError(
      `Regression baseline ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const problem = baselineProblem(parsed);
  if (problem) {
    throw new RegressionBaselineError(`Regression baseline ${path} is invalid: ${problem}`);
  }

  const { schemaVersion, runId, testCount, recordedAt } = parsed as RegressionBaseline;
  return { schemaVersion, runId, testCount, recordedAt };
}

/** The tests that ran: `passed + failed`. Skipped and todo tests are not counted (IMPORTANT-5). */
export function testsRan(counts: { passed: number; failed: number }): number {
  return counts.passed + counts.failed;
}

/**
 * The count of tests that ran which a Gate 2 evaluation must not fall below (MINOR-11; I-12 as
 * amended by operator decision D-A): the HIGHER of this run's first PASSING evaluation's testsRan
 * and the baseline's testCount (also a ran-count); either one alone when only one exists; else
 * undefined (no reference: only the 100% rule applies). The bar can never drop on resume.
 *
 * Only a passing evaluation can become the reference. A blocking one — "no tests detected", say,
 * before the run escalated and was resumed — counted something nobody accepted, and using it
 * would lower the bar (a count of 0 makes every later count look like no regression).
 */
export function regressionReference(
  priorEvaluations: readonly ExecutionGateRecord[] | undefined,
  baseline: RegressionBaseline | undefined
): number | undefined {
  const firstPassing = (priorEvaluations ?? []).find(record => record.canAdvance === true);
  const inRun = firstPassing ? testsRan(firstPassing) : undefined;
  const fromBaseline = baseline?.testCount;
  if (inRun === undefined) return fromBaseline;
  if (fromBaseline === undefined) return inRun;
  return Math.max(inRun, fromBaseline);
}

/**
 * The reference for a VALIDATOR ROUND's Gate 2 evaluation (D-A: the bar can never drop): the
 * higher of the run's first passing ran-count and the reference RECORDED on the run's round-0
 * evaluations — the baseline as it stood when round 0 was judged. Taken from the run's own records,
 * never by re-reading `baseline.json`: a round must not depend on a file that can change mid-run.
 *
 * Without this, a round 0 that ran 8 tests against a baseline of 10 would make 8 the bar for every
 * later round. More than one round-0 record (a resume repeated it): the highest recorded reference.
 */
export function validatorRoundReference(priorEvaluations: readonly ExecutionGateRecord[] | undefined): number | undefined {
  const roundZero = (priorEvaluations ?? [])
    .filter(record => record.round === 0)
    .map(record => record.referenceCount)
    .filter((count): count is number => typeof count === 'number');
  const inRun = regressionReference(priorEvaluations, undefined);
  const recorded = roundZero.length > 0 ? Math.max(...roundZero) : undefined;
  if (inRun === undefined) return recorded;
  if (recorded === undefined) return inRun;
  return Math.max(inRun, recorded);
}

/**
 * The baseline a SUCCESS run leaves for the next one (AC-65, D-7): this run's id and the tests
 * that RAN in its latest Gate 2 evaluation — `testsRan`, never `total` (IMPORTANT-5).
 *
 * FAILS CLOSED. A run with no Gate 2 record, or whose latest one did not pass, throws
 * RegressionBaselineError: a count that was never judged acceptable must not become the bar.
 */
export function baselineFromRun(state: FeatureState, now: string): RegressionBaseline {
  const history = state.executionGateHistory ?? [];
  const latest = history[history.length - 1];
  if (!latest) {
    throw new RegressionBaselineError(`Run ${state.featureId} has no Gate 2 record, so it has no test count to record as a baseline.`);
  }
  if (latest.canAdvance !== true) {
    throw new RegressionBaselineError(
      `Run ${state.featureId}'s latest Gate 2 evaluation (round ${latest.round}) did not pass, so its count cannot become the baseline.`
    );
  }
  return { schemaVersion: 1, runId: state.featureId, testCount: testsRan(latest), recordedAt: now };
}

/**
 * Write `<cwd>/.factory/baseline.json` atomically (D-7, D-12) and return its path. The baseline is
 * validated first, with the same rule the reader applies; an invalid one throws
 * RegressionBaselineError and nothing is written. A rename replaces a symlink planted at the
 * target instead of writing through it.
 */
export function writeRegressionBaseline(cwd: string, baseline: RegressionBaseline): string {
  const problem = baselineProblem(baseline);
  if (problem) throw new RegressionBaselineError(`Refusing to write an invalid regression baseline: ${problem}`);

  const { schemaVersion, runId, testCount, recordedAt } = baseline;
  const path = baselineFilePath(cwd);
  mkdirSync(join(cwd, '.factory'), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify({ schemaVersion, runId, testCount, recordedAt }, null, 2)}\n`);
  return path;
}
