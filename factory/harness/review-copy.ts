/**
 * The review copy (B-2 D-3): the read-only directory the main Validator reviews, outside the
 * project. Filesystem only: no git, node built-ins only. The snapshot extraction itself is
 * `ChangeTracker.extractSnapshot` (change-diff.ts); this module makes the directory it extracts
 * into, seals it, checks it on resume, and provides the AC-126 fallback for a run with no
 * snapshot.
 *
 * - createReviewDir: a fresh 0700 mkdtemp directory `factory-review-<runId>-e<e>-XXXXXX` under
 *   the review root (`realpathSync(os.tmpdir())` in production, I-2), returned as a realpath.
 * - copyWorkingTree / compareWithCopy: the AC-126 fallback copy and the D-2 fallback measurement.
 *   Both walk with lstat and never follow a symlink (N-1). Both skip the same paths (I-5): the
 *   top-level `.factory`, and every entry named `.git` or `node_modules` at any depth, compared in
 *   lower case (on a case-insensitive file system `.GIT` IS `.git`; over-matching fails closed).
 * - sealReadOnly: defence in depth only; the enforcement is the agent's read-only tool grant.
 * - leafDigest / copyIntact: the resume check (D-B2-2). A copy is recorded with its LEAF count
 *   (the same thing extractSnapshot's `entries` counts) and a digest of its sorted leaf paths and
 *   types, taken when the copy is made; copyIntact checks both, so one record shape works for
 *   both kinds of copy, and a deletion that leaves its directory empty is seen.
 * - mapReviewPath / insideReviewCopies: paths the Validator reports from inside the copy, and
 *   builder claims that point into a copy (Gate 1, D-15).
 * - reviewRootProblem: the review root must be outside the project (MINOR-6).
 */

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
  Stats,
  symlinkSync,
  writeFileSync
} from 'fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';

import { isSafeRunId } from './run-lifecycle';
import { normalisePath } from './stage-context';

/** Every review directory's name starts with this, then `<runId>-e<e>-`. */
export const REVIEW_DIR_PREFIX = 'factory-review-';

/**
 * The modes a copy is sealed with, owner-only (CRITICAL-1): directories and executables 0500,
 * other files 0400. No group or other bit, so the copy (which in fallback mode can hold a
 * gitignored secret) is not readable by other users even under a world-writable temp root.
 */
const SEALED_DIR_MODE = 0o500;
const SEALED_EXEC_MODE = 0o500;
const SEALED_FILE_MODE = 0o400;

/** The owner's executable bit: what git records as mode 100755, and what the copy keeps. */
const OWNER_EXEC = 0o100;

/** On macOS these top-level paths are symlinks into /private, so a path can be spelled either way. */
const MACOS_PRIVATE_LINKS = ['/var', '/tmp', '/etc'];
const PRIVATE = '/private';

// ---------------------------------------------------------------------------------------------
// Paths

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** `dir`, plus its macOS twin (`/private/var/x` for `/var/x` and back) when it has one. */
function withTwin(dir: string): string[] {
  for (const link of MACOS_PRIVATE_LINKS) {
    if (inside(PRIVATE + link, dir)) return [dir, dir.slice(PRIVATE.length)];
    if (inside(link, dir)) return [dir, PRIVATE + dir];
  }
  return [dir];
}

/** The fallback copy's exclusions (I-5), for an entry `name` at `depth` (0 = directly under the root). */
function excluded(name: string, depth: number): boolean {
  const lower = name.toLowerCase();
  return lower === '.git' || lower === 'node_modules' || (depth === 0 && lower === '.factory');
}

/** Sorted, so every walk is deterministic. */
function namesIn(dir: string): string[] {
  return readdirSync(dir).sort();
}

/** `path` must be an existing real directory (never a link to one). */
function requireRealDirectory(path: string, what: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) throw new Error(`${what} ${path} must be an existing real directory`);
}

// ---------------------------------------------------------------------------------------------
// createReviewDir

/**
 * A fresh, empty, 0700 directory for evaluation `e` of run `runId`, under `root` (created if
 * missing). Returns its realpath. The harness never deletes it.
 */
