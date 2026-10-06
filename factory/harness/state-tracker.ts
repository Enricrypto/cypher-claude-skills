/**
 * Feature Factory State Tracker
 *
 * Tracks execution state across stages to enable:
 * - Resuming after interruptions
 * - Auditing execution history
 * - Learning from past feature runs
 *
 * This module is PURE — it builds and transforms FeatureState and touches no filesystem, so the
 * transitions can be tested without a temp directory. The write lives in state-store.ts, and
 * the orchestrator decides when it happens.
 *
 * (This header used to claim "State persisted to JSON file in
 * feature-factory/artifacts/feature-states/". Nothing wrote one, and nothing ever had. The
 * record now lands at <project>/.factory/<featureId>/state.json, beside that run's documents.)
 */

import { isAbsolute } from 'path';

import { FeatureFactoryAgentOutput, ValidatorFollowupOutput, ValidatorOutput } from './agent-output-schema';
import { classifyRun, samePhase } from './run-lifecycle';

/**
 * Where a builder step or loop-back happened (D-9). `stage3` is the original build;
 * `validator-round` is a re-invocation for Validator CRITICAL issues, numbered from 1; `rework`
 * (A-2, D-5) is a re-invocation after CHECKPOINT 3 was rejected, numbered by rejection cycle
 * from 1. Builder records keep stage 3 either way — the phase is what tells them apart.
 */
export type StepPhase = { phase?: 'stage3' | 'validator-round' | 'rework'; round?: number };

/** One builder budget: the Stage 3 build, one validator round, or one CP3 rework cycle. */
export type BuilderPhase =
  | { phase: 'stage3' }
  | { phase: 'validator-round'; round: number }
  | { phase: 'rework'; round: number };

export type BuilderAgent = '04-backend-builder' | '05-frontend-builder';

/** The three human checkpoints (A-2, D-4): 1 story, 2 brief, 3 validated change. */
export type CheckpointId = 1 | 2 | 3;

/**
 * How many times a builder has been invoked, per phase (AC-70). Stage 3 attempts and each
 * validator round's attempts are separate budgets of MAX_BUILDER_ATTEMPTS: a builder that needed
 * three tries to build still gets three tries to fix a Validator issue.
 */
export interface BuilderAttemptCounts {
  stage3: number;
  /** Keyed by validator round (1-based). */
  validatorRounds: Record<number, number>;
  /** Keyed by CP3 rejection cycle (1-based). Absent until the first rework attempt (A-2, D-5). */
  rework?: Record<number, number>;
}

/**
 * Extra attempts an operator granted with `--resume <id> --grant-attempts <n>` (AC-72). Each
 * grant adds `attempts` to exactly one builder's budget in exactly one phase.
 */
export interface AttemptGrant {
  builder: BuilderAgent;
  attempts: number;
  at: BuilderPhase;
  grantedAt: string; // ISO8601
}

/**
 * The checkpoint a PAUSED run is waiting on (AC-49). `sha256` is the hash of the exact text that
 * was presented; `--approve` re-builds that text and must get the same hash (AC-52).
 * `artifactPaths` are relative to the project cwd.
 */
export interface PendingCheckpoint {
  checkpointId: CheckpointId;
  name: string;
  stage: number;
  artifactPaths: string[];
  sha256: string;
  /** CP3 only: the files in the presented change. */
  changedFiles?: string[];
  pausedAt: string; // ISO8601
}

/**
 * A human said no at a checkpoint (A-2, D-5). The run ends ESCALATED (MANUAL) and a resume
 * re-runs `reworkAgents` with `notes`.
 */
export interface CheckpointRejection {
  checkpointId: CheckpointId;
  name: string;
  stage: number;
  /** '' is allowed from a TTY rejection; the CLI's `--reject` requires non-blank notes. */
  notes: string;
  sha256: string;
  artifactPaths: string[];
  /** CP1 → ['02-story-writer']; CP2 → ['03-spec-writer']; CP3 → the builders computed at rejection. */
  reworkAgents: string[];
  rejectedAt: string; // ISO8601
  source: 'approver' | 'resume --reject';
  /** Set when a resume starts the rework. */
  rework?: { startedAt: string; supersededDir: string };
}

/** One `--resume` that changed the run (A-2, D-2/D-3). */
export interface ResumeRecord {
  resumedAt: string; // ISO8601
  fromClass: 'ACTIVE' | 'PAUSED' | 'ESCALATED';
  action: 'continue' | 'approve' | 'reject';
  checkpointId?: CheckpointId;
  grantedAttempts?: number;
}

/**
 * Where the CP3 diff starts (A-2, D-8): HEAD at run start, or why there is no git base.
 *
 * PR B-1 (D-4, D-6) adds, for a fresh start inside git:
 *  - `branch`: `refs/heads/<x>`, or `HEAD` when detached; absent on an unborn branch (I-6) and in
 *    a base recorded before B-1 (then only `commit` is compared by the snapshot's HEAD check);
 *  - `preExisting`: the paths already changed or untracked at run start, sorted unique; absent
 *    when they could not be read, or in a base recorded before B-1 ("unknown").
 */
export type ChangeBase =
  | { kind: 'git'; commit?: string; branch?: string; preExisting?: string[] }
  | { kind: 'none'; reason: string };

/**
 * One Stage 3 snapshot event (PR B-1, D-7): after every passing Stage 3 gate (the Stage 3 build, a
 * validator round, a CP3 rework), either the snapshot commit written at `ref`
 * (`refs/factory/<id>/stage3-<n>`), or why none was attempted. `at` is the phase key: a run holds at
 * most one entry per phase, and a re-evaluated gate in the same phase reuses its `n` (I-4).
 * `reused` is set when an identical commit already at `ref` was kept (AC-85).
 */
export type Stage3Snapshot =
  | { status: 'written'; n: number; ref: string; commit: string; tree: string; at: BuilderPhase; takenAt: string; reused?: true }
  | { status: 'skipped'; reason: string; at: BuilderPhase; takenAt: string };

/** A snapshot that was written. */
export type WrittenStage3Snapshot = Extract<Stage3Snapshot, { status: 'written' }>;

/** HEAD as recorded at run start and as found at a snapshot (D-8): the HEAD_MOVED context. */
export interface HeadMove {
  recorded: { commit?: string; branch?: string };
  current: { commit?: string; branch?: string };
}

// ─── PR B-2 verification records (D-7) ─────────────────────────────────────────────────────────

/** What a review copy was made from (D-3): a recorded Stage 3 snapshot, or the AC-126 fallback. */
export type ReviewSource =
  | { kind: 'snapshot'; n: number; ref: string; commit: string; tree: string }
  | { kind: 'working-tree'; reason: string };

/**
 * One review copy (D-3, D-B2-2): its directory, its source, and the leaf count and leaf digest
 * taken when it was made (review-copy.ts `leafDigest`). A resume reuses the copy only while
 * `copyIntact(dir, {entries, digest})` holds.
 */
export interface ReviewCopyRecord {
  dir: string;
  source: ReviewSource;
  entries: number;
  /** sha256 (64 lowercase hex) of the copy's sorted leaf paths and types (D-B2-2). */
  digest: string;
  madeAt: string;
}

/** The review that reported an issue (D-10). */
export type IssueOrigin = '07-validator' | '07b-validator-followup';
export const ISSUE_ORIGINS: readonly IssueOrigin[] = ['07-validator', '07b-validator-followup'];

/** The two blind skeptic invocations per CRITICAL issue (D-11). */
export type SkepticInstance = 'A' | 'B';
export const SKEPTIC_INSTANCES: readonly SkepticInstance[] = ['A', 'B'];

/** One skeptic's recorded verdict on one issue (D-11, AC-133). */
export interface SkepticVerdictRecord {
  issueKey: string;
  origin: IssueOrigin;
  instance: SkepticInstance;
  verdict: 'DISPROVED' | 'UPHELD';
  reason: string;
  /** The document it was persisted as (`SKEPTIC_E<e>_<issueKey>_<A|B>.md`). */
  document: string;
  recordedAt: string;
}

