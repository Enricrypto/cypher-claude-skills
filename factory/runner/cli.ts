#!/usr/bin/env node
/**
 * Feature Factory CLI
 *
 *   npm run factory -- --feature "add a health check endpoint" [--cwd /path/to/project]
 *
 * Exits 0 only when all five stages passed their gates. Any escalation exits 1 — so CI, or a
 * shell script, can trust the exit code rather than reading the log.
 */

import { resolve } from 'path';
import { createInterface } from 'readline';
import { runFeatureFactory } from '../feature/workflows/feature-factory-orchestrator';
import { createSdkInvoker } from './invoke-agent';
import { getStateSummary } from '../harness/state-tracker';

interface CliArgs {
  feature: string;
  name: string;
  cwd: string;
  model?: string;
  /** Approve all three human checkpoints without asking. Must be explicit — see below. */
  yes: boolean;
}

/**
 * The three human checkpoints.
 *
 * On a TTY we ask, and the run blocks until you answer. Without a TTY (CI, a pipe) there is
 * nobody to ask, so we FAIL CLOSED — the run escalates rather than approving itself.
 *
 * --yes is the only way to skip them, and it has to be typed. That is deliberate: a checkpoint
 * you can skip by forgetting to configure something is not a checkpoint. The orchestrator used
 * to log "Awaiting story approval" and then immediately approve itself, which meant the system
 * advertised a human-oversight guarantee it did not have.
 */
async function askHuman(checkpoint: { name: string; summary: string }): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      `\n⏸️  ${checkpoint.name}\n` +
        `   No TTY, so there is nobody to ask. Re-run interactively, or pass --yes to approve\n` +
        `   all checkpoints automatically.`
    );
    return false;
  }

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
    yes: args.yes === 'true'
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Feature Factory`);
  console.log(`  feature: ${args.feature}`);
  console.log(`  project: ${args.cwd}\n`);

  const invoke = createSdkInvoker({
    cwd: args.cwd,
    model: args.model,
    log: message => console.log(message),
    onToolDenied: (agent, tool) => {
      // An agent reaching past its contract. Not fatal, but never silent.
      console.warn(`  ⚠️  ${agent} attempted "${tool}", which its contract does not grant.`);
    }
  });

  if (args.yes) {
    console.log('  ⚠️  --yes: the three human checkpoints will be approved automatically.\n');
  }

  const state = await runFeatureFactory({
    featureName: args.name,
    featureDescription: args.feature,
    cwd: args.cwd,
    invoke,
    approveCheckpoint: args.yes ? async () => true : askHuman
  });

  console.log(getStateSummary(state));

  if (state.completionStatus !== 'SUCCESS') {
    console.error(`\n❌ BLOCKED: ${state.finalSummary}`);

    for (const escalation of state.escalations) {
      console.error(`\n  Stage ${escalation.stage} — ${escalation.reason} (${escalation.agent})`);
      console.error(`  ${escalation.context.message}`);
      for (const blocker of escalation.context.blockers ?? []) {
        console.error(`    - ${blocker}`);
      }
    }

    return 1;
  }

  console.log(`\n✅ Feature complete: ${state.featureName}`);
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
