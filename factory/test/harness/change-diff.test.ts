/**
 * The CP3 change (A-2, D-8, I-4) [G]: what "the diff" is when a human approves the validated
 * change.
 *
 * One of the two test files that run real `git` (with snapshot.test.ts, which drives the
 * orchestrator's Stage 3 snapshots), and only in temp repositories it creates: local and offline.
 * Everything else injects `fakeChangeTracker()` (fixtures/changes.ts).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deflateSync } from 'zlib';

import {
  ChangeDiffError,
  DEFAULT_CHANGE_TRACKER,
  factoryRef,
  git as harnessGit,
  GIT_EXTRACTION_SUBCOMMANDS,
  GIT_READ_SUBCOMMANDS,
  GIT_SNAPSHOT_SUBCOMMANDS,
  MAX_INLINE_BYTES,
  SNAPSHOT_TMP_PREFIX
} from '../../harness/change-diff';
import { copyIntact, copyWorkingTree, leafDigest } from '../../harness/review-copy';
import { ChangeBase } from '../../harness/state-tracker';
import { tempProject, TempProject } from '../fixtures/harness-run';
import { isolateHarnessGit, setupGit } from '../fixtures/real-git';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-change-');
});

afterEach(() => {
  project.cleanup();
});

/** Run git in `cwd` for test SETUP, isolated from the user's and the caller's git configuration. */
function git(cwd: string, ...args: string[]): string {
  return setupGit(cwd, args);
}

