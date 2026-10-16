/**
 * Real-git test helpers, shared by the only two test files that run `git`: change-diff.test.ts and
 * snapshot.test.ts. Both work in temp repositories they create; nothing here touches this repo.
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

/**
 * Run git in `cwd` for test SETUP, isolated from the user's and the caller's git configuration,
 * with a fixed test identity. `env` is applied last (fixed GIT_*_DATE values, for example).
 * `input`, when given, is written to git's stdin (`mktree`, `hash-object --stdin`); otherwise stdin
 * is closed.
 */
export function setupGit(cwd: string, args: string[], env: Record<string, string> = {}, input?: string): string {
  const full: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete full[name];
  Object.assign(full, env);
  return execFileSync(
    'git',
    ['-c', 'user.name=Factory Test', '-c', 'user.email=factory@test.invalid', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      env: full,
      encoding: 'utf8',
      ...(input !== undefined ? { input } : {}),
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe']
    }
  );
}

/** What isolateHarnessGit clears: anything that would let the user's own git setup reach the harness's git. */
const ISOLATED_ENV = [
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'EMAIL'
];

/** Point the harness's git at an empty global config, no system config and no identity; returns the restore. */
export function isolateHarnessGit(): () => void {
  const saved = Object.fromEntries(ISOLATED_ENV.map(name => [name, process.env[name]]));
  const dir = mkdtempSync(join(tmpdir(), 'ff-gitconfig-'));
  const globalConfig = join(dir, 'gitconfig');
  writeFileSync(globalConfig, '');
  for (const name of ISOLATED_ENV) delete process.env[name];
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  return () => {
    for (const name of ISOLATED_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  };
}

/**
 * Write `lines` as the project's `.gitignore` and track it (PR R-1, R8a / AC-009). A trailing
 * newline on every line, so the last pattern is never joined to whatever is appended later.
 */
export function gitignore(cwd: string, lines: string[]): void {
  writeFileSync(join(cwd, '.gitignore'), lines.map(line => `${line}\n`).join(''));
  setupGit(cwd, ['add', '.gitignore']);
}

/**
 * Make `path` both git-TRACKED and git-IGNORED (PR R-1, R8a / AC-009 — the story's named hazard).
 * `-f` is the only way into the index for an ignored path, which is exactly why the snapshot needs
 * its own force-add step to get such a file back out again.
 */
export function trackIgnored(cwd: string, path: string, content: string): void {
  const absolute = join(cwd, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  setupGit(cwd, ['add', '-f', '--', path]);
}

/**
 * A linked worktree of `repo` at a fresh temp directory, whose `.git` is a FILE, not a directory
 * (PR R-1, R8b / AC-010 — risk R8-4). Returns its path and the path of the git directory
 * `info/exclude` really lives in (the COMMON one, which is `repo`'s).
 */
export function linkedWorktree(repo: string, branch = 'ff-linked'): { dir: string; commonGitDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ff-linked-worktree-'));
  // mkdtemp already made it, and `git worktree add` wants to create it itself.
  rmSync(dir, { recursive: true, force: true });
  setupGit(repo, ['worktree', 'add', '-b', branch, dir]);
  return { dir, commonGitDir: join(repo, '.git') };
}
