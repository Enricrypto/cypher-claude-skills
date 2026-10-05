/**
 * A non-durable state writer, for tests only (AC-104).
 *
 * The real store (state-store.ts) writes every state save through writeFileAtomic: temp file,
 * fsync, rename, fsync the directory. S-0 measured those fsyncs at about 87% of `npm test` wall
 * clock (B1_MEASUREMENTS.md), almost all of it in tests that drive whole runs and never kill the
 * machine. This writer keeps everything a test can observe and drops only the fsyncs:
 *
 *  - the same path (`<cwd>/.factory/<featureId>/state.json`, via stateFilePath);
 *  - the same bytes (serializeState, the real store's serializer);
 *  - still atomic for a reader in this process: temp file in the same directory, then rename;
 *  - the same failure: any error becomes a StatePersistenceError, so fail-closed tests behave
 *    exactly as with the durable store.
 *
 * Injected through `OrchestrationOptions.stateWriter`; `runToEnd` (harness-run.ts) passes it by
 * default. Production never passes `stateWriter` (repo-hygiene AC-104), so production saves stay
 * durable.
 */

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

import { stateFilePath, StatePersistenceError } from '../../harness/state-store';
import { FeatureState, serializeState } from '../../harness/state-tracker';

export function nonDurableStateWriter(cwd: string, state: FeatureState): void {
  const target = stateFilePath(cwd, state.featureId);
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);

  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temp, serializeState(state));
    renameSync(temp, target);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* the original error is the one worth reporting */
    }
    throw new StatePersistenceError(target, error);
  }
}
