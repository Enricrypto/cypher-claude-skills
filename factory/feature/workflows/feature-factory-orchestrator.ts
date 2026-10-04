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
 * 4. VERIFY (Test Verifier → Gate 2 → Validator) — the harness measures regressions itself
 * 5. DELIVER (Feature Consolidator) — Consolidate after merge
 */

import {
  stageContracts,
  canAdvanceStage,
  ExecutionMeasurement,
  StageAdvancementDecision
} from '../../harness/stage-gates';

import { readRegressionBaseline, regressionReference } from '../../harness/regression-baseline';

import {
  validateOutputSchema,
  FeatureFactoryAgentOutput,
  BackendBuilderOutput,
  FrontendBuilderOutput,
  ValidatorIssue,
  verifyArtifactMaterialization,
  generateMaterializationReport
} from '../../harness/agent-output-schema';

import {
  HarnessRenderedArtifact,
  renderApiContract,
  renderBackendSummary,
  renderFrontendSummary,
  renderTestReport,
  writeHarnessDocument
} from '../../harness/harness-documents';

import {
  BuilderFailure,
  builderPrompt,
  ValidatorRoundFailure,
  consolidatorPrompt,
  PromptContext,
  researcherPrompt,
  specPrompt,
  storyPrompt,
  testVerifierPrompt,
  validatorPrompt
} from '../../harness/agent-prompts';

import { analyzeError } from '../../harness/error-categories';

import {
  auditExecution,
  validateExecutionGate,
  generateExecutionReport,
  ExecutionAudit,
  ExecutionGateDecision
} from '../../harness/execution-gates';

import {
  auditInfrastructure,
  validateInfrastructureGate,
  generateInfrastructureReport,
  InfrastructureAudit,
  InfrastructureGateDecision
} from '../../harness/infrastructure-gates';

import { AgentInvoker } from '../../runner/invoke-agent';
import {
  buildStageContext,
  BuildStageContextInput,
  claimedFilesFromBuilders,
  claimsInsideFactoryDir,
  clearStaleArtifacts,
  persistArtifacts,
  StageOutputs
} from '../../harness/stage-context';
import { acceptFeatureSpec, FeatureSpec } from '../../contracts/feature-spec';

import {
  FeatureState,
  createFeatureState,
  recordAgentStep,
  recordLoopBack,
  recordEscalation,
  recordCheckpointApproval,
  recordImportantFindings,
  recordExecutionGate,
  recordBuilderAttempt,
  recordValidatorRound,
  advanceToStage,
  completeFeature,
  BuilderAgent,
  StepPhase
} from '../../harness/state-tracker';

import { LOOP_BACK_RULES, MAX_BUILDER_ATTEMPTS, MAX_VALIDATOR_ROUNDS } from '../../harness/loop-rules';
import { specRequiresFrontend } from '../../harness/frontend-files';
import {
  criticalIssues,
  describeIssue,
  mergeBuilderOutput,
  routeCriticalIssues,
  UnroutableReason
} from '../../harness/validator-routing';

/** The loop-back table and its bounds (D-9), re-exported so SKILL.md's claims can be checked against them. */
export { LOOP_BACK_RULES, MAX_BUILDER_ATTEMPTS, MAX_VALIDATOR_ROUNDS };
export type { LoopBackRule, LoopBackSituation } from '../../harness/loop-rules';

import { saveState, stateFilePath, StatePersistenceError } from '../../harness/state-store';

/**
 * The two audits that run real commands in the target project: Gate 1.5 (infrastructure) and
 * Gate 2 (execution).
 *
 * Injected for the same reason `invoke` is: so the orchestrator can be driven end to end in a
 * test without running `npm run build/test/dev` in a temp directory. Only the AUDITS are
 * injectable. validateInfrastructureGate / validateExecutionGate stay real, so a test exercises
 * the orchestrator's real judgement of whatever evidence the audit returns.
 */
export interface OrchestrationGates {
  auditInfrastructure: (projectRoot: string) => Promise<InfrastructureAudit>;
  auditExecution: (projectRoot: string) => Promise<ExecutionAudit>;
}

/** The real audits. Production never passes `gates`, so this is what runs. */
export const DEFAULT_GATES: Readonly<OrchestrationGates> = Object.freeze({
  auditInfrastructure,
  auditExecution
});

/**
 * A human checkpoint the program enforces (D-11). The numbers are what SKILL.md documents; the
 * doc-drift test checks the two against each other, so a checkpoint cannot be added, removed or
 * renumbered in one place only.
 */
export interface CheckpointDefinition {
  readonly id: number;
  readonly name: string;
  readonly stage: 1 | 2 | 3 | 4 | 5;
}

/**
 * Every checkpoint the orchestrator asks a human to approve. There are two in this version: PR
 * review is a human step outside the program, not a checkpoint it enforces.
 */
export const CHECKPOINTS = {
  STORY: { id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 },
  BRIEF: { id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 }
} as const satisfies Record<string, CheckpointDefinition>;

/** What a human is asked to approve at a checkpoint. */
export interface CheckpointRequest {
  name: string;
  stage: number;
  summary: string;
}

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
   * The human checkpoints (CHECKPOINTS). Called before the run is allowed to continue.
   *
   * The orchestrator used to log "⏸️  CHECKPOINT 1: Awaiting story approval" and then
   * immediately record its own approval. It never waited for anyone. The system was claiming a
   * human-oversight guarantee it did not have — and a live Spec Writer noticed, refusing to
   * proceed because "Checkpoint 1 would have been skipped silently."
   *
   * This FAILS CLOSED. If no approver is supplied, the checkpoint is not silently granted — the
   * run escalates. Auto-approval must be asked for explicitly (the CLI's --yes), because a
   * checkpoint you can skip by forgetting to configure it is not a checkpoint.
   */
  approveCheckpoint?: (checkpoint: CheckpointRequest) => Promise<boolean>;

  /**
   * A spec produced upstream — by a Tier 1 Decomposer, by a human, by anything.
   *
   * OPTIONAL, and that is the whole point. Omit it and Feature Factory runs its own Researcher,
   * Story Writer and Spec Writer exactly as it always has. Supply it and those stages are
   * skipped — but only if it passes the very same gates their output would have had to pass.
   *
   * See contracts/feature-spec.ts.
   */
  preSuppliedSpec?: FeatureSpec;

  /**
   * How agents are run. Injected rather than imported so the gates can be exercised without a
   * network: production passes createSdkInvoker(...), tests pass a scripted fake. The harness
   * is indifferent to which — it judges the output, not its provenance.
   */
  invoke: AgentInvoker;

  /**
   * Replace Gate 1.5 / Gate 2's audits. Omitted entries fall back to DEFAULT_GATES, the real
   * ones. Tests pass fakes; production passes nothing.
   */
  gates?: Partial<OrchestrationGates>;

  logger?: (message: string) => void;
}