/**
 * The tree the Test Verifier's changes are measured against (D-2, IMPORTANT-1): recorded on a
 * first-pass evaluation, and committed, BEFORE the Test Verifier is invoked in it.
 * - `tree`: the working tree's git tree id at that moment (`ChangeTracker.workingTreeId`), for an
 *   evaluation whose copy is a snapshot's;
 * - `copy`: the evaluation's own fallback copy of the working tree (AC-126), made before the Test
 *   Verifier started, with the leaf count and digest it must still have when measured against.
 * An evaluation that follows one whose baseline was not cleared (its measurement failed, or found a
 * change outside a test path) records THAT baseline again, so the earlier Test Verifier's writes are
 * still measured until they are reverted (verification.ts earlierBaseline).
 */
export type MeasurementBaseline =
  | { kind: 'tree'; tree: string; recordedAt: string }
  | { kind: 'copy'; dir: string; entries: number; digest: string; recordedAt: string };

/** What the harness measured the Test Verifier to have changed against the evaluation's baseline (D-2). */
export type TestVerifierChanges =
  | { kind: 'none' }
  | { kind: 'tests'; files: string[] }
  | { kind: 'outside-tests'; files: string[]; outside: string[] };

/**
 * The typed verdict the Stage 4 gate reads (D-12, AC-131): the keys of the CRITICAL issues still
 * standing and of those both skeptics disproved. `passed` is true exactly when nothing stands.
 */
export interface ValidationVerdict {
  passed: boolean;
  standing: string[];
  disproved: string[];
  recordedAt: string;
}

/** A recorded agent timing. */
export interface StepTiming {
  startedAt: string;
  completedAt: string;
}

/**
 * One evaluation (D-7): one main-Validator review with everything that hangs off it. Keyed by
 * `(cycle, round)`, plus the run-wide `e` (1-based). Every slot except `copy` (replaceable from
 * the same source only) and `testVerifierChanges` (re-measured on resume) is write-once, and a
 * closed evaluation takes no further record; the recorders below throw otherwise.
 */
export interface ValidatorEvaluation {
  e: number;
  /** The active CHECKPOINT 3 rework cycle, else 0. */
  cycle: number;
  /** validatorRoundsCompleted at the evaluation's Gate 2. */
  round: number;
  kind: 'first-pass' | 'validator-round';
  /** The verification-start marker (D-14, AC-157). */
  startedAt: string;
  copy?: ReviewCopyRecord;
  /** The directories of copies `copy` replaced (re-extracted), oldest first (MINOR-2). */
  previousCopyDirs?: string[];
  /** What the Test Verifier's changes are measured against (IMPORTANT-1). Write-once. */
  baseline?: MeasurementBaseline;
  validator?: { output: ValidatorOutput; timing: StepTiming };
  testVerifierChanges?: TestVerifierChanges;
  followup?:
    | { status: 'skipped'; reason: string }
    | { status: 'reviewed'; files: string[]; output: ValidatorFollowupOutput; timing: StepTiming };
  skeptics?: SkepticVerdictRecord[];
  closed?: { outcome: 'decided'; verdict: ValidationVerdict } | { outcome: 'escalated'; at: string };
}

/** One agent invocation, timed by the harness around the call (A-2, D-13). */
export interface AgentInvocationRecord {
  stage: number;
  agent: string;
  startedAt: string; // ISO8601
  completedAt: string; // ISO8601
  durationMs: number;
  phase?: StepPhase['phase'];
  round?: number;
  attempt?: number;
  /** PR B-2 (D-8): the evaluation (`e`) a Stage 4 verification invocation belonged to. */
  evaluation?: number;
  /** PR B-2 (D-11): which skeptic instance this invocation was. */
  instance?: SkepticInstance;
  /** PR B-2 (I-16): set when the invoker threw; the record is still written, then the error is rethrown. */
  outcome?: 'threw';
  /** PR B-2 (I-16): the first line of what the invoker threw, at most 500 characters. */
  error?: string;
}

export interface AgentStepRecord {
  stage: number;
  agent: string;
  /** WARN: the agent completed, but with non-blocking findings the human should see. */
  status: 'PASS' | 'FAIL' | 'WARN' | 'LOOP_BACK' | 'ESCALATED';
  startedAt: string; // ISO8601
  completedAt?: string; // ISO8601
  loopCount: number;
  output?: FeatureFactoryAgentOutput;
  error?: {
    message: string;
    context?: any;
  };
  /** Builder steps only: which phase (and validator round or rework cycle) this attempt belonged to. */
  phase?: 'stage3' | 'validator-round' | 'rework';
  round?: number;
  /** Set when the caller timed the step (A-2, D-13): completedAt - startedAt. */
  durationMs?: number;
  /**
   * Set when a later gate failure means this PASS must be re-run on resume (I-6), or a rework
   * superseded it (D-5). The step is kept for the record; a resume ignores it.
   */
  invalidated?: { at: string; reason: string };
}

export interface StageLoopBack {
  stage: number;
  agent: string;
  reason: string;
  attempt: number;
  fixApplied?: string;
  /** WARN: a non-fatal verification problem, recorded but not blocking. */
  result: 'PASS' | 'FAIL' | 'WARN';
  timestamp: string;
  /** Builder loop-backs only: which phase (and validator round or rework cycle) the failed attempt belonged to. */
  phase?: 'stage3' | 'validator-round' | 'rework';
  round?: number;
  /** Why the attempt failed, so a resumed attempt can be briefed with it (A-2, D-2). */
  failure?: { kind: 'test' | 'schema' | 'status'; error: string };
}

export interface EscalationRecord {
  stage: number;
  agent: string;
  reason:
    | 'MAX_LOOPS'
    | 'CRITICAL_ISSUE'
    | 'TIMEOUT'
    | 'SCHEMA_VALIDATION'
    | 'MANUAL'
    // An agent claimed files it never wrote. Distinct from CRITICAL_ISSUE: the code is not
    // wrong, it does not exist.
    | 'HALLUCINATION_DETECTED'
    // The project itself is not ready to be built in (no test script, no migrations, etc.).
    // Distinct because the fix is to the repo, not to the feature.
    | 'INFRASTRUCTURE_FAILURE'
    // The agent process itself failed — crashed, hit max turns, exhausted its budget.
    | 'EXECUTION_FAILURE'
    // PR B-1 (D-8): HEAD's commit or branch is not what the run started on, so no snapshot was
    // written (AC-86).
    | 'HEAD_MOVED'
    // PR B-1 (D-8): git could not write the snapshot; nothing was recorded (AC-88).
    | 'SNAPSHOT_FAILED'
    // PR B-2 (I-18): the review copy could not be extracted, copied or re-made, or the Test
    // Verifier's changes could not be measured.
    | 'REVIEW_COPY_FAILED';
  severity: 'CRITICAL' | 'IMPORTANT';
  context: {
    failingTests?: string[];
    issues?: string[];
    loopCount?: number;
    blockers?: string[];
    regressions?: string[];
    missingFiles?: string[];
    remediation?: string;
    passRate?: number;
    buildErrors?: string[];
    /** MAX_LOOPS by a builder: the budget it exhausted (A-2, D-3 `exhaustedBuilder`). */
    builderPhase?: BuilderPhase;
    /** MANUAL after a checkpoint rejection (A-2, D-4). */
    checkpointId?: CheckpointId;
    notes?: string;
    /** HEAD_MOVED (PR B-1, D-8): the HEAD the run started on, and the one found. */
    head?: HeadMove;
    message: string;
  };
  escalatedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface CheckpointApproval {
  stage: number;
  checkpointName: string;
  approvedAt: string;
  approvedBy?: string;
  notes?: string;
  /** A-2 (AC-50): which checkpoint, and the SHA-256 of the exact text the approver was given. */
  checkpointId?: CheckpointId;
  sha256?: string;
}

/**
 * A non-blocking finding a human should see before approving the work (AC-17).
 *
 * IMPORTANT criteria no longer block a stage; only CRITICAL ones do. What an IMPORTANT failure
 * produces instead is one of these, kept for the run's record (and, in A-2, for CP3).
 * `source` says who raised it: 'stage-gate', 'gate-1.5', 'gate-2' or '07-validator'.
 */
export interface ImportantFinding {
  stage: number;
  source: string;
  message: string;
  recordedAt: string; // ISO8601
}

/**
 * One Gate 2 evaluation, as the harness measured it (D-12).
 *
 * The counts come from the execution audit's own parse of the test output — never from an
 * agent. `referenceCount` is what "No Regressions" judged the tests that RAN (`passed + failed`,
 * not `total`: skipped/todo do not count — IMPORTANT-5) against: the ran-count in
 * `.factory/baseline.json` for the run's first evaluation, the run's first record's ran-count afterwards,
 * and undefined when there was neither (then only the 100% rule applies).
 */
export interface ExecutionGateRecord {
  /** 0 for the evaluation after the Test Verifier; N for validator round N. */
  round: number;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  canAdvance: boolean;
  referenceCount?: number;
  recordedAt: string; // ISO8601
}

export interface FeatureState {
  // Identity
  featureId: string; // UUID
  featureName: string;
  createdAt: string; // ISO8601
  createdBy?: string;

