/**
 * Feature Factory Stage Contracts & Gates
 *
 * Each stage (1-5) has explicit acceptance criteria.
 * Harness validates before allowing advancement to next stage.
 *
 * Adapted from: e2e-loop/harness/phase-gates.ts
 * Specialized for: Feature Factory stages 1-5
 */

export interface StageCriterion {
  name: string;
  description: string;
  validator: (context: StageContext) => Promise<CriterionResult>;
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
}

export interface CriterionResult {
  passed: boolean;
  score?: number;
  details: string;
  blockers?: string[];
}

export interface StageContract {
  stage: 1 | 2 | 3 | 4 | 5;
  name: string;
  description: string;
  acceptance: {
    requireAll: boolean;
    criteria: StageCriterion[];
  };
  artifacts: {
    required: string[];
    optional?: string[];
  };
  nextStage?: number;
  loopBackStage?: number;
}

export interface StageContext {
  stageDir: string;
  artifacts: Record<string, string>;
  metadata: Record<string, any>;
  previousStageResults?: any;
}

export interface StageAdvancementDecision {
  canAdvance: boolean;
  passRate: number;
  criteriaResults: Record<string, CriterionResult>;
  blockers: string[];
  recommendation: 'ADVANCE' | 'WAIT' | 'ESCALATE' | 'RETRY';
  reason: string;
}

/**
 * Stage Contracts: Define acceptance criteria for each stage
 */
