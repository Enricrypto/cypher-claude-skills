/**
 * The change a human approves at CHECKPOINT 3 (A-2, D-8, I-4).
 *
 * CP3 presents the validated change itself, not an agent's account of it. "The change" is:
 *
 *  - inside a git work tree: `git diff <HEAD at run start>` over the working tree (so committed and
 *    uncommitted changes alike), plus every untracked, non-ignored file, with `<cwd>/.factory/`
 *    excluded. Changes that were already uncommitted when the run started appear too (I-4,
 *    documented). With no commit at run start, every file in the index or untracked is new;
 *  - outside git (or with git missing): a manifest of the files the builders CLAIMED, each with its
 *    size, sha256 and text, and a label saying plainly that it is not a git diff.
 *
 * READ-ONLY BY CONSTRUCTION. Git is run with `spawnSync`, no shell, and only three subcommands:
 * `rev-parse`, `diff` and `ls-files` (AC-45: the factory never commits, pushes or opens a PR).
 * External diff drivers, textconv filters and the fsmonitor hook are switched off, and
 * GIT_OPTIONAL_LOCKS=0 stops `diff` from rewriting the index.
 *
 * ACCEPTED RISK — filter drivers DO run. Comparing the working tree with the base, `git diff` runs
 * the `clean` (or long-running `process`) filter that a `filter=<driver>` attribute selects, as
 * configured by the user or the repository (git-lfs is the common case). Git has no option that
 * disables filter drivers for `diff` generically: `--attr-source` / GIT_ATTR_SOURCE need git 2.42 /
 * 2.40 and would also drop every other attribute (and so change the diff), and naming each driver
 * (`-c filter.<driver>.clean=`) would need `git config` / `check-attr`, which this module may not
 * run (AC-45). These are the operator's own filters — the ones any `git diff` or `git status` in
 * that repository already runs. `ls-files` runs none.
 *
 * DETERMINISTIC. The text is built only from the tree and the base, in sorted order, so the same
 * tree gives the same text and the same CP3 hash (AC-50, AC-52).
 *
 * FAILS CLOSED. A base that said git but can no longer be diffed throws ChangeDiffError: CP3 is
 * then not presented, rather than presented with less than the change.
 */

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

import type { ChangeBase } from './state-tracker';

/** The change CP3 presents. `files` are relative to cwd (absolute only for a claim outside it), sorted. */
export interface ChangeSet {
  source: 'git' | 'claimed-files';
  files: string[];
  text: string;
}

/** The seam the orchestrator takes as `options.changes` (D-8). Tests inject a fake. */
export interface ChangeTracker {
  /** Where the change starts, captured once at the start of a fresh run. Never throws. */
  captureBase(cwd: string): Promise<ChangeBase>;
  /** The change since `base`. Throws ChangeDiffError when a git base can no longer be diffed. */
  collect(cwd: string, base: ChangeBase, claimedFiles: string[]): Promise<ChangeSet>;
}

/** The change could not be collected; CP3 cannot be presented. */
export class ChangeDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeDiffError';
  }
}

/** A file larger than this is bound by its hash only; its content is not inlined. */
export const MAX_INLINE_BYTES = 256 * 1024;

/** Enough for any realistic diff; past it git's output is refused, never truncated. */
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

/** The ONLY git subcommands this module may run (AC-45). */
type GitSubcommand = 'rev-parse' | 'diff' | 'ls-files';

/**
 * Every call: no fsmonitor hook, no locale-dependent path quoting. (External diff and textconv are
 * switched off by `diff`'s own options; filter drivers are not — see ACCEPTED RISK above.)
 */
const SAFE_GIT_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true'];

/** Pathspec: the whole of cwd, except the harness's own directory. */
const PATHSPEC = ['--', '.', ':(exclude).factory'];