  // Current state
  currentStage: 1 | 2 | 3 | 4 | 5;
  currentAgent?: string;
  /** PAUSED (A-2, AC-49): waiting at `pendingCheckpoint`; committed, never finished. */
  status: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'ESCALATED' | 'PAUSED';

  /**
   * The `--feature` text the run was started with, so `--resume` needs no `--feature` (AC-37).
   * Absent in state files written before A-2.
   */
  featureDescription?: string;

  // Execution history
  stageHistory: AgentStepRecord[];
  loopBacks: StageLoopBack[];
  escalations: EscalationRecord[];

  // Approvals
  checkpointApprovals: CheckpointApproval[];

  /** Non-blocking findings. Optional so a state file written before A-1 still loads. */
  importantFindings?: ImportantFinding[];

  /** Every Gate 2 evaluation, in order. Optional so a state file written before A-1 still loads. */
  executionGateHistory?: ExecutionGateRecord[];

  /**
   * Builder invocations per phase, committed BEFORE each invocation so the count survives a kill
   * (A-2 resume reads it). Optional so a state file written before A-1 still loads.
   */
  builderAttempts?: Partial<Record<BuilderAgent, BuilderAttemptCounts>>;

  /** The highest validator round entered. Optional so a state file written before A-1 still loads. */
  validatorRoundsCompleted?: number;

  // A-2 run lifecycle. Every field is optional so a state file written before A-2 still loads.

  /** Where the CP3 diff starts (D-8). */
  changeBase?: ChangeBase;
  /** Set while the run is PAUSED at a checkpoint (AC-49). */
  pendingCheckpoint?: PendingCheckpoint;
  /** Every checkpoint rejection, in order; the index + 1 is the rework cycle (D-5). */
  checkpointRejections?: CheckpointRejection[];
  /** Extra builder attempts granted on resume (AC-72). */
  attemptGrants?: AttemptGrant[];
  /** Every agent invocation, timed (D-13). */
  agentInvocations?: AgentInvocationRecord[];
  /** Every resume that changed the run (D-2, D-3). */
  resumeHistory?: ResumeRecord[];

  /**
   * PR B-1 (D-7): one record per phase whose Stage 3 gate passed, in the order first recorded.
   * NOT initialised by createFeatureState: absent means the run has no B-1 snapshot event yet (so
   * CP3 shows no snapshot section, I-5).
   */
  stage3Snapshots?: Stage3Snapshot[];

  /**
   * PR B-2 (D-7): one record per Stage 4 verification evaluation, in order (`e` = index + 1).
   * NOT initialised by createFeatureState: absent means the run has no B-2 evaluation.
   */
  validatorEvaluations?: ValidatorEvaluation[];

  // Metrics
  metrics: {
    totalTime: number; // milliseconds
    timePerStage: Record<number, number>; // milliseconds
    loopCount: number;
    escalationCount: number;
  };

  // Final state
  completedAt?: string;
  completionStatus?: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP';
  finalSummary?: string;

