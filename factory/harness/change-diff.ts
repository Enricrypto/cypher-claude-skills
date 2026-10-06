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
 * `spawnSync`, no shell, and only the subcommands in three lists: the reads `rev-parse`, `diff` and
 * `ls-files` (GIT_READ_SUBCOMMANDS); the snapshot plumbing `add`, `write-tree`, `commit-tree` and
 * `update-ref` (GIT_SNAPSHOT_SUBCOMMANDS); and the review copy's extraction `ls-tree` and `cat-file`
 * (GIT_EXTRACTION_SUBCOMMANDS, B-2 D-1), which only read objects. The factory never touches your
 * branch, index or working tree, never pushes, and writes git refs only under `refs/factory/<id>/`
 * (built by `factoryRef`, the only place that prefix is spelled).
 *
 * Every call (D-2): external diff drivers, textconv filters and the fsmonitor hook are off; hooks
 * are off (`core.hooksPath=/dev/null`, which a repository's own `core.hooksPath` cannot override,
 * since `-c` wins); no signing; no reflog; no split index; no auto-gc; stdin is closed unless the
 * caller passes `input` (only `cat-file --batch` does), which is written and then closed, so nothing
 * can wait on input; GIT_OPTIONAL_LOCKS=0 stops `diff` from rewriting the index. Output is read as
 * raw bytes; `stdout` is their UTF-8 decoding, exactly what a `utf8` spawn gave before B-2.
 *
 * THE SNAPSHOT (D-3) builds its tree in a temporary index in its own `mkdtemp` directory, never
 * the user's `.git/index`: `git()` itself refuses `add` and `write-tree` unless GIT_INDEX_FILE is
 * `<os.tmpdir()>/factory-snapshot-XXXXXX/index` (see `isSnapshotIndex`). The commit is made by
 * `commit-tree` with the harness's own identity, and the ref is moved by a compare-and-swap
 * `update-ref`.
 *
 * THE REVIEW COPY (B-2 D-1, AC-117). `extractSnapshot` writes a recorded snapshot's tree into an
 * empty directory outside the project: `ls-tree -r -z -l --full-tree` on the recorded tree, then
 * the blobs' raw bytes from `cat-file --batch` (stdin), each checked against its object id. No
 * filter, attribute or checkout runs (`git archive` would apply export attributes; a worktree is
 * never used). Every path is validated before anything is written, and symlinks are created last,
 * after every file and directory, so no write can pass through a link the copy holds.
 *
 * THE MEASUREMENT (B-2 D-2, AC-121). `changedSince` builds the tree of the working tree now, as a
 * snapshot does (`workingTree`, shared), and lists the paths that differ from a snapshot's tree.
 * Both trees are rooted at the project directory, so the diff is never `--relative`.
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
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs';
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

/** What one extraction did (B-2 D-1). Never thrown: every failure is a `failed` value. `entries` counts the tree's leaves (files, symlinks, gitlinks). */
export type ExtractResult = { kind: 'extracted'; entries: number } | { kind: 'failed'; error: string };

/** The working tree's git tree id (IMPORTANT-1), the Test Verifier's measurement baseline. Never thrown. */
export type WorkingTreeId = { kind: 'tree'; tree: string } | { kind: 'failed'; error: string };

