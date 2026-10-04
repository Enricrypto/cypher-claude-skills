#!/usr/bin/env node
/**
 * Feature Factory CLI
 *
 *   npm run factory -- --feature "add a health check endpoint" [--cwd /path/to/project]
 *   npm run factory -- --feature "..." --resume <featureId>    # continue a run that stopped
 *
 * Exits 0 only when all five stages passed their gates. Any escalation exits 1 — so CI, or a
 * shell script, can trust the exit code rather than reading the log.
 */

import { resolve } from 'path';
import { createInterface } from 'readline';
import {
  CheckpointRequest,
  OrchestrationGates,
  runFeatureFactory
} from '../feature/workflows/feature-factory-orchestrator';
import { AgentInvoker, createSdkInvoker, SdkInvokerConfig } from './invoke-agent';
import { FeatureState, getRecommendedAction, getStateSummary, isResumable } from '../harness/state-tracker';
import { loadState, stateFilePath } from '../harness/state-store';

interface CliArgs {
  feature: string;
  name: string;
  cwd: string;
  model?: string;
  /** Approve every human checkpoint (CHECKPOINTS) without asking. Must be explicit — see below. */
  yes: boolean;
  /** A featureId from a previous run's `.factory/<id>/state.json`, to continue it. */
  resume?: string;
}

/**
 * Everything the CLI touches outside itself, passed in — the same injection the orchestrator
 * uses for `invoke`. The real main wires realCliDependencies(); tests wire fakes, so a full CLI
 * run needs no process, no TTY and no network.
 */
export interface CliDependencies {
  createInvoker: (config: SdkInvokerConfig) => AgentInvoker;
  /** Asked only when isTTY() is true and --yes was not given. */
  approver: (checkpoint: CheckpointRequest) => Promise<boolean>;
  isTTY: () => boolean;
  exit: (code: number) => void;
  log: (message: string) => void;
  error: (message: string) => void;
  /** Passed through to runFeatureFactory. Production leaves it unset: the real gates run. */
  gates?: Partial<OrchestrationGates>;
}

/** Ask a human on the terminal. Only ever called on a TTY (see checkpointApprover). */
async function askHuman(checkpoint: CheckpointRequest): Promise<boolean> {
  console.log(`\n⏸️  ${checkpoint.name}`);
  console.log(`\n${checkpoint.summary}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>(res => rl.question('   Approve? [y/N] ', res));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** The real dependencies: the SDK invoker, a readline prompt, the real TTY, exit and console. */
export function realCliDependencies(): CliDependencies {
  return {
    createInvoker: createSdkInvoker,
    approver: askHuman,
    isTTY: () => Boolean(process.stdin.isTTY),
    exit: code => process.exit(code),
    log: message => console.log(message),
    error: message => console.error(message)
  };
}

/**
 * The human checkpoints (CHECKPOINTS in the orchestrator).
 *
 * On a TTY we ask, and the run blocks until you answer. Without a TTY (CI, a pipe) there is
 * nobody to ask, so we FAIL CLOSED — the run escalates rather than approving itself.
 *
 * --yes is the only way to skip them, and it has to be typed. That is deliberate: a checkpoint
 * you can skip by forgetting to configure something is not a checkpoint. The orchestrator used
 * to log "Awaiting story approval" and then immediately approve itself, which meant the system
 * advertised a human-oversight guarantee it did not have.
 */
function checkpointApprover(
  yes: boolean,
  deps: CliDependencies
): (checkpoint: CheckpointRequest) => Promise<boolean> {
  if (yes) return async () => true;

  return async checkpoint => {
    if (!deps.isTTY()) {
      deps.error(
        `\n⏸️  ${checkpoint.name}\n` +
          `   No TTY, so there is nobody to ask. Re-run interactively, or pass --yes to approve\n` +
          `   all checkpoints automatically.`
      );
      return false;
    }
    return deps.approver(checkpoint);
  };
}

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);

    if (key === 'yes') {
      args.yes = 'true';
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Flag --${key} requires a value.`);
    }
    args[key] = value;
    i++;
  }

  const feature = args.feature;
  if (!feature) {
    throw new Error('Missing --feature. Usage: npm run factory -- --feature "<description>"');
  }

  return {
    feature,
    name: args.name ?? feature.slice(0, 60),
    cwd: resolve(args.cwd ?? process.cwd()),
    model: args.model,
    yes: args.yes === 'true',
    resume: args.resume
  };
}

