/**
 * Agent Output Schema
 *
 * All agents must output structured JSON matching these schemas.
 * Harness validates against schema before processing.
 *
 * Key principle: "Machine-readable artifacts"
 * Don't parse prose. Require JSON/YAML with guaranteed structure.
 */

export interface AgentPhaseOutput {
  phase: string;
  timestamp: string; // ISO8601
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  agent: string;
  details: AgentOutputDetails;
  decision?: {
    canAdvance: boolean;
    reason: string;
  };
}

export interface AgentOutputDetails {
  summary: string;
  artifacts: ArtifactRef[];
  metrics?: Record<string, number | string>;
  errors?: ErrorDetail[];
  warnings?: string[];
  nextAction?: string;
}

export interface ArtifactRef {
  type: 'REPORT' | 'CODE' | 'DATA' | 'LOG';
  name: string;
  path: string;
  description: string;
}

export interface ErrorDetail {
  type: string;
  message: string;
  context?: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

/**
 * Phase 0: Audit Agent Output
 */
export interface AuditAgentOutput extends AgentPhaseOutput {
  phase: 'phase-0-audit';
  details: AuditOutputDetails;
}

export interface AuditOutputDetails extends AgentOutputDetails {
  auditScore: number; // 0-100
  coverage: {
    routes: number; // %
    apis: number; // %
    errorScenarios: number; // %
    edgeCases: number; // %
  };
  gaps?: {
    type: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
    area: string;
    description: string;
    suggestion: string;
  }[];
}

/**
 * Phase 0b: Audit Reviewer Output
 */
export interface AuditReviewerOutput extends AgentPhaseOutput {
  phase: 'phase-0-audit';
  details: AuditReviewDetails;
}

export interface AuditReviewDetails extends AgentOutputDetails {
  completenessScore: number; // 0-100
  criticalGaps: GapFinding[];
  importantGaps: GapFinding[];
  niceToHaveGaps: GapFinding[];
  recommendation: 'APPROVED' | 'APPROVED_WITH_NOTES' | 'REJECTED';
}

export interface GapFinding {
  area: string;
  finding: string;
  codeReference: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
}

/**
 * Phase 2: Test Planner Output
 */
export interface TestPlannerOutput extends AgentPhaseOutput {
  phase: 'phase-2-test-generation';
  details: TestPlanDetails;
}

export interface TestPlanDetails extends AgentOutputDetails {
  totalTests: number;
  testCategories: {
    happyPath: number;
    errorHandling: number;
    edgeCases: number;
  };
  testScenarios: TestScenario[];
}

export interface TestScenario {
  id: string; // e.g., "AUTH-HP-001"
  name: string;
  category: 'HP' | 'ER' | 'EC'; // Happy Path, Error Handling, Edge Case
  description: string;
  steps: string[];
  expectedResult: string;
  testData?: Record<string, any>;
  browser?: 'chromium' | 'firefox' | 'mobile-safari' | 'all';
}

/**
 * Phase 2: Test Generator Output
 */
export interface TestGeneratorOutput extends AgentPhaseOutput {
  phase: 'phase-2-test-generation';
  details: TestGeneratorDetails;
}

export interface TestGeneratorDetails extends AgentOutputDetails {
  filesCreated: number;
  linesOfCode: number;
  testCount: number;
  usesSemanticSelectors: boolean;
  hasFixtures: boolean;
  hasCleanup: boolean;
  hasTimeouts: boolean;
  testFiles: {
    path: string;
    testCount: number;
    categories: ('HP' | 'ER' | 'EC')[];
  }[];
}

/**
 * Phase 2: Test Auditor Output (uses Playwright MCP)
 */
export interface TestAuditorOutput extends AgentPhaseOutput {
  phase: 'phase-2-test-generation';
  details: TestAuditDetails;
}

export interface TestAuditDetails extends AgentOutputDetails {
  overallScore: number; // 0-100
  checks: AuditCheck[];
  ghostFeatures: GhostFeature[]; // Tests for non-existent features
  selectorIssues: SelectorIssue[]; // Selectors that don't exist
  apiMismatches: APIMismatch[]; // API endpoints or contracts that don't match
  verdict: 'PASS' | 'FAIL';
}

export interface AuditCheck {
  name: string;
  description: string;
  passed: boolean;
  details?: string;
  evidence?: string; // Screenshot, code reference, etc.
}

export interface GhostFeature {
  testFile: string;
  testName: string;
  issue: string; // e.g., "Tests POST /api/register but endpoint doesn't exist"
  severity: 'CRITICAL' | 'WARNING';
}

export interface SelectorIssue {
  testFile: string;
  testName: string;
  selector: string;
  issue: string; // e.g., "getByRole('button', {name: 'Login'}) not found on page"
  suggestion: string;
}

export interface APIMismatch {
  testFile: string;
  endpoint: string;
  expectedSchema: Record<string, any>;
  actualSchema: Record<string, any>;
  issue: string;
}

/**
 * Phase 2: Test Results
 */
export interface TestResultsSummary {
  timestamp: string; // ISO8601
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number; // 0-1
  duration: number; // milliseconds
  browsers: BrowserResults;
  failedTests: FailedTest[];
}

export interface BrowserResults {
  chromium: { passed: number; failed: number; skipped: number };
  firefox: { passed: number; failed: number; skipped: number };
  'mobile-safari': { passed: number; failed: number; skipped: number };
}

export interface FailedTest {
  name: string;
  file: string;
  browser: string;
  error: string;
  trace?: string;
  screenshot?: string;
}

/**
 * Phase 3: Remediation Agent Output
 */
export interface RemediationOutput extends AgentPhaseOutput {
  phase: 'phase-3-remediation';
  details: RemediationDetails;
}

export interface RemediationDetails extends AgentOutputDetails {
  iteration: number;
  passRateBefore: number; // 0-1
  passRateAfter: number; // 0-1
  fixesApplied: {
    category: string; // SELECTOR_MISMATCH, API_CONTRACT, etc.
    count: number;
    fixes: {
      testName: string;
      category: string;
      fixApplied: string;
      verified: boolean;
    }[];
  };
  regressions: {
    count: number;
    tests: string[];
  };
  recommendation: 'CONTINUE_REMEDIATION' | 'READY_TO_COMMIT' | 'ESCALATE_TO_HUMAN';
}

/**
 * Phase 4: Finalization Output
 */
export interface FinalizationOutput extends AgentPhaseOutput {
  phase: 'phase-4-finalize';
  details: FinalizationDetails;
}

export interface FinalizationDetails extends AgentOutputDetails {
  commitHash?: string;
  commitMessage: string;
  filesModified: number;
  testFilesAdded: number;
  readyForPR: boolean;
  prDescription?: string;
}

/**
 * Escalation Output (when phase fails)
 */
export interface EscalationReport {
  timestamp: string;
  phase: string;
  reason: string; // Why escalation triggered
  context: {
    phase: string;
    passRate?: number;
    failCount?: number;
    iteration?: number;
    maxIterations?: number;
  };
  artifacts: {
    testResults?: string; // Path to test results
    errorLog?: string; // Path to error logs
    screenshots?: string[]; // Paths to failure screenshots
  };
  recommendation: string;
  humanAction: 'REVIEW' | 'FIX' | 'RETRY' | 'ABORT';
}

/**
 * Schema validation
 */
export function validateOutputSchema(phase: string, output: any): ValidationResult {
  const errors: string[] = [];

  // Common fields
  if (!output.phase || !output.timestamp || !output.status || !output.agent) {
    errors.push('Missing required fields: phase, timestamp, status, agent');
  }

  if (!['PASS', 'FAIL', 'PARTIAL'].includes(output.status)) {
    errors.push(`Invalid status: ${output.status}. Must be PASS, FAIL, or PARTIAL.`);
  }

  // Phase-specific validation
  switch (phase) {
    case 'phase-0-audit':
      if (typeof output.details?.auditScore !== 'number' || output.details.auditScore < 0 || output.details.auditScore > 100) {
        errors.push('Invalid auditScore: must be 0-100');
      }
      if (!output.details?.coverage) {
        errors.push('Missing coverage metrics');
      }
      break;

    case 'phase-2-test-generation':
      if (typeof output.details?.totalTests !== 'number' || output.details.totalTests < 1) {
        errors.push('Invalid totalTests: must be >= 1');
      }
      if (!Array.isArray(output.details?.testScenarios)) {
        errors.push('Invalid testScenarios: must be array');
      }
      break;

    case 'phase-3-remediation':
      if (typeof output.details?.iteration !== 'number') {
        errors.push('Invalid iteration: must be number');
      }
      if (typeof output.details?.passRateAfter !== 'number' || output.details.passRateAfter < 0 || output.details.passRateAfter > 1) {
        errors.push('Invalid passRateAfter: must be 0-1');
      }
      break;

    case 'phase-4-finalize':
      if (typeof output.details?.readyForPR !== 'boolean') {
        errors.push('Invalid readyForPR: must be boolean');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
