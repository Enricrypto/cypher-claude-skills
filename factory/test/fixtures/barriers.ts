/**
 * Barriers for orchestrator tests that prove an order or a parallel start (C-33): a signal, a
 * bounded wait on a promise, and a bounded wait on a condition. Each fails after BARRIER_MS and
 * settles as soon as what it waits for does: never a sleep.
 */

/** How long a barrier waits for the other side before the test fails (C-33). */
export const BARRIER_MS = 10_000;

/** A promise and the function that resolves it. */
export function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => (resolve = done));
  return { promise, resolve };
}

/** `promise`, or a rejection naming `what` after BARRIER_MS. Never a sleep: it settles as soon as `promise` does. */
export async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`barrier: timed out waiting for ${what}`)), BARRIER_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Yield to the event loop until `condition` holds, failing after BARRIER_MS (a barrier on a condition). */
export async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + BARRIER_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`barrier: timed out waiting for ${what}`);
    await new Promise<void>(done => setImmediate(done));
  }
}
