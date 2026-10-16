/**
 * Keep the machine awake for the whole run (PR R-1, R1 / AC-001, AC-002, AC-003).
 *
 * Mac idle sleep stopped runs that had nothing wrong with them: the orchestrator was mid-agent,
 * the laptop slept, the connection died. On macOS the run now holds `caffeinate -dims -w <pid>`
 * from run start until the orchestrator process ends.
 *
 * THE SINGLE ALLOW-LISTED SPAWN SITE (AC-003). This module is the only place in the codebase that
 * spawns `caffeinate`, with exactly one `spawn(` call, the command and the flags as module
 * constants, the argv built in code (never a shell string, so a pid can never be word-split), and
 * a repo-hygiene guard that checks all of it. It is modelled on `git()` in change-diff.ts, which
 * does the same job for git.
 *
 * NEVER THROWS (P2). A hold that could not be taken is a `{ held: false; reason }` value, not a
 * stop: the machine staying awake is a convenience, and a run must not fail because a system
 * binary is missing or `spawn` was refused. The caller logs the one line either way.
 *
 * NO RELEASE, BY DESIGN (R1-2). `-w <pid>` makes the hold self-terminating: `caffeinate` exits by
 * itself when the watched process dies. `runFeatureFactory` has no `finally` and `runCli` ends in
 * `process.exit`, which never returns, so there is no reliable release point to add one — and the
 * story puts an explicit kill out of scope. Do not add a `finally` for this.
 *
 * THREE DETAILS ARE LOAD-BEARING (brief §6 R1-4), each with its own test:
 *   - `detached: true` + `stdio: 'ignore'`: the child is in its own process group and holds no
 *     pipe, so it neither dies with a terminal nor keeps one open.
 *   - `unref()`: WITHOUT IT the Node event loop waits on `caffeinate` and the orchestrator can
 *     NEVER EXIT. A reliability fix that turned every run into a permanent hang would be worse
 *     than the bug it fixes.
 *   - an attached `'error'` listener: WITHOUT IT an ENOENT (a machine with no `caffeinate`, a
 *     locked-down image) is an UNCAUGHT EXCEPTION that kills the run. `spawn` reports a failure to
 *     start asynchronously, after this function has already returned, so the listener is the only
 *     thing that can catch it.
 */

import { spawn } from 'child_process';

/**
 * The absolute path of the macOS binary. Absolute on purpose: no PATH lookup, so a `caffeinate`
 * earlier on the operator's PATH can never be the thing that runs.
 */
export const CAFFEINATE_COMMAND = '/usr/bin/caffeinate';

/**
 * `-dims`, as decided in `R_DECISIONS.md`: prevent display (`d`), disk (`i` idle), idle (`m`
 * sleep... ) — the full set, so nothing about the machine's own idleness can interrupt a run.
 * A module constant so the argv and the documented flags cannot drift apart.
 */
export const CAFFEINATE_FLAGS = ['-dims'] as const;

/** The only platform with `caffeinate`. Everywhere else the keep-awake behaviour is a no-op (AC-002). */
const SUPPORTED_PLATFORM = 'darwin';

/** Whether the hold was taken, and when it was not, why. Never an error: a missing hold is not a problem with the run. */
export type KeepAwakeHold = { held: true } | { held: false; reason: string };

/** The seam the orchestrator takes as `options.keepAwake` (D-1). Tests inject an explicit no-op. */
export type KeepAwake = (pid: number) => KeepAwakeHold;

/**
 * Hold the machine awake while the process `pid` lives (AC-001), or say why the hold was not
 * taken. Spawns nothing at all off darwin (AC-002), and never throws.
 */
export function keepAwake(pid: number): KeepAwakeHold {
  if (process.platform !== SUPPORTED_PLATFORM) {
    return { held: false, reason: `not macOS (${process.platform}); nothing to keep awake` };
  }
  // The pid becomes argv. Anything but a positive integer is a programming error upstream, and a
  // refusal here is cheaper than asking `caffeinate` to watch something that cannot exist.
  if (!Number.isInteger(pid) || pid <= 0) {
    return { held: false, reason: `${JSON.stringify(pid)} is not a process id` };
  }

  try {
    const child = spawn(CAFFEINATE_COMMAND, [...CAFFEINATE_FLAGS, '-w', String(pid)], {
      detached: true,
      stdio: 'ignore'
    });
    // Before unref: a failure to start is reported on this listener, asynchronously, long after
    // this function has returned. With no listener it would be an uncaught exception (R1-4).
    child.on('error', () => {
      /* The machine may sleep; the run goes on. There is nothing to do and nobody to tell. */
    });
    child.unref();
    return { held: true };
  } catch (error) {
    // A synchronous refusal (EPERM, EACCES): a value, never a stop.
    return { held: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