  // Metadata
  tags?: string[];
  notes?: string;
}

/**
 * Create a new feature state
 */
export function createFeatureState(featureName: string, createdBy?: string, featureDescription?: string): FeatureState {
  return {
    featureId: generateUUID(),
    featureName,
    createdAt: new Date().toISOString(),
    createdBy,
    ...(featureDescription !== undefined ? { featureDescription } : {}),
    currentStage: 1,
    status: 'IN_PROGRESS',
    stageHistory: [],
    loopBacks: [],
    escalations: [],
    checkpointApprovals: [],
    importantFindings: [],
    executionGateHistory: [],
    builderAttempts: {},
    validatorRoundsCompleted: 0,
    checkpointRejections: [],
    attemptGrants: [],
    agentInvocations: [],
    resumeHistory: [],
    metrics: {
      totalTime: 0,
      timePerStage: {},
      loopCount: 0,
      escalationCount: 0
    }
  };
}

/**
 * Record a completed agent step
 */
export function recordAgentStep(
  state: FeatureState,
  stage: number,
  agent: string,
  status: AgentStepRecord['status'],
  output?: FeatureFactoryAgentOutput,
  error?: any,
  phase?: StepPhase,
  timing?: { startedAt: string; completedAt: string }
): FeatureState {
  const now = new Date().toISOString();

  const step: AgentStepRecord = {
    stage,
    agent,
    status,
    startedAt: timing?.startedAt ?? now,
    completedAt: timing?.completedAt ?? now,
    loopCount: countLoopsForAgent(state, agent),
    output,
    ...phaseFields(phase)
  };

  // Without timing the step keeps its pre-A-2 shape. With it, the start is the real start (D-13).
  if (timing) step.durationMs = durationBetween(timing.startedAt, timing.completedAt);

  if (error) {
    step.error = {
      message: error instanceof Error ? error.message : String(error),
      context: error instanceof Error ? error.stack : undefined
    };
  }

  state.stageHistory.push(step);
  return state;
}

/**
 * Record a loop-back attempt
 */
export function recordLoopBack(
  state: FeatureState,
  stage: number,
  agent: string,
  reason: string,
  result: 'PASS' | 'FAIL' | 'WARN',
  fixApplied?: string,
  phase?: StepPhase,
  failure?: StageLoopBack['failure']
): FeatureState {
  const loopBack: StageLoopBack = {
    stage,
    agent,
    reason,
    attempt: countLoopsForAgent(state, agent) + 1,
    fixApplied,
    result,
    timestamp: new Date().toISOString(),
    ...phaseFields(phase)
  };
  if (failure) loopBack.failure = { kind: failure.kind, error: failure.error };

  state.loopBacks.push(loopBack);
  state.metrics.loopCount++;
  return state;
}

/**
 * Record an escalation
 */
export function recordEscalation(
  state: FeatureState,
  stage: number,
  agent: string,
  reason: EscalationRecord['reason'],
  context: string,
  details?: Partial<EscalationRecord['context']>
): FeatureState {
  const escalation: EscalationRecord = {
    stage,
    agent,
    reason,
    severity: ['MAX_LOOPS', 'CRITICAL_ISSUE', 'TIMEOUT', 'HEAD_MOVED', 'SNAPSHOT_FAILED', 'REVIEW_COPY_FAILED'].includes(reason)
      ? 'CRITICAL'
      : 'IMPORTANT',
    context: {
      message: context,
      ...details
    },
    escalatedAt: new Date().toISOString()
  };

  state.escalations.push(escalation);
  state.metrics.escalationCount++;
  state.status = 'ESCALATED';
  return state;
}

/**
 * Record a checkpoint approval
 */
export function recordCheckpointApproval(
  state: FeatureState,
  stage: number,
  checkpointName: string,
  approvedBy?: string,
  notes?: string,
  binding?: { checkpointId: CheckpointId; sha256: string }
): FeatureState {
  const approval: CheckpointApproval = {
    stage,
    checkpointName,
    approvedAt: new Date().toISOString(),
    approvedBy,
    notes
  };

  // A-2 (AC-50): the approval is bound to the hash of what was presented. Without a binding the
  // record keeps its pre-A-2 shape; with one, a malformed binding is refused, never stored.
  if (binding) {
    assertCheckpointId(binding.checkpointId);
    assertSha256(binding.sha256);
    approval.checkpointId = binding.checkpointId;
    approval.sha256 = binding.sha256;
  }

  state.checkpointApprovals.push(approval);
  return state;
}

/**
 * Record non-blocking findings. Appends one entry per message; an empty list changes nothing.
 * Touches no filesystem — the caller commits.
 */
export function recordImportantFindings(
  state: FeatureState,
  stage: number,
  source: string,
  messages: string[]
): FeatureState {
  if (messages.length === 0) return state;

  const recordedAt = new Date().toISOString();
  state.importantFindings = [
    ...(state.importantFindings ?? []),
    ...messages.map(message => ({ stage, source, message, recordedAt }))
  ];
  return state;
}

/**
 * Record non-blocking findings, skipping any message the run already holds with the same `source`,
 * and any repeat within `messages` (D-12). Re-checking the same evidence, such as a resume that
 * re-renders identical documents or a Validator repeating an issue, so adds nothing. A message
 * recorded under another source does not count. Touches no filesystem — the caller commits.
 */
export function recordImportantFindingsOnce(
  state: FeatureState,
  stage: number,
  source: string,
  messages: string[]
): FeatureState {
  const known = new Set((state.importantFindings ?? []).filter(f => f.source === source).map(f => f.message));
  const fresh = messages.filter(message => !known.has(message) && (known.add(message), true));
  return recordImportantFindings(state, stage, source, fresh);
}

/**
 * recordImportantFindingsOnce, reporting what it added (MINOR-3): `added` holds the messages newly
 * recorded, in order, and is empty when every message was already held. The one place the
 * "record once, then log and save only what is new" callers get their list from. Touches no
 * filesystem: the caller logs and saves.
 */
export function addImportantFindingsOnce(
  state: FeatureState,
  stage: number,
  source: string,
  messages: string[]
): { next: FeatureState; added: string[] } {
  const before = state.importantFindings?.length ?? 0;
  const next = recordImportantFindingsOnce(state, stage, source, messages);
  return { next, added: (next.importantFindings ?? []).slice(before).map(finding => finding.message) };
}

/**
 * Record one Gate 2 evaluation. Touches no filesystem — the caller commits.
 */
export function recordExecutionGate(
  state: FeatureState,
  record: Omit<ExecutionGateRecord, 'recordedAt'>
): FeatureState {
  state.executionGateHistory = [
    ...(state.executionGateHistory ?? []),
    { ...record, recordedAt: new Date().toISOString() }
  ];
  return state;
}

/**
 * Count one builder invocation in its phase (AC-70). Call it, and commit, BEFORE invoking the
 * builder: an attempt that is killed mid-flight was still spent. Touches no filesystem.
 */
export function recordBuilderAttempt(
  state: FeatureState,
  agent: BuilderAgent,
  at: BuilderPhase
): FeatureState {
  const current = state.builderAttempts?.[agent] ?? { stage3: 0, validatorRounds: {} };
  const next: BuilderAttemptCounts = { stage3: current.stage3, validatorRounds: { ...current.validatorRounds } };
  // `rework` appears only once a rework attempt exists, so pre-A-2 counts keep their shape.
  if (current.rework) next.rework = { ...current.rework };

  switch (at.phase) {
    case 'stage3':
      next.stage3 += 1;
      break;
    case 'validator-round':
      next.validatorRounds[at.round] = (next.validatorRounds[at.round] ?? 0) + 1;
      break;
    case 'rework':
      next.rework = { ...(next.rework ?? {}), [at.round]: (next.rework?.[at.round] ?? 0) + 1 };
      break;
  }
  state.builderAttempts = { ...(state.builderAttempts ?? {}), [agent]: next };
  return state;
}

/**
 * Record that validator round `round` has been entered: the Validator's CRITICAL issues were
 * routed back to their builders. Never decreases. Touches no filesystem.
 */
export function recordValidatorRound(state: FeatureState, round: number): FeatureState {
  state.validatorRoundsCompleted = Math.max(state.validatorRoundsCompleted ?? 0, round);
  return state;
}

/** Only the phase fields that were given, so records without a phase stay exactly as before. */
function phaseFields(phase?: StepPhase): StepPhase {
  const fields: StepPhase = {};
  if (phase?.phase !== undefined) fields.phase = phase.phase;
  if (phase?.round !== undefined) fields.round = phase.round;
  return fields;
}

/**
 * Advance to next stage
 */
export function advanceToStage(state: FeatureState, nextStage: number): FeatureState {
  state.currentStage = nextStage as any;
  state.currentAgent = undefined;
  return state;
}

/**
 * Complete feature execution. `completedAt` defaults to now; `closeRun` passes its own clock.
 */
export function completeFeature(
  state: FeatureState,
  status: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP',
  summary?: string,
  completedAt: string = new Date().toISOString()
): FeatureState {
  state.completedAt = completedAt;
  state.completionStatus = status;
  state.finalSummary = summary;
  state.status = 'COMPLETED';

  // Calculate total time
  if (state.stageHistory.length > 0) {
    const start = new Date(state.stageHistory[0].startedAt);
    const end = state.completedAt ? new Date(state.completedAt) : new Date();
    state.metrics.totalTime = end.getTime() - start.getTime();
  }

  return state;
}

/**
 * Count how many times an agent has looped back
 */
export function countLoopsForAgent(state: FeatureState, agent: string): number {
  return state.loopBacks.filter(lb => lb.agent === agent).length;
}

/**
 * Get a summary of state for display
 */
export function getStateSummary(state: FeatureState): string {
  return `
Feature: ${state.featureName} (${state.featureId})
Status: ${state.status}
Current Stage: ${state.currentStage}

Timeline:
  Started: ${state.createdAt}
  ${state.completedAt ? `Completed: ${state.completedAt}` : 'In Progress'}
  Total Time: ${Math.round(state.metrics.totalTime / 1000 / 60)} minutes

Execution:
  Steps Completed: ${state.stageHistory.length}
  Loop Backs: ${state.metrics.loopCount}
  Escalations: ${state.metrics.escalationCount}

History:
${state.stageHistory
  .map(
    step => `  [${step.status}] Stage ${step.stage}: ${step.agent}
    Started: ${step.startedAt}
    ${step.error ? `Error: ${step.error.message}` : 'Success'}`
  )
  .join('\n')}

${
  state.escalations.length > 0
    ? `Escalations:\n${state.escalations
        .map(e => `  [${e.reason}] ${e.agent}: ${e.context.message}`)
        .join('\n')}`
    : ''
}
`;
}

/**
 * Save state to JSON file
 * (Actual file I/O would be handled by caller)
 */
export function serializeState(state: FeatureState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Load state from JSON string
 */
export function deserializeState(json: string): FeatureState {
  return JSON.parse(json) as FeatureState;
}

/**
 * Generate UUID (simple version)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get escalation reasons by severity
 */
export function getEscalationsByType(state: FeatureState, reason: EscalationRecord['reason']): EscalationRecord[] {
  return state.escalations.filter(e => e.reason === reason);
}

/**
 * Whether `--resume` can continue this run (D-1): ACTIVE, PAUSED or ESCALATED. A run that ended
 * ESCALATED is resumable — that is the point of escalating to a human. Only SUCCESS and
 * MANUAL_STOP are finished for good.
 */
export function isResumable(state: FeatureState): boolean {
  const runClass = classifyRun(state);
  return runClass === 'ACTIVE' || runClass === 'PAUSED' || runClass === 'ESCALATED';
}

/**
 * Get recommended action based on state
 */
export function getRecommendedAction(state: FeatureState): string {
  if (state.status === 'COMPLETED') {
    return `Feature complete: ${state.completionStatus}`;
  }

  if (state.escalations.length > 0) {
    const latest = state.escalations[state.escalations.length - 1];
    return `Escalation: ${latest.reason} in ${latest.agent} - ${latest.context.message}`;
  }

  const lastStep = state.stageHistory[state.stageHistory.length - 1];
  if (lastStep && lastStep.status === 'FAIL') {
    return `Last step failed: ${lastStep.agent} - retry or escalate`;
  }

  return `Continue with Stage ${state.currentStage}`;
}

/**
 * State Statistics
 */
export function getStateStats(state: FeatureState): {
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  loopedBackSteps: number;
  escalations: number;
  successRate: number;
} {
  const totalSteps = state.stageHistory.length;
  const passedSteps = state.stageHistory.filter(s => s.status === 'PASS').length;
  const failedSteps = state.stageHistory.filter(s => s.status === 'FAIL').length;
  const loopedBackSteps = state.stageHistory.filter(s => s.status === 'LOOP_BACK').length;

  return {
    totalSteps,
    passedSteps,
    failedSteps,
    loopedBackSteps,
    escalations: state.escalations.length,
    successRate: totalSteps > 0 ? (passedSteps / totalSteps) * 100 : 0
  };
}

// ─── A-2 run lifecycle recorders ─────────────────────────────────────────────────────────────
//
// Pure, like everything above: each takes the state, records one transition, and returns it. The
// orchestrator commits. Each refuses a malformed input with a thrown error rather than storing
// something a later resume would have to guess about (C-2: fail closed).

const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertCheckpointId(value: unknown): asserts value is CheckpointId {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new RangeError(`Checkpoint id must be 1, 2 or 3; got ${String(value)}.`);
  }
}

function assertSha256(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new TypeError(`Expected a lowercase hex SHA-256 (64 characters); got ${JSON.stringify(value)}.`);
  }
}

