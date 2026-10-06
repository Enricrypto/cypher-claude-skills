/**
 * Checkpoint lifecycle (A-2, D-4), orchestrator-level [O].
 *
 * Step 2: AC-38, an approval is committed to state.json before the next agent can run.
 * Step 4: the checkpoint model — APPROVE / REJECT / PAUSE decisions, CP1 and CP2 presenting the
 * full documents with the approval bound to their hash, the split Stage 2 gate, and the
 * pre-supplied spec path presenting CP1 and CP2.
 * Step 5: CP3 (the validated change) after the Stage 4 gate; SUCCESS = Stage 4 gate passed + CP3
 * approved, with no Consolidator in the run; the regression baseline written at SUCCESS.
 * Step 7: a paused checkpoint decided on resume (--approve with its hash re-checked, --reject with
 * notes), and the rework after a rejection: the producing agent re-runs with the notes and the
 * checkpoint is presented again (D-5, D-B, MINOR-8).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

import { AgentInvocation } from '../../runner/invoke-agent';
import { FeatureFactoryAgent } from '../../runner/agent-registry';
import {
  CHECKPOINTS,
  CheckpointDecision,
  CheckpointRequest,
  normaliseDecision
} from '../../feature/workflows/feature-factory-orchestrator';
import { sha256Hex } from '../../harness/checkpoint-presentation';
import { ChangeDiffError } from '../../harness/change-diff';
import { baselineFilePath, readRegressionBaseline } from '../../harness/regression-baseline';
import { classifyRun, RunRefusedError } from '../../harness/run-lifecycle';
import { rebuildOutputs } from '../../harness/run-progress';
import { readArtifactContents } from '../../harness/stage-context';
import { loadState } from '../../harness/state-store';
import { FeatureState, isResumable } from '../../harness/state-tracker';
import { featureSpec, researcher, spec, story, validator } from '../fixtures/agent-outputs';
import { FAKE_BASE, fakeChangeTracker } from '../fixtures/changes';
import { executionAudit, recordingGates } from '../fixtures/gates';
import {
  decisions,
  passingScript,
  removeOnPersist,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-checkpoint-');
});

afterEach(() => {
  project.cleanup();
});

/** The state.json of the only run in the project. */
function onDisk(): FeatureState {
  const factoryDir = join(project.dir, '.factory');
  const runs = readdirSync(factoryDir).filter(name => existsSync(join(factoryDir, name, 'state.json')));
  expect(runs).toHaveLength(1);
  return loadState(project.dir, runs[0])!;
}

/**
 * A full orchestrator run commits state.json (two fsyncs) at every transition, about 20-25 times;
 * under a parallel `npm test` that can pass Jest's 5 s default without anything being wrong.
 */
const RUN_TIMEOUT_MS = 30_000;