/**
 * Execute feature through all 5 stages
 */
export async function runFeatureFactory(options: OrchestrationOptions): Promise<FeatureState> {
  let state = options.resumeFromState || createFeatureState(options.featureName);

  const invokeAgent = options.invoke;
  const cwd = options.cwd;

  /** Audits are called ONLY through this object, so an injected gate can never be bypassed. */
  const gates: OrchestrationGates = {
    auditInfrastructure: options.gates?.auditInfrastructure ?? DEFAULT_GATES.auditInfrastructure,
    auditExecution: options.gates?.auditExecution ?? DEFAULT_GATES.auditExecution
  };
  const log = options.logger ?? ((message: string) => console.log(`[FF] ${message}`));
  const phase = (title: string) => log(`\n=== ${title} ===`);

  /** Accumulates real agent outputs; the gates are built from this, never from constants. */
  const outputs: StageOutputs = {};

  /** Namespaced per run, so one feature's documents never stomp another's. */
  const artifactDir = `.factory/${state.featureId}`;

  /**
   * Persist the run's state after a transition, and hand it back so call sites read naturally:
   *
   *     state = commit(recordAgentStep(state, 1, '01-researcher', 'PASS', output));
   *
   * WHERE this is called is the design, not an implementation detail. It wraps exactly the
   * transitions a resume could restart from — a completed agent step, and a stage advance.
   * Nothing finer is worth saving because nothing finer is resumable: an agent that died
   * halfway through has to be re-run from the beginning regardless, since its partial work
   * never reached the harness.
   *
   * FAILS CLOSED. saveState throws StatePersistenceError and this does not catch it.
   *
   * An earlier version warned and continued, reasoning that losing resumability was cheaper than
   * discarding completed agent work. That traded the wrong thing away. Everything this harness
   * guarantees is a guarantee about evidence, and a run that cannot write its record produces
   * none — it keeps spending tokens, keeps writing code into the project, and arrives at an
   * outcome nobody can audit or resume. Stopping costs the work in flight. Continuing costs the
   * work in flight, plus everything spent after, plus any way to reconstruct what happened.
   *
   * The throw lands in runFeatureFactory's outer catch, which records the escalation and calls
   * finish() — whose own save fails the same way, so the error reaches the CLI and the process
   * exits non-zero. That is the correct end state: loud, and impossible to mistake for success.
   */
  const commit = (next: FeatureState): FeatureState => {
    saveState(cwd, next);
    return next;
  };

  /**
   * End the run, and leave the receipt on disk.
   *
   * Every exit from runFeatureFactory goes through here — twenty-six escalations and the one
   * success — which is what makes "a finished run always has a state file" true by construction
   * rather than by remembering to add a save next to each `return`. If you add an exit path,
   * use this; a bare completeFeature() would return a run that left no record of why it ended.
   */
  const finish = (
    current: FeatureState,
    status: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP',
    summary: string
  ): FeatureState => {
    const completed = commit(completeFeature(current, status, summary));
    log(`  📋 Run record: ${stateFilePath(cwd, completed.featureId)}`);
    return completed;
  };

  /**
   * Persist a read-only agent's documents to disk IMMEDIATELY, so the next agent in the stage
   * can actually read them. Waiting until the stage gate is what left the Spec Writer with no
   * USER_STORY.md to translate.
   */
  const persist = (partial: StageOutputs) => {
    for (const { agent, path } of persistArtifacts(partial, cwd, artifactDir)) {
      log(`  📄 ${agent} → ${path}`);
    }
  };

  /**
   * The count a Gate 2 evaluation must not fall below (D-12). The run's first evaluation
   * (round 0) is judged against `.factory/baseline.json`; every later one — the validator rounds
   * — against the run's first record.
   *
   * Called BEFORE the audit and OUTSIDE its try: a baseline file that exists but cannot be
   * trusted throws RegressionBaselineError, which must reach the outer catch and escalate the run.
   * It is never read as "no baseline" — that would quietly lower the bar.
   */
  const gate2Reference = (round: number): number | undefined =>
    regressionReference(state.executionGateHistory, round === 0 ? readRegressionBaseline(cwd) : undefined);

  /** Record and commit one Gate 2 evaluation, from the audit's own parse of the test output. */
  const recordGate2 = (round: number, decision: ExecutionGateDecision, referenceCount: number | undefined) => {
    const stats = decision.testStats;
    state = commit(
      recordExecutionGate(state, {
        round,
        total: stats?.total ?? 0,
        passed: stats?.passed ?? 0,
        failed: stats?.failed ?? 0,
        passRate: decision.passRate,
        canAdvance: decision.canAdvance,
        referenceCount
      })
    );
  };

  /** What the Stage 4 gate judges "No Regressions" on: the latest Gate 2 record, and its reference. */
  const latestGate2 = (): HarnessMeasurements => {
    const history = state.executionGateHistory ?? [];
    const latest = history[history.length - 1];
    if (!latest) return {};
    const execution: ExecutionMeasurement = {
      total: latest.total,
      passed: latest.passed,
      failed: latest.failed,
      passRate: latest.passRate
    };
    return { execution, regressionReferenceCount: latest.referenceCount };
  };

  /**
   * Record non-blocking findings and commit (AC-17). IMPORTANT criteria no longer block; this is
   * where what they found goes instead, so it is never silently dropped.
   */
  const recordFindings = (stage: number, source: string, messages: string[]) => {
    if (messages.length === 0) return;
    for (const message of messages) log(`  ⚠️  [${source}] ${message}`);
    state = commit(recordImportantFindings(state, stage, source, messages));
  };

  /** Evaluate a stage gate against this run's evidence, and keep its IMPORTANT findings. */
  const stageGate = async (
    stage: number,
    extra?: {
      loops?: { backend?: number; frontend?: number };
      knowledgeStored?: boolean;
      harness?: HarnessMeasurements;
    }
  ): Promise<StageAdvancementDecision> => {
    const decision = await checkStageGate(stage, cwd, outputs, { ...extra, artifactDir });
    recordFindings(stage, 'stage-gate', decision.importantFindings);
    return decision;
  };

  /** What every prompt builder needs; prompts are built at invocation time (agent-prompts.ts). */
  const promptCtx: PromptContext = { cwd, artifactDir, featureDescription: options.featureDescription };

  /** Render a harness document into the run dir (only) and log where it went. */
  const writeDocument = (name: HarnessRenderedArtifact, content: string) => {
    log(`  📄 harness → ${writeHarnessDocument(cwd, artifactDir, name, content)}`);
  };

  /** A checkpoint that actually blocks. Fails closed when no approver is configured. */
  const checkpoint = async (definition: CheckpointDefinition, summary: string): Promise<boolean> => {
    const { name, stage } = definition;
    log(`⏸️  ${name}`);

    if (!options.approveCheckpoint) {
      state = recordEscalation(
        state,
        stage,
        'human',
        'MANUAL',
        `${name} requires human approval, but no approver is configured. ` +
          `Pass approveCheckpoint, or run the CLI with --yes to approve automatically.`
      );
      return false;
    }

    const approved = await options.approveCheckpoint({ name, stage, summary });
    if (!approved) {
      state = recordEscalation(state, stage, 'human', 'MANUAL', `${name} was rejected.`);
      return false;
    }

    state = recordCheckpointApproval(state, stage, name);
    log(`✅ ${name} approved`);
    return true;
  };

  // ==========================================================================================
  // Builders and the gates a validator round re-runs (D-9)
  //
  // Each helper returns the finished state when the run must stop, and undefined (or the
  // builder's output) when it may continue. They are used by Stage 3 AND by every validator
  // round, so a round is judged by exactly the code that judged the original build.
  // ==========================================================================================

  /** Attempts each builder used in its most recent loop: what the Stage 3 gate's loop criterion reads. */
  const lastAttempts: { backend?: number; frontend?: number } = {};

  /**
   * Run one builder for up to MAX_BUILDER_ATTEMPTS attempts in one phase: the Stage 3 build, or
   * one validator round. Each attempt is counted in state and committed BEFORE the invocation
   * (AC-70). Records keep stage 3 and carry the phase; escalations use the stage the RUN is in —
   * 3 while building, 4 during a validator round (AC-33).
   */
  const runBuilderLoop = async <H extends BuilderHalf>(
    half: H,
    run: BuilderRun
  ): Promise<{ output: BuilderOutputFor<H> } | { finished: FeatureState }> => {
    const agent = BUILDER_AGENT[half];
    const label = half === 'backend' ? 'Backend' : 'Frontend';
    const inRound = run.phase === 'validator-round';
    const escalationStage = inRound ? 4 : 3;
    const where = inRound ? ` in validator round ${run.round}` : '';
    const phase: StepPhase = inRound ? { phase: 'validator-round', round: run.round } : { phase: 'stage3' };
    const validatorRound: ValidatorRoundFailure | undefined = inRound
      ? { kind: 'validator', round: run.round, maxRounds: MAX_VALIDATOR_ROUNDS, issues: run.issues }
      : undefined;
    /** Carried into the next attempt's prompt — the only channel between two fresh contexts. */
    let failure: BuilderFailure | undefined;

    for (let attempt = 1; attempt <= MAX_BUILDER_ATTEMPTS; attempt++) {
      log(`${label} Builder${where}: Attempt ${attempt}/${MAX_BUILDER_ATTEMPTS}`);
      state = commit(
        recordBuilderAttempt(state, agent, inRound ? { phase: 'validator-round', round: run.round } : { phase: 'stage3' })
      );

      const candidate: BuilderOutputFor<H> = await invokeAgent({
        stage: 3,
        agent,
        prompt: builderPrompt(promptCtx, half, attempt, failure, validatorRound)
      });

      // A builder that declares itself blocked is believed. It is the one that just read the
      // code; when it says it cannot proceed, that is a finding, not noise.
      if (candidate.status === 'ESCALATE') {
        state = recordEscalation(
          state,
          escalationStage,
          agent,
          'CRITICAL_ISSUE',
          `${agent} refused to build${where}: ${candidate.details?.summary}`
        );
        return { finished: finish(state, 'ESCALATED', `${agent} declared the build blocked`) };
      }

      // FAILING TESTS ARE CHECKED BEFORE THE SCHEMA, and the order is the point.
      //
      // validateOutputSchema treats testsFailed > 0 as a schema error ("Builder has failing
      // tests: N") — it validates "acceptable work", not just envelope shape. So while the
      // schema check ran first, a builder that reported a failing test was classified as having
      // returned a malformed envelope, this branch `continue`d before reaching the analysis
      // below, and analyzeError() in the builder loop was DEAD CODE from the day it was written.
      //
      // A builder that honestly reports a failing test has satisfied its output contract
      // exactly. That is a work result with a designed remediation path, not a contract
      // violation, and it is handled here. The schema check below still catches every genuinely
      // malformed envelope, which is what it is for.
      if (candidate.details?.testing && candidate.details.testing.testsFailed > 0) {
        const failedTest = candidate.details.testing.failingTests?.[0];

        if (failedTest?.error) {
          // Classify, and CARRY THE CLASSIFICATION INTO THE NEXT ATTEMPT. The state record
          // alone is not enough: the next builder is a fresh context that cannot read it.
          const errorAnalysis = analyzeError(failedTest.error);
          failure = { kind: 'test', error: failedTest.error };
          state = recordLoopBack(
            state,
            3,
            agent,
            `${errorAnalysis.category}: ${failedTest.error}`,
            'FAIL',
            `Apply: ${errorAnalysis.fixClass}`,
            phase
          );
        } else {
          // Tests failed but the builder named none. Do not invent a diagnosis.
          failure = undefined;
          state = recordLoopBack(
            state,
            3,
            agent,
            `${candidate.details.testing.testsFailed} test(s) failing, none named`,
            'FAIL',
            undefined,
            phase
          );
        }
        continue;
      }

      const validation = validateOutputSchema(3, agent, candidate);
      if (!validation.valid) {
        failure = { kind: 'schema', error: validation.errors[0] };
        state = recordLoopBack(state, 3, agent, `Output schema invalid: ${validation.errors[0]}`, 'FAIL', undefined, phase);
        continue;
      }

      state = commit(recordAgentStep(state, 3, agent, 'PASS', candidate, undefined, phase));
      lastAttempts[half] = attempt;
      log(`✅ ${label} builder passed${where} (${attempt === 1 ? 'first try' : `after ${attempt} attempts`})`);
      return { output: candidate };
    }

    state = recordEscalation(
      state,
      escalationStage,
      agent,
      'MAX_LOOPS',
      `${label} builder exceeded max attempts (${MAX_BUILDER_ATTEMPTS})${where}`,
      { loopCount: MAX_BUILDER_ATTEMPTS }
    );
    return { finished: finish(state, 'ESCALATED', `${label} builder max loops exceeded${where}`) };
  };

  /**
   * Gate 1: every file the builders claim exists on disk — and none of them is the harness's own.
   * Over the MERGED claims during a validator round.
   */
  const materializationGate = async (escalationStage: 3 | 4): Promise<FeatureState | undefined> => {
    log('\n🔍 Verifying artifact materialization (checking if claimed files actually exist)...\n');

    // The same claim set buildStageContext uses: one implementation (stage-context.ts).
    const claimedFiles = claimedFilesFromBuilders(outputs.backend, outputs.frontend);

    // Everything under .factory/ was written by the harness. A builder claiming it would satisfy
    // this gate with the harness's own output, so such a claim is rejected before existence is
    // even checked: it names a file the builder did not write.
    const harnessOwned = claimsInsideFactoryDir(claimedFiles, cwd);
    if (harnessOwned.length > 0) {
      log('\n❌ CRITICAL: Builders claimed files inside .factory/, which only the harness writes:\n');
      harnessOwned.forEach(p => log(`  ❌ ${p}`));
      state = recordEscalation(
        state,
        escalationStage,
        'harness',
        'HALLUCINATION_DETECTED',
        `${harnessOwned.length} claimed file(s) inside .factory/, which only the harness writes: ${harnessOwned.join(', ')}`,
        { blockers: harnessOwned.map(p => `${p} is inside .factory/; a builder cannot claim a harness-written file`) }
      );
      return finish(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files inside .factory/');
    }

    const artifactAudit = await verifyArtifactMaterialization(3, 'builders', claimedFiles, cwd);

    log(generateMaterializationReport(artifactAudit));

    if (!artifactAudit.allMaterialized) {
      log('\n❌ CRITICAL: Hallucination detected!\n');
      log(`${artifactAudit.missingArtifacts.length} claimed files do not exist on disk:`);
      artifactAudit.missingArtifacts.forEach(f => {
        log(`  ❌ ${f.path}`);
      });

      state = recordEscalation(
        state,
        escalationStage,
        'harness',
        'HALLUCINATION_DETECTED',
        `${artifactAudit.missingArtifacts.length} claimed files not materialized`,
        { missingFiles: artifactAudit.missingArtifacts.map(f => f.path) }
      );
      return finish(state, 'ESCALATED', 'Artifact materialization failed: builders claimed files that do not exist');
    }

    log(`\n✅ All ${claimedFiles.length} artifacts verified to exist on disk\n`);
    return undefined;
  };

  /** The Stage 3 gate, on whatever the builders' outputs now are (merged, in a round — I-8). */
  const stage3Gate = async (escalationStage: 3 | 4): Promise<FeatureState | undefined> => {
    const decision = await stageGate(3, { loops: { ...lastAttempts } });
    if (decision.canAdvance) return undefined;

    state = recordEscalation(
      state,
      escalationStage,
      'harness',
      'CRITICAL_ISSUE',
      `Stage 3 gate failed: ${decision.reason}`,
      { blockers: decision.blockers }
    );
    return finish(state, 'ESCALATED', decision.reason);
  };

  /** Gate 1.5. Always a Stage 4 gate: it runs at the start of Stage 4 and in every validator round. */
  const infrastructureGate = async (): Promise<FeatureState | undefined> => {
    log('\n🏗️  Verifying infrastructure prerequisites (npm scripts, database, config)...\n');

    // FAILS CLOSED (AC-5). A gate that could not run has verified nothing, so it is an escalation,
    // never a warning followed by the Test Verifier. Only the audit and its judgement sit inside
    // the try: a failure to RECORD the escalation must still reach the outer catch untouched.
    let infrastructureAudit: InfrastructureAudit;
    let infrastructureDecision: InfrastructureGateDecision;
    try {
      infrastructureAudit = await gates.auditInfrastructure(cwd);
      infrastructureDecision = validateInfrastructureGate(infrastructureAudit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`❌ Infrastructure verification could not run: ${message}`);
      state = recordEscalation(
        state,
        4,
        'harness',
        'INFRASTRUCTURE_FAILURE',
        `Infrastructure verification could not run: ${message}`,
        { remediation: 'Fix whatever stopped the infrastructure audit from running, then re-run the feature.' }
      );
      return finish(state, 'ESCALATED', `Infrastructure verification error: ${message}`);
    }

    log(generateInfrastructureReport(infrastructureAudit));

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
      return finish(state, 'ESCALATED', `Infrastructure not ready: ${infrastructureDecision.blockers[0]}`);
    }

    // Non-blocking, but never dropped: each warning becomes an IMPORTANT finding (AC-17).
    recordFindings(4, 'gate-1.5', infrastructureDecision.warnings);

    log(`\n✅ Infrastructure ready: All prerequisites verified\n`);
    return undefined;
  };

  /**
   * Gate 2, evaluation `round`: 0 right after the Test Verifier, N in validator round N — judged
   * against `.factory/baseline.json` for round 0 and the run's first record afterwards (D-12).
   */
  const executionGate = async (round: number): Promise<FeatureState | undefined> => {
    log('\n🔍 Verifying test execution (ensuring tests actually ran and passed 100%)...\n');

    // Outside the try: an untrustworthy baseline must escalate the run, never read as "none".
    const referenceCount = gate2Reference(round);

    // FAILS CLOSED (AC-6, AC-7). A Gate 2 that could not run escalates; it never hands an
    // unverified build to the Validator for "human review" to catch.
    let executionAudit: ExecutionAudit;
    let executionDecision: ExecutionGateDecision;
    try {
      executionAudit = await gates.auditExecution(cwd);
      executionDecision = validateExecutionGate(executionAudit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`❌ Execution verification could not run: ${message}`);
      state = recordEscalation(
        state,
        4,
        'harness',
        'EXECUTION_FAILURE',
        `Execution verification could not run: ${message}`,
        { remediation: 'Fix whatever stopped the execution audit from running, then re-run the feature.' }
      );
      return finish(state, 'ESCALATED', `Execution verification error: ${message}`);
    }

    log(generateExecutionReport(executionAudit));

    // Every evaluation is recorded — a blocking one too, so the run's record shows what Gate 2
    // actually counted.
    recordGate2(round, executionDecision, referenceCount);

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
      return finish(state, 'ESCALATED', `Test execution failed: ${executionDecision.blockers[0]}`);
    }

    // Skipped/todo tests and skipped build/dev checks: non-blocking, recorded (I-10).
    recordFindings(4, 'gate-2', executionDecision.warnings);

    log(`\n✅ Execution checks passed: every test that ran passed; no build or dev-server failure\n`);
    return undefined;
  };

  try {
    log(`Starting Feature Factory: ${state.featureName}`);
    log(`Feature ID: ${state.featureId}`);

    // Previous runs left their briefs in .factory/. The agents READ this project — leaving four
    // contradictory "approved" specs lying around and then asking a builder to implement "the
    // approved spec" is how you get an agent that correctly refuses to do anything.
    const stale = clearStaleArtifacts(cwd, state.featureId);
    if (stale.length > 0) {
      log(`  🧹 Removed ${stale.length} artifact director${stale.length === 1 ? 'y' : 'ies'} from previous runs`);
    }

    // ========================================================================
    // SATISFY-OR-RUN: stages 1 and 2
    //
    // If a spec was supplied from upstream (a Tier 1 Decomposer, a human, anything), we do not
    // re-plan the feature — but we do NOT take its word for it either. It goes through the same
    // canAdvanceStage() the Story Writer's own output goes through. Being upstream buys no
    // leniency: the gate is the contract.
    //
    // If nothing was supplied, this runs exactly the code path it always has. That is the
    // invariant: Feature Factory stays runnable standalone on an existing project, with no Tier 1
    // artifacts, and the no-spec path is byte-for-byte unchanged.
    // ========================================================================

    if (options.preSuppliedSpec) {
      phase('Stages 1-2: Pre-supplied spec');

      // Into the run dir, where the builders' prompts point (I-11).
      const acceptance = await acceptFeatureSpec(options.preSuppliedSpec, cwd, artifactDir);

      if (!acceptance.accepted) {
        // Deliberately NOT falling back to running stages 1-2 ourselves. A spec that fails the
        // gate means the upstream producer is broken, and silently re-planning around it would
        // hide that — the Decomposer would look like it worked while Tier 2 quietly did its job.
        state = recordEscalation(
          state,
          2,
          'tier-1',
          'CRITICAL_ISSUE',
          `Pre-supplied spec rejected by the stage gates (${acceptance.passRate.toFixed(0)}%).`,
          { blockers: acceptance.blockers }
        );
        return finish(state, 'ESCALATED', 'Pre-supplied spec did not pass the gates');
      }

      outputs.researcher = options.preSuppliedSpec.researcher;
      outputs.story = options.preSuppliedSpec.story;
      outputs.spec = options.preSuppliedSpec.spec;

      state = commit(recordAgentStep(state, 2, 'tier-1', 'PASS', options.preSuppliedSpec.spec));
      log(`✅ Pre-supplied spec accepted — skipping Discover and Plan`);

      state = commit(advanceToStage(state, 3));
    } else {
      // ========================================================================
      // STAGE 1: DISCOVER (Researcher)
      // ========================================================================

      phase('Stage 1: Discover');

      const researcherOutput = await invokeAgent({
        stage: 1,
        agent: '01-researcher',
        prompt: researcherPrompt(promptCtx)
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
        return finish(state, 'ESCALATED', 'Schema validation failed at Stage 1');
      }

      if (agentDeclaredBlocked(researcherOutput)) {
        state = recordEscalation(
          state,
          1,
          '01-researcher',
          'CRITICAL_ISSUE',
          `01-researcher reported ${researcherOutput.status}: ${researcherOutput.details.summary}`
        );
        return finish(state, 'ESCALATED', `01-researcher declared the feature blocked`);
      }

      outputs.researcher = researcherOutput;
      persist({ researcher: researcherOutput });
      state = commit(recordAgentStep(state, 1, '01-researcher', 'PASS', researcherOutput));

      // Check Stage 1 gate
      const stage1Decision = await stageGate(1);
      if (!stage1Decision.canAdvance) {
        state = recordEscalation(
          state,
          1,
          'harness',
          'CRITICAL_ISSUE',
          `Stage 1 gate failed: ${stage1Decision.reason}`,
          { blockers: stage1Decision.blockers }
        );
        return finish(state, 'ESCALATED', stage1Decision.reason);
      }

      log(`✅ Stage 1 passed: ${stage1Decision.passRate.toFixed(0)}% criteria met`);
      state = commit(advanceToStage(state, 2));

      // ========================================================================
      // STAGE 2: PLAN (Story Writer + Spec Writer)
      // ========================================================================

      phase('Stage 2: Plan');

      // Story Writer
      const storyOutput = await invokeAgent({
        stage: 2,
        agent: '02-story-writer',
        prompt: storyPrompt(promptCtx)
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
        return finish(state, 'ESCALATED', 'Story schema validation failed');
      }

      if (agentDeclaredBlocked(storyOutput)) {
        state = recordEscalation(
          state,
          2,
          '02-story-writer',
          'CRITICAL_ISSUE',
          `02-story-writer reported ${storyOutput.status}: ${storyOutput.details.summary}`
        );
        return finish(state, 'ESCALATED', `02-story-writer declared the feature blocked`);
      }

      outputs.story = storyOutput;
      persist({ story: storyOutput });   // <- the Spec Writer must be able to READ this
      state = commit(recordAgentStep(state, 2, '02-story-writer', 'PASS', storyOutput));

      if (!(await checkpoint(CHECKPOINTS.STORY, storyOutput.details.summary))) {
        return finish(state, 'ESCALATED', 'Story not approved');
      }

      // Spec Writer
      const specOutput = await invokeAgent({
        stage: 2,
        agent: '03-spec-writer',
        prompt: specPrompt(promptCtx)
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
        return finish(state, 'ESCALATED', 'Spec schema validation failed');
      }

      if (agentDeclaredBlocked(specOutput)) {
        state = recordEscalation(
          state,
          2,
          '03-spec-writer',
          'CRITICAL_ISSUE',
          `03-spec-writer reported ${specOutput.status}: ${specOutput.details.summary}`
        );
        return finish(state, 'ESCALATED', `03-spec-writer declared the feature blocked`);
      }

      outputs.spec = specOutput;
      persist({ spec: specOutput });
      state = commit(recordAgentStep(state, 2, '03-spec-writer', 'PASS', specOutput));

      // Check Stage 2 gate
      const stage2Decision = await stageGate(2);
      if (!stage2Decision.canAdvance) {
        state = recordEscalation(
          state,
          2,
          'harness',
          'CRITICAL_ISSUE',
          `Stage 2 gate failed: ${stage2Decision.reason}`,
          { blockers: stage2Decision.blockers }
        );
        return finish(state, 'ESCALATED', stage2Decision.reason);
      }

      log(`✅ Stage 2 passed: Story & Spec approved`);

      if (!(await checkpoint(CHECKPOINTS.BRIEF, specOutput.details.summary))) {
        return finish(state, 'ESCALATED', 'Technical brief not approved');
      }

      state = commit(advanceToStage(state, 3));
    }


    // ========================================================================
    // STAGE 3: EXECUTE (Backend Builder + Frontend Builder with loop-backs)
    // ========================================================================

    phase('Stage 3: Execute');

    const backendRun = await runBuilderLoop('backend', { phase: 'stage3' });
    if ('finished' in backendRun) return backendRun.finished;
    outputs.backend = backendRun.output;

    // Rendered from the structured output, for the agents downstream (AC-25). Run dir only; never
    // a claimed file — the materialization audit below sees only the builders' filesModified.
    writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(outputs.backend));
    writeDocument('API_CONTRACT.md', renderApiContract(outputs.backend));

    // ...the Frontend Builder only if the approved brief actually calls for UI (frontend-files.ts).
    if (specRequiresFrontend(outputs.spec)) {
      const frontendRun = await runBuilderLoop('frontend', { phase: 'stage3' });
      if ('finished' in frontendRun) return frontendRun.finished;
      outputs.frontend = frontendRun.output;
      writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(outputs.frontend));
    } else {
      log('⏭️  Frontend Builder skipped — the approved brief specifies no UI work.');
    }

    // ========================================================================
    // ARTIFACT MATERIALIZATION CHECK (Reality Verification)
    // ========================================================================
    // Prevent hallucinations: verify that claimed files actually exist on disk

    const stage3Materialization = await materializationGate(3);
    if (stage3Materialization) return stage3Materialization;

    const stage3Failure = await stage3Gate(3);
    if (stage3Failure) return stage3Failure;

    log(`✅ Stage 3 passed: Implementation complete`);
    state = commit(advanceToStage(state, 4));

    // ========================================================================
    // INFRASTRUCTURE VERIFICATION GATE (Reality Check for Readiness)
    // ========================================================================
    // Verify npm scripts, database setup, TypeScript config before running tests

    const infrastructureFailure = await infrastructureGate();
    if (infrastructureFailure) return infrastructureFailure;

    // ========================================================================
    // STAGE 4: VERIFY (Test Verifier → Gate 2 → Validator, with validator rounds)
    // ========================================================================

    phase('Stage 4: Verify');

    // Test Verifier
    const testOutput = await invokeAgent({
      stage: 4,
      agent: '06-test-verifier',
      prompt: testVerifierPrompt(promptCtx)
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
      return finish(state, 'ESCALATED', 'Test verifier schema validation failed');
    }

    // The Test Verifier's verdict is believed (AC-19). Anything but a clean PASS — status FAIL,
    // LOOP_BACK (I-6) or ESCALATE, a failing test, or a CRITICAL issue — stops here: the step is
    // not recorded PASS, Gate 2 does not run, and the Validator is never asked to bless it.
    const testVerdict = testVerifierVerdict(testOutput);
    if (!testVerdict.passed) {
      state = commit(
        recordAgentStep(state, 4, '06-test-verifier', testOutput.status === 'ESCALATE' ? 'ESCALATED' : 'FAIL', testOutput)
      );
      state = recordEscalation(
        state,
        4,
        '06-test-verifier',
        'CRITICAL_ISSUE',
        `06-test-verifier did not pass: ${testVerdict.reasons.join('; ')}`,
        { failingTests: testVerdict.failingCriteria, issues: testVerdict.issues }
      );
      return finish(state, 'ESCALATED', `06-test-verifier did not pass: ${testVerdict.reasons[0]}`);
    }

    outputs.test = testOutput;
    // Rendered by the harness from the structured output the gate judges (I-5). Run dir only.
    writeDocument('TEST_REPORT.md', renderTestReport(testOutput));
    state = commit(recordAgentStep(state, 4, '06-test-verifier', 'PASS', testOutput));

    // ========================================================================
    // GATE 2 → VALIDATOR, AND THE BOUNDED VALIDATOR LOOP-BACK (D-9)
    // ========================================================================
    // Round 0 is the evaluation right after the Test Verifier. A fixable CRITICAL issue the
    // Validator pins to a builder's file sends that builder back, then Gates 1, 3, 1.5 and 2
    // re-run before the Validator is asked again — at most MAX_VALIDATOR_ROUNDS times. The run
    // stays in Stage 4 throughout: it never claims to be back in Stage 3 (AC-33).

    let round = 0;
    for (;;) {
      const executionFailure = await executionGate(round);
      if (executionFailure) return executionFailure;

      const validatorOutput = await invokeAgent({
        stage: 4,
        agent: '07-validator',
        prompt: validatorPrompt(promptCtx)
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
        return finish(state, 'ESCALATED', 'Validator schema validation failed');
      }

      // The Validator's own document goes into the run dir now — the stage gate no longer persists.
      persist({ validator: validatorOutput });
      outputs.validator = validatorOutput;

      const validatorIssues: ValidatorIssue[] = Array.isArray(validatorOutput.details.issues)
        ? validatorOutput.details.issues
        : [];

      // ESCALATE is believed, and is never recorded PASS (AC-20).
      if (validatorOutput.status === 'ESCALATE') {
        state = commit(recordAgentStep(state, 4, '07-validator', 'ESCALATED', validatorOutput));
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'CRITICAL_ISSUE',
          `07-validator escalated: ${validatorOutput.details.summary}`,
          { issues: validatorIssues.map(i => i.message) }
        );
        return finish(state, 'ESCALATED', '07-validator declared the work blocked');
      }

      const critical = criticalIssues(validatorIssues);

      if (critical.length === 0) {
        // FAIL or LOOP_BACK with no CRITICAL issue to act on: the Validator says the work is not
        // acceptable but names nothing fixable. Fail closed (I-6).
        if (validatorOutput.status !== 'PASS') {
          state = commit(recordAgentStep(state, 4, '07-validator', 'FAIL', validatorOutput));
          state = recordEscalation(
            state,
            4,
            '07-validator',
            'CRITICAL_ISSUE',
            `07-validator reported ${validatorOutput.status} with no CRITICAL issue: ${validatorOutput.details.summary}`,
            { issues: validatorIssues.map(i => i.message) }
          );
          return finish(state, 'ESCALATED', `07-validator reported ${validatorOutput.status}`);
        }

        state = commit(recordAgentStep(state, 4, '07-validator', 'PASS', validatorOutput));
        recordFindings(
          4,
          '07-validator',
          validatorIssues
            .filter(i => i.severity === 'IMPORTANT')
            .map(i => `${i.file ? `[${i.file}${i.line !== undefined ? `:${i.line}` : ''}] ` : ''}${i.message}`)
        );
        break;
      }

      state = commit(recordAgentStep(state, 4, '07-validator', 'FAIL', validatorOutput));

      // The bound (AC-32): the Validator has now judged MAX_VALIDATOR_ROUNDS rounds of fixes.
      if (round === MAX_VALIDATOR_ROUNDS) {
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'MAX_LOOPS',
          `${critical.length} CRITICAL issue(s) remain after ${MAX_VALIDATOR_ROUNDS} rounds`,
          { issues: critical.map(describeIssue), loopCount: round }
        );
        return finish(state, 'ESCALATED', `CRITICAL issues remain after ${MAX_VALIDATOR_ROUNDS} rounds`);
      }

      const routing = routeCriticalIssues(
        critical,
        {
          backend: (outputs.backend?.details.filesModified ?? []).map(f => f.path),
          frontend: (outputs.frontend?.details.filesModified ?? []).map(f => f.path)
        },
        cwd
      );

      // Anything the harness cannot hand to an owning builder goes to a human — all of it, with
      // the reason, and before any builder spends a round on the part that could be routed (AC-31).
      if (routing.unroutable.length > 0) {
        const reasons = new Map<ValidatorIssue, UnroutableReason>(routing.unroutable.map(u => [u.issue, u.reason]));
        state = recordEscalation(
          state,
          4,
          '07-validator',
          'CRITICAL_ISSUE',
          `${routing.unroutable.length} of ${critical.length} CRITICAL issue(s) cannot be routed to a builder`,
          {
            issues: critical.map(i =>
              reasons.has(i) ? `${describeIssue(i)} (unroutable: ${reasons.get(i)})` : describeIssue(i)
            )
          }
        );
        return finish(state, 'ESCALATED', 'Validator CRITICAL issues cannot be routed to a builder');
      }

      round++;
      state = commit(recordValidatorRound(state, round));
      log(`\n↩️  Validator round ${round} of ${MAX_VALIDATOR_ROUNDS}: ${critical.length} CRITICAL issue(s) back to their builders\n`);

      if (routing.backend.length > 0) {
        const fix = await runBuilderLoop('backend', { phase: 'validator-round', round, issues: routing.backend });
        if ('finished' in fix) return fix.finished;
        outputs.backend = outputs.backend ? mergeBuilderOutput(outputs.backend, fix.output) : fix.output;
        writeDocument('BACKEND_SUMMARY.md', renderBackendSummary(outputs.backend));
        writeDocument('API_CONTRACT.md', renderApiContract(outputs.backend));
      }

      if (routing.frontend.length > 0) {
        const fix = await runBuilderLoop('frontend', { phase: 'validator-round', round, issues: routing.frontend });
        if ('finished' in fix) return fix.finished;
        outputs.frontend = outputs.frontend ? mergeBuilderOutput(outputs.frontend, fix.output) : fix.output;
        writeDocument('FRONTEND_SUMMARY.md', renderFrontendSummary(outputs.frontend));
      }

      // The round is judged by the same gates as the original build, over the merged outputs.
      const roundMaterialization = await materializationGate(4);
      if (roundMaterialization) return roundMaterialization;

      const roundStage3 = await stage3Gate(4);
      if (roundStage3) return roundStage3;

      const roundInfrastructure = await infrastructureGate();
      if (roundInfrastructure) return roundInfrastructure;
    }

    // Check Stage 4 gate. "No Regressions" judges the harness's own latest Gate 2 count against
    // its reference — never anything the Validator says about regressions (AC-22).
    const stage4Decision = await stageGate(4, { harness: latestGate2() });
    if (!stage4Decision.canAdvance) {
      state = recordEscalation(
        state,
        4,
        'harness',
        'CRITICAL_ISSUE',
        `Stage 4 gate failed: ${stage4Decision.reason}`,
        { blockers: stage4Decision.blockers }
      );
      return finish(state, 'ESCALATED', stage4Decision.reason);
    }

    log(`✅ Stage 4 passed: All tests & validations passed`);
    state = commit(advanceToStage(state, 5));

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
      prompt: consolidatorPrompt(promptCtx)
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
      return finish(state, 'ESCALATED', 'Consolidator schema validation failed');
    }

    // Into the run dir, like every other read-only agent's documents — never the project root.
    persist({ consolidator: consolidatorOutput });
    outputs.consolidator = consolidatorOutput;
    state = commit(recordAgentStep(state, 5, '08-feature-consolidator', 'PASS', consolidatorOutput));

    // Check Stage 5 gate (logged only in A-1; its findings are still recorded)
    const stage5Decision = await stageGate(5, { knowledgeStored: true });
    if (!stage5Decision.canAdvance) {
      log(`⚠️  Stage 5 gate incomplete: ${stage5Decision.reason}`);
    }

    log(`✅ Stage 5 complete: Patterns consolidated and stored`);

    // ========================================================================
    // COMPLETION
    // ========================================================================

    state = finish(state, 'SUCCESS', 'All 5 stages completed successfully');

    log(`\n✅ Feature Factory Complete: ${state.featureName}`);
    log(`Total time: ${Math.round(state.metrics.totalTime / 1000 / 60)} minutes`);
    log(`Total loop-backs: ${state.metrics.loopCount}`);

    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The record itself is what failed. There is nowhere to write an escalation TO, so do not
    // pretend to record one — rethrow, and let the CLI exit non-zero with the real reason. The
    // alternative is returning a state that says ESCALATED while no file on disk says anything,
    // which is the one outcome worse than stopping: an unrecorded run that looks recorded.
    if (error instanceof StatePersistenceError) {
      log(`❌ ${message}`);
      throw error;
    }

    log(`❌ Orchestration failed: ${message}`);
    state = recordEscalation(
      state,
      state.currentStage,
      'orchestrator',
      'MANUAL',
      `Orchestration error: ${message}`
    );
    return finish(state, 'ESCALATED', message);
  }
}