function assertNonBlank(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${what} must be a non-blank string.`);
  }
}

/** completedAt - startedAt in ms. Both must parse, and the end may not precede the start. */
function durationBetween(startedAt: string, completedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new TypeError(`Step timing must be ISO8601 timestamps; got ${JSON.stringify({ startedAt, completedAt })}.`);
  }
  if (end < start) {
    throw new RangeError(`Step timing ends (${completedAt}) before it starts (${startedAt}).`);
  }
  return end - start;
}

/**
 * Pause at a checkpoint (AC-49): status PAUSED and the pending checkpoint, stamped. The run is
 * committed, NOT finished — no completedAt, no completionStatus.
 */
export function recordPause(state: FeatureState, pending: Omit<PendingCheckpoint, 'pausedAt'>): FeatureState {
  assertCheckpointId(pending.checkpointId);
  assertNonBlank(pending.name, 'A pending checkpoint name');
  assertSha256(pending.sha256);
  if (!Array.isArray(pending.artifactPaths) || pending.artifactPaths.length === 0) {
    throw new TypeError('A pending checkpoint must name the artifacts it presented.');
  }

  const record: PendingCheckpoint = {
    checkpointId: pending.checkpointId,
    name: pending.name,
    stage: pending.stage,
    artifactPaths: [...pending.artifactPaths],
    sha256: pending.sha256,
    pausedAt: new Date().toISOString()
  };
  if (pending.changedFiles) record.changedFiles = [...pending.changedFiles];

  state.pendingCheckpoint = record;
  state.status = 'PAUSED';
  return state;
}

/** Leave the pause once its checkpoint is decided (AC-51): IN_PROGRESS, no pending checkpoint. */
export function clearPause(state: FeatureState): FeatureState {
  if (state.status !== 'PAUSED') {
    throw new Error(`clearPause: run ${state.featureId} is not PAUSED (status ${state.status}).`);
  }
  delete state.pendingCheckpoint;
  state.status = 'IN_PROGRESS';
  return state;
}

/**
 * Record a checkpoint rejection (AC-46, AC-74, D-5). If the run was paused at that checkpoint, the
 * pause is resolved by this decision: the pending checkpoint is removed and the status leaves
 * PAUSED. The caller then records the MANUAL escalation and finishes ESCALATED.
 */
export function recordCheckpointRejection(
  state: FeatureState,
  rejection: Omit<CheckpointRejection, 'rejectedAt'>
): FeatureState {
  assertCheckpointId(rejection.checkpointId);
  assertNonBlank(rejection.name, 'A rejected checkpoint name');
  assertSha256(rejection.sha256);
  if (typeof rejection.notes !== 'string') {
    throw new TypeError('Rejection notes must be a string (empty is allowed from a TTY).');
  }
  if (!Array.isArray(rejection.reworkAgents) || rejection.reworkAgents.length === 0) {
    throw new TypeError('A rejection must name the agents that re-run on resume.');
  }

  state.checkpointRejections = [
    ...(state.checkpointRejections ?? []),
    { ...rejection, rejectedAt: new Date().toISOString() }
  ];

  if (state.pendingCheckpoint?.checkpointId === rejection.checkpointId) {
    delete state.pendingCheckpoint;
    if (state.status === 'PAUSED') state.status = 'IN_PROGRESS';
  }
  return state;
}

/**
 * Record that the rework of rejection cycle `cycle` (1-based index into checkpointRejections)
 * has started (D-5): its documents were superseded into `supersededDir` (relative to the project)
 * and the steps to re-run were invalidated. Refuses an unknown cycle, a blank directory, and a
 * rework that already started — a started rework is resumed, never restarted.
 */
export function recordReworkStart(
  state: FeatureState,
  cycle: number,
  rework: { supersededDir: string; startedAt?: string }
): FeatureState {
  const rejections = state.checkpointRejections ?? [];
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > rejections.length) {
    throw new RangeError(`No checkpoint rejection for rework cycle ${String(cycle)} (${rejections.length} recorded).`);
  }
  assertNonBlank(rework.supersededDir, 'A superseded directory');
  if (rejections[cycle - 1].rework) {
    throw new Error(`The rework of rejection cycle ${cycle} has already started.`);
  }

  state.checkpointRejections = rejections.map((rejection, index) =>
    index === cycle - 1
      ? { ...rejection, rework: { startedAt: rework.startedAt ?? new Date().toISOString(), supersededDir: rework.supersededDir } }
      : rejection
  );
  return state;
}

/** Record `--grant-attempts <n>` for one builder and phase (AC-72). The 1..3 cap is checkResumeRequest's. */
export function recordAttemptGrant(state: FeatureState, grant: Omit<AttemptGrant, 'grantedAt'>): FeatureState {
  if (!Number.isInteger(grant.attempts) || grant.attempts < 1) {
    throw new RangeError(`A grant must add a whole number of attempts, at least 1; got ${String(grant.attempts)}.`);
  }
  state.attemptGrants = [
    ...(state.attemptGrants ?? []),
    { builder: grant.builder, attempts: grant.attempts, at: { ...grant.at }, grantedAt: new Date().toISOString() }
  ];
  return state;
}

/** Record one timed agent invocation and add it to its stage's time (D-13). */
export function recordAgentInvocation(state: FeatureState, record: AgentInvocationRecord): FeatureState {
  if (!Number.isFinite(record.durationMs) || record.durationMs < 0) {
    throw new RangeError(`An invocation duration must be a finite, non-negative number of ms; got ${String(record.durationMs)}.`);
  }
  state.agentInvocations = [...(state.agentInvocations ?? []), { ...record }];
  state.metrics.timePerStage[record.stage] = (state.metrics.timePerStage[record.stage] ?? 0) + record.durationMs;
  return state;
}

/**
 * Save the description of a run recorded without one (pre-A-2), supplied with `--feature` on
 * resume (AC-37, IMPORTANT-1). Refuses a blank description, and never replaces a saved one.
 */
export function recordFeatureDescription(state: FeatureState, description: string): FeatureState {
  assertNonBlank(description, 'A feature description');
  if (state.featureDescription !== undefined) {
    throw new Error(`Run ${state.featureId} already has a feature description; it is never replaced.`);
  }
  state.featureDescription = description;
  return state;
}

/** Record where the CP3 diff starts (D-8). */
export function recordChangeBase(state: FeatureState, base: ChangeBase): FeatureState {
  state.changeBase = { ...base };
  return state;
}

/**
 * Flag the PASS steps of `agents` so a resume re-runs them (I-6, D-5). A step matches by its own
 * agent or by its output's agent, so the pre-supplied path's `tier-1` steps are covered. Steps
 * are kept, and an earlier invalidation is never overwritten.
 */
export function invalidateAgentSteps(state: FeatureState, agents: string[], reason: string): FeatureState {
  assertNonBlank(reason, 'An invalidation reason');
  const at = new Date().toISOString();
  for (const step of state.stageHistory) {
    if (step.status !== 'PASS' || step.invalidated) continue;
    if (agents.includes(step.agent) || (step.output?.agent !== undefined && agents.includes(step.output.agent))) {
      step.invalidated = { at, reason };
    }
  }
  return state;
}

/**
 * Reopen an ACTIVE or ESCALATED run for a resume (AC-35): IN_PROGRESS; completedAt,
 * completionStatus and finalSummary removed; the latest unresolved escalation resolved; the resume
 * appended to resumeHistory. A finished run is refused, and so is a PAUSED one — its checkpoint
 * must be decided (clearPause / recordCheckpointRejection) first.
 */
export function reopenFeature(state: FeatureState, resume: Omit<ResumeRecord, 'resumedAt'>): FeatureState {
  const runClass = classifyRun(state);
  if (runClass !== 'ACTIVE' && runClass !== 'ESCALATED') {
    throw new Error(`reopenFeature: run ${state.featureId} is ${runClass} and cannot be reopened.`);
  }

  const now = new Date().toISOString();
  state.status = 'IN_PROGRESS';
  delete state.completedAt;
  delete state.completionStatus;
  delete state.finalSummary;

  const unresolved = state.escalations.filter(escalation => !escalation.resolvedAt);
  const latest = unresolved[unresolved.length - 1];
  if (latest) {
    latest.resolvedAt = now;
    latest.resolution =
      `Reopened by resume (${resume.action})` +
      (resume.grantedAttempts !== undefined ? ` with ${resume.grantedAttempts} more attempt(s)` : '') +
      '.';
  }

  const record: ResumeRecord = { resumedAt: now, fromClass: resume.fromClass, action: resume.action };
  if (resume.checkpointId !== undefined) record.checkpointId = resume.checkpointId;
  if (resume.grantedAttempts !== undefined) record.grantedAttempts = resume.grantedAttempts;
  state.resumeHistory = [...(state.resumeHistory ?? []), record];
  return state;
}

// ─── PR B-1 Stage 3 snapshot records (D-7) ───────────────────────────────────────────────────

/** A full git object id: SHA-1 (40) or SHA-256 (64) lowercase hex. The one spelling of the rule (MINOR-4). */
export const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function assertObjectId(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw new TypeError(`${what} must be a full object id; got ${JSON.stringify(value)}.`);
  }
}

function assertBuilderPhase(at: unknown): asserts at is BuilderPhase {
  const phase = at as BuilderPhase | undefined;
  const ok =
    phase?.phase === 'stage3' ||
    ((phase?.phase === 'validator-round' || phase?.phase === 'rework') && Number.isInteger(phase.round) && phase.round >= 1);
  if (!ok) throw new TypeError(`A snapshot's phase must be stage3, or a validator round or rework with a round >= 1; got ${JSON.stringify(at)}.`);
}

