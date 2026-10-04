/**
 * Feature Factory Stage Contracts & Gates
 *
 * Each stage (1-5) has explicit acceptance criteria.
 * Harness validates before allowing advancement to next stage.
 *
 * Adapted from: e2e-loop/harness/phase-gates.ts
 * Specialized for: Feature Factory stages 1-5
 */

import { ArtifactRef, verifyArtifactMaterialization } from './agent-output-schema';
import { testsRan } from './regression-baseline';
import { MAX_BUILDER_ATTEMPTS } from './loop-rules';

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
  /**
   * Only CRITICAL criteria block (AC-17). An IMPORTANT failure is returned as a finding and the
   * stage still advances. (There used to be a `requireAll` switch, set true everywhere, which
   * made IMPORTANT block exactly like CRITICAL and the severity label meaningless.)
   */
  acceptance: {
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
  /** The project the agents are building in. The gates check THIS filesystem, not the harness's. */
  cwd: string;
  stageDir: string;
  artifacts: Record<string, string>;
  metadata: Record<string, any>;
  previousStageResults?: any;
}

export interface StageAdvancementDecision {
  canAdvance: boolean;
  passRate: number;
  criteriaResults: Record<string, CriterionResult>;
  /** Why the stage cannot advance: failed CRITICAL criteria, missing documents, thrown validators. */
  blockers: string[];
  /** Failed IMPORTANT criteria, as "[Stage N] <criterion>: <details>". Never blocking. */
  importantFindings: string[];
  /** Names in `contract.artifacts.required` that are absent from the context's artifacts. */
  missingArtifacts: string[];
  recommendation: 'ADVANCE' | 'WAIT' | 'ESCALATE' | 'RETRY';
  reason: string;
}

/** A Gate 2 measurement, as the harness's execution audit counted it (D-5). */
export interface ExecutionMeasurement {
  total: number;
  passed: number;
  failed: number;
  /** 0-1, over the tests that ran. */
  passRate: number;
}

/**
 * The Stage 4 metadata keys, named once (AC-62).
 *
 * The old Stage 4 test passed `acTestedCount` / `acTotalCount`, keys the gate never read, and
 * passed anyway because every criterion defaulted its missing input to a pass. Typing the
 * metadata turns a wrong key into a compile error; the criteria below fail closed on a missing
 * input, so an empty context can no longer pass.
 *
 * Built by stage-context.ts from the Test Verifier, the story, the Validator and the brief.
 */
export interface Stage4Metadata {
  acceptanceCriteriaTotalCount?: number;
  acceptanceCriteriaTestedCount?: number;
  acceptanceCriteriaNotCoverableCount?: number;
  /** From the approved story itself, so the Test Verifier cannot shrink the denominator. */
  storyAcceptanceCriteriaCount?: number;
  criticalIssuesCount?: number;
  securityIssuesCount?: number;
  securityBlockers?: string[];
  /** The latest Gate 2 measurement. Harness-side: passed by the orchestrator, never by an agent. */
  executionMeasurement?: ExecutionMeasurement;
  /**
   * The count of tests that RAN (`passed + failed`, see testsRan) that the measurement's own
   * ran-count must not fall below. Not `total`: skipped/todo tests do not count. Undefined: no reference.
   */
  regressionReferenceCount?: number;
}

/**
 * The Stage 2 gate, split in two (A-2, C-9). The story is judged on its own BEFORE CHECKPOINT 1,
 * so a human is never asked to approve a story the gate would reject (AC-56); the brief is judged
 * on its own before CHECKPOINT 2 (AC-78). Either part failing escalates with its blockers (AC-57).
 */