/**
 * The Test Verifier's verdict (AC-19, I-6). PASS only when the agent says PASS, no test failed,
 * and it raised no CRITICAL issue. Pure: reads the output, decides, names why.
 */
function testVerifierVerdict(output: any): {
  passed: boolean;
  reasons: string[];
  failingCriteria: string[];
  issues: string[];
} {
  const details = output?.details ?? {};
  const failed: number = details.testExecution?.failed ?? 0;
  const issues: Array<{ acId?: string; severity?: string; issue?: string }> = Array.isArray(details.issues)
    ? details.issues
    : [];
  const critical = issues.filter(i => i.severity === 'CRITICAL');

  const reasons: string[] = [];
  if (output?.status !== 'PASS') reasons.push(`status ${output?.status}`);
  if (failed > 0) reasons.push(`${failed} test(s) failed`);
  if (critical.length > 0) reasons.push(`${critical.length} CRITICAL issue(s)`);

  const results: Array<{ acId?: string; status?: string }> = details.acceptanceTests?.results ?? [];
  const failingCriteria = [
    ...results.filter(r => r.status !== 'TESTED' && r.status !== 'NOT_COVERABLE').map(r => `${r.acId} (${r.status})`),
    ...(details.testExecution?.failingTests ?? []).map((t: { name: string; error: string }) => `${t.name}: ${t.error}`)
  ];

  return {
    passed: reasons.length === 0,
    reasons,
    failingCriteria,
    issues: issues.map(i => `[${i.severity}] ${i.acId}: ${i.issue}`)
  };
}