/**
 * Record one Stage 3 snapshot event (D-7), replacing the entry for the same phase if there is one
 * (I-4): a gate re-evaluated on resume keeps exactly one entry for its phase (AC-85). A malformed
 * record is refused, never stored. Touches no filesystem — the caller commits.
 */
export function recordStage3Snapshot(state: FeatureState, snapshot: Stage3Snapshot): FeatureState {
  assertBuilderPhase(snapshot.at);
  assertNonBlank(snapshot.takenAt, 'A snapshot time');
  let record: Stage3Snapshot;
  if (snapshot.status === 'written') {
    if (!Number.isInteger(snapshot.n) || snapshot.n < 1) throw new RangeError(`A snapshot number must be a positive integer; got ${String(snapshot.n)}.`);
    assertNonBlank(snapshot.ref, 'A snapshot ref');
    assertObjectId(snapshot.commit, 'A snapshot commit');
    assertObjectId(snapshot.tree, 'A snapshot tree');
    record = {
      status: 'written',
      n: snapshot.n,
      ref: snapshot.ref,
      commit: snapshot.commit,
      tree: snapshot.tree,
      at: { ...snapshot.at },
      takenAt: snapshot.takenAt,
      ...(snapshot.reused ? { reused: true as const } : {})
    };
  } else if (snapshot.status === 'skipped') {
    assertNonBlank(snapshot.reason, 'A skipped snapshot reason');
    record = { status: 'skipped', reason: snapshot.reason, at: { ...snapshot.at }, takenAt: snapshot.takenAt };
  } else {
    throw new TypeError(`A snapshot status must be written or skipped; got ${JSON.stringify((snapshot as { status?: unknown }).status)}.`);
  }

  const existing = state.stage3Snapshots ?? [];
  const index = existing.findIndex(entry => samePhase(entry.at, record.at));
  state.stage3Snapshots = index === -1 ? [...existing, record] : existing.map((entry, i) => (i === index ? record : entry));
  return state;
}

/**
 * The `n` the snapshot of phase `at` gets (D-5): the `n` of a written entry for the same phase (a
 * re-evaluated gate pass reuses it, covering a kill before or after the ref write), else one more
 * than the highest written `n`, starting at 1.
 */
export function stage3SnapshotNumber(state: FeatureState, at: BuilderPhase): number {
  const written = (state.stage3Snapshots ?? []).filter((entry): entry is WrittenStage3Snapshot => entry.status === 'written');
  const same = written.find(entry => samePhase(entry.at, at));
  if (same) return same.n;
  return written.reduce((highest, entry) => Math.max(highest, entry.n), 0) + 1;
}

/** The agents that run after a Stage 3 gate passed: Stage 4's verification (IMPORTANT-1, B-2 D-14). */
const VERIFYING_AGENTS: readonly string[] = ['06-test-verifier', '07-validator', '07b-validator-followup', '07c-validator-skeptic'];

/**
 * Whether the run has moved past the Stage 3 snapshot of phase `at` (IMPORTANT-1, resume by
 * recorded completion): a `written` entry for `at` exists, AND a later step is on record — a
 * verifying agent's invocation that started, a Gate 2 evaluation recorded, or (PR B-2, D-14,
 * AC-157) a verification evaluation that started (open, decided or escalated), at or after the
 * snapshot was taken. Then that gate pass is complete, and a resume must not re-evaluate it (the
 * tree now holds later agents' work). Without a later step — a kill after the ref write and before
 * verification starts (AC-85) — it is false, and the gate is evaluated again.
 */
export function stage3SnapshotPassedBy(state: FeatureState, at: BuilderPhase): boolean {
  const entry = (state.stage3Snapshots ?? []).find(
    (snapshot): snapshot is WrittenStage3Snapshot => snapshot.status === 'written' && samePhase(snapshot.at, at)
  );
  if (!entry) return false;
  const taken = Date.parse(entry.takenAt);
  const after = (time: string) => Date.parse(time) >= taken;
  return (
    (state.agentInvocations ?? []).some(invocation => VERIFYING_AGENTS.includes(invocation.agent) && after(invocation.startedAt)) ||
    (state.executionGateHistory ?? []).some(record => after(record.recordedAt)) ||
    (state.validatorEvaluations ?? []).some(evaluation => after(evaluation.startedAt))
  );
}

/** The written snapshot with the highest `n`, or undefined (the B-2 seam, D-17). */
export function latestStage3Snapshot(state: FeatureState): WrittenStage3Snapshot | undefined {
  let latest: WrittenStage3Snapshot | undefined;
  for (const entry of state.stage3Snapshots ?? []) {
    if (entry.status === 'written' && (latest === undefined || entry.n > latest.n)) latest = entry;
  }
  return latest;
}

