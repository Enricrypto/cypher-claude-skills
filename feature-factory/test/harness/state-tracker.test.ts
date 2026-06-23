/**
 * State Tracker Tests
 *
 * Tests for: state-tracker.ts
 * - Feature state creation
 * - Recording steps, loop-backs, escalations
 * - State serialization/deserialization
 * - Resumption capability
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createFeatureState,
  recordAgentStep,
  recordLoopBack,
  recordEscalation,
  recordCheckpointApproval,
  completeFeature,
  serializeState,
  deserializeState,
  isResumable,
  getStateStats
} from '../../harness/state-tracker';

describe('State Tracker', () => {
  describe('createFeatureState', () => {
    it('should create initial feature state', () => {
      const state = createFeatureState('Add 2FA');

      expect(state.featureName).toBe('Add 2FA');
      expect(state.featureId).toBeTruthy();
      expect(state.currentStage).toBe(1);
      expect(state.status).toBe('IN_PROGRESS');
      expect(state.stageHistory).toEqual([]);
      expect(state.metrics.loopCount).toBe(0);
    });

    it('should generate unique feature IDs', () => {
      const state1 = createFeatureState('Feature 1');
      const state2 = createFeatureState('Feature 2');

      expect(state1.featureId).not.toBe(state2.featureId);
    });

    it('should set createdAt timestamp', () => {
      const before = new Date();
      const state = createFeatureState('Test');
      const after = new Date();

      const createdTime = new Date(state.createdAt);
      expect(createdTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(createdTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('recordAgentStep', () => {
    let state = createFeatureState('Test');

    beforeEach(() => {
      state = createFeatureState('Test');
    });

    it('should record successful step', () => {
      const output = {
        stage: 1,
        agent: '01-researcher',
        timestamp: new Date().toISOString(),
        status: 'PASS',
        details: { summary: 'Test', artifacts: [] }
      };

      state = recordAgentStep(state, 1, '01-researcher', 'PASS', output);

      expect(state.stageHistory.length).toBe(1);
      expect(state.stageHistory[0].agent).toBe('01-researcher');
      expect(state.stageHistory[0].status).toBe('PASS');
      expect(state.stageHistory[0].output).toEqual(output);
    });

    it('should record multiple steps in sequence', () => {
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
      state = recordAgentStep(state, 2, '02-story-writer', 'PASS');

      expect(state.stageHistory.length).toBe(2);
      expect(state.stageHistory[0].agent).toBe('01-researcher');
      expect(state.stageHistory[1].agent).toBe('02-story-writer');
    });

    it('should record errors with steps', () => {
      const error = new Error('Test error');
      state = recordAgentStep(state, 1, '01-researcher', 'FAIL', undefined, error);

      expect(state.stageHistory[0].error).toBeTruthy();
      expect(state.stageHistory[0].error.message).toBe('Test error');
    });
  });

  describe('recordLoopBack', () => {
    let state = createFeatureState('Test');

    beforeEach(() => {
      state = createFeatureState('Test');
    });

    it('should record loop-back attempt', () => {
      state = recordLoopBack(state, 3, '04-backend-builder', 'Import error', 'FAIL', 'FIX_IMPORT');

      expect(state.loopBacks.length).toBe(1);
      expect(state.loopBacks[0].agent).toBe('04-backend-builder');
      expect(state.loopBacks[0].reason).toBe('Import error');
      expect(state.loopBacks[0].fixApplied).toBe('FIX_IMPORT');
      expect(state.metrics.loopCount).toBe(1);
    });

    it('should track multiple loop-back attempts', () => {
      state = recordLoopBack(state, 3, '04-backend-builder', 'Error 1', 'FAIL', 'FIX_1');
      state = recordLoopBack(state, 3, '04-backend-builder', 'Error 2', 'FAIL', 'FIX_2');
      state = recordLoopBack(state, 3, '04-backend-builder', 'Error 3', 'PASS', 'FIX_3');

      expect(state.loopBacks.length).toBe(3);
      expect(state.metrics.loopCount).toBe(3);
      expect(state.loopBacks[0].attempt).toBe(1);
      expect(state.loopBacks[2].attempt).toBe(3);
    });

    it('should record different fix classes', () => {
      state = recordLoopBack(state, 3, '04-backend-builder', 'Type error', 'FAIL', 'FIX_TYPES');
      state = recordLoopBack(state, 3, '05-frontend-builder', 'Selector error', 'FAIL', 'UPDATE_LOCATOR');

      expect(state.loopBacks[0].fixApplied).toBe('FIX_TYPES');
      expect(state.loopBacks[1].fixApplied).toBe('UPDATE_LOCATOR');
    });
  });

  describe('recordEscalation', () => {
    let state = createFeatureState('Test');

    beforeEach(() => {
      state = createFeatureState('Test');
    });

    it('should record escalation', () => {
      state = recordEscalation(state, 3, '04-backend-builder', 'MAX_LOOPS', 'Exceeded 3 loops', {
        loopCount: 3
      });

      expect(state.escalations.length).toBe(1);
      expect(state.escalations[0].reason).toBe('MAX_LOOPS');
      expect(state.escalations[0].severity).toBe('CRITICAL');
      expect(state.status).toBe('ESCALATED');
      expect(state.metrics.escalationCount).toBe(1);
    });

    it('should set CRITICAL severity for critical reasons', () => {
      state = recordEscalation(state, 3, 'agent', 'MAX_LOOPS', 'Test');
      expect(state.escalations[0].severity).toBe('CRITICAL');

      state = recordEscalation(state, 3, 'agent', 'CRITICAL_ISSUE', 'Test');
      expect(state.escalations[1].severity).toBe('CRITICAL');
    });

    it('should preserve escalation context', () => {
      state = recordEscalation(state, 4, '07-validator', 'CRITICAL_ISSUE', 'Validation failed', {
        issues: ['Issue 1', 'Issue 2']
      });

      expect(state.escalations[0].context.issues).toEqual(['Issue 1', 'Issue 2']);
    });
  });

  describe('recordCheckpointApproval', () => {
    let state = createFeatureState('Test');

    beforeEach(() => {
      state = createFeatureState('Test');
    });

    it('should record checkpoint approval', () => {
      state = recordCheckpointApproval(state, 2, 'Story Approval', 'user@company.com', 'Looks good');

      expect(state.checkpointApprovals.length).toBe(1);
      expect(state.checkpointApprovals[0].checkpointName).toBe('Story Approval');
      expect(state.checkpointApprovals[0].approvedBy).toBe('user@company.com');
      expect(state.checkpointApprovals[0].notes).toBe('Looks good');
    });

    it('should track multiple approvals', () => {
      state = recordCheckpointApproval(state, 2, 'Story', 'user1', 'Ok');
      state = recordCheckpointApproval(state, 2, 'Brief', 'user2', 'Ok');

      expect(state.checkpointApprovals.length).toBe(2);
    });
  });

  describe('completeFeature', () => {
    let state = createFeatureState('Test');

    beforeEach(() => {
      state = createFeatureState('Test');
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
    });

    it('should mark feature as complete', () => {
      state = completeFeature(state, 'SUCCESS', 'Feature shipped');

      expect(state.status).toBe('COMPLETED');
      expect(state.completionStatus).toBe('SUCCESS');
      expect(state.finalSummary).toBe('Feature shipped');
      expect(state.completedAt).toBeTruthy();
    });

    it('should calculate total time', () => {
      state = completeFeature(state, 'SUCCESS');

      expect(state.metrics.totalTime).toBeGreaterThan(0);
    });

    it('should accept different completion statuses', () => {
      let s1 = completeFeature(createFeatureState('T1'), 'SUCCESS');
      let s2 = completeFeature(createFeatureState('T2'), 'ESCALATED');
      let s3 = completeFeature(createFeatureState('T3'), 'MANUAL_STOP');

      expect(s1.completionStatus).toBe('SUCCESS');
      expect(s2.completionStatus).toBe('ESCALATED');
      expect(s3.completionStatus).toBe('MANUAL_STOP');
    });
  });

  describe('Serialization', () => {
    it('should serialize state to JSON', () => {
      let state = createFeatureState('Test Feature');
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');

      const json = serializeState(state);

      expect(typeof json).toBe('string');
      expect(json).toContain('Test Feature');
      expect(json).toContain('01-researcher');
    });

    it('should deserialize JSON back to state', () => {
      let original = createFeatureState('Test Feature');
      original = recordAgentStep(original, 1, '01-researcher', 'PASS');

      const json = serializeState(original);
      const deserialized = deserializeState(json);

      expect(deserialized.featureName).toBe(original.featureName);
      expect(deserialized.featureId).toBe(original.featureId);
      expect(deserialized.stageHistory.length).toBe(original.stageHistory.length);
    });

    it('should preserve loop-backs through serialization', () => {
      let state = createFeatureState('Test');
      state = recordLoopBack(state, 3, '04-backend-builder', 'Error', 'FAIL', 'FIX_IMPORT');

      const json = serializeState(state);
      const restored = deserializeState(json);

      expect(restored.loopBacks.length).toBe(1);
      expect(restored.loopBacks[0].fixApplied).toBe('FIX_IMPORT');
    });
  });

  describe('isResumable', () => {
    it('should be resumable when IN_PROGRESS', () => {
      const state = createFeatureState('Test');
      expect(isResumable(state)).toBe(true);
    });

    it('should be resumable when ESCALATED without completedAt', () => {
      let state = createFeatureState('Test');
      state.status = 'ESCALATED';
      expect(isResumable(state)).toBe(true);
    });

    it('should not be resumable when COMPLETED', () => {
      let state = createFeatureState('Test');
      state = completeFeature(state, 'SUCCESS');
      expect(isResumable(state)).toBe(false);
    });
  });

  describe('getStateStats', () => {
    it('should calculate stats from state', () => {
      let state = createFeatureState('Test');
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
      state = recordLoopBack(state, 3, '04-backend', 'Error', 'FAIL', 'FIX');
      state = recordEscalation(state, 3, '04-backend', 'CRITICAL_ISSUE', 'Failed');

      const stats = getStateStats(state);

      expect(stats.totalSteps).toBe(1);
      expect(stats.passedSteps).toBe(1);
      expect(stats.escalations).toBe(1);
      expect(stats.successRate).toBe(100);
    });

    it('should handle failed steps', () => {
      let state = createFeatureState('Test');
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
      state = recordAgentStep(state, 2, '02-story', 'FAIL');

      const stats = getStateStats(state);

      expect(stats.totalSteps).toBe(2);
      expect(stats.passedSteps).toBe(1);
      expect(stats.failedSteps).toBe(1);
      expect(stats.successRate).toBeCloseTo(50, 0);
    });
  });
});
