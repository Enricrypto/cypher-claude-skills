/**
 * Stage 3 snapshots, orchestrator side (PR B-1, D-5 to D-8; AC-45, AC-81, AC-82, AC-84 to AC-89).
 *
 * One of the two test files that run real `git` (with change-diff.test.ts), and only in temp
 * repositories it creates: local and offline. Where an AC is about what git ends up holding, the run
 * uses the REAL tracker (DEFAULT_CHANGE_TRACKER); where it is about the orchestrator's reaction to a
 * result git cannot be made to give on demand (a failed write), it injects fakeChangeTracker().
 * Setup commits use a fixed test identity and fixed dates (fixtures/real-git.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { ChangeTracker, DEFAULT_CHANGE_TRACKER, factoryRef, SnapshotResult } from '../../harness/change-diff';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { classifyRun } from '../../harness/run-lifecycle';
import { loadState } from '../../harness/state-store';
import {
  createFeatureState,
  FeatureState,
  latestStage3Snapshot,
  recordStage3Snapshot,
  Stage3Snapshot,
  stage3SnapshotNumber,
  stage3SnapshotPassedBy,
  ValidatorEvaluation
} from '../../harness/state-tracker';
import { backend, testVerifier, validator } from '../fixtures/agent-outputs';
import { FAKE_SNAPSHOT_COMMIT, FAKE_SNAPSHOT_TREE, fakeChangeTracker } from '../fixtures/changes';
import {
  decisions,
  killAt,
  passingScript,
  restoreSnapshot,
  runToEnd,
  scriptedInvoker,
  SimulatedKill,
  tempProject,
  TempProject
} from '../fixtures/harness-run';
import { executionAudit, infraAudit, recordingGates } from '../fixtures/gates';
import { isolateHarnessGit, setupGit } from '../fixtures/real-git';
import { copyIntact, createReviewDir, leafDigest, sealReadOnly } from '../../harness/review-copy';

const RUN_TIMEOUT_MS = 30_000;

/** Fixed dates, so two repositories built alike have the same commit ids (AC-89). */
const FIXED_DATES = { GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };

/** The file the scripted Backend Builder writes: a new file, so "files no agent wrote" is everything else. */
const BUILT = 'src/feature.ts';
/** What it claims: BUILT, and the brief's src/a.ts (which the fixtures' FILE_LIST requires; it already exists, so nothing rewrites it). */
const CLAIMED = ['src/a.ts', BUILT];

let project: TempProject;
let restoreEnv: () => void;

beforeEach(() => {
  project = tempProject('ff-snap-');
  restoreEnv = isolateHarnessGit();
});

afterEach(() => {
  restoreEnv();
  project.cleanup();
});

/** Test-setup git, with the fixed identity and dates. */
const git = (cwd: string, ...args: string[]) => setupGit(cwd, args, FIXED_DATES);

function write(root: string, path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

/** A repository on `main` with one commit: src/a.ts, src/b.ts, README.md and a .gitignore that ignores *.log. */
function repoWithCommit(root: string = project.dir): string {
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/b.ts', 'export const b = 1;\n');
  write(root, 'README.md', '# Project\n');
  write(root, '.gitignore', '*.log\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  return git(root, 'rev-parse', 'HEAD').trim();
}

/** The real tracker, as `options.changes`. */
const realTracker = (): Partial<ChangeTracker> => ({ ...DEFAULT_CHANGE_TRACKER });

/** A Backend Builder that writes BUILT (its content changes with each call, so each snapshot tree differs). */
const writingBackend = (cwd: string) => (_call: AgentInvocation, n: number) => {
  write(cwd, BUILT, `export const feature = ${n};\n`);
  return backend({ files: CLAIMED });
};

const criticalOnBuilt: ValidatorIssue = {
  severity: 'CRITICAL',
  file: BUILT,
  line: 1,
  message: 'Route has no auth check',
  suggestion: 'Add the guard',
  canFix: true
};

/** A Validator that sends one CRITICAL issue back to the Backend Builder on its first call, then passes. */
const validatorFailingFirst = (_call: AgentInvocation, n: number) =>
  n === 1 ? validator({ status: 'FAIL', issues: [criticalOnBuilt] }) : validator();

/** The script for a git run: the builder writes BUILT; `validatorRound` adds one validator round. */
function gitScript(cwd: string, { validatorRound = false } = {}) {
  return {
    ...passingScript(),
    '04-backend-builder': writingBackend(cwd),
    ...(validatorRound ? { '07-validator': validatorFailingFirst } : {})
  };
}

/** The state.json of the only run in `cwd`. */
function onDisk(cwd: string = project.dir): FeatureState {
  const factoryDir = join(cwd, '.factory');
  const runs = readdirSync(factoryDir).filter(name => existsSync(join(factoryDir, name, 'state.json')));
  if (runs.length !== 1) throw new Error(`expected one run in ${factoryDir}, found ${runs.length}`);
  return loadState(cwd, runs[0])!;
}

const written = (state: FeatureState) =>
  (state.stage3Snapshots ?? []).filter((s): s is Extract<Stage3Snapshot, { status: 'written' }> => s.status === 'written');

/** Every ref in the repository, as "<ref> <sha>" lines. */
const allRefs = (cwd: string) => git(cwd, 'for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter(Boolean);

/** Every ref under refs/factory/. */
const factoryRefs = (cwd: string) => allRefs(cwd).filter(line => line.startsWith('refs/factory/'));

/** The commit `ref` points at, or undefined. */
function refTarget(cwd: string, ref: string): string | undefined {
  const line = allRefs(cwd).find(l => l.split(' ')[0] === ref);
  return line?.split(' ')[1];
}

/** Every path in a tree (recursively, from its root even when `cwd` is a subdirectory), sorted. */
const treePaths = (cwd: string, treeish: string) =>
  git(cwd, 'ls-tree', '-r', '--full-tree', '--name-only', '-z', treeish).split('\0').filter(Boolean).sort();

const blob = (cwd: string, treeish: string, path: string) => git(cwd, 'cat-file', '-p', `${treeish}:${path}`);

/** The parents of `commit` (none for a root commit). */
const parentsOf = (cwd: string, commit: string) => git(cwd, 'rev-list', '--parents', '-n', '1', commit).trim().split(' ').slice(1);

const sha256 = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');

/** Every regular file under `root`, except .git/ and .factory/ and `excluded`, mapped to its sha256. */
function fileHashes(root: string, excluded: string[] = []): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const absolute = join(dir, name);
      const path = relative(root, absolute);
      if (path === '.git' || path === '.factory' || excluded.includes(path)) continue;
      if (lstatSync(absolute).isDirectory()) walk(absolute);
      else hashes[path] = sha256(readFileSync(absolute));
    }
  };
  walk(root);
  return hashes;
}

/** The CP3 part from the change heading to the end: the diff and untracked files. */
const changePart = (text: string) => text.slice(text.indexOf('## Change (source:'));

// =============================================================================================
// Unit: the snapshot records in state (D-7)
// =============================================================================================