// ─── PR B-2 verification evaluation recorders (D-7) ──────────────────────────────────────────
//
// Pure, like the rest: each takes the state, records one fact on one evaluation, and returns it;
// the orchestrator commits before the next invocation. Write-once slots are enforced here, by
// throwing (AC-133): a resume that would overwrite a recorded slot is a bug, never a silent
// replacement. A closed evaluation takes no further record.

const SHA256_DIGEST = /^[0-9a-f]{64}$/;
const EVALUATION_KINDS: ReadonlyArray<ValidatorEvaluation['kind']> = ['first-pass', 'validator-round'];

function assertCount(value: unknown, what: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${what} must be a whole number, at least 0; got ${String(value)}.`);
  }
}

function assertStringList(value: unknown, what: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new TypeError(`${what} must be a list of strings; got ${JSON.stringify(value)}.`);
  }
}

function assertTiming(timing: unknown): asserts timing is StepTiming {
  const t = timing as StepTiming | undefined;
  if (typeof t !== 'object' || t === null) throw new TypeError('A recorded step needs its timing.');
  durationBetween(t.startedAt, t.completedAt);
}

/** The evaluation numbered `e`, if it is still open; throws for an unknown or closed one. */
function openRecord(state: FeatureState, e: number): ValidatorEvaluation {
  const evaluation = (state.validatorEvaluations ?? []).find(ev => ev.e === e);
  if (!evaluation) throw new RangeError(`No verification evaluation ${String(e)} is recorded.`);
  if (evaluation.closed) throw new Error(`Verification evaluation ${e} is closed (${evaluation.closed.outcome}); it takes no further record.`);
  return evaluation;
}

function sameSource(a: ReviewSource, b: ReviewSource): boolean {
  if (a.kind === 'snapshot' && b.kind === 'snapshot') return a.n === b.n && a.ref === b.ref && a.commit === b.commit && a.tree === b.tree;
  if (a.kind === 'working-tree' && b.kind === 'working-tree') return a.reason === b.reason;
  return false;
}

function copyOfSource(source: ReviewSource): ReviewSource {
  const s = source as ReviewSource | undefined;
  if (s?.kind === 'snapshot') {
    if (!Number.isInteger(s.n) || s.n < 1) throw new RangeError(`A review copy's snapshot number must be a positive integer; got ${String(s.n)}.`);
    assertNonBlank(s.ref, "A review copy's snapshot ref");
    assertObjectId(s.commit, "A review copy's snapshot commit");
    assertObjectId(s.tree, "A review copy's snapshot tree");
    return { kind: 'snapshot', n: s.n, ref: s.ref, commit: s.commit, tree: s.tree };
  }
  if (s?.kind === 'working-tree') {
    assertNonBlank(s.reason, "A working-tree review copy's reason");
    return { kind: 'working-tree', reason: s.reason };
  }
  throw new TypeError(`A review copy's source must be a snapshot or the working tree; got ${JSON.stringify(source)}.`);
}

function copyOfVerdict(verdict: ValidationVerdict): ValidationVerdict {
  const v = verdict as ValidationVerdict | undefined;
  if (typeof v !== 'object' || v === null || typeof v.passed !== 'boolean') throw new TypeError('A decided evaluation needs a verdict with a boolean `passed`.');
  assertStringList(v.standing, "A verdict's standing issue keys");
  assertStringList(v.disproved, "A verdict's disproved issue keys");
  assertNonBlank(v.recordedAt, "A verdict's time");
  if (v.passed !== (v.standing.length === 0)) {
    throw new Error(`A verdict passes exactly when no issue stands; got passed ${v.passed} with ${v.standing.length} standing.`);
  }
  return { passed: v.passed, standing: [...v.standing], disproved: [...v.disproved], recordedAt: v.recordedAt };
}

/**
 * Open evaluation `e = count + 1` at `(cycle, round)` (D-7), stamped now: the verification-start
 * marker (D-14, AC-157). Commit it before the copy is made and before any agent of the evaluation
 * is invoked. Throws while another evaluation is open: an open one is continued (openEvaluation),
 * never doubled.
 */
export function recordEvaluationStart(
  state: FeatureState,
  at: { cycle: number; round: number; kind: ValidatorEvaluation['kind'] }
): FeatureState {
  assertCount(at?.cycle, 'An evaluation cycle');
  assertCount(at.round, 'An evaluation round');
  if (!EVALUATION_KINDS.includes(at.kind)) throw new TypeError(`An evaluation kind must be first-pass or validator-round; got ${JSON.stringify(at.kind)}.`);
  const evaluations = state.validatorEvaluations ?? [];
  const open = evaluations.find(ev => !ev.closed);
  if (open) throw new Error(`Verification evaluation ${open.e} is still open; continue it or close it before starting another.`);
  state.validatorEvaluations = [
    ...evaluations,
    { e: evaluations.length + 1, cycle: at.cycle, round: at.round, kind: at.kind, startedAt: new Date().toISOString() }
  ];
  return state;
}

/** The open evaluation of `(cycle, round)`, which a resume continues (AC-123); else undefined. */
export function openEvaluation(state: FeatureState, cycle: number, round: number): ValidatorEvaluation | undefined {
  return (state.validatorEvaluations ?? []).find(ev => !ev.closed && ev.cycle === cycle && ev.round === round);
}

/**
 * Record evaluation `e`'s review copy (D-3, D-B2-2). A recorded copy may be replaced (a
 * re-extraction into a new directory after copyIntact failed) only with the SAME source.
 */
export function recordReviewCopy(state: FeatureState, e: number, copy: ReviewCopyRecord): FeatureState {
  const evaluation = openRecord(state, e);
  if (typeof copy?.dir !== 'string' || !isAbsolute(copy.dir)) throw new TypeError(`A review copy directory must be an absolute path; got ${JSON.stringify(copy?.dir)}.`);
  const source = copyOfSource(copy.source);
  assertCount(copy.entries, "A review copy's leaf count");
  if (typeof copy.digest !== 'string' || !SHA256_DIGEST.test(copy.digest)) {
    throw new TypeError(`A review copy's leaf digest must be 64 lowercase hex; got ${JSON.stringify(copy.digest)}.`);
  }
  assertNonBlank(copy.madeAt, "A review copy's time");
  if (evaluation.copy && !sameSource(evaluation.copy.source, source)) {
    throw new Error(`Evaluation ${e}'s review copy can only be re-made from its recorded source, never from another one.`);
  }
  // MINOR-2: a replaced copy's directory is kept, so paths the Validator reported from it still map.
  if (evaluation.copy && evaluation.copy.dir !== copy.dir) {
    evaluation.previousCopyDirs = [...(evaluation.previousCopyDirs ?? []), evaluation.copy.dir];
  }
  evaluation.copy = { dir: copy.dir, source, entries: copy.entries, digest: copy.digest, madeAt: copy.madeAt };
  return state;
}

/** Every directory evaluation `evaluation`'s review copy has had: the current one, then those it replaced (MINOR-2). */
export function reviewCopyDirs(evaluation: ValidatorEvaluation): string[] {
  return evaluation.copy ? [evaluation.copy.dir, ...(evaluation.previousCopyDirs ?? [])] : [...(evaluation.previousCopyDirs ?? [])];
}

/**
 * Record what evaluation `e` measures the Test Verifier's changes against (IMPORTANT-1), before the
 * Test Verifier is invoked in it. First-pass evaluations only. Write-once: a resume that invokes
 * the Test Verifier again in the same evaluation keeps the first baseline, so both runs' writes are
 * measured.
 */