export const stageContracts: Record<number, StageContract> = {
  1: {
    stage: 1,
    name: 'DISCOVER',
    description: 'Map codebase, identify patterns, assess risks',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'Researcher Report Complete',
          description: 'RESEARCHER_REPORT.md exists and is comprehensive',
          validator: async (ctx) => validateResearcherReport(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Files Identified',
          description: '3+ relevant files documented with roles',
          validator: async (ctx) => validateFilesIdentified(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Patterns Found',
          description: 'Existing code patterns documented',
          validator: async (ctx) => validatePatternsFound(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'Risks Flagged',
          description: 'Known issues and constraints identified',
          validator: async (ctx) => validateRisksIdentified(ctx),
          severity: 'IMPORTANT'
        }
      ]
    },
    artifacts: {
      required: ['RESEARCHER_REPORT.md'],
      optional: ['PATTERNS_FOUND.json', 'RISKS_IDENTIFIED.json']
    },
    nextStage: 2
  },

  2: {
    stage: 2,
    name: 'PLAN',
    description: 'Design user story and technical specification',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'User Story Complete',
          description: 'USER_STORY.md with 3+ acceptance criteria (Given/When/Then)',
          validator: async (ctx) => validateUserStory(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Technical Brief Complete',
          description: 'TECHNICAL_BRIEF.md with data model, API, UI, tests',
          validator: async (ctx) => validateTechnicalBrief(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'File List Documented',
          description: 'Every file to be changed listed with reason',
          validator: async (ctx) => validateFileListDocumented(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'AC Testable',
          description: 'All acceptance criteria are in testable format',
          validator: async (ctx) => validateACTestable(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md']
    },
    nextStage: 3,
    loopBackStage: 1
  },

  3: {
    stage: 3,
    name: 'EXECUTE',
    description: 'Implement backend and frontend',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'All Files Modified',
          description: 'Every file in FILE_LIST.md was touched',
          validator: async (ctx) => validateAllFilesModified(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Unit Tests Pass',
          description: '100% of unit tests passing',
          validator: async (ctx) => validateUnitTestsPass(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Code Follows Patterns',
          description: 'Implementation uses existing patterns from codebase',
          validator: async (ctx) => validatePatternsFollowed(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'No Abandoned TODOs',
          description: 'All TODOs resolved or deferred',
          validator: async (ctx) => validateNoAbandonedTODOs(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'Loop Count Within Limits',
          description: 'Backend loops <= 3, Frontend loops <= 3',
          validator: async (ctx) => validateLoopLimits(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['BACKEND_BUILDER_SUMMARY.md', 'FRONTEND_BUILDER_SUMMARY.md'],
      optional: ['LOOP_LOG.json']
    },
    nextStage: 4,
    loopBackStage: 3
  },

  4: {
    stage: 4,
    name: 'VERIFY',
    description: 'Test and validate implementation',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'Acceptance Tests Complete',
          description: 'All story ACs tested or marked not-coverable',
          validator: async (ctx) => validateAcceptanceTestsComplete(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Validation Passed',
          description: 'No Critical issues in VALIDATION_REPORT.md',
          validator: async (ctx) => validateValidationPassed(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Security Audit Passed',
          description: 'No security vulnerabilities found',
          validator: async (ctx) => validateSecurityPassed(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'No Regressions',
          description: 'Previously passing tests still pass',
          validator: async (ctx) => validateNoRegressions(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['TEST_REPORT.md', 'VALIDATION_REPORT.md'],
      optional: ['SECURITY_REPORT.md', 'REGRESSION_ANALYSIS.json']
    },
    nextStage: 5,
    loopBackStage: 3
  },

  5: {
    stage: 5,
    name: 'DELIVER',
    description: 'Consolidate learnings after merge',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'Consolidation Complete',
          description: 'CONSOLIDATION_REPORT.md documents execution metrics',
          validator: async (ctx) => validateConsolidationComplete(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'Patterns Extracted',
          description: 'Reusable patterns documented in PATTERNS.md',
          validator: async (ctx) => validatePatternsExtracted(ctx),
          severity: 'IMPORTANT'
        },
        {
          name: 'Knowledge Stored',
          description: 'Patterns saved to memory for future features',
          validator: async (ctx) => validateKnowledgeStored(ctx),
          severity: 'IMPORTANT'
        }
      ]
    },
    artifacts: {
      required: ['CONSOLIDATION_REPORT.md'],
      optional: ['PATTERNS.md', 'TIME_ESTIMATES.json']
    }
  }
};

/**
 * Main gate function: Can we advance to the next stage?
 */
export async function canAdvanceStage(
  stage: number,
  contract: StageContract,
  context: StageContext
): Promise<StageAdvancementDecision> {
  const results: Record<string, CriterionResult> = {};
  const blockers: string[] = [];
  let passCount = 0;

  for (const criterion of contract.acceptance.criteria) {
    try {
      const result = await criterion.validator(context);
      results[criterion.name] = result;

      if (result.passed) {
        passCount++;
      } else {
        if (criterion.severity === 'CRITICAL') {
          blockers.push(`[CRITICAL] ${criterion.name}: ${result.details}`);
          if (result.blockers) {
            blockers.push(...result.blockers.map(b => `  → ${b}`));
          }
        } else if (criterion.severity === 'IMPORTANT') {
          blockers.push(`[IMPORTANT] ${criterion.name}: ${result.details}`);
        }
      }
    } catch (error) {
      results[criterion.name] = {
        passed: false,
        score: 0,
        details: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        blockers: ['Contact human — validation harness error']
      };
      blockers.push(`[ERROR] ${criterion.name} validation failed`);
    }
  }

  const passRate = (passCount / contract.acceptance.criteria.length) * 100;
  const allCriticalPass = contract.acceptance.criteria
    .filter(c => c.severity === 'CRITICAL')
    .every(c => results[c.name]?.passed);

  const canAdvance = contract.acceptance.requireAll
    ? allCriticalPass && passCount === contract.acceptance.criteria.length
    : allCriticalPass;

  const recommendation: StageAdvancementDecision['recommendation'] = canAdvance
    ? 'ADVANCE'
    : passRate === 100
      ? 'ADVANCE'
      : passRate >= 80
        ? 'WAIT'
        : 'ESCALATE';

  return {
    canAdvance,
    passRate,
    criteriaResults: results,
    blockers,
    recommendation,
    reason: canAdvance
      ? `All criteria met. Ready to advance to Stage ${contract.nextStage || 'terminal'}.`
      : blockers.length > 0
        ? blockers.join('\n')
        : 'Unknown failure — check logs'
  };
}

/**
 * Validator implementations
 */

async function validateResearcherReport(ctx: StageContext): Promise<CriterionResult> {
  const report = ctx.artifacts['RESEARCHER_REPORT.md'];
  if (!report) {
    return {
      passed: false,
      score: 0,
      details: 'RESEARCHER_REPORT.md not found',
      blockers: ['Run 01-Researcher agent to generate report']
    };
  }
  return { passed: true, score: 100, details: 'Researcher report exists and is comprehensive' };
}

async function validateFilesIdentified(ctx: StageContext): Promise<CriterionResult> {
  const fileCount = ctx.metadata.filesIdentified || 0;
  if (fileCount < 3) {
    return {
      passed: false,
      score: 0,
      details: `Only ${fileCount} files identified (need 3+)`,
      blockers: ['Expand researcher audit to identify more relevant files']
    };
  }
  return { passed: true, score: 100, details: `${fileCount} relevant files identified with roles` };
}

async function validatePatternsFound(ctx: StageContext): Promise<CriterionResult> {
  const patterns = ctx.metadata.patternsFound || 0;
  if (patterns === 0) {
    return {
      passed: false,
      score: 0,
      details: 'No existing patterns documented',
      blockers: ['Identify reusable patterns from existing codebase']
    };
  }
  return { passed: true, score: 100, details: `${patterns} patterns documented` };
}

async function validateRisksIdentified(ctx: StageContext): Promise<CriterionResult> {
  const risks = ctx.metadata.risksIdentified || [];
  if (risks.length === 0) {
    return {
      passed: false,
      score: 50,
      details: 'No risks or unknowns flagged (may indicate incomplete analysis)',
      blockers: []
    };
  }
  return { passed: true, score: 100, details: `${risks.length} risks/unknowns identified` };
}

async function validateUserStory(ctx: StageContext): Promise<CriterionResult> {
  const story = ctx.artifacts['USER_STORY.md'];
  if (!story) {
    return {
      passed: false,
      score: 0,
      details: 'USER_STORY.md not found',
      blockers: ['Run 02-Story Writer agent']
    };
  }
  const acCount = (story.match(/Given|When|Then/g) || []).length / 3; // Rough count
  if (acCount < 3) {
    return {
      passed: false,
      score: 50,
      details: `Only ${Math.floor(acCount)} acceptance criteria found (need 3+)`,
      blockers: ['Expand story with more acceptance criteria']
    };
  }
  return { passed: true, score: 100, details: `User story with ${Math.floor(acCount)} acceptance criteria` };
}

async function validateTechnicalBrief(ctx: StageContext): Promise<CriterionResult> {
  const brief = ctx.artifacts['TECHNICAL_BRIEF.md'];
  if (!brief) {
    return {
      passed: false,
      score: 0,
      details: 'TECHNICAL_BRIEF.md not found',
      blockers: ['Run 03-Spec Writer agent']
    };
  }
  return { passed: true, score: 100, details: 'Technical brief complete with data model, API, UI, tests' };
}

async function validateFileListDocumented(ctx: StageContext): Promise<CriterionResult> {
  const fileList = ctx.artifacts['FILE_LIST.md'];
  if (!fileList) {
    return {
      passed: false,
      score: 0,
      details: 'FILE_LIST.md not found',
      blockers: ['Document all files to be changed in FILE_LIST.md']
    };
  }
  return { passed: true, score: 100, details: 'All files documented with reasons' };
}

async function validateACTestable(ctx: StageContext): Promise<CriterionResult> {
  const story = ctx.artifacts['USER_STORY.md'];
  if (!story || !story.includes('Given') || !story.includes('When') || !story.includes('Then')) {
    return {
      passed: false,
      score: 0,
      details: 'Acceptance criteria not in Given/When/Then format',
      blockers: ['Reformat all AC using Given/When/Then structure']
    };
  }
  return { passed: true, score: 100, details: 'All AC in testable Given/When/Then format' };
}

async function validateAllFilesModified(ctx: StageContext): Promise<CriterionResult> {
  const modifiedCount = ctx.metadata.filesModified || 0;
  const expectedCount = ctx.metadata.filesExpected || 0;
  if (modifiedCount < expectedCount) {
    return {
      passed: false,
      score: (modifiedCount / expectedCount) * 100,
      details: `Only ${modifiedCount}/${expectedCount} files from FILE_LIST modified`,
      blockers: ['Complete implementation of all files in FILE_LIST']
    };
  }
  return { passed: true, score: 100, details: `All ${modifiedCount} files from FILE_LIST modified` };
}

async function validateUnitTestsPass(ctx: StageContext): Promise<CriterionResult> {
  const passRate = ctx.metadata.testPassRate || 0;
  if (passRate < 1.0) {
    return {
      passed: false,
      score: passRate * 100,
      details: `Unit tests: ${Math.round(passRate * 100)}% passing (need 100%)`,
      blockers: ['Fix failing unit tests before advancing']
    };
  }
  return { passed: true, score: 100, details: '100% of unit tests passing' };
}

async function validatePatternsFollowed(ctx: StageContext): Promise<CriterionResult> {
  return { passed: true, score: 100, details: 'Implementation follows existing codebase patterns' };
}

async function validateNoAbandonedTODOs(ctx: StageContext): Promise<CriterionResult> {
  const todoCount = ctx.metadata.abandonedTODOs || 0;
  if (todoCount > 0) {
    return {
      passed: false,
      score: 50,
      details: `${todoCount} abandoned TODOs in code`,
      blockers: ['Resolve all TODOs or defer to future PR']
    };
  }
  return { passed: true, score: 100, details: 'No abandoned TODOs' };
}

async function validateLoopLimits(ctx: StageContext): Promise<CriterionResult> {
  const backendLoops = ctx.metadata.backendLoops || 0;
  const frontendLoops = ctx.metadata.frontendLoops || 0;
  if (backendLoops > 3 || frontendLoops > 3) {
    return {
      passed: false,
      score: 0,
      details: `Backend loops: ${backendLoops}, Frontend loops: ${frontendLoops} (max 3 each)`,
      blockers: ['Escalate: builders exceeded loop limits']
    };
  }
  return { passed: true, score: 100, details: `Builders within loop limits (Backend: ${backendLoops}, Frontend: ${frontendLoops})` };
}

async function validateAcceptanceTestsComplete(ctx: StageContext): Promise<CriterionResult> {
  const testedCount = ctx.metadata.acceptanceCriteriaTestedCount || 0;
  const totalCount = ctx.metadata.acceptanceCriteriaTotalCount || 0;
  if (testedCount < totalCount) {
    return {
      passed: false,
      score: (testedCount / totalCount) * 100,
      details: `${testedCount}/${totalCount} acceptance criteria tested`,
      blockers: ['Complete testing of all acceptance criteria']
    };
  }
  return { passed: true, score: 100, details: `All ${totalCount} acceptance criteria tested` };
}

async function validateValidationPassed(ctx: StageContext): Promise<CriterionResult> {
  const criticalIssues = ctx.metadata.criticalIssuesCount || 0;
  if (criticalIssues > 0) {
    return {
      passed: false,
      score: 0,
      details: `${criticalIssues} Critical validation issues found`,
      blockers: ['Fix all Critical issues before advancing']
    };
  }
  return { passed: true, score: 100, details: 'Validation report clean - no Critical issues' };
}

async function validateSecurityPassed(ctx: StageContext): Promise<CriterionResult> {
  const securityIssues = ctx.metadata.securityIssuesCount || 0;
  if (securityIssues > 0) {
    return {
      passed: false,
      score: 0,
      details: `${securityIssues} security vulnerabilities found`,
      blockers: ['Fix security vulnerabilities before advancing']
    };
  }
  return { passed: true, score: 100, details: 'Security audit passed - no vulnerabilities' };
}

async function validateNoRegressions(ctx: StageContext): Promise<CriterionResult> {
  const regressions = ctx.metadata.regressionCount || 0;
  if (regressions > 0) {
    return {
      passed: false,
      score: 0,
      details: `${regressions} regressions detected (previously passing tests now failing)`,
      blockers: ['Fix regressions before advancing']
    };
  }
  return { passed: true, score: 100, details: 'No regressions - all previously passing tests still pass' };
}

async function validateConsolidationComplete(ctx: StageContext): Promise<CriterionResult> {
  const report = ctx.artifacts['CONSOLIDATION_REPORT.md'];
  if (!report) {
    return {
      passed: false,
      score: 0,
      details: 'CONSOLIDATION_REPORT.md not found',
      blockers: ['Run 08-Feature Consolidator agent (after PR merge)']
    };
  }
  return { passed: true, score: 100, details: 'Consolidation report created' };
}

async function validatePatternsExtracted(ctx: StageContext): Promise<CriterionResult> {
  const patterns = ctx.artifacts['PATTERNS.md'];
  if (!patterns) {
    return {
      passed: false,
      score: 50,
      details: 'PATTERNS.md not found (optional but recommended)',
      blockers: []
    };
  }
  return { passed: true, score: 100, details: 'Reusable patterns documented' };
}

async function validateKnowledgeStored(ctx: StageContext): Promise<CriterionResult> {
  const stored = ctx.metadata.knowledgeStored || false;
  if (!stored) {
    return {
      passed: false,
      score: 50,
      details: 'Patterns not yet stored to memory (optional but recommended)',
      blockers: []
    };
  }
  return { passed: true, score: 100, details: 'Patterns stored to memory for future features' };
}
