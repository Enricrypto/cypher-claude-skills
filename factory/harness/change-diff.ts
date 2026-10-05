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
 * ONE CHOKE POINT, AN ALLOW-LIST (AC-45 revised, AC-80). Git is run only by `git()`, with
 * `spawnSync`, no shell, and only the subcommands in two lists: the reads `rev-parse`, `diff` and
 * `ls-files` (GIT_READ_SUBCOMMANDS), and the snapshot plumbing `add`, `write-tree`, `commit-tree` and
 * `update-ref` (GIT_SNAPSHOT_SUBCOMMANDS). The factory never touches your branch, index or working
 * tree, never pushes, and writes git objects only under `refs/factory/<id>/` (built by
 * `factoryRef`, the only place that prefix is spelled).
 *
 * Every call (D-2): external diff drivers, textconv filters and the fsmonitor hook are off; hooks
 * are off (`core.hooksPath=/dev/null`, which a repository's own `core.hooksPath` cannot override,
 * since `-c` wins); no signing; no reflog; no split index; no auto-gc; stdin is closed, so nothing
 * can wait on input; GIT_OPTIONAL_LOCKS=0 stops `diff` from rewriting the index.
 *
 * THE SNAPSHOT (D-3) builds its tree in a temporary index in its own `mkdtemp` directory, never
 * the user's `.git/index`: `git()` itself refuses `add` and `write-tree` unless GIT_INDEX_FILE is
 * `<os.tmpdir()>/factory-snapshot-XXXXXX/index` (see `isSnapshotIndex`). The commit is made by
 * `commit-tree` with the harness's own identity, and the ref is moved by a compare-and-swap
 * `update-ref`.
 *
 * ACCEPTED RISK — filter drivers DO run. Comparing the working tree with the base, `git diff` runs
 * the `clean` (or long-running `process`) filter that a `filter=<driver>` attribute selects, as
 * configured by the user or the repository (git-lfs is the common case). Git has no option that
 * disables filter drivers for `diff` generically: `--attr-source` / GIT_ATTR_SOURCE need git 2.42 /
 * 2.40 and would also drop every other attribute (and so change the diff), and naming each driver
 * (`-c filter.<driver>.clean=`) would need `git config` / `check-attr`, which this module may not
 * run (AC-80). These are the operator's own filters — the ones any `git diff` or `git status` in
 * that repository already runs, and `add` runs them too when a snapshot is written (MINOR-3,
 * accepted). `ls-files` runs none.
 *
 * DETERMINISTIC. The text is built only from the tree and the base, in sorted order, so the same
 * tree gives the same text and the same CP3 hash (AC-50, AC-52).
 *
 * FAILS CLOSED. A base that said git but can no longer be diffed throws ChangeDiffError: CP3 is
 * then not presented, rather than presented with less than the change.
 */

import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { isSafeRunId } from './run-lifecycle';
import { OBJECT_ID } from './state-tracker';
import type { ChangeBase } from './state-tracker';

/** The change CP3 presents. `files` are relative to cwd (absolute only for a claim outside it), sorted. */
export interface ChangeSet {
  source: 'git' | 'claimed-files';
  files: string[];
  text: string;
}

/** HEAD as the snapshot's HEAD check sees it (D-4). `commit` is absent on an unborn branch; `branch` is read only when a commit exists. */
export interface HeadState {
  commit?: string;
  branch?: string;
}

/** What one snapshot attempt did (D-3). Never thrown: every failure is a `failed` value. */
export type SnapshotResult =
  | { kind: 'written'; ref: string; commit: string; tree: string; reused: boolean }
  | { kind: 'head-moved'; recorded: HeadState; current: HeadState }
  | { kind: 'failed'; error: string };

