/**
 * Shared agent-output fixtures (AC-2).
 *
 * Every orchestrator and CLI test builds its agent outputs from here, so a schema change is
 * made once rather than in five copy-pasted fixtures that drift apart. Each function returns a
 * FRESH object: the orchestrator rewrites artifact paths in place when it persists documents,
 * so a shared instance would leak one run's paths into the next.
 *
 * Defaults are a run that passes every gate. Options exist only to make one thing fail.
 *
 * This directory is not matched by jest's testMatch; nothing in it may end in `.test.ts`.
 */

import {
  BackendBuilderOutput,
  FeatureConsolidatorOutput,
  FeatureFactoryAgentOutput,
  FrontendBuilderOutput,
  ResearcherOutput,
  SecurityCheckName,
  SecuritySurfaceDeclaration,
  SkepticOutput,
  SkepticVerdict,
  SpecWriterOutput,
  StoryWriterOutput,
  TestVerifierOutput,
  ValidatorFollowupOutput,
  ValidatorOutput
} from '../../harness/agent-output-schema';
import { FeatureSpec } from '../../contracts/feature-spec';
import type { AgentInvocation } from '../../runner/invoke-agent';

const now = () => new Date().toISOString();

/** A researcher output that clears the Stage 1 gate, with its report content attached. */
export function researcher(): ResearcherOutput {
  return {
    stage: 1,
    agent: '01-researcher',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: 'Mapped the codebase.',
      artifacts: [
        {
          name: 'RESEARCHER_REPORT.md',
          path: 'RESEARCHER_REPORT.md',
          description: 'Report',
          content: '# Researcher Report\n\nMapped the auth module.'
        }
      ],
      architecture: { layers: ['routes', 'services'], description: 'Layered' },
      filesIdentified: [
        { path: 'src/a.ts', role: 'service', reason: 'core', priority: 'MUST_MODIFY' },
        { path: 'src/b.ts', role: 'controller', reason: 'entry', priority: 'LIKELY' },
        { path: 'src/c.ts', role: 'util', reason: 'helper', priority: 'OPTIONAL' }
      ],
      existingPatterns: [
        { name: 'BaseService', description: 'base', locations: ['src/a.ts'], confidence: 0.9, recommendation: 'REUSE' }
      ],
      risks: [{ type: 'TECHNICAL', severity: 'IMPORTANT', description: 'Timezones' }],
      timeEstimate: { discover: 2, plan: 3, execute: 8, verify: 5, deliver: 2, total: 20, confidence: 0.7 }
    }
  };
}

/**
 * A story with `acCount` acceptance criteria. The structured list and the USER_STORY.md prose
 * agree: one Given/When/Then block per criterion.
 */
export function story({ acCount = 3 }: { acCount?: number } = {}): StoryWriterOutput {
  const ids = Array.from({ length: acCount }, (_, i) => `AC-${i + 1}`);

  return {
    stage: 2,
    agent: '02-story-writer',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: 'User can enable 2FA.',
      artifacts: [
        {
          name: 'USER_STORY.md',
          path: 'USER_STORY.md',
          description: 'Story',
          content: [
            '# User Story',
            'As a user I want to enable 2FA so that my account is secure.',
            ...ids.flatMap(id => [
              '',
              `## ${id}`,
              `Given the precondition for ${id}`,
              `When the user acts for ${id}`,
              `Then the outcome for ${id} is observable`
            ])
          ].join('\n')
        }
      ],
      userStory: { persona: 'user', goal: 'enable 2FA', benefit: 'security' },
      acceptanceCriteria: ids.map(id => ({
        id,
        given: 'a',
        when: 'b',
        then: 'c',
        priority: 'MUST' as const,
        testable: true
      })),
      edgeCases: [],
      assumptions: [],
      outOfScope: []
    }
  };
}

/** A brief that declares every security surface present: no security check may be "not_applicable". */
export const ALL_SURFACES_PRESENT: Readonly<SecuritySurfaceDeclaration> = Object.freeze({
  auth: 'PRESENT',
  userInput: 'PRESENT',
  secrets: 'PRESENT',
  sqlDatabase: 'PRESENT',
  htmlRendering: 'PRESENT'
});

