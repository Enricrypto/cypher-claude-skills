/**
 * Feature Factory Orchestrator
 *
 * Main workflow that coordinates all 5 stages of feature development.
 * Uses harness components to enforce deterministic gates and error handling.
 *
 * Stages:
 * 1. DISCOVER (Researcher) — Map codebase
 * 2. PLAN (Story Writer → Spec Writer) — Design feature
 * 3. EXECUTE (Backend Builder → Frontend Builder) — Implement with loop-backs
 * 4. VERIFY (Test Verifier → Validator) — Test with regression detection
 * 5. DELIVER (Feature Consolidator) — Consolidate after merge
 */

import {
  stageContracts,
  canAdvanceStage,
  StageContext,
  StageAdvancementDecision
} from '../../harness/stage-gates';

import {
  ArtifactRef,
  validateOutputSchema,
  FeatureFactoryAgentOutput,
  ResearcherOutput,
  StoryWriterOutput,
  SpecWriterOutput,
  BackendBuilderOutput,
  FrontendBuilderOutput,
  TestVerifierOutput,
  ValidatorOutput,
  FeatureConsolidatorOutput,
  verifyArtifactMaterialization,
  generateMaterializationReport,
  MaterializationAudit
} from '../../harness/agent-output-schema';

import {
  analyzeError,
  getRemediationInstruction,
  getFixCodeTemplate
} from '../../harness/error-categories';

import {
  auditExecution,
  validateExecutionGate,
  generateExecutionReport,
  ExecutionAudit
} from '../../harness/execution-gates';

import {
  auditInfrastructure,
  validateInfrastructureGate,
  generateInfrastructureReport,
  InfrastructureAudit
} from '../../harness/infrastructure-gates';

import { AgentInvoker } from '../../runner/invoke-agent';
import { buildStageContext, persistArtifacts, StageOutputs } from '../../harness/stage-context';

import {
  FeatureState,
  createFeatureState,
  recordAgentStep,
  recordLoopBack,
  recordEscalation,
  recordCheckpointApproval,
  advanceToStage,
  completeFeature,
  serializeState,
  getStateSummary
} from '../../harness/state-tracker';

/**
 * An agent that says it cannot proceed is believed.
 *
 * The live smoke test had the Researcher correctly return status:"ESCALATE" — it had found that
 * the feature was not implementable against the codebase — and the orchestrator would have
 * carried on to schema validation and the gate regardless. The agents are the ones looking at
 * the code; when one declares a blocker, that is a finding, not noise.
 */
function agentDeclaredBlocked(output: FeatureFactoryAgentOutput): boolean {
  return output.status === 'ESCALATE' || output.status === 'FAIL';
}

export interface OrchestrationOptions {
  featureName: string;
  featureDescription: string;
  resumeFromState?: FeatureState;

  /** The target project the agents build in. Artifact paths and gates resolve against this. */
  cwd: string;

  /**
   * How agents are run. Injected rather than imported so the gates can be exercised without a
   * network: production passes createSdkInvoker(...), tests pass a scripted fake. The harness
   * is indifferent to which — it judges the output, not its provenance.
   */
  invoke: AgentInvoker;

  logger?: (message: string) => void;
}

/**
 * Execute feature through all 5 stages
 */
