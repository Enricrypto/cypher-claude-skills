/**
 * Run lifecycle (A-2, D-1 and D-3): what kind of run this is, whether it can be resumed, and
 * whether a given resume request is allowed.
 *
 * PURE. Every function reads a FeatureState and touches no filesystem. The orchestrator calls
 * `checkResumeRequest` before its try block and before any commit, so a refusal is a thrown
 * RunRefusedError and leaves state.json byte-identical (AC-52, 53, 71, 73). The checks that need
 * files (the artifact hash at `--approve`, I-7) belong to the orchestrator, not here.
 *
 * Imports from state-tracker are type-only: state-tracker's `isResumable` calls `classifyRun`,
 * and a type-only import keeps that from becoming a runtime cycle.
 */

import type { BuilderAgent, BuilderPhase, CheckpointId, EscalationRecord, FeatureState } from './state-tracker';
import { MAX_BUILDER_ATTEMPTS } from './loop-rules';

export type { CheckpointId } from './state-tracker';

/**
 * ACTIVE: running, or killed mid-run (IN_PROGRESS, BLOCKED, or ESCALATED before finish()).
 * PAUSED: waiting at a checkpoint. ESCALATED / SUCCESS / MANUAL_STOP: finished that way.
 * Only SUCCESS and MANUAL_STOP are "finished" for good (OQ-2).
 */
export type RunClass = 'ACTIVE' | 'PAUSED' | 'ESCALATED' | 'SUCCESS' | 'MANUAL_STOP';

export type ResumeAction =
  | { kind: 'continue' }
  | { kind: 'approve'; checkpoint: CheckpointId }
  | { kind: 'reject'; checkpoint: CheckpointId; notes: string };

export interface ResumeRequest {
  action: ResumeAction;
  /** `--grant-attempts <n>`: only for a builder that exhausted its attempts (AC-72, I-8). */
  grantAttempts?: number;
}

export type RunRefusalCode =
  | 'RUN_FINISHED'
  | 'RUN_NOT_FOUND'
  | 'INVALID_RUN_ID'
  | 'ACTIVE_RUN_EXISTS'
  | 'UNREADABLE_RUN'
  | 'NEEDS_GRANT'
  | 'GRANT_NOT_APPLICABLE'
  | 'GRANT_OUT_OF_RANGE'
  | 'NO_PENDING_CHECKPOINT'
  | 'WRONG_CHECKPOINT'
  | 'NOTES_REQUIRED'
  | 'ARTIFACT_CHANGED'
  | 'APPROVED_ARTIFACT_CHANGED'
  | 'DESCRIPTION_MISMATCH'
  | 'DESCRIPTION_REQUIRED'
  | 'NOT_SUCCESS'
  | 'FACTORY_DIR_CASE_CONFLICT';

/** A run-lifecycle request the harness will not carry out. Thrown before any write. */
export class RunRefusedError extends Error {
  constructor(
    readonly code: RunRefusalCode,
    message: string
  ) {
    super(message);
    this.name = 'RunRefusedError';
  }
}

/** The most attempts one `--grant-attempts` may add (I-8): one fresh budget. */
export const MAX_GRANT_PER_RESUME = MAX_BUILDER_ATTEMPTS;

const BUILDERS: readonly BuilderAgent[] = ['04-backend-builder', '05-frontend-builder'];

/** D-1. */
export function classifyRun(state: FeatureState): RunClass {
  if (state.status === 'PAUSED') return 'PAUSED';
  switch (state.completionStatus) {
    case 'SUCCESS':
    case 'MANUAL_STOP':
    case 'ESCALATED':
      return state.completionStatus;
    default:
      return 'ACTIVE';
  }
}

/** `1|2|3|cp1|cp2|cp3` (any letter case for "cp"). Anything else is undefined: the caller refuses. */
export function parseCheckpointId(value: string): CheckpointId | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(?:cp)?([123])$/i.exec(value);
  return match ? (Number(match[1]) as CheckpointId) : undefined;
}

/** Whether two builder phases are the same budget: Stage 3, or the same validator round or rework cycle. */
export function samePhase(a: BuilderPhase, b: BuilderPhase): boolean {
  if (a.phase === 'stage3' || b.phase === 'stage3') return a.phase === b.phase;
  return a.phase === b.phase && a.round === b.round;
}

/** Attempts already spent (committed before each invocation, so a killed one counts). */
export function usedAttempts(state: FeatureState, builder: BuilderAgent, at: BuilderPhase): number {
  const counts = state.builderAttempts?.[builder];
  if (!counts) return 0;
  switch (at.phase) {
    case 'stage3':
      return counts.stage3 ?? 0;
    case 'validator-round':
      return counts.validatorRounds?.[at.round] ?? 0;
    case 'rework':
      return counts.rework?.[at.round] ?? 0;
  }
}

