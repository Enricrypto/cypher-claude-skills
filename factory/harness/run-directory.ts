/**
 * Run-directory lifecycle (A-2, D-9; AC-40, AC-41, AC-73; carry-over 2; I-1, I-13).
 *
 * Every run lives in `<cwd>/.factory/<featureId>/`: its state.json and its documents. This module
 * decides what happens to those directories over time, and it never deletes one:
 *
 *  - A new run start ARCHIVES finished runs — SUCCESS, MANUAL_STOP, and pre-A-2 directories with
 *    no state.json — by moving them, contents intact, into `.factory/_archive/<name>/`. The agents
 *    are told never to read `_archive/` (ARCHIVE_RULE), so an old "approved" brief cannot be
 *    mistaken for the current one; and unlike the cleanup this replaces (clearStaleArtifacts,
 *    which removed every other directory including `_archive/`), the record survives.
 *  - It then REFUSES to start while any run is unfinished (ACTIVE, PAUSED or ESCALATED), naming
 *    each one with its --resume and --close commands. Unfinished runs are never moved: the
 *    operator decides whether to resume or close them (I-1).
 *  - A state.json that cannot be read, does not parse, or names another run refuses the start,
 *    naming the directory (I-13). Guessing what a corrupt run was would be worse than stopping.
 *  - `_archive/`, `baseline.json` and any other regular file in `.factory/` are never touched.
 *    Symlinks in `.factory/` are neither followed nor moved. `_archive/` is recognised in any
 *    letter case. A `.factory` that is itself a symlink or not a directory refuses the start.
 *
 * `closeRun` is the library half of `--close` (AC-73): an unfinished run becomes MANUAL_STOP in
 * place, and the next fresh start archives it.
 *
 * Errors are RunRefusedError (run-lifecycle.ts), thrown before anything is written whenever the
 * refusal is about the request itself. Concurrency (two starts at once) is out of scope.
 */

import { lstatSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join, resolve } from 'path';

import { classifyRun, isSafeRunId, nextStepHints, RunClass, RunRefusedError } from './run-lifecycle';
import { UnsafeArtifactPathError } from './safe-write';
import { loadStateFrom, saveStateIn, STATE_FILENAME } from './state-store';
import { completeFeature, FeatureState } from './state-tracker';

export { isSafeRunId } from './run-lifecycle';

/** Finished runs move here. Never listed as a run, never moved, never deleted. */
export const ARCHIVE_DIRNAME = '_archive';

/**
 * Inside a run directory: where a rejected checkpoint's documents are moved when its rework
 * starts (D-5), one numbered directory per rejection cycle. Never read as current, never deleted.
 */
export const SUPERSEDED_DIRNAME = '_superseded';

/** The finalSummary a closed run records (AC-73). */
export const CLOSE_SUMMARY = 'Closed by operator (--close)';

export interface RunDirectoryEntry {
  /** The directory name under `.factory/` (the run id, for a recognised run). */
  name: string;
  /** Absolute path of the directory. */
  path: string;
  /**
   * `run`: a readable state.json for this id. `unrecognised`: no state.json (a pre-A-2 leftover).
   * `unreadable`: a state.json that is not a regular file, cannot be read or parsed, or names
   * another run.
   */
  kind: 'run' | 'unrecognised' | 'unreadable';
  state?: FeatureState;
  runClass?: RunClass;
  /** Why an `unreadable` directory is unreadable. */
  problem?: string;
}

export interface FoundRun {
  state: FeatureState;
  location: 'live' | 'archive';
  /** Absolute path of the run directory. */
  runDir: string;
}

/** The harness directory's exact spelling. */
const FACTORY_DIRNAME = '.factory';

function factoryDir(cwd: string): string {
  return resolve(cwd, FACTORY_DIRNAME);
}

/**
 * AC-97: refuse when `cwd` holds an entry — directory, file or anything else — whose name is
 * `.factory` in another letter case (`.Factory`, `.FACTORY`...). The harness writes `.factory/`, and
 * every git call excludes exactly `:(exclude).factory`, which git does NOT apply to `.Factory/`
 * even with core.ignorecase (AC-98 probe), so such an entry would leak harness state into the
 * CHECKPOINT 3 change and snapshots. On a case-insensitive file system it may also BE the harness
 * directory under another name. The run's pre-flight calls this first, before anything is read or
 * written; it only lists `cwd`.
 *
 * A missing `cwd` has no entries (ENOENT). Any other listing error propagates: never fail open.
 */