export function recordMeasurementBaseline(state: FeatureState, e: number, baseline: MeasurementBaseline): FeatureState {
  const evaluation = openRecord(state, e);
  if (evaluation.kind !== 'first-pass') throw new Error(`Evaluation ${e} is a ${evaluation.kind}; only a first pass measures the Test Verifier.`);
  if (evaluation.baseline) throw new Error(`Evaluation ${e} already has its measurement baseline; it is never overwritten.`);
  const b = baseline as MeasurementBaseline | undefined;
  if (b?.kind === 'tree') {
    assertObjectId(b.tree, 'A measurement baseline tree');
    assertNonBlank(b.recordedAt, "A measurement baseline's time");
    evaluation.baseline = { kind: 'tree', tree: b.tree, recordedAt: b.recordedAt };
  } else if (b?.kind === 'copy') {
    if (typeof b.dir !== 'string' || !isAbsolute(b.dir)) throw new TypeError(`A measurement baseline copy must be an absolute path; got ${JSON.stringify(b.dir)}.`);
    assertCount(b.entries, "A measurement baseline copy's leaf count");
    if (typeof b.digest !== 'string' || !SHA256_DIGEST.test(b.digest)) {
      throw new TypeError(`A measurement baseline copy's leaf digest must be 64 lowercase hex; got ${JSON.stringify(b.digest)}.`);
    }
    assertNonBlank(b.recordedAt, "A measurement baseline's time");
    evaluation.baseline = { kind: 'copy', dir: b.dir, entries: b.entries, digest: b.digest, recordedAt: b.recordedAt };
  } else {
    throw new TypeError(`A measurement baseline must be a tree or a copy; got ${JSON.stringify(baseline)}.`);
  }
  return state;
}

/** Record evaluation `e`'s main Validator output and its timing (D-7, I-7). Write-once. */
export function recordEvaluationValidator(state: FeatureState, e: number, output: ValidatorOutput, timing: StepTiming): FeatureState {
  const evaluation = openRecord(state, e);
  if (evaluation.validator) throw new Error(`Evaluation ${e} already has the main Validator's output; it is never overwritten.`);
  if (output?.agent !== '07-validator') throw new TypeError(`The main Validator's output must come from 07-validator; got ${JSON.stringify(output?.agent)}.`);
  assertTiming(timing);
  evaluation.validator = { output, timing: { startedAt: timing.startedAt, completedAt: timing.completedAt } };
  return state;
}

/** Record what the Test Verifier changed (D-2). Replaceable: a resume measures again, and the latest counts. */
export function recordTestVerifierChanges(state: FeatureState, e: number, changes: TestVerifierChanges): FeatureState {
  const evaluation = openRecord(state, e);
  let record: TestVerifierChanges;
  if (changes?.kind === 'none') {
    record = { kind: 'none' };
  } else if (changes?.kind === 'tests') {
    assertStringList(changes.files, "The Test Verifier's changed files");
    record = { kind: 'tests', files: [...changes.files] };
  } else if (changes?.kind === 'outside-tests') {
    assertStringList(changes.files, "The Test Verifier's changed files");
    assertStringList(changes.outside, "The Test Verifier's files outside a test path");
    record = { kind: 'outside-tests', files: [...changes.files], outside: [...changes.outside] };
  } else {
    throw new TypeError(`A Test Verifier measurement must be none, tests or outside-tests; got ${JSON.stringify(changes)}.`);
  }
  evaluation.testVerifierChanges = record;
  return state;
}

/** Record evaluation `e`'s follow-up (D-9): skipped with a reason, or reviewed. Write-once. */
export function recordFollowup(state: FeatureState, e: number, followup: NonNullable<ValidatorEvaluation['followup']>): FeatureState {
  const evaluation = openRecord(state, e);
  if (evaluation.followup) throw new Error(`Evaluation ${e} already has its follow-up recorded; it is never overwritten.`);
  if (followup?.status === 'skipped') {
    assertNonBlank(followup.reason, 'A skipped follow-up reason');
    evaluation.followup = { status: 'skipped', reason: followup.reason };
  } else if (followup?.status === 'reviewed') {
    assertStringList(followup.files, "The follow-up's files");
    if (followup.output?.agent !== '07b-validator-followup') throw new TypeError(`A follow-up output must come from 07b-validator-followup; got ${JSON.stringify(followup.output?.agent)}.`);
    assertTiming(followup.timing);
    evaluation.followup = {
      status: 'reviewed',
      files: [...followup.files],
      output: followup.output,
      timing: { startedAt: followup.timing.startedAt, completedAt: followup.timing.completedAt }
    };
  } else {
    throw new TypeError(`A follow-up must be skipped or reviewed; got ${JSON.stringify((followup as { status?: unknown })?.status)}.`);
  }
  return state;
}

/** Record one skeptic verdict on evaluation `e` (D-11, AC-133): one per (issueKey, instance), stamped now. */
export function recordSkepticVerdict(state: FeatureState, e: number, verdict: Omit<SkepticVerdictRecord, 'recordedAt'>): FeatureState {
  const evaluation = openRecord(state, e);
  assertNonBlank(verdict?.issueKey, 'A skeptic verdict issue key');
  if (!ISSUE_ORIGINS.includes(verdict.origin)) throw new TypeError(`A skeptic verdict's origin must be 07-validator or 07b-validator-followup; got ${JSON.stringify(verdict.origin)}.`);
  if (!SKEPTIC_INSTANCES.includes(verdict.instance)) throw new TypeError(`A skeptic instance must be A or B; got ${JSON.stringify(verdict.instance)}.`);
  if (verdict.verdict !== 'DISPROVED' && verdict.verdict !== 'UPHELD') throw new TypeError(`A skeptic verdict must be DISPROVED or UPHELD; got ${JSON.stringify(verdict.verdict)}.`);
  assertNonBlank(verdict.reason, 'A skeptic verdict reason');
  assertNonBlank(verdict.document, 'A skeptic verdict document');
  const skeptics = evaluation.skeptics ?? [];
  if (skeptics.some(s => s.issueKey === verdict.issueKey && s.instance === verdict.instance)) {
    throw new Error(`Evaluation ${e} already has skeptic ${verdict.instance}'s verdict on issue ${verdict.issueKey}; it is never overwritten.`);
  }
  evaluation.skeptics = [
    ...skeptics,
    {
      issueKey: verdict.issueKey,
      origin: verdict.origin,
      instance: verdict.instance,
      verdict: verdict.verdict,
      reason: verdict.reason,
      document: verdict.document,
      recordedAt: new Date().toISOString()
    }
  ];
  return state;
}

/** Close evaluation `e` (D-7): decided with its verdict, or escalated. Write-once. */
export function closeEvaluation(state: FeatureState, e: number, closed: NonNullable<ValidatorEvaluation['closed']>): FeatureState {
  const evaluation = (state.validatorEvaluations ?? []).find(ev => ev.e === e);
  if (!evaluation) throw new RangeError(`No verification evaluation ${String(e)} is recorded.`);
  if (evaluation.closed) throw new Error(`Evaluation ${e} is already closed (${evaluation.closed.outcome}); it is never closed again.`);
  if (closed?.outcome === 'decided') {
    evaluation.closed = { outcome: 'decided', verdict: copyOfVerdict(closed.verdict) };
  } else if (closed?.outcome === 'escalated') {
    assertNonBlank(closed.at, 'An escalated evaluation time');
    evaluation.closed = { outcome: 'escalated', at: closed.at };
  } else {
    throw new TypeError(`An evaluation closes decided or escalated; got ${JSON.stringify((closed as { outcome?: unknown })?.outcome)}.`);
  }
  return state;
}

/**
 * Close every open evaluation as escalated at `at` (D-7, I-6). `finish(ESCALATED)` calls it, so a
 * resume after an escalation starts a new evaluation; a kill never reaches it and leaves one open.
 */
export function closeOpenEvaluations(state: FeatureState, at: string): FeatureState {
  assertNonBlank(at, 'An escalated evaluation time');
  for (const evaluation of state.validatorEvaluations ?? []) {
    if (!evaluation.closed) evaluation.closed = { outcome: 'escalated', at };
  }
  return state;
}

/** The verdict of rework cycle `cycle`'s latest decided evaluation (D-12), or undefined. */
export function currentValidationVerdict(state: FeatureState, cycle: number): ValidationVerdict | undefined {
  let verdict: ValidationVerdict | undefined;
  for (const evaluation of state.validatorEvaluations ?? []) {
    if (evaluation.cycle === cycle && evaluation.closed?.outcome === 'decided') verdict = evaluation.closed.verdict;
  }
  return verdict;
}
