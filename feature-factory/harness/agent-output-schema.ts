/**
 * Feature Factory Agent Output Schemas
 *
 * All agents must output structured JSON matching stage-specific schemas.
 * Harness validates output before processing.
 *
 * Adapted from: e2e-loop/harness/agent-output-schema.ts
 * Specialized for: Feature Factory stages 1-5
 */

export interface ArtifactRef {
  name: string;
  path: string;
  description: string;
  created?: boolean;
  modified?: boolean;
}

// ============================================================================
// BASE SCHEMA (All agents)
// ============================================================================

export interface FeatureFactoryAgentOutput {
  stage: 1 | 2 | 3 | 4 | 5;
  agent: string; // "01-researcher", "04-backend-builder", etc.
  timestamp: string; // ISO8601
  status: 'PASS' | 'FAIL' | 'LOOP_BACK' | 'ESCALATE';

  details: {
    summary: string;
    artifacts: ArtifactRef[];
    metrics?: Record<string, any>;
    errors?: ErrorDetail[];
  };

  loopBack?: {
    count: number;
    maxAttempts: number;
    reason: string;
  };
}

export interface ErrorDetail {
  type: string;
  message: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
  suggestedFix?: string;
}

// ============================================================================
// STAGE 1: RESEARCHER OUTPUT
// ============================================================================

export interface ResearcherOutput extends FeatureFactoryAgentOutput {
  stage: 1;
  agent: '01-researcher';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    architecture: {
      layers: string[];
      description: string;
    };

    filesIdentified: Array<{
      path: string;
      role: 'controller' | 'service' | 'component' | 'hook' | 'util' | 'config' | 'other';
      reason: string;
      priority: 'MUST_MODIFY' | 'LIKELY' | 'OPTIONAL';
    }>;

    existingPatterns: Array<{
      name: string;
      description: string;
      locations: string[];
      confidence: number; // 0-1
      recommendation: 'REUSE' | 'ADAPT' | 'AVOID';
    }>;

    risks: Array<{
      type: 'TECHNICAL' | 'SCOPE' | 'CONSTRAINT' | 'UNKNOWN';
      severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
      description: string;
      mitigation?: string;
    }>;

    timeEstimate: {
      discover: number; // minutes
      plan: number;
      execute: number;
      verify: number;
      deliver: number;
      total: number;
      confidence: number; // 0-1
    };

    priorPatterns?: {
      featureName: string;
      timeActual: number;
      timeEstimated: number;
      patterns: string[];
      issuesEncountered: string[];
    }[];
  };
}

// ============================================================================
// STAGE 2: STORY WRITER OUTPUT
// ============================================================================

export interface StoryWriterOutput extends FeatureFactoryAgentOutput {
  stage: 2;
  agent: '02-story-writer';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    userStory: {
      persona: string; // "As a..."
      goal: string; // "I want to..."
      benefit: string; // "so that..."
    };

    acceptanceCriteria: Array<{
      id: string; // AC-001, AC-002, etc.
      given: string; // "Given..."
      when: string; // "When..."
      then: string; // "Then..."
      priority: 'MUST' | 'SHOULD' | 'COULD';
      testable: boolean;
      notes?: string;
    }>;

    edgeCases: Array<{
      case: string;
      inScope: boolean;
      reason: string;
    }>;

    assumptions: string[];
    outOfScope: string[];
  };
}

// ============================================================================
// STAGE 2: SPEC WRITER OUTPUT
// ============================================================================

export interface SpecWriterOutput extends FeatureFactoryAgentOutput {
  stage: 2;
  agent: '03-spec-writer';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    dataModel: {
      tables: Array<{
        name: string;
        description: string;
        columns: Array<{
          name: string;
          type: string;
          required: boolean;
          description?: string;
        }>;
        indexes?: string[];
        constraints?: string[];
      }>;
      migrations?: string[];
    };

    apiContract: {
      endpoints: Array<{
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        path: string;
        description: string;
        auth: 'NONE' | 'JWT' | 'API_KEY';
        requestBody?: Record<string, any>;
        responseBody?: Record<string, any>;
        statusCodes: number[];
      }>;
      errorHandling: string;
    };

    uiComponents: Array<{
      name: string;
      description: string;
      props?: Array<{
        name: string;
        type: string;
        required: boolean;
        description?: string;
      }>;
      states?: string[];
    }>;

    fileList: Array<{
      path: string;
      type: 'CREATE' | 'MODIFY' | 'DELETE';
      reason: string;
      complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
    }>;

    testStrategy: {
      unitTests: string[];
      integrationTests: string[];
      e2eTests: string[];
    };
  };
}

// ============================================================================
// STAGE 3: BACKEND BUILDER OUTPUT
// ============================================================================

export interface BackendBuilderOutput extends FeatureFactoryAgentOutput {
  stage: 3;
  agent: '04-backend-builder';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    filesModified: Array<{
      path: string;
      type: 'CREATE' | 'MODIFY' | 'DELETE';
      description: string;
      linesAdded: number;
      linesRemoved: number;
    }>;

