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
  getStateStats,
  recordExecutionGate,
  recordBuilderAttempt,
  recordValidatorRound,
  recordPause,
  clearPause,
  recordCheckpointRejection,
  recordAttemptGrant,
  recordAgentInvocation,
  recordChangeBase,
  recordFeatureDescription,
  invalidateAgentSteps,
  reopenFeature,
  recordReworkStart,
  FeatureState
} from '../../harness/state-tracker';
import { FeatureFactoryAgentOutput } from '../../harness/agent-output-schema';

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
      const output: FeatureFactoryAgentOutput = {
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
      expect(state.stageHistory[0].error?.message).toBe('Test error');
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

      // A synthetic run can start and complete inside the same millisecond, so 0 is valid.
      expect(state.metrics.totalTime).toBeGreaterThanOrEqual(0);
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

  describe('recordExecutionGate (D-12)', () => {
    const measurement = { round: 0, total: 10, passed: 10, failed: 0, passRate: 1, canAdvance: true, referenceCount: 8 };

    it('createFeatureState starts with an empty Gate 2 history', () => {
      expect(createFeatureState('Test').executionGateHistory).toEqual([]);
    });

    it('appends the measurement with a recordedAt timestamp, in order', () => {
      let state = createFeatureState('Test');
      state = recordExecutionGate(state, measurement);
      state = recordExecutionGate(state, { ...measurement, round: 1, total: 11, passed: 11, referenceCount: 10 });

      expect(state.executionGateHistory).toHaveLength(2);
      expect(state.executionGateHistory?.[0]).toMatchObject(measurement);
      expect(Number.isNaN(Date.parse(state.executionGateHistory?.[0].recordedAt ?? ''))).toBe(false);
      expect(state.executionGateHistory?.[1]).toMatchObject({ round: 1, total: 11, referenceCount: 10 });
    });

    it('tolerates a state file written before the history existed', () => {
      const old = createFeatureState('Test') as FeatureState;
      delete old.executionGateHistory;

      const state = recordExecutionGate(old, measurement);

      expect(state.executionGateHistory).toHaveLength(1);
    });

    it('keeps a missing reference missing, rather than inventing one', () => {
      const { referenceCount: _omitted, ...noReference } = measurement;

      const state = recordExecutionGate(createFeatureState('Test'), noReference);

      expect(state.executionGateHistory?.[0].referenceCount).toBeUndefined();
    });
  });

  describe('builder attempts and validator rounds (D-9, AC-70)', () => {
    it('createFeatureState starts with no builder attempts and no validator rounds', () => {
      const state = createFeatureState('Test');
      expect(state.builderAttempts).toEqual({});
      expect(state.validatorRoundsCompleted).toBe(0);
    });

    it('counts Stage 3 attempts and validator-round attempts separately, per builder', () => {
      let state = createFeatureState('Test');
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'validator-round', round: 1 });
      state = recordBuilderAttempt(state, '05-frontend-builder', { phase: 'validator-round', round: 2 });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'validator-round', round: 1 });

      expect(state.builderAttempts).toEqual({
        '04-backend-builder': { stage3: 2, validatorRounds: { 1: 2 } },
        '05-frontend-builder': { stage3: 0, validatorRounds: { 2: 1 } }
      });
    });

    it('tolerates a state file written before the counters existed', () => {
      const old = createFeatureState('Test') as FeatureState;
      delete old.builderAttempts;
      delete old.validatorRoundsCompleted;

      let state = recordBuilderAttempt(old, '04-backend-builder', { phase: 'stage3' });
      state = recordValidatorRound(state, 1);

      expect(state.builderAttempts?.['04-backend-builder']).toEqual({ stage3: 1, validatorRounds: {} });
      expect(state.validatorRoundsCompleted).toBe(1);
    });

    it('recordValidatorRound records the round number and never goes backwards', () => {
      let state = createFeatureState('Test');
      state = recordValidatorRound(state, 2);
      state = recordValidatorRound(state, 1);
      expect(state.validatorRoundsCompleted).toBe(2);
    });

    it('a step and a loop-back carry their phase and round when given, and nothing when not', () => {
      let state = createFeatureState('Test');
      state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', undefined, undefined, { phase: 'validator-round', round: 1 });
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
      state = recordLoopBack(state, 3, '04-backend-builder', 'boom', 'FAIL', undefined, { phase: 'validator-round', round: 2 });
      state = recordLoopBack(state, 3, '04-backend-builder', 'boom', 'FAIL');

      expect([state.stageHistory[0].phase, state.stageHistory[0].round]).toEqual(['validator-round', 1]);
      expect('phase' in state.stageHistory[1]).toBe(false);
      expect('round' in state.stageHistory[1]).toBe(false);
      expect([state.loopBacks[0].phase, state.loopBacks[0].round]).toEqual(['validator-round', 2]);
      expect('phase' in state.loopBacks[1]).toBe(false);
    });
  });

  describe('A-2 state model (step 1)', () => {
    const HASH = 'b'.repeat(64);
    const pending = {
      checkpointId: 2 as const,
      name: 'CHECKPOINT 2: Approve the technical brief',
      stage: 2,
      artifactPaths: ['.factory/x/TECHNICAL_BRIEF.md', '.factory/x/FILE_LIST.md'],
      sha256: HASH
    };

    function escalatedRun(): FeatureState {
      let state = createFeatureState('esc');
      state = recordAgentStep(state, 1, '01-researcher', 'PASS');
      state = recordEscalation(state, 4, '06-test-verifier', 'CRITICAL_ISSUE', 'boom');
      return completeFeature(state, 'ESCALATED', 'boom');
    }

    describe('D-1 isResumable', () => {
      it('D-1 a completed ESCALATED run is resumable', () => {
        expect(isResumable(escalatedRun())).toBe(true);
      });

      it('D-1 a PAUSED run is resumable', () => {
        expect(isResumable(recordPause(createFeatureState('p'), pending))).toBe(true);
      });

      it('D-1 a MANUAL_STOP run is not resumable', () => {
        expect(isResumable(completeFeature(createFeatureState('m'), 'MANUAL_STOP'))).toBe(false);
      });
    });

    describe('AC-37 createFeatureState', () => {
      it('AC-37 stores the feature description when given', () => {
        expect(createFeatureState('n', undefined, 'Add 2FA to login').featureDescription).toBe('Add 2FA to login');
      });

      it('AC-37 leaves the description absent when not given, rather than inventing one', () => {
        expect('featureDescription' in createFeatureState('n')).toBe(false);
      });

      it('IMPORTANT-1 recordFeatureDescription saves the description of a run recorded without one', () => {
        expect(recordFeatureDescription(createFeatureState('n'), 'Add 2FA to login').featureDescription).toBe('Add 2FA to login');
      });

      it('IMPORTANT-1 recordFeatureDescription refuses a blank description', () => {
        expect(() => recordFeatureDescription(createFeatureState('n'), '  ')).toThrow();
      });

      it('IMPORTANT-1 recordFeatureDescription never replaces a saved description', () => {
        const state = createFeatureState('n', undefined, 'Add 2FA to login');
        expect(() => recordFeatureDescription(state, 'Add SMS login')).toThrow();
        expect(state.featureDescription).toBe('Add 2FA to login');
      });

      it('D-1 starts every new list empty', () => {
        const state = createFeatureState('n');
        expect(state.checkpointRejections).toEqual([]);
        expect(state.attemptGrants).toEqual([]);
        expect(state.agentInvocations).toEqual([]);
        expect(state.resumeHistory).toEqual([]);
        expect(state.pendingCheckpoint).toBeUndefined();
      });
    });

    describe('AC-49 recordPause / clearPause', () => {
      it('AC-49 recordPause sets PAUSED and a pendingCheckpoint with name, stage, artifact paths, hash and pausedAt, without finishing', () => {
        const state = recordPause(createFeatureState('p'), { ...pending, changedFiles: ['src/a.ts'] });

        expect(state.status).toBe('PAUSED');
        expect(state.pendingCheckpoint).toMatchObject({ ...pending, changedFiles: ['src/a.ts'] });
        expect(Number.isNaN(Date.parse(state.pendingCheckpoint?.pausedAt ?? ''))).toBe(false);
        expect(state.completedAt).toBeUndefined();
        expect(state.completionStatus).toBeUndefined();
      });

      it.each([
        ['a checkpoint id outside 1..3', { ...pending, checkpointId: 4 }],
        ['a missing hash', { ...pending, sha256: '' }],
        ['a hash that is not lowercase SHA-256 hex', { ...pending, sha256: 'B'.repeat(64) }],
        ['a missing name', { ...pending, name: '' }],
        ['no artifact paths', { ...pending, artifactPaths: [] }]
      ])('AC-49 recordPause refuses %s (fails closed)', (_label, bad) => {
        expect(() => recordPause(createFeatureState('p'), bad as typeof pending)).toThrow();
      });

      it('AC-51 clearPause removes the pending checkpoint and sets IN_PROGRESS', () => {
        const state = clearPause(recordPause(createFeatureState('p'), pending));
        expect(state.status).toBe('IN_PROGRESS');
        expect(state.pendingCheckpoint).toBeUndefined();
      });

      it('AC-51 clearPause refuses a run that is not PAUSED', () => {
        expect(() => clearPause(createFeatureState('p'))).toThrow(/not PAUSED/);
      });
    });

    describe('AC-50 recordCheckpointApproval binding', () => {
      it('AC-50 an approval records the checkpoint id and the hash it is bound to', () => {
        const state = recordCheckpointApproval(createFeatureState('a'), 2, pending.name, 'resume --approve', undefined, {
          checkpointId: 2,
          sha256: HASH
        });
        expect(state.checkpointApprovals[0]).toMatchObject({ checkpointId: 2, sha256: HASH, approvedBy: 'resume --approve' });
      });

      it('AC-50 an approval without a binding keeps the pre-A-2 shape', () => {
        const state = recordCheckpointApproval(createFeatureState('a'), 2, 'Story');
        expect('checkpointId' in state.checkpointApprovals[0]).toBe(false);
        expect('sha256' in state.checkpointApprovals[0]).toBe(false);
      });

      it('AC-50 a binding with a malformed hash is refused (fails closed)', () => {
        expect(() =>
          recordCheckpointApproval(createFeatureState('a'), 2, 'x', undefined, undefined, { checkpointId: 2, sha256: 'nope' })
        ).toThrow();
      });
    });

    describe('AC-74 recordCheckpointRejection', () => {
      const rejection = {
        checkpointId: 2 as const,
        name: pending.name,
        stage: 2,
        notes: 'Missing the error states',
        sha256: HASH,
        artifactPaths: pending.artifactPaths,
        reworkAgents: ['03-spec-writer'],
        source: 'resume --reject' as const
      };

      it('AC-74 appends the rejection with notes, checkpoint and rejectedAt, and resolves the matching pause', () => {
        const state = recordCheckpointRejection(recordPause(createFeatureState('r'), pending), rejection);

        expect(state.checkpointRejections).toHaveLength(1);
        expect(state.checkpointRejections?.[0]).toMatchObject(rejection);
        expect(Number.isNaN(Date.parse(state.checkpointRejections?.[0].rejectedAt ?? ''))).toBe(false);
        expect(state.pendingCheckpoint).toBeUndefined();
        expect(state.status).toBe('IN_PROGRESS');
      });

      it('AC-46 a TTY rejection may carry empty notes', () => {
        const state = recordCheckpointRejection(createFeatureState('r'), { ...rejection, notes: '', source: 'approver' });
        expect(state.checkpointRejections?.[0].notes).toBe('');
      });

      it('AC-74 tolerates a state file written before the list existed', () => {
        const old = createFeatureState('r');
        delete old.checkpointRejections;
        expect(recordCheckpointRejection(old, rejection).checkpointRejections).toHaveLength(1);
      });

      it.each([
        ['no rework agents', { ...rejection, reworkAgents: [] }],
        ['a checkpoint id outside 1..3', { ...rejection, checkpointId: 0 }],
        ['a malformed hash', { ...rejection, sha256: '' }],
        ['notes that are not a string', { ...rejection, notes: undefined }]
      ])('AC-74 refuses a rejection with %s (fails closed)', (_label, bad) => {
        expect(() => recordCheckpointRejection(createFeatureState('r'), bad as unknown as typeof rejection)).toThrow();
      });
    });

    describe('D-5 recordReworkStart', () => {
      const rejection = {
        checkpointId: 3 as const,
        name: 'CHECKPOINT 3: Approve the validated change',
        stage: 4,
        notes: 'Use the existing rate limiter',
        sha256: HASH,
        artifactPaths: ['.factory/run/VALIDATION_REPORT.md'],
        reworkAgents: ['04-backend-builder'],
        source: 'approver' as const
      };

      it('D-5 sets the rework start and the superseded directory on that cycle\'s rejection only', () => {
        let state = recordCheckpointRejection(createFeatureState('w'), { ...rejection, checkpointId: 1 });
        state = recordCheckpointRejection(state, rejection);

        state = recordReworkStart(state, 2, { supersededDir: '.factory/run/_superseded/2' });

        expect(state.checkpointRejections?.[0].rework).toBeUndefined();
        expect(state.checkpointRejections?.[1].rework).toEqual({
          startedAt: expect.any(String),
          supersededDir: '.factory/run/_superseded/2'
        });
        expect(Number.isNaN(Date.parse(state.checkpointRejections![1].rework!.startedAt))).toBe(false);
      });

      it.each<[string, number, string]>([
        ['an unknown cycle', 2, '.factory/run/_superseded/2'],
        ['cycle 0', 0, '.factory/run/_superseded/0'],
        ['a blank superseded directory', 1, ' ']
      ])('D-5 refuses %s (fails closed)', (_label, cycle, dir) => {
        const state = recordCheckpointRejection(createFeatureState('w'), rejection);
        expect(() => recordReworkStart(state, cycle, { supersededDir: dir })).toThrow();
      });

      it('D-5 refuses to start the same rework twice', () => {
        const state = recordReworkStart(recordCheckpointRejection(createFeatureState('w'), rejection), 1, { supersededDir: 'd' });
        expect(() => recordReworkStart(state, 1, { supersededDir: 'd' })).toThrow(/already/);
      });
    });

    describe('AC-72 recordAttemptGrant', () => {
      it('AC-72 records builder, n, phase and a timestamp', () => {
        const state = recordAttemptGrant(createFeatureState('g'), {
          builder: '04-backend-builder',
          attempts: 2,
          at: { phase: 'validator-round', round: 1 }
        });
        expect(state.attemptGrants).toHaveLength(1);
        expect(state.attemptGrants?.[0]).toMatchObject({
          builder: '04-backend-builder',
          attempts: 2,
          at: { phase: 'validator-round', round: 1 }
        });
        expect(Number.isNaN(Date.parse(state.attemptGrants?.[0].grantedAt ?? ''))).toBe(false);
      });

      it.each([0, -1, 1.5, Number.NaN])('AC-72 refuses a grant of %p attempts (fails closed)', attempts => {
        expect(() =>
          recordAttemptGrant(createFeatureState('g'), { builder: '04-backend-builder', attempts, at: { phase: 'stage3' } })
        ).toThrow();
      });
    });

    describe('AC-36 recordBuilderAttempt rework budget', () => {
      it('AC-36 counts rework attempts per cycle, separately from Stage 3 and validator rounds', () => {
        let state = createFeatureState('t');
        state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
        state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'rework', round: 1 });
        state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'rework', round: 1 });
        state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'validator-round', round: 1 });
        state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });

        expect(state.builderAttempts?.['04-backend-builder']).toEqual({
          stage3: 2,
          validatorRounds: { 1: 1 },
          rework: { 1: 2 }
        });
      });

      it('AC-75 a step and a loop-back can carry the rework phase and a failure', () => {
        let state = createFeatureState('t');
        state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', undefined, undefined, { phase: 'rework', round: 1 });
        state = recordLoopBack(state, 3, '04-backend-builder', 'tests failed', 'FAIL', undefined, { phase: 'rework', round: 1 }, {
          kind: 'status',
          error: 'builder reported FAIL'
        });
        state = recordLoopBack(state, 3, '04-backend-builder', 'x', 'FAIL');

        expect([state.stageHistory[0].phase, state.stageHistory[0].round]).toEqual(['rework', 1]);
        expect(state.loopBacks[0].failure).toEqual({ kind: 'status', error: 'builder reported FAIL' });
        expect('failure' in state.loopBacks[1]).toBe(false);
      });
    });

    describe('TIMING agent timings', () => {
      it('TIMING recordAgentStep uses the real start and end when given, with a duration', () => {
        const state = recordAgentStep(createFeatureState('t'), 1, '01-researcher', 'PASS', undefined, undefined, undefined, {
          startedAt: '2026-10-04T10:00:00.000Z',
          completedAt: '2026-10-04T10:02:30.500Z'
        });
        expect(state.stageHistory[0]).toMatchObject({
          startedAt: '2026-10-04T10:00:00.000Z',
          completedAt: '2026-10-04T10:02:30.500Z',
          durationMs: 150500
        });
      });

      it('TIMING recordAgentStep without timing keeps the pre-A-2 shape (no durationMs)', () => {
        const state = recordAgentStep(createFeatureState('t'), 1, '01-researcher', 'PASS');
        expect('durationMs' in state.stageHistory[0]).toBe(false);
      });

      it.each([
        ['an unparseable start', { startedAt: 'yesterday', completedAt: '2026-10-04T10:00:00.000Z' }],
        ['an end before the start', { startedAt: '2026-10-04T10:00:01.000Z', completedAt: '2026-10-04T10:00:00.000Z' }]
      ])('TIMING recordAgentStep refuses %s (fails closed)', (_label, timing) => {
        expect(() =>
          recordAgentStep(createFeatureState('t'), 1, '01-researcher', 'PASS', undefined, undefined, undefined, timing)
        ).toThrow();
      });

      it('TIMING recordAgentInvocation appends the record and adds its duration to timePerStage', () => {
        let state = createFeatureState('t');
        const base = { agent: '04-backend-builder', startedAt: '2026-10-04T10:00:00.000Z', completedAt: '2026-10-04T10:00:01.000Z' };
        state = recordAgentInvocation(state, { ...base, stage: 3, durationMs: 1000, phase: 'stage3', attempt: 1 });
        state = recordAgentInvocation(state, { ...base, stage: 3, durationMs: 250, phase: 'stage3', attempt: 2 });
        state = recordAgentInvocation(state, { ...base, agent: '01-researcher', stage: 1, durationMs: 40 });

        expect(state.agentInvocations).toHaveLength(3);
        expect(state.agentInvocations?.[1]).toMatchObject({ stage: 3, attempt: 2, durationMs: 250 });
        expect(state.metrics.timePerStage).toEqual({ 1: 40, 3: 1250 });
      });

      it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('TIMING recordAgentInvocation refuses a duration of %p', durationMs => {
        expect(() =>
          recordAgentInvocation(createFeatureState('t'), {
            stage: 1,
            agent: '01-researcher',
            startedAt: '2026-10-04T10:00:00.000Z',
            completedAt: '2026-10-04T10:00:00.000Z',
            durationMs
          })
        ).toThrow();
      });

      it('TIMING tolerates a state file written before the list existed', () => {
        const old = createFeatureState('t');
        delete old.agentInvocations;
        const state = recordAgentInvocation(old, {
          stage: 2,
          agent: '02-story-writer',
          startedAt: '2026-10-04T10:00:00.000Z',
          completedAt: '2026-10-04T10:00:00.010Z',
          durationMs: 10
        });
        expect(state.agentInvocations).toHaveLength(1);
      });
    });

    describe('D-8 recordChangeBase', () => {
      it('D-8 records the git base or the reason there is none', () => {
        expect(recordChangeBase(createFeatureState('c'), { kind: 'git', commit: 'abc123' }).changeBase).toEqual({
          kind: 'git',
          commit: 'abc123'
        });
        expect(recordChangeBase(createFeatureState('c'), { kind: 'none', reason: 'not a git work tree' }).changeBase).toEqual({
          kind: 'none',
          reason: 'not a git work tree'
        });
      });
    });

    describe('I-6 invalidateAgentSteps', () => {
      it('I-6 flags every non-invalidated PASS step of the named agents, keeping the steps', () => {
        let state = createFeatureState('i');
        state = recordAgentStep(state, 4, '06-test-verifier', 'PASS');
        state = recordAgentStep(state, 4, '07-validator', 'FAIL');
        state = recordAgentStep(state, 4, '07-validator', 'PASS');
        state = recordAgentStep(state, 3, '04-backend-builder', 'PASS');

        state = invalidateAgentSteps(state, ['06-test-verifier', '07-validator'], 'Stage 4 gate failed');

        expect(state.stageHistory).toHaveLength(4);
        expect(state.stageHistory[0].invalidated).toMatchObject({ reason: 'Stage 4 gate failed' });
        expect(Number.isNaN(Date.parse(state.stageHistory[0].invalidated?.at ?? ''))).toBe(false);
        expect(state.stageHistory[1].invalidated).toBeUndefined();
        expect(state.stageHistory[2].invalidated).toMatchObject({ reason: 'Stage 4 gate failed' });
        expect(state.stageHistory[3].invalidated).toBeUndefined();
      });

      it('I-6 also flags pre-supplied tier-1 steps by the agent of their output', () => {
        let state = createFeatureState('i');
        state = recordAgentStep(state, 2, 'tier-1', 'PASS', {
          stage: 2,
          agent: '02-story-writer',
          timestamp: new Date().toISOString(),
          status: 'PASS',
          details: { summary: 's', artifacts: [] }
        });
        state = invalidateAgentSteps(state, ['02-story-writer'], 'story gate failed');
        expect(state.stageHistory[0].invalidated?.reason).toBe('story gate failed');
      });

      it('I-6 does not overwrite an earlier invalidation', () => {
        let state = recordAgentStep(createFeatureState('i'), 1, '01-researcher', 'PASS');
        state = invalidateAgentSteps(state, ['01-researcher'], 'first');
        state = invalidateAgentSteps(state, ['01-researcher'], 'second');
        expect(state.stageHistory[0].invalidated?.reason).toBe('first');
      });

      it('I-6 refuses a blank reason (fails closed)', () => {
        expect(() => invalidateAgentSteps(createFeatureState('i'), ['01-researcher'], ' ')).toThrow();
      });
    });

    describe('AC-35 reopenFeature', () => {
      it('AC-35 reopens an ESCALATED run: IN_PROGRESS, completion fields cleared, latest escalation resolved, resume recorded', () => {
        const state = reopenFeature(escalatedRun(), { fromClass: 'ESCALATED', action: 'continue' });

        expect(state.status).toBe('IN_PROGRESS');
        expect(state.completedAt).toBeUndefined();
        expect(state.completionStatus).toBeUndefined();
        expect(state.finalSummary).toBeUndefined();
        expect('completedAt' in state).toBe(false);
        expect(state.escalations[0].resolvedAt).toBeTruthy();
        expect(state.escalations[0].resolution).toMatch(/resume/i);
        expect(state.resumeHistory).toHaveLength(1);
        expect(state.resumeHistory?.[0]).toMatchObject({ fromClass: 'ESCALATED', action: 'continue' });
        expect(isResumable(state)).toBe(true);
      });

      it('AC-72 a grant is recorded in the resume history', () => {
        const state = reopenFeature(escalatedRun(), { fromClass: 'ESCALATED', action: 'continue', grantedAttempts: 2 });
        expect(state.resumeHistory?.[0].grantedAttempts).toBe(2);
      });

      it('AC-35 resolves only the latest unresolved escalation', () => {
        let state = createFeatureState('two');
        state = recordEscalation(state, 3, '04-backend-builder', 'MAX_LOOPS', 'first');
        state.escalations[0].resolvedAt = '2026-01-01T00:00:00.000Z';
        state.escalations[0].resolution = 'earlier';
        state = recordEscalation(state, 4, '07-validator', 'CRITICAL_ISSUE', 'second');
        state = completeFeature(state, 'ESCALATED');

        state = reopenFeature(state, { fromClass: 'ESCALATED', action: 'continue' });

        expect(state.escalations[0].resolution).toBe('earlier');
        expect(state.escalations[1].resolvedAt).toBeTruthy();
      });

      it.each([
        ['SUCCESS', () => completeFeature(createFeatureState('s'), 'SUCCESS')],
        ['MANUAL_STOP', () => completeFeature(createFeatureState('m'), 'MANUAL_STOP')],
        ['PAUSED', () => recordPause(createFeatureState('p'), pending)]
      ])('AC-35 refuses to reopen a %s run', (_label, make) => {
        expect(() => reopenFeature(make(), { fromClass: 'ESCALATED', action: 'continue' })).toThrow();
      });
    });

    it('D-1 a state.json written before A-2 loads and every new recorder tolerates the missing fields', () => {
      const legacy = deserializeState(
        JSON.stringify({
          featureId: 'legacy-run',
          featureName: 'legacy',
          createdAt: '2026-01-01T00:00:00.000Z',
          currentStage: 4,
          status: 'COMPLETED',
          stageHistory: [],
          loopBacks: [],
          escalations: [
            {
              stage: 4,
              agent: '06-test-verifier',
              reason: 'CRITICAL_ISSUE',
              severity: 'CRITICAL',
              context: { message: 'x' },
              escalatedAt: '2026-01-01T00:00:00.000Z'
            }
          ],
          checkpointApprovals: [],
          metrics: { totalTime: 0, timePerStage: {}, loopCount: 0, escalationCount: 1 },
          completedAt: '2026-01-01T00:01:00.000Z',
          completionStatus: 'ESCALATED'
        })
      );

      expect(isResumable(legacy)).toBe(true);
      let state = reopenFeature(legacy, { fromClass: 'ESCALATED', action: 'continue' });
      state = recordAttemptGrant(state, { builder: '04-backend-builder', attempts: 1, at: { phase: 'stage3' } });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'rework', round: 1 });
      state = recordAgentInvocation(state, {
        stage: 4,
        agent: '06-test-verifier',
        startedAt: '2026-01-02T00:00:00.000Z',
        completedAt: '2026-01-02T00:00:01.000Z',
        durationMs: 1000
      });
      state = recordPause(state, pending);

      expect(state.status).toBe('PAUSED');
      expect(state.resumeHistory).toHaveLength(1);
      expect(state.attemptGrants).toHaveLength(1);
      expect(state.builderAttempts?.['04-backend-builder']).toEqual({ stage3: 0, validatorRounds: {}, rework: { 1: 1 } });
    });
  });
});
