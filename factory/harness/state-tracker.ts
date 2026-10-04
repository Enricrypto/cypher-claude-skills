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

/**
 * Where a builder step or loop-back happened (D-9). `stage3` is the original build;
 * `validator-round` is a re-invocation for Validator CRITICAL issues, numbered from 1. Builder
 * records keep stage 3 either way — the phase is what tells them apart.
 */
export type StepPhase = { phase?: 'stage3' | 'validator-round'; round?: number };

export type BuilderAgent = '04-backend-builder' | '05-frontend-builder';

/**
 * How many times a builder has been invoked, per phase (AC-70). Stage 3 attempts and each
 * validator round's attempts are separate budgets of MAX_BUILDER_ATTEMPTS: a builder that needed
 * three tries to build still gets three tries to fix a Validator issue.
 */
export interface BuilderAttemptCounts {
  stage3: number;
  /** Keyed by validator round (1-based). */
  validatorRounds: Record<number, number>;
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
  /** Builder steps only: which phase (and validator round) this attempt belonged to. */
  phase?: 'stage3' | 'validator-round';
  round?: number;
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
  /** Builder loop-backs only: which phase (and validator round) the failed attempt belonged to. */
  phase?: 'stage3' | 'validator-round';
  round?: number;
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
    | 'EXECUTION_FAILURE';
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
  status: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'ESCALATED';

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
export function createFeatureState(featureName: string, createdBy?: string): FeatureState {
  return {
    featureId: generateUUID(),
    featureName,
    createdAt: new Date().toISOString(),
    createdBy,
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
  phase?: StepPhase
): FeatureState {
  const now = new Date();

  const step: AgentStepRecord = {
    stage,
    agent,
    status,
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    loopCount: countLoopsForAgent(state, agent),
    output,
    ...phaseFields(phase)
  };

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
  phase?: StepPhase
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
    severity: ['MAX_LOOPS', 'CRITICAL_ISSUE', 'TIMEOUT'].includes(reason) ? 'CRITICAL' : 'IMPORTANT',
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
  notes?: string
): FeatureState {
  const approval: CheckpointApproval = {
    stage,
    checkpointName,
    approvedAt: new Date().toISOString(),
    approvedBy,
    notes
  };

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
  at: { phase: 'stage3' } | { phase: 'validator-round'; round: number }
): FeatureState {
  const current = state.builderAttempts?.[agent] ?? { stage3: 0, validatorRounds: {} };
  const next: BuilderAttemptCounts =
    at.phase === 'stage3'
      ? { stage3: current.stage3 + 1, validatorRounds: { ...current.validatorRounds } }
      : {
          stage3: current.stage3,
          validatorRounds: { ...current.validatorRounds, [at.round]: (current.validatorRounds[at.round] ?? 0) + 1 }
        };
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
 * Complete feature execution
 */
export function completeFeature(
  state: FeatureState,
  status: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP',
  summary?: string
): FeatureState {
  state.completedAt = new Date().toISOString();
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
 * Check if state is resumable
 */
export function isResumable(state: FeatureState): boolean {
  return state.status === 'IN_PROGRESS' || (state.status === 'ESCALATED' && !state.completedAt);
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
