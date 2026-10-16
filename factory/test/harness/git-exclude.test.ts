/**
 * R8b / AC-010: `.factory/` in the project's git exclude file.
 *
 * A real-git test file (with change-diff.test.ts and snapshot.test.ts), working only in temp
 * repositories it creates. It exercises the REAL tracker's `hideFactoryFromGit`, because the whole
 * point of AC-010 is WHICH file git really resolves `info/exclude` to — a question a fake cannot
 * answer. The write itself lives in `git-exclude.ts`, which never spawns git.
 *
 * Two properties are load-bearing throughout:
 *   - IDEMPOTENT: a second and a resumed call add nothing (AC-010's "never duplicated").
 *   - NEVER A STOP: every refusal is `skipped`, nothing is written, no symlink is followed, and
 *     nothing throws.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { chmodSync } from 'fs';
import { join } from 'path';

import { DEFAULT_CHANGE_TRACKER } from '../../harness/change-diff';
import { addFactoryToExcludeFile, FACTORY_EXCLUDE_ENTRY } from '../../harness/git-exclude';
import { tempProject, TempProject } from '../fixtures/harness-run';
import { gitignore, isolateHarnessGit, linkedWorktree, setupGit } from '../fixtures/real-git';

let project: TempProject;
let restoreEnv: () => void;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  project = tempProject('ff-exclude-');
  restoreEnv = isolateHarnessGit();
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  restoreEnv();
  project.cleanup();
});

const git = (cwd: string, ...args: string[]) => setupGit(cwd, args);
const hide = (cwd: string) => DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(cwd);

/** A repository on `main` with one commit. */
function repo(root: string = project.dir): string {
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}

const excludePath = (gitDir: string) => join(gitDir, 'info', 'exclude');
const excludeText = (gitDir: string) => readFileSync(excludePath(gitDir), 'utf-8');

describe('hideFactoryFromGit: the happy path (AC-010)', () => {
  it('AC-010 it adds .factory/ to .git/info/exclude on a plain repository', async () => {
    repo();

    const result = await hide(project.dir);

    expect(result).toEqual({ kind: 'added' });
    expect(excludeText(join(project.dir, '.git'))).toContain(FACTORY_EXCLUDE_ENTRY);
    expect(FACTORY_EXCLUDE_ENTRY).toBe('.factory/');
  });

  it('AC-010 git really ignores .factory/ afterwards — the entry is not merely written, it works', async () => {
    repo();
    mkdirSync(join(project.dir, '.factory', 'run1'), { recursive: true });
    writeFileSync(join(project.dir, '.factory', 'run1', 'state.json'), '{}\n');

    // Before: the harness's own directory is untracked noise in the operator's status.
    expect(git(project.dir, 'status', '--porcelain')).toContain('.factory/');

    await hide(project.dir);

    expect(git(project.dir, 'status', '--porcelain')).not.toContain('.factory');
  });

  it('AC-010 the entry is LOCAL ONLY: it is written inside .git/ and is never a tracked file', async () => {
    repo();

    await hide(project.dir);

    // Nothing in the working tree changed, so there is nothing that could ever be committed.
    expect(git(project.dir, 'status', '--porcelain').trim()).toBe('');
  });
});

describe('hideFactoryFromGit: idempotence (AC-010)', () => {
  it('AC-010 a SECOND call adds nothing and reports `present`', async () => {
    repo();

    const first = await hide(project.dir);
    const after = excludeText(join(project.dir, '.git'));
    const second = await hide(project.dir);

    expect(first).toEqual({ kind: 'added' });
    expect(second).toEqual({ kind: 'present' });
    expect(excludeText(join(project.dir, '.git'))).toBe(after);
  });

  it('AC-010 a RESUMED run (a third and fourth call) still adds nothing: exactly one entry, ever', async () => {
    repo();

    await hide(project.dir);
    await hide(project.dir);
    await hide(project.dir);
    await hide(project.dir);

    const lines = excludeText(join(project.dir, '.git')).split('\n').filter(line => line.trim() === FACTORY_EXCLUDE_ENTRY);
    expect(lines).toHaveLength(1);
  });

  it.each([
    ['.factory/', 'the same spelling'],
    ['.factory', 'the slashless spelling'],
    ['   .factory/   ', 'a whitespace-surrounded variant'],
    ['\t.factory\t', 'a tab-surrounded slashless variant']
  ])('AC-010 an operator entry of %s (%s) already counts as present: nothing is added', async (entry, _what) => {
    repo();
    const gitDir = join(project.dir, '.git');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(excludePath(gitDir), `# my own rules\n${entry}\n*.tmp\n`);
    const before = excludeText(gitDir);

    const result = await hide(project.dir);

    expect(result).toEqual({ kind: 'present' });
    expect(excludeText(gitDir)).toBe(before);
  });
});

