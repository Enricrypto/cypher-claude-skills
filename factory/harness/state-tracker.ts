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

import { FeatureFactoryAgentOutput } from './agent-output-schema';
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
    | 'SNAPSHOT_FAILED';
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
    severity: ['MAX_LOOPS', 'CRITICAL_ISSUE', 'TIMEOUT', 'HEAD_MOVED', 'SNAPSHOT_FAILED'].includes(reason) ? 'CRITICAL' : 'IMPORTANT',
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

/** The agents that run after a Stage 3 gate passed: Stage 4's verification (IMPORTANT-1). */
const VERIFYING_AGENTS: readonly string[] = ['06-test-verifier', '07-validator'];

/**
 * Whether the run has moved past the Stage 3 snapshot of phase `at` (IMPORTANT-1, resume by
 * recorded completion): a `written` entry for `at` exists, AND a later step is on record — a Test
 * Verifier or Validator invocation that started, or a Gate 2 evaluation recorded, at or after the
 * snapshot was taken. Then that gate pass is complete, and a resume must not re-evaluate it (the
 * tree now holds later agents' work). Without a later step — a kill after the ref write and before
 * the next agent (AC-85) — it is false, and the gate is evaluated again.
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
    (state.executionGateHistory ?? []).some(record => after(record.recordedAt))
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