describe('AC-38 approvals are committed', () => {
  it('AC-38 an approved checkpoint is on disk before the next agent is invoked', async () => {
    const approvedOnDisk: Record<string, string[]> = {};
    const script = passingScript();
    const recordApprovals = (agent: FeatureFactoryAgent) => {
      const entry = script[agent]!;
      script[agent] = (call: AgentInvocation, n: number) => {
        if (n === 1) approvedOnDisk[agent] = onDisk().checkpointApprovals.map(a => a.checkpointName);
        return typeof entry === 'function' ? entry(call, n) : structuredClone(entry);
      };
    };
    recordApprovals('03-spec-writer');
    recordApprovals('04-backend-builder');
    const invoker = scriptedInvoker(script, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    // CP1 (story) is approved before the Spec Writer runs; CP2 (brief) before the Backend Builder.
    expect(approvedOnDisk['03-spec-writer']).toEqual([CHECKPOINTS.STORY.name]);
    expect(approvedOnDisk['04-backend-builder']).toEqual([CHECKPOINTS.STORY.name, CHECKPOINTS.BRIEF.name]);
  }, RUN_TIMEOUT_MS);
});

/** The text a request presented, re-read from the files it names — what was on disk when it was asked. */
function filesBehind(request: CheckpointRequest): string[] {
  return request.artifactPaths.map(path => readFileSync(path, 'utf8'));
}

/** A story whose USER_STORY.md is prose with no Given/When/Then: the story gate refuses it. */
function untestableStory() {
  const output = story();
  output.details.artifacts[0].content = '# User Story\n\nIt should just work, really.';
  return output;
}

/**
 * A run whose TECHNICAL_BRIEF.md is gone when the spec gate reads it, so the gate refuses it. The
 * Spec Writer returns a complete brief (MINOR-8 refuses one without its content at the schema);
 * the document is removed from the run directory right after the harness persists it.
 */
const briefMissingAtGate = () => removeOnPersist(project.dir, '03-spec-writer', 'TECHNICAL_BRIEF.md');

describe('D-4 normaliseDecision', () => {
  it.each<[unknown, CheckpointDecision]>([
    [true, { decision: 'APPROVE' }],
    [false, { decision: 'REJECT' }],
    [{ decision: 'APPROVE' }, { decision: 'APPROVE' }],
    [{ decision: 'APPROVE', approvedBy: 'ana' }, { decision: 'APPROVE', approvedBy: 'ana' }],
    [{ decision: 'REJECT', notes: 'needs a recovery flow' }, { decision: 'REJECT', notes: 'needs a recovery flow' }],
    [{ decision: 'REJECT', notes: '' }, { decision: 'REJECT', notes: '' }],
    [{ decision: 'PAUSE' }, { decision: 'PAUSE' }]
  ])('D-4 normaliseDecision(%j) is %j', (value, expected) => {
    expect(normaliseDecision(value)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['the string yes', 'yes'],
    ['a number', 1],
    ['an empty object', {}],
    ['a lowercase decision', { decision: 'approve' }],
    ['an unknown decision', { decision: 'MAYBE' }],
    ['a non-string approvedBy', { decision: 'APPROVE', approvedBy: 5 }],
    ['non-string notes', { decision: 'REJECT', notes: 7 }]
  ])('I-18 normaliseDecision of %s is PAUSE: nothing is approved and nothing re-run', (_label, value) => {
    expect(normaliseDecision(value)).toEqual({ decision: 'PAUSE' });
  });

  it('D-4 a well-formed decision is copied: fields it does not define are dropped', () => {
    expect(normaliseDecision({ decision: 'APPROVE', approvedBy: 'ana', sha256: 'f'.repeat(64) })).toEqual({
      decision: 'APPROVE',
      approvedBy: 'ana'
    });
  });
});

describe('AC-43 / AC-50 what a checkpoint presents, and what an approval binds to', () => {
  it('AC-43 CP1 presents the full USER_STORY.md, CP2 the full TECHNICAL_BRIEF.md, CP3 the full VALIDATION_REPORT.md plus the diff', async () => {
    const shown: Array<{ request: CheckpointRequest; files: string[] }> = [];
    const record = (request: CheckpointRequest) => (shown.push({ request, files: filesBehind(request) }), true);
    const approver = decisions(record, record, record);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const changes = fakeChangeTracker({ text: '```diff\n+export const fixture = true;\n```\n' });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve, changes });
    const runDir = join(project.dir, '.factory', state.featureId);

    const [cp1, cp2, cp3] = shown;
    expect(cp1.request).toMatchObject({ id: 1, name: CHECKPOINTS.STORY.name, stage: 2 });
    expect(cp1.request.artifactPaths).toEqual([join(runDir, 'USER_STORY.md')]);
    expect(cp1.request.text).toBe(cp1.files[0]);
    expect(cp1.request.text).toBe(story().details.artifacts[0].content);
    expect(cp1.request.text).not.toBe(story().details.summary);

    expect(cp2.request).toMatchObject({ id: 2, name: CHECKPOINTS.BRIEF.name, stage: 2 });
    expect(cp2.request.artifactPaths).toEqual([join(runDir, 'TECHNICAL_BRIEF.md'), join(runDir, 'FILE_LIST.md')]);
    expect(cp2.request.text).toBe(`${cp2.files[0]}\n\n---\n\n## FILE_LIST.md\n\n${cp2.files[1]}`);

    expect(cp3.request).toMatchObject({ id: 3, name: CHECKPOINTS.CHANGE.name, stage: 4 });
    expect(cp3.request.artifactPaths).toEqual([join(runDir, 'VALIDATION_REPORT.md')]);
    expect(cp3.request.text.startsWith(cp3.files[0])).toBe(true);
    expect(cp3.files[0]).toBe(validator().details.artifacts[0].content);
    expect(cp3.request.text).toContain('## IMPORTANT findings (');
    expect(cp3.request.text.endsWith('## Change (source: git)\n\n```diff\n+export const fixture = true;\n```\n')).toBe(true);

    // `summary` is gone from the request, deliberately: nothing may stand in for the artifact.
    for (const { request } of shown) {
      expect(Object.keys(request).sort()).toEqual(['artifactPaths', 'id', 'name', 'sha256', 'stage', 'text']);
    }
  }, RUN_TIMEOUT_MS);

  it('AC-50 the stored hash equals the SHA-256 of the text the approver was given', async () => {
    const approver = decisions({ decision: 'APPROVE', approvedBy: 'ana' }, true);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

    const approvals = onDisk().checkpointApprovals;
    expect(approvals).toHaveLength(3);
    approver.requests.forEach((request, i) => {
      expect(request.sha256).toBe(sha256Hex(request.text));
      expect(approvals[i]).toMatchObject({ checkpointId: request.id, checkpointName: request.name, sha256: request.sha256 });
    });
    expect(approvals[0].approvedBy).toBe('ana');
  }, RUN_TIMEOUT_MS);

  it('AC-43 a checkpoint whose document is not in the run directory escalates CRITICAL_ISSUE and the approver is never asked', async () => {
    // The run directory's USER_STORY.md is replaced, right after it is persisted, by a symlink to a
    // stale copy in the project root. The story gate reads through it and passes; the checkpoint
    // presents only a regular file in the run directory, so it refuses. (A story returned without
    // its content no longer gets this far: MINOR-8 refuses it at the schema.)
    const stale = story().details.artifacts[0].content!;
    writeFileSync(join(project.dir, 'USER_STORY.md'), stale);
    const swapForSymlink = (message: string) => {
      const persisted = /📄 02-story-writer → (\S*USER_STORY\.md)$/.exec(message);
      if (!persisted) return;
      const inRunDir = join(project.dir, persisted[1]);
      rmSync(inRunDir);
      symlinkSync(join(project.dir, 'USER_STORY.md'), inRunDir);
    };
    const approver = jest.fn(async (_request: CheckpointRequest) => true);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver, logger: swapForSymlink });

    expect(approver).not.toHaveBeenCalled();
    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 2, agent: 'harness', reason: 'CRITICAL_ISSUE' });
    expect(escalation.context.message).toMatch(/CHECKPOINT 1/);
    expect(escalation.context.blockers).toEqual([join(project.dir, '.factory', state.featureId, 'USER_STORY.md')]);
    expect(invoker.agents()).not.toContain('03-spec-writer');
  }, RUN_TIMEOUT_MS);

  it('AC-43 the orchestrator never hands an agent summary to a checkpoint (source scan)', () => {
    const source = readFileSync(join(__dirname, '../../feature/workflows/feature-factory-orchestrator.ts'), 'utf8');
    expect(source).not.toMatch(/checkpoint\(CHECKPOINTS\.\w+,[^)]*summary/);
    expect(source).not.toMatch(/summary:\s*\w+\.details\.summary/);
  });
});

/** Approve every checkpoint before `id`, then answer `id` with `decision`. */
const answerAt = (id: number, decision: unknown) => decisions(...Array<unknown>(id - 1).fill(true), decision);

/** What may not have run after a run stopped at checkpoint `id`. */
const AFTER_CHECKPOINT: Record<number, string> = { 1: '03-spec-writer', 2: '04-backend-builder', 3: '08-feature-consolidator' };