describe('Stage 3 snapshot records (D-7)', () => {
  const at3 = { phase: 'stage3' } as const;
  const round1 = { phase: 'validator-round', round: 1 } as const;
  const rework1 = { phase: 'rework', round: 1 } as const;
  const entry = (n: number, at: Stage3Snapshot['at'], commit = 'a'.repeat(40)): Stage3Snapshot => ({
    status: 'written',
    n,
    ref: factoryRef('run-1', `stage3-${n}`),
    commit,
    tree: 'b'.repeat(40),
    at,
    takenAt: '2026-10-05T00:00:00.000Z'
  });

  it('AC-81 a run has no snapshot record until the first one, and n counts up from 1 by phase', () => {
    let state = createFeatureState('f');
    expect(state.stage3Snapshots).toBeUndefined();
    expect(stage3SnapshotNumber(state, at3)).toBe(1);
    expect(latestStage3Snapshot(state)).toBeUndefined();

    state = recordStage3Snapshot(state, entry(1, at3));
    expect(stage3SnapshotNumber(state, at3)).toBe(1);
    expect(stage3SnapshotNumber(state, round1)).toBe(2);

    state = recordStage3Snapshot(state, entry(2, round1));
    expect(stage3SnapshotNumber(state, rework1)).toBe(3);
    expect(stage3SnapshotNumber(state, { phase: 'validator-round', round: 2 })).toBe(3);
    expect(latestStage3Snapshot(state)).toMatchObject({ n: 2, at: round1 });
  });

  it('AC-85 I-4 a record for a phase that already has one replaces it: one entry per phase key', () => {
    let state = recordStage3Snapshot(createFeatureState('f'), entry(1, at3, 'a'.repeat(40)));
    state = recordStage3Snapshot(state, entry(1, at3, 'c'.repeat(40)));

    expect(state.stage3Snapshots).toHaveLength(1);
    expect(state.stage3Snapshots![0]).toMatchObject({ n: 1, commit: 'c'.repeat(40) });
  });

  it('AC-87 a skipped record takes no number', () => {
    const state = recordStage3Snapshot(createFeatureState('f'), {
      status: 'skipped',
      reason: 'not a git work tree',
      at: at3,
      takenAt: '2026-10-05T00:00:00.000Z'
    });

    expect(state.stage3Snapshots).toHaveLength(1);
    expect(stage3SnapshotNumber(state, round1)).toBe(1);
    expect(latestStage3Snapshot(state)).toBeUndefined();
  });

  describe('stage3SnapshotPassedBy: the run has moved past a phase\'s snapshot (IMPORTANT-1)', () => {
    const TAKEN = '2026-10-05T00:00:00.000Z';
    const invocation = (agent: string, startedAt: string) => ({ stage: 4, agent, startedAt, completedAt: startedAt, durationMs: 0 });
    const gate2 = (recordedAt: string) => ({ round: 0, total: 1, passed: 0, failed: 1, passRate: 0, canAdvance: false, recordedAt });
    const withRework = (): FeatureState => recordStage3Snapshot(createFeatureState('f'), entry(1, rework1));

    it.each<[string, (state: FeatureState) => void, boolean]>([
      ['no entry for the phase', state => (state.stage3Snapshots = []), false],
      ['a written entry and no later step (the AC-85 kill window)', () => undefined, false],
      ['a Test Verifier invocation started after it', state => (state.agentInvocations = [invocation('06-test-verifier', '2026-10-05T00:00:01.000Z')]), true],
      ['a Validator invocation started after it', state => (state.agentInvocations = [invocation('07-validator', '2026-10-05T00:00:01.000Z')]), true],
      ['a Gate 2 record after it', state => (state.executionGateHistory = [gate2('2026-10-05T00:00:01.000Z')]), true],
      ['a Test Verifier invocation and a Gate 2 record from before it', state => {
        state.agentInvocations = [invocation('06-test-verifier', '2026-10-04T00:00:00.000Z')];
        state.executionGateHistory = [gate2('2026-10-04T00:00:00.000Z')];
      }, false],
      ['only a builder invocation after it', state => (state.agentInvocations = [invocation('04-backend-builder', '2026-10-05T00:00:01.000Z')]), false],
      ['a skipped entry with a later Test Verifier invocation', state => {
        state.stage3Snapshots = [{ status: 'skipped', reason: 'not a git work tree', at: rework1, takenAt: TAKEN }];
        state.agentInvocations = [invocation('06-test-verifier', '2026-10-05T00:00:01.000Z')];
      }, false]
    ])('AC-81 AC-85 %s', (_label, arrange, expected) => {
      const state = withRework();
      arrange(state);
      expect(stage3SnapshotPassedBy(state, rework1)).toBe(expected);
    });

    it('AC-85 a Test Verifier invocation one millisecond before the snapshot does not count, and a phase with no entry has never been passed', () => {
      const state = withRework();
      state.agentInvocations = [invocation('06-test-verifier', '2026-10-04T23:59:59.999Z')];
      expect(stage3SnapshotPassedBy(state, rework1)).toBe(false);
      expect(stage3SnapshotPassedBy(state, { phase: 'rework', round: 2 })).toBe(false);
    });

    it.each<[string, (state: FeatureState) => void]>([
      ['a Test Verifier invocation whose startedAt equals takenAt', state => (state.agentInvocations = [invocation('06-test-verifier', TAKEN)])],
      ['a Validator invocation whose startedAt equals takenAt', state => (state.agentInvocations = [invocation('07-validator', TAKEN)])],
      ['a Gate 2 record whose recordedAt equals takenAt', state => (state.executionGateHistory = [gate2(TAKEN)])]
    ])('AC-85 I-4 the equality boundary counts as a later step (at or after the snapshot): %s', (_label, arrange) => {
      const state = withRework();
      arrange(state);
      expect(stage3SnapshotPassedBy(state, rework1)).toBe(true);
    });

    // AC-157 (D-14): the verification-start marker. It is committed before the copy and before the
    // Test Verifier is invoked, so a kill or a throw anywhere in verification leaves it.
    const evaluation = (startedAt: string, closed?: ValidatorEvaluation['closed']): ValidatorEvaluation => ({
      e: 1,
      cycle: 1,
      round: 0,
      kind: 'first-pass',
      startedAt,
      ...(closed ? { closed } : {})
    });

    it.each<[string, (state: FeatureState) => void, boolean]>([
      ['an open evaluation started after it, with no invocation or Gate 2 record', state => (state.validatorEvaluations = [evaluation('2026-10-05T00:00:01.000Z')]), true],
      ['an evaluation started exactly at it', state => (state.validatorEvaluations = [evaluation(TAKEN)]), true],
      ['an escalated evaluation started after it', state => (state.validatorEvaluations = [evaluation('2026-10-05T00:00:01.000Z', { outcome: 'escalated', at: '2026-10-05T00:00:02.000Z' })]), true],
      ['only an evaluation started one millisecond before it', state => (state.validatorEvaluations = [evaluation('2026-10-04T23:59:59.999Z')]), false],
      ['a follow-up invocation started after it', state => (state.agentInvocations = [invocation('07b-validator-followup', '2026-10-05T00:00:01.000Z')]), true],
      ['a skeptic invocation started after it', state => (state.agentInvocations = [invocation('07c-validator-skeptic', '2026-10-05T00:00:01.000Z')]), true],
      ['a skipped entry with a later evaluation start', state => {
        state.stage3Snapshots = [{ status: 'skipped', reason: 'not a git work tree', at: rework1, takenAt: TAKEN }];
        state.validatorEvaluations = [evaluation('2026-10-05T00:00:01.000Z')];
      }, false]
    ])('AC-157 a verification start at or after the snapshot counts as moving past it (%s)', (_label, arrange, expected) => {
      const state = withRework();
      arrange(state);
      expect(stage3SnapshotPassedBy(state, rework1)).toBe(expected);
    });
  });

  it.each<[string, Stage3Snapshot]>([
    ['n that is not a positive integer', { ...entry(1, at3), n: 0 } as Stage3Snapshot],
    ['a commit that is not an object id', { ...entry(1, at3), commit: 'HEAD' } as Stage3Snapshot],
    ['a blank skip reason', { status: 'skipped', reason: ' ', at: at3, takenAt: '2026-10-05T00:00:00.000Z' }]
  ])('D-7 a malformed record is refused, never stored (%s)', (_label, record) => {
    const state = createFeatureState('f');
    expect(() => recordStage3Snapshot(state, record)).toThrow();
    expect(state.stage3Snapshots).toBeUndefined();
  });
});