/** The seam the orchestrator takes as `options.changes` (D-8). Tests inject a fake. */
export interface ChangeTracker {
  /** Where the change starts, captured once at the start of a fresh run (with branch and pre-existing paths). Never throws. */
  captureBase(cwd: string): Promise<ChangeBase>;
  /** The change since `base`. Throws ChangeDiffError when a git base can no longer be diffed. */
  collect(cwd: string, base: ChangeBase, claimedFiles: string[]): Promise<ChangeSet>;
  /**
   * Write the working tree as CP3 sees it to `refs/factory/<runId>/stage3-<n>` (D-3), after checking
   * that HEAD has not moved since `base` (D-4). Never throws; never touches the branch, the index or
   * the working tree. An unchanged tree with the same parent reuses the existing commit.
   */
  snapshot(cwd: string, base: ChangeBase, runId: string, n: number): Promise<SnapshotResult>;
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

/** The read-only subcommands (AC-80): the CP3 change and the run-start base. */
export const GIT_READ_SUBCOMMANDS = ['rev-parse', 'diff', 'ls-files'] as const;
/** The snapshot plumbing (AC-80, D-3). `add` and `write-tree` only ever touch a temporary index. */
export const GIT_SNAPSHOT_SUBCOMMANDS = ['add', 'write-tree', 'commit-tree', 'update-ref'] as const;
/** The ONLY git subcommands this module may run (AC-80). */
type GitSubcommand = (typeof GIT_READ_SUBCOMMANDS)[number] | (typeof GIT_SNAPSHOT_SUBCOMMANDS)[number];

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([...GIT_READ_SUBCOMMANDS, ...GIT_SNAPSHOT_SUBCOMMANDS]);

/** The subcommands that write an index: they must carry the snapshot's temporary GIT_INDEX_FILE. */
const WRITES_AN_INDEX: ReadonlySet<string> = new Set(['add', 'write-tree']);

/**
 * Every call (D-2): no fsmonitor hook, no locale-dependent path quoting, no hook of any kind (git
 * looks for `/dev/null/<hook>`, which can never exist), no signing, no reflog for the refs it
 * writes, no `sharedindex.*` file, no auto-maintenance. (External diff and textconv are switched
 * off by `diff`'s own options; filter drivers are not — see ACCEPTED RISK above.)
 */
const SAFE_GIT_CONFIG = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotePath=true',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgSign=false',
  '-c', 'core.logAllRefUpdates=false',
  '-c', 'core.splitIndex=false',
  '-c', 'gc.auto=0'
];

/** The snapshot's temporary directory: `<os.tmpdir()>/factory-snapshot-XXXXXX`, holding only `index`. */
export const SNAPSHOT_TMP_PREFIX = 'factory-snapshot-';

/** The identity of every snapshot commit (I-23, I-24): never the user's, so none is needed. */
const HARNESS_IDENTITY = {
  GIT_AUTHOR_NAME: 'Feature Factory',
  GIT_AUTHOR_EMAIL: 'feature-factory@localhost.invalid',
  GIT_COMMITTER_NAME: 'Feature Factory',
  GIT_COMMITTER_EMAIL: 'feature-factory@localhost.invalid'
};

/** Pathspec: the whole of cwd, except the harness's own directory. */
const PATHSPEC = ['--', '.', ':(exclude).factory'];

export type GitResult = { ok: true; stdout: string } | { ok: false; error: string };

/**
 * The snapshot index guard's rule (D-2): an absolute path named `index` whose directory is a real
 * directory (not a symlink) directly inside `os.tmpdir()` and named `factory-snapshot-…`, which is
 * exactly what `snapshot()`'s `mkdtempSync(join(tmpdir(), SNAPSHOT_TMP_PREFIX))` creates. The user's
 * `.git/index` can never satisfy it.
 */
function isSnapshotIndex(path: string | undefined): boolean {
  if (typeof path !== 'string' || !isAbsolute(path) || basename(path) !== 'index') return false;
  const dir = dirname(path);
  if (dirname(dir) !== resolve(tmpdir()) || !basename(dir).startsWith(SNAPSHOT_TMP_PREFIX)) return false;
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The ONLY function that spawns git (AC-80). `env` is applied last, over the cleaned environment.
 *
 * Throws (a programming error, not a git failure) for a subcommand outside the allow-list, and for
 * `add` or `write-tree` without the snapshot's temporary GIT_INDEX_FILE: a slip there would write
 * the user's `.git/index`. Exported for tests only; no production file outside this module calls
 * it (a repo-hygiene guard checks that).
 */
export function git(cwd: string, subcommand: GitSubcommand, args: string[], extraEnv?: Record<string, string>): GitResult {
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`Refused: ${JSON.stringify(subcommand)} is not on the allow-list of git subcommands.`);
  }
  if (WRITES_AN_INDEX.has(subcommand) && !isSnapshotIndex(extraEnv?.GIT_INDEX_FILE)) {
    throw new Error(
      `Refused: git ${subcommand} must run with GIT_INDEX_FILE set to the index in the snapshot's own temporary ` +
        `directory (${join(tmpdir(), `${SNAPSHOT_TMP_PREFIX}XXXXXX`, 'index')}), never the repository's index.`
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  // The change is about `cwd`: a caller's GIT_DIR (a git hook running `npm test`, say) must not
  // point git somewhere else. Nor may the caller's environment change how pathspecs match (with
  // GIT_LITERAL_PATHSPECS, `:(exclude).factory` would be a literal path) or where refs go
  // (GIT_NAMESPACE). The force-add sets GIT_LITERAL_PATHSPECS itself, through `extraEnv` (MINOR-5).
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_LITERAL_PATHSPECS',
    'GIT_GLOB_PATHSPECS',
    'GIT_NOGLOB_PATHSPECS',
    'GIT_ICASE_PATHSPECS',
    'GIT_NAMESPACE'
  ]) {
    delete env[name];
  }
  Object.assign(env, extraEnv);

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

