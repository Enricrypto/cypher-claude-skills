/**
 * A retrying builder is told what went wrong.
 *
 * Every builder attempt is a FRESH agent invocation — new context, no transcript of the one
 * before. The retry prompt is the only thing that crosses that boundary, and it used to carry
 * almost nothing:
 *
 *     "This is attempt 2 of 3. A previous attempt failed — fix it, do not start over."
 *
 * Meanwhile the harness had already run analyzeError() on the failure, classified it into a
 * category and a fixClass, and written that into the state record — where the next builder, a
 * fresh context, could not read it. getRemediationInstruction() existed to format exactly this
 * briefing and was imported by the orchestrator and never called.
 *
 * So attempt 2 started blind, and its first move had to be re-running the suite to rediscover
 * what attempt 1 had already discovered AND classified. Up to six full agent contexts per run,
 * each re-paying the contract and re-reading four artifacts, to re-derive a known answer.
 *
 * These tests assert the prompt actually carries the diagnosis.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { backend, researcher, spec, story } from '../fixtures/agent-outputs';
import { runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;
let projectDir: string;

beforeEach(() => {
  project = tempProject('ff-retry-');
  projectDir = project.dir;
});

afterEach(() => {
  project.cleanup();
});

/**
 * Drives the chain to Stage 3 and captures every prompt the backend builder receives.
 * The builder always fails, so the loop runs its full three attempts. The spec is
 * backend-only (the fixture default), so the Frontend Builder is skipped.
 */
async function capturePromptsWithFailure(error: string): Promise<string[]> {
  const invoker = scriptedInvoker({
    '01-researcher': researcher(),
    '02-story-writer': story(),
    '03-spec-writer': spec(),
    '04-backend-builder': backend({ testsFailed: 1, failingError: error })
  });

  await runToEnd({ featureName: 'retry-briefing', cwd: projectDir, invoke: invoker.invoke });

  return invoker.promptsFor('04-backend-builder');
}

describe('the retry prompt carries the diagnosis', () => {
  it('says nothing about a previous failure on the FIRST attempt', async () => {
    const prompts = await capturePromptsWithFailure('column "totp_secret" does not exist');

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).not.toMatch(/attempt 1 of 3|previous attempt/i);
  });

  it('gives attempt 2 the actual error text, not just "it failed"', async () => {
    const error = 'column "totp_secret" does not exist';
    const prompts = await capturePromptsWithFailure(error);

    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[1]).toContain(error);
  });

  it('gives attempt 2 the CLASSIFICATION, which is the part the agent cannot re-derive cheaply', async () => {
    // A migration error, not a missing implementation. The distinction is exactly what
    // analyzeError() exists to make, and it changes what the builder should do.
    const prompts = await capturePromptsWithFailure('column "totp_secret" does not exist');

    expect(prompts[1]).toMatch(/\*\*Category:\*\*/);
    expect(prompts[1]).toMatch(/\*\*Fix Class:\*\*/);
    expect(prompts[1]).toMatch(/CREATE_MIGRATION/);
  });

  it('tells the builder NOT to re-run the suite just to rediscover the failure', async () => {
    const prompts = await capturePromptsWithFailure('Cannot find module "./totp"');

    expect(prompts[1]).toMatch(/do not re-run the full suite/i);
  });

  it('counts attempts correctly across the loop', async () => {
    const prompts = await capturePromptsWithFailure('Cannot find module "./totp"');

    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toMatch(/attempt 2 of 3/i);
    expect(prompts[2]).toMatch(/attempt 3 of 3/i);
  });

  it('classifies an IMPORT error differently from a MIGRATION error', async () => {
    const importRetry = (await capturePromptsWithFailure('Cannot find module "./totp"'))[1];
    const migrationRetry = (await capturePromptsWithFailure('column "totp_secret" does not exist'))[1];

    expect(importRetry).toMatch(/FIX_IMPORT/);
    expect(migrationRetry).toMatch(/CREATE_MIGRATION/);
    expect(importRetry).not.toEqual(migrationRetry);
  });

  it('does not invent a diagnosis when the builder named no failing test', async () => {
    const invoker = scriptedInvoker({
      '01-researcher': researcher(),
      '02-story-writer': story(),
      '03-spec-writer': spec(),
      // Failed, but named nothing: no failingError, so failingTests is empty.
      '04-backend-builder': backend({ testsFailed: 1 })
    });

    await runToEnd({ featureName: 'no-named-failure', cwd: projectDir, invoke: invoker.invoke });

    const prompts = invoker.promptsFor('04-backend-builder');

    expect(prompts[1]).toMatch(/could not classify why/i);
    expect(prompts[1]).not.toMatch(/\*\*Fix Class:\*\*/);
  });
});