// =============================================================================================
// The orchestrator, against real git
// =============================================================================================

describe('AC-45 the factory never touches the branch, the index or the working tree', () => {
  it('AC-45 a run from start to an approved CHECKPOINT 3, with a validator round, leaves HEAD\'s branch and commit, .git/index, every file no agent wrote and every ref outside refs/factory/<id>/ byte-identical', async () => {
    const dir = project.dir;
    repoWithCommit();
    git(dir, 'checkout', '-q', '-b', 'feature/two-factor');
    write(dir, 'README.md', '# Project\n\nStaged.\n');
    git(dir, 'add', 'README.md');
    write(dir, 'src/b.ts', 'export const b = 2; // unstaged\n');
    write(dir, 'notes.txt', 'untracked\n');

    const before = {
      headFile: readFileSync(join(dir, '.git', 'HEAD')),
      head: git(dir, 'rev-parse', 'HEAD'),
      index: readFileSync(join(dir, '.git', 'index')),
      files: fileHashes(dir),
      refs: allRefs(dir)
    };

    const invoker = scriptedInvoker(gitScript(dir, { validatorRound: true }), { cwd: dir });
    const state = await runToEnd({ cwd: dir, invoke: invoker.invoke, changes: realTracker() });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.validatorRoundsCompleted).toBe(1);
    expect(written(state).map(s => s.n)).toEqual([1, 2]);

    expect(readFileSync(join(dir, '.git', 'HEAD')).equals(before.headFile)).toBe(true);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(readFileSync(join(dir, '.git', 'index')).equals(before.index)).toBe(true);
    expect(fileHashes(dir, [BUILT])).toEqual(before.files);
    const ownRefs = `refs/factory/${state.featureId}/`;
    expect(allRefs(dir).filter(line => !line.startsWith(ownRefs))).toEqual(before.refs);
  }, RUN_TIMEOUT_MS);
});