/**
 * The private ref of one snapshot (AC-80, D-3): `refs/factory/<runId>/<name>`. The ONLY place the
 * `refs/factory/` prefix is spelled in production code. Throws unless the run id is a safe run id
 * that git accepts as a ref component (no trailing `.lock` or `.`) and the name is `stage3-<n>`
 * with n a positive integer.
 */
export function factoryRef(runId: string, name: string): string {
  if (!isSafeRunId(runId) || runId.endsWith('.lock') || runId.endsWith('.')) {
    throw new Error(`${JSON.stringify(runId)} is not a valid run id for a snapshot ref.`);
  }
  if (typeof name !== 'string' || !/^stage3-[1-9]\d*$/.test(name)) {
    throw new Error(`${JSON.stringify(name)} is not a valid snapshot name (stage3-<n>, with n a positive integer).`);
  }
  return `refs/factory/${runId}/${name}`;
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

/** `git diff`'s options for the CP3 change: no colour, no external diff or textconv, no rename pairing, paths relative to cwd. */
const DIFF_OPTIONS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative'];

/** HEAD's commit, or undefined on an unborn branch (`--verify --quiet` fails silently there). */
function headCommit(cwd: string): string | undefined {
  const head = git(cwd, 'rev-parse', ['--verify', '--quiet', 'HEAD^{commit}']);
  return head.ok && OBJECT_ID.test(head.stdout.trim()) ? head.stdout.trim() : undefined;
}

/** HEAD as the snapshot's HEAD check compares it (D-4): the branch is read only when a commit exists (I-6). */
function headState(cwd: string): HeadState {
  const commit = headCommit(cwd);
  if (commit === undefined) return {};
  const branch = git(cwd, 'rev-parse', ['--symbolic-full-name', 'HEAD']);
  return branch.ok && branch.stdout.trim().length > 0 ? { commit, branch: branch.stdout.trim() } : { commit };
}

/**
 * The paths already changed or untracked at run start (D-6), read-only and sorted unique: with a
 * commit, what `git diff <HEAD>` lists plus the untracked files; on an unborn branch, the index plus
 * the untracked files. Undefined when git cannot say ("unknown").
 */
function preExistingPaths(cwd: string, commit: string | undefined): string[] | undefined {
  const listed =
    commit === undefined
      ? git(cwd, 'ls-files', ['--cached', '-z', ...PATHSPEC])
      : git(cwd, 'diff', [...DIFF_OPTIONS, '--name-only', '-z', commit, ...PATHSPEC]);
  const untracked = git(cwd, 'ls-files', ['--others', '--exclude-standard', '-z', ...PATHSPEC]);
  if (!listed.ok || !untracked.ok) return undefined;
  return sortedUnique([...nulSeparated(listed.stdout), ...nulSeparated(untracked.stdout)]);
}

async function captureBase(cwd: string): Promise<ChangeBase> {
  const inside = git(cwd, 'rev-parse', ['--is-inside-work-tree']);
  if (!inside.ok) return { kind: 'none', reason: `not a git work tree (${inside.error})` };
  if (inside.stdout.trim() !== 'true') return { kind: 'none', reason: 'not a git work tree (inside a .git directory)' };

  const { commit, branch } = headState(cwd);
  const preExisting = preExistingPaths(cwd, commit);
  return {
    kind: 'git',
    ...(commit !== undefined ? { commit } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(preExisting !== undefined ? { preExisting } : {})
  };
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

  const diff = gitOrThrow(cwd, 'diff', [...DIFF_OPTIONS, commit, ...PATHSPEC]);
  const changed = nulSeparated(gitOrThrow(cwd, 'diff', [...DIFF_OPTIONS, '--name-only', '-z', commit, ...PATHSPEC]));
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

/** Tracked-but-ignored paths are force-added in chunks of this many, to keep each argv bounded. */
const FORCE_ADD_CHUNK = 500;

/** One git step of the snapshot. A failure throws git's first stderr line, which becomes `failed.error`. */
function snapshotStep(cwd: string, subcommand: GitSubcommand, args: string[], env?: Record<string, string>): string {
  const result = git(cwd, subcommand, args, env);
  if (!result.ok) throw new Error(result.error);
  return result.stdout;
}

/** `rev-parse --verify --quiet <spec>`: the object id, or undefined when it does not resolve. */
function resolveQuietly(cwd: string, spec: string): string | undefined {
  const result = git(cwd, 'rev-parse', ['--verify', '--quiet', spec]);
  const id = result.ok ? result.stdout.trim() : '';
  return OBJECT_ID.test(id) ? id : undefined;
}

/**
 * D-3 steps 1-10. Every failure, including a refused ref name, becomes `failed`: this never throws.
 * The order matters: the HEAD check runs before any object is written, and the temporary
 * directory is always removed.
 */
async function snapshot(cwd: string, base: ChangeBase, runId: string, n: number): Promise<SnapshotResult> {
  if (base.kind !== 'git') return { kind: 'failed', error: `the run has no git base (${base.reason})` };

  let tmp: string | undefined;
  try {
    const ref = factoryRef(runId, `stage3-${n}`);

    // 1. Still a work tree.
    const inside = git(cwd, 'rev-parse', ['--is-inside-work-tree']);
    if (!inside.ok || inside.stdout.trim() !== 'true') {
      return { kind: 'failed', error: `${cwd} is no longer a git work tree${inside.ok ? '' : ` (${inside.error})`}` };
    }

    // 2. The HEAD check (D-4), before anything is written. A base without a branch (recorded
    //    before B-1, or on an unborn branch) compares the commit only.
    const recorded: HeadState = {
      ...(base.commit !== undefined ? { commit: base.commit } : {}),
      ...(base.branch !== undefined ? { branch: base.branch } : {})
    };
    const current = headState(cwd);
    if (recorded.commit !== current.commit || (recorded.branch !== undefined && recorded.branch !== current.branch)) {
      return { kind: 'head-moved', recorded, current };
    }

    // 3. The project's path inside the repository; empty at the top level.
    const prefix = snapshotStep(cwd, 'rev-parse', ['--show-prefix']).replace(/\n$/, '');

    // 4. A temporary index outside the repository. It does not exist yet: git reads that as empty.
    tmp = mkdtempSync(join(tmpdir(), SNAPSHOT_TMP_PREFIX));
    const index = { GIT_INDEX_FILE: join(tmp, 'index') };

    // 5. Every non-ignored file in the project, tracked or untracked, except .factory/.
    snapshotStep(cwd, 'add', ['-A', ...PATHSPEC], index);

    // 6. Tracked-but-ignored files, as the user's index lists them (read-only), if they still exist.
    const trackedIgnored = nulSeparated(
      snapshotStep(cwd, 'ls-files', ['--cached', '-i', '--exclude-standard', '-z', ...PATHSPEC])
    ).filter(path => {
      try {
        lstatSync(resolve(cwd, path));
        return true;
      } catch {
        return false;
      }
    });
    for (let i = 0; i < trackedIgnored.length; i += FORCE_ADD_CHUNK) {
      // Literal pathspecs: a path such as `:x` or `*.log` names that one file, never a pattern.
      snapshotStep(cwd, 'add', ['-f', '--', ...trackedIgnored.slice(i, i + FORCE_ADD_CHUNK)], {
        ...index,
        GIT_LITERAL_PATHSPECS: '1'
      });
    }

    // 7. The tree, rooted at the project directory. An empty project has no `<prefix>` subtree to
    //    pick, and the whole of an empty index is the empty tree.
    const empty = snapshotStep(cwd, 'ls-files', ['--cached', '-z'], index).length === 0;
    const tree = snapshotStep(cwd, 'write-tree', prefix.length > 0 && !empty ? [`--prefix=${prefix}`] : [], index).trim();

    // 8. Reuse an identical commit (same tree, same parent); otherwise commit and compare-and-swap.
    const existing = resolveQuietly(cwd, `${ref}^{commit}`);
    if (
      existing !== undefined &&
      resolveQuietly(cwd, `${existing}^{tree}`) === tree &&
      resolveQuietly(cwd, `${existing}^1`) === current.commit
    ) {
      return { kind: 'written', ref, commit: existing, tree, reused: true };
    }

    const commit = snapshotStep(
      cwd,
      'commit-tree',
      [
        '--no-gpg-sign',
        ...(current.commit !== undefined ? ['-p', current.commit] : []),
        '-m',
        `Feature Factory snapshot ${runId} stage3-${n}`,
        tree
      ],
      HARNESS_IDENTITY
    ).trim();
    // An empty old value means "the ref must not exist": a concurrent writer makes this fail.
    snapshotStep(cwd, 'update-ref', [ref, commit, existing ?? '']);
    return { kind: 'written', ref, commit, tree, reused: false };
  } catch (error) {
    // 10. git's first stderr line, or the refusal's own message.
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    // 9. The harness's own temporary directory, not a run artifact.
    if (tmp !== undefined) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* never let cleanup turn a result into a throw */
      }
    }
  }
}

/** The real tracker. Production never passes `changes`, so this is what runs. */
export const DEFAULT_CHANGE_TRACKER: Readonly<ChangeTracker> = Object.freeze({ captureBase, collect, snapshot });