    implementation: {
      services: Array<{
        name: string;
        methods: string[];
        description: string;
      }>;
      routes: Array<{
        method: string;
        path: string;
        handler: string;
        description: string;
      }>;
      migrations: Array<{
        name: string;
        description: string;
      }>;
    };

    testing: {
      testsWritten: number;
      testsPassed: number;
      testsFailed: number;
      coverage?: number; // percentage
      failingTests?: Array<{
        name: string;
        error: string;
        attempt?: number;
      }>;
    };

    patterns: {
      reused: string[]; // "BaseService", "AuthGuard", etc.
      created: string[]; // New patterns this feature introduced
      violations?: string[]; // Pattern violations or anti-patterns
    };

    loopBack?: {
      count: number;
      attempts: Array<{
        number: number;
        error: string;
        fix: string;
        result: 'PASS' | 'FAIL';
      }>;
    };

    metrics?: {
      totalTime: number; // minutes
      linesOfCode: number;
      complexity: 'LOW' | 'MEDIUM' | 'HIGH';
    };
  };
}

// ============================================================================
// STAGE 3: FRONTEND BUILDER OUTPUT
// ============================================================================

export interface FrontendBuilderOutput extends FeatureFactoryAgentOutput {
  stage: 3;
  agent: '05-frontend-builder';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    filesModified: Array<{
      path: string;
      type: 'CREATE' | 'MODIFY' | 'DELETE';
      description: string;
      linesAdded: number;
      linesRemoved: number;
    }>;

    implementation: {
      components: Array<{
        name: string;
        description: string;
        props?: string[];
        state?: string[];
      }>;
      pages: Array<{
        route: string;
        description: string;
        components: string[];
      }>;
      hooks: Array<{
        name: string;
        description: string;
      }>;
    };

    testing: {
      testsWritten: number;
      testsPassed: number;
      testsFailed: number;
      coverage?: number; // percentage
      failingTests?: Array<{
        name: string;
        error: string;
        attempt?: number;
      }>;
    };

    patterns: {
      reused: string[]; // Component patterns, hooks, etc.
      created: string[];
      violations?: string[];
    };

    loopBack?: {
      count: number;
      attempts: Array<{
        number: number;
        error: string;
        fix: string;
        result: 'PASS' | 'FAIL';
      }>;
    };

    metrics?: {
      totalTime: number; // minutes
      linesOfCode: number;
      complexity: 'LOW' | 'MEDIUM' | 'HIGH';
      accessibility?: number; // WCAG score
    };

    apiIntegration?: {
      endpointsUsed: string[];
      status: 'INTEGRATED' | 'MOCKED' | 'PENDING';
      issues?: string[];
    };
  };
}

// ============================================================================
// STAGE 4: TEST VERIFIER OUTPUT
// ============================================================================

export interface TestVerifierOutput extends FeatureFactoryAgentOutput {
  stage: 4;
  agent: '06-test-verifier';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    acceptanceTests: {
      totalAC: number;
      tested: number;
      notCoverable: number;
      testing: number;
      results: Array<{
        acId: string;
        description: string;
        status: 'TESTED' | 'NOT_COVERABLE' | 'TESTING';
        notes?: string;
      }>;
    };

    testExecution: {
      totalTests: number;
      passed: number;
      failed: number;
      skipped: number;
      coverage?: {
        statement: number;
        branch: number;
        function: number;
        line: number;
      };
      failingTests?: Array<{
        name: string;
        error: string;
      }>;
    };

    issues: Array<{
      acId: string;
      severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
      issue: string;
      suggestion: string;
    }>;

    loopBack?: {
      count: number;
      attempts: Array<{
        number: number;
        change: string;
        result: 'PASS' | 'FAIL';
      }>;
    };
  };
}

// ============================================================================
// STAGE 4: VALIDATOR OUTPUT
// ============================================================================

export interface ValidatorOutput extends FeatureFactoryAgentOutput {
  stage: 4;
  agent: '07-validator';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    storyCompliance: {
      allFilesMentioned: boolean;
      allACTested: boolean;
      storyMatchesImplementation: boolean;
      issues?: string[];
    };

    briefCompliance: {
      apiImplementedCorrectly: boolean;
      dataModelCorrect: boolean;
      uiComponentsCorrect: boolean;
      issues?: string[];
    };

    codeQuality: {
      followsPatterns: boolean;
      noMagicNumbers: boolean;
      noDuplicateLogic: boolean;
      properErrorHandling: boolean;
      issues?: string[];
    };

    security: {
      authImplemented: boolean;
      inputValidated: boolean;
      noHardcodedSecrets: boolean;
      sqlInjectionProtected: boolean;
      xssProtected: boolean;
      issues?: string[];
    };

    issues: Array<{
      severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
      file?: string;
      line?: number;
      message: string;
      suggestion: string;
      canFix: boolean;
    }>;