/**
 * A technical brief. `files` become the FILE_LIST (all CREATE). `ui: true` adds a UI component,
 * which is what makes the orchestrator run the Frontend Builder; the default is backend-only.
 * `securitySurface` defaults to every surface PRESENT, the fail-closed declaration.
 */
export function spec({
  files = ['src/a.ts'],
  ui = false,
  securitySurface = ALL_SURFACES_PRESENT
}: { files?: string[]; ui?: boolean; securitySurface?: SecuritySurfaceDeclaration } = {}): SpecWriterOutput {
  return {
    stage: 2,
    agent: '03-spec-writer',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: 'Technical brief.',
      artifacts: [
        { name: 'TECHNICAL_BRIEF.md', path: 'TECHNICAL_BRIEF.md', description: 'Brief', content: '# Technical Brief\n\nTOTP via speakeasy.' },
        {
          name: 'FILE_LIST.md',
          path: 'FILE_LIST.md',
          description: 'Files',
          content: ['# Files', '', ...files.map(f => `- ${f} (CREATE)`)].join('\n')
        }
      ],
      dataModel: { tables: [] },
      apiContract: { endpoints: [], errorHandling: 'RFC7807' },
      uiComponents: ui ? [{ name: 'TwoFactorForm', description: 'Enable 2FA form' }] : [],
      fileList: files.map(path => ({ path, type: 'CREATE' as const, reason: 'core', complexity: 'SIMPLE' as const })),
      testStrategy: { unitTests: [], integrationTests: [], e2eTests: [] },
      securitySurface: { ...securitySurface }
    }
  };
}

const TESTS_WRITTEN = 4;

function filesModified(files: string[], who: string) {
  return files.map(path => ({
    path,
    type: 'CREATE' as const,
    description: `${who} wrote ${path}`,
    linesAdded: 10,
    linesRemoved: 0
  }));
}

function builderTesting(testsFailed: number, failingError?: string) {
  const testsWritten = Math.max(TESTS_WRITTEN, testsFailed);
  return {
    testsWritten,
    testsPassed: testsWritten - testsFailed,
    testsFailed,
    failingTests:
      testsFailed > 0 && failingError !== undefined ? [{ name: 'enables 2FA', error: failingError }] : []
  };
}

/**
 * A backend build. `testsFailed > 0` makes it a failing attempt; `failingError` names the
 * failing test's error (omit it for a failure that names no test).
 */
export function backend({
  files = ['src/a.ts'],
  testsFailed = 0,
  failingError
}: { files?: string[]; testsFailed?: number; failingError?: string } = {}): BackendBuilderOutput {
  return {
    stage: 3,
    agent: '04-backend-builder',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: testsFailed > 0 ? 'Implemented, tests failing.' : 'Implemented.',
      artifacts: [],
      filesModified: filesModified(files, 'Backend Builder'),
      implementation: {
        services: [{ name: 'TotpService', methods: ['enable'], description: 'TOTP' }],
        routes: [{ method: 'POST', path: '/2fa', handler: 'enable', description: 'Enable 2FA' }],
        migrations: []
      },
      testing: builderTesting(testsFailed, failingError),
      patterns: { reused: ['BaseService'], created: [] }
    }
  };
}

/** A frontend build. Defaults to a single component file. */
export function frontend({
  files = ['src/components/TwoFactorForm.tsx']
}: { files?: string[] } = {}): FrontendBuilderOutput {
  return {
    stage: 3,
    agent: '05-frontend-builder',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: 'Built the UI.',
      artifacts: [],
      filesModified: filesModified(files, 'Frontend Builder'),
      implementation: {
        components: [{ name: 'TwoFactorForm', description: 'Enable 2FA form' }],
        pages: [],
        hooks: []
      },
      testing: builderTesting(0),
      patterns: { reused: [], created: [] }
    }
  };
}

