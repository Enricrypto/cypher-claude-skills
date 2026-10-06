/**
 * Feature Factory Orchestrator
 *
 * Main workflow that coordinates the four stages of a run.
 * Uses harness components to enforce deterministic gates and error handling.
 *
 * Stages:
 * 1. DISCOVER (Researcher) — Map codebase
 * 2. PLAN (Story Writer → CP1 → Spec Writer → CP2) — Design feature
 * 3. EXECUTE (Backend Builder → Frontend Builder) — Implement with loop-backs
 * 4. VERIFY (Test Verifier in the project ∥ Validator in a read-only copy of the latest Stage 3
 *    snapshot → Gate 2 → follow-up review of the Test Verifier's files → merge → two skeptics per
 *    CRITICAL → Validator rounds → Stage 4 gate → CP3) — the harness measures regressions and the
 *    Test Verifier's changes itself, and a human approves the validated change
 *
 * SUCCESS = the Stage 4 gate passed and CHECKPOINT 3 was approved (AC-44). Stage 5 (the Feature
 * Consolidator) is not part of a run: it runs on a finished SUCCESS run, on request.
 */

import { lstatSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';

import {
  stageContracts,
  canAdvanceStage,
  ExecutionMeasurement,
  StageAdvancementDecision,
  StageContract,
  STAGE2_SPEC_CONTRACT,
  STAGE2_STORY_CONTRACT
} from '../../harness/stage-gates';

import {
  CheckpointPresentation,
  CheckpointPresentationError,
  CP3_FOLLOWUP_DOCUMENT,
  NOT_GIT_SNAPSHOT_REASON,
  presentationFor
} from '../../harness/checkpoint-presentation';

import { ChangeSet, ChangeTracker, DEFAULT_CHANGE_TRACKER, HeadState } from '../../harness/change-diff';
import {
  activeRework,
  checkpointApproval,
  currentReworkCycle,
  hasPass,
  isCheckpointApproved,
  isPreSuppliedRun,
  isStageComplete,
  lastBuilderFailure,
  lastInvalidation,
  pendingValidatorRound,
  rebuildOutputs,
  reworkAgentsForChange,
  ReworkCycle,
  reworkToStart
} from '../../harness/run-progress';
import {
  allowedAttempts,
  checkResumeDescription,
  checkResumeRequest,
  classifyRun,
  exhaustedBuilder,
  ResumeRequest,
  RunRefusedError,
  shellArg,
  usedAttempts
} from '../../harness/run-lifecycle';

import {
  baselineFromRun,
  readRegressionBaseline,
  regressionReference,
  validatorRoundReference,
  writeRegressionBaseline
} from '../../harness/regression-baseline';

import {
  validateOutputSchema,
  FeatureFactoryAgentOutput,
  BackendBuilderOutput,
  FrontendBuilderOutput,
  SkepticOutput,
  ValidatorFollowupOutput,
  ValidatorIssue,
  verifyArtifactMaterialization,
  generateMaterializationReport
} from '../../harness/agent-output-schema';

import {
  HarnessRenderedArtifact,
  renderApiContract,
  renderBackendSummary,
  renderFrontendSummary,
  renderTestReport,
  writeHarnessDocument
} from '../../harness/harness-documents';

import {
  BuilderFailure,
  builderPrompt,
  CheckpointRework,
  followupPrompt,
  ValidatorRoundFailure,
  PromptContext,
  researcherPrompt,
  skepticPrompt,
  specPrompt,
  storyPrompt,
  testVerifierPrompt,
  validatorPrompt
} from '../../harness/agent-prompts';

import { analyzeError } from '../../harness/error-categories';

import {
  auditExecution,
  validateExecutionGate,
  generateExecutionReport,
  ExecutionAudit,
  ExecutionGateDecision
} from '../../harness/execution-gates';

import {
  auditInfrastructure,
  validateInfrastructureGate,
  generateInfrastructureReport,
  InfrastructureAudit,
  InfrastructureGateDecision
} from '../../harness/infrastructure-gates';

import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { REQUIRED_ARTIFACTS } from '../../runner/agent-registry';
import {
  buildStageContext,
  BuildStageContextInput,
  claimedFilesFromBuilders,
  claimsInsideFactoryDir,
  persistArtifacts,
  StageOutputs
} from '../../harness/stage-context';
import { acceptFeatureSpec, FeatureSpec } from '../../contracts/feature-spec';
import { DOCUMENT_CHECK_SOURCE } from '../../harness/direction-characters';
import { DocumentFile, documentFindings, writtenDocuments } from '../../harness/document-check';

import {
  FeatureState,
  createFeatureState,
  recordAgentStep,
  recordLoopBack,
  recordEscalation,
  recordCheckpointApproval,
  recordCheckpointRejection,
  recordPause,
  recordImportantFindings,
  addImportantFindingsOnce,
  recordExecutionGate,
  recordBuilderAttempt,
  recordValidatorRound,
  recordAgentInvocation,
  recordAttemptGrant,
  recordChangeBase,
  recordFeatureDescription,
  recordReworkStart,
  recordStage3Snapshot,
  stage3SnapshotNumber,
  stage3SnapshotPassedBy,
  latestStage3Snapshot,
  recordEvaluationStart,
  openEvaluation,
  recordMeasurementBaseline,
  MeasurementBaseline,
  reviewCopyDirs,
  recordReviewCopy,
  recordEvaluationValidator,
  recordTestVerifierChanges,
  recordFollowup,
  recordSkepticVerdict,
  SKEPTIC_INSTANCES,
  SkepticInstance,
  closeEvaluation,
  closeOpenEvaluations,
  ReviewSource,
  TestVerifierChanges,
  ValidationVerdict,
  ValidatorEvaluation,
  clearPause,
  invalidateAgentSteps,
  reopenFeature,
  advanceToStage,
  completeFeature,
  BuilderAgent,
  BuilderPhase,
  CheckpointId,
  StepPhase
} from '../../harness/state-tracker';

export type { CheckpointId } from '../../harness/state-tracker';
export type { ResumeRequest } from '../../harness/run-lifecycle';
export { RunRefusedError };

import { LOOP_BACK_RULES, MAX_BUILDER_ATTEMPTS, MAX_VALIDATOR_ROUNDS } from '../../harness/loop-rules';
import { specRequiresFrontend } from '../../harness/frontend-files';
import {
  criticalIssues,
  describeIssue,
  mergeBuilderOutput,
  routeCriticalIssues,
  UnroutableReason
} from '../../harness/validator-routing';

/** The loop-back table and its bounds (D-9), re-exported so SKILL.md's claims can be checked against them. */
export { LOOP_BACK_RULES, MAX_BUILDER_ATTEMPTS, MAX_VALIDATOR_ROUNDS };
export type { LoopBackRule, LoopBackSituation } from '../../harness/loop-rules';

import { saveState, stateFilePath, StatePersistenceError } from '../../harness/state-store';
import {
  classifyTestVerifierChanges,
  disprovedFinding,
  earlierBaseline,
  escalatedReviewFindings,
  evaluationKind,
  followupMismatch,
  followupPresented,
  importantFindings,
  MergedIssue,
  mergeIssues,
  stage4Verdict,
  testVerifierFiles,
  verdictOf
} from '../../harness/verification';
import {
  compareWithCopy,
  copyIntact,
  copyWorkingTree,
  CopyLeaves,
  createReviewDir,
  insideReviewCopies,
  leafDigest,
  reviewRootProblem,
  sealReadOnly
} from '../../harness/review-copy';
import { assertNoFactoryCaseVariant, prepareNewRunDirectory, supersedeArtifacts } from '../../harness/run-directory';

/**
 * The two audits that run real commands in the target project: Gate 1.5 (infrastructure) and
 * Gate 2 (execution).
 *
 * Injected for the same reason `invoke` is: so the orchestrator can be driven end to end in a
 * test without running `npm run build/test/dev` in a temp directory. Only the AUDITS are
 * injectable. validateInfrastructureGate / validateExecutionGate stay real, so a test exercises
 * the orchestrator's real judgement of whatever evidence the audit returns.
 */
export interface OrchestrationGates {
  auditInfrastructure: (projectRoot: string) => Promise<InfrastructureAudit>;
  auditExecution: (projectRoot: string) => Promise<ExecutionAudit>;
}

/** The real audits. Production never passes `gates`, so this is what runs. */
export const DEFAULT_GATES: Readonly<OrchestrationGates> = Object.freeze({
  auditInfrastructure,
  auditExecution
});

/**
 * A human checkpoint the program enforces (D-11). The numbers are what SKILL.md documents; the
 * doc-drift test checks the two against each other, so a checkpoint cannot be added, removed or
 * renumbered in one place only.
 */
export interface CheckpointDefinition {
  readonly id: CheckpointId;
  readonly name: string;
  readonly stage: 1 | 2 | 3 | 4 | 5;
}

/**
 * Every checkpoint the orchestrator asks a human to approve: the story and the brief before any
 * code is written, and the validated change once the Stage 4 gate has passed (AC-44). A run is
 * SUCCESS only when CP3 is approved. The factory never touches your branch, index or working tree,
 * never pushes, and writes git objects only under `refs/factory/<id>/` (AC-45 revised: its Stage 3
 * snapshots). What happens to an approved change next is the human's step.
 */
export const CHECKPOINTS = {
  STORY: { id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 },
  BRIEF: { id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 },
  CHANGE: { id: 3, name: 'CHECKPOINT 3: Approve the validated change', stage: 4 }
} as const satisfies Record<string, CheckpointDefinition>;

/**
 * What a human is asked to approve at a checkpoint (D-4).
 *
 * There is deliberately no `summary`: CP1 used to show only the Story Writer's own one-line
 * summary of its work, so a human "approved" a story they had not read. The request carries the
 * full artifact text, and the approval is bound to its hash (AC-43, AC-50).
 */
export interface CheckpointRequest {
  id: CheckpointId;
  name: string;
  stage: number;
  /** The exact text presented: the full artifact(s). Approvals bind to sha256(text). */
  text: string;
  sha256: string;
  /** Absolute paths of the documents `text` was built from. */
  artifactPaths: string[];
}

/** A human's answer at a checkpoint (D-4). Anything an approver returns is read through normaliseDecision. */
export type CheckpointDecision =
  | { decision: 'APPROVE'; approvedBy?: string }
  | { decision: 'REJECT'; notes?: string }
  | { decision: 'PAUSE' };

/**
 * Read an approver's return value as a decision (D-4, I-18).
 *
 *  - `true` is APPROVE and `false` is REJECT (the legacy boolean approvers);
 *  - a well-formed decision is copied, keeping only the fields it defines;
 *  - ANYTHING ELSE IS PAUSE. That fails closed: an answer the harness cannot read approves
 *    nothing and re-runs nothing — the run waits, resumable, for a decision it can read.
 */
export function normaliseDecision(value: unknown): CheckpointDecision {
  if (value === true) return { decision: 'APPROVE' };
  if (value === false) return { decision: 'REJECT' };
  if (typeof value !== 'object' || value === null) return { decision: 'PAUSE' };

  const answer = value as Record<string, unknown>;
  switch (answer.decision) {
    case 'APPROVE':
      if (answer.approvedBy === undefined) return { decision: 'APPROVE' };
      return typeof answer.approvedBy === 'string'
        ? { decision: 'APPROVE', approvedBy: answer.approvedBy }
        : { decision: 'PAUSE' };
    case 'REJECT':
      if (answer.notes === undefined) return { decision: 'REJECT' };
      return typeof answer.notes === 'string' ? { decision: 'REJECT', notes: answer.notes } : { decision: 'PAUSE' };
    case 'PAUSE':
      return { decision: 'PAUSE' };
    default:
      return { decision: 'PAUSE' };
  }
}

/**
 * Who re-runs when a planning checkpoint is rejected (D-5): the agent that produced what was
 * presented. CP3's builders depend on the change and are computed at rejection time
 * (reworkAgentsForChange).
 */
const PLANNING_REWORK_AGENTS: Readonly<Partial<Record<CheckpointId, readonly string[]>>> = {
  1: ['02-story-writer'],
  2: ['03-spec-writer']
};

/**
 * What a rework moves aside when it starts (D-5): the documents the rejected checkpoint presented
 * or that were built on them, into `<runDir>/_superseded/<cycle>/`. A superseded document can then
 * never be read as current — the Stage 4 gate in particular can never pass on the rejected
 * VALIDATION_REPORT.md (MINOR-8).
 */
const SUPERSEDED_ON_REWORK: Readonly<Record<CheckpointId, readonly string[]>> = {
  1: ['USER_STORY.md'],
  2: ['TECHNICAL_BRIEF.md', 'FILE_LIST.md'],
  3: ['TEST_REPORT.md', 'VALIDATION_REPORT.md', CP3_FOLLOWUP_DOCUMENT]
};

/**
 * The PASS steps a rework invalidates, so the skip rule runs them again (D-5): the planning agent
 * for CP1/CP2; for CP3 the Test Verifier, the Validator and its follow-up review. Builders are never
 * invalidated — a CP3 rework re-runs them in their own `rework` phase, and their outputs are merged.
 * Skeptics have no step to invalidate: their verdicts belong to their evaluation (PR B-2 D-7).
 */
const INVALIDATED_ON_REWORK: Readonly<Record<CheckpointId, readonly string[]>> = {
  1: ['02-story-writer'],
  2: ['03-spec-writer'],
  3: ['06-test-verifier', '07-validator', '07b-validator-followup']
};

/** Each checkpoint by its id. */
const CHECKPOINT_BY_ID: Readonly<Record<CheckpointId, CheckpointDefinition>> = {
  1: CHECKPOINTS.STORY,
  2: CHECKPOINTS.BRIEF,
  3: CHECKPOINTS.CHANGE
};

/**
 * An agent that says it cannot proceed is believed.
 *
 * The live smoke test had the Researcher correctly return status:"ESCALATE" — it had found that
 * the feature was not implementable against the codebase — and the orchestrator would have
 * carried on to schema validation and the gate regardless. The agents are the ones looking at
 * the code; when one declares a blocker, that is a finding, not noise.
 */
function agentDeclaredBlocked(output: FeatureFactoryAgentOutput): boolean {
  return output.status === 'ESCALATE' || output.status === 'FAIL';
}

export interface OrchestrationOptions {
  featureName: string;

  /**
   * What to build. Required for a fresh run (a missing or blank one is refused DESCRIPTION_REQUIRED
   * before anything is written). On a resume it may be left out: the run's saved description is
   * used, and a different one is refused DESCRIPTION_MISMATCH after the run-state refusals (AC-99).
   * A blank one counts as not supplied (I-10).
   */
  featureDescription?: string;

  /**
   * Resume this run instead of starting a fresh one (D-2). Completed agents and approved
   * checkpoints are skipped, attempts are counted from state, an ESCALATED run is reopened, and
   * every gate for unfinished work is evaluated again.
   */
  resumeFromState?: FeatureState;

  /**
   * What the resume asks for (D-3). Defaults to a plain continue. Checked before anything is
   * written: a refusal is a thrown RunRefusedError and leaves state.json byte-identical.
   */
  resume?: ResumeRequest;

  /** The target project the agents build in. Artifact paths and gates resolve against this. */
  cwd: string;

  /**
   * The human checkpoints (CHECKPOINTS). Called before the run is allowed to continue.
   *
   * The orchestrator used to log "⏸️  CHECKPOINT 1: Awaiting story approval" and then
   * immediately record its own approval. It never waited for anyone. The system was claiming a
   * human-oversight guarantee it did not have — and a live Spec Writer noticed, refusing to
   * proceed because "Checkpoint 1 would have been skipped silently."
   *
   * This FAILS CLOSED. If no approver is supplied, the checkpoint is not silently granted — the
   * run escalates. Auto-approval must be asked for explicitly (the CLI's --yes), because a
   * checkpoint you can skip by forgetting to configure it is not a checkpoint.
   *
   * The approver is shown the full artifact (CheckpointRequest.text) and answers APPROVE, REJECT
   * or PAUSE (D-4); `true` / `false` still mean approve / reject, and any other value pauses.
   */
  approveCheckpoint?: (checkpoint: CheckpointRequest) => Promise<CheckpointDecision | boolean>;

  /**
   * A spec produced upstream — by a Tier 1 Decomposer, by a human, by anything.
   *
   * OPTIONAL, and that is the whole point. Omit it and Feature Factory runs its own Researcher,
   * Story Writer and Spec Writer exactly as it always has. Supply it and those stages are
   * skipped — but only if it passes the very same gates their output would have had to pass.
   *
   * See contracts/feature-spec.ts.
   */
  preSuppliedSpec?: FeatureSpec;

  /**
   * How agents are run. Injected rather than imported so the gates can be exercised without a
   * network: production passes createSdkInvoker(...), tests pass a scripted fake. The harness
   * is indifferent to which — it judges the output, not its provenance.
   */
  invoke: AgentInvoker;

  /**
   * Replace Gate 1.5 / Gate 2's audits. Omitted entries fall back to DEFAULT_GATES, the real
   * ones. Tests pass fakes; production passes nothing.
   */
  gates?: Partial<OrchestrationGates>;

  /**
   * How the CP3 change is captured and collected, and how the Stage 3 snapshots are written (D-8,
   * B-1 D-3). Omitted entries fall back to DEFAULT_CHANGE_TRACKER, the real git one: it reads, and
   * writes only under refs/factory/<id>/. Tests pass a fake, so only the change-diff and snapshot
   * tests run git.
   */
  changes?: Partial<ChangeTracker>;

  /**
   * How the run's state is saved (AC-104). TESTS ONLY; omitted = the durable saveState
   * (state-store.ts: temp file, fsync, rename, fsync the directory), which is what production
   * always uses. Tests that never kill the machine pass a writer without the fsyncs
   * (test/fixtures/state-writer.ts), which writes the same path and bytes. A repo-hygiene test
   * checks that no production code passes this.
   */
  stateWriter?: (cwd: string, state: FeatureState) => void;

  /**
   * Where the main Validator's read-only review copies are made (PR B-2 D-3, D-20). TESTS ONLY;
   * omitted = the OS temp directory (its realpath), which is what production always uses: a copy
   * inside the project would be collected by its test runner. A repo-hygiene test checks that no
   * production code passes this.
   */
  reviewRoot?: string;

  logger?: (message: string) => void;
}

/**
 * Execute a feature through stages 1-4 and CHECKPOINT 3.
 */
export async function runFeatureFactory(options: OrchestrationOptions): Promise<FeatureState> {
  const cwd = options.cwd;

  /** The CP3 change is captured and collected ONLY through this object, so an injected tracker can never be bypassed. */
  const changes: ChangeTracker = {
    captureBase: options.changes?.captureBase ?? DEFAULT_CHANGE_TRACKER.captureBase,
    collect: options.changes?.collect ?? DEFAULT_CHANGE_TRACKER.collect,
    snapshot: options.changes?.snapshot ?? DEFAULT_CHANGE_TRACKER.snapshot,
    extractSnapshot: options.changes?.extractSnapshot ?? DEFAULT_CHANGE_TRACKER.extractSnapshot,
    changedSince: options.changes?.changedSince ?? DEFAULT_CHANGE_TRACKER.changedSince,
    workingTreeId: options.changes?.workingTreeId ?? DEFAULT_CHANGE_TRACKER.workingTreeId
  };

  const log = options.logger ?? ((message: string) => console.log(`[FF] ${message}`));

  /** Every state save of this run goes through here: the durable store unless a test injected a writer (AC-104). */
  const save = options.stateWriter ?? saveState;
  const phase = (title: string) => log(`\n=== ${title} ===`);

  /** Where review copies are made (PR B-2 D-3): outside the project, in the OS temp directory unless a test says otherwise. */
  const reviewParent = options.reviewRoot ?? realpathSync(tmpdir());

  // Pre-flight (§4), OUTSIDE the try: a refusal is a thrown RunRefusedError with nothing of this
  // run written. A fresh start first archives finished runs into .factory/_archive/ — previous
  // runs' briefs must not sit in the workspace the agents read, and nothing is ever deleted — and
  // is refused while an unfinished run exists (AC-40, AC-41). A resume touches no other run.
  const resumed = options.resumeFromState;
  if (options.resume && !resumed) {
    throw new TypeError('A resume request needs resumeFromState: there is no run to resume.');
  }

  // AC-97: the FIRST check, for a fresh start and a resume alike, before anything reads the run
  // directory through a path the file system could case-fold, and before any write. `.Factory`
  // escapes git's exact `:(exclude).factory` (AC-98), so a case variant is refused, never guessed.
  assertNoFactoryCaseVariant(cwd);
  const resumeRequest: ResumeRequest | undefined = resumed ? (options.resume ?? { action: { kind: 'continue' } }) : undefined;

  /** The description this run is briefed with; decided here, before any write (AC-99). */
  let featureDescription: string;

  if (resumed && resumeRequest) {
    // D-3: refused before anything is written, so a refusal leaves state.json byte-identical.
    checkResumeRequest(resumed, resumeRequest);

    // AC-99, after the run-state refusals: a different description is refused (DESCRIPTION_MISMATCH),
    // and a run recorded without one (pre-A-2) needs one supplied, never a guess (AC-37).
    featureDescription = checkResumeDescription(resumed, options.featureDescription);

    // A paused run waits for a decision; a plain continue is not one (I-2). Nothing is written.
    if (classifyRun(resumed) === 'PAUSED' && resumeRequest.action.kind === 'continue') {
      log(`⏸️  ${resumed.pendingCheckpoint?.name ?? 'A checkpoint'} is still waiting for a decision; nothing was run.`);
      log(`  📋 Run record: ${stateFilePath(cwd, resumed.featureId)}`);
      return resumed;
    }

    // Re-built exactly as first presented — the same files, findings and change — so a hash
    // compares like with like (AC-52, I-7). Reads only.
    const resumedRunDir = resolve(cwd, `.factory/${resumed.featureId}`);
    const resumedOutputs = rebuildOutputs(resumed, cwd);
    const representCheckpoint = (id: CheckpointId) => presentCheckpoint(id, resumed, resumedOutputs, resumedRunDir, cwd, changes);

    // AC-52: `--approve` approves what was presented, or nothing.
    if (resumeRequest.action.kind === 'approve') await assertPendingUnchanged(resumed, representCheckpoint, cwd);

    // I-7: nothing may run on a story, brief or change that differs from what a human approved.
    await assertApprovedArtifactsUnchanged(resumed, representCheckpoint, resumedRunDir, cwd);
  } else {
    // AC-99: a new run needs something to build, refused before the run directory is prepared.
    const supplied = options.featureDescription;
    if (typeof supplied !== 'string' || supplied.trim() === '') {
      throw new RunRefusedError('DESCRIPTION_REQUIRED', 'A new run needs a feature description (--feature).');
    }
    featureDescription = supplied;
  }

  const archivedRuns = resumed ? [] : prepareNewRunDirectory(cwd).archived;
  let state = resumed || createFeatureState(options.featureName, undefined, featureDescription);

  // A resumed run recorded without a description saves the supplied one, committed before any
  // agent runs, so every later resume briefs its agents with it (AC-37). Checked in the pre-flight.
  if (resumed && resumed.featureDescription === undefined) {
    state = recordFeatureDescription(state, featureDescription);
    save(cwd, state);
  }

  // A fresh run records where its change starts — HEAD now, before any agent writes anything — so
  // CP3 can show everything that changed since (D-8, I-4). Committed before the first agent runs.
  // A resume never captures a new base: the change is always measured from the run's start.
  if (!resumed) {
    state = recordChangeBase(state, await changes.captureBase(cwd));
    save(cwd, state);
  }

  const invokeAgent = options.invoke;

  /** Audits are called ONLY through this object, so an injected gate can never be bypassed. */
  const gates: OrchestrationGates = {
    auditInfrastructure: options.gates?.auditInfrastructure ?? DEFAULT_GATES.auditInfrastructure,
    auditExecution: options.gates?.auditExecution ?? DEFAULT_GATES.auditExecution
  };
  /**
   * Accumulates real agent outputs; the gates are built from this, never from constants. A resume
   * starts from the outputs its record holds (D-2): every completed step, keyed by output.agent.
   */
  const outputs: StageOutputs = resumed ? rebuildOutputs(state, cwd) : {};

  /** Re-derive the outputs from the record, in place: after a rework invalidated steps (D-5). */
  const refreshOutputs = () => {
    for (const key of Object.keys(outputs) as Array<keyof StageOutputs>) delete outputs[key];
    Object.assign(outputs, rebuildOutputs(state, cwd));
  };

  /** Namespaced per run, so one feature's documents never stomp another's. */
  const artifactDir = `.factory/${state.featureId}`;
  /** The same directory, absolute: where a checkpoint reads what it presents. */
  const runDirAbs = resolve(cwd, artifactDir);

  /**
   * Persist the run's state after a transition, and hand it back so call sites read naturally:
   *
   *     state = commit(recordAgentStep(state, 1, '01-researcher', 'PASS', output));
   *
   * WHERE this is called is the design, not an implementation detail. It wraps exactly the
   * transitions a resume could restart from — a completed agent step, a stage advance, a
   * checkpoint approval (AC-38), a builder attempt or loop-back, and each timed agent invocation
   * (D-13). Nothing finer is worth saving because nothing finer is resumable: an agent that died
   * halfway through has to be re-run from the beginning regardless, since its partial work
   * never reached the harness.
   *
   * FAILS CLOSED. The save (saveState, or a test's stateWriter) throws StatePersistenceError and this does not catch it.
   *
   * An earlier version warned and continued, reasoning that losing resumability was cheaper than
   * discarding completed agent work. That traded the wrong thing away. Everything this harness
   * guarantees is a guarantee about evidence, and a run that cannot write its record produces
   * none — it keeps spending tokens, keeps writing code into the project, and arrives at an
   * outcome nobody can audit or resume. Stopping costs the work in flight. Continuing costs the
   * work in flight, plus everything spent after, plus any way to reconstruct what happened.
   *
   * The throw lands in runFeatureFactory's outer catch, which records the escalation and calls
   * finish() — whose own save fails the same way, so the error reaches the CLI and the process
   * exits non-zero. That is the correct end state: loud, and impossible to mistake for success.
   */
  const commit = (next: FeatureState): FeatureState => {
    save(cwd, next);
    return next;
  };

  /**
   * End the run, and leave the receipt on disk.
   *
   * Every exit from runFeatureFactory goes through here — twenty-six escalations and the one
   * success — which is what makes "a finished run always has a state file" true by construction
   * rather than by remembering to add a save next to each `return`. If you add an exit path,
   * use this; a bare completeFeature() would return a run that left no record of why it ended.
   *
   * An escalation closes every open verification evaluation (PR B-2 D-7, I-6), so a resume after
   * it starts a new one and re-runs the Validator. Only a kill, which never gets here, leaves one
   * open for the resume to continue. Never called while a parallel verification branch runs (D-8).
   * Before it closes them, the IMPORTANT issues of an open evaluation whose Validator output is on
   * record are recorded once under 07-validator (MINOR-5): never decided, they would otherwise
   * never reach CHECKPOINT 3.
   */
  const finish = (
    current: FeatureState,
    status: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP',
    summary: string
  ): FeatureState => {
    if (status === 'ESCALATED') {
      const kept = addImportantFindingsOnce(current, 4, '07-validator', escalatedReviewFindings(current.validatorEvaluations ?? [], cwd));
      logFindings('07-validator', kept.added);
      current = kept.next;
    }
    const closed = status === 'ESCALATED' ? closeOpenEvaluations(current, new Date().toISOString()) : current;
    const completed = commit(completeFeature(closed, status, summary));
    log(`  📋 Run record: ${stateFilePath(cwd, completed.featureId)}`);
    return completed;
  };

  /**
   * Persist a read-only agent's documents to disk IMMEDIATELY, so the next agent in the stage
   * can actually read them. Waiting until the stage gate is what left the Spec Writer with no
   * USER_STORY.md to translate.
   */
  const persist = (partial: StageOutputs) => {
    const written = persistArtifacts(partial, cwd, artifactDir);
    // Read back right after the write, before anything else can run (D-12).
    checkDocuments(state.currentStage, writtenDocuments(cwd, written.map(({ path }) => path)));
    for (const { agent, path } of written) {
      log(`  📄 ${agent} → ${path}`);
    }
  };

  /**
   * The count a Gate 2 evaluation must not fall below (D-12, D-A). The run's first evaluation
   * (round 0) is judged against the higher of the run's first passing count and
   * `.factory/baseline.json`; every later one — the validator rounds — against the higher of the
   * run's first passing count and the reference recorded on round 0. A round never re-reads the
   * baseline file, and the bar never drops.
   *
   * Called BEFORE the audit and OUTSIDE its try: a baseline file that exists but cannot be
   * trusted throws RegressionBaselineError, which must reach the outer catch and escalate the run.
   * It is never read as "no baseline" — that would quietly lower the bar.
   */
  const gate2Reference = (round: number): number | undefined =>
    round === 0
      ? regressionReference(state.executionGateHistory, readRegressionBaseline(cwd))
      : validatorRoundReference(state.executionGateHistory);

  /** Record and commit one Gate 2 evaluation, from the audit's own parse of the test output. */
  const recordGate2 = (round: number, decision: ExecutionGateDecision, referenceCount: number | undefined) => {
    const stats = decision.testStats;
    state = commit(
      recordExecutionGate(state, {
        round,
        total: stats?.total ?? 0,
        passed: stats?.passed ?? 0,
        failed: stats?.failed ?? 0,
        passRate: decision.passRate,
        canAdvance: decision.canAdvance,
        referenceCount
      })
    );
  };

  /**
   * What the Stage 4 gate judges (D-5, PR B-2 D-12): "No Regressions" on the latest Gate 2 record
   * and its reference; "Validation Passed" on the typed verdict of the current cycle's latest
   * decided evaluation. A run whose Validator PASS was recorded before B-2 has no evaluation in
   * this cycle, and is judged on the legacy verdict from the raw issue list (I-27). A cycle with
   * evaluations but none decided gives no verdict, so the gate fails closed.
   */
  const stage4Evidence = (): HarnessMeasurements => {
    const validation: ValidationVerdict | undefined = stage4Verdict(state, currentReworkCycle(state), outputs.validator);
    const history = state.executionGateHistory ?? [];
    const latest = history[history.length - 1];
    if (!latest) return validation ? { validation } : {};
    const execution: ExecutionMeasurement = {
      total: latest.total,
      passed: latest.passed,
      failed: latest.failed,
      passRate: latest.passRate
    };
    return { execution, regressionReferenceCount: latest.referenceCount, ...(validation ? { validation } : {}) };
  };

  /**
   * Record non-blocking findings and commit (AC-17). IMPORTANT criteria no longer block; this is
   * where what they found goes instead, so it is never silently dropped.
   */
  const recordFindings = (stage: number, source: string, messages: string[]) => {
    if (messages.length === 0) return;
    logFindings(source, messages);
    state = commit(recordImportantFindings(state, stage, source, messages));
  };

  const logFindings = (source: string, messages: readonly string[]) => {
    for (const message of messages) log(`  ⚠️  [${source}] ${message}`);
  };

  /**
   * Like recordFindings, but a message the run already holds from `source` is skipped (D-12):
   * re-checking the same evidence adds nothing. Logs and commits only what is new.
   */
  const recordFindingsOnce = (stage: number, source: string, messages: string[]) => {
    const { next, added } = addImportantFindingsOnce(state, stage, source, messages);
    if (added.length === 0) return;
    logFindings(source, added);
    state = commit(next);
  };

  /**
   * The document check (AC-107, D-12): read back documents the harness just wrote and record one
   * IMPORTANT finding per document that holds an invisible or direction-control character. Every
   * harness write of an agent's or a harness-rendered document is followed by this. A resume that
   * re-renders identical content gives identical messages, so nothing is added twice.
   */
  const checkDocuments = (stage: number, files: DocumentFile[]) => {
    recordFindingsOnce(stage, DOCUMENT_CHECK_SOURCE, documentFindings(files));
  };

  /** Evaluate a stage gate against this run's evidence, and keep its IMPORTANT findings. */
  const stageGate = async (
    stage: number,
    extra?: {
      loops?: BuildStageContextInput['loops'];
      harness?: HarnessMeasurements;
      /** Judge against this part of the stage's contract instead of the whole (the split Stage 2 gate, C-9). */
      contract?: StageContract;
    }
  ): Promise<StageAdvancementDecision> => {
    const decision = await checkStageGate(stage, cwd, outputs, { ...extra, artifactDir });
    recordFindings(stage, 'stage-gate', decision.importantFindings);
    return decision;
  };

  /** What every prompt builder needs; prompts are built at invocation time (agent-prompts.ts). */
  const promptCtx: PromptContext = {
    cwd,
    artifactDir,
    // A resume briefs agents with the description the run was started with (AC-37).
    featureDescription: state.featureDescription ?? featureDescription
  };

  /**
   * Invoke an agent, and record and commit how long it took (D-13).
   *
   * Every agent invocation goes through here, so `state.agentInvocations` and
   * `metrics.timePerStage` cover the whole run. The returned `timing` is the same start and end,
   * for the step that records the agent's result. An invocation that throws is recorded too, with
   * `outcome: 'threw'` and the first line of the error (at most 500 characters), committed, and
   * the error is rethrown (PR B-2 I-16): with two agents in parallel, both must be on record
   * (AC-124). The error then reaches the outer catch, which escalates.
   */
  const timedInvoke = async (call: AgentInvocation, meta: InvocationMeta = {}): Promise<TimedInvocation> => {
    const started = new Date();
    const record = (completed: Date, failure?: { error: unknown }) =>
      recordAgentInvocation(state, {
        stage: call.stage,
        agent: call.agent,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        ...(meta.phase !== undefined ? { phase: meta.phase } : {}),
        ...(meta.round !== undefined ? { round: meta.round } : {}),
        ...(meta.attempt !== undefined ? { attempt: meta.attempt } : {}),
        ...(meta.evaluation !== undefined ? { evaluation: meta.evaluation } : {}),
        ...(meta.instance !== undefined ? { instance: meta.instance } : {}),
        ...(failure ? { outcome: 'threw' as const, error: invocationError(failure.error) } : {})
      });

    let output: unknown;
    try {
      output = await invokeAgent(call);
    } catch (error) {
      state = commit(record(new Date(), { error }));
      throw error;
    }
    const completed = new Date();
    state = commit(record(completed));
    return { output, timing: { startedAt: started.toISOString(), completedAt: completed.toISOString() } };
  };

  /** Render a harness document into the run dir (only) and log where it went. */
  const writeDocument = (name: HarnessRenderedArtifact, content: string) => {
    const path = writeHarnessDocument(cwd, artifactDir, name, content);
    checkDocuments(state.currentStage, writtenDocuments(cwd, [path]));
    log(`  📄 harness → ${path}`);
  };

  /**
   * Who re-runs when checkpoint `id` is rejected (D-5). CP3's rework goes to the builders whose
   * files are in the change, decided at rejection time and stored, so the resume that starts the
   * rework is deterministic (I-10).
   */
  const reworkAgentsFor = (id: CheckpointId, name: string, changedFiles: readonly string[] | undefined): string[] => {
    const reworkAgents = id === 3 ? reworkAgentsForChange(outputs, changedFiles ?? [], cwd) : PLANNING_REWORK_AGENTS[id];
    if (!reworkAgents || reworkAgents.length === 0) {
      throw new Error(`${name}: no rework agents are defined for a rejection.`);
    }
    return [...reworkAgents];
  };

  /**
   * A checkpoint that actually blocks (D-4). Returns undefined when the human APPROVED, and the
   * state when the run must stop: finished ESCALATED (rejected, no approver, nothing to present)
   * or PAUSED — committed, deliberately NOT finished, so it resumes at this checkpoint (AC-49).
   *
   * The presentation is built first, from files (and, for CP3, the run's findings and the change)
   * only, so the hash the approval binds to is the hash of exactly what was shown, and `--approve`
   * can re-build it (AC-50, AC-52). Anything that cannot be presented escalates without asking
   * anyone: nobody approves what they were not shown.
   */
  const checkpoint = async (
    definition: CheckpointDefinition,
    present: () => CheckpointPresentation | Promise<CheckpointPresentation>
  ): Promise<FeatureState | undefined> => {
    const { id, name, stage } = definition;
    log(`⏸️  ${name}`);

    let presentation: CheckpointPresentation;
    try {
      presentation = await present();
    } catch (error) {
      if (!(error instanceof CheckpointPresentationError)) throw error;
      const blockers = error.missing.length > 0 ? error.missing : [error.message];
      state = recordEscalation(state, stage, 'harness', 'CRITICAL_ISSUE', error.message, { blockers });
      return finish(state, 'ESCALATED', `${name} could not be presented`);
    }

    if (!options.approveCheckpoint) {
      state = recordEscalation(
        state,
        stage,
        'human',
        'MANUAL',
        `${name} requires human approval, but no approver is configured. ` +
          `Pass approveCheckpoint, or run the CLI with --yes to approve automatically.`
      );
      return finish(state, 'ESCALATED', `${name} requires human approval`);
    }

    const { text, sha256, artifactPaths, changedFiles } = presentation;
    const decision = normaliseDecision(
      await options.approveCheckpoint({ id, name, stage, text, sha256, artifactPaths: [...artifactPaths] })
    );
    /** The run record names documents relative to the project, like every other path it keeps. */
    const recordedPaths = artifactPaths.map(path => relative(cwd, path));

    switch (decision.decision) {
      case 'APPROVE':
        // Committed before anything else runs (AC-38): an approval is a transition a resume
        // restarts from, so it must be on disk before the next agent can spend anything on the
        // strength of it. Bound to the hash of the full text presented, never a summary (AC-50).
        state = commit(
          recordCheckpointApproval(state, stage, name, decision.approvedBy, undefined, { checkpointId: id, sha256 })
        );
        log(`✅ ${name} approved`);
        return undefined;

      case 'PAUSE':
        // The one exit that does not go through finish(): a paused run is not over (AC-49).
        state = commit(
          recordPause(state, {
            checkpointId: id,
            name,
            stage,
            artifactPaths: recordedPaths,
            sha256,
            ...(changedFiles ? { changedFiles } : {})
          })
        );
        log(`⏸️  ${name}: paused, waiting for a decision.`);
        log(`  📋 Run record: ${stateFilePath(cwd, state.featureId)}`);
        return state;

      case 'REJECT': {
        const notes = decision.notes ?? '';
        state = recordCheckpointRejection(state, {
          checkpointId: id,
          name,
          stage,
          notes,
          sha256,
          artifactPaths: recordedPaths,
          reworkAgents: reworkAgentsFor(id, name, changedFiles),
          source: 'approver'
        });
        state = recordEscalation(state, stage, 'human', 'MANUAL', `${name} was rejected.`, { checkpointId: id, notes });
        return finish(state, 'ESCALATED', `${name} was rejected`);
      }
    }
  };

  /**
   * The story half of Stage 2's review: the story gate, then CHECKPOINT 1. A story the gate
   * rejects is never put in front of a human (AC-56); either way a failure carries its blockers
   * (AC-57).
   */
  const reviewStory = async (): Promise<FeatureState | undefined> => {
    const decision = await stageGate(2, { contract: STAGE2_STORY_CONTRACT });
    if (!decision.canAdvance) {
      // I-6: the story this gate judged is not done. A resume re-runs its producer (a pre-supplied
      // run's tier-1 step is matched by its output's agent), instead of re-failing on it forever.
      state = invalidateAgentSteps(state, ['02-story-writer'], `Story gate failed: ${decision.reason}`);
      state = recordEscalation(
        state,
        2,
        'harness',
        'CRITICAL_ISSUE',
        `Story gate failed: ${decision.reason}`,
        { blockers: decision.blockers }
      );
      return finish(state, 'ESCALATED', decision.reason);
    }
    log(`✅ Story gate passed`);

    return checkpoint(CHECKPOINTS.STORY, () => presentCheckpoint(1, state, outputs, runDirAbs, cwd, changes));
  };

  /**
   * The brief half: the spec gate, then CHECKPOINT 2 (AC-78), then Stage 3. The run stays in
   * Stage 2 until the brief is approved.
   */
  const reviewBrief = async (): Promise<FeatureState | undefined> => {
    const decision = await stageGate(2, { contract: STAGE2_SPEC_CONTRACT });
    if (!decision.canAdvance) {
      state = invalidateAgentSteps(state, ['03-spec-writer'], `Spec gate failed: ${decision.reason}`); // I-6
      state = recordEscalation(
        state,
        2,
        'harness',
        'CRITICAL_ISSUE',
        `Spec gate failed: ${decision.reason}`,
        { blockers: decision.blockers }
      );
      return finish(state, 'ESCALATED', decision.reason);
    }
    log(`✅ Spec gate passed`);

    const stopped = await checkpoint(CHECKPOINTS.BRIEF, () => presentCheckpoint(2, state, outputs, runDirAbs, cwd, changes));
    if (stopped) return stopped;

    state = commit(advanceToStage(state, 3));
    return undefined;
  };

  // ==========================================================================================
  // Builders and the gates a validator round re-runs (D-9)
  //
  // Each helper returns the finished state when the run must stop, and undefined (or the
  // builder's output) when it may continue. They are used by Stage 3 AND by every validator
  // round, so a round is judged by exactly the code that judged the original build.
  // ==========================================================================================

  /**
   * Attempts each builder used in its most recent loop, and the attempts that loop was allowed:
   * what the Stage 3 gate's loop criterion reads (AC-72). A resume starts from the Stage 3 counts
   * in state, so the gate judges the attempts actually spent, not just this process's.
   */
  const lastAttempts: { backend?: number; frontend?: number } = {};
  const lastAllowed: { backend?: number; frontend?: number } = {};
  if (resumed) {
    for (const half of ['backend', 'frontend'] as const) {
      const agent = BUILDER_AGENT[half];
      if (!hasPass(state, agent, { phase: 'stage3' })) continue;
      lastAttempts[half] = usedAttempts(state, agent, { phase: 'stage3' });
      lastAllowed[half] = allowedAttempts(state, agent, { phase: 'stage3' });
    }
  }

  /**
   * Run one builder in one phase — the Stage 3 build, or one validator round — for the attempts
   * that phase still has. Attempts come from STATE (AC-36): a loop runs attempts `used + 1` to
   * `allowed`, where `allowed` is MAX_BUILDER_ATTEMPTS plus any operator grant (AC-72), so an
   * attempt killed in flight stays spent, and a phase with nothing left escalates MAX_LOOPS without
   * invoking anyone. Each attempt is counted in state and committed BEFORE the invocation (AC-70).
   * Records keep stage 3 and carry the phase; escalations use the stage the RUN is in — 3 while
   * building, 4 during a validator round (AC-33).
   */
  const runBuilderLoop = async <H extends BuilderHalf>(
    half: H,
    run: BuilderRun
  ): Promise<{ output: BuilderOutputFor<H> } | { finished: FeatureState }> => {
    const agent = BUILDER_AGENT[half];
    const label = half === 'backend' ? 'Backend' : 'Frontend';
    // A validator round and a CP3 rework both happen while the run is in Stage 4.
    const escalationStage = run.phase === 'stage3' ? 3 : 4;
    const where =
      run.phase === 'validator-round'
        ? ` in validator round ${run.round}`
        : run.phase === 'rework'
          ? ` in the CHECKPOINT 3 rework (cycle ${run.round})`
          : '';
    /** The attempt budget this loop spends; named in the MAX_LOOPS escalation so a resume can grant more (D-3). */
    const builderPhase: BuilderPhase = run.phase === 'stage3' ? { phase: 'stage3' } : { phase: run.phase, round: run.round };
    const phase: StepPhase = { ...builderPhase };
    const validatorRound: ValidatorRoundFailure | undefined =
      run.phase === 'validator-round'
        ? { kind: 'validator', round: run.round, maxRounds: MAX_VALIDATOR_ROUNDS, issues: run.issues }
        : undefined;
    const used = usedAttempts(state, agent, builderPhase);
    const allowed = allowedAttempts(state, agent, builderPhase);
    /**
     * Carried into the next attempt's prompt — the only channel between two fresh contexts. A
     * resumed loop starts from the failure its last committed loop-back recorded (D-2).
     */
    let failure: BuilderFailure | undefined = used > 0 ? asBuilderFailure(lastBuilderFailure(state, agent, builderPhase)) : undefined;

    for (let attempt = used + 1; attempt <= allowed; attempt++) {
      log(`${label} Builder${where}: Attempt ${attempt}/${allowed}`);
      state = commit(recordBuilderAttempt(state, agent, builderPhase));

      const invocation = await timedInvoke(
        {
          stage: 3,
          agent,
          prompt: builderPrompt(promptCtx, half, attempt, failure, validatorRound, {
            attemptsAllowed: allowed,
            ...(run.phase === 'rework' ? { rework: run.rework } : {})
          })
        },
        { ...phase, attempt }
      );
      const candidate: BuilderOutputFor<H> = invocation.output;

      // MINOR-10: no envelope at all (null, a string, a number…) is a schema failure like any
      // other malformed one: retried, briefed with the schema error. Reading a field off it here
      // used to throw past this loop and escalate MANUAL, hiding the cause.
      if (candidate === null || typeof candidate !== 'object') {
        const validation = validateOutputSchema(3, agent, candidate);
        const schemaFailure = { kind: 'schema' as const, error: validation.errors[0] };
        failure = schemaFailure;
        state = commit(
          recordLoopBack(state, 3, agent, `Output schema invalid: ${validation.errors[0]}`, 'FAIL', undefined, phase, schemaFailure)
        );
        continue;
      }

      // A builder that declares itself blocked is believed. It is the one that just read the
      // code; when it says it cannot proceed, that is a finding, not noise.
      if (candidate.status === 'ESCALATE') {
        state = recordEscalation(
          state,
          escalationStage,
          agent,
          'CRITICAL_ISSUE',
          `${agent} refused to build${where}: ${candidate.details?.summary}`
        );
        return { finished: finish(state, 'ESCALATED', `${agent} declared the build blocked`) };
      }

      // FAILING TESTS ARE CHECKED BEFORE THE SCHEMA, and the order is the point.
      //
      // validateOutputSchema treats testsFailed > 0 as a schema error ("Builder has failing
      // tests: N") — it validates "acceptable work", not just envelope shape. So while the
      // schema check ran first, a builder that reported a failing test was classified as having
      // returned a malformed envelope, this branch `continue`d before reaching the analysis
      // below, and analyzeError() in the builder loop was DEAD CODE from the day it was written.
      //
      // A builder that honestly reports a failing test has satisfied its output contract
      // exactly. That is a work result with a designed remediation path, not a contract
      // violation, and it is handled here. The schema check below still catches every genuinely
      // malformed envelope, which is what it is for.
      if (candidate.details?.testing && candidate.details.testing.testsFailed > 0) {
        const failedTest = candidate.details.testing.failingTests?.[0];

        if (failedTest?.error) {
          // Classify, and CARRY THE CLASSIFICATION INTO THE NEXT ATTEMPT. The state record
          // alone is not enough: the next builder is a fresh context that cannot read it.
          // The loop-back carries the same failure and is committed, so a resumed attempt can be
          // briefed exactly as this loop's next attempt is (D-2).
          const errorAnalysis = analyzeError(failedTest.error);
          const testFailure = { kind: 'test' as const, error: failedTest.error };
          failure = testFailure;
          state = commit(
            recordLoopBack(
              state,
              3,
              agent,
              `${errorAnalysis.category}: ${failedTest.error}`,
              'FAIL',
              `Apply: ${errorAnalysis.fixClass}`,
              phase,
              testFailure
            )
          );
        } else {
          // Tests failed but the builder named none. Do not invent a diagnosis.
          failure = undefined;
          state = commit(
            recordLoopBack(
              state,
              3,
              agent,
              `${candidate.details.testing.testsFailed} test(s) failing, none named`,
              'FAIL',
              undefined,
              phase
            )
          );
        }
        continue;
      }

      const validation = validateOutputSchema(3, agent, candidate);
      if (!validation.valid) {
        const schemaFailure = { kind: 'schema' as const, error: validation.errors[0] };
        failure = schemaFailure;
        state = commit(
          recordLoopBack(state, 3, agent, `Output schema invalid: ${validation.errors[0]}`, 'FAIL', undefined, phase, schemaFailure)
        );
        continue;
      }

      // MINOR-6: a valid envelope whose builder says the work is not done (FAIL or LOOP_BACK with
      // no failing test) is a failed attempt, never a PASS. Its own summary briefs the next one.
      if (candidate.status !== 'PASS') {
        const statusFailure = {
          kind: 'status' as const,
          error: `Builder returned status ${candidate.status}: ${candidate.details.summary}`
        };
        failure = statusFailure;
        state = commit(recordLoopBack(state, 3, agent, statusFailure.error, 'FAIL', undefined, phase, statusFailure));
        continue;
      }

      state = commit(recordAgentStep(state, 3, agent, 'PASS', candidate, undefined, phase, invocation.timing));
      lastAttempts[half] = attempt;
      lastAllowed[half] = allowed;
      log(`✅ ${label} builder passed${where} (${attempt === 1 ? 'first try' : `after ${attempt} attempts`})`);
      return { output: candidate };
    }

    state = recordEscalation(
      state,
      escalationStage,
      agent,
      'MAX_LOOPS',
      `${label} builder exceeded max attempts (${allowed})${where}`,
      { loopCount: usedAttempts(state, agent, builderPhase), builderPhase }
    );
    return { finished: finish(state, 'ESCALATED', `${label} builder max loops exceeded${where}`) };
  };

  /**
   * Gate 1: every file the builders claim exists on disk — and none of them is the harness's own.
   * Over the MERGED claims during a validator round.
   */
  const materializationGate = async (escalationStage: 3 | 4): Promise<FeatureState | undefined> => {
    log('\n🔍 Verifying artifact materialization (checking if claimed files actually exist)...\n');

    // The same claim set buildStageContext uses: one implementation (stage-context.ts).
    const claimedFiles = claimedFilesFromBuilders(outputs.backend, outputs.frontend);

    // Everything under .factory/ was written by the harness. A builder claiming it would satisfy
    // this gate with the harness's own output, so such a claim is rejected before existence is
    // even checked: it names a file the builder did not write.
    const harnessOwned = claimsInsideFactoryDir(claimedFiles, cwd);
    if (harnessOwned.length > 0) {
      log('\n❌ CRITICAL: Builders claimed files inside .factory/, which only the harness writes:\n');
      harnessOwned.forEach(p => log(`  ❌ ${p}`));
      state = recordEscalation(
        state,
        escalationStage,
        'harness',
        'HALLUCINATION_DETECTED',
        `${harnessOwned.length} claimed file(s) inside .factory/, which only the harness writes: ${harnessOwned.join(', ')}`,
        { blockers: harnessOwned.map(p => `${p} is inside .factory/; a builder cannot claim a harness-written file`) }
      );
      return finish(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files inside .factory/');
    }

    // The same for the review copies (PR B-2 D-15, AC-117): they are outside the project, and only
    // the harness writes there. A claim inside one names a file no builder wrote.
    const inCopies = insideReviewCopies(
      claimedFiles.map(claim => claim.path),
      (state.validatorEvaluations ?? []).flatMap(reviewCopyDirs),
      cwd
    );
    if (inCopies.length > 0) {
      log('\n❌ CRITICAL: Builders claimed files inside a review copy, which only the harness writes:\n');
      inCopies.forEach(p => log(`  ❌ ${p}`));
      state = recordEscalation(
        state,
        escalationStage,
        'harness',
        'HALLUCINATION_DETECTED',
        `${inCopies.length} claimed file(s) inside a review copy, which only the harness writes: ${inCopies.join(', ')}`,
        { blockers: inCopies.map(p => `${p} is inside a review copy; a builder cannot claim a harness-written file`) }
      );
      return finish(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files inside a review copy');
    }

    const artifactAudit = await verifyArtifactMaterialization(3, 'builders', claimedFiles, cwd);

    log(generateMaterializationReport(artifactAudit));

    if (!artifactAudit.allMaterialized) {
      log('\n❌ CRITICAL: Hallucination detected!\n');
      log(`${artifactAudit.missingArtifacts.length} claimed files do not exist on disk:`);
      artifactAudit.missingArtifacts.forEach(f => {
        log(`  ❌ ${f.path}`);
      });

      state = recordEscalation(
        state,
        escalationStage,
        'harness',
        'HALLUCINATION_DETECTED',
        `${artifactAudit.missingArtifacts.length} claimed files not materialized`,
        { missingFiles: artifactAudit.missingArtifacts.map(f => f.path) }
      );
      return finish(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files that do not exist');
    }

    log(`\n✅ All ${claimedFiles.length} artifacts verified to exist on disk\n`);
    return undefined;
  };

  /**
   * The snapshot after a passing Stage 3 gate in phase `at` (PR B-1, D-5; AC-81, AC-85 to AC-88).
   * Committed before anything else runs, so the next agent is only ever invoked with the snapshot
   * on record. Never touches the branch, the index or the working tree (the tracker writes only
   * under refs/factory/<id>/).
   *
   *  - No git base (outside git, or a run recorded before A-2): a `skipped` record; the run goes on.
   *  - `n` is the phase's own number when it has one, so a gate re-evaluated on resume rewrites the
   *    same `stage3-<n>` (an unchanged tree reuses its commit); otherwise the next one.
   *  - HEAD moved since the run started: HEAD_MOVED, nothing written. Git could not write it:
   *    SNAPSHOT_FAILED with git's text, nothing recorded. Both finish the run ESCALATED, resumable;
   *    no builder's PASS is invalidated, and the gate (with its snapshot) runs again on resume.
   */
  const takeSnapshot = async (escalationStage: 3 | 4, at: BuilderPhase): Promise<FeatureState | undefined> => {
    const base = state.changeBase;
    if (base === undefined || base.kind === 'none') {
      const reason = base === undefined ? 'the run recorded no change base' : NOT_GIT_SNAPSHOT_REASON;
      log(`  📸 No snapshot after the Stage 3 gate: ${reason}`);
      state = commit(recordStage3Snapshot(state, { status: 'skipped', reason, at, takenAt: new Date().toISOString() }));
      return undefined;
    }

    const n = stage3SnapshotNumber(state, at);
    const result = await changes.snapshot(cwd, base, state.featureId, n);
    switch (result.kind) {
      case 'written':
        state = commit(
          recordStage3Snapshot(state, {
            status: 'written',
            n,
            ref: result.ref,
            commit: result.commit,
            tree: result.tree,
            at,
            takenAt: new Date().toISOString(),
            ...(result.reused ? { reused: true as const } : {})
          })
        );
        log(`  📸 Snapshot stage3-${n} → ${result.ref} (${result.reused ? 'unchanged tree, existing ' : ''}commit ${result.commit})`);
        return undefined;

      case 'head-moved':
        state = recordEscalation(
          state,
          escalationStage,
          'harness',
          'HEAD_MOVED',
          `HEAD moved since the run started: recorded ${describeHead(result.recorded)}, now ${describeHead(result.current)}. ` +
            `No snapshot was written. Restore HEAD to the recorded branch and commit, then ` +
            `\`npm run factory -- --resume ${state.featureId} --cwd ${shellArg(cwd)}\`; ` +
            `or close the run: \`npm run factory -- --close ${state.featureId} --cwd ${shellArg(cwd)}\`.`,
          { head: { recorded: { ...result.recorded }, current: { ...result.current } } }
        );
        return finish(state, 'ESCALATED', 'HEAD moved since the run started; no snapshot was written');

      case 'failed':
        state = recordEscalation(
          state,
          escalationStage,
          'harness',
          'SNAPSHOT_FAILED',
          `Snapshot stage3-${n} could not be written: ${result.error}. Nothing was recorded. Fix the cause, then resume.`
        );
        return finish(state, 'ESCALATED', `Snapshot stage3-${n} could not be written`);
    }
  };

  /**
   * The Stage 3 gate, on whatever the builders' outputs now are (merged, in a round — I-8), for
   * the builder phase `at`. Every pass is snapshotted before the run moves on (D-5).
   */
  const stage3Gate = async (escalationStage: 3 | 4, at: BuilderPhase): Promise<FeatureState | undefined> => {
    const decision = await stageGate(3, { loops: { ...lastAttempts, max: { ...lastAllowed } } });
    if (decision.canAdvance) return takeSnapshot(escalationStage, at);

    state = recordEscalation(
      state,
      escalationStage,
      'harness',
      'CRITICAL_ISSUE',
      `Stage 3 gate failed: ${decision.reason}`,
      { blockers: decision.blockers }
    );
    return finish(state, 'ESCALATED', decision.reason);
  };

  /** Gate 1.5. Always a Stage 4 gate: it runs at the start of Stage 4 and in every validator round. */
  const infrastructureGate = async (): Promise<FeatureState | undefined> => {
    log('\n🏗️  Verifying infrastructure prerequisites (npm scripts, database, config)...\n');

    // FAILS CLOSED (AC-5). A gate that could not run has verified nothing, so it is an escalation,
    // never a warning followed by the Test Verifier. Only the audit and its judgement sit inside
    // the try: a failure to RECORD the escalation must still reach the outer catch untouched.
    let infrastructureAudit: InfrastructureAudit;
    let infrastructureDecision: InfrastructureGateDecision;
    try {
      infrastructureAudit = await gates.auditInfrastructure(cwd);
      infrastructureDecision = validateInfrastructureGate(infrastructureAudit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`❌ Infrastructure verification could not run: ${message}`);
      state = recordEscalation(
        state,
        4,
        'harness',
        'INFRASTRUCTURE_FAILURE',
        `Infrastructure verification could not run: ${message}`,
        { remediation: 'Fix whatever stopped the infrastructure audit from running, then re-run the feature.' }
      );
      return finish(state, 'ESCALATED', `Infrastructure verification error: ${message}`);
    }

    log(generateInfrastructureReport(infrastructureAudit));

    if (!infrastructureDecision.canAdvance) {
      log('\n❌ CRITICAL: Infrastructure prerequisites missing!\n');
      log(`Blockers:`);
      infrastructureDecision.blockers.forEach(b => {
        log(`  ❌ ${b}`);
      });
      log(`\nRequired fixes:`);
      log(infrastructureDecision.remediation);

      state = recordEscalation(
        state,
        4,
        'harness',
        'INFRASTRUCTURE_FAILURE',
        `Infrastructure verification failed: ${infrastructureDecision.reason}`,
        {
          blockers: infrastructureDecision.blockers,
          remediation: infrastructureDecision.remediation
        }
      );
      return finish(state, 'ESCALATED', `Infrastructure not ready: ${infrastructureDecision.blockers[0]}`);
    }

    // Non-blocking, but never dropped: each warning becomes an IMPORTANT finding (AC-17).
    recordFindings(4, 'gate-1.5', infrastructureDecision.warnings);

    log(`\n✅ Infrastructure ready: All prerequisites verified\n`);
    return undefined;
  };

  /**
   * Gate 2, evaluation `round`: 0 right after the Test Verifier, N in validator round N — judged
   * against `.factory/baseline.json` for round 0 and the run's first record afterwards (D-12).
   * `referenceCount` is `gate2Reference(round)`, read by the caller BEFORE anything of the
   * evaluation runs and outside any try (PR B-2 D-8, I-9): an untrustworthy baseline must escalate
   * the run before an agent is invoked, never read as "none".
   */
  const executionGate = async (round: number, referenceCount: number | undefined): Promise<FeatureState | undefined> => {
    log('\n🔍 Verifying test execution (ensuring tests actually ran and passed 100%)...\n');

    // FAILS CLOSED (AC-6, AC-7). A Gate 2 that could not run escalates; it never hands an
    // unverified build to the Validator for "human review" to catch.
    let executionAudit: ExecutionAudit;
    let executionDecision: ExecutionGateDecision;
    try {
      executionAudit = await gates.auditExecution(cwd);
      executionDecision = validateExecutionGate(executionAudit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`❌ Execution verification could not run: ${message}`);
      state = recordEscalation(
        state,
        4,
        'harness',
        'EXECUTION_FAILURE',
        `Execution verification could not run: ${message}`,
        { remediation: 'Fix whatever stopped the execution audit from running, then re-run the feature.' }
      );
      return finish(state, 'ESCALATED', `Execution verification error: ${message}`);
    }

    log(generateExecutionReport(executionAudit));

    // Every evaluation is recorded — a blocking one too, so the run's record shows what Gate 2
    // actually counted.
    recordGate2(round, executionDecision, referenceCount);

    if (!executionDecision.canAdvance) {
      log('\n❌ CRITICAL: Test execution verification failed!\n');
      log(`Pass rate: ${(executionDecision.passRate * 100).toFixed(1)}%`);
      log(`Blockers:`);
      executionDecision.blockers.forEach(b => {
        log(`  ❌ ${b}`);
      });
      log(`\nRemediation: ${executionDecision.remediation}`);

      state = recordEscalation(
        state,
        4,
        'harness',
        'EXECUTION_FAILURE',
        `Test execution verification failed: ${executionDecision.reason}`,
        {
          passRate: executionDecision.passRate,
          blockers: executionDecision.blockers,
          failingTests: executionAudit.failedTests,
          buildErrors: executionAudit.buildErrors
        }
      );
      return finish(state, 'ESCALATED', `Test execution failed: ${executionDecision.blockers[0]}`);
    }

    // Skipped/todo tests and skipped build/dev checks: non-blocking, recorded (I-10).
    recordFindings(4, 'gate-2', executionDecision.warnings);

    log(`\n✅ Execution checks passed: every test that ran passed; no build or dev-server failure\n`);
    return undefined;
  };

  // ==========================================================================================
  // The stages
  //
  // Each stage function follows the helpers' contract: it returns the finished state when the
  // run must stop, and undefined when the next stage may run. They are called in order from the
  // try below, so a throw from any of them still reaches the outer catch.
  // ==========================================================================================

  /**
   * SATISFY-OR-RUN: stages 1 and 2, from a pre-supplied spec.
   *
   * If a spec was supplied from upstream (a Tier 1 Decomposer, a human, anything), we do not
   * re-plan the feature — but we do NOT take its word for it either. It goes through the same
   * canAdvanceStage() the Story Writer's own output goes through. Being upstream buys no
   * leniency: the gate is the contract.
   *
   * If nothing was supplied, stage1() and stage2() run exactly the code path they always have.
   * That is the invariant: Feature Factory stays runnable standalone on an existing project, with
   * no Tier 1 artifacts, and the no-spec path is byte-for-byte unchanged.
   */
  const preSuppliedStages = async (preSuppliedSpec: FeatureSpec): Promise<FeatureState | undefined> => {
    phase('Stages 1-2: Pre-supplied spec');

    // Into the run dir, where the builders' prompts point (I-11).
    const acceptance = await acceptFeatureSpec(preSuppliedSpec, cwd, artifactDir);

    if (!acceptance.accepted) {
      // Deliberately NOT falling back to running stages 1-2 ourselves. A spec that fails the
      // gate means the upstream producer is broken, and silently re-planning around it would
      // hide that — the Decomposer would look like it worked while Tier 2 quietly did its job.
      state = recordEscalation(
        state,
        2,
        'tier-1',
        'CRITICAL_ISSUE',
        `Pre-supplied spec rejected by the stage gates (${acceptance.passRate.toFixed(0)}%).`,
        { blockers: acceptance.blockers }
      );
      return finish(state, 'ESCALATED', 'Pre-supplied spec did not pass the gates');
    }

    // The supplied documents were written by the acceptance, and their paths rewritten in place to
    // the run directory: read them back (D-12). Only artifacts with content were written.
    checkDocuments(
      2,
      writtenDocuments(
        cwd,
        [preSuppliedSpec.researcher, preSuppliedSpec.story, preSuppliedSpec.spec].flatMap(output =>
          (output?.details?.artifacts ?? [])
            .filter(artifact => typeof artifact.content === 'string' && artifact.content.length > 0)
            .map(artifact => artifact.path)
        )
      )
    );

    // One tier-1 PASS step per supplied output, keyed by the output's own agent (D-4), so the record
    // says exactly what stood in for which planning agent.
    if (preSuppliedSpec.researcher) {
      outputs.researcher = preSuppliedSpec.researcher;
      state = commit(recordAgentStep(state, 1, 'tier-1', 'PASS', preSuppliedSpec.researcher));
    }
    outputs.story = preSuppliedSpec.story;
    state = commit(recordAgentStep(state, 2, 'tier-1', 'PASS', preSuppliedSpec.story));
    outputs.spec = preSuppliedSpec.spec;
    state = commit(recordAgentStep(state, 2, 'tier-1', 'PASS', preSuppliedSpec.spec));
    state = commit(advanceToStage(state, 2));
    log(`✅ Pre-supplied spec accepted — skipping the planning agents, not the human checkpoints`);

    // Being upstream buys no leniency, and no skipped checkpoint either (AC-55): the supplied story
    // and brief go through the same gates and are presented at CP1 and CP2 like the agents' own.
    const storyStopped = await reviewStory();
    if (storyStopped) return storyStopped;

    return reviewBrief();
  };

  /**
   * STAGE 1: DISCOVER (Researcher). On resume (D-2): skipped once the run is past Stage 1, and
   * never run for a pre-supplied run; the Researcher is skipped when it already passed, and the
   * Stage 1 gate is always evaluated again.
   */
  const stage1 = async (): Promise<FeatureState | undefined> => {
    if (isStageComplete(state, 1)) return undefined;
    if (isPreSuppliedRun(state)) {
      // Killed between its tier-1 steps and the stage advance: the planning documents were supplied.
      state = commit(advanceToStage(state, 2));
      return undefined;
    }
    phase('Stage 1: Discover');

    if (!hasPass(state, '01-researcher')) {
      const stopped = await runResearcher();
      if (stopped) return stopped;
    }

    // Check Stage 1 gate
    const stage1Decision = await stageGate(1);
    if (!stage1Decision.canAdvance) {
      state = invalidateAgentSteps(state, ['01-researcher'], `Stage 1 gate failed: ${stage1Decision.reason}`); // I-6
      state = recordEscalation(
        state,
        1,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 1 gate failed: ${stage1Decision.reason}`,
        { blockers: stage1Decision.blockers }
      );
      return finish(state, 'ESCALATED', stage1Decision.reason);
    }

    log(`✅ Stage 1 passed: ${stage1Decision.passRate.toFixed(0)}% criteria met`);
    state = commit(advanceToStage(state, 2));
    return undefined;
  };

  /** The Researcher unit (U1): invoke, believe a declared blocker, persist its report, record PASS. */
  const runResearcher = async (): Promise<FeatureState | undefined> => {
    const researcher = await timedInvoke({
      stage: 1,
      agent: '01-researcher',
      prompt: researcherPrompt(promptCtx)
    });
    const researcherOutput = researcher.output;

    // Validate output schema
    const researchValidation = validateOutputSchema(1, '01-researcher', researcherOutput);
    if (!researchValidation.valid) {
      state = recordEscalation(
        state,
        1,
        '01-researcher',
        'SCHEMA_VALIDATION',
        `Output schema validation failed: ${researchValidation.errors.join(', ')}`
      );
      return finish(state, 'ESCALATED', 'Schema validation failed at Stage 1');
    }

    if (agentDeclaredBlocked(researcherOutput)) {
      state = recordEscalation(
        state,
        1,
        '01-researcher',
        'CRITICAL_ISSUE',
        `01-researcher reported ${researcherOutput.status}: ${researcherOutput.details.summary}`
      );
      return finish(state, 'ESCALATED', `01-researcher declared the feature blocked`);
    }

    outputs.researcher = researcherOutput;
    persist({ researcher: researcherOutput });
    state = commit(recordAgentStep(state, 1, '01-researcher', 'PASS', researcherOutput, undefined, undefined, researcher.timing));
    return undefined;
  };

  /**
   * STAGE 2: PLAN. Story Writer → story gate → CHECKPOINT 1 → Spec Writer → spec gate →
   * CHECKPOINT 2 (C-9). On resume (D-2) each agent is skipped when it already passed (a
   * pre-supplied run's tier-1 steps count), and each gate + checkpoint pair when its checkpoint is
   * approved; an approved CP2 closes the stage.
   */
  const stage2 = async (): Promise<FeatureState | undefined> => {
    if (isStageComplete(state, 2)) {
      // CP2 was approved but the advance was never committed (a kill in between).
      if (state.currentStage < 3) state = commit(advanceToStage(state, 3));
      return undefined;
    }
    phase('Stage 2: Plan');

    if (!hasPass(state, '02-story-writer')) {
      const stopped = await runStoryWriter();
      if (stopped) return stopped;
    }

    // The story gate, then CHECKPOINT 1 — before the Spec Writer translates the story (AC-56).
    if (!isCheckpointApproved(state, 1)) {
      const storyStopped = await reviewStory();
      if (storyStopped) return storyStopped;
    }

    if (!hasPass(state, '03-spec-writer')) {
      const stopped = await runSpecWriter();
      if (stopped) return stopped;
    }

    // The spec gate, then CHECKPOINT 2, then Stage 3 (AC-78).
    return reviewBrief();
  };

  /** The Story Writer unit (U2): invoke, validate, persist USER_STORY.md, record PASS. */
  const runStoryWriter = async (): Promise<FeatureState | undefined> => {
    const story = await timedInvoke({
      stage: 2,
      agent: '02-story-writer',
      prompt: storyPrompt(promptCtx, planningRework(1, '02-story-writer', 'The story gate'))
    });
    const storyOutput = story.output;

    const storyValidation = validateOutputSchema(2, '02-story-writer', storyOutput);
    if (!storyValidation.valid) {
      state = recordEscalation(
        state,
        2,
        '02-story-writer',
        'SCHEMA_VALIDATION',
        `Story output schema invalid: ${storyValidation.errors[0]}`
      );
      return finish(state, 'ESCALATED', 'Story schema validation failed');
    }

    if (agentDeclaredBlocked(storyOutput)) {
      state = recordEscalation(
        state,
        2,
        '02-story-writer',
        'CRITICAL_ISSUE',
        `02-story-writer reported ${storyOutput.status}: ${storyOutput.details.summary}`
      );
      return finish(state, 'ESCALATED', `02-story-writer declared the feature blocked`);
    }

    outputs.story = storyOutput;
    persist({ story: storyOutput });   // <- the Spec Writer must be able to READ this
    state = commit(recordAgentStep(state, 2, '02-story-writer', 'PASS', storyOutput, undefined, undefined, story.timing));
    return undefined;
  };

  /** The Spec Writer unit (U4): invoke, validate, persist TECHNICAL_BRIEF.md and FILE_LIST.md, record PASS. */
  const runSpecWriter = async (): Promise<FeatureState | undefined> => {
    const spec = await timedInvoke({
      stage: 2,
      agent: '03-spec-writer',
      prompt: specPrompt(promptCtx, planningRework(2, '03-spec-writer', 'The spec gate'))
    });
    const specOutput = spec.output;

    const specValidation = validateOutputSchema(2, '03-spec-writer', specOutput);
    if (!specValidation.valid) {
      state = recordEscalation(
        state,
        2,
        '03-spec-writer',
        'SCHEMA_VALIDATION',
        `Spec output schema invalid: ${specValidation.errors[0]}`
      );
      return finish(state, 'ESCALATED', 'Spec schema validation failed');
    }

    if (agentDeclaredBlocked(specOutput)) {
      state = recordEscalation(
        state,
        2,
        '03-spec-writer',
        'CRITICAL_ISSUE',
        `03-spec-writer reported ${specOutput.status}: ${specOutput.details.summary}`
      );
      return finish(state, 'ESCALATED', `03-spec-writer declared the feature blocked`);
    }

    outputs.spec = specOutput;
    persist({ spec: specOutput });
    state = commit(recordAgentStep(state, 2, '03-spec-writer', 'PASS', specOutput, undefined, undefined, spec.timing));
    return undefined;
  };

  /** STAGE 3: EXECUTE (Backend Builder + Frontend Builder with loop-backs), then Gate 1 and the Stage 3 gate. */
  const stage3 = async (): Promise<FeatureState | undefined> => {
    if (isStageComplete(state, 3)) return undefined;
    phase('Stage 3: Execute');

    // On resume a builder that already passed its Stage 3 build is skipped (D-2); its documents
    // were re-rendered from the rebuilt outputs. Gate 1 and the Stage 3 gate always run again.
    if (!hasPass(state, BUILDER_AGENT.backend, { phase: 'stage3' })) {
      const backendRun = await runBuilderLoop('backend', { phase: 'stage3' });
      if ('finished' in backendRun) return backendRun.finished;
      outputs.backend = backendRun.output;

      // Rendered from the structured output, for the agents downstream (AC-25). Run dir only; never
      // a claimed file — the materialization audit below sees only the builders' filesModified.
      writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(outputs.backend));
      writeDocument('API_CONTRACT.md', renderApiContract(outputs.backend));
    }

    // ...the Frontend Builder only if the approved brief actually calls for UI (frontend-files.ts).
    if (specRequiresFrontend(outputs.spec)) {
      if (!hasPass(state, BUILDER_AGENT.frontend, { phase: 'stage3' })) {
        const frontendRun = await runBuilderLoop('frontend', { phase: 'stage3' });
        if ('finished' in frontendRun) return frontendRun.finished;
        outputs.frontend = frontendRun.output;
        writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(outputs.frontend));
      }
    } else {
      log('⏭️  Frontend Builder skipped — the approved brief specifies no UI work.');
    }

    // ========================================================================
    // ARTIFACT MATERIALIZATION CHECK (Reality Verification)
    // ========================================================================
    // Prevent hallucinations: verify that claimed files actually exist on disk

    const stage3Materialization = await materializationGate(3);
    if (stage3Materialization) return stage3Materialization;

    const stage3Failure = await stage3Gate(3, { phase: 'stage3' });
    if (stage3Failure) return stage3Failure;

    log(`✅ Stage 3 passed: Implementation complete`);
    state = commit(advanceToStage(state, 4));
    return undefined;
  };

  /**
   * STAGE 4: VERIFY. Gate 1.5, then the Test Verifier (project) ∥ the Validator (read-only copy of
   * the latest snapshot) → Gate 2, with the bounded validator rounds (D-9; PR B-2 D-8, D-13), then
   * the Stage 4 gate.
   */
  const stage4 = async (): Promise<FeatureState | undefined> => {
    // An approved CP3 closes Stage 4: what remains is the baseline and SUCCESS (D-6).
    if (isStageComplete(state, 4)) return undefined;

    // After a CP3 rejection, the rework builders run first, judged by Gate 1 and the Stage 3 gate (D-5).
    const reworkStopped = await changeRework();
    if (reworkStopped) return reworkStopped;

    // ========================================================================
    // INFRASTRUCTURE VERIFICATION GATE (Reality Check for Readiness)
    // ========================================================================
    // Verify npm scripts, database setup, TypeScript config before running tests

    const infrastructureFailure = await infrastructureGate();
    if (infrastructureFailure) return infrastructureFailure;

    phase('Stage 4: Verify');

    // On resume (D-2) the whole verification — the Test Verifier ∥ the Validator, Gate 2 and the
    // validator rounds — is skipped once the Validator's evaluation passed. Gate 1.5 and the
    // Stage 4 gate always run. Legacy path (PR B-2 D-8): a Validator PASS recorded before B-2
    // without a Test Verifier PASS runs the Test Verifier alone, as before.
    if (!hasPass(state, '07-validator')) {
      const stopped = await validatorLoop();
      if (stopped) return stopped;
    } else if (!hasPass(state, '06-test-verifier')) {
      const stopped = await runTestVerifier();
      if (stopped) return stopped;
    }

    // Check Stage 4 gate. "No Regressions" judges the harness's own latest Gate 2 count against
    // its reference — never anything the Validator says about regressions (AC-22). "Validation
    // Passed" reads the typed verdict of the current cycle's decided evaluation (B-2 AC-131).
    const stage4Decision = await stageGate(4, { harness: stage4Evidence() });
    if (!stage4Decision.canAdvance) {
      // I-6: what this gate judged — the Test Verifier's and the Validator's work, with its
      // follow-up — is not done, so a resume re-runs them instead of re-failing on the same
      // reports. Builders are never invalidated: their attempts are budgeted, and their gates
      // simply run again.
      state = invalidateAgentSteps(
        state,
        ['06-test-verifier', '07-validator', '07b-validator-followup'],
        `Stage 4 gate failed: ${stage4Decision.reason}`
      );
      state = recordEscalation(
        state,
        4,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 4 gate failed: ${stage4Decision.reason}`,
        { blockers: stage4Decision.blockers }
      );
      return finish(state, 'ESCALATED', stage4Decision.reason);
    }

    // The run stays in Stage 4: what follows is CHECKPOINT 3, not Stage 5 (I-18).
    log(`✅ Stage 4 passed: All tests & validations passed`);
    return undefined;
  };

  /**
   * The Test Verifier unit (U10) on the legacy path only (PR B-2 D-8): a Validator PASS recorded
   * before B-2 without a Test Verifier PASS. Its verdict is believed; a PASS renders TEST_REPORT.md.
   * Everywhere else the Test Verifier runs as branch T of `evaluate`.
   */
  const runTestVerifier = async (): Promise<FeatureState | undefined> => {
    const test = await timedInvoke({
      stage: 4,
      agent: '06-test-verifier',
      prompt: testVerifierPrompt(promptCtx)
    });
    const testOutput = test.output;

    const testValidation = validateOutputSchema(4, '06-test-verifier', testOutput);
    if (!testValidation.valid) {
      state = recordEscalation(
        state,
        4,
        '06-test-verifier',
        'SCHEMA_VALIDATION',
        `Test output schema invalid: ${testValidation.errors[0]}`
      );
      return finish(state, 'ESCALATED', 'Test verifier schema validation failed');
    }

    // The Test Verifier's verdict is believed (AC-19). Anything but a clean PASS — status FAIL,
    // LOOP_BACK (I-6) or ESCALATE, a failing test, or a CRITICAL issue — stops here: the step is
    // not recorded PASS, Gate 2 does not run, and the Validator is never asked to bless it.
    const testVerdict = testVerifierVerdict(testOutput);
    if (!testVerdict.passed) {
      state = commit(
        recordAgentStep(
          state,
          4,
          '06-test-verifier',
          testOutput.status === 'ESCALATE' ? 'ESCALATED' : 'FAIL',
          testOutput,
          undefined,
          undefined,
          test.timing
        )
      );
      state = recordEscalation(
        state,
        4,
        '06-test-verifier',
        'CRITICAL_ISSUE',
        `06-test-verifier did not pass: ${testVerdict.reasons.join('; ')}`,
        { failingTests: testVerdict.failingCriteria, issues: testVerdict.issues }
      );
      return finish(state, 'ESCALATED', `06-test-verifier did not pass: ${testVerdict.reasons[0]}`);
    }

    outputs.test = testOutput;
    // Rendered by the harness from the structured output the gate judges (I-5). Run dir only.
    writeDocument('TEST_REPORT.md', renderTestReport(testOutput));
    state = commit(recordAgentStep(state, 4, '06-test-verifier', 'PASS', testOutput, undefined, undefined, test.timing));
    return undefined;
  };

  /**
   * One validator round's fix (D-9): each routed builder that has not already passed this round
   * re-runs, its output is merged, and the round is judged by the same gates as the original
   * build — Gate 1, the Stage 3 gate, Gate 1.5 — over the merged outputs.
   */
  const validatorRoundFix = async (
    round: number,
    routing: { backend: ValidatorIssue[]; frontend: ValidatorIssue[] }
  ): Promise<FeatureState | undefined> => {
    const at: BuilderPhase = { phase: 'validator-round', round };

    if (routing.backend.length > 0 && !hasPass(state, BUILDER_AGENT.backend, at)) {
      const fix = await runBuilderLoop('backend', { phase: 'validator-round', round, issues: routing.backend });
      if ('finished' in fix) return fix.finished;
      outputs.backend = outputs.backend ? mergeBuilderOutput(outputs.backend, fix.output, cwd) : fix.output;
      writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(outputs.backend));
      writeDocument('API_CONTRACT.md', renderApiContract(outputs.backend));
    }

    if (routing.frontend.length > 0 && !hasPass(state, BUILDER_AGENT.frontend, at)) {
      const fix = await runBuilderLoop('frontend', { phase: 'validator-round', round, issues: routing.frontend });
      if ('finished' in fix) return fix.finished;
      outputs.frontend = outputs.frontend ? mergeBuilderOutput(outputs.frontend, fix.output, cwd) : fix.output;
      writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(outputs.frontend));
    }

    const roundMaterialization = await materializationGate(4);
    if (roundMaterialization) return roundMaterialization;

    const roundStage3 = await stage3Gate(4, at);
    if (roundStage3) return roundStage3;

    return infrastructureGate();
  };

  /**
   * Record the merged reviews' IMPORTANT issues as findings, each under the source of the review
   * that reported it, skipping any the run already holds (MINOR-9, PR B-2 D-10). The merge dropped
   * duplicates first, so an issue both reviews report is recorded once (AC-122). Every reviewed
   * output's IMPORTANT issues are kept — a round that fails on a CRITICAL issue may raise
   * IMPORTANT ones the next round never repeats — each exactly once, across rounds and resumes.
   */
  const recordValidatorFindings = (merged: readonly MergedIssue[]) => {
    const findings = importantFindings(merged);
    recordFindingsOnce(4, '07-validator', findings['07-validator']);
    recordFindingsOnce(4, FOLLOWUP_AGENT, findings[FOLLOWUP_AGENT]);
  };

  // ==========================================================================================
  // Stage 4 verification (PR B-2, D-3 and D-7 to D-14)
  //
  // An EVALUATION is one main-Validator review with what hangs off it: its read-only copy, the
  // Validator's output and, in a first pass, the Test Verifier's run and the measurement of what it
  // changed. A `first-pass` evaluation runs the Test Verifier (real tree) and the Validator (the
  // copy) in parallel, then Gate 2; a `validator-round` evaluation runs Gate 2, then the Validator
  // alone on a fresh copy of the round's snapshot. Every step is recorded on the evaluation and
  // committed, so a kill resumes only unfinished work; an escalation closes it (finish).
  // ==========================================================================================

  /** Evaluation `e` of this run's record. */
  const evaluationNumbered = (e: number): ValidatorEvaluation => {
    const evaluation = (state.validatorEvaluations ?? []).find(candidate => candidate.e === e);
    if (!evaluation) throw new Error(`No verification evaluation ${e} is recorded.`);
    return evaluation;
  };

  /** Escalate REVIEW_COPY_FAILED (I-18): the copy could not be made, re-made or measured against. */
  const reviewCopyFailed = (message: string): FeatureState => {
    log(`❌ ${message}`);
    state = recordEscalation(state, 4, 'harness', 'REVIEW_COPY_FAILED', message, {
      remediation: 'Fix the cause (disk space, permissions, the snapshot ref), then resume the run.'
    });
    return finish(state, 'ESCALATED', 'The review copy could not be made or measured');
  };

  /** What evaluation `round` of this loop is (D-7, D-13): verification.ts `evaluationKind`, on this run's record. */
  const nextEvaluationKind = (round: number, afterRoundFix: boolean): ValidatorEvaluation['kind'] =>
    evaluationKind(state, currentReworkCycle(state), round, afterRoundFix, hasPass(state, '06-test-verifier'));

  /**
   * Continue the open evaluation of (cycle, round) (AC-123), or open a new one: its start is
   * committed BEFORE the copy is made and before any agent of it is invoked (D-14, AC-157), so a
   * kill, a throw or a crash anywhere in verification leaves the "verification started" marker.
   */
  const startEvaluation = (kind: ValidatorEvaluation['kind'], round: number): number => {
    const cycle = currentReworkCycle(state);
    const open = openEvaluation(state, cycle, round);
    if (open) {
      log(`  ↩️  Continuing verification evaluation ${open.e} (${open.kind}, cycle ${cycle}, round ${round})`);
      return open.e;
    }
    state = commit(recordEvaluationStart(state, { cycle, round, kind }));
    const started = state.validatorEvaluations![state.validatorEvaluations!.length - 1];
    log(`  🔎 Verification evaluation ${started.e} (${kind}, cycle ${cycle}, round ${round})`);
    return started.e;
  };

  /**
   * Where a new copy comes from (D-3): the latest written Stage 3 snapshot (the current phase's,
   * Q2), else the AC-126 fallback, a copy of the working tree, with why there is no snapshot.
   */
  const reviewSource = (): ReviewSource => {
    const snapshot = latestStage3Snapshot(state);
    if (snapshot) return { kind: 'snapshot', n: snapshot.n, ref: snapshot.ref, commit: snapshot.commit, tree: snapshot.tree };
    return {
      kind: 'working-tree',
      reason: state.changeBase?.kind === 'none' ? NOT_GIT_SNAPSHOT_REASON : NO_SNAPSHOT_RECORDED_REASON
    };
  };

  /**
   * Evaluation `e`'s read-only copy, made before either agent of the evaluation is invoked (D-3):
   *  - a recorded copy that is still whole (copyIntact: leaf count and digest) is reused;
   *  - a snapshot copy that is not is re-extracted, into a new directory, from the SAME recorded
   *    snapshot (AC-123); the new directory is recorded and committed;
   *  - a fallback copy that is not, after the Test Verifier was invoked in this evaluation or its
   *    measurement baseline was recorded, cannot be re-made (the working tree may now hold its
   *    writes): REVIEW_COPY_FAILED (I-28);
   *  - a review root inside the project, or holding it, is refused with REVIEW_COPY_FAILED before
   *    anything is created (MINOR-6);
   *  - otherwise a new copy: extracted (its leaf digest taken right after extraction, before
   *    sealing, and its count checked against the extraction's) or copied from the working tree;
   *    sealed read-only; recorded with its leaves and digest (D-B2-2); committed.
   * Any failure escalates REVIEW_COPY_FAILED; a directory a failed attempt left is removed.
   */
  const prepareReviewCopy = async (e: number): Promise<{ dir: string; source: ReviewSource } | { finished: FeatureState }> => {
    const recorded = evaluationNumbered(e).copy;
    if (recorded && copyIntact(recorded.dir, recorded)) return { dir: recorded.dir, source: recorded.source };

    const source = recorded?.source ?? reviewSource();
    if (recorded && source.kind === 'working-tree') {
      const verifierRan =
        evaluationNumbered(e).baseline !== undefined ||
        (state.agentInvocations ?? []).some(invocation => invocation.agent === '06-test-verifier' && invocation.evaluation === e);
      if (verifierRan) {
        return {
          finished: reviewCopyFailed(
            `The review copy ${recorded.dir} of the working tree is missing or changed, and the Test Verifier already ran in ` +
              `evaluation ${e}: the copy cannot be made again, because the working tree may now hold the Test Verifier's writes (I-28).`
          )
        };
      }
    }

    const misplaced = reviewRootProblem(reviewParent, cwd);
    if (misplaced !== undefined) {
      return { finished: reviewCopyFailed(`The review copy for evaluation ${e} cannot be made: ${misplaced}; it must be outside the project.`) };
    }

    let dir: string | undefined;
    let leaves: CopyLeaves;
    try {
      dir = createReviewDir(reviewParent, state.featureId, e);
      if (source.kind === 'snapshot') {
        const extracted = await changes.extractSnapshot(cwd, { ref: source.ref, commit: source.commit, tree: source.tree }, dir);
        if (extracted.kind === 'failed') throw new Error(extracted.error);
        leaves = leafDigest(dir);
        if (leaves.entries !== extracted.entries) {
          throw new Error(`the extraction reported ${extracted.entries} entries, but the copy holds ${leaves.entries}`);
        }
      } else {
        leaves = copyWorkingTree(cwd, dir);
      }
      sealReadOnly(dir);
    } catch (error) {
      if (dir !== undefined) discardReviewDir(dir);
      const what = source.kind === 'snapshot' ? `extracted from stage3-${source.n} (${source.ref})` : 'copied from the working tree';
      return {
        finished: reviewCopyFailed(
          `The review copy for evaluation ${e} could not be ${what}: ${error instanceof Error ? error.message : String(error)}`
        )
      };
    }

    state = commit(
      recordReviewCopy(state, e, { dir, source, entries: leaves.entries, digest: leaves.digest, madeAt: new Date().toISOString() })
    );
    log(
      `  📂 Review copy ${recorded ? 're-made' : 'made'} for evaluation ${e}: ${dir} ` +
        `(${source.kind === 'snapshot' ? `stage3-${source.n}` : `working tree: ${source.reason}`}; ${leaves.entries} entries; read-only)`
    );
    return { dir, source };
  };

  /** What branch T (the Test Verifier) settled with. It never calls finish (D-8). */
  type TestVerifierBranch =
    | { kind: 'skipped' | 'passed' }
    | { kind: 'schema'; error: string }
    | { kind: 'failed'; verdict: ReturnType<typeof testVerifierVerdict> };

  /**
   * Branch T (D-8): the Test Verifier, in the real project tree (no `cwd`, AC-118). Its verdict is
   * believed (AC-19): a PASS renders TEST_REPORT.md and records the PASS step; anything else
   * records the FAIL or ESCALATED step. Both are committed here; the decision is the caller's.
   */
  const testVerifierBranch = async (e: number): Promise<TestVerifierBranch> => {
    const test = await timedInvoke(
      { stage: 4, agent: '06-test-verifier', prompt: testVerifierPrompt(promptCtx) },
      { evaluation: e }
    );
    const testOutput = test.output;

    const testValidation = validateOutputSchema(4, '06-test-verifier', testOutput);
    if (!testValidation.valid) return { kind: 'schema', error: testValidation.errors[0] };

    const verdict = testVerifierVerdict(testOutput);
    if (!verdict.passed) {
      state = commit(
        recordAgentStep(
          state,
          4,
          '06-test-verifier',
          testOutput.status === 'ESCALATE' ? 'ESCALATED' : 'FAIL',
          testOutput,
          undefined,
          undefined,
          test.timing
        )
      );
      return { kind: 'failed', verdict };
    }

    outputs.test = testOutput;
    // Rendered by the harness from the structured output the gate judges (I-5). Run dir only.
    writeDocument('TEST_REPORT.md', renderTestReport(testOutput));
    state = commit(recordAgentStep(state, 4, '06-test-verifier', 'PASS', testOutput, undefined, undefined, test.timing));
    return { kind: 'passed' };
  };

  /** What branch V (the main Validator) settled with. It never calls finish (D-8). */
  type ValidatorBranch = { kind: 'skipped' | 'recorded' } | { kind: 'schema'; error: string };

  /**
   * Branch V (D-8): the main Validator, in evaluation `e`'s read-only copy (`cwd` = the copy,
   * AC-117, AC-118). A schema-valid output, whatever its status, is its completion (I-7): its
   * document is persisted and the output is recorded on the evaluation (committed). Its IMPORTANT
   * issues are recorded at the decision, from the merged list (D-10); its stageHistory step too.
   */
  const validatorBranch = async (e: number, round: number, copy: { dir: string; source: ReviewSource }): Promise<ValidatorBranch> => {
    const validator = await timedInvoke(
      { stage: 4, agent: '07-validator', prompt: validatorPrompt(promptCtx, copy), cwd: copy.dir },
      { round, evaluation: e }
    );
    const validatorOutput = validator.output;

    const validatorValidation = validateOutputSchema(4, '07-validator', validatorOutput);
    if (!validatorValidation.valid) return { kind: 'schema', error: validatorValidation.errors[0] };

    // The Validator's own document goes into the run dir now — the stage gate no longer persists.
    persist({ validator: validatorOutput });
    state = commit(recordEvaluationValidator(state, e, validatorOutput, validator.timing));
    return { kind: 'recorded' };
  };

  /**
   * Record evaluation `e`'s measurement baseline (IMPORTANT-1), committed BEFORE the Test Verifier
   * is invoked in it (`testVerifierRuns`), so the measurement attributes to it only what changed
   * while it ran, never a hand fix made after an earlier escalation:
   *  - an earlier first pass of this cycle whose baseline was not cleared (its measurement failed,
   *    or found a change outside a test path) passes that baseline on, also when the Test Verifier
   *    does not run again, so the earlier run's writes are still measured (IMPORTANT-2);
   *  - otherwise, for a snapshot copy, the working tree's tree id (`workingTreeId`); for the
   *    AC-126 fallback, the evaluation's own copy of the working tree, made before the Test
   *    Verifier started, with its leaf count and digest.
   * A baseline already on record (a continued evaluation) is kept. A tree id git cannot give
   * escalates REVIEW_COPY_FAILED before the Test Verifier runs.
   */
  const recordBaseline = async (e: number, testVerifierRuns: boolean): Promise<FeatureState | undefined> => {
    const evaluation = evaluationNumbered(e);
    if (evaluation.baseline) return undefined;
    const earlier = earlierBaseline(state.validatorEvaluations ?? [], evaluation.cycle, e);
    const inherited = earlier && !earlier.cleared ? earlier.baseline : undefined;
    if (!testVerifierRuns && inherited === undefined) return undefined;

    let baseline: MeasurementBaseline;
    const recordedAt = new Date().toISOString();
    const copy = evaluation.copy!;
    if (inherited !== undefined) {
      baseline = inherited;
    } else if (copy.source.kind === 'snapshot') {
      const id = await changes.workingTreeId(cwd);
      if (id.kind === 'failed') return reviewCopyFailed(`The tree 06-test-verifier is measured against could not be recorded: ${id.error}`);
      baseline = { kind: 'tree', tree: id.tree, recordedAt };
    } else {
      baseline = { kind: 'copy', dir: copy.dir, entries: copy.entries, digest: copy.digest, recordedAt };
    }
    state = commit(recordMeasurementBaseline(state, e, baseline));
    return undefined;
  };

  /**
   * What the Test Verifier changed (D-2, N-3), measured in every first pass after both agents
   * settled, whatever they returned (a failed verdict, a schema failure, a throw), and BEFORE Gate 2,
   * so Gate 2's own writes are not attributed to it:
   *  - against the evaluation's baseline (IMPORTANT-1): the tree id with `changedSince`, or the
   *    fallback copy with `compareWithCopy` once `copyIntact` holds;
   *  - with no baseline of its own (the Test Verifier did not run in it), nothing new when an
   *    earlier first pass of the cycle cleared its run; else, for a run whose Test Verifier passed
   *    before baselines existed, against the reviewed tree, as before.
   * The latest result is recorded. A change outside a test path escalates CRITICAL_ISSUE naming
   * the files; a measurement that fails, REVIEW_COPY_FAILED.
   */
  const measureTestVerifier = async (e: number, copy: { dir: string; source: ReviewSource }): Promise<FeatureState | undefined> => {
    const evaluation = evaluationNumbered(e);
    const baseline = evaluation.baseline;
    let files: string[];
    try {
      if (baseline?.kind === 'tree') {
        files = await filesChangedSince(baseline.tree);
      } else if (baseline?.kind === 'copy') {
        if (!copyIntact(baseline.dir, baseline)) {
          throw new Error(`the copy of the working tree it is compared with, ${baseline.dir}, is missing or changed`);
        }
        files = compareWithCopy(cwd, baseline.dir);
      } else if (earlierBaseline(state.validatorEvaluations ?? [], evaluation.cycle, e)?.cleared) {
        files = [];
      } else if (copy.source.kind === 'snapshot') {
        files = await filesChangedSince(copy.source.tree);
      } else {
        files = compareWithCopy(cwd, copy.dir);
      }
    } catch (error) {
      return reviewCopyFailed(
        `What 06-test-verifier changed could not be measured against the reviewed tree: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const measured: TestVerifierChanges = classifyTestVerifierChanges(files);
    state = commit(recordTestVerifierChanges(state, e, measured));
    if (measured.kind !== 'outside-tests') return undefined;

    const { outside } = measured;
    state = recordEscalation(
      state,
      4,
      '06-test-verifier',
      'CRITICAL_ISSUE',
      `06-test-verifier changed ${outside.length} file(s) outside a test path: ${outside.join(', ')}. Revert them or close the run.`,
      { blockers: outside }
    );
    return finish(state, 'ESCALATED', '06-test-verifier changed files outside a test path');
  };

  /** The files where the working tree now differs from git tree `tree`; throws the measurement's error. */
  const filesChangedSince = async (tree: string): Promise<string[]> => {
    const measured = await changes.changedSince(cwd, tree);
    if (measured.kind === 'failed') throw new Error(measured.error);
    return measured.files;
  };

  /** The main Validator's reviewed output for the decision, with its timing, the copy it reviewed and the copies that one replaced. */
  type Reviewed = { e: number; output: any; timing: InvocationTiming; copyDir: string; previousCopyDirs: string[] };

  /**
   * One evaluation up to the decision (D-8, D-13).
   *
   *  1. The Gate 2 reference is read before anything runs (I-9). A validator round then runs its
   *     Gate 2 first (I-10): the round's "moved past" marker stays before the Validator.
   *  2. The evaluation is opened or continued, and its copy made or reused (both committed).
   *  3. Branch T (first pass only, while the Test Verifier has no PASS) and branch V (while the
   *     evaluation has no Validator output) start in that order in the same tick, so the invoker
   *     sees the Test Verifier's call first. Promise.allSettled: no agent is left running (AC-124).
   *     In a first pass, the measurement baseline is recorded before branch T starts (IMPORTANT-1).
   *  4. First pass: the Test Verifier's changes are measured, whatever either branch settled with,
   *     so a non-test write escalates in the evaluation that made it (IMPORTANT-1, IMPORTANT-2).
   *  5. Then, in this fixed order: a rejected branch is rethrown (T first) to the outer catch; the
   *     Test Verifier's schema failure, then its failed verdict; the Validator's schema failure.
   *  6. First pass: Gate 2.
   */
  const evaluate = async (kind: ValidatorEvaluation['kind'], round: number): Promise<Reviewed | { finished: FeatureState }> => {
    const firstPass = kind === 'first-pass';
    const referenceCount = gate2Reference(round);
    if (!firstPass) {
      const executionFailure = await executionGate(round, referenceCount);
      if (executionFailure) return { finished: executionFailure };
    }

    const e = startEvaluation(kind, round);
    const copy = await prepareReviewCopy(e);
    if ('finished' in copy) return copy;

    const startT = firstPass && !hasPass(state, '06-test-verifier');
    if (firstPass) {
      const baselineFailure = await recordBaseline(e, startT);
      if (baselineFailure) return { finished: baselineFailure };
    }
    const startV = evaluationNumbered(e).validator === undefined;
    const branchT: Promise<TestVerifierBranch> = startT ? testVerifierBranch(e) : Promise.resolve({ kind: 'skipped' });
    const branchV: Promise<ValidatorBranch> = startV ? validatorBranch(e, round, copy) : Promise.resolve({ kind: 'skipped' });
    const [t, v] = await Promise.allSettled([branchT, branchV]);

    if (firstPass) {
      const measured = await measureTestVerifier(e, copy);
      if (measured) return { finished: measured };
    }

    if (t.status === 'rejected') throw t.reason;
    if (v.status === 'rejected') throw v.reason;

    if (t.value.kind === 'schema') {
      state = recordEscalation(state, 4, '06-test-verifier', 'SCHEMA_VALIDATION', `Test output schema invalid: ${t.value.error}`);
      return { finished: finish(state, 'ESCALATED', 'Test verifier schema validation failed') };
    }
    if (t.value.kind === 'failed') {
      // The Test Verifier's verdict is believed (AC-19). Anything but a clean PASS — status FAIL,
      // LOOP_BACK (I-6) or ESCALATE, a failing test, or a CRITICAL issue — stops here: the step is
      // not recorded PASS, Gate 2 does not run, and the Validator's review is never decided.
      const { verdict } = t.value;
      state = recordEscalation(
        state,
        4,
        '06-test-verifier',
        'CRITICAL_ISSUE',
        `06-test-verifier did not pass: ${verdict.reasons.join('; ')}`,
        { failingTests: verdict.failingCriteria, issues: verdict.issues }
      );
      return { finished: finish(state, 'ESCALATED', `06-test-verifier did not pass: ${verdict.reasons[0]}`) };
    }
    if (v.value.kind === 'schema') {
      state = recordEscalation(state, 4, '07-validator', 'SCHEMA_VALIDATION', `Validator output schema invalid: ${v.value.error}`);
      return { finished: finish(state, 'ESCALATED', 'Validator schema validation failed') };
    }

    if (firstPass) {
      const executionFailure = await executionGate(round, referenceCount);
      if (executionFailure) return { finished: executionFailure };
    }

    const evaluation = evaluationNumbered(e);
    const reviewed = evaluation.validator!;
    return { e, output: reviewed.output, timing: reviewed.timing, copyDir: copy.dir, previousCopyDirs: [...(evaluation.previousCopyDirs ?? [])] };
  };

  /** Whether `path` (project-relative) still exists in the project: a symlink counts, followed or not. */
  const existsInProject = (path: string): boolean => {
    try {
      lstatSync(resolve(cwd, path));
      return true;
    } catch {
      return false;
    }
  };

  /** `output` with only its artifacts named `name`: what a review agent may have persisted (never another document). */
  const onlyDocument = <T extends FeatureFactoryAgentOutput>(output: T, name: string): T => ({
    ...output,
    details: { ...output.details, artifacts: output.details.artifacts.filter(artifact => artifact.name === name) }
  });

  /**
   * The follow-up review (D-9, AC-121), first pass only, after Gate 2 and the main Validator's
   * ESCALATE check. Its record is the evaluation's write-once `followup` slot (AC-123):
   *  - recorded → reused (a resume never runs it twice);
   *  - the Test Verifier changed no file in this cycle → recorded skipped, with the reason;
   *  - otherwise 07b reviews exactly the test files it changed in this cycle's first passes
   *    (verification.ts `testVerifierFiles`: each evaluation measures only its own run), in the
   *    project (no `cwd`; deleted files named as deleted). A schema failure escalates SCHEMA_VALIDATION, an ESCALATE CRITICAL_ISSUE.
   *    Otherwise its document is persisted as VALIDATION_FOLLOWUP.md (never VALIDATION_REPORT.md),
   *    its step is recorded PASS and the review recorded on the evaluation, in one commit.
   * A `filesReviewed` that is not the list it was given is one IMPORTANT finding, not a block (I-29).
   * A validator round never runs it (AC-125). Returns the reviewed output, if any.
   */
  const followupReview = async (e: number): Promise<{ output?: ValidatorFollowupOutput } | { finished: FeatureState }> => {
    const evaluation = evaluationNumbered(e);
    if (evaluation.kind !== 'first-pass') return {};

    let reviewed = evaluation.followup;
    if (!reviewed) {
      if (evaluation.testVerifierChanges === undefined) throw new Error(`Evaluation ${e} has no measurement of what 06-test-verifier changed.`);
      const changed = testVerifierFiles(state.validatorEvaluations ?? [], evaluation.cycle, e);
      if (changed.length === 0) {
        state = commit(recordFollowup(state, e, { status: 'skipped', reason: FOLLOWUP_SKIPPED_REASON }));
        log(`  ⏭️  Follow-up review skipped: ${FOLLOWUP_SKIPPED_REASON}`);
        return {};
      }

      const files = changed.map(path => ({ path, deleted: !existsInProject(path) }));
      const followup = await timedInvoke(
        { stage: 4, agent: FOLLOWUP_AGENT, prompt: followupPrompt(promptCtx, files) },
        { evaluation: e }
      );
      const output = followup.output;

      const validation = validateOutputSchema(4, FOLLOWUP_AGENT, output);
      if (!validation.valid) {
        state = recordEscalation(state, 4, FOLLOWUP_AGENT, 'SCHEMA_VALIDATION', `Follow-up output schema invalid: ${validation.errors[0]}`);
        return { finished: finish(state, 'ESCALATED', 'Validator follow-up schema validation failed') };
      }
      const issues: ValidatorIssue[] = output.details.issues;
      if (output.status === 'ESCALATE') {
        state = commit(recordAgentStep(state, 4, FOLLOWUP_AGENT, 'ESCALATED', output, undefined, undefined, followup.timing));
        state = recordEscalation(state, 4, FOLLOWUP_AGENT, 'CRITICAL_ISSUE', `${FOLLOWUP_AGENT} escalated: ${output.details.summary}`, {
          issues: issues.map(issue => issue.message)
        });
        return { finished: finish(state, 'ESCALATED', `${FOLLOWUP_AGENT} declared the work blocked`) };
      }

      persist({ validatorFollowup: onlyDocument(output as ValidatorFollowupOutput, CP3_FOLLOWUP_DOCUMENT) });
      state = recordAgentStep(state, 4, FOLLOWUP_AGENT, 'PASS', output, undefined, undefined, followup.timing);
      state = commit(recordFollowup(state, e, { status: 'reviewed', files: [...changed], output, timing: followup.timing }));
      reviewed = evaluationNumbered(e).followup!;
    }
    if (reviewed.status !== 'reviewed') return {};

    outputs.validatorFollowup = reviewed.output;
    const mismatch = followupMismatch(reviewed.files, reviewed.output.details.filesReviewed, cwd);
    if (mismatch) recordFindingsOnce(4, FOLLOWUP_AGENT, [mismatch]);
    return { output: reviewed.output };
  };

  /**
   * The skeptics (D-11, AC-128 to AC-134): every merged CRITICAL issue, in merged order, is given to
   * skeptic A and skeptic B TOGETHER (IMPORTANT-3): both are started in the same tick, A first, so
   * neither can be started after the other's verdict is on record. IMPORTANT and MINOR issues never
   * are, and with no CRITICAL nothing runs. A verdict already on record for the evaluation is
   * skipped per (issue, instance) (AC-133): a resume runs only the missing one.
   *
   * Each skeptic reads the tree its issue's reviewer read (AC-132): a main-Validator issue the
   * evaluation's review copy (`cwd` = the copy, made intact first — re-extracted when it is not), a
   * follow-up issue the project (no `cwd`). Its prompt holds the issue, never a verdict (AC-128),
   * and tells it not to read the run's state.json or any SKEPTIC_* document.
   *
   * Each verdict is recorded (its document persisted as SKEPTIC_E<e>_<issueKey>_<A|B>.md, the
   * verdict committed) as soon as it returns. Promise.allSettled: no skeptic is left running. Then,
   * A before B: a throw (recorded by timedInvoke first) reaches the outer catch; a schema failure or
   * an echoed key other than the one given escalates SCHEMA_VALIDATION; a status other than PASS
   * escalates CRITICAL_ISSUE (I-12). The failing skeptic's verdict is not recorded, so the issue is
   * not disproved (AC-134).
   */
  const challengeCriticals = async (e: number, merged: readonly MergedIssue[]): Promise<FeatureState | undefined> => {
    /** One skeptic on one issue: its verdict recorded, or why it failed. Never calls finish. */
    type SkepticRun = { kind: 'recorded' } | { kind: 'schema' | 'status'; instance: SkepticInstance; message: string; summary: string };

    const critical = new Set(criticalIssues(merged.map(entry => entry.issue)));
    for (const entry of merged.filter(candidate => critical.has(candidate.issue))) {
      const missing = SKEPTIC_INSTANCES.filter(
        instance => !(evaluationNumbered(e).skeptics ?? []).some(verdict => verdict.issueKey === entry.key && verdict.instance === instance)
      );
      if (missing.length === 0) continue;

      let treeDir = cwd;
      if (entry.origin === '07-validator') {
        const copy = await prepareReviewCopy(e);
        if ('finished' in copy) return copy.finished;
        treeDir = copy.dir;
      }

      const challenge = async (instance: SkepticInstance): Promise<SkepticRun> => {
        const prompt = skepticPrompt(promptCtx, { instance, issueKey: entry.key, origin: entry.origin, issue: entry.issue, treeDir });
        const skeptic = await timedInvoke(
          { stage: 4, agent: SKEPTIC_AGENT, prompt, ...(treeDir !== cwd ? { cwd: treeDir } : {}) },
          { evaluation: e, instance }
        );
        const output = skeptic.output;

        const validation = validateOutputSchema(4, SKEPTIC_AGENT, output);
        const problem = !validation.valid
          ? validation.errors[0]
          : output.details.issueKey !== entry.key
            ? `it echoed issue key ${JSON.stringify(output.details.issueKey)}, but was given ${entry.key}`
            : undefined;
        if (problem !== undefined) {
          return {
            kind: 'schema',
            instance,
            message: `Skeptic ${instance} output on issue ${entry.key} is invalid: ${problem}`,
            summary: 'Skeptic schema validation failed'
          };
        }
        if (output.status !== 'PASS') {
          return {
            kind: 'status',
            instance,
            message: `${SKEPTIC_AGENT} ${instance} returned ${output.status} on issue ${entry.key}: ${output.details.summary}`,
            summary: `${SKEPTIC_AGENT} ${instance} returned ${output.status}`
          };
        }

        // One document per invocation, never overwritten (I-11): the schema's name, made unique.
        const verdict = output as SkepticOutput;
        const kept = onlyDocument(verdict, SKEPTIC_DOCUMENT);
        const document = kept.details.artifacts.find(artifact => typeof artifact.content === 'string' && artifact.content.trim().length > 0)!;
        document.name = `SKEPTIC_E${e}_${entry.key}_${instance}.md`;
        persist({ skeptic: { ...kept, details: { ...kept.details, artifacts: [document] } } });
        state = commit(
          recordSkepticVerdict(state, e, {
            issueKey: entry.key,
            origin: entry.origin,
            instance,
            verdict: verdict.details.verdict,
            reason: verdict.details.reason,
            document: document.path
          })
        );
        log(`  🧐 Skeptic ${instance} on ${entry.key} (${entry.origin}): ${verdict.details.verdict}`);
        return { kind: 'recorded' };
      };

      // Both started before either is awaited, A first (`missing` keeps SKEPTIC_INSTANCES' order).
      const settled = await Promise.allSettled(missing.map(instance => challenge(instance)));
      for (const result of settled) if (result.status === 'rejected') throw result.reason;
      for (const result of settled) {
        if (result.status !== 'fulfilled' || result.value.kind === 'recorded') continue;
        const failed = result.value;
        state = recordEscalation(
          state,
          4,
          SKEPTIC_AGENT,
          failed.kind === 'schema' ? 'SCHEMA_VALIDATION' : 'CRITICAL_ISSUE',
          failed.message,
          { issues: [describeIssue(entry.issue)] }
        );
        return finish(state, 'ESCALATED', failed.summary);
      }
    }
    return undefined;
  };

  /** The decided verdict of an evaluation (D-12): passed exactly when no CRITICAL issue stands. */
  const decidedVerdict = (standing: readonly MergedIssue[], disproved: readonly { merged: MergedIssue }[]): ValidationVerdict => ({
    passed: standing.length === 0,
    standing: standing.map(issue => issue.key),
    disproved: disproved.map(entry => entry.merged.key),
    recordedAt: new Date().toISOString()
  });

  /**
   * VERIFICATION AND THE BOUNDED VALIDATOR LOOP-BACK (D-9; PR B-2 D-8 to D-13).
   *
   * The first evaluation is a first pass: the Test Verifier ∥ the Validator, then Gate 2. Each
   * evaluation is then decided here, in this order:
   *  1. the main Validator's ESCALATE is believed (AC-20);
   *  2. a main status other than PASS with no CRITICAL in its own output escalates (I-6, I-13);
   *  3. the follow-up review (first pass only, D-9);
   *  4. the merge of both reviews (D-10): their IMPORTANT issues recorded once, each under its
   *     review's source; a follow-up status other than PASS with no CRITICAL of its own escalates;
   *  5. the skeptics on every merged CRITICAL (D-11); a CRITICAL both disproved becomes one
   *     IMPORTANT finding (source 07c-validator-skeptic), never routed (AC-130);
   *  6. the verdict (D-12): nothing standing → the 07 step PASS and the evaluation decided passed.
   *     Otherwise the 07 step FAIL, the evaluation decided not passed, then the round bound
   *     (MAX_LOOPS), the routing of the STANDING issues to their builders (unroutable → escalate),
   *     and a validator round: Gates 1, 3, 1.5, then Gate 2 and the Validator alone on a fresh copy
   *     of the round's snapshot — at most MAX_VALIDATOR_ROUNDS times. The run stays in Stage 4
   *     throughout: it never claims to be back in Stage 3 (AC-33).
   *
   * Each evaluation's 07 step is recorded once, at its decision (PASS, FAIL or ESCALATED, with the
   * Validator's output and invocation timing).
   *
   * On resume (D-2) the rounds continue from state: a round that was opened but never reached its
   * Gate 2 re-enters at its builder fix; an open evaluation is continued; otherwise the loop starts
   * at the round state records.
   */
  const validatorLoop = async (): Promise<FeatureState | undefined> => {
    let round = state.validatorRoundsCompleted ?? 0;
    let afterRoundFix = false;

    const pending = pendingValidatorRound(state, cwd);
    if (pending) {
      log(`\n↩️  Resuming validator round ${pending.round} of ${MAX_VALIDATOR_ROUNDS} at its builder fix\n`);
      const stopped = await validatorRoundFix(pending.round, pending);
      if (stopped) return stopped;
      afterRoundFix = true;
    }

    for (;;) {
      const reviewed = await evaluate(nextEvaluationKind(round, afterRoundFix), round);
      if ('finished' in reviewed) return reviewed.finished;

      const { e, output: validatorOutput, timing, copyDir, previousCopyDirs } = reviewed;
      outputs.validator = validatorOutput;

      const validatorIssues: ValidatorIssue[] = Array.isArray(validatorOutput.details.issues)
        ? validatorOutput.details.issues
        : [];

      // ESCALATE is believed, and is never recorded PASS (AC-20). After Gate 2 (I-8).
      if (validatorOutput.status === 'ESCALATE') {
        recordValidatorFindings(mergeIssues({ issues: validatorIssues, copyDir, previousCopyDirs }, undefined, cwd));
        state = commit(recordAgentStep(state, 4, '07-validator', 'ESCALATED', validatorOutput, undefined, undefined, timing));
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'CRITICAL_ISSUE',
          `07-validator escalated: ${validatorOutput.details.summary}`,
          { issues: validatorIssues.map(i => i.message) }
        );
        return finish(state, 'ESCALATED', '07-validator declared the work blocked');
      }

      // FAIL or LOOP_BACK with no CRITICAL issue of its own: the Validator says the work is not
      // acceptable but names nothing fixable. Fail closed (I-6, kept per reviewer: I-13).
      if (validatorOutput.status !== 'PASS' && criticalIssues(validatorIssues).length === 0) {
        recordValidatorFindings(mergeIssues({ issues: validatorIssues, copyDir, previousCopyDirs }, undefined, cwd));
        state = commit(recordAgentStep(state, 4, '07-validator', 'FAIL', validatorOutput, undefined, undefined, timing));
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'CRITICAL_ISSUE',
          `07-validator reported ${validatorOutput.status} with no CRITICAL issue: ${validatorOutput.details.summary}`,
          { issues: validatorIssues.map(i => i.message) }
        );
        return finish(state, 'ESCALATED', `07-validator reported ${validatorOutput.status}`);
      }

      const followup = await followupReview(e);
      if ('finished' in followup) return followup.finished;
      const followupIssues: ValidatorIssue[] | undefined = followup.output ? followup.output.details.issues : undefined;

      // The merged list (D-10): the main review's paths mapped out of its copy, then the
      // follow-up's; routing, the Stage 4 gate and CHECKPOINT 3 all use it (AC-122).
      const merged = mergeIssues(
        { issues: validatorIssues, copyDir, previousCopyDirs },
        followupIssues ? { issues: followupIssues } : undefined,
        cwd
      );
      recordValidatorFindings(merged);

      if (followup.output && followup.output.status !== 'PASS' && criticalIssues(followupIssues).length === 0) {
        state = recordEscalation(
          state,
          4,
          FOLLOWUP_AGENT,
          'CRITICAL_ISSUE',
          `${FOLLOWUP_AGENT} reported ${followup.output.status} with no CRITICAL issue: ${followup.output.details.summary}`,
          { issues: (followupIssues ?? []).map(i => i.message) }
        );
        return finish(state, 'ESCALATED', `${FOLLOWUP_AGENT} reported ${followup.output.status}`);
      }

      const challenged = await challengeCriticals(e, merged);
      if (challenged) return challenged;

      const { standing, disproved } = verdictOf(merged, evaluationNumbered(e).skeptics ?? []);
      // AC-130: shown at CHECKPOINT 3 with both reasons, never routed, never dropped.
      recordFindingsOnce(4, SKEPTIC_AGENT, disproved.map(disprovedFinding));
      const verdict = decidedVerdict(standing, disproved);
      const critical = standing.map(entry => entry.issue);

      if (critical.length === 0) {
        state = closeEvaluation(state, e, { outcome: 'decided', verdict });
        state = commit(recordAgentStep(state, 4, '07-validator', 'PASS', validatorOutput, undefined, undefined, timing));
        return undefined;
      }

      state = closeEvaluation(state, e, { outcome: 'decided', verdict });
      state = commit(recordAgentStep(state, 4, '07-validator', 'FAIL', validatorOutput, undefined, undefined, timing));

      // The bound (AC-32): the Validator has now judged MAX_VALIDATOR_ROUNDS rounds of fixes.
      if (round === MAX_VALIDATOR_ROUNDS) {
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'MAX_LOOPS',
          `${critical.length} CRITICAL issue(s) remain after ${MAX_VALIDATOR_ROUNDS} rounds`,
          { issues: critical.map(describeIssue), loopCount: round }
        );
        return finish(state, 'ESCALATED', `CRITICAL issues remain after ${MAX_VALIDATOR_ROUNDS} rounds`);
      }

      const routing = routeCriticalIssues(
        critical,
        {
          backend: (outputs.backend?.details.filesModified ?? []).map(f => f.path),
          frontend: (outputs.frontend?.details.filesModified ?? []).map(f => f.path)
        },
        cwd
      );

      // Anything the harness cannot hand to an owning builder goes to a human — all of it, with
      // the reason, and before any builder spends a round on the part that could be routed (AC-31).
      if (routing.unroutable.length > 0) {
        const reasons = new Map<ValidatorIssue, UnroutableReason>(routing.unroutable.map(u => [u.issue, u.reason]));
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'CRITICAL_ISSUE',
          `${routing.unroutable.length} of ${critical.length} CRITICAL issue(s) cannot be routed to a builder`,
          {
            issues: critical.map(i =>
              reasons.has(i) ? `${describeIssue(i)} (unroutable: ${reasons.get(i)})` : describeIssue(i)
            )
          }
        );
        return finish(state, 'ESCALATED', 'Validator CRITICAL issues cannot be routed to a builder');
      }

      round++;
      state = commit(recordValidatorRound(state, round));
      log(`\n↩️  Validator round ${round} of ${MAX_VALIDATOR_ROUNDS}: ${critical.length} CRITICAL issue(s) back to their builders\n`);

      // The round is judged by the same gates as the original build, over the merged outputs.
      const stopped = await validatorRoundFix(round, routing);
      if (stopped) return stopped;
      afterRoundFix = true;
    }
  };

  /**
   * CP3's presentation (D-4, D-8): the full VALIDATION_REPORT.md, every IMPORTANT finding the run
   * recorded, and the change since the base captured at run start — collected now, from the tree.
   * The same function re-builds it for `--approve 3` and the I-7 check, so they compare like with
   * like. A change that cannot be collected cannot be presented, so CP3 escalates (fails closed).
   */
  const presentValidatedChange = (): Promise<CheckpointPresentation> =>
    presentCheckpoint(3, state, outputs, runDirAbs, cwd, changes);

  /**
   * Start a rework (D-5), after a rejection: move the rejected documents into
   * `_superseded/<cycle>/` (never deleted; a retry skips what already moved), invalidate the steps
   * the rework re-runs, and record its start. The caller commits.
   */
  const startRework = ({ rejection, cycle }: ReworkCycle) => {
    const id = rejection.checkpointId;
    const { supersededDir, moved } = supersedeArtifacts(runDirAbs, cycle, SUPERSEDED_ON_REWORK[id]);
    state = invalidateAgentSteps(state, [...INVALIDATED_ON_REWORK[id]], `Superseded by the rework of ${rejection.name} (cycle ${cycle})`);
    state = recordReworkStart(state, cycle, { supersededDir: relative(cwd, supersededDir) });
    log(`  ♻️  Rework of ${rejection.name} (cycle ${cycle}): ${moved.length > 0 ? moved.join(', ') : 'nothing'} superseded`);
  };

  /**
   * The start of a resume (§4, D-3), inside the try because it writes. The refusals already
   * happened in the pre-flight; nothing here can refuse.
   *
   *  - `--approve <n>`: the hash was re-checked in the pre-flight. Record the approval, bound to
   *    the hash that was presented, leave the pause and continue past the checkpoint (AC-51).
   *  - `--reject <n> --notes`: record the rejection and a MANUAL escalation, and finish ESCALATED,
   *    resumable (AC-74). Returns the finished state. Nothing is re-run until the next resume.
   *  - continue: a grant for the exhausted builder (AC-72), the reopen of an ESCALATED run
   *    (AC-35), and — when the run stopped on a rejection — the start of its rework (D-5).
   *
   * Each path commits. Then the outputs are re-derived from the record and the harness documents
   * re-rendered from them, so every path a prompt names exists (AC-34) and nothing superseded is
   * re-rendered.
   */
  const applyResume = async (request: ResumeRequest): Promise<FeatureState | undefined> => {
    const runClass = classifyRun(state);
    log(`  ▶️  Resuming ${runClass} run at Stage ${state.currentStage}`);
    const action = request.action;

    if (action.kind === 'approve') {
      const pending = state.pendingCheckpoint!;
      state = clearPause(state);
      state = recordCheckpointApproval(state, pending.stage, pending.name, 'resume --approve', undefined, {
        checkpointId: pending.checkpointId,
        sha256: pending.sha256
      });
      state = commit(reopenFeature(state, { fromClass: 'PAUSED', action: 'approve', checkpointId: pending.checkpointId }));
      log(`✅ ${pending.name} approved (resume --approve)`);
    } else if (action.kind === 'reject') {
      const pending = state.pendingCheckpoint!;
      state = recordCheckpointRejection(state, {
        checkpointId: pending.checkpointId,
        name: pending.name,
        stage: pending.stage,
        notes: action.notes,
        sha256: pending.sha256,
        artifactPaths: [...pending.artifactPaths],
        reworkAgents: reworkAgentsFor(pending.checkpointId, pending.name, pending.changedFiles),
        source: 'resume --reject'
      });
      state = reopenFeature(state, { fromClass: 'PAUSED', action: 'reject', checkpointId: pending.checkpointId });
      state = recordEscalation(state, pending.stage, 'human', 'MANUAL', `${pending.name} was rejected.`, {
        checkpointId: pending.checkpointId,
        notes: action.notes
      });
      return finish(state, 'ESCALATED', `${pending.name} was rejected`);
    } else {
      const grant = request.grantAttempts;
      const exhausted = exhaustedBuilder(state);
      let changed = false;
      if (grant !== undefined && exhausted) {
        // Exactly the builder and the budget it exhausted (I-8); checkResumeRequest capped n.
        state = recordAttemptGrant(state, { builder: exhausted.builder, attempts: grant, at: exhausted.at });
        log(`  ➕ ${grant} more attempt(s) granted to ${exhausted.builder}`);
        changed = true;
      }
      if (runClass === 'ESCALATED' || changed || state.status !== 'IN_PROGRESS') {
        state = reopenFeature(state, {
          fromClass: runClass === 'ESCALATED' ? 'ESCALATED' : 'ACTIVE',
          action: 'continue',
          ...(grant !== undefined ? { grantedAttempts: grant } : {})
        });
        changed = true;
      }
      const due = reworkToStart(state);
      if (due) {
        startRework(due);
        changed = true;
      }
      if (changed) state = commit(state);
    }

    refreshOutputs();
    if (outputs.backend) {
      writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(outputs.backend));
      writeDocument('API_CONTRACT.md', renderApiContract(outputs.backend));
    }
    if (outputs.frontend) writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(outputs.frontend));
    if (outputs.test) writeDocument('TEST_REPORT.md', renderTestReport(outputs.test));
    return undefined;
  };

  /**
   * What a re-run planning agent is told about the version that was not accepted (D-5, D-B): the
   * active rework of checkpoint `id` (the reviewer's notes, the superseded documents), else the
   * gate that invalidated the agent's last PASS (its reason, the existing documents). Undefined for
   * a first run. A pre-supplied (tier-1) document is reworked the same way, by the factory's agent.
   */
  const planningRework = (
    id: 1 | 2,
    agent: '02-story-writer' | '03-spec-writer',
    gate: string
  ): CheckpointRework | undefined => {
    const documents = SUPERSEDED_ON_REWORK[id];
    const active = activeRework(state);
    if (active && active.rejection.checkpointId === id && active.rejection.rework) {
      const dir = resolve(cwd, active.rejection.rework.supersededDir);
      return {
        checkpointName: active.rejection.name,
        notes: active.rejection.notes,
        rejectedPaths: existingFiles(documents.map(name => join(dir, name)))
      };
    }
    const invalidated = lastInvalidation(state, agent);
    if (invalidated) {
      return {
        checkpointName: gate,
        notes: invalidated.reason,
        rejectedPaths: existingFiles(documents.map(name => join(runDirAbs, name)))
      };
    }
    return undefined;
  };

  /**
   * The CP3 rework (D-5, I-10), at the start of Stage 4 while it is active: each builder the
   * rejection named (backend first) that has not passed this rework cycle re-runs in its own
   * `rework` budget, briefed with the notes; its output is merged and its documents re-rendered.
   * Then Gate 1 and the Stage 3 gate over the merged outputs. Gate 1.5, the Test Verifier (its PASS
   * was invalidated) ∥ the Validator on the rework's snapshot, and Gate 2 follow in Stage 4 as always
   * — validator rounds are not reset — then the Stage 4 gate and CP3, presented again.
   */
  const changeRework = async (): Promise<FeatureState | undefined> => {
    const active = activeRework(state);
    if (!active || active.rejection.checkpointId !== 3 || !active.rejection.rework) return undefined;
    const { rejection, cycle } = active;
    phase(`Rework after ${rejection.name} (cycle ${cycle})`);

    const supersededDir = resolve(cwd, rejection.rework!.supersededDir);
    const rework: CheckpointRework = {
      checkpointName: rejection.name,
      notes: rejection.notes,
      rejectedPaths: existingFiles(SUPERSEDED_ON_REWORK[3].map(name => join(supersededDir, name)))
    };
    const at: BuilderPhase = { phase: 'rework', round: cycle };

    for (const half of ['backend', 'frontend'] as const) {
      const agent = BUILDER_AGENT[half];
      if (!rejection.reworkAgents.includes(agent) || hasPass(state, agent, at)) continue;
      const run = await runBuilderLoop(half, { phase: 'rework', round: cycle, rework });
      if ('finished' in run) return run.finished;
      if (half === 'backend') {
        const merged = outputs.backend ? mergeBuilderOutput(outputs.backend, run.output as BackendBuilderOutput, cwd) : (run.output as BackendBuilderOutput);
        outputs.backend = merged;
        writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(merged));
        writeDocument('API_CONTRACT.md', renderApiContract(merged));
      } else {
        const merged = outputs.frontend ? mergeBuilderOutput(outputs.frontend, run.output as FrontendBuilderOutput, cwd) : (run.output as FrontendBuilderOutput);
        outputs.frontend = merged;
        writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(merged));
      }
    }

    const reworkMaterialization = await materializationGate(4);
    if (reworkMaterialization) return reworkMaterialization;

    // Resume by recorded completion (IMPORTANT-1): once a later step of this cycle is on record
    // (verification started — PR B-2 AC-157 —, or the Test Verifier, the Validator or Gate 2 ran
    // after the snapshot), this gate pass is done, and stage3-<k> stays the tree it judged. A kill
    // before verification starts (in Gate 1.5) still re-evaluates it (AC-85).
    if (stage3SnapshotPassedBy(state, at)) {
      log(`  📸 The rework's Stage 3 gate passed earlier in cycle ${cycle}, and the run has moved past it: its snapshot is kept`);
      return undefined;
    }
    return stage3Gate(4, at);
  };

  /** CHECKPOINT 3: a human approves the validated change, after the Stage 4 gate (AC-44). */
  const reviewChange = async (): Promise<FeatureState | undefined> => {
    // Approved before the run stopped (the baseline write failed, or a kill): the human's decision
    // stands, and the run goes straight to the baseline and SUCCESS (D-6).
    if (isCheckpointApproved(state, 3)) return undefined;
    phase('Checkpoint 3: Review');
    return checkpoint(CHECKPOINTS.CHANGE, presentValidatedChange);
  };

  try {
    log(`Starting Feature Factory: ${state.featureName}`);
    log(`Feature ID: ${state.featureId}`);

    if (archivedRuns.length > 0) {
      log(
        `  📦 Archived ${archivedRuns.length} finished run${archivedRuns.length === 1 ? '' : 's'} into .factory/_archive/`
      );
    }

    if (resumed && resumeRequest) {
      const stopped = await applyResume(resumeRequest);
      if (stopped) return stopped;
    }

    // A pre-supplied spec is accepted only while nothing of the planning has happened; a resumed
    // pre-supplied run is recognised by its tier-1 steps and goes through the common stages, which
    // skip what it supplied (D-4).
    const acceptSupplied =
      options.preSuppliedSpec !== undefined &&
      state.currentStage <= 2 &&
      !isPreSuppliedRun(state) &&
      !['01-researcher', '02-story-writer', '03-spec-writer'].some(agent => hasPass(state, agent));
    const stages: Array<() => Promise<FeatureState | undefined>> = acceptSupplied
      ? [() => preSuppliedStages(options.preSuppliedSpec!), stage3, stage4, reviewChange]
      : [stage1, stage2, stage3, stage4, reviewChange];

    for (const stage of stages) {
      const stopped = await stage();
      if (stopped) return stopped;
    }

    // ========================================================================
    // COMPLETION: SUCCESS = the Stage 4 gate passed and CHECKPOINT 3 was approved (AC-44)
    // ========================================================================
    // The baseline the next run is judged against comes from this run's own latest passing Gate 2
    // count (AC-65, D-7). It is written before the run is finished: if the write throws, the outer
    // catch escalates and the run is not reported SUCCESS. The Consolidator is not invoked here.

    const baselinePath = writeRegressionBaseline(cwd, baselineFromRun(state, new Date().toISOString()));
    log(`  📏 Regression baseline → ${baselinePath}`);

    state = finish(state, 'SUCCESS', 'Stage 4 gate passed and CHECKPOINT 3 approved');

    log(`\n✅ Feature Factory Complete: ${state.featureName}`);
    log(`Total time: ${Math.round(state.metrics.totalTime / 1000 / 60)} minutes`);
    log(`Total loop-backs: ${state.metrics.loopCount}`);

    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The record itself is what failed. There is nowhere to write an escalation TO, so do not
    // pretend to record one — rethrow, and let the CLI exit non-zero with the real reason. The
    // alternative is returning a state that says ESCALATED while no file on disk says anything,
    // which is the one outcome worse than stopping: an unrecorded run that looks recorded.
    if (error instanceof StatePersistenceError) {
      log(`❌ ${message}`);
      throw error;
    }

    log(`❌ Orchestration failed: ${message}`);
    state = recordEscalation(
      state,
      state.currentStage,
      'orchestrator',
      'MANUAL',
      `Orchestration error: ${message}`
    );
    return finish(state, 'ESCALATED', message);
  }
}

/**
 * The Test Verifier's verdict (AC-19, I-6). PASS only when the agent says PASS, no test failed,
 * and it raised no CRITICAL issue. Pure: reads the output, decides, names why.
 */
function testVerifierVerdict(output: any): {
  passed: boolean;
  reasons: string[];
  failingCriteria: string[];
  issues: string[];
} {
  const details = output?.details ?? {};
  const failed: number = details.testExecution?.failed ?? 0;
  const issues: Array<{ acId?: string; severity?: string; issue?: string }> = Array.isArray(details.issues)
    ? details.issues
    : [];
  const critical = issues.filter(i => i.severity === 'CRITICAL');

  const reasons: string[] = [];
  if (output?.status !== 'PASS') reasons.push(`status ${output?.status}`);
  if (failed > 0) reasons.push(`${failed} test(s) failed`);
  if (critical.length > 0) reasons.push(`${critical.length} CRITICAL issue(s)`);

  const results: Array<{ acId?: string; status?: string }> = details.acceptanceTests?.results ?? [];
  const failingCriteria = [
    ...results.filter(r => r.status !== 'TESTED' && r.status !== 'NOT_COVERABLE').map(r => `${r.acId} (${r.status})`),
    ...(details.testExecution?.failingTests ?? []).map((t: { name: string; error: string }) => `${t.name}: ${t.error}`)
  ];

  return {
    passed: reasons.length === 0,
    reasons,
    failingCriteria,
    issues: issues.map(i => `[${i.severity}] ${i.acId}: ${i.issue}`)
  };
}

/** A committed loop-back failure as the retry briefing reads it: test, schema or status (MINOR-6). */
function asBuilderFailure(failure: { kind: 'test' | 'schema' | 'status'; error: string } | undefined): BuilderFailure | undefined {
  if (!failure) return undefined;
  return { kind: failure.kind, error: failure.error };
}

/**
 * Re-build checkpoint `id`'s presentation for `state` exactly as it was built when presented: CP1
 * and CP2 from the run directory's files; CP3 also from the run's IMPORTANT findings and the change
 * collected against the run's change base with the builders' claims (D-4, D-8). The checkpoint
 * itself, `--approve` (AC-52) and the I-7 check all use this one function, so they compare like
 * with like. A change that cannot be collected is a CheckpointPresentationError: it cannot be shown.
 */
async function presentCheckpoint(
  id: CheckpointId,
  state: FeatureState,
  outputs: StageOutputs,
  runDirAbs: string,
  cwd: string,
  changes: ChangeTracker
): Promise<CheckpointPresentation> {
  if (id !== 3) return presentationFor(id, runDirAbs);

  // A run recorded before A-2 has no base: its change is the claimed files, labelled as such.
  const base = state.changeBase ?? { kind: 'none' as const, reason: 'the run recorded no change base' };
  const claimed = claimedFilesFromBuilders(outputs.backend, outputs.frontend).map(ref => ref.path);

  let change: ChangeSet;
  try {
    change = await changes.collect(cwd, base, claimed);
  } catch (error) {
    throw new CheckpointPresentationError(
      `${CHECKPOINTS.CHANGE.name} cannot be presented: ${error instanceof Error ? error.message : String(error)}`,
      []
    );
  }
  // PR B-1 (D-13, I-5): the snapshot section only for a run that has snapshot records, so a run
  // paused or approved before B-1 re-builds exactly the text it presented.
  const snapshots =
    state.stage3Snapshots !== undefined
      ? { entries: state.stage3Snapshots, ...(state.changeBase ? { base: state.changeBase } : {}) }
      : undefined;
  // PR B-2 (D-16, I-15): the follow-up document only when the run's latest first pass reviewed
  // files, derived from state, so a run without one re-builds exactly the text it presented.
  return presentationFor(3, runDirAbs, {
    findings: state.importantFindings ?? [],
    change,
    ...(snapshots ? { snapshots } : {}),
    ...(followupPresented(state) ? { followup: true as const } : {})
  });
}

/** HEAD for the HEAD_MOVED message (D-8): `<branch | detached | unborn> at <commit | no commit>`. */
function describeHead(head: HeadState): string {
  const where =
    head.branch === undefined
      ? head.commit === undefined
        ? 'unborn'
        : 'a branch not recorded'
      : head.branch === 'HEAD'
        ? 'detached'
        : head.branch;
  return `${where} at ${head.commit ?? 'no commit'}`;
}

/**
 * Checkpoint `id`'s presentation re-built now, or undefined when it can no longer be presented.
 * The whole presentation, not just its hash: `unescapedSha256` tells a pre-B-1 hash apart (AC-110).
 */
async function currentPresentation(
  represent: (id: CheckpointId) => Promise<CheckpointPresentation>,
  id: CheckpointId
): Promise<CheckpointPresentation | undefined> {
  try {
    return await represent(id);
  } catch (error) {
    if (!(error instanceof CheckpointPresentationError)) throw error;
    return undefined;
  }
}

/**
 * AC-110: the recorded hash is the hash of the RAW text of what is presented now. The documents are
 * unchanged, but the hash was taken before PR B-1, over text this version shows escaped under a
 * warning banner. Such a hash can never match again, and the run cannot be re-presented, so it is
 * closed, never approved on a hash that no longer describes what is shown.
 */
function recordedBeforeEscaping(current: CheckpointPresentation | undefined, recorded: string): boolean {
  return current !== undefined && current.sha256 !== recorded && current.unescapedSha256 === recorded;
}

/** The AC-110 refusal text: the same for `--approve` (ARTIFACT_CHANGED) and the I-7 re-check (APPROVED_ARTIFACT_CHANGED). */
function presentationChangedInThisVersion(name: string, runId: string, cwd: string): string {
  return (
    `${name}: the presentation changed in this version: invisible or direction-control characters are now shown ` +
    `escaped under a warning banner, so the hash recorded before this version no longer matches. ` +
    `Close the run: npm run factory -- --close ${runId} --cwd ${shellArg(cwd)}`
  );
}

/**
 * AC-52: `--approve <n>` approves what was presented at the pause, or nothing. The presentation is
 * re-built and its hash compared with the one the pause recorded. A changed — or no longer
 * presentable — artifact is refused with ARTIFACT_CHANGED before anything is written: the run stays
 * PAUSED, and no approval is recorded.
 */
async function assertPendingUnchanged(
  state: FeatureState,
  represent: (id: CheckpointId) => Promise<CheckpointPresentation>,
  cwd: string
): Promise<void> {
  const pending = state.pendingCheckpoint!;
  const current = await currentPresentation(represent, pending.checkpointId);
  if (current?.sha256 === pending.sha256) return;

  if (recordedBeforeEscaping(current, pending.sha256)) {
    throw new RunRefusedError('ARTIFACT_CHANGED', presentationChangedInThisVersion(pending.name, state.featureId, cwd));
  }
  throw new RunRefusedError(
    'ARTIFACT_CHANGED',
    `${pending.name}: artifact changed since it was presented ` +
      `(${current === undefined ? 'it can no longer be presented' : 'its hash differs'}), so it cannot be approved as shown. ` +
      `Nothing was recorded; the run is still paused. Reject it so it is reworked: ` +
      `npm run factory -- --resume ${state.featureId} --reject ${pending.checkpointId} --notes "<why>" --cwd ${shellArg(cwd)}, ` +
      `or close it: npm run factory -- --close ${state.featureId} --cwd ${shellArg(cwd)}`
  );
}

/**
 * I-7: a resume that will skip an approved checkpoint first re-builds what that checkpoint
 * presented and compares the hash: CP1 and CP2 from the files, CP3 from its report, the findings
 * and the change collected now. A changed or unpresentable artifact is refused with
 * APPROVED_ARTIFACT_CHANGED before anything is written: builders must never implement a story or
 * brief edited after its approval, and a run must never end SUCCESS on a change nobody approved.
 * A checkpoint whose approval a later rejection superseded is not checked: it will be presented
 * again.
 */
async function assertApprovedArtifactsUnchanged(
  state: FeatureState,
  represent: (id: CheckpointId) => Promise<CheckpointPresentation>,
  runDirAbs: string,
  cwd: string
): Promise<void> {
  for (const definition of [CHECKPOINTS.STORY, CHECKPOINTS.BRIEF, CHECKPOINTS.CHANGE]) {
    const approval = checkpointApproval(state, definition.id);
    if (!approval?.sha256) continue;

    const current = await currentPresentation(represent, definition.id);
    if (current?.sha256 === approval.sha256) continue;

    if (recordedBeforeEscaping(current, approval.sha256)) {
      throw new RunRefusedError('APPROVED_ARTIFACT_CHANGED', presentationChangedInThisVersion(definition.name, state.featureId, cwd));
    }
    throw new RunRefusedError(
      'APPROVED_ARTIFACT_CHANGED',
      `${definition.name} was approved, but what it presented has ${current === undefined ? 'gone missing' : 'changed'} since ` +
        `(${relative(cwd, runDirAbs)}). The run will not continue on something nobody approved. ` +
        `Close it with: npm run factory -- --close ${state.featureId} --cwd ${shellArg(cwd)}`
    );
  }
}

/** The paths that exist as regular files, in order: what a rework briefing may point an agent at. */
function existingFiles(paths: readonly string[]): string[] {
  return paths.filter(path => {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  });
}

type BuilderHalf = 'backend' | 'frontend';
type BuilderOutputFor<H extends BuilderHalf> = H extends 'backend' ? BackendBuilderOutput : FrontendBuilderOutput;

const BUILDER_AGENT: Readonly<Record<BuilderHalf, BuilderAgent>> = {
  backend: '04-backend-builder',
  frontend: '05-frontend-builder'
};

/**
 * Which phase a builder loop runs in: the Stage 3 build, validator round `round` with its routed
 * issues, or CP3 rework cycle `round` with the rejection's briefing (D-5).
 */
type BuilderRun =
  | { phase: 'stage3' }
  | { phase: 'validator-round'; round: number; issues: ValidatorIssue[] }
  | { phase: 'rework'; round: number; rework: CheckpointRework };

/** The real start and end of one agent invocation (D-13), shared by its invocation record and its step. */
type InvocationTiming = { startedAt: string; completedAt: string };

/**
 * Where an invocation sits in a builder loop (phase, round, attempt), or which validator round it
 * judged; for Stage 4 verification also the evaluation it belonged to (PR B-2 D-8) and, for a
 * skeptic, its instance (D-11).
 */
type InvocationMeta = {
  phase?: StepPhase['phase'];
  round?: number;
  attempt?: number;
  evaluation?: number;
  /** Which skeptic a 07c invocation was (PR B-2 D-11). */
  instance?: SkepticInstance;
};

/** The follow-up reviewer and the skeptic (PR B-2 D-6), and the document the skeptic's schema names. */
const FOLLOWUP_AGENT = '07b-validator-followup';
const SKEPTIC_AGENT = '07c-validator-skeptic';
const SKEPTIC_DOCUMENT = REQUIRED_ARTIFACTS[SKEPTIC_AGENT][0];

/** Why a first pass recorded its follow-up as skipped (D-9). */
const FOLLOWUP_SKIPPED_REASON = 'the Test Verifier changed no file';

/** Why a run has no snapshot to copy for the Validator, when it is in git (AC-126, N-10). */
const NO_SNAPSHOT_RECORDED_REASON = 'no snapshot was recorded for this run (started before PR B-1)';

/**
 * Remove a review directory a failed copy attempt left (D-3: discard it after an extraction
 * failure). It was never recorded, so nothing refers to it. Best effort: a directory that cannot
 * be removed stays, unrecorded, and the escalation already says why the copy failed.
 */
function discardReviewDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Left in the temp directory; see above.
  }
}

/** How long a recorded invocation error may be (PR B-2 I-16). */
const INVOCATION_ERROR_LENGTH = 500;

/** What a thrown invocation is recorded with (I-16): the first line of its message, at most 500 characters. */
function invocationError(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return (firstLine.trim() === '' ? 'the invocation threw' : firstLine).slice(0, INVOCATION_ERROR_LENGTH);
}

/** An agent's output, and when it ran. The output is untyped until validateOutputSchema judges it. */
type TimedInvocation = { output: any; timing: InvocationTiming };

/** What the harness itself measured, for the Stage 4 gate (D-5). Never supplied by an agent. */
type HarnessMeasurements = NonNullable<BuildStageContextInput['harness']>;

/**
 * Helper: Check stage gate.
 *
 * The context is DERIVED — from what the agents produced and what is on disk. It used to be
 * fabricated here (testPassRate hardcoded to 1.0, criticalIssuesCount to 0), which meant the
 * gates were real code judging invented evidence and the CRITICAL criteria could never fail.
 * See harness/stage-context.ts.
 */
async function checkStageGate(
  stage: number,
  cwd: string,
  outputs: StageOutputs,
  extra: {
    loops?: BuildStageContextInput['loops'];
    artifactDir: string;
    harness?: HarnessMeasurements;
    /** A part of the stage's contract (the split Stage 2 gate); the whole contract otherwise. */
    contract?: StageContract;
  }
): Promise<StageAdvancementDecision> {
  // This used to call persistArtifacts(outputs, cwd) with NO run directory — so any document not
  // already persisted (the Validator's, the Consolidator's) would have been written into the
  // project root. Every agent's documents are now persisted once, right after it returns, into
  // the run directory. A gate only reads.
  const contract = extra.contract ?? stageContracts[stage];
  const context = buildStageContext({
    stage,
    cwd,
    outputs,
    loops: extra.loops,
    artifactDir: extra.artifactDir,
    harness: extra.harness
  });

  return canAdvanceStage(stage, contract, context);
}
