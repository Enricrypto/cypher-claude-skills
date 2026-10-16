/**
 * R1 / AC-001, AC-002: the keep-awake hold.
 *
 * `caffeinate` is spawned from exactly one site (a repo-hygiene guard checks that); here we pin
 * WHAT that site does. The spawn is spied on rather than injected, so these tests exercise the
 * real seam: `keepAwake` reads `process.platform` and calls `child_process.spawn` itself.
 *
 * Three details are load-bearing and each has its own test (brief §6 R1-4):
 *   - `unref()`, without which the Node event loop waits on `caffeinate` and the orchestrator can
 *     never exit — a reliability fix that would turn every run into a permanent hang;
 *   - an attached `'error'` listener, without which an ENOENT on a machine with no `caffeinate`
 *     is an UNCAUGHT exception that kills the run;
 *   - never a throw (P2): a hold that could not be taken is a value, so it can be logged and
 *     ignored.
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import childProcess = require('child_process');
import { EventEmitter } from 'events';

import { CAFFEINATE_COMMAND, CAFFEINATE_FLAGS, keepAwake } from '../../harness/keep-awake';

/** A spawned child as `keepAwake` uses it: an event emitter with `unref`. */
class FakeChild extends EventEmitter {
  unrefCalls = 0;
  unref(): this {
    this.unrefCalls++;
    return this;
  }
}

const realPlatform = process.platform;

/** Run `keepAwake` as if on `platform`, with `spawn` spied. Restores the platform either way. */
function onPlatform<T>(platform: NodeJS.Platform, body: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('keepAwake', () => {
  it('AC-001 on darwin it spawns caffeinate -dims -w <pid> detached, with no shell, unrefs it and attaches an error listener', () => {
    const child = new FakeChild();
    const spawn = jest.spyOn(childProcess, 'spawn').mockReturnValue(child as unknown as childProcess.ChildProcess);

    const hold = onPlatform('darwin', () => keepAwake(4321));

    expect(hold).toEqual({ held: true });
    expect(spawn).toHaveBeenCalledTimes(1);

    const [command, args, options] = spawn.mock.calls[0];
    // Exactly the argv AC-001 names, built in code — never a shell string.
    expect(command).toBe(CAFFEINATE_COMMAND);
    expect(args).toEqual(['-dims', '-w', '4321']);
    // The flags come from the module constant, so the argv and the constant cannot drift apart.
    expect(args).toEqual([...CAFFEINATE_FLAGS, '-w', '4321']);
    expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
    // No shell: a pid can never be word-split or interpreted.
    expect(options).not.toHaveProperty('shell', true);

    // Without unref() the orchestrator could never exit.
    expect(child.unrefCalls).toBe(1);
    // Without an 'error' listener an ENOENT would be an uncaught exception.
    expect(child.listenerCount('error')).toBe(1);
  });

  it('AC-002 on linux nothing at all is spawned and the hold reports why', () => {
    const spawn = jest.spyOn(childProcess, 'spawn');

    const hold = onPlatform('linux', () => keepAwake(4321));

    expect(spawn).not.toHaveBeenCalled();
    expect(hold.held).toBe(false);
    expect(hold).toEqual({ held: false, reason: expect.stringContaining('linux') as unknown as string });
  });

  it('AC-002 on win32 nothing at all is spawned', () => {
    const spawn = jest.spyOn(childProcess, 'spawn');

    const hold = onPlatform('win32', () => keepAwake(4321));

    expect(spawn).not.toHaveBeenCalled();
    expect(hold.held).toBe(false);
  });

  it('AC-001 a spawn that throws synchronously (EPERM) is a not-held value, never a throw', () => {
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw Object.assign(new Error('spawn /usr/bin/caffeinate EPERM'), { code: 'EPERM' });
    });

    const hold = onPlatform('darwin', () => keepAwake(4321));

    expect(hold.held).toBe(false);
    expect(hold).toEqual({ held: false, reason: expect.stringContaining('EPERM') as unknown as string });
  });

  it('AC-001 an asynchronously emitted ENOENT is swallowed by the error listener, not an uncaught exception', () => {
    const child = new FakeChild();
    jest.spyOn(childProcess, 'spawn').mockReturnValue(child as unknown as childProcess.ChildProcess);

    const hold = onPlatform('darwin', () => keepAwake(4321));
    expect(hold).toEqual({ held: true });

    // An EventEmitter with no 'error' listener THROWS on emit. This is the regression guard.
    const enoent = Object.assign(new Error('spawn /usr/bin/caffeinate ENOENT'), { code: 'ENOENT' });
    expect(() => child.emit('error', enoent)).not.toThrow();
  });

  it('AC-001 the pid is always passed as a decimal string and a non-finite pid is refused without spawning', () => {
    const spawn = jest.spyOn(childProcess, 'spawn').mockReturnValue(new FakeChild() as unknown as childProcess.ChildProcess);

    const bad = onPlatform('darwin', () => keepAwake(Number.NaN));

    expect(spawn).not.toHaveBeenCalled();
    expect(bad.held).toBe(false);
  });
});