function write(relativePath: string, content: string | Buffer, root = project.dir): string {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

/** A repository with one commit: src/a.ts and .gitignore (which ignores *.log). */
function repoWithCommit(): string {
  git(project.dir, 'init', '-q');
  write('src/a.ts', 'export const a = 1;\n');
  write('.gitignore', '*.log\n');
  git(project.dir, 'add', '.');
  git(project.dir, 'commit', '-q', '-m', 'base');
  return git(project.dir, 'rev-parse', 'HEAD').trim();
}

describe('captureBase', () => {
  it('AC-43 records HEAD at run start inside a git work tree', async () => {
    const head = repoWithCommit();

    const branch = git(project.dir, 'rev-parse', '--symbolic-full-name', 'HEAD').trim();

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git', commit: head, branch, preExisting: [] });
  });

  it('I-4 in a repository with no commit yet, the base is git with no commit', async () => {
    git(project.dir, 'init', '-q');

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git', preExisting: [] });
  });

  it('I-4 outside a git work tree the base is none, with a reason', async () => {
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    expect(base.kind).toBe('none');
    expect(base.kind === 'none' && base.reason).toMatch(/not a git work tree/i);
  });
});

describe('collect inside git (I-4)', () => {
  it('AC-43 the change is the git diff from the run-start commit, committed or not, plus untracked files', async () => {
    const head = repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    write('src/a.ts', 'export const a = 2;\n');
    write('src/committed.ts', 'export const c = 3;\n');
    git(project.dir, 'add', 'src/committed.ts');
    git(project.dir, 'commit', '-q', '-m', 'a builder committed this');
    write('src/new.ts', 'export const n = 4;\n');

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, ['src/a.ts']);

    expect(change.source).toBe('git');
    expect(change.files).toEqual(['src/a.ts', 'src/committed.ts', 'src/new.ts']);
    expect(change.text).toContain(head);
    expect(change.text).toContain('-export const a = 1;');
    expect(change.text).toContain('+export const a = 2;');
    expect(change.text).toContain('+export const c = 3;');
    // An untracked file: path, size and hash, and its text inline.
    expect(change.text).toContain('src/new.ts');
    expect(change.text).toContain(`20 bytes, sha256 ${sha256('export const n = 4;\n')}`);
    expect(change.text).toContain('export const n = 4;');
  });

  it('I-4 .factory/ and ignored files are not part of the change', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    write('.factory/run-1/VALIDATION_REPORT.md', '# report\n');
    write('.factory/baseline.json', '{}');
    write('debug.log', 'noise\n');
    write('src/b.ts', 'export const b = 1;\n');

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(change.files).toEqual(['src/b.ts']);
    expect(change.text).not.toContain('VALIDATION_REPORT.md');
    expect(change.text).not.toContain('baseline.json');
    expect(change.text).not.toContain('debug.log');
  });

  it('I-4 pre-existing uncommitted changes appear in the change (documented)', async () => {
    repoWithCommit();
    write('src/a.ts', 'export const a = "edited before the run";\n');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(change.files).toEqual(['src/a.ts']);
    expect(change.text).toContain('edited before the run');
  });

  it('D-8 a binary or oversized untracked file is bound by its hash, but its content is not inlined', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const large = 'x'.repeat(MAX_INLINE_BYTES + 1);
    write('assets/logo.png', binary);
    write('data/large.txt', large);

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(change.files).toEqual(['assets/logo.png', 'data/large.txt']);
    expect(change.text).toContain(`${binary.length} bytes, sha256 ${sha256(binary)}`);
    expect(change.text).toContain(`${large.length} bytes, sha256 ${sha256(large)}`);
    expect(change.text).toMatch(/binary; content not shown/);
    expect(change.text).toMatch(/content not shown/);
    expect(change.text).not.toContain('x'.repeat(1000));
  });

  it('D-8 an untracked symlink is described, never followed', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    const outside = tempProject('ff-change-outside-');
    try {
      write('secret.txt', 'TOP SECRET CONTENT\n', outside.dir);
      symlinkSync(join(outside.dir, 'secret.txt'), join(project.dir, 'link.txt'));

      const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

      expect(change.files).toEqual(['link.txt']);
      expect(change.text).toMatch(/symlink to .*secret\.txt; not followed/);
      expect(change.text).not.toContain('TOP SECRET CONTENT');
    } finally {
      outside.cleanup();
    }
  });

  it('I-4 with no commit at run start, every file in the index or untracked is shown as new', async () => {
    git(project.dir, 'init', '-q');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/staged.ts', 'export const s = 1;\n');
    git(project.dir, 'add', 'src/staged.ts');
    write('src/untracked.ts', 'export const u = 1;\n');

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(change.source).toBe('git');
    expect(change.files).toEqual(['src/staged.ts', 'src/untracked.ts']);
    expect(change.text).toContain('export const s = 1;');
    expect(change.text).toContain('export const u = 1;');
  });

  it('AC-50 the text is deterministic: the same tree gives the same text', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    write('src/z.ts', 'z\n');
    write('src/b.ts', 'b\n');

    const first = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);
    const second = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(second).toEqual(first);
  });

  it('D-8 paths are relative to cwd when cwd is a subdirectory of the repository', async () => {
    git(project.dir, 'init', '-q');
    write('app/src/a.ts', 'a\n');
    write('other/b.ts', 'b\n');
    git(project.dir, 'add', '.');
    git(project.dir, 'commit', '-q', '-m', 'base');
    const cwd = join(project.dir, 'app');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);

    write('app/src/a.ts', 'a2\n');
    write('app/src/new.ts', 'n\n');
    write('other/b.ts', 'b2\n');

    const change = await DEFAULT_CHANGE_TRACKER.collect(cwd, base, []);

    expect(change.files).toEqual(['src/a.ts', 'src/new.ts']);
    expect(change.text).not.toContain('other/b.ts');
  });

  it('SEC repository configuration cannot make collecting the change run a command', async () => {
    repoWithCommit();
    const marker = join(project.dir, 'EXECUTED');
    const script = write('hook.sh', `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
    execFileSync('chmod', ['+x', script]);
    git(project.dir, 'config', 'diff.external', script);
    git(project.dir, 'config', 'core.fsmonitor', script);
    write('.gitattributes', '*.ts diff=conv\n');
    git(project.dir, 'config', 'diff.conv.textconv', script);
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

    expect(existsSync(marker)).toBe(false);
    expect(change.text).toContain('+export const a = 2;');
  });

  it('fails closed when the base said git but the project is no longer a work tree', async () => {
    const head = repoWithCommit();

    const outside = tempProject('ff-change-gone-');
    try {
      await expect(
        DEFAULT_CHANGE_TRACKER.collect(outside.dir, { kind: 'git', commit: head }, [])
      ).rejects.toThrow(ChangeDiffError);
    } finally {
      outside.cleanup();
    }
  });

  it.each(['--output=/tmp/x', 'HEAD', 'abc', '0'.repeat(39)])(
    'SEC a recorded base commit %s that is not a full object id is refused before git sees it',
    async commit => {
      repoWithCommit();

      await expect(DEFAULT_CHANGE_TRACKER.collect(project.dir, { kind: 'git', commit }, [])).rejects.toThrow(
        /not a commit id/
      );
    }
  );
});

describe('collect outside git: the claimed-files manifest (I-4)', () => {
  it('AC-43 lists the claimed files with sha256 and text, and says plainly it is not a git diff', async () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 1;\n');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, [
      'src/b.ts',
      join(project.dir, 'src/a.ts'),
      'src/a.ts',
      'src/missing.ts'
    ]);

    expect(change.source).toBe('claimed-files');
    expect(change.files).toEqual(['src/a.ts', 'src/b.ts', 'src/missing.ts']);
    expect(change.text).toMatch(/NOT A GIT DIFF/);
    expect(change.text).toMatch(/not a git work tree/i);
    expect(change.text).toContain(`sha256 ${sha256('export const a = 1;\n')}`);
    expect(change.text).toContain('export const b = 1;');
    expect(change.text).toMatch(/src\/missing\.ts[^\n]*\n+\(missing\)/);
  });

  it('SEC a claimed file reached through a symlinked directory that leaves the project is not read', async () => {
    const outside = tempProject('ff-change-outside-');
    try {
      write('secret.txt', 'TOP SECRET CONTENT\n', outside.dir);
      symlinkSync(outside.dir, join(project.dir, 'linked'));

      const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, { kind: 'none', reason: 'no git' }, ['linked/secret.txt']);

      expect(change.files).toEqual(['linked/secret.txt']);
      expect(change.text).toMatch(/resolves outside the project; not read/);
      expect(change.text).not.toContain('TOP SECRET CONTENT');
    } finally {
      outside.cleanup();
    }
  });

  it('SEC a claimed file outside the project is listed but never read', async () => {
    const outside = tempProject('ff-change-outside-');
    try {
      const secret = write('secret.txt', 'TOP SECRET CONTENT\n', outside.dir);

      const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, { kind: 'none', reason: 'no git' }, [secret]);

      expect(change.files).toEqual([secret]);
      expect(change.text).toMatch(/outside the project; not read/);
      expect(change.text).not.toContain('TOP SECRET CONTENT');
    } finally {
      outside.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PR B-1, step 2: the snapshot plumbing (AC-80, AC-82 to AC-86, AC-88) and captureBase's new
// fields. All real git runs in temp repositories; the harness's own calls are isolated from the
// user's global and system git configuration for the duration of each test.
// ---------------------------------------------------------------------------------------------

/** Every path in a tree (recursively), sorted. */
function treePaths(cwd: string, treeish: string): string[] {
  return git(cwd, 'ls-tree', '-r', '--name-only', '-z', treeish).split('\0').filter(Boolean).sort();
}

/** The content of `path` in `treeish`. */
function blob(cwd: string, treeish: string, path: string): string {
  return git(cwd, 'cat-file', '-p', `${treeish}:${path}`);
}

/** Every ref under refs/factory/, as "<ref> <sha>". */
function factoryRefs(cwd: string): string[] {
  return git(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/factory/').split('\n').filter(Boolean);
}

/** The number of loose objects: any object a snapshot writes shows here. */
function looseObjects(cwd: string): number {
  return Number(/^count: (\d+)$/m.exec(git(cwd, 'count-objects', '-v'))![1]);
}

/** The repository HEAD's branch name, as git spells it (refs/heads/<x>). */
const branchOf = (cwd: string) => git(cwd, 'rev-parse', '--symbolic-full-name', 'HEAD').trim();

describe('factoryRef and the git() choke point (AC-80)', () => {
  it('AC-80 factoryRef prefixes refs/factory/<id>/ and refuses an unsafe id or name', () => {
    expect(factoryRef('run-1', 'stage3-1')).toBe('refs/factory/run-1/stage3-1');
    expect(factoryRef('20261005-abc.def_1', 'stage3-12')).toBe('refs/factory/20261005-abc.def_1/stage3-12');

    for (const runId of ['', '../x', 'a/b', '.hidden', 'a..b', 'run.lock', 'run.', 'a b', 'x'.repeat(129), 'r@{1}']) {
      expect(() => factoryRef(runId, 'stage3-1')).toThrow(/run id/);
    }
    for (const name of ['', 'stage3-0', 'stage3-01', 'stage3-1.5', 'stage3-', 'stage3-1/x', 'Stage3-1', 'heads/main', '../stage3-1']) {
      expect(() => factoryRef('run-1', name)).toThrow(/snapshot name/);
    }
  });

  it('AC-80 the allow-list is exactly the read set and the snapshot plumbing set', () => {
    expect([...GIT_READ_SUBCOMMANDS]).toEqual(['rev-parse', 'diff', 'ls-files']);
    expect([...GIT_SNAPSHOT_SUBCOMMANDS]).toEqual(['add', 'write-tree', 'commit-tree', 'update-ref']);
    expect(() => harnessGit(project.dir, 'status' as never, [])).toThrow(/not on the allow-list/);
  });

  it('AC-80 git() refuses add or write-tree without a temporary GIT_INDEX_FILE', () => {
    repoWithCommit();
    write('src/new.ts', 'export const n = 1;\n');
    const indexBefore = readFileSync(join(project.dir, '.git', 'index'));
    const other = mkdtempSync(join(tmpdir(), 'ff-not-a-snapshot-'));
    const nested = mkdtempSync(join(tmpdir(), SNAPSHOT_TMP_PREFIX));
    mkdirSync(join(nested, 'sub'));
    try {
      const refused: Array<Record<string, string> | undefined> = [
        undefined,
        {},
        { GIT_INDEX_FILE: join(project.dir, '.git', 'index') },
        { GIT_INDEX_FILE: join(other, 'index') },
        { GIT_INDEX_FILE: join(nested, 'sub', 'index') },
        { GIT_INDEX_FILE: join(nested, 'other-name') },
        { GIT_INDEX_FILE: `${SNAPSHOT_TMP_PREFIX}relative/index` }
      ];
      for (const env of refused) {
        expect(() => harnessGit(project.dir, 'add', ['-A', '--', '.'], env)).toThrow(/GIT_INDEX_FILE/);
        expect(() => harnessGit(project.dir, 'write-tree', [], env)).toThrow(/GIT_INDEX_FILE/);
      }
      expect(readFileSync(join(project.dir, '.git', 'index'))).toEqual(indexBefore);
      expect(git(project.dir, 'ls-files', '--cached')).not.toContain('src/new.ts');

      // The snapshot's own kind of directory is accepted, and only that index is written.
      const result = harnessGit(project.dir, 'add', ['-A', '--', '.'], { GIT_INDEX_FILE: join(nested, 'index') });
      expect(result.ok).toBe(true);
      expect(existsSync(join(nested, 'index'))).toBe(true);
      expect(readFileSync(join(project.dir, '.git', 'index'))).toEqual(indexBefore);
    } finally {
      rmSync(other, { recursive: true, force: true });
      rmSync(nested, { recursive: true, force: true });
    }
  });
});

describe('captureBase: branch and pre-existing changes (AC-84, AC-86)', () => {
  it('AC-84 captureBase records the branch and, read-only, the paths already changed or untracked (not ignored, not .factory/)', async () => {
    const head = repoWithCommit();
    write('src/a.ts', 'export const a = "edited before the run";\n');
    write('src/staged.ts', 'staged\n');
    git(project.dir, 'add', 'src/staged.ts');
    write('src/untracked.ts', 'untracked\n');
    write('debug.log', 'ignored\n');
    write('.factory/run-1/state.json', '{}');
    const indexBefore = readFileSync(join(project.dir, '.git', 'index'));

    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    expect(base).toEqual({
      kind: 'git',
      commit: head,
      branch: branchOf(project.dir),
      preExisting: ['src/a.ts', 'src/staged.ts', 'src/untracked.ts']
    });
    expect(readFileSync(join(project.dir, '.git', 'index'))).toEqual(indexBefore);
  });

  it('AC-84 on an unborn branch the pre-existing paths are the index and the untracked files, and no branch is recorded', async () => {
    git(project.dir, 'init', '-q');
    write('b.ts', 'b\n');
    git(project.dir, 'add', 'b.ts');
    write('a.ts', 'a\n');

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git', preExisting: ['a.ts', 'b.ts'] });
  });

  it('AC-86 with a detached HEAD captureBase records the branch as HEAD', async () => {
    const head = repoWithCommit();
    git(project.dir, 'checkout', '-q', '--detach');

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git', commit: head, branch: 'HEAD', preExisting: [] });
  });
});

describe('snapshot (AC-82, AC-83, AC-85, AC-86, AC-88)', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = isolateHarnessGit();
  });

  afterEach(() => {
    restoreEnv();
  });

  /** repoWithCommit plus a tracked file that .gitignore matches (force-added). */
  function repoWithTrackedIgnoredFile(): string {
    repoWithCommit();
    write('keep.log', 'tracked although ignored\n');
    git(project.dir, 'add', '-f', 'keep.log');
    git(project.dir, 'commit', '-q', '-m', 'force-added log');
    return git(project.dir, 'rev-parse', 'HEAD').trim();
  }

  it('AC-82 the snapshot tree is the working tree as CHECKPOINT 3 sees it: tracked, staged and untracked changes and a tracked ignored file, no ignored file, no .factory/, with HEAD as parent', async () => {
    const head = repoWithTrackedIgnoredFile();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    write('src/staged.ts', 'staged\n');
    git(project.dir, 'add', 'src/staged.ts');
    write('src/untracked.ts', 'untracked\n');
    write('keep.log', 'tracked and edited\n');
    write('debug.log', 'ignored\n');
    write('.factory/run-1/state.json', '{}');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(result).toEqual({ kind: 'written', ref: 'refs/factory/run-1/stage3-1', commit: expect.any(String), tree: expect.any(String), reused: false });
    if (result.kind !== 'written') return;
    expect(factoryRefs(project.dir)).toEqual([`refs/factory/run-1/stage3-1 ${result.commit}`]);
    expect(git(project.dir, 'rev-parse', `${result.commit}^{tree}`).trim()).toBe(result.tree);
    expect(git(project.dir, 'rev-parse', `${result.commit}^1`).trim()).toBe(head);
    expect(treePaths(project.dir, result.tree)).toEqual(['.gitignore', 'keep.log', 'src/a.ts', 'src/staged.ts', 'src/untracked.ts']);
    expect(blob(project.dir, result.tree, 'src/a.ts')).toBe('export const a = 2;\n');
    expect(blob(project.dir, result.tree, 'keep.log')).toBe('tracked and edited\n');
    expect(git(project.dir, 'cat-file', '-p', result.commit)).toContain('Feature Factory snapshot run-1 stage3-1');
  });

  it('MINOR-5 with GIT_LITERAL_PATHSPECS=1 in the caller\'s environment, a snapshot and the CHECKPOINT 3 change still exclude .factory/', async () => {
    repoWithCommit();
    write('src/new.ts', 'export const n = 1;\n');
    write('.factory/run-1/state.json', '{}');
    const saved = process.env.GIT_LITERAL_PATHSPECS;
    process.env.GIT_LITERAL_PATHSPECS = '1';
    try {
      const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
      const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
      const change = await DEFAULT_CHANGE_TRACKER.collect(project.dir, base, []);

      expect(base).toMatchObject({ kind: 'git', preExisting: ['src/new.ts'] });
      expect(result.kind).toBe('written');
      if (result.kind !== 'written') return;
      expect(treePaths(project.dir, result.tree)).toEqual(['.gitignore', 'src/a.ts', 'src/new.ts']);
      expect(change.files).toEqual(['src/new.ts']);
      expect(change.text).not.toContain('state.json');
    } finally {
      if (saved === undefined) delete process.env.GIT_LITERAL_PATHSPECS;
      else process.env.GIT_LITERAL_PATHSPECS = saved;
    }
  });

  it('AC-82 on an unborn branch the snapshot is a root commit of the index and the untracked files', async () => {
    git(project.dir, 'init', '-q');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/staged.ts', 'staged\n');
    git(project.dir, 'add', 'src/staged.ts');
    write('src/untracked.ts', 'untracked\n');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(git(project.dir, 'cat-file', '-p', result.commit)).not.toMatch(/^parent /m);
    expect(treePaths(project.dir, result.tree)).toEqual(['src/staged.ts', 'src/untracked.ts']);
    // The user's branch is still unborn.
    expect(() => git(project.dir, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}')).toThrow();
  });

  it('AC-82 with cwd a subdirectory the snapshot tree root is the project directory', async () => {
    git(project.dir, 'init', '-q');
    write('app/src/a.ts', 'a\n');
    write('other/b.ts', 'b\n');
    git(project.dir, 'add', '.');
    git(project.dir, 'commit', '-q', '-m', 'base');
    const cwd = join(project.dir, 'app');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);
    write('app/src/a.ts', 'a2\n');
    write('app/src/new.ts', 'n\n');
    write('app/.factory/run-1/state.json', '{}');
    write('other/b.ts', 'b2\n');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(cwd, base, 'run-1', 1);

    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(treePaths(project.dir, result.tree)).toEqual(['src/a.ts', 'src/new.ts']);
    expect(blob(project.dir, result.tree, 'src/a.ts')).toBe('a2\n');
  });

  it('AC-82 with cwd an empty subdirectory the snapshot is the empty tree', async () => {
    repoWithCommit();
    const cwd = join(project.dir, 'empty');
    mkdirSync(cwd);
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(cwd, base, 'run-1', 1);

    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(treePaths(project.dir, result.tree)).toEqual([]);
  });

  it('AC-85 a second snapshot of an unchanged tree reuses the commit and writes no object', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    const first = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    const objects = looseObjects(project.dir);

    const second = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(first.kind).toBe('written');
    expect(second).toEqual({ ...first, reused: true });
    expect(looseObjects(project.dir)).toBe(objects);
    expect(factoryRefs(project.dir)).toHaveLength(1);
  });

  it('AC-85 a snapshot of a changed tree replaces stage3-<n>', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    const first = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    write('src/a.ts', 'export const a = 3;\n');

    const second = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(second.kind).toBe('written');
    if (first.kind !== 'written' || second.kind !== 'written') return;
    expect(second.reused).toBe(false);
    expect(second.commit).not.toBe(first.commit);
    expect(factoryRefs(project.dir)).toEqual([`refs/factory/run-1/stage3-1 ${second.commit}`]);
    expect(blob(project.dir, second.tree, 'src/a.ts')).toBe('export const a = 3;\n');
  });

  it('AC-85 the ref is compare-and-swapped: a stage3-<n> that is not a readable commit is never overwritten', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    const stray = git(project.dir, 'rev-parse', 'HEAD:src/a.ts').trim();
    git(project.dir, 'update-ref', 'refs/factory/run-1/stage3-1', stray);

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error).toMatch(/already exists/);
    expect(factoryRefs(project.dir)).toEqual([`refs/factory/run-1/stage3-1 ${stray}`]);
  });

  it.each([
    ['a new commit on the branch', (dir: string) => {
      write('src/b.ts', 'b\n');
      git(dir, 'add', 'src/b.ts');
      git(dir, 'commit', '-q', '-m', 'a builder committed');
    }],
    ['a switch to another branch at the same commit', (dir: string) => git(dir, 'checkout', '-q', '-b', 'elsewhere')],
    ['a detached HEAD at the same commit', (dir: string) => git(dir, 'checkout', '-q', '--detach')]
  ])('AC-86 a HEAD move returns head-moved naming the recorded and current HEAD and writes nothing (%s)', async (_, move) => {
    const head = repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    move(project.dir);
    const current = { commit: git(project.dir, 'rev-parse', 'HEAD').trim(), branch: branchOf(project.dir) };
    const objects = looseObjects(project.dir);

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(result).toEqual({ kind: 'head-moved', recorded: { commit: head, branch: base.kind === 'git' ? base.branch : undefined }, current });
    expect(factoryRefs(project.dir)).toEqual([]);
    expect(looseObjects(project.dir)).toBe(objects);
  });

  it('AC-86 a first commit on a branch that was unborn at run start is a HEAD move', async () => {
    git(project.dir, 'init', '-q');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('a.ts', 'a\n');
    git(project.dir, 'add', 'a.ts');
    git(project.dir, 'commit', '-q', '-m', 'first');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

    expect(result.kind).toBe('head-moved');
    expect(result.kind === 'head-moved' && result.recorded).toEqual({});
    expect(result.kind === 'head-moved' && result.current.commit).toBe(git(project.dir, 'rev-parse', 'HEAD').trim());
    expect(factoryRefs(project.dir)).toEqual([]);
  });

  it('AC-86 a base recorded before B-1 (no branch) compares only the commit', async () => {
    const head = repoWithCommit();
    git(project.dir, 'checkout', '-q', '-b', 'elsewhere');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, { kind: 'git', commit: head }, 'run-1', 1);

    expect(result.kind).toBe('written');
  });

  it('AC-45 a snapshot leaves HEAD, .git/index and every working-tree file byte-identical, and writes no reflog or shared index', async () => {
    repoWithTrackedIgnoredFile();
    git(project.dir, 'config', 'core.splitIndex', 'true');
    git(project.dir, 'config', 'core.logAllRefUpdates', 'always');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    write('src/staged.ts', 'staged\n');
    git(project.dir, 'add', 'src/staged.ts');
    write('src/untracked.ts', 'untracked\n');
    const gitDir = join(project.dir, '.git');
    const before = {
      head: readFileSync(join(gitDir, 'HEAD')),
      index: readFileSync(join(gitDir, 'index')),
      gitEntries: readdirSync(gitDir).sort(),
      files: ['src/a.ts', 'src/staged.ts', 'src/untracked.ts', 'keep.log'].map(path => readFileSync(join(project.dir, path)))
    };

    // The CommonJS fs object (not a namespace import) is what change-diff's compiled calls use.
    const made = jest.spyOn(require('fs') as typeof import('fs'), 'mkdtempSync');
    let result;
    let temporary: string[];
    try {
      result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
      temporary = made.mock.results.map(r => r.value as string);
    } finally {
      made.mockRestore();
    }

    expect(result.kind).toBe('written');
    expect(readFileSync(join(gitDir, 'HEAD'))).toEqual(before.head);
    expect(readFileSync(join(gitDir, 'index'))).toEqual(before.index);
    expect(readdirSync(gitDir).sort()).toEqual(before.gitEntries);
    expect(['src/a.ts', 'src/staged.ts', 'src/untracked.ts', 'keep.log'].map(path => readFileSync(join(project.dir, path)))).toEqual(before.files);
    expect(existsSync(join(gitDir, 'logs', 'refs', 'factory'))).toBe(false);
    // The temporary index lived in the snapshot's own directory, which is removed.
    expect(temporary).toHaveLength(1);
    expect(temporary[0].startsWith(join(tmpdir(), SNAPSHOT_TMP_PREFIX))).toBe(true);
    expect(existsSync(temporary[0])).toBe(false);
  });

  it.each<[string, (dir: string) => [string, ChangeBase, string, number]]>([
    ['a base that is not git', dir => [dir, { kind: 'none', reason: 'not a git work tree' }, 'run-1', 1]],
    ['a project that is no longer a work tree', () => [tmpdir(), { kind: 'git', commit: '0'.repeat(40) }, 'run-1', 1]],
    ['an unsafe run id', dir => [dir, { kind: 'git' }, '../escape', 1]],
    ['a snapshot number that is not a positive integer', dir => [dir, { kind: 'git' }, 'run-1', 0]]
  ])('AC-88 snapshot never throws: %s returns failed with a reason and writes no ref', async (_, args) => {
    git(project.dir, 'init', '-q');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(...args(project.dir));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error.length).toBeGreaterThan(0);
    expect(factoryRefs(project.dir)).toEqual([]);
  });

  it('AC-83 a snapshot with every hook (reference-transaction included, and a repo core.hooksPath) writing a marker, commit.gpgSign on with a failing gpg.program, and no user identity succeeds without input, runs no hook, and is unsigned with the harness identity', async () => {
    repoWithCommit();
    const outside = tempProject('ff-hooks-');
    try {
      const marker = join(outside.dir, 'ran');
      const hookNames = [
        'reference-transaction', 'post-index-change', 'pre-commit', 'prepare-commit-msg', 'commit-msg',
        'post-commit', 'post-checkout', 'post-merge', 'post-rewrite', 'pre-auto-gc', 'pre-push'
      ];
      const repoHooks = join(outside.dir, 'repo-hooks');
      for (const dir of [join(project.dir, '.git', 'hooks'), repoHooks]) {
        for (const name of hookNames) {
          const hook = write(name, `#!/bin/sh\ncat >/dev/null 2>&1\necho ${name} >> "${marker}"\nexit 0\n`, dir);
          execFileSync('chmod', ['755', hook]);
        }
      }
      const gpg = write('gpg', `#!/bin/sh\necho gpg >> "${marker}"\nexit 1\n`, outside.dir);
      execFileSync('chmod', ['755', gpg]);
      git(project.dir, 'config', 'core.hooksPath', repoHooks);
      git(project.dir, 'config', 'commit.gpgSign', 'true');
      git(project.dir, 'config', 'gpg.program', gpg);
      git(project.dir, 'config', 'user.useConfigOnly', 'true');

      // Control: without the harness's settings the repository's reference-transaction hook runs.
      git(project.dir, 'update-ref', 'refs/test/control', 'HEAD');
      expect(readFileSync(marker, 'utf8')).toContain('reference-transaction');
      rmSync(marker);

      const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
      write('src/a.ts', 'export const a = 2;\n');

      const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);

      expect(result.kind).toBe('written');
      if (result.kind !== 'written') return;
      expect(existsSync(marker)).toBe(false);
      const commit = git(project.dir, 'cat-file', '-p', result.commit);
      expect(commit).not.toMatch(/^gpgsig/m);
      expect(commit).toMatch(/^author Feature Factory <feature-factory@localhost\.invalid> /m);
      expect(commit).toMatch(/^committer Feature Factory <feature-factory@localhost\.invalid> /m);
    } finally {
      outside.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PR B-2, step 2: the review copy's extraction (D-1, AC-117) and the measurement of the Test
// Verifier's changes (D-2, AC-121). Real git in temp repositories only; the harness's own calls
// are isolated from the user's global and system git configuration.
// ---------------------------------------------------------------------------------------------

type Snap = { ref: string; commit: string; tree: string };
interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
  path: string;
}

