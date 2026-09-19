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
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation } from '../../runner/invoke-agent';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-retry-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function researcher(): any {
  return {
    stage: 1, agent: '01-researcher', timestamp: new Date().toISOString(), status: 'PASS',
    details: {
      summary: 'Mapped the codebase.',
      artifacts: [{ name: 'RESEARCHER_REPORT.md', path: 'RESEARCHER_REPORT.md', description: 'r', content: '# Researcher Report\n\nMapped auth.' }],
      architecture: { layers: ['routes', 'services'], description: 'Layered' },
      filesIdentified: [
        { path: 'src/a.ts', role: 'service', reason: 'core', priority: 'MUST_MODIFY' },
        { path: 'src/b.ts', role: 'controller', reason: 'entry', priority: 'LIKELY' },
        { path: 'src/c.ts', role: 'util', reason: 'helper', priority: 'OPTIONAL' }
      ],
      existingPatterns: [{ name: 'BaseService', description: 'b', locations: ['src/a.ts'], confidence: 0.9, recommendation: 'REUSE' }],
      risks: [{ type: 'TECHNICAL', severity: 'IMPORTANT', description: 'Timezones' }],
      timeEstimate: { discover: 2, plan: 3, execute: 8, verify: 5, deliver: 2, total: 20, confidence: 0.7 }
    }
  };
}

function story(): any {
  return {
    stage: 2, agent: '02-story-writer', timestamp: new Date().toISOString(), status: 'PASS',
    details: {
      summary: 'User can enable 2FA.',
      artifacts: [{
        name: 'USER_STORY.md', path: 'USER_STORY.md', description: 's',
        content: ['# User Story', '## AC-1', 'Given a', 'When b', 'Then c',
                  '## AC-2', 'Given a', 'When b', 'Then c',
                  '## AC-3', 'Given a', 'When b', 'Then c'].join('\n')
      }],
      userStory: { persona: 'user', goal: 'enable 2FA', benefit: 'security' },
      acceptanceCriteria: [
        { id: 'AC-1', given: 'a', when: 'b', then: 'c', priority: 'MUST', testable: true },
        { id: 'AC-2', given: 'a', when: 'b', then: 'c', priority: 'MUST', testable: true },
        { id: 'AC-3', given: 'a', when: 'b', then: 'c', priority: 'MUST', testable: true }
      ],
      edgeCases: [], assumptions: [], outOfScope: []
    }
  };
}

/** A backend-only spec, so the Frontend Builder is skipped and the test stays focused. */
function spec(): any {
  return {
    stage: 2, agent: '03-spec-writer', timestamp: new Date().toISOString(), status: 'PASS',
    details: {
      summary: 'Technical brief.',
      artifacts: [
        { name: 'TECHNICAL_BRIEF.md', path: 'TECHNICAL_BRIEF.md', description: 'b', content: '# Technical Brief\n\nTOTP.' },
        { name: 'FILE_LIST.md', path: 'FILE_LIST.md', description: 'f', content: '# Files\n\n- src/a.ts (CREATE)' }
      ],
      apiContract: { endpoints: [], errorHandling: 'RFC7807' },
      fileList: [{ path: 'src/a.ts', type: 'CREATE', reason: 'core', complexity: 'SIMPLE' }],
      testStrategy: { unitTests: [], integrationTests: [], e2eTests: [] },
      dataModel: { tables: [] },
      uiComponents: []
    }
  };
}

/** A backend build whose tests failed, carrying a specific, classifiable error. */
function failingBackend(error: string): any {
  return {
    stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
    details: {
      summary: 'Implemented, tests failing.',
      artifacts: [],
      filesModified: ['src/a.ts'],
      apiContract: { endpoints: [], errorHandling: 'RFC7807' },
      testing: {
        testsWritten: 1, testsPassed: 0, testsFailed: 1,
        failingTests: [{ name: 'enables 2FA', error }]
      }
    }
  };
}

/**
 * Drives the chain to Stage 3 and captures every prompt the backend builder receives.
 * The builder always fails, so the loop runs its full three attempts.
 */
async function capturePromptsWithFailure(error: string): Promise<string[]> {
  const prompts: string[] = [];

  const invoke = async (call: AgentInvocation) => {
    if (call.agent === '01-researcher') return researcher();
    if (call.agent === '02-story-writer') return story();
    if (call.agent === '03-spec-writer') return spec();
    if (call.agent === '04-backend-builder') {
      prompts.push(call.prompt);
      return failingBackend(error);
    }
    return {
      stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(),
      status: 'PASS', details: { summary: 'x', artifacts: [] }
    };
  };

  await runFeatureFactory({
    featureName: 'retry-briefing',
    featureDescription: 'add 2FA',
    cwd: projectDir,
    invoke,
    approveCheckpoint: async () => true,
    logger: () => {}
  });

  return prompts;
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
    const prompts: string[] = [];

    const invoke = async (call: AgentInvocation) => {
      if (call.agent === '01-researcher') return researcher();
      if (call.agent === '02-story-writer') return story();
      if (call.agent === '03-spec-writer') return spec();
      if (call.agent === '04-backend-builder') {
        prompts.push(call.prompt);
        const out = failingBackend('irrelevant');
        out.details.testing.failingTests = []; // failed, but named nothing
        return out;
      }
      return {
        stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(),
        status: 'PASS', details: { summary: 'x', artifacts: [] }
      };
    };

    await runFeatureFactory({
      featureName: 'no-named-failure',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke,
      approveCheckpoint: async () => true,
      logger: () => {}
    });

    expect(prompts[1]).toMatch(/could not classify why/i);
    expect(prompts[1]).not.toMatch(/\*\*Fix Class:\*\*/);
  });
});
