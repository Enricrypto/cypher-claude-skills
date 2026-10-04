/**
 * Safe writes (A-2, D-12, NEW-MINOR-1).
 *
 * The harness writes into directories that agents can also write into: a builder has Write and
 * Bash, and the run directory lives inside the project it works on. A symlink planted there
 * (`TEST_REPORT.md -> ~/.zshrc`, or `.factory/<id> -> /somewhere`) would otherwise turn an
 * ordinary harness write into a write anywhere the user can write. Two primitives close that:
 *
 *  - `writeFileNoFollow` for documents written in place: the target must be a regular file or
 *    absent, never a symlink, and its directory must resolve inside the container. The open itself
 *    uses O_NOFOLLOW, so a symlink planted between the check and the open fails the write too.
 *  - `writeFileAtomic` for records that must never be torn (state.json, baseline.json): temp file
 *    in the same directory, fsync, rename, fsync the directory. A rename REPLACES a symlink at the
 *    target instead of following it.
 *
 * Neither deletes anything it did not create.
 */

import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';

/**
 * A write the harness refuses: a name that is not a plain filename, a path outside its container,
 * or a target reached through a symlink. Defined here (and re-exported by stage-context.ts, where
 * it was born) so the writers and the artifact planner throw one and the same class.
 */
export class UnsafeArtifactPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeArtifactPathError';
  }
}

/** `child` is `parent` or lies below it. Both must already be absolute and normalised. */
function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function realpathOrRefuse(path: string, what: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    throw new UnsafeArtifactPathError(
      `${what} ${path} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Walk from `container` down to `dir` without following a symlink that resolves outside
 * `realContainer`. With `create`, every missing directory is made one level at a time (never
 * through such a symlink) and `dir` must then resolve inside the container. Without `create`, the
 * walk stops at the first missing component: nothing below it exists yet, so nothing below it can
 * be a symlink.
 */
function checkDirectoryInside(container: string, realContainer: string, dir: string, create: boolean): void {
  const parts = relative(container, dir).split(sep).filter(part => part.length > 0);
  let current = container;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) {
      if (!create) return;
      mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const real = realpathOrRefuse(current, 'Directory');
      if (!isWithin(realContainer, real)) {
        throw new UnsafeArtifactPathError(`Directory ${current} is a symlink resolving to ${real}, outside ${realContainer}.`);
      }
      if (!lstatSync(real).isDirectory()) {
        throw new UnsafeArtifactPathError(`${current} resolves to ${real}, which is not a directory.`);
      }
      continue;
    }
    if (!stat.isDirectory()) {
      throw new UnsafeArtifactPathError(`${current} is in the way of ${dir}: it exists and is not a directory.`);
    }
  }

  if (!create) return;
  const realDir = realpathOrRefuse(dir, 'Directory');
  if (!isWithin(realContainer, realDir)) {
    throw new UnsafeArtifactPathError(`Directory ${dir} resolves to ${realDir}, outside ${realContainer}.`);
  }
}

interface CheckedTarget {
  container: string;
  realContainer: string;
  target: string;
}

function checkTarget(containerAbs: string, path: string, create: boolean): CheckedTarget {
  const container = resolve(containerAbs);
  const target = resolve(container, path);

  if (target === container || !isWithin(container, target)) {
    throw new UnsafeArtifactPathError(`Refusing to write ${target}: it is not inside ${container}.`);
  }

  const realContainer = realpathOrRefuse(container, 'Container');
  checkDirectoryInside(container, realContainer, dirname(target), create);

  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new UnsafeArtifactPathError(
      `Refusing to write ${target}: it exists and is ${existing.isSymbolicLink() ? 'a symlink' : 'not a regular file'}.`
    );
  }
  return { container, realContainer, target };
}

/**
 * Every refusal `writeFileNoFollow` would make, checked WITHOUT writing or creating anything.
 * Callers that write several files call this for all of them first, so a refusal leaves no
 * partial output behind. Returns the absolute target path.
 */
export function assertNoFollowWritable(containerAbs: string, path: string): string {
  return checkTarget(containerAbs, path, false).target;
}

/**
 * Write `content` to `path` (absolute, or relative to `containerAbs`) without following a symlink.
 * Returns the absolute path written.
 *
 * Refuses, with UnsafeArtifactPathError and nothing written:
 *  - a container that does not exist;
 *  - a path that is the container or lies outside it (lexically);
 *  - a directory on the way that resolves outside `realpath(containerAbs)`;
 *  - an existing target that is a symlink (dangling or not) or not a regular file.
 */
export function writeFileNoFollow(containerAbs: string, path: string, content: string): string {
  const { target } = checkTarget(containerAbs, path, true);

  let fd: number;
  try {
    fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  } catch (error) {
    // ELOOP: a symlink appeared at the target after the check. Same refusal, same type.
    throw new UnsafeArtifactPathError(
      `Refusing to write ${target}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    writeSync(fd, content, null, 'utf-8');
  } finally {
    closeSync(fd);
  }
  return target;
}

/**
 * Write `content` to `path` durably and atomically: a reader sees the old complete file or the new
 * complete file, never a torn one, and after a crash the new file is not silently zero-length.
 *
 *   1. write a temp file in the SAME directory (rename is only atomic within one filesystem;
 *      os.tmpdir() is often another mount and the rename fails with EXDEV). The temp file is
 *      opened with O_NOFOLLOW, so a symlink planted at its name fails the write.
 *   2. fsync the temp file, so its bytes are on the device.
 *   3. rename over the target (replacing a symlink there, never following it), then fsync the
 *      directory so the rename is durable. Directory fsync is best effort: some platforms
 *      (Windows) reject it, and that does not make the write itself fail.
 *
 * The directory must exist. On failure the temp file this call created is removed and the
 * original error is rethrown.
 */
export function writeFileAtomic(path: string, content: string): void {
  const target = resolve(path);
  const directory = dirname(target);
  const temp = join(directory, `.${basename(target)}.${process.pid}.tmp`);
  let created = false;

  try {
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
    created = true;
    try {
      writeSync(fd, content, null, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(temp, target);
    created = false;

    try {
      const dirFd = openSync(directory, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      /* best effort: the file itself is already synced and in place */
    }
  } catch (error) {
    if (created) {
      try {
        unlinkSync(temp);
      } catch {
        /* the original error is the one worth reporting */
      }
    }
    throw error;
  }
}