describe('AC-81 a snapshot after every passing Stage 3 gate', () => {
  it('AC-81 each passing Stage 3 gate (Stage 3, a validator round, a CHECKPOINT 3 rework) writes refs/factory/<id>/stage3-<n> from n=1, recorded with n, ref, commit, tree, phase and time before the next agent is invoked', async () => {
    const dir = project.dir;
    const head = repoWithCommit();

    /** At each invocation: the agent, and the snapshots state.json already holds. */
    const seen: Array<{ agent: string; snapshots: number[] }> = [];
    const observing = (invoke: AgentInvoker): AgentInvoker => async call => {
      seen.push({ agent: call.agent, snapshots: written(onDisk()).map(s => s.n) });
      return invoke(call);
    };

    // Run 1: Stage 3, one validator round, then CHECKPOINT 3 is rejected.
    const first = scriptedInvoker(gitScript(dir, { validatorRound: true }), { cwd: dir });
    const rejected = await runToEnd({
      cwd: dir,
      invoke: observing(first.invoke),
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: realTracker()
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    // Run 2: the rework, then CHECKPOINT 3 is approved.
    const second = scriptedInvoker(gitScript(dir), { cwd: dir });
    const state = await runToEnd({ cwd: dir, invoke: observing(second.invoke), resumeFromState: onDisk(), changes: realTracker() });
    expect(state.completionStatus).toBe('SUCCESS');

    // Each record was on disk before the next agent ran.
    expect(seen.filter(s => s.agent.startsWith('04-')).map(s => s.snapshots)).toEqual([[], [1], [1, 2]]);
    expect(seen.filter(s => s.agent.startsWith('06-')).map(s => s.snapshots)).toEqual([[1], [1, 2, 3]]);
    expect(seen.filter(s => s.agent.startsWith('07-')).map(s => s.snapshots)).toEqual([[1], [1, 2], [1, 2, 3]]);

    const snapshots = written(state);
    expect(snapshots.map(s => [s.n, s.at])).toEqual([
      [1, { phase: 'stage3' }],
      [2, { phase: 'validator-round', round: 1 }],
      [3, { phase: 'rework', round: 1 }]
    ]);
    for (const s of snapshots) {
      expect(s.ref).toBe(`refs/factory/${state.featureId}/stage3-${s.n}`);
      expect(refTarget(dir, s.ref)).toBe(s.commit);
      expect(git(dir, 'rev-parse', `${s.commit}^{tree}`).trim()).toBe(s.tree);
      expect(parentsOf(dir, s.commit)).toEqual([head]);
      expect(Number.isNaN(Date.parse(s.takenAt))).toBe(false);
    }
    // What the builder had written at each gate: Stage 3 (call 1), round 1 (call 2), rework (run 2's call 1).
    expect(snapshots.map(s => blob(dir, s.commit, BUILT))).toEqual([1, 2, 1].map(v => `export const feature = ${v};\n`));
    expect(factoryRefs(dir)).toHaveLength(3);
  }, RUN_TIMEOUT_MS);
});

/** One AC-82 case: prepare the tree in `root`, and return the project directory and the check on its stage3-1 commit. */
type TreeCase = (root: string) => { cwd: string; check: (cwd: string, commit: string) => void };

describe('AC-82 what a snapshot holds', () => {
  it.each<[string, TreeCase]>([
    [
      'tracked changes, with their current content',
      root => {
        repoWithCommit(root);
        write(root, 'src/a.ts', 'export const a = 2; // changed\n');
        git(root, 'rm', '-q', 'src/b.ts');
        return {
          cwd: root,
          check: (cwd, commit) => {
            expect(blob(cwd, commit, 'src/a.ts')).toBe('export const a = 2; // changed\n');
            expect(treePaths(cwd, commit)).not.toContain('src/b.ts');
            expect(blob(cwd, commit, BUILT)).toBe('export const feature = 1;\n');
          }
        };
      }
    ],
    [
      'untracked files that are not ignored',
      root => {
        repoWithCommit(root);
        write(root, 'notes/todo.txt', 'untracked\n');
        return { cwd: root, check: (cwd, commit) => expect(blob(cwd, commit, 'notes/todo.txt')).toBe('untracked\n') };
      }
    ],
    [
      'no ignored file',
      root => {
        repoWithCommit(root);
        write(root, 'debug.log', 'ignored\n');
        return { cwd: root, check: (cwd, commit) => expect(treePaths(cwd, commit)).not.toContain('debug.log') };
      }
    ],
    [
      'a tracked file that is ignored is kept',
      root => {
        repoWithCommit(root);
        write(root, 'keep.log', 'kept v1\n');
        git(root, 'add', '-f', 'keep.log');
        git(root, 'commit', '-q', '-m', 'force-added log');
        write(root, 'keep.log', 'kept v2\n');
        return { cwd: root, check: (cwd, commit) => expect(blob(cwd, commit, 'keep.log')).toBe('kept v2\n') };
      }
    ],
    [
      'nothing under .factory/',
      root => {
        repoWithCommit(root);
        return {
          cwd: root,
          check: (cwd, commit) => {
            expect(treePaths(cwd, commit).filter(path => path.startsWith('.factory/'))).toEqual([]);
            expect(existsSync(join(cwd, '.factory'))).toBe(true);
          }
        };
      }
    ],
    [
      'its parent is HEAD',
      root => {
        const head = repoWithCommit(root);
        return { cwd: root, check: (cwd, commit) => expect(parentsOf(cwd, commit)).toEqual([head]) };
      }
    ],
    [
      'an unborn branch: a root commit',
      root => {
        git(root, 'init', '-q', '-b', 'main');
        write(root, 'src/a.ts', 'export const a = 1;\n');
        git(root, 'add', 'src/a.ts');
        return {
          cwd: root,
          check: (cwd, commit) => {
            expect(parentsOf(cwd, commit)).toEqual([]);
            expect(treePaths(cwd, commit)).toEqual(['src/a.ts', BUILT].sort());
          }
        };
      }
    ],
    [
      'cwd a subdirectory: the tree root is the project',
      root => {
        git(root, 'init', '-q', '-b', 'main');
        write(root, 'other/x.ts', 'export const x = 1;\n');
        write(root, 'project/src/a.ts', 'export const a = 1;\n');
        git(root, 'add', '.');
        git(root, 'commit', '-q', '-m', 'base');
        return {
          cwd: join(root, 'project'),
          check: (cwd, commit) => expect(treePaths(cwd, commit)).toEqual(['src/a.ts', BUILT].sort())
        };
      }
    ]
  ])('AC-82 the snapshot tree is the working tree as CHECKPOINT 3 sees it (%s)', async (_label, prepare) => {
    const { cwd, check } = prepare(project.dir);
    const invoker = scriptedInvoker(gitScript(cwd), { cwd });

    const state = await runToEnd({ cwd, invoke: invoker.invoke, changes: realTracker() });

    expect(state.completionStatus).toBe('SUCCESS');
    const [first] = written(state);
    expect(first).toMatchObject({ n: 1, at: { phase: 'stage3' } });
    check(cwd, first.commit);
  }, RUN_TIMEOUT_MS);
});

describe('AC-84 pre-existing changes at CHECKPOINT 3', () => {
  const LISTED = 'The snapshots and the change include 2 path(s) that were already changed or untracked when the run started:';
  const UNKNOWN =
    'Whether the snapshots and the change include changes that were already in the working tree when the run started is unknown: ' +
    'this run started before the factory recorded them.';

  it.each<[string, (root: string) => Partial<ChangeTracker>, (text: string) => void]>([
    [
      'listed',
      root => {
        repoWithCommit(root);
        write(root, 'src/a.ts', 'export const a = 2;\n');
        write(root, 'notes.txt', 'untracked\n');
        return realTracker();
      },
      text => expect(text).toContain(`${LISTED}\n- notes.txt\n- src/a.ts\n`)
    ],
    [
      'none: no note',
      root => {
        repoWithCommit(root);
        return realTracker();
      },
      text => {
        expect(text).toContain('## Snapshots (1)');
        expect(text).not.toContain('already changed or untracked');
        expect(text).not.toContain('Whether the snapshots and the change include');
      }
    ],
    [
      'a base recorded before B-1: unknown',
      root => {
        repoWithCommit(root);
        // What a pre-B-1 run recorded: the commit only, no branch and no pre-existing list.
        return {
          ...realTracker(),
          captureBase: async cwd => {
            const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);
            return base.kind === 'git' ? { kind: 'git', commit: base.commit } : base;
          }
        };
      },
      text => {
        expect(text).toContain(UNKNOWN);
        expect(text).not.toContain('already changed or untracked when the run started:');
      }
    ]
  ])('AC-84 CHECKPOINT 3 notes the pre-existing changes (%s)', async (_label, prepare, expectText) => {
    const changes = prepare(project.dir);
    const approver = decisions(true, true, true);
    const invoker = scriptedInvoker(gitScript(project.dir), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve, changes });

    expect(state.completionStatus).toBe('SUCCESS');
    const cp3 = approver.requests[2];
    expect(cp3.id).toBe(3);
    expectText(cp3.text);
    // The notes sit before the change: the text still ends with it (CK:177).
    expect(cp3.text.indexOf('## Snapshots')).toBeLessThan(cp3.text.indexOf('## Change (source: git)'));
  }, RUN_TIMEOUT_MS);
});