/** Write a blob object; returns its id. */
function hashBlob(content: string): string {
  return setupGit(project.dir, ['hash-object', '-w', '--stdin'], {}, content).trim();
}

/** A tree built from `[mode, type, oid, name]` entries by `git mktree`, which checks no name. */
function mktree(entries: Array<[string, string, string, string]>): string {
  const input = entries.map(([mode, type, oid, name]) => `${mode} ${type} ${oid}\t${name}\n`).join('');
  return setupGit(project.dir, ['mktree', '--missing'], {}, input).trim();
}

/** A hand-built tree committed under a test ref, so it can be passed as a recorded snapshot. */
function snapOf(tree: string, ref = 'refs/test/snapshot'): Snap {
  const commit = git(project.dir, 'commit-tree', '-m', 'hand-built', tree).trim();
  git(project.dir, 'update-ref', ref, commit);
  return { ref, commit, tree };
}

/** Git's object id of `bytes` as a blob, in the hash the length of `oid` names. */
function blobId(bytes: Buffer, oid: string): string {
  return createHash(oid.length === 64 ? 'sha256' : 'sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
}

/** Every leaf entry of a tree (blobs and gitlinks), as `ls-tree -r --full-tree` lists them. */
function lsTree(tree: string): TreeEntry[] {
  return git(project.dir, 'ls-tree', '-r', '-z', '--full-tree', tree)
    .split('\0')
    .filter(Boolean)
    .map(line => {
      const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(line)!;
      return { mode: m[1], type: m[2], oid: m[3], path: m[4] };
    });
}

/** Every leaf under `root` (files, symlinks, empty directories), sorted, never following a link. */
function leaves(root: string, prefix = ''): string[] {
  const names = readdirSync(prefix === '' ? root : join(root, prefix));
  if (names.length === 0 && prefix !== '') return [prefix];
  return names
    .flatMap(name => {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      return lstatSync(join(root, path)).isDirectory() ? leaves(root, path) : [path];
    })
    .sort();
}

/** The bytes of the file at `path` at each of `offsets`, read one at a time (no whole-file buffer). */
function bytesAt(path: string, offsets: readonly number[]): number[] {
  const fd = openSync(path, 'r');
  try {
    return offsets.map(offset => {
      const one = Buffer.alloc(1);
      readSync(fd, one, 0, 1, offset);
      return one[0];
    });
  } finally {
    closeSync(fd);
  }
}

/** The loose-object file of `oid`. */
const looseObject = (oid: string) => join(project.dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2));

