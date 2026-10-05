/**
 * Test Verifier (Agent 06) acceptance tests for PR B-1: the gaps the builders' own tests left.
 *
 * Each test here was written because a deliberate mutation of the implementation survived the
 * existing suite:
 *
 *  - AC-80 (the index guard): `git()` refuses `add` and `write-tree` unless GIT_INDEX_FILE is the
 *    index in the snapshot's own `mkdtemp` directory. The existing test never offered a directory
 *    that is NAMED like one but sits somewhere else (inside the project, say), nor a symlink named
 *    like one, so dropping either half of the rule (the "directly under os.tmpdir()" check, or the
 *    "a real directory, not a symlink" check) survived. A symlink is the dangerous case: it can
 *    point into `.git/`, so `git add` would rewrite the user's `.git/index`.
 *    These tests spawn no git when the guard holds: it throws before git is run.
 *  - AC-86 (the HEAD_MOVED message): the real-git tests check the --resume and --close commands
 *    in the message, but dropping "Restore HEAD to the recorded branch and commit" survived, and
 *    the "unborn" and "detached" wordings were never reached. A fake tracker returns head-moved
 *    here, so this runs no git.
 *  - AC-83 / D-1 (no signing): `commit-tree --no-gpg-sign` and `-c commit.gpgSign=false` are two
 *    defences for one property. git 2.39's commit-tree ignores commit.gpgSign, so a live repository
 *    cannot tell whether either is present: removing one, or both, kept the AC-83 test green. D-1
 *    makes `--no-gpg-sign` a binding decision, so both are pinned in the source.
 *  - AC-94 (the bound): createBoundedOutput's text() slices its tail, so a buffer that never
 *    trimmed its tail still returned the right text, and every test passed while Gate 2 kept the
 *    whole stream. A stream longer than the longest string the runtime can hold makes the
 *    difference visible: bounded, it is fine; unbounded, it throws.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { constants as bufferConstants } from 'buffer';

import { git as harnessGit, HeadState, SNAPSHOT_TMP_PREFIX } from '../../harness/change-diff';
import { createBoundedOutput, OUTPUT_HEAD_CHARS, OUTPUT_TAIL_CHARS } from '../../harness/execution-gates';
import { shellArg } from '../../harness/run-lifecycle';
import { fakeChangeTracker } from '../fixtures/changes';
import { passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { code } from '../fixtures/source-code';

const RUN_TIMEOUT_MS = 30_000;

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-b1-gaps-');
});

afterEach(() => {
  project.cleanup();
});

/** git() must refuse both index-writing subcommands with this GIT_INDEX_FILE, and write no index there. */
function expectIndexRefused(indexFile: string): void {
  expect(() => harnessGit(project.dir, 'add', ['-A', '--', '.'], { GIT_INDEX_FILE: indexFile })).toThrow(/GIT_INDEX_FILE/);
  expect(() => harnessGit(project.dir, 'write-tree', [], { GIT_INDEX_FILE: indexFile })).toThrow(/GIT_INDEX_FILE/);
  expect(existsSync(indexFile)).toBe(false);
}