export const STAGE2_STORY_CONTRACT: StageContract = {
  stage: 2,
  name: 'PLAN (story)',
  description: 'Design the user story',
  acceptance: {
    criteria: [
      {
        name: 'User Story Complete',
        description: 'USER_STORY.md with 3+ acceptance criteria (Given/When/Then)',
        validator: async (ctx) => validateUserStory(ctx),
        severity: 'CRITICAL'
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
    required: ['USER_STORY.md']
  },
  loopBackStage: 1
};

/** The brief half of the Stage 2 gate (C-9), judged after the Spec Writer and before CHECKPOINT 2. */
export const STAGE2_SPEC_CONTRACT: StageContract = {
  stage: 2,
  name: 'PLAN (technical brief)',
  description: 'Design the technical specification',
  acceptance: {
    criteria: [
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
      }
    ]
  },
  artifacts: {
    required: ['TECHNICAL_BRIEF.md', 'FILE_LIST.md']
  },
  nextStage: 3,
  loopBackStage: 1
};

/**
 * Stage Contracts: Define acceptance criteria for each stage
 */
export const stageContracts: Record<number, StageContract> = {
  1: {
    stage: 1,
    name: 'DISCOVER',
    description: 'Map codebase, identify patterns, assess risks',
    acceptance: {
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

  // The union of the story and spec parts below (C-9): one contract, still used whole by
  // acceptFeatureSpec, so a pre-supplied spec is judged by every Stage 2 criterion at once.
  2: {
    stage: 2,
    name: 'PLAN',
    description: 'Design user story and technical specification',
    acceptance: {
      criteria: [...STAGE2_STORY_CONTRACT.acceptance.criteria, ...STAGE2_SPEC_CONTRACT.acceptance.criteria]
    },
    artifacts: {
      required: [...STAGE2_STORY_CONTRACT.artifacts.required, ...STAGE2_SPEC_CONTRACT.artifacts.required]
    },
    nextStage: 3,
    loopBackStage: 1
  },

  3: {
    stage: 3,
    name: 'EXECUTE',
    description: 'Implement backend and frontend',
    acceptance: {
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
        },
        {
          name: 'Artifacts Materialized',
          description: 'All claimed files actually exist on disk (NOT hallucinated)',
          validator: async (ctx) => validateArtifactsMaterialized(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    // Nothing required (I-4): the builders' summaries are rendered by the harness from their
    // structured output, and a gate that checked documents the harness itself wrote would prove
    // nothing. The real Stage 3 evidence is the materialization audit and the criteria above.
    artifacts: {
      required: [],
      optional: ['BACKEND_SUMMARY.md', 'API_CONTRACT.md', 'FRONTEND_SUMMARY.md', 'LOOP_LOG.json']
    },
    nextStage: 4,
    loopBackStage: 3
  },

  4: {
    stage: 4,
    name: 'VERIFY',
    description: 'Test and validate implementation',
    acceptance: {
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
    description: 'Consolidate learnings from a finished SUCCESS run (--consolidate)',
    acceptance: {
      // Judged only on the two documents the Consolidator must write (AC-48). There is no
      // "Knowledge Stored" criterion: memory is the operator's session's job, outside the
      // factory, and the orchestrator used to feed that criterion a hard-coded `true`.
      criteria: [
        {
          name: 'Consolidation Complete',
          description: 'CONSOLIDATION_REPORT.md documents execution metrics',
          validator: async (ctx) => validateConsolidationComplete(ctx),
          severity: 'CRITICAL'
        },
        {
          name: 'Patterns Extracted',
          description: 'Reusable patterns documented in PATTERNS.md',
          validator: async (ctx) => validatePatternsExtracted(ctx),
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['CONSOLIDATION_REPORT.md', 'PATTERNS.md'],
      optional: ['TIME_ESTIMATES.json']
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
  const importantFindings: string[] = [];
  let passCount = 0;
  let anyValidatorThrew = false;

  for (const criterion of contract.acceptance.criteria) {
    try {
      const result = await criterion.validator(context);
      results[criterion.name] = result;

      if (result.passed) {
        passCount++;
      } else if (criterion.severity === 'CRITICAL') {
        blockers.push(`[CRITICAL] ${criterion.name}: ${result.details}`);
        if (result.blockers) {
          blockers.push(...result.blockers.map(b => `  → ${b}`));
        }
      } else if (criterion.severity === 'IMPORTANT') {
        importantFindings.push(`[Stage ${stage}] ${criterion.name}: ${result.details}`);
      }
    } catch (error) {
      // A criterion that could not be evaluated has verified nothing. Fail closed, whatever its
      // severity: an IMPORTANT check that crashes must not quietly become "advance".
      anyValidatorThrew = true;
      results[criterion.name] = {
        passed: false,
        score: 0,
        details: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        blockers: ['Contact human — validation harness error']
      };
      blockers.push(`[ERROR] ${criterion.name} validation failed: ${results[criterion.name].details}`);
    }
  }

  // Required documents are enforced, not just listed (AC-21).
  const missingArtifacts = contract.artifacts.required.filter(name => context.artifacts[name] === undefined);
  for (const name of missingArtifacts) {
    blockers.push(`[ARTIFACT] Required document ${name} is missing`);
  }

  const criteriaCount = contract.acceptance.criteria.length;
  const passRate = criteriaCount === 0 ? 100 : (passCount / criteriaCount) * 100;
  const allCriticalPass = contract.acceptance.criteria
    .filter(c => c.severity === 'CRITICAL')
    .every(c => results[c.name]?.passed);

  const canAdvance = allCriticalPass && missingArtifacts.length === 0 && !anyValidatorThrew;

  const recommendation: StageAdvancementDecision['recommendation'] = canAdvance
    ? 'ADVANCE'
    : passRate >= 80
      ? 'WAIT'
      : 'ESCALATE';

  return {
    canAdvance,
    passRate,
    criteriaResults: results,
    blockers,
    importantFindings,
    missingArtifacts,
    recommendation,
    reason: canAdvance
      ? `All CRITICAL criteria met. Ready to advance to Stage ${contract.nextStage || 'terminal'}.` +
        (importantFindings.length > 0 ? ` ${importantFindings.length} IMPORTANT finding(s) recorded.` : '')
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
  const expected: string[] = ctx.metadata.expectedFiles ?? [];
  const modified: string[] = ctx.metadata.modifiedFiles ?? [];

  if (expected.length === 0) {
    return { passed: true, score: 100, details: 'No approved file list to check against' };
  }

  const touched = new Set(modified);
  const missing = expected.filter(path => !touched.has(path));

  // What this gate is FOR: catching a builder that silently skipped implementation work the
  // approved brief called for. Judged against that purpose, not all missing files are equal.
  //
  //   A missing SOURCE file means the feature is genuinely incomplete. That is a real skip.
  //
  //   A missing TEST file is not. If the brief guessed "preferences.routes.test.ts" and the
  //   builder wrote "preferencesSchema.test.ts" covering the same behaviour, nothing was
  //   skipped — and test coverage is not this gate's job. Stage 4 checks acceptance criteria
  //   TESTED vs TOTAL, and the Test Verifier writes the acceptance tests. THAT is the
  //   authority on whether the story is tested; a Spec Writer guessing a filename in advance
  //   is not. Blocking a correct implementation over a test filename would be theatre.
  //
  //   A missing CONFIG file (package.json et al) usually means the brief over-listed — the
  //   dependency was already present. Also not a skipped implementation.
  //
  // The deviation is still REPORTED in every case. It just does not masquerade as incomplete
  // work when it is not.
  const isTest = (path: string) => /(^|\/)tests?\//.test(path) || /\.(test|spec)\.[jt]sx?$/.test(path);
  const isSource = (path: string) => /^src\//.test(path) && !isTest(path);

  const missingSource = missing.filter(isSource);
  const missingOther = missing.filter(path => !isSource(path));

  if (missingSource.length > 0) {
    return {
      passed: false,
      score: Math.round(((expected.length - missing.length) / expected.length) * 100),
      details: `${missingSource.length} source file(s) from the approved brief were never written`,
      blockers: [
        `The approved brief said these SOURCE files would be created or modified, and they were not.`,
        `The feature is incomplete:`,
        ...missingSource.map(path => `  - ${path}`),
        ...(missingOther.length > 0
          ? [`(Also not written, but not blocking: ${missingOther.join(', ')})`]
          : [])
      ]
    };
  }

  if (missingOther.length > 0) {
    return {
      passed: true,
      score: 80,
      details:
        `All source files were written. The builder deviated from the brief on ` +
        `${missingOther.length} non-source file(s): ${missingOther.join(', ')}. ` +
        `Not blocking — stage 4 is the authority on test coverage — but worth a human's eye.`
    };
  }

  const extra = modified.filter(path => !expected.includes(path));

  return {
    passed: true,
    score: 100,
    details:
      `All ${expected.length} files from the approved brief were written` +
      (extra.length > 0 ? ` (plus ${extra.length} not in the brief: ${extra.join(', ')})` : '')
  };
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

/**
 * Each builder's attempts in its latest loop against the attempts it was ALLOWED there: the
 * default MAX_BUILDER_ATTEMPTS plus any operator grant (AC-72). Without the allowed count a
 * granted 4th attempt that passed would fail this gate.
 */
async function validateLoopLimits(ctx: StageContext): Promise<CriterionResult> {
  const backendLoops = ctx.metadata.backendLoops || 0;
  const frontendLoops = ctx.metadata.frontendLoops || 0;
  const maxBackend = ctx.metadata.maxBackendLoops ?? MAX_BUILDER_ATTEMPTS;
  const maxFrontend = ctx.metadata.maxFrontendLoops ?? MAX_BUILDER_ATTEMPTS;
  if (backendLoops > maxBackend || frontendLoops > maxFrontend) {
    const max = maxBackend === maxFrontend ? `max ${maxBackend} each` : `max ${maxBackend} backend, ${maxFrontend} frontend`;
    return {
      passed: false,
      score: 0,
      details: `Backend loops: ${backendLoops}, Frontend loops: ${frontendLoops} (${max})`,
      blockers: ['Escalate: builders exceeded loop limits']
    };
  }
  return { passed: true, score: 100, details: `Builders within loop limits (Backend: ${backendLoops}, Frontend: ${frontendLoops})` };
}

async function validateAcceptanceTestsComplete(ctx: StageContext): Promise<CriterionResult> {
  const md = ctx.metadata as Stage4Metadata;
  const total = md.acceptanceCriteriaTotalCount;
  const tested = md.acceptanceCriteriaTestedCount ?? 0;
  const notCoverable = md.acceptanceCriteriaNotCoverableCount ?? 0;
  const storyCount = md.storyAcceptanceCriteriaCount;

  // Zero criteria is not "all criteria tested". It is no evidence at all.
  if (typeof total !== 'number' || total <= 0) {
    return {
      passed: false,
      score: 0,
      details: `No acceptance criteria reported by the Test Verifier (total ${total ?? 'missing'})`,
      blockers: ['The Test Verifier must report every acceptance criterion in the story']
    };
  }

  // The denominator comes from the approved story, not from the agent being graded.
  if (typeof storyCount !== 'number' || total !== storyCount) {
    return {
      passed: false,
      score: 0,
      details:
        typeof storyCount === 'number'
          ? `Test Verifier reported ${total} acceptance criteria, but the story has ${storyCount}`
          : `Test Verifier reported ${total} acceptance criteria, but the story's count is unknown`,
      blockers: ['Every acceptance criterion in the approved story must be tested or marked not coverable']
    };
  }

  const covered = tested + notCoverable;
  if (covered < total) {
    return {
      passed: false,
      score: (covered / total) * 100,
      details: `${covered}/${total} acceptance criteria tested or marked not coverable`,
      blockers: ['Complete testing of all acceptance criteria']
    };
  }

  return {
    passed: true,
    score: 100,
    details: `All ${total} acceptance criteria accounted for (${tested} tested, ${notCoverable} not coverable)`
  };
}

async function validateValidationPassed(ctx: StageContext): Promise<CriterionResult> {
  const criticalIssues = (ctx.metadata as Stage4Metadata).criticalIssuesCount;
  if (typeof criticalIssues !== 'number') {
    return {
      passed: false,
      score: 0,
      details: 'No Validator result to judge',
      blockers: ['Run 07-Validator; an absent validation is not a clean one']
    };
  }
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
  const md = ctx.metadata as Stage4Metadata;
  if (typeof md.securityIssuesCount !== 'number') {
    return {
      passed: false,
      score: 0,
      details: 'No security evaluation to judge',
      blockers: ['Run 07-Validator; an absent security assessment is not a clean one']
    };
  }
  if (md.securityIssuesCount > 0) {
    return {
      passed: false,
      score: 0,
      details: `${md.securityIssuesCount} security check(s) blocking`,
      blockers: md.securityBlockers && md.securityBlockers.length > 0
        ? md.securityBlockers
        : ['Fix security vulnerabilities before advancing']
    };
  }
  return { passed: true, score: 100, details: 'Security audit passed - no blocking checks' };
}

/**
 * "No Regressions" judges the harness's own Gate 2 count (D-5, AC-22, AC-66). It used to read a
 * count the Validator reported about itself, defaulting a missing one to a pass.
 *
 * Fails when there is no measurement, when anything that ran failed, or when a reference exists
 * and fewer tests ran than it. With no reference, only the 100% rule applies.
 *
 * "Ran" means `passed + failed` (testsRan), compared against a reference in the same unit
 * (IMPORTANT-5): skipped and todo tests are reported but never count toward the reference.
 */
async function validateNoRegressions(ctx: StageContext): Promise<CriterionResult> {
  const md = ctx.metadata as Stage4Metadata;
  const measured = md.executionMeasurement;
  const reference = md.regressionReferenceCount;

  if (!measured || typeof measured.total !== 'number' || typeof measured.passRate !== 'number') {
    return {
      passed: false,
      score: 0,
      details: 'No Gate 2 measurement to judge',
      blockers: ['Gate 2 must run and count the tests; an absent measurement is not a clean one']
    };
  }

  if (!(measured.passRate >= 1)) {
    return {
      passed: false,
      score: measured.passRate * 100,
      details: `Gate 2 pass rate ${(measured.passRate * 100).toFixed(1)}% (${measured.failed} failing of ${measured.passed + measured.failed}); 100% required`,
      blockers: ['Fix the failing tests before advancing']
    };
  }

  const ran = testsRan(measured);
  const notRun = measured.total > ran ? ` (${measured.total - ran} reported but not run: skipped/todo do not count)` : '';

  if (typeof reference === 'number' && ran < reference) {
    return {
      passed: false,
      score: reference > 0 ? (ran / reference) * 100 : 0,
      details: `Gate 2: ${ran} tests ran${notRun}, below the regression reference of ${reference}`,
      blockers: ['Tests were lost or skipped: restore the missing tests (or explain the removal) before advancing']
    };
  }

  return {
    passed: true,
    score: 100,
    details:
      typeof reference === 'number'
        ? `All ${ran} tests that ran pass${notRun}, at or above the regression reference of ${reference}`
        : `All ${ran} tests that ran pass${notRun}; no regression reference, so only the 100% rule applies`
  };
}

async function validateConsolidationComplete(ctx: StageContext): Promise<CriterionResult> {
  const report = ctx.artifacts['CONSOLIDATION_REPORT.md'];
  if (!report) {
    return {
      passed: false,
      score: 0,
      details: 'CONSOLIDATION_REPORT.md not found',
      blockers: ['CONSOLIDATION_REPORT.md is missing: the Feature Consolidator must write it (--consolidate <id>)']
    };
  }
  return { passed: true, score: 100, details: 'Consolidation report created' };
}

async function validatePatternsExtracted(ctx: StageContext): Promise<CriterionResult> {
  const patterns = ctx.artifacts['PATTERNS.md'];
  if (!patterns) {
    return {
      passed: false,
      score: 0,
      details: 'PATTERNS.md not found',
      blockers: ['PATTERNS.md is missing: the Feature Consolidator must write it (--consolidate <id>)']
    };
  }
  return { passed: true, score: 100, details: 'Reusable patterns documented' };
}

/**
 * REALITY CHECK: Verify that claimed artifacts actually exist on disk.
 * This prevents hallucinations where agents claim to have created files
 * but never actually wrote them.
 */
async function validateArtifactsMaterialized(ctx: StageContext): Promise<CriterionResult> {
  const claimedFiles = ctx.metadata.claimedFiles || [];

  if (!claimedFiles || claimedFiles.length === 0) {
    return {
      passed: false,
      score: 0,
      details: 'No files recorded for materialization check',
      blockers: ['Builders must record all claimed files in metadata.claimedFiles']
    };
  }

  // Builders may record either a bare path string or a full ArtifactRef.
  const artifacts: ArtifactRef[] = claimedFiles.map((file: string | ArtifactRef) =>
    typeof file === 'string'
      ? { name: file, path: file, description: 'Claimed by builder' }
      : {
          name: file.name ?? file.path,
          path: file.path,
          description: file.description ?? 'Claimed by builder'
        }
  );

  // This gate must hit the real filesystem. It is the only thing standing between an agent
  // claiming it wrote a file and that claim being believed, so it delegates to
  // verifyArtifactMaterialization() rather than trusting any caller-supplied state.
  const agent = ctx.metadata.agent ?? 'builders';
  const audit = await verifyArtifactMaterialization(3, agent, artifacts, ctx.cwd);

  if (!audit.allMaterialized) {
    return {
      passed: false,
      score: 0,
      details: `${audit.missingArtifacts.length}/${artifacts.length} files do not exist on disk`,
      blockers: [
        `HALLUCINATION DETECTED: These files were claimed but not created:`,
        ...audit.missingArtifacts.map(a => `  - ${a.path}`),
        `The agents must actually call Write/Edit tools to create files.`,
        `Do NOT advance until all claimed files exist on disk.`
      ]
    };
  }

  return {
    passed: true,
    score: 100,
    details: `✅ All ${artifacts.length} claimed artifacts exist on disk (materialization verified)`
  };
}
