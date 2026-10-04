/**
 * E2E Loop Phase Gates
 *
 * Deterministic acceptance criteria for each phase.
 * Phases only advance when ALL CRITICAL criteria are met.
 *
 * Philosophy: "100% acceptance only"
 * - Phase gates are objective, not subjective
 * - Test pass rate must be 100% before advancing from Phase 2
 * - No "looks good enough" — only "gate passed"
 * - Escalate to human if max iterations exceeded
 */

export interface PhaseContract {
  phase: number;
  name: string;
  acceptance: {
    criteria: AcceptanceCriterion[];
  };
  nextPhase?: number;
  loopBackPhase?: number;
  maxIterations?: number;
}

export interface AcceptanceCriterion {
  name: string;
  description: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
  validator: (context: PhaseContext) => boolean;
}

export interface PhaseContext {
  phase: number;
  testResults?: TestResults;
  remediationIterations?: number;
  artifacts?: string[];
  metadata?: Record<string, any>;
}

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  failedTests: FailedTest[];
}

export interface FailedTest {
  name: string;
  browser: string;
  error: string;
  errorType?: string;
}

export interface PhaseAdvancementDecision {
  canAdvance: boolean;
  passRate: number;
  blockers: string[];
  recommendation: 'ADVANCE' | 'LOOP_BACK' | 'ESCALATE';
  details: string;
}

// ============================================================================
// Phase Contracts
// ============================================================================

export const phaseContracts: Record<number, PhaseContract> = {
  // Phase -1: Audit Preparation
  [-1]: {
    phase: -1,
    name: 'Audit Preparation',
    acceptance: {
      criteria: [
        {
          name: 'Audit Completeness',
          description: 'Audit covers routes, APIs, state, errors, edge cases',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.auditCompleteness >= 0.95
        },
        {
          name: 'Validation Passed',
          description: 'Audit validation score >= 95%',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.validationScore >= 95
        },
        {
          name: 'Gaps Remediated',
          description: 'All identified gaps have been fixed',
          severity: 'IMPORTANT',
          validator: (ctx) => ctx.metadata?.gapsFixed === true
        }
      ]
    },
    nextPhase: 0
  },

  // Phase 0: Infrastructure
  [0]: {
    phase: 0,
    name: 'Infrastructure Fix',
    acceptance: {
      criteria: [
        {
          name: 'Infrastructure Verified',
          description: 'All infrastructure changes verified (health checks, env vars, migrations)',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.infrastructureVerified === true
        },
        {
          name: 'Docker Rebuild Success',
          description: 'Docker environment rebuilt and running',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.dockerHealthy === true
        }
      ]
    },
    nextPhase: 1
  },

  // Phase 1: Test Generation & Verification
  [1]: {
    phase: 1,
    name: 'Test Generation & Verification',
    acceptance: {
      criteria: [
        {
          name: 'Test Plan Created',
          description: 'Comprehensive test plan with HP, ER, EC categories',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.testPlanCreated === true
        },
        {
          name: 'Tests Generated',
          description: 'Playwright test files generated from plan',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.testsGenerated === true
        },
        {
          name: 'Test Audit Passed',
          description: 'All selectors, APIs, and test data verified against actual code',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.testAuditPassed === true
        },
        {
          name: 'Initial Test Run Complete',
          description: 'Tests executed and results captured',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.testResults !== undefined
        }
      ]
    },
    nextPhase: 2,
    loopBackPhase: 2
  },

  // Phase 2: Remediation Loop
  [2]: {
    phase: 2,
    name: 'Remediation Loop',
    acceptance: {
      criteria: [
        {
          name: '100% Pass Rate',
          description: 'ALL tests passing (0 failures, 0 skipped)',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.testResults?.passRate === 1.0 && ctx.testResults?.failed === 0
        },
        {
          name: 'Max Iterations Not Exceeded',
          description: 'Remediation iterations <= 5',
          severity: 'CRITICAL',
          validator: (ctx) => (ctx.remediationIterations ?? 0) <= 5
        },
        {
          name: 'All Browsers Passing',
          description: 'Tests pass on chromium, firefox, and mobile-chrome',
          severity: 'IMPORTANT',
          validator: (ctx) => ctx.metadata?.allBrowsersPass === true
        }
      ]
    },
    nextPhase: 3,
    loopBackPhase: 2,
    maxIterations: 5
  },

  // Phase 3: Finalize
  [3]: {
    phase: 3,
    name: 'Finalize & Consolidate',
    acceptance: {
      criteria: [
        {
          name: 'Phase 2 Gate Passed',
          description: 'Tests are 100% passing (prerequisite from Phase 2)',
          severity: 'CRITICAL',
          validator: (ctx) => ctx.metadata?.phase2Passed === true
        },
        {
          name: 'Consolidation Complete',
          description: 'Execution metrics captured and learning stored',
          severity: 'IMPORTANT',
          validator: (ctx) => ctx.metadata?.consolidationComplete === true
        }
      ]
    }
  }
};

// ============================================================================
// Gate Validation Logic
// ============================================================================

/**
 * Determine if a phase can advance to the next phase.
 * Only advances if ALL CRITICAL criteria are met.
 */
