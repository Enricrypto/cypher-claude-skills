/**
 * Run state reaches the disk.
 *
 * state-tracker.ts has always built a complete record of a run — every agent step, every
 * loop-back, every typed escalation, every checkpoint a human approved — and the orchestrator
 * has always thrown it away. It imported serializeState and never called it. Its header
 * promised "State persisted to JSON file" and no code anywhere wrote one, which also left
 * OrchestrationOptions.resumeFromState permanently unreachable: nothing could produce a
 * FeatureState to hand it.
 *
 * These tests lock down the rule that replaced that: A FINISHED RUN ALWAYS LEAVES A RECORD.
 * Not on success only — an escalation is the case where you most need to know what happened.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation } from '../../runner/invoke-agent';
import { loadState, saveState, stateFilePath, StatePersistenceError } from '../../harness/state-store';
import { createFeatureState, deserializeState, recordAgentStep, FeatureState } from '../../harness/state-tracker';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-state-'));
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

function planningInvoker(seen: string[] = []) {
  return async (call: AgentInvocation) => {
    seen.push(call.agent);
    if (call.agent === '01-researcher') return researcher();
    if (call.agent === '02-story-writer') return story();
    return {
      stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(),
      status: 'PASS', details: { summary: 'x', artifacts: [] }
    };
  };
}

// ============================================================================
// The orchestrator
// ============================================================================

describe('a finished run leaves a record', () => {
  it('writes state.json when the run ESCALATES — the case you most need it for', async () => {
    const state = await runFeatureFactory({
      featureName: 'escalating-run',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker()
      // No approver → fails closed at Checkpoint 1.
    });

    expect(state.completionStatus).toBe('ESCALATED');

    const path = stateFilePath(projectDir, state.featureId);
    expect(existsSync(path)).toBe(true);
  });

  it('records WHY it stopped, not merely THAT it stopped', async () => {
    const state = await runFeatureFactory({
      featureName: 'why-it-stopped',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker()
    });

    const onDisk = deserializeState(readFileSync(stateFilePath(projectDir, state.featureId), 'utf-8'));

    expect(onDisk.completionStatus).toBe('ESCALATED');
    expect(onDisk.escalations.at(-1)!.agent).toBe('human');
    expect(onDisk.escalations.at(-1)!.context.message).toMatch(/requires human approval/i);
  });

  it('persists the execution history, not just the final verdict', async () => {
    const state = await runFeatureFactory({
      featureName: 'history',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker(),
      approveCheckpoint: async () => true
    });

    const onDisk = loadState(projectDir, state.featureId)!;

    // The agents that actually ran are named in the record.
    const agents = onDisk.stageHistory.map(step => step.agent);
    expect(agents).toContain('01-researcher');
    expect(agents).toContain('02-story-writer');

    // And the checkpoint a human approved is on disk, with a timestamp.
    expect(onDisk.checkpointApprovals.length).toBeGreaterThan(0);
    expect(onDisk.checkpointApprovals[0].approvedAt).toBeTruthy();
  });

  it('writes the record beside that run\'s own documents', async () => {
    const state = await runFeatureFactory({
      featureName: 'colocated',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke: planningInvoker(),
      approveCheckpoint: async () => true
    });

    const runDir = join(projectDir, '.factory', state.featureId);
    expect(existsSync(join(runDir, 'state.json'))).toBe(true);
    expect(existsSync(join(runDir, 'RESEARCHER_REPORT.md'))).toBe(true);
  });

  it('saves progress DURING the run, not only at the end', async () => {
    // The Spec Writer asserts that by then the Researcher's step is already durable. If state
    // were written only on exit, this file would not exist yet and the run would still pass —
    // which is exactly the hole this test closes.
    let onDiskAtSpecTime: FeatureState | undefined;
    let featureId = '';

    const invoke = async (call: AgentInvocation) => {
      if (call.agent === '03-spec-writer') {
        const runDir = join(projectDir, '.factory');
        const [id] = require('fs').readdirSync(runDir);
        featureId = id;
        onDiskAtSpecTime = loadState(projectDir, id);
      }
      return planningInvoker()(call);
    };

    await runFeatureFactory({
      featureName: 'mid-run',
      featureDescription: 'add 2FA',
      cwd: projectDir,
      invoke,
      approveCheckpoint: async () => true
    });

    expect(onDiskAtSpecTime).toBeDefined();
    expect(onDiskAtSpecTime!.status).toBe('IN_PROGRESS');
    expect(onDiskAtSpecTime!.stageHistory.map(s => s.agent)).toContain('01-researcher');
    expect(featureId).toBeTruthy();
  });

  it('FAILS CLOSED: a run that cannot be recorded stops, rather than continuing unrecorded', async () => {
    // Fail ONLY the state write, leaving artifact persistence working — otherwise the run dies
    // earlier, at the Researcher's report, and never reaches the code under test.
    //
    // Pinning the run id via resumeFromState is what makes that possible: the path is knowable
    // in advance. state.json is created as a DIRECTORY, so saveState's write-then-rename fails
    // at the rename while everything else in the run directory still works.
    const pinned = createFeatureState('unsaveable');
    mkdirSync(join(projectDir, '.factory', pinned.featureId, 'state.json'), { recursive: true });

    await expect(
      runFeatureFactory({
        featureName: 'unsaveable',
        featureDescription: 'add 2FA',
        cwd: projectDir,
        resumeFromState: pinned,
        invoke: planningInvoker(),
        approveCheckpoint: async () => true,
        logger: () => {}
      })
    ).rejects.toThrow(StatePersistenceError);
  });

  it('does not return a state claiming ESCALATED when nothing on disk says so', async () => {
    // The failure mode this rules out: the orchestrator catches the save error, records an
    // escalation into the in-memory state, and returns it — so the caller sees a tidy
    // completionStatus while no file anywhere backs it up. An unrecorded run that looks
    // recorded is worse than one that stops.
    const pinned = createFeatureState('no-phantom-verdict');
    mkdirSync(join(projectDir, '.factory', pinned.featureId, 'state.json'), { recursive: true });

    let returned: unknown = 'NOTHING RETURNED';
    try {
      returned = await runFeatureFactory({
        featureName: 'no-phantom-verdict',
        featureDescription: 'add 2FA',
        cwd: projectDir,
        resumeFromState: pinned,
        invoke: planningInvoker(),
        approveCheckpoint: async () => true,
        logger: () => {}
      });
    } catch (error) {
      returned = error;
    }

    expect(returned).toBeInstanceOf(StatePersistenceError);
    expect((returned as StatePersistenceError).message).toMatch(/cannot be recorded|could not write/i);
  });
});

// ============================================================================
// The store itself
// ============================================================================

describe('the state store', () => {
  it('round-trips a state through the filesystem unchanged', () => {
    const before = recordAgentStep(
      createFeatureState('round-trip'),
      1,
      '01-researcher',
      'PASS',
      { stage: 1, agent: '01-researcher', status: 'PASS', timestamp: '', details: { summary: 's', artifacts: [] } } as any
    );

    saveState(projectDir, before);
    const after = loadState(projectDir, before.featureId)!;

    expect(after).toEqual(before);
  });

  it('returns undefined for a run that was never saved — that is not an error', () => {
    expect(loadState(projectDir, 'no-such-run')).toBeUndefined();
  });

  it('THROWS on a corrupt state file rather than resuming from a guess', () => {
    const state = createFeatureState('corrupt');
    saveState(projectDir, state);
    writeFileSync(stateFilePath(projectDir, state.featureId), '{ not json');

    expect(() => loadState(projectDir, state.featureId)).toThrow(/corrupt|not valid JSON/i);
  });

  it('refuses to resume a run under another run\'s identity', () => {
    const real = createFeatureState('real-run');
    saveState(projectDir, real);

    // A state file for a different run, sitting under this id.
    const impostor = createFeatureState('other-run');
    mkdirSync(join(projectDir, '.factory', 'claimed-id'), { recursive: true });
    writeFileSync(join(projectDir, '.factory', 'claimed-id', 'state.json'), JSON.stringify(impostor));

    expect(() => loadState(projectDir, 'claimed-id')).toThrow(/belongs to run/i);
  });

  it('leaves no scratch file behind after a successful save', () => {
    const state = createFeatureState('clean');
    saveState(projectDir, state);

    const runDir = join(projectDir, '.factory', state.featureId);
    const entries = require('fs').readdirSync(runDir);
    expect(entries).toEqual(['state.json']);
  });

  it('leaves no scratch file behind after a FAILED save either', () => {
    // A leaked .state.json.<pid>.tmp in the run directory is the same class of hazard as the
    // four contradictory briefs that once made a Backend Builder refuse to work: the agents
    // read this directory.
    const state = createFeatureState('failed-save');
    const runDir = join(projectDir, '.factory', state.featureId);
    mkdirSync(join(runDir, 'state.json'), { recursive: true }); // rename onto a dir fails

    expect(() => saveState(projectDir, state)).toThrow(StatePersistenceError);

    const strays = require('fs').readdirSync(runDir).filter((e: string) => e.endsWith('.tmp'));
    expect(strays).toEqual([]);
  });

  it('writes content that is complete and parseable, not merely present', () => {
    // The fsync guard: rename makes the file appear atomically, but without syncing it can
    // appear EMPTY. A zero-length state.json that every reader agrees is current is worse than
    // no file, because loadState would throw and the run would look lost rather than unsaved.
    const state = recordAgentStep(
      createFeatureState('durable'),
      1,
      '01-researcher',
      'PASS',
      { stage: 1, agent: '01-researcher', status: 'PASS', timestamp: '', details: { summary: 's', artifacts: [] } } as any
    );

    const path = saveState(projectDir, state);
    const raw = readFileSync(path, 'utf-8');

    expect(raw.length).toBeGreaterThan(0);
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).featureId).toBe(state.featureId);
    expect(JSON.parse(raw).stageHistory).toHaveLength(1);
  });
});