export function assertNoFactoryCaseVariant(cwd: string): void {
  let names: string[];
  try {
    names = readdirSync(cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const variants = names
    .filter(name => name !== FACTORY_DIRNAME && name.toLowerCase() === FACTORY_DIRNAME)
    .sort()
    .map(name => resolve(cwd, name));
  if (variants.length === 0) return;

  throw new RunRefusedError(
    'FACTORY_DIR_CASE_CONFLICT',
    variants
      .map(
        path =>
          `${path} differs from the harness directory ${FACTORY_DIRNAME} only in letter case; ` +
          `git's \`:(exclude)${FACTORY_DIRNAME}\` would not exclude it. Rename or remove it, then run again.`
      )
      .join('\n')
  );
}

function archiveDir(cwd: string): string {
  return join(factoryDir(cwd), ARCHIVE_DIRNAME);
}

function unreadable(dir: string, problem: string): RunRefusedError {
  return new RunRefusedError(
    'UNREADABLE_RUN',
    `The run directory ${dir} cannot be used: ${problem}\n` +
      `It was left exactly as it is. Inspect it, then move it out of .factory/ (or repair its ` +
      `${STATE_FILENAME}) before starting or changing a run.`
  );
}

/**
 * The run recorded in `dir` under `id`; undefined when there is no directory or no state.json.
 * Throws UNREADABLE_RUN for a directory or state.json that is a symlink or the wrong file type,
 * and for a state.json that cannot be read, does not parse, or belongs to another run.
 */
function readRunAt(dir: string, id: string): FeatureState | undefined {
  const dirStat = lstatSync(dir, { throwIfNoEntry: false });
  if (!dirStat) return undefined;
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw unreadable(dir, `it is ${dirStat.isSymbolicLink() ? 'a symlink' : 'not a directory'}.`);
  }

  const statePath = join(dir, STATE_FILENAME);
  const fileStat = lstatSync(statePath, { throwIfNoEntry: false });
  if (!fileStat) return undefined;
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw unreadable(dir, `its ${STATE_FILENAME} is ${fileStat.isSymbolicLink() ? 'a symlink' : 'not a regular file'}.`);
  }

  try {
    return loadStateFrom(dir, id);
  } catch (error) {
    throw unreadable(dir, error instanceof Error ? error.message : String(error));
  }
}

function assertSafeRunId(id: string): void {
  if (!isSafeRunId(id)) {
    throw new RunRefusedError(
      'INVALID_RUN_ID',
      `${JSON.stringify(id)} is not a valid run id: a letter or digit, then letters, digits, ".", "_" ` +
        `or "-" (at most 128 characters, never "..").`
    );
  }
}

/**
 * `_archive` in any letter case. On a case-insensitive file system (APFS, NTFS) `_Archive/` IS the
 * archive directory, so it must never be listed — and moved into itself — as a run (MINOR-7).
 */
function isArchiveName(name: string): boolean {
  return name.toLowerCase() === ARCHIVE_DIRNAME;
}

/**
 * Every real directory directly under `.factory/` except `_archive/` (in any letter case),
 * classified, sorted by name. Symlinks and regular files are not run directories and are not
 * listed. No `.factory/` lists nothing; a `.factory` that is a symlink or not a directory is
 * refused with UNREADABLE_RUN (fail closed: it is never read as empty). Reads only.
 */
export function listRunDirectories(cwd: string): RunDirectoryEntry[] {
  const root = factoryDir(cwd);
  const rootStat = lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat) return [];
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw unreadable(root, `it is ${rootStat.isSymbolicLink() ? 'a symlink' : 'not a directory'}.`);
  }

  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isArchiveName(entry.name))
    .map(entry => entry.name)
    .sort()
    .map((name): RunDirectoryEntry => {
      const path = join(root, name);
      try {
        const state = readRunAt(path, name);
        return state ? { name, path, kind: 'run', state, runClass: classifyRun(state) } : { name, path, kind: 'unrecognised' };
      } catch (error) {
        return { name, path, kind: 'unreadable', problem: error instanceof Error ? error.message : String(error) };
      }
    });
}

/** `2026-10-04T19:03:12.345Z` → `20261004T190312345Z`. */
function compactTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, '');
}