type BuilderHalf = 'backend' | 'frontend';
type BuilderOutputFor<H extends BuilderHalf> = H extends 'backend' ? BackendBuilderOutput : FrontendBuilderOutput;

const BUILDER_AGENT: Readonly<Record<BuilderHalf, BuilderAgent>> = {
  backend: '04-backend-builder',
  frontend: '05-frontend-builder'
};

/** Which phase a builder loop runs in: the Stage 3 build, or validator round `round` with its routed issues. */
type BuilderRun = { phase: 'stage3' } | { phase: 'validator-round'; round: number; issues: ValidatorIssue[] };

/** What the harness itself measured, for the Stage 4 gate (D-5). Never supplied by an agent. */
type HarnessMeasurements = NonNullable<BuildStageContextInput['harness']>;

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
  extra: {
    loops?: { backend?: number; frontend?: number };
    knowledgeStored?: boolean;
    artifactDir: string;
    harness?: HarnessMeasurements;
  }
): Promise<StageAdvancementDecision> {
  // This used to call persistArtifacts(outputs, cwd) with NO run directory — so any document not
  // already persisted (the Validator's, the Consolidator's) would have been written into the
  // project root. Every agent's documents are now persisted once, right after it returns, into
  // the run directory. A gate only reads.
  const contract = stageContracts[stage];
  const context = buildStageContext({
    stage,
    cwd,
    outputs,
    loops: extra.loops,
    knowledgeStored: extra.knowledgeStored,
    artifactDir: extra.artifactDir,
    harness: extra.harness
  });

  return canAdvanceStage(stage, contract, context);
}
