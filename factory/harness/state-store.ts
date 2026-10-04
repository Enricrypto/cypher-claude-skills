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
 * human approved on the way, what it cost. OrchestrationOptions.resumeFromState was designed,
 * documented, and unreachable, because nothing could produce a FeatureState to hand it.
 *
 * This module is the missing write. It is deliberately the ONLY thing here that touches the
 * filesystem for state — state-tracker.ts stays pure so it can be tested without a temp dir,
 * and everything that decides WHEN to save lives in the orchestrator.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'fs';
import { dirname, join, resolve } from 'path';

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
 * because the harness ran them, a human approved because an approver returned true. A run whose
 * record cannot be written produces none of that — it still burns tokens, still writes code into
 * the project, still reports an outcome, and has nothing to back any of it up. Continuing means
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
 * NOTE: clearStaleArtifacts() removes every directory except the current run's, so state files
 * are reaped along with the artifacts they describe. That is intended — a state file whose
 * briefs have been deleted cannot be resumed anyway, and keeping it would invite exactly the
 * "four contradictory approved specs" problem that cleanup exists to prevent.
 */
export function stateFilePath(cwd: string, featureId: string): string {
  return resolve(cwd, '.factory', featureId, STATE_FILENAME);
}

/**
 * Write the state durably.
 *
 * Three steps, and each one is load-bearing:
 *
 *   1. write to a temp file in the SAME directory as the target. Same directory, not
 *      os.tmpdir(), because rename is only atomic within one filesystem and /tmp is frequently
 *      a different mount — a cross-device rename fails outright with EXDEV.
 *   2. fsync the temp file, so its bytes are actually on the device.
 *   3. rename over the target, then fsync the DIRECTORY, so the rename itself is durable.
 *
 * Step 2 and 3 are the difference between "atomic" and "durable", and skipping them is the
 * usual way this pattern is written wrong. rename(2) guarantees a reader sees either the old
 * complete file or the new complete file — never a torn one. It guarantees nothing about the
 * bytes having reached the disk. Without the fsyncs, a power loss or a hard kill at the wrong
 * moment can leave a rename that survived and contents that did not: a ZERO-LENGTH state.json
 * that every reader agrees is the current one.
 *
 * That failure mode matters more here than in most places, because saveState now fails the run
 * closed. Hard-failing on a bad write while leaving a silently empty file behind would be the
 * worst of both: loud when the disk is broken, silent when the data is gone.
 *
 * Being killed mid-save is not exotic in this harness — Ctrl-C at a checkpoint is a NORMAL way
 * to end a run, because a checkpoint is exactly where a human sits and decides not to continue.
 */
export function saveState(cwd: string, state: FeatureState): string {
  const target = stateFilePath(cwd, state.featureId);
  const directory = dirname(target);
  const temp = join(directory, `.${STATE_FILENAME}.${process.pid}.tmp`);

  try {
    // Inside the try: creating the directory fails for the same reasons writing does (no space,
    // no permission, .factory occupied by a file), and every one of them means the same thing —
    // there is no record. One failure mode, one error type.
    mkdirSync(directory, { recursive: true });

    // Write and fsync the temp file. openSync/writeSync/fsyncSync rather than writeFileSync,
    // because we need the descriptor to sync it before it is renamed into place.
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, serializeState(state), null, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(temp, target);

    // fsync the directory so the rename survives too. A directory fd cannot be opened for
    // writing; 'r' is correct and is what fsync needs.
    //
    // Not universally supported — some filesystems and platforms reject fsync on a directory
    // handle (Windows most notably). A failure here means the rename may not be durable yet; it
    // does NOT mean the save failed, and treating it as fatal would break saving entirely on
    // those systems for a guarantee they cannot offer anyway.
    try {
      const dirFd = openSync(directory, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      /* best effort — the file itself is already synced and in place */
    }
  } catch (error) {
    // Never leave the scratch file behind to be mistaken for a real one.
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      /* the original error is the one worth reporting */
    }
    throw new StatePersistenceError(target, error);
  }

  return target;
}

/**
 * Load a run's state, or undefined if there is none.
 *
 * Returns undefined ONLY for "no such run". A file that exists but does not parse THROWS,
 * because that is corruption and resuming from a guess would silently restart work the operator
 * believes is already done — the sort of quiet wrongness this harness exists to make impossible.
 */
export function loadState(cwd: string, featureId: string): FeatureState | undefined {
  const path = stateFilePath(cwd, featureId);
  if (!existsSync(path)) return undefined;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(
      `State file for run ${featureId} exists at ${path} but could not be read: ` +
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

  // A state file for a DIFFERENT run, sitting under this run's id, means something wrote to the
  // wrong path. Resuming it would run one feature under another's identity.
  if (state.featureId !== featureId) {
    throw new Error(
      `State file at ${path} belongs to run ${state.featureId}, not ${featureId}. ` +
        `Refusing to resume a run under the wrong identity.`
    );
  }

  return state;
}
