/**
 * `--consolidate <id>` as a library workflow (A-2 D-10; AC-28 exception, AC-47, AC-48, AC-76).
 *
 * The Feature Consolidator used to run inline at the end of every run, after a log line saying it
 * was "waiting for PR merge" — it never waited. A run now ends at CHECKPOINT 3 (AC-44), and the
 * Consolidator runs only when the operator asks, on a finished SUCCESS run:
 *
 *  1. The id must be safe, and the run is found live (`.factory/<id>/`) or archived
 *     (`.factory/_archive/<id>/`) by findRun. Unknown → RUN_NOT_FOUND; anything but SUCCESS →
 *     NOT_SUCCESS. Refusals are thrown before anything is invoked or written.
 *  2. 08 is invoked with that run's directory named as the ONLY directory it may read — the single
 *     exception to the archive rule (AC-28) — and pointed at the run's state.json for timings.
 *     The invocation is timed and committed like every orchestrator invocation (D-13); one that
 *     throws records nothing.
 *  3. A valid output's documents are persisted into THAT directory through the safe writer. An
 *     output that fails the schema, declares FAIL/ESCALATE or names an unsafe document is a FAIL
 *     step, and nothing of it is written.
 *  4. The step is recorded at Stage 5 and the run moves to currentStage 5 (I-18). It stays SUCCESS:
 *     consolidating never changes how the run ended.
 *  5. The Stage 5 gate judges the two documents and nothing memory-related (AC-48). A rejected
 *     output is not judged at all: the gate would only see whatever an earlier consolidation left
 *     behind, so the result is a failed decision naming why (fails closed).
 *
 * State is saved with saveStateIn(runDir), so an archived run is updated where it lies. Nothing is
 * moved, deleted, committed or pushed.
 */

import { join } from 'path';

import { consolidatorPrompt, PromptContext } from '../../harness/agent-prompts';
import { FeatureFactoryAgentOutput, validateOutputSchema } from '../../harness/agent-output-schema';
import { ARCHIVE_DIRNAME, findRun } from '../../harness/run-directory';
import { classifyRun, RunRefusedError } from '../../harness/run-lifecycle';
import { rebuildOutputs } from '../../harness/run-progress';
import { buildStageContext, persistArtifacts, UnsafeArtifactPathError } from '../../harness/stage-context';
import { canAdvanceStage, StageAdvancementDecision, stageContracts } from '../../harness/stage-gates';
import { saveStateIn, stateFilePathIn } from '../../harness/state-store';
import {
  advanceToStage,
  FeatureState,
  recordAgentInvocation,
  recordAgentStep,
  recordImportantFindings
} from '../../harness/state-tracker';
import { AgentInvoker } from '../../runner/invoke-agent';

const CONSOLIDATOR = '08-feature-consolidator';
const STAGE = 5;

export interface ConsolidationOptions {
  /** The target project whose `.factory/` holds the run. */
  cwd: string;
  /** The run to consolidate; must pass isSafeRunId. */
  runId: string;
  invoke: AgentInvoker;
  logger?: (message: string) => void;
}

export interface ConsolidationResult {
  /** The run's state after consolidation, as saved in `runDir`. */
  state: FeatureState;
  location: 'live' | 'archive';
  /** Absolute path of the run's directory, where the documents and state.json were written. */
  runDir: string;
  decision: StageAdvancementDecision;
  /** `decision.canAdvance`. */
  passed: boolean;
}

/** Why a returned output was not accepted, or undefined when it was. */
function rejection(output: unknown): string | undefined {
  const validation = validateOutputSchema(STAGE, CONSOLIDATOR, output);
  if (!validation.valid) return `Consolidator output schema invalid: ${validation.errors[0]}`;

  // An agent that says it cannot proceed is believed, as in a run.
  const status = (output as FeatureFactoryAgentOutput).status;
  if (status === 'FAIL' || status === 'ESCALATE') return `The Consolidator declared ${status}.`;
  return undefined;
}

/** The decision for an output that was not accepted: nothing new to judge, so the gate fails. */
function rejectedDecision(reason: string): StageAdvancementDecision {
  return {
    canAdvance: false,
    passRate: 0,
    criteriaResults: {},
    blockers: [reason],
    importantFindings: [],
    missingArtifacts: [],
    recommendation: 'RETRY',
    reason: `Stage 5 gate not evaluated: ${reason}`
  };
}

