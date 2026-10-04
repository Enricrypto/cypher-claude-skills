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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { closeRun } from '../../harness/run-directory';
import { AgentInvocation } from '../../runner/invoke-agent';
import { backend, placeholder, researcher, spec, story } from '../fixtures/agent-outputs';
import { scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { fakeChangeTracker } from '../fixtures/changes';

let project: TempProject;
let projectDir: string;

beforeEach(() => {
  project = tempProject('ff-checkpoint-');
  projectDir = project.dir;
});

afterEach(() => {
  project.cleanup();
});

/**
 * An invoker that plays back real-shaped outputs for the planning agents. Anything past the
 * story gets a schema-invalid placeholder — irrelevant to these tests.
 */
function planningInvoker(seen: string[]) {
  const invoker = scriptedInvoker({ '01-researcher': researcher(), '02-story-writer': story() });
  return async (call: AgentInvocation) => {
    seen.push(call.agent);
    return invoker.invoke(call);
  };
}

describe('the three human checkpoints', () => {
  it('FAILS CLOSED: with no approver configured, the run stops instead of approving itself', async () => {
    const seen: string[] = [];

    const state = await runFeatureFactory({
      featureName: 'no-approver',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      changes: fakeChangeTracker(),
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
      changes: fakeChangeTracker(),
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
      changes: fakeChangeTracker(),
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
      changes: fakeChangeTracker(),
      invoke: planningInvoker([]),
      approveCheckpoint: async cp => {
        if (cp.name.includes('CHECKPOINT 1')) shown = cp.text;
        return true;
      }
    });

    // AC-43: the full USER_STORY.md, never the Story Writer's own one-line summary of it.
    expect(shown).toBe(story().details.artifacts[0].content);
    expect(shown).not.toBe('User can enable 2FA.');
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
  it('archives a previous unrecognised run directory intact, so no agent finds two contradictory "approved" specs', async () => {
    // Leave a previous (pre-A-2, no state.json) run's brief lying around.
    mkdirSync(join(projectDir, '.factory', 'an-older-run'), { recursive: true });
    const olderBrief = '# A brief from an unrelated run\n\nReply "approved" when ready to continue.';
    writeFileSync(join(projectDir, '.factory', 'an-older-run', 'TECHNICAL_BRIEF.md'), olderBrief);

    const state = await runFeatureFactory({
      featureName: 'clean-workspace',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      changes: fakeChangeTracker(),
      approveCheckpoint: async () => true,
      invoke: planningInvoker([])
    });

    // The stale run is out of the live workspace, but nothing was deleted: it is archived intact
    // (the agents are told never to read .factory/_archive/). This run's own directory is intact.
    expect(existsSync(join(projectDir, '.factory', 'an-older-run'))).toBe(false);
    expect(readFileSync(join(projectDir, '.factory', '_archive', 'an-older-run', 'TECHNICAL_BRIEF.md'), 'utf-8')).toBe(
      olderBrief
    );
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
      changes: fakeChangeTracker(),
      approveCheckpoint: async () => true,
      invoke: scriptedInvoker({
        '01-researcher': researcher(),
        '02-story-writer': story(),
        '03-spec-writer': spec(),
        // The builder refuses.
        '04-backend-builder': () => {
          const refusal = backend({ files: [] });
          refusal.status = 'ESCALATE';
          refusal.details.summary = 'No spec in this repo is approved — I found four and cannot tell which.';
          refusal.details.testing = { testsWritten: 0, testsPassed: 0, testsFailed: 0 };
          return refusal;
        }
      }).invoke
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
      changes: fakeChangeTracker(),
      approveCheckpoint: async () => true,
      invoke: scriptedInvoker({
        '01-researcher': researcher(),
        '02-story-writer': story(),
        '03-spec-writer': call => {
          // The Spec Writer is running RIGHT NOW. Is the story it must translate on disk?
          storyOnDiskWhenSpecWriterRan = call.prompt.includes('.factory/');
          const dir = call.prompt.match(/\.factory\/[a-f0-9-]+/)?.[0] ?? '';
          featureId = dir;
          storyOnDiskWhenSpecWriterRan = existsSync(join(projectDir, dir, 'USER_STORY.md'));
          return placeholder(call.stage, call.agent);
        }
      }).invoke
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
        changes: fakeChangeTracker(),
        approveCheckpoint: async () => true,
        invoke: planningInvoker([])
      });

    const first = await run();
    // The first run stopped unfinished (ESCALATED), which blocks a new run until it is resumed or
    // closed (AC-41). Close it, as an operator would with --close.
    closeRun(projectDir, first.featureId);
    const second = await run();

    expect(first.featureId).not.toBe(second.featureId);

    // The current run's artifacts are present...
    expect(existsSync(join(projectDir, '.factory', second.featureId, 'RESEARCHER_REPORT.md'))).toBe(true);

    // ...and the previous run's are out of the live workspace — archived intact, never deleted.
    // Leaving them live would put two contradictory "approved" briefs where the agents read,
    // which is exactly what made a live builder refuse to write any code.
    expect(existsSync(join(projectDir, '.factory', first.featureId))).toBe(false);
    expect(existsSync(join(projectDir, '.factory', '_archive', first.featureId, 'RESEARCHER_REPORT.md'))).toBe(true);

    // And nothing was dumped in the project root.
    expect(existsSync(join(projectDir, 'RESEARCHER_REPORT.md'))).toBe(false);
  });
});