/** Parse, run, report. Returns the exit code: 0 only on SUCCESS. */
async function execute(argv: string[], deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv);
  const { log, error } = deps;

  log(`Feature Factory`);
  log(`  feature: ${args.feature}`);
  log(`  project: ${args.cwd}\n`);

  const invoke = deps.createInvoker({
    cwd: args.cwd,
    model: args.model,
    log: message => log(message),
    onToolDenied: (agent, tool) => {
      // An agent reaching past its contract. Not fatal, but never silent.
      error(`  ⚠️  ${agent} attempted "${tool}", which its contract does not grant.`);
    }
  });

  if (args.yes) {
    log('  ⚠️  --yes: the human checkpoints will be approved automatically.\n');
  }

  // --resume continues a run whose record is on disk. A missing state file is a HARD error, not
  // a quiet fallback to a fresh run: the operator asked to continue specific work, and silently
  // starting over would re-run agents they believe are already done.
  let resumeFromState: FeatureState | undefined;
  if (args.resume) {
    resumeFromState = loadState(args.cwd, args.resume);

    if (!resumeFromState) {
      throw new Error(
        `No run ${args.resume} in ${args.cwd}. Expected ${stateFilePath(args.cwd, args.resume)}.`
      );
    }

    if (!isResumable(resumeFromState)) {
      throw new Error(
        `Run ${args.resume} already finished (${resumeFromState.completionStatus}). ` +
          `${getRecommendedAction(resumeFromState)}`
      );
    }

    log(`  ▶️  Resuming ${resumeFromState.featureName} at Stage ${resumeFromState.currentStage}`);
    log(`     ${getRecommendedAction(resumeFromState)}\n`);
  }

  const state = await runFeatureFactory({
    featureName: args.name,
    featureDescription: args.feature,
    cwd: args.cwd,
    resumeFromState,
    invoke,
    approveCheckpoint: checkpointApprover(args.yes, deps),
    gates: deps.gates,
    // The orchestrator's own default format, routed through the injected log.
    logger: message => log(`[FF] ${message}`)
  });

  log(getStateSummary(state));

  if (state.completionStatus !== 'SUCCESS') {
    error(`\n❌ BLOCKED: ${state.finalSummary}`);

    for (const escalation of state.escalations) {
      error(`\n  Stage ${escalation.stage} — ${escalation.reason} (${escalation.agent})`);
      error(`  ${escalation.context.message}`);
      for (const blocker of escalation.context.blockers ?? []) {
        error(`    - ${blocker}`);
      }
    }

    // The run left a full record. Say where, so the failure is inspectable rather than just
    // whatever survived in the terminal scrollback.
    error(`\n  Run record: ${stateFilePath(args.cwd, state.featureId)}`);
    error(`  Resume with: npm run factory -- --feature "${args.feature}" --resume ${state.featureId}`);

    return 1;
  }

  log(`\n✅ Feature complete: ${state.featureName}`);
  return 0;
}

/**
 * The CLI entry point. Always calls `deps.exit(code)` exactly once, then returns the code.
 * A thrown error is reported through `deps.error` and exits 1.
 */
export async function runCli(argv: string[], deps: CliDependencies): Promise<number> {
  let code: number;
  try {
    code = await execute(argv, deps);
  } catch (err) {
    deps.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  }
  deps.exit(code);
  return code;
}

if (require.main === module) {
  void runCli(process.argv.slice(2), realCliDependencies());
}
