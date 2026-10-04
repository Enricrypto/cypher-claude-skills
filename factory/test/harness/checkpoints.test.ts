/**
 * The three human checkpoints.
 *
 * These exist because the orchestrator used to log
 *
 *     ⏸️  CHECKPOINT 1: Awaiting story approval
 *
 * and then, on the very next line, record its own approval. It never waited for anyone. The
 * system advertised a human-oversight guarantee it did not have — and a live Spec Writer caught
 * it, refusing to proceed on the grounds that "Checkpoint 1 would have been skipped silently."
 *
 * The rule these lock down: a checkpoint FAILS CLOSED. If nobody is there to approve, the run
 * stops. A checkpoint you can skip by forgetting to configure something is not a checkpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation } from '../../runner/invoke-agent';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-checkpoint-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** A researcher output good enough to clear the stage-1 gate, with its report on disk. */
function researcher(): any {
  return {
    stage: 1,
    agent: '01-researcher',
    timestamp: new Date().toISOString(),
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

function story(): any {
  return {
    stage: 2,
    agent: '02-story-writer',
    timestamp: new Date().toISOString(),
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
            '## AC-1', 'Given logged in', 'When enabling 2FA', 'Then QR shown',
            '## AC-2', 'Given QR shown', 'When valid code', 'Then enabled',
            '## AC-3', 'Given enabled', 'When invalid code', 'Then rejected'
          ].join('\n')
        }
      ],
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

function spec(): any {
  return {
    stage: 2,
    agent: '03-spec-writer',
    timestamp: new Date().toISOString(),
    status: 'PASS',
    details: {
      summary: 'Technical brief.',
      artifacts: [
        { name: 'TECHNICAL_BRIEF.md', path: 'TECHNICAL_BRIEF.md', description: 'Brief', content: '# Technical Brief\n\nTOTP via speakeasy.' },
        { name: 'FILE_LIST.md', path: 'FILE_LIST.md', description: 'Files', content: '# Files\n\n- src/a.ts (CREATE)' }
      ],
      apiContract: { endpoints: [], errorHandling: 'RFC7807' },
      fileList: [{ path: 'src/a.ts', type: 'CREATE', reason: 'core', complexity: 'SIMPLE' }],
      testStrategy: { unitTests: [], integrationTests: [], e2eTests: [] },
      dataModel: { tables: [] },
      uiComponents: []
    }
  };
}

/** An invoker that plays back real-shaped outputs for the planning agents. */
function planningInvoker(seen: string[]) {
  return async (call: AgentInvocation) => {
    seen.push(call.agent);
    if (call.agent === '01-researcher') return researcher();
    if (call.agent === '02-story-writer') return story();
    // Anything past the story is irrelevant to these tests.
    return {
      stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(),
      status: 'PASS', details: { summary: 'x', artifacts: [] }
    };
  };
}

describe('the three human checkpoints', () => {
  it('FAILS CLOSED: with no approver configured, the run stops instead of approving itself', async () => {
    const seen: string[] = [];

    const state = await runFeatureFactory({
      featureName: 'no-approver',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker(seen)
      // approveCheckpoint deliberately omitted
    });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.agent).toBe('human');
    expect(state.escalations.at(-1)!.context.message).toMatch(/requires human approval/i);

    // It got as far as writing the story, then stopped. It did NOT proceed to the Spec Writer.
    expect(seen).toContain('02-story-writer');
    expect(seen).not.toContain('03-spec-writer');
  });

  it('stops when the human says no', async () => {
    const seen: string[] = [];

    const state = await runFeatureFactory({
      featureName: 'rejected',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker(seen),
      approveCheckpoint: async () => false
    });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.context.message).toMatch(/rejected/i);
    expect(seen).not.toContain('03-spec-writer');
  });

  it('records who approved what, and continues when the human says yes', async () => {
    const seen: string[] = [];
    const asked: string[] = [];

    await runFeatureFactory({
      featureName: 'approved',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker(seen),
      approveCheckpoint: async cp => {
        asked.push(cp.name);
        return true;
      }
    });

    expect(asked[0]).toMatch(/CHECKPOINT 1.*story/i);
    expect(seen).toContain('03-spec-writer');   // it moved on
  });

  it('shows the human what they are approving, not just a prompt', async () => {
    let shown = '';

    await runFeatureFactory({
      featureName: 'summary',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker([]),
      approveCheckpoint: async cp => {
        if (cp.name.includes('CHECKPOINT 1')) shown = cp.summary;
        return true;
      }
    });

    expect(shown).toBe('User can enable 2FA.');
  });
});