    regressions?: {
      count: number;
      tests: string[];
    };
  };
}

// ============================================================================
// STAGE 5: FEATURE CONSOLIDATOR OUTPUT
// ============================================================================

export interface FeatureConsolidatorOutput extends FeatureFactoryAgentOutput {
  stage: 5;
  agent: '08-feature-consolidator';

  details: {
    summary: string;
    artifacts: ArtifactRef[];

    executionMetrics: {
      featureName: string;
      startDate: string;
      endDate: string;
      totalTime: number; // minutes
      timePerStage: {
        discover: number;
        plan: number;
        execute: number;
        verify: number;
        deliver: number;
      };
      loopCount: number;
      escalationCount: number;
    };

    patterns: {
      reusedPatterns: Array<{
        name: string;
        usedIn: string[];
        effectiveness: 'HIGH' | 'MEDIUM' | 'LOW';
      }>;
      newPatterns: Array<{
        name: string;
        description: string;
        applicability: string;
        nextUse?: string;
      }>;
      patternIssues: Array<{
        pattern: string;
        issue: string;
        howToFix: string;
      }>;
    };

    learnings: {
      whatWorked: string[];
      whatDidntWork: string[];
      surprises: string[];
      nextTime: string[];
    };

    estimates: {
      stageEstimates: Record<string, number>;
      confidence: number;
      actualVsEstimated: Record<string, number>;
      adjustedEstimate?: number;
    };

    recommendations: {
      forSimilarFeatures: string[];
      architectureImprovements: string[];
      processImprovements: string[];
    };
  };
}

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

export function validateOutputSchema(
  stage: number,
  agent: string,
  output: any
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check base schema
  if (!output.stage || output.stage !== stage) {
    errors.push(`stage mismatch: expected ${stage}, got ${output.stage}`);
  }
  if (!output.agent || output.agent !== agent) {
    errors.push(`agent mismatch: expected ${agent}, got ${output.agent}`);
  }
  if (!output.timestamp || typeof output.timestamp !== 'string') {
    errors.push('timestamp missing or not ISO8601 string');
  }
  if (!['PASS', 'FAIL', 'LOOP_BACK', 'ESCALATE'].includes(output.status)) {
    errors.push(`invalid status: ${output.status}`);
  }
  if (!output.details || typeof output.details !== 'object') {
    errors.push('details missing or not object');
  }
  if (!output.details.summary || typeof output.details.summary !== 'string') {
    errors.push('details.summary missing or not string');
  }
  if (!Array.isArray(output.details.artifacts)) {
    errors.push('details.artifacts must be array');
  }

  // Validate stage-specific schema
  switch (stage) {
    case 1:
      // Researcher must have architecture, filesIdentified, patterns
      if (!output.details.architecture) {
        errors.push('Researcher missing architecture');
      }
      if (!Array.isArray(output.details.filesIdentified) || output.details.filesIdentified.length === 0) {
        errors.push('Researcher must identify 3+ files');
      }
      if (!Array.isArray(output.details.existingPatterns) || output.details.existingPatterns.length === 0) {
        errors.push('Researcher must find existing patterns');
      }
      break;

    case 2:
      // Story Writer must have userStory and acceptanceCriteria
      if (!output.details.userStory) {
        errors.push('Story Writer missing userStory');
      }
      if (!Array.isArray(output.details.acceptanceCriteria) || output.details.acceptanceCriteria.length < 3) {
        errors.push('Story Writer must have 3+ acceptance criteria');
      }
      break;

    case 3:
      // Builders must have filesModified and testing results
      if (!Array.isArray(output.details.filesModified) || output.details.filesModified.length === 0) {
        errors.push('Builder must modify at least one file');
      }
      if (!output.details.testing) {
        errors.push('Builder missing testing results');
      }
      if (output.details.testing.testsFailed && output.details.testing.testsFailed > 0) {
        errors.push(`Builder has failing tests: ${output.details.testing.testsFailed}`);
      }
      break;

    case 4:
      // Validator must have acceptanceTests and issues
      if (!output.details.acceptanceTests) {
        errors.push('Validator missing acceptanceTests results');
      }
      if (!output.details.codeQuality) {
        errors.push('Validator missing codeQuality assessment');
      }
      break;

    case 5:
      // Consolidator must have metrics and patterns
      if (!output.details.executionMetrics) {
        errors.push('Consolidator missing executionMetrics');
      }
      if (!output.details.patterns) {
        errors.push('Consolidator missing patterns consolidation');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate a validation error message
 */
export function getValidationErrorMessage(stage: number, agent: string, validationErrors: string[]): string {
  return `
## Output Schema Validation Failed

**Stage:** ${stage}
**Agent:** ${agent}

**Errors:**
${validationErrors.map(e => `- ${e}`).join('\n')}

**Action:** Agent must re-run and produce JSON matching the schema for Stage ${stage}.

See \`agent-output-schema.ts\` for the exact schema definition.
`;
}