/** A Test Verifier report. Defaults: 3 of 3 criteria tested, every test green, no issues. */
export function testVerifier({
  totalAC = 3,
  tested = totalAC,
  notCoverable = 0,
  failed = 0,
  status = 'PASS',
  criticalIssue = false
}: {
  totalAC?: number;
  tested?: number;
  notCoverable?: number;
  failed?: number;
  status?: TestVerifierOutput['status'];
  criticalIssue?: boolean;
} = {}): TestVerifierOutput {
  const totalTests = 10;
  const results: TestVerifierOutput['details']['acceptanceTests']['results'] = Array.from(
    { length: totalAC },
    (_, i) => ({
      acId: `AC-${i + 1}`,
      description: `Criterion ${i + 1}`,
      status: i < tested ? 'TESTED' : i < tested + notCoverable ? 'NOT_COVERABLE' : 'TESTING'
    })
  );

  return {
    stage: 4,
    agent: '06-test-verifier',
    timestamp: now(),
    status,
    details: {
      summary: 'Acceptance tests written and run.',
      artifacts: [],
      acceptanceTests: {
        totalAC,
        tested,
        notCoverable,
        testing: Math.max(0, totalAC - tested - notCoverable),
        results
      },
      testExecution: { totalTests, passed: totalTests - failed, failed, skipped: 0 },
      issues: criticalIssue
        ? [{ acId: 'AC-1', severity: 'CRITICAL', issue: 'AC-1 is not actually exercised', suggestion: 'Assert the outcome' }]
        : []
    }
  };
}

type ValidatorSecurity = ValidatorOutput['details']['security'];
type ValidatorIssueFixture = ValidatorOutput['details']['issues'][number];

/**
 * A Validator report. Defaults: PASS, every security check true, no issues.
 * `notApplicableReasons` is merged into `security`, where the schema puts it.
 */
export function validator({
  status = 'PASS',
  issues = [],
  security = {},
  notApplicableReasons,
  regressions
}: {
  status?: ValidatorOutput['status'];
  issues?: ValidatorIssueFixture[];
  security?: Partial<ValidatorSecurity>;
  notApplicableReasons?: Partial<Record<SecurityCheckName, string>>;
  regressions?: ValidatorOutput['details']['regressions'];
} = {}): ValidatorOutput {
  return {
    stage: 4,
    agent: '07-validator',
    timestamp: now(),
    status,
    details: {
      summary: 'Implementation matches the story and the brief.',
      artifacts: [
        {
          name: 'VALIDATION_REPORT.md',
          path: 'VALIDATION_REPORT.md',
          description: 'Validation report',
          content: '# Validation Report\n\nNo critical issues.'
        }
      ],
      storyCompliance: { allFilesMentioned: true, allACTested: true, storyMatchesImplementation: true },
      briefCompliance: { apiImplementedCorrectly: true, dataModelCorrect: true, uiComponentsCorrect: true },
      codeQuality: { followsPatterns: true, noMagicNumbers: true, noDuplicateLogic: true, properErrorHandling: true },
      security: {
        authImplemented: true,
        inputValidated: true,
        noHardcodedSecrets: true,
        sqlInjectionProtected: true,
        xssProtected: true,
        ...security,
        ...(notApplicableReasons ? { notApplicableReasons } : {})
      },
      issues,
      ...(regressions ? { regressions } : {})
    }
  };
}

/**
 * A follow-up review (07b) of the files the Test Verifier changed. Defaults: PASS, no file
 * reviewed, no issues. A test that makes the Test Verifier change files passes the same `files`.
 */
export function followup({
  files = [],
  issues = [],
  status = 'PASS'
}: {
  files?: string[];
  issues?: ValidatorIssueFixture[];
  status?: ValidatorFollowupOutput['status'];
} = {}): ValidatorFollowupOutput {
  return {
    stage: 4,
    agent: '07b-validator-followup',
    timestamp: now(),
    status,
    details: {
      summary: 'Reviewed the test files the Test Verifier changed.',
      artifacts: [
        {
          name: 'VALIDATION_FOLLOWUP.md',
          path: 'VALIDATION_FOLLOWUP.md',
          description: 'Follow-up review',
          content: '# Validation Follow-up\n\nNo issues in the listed files.'
        }
      ],
      filesReviewed: [...files],
      issues: structuredClone(issues)
    }
  };
}

