/**
 * Run progress (A-2, D-2, D-5): pure decisions over a run's record and outputs. No filesystem,
 * no clock.
 *
 * THE SKIP RULE (D-2) — one rule, used everywhere a resume decides what to run again:
 *
 *  1. A whole stage is skipped when it is complete (`isStageComplete`): the run has advanced past
 *     it (`stage < currentStage`, committed by advanceToStage), or the checkpoint that closes it
 *     is approved (CP2 closes Stage 2, CP3 closes Stage 4). Its agents AND its gates are skipped.
 *  2. Inside a stage that is not complete, a unit is skipped only when its completion is recorded:
 *       - an agent unit: a non-invalidated PASS step for that agent (`hasPass`), keyed by the
 *         output's own agent, so a pre-supplied run's `tier-1` steps complete 01/02/03; a builder
 *         unit is per phase (the Stage 3 build, or one validator round);
 *       - a checkpoint unit: an approval bound to that checkpoint id, not older than the latest
 *         rejection of the same checkpoint (`isCheckpointApproved`).
 *  3. A gate has no completion record. Whenever the flow reaches one it is evaluated again —
 *     Gate 1, the Stage 1/3/4 gates, Gate 1.5, Gate 2 — except the gate that guards an approved
 *     checkpoint (the story gate before an approved CP1, the spec gate before an approved CP2):
 *     the approval is the human's sign-off over what that gate passed, and its artifact is
 *     hash-checked on resume instead (I-7).
 *  4. Gate 2 belongs to its Validator unit: a round whose Validator step is PASS is skipped with
 *     its Gate 2; an unfinished round always re-runs Gate 2 (`pendingValidatorRound`).
 *
 * Attempts are never skipped: they are counted in state (run-lifecycle's used/allowedAttempts).
 */

import { resolve } from 'path';

import type { StageOutputs } from './stage-context';
import type {
  AgentStepRecord,
  BuilderAgent,
  BuilderPhase,
  CheckpointApproval,
  CheckpointId,
  CheckpointRejection,
  FeatureState,
  StageLoopBack
} from './state-tracker';
import type { BackendBuilderOutput, FrontendBuilderOutput, ValidatorIssue } from './agent-output-schema';
import { criticalIssues, mergeBuilderOutput, routeCriticalIssues } from './validator-routing';

type BuilderOutputs = Pick<StageOutputs, 'backend' | 'frontend'>;

/** Which StageOutputs slot each agent's output fills. */
const OUTPUT_SLOT: Readonly<Record<string, keyof StageOutputs>> = {
  '01-researcher': 'researcher',
  '02-story-writer': 'story',
  '03-spec-writer': 'spec',
  '04-backend-builder': 'backend',
  '05-frontend-builder': 'frontend',
  '06-test-verifier': 'test',
  '07-validator': 'validator',
  '08-feature-consolidator': 'consolidator'
};

/** The agent a step completed: its output's own agent (a `tier-1` step stands in for 01/02/03), else the step's. */
function stepAgent(step: AgentStepRecord): string {
  return typeof step.output?.agent === 'string' ? step.output.agent : step.agent;
}

/** A step that completes its unit: PASS, with an output, and never invalidated (I-6, D-5). */
function completes(step: AgentStepRecord): boolean {
  return step.status === 'PASS' && step.output !== undefined && step.invalidated === undefined;
}

function inPhase(step: { phase?: string; round?: number }, at: BuilderPhase): boolean {
  if (at.phase === 'stage3') return step.phase === 'stage3';
  return step.phase === at.phase && step.round === at.round;
}

/**
 * D-2 skip rule, agent unit: a non-invalidated PASS step for `agent` (keyed by output.agent).
 * With `at`, only a PASS in that builder phase counts.
 */
export function hasPass(state: FeatureState, agent: string, at?: BuilderPhase): boolean {
  return state.stageHistory.some(step => completes(step) && stepAgent(step) === agent && (!at || inPhase(step, at)));
}

/** A run whose planning documents were supplied upstream (D-4): it has `tier-1` steps, and never runs the Researcher. */
export function isPreSuppliedRun(state: FeatureState): boolean {
  return state.stageHistory.some(step => step.agent === 'tier-1');
}

/**
 * The approval that completes checkpoint `id`, or undefined: the latest approval bound to that id
 * (a pre-A-2 approval without an id completes nothing; the checkpoint is asked again), and only if
 * it is newer than the latest rejection of the same checkpoint (D-5: a rework re-presents it).
 */
export function checkpointApproval(state: FeatureState, id: CheckpointId): CheckpointApproval | undefined {
  const approvals = state.checkpointApprovals.filter(approval => approval.checkpointId === id);
  const latest = approvals[approvals.length - 1];
  if (!latest) return undefined;

  const rejections = (state.checkpointRejections ?? []).filter(rejection => rejection.checkpointId === id);
  const lastRejection = rejections[rejections.length - 1];
  if (lastRejection && !(Date.parse(latest.approvedAt) > Date.parse(lastRejection.rejectedAt))) return undefined;
  return latest;
}

