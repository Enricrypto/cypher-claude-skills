/**
 * Real-git test helpers, shared by the only two test files that run `git`: change-diff.test.ts and
 * snapshot.test.ts. Both work in temp repositories they create; nothing here touches this repo.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Run git in `cwd` for test SETUP, isolated from the user's and the caller's git configuration,
 * with a fixed test identity. `env` is applied last (fixed GIT_*_DATE values, for example).
 */
export function setupGit(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const full: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete full[name];
  Object.assign(full, env);
  return execFileSync(
    'git',
    ['-c', 'user.name=Factory Test', '-c', 'user.email=factory@test.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: full, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
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