/** What the measurement found (B-2 D-2). Never thrown. `files` are project-relative and sorted. */
export type ChangedFiles = { kind: 'files'; files: string[] } | { kind: 'failed'; error: string };

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
  /**
   * Write the tree of a recorded snapshot into `dest`, an existing empty real directory (B-2 D-1):
   * only after checking that `snap.ref` still points at `snap.commit`, whose tree is `snap.tree`.
   * Byte-identical files with their exec bit, symlinks as links (created last, never followed),
   * gitlinks as empty directories. Never throws; reads objects only.
   */
  extractSnapshot(cwd: string, snap: { ref: string; commit: string; tree: string }, dest: string): Promise<ExtractResult>;
  /**
   * The project-relative paths (added, modified or deleted) where the working tree now differs
   * from the snapshot tree `tree` (B-2 D-2). Never throws; never touches the branch, the index or
   * the working tree, and moves no ref.
   */
  changedSince(cwd: string, tree: string): Promise<ChangedFiles>;
  /**
   * The tree id of the working tree as CP3 sees it, rooted at the project directory (the tree
   * `changedSince` compares against), written as git objects only (IMPORTANT-1): the baseline
   * recorded before the Test Verifier is invoked. Never throws; no commit, no ref, never the
   * user's index.
   */
  workingTreeId(cwd: string): Promise<WorkingTreeId>;
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
/** The review copy's extraction (AC-80, B-2 D-1): list a tree, read its blobs. Both only read objects. */
export const GIT_EXTRACTION_SUBCOMMANDS = ['ls-tree', 'cat-file'] as const;
/** The ONLY git subcommands this module may run (AC-80). */
type GitSubcommand = (typeof GIT_READ_SUBCOMMANDS)[number] | (typeof GIT_SNAPSHOT_SUBCOMMANDS)[number] | (typeof GIT_EXTRACTION_SUBCOMMANDS)[number];

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  ...GIT_READ_SUBCOMMANDS,
  ...GIT_SNAPSHOT_SUBCOMMANDS,
  ...GIT_EXTRACTION_SUBCOMMANDS
]);

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
  '-c', 'gc.auto=0',
  // A repository's diff.relative must never narrow a diff (IMPORTANT-4). A git too old to know
  // the key ignores it, and has no diff.relative to narrow with. The CP3 change asks for
  // `--relative` explicitly, which a command-line option still turns on.
  '-c', 'diff.relative=false'
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

/** `raw` is git's stdout as bytes; `stdout` is its UTF-8 decoding (B-2 D-1). */
export type GitResult = { ok: true; stdout: string; raw: Buffer } | { ok: false; error: string };

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
 *
 * `io.input`, when given, is written to git's stdin, which is then closed (`cat-file --batch`);
 * otherwise stdin is not opened at all.
 */
