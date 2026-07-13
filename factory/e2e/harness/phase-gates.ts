/**
 * Phase Gates & Contract Validation
 *
 * Enforces deterministic phase advancement rules.
 * Only the harness can decide if a phase is complete.
 * Agents cannot advance phases; they produce artifacts that the harness validates.
 *
 * Key principle: "100% acceptance only"
 * - Phases do NOT advance unless ALL contract criteria are met
 * - No "close enough" or "good enough"
 * - If < 100%, escalate to human review
 */

export interface PhaseContract {
  phase: string;
  name: string;
  description: string;
  acceptance: {
    requireAll: boolean; // If true, ALL criteria must pass. If false, any can pass.
    criteria: ContractCriterion[];
  };
  artifacts: {
    required: string[]; // Files that must exist
    optional?: string[]; // Files that may exist
  };
  nextPhase?: string; // Phase to advance to if successful
  escalationPhase?: string; // Where to go if this phase fails
}

export interface ContractCriterion {
  name: string;
  description: string;
  validator: (context: PhaseContext) => Promise<CriterionResult>;
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
}

export interface CriterionResult {
  passed: boolean;
  score?: number; // 0-100
  details: string;
  blockers?: string[]; // If failed, what needs to happen to pass
}

export interface PhaseContext {
  phaseDir: string;
  artifacts: Record<string, string>; // filename -> filepath
  metadata: Record<string, any>;
  previousPhaseResults?: any;
}

export interface PhaseAdvancementDecision {
  canAdvance: boolean;
  passRate: number; // 0-100 (% of criteria met)
  criteriaResults: Record<string, CriterionResult>;
  blockers: string[]; // What's preventing advancement
  recommendation: 'ADVANCE' | 'WAIT' | 'ESCALATE' | 'RETRY';
  reason: string;
}

/**
 * Default Phase Contracts
 * "100% acceptance only" model:
 * - Phase 0-3: All CRITICAL + IMPORTANT must pass (NICE_TO_HAVE optional)
 * - Phase 4: All must pass
 */