describe('AC-85 a kill between the ref write and the state save', () => {
  /** The real tracker, but the first snapshot "dies" right after git wrote it: state.json is captured, then SimulatedKill. */
  function killedAfterRef(cwd: string) {
    let calls = 0;
    let captured: FeatureState | undefined;
    let wrote: SnapshotResult | undefined;
    const changes: Partial<ChangeTracker> = {
      ...realTracker(),
      snapshot: async (...args) => {
        const result = await DEFAULT_CHANGE_TRACKER.snapshot(...args);
        if (++calls === 1) {
          wrote = result;
          captured = onDisk(cwd);
          throw new SimulatedKill('snapshot', 1);
        }
        return result;
      }
    };
    return { changes, calls: () => calls, captured: () => captured!, wrote: () => wrote! };
  }

  async function killThenResume(changeTree: boolean) {
    const dir = project.dir;
    repoWithCommit();
    const kill = killedAfterRef(dir);
    await runToEnd({ cwd: dir, invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke, changes: kill.changes });
    const killed = restoreSnapshot(dir, kill.captured());
    const before = kill.wrote();
    expect(before.kind).toBe('written');
    expect(killed.stage3Snapshots).toBeUndefined();
    const ref = `refs/factory/${killed.featureId}/stage3-1`;
    expect(refTarget(dir, ref)).toBe(before.kind === 'written' ? before.commit : undefined);

    if (changeTree) write(dir, BUILT, 'export const feature = 99;\n');
    const state = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      resumeFromState: killed,
      changes: kill.changes
    });
    return { state, before: before as Extract<SnapshotResult, { kind: 'written' }>, ref, calls: kill.calls() };
  }

  it('AC-85 killed after the ref write and before the state save, a resume re-evaluates the gate, keeps one entry for n pointing at the ref, reuses the commit for an unchanged tree and writes no stage3-<n+1>', async () => {
    const { state, before, ref, calls } = await killThenResume(false);

    expect(state.completionStatus).toBe('SUCCESS');
    expect(calls).toBe(2); // the gate passed again, and snapshotted again
    expect(state.stage3Snapshots).toHaveLength(1);
    expect(state.stage3Snapshots![0]).toMatchObject({ status: 'written', n: 1, ref, commit: before.commit, tree: before.tree, reused: true });
    expect(refTarget(project.dir, ref)).toBe(before.commit);
    expect(factoryRefs(project.dir)).toEqual([`${ref} ${before.commit}`]);
  }, RUN_TIMEOUT_MS);

  it('AC-85 the same kill with a changed tree replaces stage3-<n>', async () => {
    const { state, before, ref } = await killThenResume(true);

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.stage3Snapshots).toHaveLength(1);
    const [entry] = written(state);
    expect(entry).toMatchObject({ n: 1, ref });
    expect(entry.reused).toBeUndefined();
    expect(entry.commit).not.toBe(before.commit);
    expect(entry.tree).not.toBe(before.tree);
    expect(refTarget(project.dir, ref)).toBe(entry.commit);
    expect(blob(project.dir, entry.commit, BUILT)).toBe('export const feature = 99;\n');
    expect(factoryRefs(project.dir)).toEqual([`${ref} ${entry.commit}`]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-85 I-4 a gate pass re-evaluated after its record was saved', () => {
  it('AC-85 I-4 a validator round re-entered on resume (Gate 1.5 failed after its snapshot) re-evaluates the Stage 3 gate and keeps its n and its commit', async () => {
    const dir = project.dir;
    repoWithCommit();
    const failingRoundInfra = recordingGates({
      auditInfrastructure: n => (n === 2 ? infraAudit({ critical: ['database unreachable'] }) : infraAudit())
    });

    const stopped = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir, { validatorRound: true }), { cwd: dir }).invoke,
      gates: failingRoundInfra.gates,
      changes: realTracker()
    });
    expect(stopped.escalations.at(-1)?.reason).toBe('INFRASTRUCTURE_FAILURE');
    const before = written(onDisk());
    expect(before.map(s => [s.n, s.at])).toEqual([
      [1, { phase: 'stage3' }],
      [2, { phase: 'validator-round', round: 1 }]
    ]);

    const resumed = scriptedInvoker(gitScript(dir), { cwd: dir });
    const state = await runToEnd({ cwd: dir, invoke: resumed.invoke, resumeFromState: onDisk(), changes: realTracker() });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents().filter(agent => agent.startsWith('04-'))).toEqual([]); // the round's builder had passed
    const after = written(state);
    expect(after.map(s => s.n)).toEqual([1, 2]);
    expect(after[1]).toMatchObject({ commit: before[1].commit, tree: before[1].tree, reused: true });
    expect(factoryRefs(dir)).toHaveLength(2);
  }, RUN_TIMEOUT_MS);
});

describe('AC-81 AC-85 a CHECKPOINT 3 rework the run has moved past keeps its snapshot', () => {
  it('AC-81 AC-85 a resume after the rework\'s Test Verifier wrote a test file and Gate 2 escalated does not re-take the rework snapshot: stage3-<k>, its commit, its tree and its state entry are unchanged', async () => {
    const dir = project.dir;
    repoWithCommit();
    const TEST_FILE = 'test/feature.test.ts';

    // Run 1: Stage 3, then CHECKPOINT 3 is rejected.
    const rejected = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: realTracker()
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    // Run 2: the rework passes its Stage 3 gate (stage3-2), the Test Verifier writes a test file,
    // then Gate 2 escalates.
    const verifierWrites = {
      ...gitScript(dir),
      '06-test-verifier': () => {
        write(dir, TEST_FILE, 'it("works", () => {});\n');
        return testVerifier();
      }
    };
    const failingGate2 = recordingGates({ auditExecution: executionAudit({ failed: 2 }) });
    const escalated = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(verifierWrites, { cwd: dir }).invoke,
      resumeFromState: onDisk(),
      gates: failingGate2.gates,
      changes: realTracker()
    });
    expect(escalated.escalations.at(-1)?.reason).toBe('EXECUTION_FAILURE');
    const reworkBefore = written(onDisk()).find(s => s.at.phase === 'rework')!;
    expect(reworkBefore).toMatchObject({ n: 2, at: { phase: 'rework', round: 1 } });
    expect(treePaths(dir, reworkBefore.commit)).not.toContain(TEST_FILE);

    // Run 3: a plain --resume.
    const state = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      resumeFromState: onDisk(),
      changes: realTracker()
    });

    expect(state.completionStatus).toBe('SUCCESS');
    const reworkAfter = written(state).find(s => s.at.phase === 'rework');
    expect(reworkAfter).toEqual(reworkBefore);
    expect(refTarget(dir, reworkBefore.ref)).toBe(reworkBefore.commit);
    expect(git(dir, 'rev-parse', `${reworkBefore.ref}^{tree}`).trim()).toBe(reworkBefore.tree);
    expect(factoryRefs(dir)).toHaveLength(2);
  }, RUN_TIMEOUT_MS);

  it('AC-85 I-4 a rework killed at Gate 1.5, after its Stage 3 gate passed and was recorded and before verification started, is re-evaluated on a plain resume: same n, same commit for an unchanged tree', async () => {
    const dir = project.dir;
    repoWithCommit();

    // Run 1: Stage 3, then CHECKPOINT 3 is rejected.
    const rejected = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: realTracker()
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    // Run 2: the rework passes its Stage 3 gate (stage3-2, recorded), then the process dies in
    // Gate 1.5, before verification starts (PR B-2 AC-157 moved the kill point here: a kill at the
    // Test Verifier is after the verification-start marker): no evaluation, no 06/07 invocation and
    // no Gate 2 record after the snapshot. The state on disk at that moment is what a kill leaves.
    let captured: FeatureState | undefined;
    const killedInGate15 = recordingGates({
      auditInfrastructure: () => {
        captured = onDisk();
        throw new SimulatedKill('gate-1.5', 1);
      }
    });
    await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      resumeFromState: onDisk(),
      gates: killedInGate15.gates,
      changes: realTracker()
    });
    expect(captured).toBeDefined();
    const killed = restoreSnapshot(dir, captured!);
    expect((killed.validatorEvaluations ?? []).filter(evaluation => evaluation.cycle === 1)).toEqual([]);
    const reworkBefore = written(killed).find(s => s.at.phase === 'rework')!;
    expect(reworkBefore).toMatchObject({ n: 2, at: { phase: 'rework', round: 1 } });
    expect(reworkBefore.reused).toBeUndefined();
    expect(stage3SnapshotPassedBy(killed, reworkBefore.at)).toBe(false);

    // Run 3: a plain --resume, counting the snapshots the rework's gate takes.
    let snapshots = 0;
    const counting: Partial<ChangeTracker> = {
      ...realTracker(),
      snapshot: async (...args) => {
        snapshots++;
        return DEFAULT_CHANGE_TRACKER.snapshot(...args);
      }
    };
    const resumed = scriptedInvoker(gitScript(dir), { cwd: dir });
    const state = await runToEnd({ cwd: dir, invoke: resumed.invoke, resumeFromState: killed, changes: counting });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(resumed.agents().filter(agent => agent.startsWith('04-'))).toEqual([]); // the rework's builder had passed
    expect(snapshots).toBe(1); // the rework's Stage 3 gate was evaluated again, and snapshotted again
    const reworkAfter = written(state).find(s => s.at.phase === 'rework')!;
    expect(reworkAfter).toMatchObject({ n: 2, ref: reworkBefore.ref, commit: reworkBefore.commit, tree: reworkBefore.tree, reused: true });
    expect(written(state).map(s => s.n)).toEqual([1, 2]);
    expect(refTarget(dir, reworkBefore.ref)).toBe(reworkBefore.commit);
    expect(factoryRefs(dir)).toHaveLength(2);
  }, RUN_TIMEOUT_MS);
});