/** D-2 skip rule, checkpoint unit. */
export function isCheckpointApproved(state: FeatureState, id: CheckpointId): boolean {
  return checkpointApproval(state, id) !== undefined;
}

/**
 * D-2 skip rule, whole stage: advanced past, or closed by an approved checkpoint (CP2 closes
 * Stage 2; CP3 closes Stage 4 — what remains is the baseline and SUCCESS).
 */
export function isStageComplete(state: FeatureState, stage: number): boolean {
  if (state.currentStage > stage) return true;
  if (stage === 2) return isCheckpointApproved(state, 2);
  if (stage === 4) return isCheckpointApproved(state, 3);
  return false;
}

/**
 * Fold the builders' completed steps that `include` admits, in record order (Stage 3 PASS, then
 * each validator round and rework). With `cwd`, claims are merged by project-relative path
 * (MINOR-5), exactly as the run merged them.
 */
function foldBuilders(state: FeatureState, include: (step: AgentStepRecord) => boolean, cwd?: string): BuilderOutputs {
  const folded: BuilderOutputs = {};
  for (const step of state.stageHistory) {
    if (!completes(step) || !include(step)) continue;
    const agent = stepAgent(step);
    if (agent === '04-backend-builder') {
      const next = structuredClone(step.output) as BackendBuilderOutput;
      folded.backend = folded.backend ? mergeBuilderOutput(folded.backend, next, cwd) : next;
    } else if (agent === '05-frontend-builder') {
      const next = structuredClone(step.output) as FrontendBuilderOutput;
      folded.frontend = folded.frontend ? mergeBuilderOutput(folded.frontend, next, cwd) : next;
    }
  }
  return folded;
}

/**
 * Rebuild the run's outputs from its record (D-2): every non-invalidated PASS step with an
 * output, keyed by output.agent; the latest wins, except the builders, which are folded with
 * mergeBuilderOutput in order — exactly the merge the validator rounds do at run time. Artifact
 * paths were rewritten into the run dir before each step was recorded, so they survive as is.
 * The outputs are copies: nothing done to them changes the record.
 */
export function rebuildOutputs(state: FeatureState, cwd?: string): StageOutputs {
  const outputs: StageOutputs = {};
  for (const step of state.stageHistory) {
    if (!completes(step)) continue;
    const slot = OUTPUT_SLOT[stepAgent(step)];
    if (!slot || slot === 'backend' || slot === 'frontend') continue;
    (outputs as Record<string, unknown>)[slot] = structuredClone(step.output);
  }
  return { ...outputs, ...foldBuilders(state, () => true, cwd) };
}

/** A validator round that was entered but never reached its Gate 2, with the issues each builder must fix. */
export interface PendingValidatorRound {
  round: number;
  backend: ValidatorIssue[];
  frontend: ValidatorIssue[];
}

/**
 * The validator round a resume must re-enter at its builder fix (D-2), or undefined.
 *
 * Round r (= validatorRoundsCompleted, r > 0) is unfinished while no Gate 2 evaluation for round r
 * is recorded and the latest Validator step is the FAIL that opened it. Its routing is recomputed
 * from that FAIL's CRITICAL issues against the builders' claims from BEFORE the round (what the
 * routing saw when the round was opened), with routeCriticalIssues. A routing that no longer
 * routes everything is not a pending round: the resume starts the loop again with Gate 2 and the
 * Validator. The orchestrator skips a routed builder that already has a PASS for round r, and
 * always re-runs the round's gates.
 */
export function pendingValidatorRound(state: FeatureState, cwd: string): PendingValidatorRound | undefined {
  const round = state.validatorRoundsCompleted ?? 0;
  if (round <= 0) return undefined;
  if ((state.executionGateHistory ?? []).some(record => record.round === round)) return undefined;

  const validatorSteps = state.stageHistory.filter(step => stepAgent(step) === '07-validator');
  const opener = validatorSteps[validatorSteps.length - 1];
  if (!opener || opener.status !== 'FAIL' || !opener.output) return undefined;

  const before = foldBuilders(
    state,
    step => step.phase === 'stage3' || step.phase === 'rework' || (step.phase === 'validator-round' && (step.round ?? 0) < round),
    cwd
  );
  const issues = (opener.output as { details?: { issues?: ValidatorIssue[] } }).details?.issues;
  const routing = routeCriticalIssues(
    criticalIssues(issues),
    {
      backend: (before.backend?.details.filesModified ?? []).map(file => file.path),
      frontend: (before.frontend?.details.filesModified ?? []).map(file => file.path)
    },
    cwd
  );
  if (routing.unroutable.length > 0 || routing.backend.length + routing.frontend.length === 0) return undefined;
  return { round, backend: routing.backend, frontend: routing.frontend };
}