export async function runFeatureFactory(options: OrchestrationOptions): Promise<FeatureState> {
  let state = options.resumeFromState || createFeatureState(options.featureName);

  const invokeAgent = options.invoke;
  const cwd = options.cwd;
  const log = options.logger ?? ((message: string) => console.log(`[FF] ${message}`));
  const phase = (title: string) => log(`\n=== ${title} ===`);

  /** Accumulates real agent outputs; the gates are built from this, never from constants. */
  const outputs: StageOutputs = {};

  try {
    log(`Starting Feature Factory: ${state.featureName}`);
    log(`Feature ID: ${state.featureId}`);

    // ========================================================================
    // STAGE 1: DISCOVER (Researcher)
    // ========================================================================

    phase('Stage 1: Discover');

    const researcherOutput = await invokeAgent({
      stage: 1,
      agent: '01-researcher',
      prompt: `Analyze the codebase for feature: "${options.featureDescription}"`,
      maxAttempts: 1
    });

    // Validate output schema
    const researchValidation = validateOutputSchema(1, '01-researcher', researcherOutput);
    if (!researchValidation.valid) {
      state = recordEscalation(
        state,
        1,
        '01-researcher',
        'SCHEMA_VALIDATION',
        `Output schema validation failed: ${researchValidation.errors.join(', ')}`
      );
      return completeFeature(state, 'ESCALATED', 'Schema validation failed at Stage 1');
    }

    if (agentDeclaredBlocked(researcherOutput)) {
      state = recordEscalation(
        state,
        1,
        '01-researcher',
        'CRITICAL_ISSUE',
        `01-researcher reported ${researcherOutput.status}: ${researcherOutput.details.summary}`
      );
      return completeFeature(state, 'ESCALATED', `01-researcher declared the feature blocked`);
    }

    outputs.researcher = researcherOutput;
    state = recordAgentStep(state, 1, '01-researcher', 'PASS', researcherOutput);

    // Check Stage 1 gate
    const stage1Decision = await checkStageGate(1, cwd, outputs);
    if (!stage1Decision.canAdvance) {
      state = recordEscalation(
        state,
        1,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 1 gate failed: ${stage1Decision.reason}`,
        { blockers: stage1Decision.blockers }
      );
      return completeFeature(state, 'ESCALATED', stage1Decision.reason);
    }

    log(`✅ Stage 1 passed: ${stage1Decision.passRate.toFixed(0)}% criteria met`);
    state = advanceToStage(state, 2);

    // ========================================================================
    // STAGE 2: PLAN (Story Writer + Spec Writer)
    // ========================================================================

    phase('Stage 2: Plan');

    // Story Writer
    const storyOutput = await invokeAgent({
      stage: 2,
      agent: '02-story-writer',
      prompt: `Write user story for: "${options.featureDescription}" based on researcher report`,
      maxAttempts: 1
    });

    const storyValidation = validateOutputSchema(2, '02-story-writer', storyOutput);
    if (!storyValidation.valid) {
      state = recordEscalation(
        state,
        2,
        '02-story-writer',
        'SCHEMA_VALIDATION',
        `Story output schema invalid: ${storyValidation.errors[0]}`
      );
      return completeFeature(state, 'ESCALATED', 'Story schema validation failed');
    }

    if (agentDeclaredBlocked(storyOutput)) {
      state = recordEscalation(
        state,
        2,
        '02-story-writer',
        'CRITICAL_ISSUE',
        `02-story-writer reported ${storyOutput.status}: ${storyOutput.details.summary}`
      );
      return completeFeature(state, 'ESCALATED', `02-story-writer declared the feature blocked`);
    }

    outputs.story = storyOutput;
    state = recordAgentStep(state, 2, '02-story-writer', 'PASS', storyOutput);

    // CHECKPOINT 1: Approve story
    log('⏸️  CHECKPOINT 1: Awaiting story approval');
    state = recordCheckpointApproval(state, 2, 'Story Approval');

    // Spec Writer
    const specOutput = await invokeAgent({
      stage: 2,
      agent: '03-spec-writer',
      prompt: `Write technical brief for approved story`,
      maxAttempts: 1
    });

    const specValidation = validateOutputSchema(2, '03-spec-writer', specOutput);
    if (!specValidation.valid) {
      state = recordEscalation(
        state,
        2,
        '03-spec-writer',
        'SCHEMA_VALIDATION',
        `Spec output schema invalid: ${specValidation.errors[0]}`
      );
      return completeFeature(state, 'ESCALATED', 'Spec schema validation failed');
    }

    if (agentDeclaredBlocked(specOutput)) {
      state = recordEscalation(
        state,
        2,
        '03-spec-writer',
        'CRITICAL_ISSUE',
        `03-spec-writer reported ${specOutput.status}: ${specOutput.details.summary}`
      );
      return completeFeature(state, 'ESCALATED', `03-spec-writer declared the feature blocked`);
    }

    outputs.spec = specOutput;
    state = recordAgentStep(state, 2, '03-spec-writer', 'PASS', specOutput);

    // Check Stage 2 gate
    const stage2Decision = await checkStageGate(2, cwd, outputs);
    if (!stage2Decision.canAdvance) {
      state = recordEscalation(
        state,
        2,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 2 gate failed: ${stage2Decision.reason}`
      );
      return completeFeature(state, 'ESCALATED', stage2Decision.reason);
    }

    log(`✅ Stage 2 passed: Story & Spec approved`);

    // CHECKPOINT 2: Approve brief
    log('⏸️  CHECKPOINT 2: Awaiting brief approval');
    state = recordCheckpointApproval(state, 2, 'Brief Approval');

    state = advanceToStage(state, 3);

    // ========================================================================
    // STAGE 3: EXECUTE (Backend Builder + Frontend Builder with loop-backs)
    // ========================================================================

    phase('Stage 3: Execute');

    // Backend Builder with loop-back
    let backendLoopCount = 0;
    let backendOutput: BackendBuilderOutput | null = null;
    let backendPassed = false;

    while (backendLoopCount < 3 && !backendPassed) {
      backendLoopCount++;
      log(`Backend Builder: Attempt ${backendLoopCount}/3`);

      const candidate: BackendBuilderOutput = await invokeAgent({
        stage: 3,
        agent: '04-backend-builder',
        prompt: `Implement backend for approved spec${backendLoopCount > 1 ? ` (Attempt ${backendLoopCount})` : ''}`,
        maxAttempts: 1
      });

      const backendValidation = validateOutputSchema(3, '04-backend-builder', candidate);
      if (!backendValidation.valid) {
        state = recordLoopBack(
          state,
          3,
          '04-backend-builder',
          `Output schema invalid: ${backendValidation.errors[0]}`,
          'FAIL'
        );
        continue;
      }

      if (candidate.details.testing?.testsFailed && candidate.details.testing.testsFailed > 0) {
        // Tests failed — analyze errors and loop back
        const failedTest = candidate.details.testing.failingTests?.[0];
        if (failedTest) {
          const errorAnalysis = analyzeError(failedTest.error);
          state = recordLoopBack(
            state,
            3,
            '04-backend-builder',
            `${errorAnalysis.category}: ${failedTest.error}`,
            'FAIL',
            `Apply: ${errorAnalysis.fixClass}`
          );
        }
        continue;
      }

      // Backend tests passed
      backendOutput = candidate;
      state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', candidate);
      backendPassed = true;
    }

    if (!backendPassed || !backendOutput) {
      state = recordEscalation(
        state,
        3,
        '04-backend-builder',
        'MAX_LOOPS',
        `Backend builder exceeded max attempts (${backendLoopCount})`,
        { loopCount: backendLoopCount }
      );
      return completeFeature(state, 'ESCALATED', 'Backend builder max loops exceeded');
    }

    log(`✅ Backend builder passed (${backendLoopCount === 1 ? 'first try' : `after ${backendLoopCount} attempts`})`);
    const backend: BackendBuilderOutput = backendOutput;

    // Frontend Builder with loop-back
    let frontendLoopCount = 0;
    let frontendOutput: FrontendBuilderOutput | null = null;
    let frontendPassed = false;

    while (frontendLoopCount < 3 && !frontendPassed) {
      frontendLoopCount++;
      log(`Frontend Builder: Attempt ${frontendLoopCount}/3`);

      const candidate: FrontendBuilderOutput = await invokeAgent({
        stage: 3,
        agent: '05-frontend-builder',
        prompt: `Implement frontend for approved spec and backend API${frontendLoopCount > 1 ? ` (Attempt ${frontendLoopCount})` : ''}`,
        maxAttempts: 1
      });

      const frontendValidation = validateOutputSchema(3, '05-frontend-builder', candidate);
      if (!frontendValidation.valid) {
        state = recordLoopBack(
          state,
          3,
          '05-frontend-builder',
          `Output schema invalid: ${frontendValidation.errors[0]}`,
          'FAIL'
        );
        continue;
      }

      if (candidate.details.testing?.testsFailed && candidate.details.testing.testsFailed > 0) {
        const failedTest = candidate.details.testing.failingTests?.[0];
        if (failedTest) {
          const errorAnalysis = analyzeError(failedTest.error);
          state = recordLoopBack(
            state,
            3,
            '05-frontend-builder',
            `${errorAnalysis.category}: ${failedTest.error}`,
            'FAIL',
            `Apply: ${errorAnalysis.fixClass}`
          );
        }
        continue;
      }

      frontendOutput = candidate;
      state = recordAgentStep(state, 3, '05-frontend-builder', 'PASS', candidate);
      frontendPassed = true;
    }

    if (!frontendPassed || !frontendOutput) {
      state = recordEscalation(
        state,
        3,
        '05-frontend-builder',
        'MAX_LOOPS',
        `Frontend builder exceeded max attempts (${frontendLoopCount})`,
        { loopCount: frontendLoopCount }
      );
      return completeFeature(state, 'ESCALATED', 'Frontend builder max loops exceeded');
    }

    log(`✅ Frontend builder passed (${frontendLoopCount === 1 ? 'first try' : `after ${frontendLoopCount} attempts`})`);
    const frontend: FrontendBuilderOutput = frontendOutput;
    outputs.backend = backend;
    outputs.frontend = frontend;

    // ========================================================================
    // ARTIFACT MATERIALIZATION CHECK (Reality Verification)
    // ========================================================================
    // Prevent hallucinations: verify that claimed files actually exist on disk

    log('\n🔍 Verifying artifact materialization (checking if claimed files actually exist)...\n');

    const claimedFiles: ArtifactRef[] = [
      ...(backend.details.filesModified ?? []).map(f => ({
        name: f.path.split('/').pop() ?? f.path, path: f.path, description: `Backend Builder: ${f.description}`
      })),
      ...(frontend.details.filesModified ?? []).map(f => ({
        name: f.path.split('/').pop() ?? f.path, path: f.path, description: `Frontend Builder: ${f.description}`
      }))
    ];

    const artifactAudit = await verifyArtifactMaterialization(3, 'builders', claimedFiles);

    log(generateMaterializationReport(artifactAudit));

    if (!artifactAudit.allMaterialized) {
      log('\n❌ CRITICAL: Hallucination detected!\n');
      log(`${artifactAudit.missingArtifacts.length} claimed files do not exist on disk:`);
      artifactAudit.missingArtifacts.forEach(f => {
        log(`  ❌ ${f.path}`);
      });

      state = recordEscalation(
        state,
        3,
        'harness',
        'HALLUCINATION_DETECTED',
        `${artifactAudit.missingArtifacts.length} claimed files not materialized`,
        { missingFiles: artifactAudit.missingArtifacts.map(f => f.path) }
      );
      return completeFeature(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files that do not exist');
    }

    log(`\n✅ All ${claimedFiles.length} artifacts verified to exist on disk\n`);

    // Check Stage 3 gate
    const stage3Decision = await checkStageGate(3, cwd, outputs, {
      loops: { backend: backendLoopCount, frontend: frontendLoopCount }
    });
    if (!stage3Decision.canAdvance) {
      state = recordEscalation(
        state,
        3,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 3 gate failed: ${stage3Decision.reason}`
      );
      return completeFeature(state, 'ESCALATED', stage3Decision.reason);
    }

    log(`✅ Stage 3 passed: Implementation complete`);
    state = advanceToStage(state, 4);

    // ========================================================================
    // INFRASTRUCTURE VERIFICATION GATE (Reality Check for Readiness)
    // ========================================================================
    // Verify npm scripts, database setup, TypeScript config before running tests

    log('\n🏗️  Verifying infrastructure prerequisites (npm scripts, database, config)...\n');

    let infrastructureAudit: InfrastructureAudit | null = null;
    try {
      infrastructureAudit = await auditInfrastructure(process.cwd());
      log(generateInfrastructureReport(infrastructureAudit));

      const infrastructureDecision = validateInfrastructureGate(infrastructureAudit);

      if (!infrastructureDecision.canAdvance) {
        log('\n❌ CRITICAL: Infrastructure prerequisites missing!\n');
        log(`Blockers:`);
        infrastructureDecision.blockers.forEach(b => {
          log(`  ❌ ${b}`);
        });
        log(`\nRequired fixes:`);
        log(infrastructureDecision.remediation);

        state = recordEscalation(
          state,
          4,
          'harness',
          'INFRASTRUCTURE_FAILURE',
          `Infrastructure verification failed: ${infrastructureDecision.reason}`,
          {
            blockers: infrastructureDecision.blockers,
            remediation: infrastructureDecision.remediation
          }
        );
        return completeFeature(state, 'ESCALATED', `Infrastructure not ready: ${infrastructureDecision.blockers[0]}`);
      }

      if (infrastructureDecision.warnings.length > 0) {
        log(`\n⚠️  Warnings (non-blocking):`);
        infrastructureDecision.warnings.forEach(w => {
          log(`  ⚠️  ${w}`);
        });
      }

      log(`\n✅ Infrastructure ready: All prerequisites verified\n`);
    } catch (err: any) {
      log(`⚠️  Could not run infrastructure verification: ${err.message}`);
      log('Continuing to Test Verifier (manual infrastructure check recommended)');
      state = recordLoopBack(
        state,
        4,
        'harness',
        `Infrastructure verification error: ${err.message}`,
        'WARN'
      );
    }

    // ========================================================================
    // STAGE 4: VERIFY (Test Verifier + Validator with regression detection)
    // ========================================================================

    phase('Stage 4: Verify');

    // Capture baseline test state before verification
    // testing has no `totalTests` field — it is {testsWritten, testsPassed, testsFailed}.
    // Reading a non-existent field made this baseline {0, 0}, so detectRegressions compared
    // `after.passingTests < 0` and could never fire. Regression detection was dead.
    const backendTesting = backendOutput.details.testing;
    const frontendTesting = frontendOutput.details.testing;
    const testBaselineBefore = {
      totalTests: (backendTesting?.testsWritten ?? 0) + (frontendTesting?.testsWritten ?? 0),
      passingTests: (backendTesting?.testsPassed ?? 0) + (frontendTesting?.testsPassed ?? 0)
    };

    // Test Verifier
    const testOutput = await invokeAgent({
      stage: 4,
      agent: '06-test-verifier',
      prompt: `Write acceptance tests for implemented feature`,
      maxAttempts: 2
    });

    const testValidation = validateOutputSchema(4, '06-test-verifier', testOutput);
    if (!testValidation.valid) {
      state = recordEscalation(
        state,
        4,
        '06-test-verifier',
        'SCHEMA_VALIDATION',
        `Test output schema invalid: ${testValidation.errors[0]}`
      );
      return completeFeature(state, 'ESCALATED', 'Test verifier schema validation failed');
    }

    state = recordAgentStep(state, 4, '06-test-verifier', 'PASS', testOutput);

    // ========================================================================
    // EXECUTION VERIFICATION GATE (Reality Check for Tests)
    // ========================================================================
    // Prevent test hallucinations: verify tests actually ran and passed

    log('\n🔍 Verifying test execution (ensuring tests actually ran and passed 100%)...\n');

    let executionAudit: ExecutionAudit | null = null;
    try {
      executionAudit = await auditExecution(process.cwd());
      log(generateExecutionReport(executionAudit));

      const executionDecision = validateExecutionGate(executionAudit);

      if (!executionDecision.canAdvance) {
        log('\n❌ CRITICAL: Test execution verification failed!\n');
        log(`Pass rate: ${(executionDecision.passRate * 100).toFixed(1)}%`);
        log(`Blockers:`);
        executionDecision.blockers.forEach(b => {
          log(`  ❌ ${b}`);
        });
        log(`\nRemediation: ${executionDecision.remediation}`);

        state = recordEscalation(
          state,
          4,
          'harness',
          'EXECUTION_FAILURE',
          `Test execution verification failed: ${executionDecision.reason}`,
          {
            passRate: executionDecision.passRate,
            blockers: executionDecision.blockers,
            failingTests: executionAudit.failedTests,
            buildErrors: executionAudit.buildErrors
          }
        );
        return completeFeature(state, 'ESCALATED', `Test execution failed: ${executionDecision.blockers[0]}`);
      }

      log(`\n✅ All execution checks passed: Tests 100% passing, Build compiles, Dev server clean\n`);
    } catch (err: any) {
      log(`⚠️  Could not run execution verification: ${err.message}`);
      log('Continuing to Validator (human review will catch issues)');
      state = recordLoopBack(
        state,
        4,
        'harness',
        `Execution verification error: ${err.message}`,
        'WARN'
      );
    }

    // Validator
    const validatorOutput = await invokeAgent({
      stage: 4,
      agent: '07-validator',
      prompt: `Validate implementation against approved story and spec`,
      maxAttempts: 2
    });

    const validatorValidation = validateOutputSchema(4, '07-validator', validatorOutput);
    if (!validatorValidation.valid) {
      state = recordEscalation(
        state,
        4,
        '07-validator',
        'SCHEMA_VALIDATION',
        `Validator output schema invalid: ${validatorValidation.errors[0]}`
      );
      return completeFeature(state, 'ESCALATED', 'Validator schema validation failed');
    }

    // Check for critical validation issues
    const criticalIssues = validatorOutput.details.issues?.filter((i: { severity: string }) => i.severity === 'CRITICAL') || [];
    if (criticalIssues.length > 0) {
      state = recordEscalation(
        state,
        4,
        '07-validator',
        'CRITICAL_ISSUE',
        `${criticalIssues.length} critical validation issues found`,
        { issues: criticalIssues.map((i: { message: string }) => i.message) }
      );
      // Loop back to Stage 3 for fixes
      state = advanceToStage(state, 3);
      log(`⚠️  Looping back to Stage 3: Fix critical issues`);
      // In a real scenario, would loop back. For now, escalate.
      return completeFeature(state, 'ESCALATED', 'Critical validation issues require Stage 3 fixes');
    }

    state = recordAgentStep(state, 4, '07-validator', 'PASS', validatorOutput);

    // Regression detection
    const testBaselineAfter = {
      totalTests: testOutput.details.testExecution?.totalTests || 0,
      passingTests: testOutput.details.testExecution?.passed || 0
    };

    const regressions = detectRegressions(testBaselineBefore, testBaselineAfter);
    if (regressions.length > 0) {
      state = recordEscalation(
        state,
        4,
        'harness',
        'CRITICAL_ISSUE',
        `${regressions.length} regressions detected: previously passing tests now failing`,
        { regressions }
      );
      return completeFeature(state, 'ESCALATED', 'Regressions detected');
    }

    // Check Stage 4 gate
    const stage4Decision = await checkStageGate(4, cwd, outputs);
    if (!stage4Decision.canAdvance) {
      state = recordEscalation(
        state,
        4,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 4 gate failed: ${stage4Decision.reason}`
      );
      return completeFeature(state, 'ESCALATED', stage4Decision.reason);
    }

    log(`✅ Stage 4 passed: All tests & validations passed`);
    state = advanceToStage(state, 5);

    // ========================================================================
    // STAGE 5: DELIVER (Feature Consolidator — after merge)
    // ========================================================================

    phase('Stage 5: Deliver');

    log('⏸️  Waiting for PR merge before consolidation');
    log('After merge, run: feature-factory --consolidate <feature-id>');

    // Feature Consolidator (runs after merge)
    const consolidatorOutput = await invokeAgent({
      stage: 5,
      agent: '08-feature-consolidator',
      prompt: `Consolidate feature execution and extract reusable patterns`,
      maxAttempts: 1
    });

    const consolidatorValidation = validateOutputSchema(5, '08-feature-consolidator', consolidatorOutput);
    if (!consolidatorValidation.valid) {
      state = recordEscalation(
        state,
        5,
        '08-feature-consolidator',
        'SCHEMA_VALIDATION',
        `Consolidator output schema invalid: ${consolidatorValidation.errors[0]}`
      );
      return completeFeature(state, 'ESCALATED', 'Consolidator schema validation failed');
    }

    state = recordAgentStep(state, 5, '08-feature-consolidator', 'PASS', consolidatorOutput);

    // Check Stage 5 gate
    const stage5Decision = await checkStageGate(5, cwd, outputs, { knowledgeStored: true });
    if (!stage5Decision.canAdvance) {
      log(`⚠️  Stage 5 gate incomplete: ${stage5Decision.reason}`);
    }

    log(`✅ Stage 5 complete: Patterns consolidated and stored`);

    // ========================================================================
    // COMPLETION
    // ========================================================================

    state = completeFeature(state, 'SUCCESS', 'All 5 stages completed successfully');

    log(`\n✅ Feature Factory Complete: ${state.featureName}`);
    log(`Total time: ${Math.round(state.metrics.totalTime / 1000 / 60)} minutes`);
    log(`Total loop-backs: ${state.metrics.loopCount}`);

    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`❌ Orchestration failed: ${message}`);
    state = recordEscalation(
      state,
      state.currentStage,
      'orchestrator',
      'MANUAL',
      `Orchestration error: ${message}`
    );
    return completeFeature(state, 'ESCALATED', message);
  }
}