/** A full SHA-1 or SHA-256 object id. Anything else from state.json is refused before git sees it. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type GitResult = { ok: true; stdout: string } | { ok: false; error: string };

function git(cwd: string, subcommand: GitSubcommand, args: string[]): GitResult {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  // The change is about `cwd`: a caller's GIT_DIR (a git hook running `npm test`, say) must not
  // point git somewhere else.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete env[name];
  }

  const result = spawnSync('git', [...SAFE_GIT_CONFIG, subcommand, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim().split('\n')[0];
    return { ok: false, error: stderr || `git ${subcommand} exited with code ${String(result.status)}` };
  }
  return { ok: true, stdout: result.stdout ?? '' };
}

function gitOrThrow(cwd: string, subcommand: GitSubcommand, args: string[]): string {
  const result = git(cwd, subcommand, args);
  if (!result.ok) throw new ChangeDiffError(`The CP3 change could not be collected: git ${subcommand} failed: ${result.error}`);
  return result.stdout;
}

/** NUL-separated paths (`-z`), in code-unit order. */
function nulSeparated(stdout: string): string[] {
  return stdout.split('\0').filter(path => path.length > 0);
}

const sortedUnique = (paths: Iterable<string>): string[] => [...new Set(paths)].sort();

/** A fence longer than any backtick run in `content`, so the content cannot close it. */
function fenced(content: string, info = ''): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map(m => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`;
}

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * One file's block: path, size and sha256 (which bind its content whatever is shown), then the
 * text when it is text and small enough. A symlink is described, never followed, and a file that
 * resolves outside the project (through a symlinked directory) is never read.
 */
function describeFile(cwd: string, path: string): string {
  const absolute = resolve(cwd, path);
  if (!within(resolve(cwd), absolute)) return `#### ${path}\n\n(outside the project; not read)`;

  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    return `#### ${path}\n\n(missing)`;
  }

  if (stat.isSymbolicLink()) {
    let target = '(unreadable)';
    try {
      target = readlinkSync(absolute);
    } catch {
      /* described as unreadable */
    }
    return `#### ${path}\n\n(symlink to ${target}; not followed)`;
  }
  if (!stat.isFile()) return `#### ${path}\n\n(not a regular file)`;

  // A directory on the way may be a symlink: the file must really live inside the project.
  try {
    if (!within(realpathSync(cwd), realpathSync(absolute))) return `#### ${path}\n\n(resolves outside the project; not read)`;
  } catch {
    return `#### ${path}\n\n(unreadable)`;
  }

  let content: Buffer;
  try {
    content = readFileSync(absolute);
  } catch {
    return `#### ${path}\n\n(unreadable)`;
  }

  const header = `#### ${path} (${content.length} bytes, sha256 ${createHash('sha256').update(content).digest('hex')})`;
  if (content.includes(0)) return `${header}\n\n(binary; content not shown)`;
  if (content.length > MAX_INLINE_BYTES) return `${header}\n\n(larger than ${MAX_INLINE_BYTES} bytes; content not shown)`;
  return `${header}\n\n${fenced(content.toString('utf8'))}`;
}

function fileList(title: string, files: string[]): string {
  return `${title} (${files.length}):\n${files.length > 0 ? files.map(f => `- ${f}`).join('\n') : '(none)'}`;
}

async function captureBase(cwd: string): Promise<ChangeBase> {
  const inside = git(cwd, 'rev-parse', ['--is-inside-work-tree']);
  if (!inside.ok) return { kind: 'none', reason: `not a git work tree (${inside.error})` };
  if (inside.stdout.trim() !== 'true') return { kind: 'none', reason: 'not a git work tree (inside a .git directory)' };

  const head = git(cwd, 'rev-parse', ['--verify', '--quiet', 'HEAD^{commit}']);
  // --verify --quiet fails silently on an unborn branch: a repository with no commit yet.
  return head.ok && OBJECT_ID.test(head.stdout.trim()) ? { kind: 'git', commit: head.stdout.trim() } : { kind: 'git' };
}

