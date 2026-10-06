/**
 * A fake change tracker (D-8): the `changes` seam for orchestrator and CLI tests.
 *
 * It records every call and never spawns anything, so `npm test` runs no `git` outside the
 * real-git test files, which exercise the real tracker in temp repositories.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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

/** The one file a fake extraction writes into the review copy (project-relative), and its content. */
export const FAKE_COPY_FILE = 'src/a.ts';
export const FAKE_COPY_CONTENT = 'export const a = 1; // the fake review copy\n';

/** What a fake extraction writes into `dest` by default: FAKE_COPY_FILE with FAKE_COPY_CONTENT, one entry. */
export function writeFakeCopy(dest: string): { kind: 'extracted'; entries: number } {
  const path = join(dest, FAKE_COPY_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, FAKE_COPY_CONTENT);
  return { kind: 'extracted', entries: 1 };
}

export interface FakeChangeTracker extends ChangeTracker {
  /** Every captureBase and collect call, in order. */
  calls: Array<
    | { method: 'captureBase'; cwd: string }
    | { method: 'collect'; cwd: string; base: ChangeBase; claimedFiles: string[] }
  >;
  /** Every snapshot call, in order: a separate log, so `calls` is what it was before PR B-1 (I-1). */
  snapshotCalls: Array<{ cwd: string; base: ChangeBase; runId: string; n: number }>;
  /**
   * Every extractSnapshot and changedSince call, in order (PR B-2): a separate log again, so
   * `calls` and `snapshotCalls` are what they were before.
   */
  reviewCalls: Array<
    | { method: 'extractSnapshot'; cwd: string; snap: { ref: string; commit: string; tree: string }; dest: string }
    | { method: 'changedSince'; cwd: string; tree: string }
  >;
  /** Every workingTreeId call (the measurement baseline, IMPORTANT-1): a separate log, so `reviewCalls` is what it was before. */
  baselineCalls: Array<{ cwd: string }>;
}

/**
 * A tracker whose `collect` returns `{ source, files, text }`. By default the change is the one file
 * the scripted Backend Builder writes (`src/a.ts`), so a CP3 rejection routes to that builder.
 * `collect` may be replaced to throw or vary per call.
 *
 * `snapshot` by default reports `written` at `factoryRef(runId, stage3-<n>)` with fixed fake ids and
 * `reused: false` (or `failed` for a ref factoryRef refuses, as the real one does). Pass `snapshot`
 * to return `head-moved` or `failed`, or to vary per call.
 *
 * `extractSnapshot` by default writes FAKE_COPY_FILE into `dest` and returns `extracted` with one
 * entry; pass `extract` to fail or vary. `changedSince` by default reports no changed file; pass
 * `changed` as the files to report, or as a function to fail or vary per call.
 *
 * `workingTreeId` by default reports FAKE_SNAPSHOT_TREE (a working tree unchanged since the fake
 * snapshot, so the baseline the Test Verifier is measured against is the snapshot's tree); pass
 * `baseline` as another tree id, or as a function to fail or vary per call.
 */
export function fakeChangeTracker({
  files = ['src/a.ts'],
  source = 'git',
  text,
  base = FAKE_BASE,
  collect,
  snapshot,
  extract,
  changed,
  baseline
}: {
  files?: string[];
  source?: ChangeSet['source'];
  text?: string;
  base?: ChangeBase;
  collect?: ChangeTracker['collect'];
  snapshot?: ChangeTracker['snapshot'];
  extract?: ChangeTracker['extractSnapshot'];
  changed?: string[] | ChangeTracker['changedSince'];
  baseline?: string | ChangeTracker['workingTreeId'];
} = {}): FakeChangeTracker {
  const calls: FakeChangeTracker['calls'] = [];
  const snapshotCalls: FakeChangeTracker['snapshotCalls'] = [];
  const reviewCalls: FakeChangeTracker['reviewCalls'] = [];
  const baselineCalls: FakeChangeTracker['baselineCalls'] = [];
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
    reviewCalls,
    baselineCalls,
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
    },
    extractSnapshot: async (cwd, snap, dest) => {
      reviewCalls.push({ method: 'extractSnapshot', cwd, snap: structuredClone(snap), dest });
      if (extract) return extract(cwd, snap, dest);
      return writeFakeCopy(dest);
    },
    changedSince: async (cwd, tree) => {
      reviewCalls.push({ method: 'changedSince', cwd, tree });
      if (typeof changed === 'function') return changed(cwd, tree);
      return { kind: 'files', files: [...(changed ?? [])] };
    },
    workingTreeId: async cwd => {
      baselineCalls.push({ cwd });
      if (typeof baseline === 'function') return baseline(cwd);
      return { kind: 'tree', tree: baseline ?? FAKE_SNAPSHOT_TREE };
    }
  };
}