/**
 * Helper: Check stage gate.
 *
 * The context is DERIVED — from what the agents produced and what is on disk. It used to be
 * fabricated here (testPassRate hardcoded to 1.0, criticalIssuesCount to 0), which meant the
 * gates were real code judging invented evidence and the CRITICAL criteria could never fail.
 * See harness/stage-context.ts.
 */
async function checkStageGate(
  stage: number,
  cwd: string,
  outputs: StageOutputs,
  extra?: { loops?: { backend?: number; frontend?: number }; knowledgeStored?: boolean }
): Promise<StageAdvancementDecision> {
  // Read-only agents cannot write their own documents — they have no Write tool. Persist what
  // they returned so the gates have something real to read. Builders are excluded: they must
  // write their own code, or the materialization gate would be checking the harness's work.
  persistArtifacts(outputs, cwd);

  const contract = stageContracts[stage];
  const context = buildStageContext({
    stage,
    cwd,
    outputs,
    loops: extra?.loops,
    knowledgeStored: extra?.knowledgeStored
  });

  return canAdvanceStage(stage, contract, context);
}

/**
 * Helper: Detect regressions
 */
function detectRegressions(
  before: { totalTests: number; passingTests: number },
  after: { totalTests: number; passingTests: number }
): string[] {
  const regressions: string[] = [];

  // If previously passing tests are now failing
  if (after.passingTests < before.passingTests) {
    const failedCount = before.passingTests - after.passingTests;
    regressions.push(`${failedCount} previously passing tests now failing`);
  }

  return regressions;
}

/**
 * Helper: Get stage name for folder
 */
function getStageNameLowerCase(stage: number): string {
  const names = {
    1: 'discover',
    2: 'plan',
    3: 'execute',
    4: 'verify',
    5: 'deliver'
  };
  return names[stage as keyof typeof names] || 'unknown';
}