describe('AC-80 the snapshot index guard', () => {
  it('AC-80 git() refuses add or write-tree when GIT_INDEX_FILE is in a factory-snapshot- directory that is not directly under the temp directory', () => {
    // Named exactly like the snapshot's own directory, but inside the project (and so inside the
    // temp directory, one level too deep).
    const lookalike = join(project.dir, `${SNAPSHOT_TMP_PREFIX}inside-project`);
    mkdirSync(lookalike);
    const insideGitDir = join(project.dir, '.git', `${SNAPSHOT_TMP_PREFIX}inside-git`);
    mkdirSync(insideGitDir, { recursive: true });

    expectIndexRefused(join(lookalike, 'index'));
    expectIndexRefused(join(insideGitDir, 'index'));
  });

  it('AC-80 git() refuses add or write-tree when GIT_INDEX_FILE is in a symlink named like the snapshot directory, directly under the temp directory', () => {
    // The symlink could point anywhere, `.git/` included; here at a scratch directory.
    const target = mkdtempSync(join(tmpdir(), 'ff-b1-link-target-'));
    const link = join(tmpdir(), `${SNAPSHOT_TMP_PREFIX}b1-gaps-${randomBytes(6).toString('hex')}`);
    try {
      symlinkSync(target, link);
      expectIndexRefused(join(link, 'index'));
      expect(existsSync(join(target, 'index'))).toBe(false);
    } finally {
      rmSync(link, { force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('AC-86 the HEAD_MOVED escalation', () => {
  const RECORDED = 'a'.repeat(40);
  const MOVED_TO = 'b'.repeat(40);

  it.each<[string, HeadState, HeadState, string]>([
    [
      'a branch at a new commit',
      { commit: RECORDED, branch: 'refs/heads/main' },
      { commit: MOVED_TO, branch: 'refs/heads/main' },
      `recorded refs/heads/main at ${RECORDED}, now refs/heads/main at ${MOVED_TO}`
    ],
    ['an unborn branch, then a detached HEAD', {}, { commit: MOVED_TO, branch: 'HEAD' }, `recorded unborn at no commit, now detached at ${MOVED_TO}`],
    [
      'a base recorded with no branch, then a branch',
      { commit: RECORDED },
      { commit: MOVED_TO, branch: 'refs/heads/main' },
      `recorded a branch not recorded at ${RECORDED}, now refs/heads/main at ${MOVED_TO}`
    ]
  ])(
    'AC-86 HEAD_MOVED names the recorded and current HEAD (%s) and tells the operator to restore HEAD to the recorded branch and commit, or to close the run',
    async (_label, recorded, current, heads) => {
      const tracker = fakeChangeTracker({ snapshot: async () => ({ kind: 'head-moved', recorded, current }) });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
        changes: tracker
      });

      expect(state.completionStatus).toBe('ESCALATED');
      const escalation = state.escalations[state.escalations.length - 1];
      expect(escalation).toMatchObject({ stage: 3, agent: 'harness', reason: 'HEAD_MOVED', severity: 'CRITICAL' });
      const id = state.featureId;
      const cwd = shellArg(project.dir);
      expect(escalation.context.message).toBe(
        `HEAD moved since the run started: ${heads}. No snapshot was written. ` +
          `Restore HEAD to the recorded branch and commit, then \`npm run factory -- --resume ${id} --cwd ${cwd}\`; ` +
          `or close the run: \`npm run factory -- --close ${id} --cwd ${cwd}\`.`
      );
      expect(escalation.context.head).toEqual({ recorded, current });
      expect(state.stage3Snapshots).toBeUndefined();
      expect(tracker.snapshotCalls.map(call => call.n)).toEqual([1]);
    },
    RUN_TIMEOUT_MS
  );
});

describe('AC-83 D-1 no signing, by both defences', () => {
  it('AC-83 D-1 commit-tree always carries --no-gpg-sign and every git call carries -c commit.gpgSign=false', () => {
    // Comments stripped, so a commented-out defence does not count as present.
    const source = code(readFileSync(join(__dirname, '..', '..', 'harness', 'change-diff.ts'), 'utf-8'));

    const safeConfig = /const SAFE_GIT_CONFIG = \[([\s\S]*?)\];/.exec(source);
    expect(safeConfig).not.toBeNull();
    expect(safeConfig![1]).toContain(`'-c', 'commit.gpgSign=false'`);
    // ...and every call is built from SAFE_GIT_CONFIG (the single spawn site).
    expect(source.match(/\bspawnSync\(/g)).toHaveLength(1);
    expect(source).toMatch(/spawnSync\('git', \[\.\.\.SAFE_GIT_CONFIG, subcommand, \.\.\.args\]/);

    // The one commit-tree call: its first argument is --no-gpg-sign.
    const commitTreeCalls = [...source.matchAll(/snapshotStep\(\s*cwd,\s*'commit-tree',\s*\[([\s\S]*?)\],\s*HARNESS_IDENTITY\s*\)/g)];
    expect(commitTreeCalls).toHaveLength(1);
    expect(commitTreeCalls[0][1]).toMatch(/^\s*'--no-gpg-sign',/);
  });
});

describe('AC-94 the Gate 2 output bound', () => {
  it('AC-94 a stream longer than the longest string the runtime can hold is kept bounded, with the marker, and nothing throws', () => {
    // One chunk more than the runtime's maximum string length. An implementation that kept the
    // whole stream (or an unbounded tail) would throw "Invalid string length".
    const chunk = 'x'.repeat(1024 * 1024);
    const pushes = Math.ceil(bufferConstants.MAX_STRING_LENGTH / chunk.length) + 1;
    expect(pushes * chunk.length).toBeGreaterThan(bufferConstants.MAX_STRING_LENGTH);
    const output = createBoundedOutput();

    expect(() => {
      for (let i = 0; i < pushes; i++) output.push(chunk);
    }).not.toThrow();

    const total = pushes * chunk.length;
    const omitted = total - OUTPUT_HEAD_CHARS - OUTPUT_TAIL_CHARS;
    const marker =
      `\n[... Gate 2 kept the first ${OUTPUT_HEAD_CHARS} and the last ${OUTPUT_TAIL_CHARS} characters of this stream; ` +
      `${omitted} characters were omitted ...]\n`;
    expect(output.omitted()).toBe(omitted);
    const text = output.text();
    expect(text.length).toBe(OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS + marker.length);
    expect(text.slice(OUTPUT_HEAD_CHARS, OUTPUT_HEAD_CHARS + marker.length)).toBe(marker);
  });
});
