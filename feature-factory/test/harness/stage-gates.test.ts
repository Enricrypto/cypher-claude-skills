/**
 * Stage Gates Tests
 *
 * Tests for: stage-gates.ts
 * - Stage contracts defined correctly
 * - Gate validation logic works
 * - Criteria evaluation is correct
 * - Advancement decision is accurate
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  stageContracts,
  canAdvanceStage,
  StageContext,
  StageAdvancementDecision
} from '../../harness/stage-gates';

describe('Stage Gates', () => {
  let mockContext: StageContext;

  beforeEach(() => {
    mockContext = {
      stageDir: 'artifacts/stage-1/',
      artifacts: [],
      metadata: {}
    };
  });

  describe('Stage Contracts', () => {
    it('should have contracts for all 5 stages', () => {
      expect(stageContracts[1]).toBeDefined();
      expect(stageContracts[2]).toBeDefined();
      expect(stageContracts[3]).toBeDefined();
      expect(stageContracts[4]).toBeDefined();
      expect(stageContracts[5]).toBeDefined();
    });

    it('Stage 1 should have CRITICAL criteria', () => {
      const stage1 = stageContracts[1];
      expect(stage1.acceptance.criteria.length).toBeGreaterThan(0);

      const criticalCriteria = stage1.acceptance.criteria.filter(
        c => c.severity === 'CRITICAL'
      );
      expect(criticalCriteria.length).toBeGreaterThan(0);
    });

    it('Stage 1 should require architecture and files', () => {
      const stage1 = stageContracts[1];
      const names = stage1.acceptance.criteria.map(c => c.name);

      expect(names).toContain('Architecture Mapped');
      expect(names).toContain('Files Identified');
    });

    it('Stage 3 should require tests to pass', () => {
      const stage3 = stageContracts[3];
      const names = stage3.acceptance.criteria.map(c => c.name);

      expect(names).toContain('Unit Tests Pass');
      expect(names).toContain('Loop Count Within Limits');
    });

    it('Stage 4 should require no regressions', () => {
      const stage4 = stageContracts[4];
      const names = stage4.acceptance.criteria.map(c => c.name);

      expect(names).toContain('No Regressions');
    });
  });

  describe('canAdvanceStage - Stage 1', () => {
    it('should PASS when all CRITICAL criteria met', async () => {
      const stage1 = stageContracts[1];
      mockContext.metadata = {
        architectureMapped: true,
        filesIdentified: 5,
        patternsFound: 3,
        risksFlagged: 2
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(true);
      expect(decision.passRate).toBeGreaterThan(0);
      expect(decision.blockers.length).toBe(0);
    });

    it('should FAIL when files < 3', async () => {
      const stage1 = stageContracts[1];
      mockContext.metadata = {
        architectureMapped: true,
        filesIdentified: 2,  // Less than required 3
        patternsFound: 3,
        risksFlagged: 2
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.length).toBeGreaterThan(0);
    });

    it('should FAIL when architecture not mapped', async () => {
      const stage1 = stageContracts[1];
      mockContext.metadata = {
        architectureMapped: false,  // CRITICAL failure
        filesIdentified: 5,
        patternsFound: 3,
        risksFlagged: 2
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(false);
    });

    it('should calculate pass rate correctly', async () => {
      const stage1 = stageContracts[1];
      const totalCriteria = stage1.acceptance.criteria.length;

      mockContext.metadata = {
        architectureMapped: true,
        filesIdentified: 5,
        patternsFound: 0,    // IMPORTANT criterion fails
        risksFlagged: 2
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      const expectedPassRate = ((totalCriteria - 1) / totalCriteria) * 100;
      expect(decision.passRate).toBeCloseTo(expectedPassRate, 0);
    });
  });

  describe('canAdvanceStage - Stage 3', () => {
    it('should FAIL if tests not 100% passing', async () => {
      const stage3 = stageContracts[3];
      mockContext.metadata = {
        filesModified: 5,
        testPassRate: 0.95,  // 95% is not enough
        loopLimitsOK: true
      };

      const decision = await canAdvanceStage(3, stage3, mockContext);

      expect(decision.canAdvance).toBe(false);
    });

    it('should FAIL if loop count exceeded', async () => {
      const stage3 = stageContracts[3];
      mockContext.metadata = {
        filesModified: 5,
        testPassRate: 1.0,
        backendLoops: 4,  // Exceeds max of 3
        loopLimitsOK: false
      };

      const decision = await canAdvanceStage(3, stage3, mockContext);

      expect(decision.canAdvance).toBe(false);
    });

    it('should PASS when all files modified and tests 100%', async () => {
      const stage3 = stageContracts[3];
      mockContext.metadata = {
        filesModified: 5,
        filesExpected: 5,
        testPassRate: 1.0,
        backendLoops: 2,
        frontendLoops: 1,
        noAbandonedTODOs: true
      };

      const decision = await canAdvanceStage(3, stage3, mockContext);

      expect(decision.canAdvance).toBe(true);
    });
  });

  describe('canAdvanceStage - Stage 4', () => {
    it('should FAIL if regressions detected', async () => {
      const stage4 = stageContracts[4];
      mockContext.metadata = {
        testsPassed: 145,
        testsBefore: 140,
        regressionCount: 5  // Previously passing tests now fail
      };

      const decision = await canAdvanceStage(4, stage4, mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => b.includes('regressions'))).toBe(true);
    });

    it('should PASS if no regressions and AC tested', async () => {
      const stage4 = stageContracts[4];
      mockContext.metadata = {
        acTestedCount: 4,
        acTotalCount: 4,
        validationCriticalCount: 0,
        securityIssuesCount: 0,
        regressionCount: 0
      };

      const decision = await canAdvanceStage(4, stage4, mockContext);

      expect(decision.canAdvance).toBe(true);
    });
  });

  describe('Gate Recommendations', () => {
    it('should recommend ADVANCE when passing', async () => {
      const stage1 = stageContracts[1];
      mockContext.metadata = {
        architectureMapped: true,
        filesIdentified: 5,
        patternsFound: 3,
        risksFlagged: 2
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.recommendation).toBe('ADVANCE');
    });

    it('should recommend ESCALATE on CRITICAL failure', async () => {
      const stage1 = stageContracts[1];
      mockContext.metadata = {
        architectureMapped: false,
        filesIdentified: 2,
        patternsFound: 0,
        risksFlagged: 0
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.recommendation).toBe('ESCALATE');
    });
  });

  describe('nextStage routing', () => {
    it('Stage 1 should advance to Stage 2', () => {
      expect(stageContracts[1].nextStage).toBe(2);
    });

    it('Stage 3 should loop back to itself', () => {
      expect(stageContracts[3].loopBackStage).toBe(3);
    });

    it('Stage 4 should loop back to Stage 3 on critical issues', () => {
      expect(stageContracts[4].loopBackStage).toBe(3);
    });
  });
});