export function createReviewDir(root: string, runId: string, e: number): string {
  if (!isSafeRunId(runId)) throw new Error(`${JSON.stringify(runId)} is not a valid run id for a review directory`);
  if (!Number.isSafeInteger(e) || e < 0) throw new Error(`${e} is not a valid evaluation number for a review directory`);
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error(`the review root ${JSON.stringify(root)} must be an absolute path`);
  mkdirSync(root, { recursive: true });
  return realpathSync(mkdtempSync(join(root, `${REVIEW_DIR_PREFIX}${runId}-e${e}-`)));
}

// ---------------------------------------------------------------------------------------------
// copyWorkingTree (AC-126)

/**
 * Copy the working tree at `cwd` into `dest`, an existing, empty, real directory (AC-126, N-1):
 * - the I-5 exclusions are skipped;
 * - regular files are copied byte for byte (`wx`), mode 0755 when the owner may execute, else 0644;
 * - directories are recreated, empty ones included;
 * - symlinks are recreated with the same target (readlink + symlink), never followed, and only
 *   after every file and directory exists, so no write can pass through a link the copy holds;
 * - any other type (socket, FIFO, device) is skipped.
 *
 * Returns `leafDigest(dest)` taken right after the copy (D-B2-2): the leaves written and their
 * digest, so `copyIntact(dest, record)` holds right after. Throws on any failure; the caller
 * discards `dest`.
 */
export function copyWorkingTree(cwd: string, dest: string): CopyLeaves {
  const target = resolve(dest);
  requireRealDirectory(target, 'the copy destination');
  if (readdirSync(target).length > 0) throw new Error(`the copy destination ${target} is not empty`);
  const source = realpathSync(cwd);

  const links: Array<{ target: Buffer; path: string }> = [];

  /** Copies `from` into `to`. Any other file type is skipped. */
  const copyDirectory = (from: string, to: string, depth: number): void => {
    for (const name of namesIn(from)) {
      if (excluded(name, depth)) continue;
      const src = join(from, name);
      const out = join(to, name);
      const stat = lstatSync(src);
      if (stat.isSymbolicLink()) {
        links.push({ target: readlinkSync(src, { encoding: 'buffer' }), path: out });
      } else if (stat.isDirectory()) {
        mkdirSync(out, { mode: 0o755 });
        copyDirectory(src, out, depth + 1);
      } else if (stat.isFile()) {
        const mode = stat.mode & OWNER_EXEC ? 0o755 : 0o644;
        writeFileSync(out, readFileSync(src), { flag: 'wx', mode });
        chmodSync(out, mode);
      }
    }
  };

  copyDirectory(source, target, 0);
  for (const link of links) symlinkSync(link.target, link.path);
  return leafDigest(target);
}

// ---------------------------------------------------------------------------------------------
// compareWithCopy (D-2 fallback measurement)