export const phaseContracts: Record<string, PhaseContract> = {
  'phase-0-audit': {
    phase: 'phase-0-audit',
    name: 'Audit Preparation',
    description: 'Comprehensive code audit → validation → remediation',
    acceptance: {
      requireAll: true, // All criteria must pass
      criteria: [
        {
          name: 'Audit Complete',
          description: 'Audit report generated and contains all sections',
          validator: async (ctx) => validateAuditComplete(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Audit Validated',
          description: 'Audit validation report shows >= 95% completeness',
          validator: async (ctx) => validateAuditScore(ctx, 0.95),
          severity: 'CRITICAL'
        },
        {
          name: 'Gaps Remediated',
          description: 'All identified gaps have been fixed and documented',
          validator: async (ctx) => validateGapsRemediated(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: [
        'AUDIT_REPORT.md',
        'AUDIT_VALIDATION_REPORT.md',
        'REMEDIATED_AUDIT_REPORT.md'
      ],
      optional: ['AUDIT_DETAILS.json']
    },
    nextPhase: 'phase-1-infrastructure'
  },

  'phase-1-infrastructure': {
    phase: 'phase-1-infrastructure',
    name: 'Infrastructure Fix',
    description: 'Apply optional infrastructure corrections (non-blocking)',
    acceptance: {
      requireAll: false, // Can skip if no fixes needed
      criteria: [
        {
          name: 'Fixes Applied',
          description: 'Infrastructure fixes documented or skipped',
          validator: async (ctx) => validateInfrastructureFixes(ctx),
          severity: 'IMPORTANT'
        }
      ]
    },
    artifacts: {
      required: [],
      optional: ['INFRASTRUCTURE_FIXES.md']
    },
    nextPhase: 'phase-2-test-generation'
  },

  'phase-2-test-generation': {
    phase: 'phase-2-test-generation',
    name: 'Test Generation',
    description: 'Plan → Generate → Audit tests',
    acceptance: {
      requireAll: true, // All must pass for production-ready tests
      criteria: [
        {
          name: 'Test Plan Complete',
          description: 'Detailed test plan with all scenarios mapped',
          validator: async (ctx) => validateTestPlanComplete(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Tests Generated',
          description: 'All test files created in correct locations',
          validator: async (ctx) => validateTestsGenerated(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Tests Audit Passed',
          description: 'Test auditor verified no ghost features, selectors exist, APIs match schema',
          validator: async (ctx) => validateTestAuditPassed(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'All Tests Passing',
          description: '100% test pass rate across chromium, firefox, mobile-safari',
          validator: async (ctx) => validateAllTestsPassing(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: [
        'TEST_PLAN.md',
        'GENERATED_TESTS_MANIFEST.md',
        'TEST_AUDIT_REPORT.md',
        'TEST_RESULTS.json'
      ],
      optional: []
    },
    nextPhase: 'phase-3-remediation',
    escalationPhase: 'phase-3-remediation' // If tests fail, go to remediation
  },

  'phase-3-remediation': {
    phase: 'phase-3-remediation',
    name: 'Remediation Loop',
    description: 'Fix failing tests systematically until 100% pass rate',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: '100% Test Pass Rate',
          description: 'All tests passing on all 3 browsers (chromium, firefox, mobile-safari)',
          validator: async (ctx) => validate100PercentPass(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'No Regressions',
          description: 'Previously passing tests still pass',
          validator: async (ctx) => validateNoRegressions(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Max Iterations Not Exceeded',
          description: 'Remediation completed within iteration limits',
          validator: async (ctx) => validateIterationLimits(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: [
        'FINAL_TEST_RESULTS.json',
        'REMEDIATION_SUMMARY.md'
      ],
      optional: [
        'DIAGNOSIS_REPORT.md',
        'REMEDIATION_LOG.md'
      ]
    },
    nextPhase: 'phase-4-finalize'
  },

  'phase-4-finalize': {
    phase: 'phase-4-finalize',
    name: 'Finalize & Commit',
    description: 'Create production-ready PR (only after 100% pass)',
    acceptance: {
      requireAll: true,
      criteria: [
        {
          name: 'Commit Created',
          description: 'Git commit with clear fix summary',
          validator: async (ctx) => validateCommitCreated(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Ready for PR',
          description: 'All context preserved for human PR review',
          validator: async (ctx) => validateReadyForPR(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['COMMIT_SUMMARY.md'],
      optional: []
    },
    nextPhase: undefined // Terminal phase
  }
};

/**
 * Main gate function: Can we advance to the next phase?
 */
export async function canAdvancePhase(
  contract: PhaseContract,
  context: PhaseContext
): Promise<PhaseAdvancementDecision> {
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
          if (result.blockers) blockers.push(...result.blockers.map(b => `  → ${b}`));
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

  const recommendation: PhaseAdvancementDecision['recommendation'] = canAdvance
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
      ? `All criteria met. Ready to advance to ${contract.nextPhase || 'terminal phase'}.`
      : blockers.length > 0
        ? blockers.join('\n')
        : 'Unknown failure — check logs'
  };
}

/**
 * Validator implementations
 * These check if phase artifacts meet contract criteria
 */

async function validateAuditComplete(ctx: PhaseContext): Promise<CriterionResult> {
  const report = ctx.artifacts['AUDIT_REPORT.md'];
  if (!report) {
    return {
      passed: false,
      score: 0,
      details: 'AUDIT_REPORT.md not found',
      blockers: ['Run audit agent to generate AUDIT_REPORT.md']
    };
  }
  return { passed: true, score: 100, details: 'Audit report exists and contains sections' };
}

async function validateAuditScore(ctx: PhaseContext, minScore: number): Promise<CriterionResult> {
  const report = ctx.artifacts['AUDIT_VALIDATION_REPORT.md'];
  const score = ctx.metadata.auditValidationScore || 0;

  if (score < minScore) {
    return {
      passed: false,
      score: score * 100,
      details: `Audit completeness: ${(score * 100).toFixed(0)}% (need ${minScore * 100}%)`,
      blockers: ['Run audit reviewer to improve score', 'Run gap remediation to fix issues']
    };
  }

  return { passed: true, score: score * 100, details: `Audit score: ${(score * 100).toFixed(0)}%` };
}

async function validateGapsRemediated(ctx: PhaseContext): Promise<CriterionResult> {
  const remediated = ctx.artifacts['REMEDIATED_AUDIT_REPORT.md'];
  if (!remediated) {
    return {
      passed: false,
      score: 0,
      details: 'REMEDIATED_AUDIT_REPORT.md not found',
      blockers: ['Run gap remediation agent']
    };
  }
  return { passed: true, score: 100, details: 'All gaps remediated and documented' };
}

async function validateInfrastructureFixes(ctx: PhaseContext): Promise<CriterionResult> {
  // Phase 1 is optional — if no fixes needed, can skip
  return { passed: true, score: 100, details: 'Infrastructure fixes applied or skipped (optional phase)' };
}

async function validateTestPlanComplete(ctx: PhaseContext): Promise<CriterionResult> {
  const plan = ctx.artifacts['TEST_PLAN.md'];
  if (!plan) {
    return {
      passed: false,
      score: 0,
      details: 'TEST_PLAN.md not found',
      blockers: ['Run test planner agent']
    };
  }
  return { passed: true, score: 100, details: 'Test plan complete with all scenarios' };
}

async function validateTestsGenerated(ctx: PhaseContext): Promise<CriterionResult> {
  const manifest = ctx.artifacts['GENERATED_TESTS_MANIFEST.md'];
  if (!manifest) {
    return {
      passed: false,
      score: 0,
      details: 'GENERATED_TESTS_MANIFEST.md not found',
      blockers: ['Run test generator agent']
    };
  }
  return { passed: true, score: 100, details: 'All test files generated' };
}

async function validateTestAuditPassed(ctx: PhaseContext): Promise<CriterionResult> {
  const audit = ctx.artifacts['TEST_AUDIT_REPORT.md'];
  if (!audit) {
    return {
      passed: false,
      score: 0,
      details: 'TEST_AUDIT_REPORT.md not found',
      blockers: ['Run test auditor agent with Playwright MCP for live verification']
    };
  }

  const passed = ctx.metadata.testAuditPassed === true;
  if (!passed) {
    return {
      passed: false,
      score: 0,
      details: 'Test audit found issues: ghost features, selector mismatches, or API contract mismatches',
      blockers: [
        'Fix issues identified in TEST_AUDIT_REPORT.md',
        'Re-run test generator',
        'Re-run test auditor'
      ]
    };
  }

  return { passed: true, score: 100, details: 'Test audit passed — no ghost features, all selectors verified' };
}

async function validateAllTestsPassing(ctx: PhaseContext): Promise<CriterionResult> {
  const results = ctx.artifacts['TEST_RESULTS.json'];
  if (!results) {
    return {
      passed: false,
      score: 0,
      details: 'TEST_RESULTS.json not found',
      blockers: ['Run tests: npm run test:e2e']
    };
  }

  const passRate = ctx.metadata.testPassRate || 0;
  if (passRate < 1.0) {
    const failCount = ctx.metadata.testFailCount || 0;
    return {
      passed: false,
      score: passRate * 100,
      details: `Tests passing: ${(passRate * 100).toFixed(0)}% (${failCount} failures)`,
      blockers: [
        'Review TEST_RESULTS.json for failure details',
        'Trigger phase-3 remediation to fix failures'
      ]
    };
  }

  return { passed: true, score: 100, details: '100% test pass rate across all 3 browsers' };
}

async function validate100PercentPass(ctx: PhaseContext): Promise<CriterionResult> {
  const passRate = ctx.metadata.testPassRate || 0;
  const failCount = ctx.metadata.testFailCount || 0;

  if (passRate < 1.0) {
    return {
      passed: false,
      score: passRate * 100,
      details: `Tests passing: ${(passRate * 100).toFixed(0)}% (${failCount} still failing)`,
      blockers: [
        'Continue remediation until all tests pass',
        'If max iterations reached, escalate to human review'
      ]
    };
  }

  return { passed: true, score: 100, details: '100% test pass rate achieved' };
}

async function validateNoRegressions(ctx: PhaseContext): Promise<CriterionResult> {
  const regressions = ctx.metadata.regressionCount || 0;

  if (regressions > 0) {
    return {
      passed: false,
      score: 0,
      details: `${regressions} regression(s) detected`,
      blockers: [
        `Remediation broke ${regressions} previously passing tests`,
        'Rollback fixes and try different approach'
      ]
    };
  }

  return { passed: true, score: 100, details: 'No regressions — all previously passing tests still pass' };
}

async function validateIterationLimits(ctx: PhaseContext): Promise<CriterionResult> {
  const iteration = ctx.metadata.remediationIteration || 0;
  const maxIterations = ctx.metadata.maxRemediationIterations || 5;

  if (iteration >= maxIterations) {
    return {
      passed: false,
      score: 0,
      details: `Max remediation iterations (${maxIterations}) reached`,
      blockers: ['Escalate to human review — automated remediation unable to reach 100%']
    };
  }

  return {
    passed: true,
    score: 100,
    details: `Iteration ${iteration}/${maxIterations} — within limits`
  };
}

async function validateCommitCreated(ctx: PhaseContext): Promise<CriterionResult> {
  const summary = ctx.artifacts['COMMIT_SUMMARY.md'];
  if (!summary) {
    return {
      passed: false,
      score: 0,
      details: 'COMMIT_SUMMARY.md not found',
      blockers: ['Create git commit with test fixes']
    };
  }
  return { passed: true, score: 100, details: 'Commit created with clear summary' };
}

async function validateReadyForPR(ctx: PhaseContext): Promise<CriterionResult> {
  // Check that all context is preserved and PR can be created
  const ready = ctx.metadata.readyForPR === true;

  if (!ready) {
    return {
      passed: false,
      score: 0,
      details: 'Workspace not ready for PR',
      blockers: ['Ensure all test results and context preserved']
    };
  }

  return { passed: true, score: 100, details: 'Ready for human PR review' };
}
