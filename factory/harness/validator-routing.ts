/**
 * Routing a Validator CRITICAL issue back to the builder that owns the file (D-9).
 *
 * Pure: no filesystem, no state. The orchestrator decides what to do with the result; this only
 * says who owns each issue, or why nobody can.
 *
 * An issue is routable only when the Validator pinned it to a file, says it can be fixed, and a
 * builder actually claimed that file. Anything else escalates — the harness never guesses an
 * owner, because a guess sends a builder to "fix" code it did not write.
 */

import { BackendBuilderOutput, FrontendBuilderOutput, ValidatorIssue } from './agent-output-schema';
import { isFrontendPath } from './frontend-files';
import { normalisePath } from './stage-context';

/** The files each builder claimed (its filesModified paths). */
export interface IssueOwners {
  backend: string[];
  frontend: string[];
}

export type UnroutableReason = 'NO_FILE' | 'CANNOT_FIX' | 'NOT_OWNED';

export interface ValidatorRouting {
  backend: ValidatorIssue[];
  frontend: ValidatorIssue[];
  unroutable: Array<{ issue: ValidatorIssue; reason: UnroutableReason }>;
}

/**
 * `[file:line] message — suggestion`: how a Validator issue is shown to a builder (in its
 * validator-round briefing) and to a human (in an escalation). One format for both.
 */
export function describeIssue(issue: ValidatorIssue): string {
  const where = issue.file ? `[${issue.file}${issue.line !== undefined ? `:${issue.line}` : ''}] ` : '';
  return `${where}${issue.message} — ${issue.suggestion}`;
}

/** The CRITICAL issues in a Validator report. A missing list is no issues, not an error. */
export function criticalIssues(issues: ValidatorIssue[] | undefined): ValidatorIssue[] {
  return (Array.isArray(issues) ? issues : []).filter(issue => issue.severity === 'CRITICAL');
}

/**
 * Who fixes each issue:
 *   - no `file` → NO_FILE;  `canFix === false` → CANNOT_FIX;
 *   - owned by one builder → that builder;
 *   - owned by both → frontend when isFrontendPath(file), else backend (AC-69);
 *   - owned by neither → NOT_OWNED.
 * Paths are compared after normalisePath(…, cwd), so `/abs/project/src/a.ts`, `./src/a.ts` and
 * `src/a.ts` are one file.
 */
export function routeCriticalIssues(issues: ValidatorIssue[], owners: IssueOwners, cwd: string): ValidatorRouting {
  const backendFiles = new Set(owners.backend.map(p => normalisePath(p, cwd)));
  const frontendFiles = new Set(owners.frontend.map(p => normalisePath(p, cwd)));
  const routing: ValidatorRouting = { backend: [], frontend: [], unroutable: [] };

  for (const issue of issues) {
    if (typeof issue.file !== 'string' || issue.file.trim() === '') {
      routing.unroutable.push({ issue, reason: 'NO_FILE' });
      continue;
    }
    if (issue.canFix === false) {
      routing.unroutable.push({ issue, reason: 'CANNOT_FIX' });
      continue;
    }

    const file = normalisePath(issue.file, cwd);
    const backendOwns = backendFiles.has(file);
    const frontendOwns = frontendFiles.has(file);

    if (backendOwns && frontendOwns) {
      (isFrontendPath(file) ? routing.frontend : routing.backend).push(issue);
    } else if (backendOwns) {
      routing.backend.push(issue);
    } else if (frontendOwns) {
      routing.frontend.push(issue);
    } else {
      routing.unroutable.push({ issue, reason: 'NOT_OWNED' });
    }
  }

  return routing;
}

/**
 * Fold a validator-round build into the builder's earlier output.
 *
 * The round's output wins everywhere (its summary, its test results), except `filesModified`:
 * a round fixes a few files, and the files it did not touch are still the builder's work. That
 * list is the union by normalised path, in first-seen order, with the round's entry winning for
 * a path both name. Neither input is mutated.
 *
 * `testing` (IMPORTANT-4):
 *   - The round reports no test written AND none failing (`testsWritten === 0`, `testsFailed === 0`)
 *     → the PREVIOUS totals are kept. A fix that needed no new test is honest, not a 0% pass rate;
 *     replacing the totals with zeros would fail the Stage 3 "Unit Tests Pass" gate on correct work.
 *   - Otherwise the round's totals win, whole. In particular any `testsFailed > 0` in the round
 *     always reaches the gate (even alongside `testsWritten === 0`): failures are never masked by
 *     an earlier green run. Totals are not summed — a round re-runs its tests, so a sum would
 *     double-count them.
 *   - A round with no `testing` at all keeps that absence (fails closed at the schema/gate).
 */
export function mergeBuilderOutput<T extends BackendBuilderOutput | FrontendBuilderOutput>(previous: T, next: T): T {
  const nextFiles = next.details?.filesModified ?? [];
  const byPath = new Map(nextFiles.map(f => [normalisePath(f.path), f]));
  const merged: Array<(typeof nextFiles)[number]> = [];
  const seen = new Set<string>();

  for (const file of [...(previous.details?.filesModified ?? []), ...nextFiles]) {
    const key = normalisePath(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(byPath.get(key) ?? file);
  }

  const nextTesting = next.details?.testing;
  const keepPreviousTesting =
    nextTesting !== undefined &&
    nextTesting.testsWritten === 0 &&
    nextTesting.testsFailed === 0 &&
    previous.details?.testing !== undefined;
  const testing = keepPreviousTesting ? previous.details.testing : nextTesting;

  return { ...next, details: { ...next.details, filesModified: merged, testing } } as T;
}