/** MAX_BUILDER_ATTEMPTS plus every grant for exactly this builder and phase (D-2). */
export function allowedAttempts(state: FeatureState, builder: BuilderAgent, at: BuilderPhase): number {
  const granted = (state.attemptGrants ?? [])
    .filter(grant => grant.builder === builder && samePhase(grant.at, at))
    .reduce((sum, grant) => sum + grant.attempts, 0);
  return MAX_BUILDER_ATTEMPTS + granted;
}

/**
 * The budget a MAX_LOOPS record from before A-2 (no `builderPhase`) ran out of, from its escalation
 * stage (MINOR-8, AC-101): stage 3 is Stage 3; stage 4 is the validator round the run had entered,
 * when that is a whole number of at least 1. Anything else cannot be inferred (I-11): undefined.
 */
function inferBuilderPhase(state: FeatureState, escalation: EscalationRecord): BuilderPhase | undefined {
  if (escalation.stage === 3) return { phase: 'stage3' };
  const round = state.validatorRoundsCompleted;
  if (escalation.stage === 4 && typeof round === 'number' && Number.isInteger(round) && round >= 1) {
    return { phase: 'validator-round', round };
  }
  return undefined;
}

/**
 * The builder (and the budget it ran out of) when the run stopped because a builder exhausted its
 * attempts: the latest unresolved escalation is MAX_LOOPS, by a builder, with `builderPhase` (or,
 * for a pre-A-2 record, a phase inferred from its stage, AC-101). Only an ACTIVE or ESCALATED run
 * can be in that position; anything else is undefined.
 */
export function exhaustedBuilder(state: FeatureState): { builder: BuilderAgent; at: BuilderPhase } | undefined {
  const runClass = classifyRun(state);
  if (runClass !== 'ACTIVE' && runClass !== 'ESCALATED') return undefined;

  const unresolved = state.escalations.filter(escalation => !escalation.resolvedAt);
  const latest = unresolved[unresolved.length - 1];
  if (!latest || latest.reason !== 'MAX_LOOPS') return undefined;

  const builder = BUILDERS.find(candidate => candidate === latest.agent);
  if (!builder) return undefined;
  const at = latest.context.builderPhase ?? inferBuilderPhase(state, latest);
  if (!at) return undefined;
  return { builder, at };
}

function describePhase(at: BuilderPhase): string {
  return at.phase === 'stage3' ? 'Stage 3' : `${at.phase} ${at.round}`;
}

/**
 * D-3: refuse a resume request the run cannot honour. Returns normally when the orchestrator may
 * proceed; throws RunRefusedError otherwise. A malformed request (no action, unknown kind) is a
 * TypeError: it never reads as a plain continue.
 */
export function checkResumeRequest(state: FeatureState, request: ResumeRequest): void {
  const action = request?.action;
  if (!action || !['continue', 'approve', 'reject'].includes(action.kind)) {
    throw new TypeError('Malformed resume request: expected an action of kind continue, approve or reject.');
  }

  const id = state.featureId;
  const runClass = classifyRun(state);
  const grant = request.grantAttempts;

  if (runClass === 'SUCCESS' || runClass === 'MANUAL_STOP') {
    throw new RunRefusedError('RUN_FINISHED', `Run ${id} already finished (${runClass}); it cannot be resumed.`);
  }

  if (grant !== undefined && !(Number.isInteger(grant) && grant >= 1 && grant <= MAX_GRANT_PER_RESUME)) {
    throw new RunRefusedError(
      'GRANT_OUT_OF_RANGE',
      `--grant-attempts must be a whole number from 1 to ${MAX_GRANT_PER_RESUME}; got ${String(grant)}.`
    );
  }

  if (action.kind === 'approve' || action.kind === 'reject') {
    const pending = runClass === 'PAUSED' ? state.pendingCheckpoint : undefined;
    if (!pending) {
      throw new RunRefusedError(
        'NO_PENDING_CHECKPOINT',
        `Run ${id} is not paused at a checkpoint, so there is nothing to --${action.kind}.`
      );
    }
    if (action.checkpoint !== pending.checkpointId) {
      throw new RunRefusedError(
        'WRONG_CHECKPOINT',
        `Run ${id} is paused at checkpoint ${pending.checkpointId} (${pending.name}), ` +
          `not checkpoint ${String(action.checkpoint)}.`
      );
    }
    if (action.kind === 'reject' && (typeof action.notes !== 'string' || action.notes.trim() === '')) {
      throw new RunRefusedError('NOTES_REQUIRED', `--reject needs --notes "<why>" so the rework knows what to change.`);
    }
    if (grant !== undefined) {
      throw new RunRefusedError('GRANT_NOT_APPLICABLE', `--grant-attempts applies only to a run whose builder exhausted its attempts.`);
    }
    return;
  }

  // continue
  if (runClass === 'PAUSED') {
    if (grant !== undefined) {
      throw new RunRefusedError('GRANT_NOT_APPLICABLE', `Run ${id} is paused at a checkpoint; --grant-attempts does not apply.`);
    }
    return;
  }

  const exhausted = exhaustedBuilder(state);
  if (exhausted && grant === undefined) {
    throw new RunRefusedError(
      'NEEDS_GRANT',
      `Run ${id} stopped because ${exhausted.builder} exhausted its attempts (${describePhase(exhausted.at)}). ` +
        `Resume it with --grant-attempts <n> (1-${MAX_GRANT_PER_RESUME}), or close it with --close ${id}.`
    );
  }
  if (!exhausted && grant !== undefined) {
    throw new RunRefusedError(
      'GRANT_NOT_APPLICABLE',
      `--grant-attempts applies only to a run whose builder exhausted its attempts; run ${id} did not stop that way.`
    );
  }
}