/**
 * What the first resumed attempt of `builder` in phase `at` is briefed with (AC-36, D-2): the
 * failure on the LAST loop-back of that builder and phase. A last loop-back that named no failure
 * gives undefined — never an older failure, which would brief the wrong problem.
 */
export function lastBuilderFailure(
  state: FeatureState,
  builder: BuilderAgent,
  at: BuilderPhase
): StageLoopBack['failure'] | undefined {
  const loopBacks = state.loopBacks.filter(loopBack => loopBack.agent === builder && inPhase(loopBack, at));
  const failure = loopBacks[loopBacks.length - 1]?.failure;
  return failure ? { kind: failure.kind, error: failure.error } : undefined;
}

/**
 * The builders a CP3 rework re-runs (D-5, I-10), backend first:
 *  - every builder whose claimed files (its merged `filesModified`) intersect the change's files,
 *    both normalised with `cwd`;
 *  - if none does, every builder that ran in this run.
 *
 * Computed at rejection time and stored with the rejection, so the resume that starts the rework
 * is deterministic. Returns [] only when no builder ran at all.
 */
export function reworkAgentsForChange(
  builders: Pick<StageOutputs, 'backend' | 'frontend'>,
  changedFiles: readonly string[],
  cwd: string
): BuilderAgent[] {
  const ran: Array<[BuilderAgent, readonly { path: string }[]]> = [];
  if (builders.backend) ran.push(['04-backend-builder', builders.backend.details?.filesModified ?? []]);
  if (builders.frontend) ran.push(['05-frontend-builder', builders.frontend.details?.filesModified ?? []]);

  const changed = new Set(changedFiles.map(path => resolve(cwd, path)));
  const touched = ran.filter(([, claimed]) => claimed.some(file => changed.has(resolve(cwd, file.path))));

  return (touched.length > 0 ? touched : ran).map(([agent]) => agent);
}

/** A checkpoint rejection and its rework cycle: its 1-based index in `checkpointRejections` (D-5). */
export interface ReworkCycle {
  rejection: CheckpointRejection;
  cycle: number;
}

/** The latest rejection with its cycle, or undefined (also for a state written before A-2). */
function latestRejection(state: FeatureState): ReworkCycle | undefined {
  const rejections = state.checkpointRejections ?? [];
  if (rejections.length === 0) return undefined;
  return { rejection: rejections[rejections.length - 1], cycle: rejections.length };
}

/** Whether checkpoint `id` has an approval bound to it recorded strictly after `since`. */
function approvedAfter(state: FeatureState, id: CheckpointId, since: string): boolean {
  const start = Date.parse(since);
  return state.checkpointApprovals.some(approval => approval.checkpointId === id && Date.parse(approval.approvedAt) > start);
}

/**
 * The rework a resume must START (D-5): the latest rejection, when its rework has not started and
 * its checkpoint has not been approved since. Only the latest rejection counts — an earlier one was
 * either reworked and approved, or the run could not have reached a later checkpoint.
 */
export function reworkToStart(state: FeatureState): ReworkCycle | undefined {
  const latest = latestRejection(state);
  if (!latest || latest.rejection.rework) return undefined;
  return approvedAfter(state, latest.rejection.checkpointId, latest.rejection.rejectedAt) ? undefined : latest;
}

/**
 * The rework under way (D-5): the latest rejection's rework has started, and its checkpoint has no
 * approval recorded after that start. While it is active, the producing agents are briefed with
 * its notes, and a CP3 rework re-runs its builders before Stage 4's gates.
 */
export function activeRework(state: FeatureState): ReworkCycle | undefined {
  const latest = latestRejection(state);
  const started = latest?.rejection.rework;
  if (!latest || !started) return undefined;
  return approvedAfter(state, latest.rejection.checkpointId, started.startedAt) ? undefined : latest;
}

/**
 * Why `agent` must run again when a GATE invalidated its last PASS (I-6, D-B): its latest step
 * (keyed by output.agent, so a pre-supplied `tier-1` step counts) is an invalidated PASS and it has
 * no valid PASS. The re-run is briefed with this reason, so it produces a new version of the
 * existing document instead of the same one. Undefined otherwise.
 */
export function lastInvalidation(state: FeatureState, agent: string): { reason: string; at: string } | undefined {
  if (hasPass(state, agent)) return undefined;
  const steps = state.stageHistory.filter(step => stepAgent(step) === agent);
  const latest = steps[steps.length - 1];
  if (!latest || latest.status !== 'PASS' || !latest.invalidated) return undefined;
  return { reason: latest.invalidated.reason, at: latest.invalidated.at };
}
