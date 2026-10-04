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
 * The baseline is a regular file in `.factory/`. Startup cleanup (clearStaleArtifacts) removes
 * only directories, so it survives. Nothing writes it in A-1; A-2 adds the writer at SUCCESS,
 * using RegressionBaseline exactly as declared here.
 *
 * FAILS CLOSED. An absent file means "no baseline". A file that exists but cannot be read, or
 * does not match the schema, throws RegressionBaselineError — it is never quietly treated as
 * absent, because that would turn a corrupt reference into a lowered bar.
 *
 * Pure apart from the one read; never calls process.cwd().
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ExecutionGateRecord } from './state-tracker';

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
 * The count of tests that ran which a Gate 2 evaluation must not fall below.
 * Prior evaluations in this run → the first one's testsRan; else the baseline's testCount (also a
 * ran-count); else undefined (no reference: only the 100% rule applies).
 */
export function regressionReference(
  priorEvaluations: readonly ExecutionGateRecord[] | undefined,
  baseline: RegressionBaseline | undefined
): number | undefined {
  if (priorEvaluations && priorEvaluations.length > 0) return testsRan(priorEvaluations[0]);
  return baseline?.testCount;
}
