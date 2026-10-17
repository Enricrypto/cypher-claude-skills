/**
 * The brief's size, and what it changes (Phase R, PR R-2: R4 and R5).
 *
 * The ONE place the five numbers are spelled — 12, 30, 40, 2, 150 — so the code, the tests and
 * doc-drift all read the same constants and the documents cannot drift from the behaviour, exactly
 * as `EFFORT_LABELS`, `MAX_BUILDER_ATTEMPTS` and `MAX_OUTPUT_TOKENS_VALUE` are read today.
 *
 * It lives in `harness/` and imports from `runner/agent-registry` because the harness DECIDES and
 * the runner ENFORCES: the orchestrator computes a cap here and carries it on the call, and
 * `createSdkInvoker` is the one place it reaches the SDK. (`upstream-artifacts.ts` imports across
 * the same boundary for the same reason.)
 *
 * Everything exported here is PURE and TOTAL. Both inputs — the Spec Writer's `fileList` and the
 * Story Writer's acceptance-criteria count — are model-produced, so they are untrusted: a non-array,
 * a non-finite number, a negative or fractional count each resolve to a safe default and nothing
 * throws. That matters twice over, because `briefSizeWarning` is read by a stage criterion, and a
 * criterion that throws BLOCKS the stage whatever its severity — which is the one thing R5 forbids.
 */

import { AGENT_COST, FeatureFactoryAgent } from '../runner/agent-registry';

/** More than this many acceptance criteria in the approved story is a size warning (R5). */
export const BRIEF_AC_LIMIT = 12;
/** More than this many files in the approved list is a size warning (R5). */
export const BRIEF_FILE_LIMIT = 30;
/** The flat part of R4's formula. */
export const TURN_ALLOWANCE_BASE = 40;
/** Turns allowed per approved file (R4). */
export const TURNS_PER_FILE = 2;
/** The ceiling R4's result is capped at, whatever the base or the file count. */
export const TURN_CEILING = 150;

/**
 * Exactly the agents R_DECISIONS.md names a base for. 07b, 07c and 08 keep `base` even though
 * 07b and 08 receive FILE_LIST.md: `40 + 2f` does not depend on `base`, so scaling them would give
 * the follow-up the Validator's cap on any brief over 5 files and the Consolidator 100 turns on a
 * 30-file brief — erasing a turn-budget ordering `agent-registry.test.ts` asserts deliberately.
 */
export const TURN_SCALED_AGENTS: readonly FeatureFactoryAgent[] = Object.freeze([
  '04-backend-builder',
  '05-frontend-builder',
  '06-test-verifier',
  '07-validator'
] as const);

/**
 * A count this module is willing to do arithmetic with: a whole, non-negative number.
 *
 * A model-produced value reaching `query({ options: { maxTurns } })` as `NaN` is worse than a wrong
 * number, and a negative or fractional one is meaningless. `Infinity` is deliberately kept as-is
 * rather than zeroed: it is "very large", and the ceiling already bounds what it can produce.
 */
function wholeCount(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return 0;
  return value === Number.POSITIVE_INFINITY ? value : Math.floor(value);
}

/**
 * Every entry of the approved list, DELETE included; 0 for anything unusable. Total.
 *
 * Deliberately NOT `metadata.expectedFiles`, which drops DELETE entries because a deleted file
 * cannot appear in a builder's `filesModified`. Here the opposite is wanted: a deletion is still
 * work a builder spends turns on, and still brief size.
 */
export function briefFileCount(fileList: unknown): number {
  return Array.isArray(fileList) ? fileList.length : 0;
}

/**
 * R4, literally: min(150, max(base, 40 + 2 × files)). The `min` is applied to the RESULT, so a
 * base above 150 would be lowered — no base is today (the highest is 80), and the formula is
 * implemented as decided rather than "improved".
 */
export function turnCap(base: number, fileCount: number): number {
  const allowance = TURN_ALLOWANCE_BASE + TURNS_PER_FILE * wholeCount(fileCount);
  return Math.min(TURN_CEILING, Math.max(wholeCount(base), allowance));
}

/**
 * The cap for `agent`, or undefined when the agent is not scaled (the caller then omits it, so the
 * call it makes is byte-identical to the one it made before this PR).
 *
 * An agent that is scaled but somehow absent from `AGENT_COST` — impossible under the `Record`
 * type — also returns undefined, so the invoker falls back to its own `FALLBACK_COST` rather than
 * computing over `undefined`.
 */
export function scaledMaxTurns(agent: string, fileCount: number): number | undefined {
  if (!TURN_SCALED_AGENTS.includes(agent as FeatureFactoryAgent)) return undefined;
  const cost = AGENT_COST[agent as FeatureFactoryAgent];
  if (!cost) return undefined;
  return turnCap(cost.maxTurns, fileCount);
}

/**
 * R5's one message, or undefined when neither limit is exceeded. Mentions a split.
 *
 * The clauses that apply are joined into ONE string, because this becomes one IMPORTANT finding
 * above the CHECKPOINT 2 approval prompt — two findings for one oversized brief would read as two
 * problems. The limits in the text come from the constants above, never from a literal.
 */
export function briefSizeWarning(counts: { acceptanceCriteria: number; files: number }): string | undefined {
  const acCount = wholeCount(counts?.acceptanceCriteria);
  const fileCount = wholeCount(counts?.files);

  const clauses: string[] = [];
  if (acCount > BRIEF_AC_LIMIT) {
    clauses.push(`the approved story has ${acCount} acceptance criteria (more than ${BRIEF_AC_LIMIT})`);
  }
  if (fileCount > BRIEF_FILE_LIMIT) {
    clauses.push(`the approved file list has ${fileCount} files (more than ${BRIEF_FILE_LIMIT})`);
  }
  if (clauses.length === 0) return undefined;

  return `${clauses.join(' and ')}; suggest splitting this brief into more than one PR`;
}