describe('hideFactoryFromGit: the operator\'s own file (AC-010)', () => {
  it("AC-010 the operator's existing entries survive BYTE FOR BYTE and the entry is appended at the end", async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    const mine = '# my notes\n\n*.swp\n!keep.swp\n  spaced-entry  \n';
    writeFileSync(excludePath(gitDir), mine);

    const result = await hide(project.dir);

    expect(result).toEqual({ kind: 'added' });
    // Nothing reordered, nothing deduped, nothing normalised: the original is a strict prefix.
    expect(excludeText(gitDir)).toBe(`${mine}${FACTORY_EXCLUDE_ENTRY}\n`);
  });

  it('AC-010 a file that does NOT end in a newline gets a separator, so the last entry is never joined to ours', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(excludePath(gitDir), '*.swp');

    await hide(project.dir);

    expect(excludeText(gitDir)).toBe(`*.swp\n${FACTORY_EXCLUDE_ENTRY}\n`);
    // The operator's pattern is still its own line, not `*.swp.factory/`.
    expect(excludeText(gitDir).split('\n')).toContain('*.swp');
  });

  it('AC-010 an ABSENT exclude file gets exactly one clean line and no leading blank', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    rmSync(excludePath(gitDir), { force: true });

    await hide(project.dir);

    expect(excludeText(gitDir)).toBe(`${FACTORY_EXCLUDE_ENTRY}\n`);
  });

  it('AC-010 a ZERO-BYTE exclude file gets exactly one clean line and no leading blank', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(excludePath(gitDir), '');

    await hide(project.dir);

    expect(excludeText(gitDir)).toBe(`${FACTORY_EXCLUDE_ENTRY}\n`);
  });

  it('AC-010 an absent info/ directory is created, one level only', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    rmSync(join(gitDir, 'info'), { recursive: true, force: true });

    const result = await hide(project.dir);

    expect(result).toEqual({ kind: 'added' });
    expect(lstatSync(join(gitDir, 'info')).isDirectory()).toBe(true);
  });
});

describe('hideFactoryFromGit: finding the right git directory (AC-010, R8-4)', () => {
  it('AC-010 a project in a SUBDIRECTORY of the repository writes the repository\'s exclude file', async () => {
    repo();
    const sub = join(project.dir, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'index.ts'), 'export {};\n');

    const result = await hide(sub);

    expect(result).toEqual({ kind: 'added' });
    // Never `<sub>/.git`, which does not exist.
    expect(excludeText(join(project.dir, '.git'))).toContain(FACTORY_EXCLUDE_ENTRY);
    expect(lstatSync(join(project.dir, '.git')).isDirectory()).toBe(true);
  });

  it('AC-010 R8-4 a LINKED WORKTREE whose .git is a FILE writes the COMMON git directory, and git honours it there', async () => {
    repo();
    const { dir, commonGitDir } = linkedWorktree(project.dir);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    // The premise of this test: `.git` here is a file, so `cwd + '/.git'` would be wrong.
    expect(lstatSync(join(dir, '.git')).isFile()).toBe(true);

    const result = await hide(dir);

    expect(result).toEqual({ kind: 'added' });
    // `--git-common-dir` is the right choice because git resolves info/exclude through its
    // shared-path list. Read it back rather than trusting the choice (brief OQ-2).
    expect(excludeText(commonGitDir)).toContain(FACTORY_EXCLUDE_ENTRY);

    // The proof that the right file was written: git really ignores .factory IN THE WORKTREE.
    mkdirSync(join(dir, '.factory', 'run1'), { recursive: true });
    writeFileSync(join(dir, '.factory', 'run1', 'state.json'), '{}\n');
    expect(setupGit(dir, ['status', '--porcelain'])).not.toContain('.factory');
  });
});

describe('hideFactoryFromGit: every refusal is a skip, never a stop (AC-010)', () => {
  it('AC-010 OUTSIDE a git work tree it is skipped, nothing is written and nothing throws', async () => {
    // tempProject makes a directory with no repository in it.
    const result = await hide(project.dir);

    expect(result).toEqual({ kind: 'skipped', reason: 'not a git work tree' });
    expect(() => lstatSync(join(project.dir, '.git'))).toThrow();
  });

  it('AC-010 with `info` as a REGULAR FILE it is skipped and the file is left exactly as it was', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    rmSync(join(gitDir, 'info'), { recursive: true, force: true });
    writeFileSync(join(gitDir, 'info'), 'not a directory\n');

    const result = await hide(project.dir);

    expect(result.kind).toBe('skipped');
    expect(readFileSync(join(gitDir, 'info'), 'utf-8')).toBe('not a directory\n');
  });

  it('AC-010 P6 with `exclude` as a SYMLINK it is skipped, the link is NOT followed and the target is untouched', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    rmSync(excludePath(gitDir), { force: true });
    // The attack this refusal exists for: a planted link turning a harness write into a write
    // anywhere the user can write.
    const victim = join(project.dir, 'victim.txt');
    writeFileSync(victim, 'untouched\n');
    symlinkSync(victim, excludePath(gitDir));

    const result = await hide(project.dir);

    expect(result.kind).toBe('skipped');
    expect(readFileSync(victim, 'utf-8')).toBe('untouched\n');
    expect(lstatSync(excludePath(gitDir)).isSymbolicLink()).toBe(true);
  });

  it('AC-010 P6 with `info` as a SYMLINK it is skipped and the link is not followed', async () => {
    repo();
    const gitDir = join(project.dir, '.git');
    rmSync(join(gitDir, 'info'), { recursive: true, force: true });
    const elsewhere = join(project.dir, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(gitDir, 'info'));

    const result = await hide(project.dir);

    expect(result.kind).toBe('skipped');
    expect(() => lstatSync(join(elsewhere, 'exclude'))).toThrow();
  });

  it('AC-010 with a READ-ONLY git directory it is skipped, nothing is written and nothing throws', async () => {
    repo();
    const info = join(project.dir, '.git', 'info');
    mkdirSync(info, { recursive: true });
    rmSync(join(info, 'exclude'), { force: true });
    chmodSync(info, 0o500);
    cleanups.push(() => chmodSync(info, 0o700));

    const result = await hide(project.dir);

    expect(result.kind).toBe('skipped');
    expect(() => lstatSync(join(info, 'exclude'))).toThrow();
  });

  it('AC-010 a git directory that does not exist at all is skipped, not a throw', () => {
    // The writer's own contract, called directly with a directory that is not there.
    const result = addFactoryToExcludeFile(join(project.dir, 'no', 'such', 'gitdir'));

    expect(result.kind).toBe('skipped');
  });
});