/** A free name under `_archive/`: the name itself, else `<name>.<timestamp>`, else `-2`, `-3`... */
function archiveTarget(archive: string, name: string, now: Date): string {
  const plain = join(archive, name);
  if (!lstatSync(plain, { throwIfNoEntry: false })) return plain;

  const stamped = `${name}.${compactTimestamp(now)}`;
  for (let n = 1; ; n++) {
    const candidate = join(archive, n === 1 ? stamped : `${stamped}-${n}`);
    if (!lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
}

function describeUnfinished(entry: RunDirectoryEntry, cwd: string): string {
  const hints = nextStepHints(entry.state as FeatureState, cwd);
  const lines = hints.length > 0 ? hints : [`Its id is not a valid run id; move ${entry.path} out of .factory/ by hand.`];
  return [`  Run ${entry.name} (${entry.runClass}):`, ...lines.map(line => `    ${line}`)].join('\n');
}

/**
 * Pre-flight for a FRESH run (never for a resume), called before the run's state is created.
 *
 *  1. Archive every SUCCESS, MANUAL_STOP and unrecognised directory into `_archive/` (renamed,
 *     intact; `_archive/` created on first use; a name collision gets a timestamp suffix).
 *  2. Then refuse with UNREADABLE_RUN if any directory has an unreadable state.json, naming it.
 *  3. Then refuse with ACTIVE_RUN_EXISTS if any ACTIVE, PAUSED or ESCALATED run exists, naming
 *     each id with its --resume and --close commands.
 *
 * Unfinished and unreadable directories are never moved. Returns the names archived.
 */
export function prepareNewRunDirectory(cwd: string, now: Date = new Date()): { archived: string[] } {
  const entries = listRunDirectories(cwd);
  const finished = entries.filter(
    entry => entry.kind === 'unrecognised' || entry.runClass === 'SUCCESS' || entry.runClass === 'MANUAL_STOP'
  );
  const broken = entries.filter(entry => entry.kind === 'unreadable');
  const unfinished = entries.filter(
    entry => entry.runClass === 'ACTIVE' || entry.runClass === 'PAUSED' || entry.runClass === 'ESCALATED'
  );

  const archived: string[] = [];
  if (finished.length > 0) {
    const archive = archiveDir(cwd);
    const archiveStat = lstatSync(archive, { throwIfNoEntry: false });
    if (archiveStat && (archiveStat.isSymbolicLink() || !archiveStat.isDirectory())) {
      throw unreadable(
        archive,
        `it is ${archiveStat.isSymbolicLink() ? 'a symlink' : 'not a directory'}, so finished runs cannot be archived into it.`
      );
    }
    if (!archiveStat) mkdirSync(archive);

    for (const entry of finished) {
      renameSync(entry.path, archiveTarget(archive, entry.name, now));
      archived.push(entry.name);
    }
  }

  if (broken.length > 0) {
    throw new RunRefusedError(
      'UNREADABLE_RUN',
      `A new run cannot start: ${broken.length === 1 ? 'a run directory is' : `${broken.length} run directories are`} ` +
        `unreadable.\n` +
        broken.map(entry => `  ${entry.problem}`).join('\n')
    );
  }

  if (unfinished.length > 0) {
    throw new RunRefusedError(
      'ACTIVE_RUN_EXISTS',
      `A new run cannot start: ${unfinished.length === 1 ? 'an unfinished run exists' : `${unfinished.length} unfinished runs exist`} ` +
        `in ${factoryDir(cwd)}. Resume or close ${unfinished.length === 1 ? 'it' : 'each one'} first.\n` +
        unfinished.map(entry => describeUnfinished(entry, cwd)).join('\n')
    );
  }

  return { archived };
}

/**
 * The run with this id: live (`.factory/<id>/`) first, then archived (`.factory/_archive/<id>/`).
 * Undefined when neither has a state.json. Throws INVALID_RUN_ID for an unsafe id and
 * UNREADABLE_RUN for a corrupt record.
 */
export function findRun(cwd: string, id: string): FoundRun | undefined {
  assertSafeRunId(id);

  const liveDir = join(factoryDir(cwd), id);
  const liveState = readRunAt(liveDir, id);
  if (liveState) return { state: liveState, location: 'live', runDir: liveDir };

  const archivedDir = join(archiveDir(cwd), id);
  const archivedState = readRunAt(archivedDir, id);
  if (archivedState) return { state: archivedState, location: 'archive', runDir: archivedDir };

  return undefined;
}

/**
 * Close an unfinished live run (AC-73): ACTIVE, PAUSED or ESCALATED becomes MANUAL_STOP with
 * finalSummary CLOSE_SUMMARY, saved in place. `pendingCheckpoint` is kept for the record. The next
 * fresh start archives it.
 *
 * Refuses, with state.json unchanged: an unsafe id (INVALID_RUN_ID), a run that is already
 * SUCCESS or MANUAL_STOP or already archived (RUN_FINISHED), no such run (RUN_NOT_FOUND), a
 * corrupt record (UNREADABLE_RUN).
 */
export function closeRun(cwd: string, id: string, now: string = new Date().toISOString()): FeatureState {
  assertSafeRunId(id);

  const liveDir = join(factoryDir(cwd), id);
  const state = readRunAt(liveDir, id);

  if (!state) {
    if (readRunAt(join(archiveDir(cwd), id), id)) {
      throw new RunRefusedError('RUN_FINISHED', `Run ${id} is already finished and archived; there is nothing to close.`);
    }
    throw new RunRefusedError('RUN_NOT_FOUND', `No run ${id} in ${factoryDir(cwd)}.`);
  }

  const runClass = classifyRun(state);
  if (runClass === 'SUCCESS' || runClass === 'MANUAL_STOP') {
    throw new RunRefusedError('RUN_FINISHED', `Run ${id} already finished (${runClass}); there is nothing to close.`);
  }

  const closed = completeFeature(state, 'MANUAL_STOP', CLOSE_SUMMARY, now);
  saveStateIn(liveDir, closed);
  return closed;
}

/** A plain document name: a letter or digit first, no separator, never `.` or `..`. */
const PLAIN_DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `dir` as a real directory: created when absent; a symlink or anything else is refused. */
function realDirectory(dir: string): void {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (!stat) {
    mkdirSync(dir);
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new UnsafeArtifactPathError(`${dir} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a directory'}; nothing was superseded.`);
  }
}

/**
 * Move a rejected checkpoint's documents out of the way when its rework starts (D-5, MINOR-8):
 * `<runDir>/<name>` → `<runDir>/_superseded/<cycle>/<name>`, by rename, contents intact. A
 * superseded document can then never be read as the current one — the gates read only the run
 * directory's top-level files — while the record of what was rejected survives. Nothing is ever
 * deleted.
 *
 *  - A missing document is skipped, so a retried supersede is idempotent.
 *  - Everything is checked before anything moves: the run directory, `_superseded/` and
 *    `_superseded/<cycle>/` must be real directories (never symlinks); each present document must
 *    be a regular file (a symlink is refused, not followed); and a document already superseded in
 *    this cycle is never overwritten.
 *
 * Returns the absolute cycle directory and the names actually moved.
 */
export function supersedeArtifacts(
  runDirAbs: string,
  cycle: number,
  names: readonly string[]
): { supersededDir: string; moved: string[] } {
  if (!Number.isInteger(cycle) || cycle < 1) {
    throw new RangeError(`A rework cycle must be a whole number from 1; got ${String(cycle)}.`);
  }
  for (const name of names) {
    if (typeof name !== 'string' || !PLAIN_DOCUMENT_NAME.test(name) || name.includes('..')) {
      throw new UnsafeArtifactPathError(`${JSON.stringify(name)} is not a plain document name; nothing was superseded.`);
    }
  }

  const runStat = lstatSync(runDirAbs, { throwIfNoEntry: false });
  if (!runStat || runStat.isSymbolicLink() || !runStat.isDirectory()) {
    throw new UnsafeArtifactPathError(`The run directory ${runDirAbs} is missing or not a real directory; nothing was superseded.`);
  }

  const root = join(runDirAbs, SUPERSEDED_DIRNAME);
  const target = join(root, String(cycle));
  const present: string[] = [];
  for (const name of names) {
    const stat = lstatSync(join(runDirAbs, name), { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new UnsafeArtifactPathError(
        `${join(runDirAbs, name)} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a regular file'}; nothing was superseded.`
      );
    }
    present.push(name);
  }

  realDirectory(root);
  realDirectory(target);
  for (const name of present) {
    if (lstatSync(join(target, name), { throwIfNoEntry: false })) {
      throw new Error(`${join(target, name)} already holds a superseded ${name}; it is never overwritten. Nothing was moved.`);
    }
  }

  for (const name of present) renameSync(join(runDirAbs, name), join(target, name));
  return { supersededDir: target, moved: present };
}
