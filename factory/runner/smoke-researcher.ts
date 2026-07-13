/**
 * Live smoke test — proves the PLUMBING, not the gates. The gates are already covered offline
 * by test/harness/stage-context.test.ts, which needs no model.
 *
 * Runs ONE agent (the Researcher — read-only, so it cannot damage the target repo) and checks:
 *   1. it spawns and authenticates (subscription, via the bundled Claude Code binary)
 *   2. it returns schema-forced structured output
 *   3. validateOutputSchema accepts it
 *   4. the stage-1 gate reaches a verdict on real, derived evidence
 *
 * Usage:  npx ts-node feature-factory/runner/smoke-researcher.ts --cwd /path/to/scratch/repo
 *
 * This costs subscription usage. It is not part of `npm test` and never runs in CI.
 */

import { resolve } from 'path';
import { createSdkInvoker } from './invoke-agent';
import { validateOutputSchema } from '../harness/agent-output-schema';
import { buildStageContext, persistArtifacts } from '../harness/stage-context';
import { canAdvanceStage, stageContracts } from '../harness/stage-gates';

async function main(): Promise<void> {
  const cwdIndex = process.argv.indexOf('--cwd');
  if (cwdIndex === -1 || !process.argv[cwdIndex + 1]) {
    throw new Error('Usage: smoke-researcher.ts --cwd /path/to/repo');
  }
  const project = resolve(process.argv[cwdIndex + 1]);

  console.log('=== LIVE SMOKE TEST: 01-researcher ===');
  console.log(`project: ${project}\n`);

  const denials: string[] = [];
  const invoke = createSdkInvoker({
    cwd: project,
    log: message => console.log(message),
    onToolDenied: (agent, tool) => denials.push(`${agent} -> ${tool}`)
  });

  const started = Date.now();

  const output = await invoke({
    stage: 1,
    agent: '01-researcher',
    prompt:
      'Analyze this codebase for the feature: "add an endpoint to update a user\'s email address". ' +
      'Map the relevant files, identify existing patterns to reuse, and flag risks.'
  });

  console.log(`\n--- returned in ${((Date.now() - started) / 1000).toFixed(1)}s ---\n`);
  console.log('STRUCTURED OUTPUT (truncated):');
  console.log(JSON.stringify(output, null, 2).slice(0, 1400));
  console.log('...\n');

  const validation = validateOutputSchema(1, '01-researcher', output);
  console.log(`schema valid: ${validation.valid}`);
  if (!validation.valid) {
    console.log(`  errors: ${validation.errors.join('; ')}`);
  }

  console.log('\nartifacts the agent returned:');
  for (const artifact of output.details.artifacts ?? []) {
    const size = typeof artifact.content === 'string' ? `${artifact.content.length} chars` : 'NO CONTENT';
    console.log(`  ${artifact.name} -> ${artifact.path} (${size})`);
  }

  // The Researcher is read-only and cannot write files. The harness persists what it returned.
  const outputs = { researcher: output };
  const written = persistArtifacts(outputs, project);
  console.log(`\nharness persisted: ${written.length === 0 ? 'nothing' : written.map(w => w.path).join(', ')}`);

  const context = buildStageContext({ stage: 1, cwd: project, outputs });
  console.log('\ngate context (derived from the output + disk, not fabricated):');
  console.log(`  filesIdentified:   ${context.metadata.filesIdentified}`);
  console.log(`  patternsFound:     ${context.metadata.patternsFound}`);
  console.log(`  risksIdentified:   ${(context.metadata.risksIdentified ?? []).length}`);
  console.log(`  artifacts on disk: ${JSON.stringify(Object.keys(context.artifacts))}`);

  const decision = await canAdvanceStage(1, stageContracts[1], context);
  console.log(
    `\nGATE: canAdvance=${decision.canAdvance} (${decision.recommendation}, ${decision.passRate.toFixed(0)}%)`
  );
  for (const blocker of decision.blockers) {
    console.log(`  BLOCKER: ${blocker}`);
  }

  console.log(`\ntool denials: ${denials.length === 0 ? 'none' : denials.join(', ')}`);
}

main().catch(error => {
  console.error(`\nSMOKE TEST FAILED: ${error.message}`);
  if (error.detail?.length) console.error(`detail: ${error.detail.join('\n        ')}`);
  process.exit(1);
});