describe('git(): raw output and stdin input (D-1, AC-80, AC-89)', () => {
  it('AC-80 D-1 the extraction array is exactly ls-tree and cat-file, and git() accepts both', () => {
    repoWithCommit();

    expect([...GIT_EXTRACTION_SUBCOMMANDS]).toEqual(['ls-tree', 'cat-file']);
    expect(harnessGit(project.dir, 'ls-tree', ['--name-only', 'HEAD']).ok).toBe(true);
    expect(harnessGit(project.dir, 'cat-file', ['-t', 'HEAD']).ok).toBe(true);
  });

  it('AC-89 D-1 git() returns the raw bytes, and its text is exactly their UTF-8 decoding', () => {
    git(project.dir, 'init', '-q');
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x0a, 0xff, 0x00, 0xfe, 0x0a]);
    const oid = setupGit(project.dir, ['hash-object', '-w', write('bin.dat', bytes)]).trim();

    const result = harnessGit(project.dir, 'cat-file', ['blob', oid]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw).toEqual(bytes);
    expect(result.stdout).toBe(bytes.toString('utf8'));
    // Text output is what a utf8 spawn of the same command gives.
    expect(harnessGit(project.dir, 'rev-parse', ['--is-inside-work-tree'])).toMatchObject({ ok: true, stdout: 'true\n' });
  });

  it('D-1 git() pipes stdin only when input is given; otherwise stdin is closed and nothing waits on it', () => {
    repoWithCommit();
    const oid = git(project.dir, 'rev-parse', 'HEAD:src/a.ts').trim();

    const closed = harnessGit(project.dir, 'cat-file', ['--batch']);
    const piped = harnessGit(project.dir, 'cat-file', ['--batch'], undefined, { input: `${oid}\n` });

    expect(closed).toMatchObject({ ok: true, stdout: '' });
    expect(piped).toMatchObject({ ok: true, stdout: `${oid} blob 20\nexport const a = 1;\n\n` });
  });
});

