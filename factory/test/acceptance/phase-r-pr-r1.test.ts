/**
 * ACCEPTANCE TESTS — Phase R, PR R-1 (R1, R2, R3, R8).
 *
 * One test per acceptance criterion of the approved user story
 * (`.factory/<run>/USER_STORY.md`, AC-001 … AC-011), each named after the criterion it proves.
 * These are deliberately OUTSIDE-IN: they drive whole runs through `runFeatureFactory` (via the
 * `runToEnd` fixture), the real `createSdkInvoker` against a fake SDK, and the REAL change tracker
 * against REAL git repositories in temp directories. The unit tests the builders wrote assert how
 * each module behaves; these assert that the four behaviours the story asked for are true of the
 * factory as a whole.
 *
 * No network, no real agent, no `caffeinate` actually spawned (the spawn is spied), and nothing
 * sleeps: R3's 30-second wait is the injected seam, as `barriers.ts` requires.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import childProcess = require('child_process');
import { EventEmitter } from 'events';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { CAFFEINATE_COMMAND, CAFFEINATE_FLAGS, keepAwake as productionKeepAwake } from '../../harness/keep-awake';
import { FACTORY_EXCLUDE_ENTRY } from '../../harness/git-exclude';
import { DEFAULT_CHANGE_TRACKER } from '../../harness/change-diff';
import { loadState, saveState } from '../../harness/state-store';
import { AgentInvocationRecord, ChangeBase, FeatureState, stage3SnapshotPassedBy } from '../../harness/state-tracker';
import {
  AgentInvocation,
  AgentInvocationError,
  createSdkInvoker,
  MAX_OUTPUT_TOKENS_VALUE,
  MAX_OUTPUT_TOKENS_VAR
} from '../../runner/invoke-agent';
import { AGENT_COST, FeatureFactoryAgent } from '../../runner/agent-registry';
import { classifyInvocationError, TRANSIENT_RETRY_WAIT_MS } from '../../runner/transient-errors';
import { ChangeTracker } from '../../harness/change-diff';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { fakeChangeTracker } from '../fixtures/changes';
import { skeptic, validator } from '../fixtures/agent-outputs';
import {
  InvokerScript,
  passingScript,
  removeTree,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';
import { gitignore, isolateHarnessGit, linkedWorktree, setupGit, trackIgnored } from '../fixtures/real-git';

/** A whole scripted run is a few seconds; a real-git snapshot a little more. */
const RUN_TIMEOUT_MS = 60_000;

/** The repository root, from `factory/test/acceptance/`. */
const ROOT = resolve(__dirname, '..', '..', '..');

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-accept-r1-');
});

afterEach(() => {
  project.cleanup();
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The run as `state.json` holds it on disk — what a resume and `--consolidate` would read. */
const onDisk = (state: FeatureState): FeatureState => loadState(project.dir, state.featureId)!;

/** One agent's invocation records, in order. */
const recordsFor = (state: FeatureState, agent: string): AgentInvocationRecord[] =>
  (state.agentInvocations ?? []).filter(record => record.agent === agent);

/** A spawned child as `keepAwake` uses it: an event emitter with `unref` (and a `kill` nobody should call). */
class FakeChild extends EventEmitter {
  unrefCalls = 0;
  killCalls = 0;
  unref(): this {
    this.unrefCalls++;
    return this;
  }
  kill(): boolean {
    this.killCalls++;
    return true;
  }
}

const REAL_PLATFORM = process.platform;

/** Run `body` as if the machine were `platform`; the real value is always restored. */
async function onPlatform<T>(platform: NodeJS.Platform, body: () => Promise<T> | T): Promise<T> {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
  }
}

/** Spy on every way a child process can be started, each neutralised so nothing is ever really run. */
function spawnSpies() {
  const child = new FakeChild();
  return {
    child,
    spawn: jest.spyOn(childProcess, 'spawn').mockReturnValue(child as unknown as childProcess.ChildProcess),
    spawnSync: jest.spyOn(childProcess, 'spawnSync').mockReturnValue({} as ReturnType<typeof childProcess.spawnSync>),
    exec: jest.spyOn(childProcess, 'exec').mockReturnValue(child as unknown as childProcess.ChildProcess),
    execFile: jest.spyOn(childProcess, 'execFile').mockReturnValue(child as unknown as childProcess.ChildProcess)
  };
}

/** Records the millisecond value each `waitBeforeRetry` call was asked for; never waits. */
function waitSpy(duringWait?: () => void) {
  const waits: number[] = [];
  return {
    waits,
    waitBeforeRetry: async (ms: number) => {
      waits.push(ms);
      duringWait?.();
    }
  };
}

/** A script in which `agent` throws `error` on its first call and behaves normally afterwards. */
function throwsOnce(agent: string, error: () => unknown, base: InvokerScript = passingScript()): InvokerScript {
  const normal = base[agent as keyof InvokerScript];
  return {
    ...base,
    [agent]: (call: AgentInvocation, callNumber: number) => {
      if (callNumber === 1) throw error();
      return typeof normal === 'function'
        ? (normal as (c: AgentInvocation, n: number) => unknown)(call, callNumber)
        : structuredClone(normal);
    }
  };
}

/** Every `.ts` file under `dir`, recursively, repo-relative. */
function typescriptFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(path.slice(ROOT.length + 1));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Every production directory under `factory/`, i.e. everything that is not `factory/test`.
 *
 * It must be a SUPERSET of the four the pinned single-spawn-site guard in
 * `repo-hygiene.test.ts` scans (`feature/workflows`, `runner`, `harness`, `contracts`), or this
 * acceptance test would be the weaker of the two and a second `spawn(CAFFEINATE_COMMAND, …)`
 * added in an unscanned directory could satisfy it while failing the hygiene test. Derived from
 * the tree rather than hand-listed, so a new production directory is scanned the day it appears.
 */
const PRODUCTION_DIRS = readdirSync(join(ROOT, 'factory'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== 'test')
  .map(entry => `factory/${entry.name}`)
  .sort();

/** The factory's production source: everything but its tests. */
const productionFiles = (): string[] => PRODUCTION_DIRS.flatMap(dir => typescriptFiles(join(ROOT, dir)));

const read = (repoRelative: string): string => readFileSync(join(ROOT, repoRelative), 'utf-8');

/**
 * `source` with its comments removed, so a scan counts what the module DOES rather than what it
 * explains. These modules document the very things being counted ("exactly one `spawn(`", "no
 * `finally`"), which a naive scan would read as code.
 */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** `SKILL.md` with its line wrapping collapsed, the way `doc-drift.test.ts` compares claims. */
const skillMd = (): string => read('factory/feature/SKILL.md').replace(/\s+/g, ' ');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A fake Agent SDK, for R2. `query` records the options it was handed and succeeds once.
// ─────────────────────────────────────────────────────────────────────────────────────────────

type QueryCall = { prompt: string; options: Record<string, unknown> };
const mockQueryCalls: QueryCall[] = [];
const FITS_UNDER_THE_OLD_DEFAULT = { status: 'PASS', note: 'a reply well under 32k' };

function mockQuery(call: QueryCall): AsyncIterable<unknown> {
  mockQueryCalls.push(call);
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      permission_denials: [],
      // A FRESH clone per call, deliberately. The invoker returns `message.structured_output`
      // by reference, so yielding the shared constant would make the AC-005 assertion below
      // `expect(X).toEqual(X)` — true for whatever came back, and blind to a rewrite inside the
      // invoker. Cloning here is what lets that assertion compare against an independent value.
      structured_output: structuredClone(FITS_UNDER_THE_OLD_DEFAULT),
      result: '',
      num_turns: 1,
      total_cost_usd: 0
    };
  })();
}

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }));

/** The fake must be the module the invoker really loads, or the assertions below prove nothing. */
async function assertFakeSdk(): Promise<void> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  expect(sdk.query).toBe(mockQuery);
}

/** The `options` the invoker passed to `query()` for one agent. */
async function optionsFor(agent: FeatureFactoryAgent): Promise<Record<string, unknown>> {
  await assertFakeSdk();
  mockQueryCalls.length = 0;
  await createSdkInvoker({ cwd: project.dir })({ stage: 1, agent, prompt: 'go' });
  expect(mockQueryCalls).toHaveLength(1);
  return mockQueryCalls[0].options;
}