/**
 * The feature description a resume briefs its agents with (AC-37): the one saved in the run, else
 * — for a run recorded before descriptions were saved (pre-A-2) — the `--feature` one. A run with
 * neither is refused with DESCRIPTION_REQUIRED rather than briefed with a guess (its display name
 * is not a description). Pure: the caller saves a supplied description into the run.
 */
export function resumeDescription(state: FeatureState, feature: string | undefined): string {
  if (state.featureDescription !== undefined) return state.featureDescription;
  if (typeof feature === 'string' && feature.trim() !== '') return feature;
  throw new RunRefusedError(
    'DESCRIPTION_REQUIRED',
    `Run ${state.featureId} was recorded without a feature description, so it cannot be resumed without one. ` +
      `Resume it with --feature "<the description it was started with>"; it is then saved in the run.`
  );
}

/**
 * The description a resume runs with (AC-99, NEW-MINOR-1). Called by the orchestrator right after
 * `checkResumeRequest`, so the run-state refusals (RUN_FINISHED, NEEDS_GRANT, ...) win. A supplied
 * description that differs from the saved one is refused DESCRIPTION_MISMATCH: a resume never
 * re-briefs a run with another feature. Otherwise `resumeDescription` decides (DESCRIPTION_REQUIRED
 * for a run recorded without one and given none). A blank `supplied` counts as not supplied (I-10).
 */
export function checkResumeDescription(state: FeatureState, supplied: string | undefined): string {
  const given = typeof supplied === 'string' && supplied.trim() !== '' ? supplied : undefined;
  if (given !== undefined && state.featureDescription !== undefined && given !== state.featureDescription) {
    throw new RunRefusedError(
      'DESCRIPTION_MISMATCH',
      `--feature ${JSON.stringify(given)} does not match the description saved in run ${state.featureId} ` +
        `(${JSON.stringify(state.featureDescription)}). Omit --feature to resume it as it was started.`
    );
  }
  return resumeDescription(state, given);
}

/**
 * Quote a shell argument only when it needs it, POSIX single-quote style. The ONE quoting rule for
 * every command the harness prints (next-step hints, refusal messages).
 */
export function shellArg(value: string): string {
  return /^[A-Za-z0-9_\/.,:@%+=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The commands that make sense next, derived from state (D-11, AC-42). "Resume with" appears only
 * for a resumable class. A run whose id is not a safe run id gets no commands: the CLI would
 * refuse them anyway.
 */
export function nextStepHints(state: FeatureState, cwd: string): string[] {
  const id = state.featureId;
  if (!isSafeRunId(id)) return [];

  const where = `--cwd ${shellArg(cwd)}`;
  const resume = `npm run factory -- --resume ${id} ${where}`;
  const close = `Close with: npm run factory -- --close ${id} ${where}`;

  switch (classifyRun(state)) {
    case 'PAUSED': {
      const n = state.pendingCheckpoint?.checkpointId;
      if (n === undefined) return [close];
      return [`Approve with: ${resume} --approve ${n}`, `Reject with: ${resume} --reject ${n} --notes "<why>"`, close];
    }
    case 'ACTIVE':
    case 'ESCALATED':
      return exhaustedBuilder(state)
        ? [`Resume with: ${resume} --grant-attempts <n>`, close]
        : [`Resume with: ${resume}`, close];
    case 'SUCCESS':
      return [`Consolidate with: npm run factory -- --consolidate ${id} ${where}`];
    case 'MANUAL_STOP':
      return [];
  }
}

/**
 * A run id that is safe to join under `.factory/` (SEC, D-9): a letter or digit first, then
 * letters, digits, `.`, `_` or `-`, at most 128 characters, and never `..`. Refuses `.hidden`,
 * `_archive` and anything with a path separator.
 */
export function isSafeRunId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes('..');
}