describe('the workspace the agents read', () => {
  /**
   * A live Backend Builder found FOUR technical briefs for the same feature in .factory/, from
   * four separate runs, every one still saying "reply 'approved' when ready to continue" — and
   * refused to write any code at all:
   *
   *     "No spec in this repo is approved... 'Newest wins' is not a safe inference: these are
   *      parallel runs, not revisions of one another."
   *
   * It was right. The harness had littered the workspace with contradictory instructions and
   * then asked an agent to implement "the approved spec".
   */
  it('removes previous runs\' artifacts, so no agent finds two contradictory "approved" specs', async () => {
    // Leave a previous run's brief lying around.
    mkdirSync(join(projectDir, '.factory', 'an-older-run'), { recursive: true });
    writeFileSync(
      join(projectDir, '.factory', 'an-older-run', 'TECHNICAL_BRIEF.md'),
      '# A brief from an unrelated run\n\nReply "approved" when ready to continue.'
    );

    const state = await runFeatureFactory({
      featureName: 'clean-workspace',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      approveCheckpoint: async () => true,
      invoke: planningInvoker([])
    });

    // The stale run is gone; this run's own directory is intact.
    expect(existsSync(join(projectDir, '.factory', 'an-older-run'))).toBe(false);
    expect(existsSync(join(projectDir, '.factory', state.featureId, 'USER_STORY.md'))).toBe(true);
  });

  it('BELIEVES a builder that says it is blocked, instead of reporting "passed"', async () => {
    // The orchestrator printed "✅ Backend builder passed (first try)" while the builder was
    // reporting ESCALATE and had written no code whatsoever. agentDeclaredBlocked() was wired
    // for the read-only agents and never for the builders.
    const state = await runFeatureFactory({
      featureName: 'builder-refuses',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      approveCheckpoint: async () => true,
      invoke: async (call: AgentInvocation) => {
        if (call.agent === '01-researcher') return researcher();
        if (call.agent === '02-story-writer') return story();
        if (call.agent === '03-spec-writer') return spec();

        // The builder refuses.
        return {
          stage: 3, agent: call.agent, timestamp: new Date().toISOString(),
          status: 'ESCALATE',
          details: {
            summary: 'No spec in this repo is approved — I found four and cannot tell which.',
            artifacts: [], filesModified: [],
            implementation: { services: [], routes: [], migrations: [] },
            testing: { testsWritten: 0, testsPassed: 0, testsFailed: 0 },
            patterns: { reused: [], created: [] }
          }
        };
      }
    });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.agent).toBe('04-backend-builder');
    expect(state.escalations.at(-1)!.context.message).toMatch(/refused to build/i);
  });
});

describe('artifact persistence and sequencing', () => {
  /**
   * The bug a live Spec Writer caught: persistArtifacts() only ran at the STAGE GATE, which is
   * the end of the stage — and stage 2 has two agents. So the Spec Writer executed against a
   * disk with no USER_STORY.md on it, and would have had to INVENT the acceptance criteria the
   * builders are then graded against. It refused, and it was right.
   */
  it('writes the story to disk BEFORE the Spec Writer runs', async () => {
    let storyOnDiskWhenSpecWriterRan = false;
    let featureId = '';

    const state = await runFeatureFactory({
      featureName: 'sequencing',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      approveCheckpoint: async () => true,
      invoke: async (call: AgentInvocation) => {
        if (call.agent === '01-researcher') return researcher();
        if (call.agent === '02-story-writer') return story();

        if (call.agent === '03-spec-writer') {
          // The Spec Writer is running RIGHT NOW. Is the story it must translate on disk?
          storyOnDiskWhenSpecWriterRan = call.prompt.includes('.factory/');
          const dir = call.prompt.match(/\.factory\/[a-f0-9-]+/)?.[0] ?? '';
          featureId = dir;
          storyOnDiskWhenSpecWriterRan = existsSync(join(projectDir, dir, 'USER_STORY.md'));
        }

        return {
          stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(),
          status: 'PASS', details: { summary: 'x', artifacts: [] }
        };
      }
    });

    expect(storyOnDiskWhenSpecWriterRan).toBe(true);
    expect(featureId).toContain(state.featureId);
  });

  it('namespaces artifacts per run, so one feature never stomps another', async () => {
    const run = () =>
      runFeatureFactory({
        featureName: 'namespaced',
        featureDescription: 'add 2FA',
        cwd: projectDir,
        approveCheckpoint: async () => true,
        invoke: planningInvoker([])
      });

    const first = await run();
    const second = await run();

    expect(first.featureId).not.toBe(second.featureId);

    // The current run's artifacts are present...
    expect(existsSync(join(projectDir, '.factory', second.featureId, 'RESEARCHER_REPORT.md'))).toBe(true);

    // ...and the previous run's are GONE. Leaving them would put two contradictory "approved"
    // briefs in the workspace the agents read, which is exactly what made a live builder refuse
    // to write any code. Namespacing stops them overwriting each other; cleanup stops them
    // confusing each other.
    expect(existsSync(join(projectDir, '.factory', first.featureId))).toBe(false);

    // And nothing was dumped in the project root.
    expect(existsSync(join(projectDir, 'RESEARCHER_REPORT.md'))).toBe(false);
  });
});