describe('AC-86 HEAD moved since the run started', () => {
  type HeadCase = (dir: string) => Promise<FeatureState>;

  /** The Backend Builder writes BUILT, then does `act` in the repository (what a misbehaving builder could do). */
  const builderThat = (dir: string, act: () => void) => ({
    ...gitScript(dir),
    '04-backend-builder': () => {
      write(dir, BUILT, 'export const feature = 1;\n');
      act();
      return backend({ files: CLAIMED });
    }
  });

  it.each<[string, HeadCase, (dir: string, base: string) => { commit: string; branch: string }]>([
    [
      'a builder commits during Stage 3',
      async dir => {
        const script = builderThat(dir, () => {
          git(dir, 'add', BUILT);
          git(dir, 'commit', '-q', '-m', 'a builder committed');
        });
        return runToEnd({ cwd: dir, invoke: scriptedInvoker(script, { cwd: dir }).invoke, changes: realTracker() });
      },
      dir => ({ commit: git(dir, 'rev-parse', 'HEAD').trim(), branch: 'refs/heads/main' })
    ],
    [
      'a builder switches branch',
      async dir => {
        const script = builderThat(dir, () => git(dir, 'checkout', '-q', '-b', 'elsewhere'));
        return runToEnd({ cwd: dir, invoke: scriptedInvoker(script, { cwd: dir }).invoke, changes: realTracker() });
      },
      (_dir, base) => ({ commit: base, branch: 'refs/heads/elsewhere' })
    ],
    [
      'the operator commits between a CHECKPOINT 1 pause and the resume',
      async dir => {
        const paused = await runToEnd({
          cwd: dir,
          invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
          approveCheckpoint: decisions({ decision: 'PAUSE' }).approve,
          changes: realTracker()
        });
        expect(classifyRun(paused)).toBe('PAUSED');
        write(dir, 'src/a.ts', 'export const a = 3; // the operator\n');
        git(dir, 'commit', '-q', '-am', 'the operator committed');
        return runToEnd({
          cwd: dir,
          invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
          resumeFromState: onDisk(dir),
          resume: { action: { kind: 'approve', checkpoint: 1 } },
          changes: realTracker()
        });
      },
      dir => ({ commit: git(dir, 'rev-parse', 'HEAD').trim(), branch: 'refs/heads/main' })
    ]
  ])('AC-86 a HEAD move escalates HEAD_MOVED naming the recorded and current HEAD and writes no snapshot (%s)', async (_label, run, expectedCurrent) => {
    const dir = project.dir;
    const base = repoWithCommit();

    const state = await run(dir);

    expect(state.completionStatus).toBe('ESCALATED');
    const escalation = state.escalations[state.escalations.length - 1];
    expect(escalation).toMatchObject({ stage: 3, agent: 'harness', reason: 'HEAD_MOVED', severity: 'CRITICAL' });
    const current = expectedCurrent(dir, base);
    expect(escalation.context.head).toEqual({ recorded: { commit: base, branch: 'refs/heads/main' }, current });
    expect(escalation.context.message).toContain(`recorded refs/heads/main at ${base}`);
    expect(escalation.context.message).toContain(`now ${current.branch} at ${current.commit}`);
    expect(escalation.context.message).toContain('No snapshot was written.');
    expect(escalation.context.message).toContain(`--resume ${state.featureId}`);
    expect(escalation.context.message).toContain(`--close ${state.featureId}`);
    expect(factoryRefs(dir)).toEqual([]);
    expect(written(state)).toEqual([]);
    expect(onDisk(dir).escalations.at(-1)?.reason).toBe('HEAD_MOVED');
  }, RUN_TIMEOUT_MS);
});

