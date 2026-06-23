/**
 * Feature Factory State Tracker
 *
 * Tracks execution state across stages to enable:
 * - Resuming after interruptions
 * - Auditing execution history
 * - Learning from past feature runs
 *
 * State persisted to JSON file in feature-factory/artifacts/feature-states/
 */

import { FeatureFactoryAgentOutput } from './agent-output-schema';

export interface AgentStepRecord {
  stage: number;
  agent: string;
  status: 'PASS' | 'FAIL' | 'LOOP_BACK' | 'ESCALATED';
  startedAt: string; // ISO8601
  completedAt?: string; // ISO8601
  loopCount: number;
  output?: FeatureFactoryAgentOutput;
  error?: {
    message: string;
    context?: any;
  };
}

export interface StageLoopBack {
  stage: number;
  agent: string;
  reason: string;
  attempt: number;
  fixApplied?: string;
  result: 'PASS' | 'FAIL';
  timestamp: string;
}

export interface EscalationRecord {
  stage: number;
  agent: string;
  reason: 'MAX_LOOPS' | 'CRITICAL_ISSUE' | 'TIMEOUT' | 'SCHEMA_VALIDATION' | 'MANUAL';
  severity: 'CRITICAL' | 'IMPORTANT';
  context: {
    failingTests?: string[];
    issues?: string[];
    loopCount?: number;
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
  error?: any
): FeatureState {
  const now = new Date();

  const step: AgentStepRecord = {
    stage,
    agent,
    status,
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    loopCount: countLoopsForAgent(state, agent),
    output
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
  result: 'PASS' | 'FAIL',
  fixApplied?: string
): FeatureState {
  const loopBack: StageLoopBack = {
    stage,
    agent,
    reason,
    attempt: countLoopsForAgent(state, agent) + 1,
    fixApplied,
    result,
    timestamp: new Date().toISOString()
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