describe('AC-49 PAUSE', () => {
  it.each<[number, number, string[] | undefined]>([
    [1, 2, undefined],
    [2, 2, undefined],
    [3, 4, ['src/a.ts']]
  ])(
    'AC-49 a PAUSE at CP%i records status PAUSED and a pendingCheckpoint with name, stage, artifact paths and hash, without finishing the run',
    async (id, stage, changedFiles) => {
      const approver = answerAt(id, { decision: 'PAUSE' });
      const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

      const request = approver.requests.at(-1)!;
      expect(request.id).toBe(id);
      expect(state.status).toBe('PAUSED');
      expect(state.completedAt).toBeUndefined();
      expect(state.completionStatus).toBeUndefined();
      expect(classifyRun(state)).toBe('PAUSED');
      expect(state.pendingCheckpoint).toEqual({
        checkpointId: id,
        name: request.name,
        stage,
        artifactPaths: request.artifactPaths.map(path => relative(project.dir, path)),
        sha256: request.sha256,
        ...(changedFiles ? { changedFiles } : {}),
        pausedAt: expect.any(String)
      });
      expect(state.checkpointApprovals.map(a => a.checkpointId)).toEqual([1, 2].slice(0, id - 1));
      expect(state.currentStage).toBe(stage);
      // Committed, not finished: the record on disk is the paused state.
      expect(onDisk()).toEqual(state);
      // Nothing after the checkpoint ran, and a paused run leaves no baseline.
      expect(invoker.agents()).not.toContain(AFTER_CHECKPOINT[id]);
      expect(existsSync(baselineFilePath(project.dir))).toBe(false);
    },
    RUN_TIMEOUT_MS
  );

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['the string yes', 'yes'],
    ['an unknown decision', { decision: 'MAYBE' }]
  ])('I-18 an approver returning %s pauses the run: no approval is recorded and nothing after the checkpoint runs', async (_label, value) => {
    const approver = decisions(value);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

    expect(state.status).toBe('PAUSED');
    expect(state.pendingCheckpoint?.checkpointId).toBe(1);
    expect(state.checkpointApprovals).toEqual([]);
    expect(state.escalations).toEqual([]);
    expect(invoker.agents()).not.toContain('03-spec-writer');
  }, RUN_TIMEOUT_MS);
});

describe('AC-46 REJECT', () => {
  it.each<[number, number, string[]]>([
    [1, 2, ['02-story-writer']],
    [2, 2, ['03-spec-writer']],
    [3, 4, ['04-backend-builder']]
  ])('AC-46 rejecting CP%i ends ESCALATED with reason MANUAL and the run is resumable', async (id, stage, reworkAgents) => {
    const reject = { decision: 'REJECT', notes: 'Cover account recovery.' };
    const approver = answerAt(id, reject);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

    const request = approver.requests.at(-1)!;
    expect(request.id).toBe(id);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(classifyRun(state)).toBe('ESCALATED');
    expect(isResumable(state)).toBe(true);
    expect(state.pendingCheckpoint).toBeUndefined();

    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage, agent: 'human', reason: 'MANUAL' });
    expect(escalation.context).toMatchObject({ checkpointId: id, notes: 'Cover account recovery.' });
    expect(escalation.context.message).toBe(`${request.name} was rejected.`);

    expect(state.checkpointRejections).toEqual([
      {
        checkpointId: id,
        name: request.name,
        stage,
        notes: 'Cover account recovery.',
        sha256: request.sha256,
        artifactPaths: request.artifactPaths.map(path => relative(project.dir, path)),
        reworkAgents,
        rejectedAt: expect.any(String),
        source: 'approver'
      }
    ]);
    expect(onDisk()).toEqual(state);
    expect(invoker.agents()).not.toContain(AFTER_CHECKPOINT[id]);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('I-10 a CP3 rejection whose change holds no builder file re-runs every builder that ran', async () => {
    const approver = answerAt(3, { decision: 'REJECT', notes: 'Wrong approach.' });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: approver.approve,
      changes: fakeChangeTracker({ files: ['README.md'] })
    });

    expect(state.checkpointRejections!.map(r => [r.checkpointId, r.reworkAgents])).toEqual([[3, ['04-backend-builder']]]);
  }, RUN_TIMEOUT_MS);

  it('I-18 a legacy false is a rejection with empty notes, as from a TTY', async () => {
    const approver = decisions(false);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.checkpointRejections).toHaveLength(1);
    expect(state.checkpointRejections![0]).toMatchObject({ checkpointId: 1, notes: '', source: 'approver' });
    expect(state.escalations.at(-1)!.context.notes).toBe('');
  }, RUN_TIMEOUT_MS);
});

describe('AC-56 / AC-57 / AC-78 the split Stage 2 gate', () => {
  it('AC-56 a story failing the story gate ends the run before CP1 and the approver is never called', async () => {
    const approver = jest.fn(async (_request: CheckpointRequest) => true);
    const invoker = scriptedInvoker({ ...passingScript(), '02-story-writer': untestableStory() }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver });

    expect(approver).not.toHaveBeenCalled();
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.checkpointApprovals).toEqual([]);
    expect(invoker.agents()).not.toContain('03-spec-writer');
  }, RUN_TIMEOUT_MS);

  it.each<[string, Partial<Record<FeatureFactoryAgent, object>>, RegExp, RegExp, (() => (message: string) => void) | undefined]>([
    ['story', { '02-story-writer': untestableStory() }, /^Story gate failed/, /Given\/When\/Then/, undefined],
    ['spec', {}, /^Spec gate failed/, /TECHNICAL_BRIEF\.md/, briefMissingAtGate]
  ])('AC-57 a %s-part Stage 2 gate failure escalates with blockers', async (_part, overrides, message, blocker, logger) => {
    const invoker = scriptedInvoker({ ...passingScript(), ...overrides }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, ...(logger ? { logger: logger() } : {}) });

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 2, agent: 'harness', reason: 'CRITICAL_ISSUE' });
    expect(escalation.context.message).toMatch(message);
    expect(escalation.context.blockers!.length).toBeGreaterThan(0);
    expect(escalation.context.blockers!.join('\n')).toMatch(blocker);
  }, RUN_TIMEOUT_MS);

  it('AC-78 a spec failing the spec gate ends the run before CP2 and the approver is never called for CP2', async () => {
    const approver = decisions();
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve, logger: briefMissingAtGate() });

    expect(approver.requests.map(r => r.id)).toEqual([1]);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.checkpointApprovals.map(a => a.checkpointId)).toEqual([1]);
    expect(invoker.agents()).not.toContain('04-backend-builder');
  }, RUN_TIMEOUT_MS);
});