describe('AC-87 outside git', () => {
  it('AC-87 outside a git work tree no snapshot is attempted, state records skipped: not a git work tree, the run continues and CHECKPOINT 3 says no snapshot was taken', async () => {
    const approver = decisions(true, true, true);
    const invoker = scriptedInvoker(gitScript(project.dir), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, approveCheckpoint: approver.approve, changes: realTracker() });

    expect(state.changeBase?.kind).toBe('none');
    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.stage3Snapshots).toEqual([
      { status: 'skipped', reason: 'not a git work tree', at: { phase: 'stage3' }, takenAt: expect.any(String) }
    ]);
    const cp3 = approver.requests[2].text;
    expect(cp3).toContain('## Snapshots (0)');
    expect(cp3).toContain('- skipped · Stage 3 · not a git work tree');
    expect(cp3).toContain('No snapshot was taken: not a git work tree.');
    expect(existsSync(join(project.dir, '.git'))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('AC-87 a fake tracker\'s none base is skipped too, and the snapshot is never called', async () => {
    const tracker = fakeChangeTracker({ base: { kind: 'none', reason: 'not a git work tree (fatal: not a git repository)' } });
    const state = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      changes: tracker
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(tracker.snapshotCalls).toEqual([]);
    expect(state.stage3Snapshots?.map(s => s.status)).toEqual(['skipped']);
  }, RUN_TIMEOUT_MS);
});

describe('AC-88 a snapshot that cannot be written', () => {
  it('AC-88 a failed snapshot write escalates SNAPSHOT_FAILED with git\'s error text, records no entry, and the run resumes', async () => {
    const error = "fatal: cannot lock ref 'refs/factory/x/stage3-1': simulated";
    let calls = 0;
    const tracker = fakeChangeTracker({
      snapshot: async (_cwd, _base, runId, n) =>
        ++calls === 1
          ? { kind: 'failed', error }
          : { kind: 'written', ref: factoryRef(runId, `stage3-${n}`), commit: FAKE_SNAPSHOT_COMMIT, tree: FAKE_SNAPSHOT_TREE, reused: false }
    });
    const invoke = () => scriptedInvoker(passingScript(), { cwd: project.dir }).invoke;

    const failed = await runToEnd({ cwd: project.dir, invoke: invoke(), changes: tracker });

    expect(failed.completionStatus).toBe('ESCALATED');
    const escalation = failed.escalations[failed.escalations.length - 1];
    expect(escalation).toMatchObject({ stage: 3, agent: 'harness', reason: 'SNAPSHOT_FAILED', severity: 'CRITICAL' });
    expect(escalation.context.message).toBe(
      `Snapshot stage3-1 could not be written: ${error}. Nothing was recorded. Fix the cause, then resume.`
    );
    expect(failed.stage3Snapshots).toBeUndefined();
    expect(onDisk().stage3Snapshots).toBeUndefined();
    expect(classifyRun(onDisk())).toBe('ESCALATED');

    const resumed = await runToEnd({ cwd: project.dir, invoke: invoke(), resumeFromState: onDisk(), changes: tracker });

    expect(resumed.completionStatus).toBe('SUCCESS');
    expect(tracker.snapshotCalls.map(c => c.n)).toEqual([1, 1]);
    expect(written(resumed)).toEqual([
      expect.objectContaining({ n: 1, commit: FAKE_SNAPSHOT_COMMIT, tree: FAKE_SNAPSHOT_TREE, at: { phase: 'stage3' } })
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-89 snapshots change nothing CHECKPOINT 3 binds to', () => {
  it('AC-89 the diff and untracked-file part of CHECKPOINT 3 is byte-identical with and without snapshots', async () => {
    const twinA = join(project.dir, 'a');
    const twinB = join(project.dir, 'b');
    const cp3 = async (cwd: string, changes: Partial<ChangeTracker>) => {
      const approver = decisions(true, true, true);
      const state = await runToEnd({ cwd, invoke: scriptedInvoker(gitScript(cwd), { cwd }).invoke, approveCheckpoint: approver.approve, changes });
      expect(state.completionStatus).toBe('SUCCESS');
      return approver.requests[2] as CheckpointRequest;
    };
    for (const twin of [twinA, twinB]) {
      mkdirSync(twin);
      repoWithCommit(twin);
      write(twin, 'src/a.ts', 'export const a = 2;\n');
      write(twin, 'notes.txt', 'untracked\n');
    }
    expect(git(twinA, 'rev-parse', 'HEAD')).toBe(git(twinB, 'rev-parse', 'HEAD'));

    const withSnapshots = await cp3(twinA, realTracker());
    const noOp: ChangeTracker['snapshot'] = async (_cwd, _base, runId, n) => ({
      kind: 'written',
      ref: factoryRef(runId, `stage3-${n}`),
      commit: FAKE_SNAPSHOT_COMMIT,
      tree: FAKE_SNAPSHOT_TREE,
      reused: false
    });
    // The no-op snapshot names no real commit, so the review copy and the measurement (PR B-2)
    // use the fake tracker's too; neither touches what CHECKPOINT 3 binds to.
    const fake = fakeChangeTracker();
    const withoutSnapshots = await cp3(twinB, {
      ...realTracker(),
      snapshot: noOp,
      extractSnapshot: fake.extractSnapshot,
      changedSince: fake.changedSince
    });

    expect(factoryRefs(twinA)).toHaveLength(1);
    expect(factoryRefs(twinB)).toEqual([]);
    expect(changePart(withSnapshots.text)).toContain('+export const a = 2;');
    expect(changePart(withSnapshots.text)).toBe(changePart(withoutSnapshots.text));
  }, RUN_TIMEOUT_MS);

  it('AC-89 --approve 3 of a run paused at CHECKPOINT 3 is not refused because of a snapshot', async () => {
    const dir = project.dir;
    repoWithCommit();
    const paused = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'PAUSE' }).approve,
      changes: realTracker()
    });
    expect(classifyRun(paused)).toBe('PAUSED');
    expect(paused.pendingCheckpoint?.checkpointId).toBe(3);
    const snapshotsAtPause = paused.stage3Snapshots;
    expect(written(paused)).toHaveLength(1);

    const state = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      resumeFromState: onDisk(),
      resume: { action: { kind: 'approve', checkpoint: 3 } },
      changes: realTracker()
    });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.checkpointApprovals.at(-1)).toMatchObject({ checkpointId: 3, sha256: paused.pendingCheckpoint!.sha256 });
    expect(state.stage3Snapshots).toEqual(snapshotsAtPause);
    expect(factoryRefs(dir)).toHaveLength(1);
  }, RUN_TIMEOUT_MS);
});

// =============================================================================================
// PR B-2: the main Validator's review copy, against real git (AC-117, AC-157, D-B2-2)
// =============================================================================================

