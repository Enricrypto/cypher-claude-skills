/**
 * A fake change tracker (D-8): the `changes` seam for orchestrator and CLI tests.
 *
 * It records every call and never spawns anything, so `npm test` runs no `git` outside the
 * real-git test files, which exercise the real tracker in temp repositories.
 */

import { ChangeSet, ChangeTracker, factoryRef, SnapshotResult } from '../../harness/change-diff';
import { ChangeBase } from '../../harness/state-tracker';

/** The base a fake capture returns unless told otherwise: a git run-start commit on main, nothing pre-existing. */
export const FAKE_BASE: ChangeBase = {
  kind: 'git',
  commit: 'c0ffee'.padEnd(40, '0'),
  branch: 'refs/heads/main',
  preExisting: []
};

/** The fixed ids a fake snapshot reports. */
export const FAKE_SNAPSHOT_COMMIT = '5a95'.padEnd(40, '1');
export const FAKE_SNAPSHOT_TREE = '7eee'.padEnd(40, '2');

export interface FakeChangeTracker extends ChangeTracker {
  /** Every captureBase and collect call, in order. */
  calls: Array<
    | { method: 'captureBase'; cwd: string }
    | { method: 'collect'; cwd: string; base: ChangeBase; claimedFiles: string[] }
  >;
  /** Every snapshot call, in order: a separate log, so `calls` is what it was before PR B-1 (I-1). */
  snapshotCalls: Array<{ cwd: string; base: ChangeBase; runId: string; n: number }>;
}

/**
 * A tracker whose `collect` returns `{ source, files, text }`. By default the change is the one file
 * the scripted Backend Builder writes (`src/a.ts`), so a CP3 rejection routes to that builder.
 * `collect` may be replaced to throw or vary per call.
 *
 * `snapshot` by default reports `written` at `factoryRef(runId, stage3-<n>)` with fixed fake ids and
 * `reused: false` (or `failed` for a ref factoryRef refuses, as the real one does). Pass `snapshot`
 * to return `head-moved` or `failed`, or to vary per call.
 */
export function fakeChangeTracker({
  files = ['src/a.ts'],
  source = 'git',
  text,
  base = FAKE_BASE,
  collect,
  snapshot
}: {
  files?: string[];
  source?: ChangeSet['source'];
  text?: string;
  base?: ChangeBase;
  collect?: ChangeTracker['collect'];
  snapshot?: ChangeTracker['snapshot'];
} = {}): FakeChangeTracker {
  const calls: FakeChangeTracker['calls'] = [];
  const snapshotCalls: FakeChangeTracker['snapshotCalls'] = [];
  const change: ChangeSet = {
    source,
    files: [...files],
    text: text ?? `Fake change (${source})\n\n${files.map(f => `+++ ${f}`).join('\n')}\n`
  };

  const written = async (runId: string, n: number): Promise<SnapshotResult> => {
    try {
      return { kind: 'written', ref: factoryRef(runId, `stage3-${n}`), commit: FAKE_SNAPSHOT_COMMIT, tree: FAKE_SNAPSHOT_TREE, reused: false };
    } catch (error) {
      return { kind: 'failed', error: (error as Error).message };
    }
  };

  return {
    calls,
    snapshotCalls,
    captureBase: async cwd => {
      calls.push({ method: 'captureBase', cwd });
      return structuredClone(base);
    },
    collect: async (cwd, recorded, claimedFiles) => {
      calls.push({ method: 'collect', cwd, base: structuredClone(recorded), claimedFiles: [...claimedFiles] });
      return collect ? collect(cwd, recorded, claimedFiles) : structuredClone(change);
    },
    snapshot: async (cwd, recorded, runId, n) => {
      snapshotCalls.push({ cwd, base: structuredClone(recorded), runId, n });
      return snapshot ? snapshot(cwd, recorded, runId, n) : written(runId, n);
    }
  };
}
