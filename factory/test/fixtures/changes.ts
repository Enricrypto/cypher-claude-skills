/**
 * A fake change tracker (D-8): the `changes` seam for orchestrator and CLI tests.
 *
 * It records every call and never spawns anything, so `npm test` runs no `git` outside
 * change-diff.test.ts, which exercises the real tracker in temp repositories.
 */

import { ChangeSet, ChangeTracker } from '../../harness/change-diff';
import { ChangeBase } from '../../harness/state-tracker';

/** The base a fake capture returns unless told otherwise: a git run-start commit. */
export const FAKE_BASE: ChangeBase = { kind: 'git', commit: 'c0ffee'.padEnd(40, '0') };

export interface FakeChangeTracker extends ChangeTracker {
  /** Every call, in order. */
  calls: Array<
    | { method: 'captureBase'; cwd: string }
    | { method: 'collect'; cwd: string; base: ChangeBase; claimedFiles: string[] }
  >;
}

/**
 * A tracker whose `collect` returns `{ source, files, text }`. By default the change is the one file
 * the scripted Backend Builder writes (`src/a.ts`), so a CP3 rejection routes to that builder.
 * `collect` may be replaced to throw or vary per call.
 */
export function fakeChangeTracker({
  files = ['src/a.ts'],
  source = 'git',
  text,
  base = FAKE_BASE,
  collect
}: {
  files?: string[];
  source?: ChangeSet['source'];
  text?: string;
  base?: ChangeBase;
  collect?: ChangeTracker['collect'];
} = {}): FakeChangeTracker {
  const calls: FakeChangeTracker['calls'] = [];
  const change: ChangeSet = {
    source,
    files: [...files],
    text: text ?? `Fake change (${source})\n\n${files.map(f => `+++ ${f}`).join('\n')}\n`
  };

  return {
    calls,
    captureBase: async cwd => {
      calls.push({ method: 'captureBase', cwd });
      return structuredClone(base);
    },
    collect: async (cwd, recorded, claimedFiles) => {
      calls.push({ method: 'collect', cwd, base: structuredClone(recorded), claimedFiles: [...claimedFiles] });
      return collect ? collect(cwd, recorded, claimedFiles) : structuredClone(change);
    }
  };
}