function collectGit(cwd: string, commit: string | undefined): ChangeSet {
  const inside = git(cwd, 'rev-parse', ['--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw new ChangeDiffError(
      `The CP3 change could not be collected: the run started in a git work tree, but ${cwd} is no longer one` +
        `${inside.ok ? '' : ` (${inside.error})`}.`
    );
  }

  if (commit === undefined) {
    // No commit at run start: there is nothing to diff against, so everything is new.
    const tracked = nulSeparated(gitOrThrow(cwd, 'ls-files', ['--cached', '-z', ...PATHSPEC]));
    const untracked = nulSeparated(gitOrThrow(cwd, 'ls-files', ['--others', '--exclude-standard', '-z', ...PATHSPEC]));
    const files = sortedUnique([...tracked, ...untracked]);
    const text = [
      'Base: no commit (the repository had no commit when the run started), so every file in the index or untracked is new. .factory/ is excluded.',
      fileList('Files in the change', files),
      `### New files (${files.length})`,
      ...files.map(path => describeFile(cwd, path))
    ].join('\n\n');
    return { source: 'git', files, text: `${text}\n` };
  }

  if (!OBJECT_ID.test(commit)) {
    throw new ChangeDiffError(`The CP3 change could not be collected: the recorded base ${JSON.stringify(commit)} is not a commit id.`);
  }
  gitOrThrow(cwd, 'rev-parse', ['--verify', '--quiet', `${commit}^{commit}`]);

  const diffOptions = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative'];
  const diff = gitOrThrow(cwd, 'diff', [...diffOptions, commit, ...PATHSPEC]);
  const changed = nulSeparated(gitOrThrow(cwd, 'diff', [...diffOptions, '--name-only', '-z', commit, ...PATHSPEC]));
  const untracked = sortedUnique(
    nulSeparated(gitOrThrow(cwd, 'ls-files', ['--others', '--exclude-standard', '-z', ...PATHSPEC]))
  );
  const files = sortedUnique([...changed, ...untracked]);

  const text = [
    `Base: ${commit} (the git HEAD when the run started). Every change since then is shown, committed or not, including changes that were already uncommitted when the run started. .factory/ is excluded.`,
    fileList('Files in the change', files),
    '### Tracked changes',
    diff.length > 0 ? fenced(diff, 'diff') : '(no tracked changes)',
    `### Untracked files (${untracked.length})`,
    ...(untracked.length > 0 ? untracked.map(path => describeFile(cwd, path)) : ['(none)'])
  ].join('\n\n');
  return { source: 'git', files, text: `${text}\n` };
}

function collectClaimed(cwd: string, reason: string, claimedFiles: string[]): ChangeSet {
  const root = resolve(cwd);
  const files = sortedUnique(
    claimedFiles
      .filter(path => typeof path === 'string' && path.trim().length > 0)
      .map(path => {
        const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
        return within(root, absolute) ? relative(root, absolute) : absolute;
      })
  );

  const text = [
    `NOT A GIT DIFF: ${reason}. These are the files the builders claimed, with their current size, sha256 and content. Nothing here shows what changed in them, or any file they changed without claiming it.`,
    fileList('Files claimed', files),
    `### Claimed files (${files.length})`,
    ...(files.length > 0 ? files.map(path => describeFile(root, path)) : ['(none)'])
  ].join('\n\n');
  return { source: 'claimed-files', files, text: `${text}\n` };
}

async function collect(cwd: string, base: ChangeBase, claimedFiles: string[]): Promise<ChangeSet> {
  if (base.kind === 'git') return collectGit(cwd, base.commit);
  return collectClaimed(cwd, base.reason, claimedFiles);
}

/** The real tracker. Production never passes `changes`, so this is what runs. */
export const DEFAULT_CHANGE_TRACKER: Readonly<ChangeTracker> = Object.freeze({ captureBase, collect });