export async function canAdvancePhase(
  phase: number,
  context: PhaseContext
): Promise<PhaseAdvancementDecision> {
  const contract = phaseContracts[phase];

  if (!contract) {
    return {
      canAdvance: false,
      passRate: 0,
      blockers: [`Phase ${phase} contract not defined`],
      recommendation: 'ESCALATE',
      details: `Unknown phase: ${phase}`
    };
  }

  const blockers: string[] = [];
  let criticalFailures = 0;
  let totalCritical = 0;

  // Evaluate all criteria
  for (const criterion of contract.acceptance.criteria) {
    if (criterion.severity === 'CRITICAL') {
      totalCritical++;
      const passes = criterion.validator(context);

      if (!passes) {
        criticalFailures++;
        blockers.push(`[CRITICAL] ${criterion.name}: ${criterion.description}`);
      }
    } else {
      // IMPORTANT and NICE_TO_HAVE are advisory only
      const passes = criterion.validator(context);
      if (!passes && criterion.severity === 'IMPORTANT') {
        blockers.push(`[IMPORTANT] ${criterion.name}: ${criterion.description}`);
      }
    }
  }

  const passRate = totalCritical > 0 ? ((totalCritical - criticalFailures) / totalCritical) * 100 : 100;
  const canAdvance = criticalFailures === 0;

  let recommendation: 'ADVANCE' | 'LOOP_BACK' | 'ESCALATE' = 'ADVANCE';
  let details = `Phase ${phase} gate: PASSED`;

  if (!canAdvance) {
    // Decide: loop back or escalate?
    if (phase === 2 && context.remediationIterations !== undefined && context.remediationIterations < 5) {
      // Phase 2: Loop back for more remediation
      recommendation = 'LOOP_BACK';
      details = `Phase 2 gate: FAILED (${context.remediationIterations}/5 iterations). Loop back to remediation.`;
    } else if (phase === 2 && context.remediationIterations === 5) {
      // Phase 2: Max iterations reached
      recommendation = 'ESCALATE';
      details = `Phase 2 gate: FAILED after 5 remediation iterations. Escalate to human review.`;
    } else {
      // Other phases: escalate
      recommendation = 'ESCALATE';
      details = `Phase ${phase} gate: FAILED. Escalate for manual investigation.`;
    }
  }

  return {
    canAdvance,
    passRate,
    blockers,
    recommendation,
    details
  };
}

// ============================================================================
// Test Pass Rate Validator (Special Case for Phase 2)
// ============================================================================

/**
 * Validate test results for Phase 2 (Remediation).
 * CRITICAL: Tests MUST be 100% passing to advance to Phase 3.
 *
 * This is the main gate that prevents advancing with broken tests.
 */
export function validateTestPassRate(results: TestResults): {
  passes: boolean;
  passRate: string;
  failed: number;
  issues: string[];
} {
  const issues: string[] = [];

  // Check pass rate
  if (results.passRate < 1.0) {
    issues.push(`Pass rate: ${(results.passRate * 100).toFixed(1)}% (need 100%)`);
    issues.push(`Failed tests: ${results.failed}`);
  }

  // Check for skipped tests (also block advancement)
  if (results.skipped > 0) {
    issues.push(`Skipped tests: ${results.skipped} (all tests must run)`);
  }

  const passes = results.passRate === 1.0 && results.skipped === 0;

  return {
    passes,
    passRate: `${(results.passRate * 100).toFixed(1)}%`,
    failed: results.failed,
    issues
  };
}

// ============================================================================
// Remediation Iteration Logic
// ============================================================================

/**
 * Determine if remediation should loop back or escalate.
 */
export function getRemediationDecision(
  iteration: number,
  testResults: TestResults,
  maxIterations: number = 5
): {
  action: 'CONTINUE' | 'ESCALATE' | 'SUCCESS';
  reason: string;
} {
  const passRateValid = validateTestPassRate(testResults);

  if (passRateValid.passes) {
    return {
      action: 'SUCCESS',
      reason: '100% pass rate achieved'
    };
  }

  if (iteration >= maxIterations) {
    return {
      action: 'ESCALATE',
      reason: `Max iterations (${maxIterations}) reached. Pass rate: ${passRateValid.passRate}. Escalate to human review.`
    };
  }

  return {
    action: 'CONTINUE',
    reason: `Iteration ${iteration}/${maxIterations}. Pass rate: ${passRateValid.passRate}. Continue remediation.`
  };
}

// ============================================================================
// Summary & Reporting
// ============================================================================

export function generateGateSummary(phase: number, decision: PhaseAdvancementDecision): string {
  const phaseContract = phaseContracts[phase];
  const phaseName = phaseContract?.name || `Phase ${phase}`;

  let summary = `
╔════════════════════════════════════════════════╗
║ PHASE ${phase} GATE DECISION: ${phaseName}
╚════════════════════════════════════════════════╝

Recommendation: ${decision.recommendation}
Pass Rate: ${decision.passRate.toFixed(1)}%
Details: ${decision.details}
`;

  if (decision.blockers.length > 0) {
    summary += `\nBlockers:\n`;
    decision.blockers.forEach((blocker) => {
      summary += `  • ${blocker}\n`;
    });
  }

  return summary;
}