describe('AC-55 the pre-supplied spec path', () => {
  it('AC-55 a pre-supplied spec saves the story and brief in the run directory, builder prompts name existing paths, and CP1 and CP2 are presented', async () => {
    const shown: Array<{ request: CheckpointRequest; files: string[] }> = [];
    const record = (request: CheckpointRequest) => (shown.push({ request, files: filesBehind(request) }), true);
    const approver = decisions(record, record, record);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: approver.approve,
      // The brief's file list matches what the scripted Backend Builder writes, so the run can finish.
      preSuppliedSpec: featureSpec({ files: ['src/a.ts'] })
    });
    const runDir = join(project.dir, '.factory', state.featureId);

    // The planning agents never ran: the supplied outputs stand in for them.
    expect(invoker.agents()).not.toContain('01-researcher');
    expect(invoker.agents()).not.toContain('02-story-writer');
    expect(invoker.agents()).not.toContain('03-spec-writer');

    // One tier-1 PASS step per supplied output, keyed by the output's own agent.
    const tier1 = state.stageHistory.filter(step => step.agent === 'tier-1');
    expect(tier1.map(step => [step.stage, step.status, step.output?.agent])).toEqual([
      [2, 'PASS', '02-story-writer'],
      [2, 'PASS', '03-spec-writer']
    ]);

    // CP1 and CP2 were presented, from the run directory's own documents (and CP3 at the end).
    expect(shown.map(s => s.request.id)).toEqual([1, 2, 3]);
    expect(shown[0].request.artifactPaths).toEqual([join(runDir, 'USER_STORY.md')]);
    expect(shown[0].request.text).toBe(shown[0].files[0]);
    expect(shown[1].request.artifactPaths).toEqual([join(runDir, 'TECHNICAL_BRIEF.md'), join(runDir, 'FILE_LIST.md')]);
    expect(state.checkpointApprovals.map(a => [a.checkpointId, a.sha256])).toEqual(
      shown.map(s => [s.request.id, s.request.sha256])
    );

    // The builder's prompt names the brief by a path that exists.
    const brief = join(runDir, 'TECHNICAL_BRIEF.md');
    expect(existsSync(brief)).toBe(true);
    expect(invoker.promptsFor('04-backend-builder')[0]).toContain(brief);
    expect(state.escalations.map(e => e.context.message)).toEqual([]);
    expect(state.completionStatus).toBe('SUCCESS');
  }, RUN_TIMEOUT_MS);

  it('AC-55 a supplied researcher output is recorded as a tier-1 step at stage 1', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: decisions({ decision: 'PAUSE' }).approve,
      preSuppliedSpec: { ...featureSpec(), researcher: researcher() }
    });

    expect(state.stageHistory.filter(step => step.agent === 'tier-1').map(step => [step.stage, step.output?.agent])).toEqual([
      [1, '01-researcher'],
      [2, '02-story-writer'],
      [2, '03-spec-writer']
    ]);
    expect(invoker.agents()).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-55 a pre-supplied run stays in Stage 2 until CP2 is approved: a pause at CP1 builds nothing', async () => {
    const approver = decisions({ decision: 'PAUSE' });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: approver.approve,
      preSuppliedSpec: featureSpec()
    });

    expect(approver.requests.map(r => r.id)).toEqual([1]);
    expect(state.status).toBe('PAUSED');
    expect(state.currentStage).toBe(2);
    expect(invoker.agents()).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-56 a pre-supplied spec is judged by the same story gate, and a failing one never reaches CP1', async () => {
    const supplied = featureSpec();
    supplied.story = untestableStory();
    const approver = jest.fn(async (_request: CheckpointRequest) => true);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: approver,
      preSuppliedSpec: supplied
    });

    expect(approver).not.toHaveBeenCalled();
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.agent).toBe('tier-1');
    expect(invoker.agents()).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-44 CP3 and SUCCESS', () => {
  it('AC-44 CP3 is presented after the Stage 4 gate with the IMPORTANT findings, and approving it ends SUCCESS with no Consolidator invocation', async () => {
    const events: string[] = [];
    const script = passingScript();
    script['07-validator'] = validator({
      issues: [
        { severity: 'IMPORTANT', message: 'Consider rate limiting the endpoint', file: 'src/a.ts', line: 3, suggestion: 'Add a limiter', canFix: true }
      ]
    });
    const invoker = scriptedInvoker(script, { cwd: project.dir });
    const invoke = async (call: AgentInvocation) => (events.push(call.agent), invoker.invoke(call));
    const approver = decisions(true, true, (request: CheckpointRequest) => (events.push(`CP${request.id}`), true));
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 12, passed: 10, failed: 0, warnings: ['2 tests skipped'] }) });
    const changes = fakeChangeTracker();

    const state = await runToEnd({ cwd: project.dir, invoke, approveCheckpoint: approver.approve, gates: recorded.gates, changes });

    // CP3 is the last thing asked, after the Validator, and the Consolidator never runs.
    expect(events.slice(-2)).toEqual(['07-validator', 'CP3']);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');

    const cp3 = approver.requests[2];
    expect(cp3).toMatchObject({ id: 3, name: CHECKPOINTS.CHANGE.name, stage: 4 });
    for (const finding of state.importantFindings!) {
      expect(cp3.text).toContain(`- [Stage ${finding.stage} · ${finding.source}] ${finding.message}`);
    }
    expect(cp3.text).toContain('2 tests skipped');
    expect(cp3.text).toContain('[src/a.ts:3] Consider rate limiting the endpoint');

    // The change was collected against the base captured when the run started, from the claims.
    expect(changes.calls).toEqual([
      { method: 'captureBase', cwd: project.dir },
      { method: 'collect', cwd: project.dir, base: FAKE_BASE, claimedFiles: ['src/a.ts'] }
    ]);
    expect(state.changeBase).toEqual(FAKE_BASE);

    // SUCCESS = Stage 4 gate passed + CP3 approved. The run stays in Stage 4 (I-18).
    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.currentStage).toBe(4);
    expect(state.checkpointApprovals.map(a => [a.checkpointId, a.sha256])).toEqual(
      approver.requests.map(r => [r.id, r.sha256])
    );
    expect(state.stageHistory.some(step => step.stage === 5)).toBe(false);
    expect(onDisk()).toEqual(state);
  }, RUN_TIMEOUT_MS);

  it('AC-44 a Stage 4 gate failure ends the run before CP3: the approver is never asked for it and no baseline is written', async () => {
    // A failed security check fails the Stage 4 gate. (A Validator with no VALIDATION_REPORT.md no
    // longer reaches the gate: MINOR-8 refuses it at the schema.)
    const insecure = validator({ security: { authImplemented: false } });
    const approver = decisions();
    const invoker = scriptedInvoker({ ...passingScript(), '07-validator': insecure }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(approver.requests.map(r => r.id)).toEqual([1, 2]);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('AC-43 a CP3 whose change cannot be collected escalates CRITICAL_ISSUE and the approver is never asked for CP3', async () => {
    const approver = decisions();
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const changes = fakeChangeTracker({
      collect: async () => {
        throw new ChangeDiffError('The CP3 change could not be collected: git diff failed: bad object');
      }
    });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve, changes });

    expect(approver.requests.map(r => r.id)).toEqual([1, 2]);
    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations.at(-1)!;
    expect(escalation).toMatchObject({ stage: 4, agent: 'harness', reason: 'CRITICAL_ISSUE' });
    expect(escalation.context.message).toMatch(/CHECKPOINT 3.*bad object/);
    expect(escalation.context.blockers!.join('\n')).toMatch(/bad object/);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('D-8 a fresh run records its change base and feature description before any agent runs', async () => {
    let atFirstAgent: FeatureState | undefined;
    const script = passingScript();
    script['01-researcher'] = () => ((atFirstAgent = onDisk()), researcher());
    const invoker = scriptedInvoker(script, { cwd: project.dir });

    await runToEnd({ cwd: project.dir, invoke: invoker.invoke, featureDescription: 'add TOTP 2FA to login' });

    expect(atFirstAgent!.changeBase).toEqual(FAKE_BASE);
    expect(atFirstAgent!.featureDescription).toBe('add TOTP 2FA to login');
  }, RUN_TIMEOUT_MS);
});

describe('AC-65 the regression baseline is written at SUCCESS', () => {
  it('AC-65 a SUCCESS run writes .factory/baseline.json with its Gate 2 ran-count and run id outside the run directory, and the next run uses it as the reference', async () => {
    // 12 reported, 2 skipped: the baseline is the 10 that RAN (IMPORTANT-5).
    const first = recordingGates({ auditExecution: executionAudit({ total: 12, passed: 10, failed: 0 }) });
    const firstRun = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      gates: first.gates
    });

    expect(firstRun.completionStatus).toBe('SUCCESS');
    expect(readRegressionBaseline(project.dir)).toEqual({
      schemaVersion: 1,
      runId: firstRun.featureId,
      testCount: 10,
      recordedAt: expect.any(String)
    });
    expect(baselineFilePath(project.dir)).toBe(join(project.dir, '.factory', 'baseline.json'));
    expect(existsSync(join(project.dir, '.factory', firstRun.featureId, 'baseline.json'))).toBe(false);

    // The next run in the same project archives the first and judges its Gate 2 against 10.
    const second = recordingGates({ auditExecution: executionAudit({ total: 9 }) });
    const secondRun = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      gates: second.gates
    });

    expect(existsSync(join(project.dir, '.factory', '_archive', firstRun.featureId))).toBe(true);
    expect(secondRun.executionGateHistory?.[0].referenceCount).toBe(10);
    expect(secondRun.completionStatus).toBe('ESCALATED');
    expect(secondRun.escalations[0].context.blockers?.join('\n')).toMatch(/No Regressions/);
    // A failed run leaves the previous baseline in place.
    expect(readRegressionBaseline(project.dir)?.runId).toBe(firstRun.featureId);
  }, RUN_TIMEOUT_MS * 2);
});

