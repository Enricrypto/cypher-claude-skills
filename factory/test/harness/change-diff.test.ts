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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  ChangeDiffError,
  DEFAULT_CHANGE_TRACKER,
  factoryRef,
  git as harnessGit,
  GIT_READ_SUBCOMMANDS,
  GIT_SNAPSHOT_SUBCOMMANDS,
  MAX_INLINE_BYTES,
  SNAPSHOT_TMP_PREFIX
} from '../../harness/change-diff';
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