/** The environment the agent subprocess would run in. */
const envOf = (options: Record<string, unknown>): Record<string, string> => options.env as Record<string, string>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R1 — keep the machine awake for the whole run
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-001 on macOS the run holds caffeinate -dims -w <orchestrator pid> for the whole run', () => {
  it(
    'AC-001 a run started on macOS spawns caffeinate -dims -w <orchestrator pid> once, from the allow-listed site, and never releases it',
    async () => {
      const spies = spawnSpies();
      const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

      // The REAL seam — not the fixture's no-op — so this test exercises production's own hold.
      const state = await onPlatform('darwin', () =>
        runToEnd({ cwd: project.dir, invoke: invoker.invoke, keepAwake: productionKeepAwake })
      );

      expect(state.completionStatus).toBe('SUCCESS');

      // Exactly one hold for the whole run: taken at run start, never re-taken per stage.
      expect(spies.spawn).toHaveBeenCalledTimes(1);
      const [command, args, options] = spies.spawn.mock.calls[0];
      expect(command).toBe(CAFFEINATE_COMMAND);
      // Argv built in code, the pid the ORCHESTRATOR's own: `-w` is what makes the hold last
      // exactly as long as this process and release itself afterwards.
      expect(args).toEqual([...CAFFEINATE_FLAGS, '-w', String(process.pid)]);
      expect(args).toEqual(['-dims', '-w', String(process.pid)]);
      expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
      // No shell in any form: `shell: '/bin/sh'` would word-split the argv just as `true` would.
      expect(options).not.toHaveProperty('shell');

      // The two details without which this "reliability" fix would break every run: unref, or the
      // orchestrator could never exit; an 'error' listener, or an ENOENT is an uncaught exception.
      expect(spies.child.unrefCalls).toBe(1);
      expect(spies.child.listenerCount('error')).toBe(1);

      // No explicit release: the hold is still held when the run ends (AC-001 — "no explicit
      // release call is required"). Nothing in the run killed it.
      expect(spies.child.killCalls).toBe(0);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-001 the ORCHESTRATOR takes the hold: once, with its own process.pid, on a run that really runs — and not on one that is refused',
    async () => {
      // A RECORDING double, not a platform stub: this is the orchestrator-level half of AC-001,
      // and it holds on every platform. A call site deleted entirely, re-taken per stage, or
      // handed something other than the orchestrator's own pid fails here.
      const pids: number[] = [];
      const recording = (pid: number) => {
        pids.push(pid);
        return { held: true as const };
      };

      const state = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
        keepAwake: recording
      });

      expect(state.completionStatus).toBe('SUCCESS');
      // `-w <pid>` is what makes the hold last exactly as long as THIS process and then release
      // itself, so the pid must be the orchestrator's own.
      expect(pids).toEqual([process.pid]);

      // And no hold for a run that runs NOTHING: the pre-flight refusals come first, deliberately
      // (brief §3 step 6), because `-w <pid>` releases on the process, not the run — a hold taken
      // for a refused start would linger in a long-lived library caller.
      const refused = tempProject('ff-accept-r1-refused-');
      try {
        pids.length = 0;
        await expect(
          runToEnd({
            cwd: refused.dir,
            invoke: scriptedInvoker(passingScript(), { cwd: refused.dir }).invoke,
            keepAwake: recording,
            featureDescription: ''
          })
        ).rejects.toThrow(/description/i);
        expect(pids).toEqual([]);
      } finally {
        refused.cleanup();
      }
    },
    RUN_TIMEOUT_MS
  );

  it('AC-001 the hold is self-terminating: nothing the seam hands back can release it', async () => {
    const code = withoutComments(read('factory/harness/keep-awake.ts'));

    // `-w <pid>` IS the release. A `kill`, a `finally` or a stored handle would be a second
    // mechanism that could fire early (or never) — the story puts an explicit kill out of scope.
    expect(code).not.toMatch(/\.kill\(/);
    expect(code).not.toMatch(/\bfinally\b/);
    expect(code).toContain("'-w'");

    // And the BEHAVIOURAL half, which a source scan cannot give: what the seam returns carries
    // no release of any kind, on either platform, so the orchestrator has nothing to call even
    // if a later change wanted to. (Asserted over the real value rather than the type: a
    // `hold.kill()` regex can never fail, since `KeepAwakeHold` would not compile with one.)
    const spies = spawnSpies();
    const held = (await onPlatform('darwin', () => productionKeepAwake(process.pid))) as unknown as Record<string, unknown>;
    const notHeld = (await onPlatform('linux', () => productionKeepAwake(process.pid))) as unknown as Record<string, unknown>;
    for (const hold of [held, notHeld]) {
      expect(Object.values(hold).some(value => typeof value === 'function')).toBe(false);
    }
    expect(spies.child.killCalls).toBe(0);
  });
});

describe('AC-002 off macOS the keep-awake behaviour is a no-op', () => {
  it.each(['linux', 'win32'] as NodeJS.Platform[])(
    'AC-002 on %s no caffeinate (or any other child process) is spawned, and the run behaves as it does today',
    async platform => {
      // The control: the same run, same script, with the keep-awake seam doing nothing at all.
      const control = scriptedInvoker(passingScript(), { cwd: project.dir });
      const expected = await runToEnd({ cwd: project.dir, invoke: control.invoke });
      // Pin the control first, so two runs that escalated the same way cannot pass as "identical".
      expect(expected.completionStatus).toBe('SUCCESS');

      const other = tempProject('ff-accept-r1-nonmac-');
      try {
        const spies = spawnSpies();
        const invoker = scriptedInvoker(passingScript(), { cwd: other.dir });

        const state = await onPlatform(platform, () =>
          runToEnd({ cwd: other.dir, invoke: invoker.invoke, keepAwake: productionKeepAwake })
        );

        // Nothing is spawned AT ALL — not caffeinate, not an equivalent.
        expect(spies.spawn).not.toHaveBeenCalled();
        expect(spies.spawnSync).not.toHaveBeenCalled();
        expect(spies.exec).not.toHaveBeenCalled();
        expect(spies.execFile).not.toHaveBeenCalled();

        // "the run's behavior is otherwise identical to today": same outcome, same agents, in
        // the same order, as the run whose hold did nothing.
        expect(state.completionStatus).toBe(expected.completionStatus);
        expect(invoker.agents()).toEqual(control.agents());
      } finally {
        other.cleanup();
      }
    },
    RUN_TIMEOUT_MS
  );
});

