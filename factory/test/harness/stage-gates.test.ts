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
  STAGE2_SPEC_CONTRACT,
  STAGE2_STORY_CONTRACT,
  StageContext,
  StageContract,
  Stage4Metadata
} from '../../harness/stage-gates';
import { createFeatureState, recordImportantFindings } from '../../harness/state-tracker';
import { MAX_BUILDER_ATTEMPTS } from '../../harness/loop-rules';

describe('Stage Gates', () => {
  let mockContext: StageContext;

  beforeEach(() => {
    mockContext = {
      // These tests deliberately check against THIS repo's filesystem, so the claimed files
      // below (package.json, tsconfig.json) are real. The gate must be told which filesystem
      // to look at — it used to assume process.cwd(), which is how it ended up checking the
      // harness's directory instead of the project the agents were building in.
      cwd: process.cwd(),
      stageDir: 'artifacts/stage-1/',
      artifacts: {},
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

    it('Stage 1 should require a researcher report and files', () => {
      const stage1 = stageContracts[1];
      const names = stage1.acceptance.criteria.map(c => c.name);

      expect(names).toContain('Researcher Report Complete');
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
      mockContext.artifacts = { 'RESEARCHER_REPORT.md': '# Researcher Report' };
      mockContext.metadata = {
        filesIdentified: 5,
        patternsFound: 3,
        risksIdentified: ['multi-tenancy', 'timezone handling']
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(true);
      expect(decision.passRate).toBeGreaterThan(0);
      expect(decision.blockers.length).toBe(0);
    });

    it('should FAIL when files < 3', async () => {
      const stage1 = stageContracts[1];
      mockContext.artifacts = { 'RESEARCHER_REPORT.md': '# Researcher Report' };
      mockContext.metadata = {
        filesIdentified: 2,  // Less than required 3
        patternsFound: 3,
        risksIdentified: ['multi-tenancy', 'timezone handling']
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.length).toBeGreaterThan(0);
    });

    it('should FAIL when the researcher report is missing', async () => {
      const stage1 = stageContracts[1];
      mockContext.artifacts = {};  // CRITICAL criterion: report absent
      mockContext.metadata = {
        filesIdentified: 5,
        patternsFound: 3,
        risksIdentified: ['multi-tenancy', 'timezone handling']
      };

      const decision = await canAdvanceStage(1, stage1, mockContext);

      expect(decision.canAdvance).toBe(false);
    });

    it('should calculate pass rate correctly', async () => {
      const stage1 = stageContracts[1];
      const totalCriteria = stage1.acceptance.criteria.length;

      mockContext.artifacts = { 'RESEARCHER_REPORT.md': '# Researcher Report' };
      mockContext.metadata = {
        filesIdentified: 5,
        patternsFound: 0,    // IMPORTANT criterion fails
        risksIdentified: ['multi-tenancy', 'timezone handling']
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

    it('AC-72 the loop criterion reads the allowed attempts from metadata: a granted 4th attempt is within limits', async () => {
      const stage3 = stageContracts[3];
      const criterion = stage3.acceptance.criteria.find(c => c.name === 'Loop Count Within Limits')!;

      mockContext.metadata = { backendLoops: 4, frontendLoops: 1, maxBackendLoops: 4 };
      expect((await criterion.validator(mockContext)).passed).toBe(true);

      mockContext.metadata = { backendLoops: 1, frontendLoops: 4, maxBackendLoops: 4 };
      expect((await criterion.validator(mockContext)).passed).toBe(false);

      mockContext.metadata = { backendLoops: 5, frontendLoops: 0, maxBackendLoops: 4, maxFrontendLoops: 3 };
      const over = await criterion.validator(mockContext);
      expect(over.passed).toBe(false);
      expect(over.details).toMatch(/max 4/);
    });

    it('AC-72 without max metadata the loop limit is MAX_BUILDER_ATTEMPTS', async () => {
      const criterion = stageContracts[3].acceptance.criteria.find(c => c.name === 'Loop Count Within Limits')!;

      mockContext.metadata = { backendLoops: MAX_BUILDER_ATTEMPTS, frontendLoops: MAX_BUILDER_ATTEMPTS };
      expect((await criterion.validator(mockContext)).passed).toBe(true);
      mockContext.metadata = { backendLoops: MAX_BUILDER_ATTEMPTS + 1 };
      expect((await criterion.validator(mockContext)).passed).toBe(false);
    });

    // The claimed files below are real paths in this repo, so the materialization gate is
    // exercised against the actual filesystem rather than a mocked existence map.
    it('should PASS when all files modified and tests 100%', async () => {
      const stage3 = stageContracts[3];
      mockContext.metadata = {
        filesModified: 5,
        filesExpected: 5,
        testPassRate: 1.0,
        backendLoops: 2,
        frontendLoops: 1,
        noAbandonedTODOs: true,
        claimedFiles: ['package.json', 'tsconfig.json']
      };

      const decision = await canAdvanceStage(3, stage3, mockContext);

      expect(decision.canAdvance).toBe(true);
    });

    it('should BLOCK when a builder claims a file it never wrote', async () => {
      const stage3 = stageContracts[3];
      mockContext.metadata = {
        filesModified: 5,
        filesExpected: 5,
        testPassRate: 1.0,
        backendLoops: 2,
        frontendLoops: 1,
        noAbandonedTODOs: true,
        // package.json is real; the service file is a hallucination.
        claimedFiles: ['package.json', 'src/services/TotallyImaginaryService.ts']
      };

      const decision = await canAdvanceStage(3, stage3, mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.join('\n')).toContain('HALLUCINATION DETECTED');
      expect(decision.blockers.join('\n')).toContain('TotallyImaginaryService.ts');
    });
  });

  describe('canAdvanceStage - Stage 4', () => {
    /** Both Stage 4 documents present: TEST_REPORT.md (harness-rendered) and VALIDATION_REPORT.md. */
    const stage4Artifacts = () => ({
      'TEST_REPORT.md': '> **Harness-generated** from 06-test-verifier\'s structured output.',
      'VALIDATION_REPORT.md': '# Validation Report'
    });

    /** Every Stage 4 input present and clean. Typed, so a misspelt key is a compile error. */
    const cleanStage4 = (): Stage4Metadata => ({
      acceptanceCriteriaTotalCount: 4,
      acceptanceCriteriaTestedCount: 4,
      acceptanceCriteriaNotCoverableCount: 0,
      storyAcceptanceCriteriaCount: 4,
      criticalIssuesCount: 0,
      securityIssuesCount: 0,
      securityBlockers: [],
      executionMeasurement: { total: 10, passed: 10, failed: 0, passRate: 1 },
      regressionReferenceCount: 10
    });

    /** Judge only "No Regressions" for the given harness measurement and reference. */
    const noRegressions = async (md: Partial<Stage4Metadata>) => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = { ...cleanStage4(), ...md };
      mockContext.metadata = metadata;
      return canAdvanceStage(4, stageContracts[4], mockContext);
    };

    // The input is the harness's own Gate 2 count against its reference — never a number the
    // Validator typed into its report.
    it('should FAIL if regressions detected', async () => {
      const decision = await noRegressions({
        executionMeasurement: { total: 8, passed: 8, failed: 0, passRate: 1 },
        regressionReferenceCount: 10
      });

      expect(decision.canAdvance).toBe(false);
      expect(decision.criteriaResults['No Regressions'].passed).toBe(false);
      expect(decision.blockers.join('\n')).toMatch(/\[CRITICAL\] No Regressions: .*8.*10/);
    });

    it('AC-22 No Regressions fails when there is no Gate 2 measurement to judge', async () => {
      const decision = await noRegressions({ executionMeasurement: undefined });

      expect(decision.canAdvance).toBe(false);
      expect(decision.criteriaResults['No Regressions'].passed).toBe(false);
    });

    it('AC-22 No Regressions fails below a 100% pass rate even at the reference count', async () => {
      const decision = await noRegressions({
        executionMeasurement: { total: 10, passed: 9, failed: 1, passRate: 0.9 },
        regressionReferenceCount: 10
      });

      expect(decision.criteriaResults['No Regressions'].passed).toBe(false);
    });

    it('AC-22 No Regressions passes at or above the reference with 100%', async () => {
      for (const total of [10, 11]) {
        const decision = await noRegressions({
          executionMeasurement: { total, passed: total, failed: 0, passRate: 1 },
          regressionReferenceCount: 10
        });
        expect({ total, passed: decision.criteriaResults['No Regressions'].passed }).toEqual({ total, passed: true });
      }
    });

    // IMPORTANT-5 (operator decision): only tests that RAN (passed + failed) count; skipped and
    // todo tests do not, so a round cannot .skip its way past the reference.
    it('IMPORTANT-5 No Regressions FAILS when 10 are reported but only 8 ran (2 skipped), against a reference of 10', async () => {
      const decision = await noRegressions({
        executionMeasurement: { total: 10, passed: 8, failed: 0, passRate: 1 },
        regressionReferenceCount: 10
      });

      expect(decision.criteriaResults['No Regressions'].passed).toBe(false);
      expect(decision.blockers.join('\n')).toMatch(/\[CRITICAL\] No Regressions: .*8 tests ran.*10/);
    });

    it('IMPORTANT-5 No Regressions passes when 10 ran against a reference of 10, whatever else was skipped', async () => {
      const decision = await noRegressions({
        executionMeasurement: { total: 13, passed: 10, failed: 0, passRate: 1 },
        regressionReferenceCount: 10
      });

      expect(decision.criteriaResults['No Regressions'].passed).toBe(true);
    });

    it('AC-66 with no reference only the 100% rule applies', async () => {
      const passes = await noRegressions({
        executionMeasurement: { total: 1, passed: 1, failed: 0, passRate: 1 },
        regressionReferenceCount: undefined
      });
      expect(passes.criteriaResults['No Regressions'].passed).toBe(true);

      const fails = await noRegressions({
        executionMeasurement: { total: 4, passed: 3, failed: 1, passRate: 0.75 },
        regressionReferenceCount: undefined
      });
      expect(fails.criteriaResults['No Regressions'].passed).toBe(false);
    });

    it('AC-62 Stage 4 passes on real metadata keys', async () => {
      const stage4 = stageContracts[4];
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = cleanStage4();
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stage4, mockContext);

      expect(decision.blockers).toEqual([]);
      expect(decision.canAdvance).toBe(true);
    });

    it('AC-62 Stage 4 with empty metadata fails (no vacuous pass)', async () => {
      const stage4 = stageContracts[4];
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {};
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stage4, mockContext);

      expect(decision.canAdvance).toBe(false);
      // No evidence is not clean evidence: each judged input fails on its own.
      expect(decision.criteriaResults['Acceptance Tests Complete'].passed).toBe(false);
      expect(decision.criteriaResults['Validation Passed'].passed).toBe(false);
      expect(decision.criteriaResults['Security Audit Passed'].passed).toBe(false);
      expect(decision.criteriaResults['No Regressions'].passed).toBe(false);
    });

    it('AC-18 totalAC 0 fails', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {
        ...cleanStage4(),
        acceptanceCriteriaTotalCount: 0,
        acceptanceCriteriaTestedCount: 0,
        storyAcceptanceCriteriaCount: 0
      };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.criteriaResults['Acceptance Tests Complete'].passed).toBe(false);
    });

    it('AC-18 tested+notCoverable ≥ totalAC equal to the story count passes', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {
        ...cleanStage4(),
        acceptanceCriteriaTotalCount: 5,
        acceptanceCriteriaTestedCount: 3,
        acceptanceCriteriaNotCoverableCount: 2,
        storyAcceptanceCriteriaCount: 5
      };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.criteriaResults['Acceptance Tests Complete'].passed).toBe(true);
      expect(decision.canAdvance).toBe(true);
    });

    it('AC-18 tested+notCoverable below totalAC fails', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {
        ...cleanStage4(),
        acceptanceCriteriaTotalCount: 5,
        acceptanceCriteriaTestedCount: 3,
        acceptanceCriteriaNotCoverableCount: 1,
        storyAcceptanceCriteriaCount: 5
      };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.criteriaResults['Acceptance Tests Complete'].details).toMatch(/4\/5/);
    });

    it('AC-18 totalAC different from the story count fails', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {
        ...cleanStage4(),
        acceptanceCriteriaTotalCount: 3,
        acceptanceCriteriaTestedCount: 3,
        storyAcceptanceCriteriaCount: 5
      };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.criteriaResults['Acceptance Tests Complete'].details).toMatch(/story has 5/);
    });

    it('AC-18 an unknown story count fails rather than trusting the Test Verifier\'s total', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = { ...cleanStage4(), storyAcceptanceCriteriaCount: undefined };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.criteriaResults['Acceptance Tests Complete'].passed).toBe(false);
    });

    it('AC-21 a missing required Stage 4 artifact fails canAdvanceStage', async () => {
      mockContext.artifacts = { 'VALIDATION_REPORT.md': '# Validation Report' };
      mockContext.metadata = cleanStage4();

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      // Every criterion passes; the missing document alone blocks.
      expect(Object.values(decision.criteriaResults).every(r => r.passed)).toBe(true);
      expect(decision.canAdvance).toBe(false);
      expect(decision.missingArtifacts).toEqual(['TEST_REPORT.md']);
      expect(decision.blockers.join('\n')).toContain('TEST_REPORT.md');
      expect(decision.recommendation).not.toBe('ADVANCE');
    });

    it('a security blocker is carried into the gate blockers', async () => {
      mockContext.artifacts = stage4Artifacts();
      const metadata: Stage4Metadata = {
        ...cleanStage4(),
        securityIssuesCount: 1,
        securityBlockers: ['authImplemented is false']
      };
      mockContext.metadata = metadata;

      const decision = await canAdvanceStage(4, stageContracts[4], mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.join('\n')).toContain('authImplemented is false');
    });
  });

  describe('IMPORTANT findings (AC-17)', () => {
    it('AC-17 an IMPORTANT failure with all CRITICAL passing advances and is returned as an important finding', async () => {
      mockContext.artifacts = { 'RESEARCHER_REPORT.md': '# Researcher Report' };
      mockContext.metadata = {
        filesIdentified: 5,
        patternsFound: 0, // IMPORTANT: "Patterns Found" fails
        risksIdentified: ['timezones']
      };

      const decision = await canAdvanceStage(1, stageContracts[1], mockContext);

      expect(decision.canAdvance).toBe(true);
      expect(decision.recommendation).toBe('ADVANCE');
      expect(decision.blockers).toEqual([]);
      expect(decision.importantFindings).toEqual([
        '[Stage 1] Patterns Found: No existing patterns documented'
      ]);
    });

    it('AC-17 recordImportantFindings appends the finding to the run\'s list', () => {
      let state = createFeatureState('findings');
      state = recordImportantFindings(state, 1, 'stage-gate', ['[Stage 1] Patterns Found: none']);
      state = recordImportantFindings(state, 4, 'gate-2', ['2 skipped tests']);
      state = recordImportantFindings(state, 4, 'gate-2', []);

      expect(state.importantFindings!.map(({ stage, source, message }) => ({ stage, source, message }))).toEqual([
        { stage: 1, source: 'stage-gate', message: '[Stage 1] Patterns Found: none' },
        { stage: 4, source: 'gate-2', message: '2 skipped tests' }
      ]);
      for (const finding of state.importantFindings!) {
        expect(Number.isNaN(Date.parse(finding.recordedAt))).toBe(false);
      }
    });

    it('recordImportantFindings tolerates a state file written before the field existed', () => {
      const legacy = createFeatureState('legacy');
      delete legacy.importantFindings;

      const state = recordImportantFindings(legacy, 3, 'stage-gate', ['finding']);

      expect(state.importantFindings!.map(f => f.message)).toEqual(['finding']);
    });

    it('a criterion whose validator throws blocks whatever its severity', async () => {
      const contract: StageContract = {
        stage: 5,
        name: 'TEST',
        description: 'one IMPORTANT criterion that throws',
        acceptance: {
          criteria: [
            {
              name: 'Explodes',
              description: 'throws',
              severity: 'IMPORTANT',
              validator: async () => {
                throw new Error('boom');
              }
            }
          ]
        },
        artifacts: { required: [] }
      };

      const decision = await canAdvanceStage(5, contract, mockContext);

      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.join('\n')).toContain('Explodes');
      expect(decision.importantFindings).toEqual([]);
    });

    it('no contract carries a requireAll switch any more', () => {
      for (const contract of Object.values(stageContracts)) {
        expect(Object.keys(contract.acceptance)).toEqual(['criteria']);
      }
    });

    it('Stage 3 requires no documents; its harness-rendered summaries are optional', () => {
      expect(stageContracts[3].artifacts.required).toEqual([]);
      expect(stageContracts[3].artifacts.optional).toEqual([
        'BACKEND_SUMMARY.md',
        'API_CONTRACT.md',
        'FRONTEND_SUMMARY.md',
        'LOOP_LOG.json'
      ]);
      expect(stageContracts[4].artifacts.required).toEqual(['TEST_REPORT.md', 'VALIDATION_REPORT.md']);
    });
  });

  describe('Gate Recommendations', () => {
    it('should recommend ADVANCE when passing', async () => {
      const stage1 = stageContracts[1];
      mockContext.artifacts = { 'RESEARCHER_REPORT.md': '# Researcher Report' };
      mockContext.metadata = {
        filesIdentified: 5,
        patternsFound: 3,
        risksIdentified: ['multi-tenancy', 'timezone handling']
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

describe('the split Stage 2 gate (C-9, A-2 step 4)', () => {
  const criteria = (contract: StageContract) => contract.acceptance.criteria.map(c => [c.name, c.severity]);

  it('AC-56 STAGE2_STORY_CONTRACT judges the story alone: User Story Complete and AC Testable (CRITICAL), USER_STORY.md required', () => {
    expect(STAGE2_STORY_CONTRACT.stage).toBe(2);
    expect(criteria(STAGE2_STORY_CONTRACT)).toEqual([
      ['User Story Complete', 'CRITICAL'],
      ['AC Testable', 'CRITICAL']
    ]);
    expect(STAGE2_STORY_CONTRACT.artifacts.required).toEqual(['USER_STORY.md']);
  });

  it('AC-78 STAGE2_SPEC_CONTRACT judges the brief alone: Technical Brief Complete (CRITICAL), File List Documented (IMPORTANT), both documents required', () => {
    expect(STAGE2_SPEC_CONTRACT.stage).toBe(2);
    expect(criteria(STAGE2_SPEC_CONTRACT)).toEqual([
      ['Technical Brief Complete', 'CRITICAL'],
      ['File List Documented', 'IMPORTANT']
    ]);
    expect(STAGE2_SPEC_CONTRACT.artifacts.required).toEqual(['TECHNICAL_BRIEF.md', 'FILE_LIST.md']);
  });

  it('C-9 stageContracts[2] is the concatenation of the story and spec contracts, so acceptFeatureSpec judges both', () => {
    expect(stageContracts[2].stage).toBe(2);
    expect(stageContracts[2].acceptance.criteria).toEqual([
      ...STAGE2_STORY_CONTRACT.acceptance.criteria,
      ...STAGE2_SPEC_CONTRACT.acceptance.criteria
    ]);
    expect(stageContracts[2].artifacts.required).toEqual([
      ...STAGE2_STORY_CONTRACT.artifacts.required,
      ...STAGE2_SPEC_CONTRACT.artifacts.required
    ]);
  });

  it('AC-57 each part blocks only on its own documents, with blockers', async () => {
    const context = (artifacts: Record<string, string>): StageContext => ({
      cwd: process.cwd(),
      stageDir: '',
      artifacts,
      metadata: {}
    });
    const testableStory = ['# Story', ...[1, 2, 3].flatMap(i => [`Given ${i}`, `When ${i}`, `Then ${i}`])].join('\n');

    // The story part passes on a testable story with no brief anywhere...
    expect((await canAdvanceStage(2, STAGE2_STORY_CONTRACT, context({ 'USER_STORY.md': testableStory }))).canAdvance).toBe(true);
    // ...and the spec part blocks on the missing brief, naming it.
    const spec = await canAdvanceStage(2, STAGE2_SPEC_CONTRACT, context({ 'USER_STORY.md': testableStory }));
    expect(spec.canAdvance).toBe(false);
    expect(spec.blockers.join('\n')).toMatch(/TECHNICAL_BRIEF\.md/);

    // The story part blocks on prose with no Given/When/Then.
    const story = await canAdvanceStage(2, STAGE2_STORY_CONTRACT, context({ 'USER_STORY.md': '# Story\nIt should work.' }));
    expect(story.canAdvance).toBe(false);
    expect(story.blockers.join('\n')).toMatch(/Given\/When\/Then/);
  });
});

describe('the Stage 5 contract (D-10, A-2 step 5)', () => {
  const context = (artifacts: Record<string, string>, metadata: Record<string, unknown> = {}): StageContext => ({
    cwd: process.cwd(),
    stageDir: '',
    artifacts,
    metadata
  });

  it('AC-48 Stage 5 judges Consolidation Complete and Patterns Extracted, both CRITICAL, and requires CONSOLIDATION_REPORT.md and PATTERNS.md', () => {
    expect(stageContracts[5].acceptance.criteria.map(c => [c.name, c.severity])).toEqual([
      ['Consolidation Complete', 'CRITICAL'],
      ['Patterns Extracted', 'CRITICAL']
    ]);
    expect(stageContracts[5].artifacts.required).toEqual(['CONSOLIDATION_REPORT.md', 'PATTERNS.md']);
  });

  it('AC-48 the Stage 5 gate passes on the two documents alone, whatever any metadata says about memory', async () => {
    const both = { 'CONSOLIDATION_REPORT.md': '# Consolidation', 'PATTERNS.md': '# Patterns' };

    expect((await canAdvanceStage(5, stageContracts[5], context(both))).canAdvance).toBe(true);
    expect((await canAdvanceStage(5, stageContracts[5], context(both, { knowledgeStored: false }))).canAdvance).toBe(true);
  });

  it.each(['CONSOLIDATION_REPORT.md', 'PATTERNS.md'])('AC-48 the Stage 5 gate fails without %s, naming it', async missing => {
    const artifacts: Record<string, string> = { 'CONSOLIDATION_REPORT.md': '# Consolidation', 'PATTERNS.md': '# Patterns' };
    delete artifacts[missing];

    const decision = await canAdvanceStage(5, stageContracts[5], context(artifacts, { knowledgeStored: true }));

    expect(decision.canAdvance).toBe(false);
    expect(decision.blockers.join('\n')).toContain(missing);
  });
});