describe('extractSnapshot (D-1, AC-117)', () => {
  let restoreEnv: () => void;
  let scratch: string[];

  beforeEach(() => {
    restoreEnv = isolateHarnessGit();
    scratch = [];
  });

  afterEach(() => {
    restoreEnv();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** A fresh empty destination outside the project. */
  function freshDest(): string {
    const dest = mkdtempSync(join(tmpdir(), 'ff-copy-'));
    scratch.push(dest);
    return dest;
  }

  /**
   * A working tree with every entry kind, snapshotted by the real tracker: an edited and a new
   * file, an executable, a binary, a relative and a dangling absolute symlink, a nested repository
   * (a gitlink), a tracked-but-ignored file, an untracked ignored file and .factory/.
   */
  async function richSnapshot(): Promise<Snap> {
    repoWithCommit();
    write('keep.log', 'tracked although ignored\n');
    git(project.dir, 'add', '-f', 'keep.log');
    git(project.dir, 'commit', '-q', '-m', 'force-added log');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/a.ts', 'export const a = 2;\n');
    chmodSync(write('bin/run.sh', '#!/bin/sh\necho run\n'), 0o755);
    write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0xff, 0x0d]));
    symlinkSync('src/a.ts', join(project.dir, 'link-to-a.ts'));
    symlinkSync('/factory-test/absent', join(project.dir, 'dangling'));
    const lib = join(project.dir, 'vendor', 'lib');
    mkdirSync(lib, { recursive: true });
    git(lib, 'init', '-q');
    write('vendor/lib/lib.ts', 'lib\n');
    git(lib, 'add', '.');
    git(lib, 'commit', '-q', '-m', 'lib');
    write('src/new.ts', 'export const n = 1;\n');
    write('debug.log', 'ignored, untracked\n');
    write('.factory/run-1/state.json', '{}');

    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    if (result.kind !== 'written') throw new Error(`snapshot not written: ${JSON.stringify(result)}`);
    return { ref: result.ref, commit: result.commit, tree: result.tree };
  }

  it.each<[string, (dest: string, entries: TreeEntry[]) => void]>([
    [
      'writes every blob byte-identical with its mode',
      (dest, entries) => {
        const files = entries.filter(e => e.mode === '100644' || e.mode === '100755');
        expect(files.map(e => e.path)).toEqual(['.gitignore', 'assets/logo.png', 'bin/run.sh', 'keep.log', 'src/a.ts', 'src/new.ts']);
        for (const entry of files) {
          const stat = lstatSync(join(dest, entry.path));
          expect(stat.isFile()).toBe(true);
          expect(blobId(readFileSync(join(dest, entry.path)), entry.oid)).toBe(entry.oid);
          expect(stat.mode & 0o777).toBe(entry.mode === '100755' ? 0o755 : 0o644);
        }
        expect(readFileSync(join(dest, 'src/a.ts'), 'utf8')).toBe('export const a = 2;\n');
      }
    ],
    [
      'keeps a symlink as a link without following it',
      (dest, entries) => {
        const links = entries.filter(e => e.mode === '120000');
        expect(links.map(e => e.path)).toEqual(['dangling', 'link-to-a.ts']);
        for (const entry of links) {
          expect(lstatSync(join(dest, entry.path)).isSymbolicLink()).toBe(true);
          expect(blobId(readlinkSync(join(dest, entry.path), { encoding: 'buffer' }), entry.oid)).toBe(entry.oid);
        }
        expect(readlinkSync(join(dest, 'link-to-a.ts'))).toBe('src/a.ts');
        expect(readlinkSync(join(dest, 'dangling'))).toBe('/factory-test/absent');
      }
    ],
    [
      'makes a gitlink an empty directory',
      (dest, entries) => {
        expect(entries.filter(e => e.mode === '160000').map(e => [e.type, e.path])).toEqual([['commit', 'vendor/lib']]);
        expect(lstatSync(join(dest, 'vendor/lib')).isDirectory()).toBe(true);
        expect(readdirSync(join(dest, 'vendor/lib'))).toEqual([]);
      }
    ],
    [
      'equals the snapshot tree exactly: no .git, no .factory, no untracked ignored file, the tracked ignored file present',
      (dest, entries) => {
        expect(leaves(dest)).toEqual(entries.map(e => e.path).sort());
        expect(existsSync(join(dest, '.git'))).toBe(false);
        expect(existsSync(join(dest, '.factory'))).toBe(false);
        expect(existsSync(join(dest, 'debug.log'))).toBe(false);
        expect(readFileSync(join(dest, 'keep.log'), 'utf8')).toBe('tracked although ignored\n');
      }
    ]
  ])('AC-117 extractSnapshot %s', async (_, check) => {
    const snap = await richSnapshot();
    const dest = freshDest();

    const result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, snap, dest);

    const entries = lsTree(snap.tree);
    expect(result).toEqual({ kind: 'extracted', entries: entries.length });
    check(dest, entries);
  });

  it('AC-123 D-B2-2 an extracted copy and a fallback copy of the same working tree have the same leaf count and digest', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    chmodSync(write('bin/run.sh', '#!/bin/sh\necho run\n'), 0o755);
    write('src/deep/b.ts', 'export const b = 2;\n');
    symlinkSync('src/a.ts', join(project.dir, 'link-to-a.ts'));
    const written = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    if (written.kind !== 'written') throw new Error(written.kind);
    const extracted = freshDest();
    const fallback = freshDest();

    const result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, written, extracted);
    const record = leafDigest(extracted);

    expect(result).toEqual({ kind: 'extracted', entries: record.entries });
    expect(copyWorkingTree(project.dir, fallback)).toEqual(record);
    expect(copyIntact(extracted, record)).toBe(true);
  });

  it('AC-117 extractSnapshot from a subdirectory cwd extracts the whole project-rooted snapshot tree', async () => {
    git(project.dir, 'init', '-q');
    write('app/src/a.ts', 'a\n');
    write('other/b.ts', 'b\n');
    git(project.dir, 'add', '.');
    git(project.dir, 'commit', '-q', '-m', 'base');
    const cwd = join(project.dir, 'app');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);
    write('app/src/new.ts', 'n\n');
    const written = await DEFAULT_CHANGE_TRACKER.snapshot(cwd, base, 'run-1', 1);
    if (written.kind !== 'written') throw new Error(written.kind);
    const dest = freshDest();

    const result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(cwd, written, dest);

    expect(result).toEqual({ kind: 'extracted', entries: 2 });
    expect(leaves(dest)).toEqual(['src/a.ts', 'src/new.ts']);
  });

  it('AC-117 extractSnapshot fetches more than 1000 blobs in batches of at most 1000 objects', async () => {
    repoWithCommit();
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    for (let i = 0; i < 1001; i++) write(`many/f${String(i).padStart(4, '0')}.txt`, `file ${i}\n`);
    const written = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    if (written.kind !== 'written') throw new Error(written.kind);
    const dest = freshDest();

    const spawned = jest.spyOn(require('child_process') as typeof import('child_process'), 'spawnSync');
    let result;
    let batches: number;
    try {
      result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, written, dest);
      batches = spawned.mock.calls.filter(call => (call[1] as string[]).includes('cat-file')).length;
    } finally {
      spawned.mockRestore();
    }

    expect(result).toEqual({ kind: 'extracted', entries: 1003 });
    expect(batches).toBe(2);
    expect(readFileSync(join(dest, 'many/f1000.txt'), 'utf8')).toBe('file 1000\n');
    expect(leaves(dest)).toHaveLength(1003);
  });

  /**
   * Whether this git can create a sha256 repository (`init --object-format`, git 2.29 or later),
   * probed once when the file is collected: Jest decides a skip before any hook runs.
   */
  const SHA256_REPOSITORIES = ((): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-sha256-probe-'));
    try {
      setupGit(dir, ['init', '-q', '--object-format=sha256']);
      return true;
    } catch {
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  const sha256It = SHA256_REPOSITORIES ? it : it.skip;
  const SHA256_SKIP_NOTE = SHA256_REPOSITORIES ? '' : ' (skipped: this git cannot create a sha256 repository; it requires git 2.29 or later)';

  sha256It(`AC-117 D-1 extractSnapshot in a sha256 repository checks every blob with sha256 and writes it byte-identical${SHA256_SKIP_NOTE}`, async () => {
    // Kills: the blob check always hashing with sha1 (a 64-hex object id is a sha256 repository).
    git(project.dir, 'init', '-q', '--object-format=sha256');
    write('src/a.ts', 'export const a = 1;\n');
    git(project.dir, 'add', '.');
    git(project.dir, 'commit', '-q', '-m', 'base');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);
    write('src/b.ts', 'export const b = 2;\n');
    const written = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'run-1', 1);
    if (written.kind !== 'written') throw new Error(`snapshot not written: ${JSON.stringify(written)}`);
    expect(written.tree).toMatch(/^[0-9a-f]{64}$/);
    const dest = freshDest();

    const result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, written, dest);

    expect(result).toEqual({ kind: 'extracted', entries: 2 });
    expect(readFileSync(join(dest, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(readFileSync(join(dest, 'src', 'b.ts'), 'utf8')).toBe('export const b = 2;\n');
  });

  it('AC-117 D-1 extractSnapshot never asks cat-file for more than 64 MiB of blobs at once: two 40 MiB blobs take two requests', async () => {
    // Kills: the 64 MiB per-request byte bound raised (the 1000-object bound is the test above).
    // The tree is built by hand, so no 80 MiB snapshot is taken; one 40 MiB buffer is refilled for
    // each blob, and the copies are checked by size and a few bytes (the extraction itself
    // hash-checks every blob), so no second large buffer is held.
    git(project.dir, 'init', '-q');
    const SIZE = 40 * 1024 * 1024;
    let buffer: Buffer | undefined = Buffer.alloc(SIZE);
    const blobOf = (name: string, fill: number): string => {
      buffer!.fill(fill);
      const path = write(name, buffer!);
      const oid = git(project.dir, 'hash-object', '-w', path).trim();
      rmSync(path);
      return oid;
    };
    const first = blobOf('big-a.bin', 0x61);
    const second = blobOf('big-b.bin', 0x62);
    buffer = undefined;
    const snap = snapOf(mktree([['100644', 'blob', first, 'big-a.bin'], ['100644', 'blob', second, 'big-b.bin']]));
    const dest = freshDest();

    const spawned = jest.spyOn(require('child_process') as typeof import('child_process'), 'spawnSync');
    let requests: number;
    let result;
    try {
      result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, snap, dest);
      requests = spawned.mock.calls.filter(call => (call[1] as string[]).includes('cat-file')).length;
    } finally {
      spawned.mockRestore();
    }

    expect(result).toEqual({ kind: 'extracted', entries: 2 });
    expect(requests).toBe(2);
    for (const [name, fill] of [['big-a.bin', 0x61], ['big-b.bin', 0x62]] as const) {
      expect({ name, size: statSync(join(dest, name)).size, spots: bytesAt(join(dest, name), [0, SIZE / 2, SIZE - 1]) }).toEqual({
        name,
        size: SIZE,
        spots: [fill, fill, fill]
      });
    }
  });

  it('AC-117 N-1 extractSnapshot creates symlinks last, so a link in the tree never redirects a file write', async () => {
    git(project.dir, 'init', '-q');
    const outside = freshDest();
    // `D` (a link to a directory outside) sorts before `d/x`: written in tree order, `d/x` would go
    // through the link on a case-insensitive file system.
    const link = hashBlob(outside);
    const inner = mktree([['100644', 'blob', hashBlob('x\n'), 'x']]);
    const snap = snapOf(mktree([['120000', 'blob', link, 'D'], ['040000', 'tree', inner, 'd']]));
    const dest = freshDest();

    await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, snap, dest);

    expect(readdirSync(outside)).toEqual([]);
    expect(lstatSync(join(dest, 'd', 'x')).isFile()).toBe(true);
  });

  /** One refusal: the snapshot to extract, the destination, and what must hold afterwards. */
  interface Refusal {
    snap: Snap;
    dest: string;
    error: RegExp;
    /** Default: the destination is still empty. */
    unchanged?: () => void;
  }

  it.each<[string, () => Promise<Refusal>]>([
    [
      'a ref that moved since it was recorded',
      async () => {
        const snap = await richSnapshot();
        git(project.dir, 'update-ref', snap.ref, 'HEAD');
        return { snap, dest: freshDest(), error: /no longer points at the recorded commit/ };
      }
    ],
    [
      'a recorded tree that is not the commit\'s tree',
      async () => {
        const snap = await richSnapshot();
        return { snap: { ...snap, tree: git(project.dir, 'rev-parse', 'HEAD^{tree}').trim() }, dest: freshDest(), error: /tree/ };
      }
    ],
    [
      'a ref, commit or tree that is not an object id',
      async () => {
        const snap = await richSnapshot();
        return { snap: { ...snap, ref: '--output=/tmp/x' }, dest: freshDest(), error: /not a valid/ };
      }
    ],
    ...['..', '.', '.git', '.GIT', '.Git'].map((name): [string, () => Promise<Refusal>] => [
      `an unsafe path segment ${JSON.stringify(name)}`,
      async () => {
        git(project.dir, 'init', '-q');
        const blob = hashBlob('payload\n');
        const below = mktree([['100644', 'blob', blob, name]]);
        const snap = snapOf(mktree([['100644', 'blob', blob, 'fine.txt'], ['040000', 'tree', below, 'a']]));
        return { snap, dest: freshDest(), error: /unsafe path/ };
      }
    ]),
    [
      'an unsafe path segment at the root',
      async () => {
        git(project.dir, 'init', '-q');
        const blob = hashBlob('payload\n');
        const snap = snapOf(mktree([['100644', 'blob', blob, '..'], ['100644', 'blob', blob, 'fine.txt']]));
        return { snap, dest: freshDest(), error: /unsafe path/ };
      }
    ],
    [
      'the same path twice',
      async () => {
        git(project.dir, 'init', '-q');
        const blob = hashBlob('payload\n');
        const snap = snapOf(mktree([['100644', 'blob', blob, 'twice'], ['100644', 'blob', blob, 'twice']]));
        return { snap, dest: freshDest(), error: /more than once|inside another/ };
      }
    ],
    [
      'a path that is both a symlink and a directory',
      async () => {
        git(project.dir, 'init', '-q');
        const outside = freshDest();
        const inner = mktree([['100644', 'blob', hashBlob('x\n'), 'x']]);
        const snap = snapOf(mktree([['120000', 'blob', hashBlob(outside), 'd'], ['040000', 'tree', inner, 'd']]));
        const dest = freshDest();
        return {
          snap,
          dest,
          error: /more than once|inside another/,
          unchanged: () => {
            expect(readdirSync(dest)).toEqual([]);
            expect(readdirSync(outside)).toEqual([]);
          }
        };
      }
    ],
    [
      'a blob whose bytes do not match its object id',
      async () => {
        git(project.dir, 'init', '-q');
        const wanted = hashBlob('the reviewed content\n');
        const other = hashBlob('something else\n');
        rmSync(looseObject(wanted), { force: true });
        writeFileSync(looseObject(wanted), readFileSync(looseObject(other)));
        const snap = snapOf(mktree([['100644', 'blob', wanted, 'f.ts']]));
        return { snap, dest: freshDest(), error: /does not match its object id/ };
      }
    ],
    [
      'a blob larger than the git output limit (256 MiB)',
      async () => {
        git(project.dir, 'init', '-q');
        // A loose object whose header claims 300 MB: ls-tree reports that size; nothing is fetched.
        const oid = createHash('sha1').update('factory-test-huge').digest('hex');
        mkdirSync(join(looseObject(oid), '..'), { recursive: true });
        writeFileSync(looseObject(oid), deflateSync(Buffer.from('blob 300000000\0x')));
        const snap = snapOf(mktree([['100644', 'blob', oid, 'huge.bin']]));
        return { snap, dest: freshDest(), error: /larger than/ };
      }
    ],
    [
      'a blob the repository does not have',
      async () => {
        git(project.dir, 'init', '-q');
        const snap = snapOf(mktree([['100644', 'blob', '1'.repeat(40), 'gone.ts']]));
        return { snap, dest: freshDest(), error: /./ };
      }
    ],
    [
      'a destination that is not empty',
      async () => {
        const snap = await richSnapshot();
        const dest = freshDest();
        writeFileSync(join(dest, 'existing'), 'x');
        return { snap, dest, error: /empty/, unchanged: () => expect(readdirSync(dest)).toEqual(['existing']) };
      }
    ],
    [
      'a destination that is a symlink to an empty directory',
      async () => {
        const snap = await richSnapshot();
        const target = freshDest();
        const holder = freshDest();
        const dest = join(holder, 'link');
        symlinkSync(target, dest);
        return { snap, dest, error: /real directory/, unchanged: () => expect(readdirSync(target)).toEqual([]) };
      }
    ],
    [
      'a destination that does not exist',
      async () => {
        const snap = await richSnapshot();
        const dest = join(freshDest(), 'absent');
        return { snap, dest, error: /real directory/, unchanged: () => expect(existsSync(dest)).toBe(false) };
      }
    ]
  ])('AC-117 extractSnapshot refuses %s: failed, and nothing is written', async (_, setup) => {
    const { snap, dest, error, unchanged } = await setup();

    const result = await DEFAULT_CHANGE_TRACKER.extractSnapshot(project.dir, snap, dest);

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error).toMatch(error);
    if (unchanged) unchanged();
    else expect(readdirSync(dest)).toEqual([]);
  });
});