/**
 * Consolidate a finished SUCCESS run (D-10). Throws RunRefusedError (INVALID_RUN_ID,
 * RUN_NOT_FOUND, NOT_SUCCESS, UNREADABLE_RUN) before anything is invoked or written; an invoker
 * error or StatePersistenceError reaches the caller.
 */
export async function consolidateRun(options: ConsolidationOptions): Promise<ConsolidationResult> {
  const { cwd, runId } = options;
  const log = options.logger ?? ((message: string) => console.log(`[FF] ${message}`));

  // findRun refuses an unsafe id (INVALID_RUN_ID) and an unreadable record (UNREADABLE_RUN).
  const found = findRun(cwd, runId);
  if (!found) {
    throw new RunRefusedError('RUN_NOT_FOUND', `No run ${runId} in ${join(cwd, '.factory')} or its ${ARCHIVE_DIRNAME}/.`);
  }
  const runClass = classifyRun(found.state);
  if (runClass !== 'SUCCESS') {
    throw new RunRefusedError('NOT_SUCCESS', `Run ${runId} is ${runClass}; only a SUCCESS run can be consolidated.`);
  }

  const { location, runDir } = found;
  let state = found.state;
  const save = (next: FeatureState): FeatureState => {
    saveStateIn(runDir, next);
    return next;
  };

  const artifactDir = location === 'live' ? `.factory/${runId}` : `.factory/${ARCHIVE_DIRNAME}/${runId}`;
  const ctx: PromptContext = {
    cwd,
    artifactDir,
    featureDescription: state.featureDescription ?? state.featureName
  };

  log(`\n=== Stage 5: Consolidate ${runId} (${location}) ===`);

  // Timed and committed like the orchestrator's timedInvoke (D-13). A throw records nothing.
  const started = new Date();
  const output = await options.invoke({
    stage: STAGE,
    agent: CONSOLIDATOR,
    prompt: consolidatorPrompt(ctx, { readableRunDir: runDir })
  });
  const completed = new Date();
  const timing = { startedAt: started.toISOString(), completedAt: completed.toISOString() };
  state = save(
    recordAgentInvocation(state, {
      stage: STAGE,
      agent: CONSOLIDATOR,
      ...timing,
      durationMs: completed.getTime() - started.getTime()
    })
  );

  let refused = rejection(output);
  if (refused === undefined) {
    try {
      // Into that run's directory only, through the no-follow writer; checked before any write.
      for (const { agent, path } of persistArtifacts({ consolidator: output }, cwd, artifactDir)) {
        log(`  📄 ${agent} → ${path}`);
      }
    } catch (error) {
      if (!(error instanceof UnsafeArtifactPathError)) throw error;
      refused = error.message;
    }
  }

  if (refused !== undefined) {
    log(`  ❌ ${refused}`);
    state = save(
      advanceToStage(recordAgentStep(state, STAGE, CONSOLIDATOR, 'FAIL', undefined, refused, undefined, timing), STAGE)
    );
    const decision = rejectedDecision(refused);
    log(`  📋 Run record: ${stateFilePathIn(runDir)}`);
    return { state, location, runDir, decision, passed: decision.canAdvance };
  }

  state = save(advanceToStage(recordAgentStep(state, STAGE, CONSOLIDATOR, 'PASS', output, undefined, undefined, timing), STAGE));

  // The run's outputs, rebuilt from its record — this consolidation's PASS included (D-2).
  const context = buildStageContext({ stage: STAGE, cwd, outputs: rebuildOutputs(state, cwd), artifactDir });
  const decision = await canAdvanceStage(STAGE, stageContracts[STAGE], context);

  if (decision.importantFindings.length > 0) {
    for (const finding of decision.importantFindings) log(`  ⚠️  [stage-gate] ${finding}`);
    state = save(recordImportantFindings(state, STAGE, 'stage-gate', decision.importantFindings));
  }

  log(decision.canAdvance ? `✅ Stage 5 passed: ${decision.reason}` : `❌ Stage 5 gate failed: ${decision.reason}`);
  log(`  📋 Run record: ${stateFilePathIn(runDir)}`);
  return { state, location, runDir, decision, passed: decision.canAdvance };
}