/**
 * The issue key a skeptic prompt asks the skeptic to echo: the key in its "Echo issueKey `<k>`"
 * line (D-5), or '' when the prompt has no such line. An empty key fails the skeptic's schema, so
 * a prompt that forgot the line cannot pass by accident.
 */
export function echoedIssueKey(prompt: string): string {
  return /Echo issueKey `([^`\n]+)`/.exec(prompt)?.[1] ?? '';
}

/**
 * A skeptic (07c), as a function of its invocation: by default it echoes the key its prompt gave
 * it, so the harness's key check passes. Defaults: PASS with verdict UPHELD and no evidence; a
 * DISPROVED verdict defaults to one file:line evidence entry (the schema requires at least one).
 */
export function skeptic({
  verdict = 'UPHELD',
  reason = verdict === 'DISPROVED' ? 'The code shows the issue as stated is not real.' : 'The issue stands as stated.',
  evidence = verdict === 'DISPROVED' ? [{ file: 'src/a.ts', line: 1, note: 'the guard the issue says is missing' }] : [],
  status = 'PASS',
  issueKey = call => echoedIssueKey(call.prompt)
}: {
  verdict?: SkepticVerdict;
  reason?: string;
  evidence?: SkepticOutput['details']['evidence'];
  status?: SkepticOutput['status'];
  issueKey?: (call: AgentInvocation) => string;
} = {}): (call: AgentInvocation) => SkepticOutput {
  return call => ({
    stage: 4,
    agent: '07c-validator-skeptic',
    timestamp: now(),
    status,
    details: {
      summary: `Skeptic verdict: ${verdict}.`,
      artifacts: [
        {
          name: 'SKEPTIC_REVIEW.md',
          path: 'SKEPTIC_REVIEW.md',
          description: 'Skeptic review',
          content: `# Skeptic Review\n\n${verdict}: ${reason}`
        }
      ],
      issueKey: issueKey(call),
      verdict,
      reason,
      evidence: structuredClone(evidence)
    }
  });
}

/** A Consolidator report that satisfies its schema. */
export function consolidator(): FeatureConsolidatorOutput {
  return {
    stage: 5,
    agent: '08-feature-consolidator',
    timestamp: now(),
    status: 'PASS',
    details: {
      summary: 'Consolidated.',
      artifacts: [
        { name: 'CONSOLIDATION_REPORT.md', path: 'CONSOLIDATION_REPORT.md', description: 'Report', content: '# Consolidation Report' },
        { name: 'PATTERNS.md', path: 'PATTERNS.md', description: 'Patterns', content: '# Patterns' }
      ],
      executionMetrics: {
        featureName: 'fixture',
        startDate: now(),
        endDate: now(),
        totalTime: 1,
        timePerStage: { discover: 0, plan: 0, execute: 0, verify: 0, deliver: 0 },
        loopCount: 0,
        escalationCount: 0
      },
      patterns: { reusedPatterns: [], newPatterns: [], patternIssues: [] },
      learnings: { whatWorked: [], whatDidntWork: [], surprises: [], nextTime: [] },
      estimates: { stageEstimates: {}, confidence: 0.5, actualVsEstimated: {} },
      recommendations: { forSimilarFeatures: [], architectureImprovements: [], processImprovements: [] }
    }
  };
}

/**
 * A minimal, schema-INVALID envelope for an agent a test does not care about. The schema gate
 * rejects it, so a run that reaches this agent stops there.
 */
export function placeholder(stage: number, agent: string): FeatureFactoryAgentOutput {
  return {
    stage: stage as FeatureFactoryAgentOutput['stage'],
    agent,
    timestamp: now(),
    status: 'PASS',
    details: { summary: 'x', artifacts: [] }
  };
}

/** A pre-supplied (Tier 1) spec: a story and a brief that pass the Stage 2 gate. */
export function featureSpec({
  name = 'add-2fa',
  files = ['src/auth/totp.ts'],
  dependsOn
}: { name?: string; files?: string[]; dependsOn?: string[] } = {}): FeatureSpec {
  return {
    featureName: name,
    featureDescription: 'Let a user enable two-factor authentication',
    story: story(),
    spec: spec({ files }),
    ...(dependsOn ? { dependsOn } : {})
  };
}