// ==========================================================================================
// Step 7: deciding a paused checkpoint on resume, and the rework after a rejection
// ==========================================================================================

/** The bytes of the only run's state.json. */
function stateBytes(): string {
  return readFileSync(join(project.dir, '.factory', onDisk().featureId, 'state.json'), 'utf8');
}

/** The only run's directory. */
const runDirOf = (state: FeatureState) => join(project.dir, '.factory', state.featureId);

/** Run to the checkpoint `id` and pause there. */
async function pausedAt(id: number, overrides: Partial<Parameters<typeof runToEnd>[0]> = {}): Promise<FeatureState> {
  const paused = await runToEnd({
    cwd: project.dir,
    invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
    approveCheckpoint: answerAt(id, { decision: 'PAUSE' }).approve,
    ...overrides
  });
  expect(paused.pendingCheckpoint?.checkpointId).toBe(id);
  return paused;
}

/** Resume the only run with `resume`; any refusal is returned instead of thrown. */
async function resumeWith(
  resume: Parameters<typeof runToEnd>[0]['resume'],
  overrides: Partial<Parameters<typeof runToEnd>[0]> = {}
): Promise<{ state?: FeatureState; refusal?: unknown; invoker: ReturnType<typeof scriptedInvoker>; approver: ReturnType<typeof decisions> }> {
  const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
  const approver = decisions();
  try {
    const state = await runToEnd({
      cwd: project.dir,
      invoke: invoker.invoke,
      approveCheckpoint: approver.approve,
      resumeFromState: onDisk(),
      ...(resume ? { resume } : {}),
      ...overrides
    });
    return { state, invoker, approver };
  } catch (refusal) {
    return { refusal, invoker, approver };
  }
}