describe('changedSince: the Test Verifier measurement (D-2, AC-121)', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = isolateHarnessGit();
  });

  afterEach(() => {
    restoreEnv();
  });

  /** A repository with app/ and other/, snapshotted from `cwd`; returns the snapshot's tree. */
  async function snapshotFrom(sub: string): Promise<{ cwd: string; tree: string }> {
    git(project.dir, 'init', '-q');
    write('.gitignore', '*.log\n');
    write('app/src/a.ts', 'a\n');
    write('app/src/gone.ts', 'gone\n');
    write('app/test/old.test.ts', 'old\n');
    write('other/b.ts', 'b\n');
    git(project.dir, 'add', '.');
    git(project.dir, 'commit', '-q', '-m', 'base');
    const cwd = sub === '' ? project.dir : join(project.dir, sub);
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(cwd);
    const written = await DEFAULT_CHANGE_TRACKER.snapshot(cwd, base, 'run-1', 1);
    if (written.kind !== 'written') throw new Error(written.kind);
    return { cwd, tree: written.tree };
  }

  it.each([
    ['the project root', '', ['app/src/a.ts', 'app/src/gone.ts', 'app/test/new.test.ts', 'other/b.ts']],
    ['a subdirectory of the repository', 'app', ['src/a.ts', 'src/gone.ts', 'test/new.test.ts']]
  ])(
    'AC-121 changedSince lists the files that differ from a snapshot tree, untracked and deleted included, also from a subdirectory, without touching .git/index (%s)',
    async (_, sub, expected) => {
      const { cwd, tree } = await snapshotFrom(sub);
      write('app/src/a.ts', 'a2\n');
      rmSync(join(project.dir, 'app/src/gone.ts'));
      write('app/test/new.test.ts', 'new\n');
      write('app/debug.log', 'ignored\n');
      write('other/b.ts', 'b2\n');
      write(join(sub, '.factory/run-1/state.json'), '{}');
      const gitDir = join(project.dir, '.git');
      const before = { head: readFileSync(join(gitDir, 'HEAD')), index: readFileSync(join(gitDir, 'index')), refs: factoryRefs(project.dir) };

      const result = await DEFAULT_CHANGE_TRACKER.changedSince(cwd, tree);

      expect(result).toEqual({ kind: 'files', files: expected });
      expect(readFileSync(join(gitDir, 'HEAD'))).toEqual(before.head);
      expect(readFileSync(join(gitDir, 'index'))).toEqual(before.index);
      expect(factoryRefs(project.dir)).toEqual(before.refs);
    }
  );

  it.each([
    ['the project root', ''],
    ['a subdirectory of the repository', 'app']
  ])(
    'IMPORTANT-1 workingTreeId is the tree changedSince compares with: the snapshot\'s while nothing changed, and later changes measure against it, without touching HEAD, the index or a ref (%s)',
    async (_, sub) => {
      const { cwd, tree } = await snapshotFrom(sub);
      const gitDir = join(project.dir, '.git');
      const before = { head: readFileSync(join(gitDir, 'HEAD')), index: readFileSync(join(gitDir, 'index')), refs: factoryRefs(project.dir) };

      const unchanged = await DEFAULT_CHANGE_TRACKER.workingTreeId(cwd);
      expect(unchanged).toEqual({ kind: 'tree', tree });

      // A hand fix before the Test Verifier starts is in the baseline; only what follows is measured.
      write('app/src/a.ts', 'hand fix\n');
      const baseline = await DEFAULT_CHANGE_TRACKER.workingTreeId(cwd);
      if (baseline.kind !== 'tree') throw new Error(baseline.error);
      expect(baseline.tree).not.toBe(tree);
      write('app/test/new.test.ts', 'new\n');
      expect(await DEFAULT_CHANGE_TRACKER.changedSince(cwd, baseline.tree)).toEqual({
        kind: 'files',
        files: [sub === '' ? 'app/test/new.test.ts' : 'test/new.test.ts']
      });
      expect(readFileSync(join(gitDir, 'HEAD'))).toEqual(before.head);
      expect(readFileSync(join(gitDir, 'index'))).toEqual(before.index);
      expect(factoryRefs(project.dir)).toEqual(before.refs);
    }
  );

  it('IMPORTANT-1 workingTreeId never throws: outside a work tree it returns failed with a reason', async () => {
    const result = await DEFAULT_CHANGE_TRACKER.workingTreeId(project.dir);

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error.length).toBeGreaterThan(0);
  });

  it('AC-121 changedSince of an unchanged working tree lists no file', async () => {
    const { cwd, tree } = await snapshotFrom('app');

    expect(await DEFAULT_CHANGE_TRACKER.changedSince(cwd, tree)).toEqual({ kind: 'files', files: [] });
  });

  it('AC-121 changedSince is not narrowed by a repository\'s diff.relative setting', async () => {
    const { cwd, tree } = await snapshotFrom('app');
    git(project.dir, 'config', 'diff.relative', 'true');
    write('app/src/a.ts', 'a2\n');

    expect(await DEFAULT_CHANGE_TRACKER.changedSince(cwd, tree)).toEqual({ kind: 'files', files: ['src/a.ts'] });
  });

  it('IMPORTANT-4 the measurement needs no git >= 2.28 option: no --no-relative flag; diff.relative=false is set per call and --ignore-submodules=none is kept', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'harness', 'change-diff.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const treeOptions = /const TREE_DIFF_OPTIONS = \[([^\]]*)\]/.exec(source);
    const safeConfig = /const SAFE_GIT_CONFIG = \[([\s\S]*?)\];/.exec(source);

    expect(source).not.toContain('--no-relative');
    expect(treeOptions?.[1]).toContain(`'--ignore-submodules=none'`);
    expect(safeConfig?.[1]).toContain(`'-c', 'diff.relative=false'`);
  });

  it('AC-121 changedSince lists a moved gitlink even when the repository sets diff.ignoreSubmodules=all', async () => {
    const { cwd, tree } = await snapshotFrom('');
    const lib = join(project.dir, 'vendor', 'lib');
    mkdirSync(lib, { recursive: true });
    git(lib, 'init', '-q');
    write('vendor/lib/lib.ts', 'one\n');
    git(lib, 'add', '.');
    git(lib, 'commit', '-q', '-m', 'one');
    const withLib = await DEFAULT_CHANGE_TRACKER.snapshot(cwd, await DEFAULT_CHANGE_TRACKER.captureBase(cwd), 'run-1', 2);
    if (withLib.kind !== 'written') throw new Error(withLib.kind);
    write('vendor/lib/lib.ts', 'two\n');
    git(lib, 'commit', '-q', '-am', 'two');
    git(project.dir, 'config', 'diff.ignoreSubmodules', 'all');

    expect(await DEFAULT_CHANGE_TRACKER.changedSince(cwd, tree)).toEqual({ kind: 'files', files: ['vendor/lib'] });
    expect(await DEFAULT_CHANGE_TRACKER.changedSince(cwd, withLib.tree)).toEqual({ kind: 'files', files: ['vendor/lib'] });
  });

  it.each<[string, (cwd: string, tree: string) => [string, string]]>([
    ['a tree id that is not an object id', cwd => [cwd, '--output=/tmp/x']],
    ['a tree the repository does not have', cwd => [cwd, '0'.repeat(40)]],
    ['a commit id, not a tree id', cwd => [cwd, git(project.dir, 'rev-parse', 'HEAD').trim()]],
    ['a project that is not a work tree', (_, tree) => [tmpdir(), tree]]
  ])('AC-121 changedSince never throws: %s returns failed with a reason', async (_, args) => {
    const { cwd, tree } = await snapshotFrom('');

    const result = await DEFAULT_CHANGE_TRACKER.changedSince(...args(cwd, tree));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error.length).toBeGreaterThan(0);
  });
});