describe('AC-003 one spawn site, and no no-spawn assertion left asserting a false thing', () => {
  it('AC-003 exactly one production file spawns caffeinate, with exactly one spawn call', () => {
    const scanned = productionFiles();

    // The scan is only worth as much as its reach. These are the four directories the pinned
    // guard in `repo-hygiene.test.ts` covers; a narrower scan here would let a second spawn site
    // pass this test while failing that one.
    for (const file of [
      'factory/feature/workflows/feature-factory-orchestrator.ts',
      'factory/runner/cli.ts',
      'factory/harness/change-diff.ts',
      'factory/contracts/feature-spec.ts'
    ]) {
      expect(scanned).toContain(file);
    }
    expect(scanned.every(path => !path.startsWith('factory/test/'))).toBe(true);

    const spawnsCaffeinate = scanned.filter(path => {
      const code = withoutComments(read(path));
      return /\bspawn\s*\(/.test(code) && /caffeinate/i.test(code);
    });

    expect(spawnsCaffeinate).toEqual(['factory/harness/keep-awake.ts']);
    expect(withoutComments(read('factory/harness/keep-awake.ts')).match(/\bspawn\(/g)).toHaveLength(1);
    // The command and the flags are module constants, so the documented argv cannot drift.
    expect(CAFFEINATE_COMMAND).toBe('/usr/bin/caffeinate');
    expect([...CAFFEINATE_FLAGS]).toEqual(['-dims']);
  });

  it(
    'AC-003 the whole-run fixtures inject an explicit no-op hold, and the real seam proves that double is not vacuous',
    async () => {
      // With the fixture's explicit double, a full run on macOS spawns nothing — which is what
      // makes `orchestrator-gates.test.ts` AC-1 and `cli.test.ts` AC-63 true rather than lucky.
      const silent = spawnSpies();
      const quiet = await onPlatform('darwin', () =>
        runToEnd({ cwd: project.dir, invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke })
      );
      expect(quiet.completionStatus).toBe('SUCCESS');
      expect(silent.spawn).not.toHaveBeenCalled();
      jest.restoreAllMocks();

      // And the seam those tests stub is a LIVE path: given production's own hold, the very same
      // run does spawn. Without this half, the assertion above could pass over dead code.
      const other = tempProject('ff-accept-r1-seam-');
      try {
        const loud = spawnSpies();
        await onPlatform('darwin', () =>
          runToEnd({
            cwd: other.dir,
            invoke: scriptedInvoker(passingScript(), { cwd: other.dir }).invoke,
            keepAwake: productionKeepAwake
          })
        );
        expect(loud.spawn).toHaveBeenCalledTimes(1);
      } finally {
        other.cleanup();
      }
    },
    RUN_TIMEOUT_MS
  );

  it('AC-003 every test that asserts "no child process is spawned" around a whole run names a keep-awake double', () => {
    for (const path of ['factory/test/runner/cli.test.ts', 'factory/test/harness/orchestrator-gates.test.ts']) {
      const source = read(path);
      // Each of these spies on child_process around a full CLI / orchestrator run. `jest.spyOn`
      // without an implementation CALLS THROUGH, so without an injected hold the assertion would
      // be false on macOS (and would really hold the Jest worker's machine awake).
      expect(source).toMatch(/jest\.spyOn\(\s*childProcess\s*,\s*'spawn'\s*\)/);
      // The same shape the fixture uses, not a bare substring: `toContain('keepAwake')` would
      // pass on a mention in a comment and would not tie the double to an injection site.
      expect(source).toMatch(/keepAwake:\s*(\(\)\s*=>\s*\(\{\s*held:\s*false|NO_OP_KEEP_AWAKE)/);
    }
    // The shared whole-run fixture supplies the default, so no test inherits a real hold.
    expect(read('factory/test/fixtures/harness-run.ts')).toMatch(/keepAwake:\s*\(\)\s*=>\s*\(\{\s*held:\s*false/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R2 — raise the reply limit
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-004 every agent invocation runs with CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000', () => {
  const EVERY_AGENT = Object.keys(AGENT_COST) as FeatureFactoryAgent[];

  it('AC-004 the factory has an agent to cover: builders, writers, reviewers, skeptics and the validator', () => {
    expect(EVERY_AGENT).toEqual(
      expect.arrayContaining([
        '01-researcher',
        '02-story-writer',
        '03-spec-writer',
        '04-backend-builder',
        '05-frontend-builder',
        '06-test-verifier',
        '07-validator',
        '07b-validator-followup',
        '07c-validator-skeptic'
      ])
    );
  });

  it.each(EVERY_AGENT)('AC-004 %s is invoked with the 64000 ceiling in its environment', async agent => {
    const env = envOf(await optionsFor(agent));

    expect(env[MAX_OUTPUT_TOKENS_VAR]).toBe('64000');
    expect([MAX_OUTPUT_TOKENS_VAR, MAX_OUTPUT_TOKENS_VALUE]).toEqual(['CLAUDE_CODE_MAX_OUTPUT_TOKENS', '64000']);
  });

  it('AC-004 the new variable is added TO the inherited environment, never in place of it', async () => {
    process.env.FF_ACCEPTANCE_SENTINEL = 'inherited';
    try {
      const env = envOf(await optionsFor('04-backend-builder'));

      // The SDK's `options.env` REPLACES the subprocess environment, so a missing spread would
      // strip PATH, HOME and the credentials the agent needs — breaking every invocation.
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME).toBe(process.env.HOME);
      expect(env.FF_ACCEPTANCE_SENTINEL).toBe('inherited');
      expect(env[MAX_OUTPUT_TOKENS_VAR]).toBe(MAX_OUTPUT_TOKENS_VALUE);
    } finally {
      delete process.env.FF_ACCEPTANCE_SENTINEL;
    }
  });

  it("AC-004 the factory's 64000 wins over a value already set in the operator's shell", async () => {
    const saved = process.env[MAX_OUTPUT_TOKENS_VAR];
    process.env[MAX_OUTPUT_TOKENS_VAR] = '8000';
    try {
      expect(envOf(await optionsFor('07-validator'))[MAX_OUTPUT_TOKENS_VAR]).toBe('64000');
    } finally {
      if (saved === undefined) delete process.env[MAX_OUTPUT_TOKENS_VAR];
      else process.env[MAX_OUTPUT_TOKENS_VAR] = saved;
    }
  });

  it('AC-004 the standalone smoke entry points inherit the ceiling, because it lives in the one invoker', () => {
    // The validator script's name is built by concatenation: repo-hygiene S-1 forbids any other
    // file from naming it, since it is operator-only.
    for (const path of ['factory/runner/smoke-researcher.ts', 'factory/runner/smoke-' + 'validator.ts']) {
      const source = read(path);
      // They build their own invoker through `createSdkInvoker`, which is where R2 lives, so they
      // get the ceiling without an edit. Neither may call `query()` or set `env` itself.
      expect(source).toContain('createSdkInvoker');
      expect(source).not.toMatch(/\bquery\(/);
      expect(source).not.toMatch(/CLAUDE_CODE_MAX_OUTPUT_TOKENS/);
    }
  });
});

describe('AC-005 a reply that already fitted is unchanged under the new ceiling', () => {
  it('AC-005 a reply well under the old default comes back byte-identically, and the only request change is the environment', async () => {
    await assertFakeSdk();
    mockQueryCalls.length = 0;

    // A named constant, not an `agent: '0N-…'` literal: repo-hygiene AC-2 reserves agent output
    // literals for the shared fixtures in any file that drives the harness.
    const researcher = '01-researcher';
    const output = await createSdkInvoker({ cwd: project.dir })({ stage: 1, agent: researcher, prompt: 'go' });

    // Unchanged output: the ceiling only decides what happens to a reply that would be truncated.
    //
    // Compared against an INDEPENDENT literal, not against `FITS_UNDER_THE_OLD_DEFAULT` itself.
    // The fake yields a fresh clone per call and the invoker returns what it was handed by
    // reference, so comparing with the constant would be `expect(X).toEqual(X)` and could not
    // detect a reply the invoker rewrote or mutated on the way out. This literal can.
    expect(output).toEqual({ status: 'PASS', note: 'a reply well under 32k' });
    // Proof the comparison is independent: what came back is not the constant the test declares.
    expect(output).not.toBe(FITS_UNDER_THE_OLD_DEFAULT);

    // Exactly today's options plus `env`: nothing else about the invocation moved.
    const beforeThisPr = [
      'cwd',
      'model',
      'effort',
      'maxTurns',
      'systemPrompt',
      'outputFormat',
      'allowedTools',
      'disallowedTools',
      'permissionMode',
      'settingSources'
    ];
    expect(Object.keys(mockQueryCalls[0].options).sort()).toEqual([...beforeThisPr, 'env'].sort());

    // A ceiling, not a target: no option asks for more output than before.
    expect(Object.keys(mockQueryCalls[0].options).filter(key => /token/i.test(key))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R3 — retry once on a transient API error
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** A dropped connection, as a raw transport error arrives: the signature in the message. */
const connectionClosed = () => new Error('Connection closed');
/** An SDK failure whose status is in `detail[]` (the SDK's `failure.errors`). */
const overloadedInDetail = () =>
  new AgentInvocationError('Agent 01-researcher failed (error_during_execution).', '01-researcher', 1, [
    'Internal server error: HTTP 503'
  ]);
/** A socket reset, whose signature is a PROPERTY on the error, not text in its message. */
const socketReset = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

describe('AC-006 a transient failure is retried once, after 30 seconds, with both attempts recorded', () => {
  it.each([
    ['the error message', connectionClosed, 'CONNECTION_CLOSED'],
    ['the SDK failure detail', overloadedInDetail, 'HTTP_5XX'],
    ["the error object's code", socketReset, 'ECONNRESET']
  ] as Array<[string, () => unknown, string]>)(
    'AC-006 a transient signal in %s is waited out for 30s, retried exactly once, and both attempts are in agentInvocations',
    async (_carrier, error, signal) => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(throwsOnce('01-researcher', error), { cwd: project.dir });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        waitBeforeRetry: wait.waitBeforeRetry
      });

      // Exactly one wait, of exactly 30 seconds: the bound is one and the wait is not a loop.
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);
      expect(TRANSIENT_RETRY_WAIT_MS).toBe(30_000);

      // The SAME invocation, re-invoked: same agent, same prompt, same configuration.
      const prompts = invoker.promptsFor('01-researcher');
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toBe(prompts[1]);

      // Both attempts on record, each identifiable, with the matched signal on the failed one.
      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(2);
      expect(records.map(record => record.invocationAttempt)).toEqual([1, 2]);
      expect(records[0].outcome).toBe('threw');
      expect(records[0].transientSignal).toBe(signal);
      expect(records[1].outcome).toBeUndefined();
      // The retry's own record carries no signal: only the attempt whose failure EARNED the
      // retry does.
      expect(records[1].transientSignal).toBeUndefined();

      // Each attempt is timed for itself (brief §3 property 1), so `metrics.timePerStage` still
      // means something. Asserted as "the retry started at or after the first attempt ENDED",
      // which two records sharing one timestamp cannot satisfy by accident, plus a real duration
      // field on each — nothing here is a single measurement reported twice.
      for (const record of records) {
        expect(typeof record.durationMs).toBe('number');
        expect(record.durationMs).toBeGreaterThanOrEqual(0);
        expect(Date.parse(record.completedAt)).toBeGreaterThanOrEqual(Date.parse(record.startedAt));
      }
      expect(Date.parse(records[1].startedAt)).toBeGreaterThanOrEqual(Date.parse(records[0].completedAt));
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-006 the bound is exactly ONE: when the same transient error recurs the run escalates after two attempts, not three',
    async () => {
      // Every other transient case in this file succeeds on attempt 2, so the loop terminates on
      // success whatever its bound is — a bound of 1, of 5 or of infinity would pass them all.
      // This is the case that distinguishes them: an error that NEVER stops.
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        {
          ...passingScript(),
          '01-researcher': () => {
            throw connectionClosed();
          }
        },
        { cwd: project.dir }
      );

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      // The run stops rather than retrying for ever, and it waited exactly once.
      expect(state.completionStatus).toBe('ESCALATED');
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);
      // Two invocations of the agent in all — the first and its single retry.
      expect(invoker.promptsFor('01-researcher')).toHaveLength(2);

      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(2);
      expect(records.map(record => record.outcome)).toEqual(['threw', 'threw']);
      // Both attempts of one retried invocation are marked, as SKILL.md says they are...
      expect(records.map(record => record.invocationAttempt)).toEqual([1, 2]);
      // ...and only the attempt whose failure earned the retry carries the signal.
      expect(records[0].transientSignal).toBe('CONNECTION_CLOSED');
      expect(records[1].transientSignal).toBeUndefined();
      // The original error escalated unchanged: the second failure is rethrown, never wrapped.
      expect((state.escalations ?? []).map(escalation => escalation.context.message).join('\n')).toContain('Connection closed');
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-006 the failed attempt is on record BEFORE the 30-second wait starts, so a kill inside the window loses nothing',
    async () => {
      let duringWait: FeatureState | undefined;
      const invoker = scriptedInvoker(throwsOnce('01-researcher', connectionClosed), { cwd: project.dir });
      // Read state.json from inside the injected wait: exactly where a killed process would stop.
      const wait = waitSpy(() => {
        const factory = join(project.dir, '.factory');
        const ids = readdirSync(factory).filter(name => existsSync(join(factory, name, 'state.json')));
        duringWait = loadState(project.dir, ids[0])!;
      });

      await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      const already = (duringWait?.agentInvocations ?? []).filter(record => record.agent === '01-researcher');
      expect(already).toHaveLength(1);
      expect(already[0].outcome).toBe('threw');
      expect(already[0].transientSignal).toBe('CONNECTION_CLOSED');
    },
    RUN_TIMEOUT_MS
  );

  it.each([
    ['Connection closed', new Error('Connection closed'), 'CONNECTION_CLOSED'],
    ['HTTP 429', new Error('Request failed: HTTP 429'), 'HTTP_429'],
    ['HTTP 529', new Error('status code: 529 overloaded'), 'HTTP_529'],
    ['another 5xx', new Error('503 Service Unavailable'), 'HTTP_5XX'],
    ['ECONNRESET', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), 'ECONNRESET'],
    ['EPIPE', Object.assign(new Error('write failed'), { code: 'EPIPE' }), 'EPIPE']
  ] as Array<[string, unknown, string]>)(
    'AC-006 %s is classified transient, so the factory retries it',
    (_name, error, signal) => {
      expect(classifyInvocationError(error)).toEqual({ kind: 'transient', signal });
    }
  );

  it('AC-006 a bare integer is never read as an HTTP status, so a token count or a duration triggers no retry', () => {
    for (const text of ['the agent used 529 tokens', 'finished in 503 ms', 'cost 429 cents', 'src/a.ts:500 is long']) {
      expect(classifyInvocationError(new Error(text))).toEqual({ kind: 'unknown' });
    }
  });
});

describe('AC-007 a failure that would reproduce on a retry is never retried', () => {
  it(
    'AC-007 a max-turns failure escalates with one record and no wait, exactly as it does today',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        {
          ...passingScript(),
          '01-researcher': () => {
            throw new AgentInvocationError('Agent 01-researcher failed (error_max_turns).', '01-researcher', 1, []);
          }
        },
        { cwd: project.dir }
      );

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      expect(state.completionStatus).toBe('ESCALATED');
      expect(wait.waits).toEqual([]);
      expect(invoker.promptsFor('01-researcher')).toHaveLength(1);

      const records = recordsFor(onDisk(state), '01-researcher');
      expect(records).toHaveLength(1);
      // A record that was not retried carries NEITHER new field: it means what it meant before.
      expect(records[0].invocationAttempt).toBeUndefined();
      expect(records[0].transientSignal).toBeUndefined();
      // The ORIGINAL error text reached the escalation: R3 rethrows, it never wraps.
      expect((state.escalations ?? []).map(escalation => escalation.context.message).join('\n')).toContain('error_max_turns');
    },
    RUN_TIMEOUT_MS
  );

  it.each([
    ['a max-turns failure', new AgentInvocationError('Agent 06-test-verifier failed (error_max_turns).', '06-test-verifier', 4, [])],
    [
      'a structured-output retry limit',
      new AgentInvocationError('Agent 07-validator failed (error_max_structured_output_retries).', '07-validator', 4, [])
    ],
    [
      'an output-token-limit failure',
      new AgentInvocationError('Agent 04-backend-builder failed (error_during_execution).', '04-backend-builder', 3, [
        'the assistant hit max_output_tokens'
      ])
    ],
    ['a schema failure', new AgentInvocationError('Agent 02-story-writer returned no structured output.', '02-story-writer', 2, [''])]
  ] as Array<[string, unknown]>)('AC-007 %s is classified never-retry', (_name, error) => {
    const verdict = classifyInvocationError(error);
    expect(verdict.kind).toBe('never-retry');
  });

  it('AC-007 a fatal failure that also mentions a transient one is still never retried: the fatal table is matched first', () => {
    const both = new AgentInvocationError('Agent 01-researcher failed (error_max_turns).', '01-researcher', 1, ['Connection closed']);

    expect(classifyInvocationError(both).kind).toBe('never-retry');
  });

  it(
    'AC-007 an unrecognised failure is not retried either: only the listed signatures are, everything else escalates as before',
    async () => {
      const wait = waitSpy();
      const invoker = scriptedInvoker(
        {
          ...passingScript(),
          '01-researcher': () => {
            throw new AgentInvocationError('Agent 01-researcher failed (error_during_execution).', '01-researcher', 1, [
              'something nobody has seen before'
            ]);
          }
        },
        { cwd: project.dir }
      );

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      expect(state.completionStatus).toBe('ESCALATED');
      expect(wait.waits).toEqual([]);
      expect(recordsFor(onDisk(state), '01-researcher')).toHaveLength(1);
    },
    RUN_TIMEOUT_MS
  );
});

describe('AC-008 a successful retry is invisible to every downstream stage', () => {
  it(
    'AC-008 a retried Researcher invocation lets the run continue to SUCCESS, with the retry visible only as a second record',
    async () => {
      // The control runs in its own project: a run that never blipped.
      const other = tempProject('ff-accept-r1-control-');
      let expected: FeatureState;
      try {
        const control = scriptedInvoker(passingScript(), { cwd: other.dir });
        expected = await runToEnd({ cwd: other.dir, invoke: control.invoke });
        expect(expected.completionStatus).toBe('SUCCESS');
        expected = loadState(other.dir, expected.featureId)!;
      } finally {
        other.cleanup();
      }

      const invoker = scriptedInvoker(throwsOnce('01-researcher', connectionClosed), { cwd: project.dir });
      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: async () => {} });

      // Same outcome, same chain, same stage history as the control: the only difference
      // anywhere downstream is the one extra invocation record.
      expect(state.completionStatus).toBe('SUCCESS');
      expect(state.stageHistory.map(step => [step.agent, step.status])).toEqual(
        expected.stageHistory.map(step => [step.agent, step.status])
      );
      expect(recordsFor(onDisk(state), '01-researcher')).toHaveLength(2);
      expect((onDisk(state).agentInvocations ?? []).length).toBe((expected.agentInvocations ?? []).length + 1);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-008 a retry inside the Test Verifier / Validator parallel section still waits for both branches and reaches SUCCESS',
    async () => {
      // The control: the same parallel section with no blip anywhere, in its own project. Its
      // step sequence is what "the order the harness always uses" MEANS here — recomputed, not
      // hardcoded, so this test cannot drift away from the real decision order.
      const other = tempProject('ff-accept-r1-parallel-control-');
      let expectedSteps: string[];
      try {
        const control = await runToEnd({
          cwd: other.dir,
          invoke: scriptedInvoker(passingScript(), { cwd: other.dir }).invoke
        });
        expect(control.completionStatus).toBe('SUCCESS');
        expectedSteps = loadState(other.dir, control.featureId)!.stageHistory.map(step => step.agent);
      } finally {
        other.cleanup();
      }

      const wait = waitSpy();
      const invoker = scriptedInvoker(throwsOnce('06-test-verifier', connectionClosed), { cwd: project.dir });

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);

      const saved = onDisk(state);
      // The slowed branch finished, and so did its partner: neither was left running.
      expect(recordsFor(saved, '06-test-verifier').map(record => record.invocationAttempt)).toEqual([1, 2]);
      expect(recordsFor(saved, '07-validator')).toHaveLength(1);
      expect(recordsFor(saved, '07-validator')[0].invocationAttempt).toBeUndefined();

      // Both verdicts were decided, and in the SAME RELATIVE ORDER as the un-blipped control.
      // Compared as one sequence, not per agent: filtering each agent out separately discards
      // exactly the relative order this criterion is about, so a swapped decision order would
      // not fail it.
      const steps = saved.stageHistory.map(step => step.agent);
      expect(steps).toEqual(expectedSteps);
      const verifierAt = steps.indexOf('06-test-verifier');
      const validatorAt = steps.indexOf('07-validator');
      expect(verifierAt).toBeGreaterThanOrEqual(0);
      // The decision order is evaluated after BOTH branches settle, so the slowed branch is
      // still decided first — the retry made it later in wall-clock, not later in the order.
      expect(verifierAt).toBeLessThan(validatorAt);
      expect(saved.stageHistory.filter(step => step.agent === '06-test-verifier').map(step => step.status)).toEqual(['PASS']);
      expect(saved.stageHistory.filter(step => step.agent === '07-validator').map(step => step.status)).toEqual(['PASS']);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-008 a retry on skeptic A (A || B) leaves neither skeptic running, and the verdict is the one it would have been',
    async () => {
      // AC-008 names the two skeptics as the other parallel section a retry must not break, and
      // a clean run never reaches them: the skeptics are only dispatched for a CRITICAL issue,
      // so this test has to route one.
      const critical: ValidatorIssue = {
        severity: 'CRITICAL',
        file: 'src/a.ts',
        line: 1,
        message: 'Route has no auth check',
        suggestion: 'Add the guard',
        canFix: true
      };
      const wait = waitSpy();
      /** How many times each skeptic instance has been invoked, read out of its own prompt. */
      const callsPerInstance: Record<string, number> = { A: 0, B: 0 };

      const invoker = scriptedInvoker(
        {
          ...passingScript(),
          // FAIL with the CRITICAL first so two skeptics are dispatched, then pass so the run
          // finishes rather than looping.
          '07-validator': (_call: AgentInvocation, n: number) =>
            n === 1 ? validator({ status: 'FAIL', issues: [critical] }) : validator(),
          '07c-validator-skeptic': (call: AgentInvocation) => {
            const instance = call.prompt.includes('You are skeptic A.') ? 'A' : 'B';
            callsPerInstance[instance]++;
            // Only skeptic A's FIRST invocation blips; its retry and B both succeed.
            if (instance === 'A' && callsPerInstance.A === 1) throw connectionClosed();
            return skeptic({ verdict: 'UPHELD' })(call);
          }
        },
        { cwd: project.dir }
      );

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: wait.waitBeforeRetry });

      expect(wait.waits).toEqual([TRANSIENT_RETRY_WAIT_MS]);

      const saved = onDisk(state);
      const records = recordsFor(saved, '07c-validator-skeptic');
      // Three invocations in all: A's failed attempt, A's retry, and B's single call.
      expect(records).toHaveLength(3);

      // Split by instance rather than by position: A fails fast and then waits while B is still
      // running, so B's record may well be committed BETWEEN A's two. That interleaving is the
      // retry working; what matters is that each instance's records are right and both settled.
      const a = records.filter(record => record.instance === 'A');
      const b = records.filter(record => record.instance === 'B');
      expect(a.map(record => record.invocationAttempt)).toEqual([1, 2]);
      expect(a[0].outcome).toBe('threw');
      expect(a[0].transientSignal).toBe('CONNECTION_CLOSED');
      expect(a[1].outcome).toBeUndefined();
      // The partner branch is untouched by its sibling's retry.
      expect(b).toHaveLength(1);
      expect(b[0].invocationAttempt).toBeUndefined();
      expect(b[0].outcome).toBeUndefined();

      // BOTH verdicts are on record — the "no skeptic is left running" half of the guarantee —
      // and the decision came out as it would have with no retry at all: both UPHELD, so the
      // issue stood and the owning builder was routed once more, in a validator round.
      const evaluation = (saved.validatorEvaluations ?? []).find(candidate => (candidate.skeptics ?? []).length > 0);
      expect(evaluation).toBeDefined();
      const verdicts = evaluation!.skeptics ?? [];
      expect(new Set(verdicts.map(verdict => verdict.instance))).toEqual(new Set(['A', 'B']));
      expect(verdicts.every(verdict => verdict.verdict === 'UPHELD')).toBe(true);
      expect(saved.stageHistory.filter(step => step.agent === '04-backend-builder').map(step => step.phase)).toEqual([
        'stage3',
        'validator-round'
      ]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-008 a builder retried for a transient error does not spend one of its three attempts',
    async () => {
      const invoker = scriptedInvoker(throwsOnce('04-backend-builder', socketReset), { cwd: project.dir });

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, waitBeforeRetry: async () => {} });

      expect(state.completionStatus).toBe('SUCCESS');

      const records = recordsFor(onDisk(state), '04-backend-builder');
      expect(records).toHaveLength(2);
      // The BUILDER attempt, phase and round are identical on both records: `meta` passed through.
      expect(records.map(record => record.attempt)).toEqual([1, 1]);
      expect(records.map(record => record.invocationAttempt)).toEqual([1, 2]);
      expect(records[0].phase).toBe(records[1].phase);
      // One builder step, so the Stage 3 gate's "Loop Count Within Limits" saw one try, not two.
      expect(onDisk(state).stageHistory.filter(step => step.agent === '04-backend-builder')).toHaveLength(1);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-008 a run whose agentInvocations predate this PR (no retry marker at all) resumes exactly as one recorded by it does',
    async () => {
      // A run that retried once and then escalated at the Validator, built TWICE in two
      // projects: one copy keeps the new fields, the other has them stripped the way a pre-R-1
      // `state.json` is. Resuming both and comparing the outcomes is what makes "exactly as"
      // an equality that is computed rather than a hardcoded expectation that happens to hold.
      const escalatingScript = () => ({ ...passingScript(), '07-validator': validator({ status: 'ESCALATE' }) });

      /** Run to the Validator's ESCALATE in `dir`, optionally strip the new fields, then resume. */
      async function escalateThenResume(dir: string, strip: boolean) {
        const first = await runToEnd({
          cwd: dir,
          invoke: scriptedInvoker(throwsOnce('01-researcher', connectionClosed, escalatingScript()), { cwd: dir }).invoke,
          waitBeforeRetry: async () => {}
        });
        expect(first.completionStatus).toBe('ESCALATED');

        const recorded = loadState(dir, first.featureId)!;
        expect((recorded.agentInvocations ?? []).some(record => record.invocationAttempt !== undefined)).toBe(true);

        if (strip) {
          // Strip BOTH new fields from every record: a run recorded before this PR has neither.
          const stripped: FeatureState = {
            ...recorded,
            agentInvocations: (recorded.agentInvocations ?? []).map(record => {
              const { invocationAttempt, transientSignal, ...old } = record;
              return old as AgentInvocationRecord;
            })
          };
          saveState(dir, stripped);
          expect((loadState(dir, first.featureId)!.agentInvocations ?? []).every(r => r.invocationAttempt === undefined)).toBe(true);
        }

        const resumedInvoker = scriptedInvoker(passingScript(), { cwd: dir });
        const resumed = await runToEnd({
          cwd: dir,
          invoke: resumedInvoker.invoke,
          resumeFromState: loadState(dir, first.featureId)!
        });
        return {
          resumed,
          agents: resumedInvoker.agents(),
          snapshotKept: stage3SnapshotPassedBy(loadState(dir, first.featureId)!, { phase: 'stage3' })
        };
      }

      const old = await escalateThenResume(project.dir, true);

      const control = tempProject('ff-accept-r1-pre-r1-control-');
      try {
        const current = await escalateThenResume(control.dir, false);

        // The resume is decided from `state.json`, and a missing optional field changes nothing:
        // same outcome, same agents re-run, as the identical run recorded WITH the fields.
        expect(old.resumed.completionStatus).toBe('SUCCESS');
        expect(old.resumed.completionStatus).toBe(current.resumed.completionStatus);
        expect(old.agents).toEqual(['07-validator']);
        expect(old.agents).toEqual(current.agents);
        // Brief §2 / R3-4: the extra retry record cannot change AC-157's `.some()` verdict, and
        // neither can its absence — the two states agree on whether a rework's snapshot is kept.
        expect(old.snapshotKept).toBe(current.snapshotKept);
      } finally {
        control.cleanup();
      }
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R8 — the snapshot works when `.factory/` is ignored, and the factory hides `.factory/` itself
//
// REAL git, in temp repositories these tests create. Nothing here touches this repository.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-009 the Stage 3 snapshot succeeds whether or not the project ignores .factory/', () => {
  let restoreGit: () => void;

  beforeEach(() => {
    restoreGit = isolateHarnessGit();
  });

  afterEach(() => {
    restoreGit();
  });

  /** A repository with one commit, a `.factory/` run directory, and a source file. */
  function repo(): ChangeBase {
    setupGit(project.dir, ['init', '-q']);
    mkdirSync(join(project.dir, 'src'), { recursive: true });
    writeFileSync(join(project.dir, 'src/a.ts'), 'export const a = 1;\n');
    mkdirSync(join(project.dir, '.factory/run-1'), { recursive: true });
    writeFileSync(join(project.dir, '.factory/run-1/state.json'), '{"featureId":"run-1"}\n');
    setupGit(project.dir, ['add', 'src/a.ts']);
    setupGit(project.dir, ['commit', '-q', '-m', 'base']);
    return { kind: 'git', commit: setupGit(project.dir, ['rev-parse', 'HEAD']).trim(), branch: 'refs/heads/' + setupGit(project.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), preExisting: [] };
  }

  /** The paths a snapshot tree holds, sorted. */
  const treeOf = (tree: string): string[] =>
    setupGit(project.dir, ['ls-tree', '-r', '--name-only', tree])
      .split('\n')
      .filter(line => line.length > 0)
      .sort();

  /** Take the Stage 3 snapshot the orchestrator would take, through the real tracker. */
  const snapshot = (base: ChangeBase, n = 1) => DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'accept-r1', n);

  it('AC-009 the premise, recorded: the pathspec this PR removed is what made git refuse the add when .factory/ is ignored', async () => {
    const base = repo();
    gitignore(project.dir, ['.factory/']);
    const index = join(project.dir, 'old-style-index');

    // Exactly the call the snapshot used to make. On the git this PR was built against (2.39.5)
    // it exits 1 — "The following paths are ignored... use -f" — which is the stop this PR
    // exists to remove.
    //
    // RECORDED, not required. A future git that no longer refuses this would otherwise turn a
    // correct implementation into a red acceptance test pointing at the wrong thing, so the
    // legacy behaviour is observed and reported, and the binding assertion is the one below:
    // whatever the installed git does with the OLD call, the NEW snapshot succeeds.
    let legacyError: string | undefined;
    try {
      setupGit(project.dir, ['add', '-A', '--', '.', ':(exclude).factory'], { GIT_INDEX_FILE: index });
    } catch (error) {
      legacyError = error instanceof Error ? error.message : String(error);
    }
    if (legacyError === undefined) {
      // eslint-disable-next-line no-console
      console.log('AC-009 note: this git does NOT fail the pre-R-1 add; the premise no longer reproduces here.');
    } else {
      expect(legacyError).toMatch(/ignored by one of your \.gitignore files|did not match any files/i);
    }

    // The product, which is what this file is here to judge: the shipped snapshot succeeds.
    const result = await snapshot(base);
    expect(result.kind).toBe('written');
  }, RUN_TIMEOUT_MS);

  it('AC-009 with .factory/ ignored the snapshot succeeds and .factory/ is not in the tree', async () => {
    const base = repo();
    gitignore(project.dir, ['.factory/']);

    const result = await snapshot(base);

    expect(result.kind).toBe('written');
    const paths = treeOf((result as { tree: string }).tree);
    expect(paths).toContain('src/a.ts');
    expect(paths.some(path => path.startsWith('.factory'))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it('AC-009 the tree is the SAME whether or not .factory/ is ignored: this PR changed robustness, not content', async () => {
    const base = repo();
    writeFileSync(join(project.dir, 'untracked.txt'), 'untracked but not ignored\n');
    trackIgnored(project.dir, 'secret.env', 'TOKEN=1\n');
    gitignore(project.dir, ['secret.env']);

    // Not ignoring `.factory/` yet.
    const before = await snapshot(base, 1);
    expect(before.kind).toBe('written');

    // Now ignore it the way the factory itself does (R8b), which leaves every other file and
    // the .gitignore byte-identical — so an equal tree id is a real content equivalence.
    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });
    const after = await snapshot(base, 2);

    expect(after.kind).toBe('written');
    expect((after as { tree: string }).tree).toBe((before as { tree: string }).tree);
    // Documented content: every non-ignored file plus the tracked-but-ignored ones, no .factory/.
    expect(treeOf((after as { tree: string }).tree)).toEqual(['.gitignore', 'secret.env', 'src/a.ts', 'untracked.txt']);
  }, RUN_TIMEOUT_MS);

  it.each([
    ['untracked and not ignored', false, false],
    ['untracked and ignored', false, true],
    ['tracked and not ignored', true, false],
    ['tracked AND ignored — the story\'s named hazard', true, true]
  ] as Array<[string, boolean, boolean]>)(
    'AC-009 a .factory/ file that is %s is kept out of the tree, and the snapshot still succeeds',
    async (_case, tracked, ignored) => {
      const base = repo();
      if (tracked) trackIgnored(project.dir, '.factory/run-1/tracked.json', '{"tracked":true}\n');
      if (ignored) gitignore(project.dir, ['.factory/']);

      const result = await snapshot(base);

      expect(result.kind).toBe('written');
      expect(treeOf((result as { tree: string }).tree).some(path => path.startsWith('.factory'))).toBe(false);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-009 hostile top-level filenames are captured as the literal paths they are', async () => {
    const base = repo();
    gitignore(project.dir, ['.factory/']);
    const hostile = ['-f', '--', ':(glob)x', ':x', 'a b.txt'];
    for (const name of hostile) writeFileSync(join(project.dir, name), `${name}\n`);

    const result = await snapshot(base);

    expect(result.kind).toBe('written');
    // Top-level names are argv now; this passes only because of `--` and literal pathspecs.
    expect(treeOf((result as { tree: string }).tree)).toEqual(expect.arrayContaining(hostile));
  }, RUN_TIMEOUT_MS);

  it('AC-009 `-A` semantics are preserved: a deletion is staged, and a tracked file inside a fully ignored directory survives', async () => {
    setupGit(project.dir, ['init', '-q']);
    writeFileSync(join(project.dir, 'keep.txt'), 'keep\n');
    writeFileSync(join(project.dir, 'gone.txt'), 'gone\n');
    mkdirSync(join(project.dir, 'logs'), { recursive: true });
    writeFileSync(join(project.dir, 'logs/noise.log'), 'noise\n');
    setupGit(project.dir, ['add', 'keep.txt', 'gone.txt']);
    setupGit(project.dir, ['commit', '-q', '-m', 'base']);
    const base: ChangeBase = {
      kind: 'git',
      commit: setupGit(project.dir, ['rev-parse', 'HEAD']).trim(),
      branch: 'refs/heads/' + setupGit(project.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
      preExisting: []
    };
    gitignore(project.dir, ['.factory/', 'logs/']);
    trackIgnored(project.dir, 'logs/kept.txt', 'tracked inside an ignored directory\n');
    rmSync(join(project.dir, 'gone.txt'));

    const result = await snapshot(base);

    expect(result.kind).toBe('written');
    const paths = treeOf((result as { tree: string }).tree);
    // A deleted tracked file is absent, as `-A` has always made it.
    expect(paths).not.toContain('gone.txt');
    expect(paths).toContain('keep.txt');
    // The ignored directory's content stays out, but its tracked file is recovered.
    expect(paths).toContain('logs/kept.txt');
    expect(paths).not.toContain('logs/noise.log');
  }, RUN_TIMEOUT_MS);

  it.each([
    ['an empty project', (dir: string) => void dir],
    [
      'a project where every top-level entry is ignored',
      (dir: string) => {
        writeFileSync(join(dir, '.gitignore'), '*\n');
        writeFileSync(join(dir, 'ignored.txt'), 'ignored\n');
      }
    ]
  ] as Array<[string, (dir: string) => void]>)('AC-009 %s snapshots to the empty tree instead of failing', async (_name, prepare) => {
    setupGit(project.dir, ['init', '-q']);
    prepare(project.dir);

    const result = await snapshot({ kind: 'git', preExisting: [] });

    expect(result.kind).toBe('written');
    expect(treeOf((result as { tree: string }).tree)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-010 the factory adds .factory/ to the project\'s .git/info/exclude at run start', () => {
  let restoreGit: () => void;

  beforeEach(() => {
    restoreGit = isolateHarnessGit();
  });

  afterEach(() => {
    restoreGit();
  });

  const excludePath = (gitDir = join(project.dir, '.git')) => join(gitDir, 'info', 'exclude');

  function repoWithCommit(dir = project.dir): void {
    setupGit(dir, ['init', '-q']);
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
    setupGit(dir, ['add', 'src.ts']);
    setupGit(dir, ['commit', '-q', '-m', 'base']);
  }

  it('AC-010 the entry is added, and git then ignores the harness\'s own directory', async () => {
    repoWithCommit();
    mkdirSync(join(project.dir, '.factory/run-1'), { recursive: true });
    writeFileSync(join(project.dir, '.factory/run-1/state.json'), '{}\n');

    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });

    expect(readFileSync(excludePath(), 'utf-8')).toContain(`${FACTORY_EXCLUDE_ENTRY}\n`);
    expect(FACTORY_EXCLUDE_ENTRY).toBe('.factory/');
    // The point of the write: `.factory/` is gone from the operator's `git status`.
    expect(setupGit(project.dir, ['status', '--porcelain'])).not.toContain('.factory');
  }, RUN_TIMEOUT_MS);

  it('AC-010 it is never duplicated on a second or a resumed run, in either spelling', async () => {
    repoWithCommit();

    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });
    const afterFirst = readFileSync(excludePath(), 'utf-8');

    // A second run, and a third (the resume): nothing is written and nothing changes.
    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'present' });
    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'present' });
    expect(readFileSync(excludePath(), 'utf-8')).toBe(afterFirst);
    expect(afterFirst.split('\n').filter(line => line.trim() === FACTORY_EXCLUDE_ENTRY)).toHaveLength(1);

    // An operator who wrote `.factory` without the slash gets no second line either.
    const other = tempProject('ff-accept-r1-exclude-');
    try {
      repoWithCommit(other.dir);
      writeFileSync(join(other.dir, '.git/info/exclude'), 'build/\n  .factory  \n');
      expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(other.dir)).toEqual({ kind: 'present' });
      expect(readFileSync(join(other.dir, '.git/info/exclude'), 'utf-8')).toBe('build/\n  .factory  \n');
    } finally {
      other.cleanup();
    }
  }, RUN_TIMEOUT_MS);

  it('AC-010 the operator\'s own entries survive byte for byte, and a file with no trailing newline gets a separator', async () => {
    repoWithCommit();
    const operator = '# mine\nbuild/\n*.tmp';
    writeFileSync(excludePath(), operator);

    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });

    // Appended, never rewritten: the operator's bytes are the prefix of the result.
    expect(readFileSync(excludePath(), 'utf-8')).toBe(`${operator}\n${FACTORY_EXCLUDE_ENTRY}\n`);
  }, RUN_TIMEOUT_MS);

  it('AC-010 the write is local only: nothing is staged, nothing is committed, and the exclude file is not tracked', async () => {
    repoWithCommit();
    const head = setupGit(project.dir, ['rev-parse', 'HEAD']).trim();

    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });

    expect(setupGit(project.dir, ['rev-parse', 'HEAD']).trim()).toBe(head);
    expect(setupGit(project.dir, ['status', '--porcelain']).trim()).toBe('');
    expect(setupGit(project.dir, ['ls-files']).trim()).toBe('src.ts');
  }, RUN_TIMEOUT_MS);

  it('AC-010 a linked worktree whose .git is a FILE gets the entry in the git directory git really reads', async () => {
    repoWithCommit();
    const linked = linkedWorktree(project.dir);
    try {
      // The premise of risk R8-4: `.git` here is a file, so `cwd + '/.git'` would be wrong.
      expect(lstatSync(join(linked.dir, '.git')).isFile()).toBe(true);

      expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(linked.dir)).toEqual({ kind: 'added' });

      // Read it back rather than trusting the choice: this is the file git itself consults.
      expect(readFileSync(join(linked.commonGitDir, 'info', 'exclude'), 'utf-8')).toContain(`${FACTORY_EXCLUDE_ENTRY}\n`);
      mkdirSync(join(linked.dir, '.factory'), { recursive: true });
      writeFileSync(join(linked.dir, '.factory/state.json'), '{}\n');
      expect(setupGit(linked.dir, ['status', '--porcelain'])).not.toContain('.factory');
    } finally {
      removeTree(linked.dir);
    }
  }, RUN_TIMEOUT_MS);

  it.each([
    [
      'outside a git work tree',
      () => {
        /* the temp project is simply not a repository */
      },
      undefined
    ],
    [
      'with the exclude file replaced by a symlink',
      () => {
        repoWithCommit();
        mkdirSync(join(project.dir, '.git/info'), { recursive: true });
        writeFileSync(join(project.dir, 'elsewhere'), 'not ours\n');
        // `git init` writes a sample exclude file; replace it with a link to somewhere else.
        rmSync(excludePath(), { force: true });
        symlinkSync(join(project.dir, 'elsewhere'), excludePath());
      },
      // The link's TARGET, carried in the row so the no-follow proof below cannot be skipped by
      // accident: if this case ever stopped writing the file, the assertion would fail rather
      // than quietly vanish.
      { path: 'elsewhere', content: 'not ours\n' }
    ],
    [
      'with info/ in the way as a regular file',
      () => {
        repoWithCommit();
        rmSync(join(project.dir, '.git/info'), { recursive: true, force: true });
        writeFileSync(join(project.dir, '.git/info'), 'not a directory\n');
      },
      undefined
    ]
  ] as Array<[string, () => void, { path: string; content: string } | undefined]>)(
    'AC-010 %s it is skipped, writes nothing, and never throws',
    async (_name, prepare, untouched) => {
      prepare();

      const result = await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir);

      expect(result.kind).toBe('skipped');
      expect((result as { reason: string }).reason.length).toBeGreaterThan(0);
      // No symlink was followed: the file the link points at is byte-for-byte as it was.
      if (untouched) {
        expect(readFileSync(join(project.dir, untouched.path), 'utf-8')).toBe(untouched.content);
      }
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-010 a run hides .factory/ before it captures its base, on a fresh run and on a resume alike',
    async () => {
      const order: string[] = [];
      const base = fakeChangeTracker({
        hide: async () => {
          order.push('hideFactoryFromGit');
          return { kind: 'added' };
        }
      });
      const tracker: ChangeTracker = {
        ...base,
        captureBase: async (cwd: string) => {
          order.push('captureBase');
          return base.captureBase(cwd);
        }
      };

      // Fresh run: it escalates at the Validator, so there is something to resume.
      const first = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker({ ...passingScript(), '07-validator': validator({ status: 'ESCALATE' }) }, { cwd: project.dir }).invoke,
        changes: tracker
      });
      expect(first.completionStatus).toBe('ESCALATED');
      // Before the base is captured, so the base is captured with `.factory/` already excluded.
      expect(order).toEqual(['hideFactoryFromGit', 'captureBase']);
      // Read from the fixture's own log — what `fakeChangeTracker.hideCalls` exists for: the
      // pre-flight called the SEAM, with the project's cwd, exactly once on this fresh run.
      expect(base.hideCalls).toEqual([{ cwd: project.dir }]);

      // The resume runs it again — which is the only reason "never duplicated on a resumed run"
      // means anything — and never captures a second base.
      const resumed = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
        changes: tracker,
        resumeFromState: onDisk(first)
      });
      expect(resumed.completionStatus).toBe('SUCCESS');
      expect(order).toEqual(['hideFactoryFromGit', 'captureBase', 'hideFactoryFromGit']);
      // Once per run, fresh AND resumed: an accidental `if (!resumed)` around the pre-flight step
      // would leave the second entry missing and nothing else in the suite would notice.
      expect(base.hideCalls).toEqual([{ cwd: project.dir }, { cwd: project.dir }]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-010 a skipped hide never stops the run: the run proceeds and says why',
    async () => {
      const logged: string[] = [];
      const tracker = fakeChangeTracker({ hide: async () => ({ kind: 'skipped', reason: 'not a git work tree' }) });

      const state = await runToEnd({
        cwd: project.dir,
        invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
        changes: tracker,
        logger: message => logged.push(message)
      });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(tracker.hideCalls).toEqual([{ cwd: project.dir }]);
      // Reported at normal level, as an explicitly tolerated outcome — never an escalation.
      expect(logged.join('\n')).toContain('not a git work tree');
      // Nothing escalated at all — said as the equality it is, rather than as a `not.toContain`
      // on a list this SUCCESS run has already guaranteed to be empty.
      expect(state.escalations ?? []).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  // Git is already isolated for this block by its own `beforeEach`.
  it('AC-009 AC-010 the two halves work together: once the factory has hidden .factory/, the snapshot still succeeds', async () => {
    setupGit(project.dir, ['init', '-q']);
    writeFileSync(join(project.dir, 'src.ts'), 'export const a = 1;\n');
    setupGit(project.dir, ['add', 'src.ts']);
    setupGit(project.dir, ['commit', '-q', '-m', 'base']);
    mkdirSync(join(project.dir, '.factory/run-1'), { recursive: true });
    writeFileSync(join(project.dir, '.factory/run-1/state.json'), '{}\n');
    const base = await DEFAULT_CHANGE_TRACKER.captureBase(project.dir);

    // R8b makes R8a's failure condition true in EVERY project, which is why they must ship
    // together: this is the regression guard for that risk.
    expect(await DEFAULT_CHANGE_TRACKER.hideFactoryFromGit(project.dir)).toEqual({ kind: 'added' });
    const result = await DEFAULT_CHANGE_TRACKER.snapshot(project.dir, base, 'accept-r1-both', 1);

    expect(result.kind).toBe('written');
    const tree = setupGit(project.dir, ['ls-tree', '-r', '--name-only', (result as { tree: string }).tree]);
    expect(tree).toContain('src.ts');
    expect(tree).not.toContain('.factory');
  }, RUN_TIMEOUT_MS);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-011 — SKILL.md and the doc-drift claims move with the code
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-011 SKILL.md and its pinned claims match the behaviour this PR ships', () => {
  it('AC-011 the version line names this PR, and the retired one is gone from the intro', () => {
    const intro = read('factory/feature/SKILL.md').split('\n---')[0];

    expect(intro).toContain('(Phase R, PR R-1)');
    expect(intro).not.toContain('PR B-2');
  });

  it('AC-011 the sentence about writing inside .git/ is true again, now that the factory writes info/exclude', () => {
    const skill = skillMd();

    // The old sentence ("never touches your branch, index or working tree" with no exception)
    // became untrue the moment R8b shipped; the new one names the single file and why.
    expect(skill).toContain('the one file it writes inside `.git/` is `info/exclude`');
    expect(skill).toContain(FACTORY_EXCLUDE_ENTRY);
    expect(skill).toMatch(/local(ly)?[^.]{0,80}never committed|never committed/i);
    // The builder-facing rule is untouched and still scoped to builders.
    expect(skill).toContain('never to commit, push, switch branches or write under `.git/` or `.factory/`');
  });

  it('AC-011 the R1 claim matches the code: the argv, the platform no-op, and that a missing hold is not an error', () => {
    const skill = skillMd();

    expect(skill).toContain(`caffeinate ${[...CAFFEINATE_FLAGS].join(' ')} -w <pid>`);
    expect(skill).toMatch(/on macOS/);
    expect(skill).toMatch(/on every other platform nothing is spawned/i);
    expect(skill).toMatch(/releases itself|self-terminating|nothing to clean up/i);
  });

  it('AC-011 the R2 claim matches the code: the variable, the value, and that it is a ceiling added to the environment', () => {
    const skill = skillMd();

    expect(skill).toContain(MAX_OUTPUT_TOKENS_VAR);
    expect(skill).toContain(MAX_OUTPUT_TOKENS_VALUE);
    expect(skill).toMatch(/on top of the environment/i);
    expect(skill).toMatch(/ceiling, not a target/i);
  });

  it('AC-011 the R3 claim matches the code: the bound, the wait, both lists, both records and the field names', () => {
    const skill = skillMd();

    expect(skill).toMatch(/retried \*\*once\*\*|retried once/i);
    expect(skill).toContain(`${TRANSIENT_RETRY_WAIT_MS / 1000} seconds`);
    // Every transient signature the classifier really matches is named...
    for (const signature of ['Connection closed', '429', '529', '5xx', 'ECONNRESET', 'EPIPE']) {
      expect(skill).toContain(signature);
    }
    // ...and so is the never-retry list, and the two record fields the orchestrator writes.
    expect(skill).toMatch(/max-turns/i);
    expect(skill).toMatch(/never\*{0,2} retried|are \*\*never\*\* retried/i);
    expect(skill).toContain('invocationAttempt');
    expect(skill).toContain('transientSignal');
    expect(skill).toMatch(/\*\*Both\*\* attempts are recorded|both attempts are recorded/i);
    // The loop-back claim "every retry is bounded" stays true and is cross-referenced.
    expect(skill).toContain('Every retry is bounded');
  });

  it('AC-011 the snapshot section says what R8a changed, and still documents the same snapshot content', () => {
    const skill = skillMd();

    expect(skill).toMatch(/Whether the project ignores `\.factory\/` makes no difference/i);
    expect(skill).toMatch(/non-ignored top-level entries/i);
    expect(skill).toMatch(/every non-ignored file in the project, tracked or untracked, plus the tracked files that are ignored/i);
  });

  it('AC-011 the pinned doc-drift claims moved in the same change, so the code and the document cannot disagree', () => {
    const pinned = read('factory/test/contracts/doc-drift.test.ts');

    // The claim list is what makes SKILL.md's promises enforceable; it must require this PR's
    // literals, not the previous PR's.
    expect(pinned).toContain('Phase R, PR R-1');
    for (const literal of ['caffeinate', MAX_OUTPUT_TOKENS_VAR, MAX_OUTPUT_TOKENS_VALUE, 'info/exclude', 'Connection closed']) {
      expect(pinned).toContain(literal);
    }
  });
});