describe('PR B-2 the review copy against real git', () => {
  /** Every regular file and symlink below `root`, relative and sorted: a file by its content, a link by its target. */
  function leavesOf(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const absolute = join(dir, name);
        const stat = lstatSync(absolute);
        if (stat.isDirectory()) walk(absolute);
        else out[relative(root, absolute)] = stat.isSymbolicLink() ? `link ${readlinkSync(absolute)}` : readFileSync(absolute, 'utf8');
      }
    };
    walk(root);
    return out;
  }

  const evaluationsOf = (state: FeatureState) => state.validatorEvaluations ?? [];

  it('AC-117 the main Validator\'s copy is extracted from the latest snapshot ref and equals its tree exactly (no .git, no .factory, no untracked ignored file) and holds nothing the Test Verifier writes', async () => {
    const dir = project.dir;
    repoWithCommit();
    write(dir, 'debug.log', 'untracked and ignored\n');
    write(dir, 'notes.txt', 'untracked, not ignored\n');
    const TEST_FILE = 'test/feature.test.ts';
    let seen: { cwd?: string; leaves: Record<string, string> } | undefined;
    const script = {
      ...gitScript(dir),
      '06-test-verifier': () => {
        write(dir, TEST_FILE, 'it("works", () => {});\n');
        return testVerifier();
      },
      '07-validator': (call: AgentInvocation) => {
        seen = { cwd: call.cwd, leaves: leavesOf(call.cwd!) };
        return validator();
      }
    };

    const state = await runToEnd({ cwd: dir, invoke: scriptedInvoker(script, { cwd: dir }).invoke, changes: realTracker() });

    expect(state.completionStatus).toBe('SUCCESS');
    const snapshot = latestStage3Snapshot(state)!;
    const [evaluation] = evaluationsOf(state);
    const copy = evaluation.copy!;
    expect(copy.source).toEqual({ kind: 'snapshot', n: snapshot.n, ref: snapshot.ref, commit: snapshot.commit, tree: snapshot.tree });
    expect(seen?.cwd).toBe(copy.dir);

    // Exactly the snapshot's tree, byte for byte: what git holds is what the Validator read.
    const paths = treePaths(dir, snapshot.commit);
    expect(Object.keys(seen!.leaves).sort()).toEqual(paths);
    for (const path of paths) expect({ path, content: seen!.leaves[path] }).toEqual({ path, content: blob(dir, snapshot.commit, path) });
    expect(paths).toEqual(expect.arrayContaining(['notes.txt', BUILT, 'src/a.ts']));
    for (const absent of ['debug.log', TEST_FILE]) expect(paths).not.toContain(absent);
    expect(paths.some(path => path.startsWith('.factory/') || path.startsWith('.git/'))).toBe(false);
    expect(existsSync(join(copy.dir, '.git'))).toBe(false);
    expect(existsSync(join(copy.dir, '.factory'))).toBe(false);

    // Still whole after the run, recorded with its leaves and digest; the Test Verifier's file was measured against it.
    expect(copyIntact(copy.dir, copy)).toBe(true);
    expect(copy.entries).toBe(paths.length);
    expect(existsSync(join(copy.dir, TEST_FILE))).toBe(false);
    expect(evaluation.testVerifierChanges).toEqual({ kind: 'tests', files: [TEST_FILE] });
  }, RUN_TIMEOUT_MS);

  it('D-B2-2 on a rich extracted snapshot (an executable, a symlink, nested and unusual names) the leaf digest taken after extraction has the extraction\'s entry count and copyIntact holds after sealing', async () => {
    const dir = project.dir;
    repoWithCommit();
    write(dir, 'bin/run.sh', '#!/bin/sh\necho hi\n');
    chmodSync(join(dir, 'bin/run.sh'), 0o755);
    symlinkSync('../src/a.ts', join(dir, 'bin/a-link'));
    write(dir, 'deep/er/still/x.ts', 'export const x = 1;\n');
    write(dir, 'names/with space.ts', 'export {};\n');
    write(dir, 'names/ñandú.md', '# ñandú\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'rich');

    const base = await DEFAULT_CHANGE_TRACKER.captureBase(dir);
    const snapshot = await DEFAULT_CHANGE_TRACKER.snapshot(dir, base, 'run-rich', 1);
    expect(snapshot.kind).toBe('written');
    const snap = snapshot as Extract<SnapshotResult, { kind: 'written' }>;
    const dest = createReviewDir(`${dir}-review`, 'run-rich', 1);

    const extracted = await DEFAULT_CHANGE_TRACKER.extractSnapshot(dir, snap, dest);

    expect(extracted.kind).toBe('extracted');
    const leaves = leafDigest(dest);
    expect(leaves.entries).toBe(extracted.kind === 'extracted' ? extracted.entries : -1);
    expect(leaves.entries).toBe(treePaths(dir, snap.commit).length);
    sealReadOnly(dest);
    expect(copyIntact(dest, leaves)).toBe(true);
    expect(lstatSync(join(dest, 'bin/a-link')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dest, 'bin/run.sh')).mode & 0o111).not.toBe(0);
  }, RUN_TIMEOUT_MS);

  it('AC-157 the rework\'s Test Verifier writes a partial file and its invocation throws: a resume keeps stage3-<k>, its commit, tree and record, and extracts the Validator\'s copy from it, without the partial file', async () => {
    const dir = project.dir;
    repoWithCommit();
    const PARTIAL = 'test/partial.test.ts';

    // Run 1: Stage 3, then CHECKPOINT 3 is rejected.
    const rejected = await runToEnd({
      cwd: dir,
      invoke: scriptedInvoker(gitScript(dir), { cwd: dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Tighten the guard.' }).approve,
      changes: realTracker()
    });
    expect(rejected.completionStatus).toBe('ESCALATED');

    // Run 2: the rework passes its Stage 3 gate (stage3-2); the Test Verifier writes part of a file,
    // then its invocation throws (an SDK or API error).
    const throwing = {
      ...gitScript(dir),
      '06-test-verifier': () => {
        write(dir, PARTIAL, 'it("half a test", () => {\n');
        throw new Error('SDK error: 529 overloaded');
      }
    };
    const stopped = await runToEnd({ cwd: dir, invoke: scriptedInvoker(throwing, { cwd: dir }).invoke, resumeFromState: onDisk(), changes: realTracker() });
    expect(stopped.escalations.at(-1)).toMatchObject({ agent: 'orchestrator', reason: 'MANUAL' });
    const afterThrow = onDisk();
    expect(afterThrow.agentInvocations!.filter(i => i.agent === '06-test-verifier').at(-1)).toMatchObject({ outcome: 'threw', error: 'SDK error: 529 overloaded' });
    const reworkBefore = written(afterThrow).find(s => s.at.phase === 'rework')!;
    expect(reworkBefore).toMatchObject({ n: 2, at: { phase: 'rework', round: 1 } });
    expect(stage3SnapshotPassedBy(afterThrow, reworkBefore.at)).toBe(true);
    expect(existsSync(join(dir, PARTIAL))).toBe(true);

    // Run 3: a plain --resume, counting snapshot calls; the Validator records the copy it reads.
    let snapshots = 0;
    const counting: Partial<ChangeTracker> = {
      ...realTracker(),
      snapshot: async (...args) => {
        snapshots++;
        return DEFAULT_CHANGE_TRACKER.snapshot(...args);
      }
    };
    let seen: { cwd?: string; leaves: Record<string, string> } | undefined;
    const resumedScript = {
      ...gitScript(dir),
      '07-validator': (call: AgentInvocation) => {
        seen = { cwd: call.cwd, leaves: leavesOf(call.cwd!) };
        return validator();
      }
    };
    const state = await runToEnd({ cwd: dir, invoke: scriptedInvoker(resumedScript, { cwd: dir }).invoke, resumeFromState: onDisk(), changes: counting });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(snapshots).toBe(0);
    expect(written(state).find(s => s.at.phase === 'rework')).toEqual(reworkBefore);
    expect(refTarget(dir, reworkBefore.ref)).toBe(reworkBefore.commit);
    expect(git(dir, 'rev-parse', `${reworkBefore.ref}^{tree}`).trim()).toBe(reworkBefore.tree);
    // The resumed evaluation's copy was extracted from stage3-<k>, which holds no partial write.
    const resumedEvaluation = evaluationsOf(state).filter(evaluation => evaluation.cycle === 1).at(-1)!;
    expect(resumedEvaluation.copy!.source).toEqual({ kind: 'snapshot', n: 2, ref: reworkBefore.ref, commit: reworkBefore.commit, tree: reworkBefore.tree });
    expect(seen?.cwd).toBe(resumedEvaluation.copy!.dir);
    expect(Object.keys(seen!.leaves).sort()).toEqual(treePaths(dir, reworkBefore.commit));
    expect(Object.keys(seen!.leaves)).not.toContain(PARTIAL);
  }, RUN_TIMEOUT_MS);
});
