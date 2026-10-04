/**
 * Feature Factory State Store — the run's memory, on disk.
 *
 * state-tracker.ts builds a complete FeatureState: every agent step, every loop-back, every
 * typed escalation, every checkpoint a human approved, timings per stage. It has always been
 * complete, and it has always been thrown away. The orchestrator imported serializeState and
 * never called it; there was no writeFileSync in it at all. The header of state-tracker.ts
 * claimed "State persisted to JSON file" and nothing anywhere wrote one.
 *
 * What that cost: a forty-minute run that escalated at Stage 4 left the builders' files behind
 * and no record of WHY it stopped — which gate failed, how many times a builder looped, what a
 * human approved on the way, what it cost. OrchestrationOptions.resumeFromState was designed and
 * documented, but unreachable, because nothing could produce a FeatureState to hand it. Resume now
 * reads that record back (run-progress.ts) and continues from it.
 *
 * This module is the missing write. It is deliberately the ONLY thing here that touches the
 * filesystem for state — state-tracker.ts stays pure so it can be tested without a temp dir,
 * and everything that decides WHEN to save lives in the orchestrator.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { writeFileAtomic } from './safe-write';
import { FeatureState, deserializeState, serializeState } from './state-tracker';

/** The run's state lives beside the run's documents. One run, one directory. */
export const STATE_FILENAME = 'state.json';

/**
 * The record could not be written.
 *
 * This is fatal, and deliberately so. An earlier version of commit() caught the save failure,
 * warned, and let the run continue — on the reasoning that losing resumability is cheaper than
 * throwing away completed agent work. That was wrong, and it was the only place in this harness
 * that degraded instead of failing closed.
 *
 * It was wrong because of what the run becomes afterwards. Every guarantee this harness makes is
 * a guarantee about EVIDENCE: the files exist because a gate stat'd them, the tests passed
 * because the harness ran them, a human approved because an approval bound to the hash of the
 * exact text they were shown was recorded. A run whose record cannot be written produces none of
 * that — it still burns tokens, still writes code into the project, still reports an outcome, and
 * has nothing to back any of it up. Continuing means
 * spending more money to reach a conclusion no one can audit, which is the precise failure mode
 * the gates exist to prevent. Stopping costs the work in flight. Continuing costs the work in
 * flight AND the money still to be spent AND the ability to tell what happened.
 */
export class StatePersistenceError extends Error {
  constructor(
    readonly path: string,
    readonly cause: unknown
  ) {
    super(
      `Could not write the run record to ${path}: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n` +
        `The run is stopping. A run that cannot be recorded cannot be audited or resumed, and ` +
        `continuing would spend more on an outcome nobody can verify.`
    );
    this.name = 'StatePersistenceError';
  }
}

/**
 * Where a run's state file lives: `<cwd>/.factory/<featureId>/state.json`.
 *
 * The same directory persistArtifacts() writes RESEARCHER_REPORT.md and TECHNICAL_BRIEF.md
 * into, so a run's record and a run's documents cannot drift apart or be half-deleted.
 *
 * A run directory is never deleted. When a new run starts, finished runs (SUCCESS, MANUAL_STOP)
 * are moved, state file and documents together, into `.factory/_archive/<featureId>/`
 * (run-directory.ts); unfinished runs stay where they are and block the new run until they are
 * resumed or closed. The `...In` / `...From` variants below take the run directory itself, so an
 * archived run's record can be read and updated in place.
 */
export function stateFilePath(cwd: string, featureId: string): string {
  return stateFilePathIn(resolve(cwd, '.factory', featureId));
}

/** The state file inside a given run directory (live or archived). */
export function stateFilePathIn(runDirAbs: string): string {
  return join(resolve(runDirAbs), STATE_FILENAME);
}

/**
 * Write the state durably into `<cwd>/.factory/<featureId>/`. See saveStateIn.
 */
export function saveState(cwd: string, state: FeatureState): string {
  return saveStateIn(resolve(cwd, '.factory', state.featureId), state);
}

/**
 * Write the state durably into a given run directory, creating it if needed. Returns the path.
 *
 * The write is writeFileAtomic (safe-write.ts): a temp file in the same directory, fsync, rename,
 * fsync the directory. Atomic means a reader sees the old complete file or the new complete file,
 * never a torn one; the fsyncs make it durable, so a power loss or hard kill cannot leave a
 * rename that survived and contents that did not — a ZERO-LENGTH state.json every reader agrees
 * is current. The rename also replaces a symlink at state.json rather than writing through it.
 *
 * That matters more here than in most places, because saving fails the run closed. Being killed
 * mid-save is not exotic either: Ctrl-C at a checkpoint is a normal way to end a run.
 */
export function saveStateIn(runDirAbs: string, state: FeatureState): string {
  const target = stateFilePathIn(runDirAbs);

  try {
    // Inside the try: creating the directory fails for the same reasons writing does (no space,
    // no permission, .factory occupied by a file), and every one of them means the same thing —
    // there is no record. One failure mode, one error type.
    mkdirSync(dirname(target), { recursive: true });
    writeFileAtomic(target, serializeState(state));
  } catch (error) {
    throw new StatePersistenceError(target, error);
  }

  return target;
}

/**
 * Load a run's state from `<cwd>/.factory/<featureId>/`, or undefined if there is none.
 * See loadStateFrom.
 */
export function loadState(cwd: string, featureId: string): FeatureState | undefined {
  return loadStateFrom(resolve(cwd, '.factory', featureId), featureId);
}

/**
 * Load the state in a given run directory (live or archived), or undefined if there is none.
 *
 * Returns undefined ONLY for "no such run". A file that exists but does not parse THROWS,
 * because that is corruption and resuming from a guess would silently restart work the operator
 * believes is already done — the sort of quiet wrongness this harness exists to make impossible.
 */
export function loadStateFrom(runDirAbs: string, expectedId: string): FeatureState | undefined {
  const path = stateFilePathIn(runDirAbs);
  if (!existsSync(path)) return undefined;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(
      `State file for run ${expectedId} exists at ${path} but could not be read: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }

  let state: FeatureState;
  try {
    state = deserializeState(raw);
  } catch (error) {
    throw new Error(
      `State file at ${path} is not valid JSON. It is corrupt, not resumable, and the run it ` +
        `describes must be re-run rather than guessed at. ` +
        `(${error instanceof Error ? error.message : String(error)})`
    );
  }

  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`State file at ${path} does not hold a run record. It is corrupt and not resumable.`);
  }

  // A state file for a DIFFERENT run, sitting under this run's id, means something wrote to the
  // wrong path. Resuming it would run one feature under another's identity.
  if (state.featureId !== expectedId) {
    throw new Error(
      `State file at ${path} belongs to run ${state.featureId}, not ${expectedId}. ` +
        `Refusing to resume a run under the wrong identity.`
    );
  }

  return state;
}
