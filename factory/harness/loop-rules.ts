/**
 * Loop-back rules (D-9): what the harness does when something fails, and how many times.
 *
 * The table is data, not prose, so the orchestrator, the tests and SKILL.md's machine-readable
 * claims block can all be checked against ONE source. The orchestrator re-exports it and uses the
 * two bounds below instead of literal 3s and 2s.
 *
 * Every retry is bounded. Anything without a bound escalates to a human.
 */

/** Attempts per builder per phase: the Stage 3 build, or one validator round. */
export const MAX_BUILDER_ATTEMPTS = 3;

/** Times a Validator CRITICAL issue may be routed back to the builder that owns the file. */
export const MAX_VALIDATOR_ROUNDS = 2;

export type LoopBackSituation =
  | 'BUILDER_TESTS_FAIL'
  | 'BUILDER_SCHEMA_INVALID'
  | 'GATE_2_FAILS'
  | 'TEST_VERIFIER_FAILS'
  | 'VALIDATOR_CRITICAL_ROUTABLE'
  | 'VALIDATOR_CRITICAL_UNROUTABLE'
  | 'VALIDATOR_ESCALATES';

export interface LoopBackRule {
  situation: LoopBackSituation;
  action: 'RETRY_SAME_BUILDER' | 'RETRY_OWNING_BUILDER' | 'ESCALATE';
  /** How many times the action may be taken before the run escalates. Absent for ESCALATE. */
  bound?: number;
}

export const LOOP_BACK_RULES: readonly LoopBackRule[] = Object.freeze<LoopBackRule[]>([
  { situation: 'BUILDER_TESTS_FAIL', action: 'RETRY_SAME_BUILDER', bound: MAX_BUILDER_ATTEMPTS },
  { situation: 'BUILDER_SCHEMA_INVALID', action: 'RETRY_SAME_BUILDER', bound: MAX_BUILDER_ATTEMPTS },
  { situation: 'GATE_2_FAILS', action: 'ESCALATE' },
  { situation: 'TEST_VERIFIER_FAILS', action: 'ESCALATE' },
  { situation: 'VALIDATOR_CRITICAL_ROUTABLE', action: 'RETRY_OWNING_BUILDER', bound: MAX_VALIDATOR_ROUNDS },
  { situation: 'VALIDATOR_CRITICAL_UNROUTABLE', action: 'ESCALATE' },
  { situation: 'VALIDATOR_ESCALATES', action: 'ESCALATE' }
]);
