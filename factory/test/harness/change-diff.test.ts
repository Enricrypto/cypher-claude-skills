/**
 * The CP3 change (A-2, D-8, I-4) [G]: what "the diff" is when a human approves the validated
 * change.
 *
 * The ONLY test file that runs real `git`, and only in temp repositories it creates: local and
 * offline. Everything else injects `fakeChangeTracker()` (fixtures/changes.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  ChangeDiffError,
  DEFAULT_CHANGE_TRACKER,
  MAX_INLINE_BYTES
} from '../../harness/change-diff';
import { tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-change-');
});

afterEach(() => {
  project.cleanup();
});

/** Run git in `cwd` for test SETUP, isolated from the user's and the caller's git configuration. */
function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return execFileSync(
    'git',
    ['-c', 'user.name=Factory Test', '-c', 'user.email=factory@test.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
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

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git', commit: head });
  });

  it('I-4 in a repository with no commit yet, the base is git with no commit', async () => {
    git(project.dir, 'init', '-q');

    expect(await DEFAULT_CHANGE_TRACKER.captureBase(project.dir)).toEqual({ kind: 'git' });
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