export function git(
  cwd: string,
  subcommand: GitSubcommand,
  args: string[],
  extraEnv?: Record<string, string>,
  io?: { input?: string }
): GitResult {
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

  const input = io?.input;
  const result = spawnSync('git', [...SAFE_GIT_CONFIG, subcommand, ...args], {
    cwd,
    env,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    // As bytes: with encoding 'buffer', spawnSync cannot decode a string input itself.
    ...(input !== undefined ? { input: Buffer.from(input, 'utf8') } : {}),
    stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe']
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString('utf8').trim().split('\n')[0];
    return { ok: false, error: stderr || `git ${subcommand} exited with code ${String(result.status)}` };
  }
  const raw = result.stdout ?? Buffer.alloc(0);
  return { ok: true, stdout: raw.toString('utf8'), raw };
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

/** One git step of the snapshot or the measurement. A failure throws git's first stderr line, which becomes `failed.error`. */
function snapshotStep(
  cwd: string,
  subcommand: GitSubcommand,
  args: string[],
  env?: Record<string, string>,
  io?: { input?: string }
): Extract<GitResult, { ok: true }> {
  const result = git(cwd, subcommand, args, env, io);
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** `rev-parse --verify --quiet <spec>`: the object id, or undefined when it does not resolve. */
function resolveQuietly(cwd: string, spec: string): string | undefined {
  const result = git(cwd, 'rev-parse', ['--verify', '--quiet', spec]);
  const id = result.ok ? result.stdout.trim() : '';
  return OBJECT_ID.test(id) ? id : undefined;
}

/** Why `cwd` is not (or no longer) a git work tree; undefined when it is one. */
function notAWorkTree(cwd: string): string | undefined {
  const inside = git(cwd, 'rev-parse', ['--is-inside-work-tree']);
  if (inside.ok && inside.stdout.trim() === 'true') return undefined;
  return `${cwd} is no longer a git work tree${inside.ok ? '' : ` (${inside.error})`}`;
}

/**
 * The tree of the working tree as CHECKPOINT 3 sees it (D-3 steps 3-7), rooted at the project
 * directory: every non-ignored file, tracked or untracked, and the tracked-but-ignored files that
 * still exist, never `.factory/`. Built in a temporary index in its own `mkdtemp` directory, which
 * is always removed. It writes git objects only: no commit, no ref, never the user's index. Used by
 * `snapshot` and `changedSince`. Throws git's first stderr line on failure.
 */
function workingTree(cwd: string): string {
  // 3. The project's path inside the repository; empty at the top level.
  const prefix = snapshotStep(cwd, 'rev-parse', ['--show-prefix']).stdout.replace(/\n$/, '');

  // 4. A temporary index outside the repository. It does not exist yet: git reads that as empty.
  const tmp = mkdtempSync(join(tmpdir(), SNAPSHOT_TMP_PREFIX));
  try {
    const index = { GIT_INDEX_FILE: join(tmp, 'index') };

    // 5. Every non-ignored file in the project, tracked or untracked, except .factory/.
    snapshotStep(cwd, 'add', ['-A', ...PATHSPEC], index);

    // 6. Tracked-but-ignored files, as the user's index lists them (read-only), if they still exist.
    const trackedIgnored = nulSeparated(
      snapshotStep(cwd, 'ls-files', ['--cached', '-i', '--exclude-standard', '-z', ...PATHSPEC]).stdout
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
    const empty = snapshotStep(cwd, 'ls-files', ['--cached', '-z'], index).stdout.length === 0;
    return snapshotStep(cwd, 'write-tree', prefix.length > 0 && !empty ? [`--prefix=${prefix}`] : [], index).stdout.trim();
  } finally {
    // 9. The harness's own temporary directory, not a run artifact.
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* never let cleanup turn a result into a throw */
    }
  }
}

/**
 * D-3 steps 1-10. Every failure, including a refused ref name, becomes `failed`: this never throws.
 * The order matters: the HEAD check runs before any object is written, and the temporary
 * directory is always removed (by `workingTree`).
 */
async function snapshot(cwd: string, base: ChangeBase, runId: string, n: number): Promise<SnapshotResult> {
  if (base.kind !== 'git') return { kind: 'failed', error: `the run has no git base (${base.reason})` };

  try {
    const ref = factoryRef(runId, `stage3-${n}`);

    // 1. Still a work tree.
    const gone = notAWorkTree(cwd);
    if (gone !== undefined) return { kind: 'failed', error: gone };

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

    // 3-7 (and 9). The tree of the working tree, rooted at the project directory.
    const tree = workingTree(cwd);

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
    ).stdout.trim();
    // An empty old value means "the ref must not exist": a concurrent writer makes this fail.
    snapshotStep(cwd, 'update-ref', [ref, commit, existing ?? '']);
    return { kind: 'written', ref, commit, tree, reused: false };
  } catch (error) {
    // 10. git's first stderr line, or the refusal's own message.
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * `git diff`'s options for the measurement (B-2 D-2): two trees, both rooted at the project
 * directory, so never `--relative`. A repository's `diff.relative` (which would drop every path
 * from a subdirectory) is overridden by SAFE_GIT_CONFIG's `diff.relative=false` on every call,
 * which needs no minimum git version (IMPORTANT-4); `--ignore-submodules=none` overrides a
 * repository's `diff.ignoreSubmodules` (which would hide a changed gitlink).
 */
const TREE_DIFF_OPTIONS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none'];

/** B-2 D-2. Never throws: every failure is `failed`. Writes git objects only (the measurement's tree). */
async function changedSince(cwd: string, tree: string): Promise<ChangedFiles> {
  try {
    if (typeof tree !== 'string' || !OBJECT_ID.test(tree)) {
      return { kind: 'failed', error: `${JSON.stringify(tree)} is not a tree id` };
    }
    const gone = notAWorkTree(cwd);
    if (gone !== undefined) return { kind: 'failed', error: gone };
    if (resolveQuietly(cwd, `${tree}^{tree}`) !== tree) {
      return { kind: 'failed', error: `the snapshot tree ${tree} is not a tree in this repository` };
    }

    const now = workingTree(cwd);
    const listed = snapshotStep(cwd, 'diff', [...TREE_DIFF_OPTIONS, '--name-only', '-z', tree, now]).stdout;
    return { kind: 'files', files: sortedUnique(nulSeparated(listed)) };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** IMPORTANT-1. Never throws: every failure is `failed`. Writes git objects only (the tree). */
async function workingTreeId(cwd: string): Promise<WorkingTreeId> {
  try {
    const gone = notAWorkTree(cwd);
    if (gone !== undefined) return { kind: 'failed', error: gone };
    const tree = workingTree(cwd);
    if (!OBJECT_ID.test(tree)) return { kind: 'failed', error: `git wrote ${JSON.stringify(tree)}, which is not a tree id` };
    return { kind: 'tree', tree };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** A `cat-file --batch` request holds at most this many objects (B-2 D-1)... */
const EXTRACT_BATCH_OBJECTS = 1000;
/** ...and at most this many blob bytes, unless one blob alone is larger (up to MAX_GIT_OUTPUT_BYTES). */
const EXTRACT_BATCH_BYTES = 64 * 1024 * 1024;

/** One leaf of a snapshot tree, as `ls-tree -r -z -l --full-tree` lists it. */
interface TreeLeaf {
  kind: 'file' | 'executable' | 'symlink' | 'gitlink';
  oid: string;
  size: number;
  path: string;
}

/** The only modes a copy holds (D-1 step 4), and whether each is a blob (a gitlink names a commit). Anything else fails. */
const LEAF_MODES: ReadonlyMap<string, { kind: TreeLeaf['kind']; blob: boolean }> = new Map([
  ['100644', { kind: 'file', blob: true }],
  ['100755', { kind: 'executable', blob: true }],
  ['120000', { kind: 'symlink', blob: true }],
  ['160000', { kind: 'gitlink', blob: false }]
] as const);

/** `<mode> SP <type> SP <oid> SP+ <size or -> TAB <path>`; with `-r` (and no `-t`) the type is a blob or, for a gitlink, a commit. */
const LS_TREE_ENTRY = /^(\d{6}) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(-|\d+)\t([\s\S]+)$/;

/** A path that is empty or absolute, or has a segment '', '.', '..' or `.git` in any letter case (D-1 step 3). */
function unsafePath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) return true;
  return path.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || segment.toLowerCase() === '.git');
}

/** Git's object id of `bytes` as a blob: sha1 for a 40-hex id, sha256 for a 64-hex one. */
function blobObjectId(bytes: Buffer, idLength: number): string {
  return createHash(idLength === 64 ? 'sha256' : 'sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** The leaves of `tree`, validated: known modes and types, safe paths, each path once and none inside another. Throws on the first problem. */
function treeLeaves(cwd: string, tree: string): TreeLeaf[] {
  const raw = snapshotStep(cwd, 'ls-tree', ['-r', '-z', '-l', '--full-tree', tree]).raw;
  const leaves: TreeLeaf[] = [];
  let start = 0;
  while (start < raw.length) {
    let end = raw.indexOf(0, start);
    if (end < 0) end = raw.length;
    const record = raw.subarray(start, end);
    start = end + 1;
    const line = record.toString('utf8');
    if (!Buffer.from(line, 'utf8').equals(record)) throw new Error(`the snapshot tree holds a path that is not valid UTF-8: ${JSON.stringify(line)}`);
    const m = LS_TREE_ENTRY.exec(line);
    if (m === null) throw new Error(`unexpected ls-tree entry ${JSON.stringify(line)}`);
    const [, mode, type, oid, size, path] = m;
    const known = LEAF_MODES.get(mode);
    if (known === undefined || known.blob !== (type === 'blob')) throw new Error(`the snapshot tree holds ${JSON.stringify(path)} with mode ${mode} (${type}), which a copy cannot hold`);
    if (unsafePath(path)) throw new Error(`the snapshot tree holds an unsafe path ${JSON.stringify(path)}`);
    if (type === 'blob' && size === '-') throw new Error(`the size of ${JSON.stringify(path)} is unknown`);
    const bytes = size === '-' ? 0 : Number(size);
    if (bytes > MAX_GIT_OUTPUT_BYTES) {
      throw new Error(`${JSON.stringify(path)} (${bytes} bytes) is larger than ${MAX_GIT_OUTPUT_BYTES} bytes, the most git output this module reads`);
    }
    leaves.push({ kind: known.kind, oid, size: bytes, path });
  }

  const paths = new Set<string>();
  for (const { path } of leaves) {
    if (paths.has(path)) throw new Error(`the snapshot tree holds ${JSON.stringify(path)} more than once`);
    paths.add(path);
  }
  for (const { path } of leaves) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/');
      if (paths.has(ancestor)) throw new Error(`the snapshot tree holds ${JSON.stringify(path)} inside another entry, ${JSON.stringify(ancestor)}`);
    }
  }
  return leaves;
}

/** Group the distinct blobs into `cat-file --batch` requests (D-1 step 5). */
function blobBatches(leaves: readonly TreeLeaf[]): Array<Array<{ oid: string; size: number }>> {
  const sizes = new Map<string, number>();
  for (const leaf of leaves) if (leaf.kind !== 'gitlink') sizes.set(leaf.oid, leaf.size);

  const batches: Array<Array<{ oid: string; size: number }>> = [];
  let current: Array<{ oid: string; size: number }> = [];
  let bytes = 0;
  for (const [oid, size] of sizes) {
    if (current.length > 0 && (current.length === EXTRACT_BATCH_OBJECTS || bytes + size > EXTRACT_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push({ oid, size });
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** One `cat-file --batch` request: each blob's raw bytes, checked against its size and object id. Throws on the first problem. */
function fetchBlobs(cwd: string, batch: ReadonlyArray<{ oid: string; size: number }>): Map<string, Buffer> {
  const raw = snapshotStep(cwd, 'cat-file', ['--batch'], undefined, { input: batch.map(b => `${b.oid}\n`).join('') }).raw;
  const blobs = new Map<string, Buffer>();
  let pos = 0;
  for (const { oid, size } of batch) {
    const newline = raw.indexOf(0x0a, pos);
    if (newline < 0) throw new Error(`git cat-file returned no header for ${oid}`);
    const header = raw.toString('utf8', pos, newline);
    if (header === `${oid} missing`) throw new Error(`the snapshot's blob ${oid} is missing from the repository`);
    if (header !== `${oid} blob ${size}`) throw new Error(`git cat-file returned ${JSON.stringify(header)} for the blob ${oid} of ${size} bytes`);
    const start = newline + 1;
    const end = start + size;
    if (end >= raw.length || raw[end] !== 0x0a) throw new Error(`git cat-file returned a truncated blob ${oid}`);
    const bytes = raw.subarray(start, end);
    if (blobObjectId(bytes, oid.length) !== oid) throw new Error(`the content of the blob ${oid} does not match its object id`);
    blobs.set(oid, bytes);
    pos = end + 1;
  }
  if (pos !== raw.length) throw new Error('git cat-file returned more than was asked for');
  return blobs;
}

/**
 * B-2 D-1 steps 1-6 (the seal, step 7, is the review copy's). Never throws: every failure is
 * `failed`. Nothing is written until the snapshot, the destination and every path have been
 * checked; a blob that fails its check stops the extraction before its batch is written (earlier
 * batches stay in `dest`, which the caller then discards). Files first (`wx`, 0644 or 0755), then
 * the gitlinks' empty directories and every symlink's directory, then the symlinks, so no write
 * and no directory creation can pass through a link the copy holds (N-1).
 */
async function extractSnapshot(cwd: string, snap: { ref: string; commit: string; tree: string }, dest: string): Promise<ExtractResult> {
  try {
    const { ref, commit, tree } = (snap ?? {}) as Partial<typeof snap>;
    const validRef = typeof ref === 'string' && ref.length > 0 && !ref.startsWith('-') && !/\s/.test(ref);
    if (!validRef || typeof commit !== 'string' || !OBJECT_ID.test(commit) || typeof tree !== 'string' || !OBJECT_ID.test(tree)) {
      return { kind: 'failed', error: `the recorded snapshot ${JSON.stringify(snap)} is not a valid ref, commit and tree` };
    }

    // The destination: an existing, empty, real directory (never a link to one).
    const target = resolve(dest);
    let stat;
    try {
      stat = lstatSync(target);
    } catch {
      stat = undefined;
    }
    if (stat === undefined || !stat.isDirectory()) {
      return { kind: 'failed', error: `the destination ${target} must be an existing, empty real directory` };
    }
    if (readdirSync(target).length > 0) return { kind: 'failed', error: `the destination ${target} is not empty` };

    // 1. The recorded ref still points at the recorded commit, whose tree is the recorded tree.
    if (resolveQuietly(cwd, `${ref}^{commit}`) !== commit) {
      return { kind: 'failed', error: `the recorded snapshot ref ${ref} no longer points at the recorded commit ${commit}` };
    }
    if (resolveQuietly(cwd, `${commit}^{tree}`) !== tree) {
      return { kind: 'failed', error: `the recorded snapshot commit ${commit} does not have the recorded tree ${tree}` };
    }

    // 2-4. The recorded tree's leaves (never the ref's), every path and mode checked.
    const leaves = treeLeaves(cwd, tree);
    const byOid = new Map<string, TreeLeaf[]>();
    for (const leaf of leaves) byOid.set(leaf.oid, [...(byOid.get(leaf.oid) ?? []), leaf]);

    // 5-6. Blobs in batches; regular files written as each batch arrives, link targets kept.
    const linkTargets = new Map<string, Buffer>();
    for (const batch of blobBatches(leaves)) {
      const blobs = fetchBlobs(cwd, batch);
      for (const [oid, bytes] of blobs) {
        for (const leaf of byOid.get(oid) ?? []) {
          if (leaf.kind === 'symlink') {
            linkTargets.set(leaf.path, Buffer.from(bytes));
            continue;
          }
          if (leaf.kind === 'gitlink') continue;
          const path = join(target, leaf.path);
          const mode = leaf.kind === 'executable' ? 0o755 : 0o644;
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes, { flag: 'wx', mode });
          chmodSync(path, mode);
        }
      }
    }

    // Every remaining directory exists before the first link does.
    for (const leaf of leaves) {
      if (leaf.kind === 'gitlink') mkdirSync(join(target, leaf.path), { recursive: true });
      if (leaf.kind === 'symlink') mkdirSync(dirname(join(target, leaf.path)), { recursive: true });
    }

    // Symlinks last: kept as links (the target is the blob's bytes), never followed.
    for (const leaf of leaves) {
      if (leaf.kind !== 'symlink') continue;
      const linkTarget = linkTargets.get(leaf.path);
      if (linkTarget === undefined) throw new Error(`the target of the symlink ${JSON.stringify(leaf.path)} was not read`);
      symlinkSync(linkTarget, join(target, leaf.path));
    }

    return { kind: 'extracted', entries: leaves.length };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** The real tracker. Production never passes `changes`, so this is what runs. */
export const DEFAULT_CHANGE_TRACKER: Readonly<ChangeTracker> = Object.freeze({
  captureBase,
  collect,
  snapshot,
  extractSnapshot,
  changedSince,
  workingTreeId
});