/** What each file and symlink under `root` is (I-5 exclusions applied): a file by mode and sha256, a symlink by its target. */
function fingerprints(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (dir: string, prefix: string, depth: number): void => {
    for (const name of namesIn(dir)) {
      if (excluded(name, depth)) continue;
      const path = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat: Stats = lstatSync(path);
      if (stat.isSymbolicLink()) {
        out.set(rel, `link ${readlinkSync(path, { encoding: 'buffer' }).toString('hex')}`);
      } else if (stat.isDirectory()) {
        visit(path, rel, depth + 1);
      } else if (stat.isFile()) {
        const exec = stat.mode & OWNER_EXEC ? 'exec' : 'plain';
        out.set(rel, `file ${exec} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
      }
    }
  };
  visit(realpathSync(root), '', 0);
  return out;
}

/**
 * The files and symlinks that differ between the working tree at `cwd` and the fallback copy
 * `copyDir` (D-2, AC-126): present on one side only, a file whose content or executable bit
 * changed, a symlink with another target, or one kind replaced by the other. Directories are not
 * compared (git does not track them either). Sorted, project-relative, `/`-separated. Throws on
 * any failure to read.
 */
export function compareWithCopy(cwd: string, copyDir: string): string[] {
  const now = fingerprints(cwd);
  const copy = fingerprints(copyDir);
  const changed = new Set<string>();
  for (const [path, print] of now) if (copy.get(path) !== print) changed.add(path);
  for (const path of copy.keys()) if (!now.has(path)) changed.add(path);
  return [...changed].sort();
}

// ---------------------------------------------------------------------------------------------
// sealReadOnly

/**
 * Make `dir` read-only and owner-only, bottom-up: files 0400 (0500 when the owner may execute),
 * directories 0500, `dir` itself last (CRITICAL-1: no group or other bit anywhere). Symlinks are skipped (chmod would follow them), so nothing outside
 * the copy changes. Other types are left alone.
 */
export function sealReadOnly(dir: string): void {
  const root = resolve(dir);
  requireRealDirectory(root, 'the copy');
  const seal = (current: string): void => {
    for (const name of namesIn(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        seal(path);
        chmodSync(path, SEALED_DIR_MODE);
      } else if (stat.isFile()) {
        chmodSync(path, stat.mode & OWNER_EXEC ? SEALED_EXEC_MODE : SEALED_FILE_MODE);
      }
    }
  };
  seal(root);
  chmodSync(root, SEALED_DIR_MODE);
}

// ---------------------------------------------------------------------------------------------
// leafDigest and copyIntact (D-3 resume check, D-B2-2)

/** What a review copy is recorded with, and what copyIntact checks (D-B2-2). */
export interface CopyLeaves {
  /** The number of leaves (see `leafDigest`). */
  entries: number;
  /** sha256 (64 lowercase hex) of the sorted leaf list, in the format `leafDigest` defines. */
  digest: string;
}

/** A leaf's entry type in the digest: regular file, symlink, empty directory, anything else. */
export type LeafType = 'f' | 'l' | 'd-empty' | 'o';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Every leaf below `dir` (see `leafDigest`), with its `/`-separated path relative to `dir`. Never follows a symlink. */
function leavesBelow(dir: string): Array<{ type: LeafType; path: string }> {
  const out: Array<{ type: LeafType; path: string }> = [];
  const visit = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        if (readdirSync(path).length === 0) out.push({ type: 'd-empty', path: rel });
        else visit(path, rel);
      } else {
        out.push({ type: stat.isSymbolicLink() ? 'l' : stat.isFile() ? 'f' : 'o', path: rel });
      }
    }
  };
  visit(dir, '');
  return out;
}

/**
 * The leaves below `dir` and their digest (D-B2-2): the record a review copy is made with.
 *
 * A LEAF is:
 * - every entry that is not a directory: a regular file (`f`), a symlink (`l`, never followed),
 *   or any other type, such as a socket or FIFO (`o`); and
 * - every directory with no entry in it (`d-empty`).
 * Directories with something in them are never leaves, nor is `dir` itself. No exclusions: a
 * tracked `node_modules` is part of an extracted copy. For an extracted snapshot the count equals
 * extractSnapshot's `entries` (its files, symlinks and gitlinks; a gitlink is an empty directory,
 * and git trees hold no other empty directory). For a fallback copy it is what copyWorkingTree
 * wrote.
 *
 * THE DIGEST FORMAT: the lowercase hex sha256 of the concatenation, over every leaf sorted by its
 * path's UTF-8 bytes, of `<type>` TAB `<path>` NUL, where `<type>` is `f`, `l`, `d-empty` or `o`
 * and `<path>` is relative to `dir`, `/`-separated, with no leading `./` or `/`. NUL ends each
 * line because no path can hold one (a newline can). It hashes paths and types only: never
 * contents, modes or link targets. An empty `dir` is 0 leaves and the sha256 of the empty string.
 *
 * WHEN TO TAKE IT: copyWorkingTree returns it. For an extracted copy the caller takes it right
 * after `extractSnapshot` returns `extracted` and BEFORE `sealReadOnly` (sealing does not change
 * it, but nothing may write in between), checks that its `entries` equals the extraction's, and
 * records both in the review copy record.
 *
 * Throws if `dir` is not an existing real directory, or on any read error.
 */
export function leafDigest(dir: string): CopyLeaves {
  const root = resolve(dir);
  requireRealDirectory(root, 'the copy');
  const leaves = leavesBelow(root)
    .map(leaf => ({ ...leaf, bytes: Buffer.from(leaf.path, 'utf8') }))
    .sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  const hash = createHash('sha256');
  for (const leaf of leaves) hash.update(`${leaf.type}\t${leaf.path}\0`, 'utf8');
  return { entries: leaves.length, digest: hash.digest('hex') };
}

/**
 * Whether the copy at `dir` is still whole (D-3 resume, D-B2-2): it is an existing real directory
 * whose `leafDigest` equals the recorded one, count AND digest. A partly cleaned temp copy (also
 * one whose cleaner deleted a file but kept its emptied directory), one with something added, or
 * one with a leaf renamed or changed in type fails. A malformed record fails. Never throws.
 */
export function copyIntact(dir: string, recorded: CopyLeaves): boolean {
  if (typeof recorded !== 'object' || recorded === null) return false;
  if (!Number.isSafeInteger(recorded.entries) || recorded.entries < 0) return false;
  if (typeof recorded.digest !== 'string' || !SHA256_HEX.test(recorded.digest)) return false;
  try {
    const now = leafDigest(dir);
    return now.entries === recorded.entries && now.digest === recorded.digest;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// mapReviewPath and insideReviewCopies

/**
 * A path the main Validator reported from inside its copy, as a project path: an absolute path
 * inside `copyDir`, or inside its non-realpath twin (`/var/...` for `/private/var/...` and back),
 * becomes copy-relative, which is project-relative (`''` for the copy itself). Anything else is
 * returned unchanged; `normalisePath` then handles a project-absolute path.
 */
export function mapReviewPath(file: string, copyDir: string): string {
  if (!isAbsolute(file)) return file;
  const abs = resolve(file);
  for (const root of withTwin(resolve(copyDir))) {
    if (inside(root, abs)) return normalisePath(abs, root).split(sep).join('/');
  }
  return file;
}

/**
 * The claims (Gate 1, D-15) that resolve inside any of the recorded copy directories `dirs`, or
 * their twins: only the harness writes there. A relative claim is resolved against `cwd`.
 * Compared in lower case, as `claimsInsideFactoryDir` does; symlinks are not followed. Returned
 * exactly as claimed, in order.
 */
export function insideReviewCopies(claims: readonly string[], dirs: readonly string[], cwd: string): string[] {
  const roots = dirs.flatMap(dir => withTwin(resolve(dir))).map(root => root.toLowerCase());
  if (roots.length === 0) return [];
  return claims.filter(claim => {
    const abs = (isAbsolute(claim) ? resolve(claim) : resolve(cwd, claim)).toLowerCase();
    return roots.some(root => inside(root, abs));
  });
}

// ---------------------------------------------------------------------------------------------
// reviewRootProblem (MINOR-6)

/** `path` made absolute, its deepest existing ancestor replaced by that ancestor's realpath (the rest may not exist yet). */
function realOrResolved(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Why review copies may not be made under `root` for the project at `project`, or undefined when
 * they may (MINOR-6): the root is the project or inside it. A copy there would land in the CP3
 * change, the snapshots and the project's test run, and the fallback copy of the working tree
 * would copy its own destination into itself. A project inside the root (a project under the OS
 * temp directory) is fine: each copy is a new directory directly under the root, never inside the
 * project. Both paths are resolved through their existing ancestors' realpaths and compared in
 * lower case, so a case-insensitive file system or a symlinked temp directory cannot hide the
 * overlap; over-matching refuses, which fails closed. Reads only; never throws.
 */
export function reviewRootProblem(root: string, project: string): string | undefined {
  const rootDir = realOrResolved(root).toLowerCase();
  const projectDir = realOrResolved(project).toLowerCase();
  if (inside(projectDir, rootDir)) return `the review root ${root} is inside the project ${project}`;
  return undefined;
}