describe('AC-51 / AC-52 --approve on resume', () => {
  it.each<[number, string[], number[]]>([
    [1, ['03-spec-writer', '04-backend-builder', '06-test-verifier', '07-validator'], [2, 3]],
    [2, ['04-backend-builder', '06-test-verifier', '07-validator'], [3]],
    [3, [], []]
  ])('AC-51 --approve of the pending checkpoint with an unchanged artifact records its hash and continues without asking again (CP%i)', async (id, agents, asked) => {
    const paused = await pausedAt(id);
    const pending = paused.pendingCheckpoint!;

    let atFirstAgent: FeatureState | undefined;
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const approver = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: async call => ((atFirstAgent ??= onDisk()), invoker.invoke(call)),
      approveCheckpoint: approver.approve,
      resumeFromState: onDisk(),
      resume: { action: { kind: 'approve', checkpoint: id as 1 | 2 | 3 } }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(invoker.agents()).toEqual(agents);
    expect(approver.requests.map(r => r.id)).toEqual(asked);
    const approval = state.checkpointApprovals.find(a => a.checkpointId === id)!;
    expect(approval).toMatchObject({ checkpointName: pending.name, stage: pending.stage, sha256: pending.sha256, approvedBy: 'resume --approve' });
    expect(state.checkpointApprovals.filter(a => a.checkpointId === id)).toHaveLength(1);
    expect(state.resumeHistory).toEqual([expect.objectContaining({ fromClass: 'PAUSED', action: 'approve', checkpointId: id })]);
    // The decision is on disk before anything runs on the strength of it (AC-38).
    if (atFirstAgent) {
      expect(atFirstAgent.checkpointApprovals.map(a => a.checkpointId)).toContain(id);
      expect(atFirstAgent.pendingCheckpoint).toBeUndefined();
      expect(atFirstAgent.status).toBe('IN_PROGRESS');
    }
    expect(existsSync(baselineFilePath(project.dir))).toBe(true);
  }, RUN_TIMEOUT_MS);

  it.each<[string, number, (state: FeatureState) => Partial<Parameters<typeof runToEnd>[0]>]>([
    ['CP1, USER_STORY.md edited', 1, state => (writeFileSync(join(runDirOf(state), 'USER_STORY.md'), '# User Story\n\nEdited after it was shown.'), {})],
    ['CP2, FILE_LIST.md edited', 2, state => (writeFileSync(join(runDirOf(state), 'FILE_LIST.md'), '# Files\n\n- src/other.ts (CREATE)'), {})],
    ['CP3, VALIDATION_REPORT.md edited', 3, state => (writeFileSync(join(runDirOf(state), 'VALIDATION_REPORT.md'), '# Validation Report\n\nRewritten.'), {})],
    ['CP3, the change differs', 3, () => ({ changes: fakeChangeTracker({ text: 'A different change.\n' }) })],
    ['CP3, the change can no longer be collected', 3, () => ({ changes: fakeChangeTracker({ collect: async () => { throw new ChangeDiffError('git diff failed'); } }) })]
  ])("AC-52 --approve after the artifact changed is refused with 'artifact changed', no approval is recorded and the run stays PAUSED (%s)", async (_label, id, change) => {
    const paused = await pausedAt(id);
    const overrides = change(paused);
    const before = stateBytes();

    const { state, refusal, invoker, approver } = await resumeWith({ action: { kind: 'approve', checkpoint: id as 1 | 2 | 3 } }, overrides);

    expect(state).toBeUndefined();
    expect(refusal).toBeInstanceOf(RunRefusedError);
    expect(refusal).toMatchObject({ code: 'ARTIFACT_CHANGED' });
    expect((refusal as Error).message).toMatch(/artifact changed/i);
    expect((refusal as Error).message).toContain(paused.pendingCheckpoint!.name);
    expect(stateBytes()).toBe(before);
    expect(onDisk().status).toBe('PAUSED');
    expect(onDisk().checkpointApprovals.map(a => a.checkpointId)).toEqual([1, 2].slice(0, id - 1));
    expect(invoker.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('MINOR-6 artifact-changed refusals quote --cwd the way the next-step hints do', () => {
  /** A project path with a space and a single quote: unquoted, the printed command would not run. */
  const quotedProject = () => {
    project.cleanup();
    project = tempProject("ff checkpoint 'q' ");
    return `'${project.dir.replace(/'/g, `'\\''`)}'`;
  };

  it('MINOR-6 ARTIFACT_CHANGED quotes --cwd in its reject and close commands', async () => {
    const cwd = quotedProject();
    const paused = await pausedAt(1);
    writeFileSync(join(runDirOf(paused), 'USER_STORY.md'), '# User Story\n\nEdited after it was shown.');

    const { refusal } = await resumeWith({ action: { kind: 'approve', checkpoint: 1 } });

    expect(refusal).toMatchObject({ code: 'ARTIFACT_CHANGED' });
    const message = (refusal as Error).message;
    expect(message).toContain(`--reject 1 --notes "<why>" --cwd ${cwd}`);
    expect(message).toContain(`--close ${paused.featureId} --cwd ${cwd}`);
  }, RUN_TIMEOUT_MS);

  it('MINOR-6 APPROVED_ARTIFACT_CHANGED quotes --cwd in its close command', async () => {
    const cwd = quotedProject();
    const paused = await pausedAt(2);
    writeFileSync(join(runDirOf(paused), 'USER_STORY.md'), '# User Story\n\nEdited after it was approved.');

    const { refusal } = await resumeWith({ action: { kind: 'reject', checkpoint: 2, notes: 'Split the endpoint.' } });

    expect(refusal).toMatchObject({ code: 'APPROVED_ARTIFACT_CHANGED' });
    expect((refusal as Error).message).toContain(`--close ${paused.featureId} --cwd ${cwd}`);
  }, RUN_TIMEOUT_MS);
});

describe('AC-53 / AC-54 / AC-74 deciding a paused checkpoint', () => {
  it.each<['approve' | 'reject']>([['approve'], ['reject']])(
    'AC-53 --%s naming a checkpoint other than the pending one is refused and state.json is unchanged',
    async kind => {
      await pausedAt(2);
      const before = stateBytes();

      const action = kind === 'approve' ? { kind, checkpoint: 1 as const } : { kind, checkpoint: 3 as const, notes: 'Not this one.' };
      const { refusal, invoker, approver } = await resumeWith({ action });

      expect(refusal).toBeInstanceOf(RunRefusedError);
      expect(refusal).toMatchObject({ code: 'WRONG_CHECKPOINT' });
      expect(stateBytes()).toBe(before);
      expect(invoker.calls).toEqual([]);
      expect(approver.requests).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-54 resuming a PAUSED run with neither --approve nor --reject does not pass the pending checkpoint', async () => {
    await pausedAt(3);
    const before = stateBytes();

    const { state, invoker, approver } = await resumeWith(undefined);

    expect(state!.status).toBe('PAUSED');
    expect(state!.pendingCheckpoint?.checkpointId).toBe(3);
    expect(state!.checkpointApprovals.map(a => a.checkpointId)).toEqual([1, 2]);
    expect(stateBytes()).toBe(before);
    expect(invoker.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it.each<[number, number, string[]]>([
    [1, 2, ['02-story-writer']],
    [2, 2, ['03-spec-writer']],
    [3, 4, ['04-backend-builder']]
  ])('AC-74 --reject <cp> --notes ends ESCALATED MANUAL, records the notes and the rejected checkpoint, and stays resumable (CP%i)', async (id, stage, reworkAgents) => {
    const paused = await pausedAt(id);
    const pending = paused.pendingCheckpoint!;

    const { state, invoker, approver } = await resumeWith({ action: { kind: 'reject', checkpoint: id as 1 | 2 | 3, notes: 'Split the migration.' } });

    expect(state!.completionStatus).toBe('ESCALATED');
    expect(isResumable(state!)).toBe(true);
    expect(state!.pendingCheckpoint).toBeUndefined();
    expect(state!.escalations.at(-1)).toMatchObject({ stage, agent: 'human', reason: 'MANUAL' });
    expect(state!.escalations.at(-1)!.context).toMatchObject({ checkpointId: id, notes: 'Split the migration.', message: `${pending.name} was rejected.` });
    expect(state!.checkpointRejections).toEqual([
      {
        checkpointId: id,
        name: pending.name,
        stage,
        notes: 'Split the migration.',
        sha256: pending.sha256,
        artifactPaths: pending.artifactPaths,
        reworkAgents,
        rejectedAt: expect.any(String),
        source: 'resume --reject'
      }
    ]);
    expect(state!.resumeHistory).toEqual([expect.objectContaining({ fromClass: 'PAUSED', action: 'reject', checkpointId: id })]);
    expect(onDisk()).toEqual(state);
    // A rejection re-runs nothing by itself: the rework starts on the next resume.
    expect(invoker.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

/** A timeline of agents, checkpoints and the injected Gate 1.5 / Gate 2 audits; Gate 1 from its log line. */
function timelineFor(script: ReturnType<typeof passingScript>) {
  const events: string[] = [];
  const invoker = scriptedInvoker(script, { cwd: project.dir });
  const recorded = recordingGates();
  return {
    events,
    invoker,
    invoke: async (call: AgentInvocation) => (events.push(call.agent), invoker.invoke(call)),
    approver: decisions((r: CheckpointRequest) => (events.push(`CP${r.id}`), true), (r: CheckpointRequest) => (events.push(`CP${r.id}`), true), (r: CheckpointRequest) => (events.push(`CP${r.id}`), true)),
    gates: {
      auditInfrastructure: async (root: string) => (events.push('gate-1.5'), recorded.gates.auditInfrastructure(root)),
      auditExecution: async (root: string) => (events.push('gate-2'), recorded.gates.auditExecution(root))
    },
    logger: (message: string) => {
      if (/artifacts verified to exist on disk/.test(message)) events.push('gate-1');
    }
  };
}

describe('AC-75 rework after a rejection', () => {
  it('AC-75 after a CP1 rejection, resume re-runs the Story Writer with the notes, then the story gate, then CP1', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: answerAt(1, { decision: 'REJECT', notes: 'Cover account recovery.' }).approve
    });
    const runDir = runDirOf(first);
    const rejected = readFileSync(join(runDir, 'USER_STORY.md'), 'utf8');

    const revised = story();
    revised.details.artifacts[0].content = revised.details.artifacts[0].content!.replace('is secure.', 'is secure and recoverable.');
    const run = timelineFor({ ...passingScript(), '02-story-writer': revised });
    const state = await runToEnd({ cwd: project.dir, invoke: run.invoke, approveCheckpoint: run.approver.approve, gates: run.gates, resumeFromState: onDisk() });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(run.events.filter(e => !e.startsWith('gate'))).toEqual(['02-story-writer', 'CP1', '03-spec-writer', 'CP2', '04-backend-builder', '06-test-verifier', '07-validator', 'CP3']);

    const superseded = join(runDir, '_superseded', '1', 'USER_STORY.md');
    expect(readFileSync(superseded, 'utf8')).toBe(rejected);
    const prompt = run.invoker.promptsFor('02-story-writer')[0];
    expect(prompt).toContain(CHECKPOINTS.STORY.name);
    expect(prompt).toContain('  > Cover account recovery.');
    expect(prompt).toContain(superseded);

    // CP1 presented the new story, and the new approval is bound to it.
    const cp1 = run.approver.requests[0];
    expect(cp1.text).toBe(revised.details.artifacts[0].content);
    expect(cp1.sha256).not.toBe(first.checkpointRejections![0].sha256);
    expect(state.checkpointApprovals.find(a => a.checkpointId === 1)!.sha256).toBe(cp1.sha256);

    expect(state.checkpointRejections![0].rework).toEqual({ startedAt: expect.any(String), supersededDir: relative(project.dir, join(runDir, '_superseded', '1')) });
    expect(state.stageHistory.filter(s => s.agent === '02-story-writer').map(s => [s.status, s.invalidated !== undefined])).toEqual([
      ['PASS', true],
      ['PASS', false]
    ]);
  }, RUN_TIMEOUT_MS);

  it('AC-75 after a CP2 rejection, resume re-runs the Spec Writer with the notes, then the spec gate, then CP2', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: answerAt(2, { decision: 'REJECT', notes: 'Use otplib, not speakeasy.' }).approve
    });
    const runDir = runDirOf(first);

    const revised = spec();
    revised.details.artifacts[0].content = '# Technical Brief\n\nTOTP via otplib.';
    const run = timelineFor({ ...passingScript(), '03-spec-writer': revised });
    const state = await runToEnd({ cwd: project.dir, invoke: run.invoke, approveCheckpoint: run.approver.approve, gates: run.gates, resumeFromState: onDisk() });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(run.events.filter(e => !e.startsWith('gate'))).toEqual(['03-spec-writer', 'CP2', '04-backend-builder', '06-test-verifier', '07-validator', 'CP3']);

    const supersededDir = join(runDir, '_superseded', '1');
    expect(readdirSync(supersededDir).sort()).toEqual(['FILE_LIST.md', 'TECHNICAL_BRIEF.md']);
    const prompt = run.invoker.promptsFor('03-spec-writer')[0];
    expect(prompt).toContain(CHECKPOINTS.BRIEF.name);
    expect(prompt).toContain('  > Use otplib, not speakeasy.');
    expect(prompt).toContain(join(supersededDir, 'TECHNICAL_BRIEF.md'));

    const cp2 = run.approver.requests[0];
    expect(cp2.id).toBe(2);
    expect(cp2.text.startsWith('# Technical Brief\n\nTOTP via otplib.')).toBe(true);
    expect(state.checkpointApprovals.filter(a => a.checkpointId === 2).at(-1)!.sha256).toBe(cp2.sha256);
    // CP1's approval stands: it was not asked again.
    expect(state.checkpointApprovals.filter(a => a.checkpointId === 1)).toHaveLength(1);
  }, RUN_TIMEOUT_MS);

  it('AC-75 after a CP3 rejection, resume re-invokes each builder with files in the diff, then Gates 1, 1.5, 2, the Test Verifier, the Validator and the Stage 4 gate, then CP3, and the new approval binds to the new hash', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: answerAt(3, { decision: 'REJECT', notes: 'Use the existing rate limiter.' }).approve,
      changes: fakeChangeTracker({ text: 'The rejected change.\n' })
    });
    const runDir = runDirOf(first);
    const rejectedReport = readFileSync(join(runDir, 'VALIDATION_REPORT.md'), 'utf8');

    const run = timelineFor(passingScript());
    const state = await runToEnd({
      cwd: project.dir,
      invoke: run.invoke,
      approveCheckpoint: run.approver.approve,
      gates: run.gates,
      logger: run.logger,
      changes: fakeChangeTracker({ text: 'The reworked change.\n' }),
      resumeFromState: onDisk()
    });

    expect(state.completionStatus).toBe('SUCCESS');
    // I-10 order: rework builders → Gate 1 (→ Stage 3 gate) → Gate 1.5 → Test Verifier ∥ Validator → Gate 2 → (Stage 4 gate) → CP3.
    expect(run.events).toEqual(['04-backend-builder', 'gate-1', 'gate-1.5', '06-test-verifier', '07-validator', 'gate-2', 'CP3']);

    const supersededDir = join(runDir, '_superseded', '1');
    expect(readdirSync(supersededDir).sort()).toEqual(['TEST_REPORT.md', 'VALIDATION_REPORT.md']);
    expect(readFileSync(join(supersededDir, 'VALIDATION_REPORT.md'), 'utf8')).toBe(rejectedReport);
    const prompt = run.invoker.promptsFor('04-backend-builder')[0];
    expect(prompt).toContain(CHECKPOINTS.CHANGE.name);
    expect(prompt).toContain('  > Use the existing rate limiter.');
    expect(prompt).toContain(join(supersededDir, 'VALIDATION_REPORT.md'));

    // The rework has its own attempt budget, and its step says so.
    expect(state.builderAttempts?.['04-backend-builder']?.rework).toEqual({ 1: 1 });
    expect(state.stageHistory.filter(s => s.agent === '04-backend-builder').map(s => [s.phase, s.round])).toEqual([
      ['stage3', undefined],
      ['rework', 1]
    ]);
    // Validator rounds are not reset (I-10): Gate 2 continues at the round the run had reached.
    expect(state.executionGateHistory!.map(r => r.round)).toEqual([0, 0]);

    // CP3 presented the new change, and the new approval binds to the new hash.
    const cp3 = run.approver.requests[0];
    expect(cp3.id).toBe(3);
    expect(cp3.text.endsWith('The reworked change.\n')).toBe(true);
    expect(cp3.sha256).not.toBe(first.checkpointRejections![0].sha256);
    expect(state.checkpointApprovals.find(a => a.checkpointId === 3)!.sha256).toBe(cp3.sha256);
    expect(existsSync(baselineFilePath(project.dir))).toBe(true);
  }, RUN_TIMEOUT_MS);

  it('MINOR-8 a superseded VALIDATION_REPORT.md cannot satisfy the Stage 4 gate after a CP3 rework', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: answerAt(3, { decision: 'REJECT', notes: 'Redo the validation.' }).approve
    });
    const runDir = runDirOf(first);

    // The reworked Validator returns no report. The rejected one still exists — superseded.
    const noReport = validator();
    noReport.details.artifacts = [];
    const { state, approver } = await resumeWith(undefined, {
      invoke: scriptedInvoker({ ...passingScript(), '07-validator': noReport }, { cwd: project.dir }).invoke
    });

    expect(state!.completionStatus).toBe('ESCALATED');
    const escalation = state!.escalations.at(-1)!;
    expect([escalation.stage, escalation.agent, escalation.reason]).toEqual([4, '07-validator', 'SCHEMA_VALIDATION']);
    expect(approver.requests).toEqual([]);
    expect(existsSync(join(runDir, '_superseded', '1', 'VALIDATION_REPORT.md'))).toBe(true);
    expect(existsSync(join(runDir, 'VALIDATION_REPORT.md'))).toBe(false);
    // Nothing a gate reads still names the superseded report.
    const readable = readArtifactContents(rebuildOutputs(state!, project.dir), project.dir, `.factory/${state!.featureId}`);
    expect(readable['VALIDATION_REPORT.md']).toBeUndefined();
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);
});

describe('D-B a pre-supplied story or brief is reworked by the factory\'s own planning agents', () => {
  const supplied = () => featureSpec({ files: ['src/a.ts'] });

  it('D-B after a pre-supplied story is rejected at CP1, resume re-runs the factory\'s Story Writer with the notes, then the story gate and CP1, and the run continues', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: answerAt(1, { decision: 'REJECT', notes: 'Name the recovery codes.' }).approve,
      preSuppliedSpec: supplied()
    });
    expect(first.checkpointRejections!.map(r => r.reworkAgents)).toEqual([['02-story-writer']]);

    const { state, invoker, approver } = await resumeWith(undefined);

    expect(state!.completionStatus).toBe('SUCCESS');
    expect(invoker.agents()).toEqual(['02-story-writer', '04-backend-builder', '06-test-verifier', '07-validator']);
    expect(approver.requests.map(r => r.id)).toEqual([1, 2, 3]);
    const prompt = invoker.promptsFor('02-story-writer')[0];
    expect(prompt).toContain('  > Name the recovery codes.');
    expect(prompt).toContain(join(runDirOf(first), '_superseded', '1', 'USER_STORY.md'));
    // The supplied story is kept for the record, flagged; the brief it came with still stands.
    const tier1 = state!.stageHistory.filter(s => s.agent === 'tier-1');
    expect(tier1.map(s => [s.output?.agent, s.invalidated !== undefined])).toEqual([
      ['02-story-writer', true],
      ['03-spec-writer', false]
    ]);
  }, RUN_TIMEOUT_MS);

  it('D-B a pre-supplied story that a gate invalidates is re-written by the factory\'s Story Writer on resume, briefed with the gate\'s reason and the existing document', async () => {
    // No approver: the run stops at CP1, before anyone approved the supplied story.
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: undefined,
      preSuppliedSpec: supplied()
    });
    expect(first.escalations.at(-1)!.reason).toBe('MANUAL');
    const storyPath = join(runDirOf(first), 'USER_STORY.md');
    writeFileSync(storyPath, '# User Story\n\nIt should just work, really.');

    // The story gate now refuses the supplied story and invalidates it (I-6).
    const refused = await resumeWith(undefined);
    expect(refused.state!.escalations.at(-1)!.context.message).toMatch(/^Story gate failed/);
    expect(refused.invoker.calls).toEqual([]);
    expect(refused.approver.requests).toEqual([]);

    const { state, invoker, approver } = await resumeWith(undefined);

    expect(state!.completionStatus).toBe('SUCCESS');
    expect(invoker.agents()).toEqual(['02-story-writer', '04-backend-builder', '06-test-verifier', '07-validator']);
    expect(approver.requests.map(r => r.id)).toEqual([1, 2, 3]);
    const prompt = invoker.promptsFor('02-story-writer')[0];
    expect(prompt).toMatch(/Story gate failed/);
    expect(prompt).toContain(storyPath);
  }, RUN_TIMEOUT_MS);
});
