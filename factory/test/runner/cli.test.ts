/**
 * The CLI has an injectable entry point (AC-63), and it is thin (D-11).
 *
 * `main()` used to reach straight for createSdkInvoker, readline, process.stdin.isTTY and
 * process.exit, so nothing about the CLI — its exit codes, its fail-closed checkpoint wiring —
 * could be tested without a real agent run. runCli takes those as dependencies, mirroring the
 * orchestrator's injected `invoke`, and the real main only wires in the real ones.
 *
 * A-2 (D-11): the CLI parses one mode (a new run, --resume, --close, --consolidate), refuses
 * anything it does not understand, dispatches to the library, and prints. Every decision about a
 * run is the library's; these tests drive the whole path with injected fakes (no process, no
 * network, no git: `changes` is a fake tracker).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import childProcess = require('child_process');

import {
  CLI_FLAGS,
  CliDependencies,
  CliUsageError,
  checkpointApprover,
  EXIT_CODES,
  exitCodeFor,
  parseArgs,
  printableForTerminal,
  realCliDependencies,
  runCli,
  terminalApprover
} from '../../runner/cli';
import { AgentInvocation, createSdkInvoker, SdkInvokerConfig } from '../../runner/invoke-agent';
import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import {
  decisions,
  InvokerScript,
  passingScript,
  scriptedInvoker,
  seedRun,
  removeTmpReviewCopies,
  tempProject,
  TempProject
} from '../fixtures/harness-run';
import { backend, story, testVerifier } from '../fixtures/agent-outputs';
import { recordingGates } from '../fixtures/gates';
import { fakeChangeTracker } from '../fixtures/changes';
import { plantFactoryCaseVariant, treeSnapshot } from '../fixtures/factory-case-variant';
import { baselineFilePath } from '../../harness/regression-baseline';
import { sha256Hex } from '../../harness/checkpoint-presentation';
import {
  DIRECTION_CHARACTER_RANGES,
  directionCharacterPattern,
  escapeCodePoint,
  escapeDirectionCharacters
} from '../../harness/direction-characters';
import { prepareNewRunDirectory } from '../../harness/run-directory';
import { loadState, saveState, stateFilePath } from '../../harness/state-store';
import { FeatureState } from '../../harness/state-tracker';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-cli-');
});

afterEach(() => {
  project.cleanup();
  jest.restoreAllMocks();
});

/** Full runs commit state after every step; give them room. */
const RUN_TIMEOUT_MS = 30_000;

/** Fakes for every dependency; the returned spies are what the tests assert on. */
function fakeDependencies(overrides: Partial<CliDependencies> = {}, script: InvokerScript = passingScript()) {
  const invoker = scriptedInvoker(script, { cwd: project.dir });
  const invokerConfigs: SdkInvokerConfig[] = [];
  const exitCodes: number[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const approver = jest.fn(async (_checkpoint: CheckpointRequest) => true);
  const recorded = recordingGates();

  const deps: CliDependencies = {
    createInvoker: config => {
      invokerConfigs.push(config);
      return invoker.invoke;
    },
    approver,
    isTTY: () => true,
    exit: code => {
      exitCodes.push(code);
    },
    log: message => {
      logs.push(message);
    },
    error: message => {
      errors.push(message);
    },
    gates: recorded.gates,
    changes: fakeChangeTracker(),
    ...overrides
  };

  return { deps, invoker, invokerConfigs, exitCodes, logs, errors, approver, gates: recorded };
}

/** One CLI invocation with fresh fakes: its exit code, its fakes, and everything it printed. */
async function cli(argv: string[], overrides: Partial<CliDependencies> = {}, script?: InvokerScript) {
  const fakes = fakeDependencies(overrides, script);
  const code = await runCli(argv, fakes.deps);
  return { ...fakes, code, output: [...fakes.logs, ...fakes.errors].join('\n') };
}

/** `--cwd <project>` appended to a command. */
const at = (...argv: string[]) => [...argv, '--cwd', project.dir];

/** The id of the only live run in the project. */
function liveRunId(): string {
  const names = readdirSync(join(project.dir, '.factory'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '_archive')
    .map(entry => entry.name);
  expect(names).toHaveLength(1);
  return names[0];
}

function onDisk(id: string): FeatureState {
  return loadState(project.dir, id)!;
}

function stateBytes(id: string): string {
  return readFileSync(stateFilePath(project.dir, id), 'utf-8');
}

const stillRed = () => backend({ testsFailed: 1, failingError: 'still red' });
const verifierFails = (): InvokerScript => ({ ...passingScript(), '06-test-verifier': testVerifier({ failed: 1 }) });

describe('runCli', () => {
  it('AC-63 a full CLI invocation with injected fakes spawns no process and reports the exit code via the injected exit', async () => {
    const spawned = [
      jest.spyOn(childProcess, 'spawn'),
      jest.spyOn(childProcess, 'spawnSync'),
      jest.spyOn(childProcess, 'execSync'),
      jest.spyOn(childProcess, 'exec'),
      jest.spyOn(childProcess, 'execFile')
    ];
    const fakes = fakeDependencies();

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir, '--yes'], fakes.deps);

    expect(code).toBe(0);
    expect(fakes.exitCodes).toEqual([0]);
    expect(fakes.invokerConfigs.map(c => c.cwd)).toEqual([project.dir]);
    // SUCCESS needs CP3 (AC-44); the Consolidator is not part of a run.
    expect(fakes.invoker.agents()).not.toContain('08-feature-consolidator');
    expect(fakes.gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditExecution']);
    // --yes approves without asking.
    expect(fakes.approver).not.toHaveBeenCalled();
    for (const spy of spawned) expect(spy).not.toHaveBeenCalled();
  });

  it('AC-77 with no TTY and no --yes a checkpoint pauses the run, records no approval and exits 3', async () => {
    const fakes = fakeDependencies({ isTTY: () => false });

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir], fakes.deps);

    expect(code).toBe(EXIT_CODES.PAUSED);
    expect(fakes.exitCodes).toEqual([3]);
    expect(fakes.approver).not.toHaveBeenCalled();
    expect(fakes.errors.join('\n')).toMatch(/No TTY/);
    // Fail closed: the run stopped at Checkpoint 1, before the Spec Writer, and approved nothing.
    expect(fakes.invoker.agents()).not.toContain('03-spec-writer');
    const state = onDisk(liveRunId());
    expect(state.status).toBe('PAUSED');
    expect(state.completionStatus).toBeUndefined();
    expect(state.checkpointApprovals).toEqual([]);
    expect(state.pendingCheckpoint?.checkpointId).toBe(1);
  }, RUN_TIMEOUT_MS);

  it('AC-77 --yes still approves every checkpoint without asking (no TTY needed)', async () => {
    const fakes = fakeDependencies({ isTTY: () => false });

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir, '--yes'], fakes.deps);

    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(fakes.approver).not.toHaveBeenCalled();
    const approvals = onDisk(liveRunId()).checkpointApprovals;
    expect(approvals.map(a => a.checkpointId)).toEqual([1, 2, 3]);
    expect(approvals.map(a => a.approvedBy)).toEqual(['--yes', '--yes', '--yes']);
  }, RUN_TIMEOUT_MS);

  it('AC-63 on a TTY without --yes the injected approver decides each checkpoint', async () => {
    const fakes = fakeDependencies();

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir], fakes.deps);

    expect(code).toBe(0);
    expect(fakes.approver.mock.calls.map(([checkpoint]) => checkpoint.name)).toEqual([
      expect.stringMatching(/CHECKPOINT 1/),
      expect.stringMatching(/CHECKPOINT 2/),
      expect.stringMatching(/CHECKPOINT 3/)
    ]);
  });

  it('AC-44 a run whose CP3 is approved exits 0, and a CP3 rejection exits 1', async () => {
    const approved = fakeDependencies();

    expect(await runCli(['--feature', 'add 2FA', '--cwd', project.dir], approved.deps)).toBe(0);
    expect(approved.approver.mock.calls.at(-1)![0]).toMatchObject({ id: 3, stage: 4 });
    expect(approved.invoker.agents()).not.toContain('08-feature-consolidator');
    expect(existsSync(baselineFilePath(project.dir))).toBe(true);

    project.cleanup();
    project = tempProject('ff-cli-');
    const rejected = fakeDependencies({
      approver: jest.fn(async (checkpoint: CheckpointRequest) => checkpoint.id !== 3)
    });

    expect(await runCli(['--feature', 'add 2FA', '--cwd', project.dir], rejected.deps)).toBe(1);
    expect(rejected.exitCodes).toEqual([1]);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, 30_000);

  it('AC-63 a thrown error is reported through the injected error and exits 1', async () => {
    const fakes = fakeDependencies();

    const code = await runCli(['--cwd', project.dir], fakes.deps);

    expect(code).toBe(1);
    expect(fakes.exitCodes).toEqual([1]);
    expect(fakes.errors.join('\n')).toMatch(/Missing --feature/);
    expect(fakes.invokerConfigs).toEqual([]);
  });

  it('AC-63 real main calls runCli with realCliDependencies', () => {
    const source = readFileSync(join(__dirname, '../../runner/cli.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).toMatch(
      /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{\s*void\s+runCli\(\s*process\.argv\.slice\(2\)\s*,\s*realCliDependencies\(\)\s*\)\s*;?\s*\}/
    );
    expect(source).not.toMatch(/function\s+main\s*\(/);

    expect(realCliDependencies().createInvoker).toBe(createSdkInvoker);
  });
});

describe('D-11 parseArgs', () => {
  it('D-11 CLI_FLAGS lists exactly the twelve flags, and only --yes takes no value', () => {
    expect(Object.keys(CLI_FLAGS).sort()).toEqual(
      ['approve', 'close', 'consolidate', 'cwd', 'feature', 'grant-attempts', 'model', 'name', 'notes', 'reject', 'resume', 'yes'].sort()
    );
    expect(Object.entries(CLI_FLAGS).filter(([, flag]) => !flag.takesValue).map(([name]) => name)).toEqual(['yes']);
    for (const flag of Object.values(CLI_FLAGS)) expect(flag.summary.trim()).not.toBe('');
  });

  it('D-6 EXIT_CODES are SUCCESS 0, STOPPED 1 and PAUSED 3 (2 is left unused)', () => {
    expect(EXIT_CODES).toEqual({ SUCCESS: 0, STOPPED: 1, PAUSED: 3 });
  });

  it('D-6 exitCodeFor maps SUCCESS to 0, PAUSED to 3 and every other end to 1', () => {
    const seeded = (runClass: Parameters<typeof seedRun>[1]) => {
      const dir = tempProject('ff-cli-exit-');
      try {
        return exitCodeFor(seedRun(dir.dir, runClass));
      } finally {
        dir.cleanup();
      }
    };
    expect(seeded('SUCCESS')).toBe(0);
    expect(seeded('PAUSED')).toBe(3);
    expect(seeded('ESCALATED')).toBe(1);
    expect(seeded('MANUAL_STOP')).toBe(1);
    expect(seeded('ACTIVE')).toBe(1);
  });

  it('D-11 a new run takes --feature, --name, --cwd, --model and --yes; --name defaults to the feature', () => {
    expect(parseArgs(['--feature', 'add 2FA', '--name', 'two-factor', '--cwd', '/tmp/p', '--model', 'm', '--yes'])).toEqual({
      kind: 'run',
      feature: 'add 2FA',
      name: 'two-factor',
      cwd: '/tmp/p',
      model: 'm',
      yes: true
    });
    expect(parseArgs(['--feature', 'x'.repeat(80), '--cwd', '/tmp/p'])).toMatchObject({ name: 'x'.repeat(60), yes: false });
  });

  it.each<[string, string[], object]>([
    ['a plain continue', [], { action: { kind: 'continue' } }],
    ['--approve 2', ['--approve', '2'], { action: { kind: 'approve', checkpoint: 2 } }],
    ['--approve cp3', ['--approve', 'cp3'], { action: { kind: 'approve', checkpoint: 3 } }],
    ['--reject CP1 --notes', ['--reject', 'CP1', '--notes', 'too vague'], { action: { kind: 'reject', checkpoint: 1, notes: 'too vague' } }],
    ['--grant-attempts 2', ['--grant-attempts', '2'], { action: { kind: 'continue' }, grantAttempts: 2 }]
  ])('D-11 --resume with %s becomes that resume request', (_label, extra, request) => {
    expect(parseArgs(['--resume', 'run-1', '--cwd', '/tmp/p', ...extra])).toEqual({
      kind: 'resume',
      id: 'run-1',
      cwd: '/tmp/p',
      yes: false,
      request
    });
  });

  it('D-11 --resume keeps --feature, --model and --yes; --close and --consolidate take a run id', () => {
    expect(parseArgs(['--resume', 'r', '--feature', 'f', '--model', 'm', '--yes', '--cwd', '/p'])).toEqual({
      kind: 'resume',
      id: 'r',
      cwd: '/p',
      feature: 'f',
      model: 'm',
      yes: true,
      request: { action: { kind: 'continue' } }
    });
    expect(parseArgs(['--close', 'r', '--cwd', '/p'])).toEqual({ kind: 'close', id: 'r', cwd: '/p' });
    expect(parseArgs(['--consolidate', 'r', '--model', 'm', '--cwd', '/p'])).toEqual({
      kind: 'consolidate',
      id: 'r',
      cwd: '/p',
      model: 'm'
    });
  });

  it('D-11 with no mode the error says Missing --feature', () => {
    expect(() => parseArgs(['--cwd', '/p'])).toThrow(CliUsageError);
    expect(() => parseArgs([])).toThrow(/Missing --feature/);
  });

  it.each<[string, string[]]>([
    ['an unknown flag', ['--feature', 'f', '--force']],
    ['a stray token', ['--feature', 'f', 'extra']],
    ['a leading stray token', ['run', '--feature', 'f']],
    ['a single-dash flag', ['--feature', 'f', '-y']],
    ['a --flag=value token', ['--feature=f']],
    ['a duplicate flag', ['--feature', 'a', '--feature', 'b']],
    ['a duplicate --yes', ['--feature', 'a', '--yes', '--yes']],
    ['a flag missing its value', ['--feature']],
    ['a flag followed by another flag', ['--feature', '--yes']],
    ['a blank value', ['--feature', '   ']],
    ['two modes', ['--resume', 'a', '--close', 'a']],
    ['--feature with --close', ['--close', 'a', '--feature', 'f']],
    ['--yes with --close', ['--close', 'a', '--yes']],
    ['--yes with --consolidate', ['--consolidate', 'a', '--yes']],
    ['--approve without --resume', ['--feature', 'f', '--approve', '1']],
    ['--grant-attempts without --resume', ['--feature', 'f', '--grant-attempts', '1']],
    ['--approve with --reject', ['--resume', 'a', '--approve', '1', '--reject', '1', '--notes', 'n']],
    ['--approve with --grant-attempts', ['--resume', 'a', '--approve', '1', '--grant-attempts', '1']],
    ['--reject with --grant-attempts', ['--resume', 'a', '--reject', '1', '--notes', 'n', '--grant-attempts', '1']],
    ['--notes without --reject', ['--resume', 'a', '--notes', 'n']],
    ['--notes with --approve', ['--resume', 'a', '--approve', '1', '--notes', 'n']],
    ['an unknown checkpoint', ['--resume', 'a', '--approve', '4']],
    ['a checkpoint word', ['--resume', 'a', '--approve', 'story']],
    ['a non-integer --grant-attempts', ['--resume', 'a', '--grant-attempts', '1.5']],
    ['a word --grant-attempts', ['--resume', 'a', '--grant-attempts', 'two']],
    ['a negative --grant-attempts', ['--resume', 'a', '--grant-attempts', '-1']],
    ['--name with --resume', ['--resume', 'a', '--name', 'n']]
  ])('D-11 %s is a usage error', (_label, argv) => {
    expect(() => parseArgs(argv)).toThrow(CliUsageError);
  });

  it('AC-74 --reject without --notes, or with blank notes, is a usage error', () => {
    expect(() => parseArgs(['--resume', 'a', '--reject', '1'])).toThrow(/--notes/);
    expect(() => parseArgs(['--resume', 'a', '--reject', '1', '--notes', ' \t '])).toThrow(CliUsageError);
  });

  it.each([['../x'], ['a/b'], ['.hidden'], ['_archive'], ['a..b'], ['x\u001b[2J']])(
    'SEC the run id %j is refused by every mode before anything runs',
    id => {
      for (const flag of ['--resume', '--close', '--consolidate']) {
        expect(() => parseArgs([flag, id])).toThrow(/not a valid run id/);
      }
    }
  );
});

describe('SEC terminal-safe printing', () => {
  it('SEC AC-102 printableForTerminal escapes C0 and C1 controls as \\xNN and every shared-set character as \\u{XXXX}, keeping newlines and tabs', () => {
    expect(printableForTerminal('plain\ttext\nnext line')).toBe('plain\ttext\nnext line');
    expect(printableForTerminal('\u001b[2J\u001b]0;pwned\u0007')).toBe('\\x1B[2J\\x1B]0;pwned\\x07');
    expect(printableForTerminal('over\rwrite\u0008\u007f')).toBe('over\\x0Dwrite\\x08\\x7F');
    expect(printableForTerminal('csi\u009b31m and \u0085')).toBe('csi\\x9B31m and \\x85');
    expect(printableForTerminal('windows\r\nline')).toBe('windows\nline');
    expect(printableForTerminal('ünïcödé ✓ — fine')).toBe('ünïcödé ✓ — fine');
    // Nothing raw survives.
    expect(printableForTerminal('\u0000\u001f\u0080\u009f')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);

    // AC-102: every member of the shared set (AC-105) is shown as its \u{XXXX} escape, built here
    // from the code point so no raw character sits in this file.
    for (const [low, high] of DIRECTION_CHARACTER_RANGES) {
      for (let codePoint = low; codePoint <= high; codePoint++) {
        const shown = printableForTerminal(`a${String.fromCodePoint(codePoint)}b`);
        expect(shown).toBe(`a${escapeCodePoint(codePoint)}b`);
      }
    }
    const rlo = String.fromCodePoint(0x202e);
    const zwj = String.fromCodePoint(0x200d);
    expect(printableForTerminal(`x${rlo}y\u001b[2J${zwj}\tz\r\nw`)).toBe(
      'x' + '\\' + 'u{202E}y\\x1B[2J' + '\\' + 'u{200D}\tz\nw'
    );
    expect(directionCharacterPattern().test(printableForTerminal(`${rlo}${zwj}${String.fromCodePoint(0xfeff)}`))).toBe(false);
  });

  it('AC-102 printableForTerminal leaves already-escaped text and a literal backslash unchanged', () => {
    const rlo = String.fromCodePoint(0x202e);
    const alreadyEscaped = escapeDirectionCharacters(`see ${rlo} here`);
    const backslashes = 'C:\\path\\to and \\x1B and \\\\ and ' + '\\' + 'u{202E} typed';

    expect(alreadyEscaped).toBe('see ' + '\\' + 'u{202E} here');
    expect(printableForTerminal(alreadyEscaped)).toBe(alreadyEscaped);
    expect(printableForTerminal(backslashes)).toBe(backslashes);
    // Escaping twice is the same as escaping once.
    const once = printableForTerminal(`a${rlo}\u0007b`);
    expect(printableForTerminal(once)).toBe(once);
  });

  it('SEC the TTY approver escapes terminal control sequences in presented text, and the hash stays over the raw text', async () => {
    const raw = '# Story\n\u001b[2Jhidden\u001b[8m text';
    const request: CheckpointRequest = {
      id: 1,
      name: 'CHECKPOINT 1: Approve the story',
      stage: 2,
      text: raw,
      sha256: sha256Hex(raw),
      artifactPaths: []
    };
    const printed: string[] = [];
    const approve = terminalApprover({ log: message => printed.push(message), ask: async () => 'y' });

    const decision = await approve(request);

    expect(decision).toEqual({ decision: 'APPROVE' });
    const shown = printed.join('\n');
    expect(shown).toContain('\\x1B[2Jhidden\\x1B[8m text');
    expect(shown).not.toContain('\u001b');
    // The approver never touches the request: the approval binds to the raw text's hash.
    expect(request.text).toBe(raw);
    expect(request.sha256).toBe(sha256Hex(raw));
  });

  it('SEC everything a run prints goes through printableForTerminal', async () => {
    const result = await cli(at('--feature', 'add \u001b[31m2FA'), {}, verifierFails());

    expect(result.output).not.toContain('\u001b');
    expect(result.output).toContain('\\x1B[31m2FA');
  }, RUN_TIMEOUT_MS);
});

describe('D-11 the TTY approver', () => {
  const request: CheckpointRequest = {
    id: 2,
    name: 'CHECKPOINT 2: Approve the technical brief',
    stage: 2,
    text: 'brief',
    sha256: sha256Hex('brief'),
    artifactPaths: []
  };

  /** The approver answering `answers` in order; returns the decision and every question asked. */
  async function answer(...answers: string[]) {
    const questions: string[] = [];
    const decision = await terminalApprover({
      log: () => {},
      ask: async question => {
        questions.push(question);
        return answers[questions.length - 1] ?? '';
      }
    })(request);
    return { decision, questions };
  }

  it('D-11 y or yes approves, p or pause pauses', async () => {
    for (const reply of ['y', 'YES', ' yes ']) expect((await answer(reply)).decision).toEqual({ decision: 'APPROVE' });
    for (const reply of ['p', 'Pause']) expect((await answer(reply)).decision).toEqual({ decision: 'PAUSE' });
    expect((await answer('y')).questions).toEqual([expect.stringMatching(/y = approve \/ n = reject \/ p = pause/)]);
  });

  it('D-11 n rejects and asks for optional notes; an empty answer is a rejection with empty notes (I-18)', async () => {
    const withNotes = await answer('n', '  needs rate limiting  ');
    expect(withNotes.decision).toEqual({ decision: 'REJECT', notes: 'needs rate limiting' });
    expect(withNotes.questions[1]).toMatch(/notes/i);

    expect((await answer('n', '')).decision).toEqual({ decision: 'REJECT', notes: '' });
    // Anything that is not y / yes / p / pause rejects, as before.
    expect((await answer('', '')).decision).toEqual({ decision: 'REJECT', notes: '' });
    expect((await answer('ok', 'x')).decision).toEqual({ decision: 'REJECT', notes: 'x' });
  });

  it('AC-77 --yes approves every checkpoint with approvedBy --yes and never consults the TTY or the approver', async () => {
    const isTTY = jest.fn(() => true);
    const approver = jest.fn(async () => false);
    const approve = checkpointApprover(true, { ...fakeDependencies().deps, isTTY, approver });

    for (const id of [1, 2, 3] as const) {
      expect(await approve({ ...request, id })).toEqual({ decision: 'APPROVE', approvedBy: '--yes' });
    }
    expect(isTTY).not.toHaveBeenCalled();
    expect(approver).not.toHaveBeenCalled();
  });
});

describe('D-11 exit codes and next-step hints', () => {
  it('AC-49 a paused run exits 3', async () => {
    const result = await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve });

    expect(result.code).toBe(EXIT_CODES.PAUSED);
    expect(result.exitCodes).toEqual([3]);
    expect(onDisk(liveRunId()).status).toBe('PAUSED');
  }, RUN_TIMEOUT_MS);

  it('AC-54 that resume exits 3 and prints the approve and reject commands', async () => {
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve });
    const id = liveRunId();
    const before = stateBytes(id);

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.PAUSED);
    expect(result.invoker.calls).toEqual([]);
    expect(result.approver).not.toHaveBeenCalled();
    expect(stateBytes(id)).toBe(before);
    expect(result.output).toContain(`Approve with: npm run factory -- --resume ${id} --cwd ${project.dir} --approve 1`);
    expect(result.output).toContain(`Reject with: npm run factory -- --resume ${id} --cwd ${project.dir} --reject 1 --notes "<why>"`);
    expect(result.output).not.toContain('Resume with');
  }, RUN_TIMEOUT_MS);

  it('AC-51 --resume --approve 2 continues the run', async () => {
    const first = decisions({ decision: 'APPROVE' }, { decision: 'PAUSE' });
    expect((await cli(at('--feature', 'add 2FA'), { approver: first.approve })).code).toBe(3);
    const id = liveRunId();
    expect(onDisk(id).pendingCheckpoint?.checkpointId).toBe(2);

    const result = await cli(at('--resume', id, '--approve', '2'));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    // CP2 is not asked again; only CP3 is.
    expect(result.approver.mock.calls.map(([checkpoint]) => checkpoint.id)).toEqual([3]);
    expect(result.invoker.agents()[0]).toBe('04-backend-builder');
    expect(onDisk(id).checkpointApprovals.find(a => a.checkpointId === 2)?.approvedBy).toBe('resume --approve');
  }, RUN_TIMEOUT_MS);

  it('AC-52 the refusal exits non-zero', async () => {
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve });
    const id = liveRunId();
    appendFileSync(join(project.dir, '.factory', id, 'USER_STORY.md'), '\nEdited after the pause.\n');
    const before = stateBytes(id);

    const result = await cli(at('--resume', id, '--approve', '1'));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toMatch(/artifact changed/);
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  /** A script whose USER_STORY.md holds U+202E (built from its code point, never typed raw). */
  const storyWithDirectionCharacter = (): InvokerScript => {
    const output = story();
    output.details.artifacts[0].content = `${output.details.artifacts[0].content}\n\nThe fee is ${String.fromCodePoint(0x202e)}01 USD.\n`;
    return { ...passingScript(), '02-story-writer': output };
  };

  it('AC-109 --resume --approve exits as the run continues', async () => {
    const script = storyWithDirectionCharacter();
    expect((await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve }, script)).code).toBe(3);
    const id = liveRunId();

    const result = await cli(at('--resume', id, '--approve', '1'), {}, script);

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(onDisk(id).checkpointApprovals.find(a => a.checkpointId === 1)?.approvedBy).toBe('resume --approve');
  }, RUN_TIMEOUT_MS);

  it('AC-110 the refusal exits 1', async () => {
    const script = storyWithDirectionCharacter();
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve }, script);
    const id = liveRunId();
    // A pause recorded before PR B-1: its hash was taken over the raw, unescaped story.
    const recorded = onDisk(id);
    recorded.pendingCheckpoint!.sha256 = sha256Hex(readFileSync(join(project.dir, '.factory', id, 'USER_STORY.md'), 'utf-8'));
    saveState(project.dir, recorded);
    const before = stateBytes(id);

    const result = await cli(at('--resume', id, '--approve', '1'), {}, script);

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toContain('the presentation changed in this version');
    expect(result.output).toContain(`npm run factory -- --close ${id} --cwd ${project.dir}`);
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  it.each([
    ['approve', ['--approve', '2']],
    ['reject', ['--reject', '3', '--notes', 'wrong one']]
  ])('AC-53 --%s naming a checkpoint other than the pending one is refused and state.json is unchanged', async (_kind, extra) => {
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve });
    const id = liveRunId();
    const before = stateBytes(id);

    const result = await cli(at('--resume', id, ...extra));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toMatch(/paused at checkpoint 1/);
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  it('AC-74 --reject without --notes is a usage error; with notes it exits 1', async () => {
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'PAUSE' }).approve });
    const id = liveRunId();
    const before = stateBytes(id);

    const usage = await cli(at('--resume', id, '--reject', '1'));
    expect(usage.code).toBe(EXIT_CODES.STOPPED);
    expect(usage.output).toMatch(/--notes/);
    expect(usage.invokerConfigs).toEqual([]);
    expect(stateBytes(id)).toBe(before);

    const rejected = await cli(at('--resume', id, '--reject', '1', '--notes', 'cover account recovery'));
    expect(rejected.code).toBe(EXIT_CODES.STOPPED);
    expect(rejected.invoker.calls).toEqual([]);
    const state = onDisk(id);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.reason).toBe('MANUAL');
    expect(state.checkpointRejections?.at(-1)).toMatchObject({ checkpointId: 1, notes: 'cover account recovery', source: 'resume --reject' });
    expect(rejected.output).toContain(`Resume with: npm run factory -- --resume ${id} --cwd ${project.dir}`);
  }, RUN_TIMEOUT_MS);

  it('AC-46 a TTY rejection exits 1 and prints the resume command', async () => {
    const result = await cli(at('--feature', 'add 2FA'), {
      approver: decisions({ decision: 'REJECT', notes: 'too vague' }).approve
    });
    const id = liveRunId();

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(onDisk(id).completionStatus).toBe('ESCALATED');
    expect(result.output).toContain(`Resume with: npm run factory -- --resume ${id} --cwd ${project.dir}`);
    expect(result.output).toContain(`Close with: npm run factory -- --close ${id} --cwd ${project.dir}`);
  }, RUN_TIMEOUT_MS);

  it('AC-75 --resume after a rejection re-runs the producing agent', async () => {
    await cli(at('--feature', 'add 2FA'), { approver: decisions({ decision: 'REJECT', notes: 'cover account recovery' }).approve });
    const id = liveRunId();

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.invoker.agents()[0]).toBe('02-story-writer');
    expect(result.invoker.promptsFor('02-story-writer')[0]).toContain('cover account recovery');
    expect(result.approver.mock.calls.map(([checkpoint]) => checkpoint.id)).toEqual([1, 2, 3]);
  }, RUN_TIMEOUT_MS);

  it('AC-35 --resume of an ESCALATED run reopens it and exits 0 when it then succeeds', async () => {
    expect((await cli(at('--feature', 'add 2FA'), {}, verifierFails())).code).toBe(1);
    const id = liveRunId();

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.invoker.agents()).toEqual(['06-test-verifier', '07-validator']);
    expect(onDisk(id).completionStatus).toBe('SUCCESS');
    expect(result.output).toContain(`Consolidate with: npm run factory -- --consolidate ${id} --cwd ${project.dir}`);
  }, RUN_TIMEOUT_MS);

  it('AC-37 --resume <id> works without --feature, using the description saved in state', async () => {
    await cli(at('--feature', 'add TOTP two-factor login'), {}, verifierFails());
    const id = liveRunId();

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.invoker.promptsFor('06-test-verifier')[0]).toContain('add TOTP two-factor login');
    expect(result.output).toContain('add TOTP two-factor login');
  }, RUN_TIMEOUT_MS);

  it('AC-37 --feature that differs from the saved description is refused', async () => {
    await cli(at('--feature', 'add TOTP two-factor login'), {}, verifierFails());
    const id = liveRunId();
    const before = stateBytes(id);

    const matching = await cli(at('--resume', id, '--feature', 'add TOTP two-factor login'), { approver: jest.fn(async () => false) });
    expect(matching.invoker.calls.length).toBeGreaterThan(0);

    const later = stateBytes(id);
    expect(later).not.toBe(before);
    const result = await cli(at('--resume', id, '--feature', 'add SMS login'));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toMatch(/does not match the description saved/);
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(later);
  }, RUN_TIMEOUT_MS);

  /** An ESCALATED run whose state.json, like a pre-A-2 one, has no featureDescription. */
  async function runWithoutDescription(): Promise<string> {
    await cli(at('--feature', 'add TOTP two-factor login'), {}, verifierFails());
    const id = liveRunId();
    const legacy = onDisk(id);
    delete legacy.featureDescription;
    saveState(project.dir, legacy);
    return id;
  }

  it('IMPORTANT-1 --resume of a run recorded without a description, without --feature, is refused naming --feature and exits 1 with nothing written', async () => {
    const id = await runWithoutDescription();
    const before = stateBytes(id);

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toMatch(/recorded without a feature description/);
    expect(result.output).toMatch(/--feature "<the description it was started with>"/);
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  it('IMPORTANT-1 --resume --feature on a run recorded without a description saves the description in state and briefs the agents with it', async () => {
    const id = await runWithoutDescription();

    const result = await cli(at('--resume', id, '--feature', 'add TOTP two-factor login'));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(result.invoker.promptsFor('06-test-verifier')[0]).toContain('add TOTP two-factor login');
    expect(onDisk(id).featureDescription).toBe('add TOTP two-factor login');
  }, RUN_TIMEOUT_MS);

  it('AC-41 the CLI refuses a new run with the existing run\'s --resume and --close commands and exits 1', async () => {
    await cli(at('--feature', 'add 2FA'), {}, verifierFails());
    const id = liveRunId();

    const result = await cli(at('--feature', 'something else'));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.invoker.calls).toEqual([]);
    expect(result.output).toContain(`--resume ${id}`);
    expect(result.output).toContain(`--close ${id}`);
    expect(liveRunId()).toBe(id);
  }, RUN_TIMEOUT_MS);

  it('AC-97 --feature and --resume next to a .Factory entry exit 1, name it, and create nothing', async () => {
    // --feature: a project whose only harness-like entry is a .Factory directory.
    const freshVariant = plantFactoryCaseVariant(project.dir);
    const freshBefore = treeSnapshot(project.dir);

    const fresh = await cli(at('--feature', 'add 2FA'));

    expect(fresh.code).toBe(EXIT_CODES.STOPPED);
    expect(fresh.output).toContain(`${freshVariant} differs from the harness directory .factory only in letter case`);
    expect(fresh.invoker.calls).toEqual([]);
    expect(treeSnapshot(project.dir)).toEqual(freshBefore);

    // --resume: a real run, then its .factory turned into (or joined by) a .Factory entry.
    rmSync(freshVariant, { recursive: true, force: true });
    await cli(at('--feature', 'add 2FA'), {}, verifierFails());
    const id = liveRunId();
    const resumeVariant = plantFactoryCaseVariant(project.dir);
    const resumeBefore = treeSnapshot(project.dir);

    const resumed = await cli(at('--resume', id));

    expect(resumed.code).toBe(EXIT_CODES.STOPPED);
    expect(resumed.output).toContain(`${resumeVariant} differs from the harness directory .factory only in letter case`);
    expect(resumed.invoker.calls).toEqual([]);
    expect(treeSnapshot(project.dir)).toEqual(resumeBefore);
  }, RUN_TIMEOUT_MS);

  it('AC-97 --resume next to a .Factory entry is refused before the CLI reads the run directory', async () => {
    // The real module object, so the spy replaces what cli.ts calls.
    const runDirectory = require('../../harness/run-directory') as typeof import('../../harness/run-directory');
    await cli(at('--feature', 'add 2FA'), {}, verifierFails());
    const id = liveRunId();
    const variant = plantFactoryCaseVariant(project.dir);
    const before = treeSnapshot(project.dir);
    const lookups = jest.spyOn(runDirectory, 'findRun');

    // A real run: on a case-insensitive file system the lookup would succeed through .Factory.
    const real = await cli(at('--resume', id));
    // An unknown id: had the lookup run first, it would have said "No run ...".
    const unknown = await cli(at('--resume', 'no-such-run'));

    for (const result of [real, unknown]) {
      expect(result.code).toBe(EXIT_CODES.STOPPED);
      expect(result.output).toContain(`${variant} differs from the harness directory .factory only in letter case`);
      expect(result.output).not.toMatch(/No run /);
      expect(result.invoker.calls).toEqual([]);
    }
    expect(lookups).not.toHaveBeenCalled();
    expect(treeSnapshot(project.dir)).toEqual(before);
  }, RUN_TIMEOUT_MS);

  it('AC-99 each description refusal exits 1 with state.json unchanged', async () => {
    const cases: Array<[string, () => Promise<string>, string[], RegExp]> = [
      [
        'a finished run given a different --feature',
        async () => (await cli(at('--feature', 'add 2FA')), liveRunId()),
        ['--feature', 'add SMS login'],
        /already finished \(SUCCESS\)/
      ],
      [
        'an exhausted-builder run given a different --feature',
        async () => (await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed }), liveRunId()),
        ['--feature', 'add SMS login'],
        /--grant-attempts <n>/
      ],
      [
        'a resumable run given a different --feature',
        async () => (await cli(at('--feature', 'add 2FA'), {}, verifierFails()), liveRunId()),
        ['--feature', 'add SMS login'],
        /--feature "add SMS login" does not match the description saved in run \S+ \("add 2FA"\)/
      ],
      ['a run recorded without a description, given none', () => runWithoutDescription(), [], /recorded without a feature description/]
    ];

    for (const [label, start, extra, message] of cases) {
      removeTmpReviewCopies(project.dir);
      rmSync(join(project.dir, '.factory'), { recursive: true, force: true });
      const id = await start();
      const before = stateBytes(id);

      const result = await cli(at('--resume', id, ...extra));

      expect([label, result.code]).toEqual([label, EXIT_CODES.STOPPED]);
      expect(result.output).toMatch(message);
      expect(result.invoker.calls).toEqual([]);
      expect(stateBytes(id)).toBe(before);
    }
  }, RUN_TIMEOUT_MS * 2);

  it('AC-101 the CLI names --grant-attempts and exits 1', async () => {
    await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed });
    const id = liveRunId();
    const legacy = onDisk(id);
    delete legacy.escalations.at(-1)!.context.builderPhase;
    saveState(project.dir, legacy);
    const before = stateBytes(id);

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toContain('exhausted its attempts (Stage 3)');
    expect(result.output).toContain('--grant-attempts <n>');
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);

    const granted = await cli(at('--resume', id, '--grant-attempts', '1'));
    expect(granted.code).toBe(EXIT_CODES.SUCCESS);
    expect(onDisk(id).attemptGrants).toEqual([expect.objectContaining({ builder: '04-backend-builder', attempts: 1, at: { phase: 'stage3' } })]);
  }, RUN_TIMEOUT_MS);

  it('AC-71 the refusal exits 1', async () => {
    await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed });
    const id = liveRunId();
    const before = stateBytes(id);

    const result = await cli(at('--resume', id));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toContain('--grant-attempts <n>');
    expect(result.invoker.calls).toEqual([]);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  it('AC-72 --resume --grant-attempts 1 exits 0 when the granted attempt passes', async () => {
    await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed });
    const id = liveRunId();

    const result = await cli(at('--resume', id, '--grant-attempts', '1'));

    expect(result.code).toBe(EXIT_CODES.SUCCESS);
    expect(onDisk(id).attemptGrants).toEqual([expect.objectContaining({ builder: '04-backend-builder', attempts: 1 })]);
  }, RUN_TIMEOUT_MS);

  it('I-8 --grant-attempts outside 1..3 is refused and exits 1', async () => {
    await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed });
    const id = liveRunId();
    const before = stateBytes(id);

    const result = await cli(at('--resume', id, '--grant-attempts', '4'));

    expect(result.code).toBe(EXIT_CODES.STOPPED);
    expect(result.output).toMatch(/from 1 to 3/);
    expect(stateBytes(id)).toBe(before);
  }, RUN_TIMEOUT_MS);

  it('AC-73 --close exits 0, a second --close exits 1', async () => {
    const seeded = seedRun(project.dir, 'ESCALATED');

    const first = await cli(at('--close', seeded.featureId));
    expect(first.code).toBe(EXIT_CODES.SUCCESS);
    expect(first.invokerConfigs).toEqual([]);
    expect(onDisk(seeded.featureId).completionStatus).toBe('MANUAL_STOP');
    expect(first.output).toContain(seeded.featureId);

    const before = stateBytes(seeded.featureId);
    const second = await cli(at('--close', seeded.featureId));
    expect(second.code).toBe(EXIT_CODES.STOPPED);
    expect(second.output).toMatch(/already finished/);
    expect(stateBytes(seeded.featureId)).toBe(before);
  });

  it('AC-47 --consolidate exits 0 when the Stage 5 gate passes and 1 when refused', async () => {
    expect((await cli(at('--feature', 'add 2FA'))).code).toBe(0);
    const id = liveRunId();

    const passed = await cli(at('--consolidate', id));
    expect(passed.code).toBe(EXIT_CODES.SUCCESS);
    expect(passed.invoker.agents()).toEqual(['08-feature-consolidator']);
    expect(onDisk(id).currentStage).toBe(5);

    const gateFails = await cli(at('--consolidate', id), {}, {});
    expect(gateFails.code).toBe(EXIT_CODES.STOPPED);
    expect(gateFails.output).toMatch(/Stage 5/);

    const unknown = await cli(at('--consolidate', 'no-such-run'));
    expect(unknown.code).toBe(EXIT_CODES.STOPPED);
    expect(unknown.invoker.calls).toEqual([]);

    const escalated = seedRun(project.dir, 'ESCALATED');
    const notSuccess = await cli(at('--consolidate', escalated.featureId));
    expect(notSuccess.code).toBe(EXIT_CODES.STOPPED);
    expect(notSuccess.output).toMatch(/only a SUCCESS run can be consolidated/);
    expect(notSuccess.invoker.calls).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('D-11 --resume of an archived run says it is archived and finished; an unknown id is not found', async () => {
    const finished = seedRun(project.dir, 'SUCCESS');
    prepareNewRunDirectory(project.dir);
    expect(existsSync(join(project.dir, '.factory', '_archive', finished.featureId))).toBe(true);

    const archived = await cli(at('--resume', finished.featureId));
    expect(archived.code).toBe(EXIT_CODES.STOPPED);
    expect(archived.output).toMatch(/archived and finished/);
    expect(archived.output).not.toContain('Resume with');
    expect(archived.invoker.calls).toEqual([]);

    const unknown = await cli(at('--resume', 'no-such-run'));
    expect(unknown.code).toBe(EXIT_CODES.STOPPED);
    expect(unknown.output).toMatch(/No run no-such-run/);
  });

  it.each<[string, () => Promise<string>, RegExp | undefined]>([
    [
      'SUCCESS: no',
      async () => (await cli(at('--feature', 'add 2FA'))).output,
      undefined
    ],
    [
      'MANUAL_STOP: no',
      async () => (await cli(at('--close', seedRun(project.dir, 'ESCALATED').featureId))).output,
      undefined
    ],
    [
      'ESCALATED: yes',
      async () => (await cli(at('--feature', 'add 2FA'), {}, verifierFails())).output,
      /Resume with: npm run factory -- --resume \S+ --cwd \S+$/m
    ],
    [
      'builder-exhausted: yes, with --grant-attempts',
      async () => (await cli(at('--feature', 'add 2FA'), {}, { ...passingScript(), '04-backend-builder': stillRed })).output,
      /Resume with: npm run factory -- --resume \S+ --cwd \S+ --grant-attempts <n>$/m
    ],
    [
      'StatePersistenceError: no',
      async () => {
        // The run record becomes unwritable at the first agent call: state.json turns into a directory.
        const breakRecord = (call: AgentInvocation) => {
          const record = stateFilePath(project.dir, liveRunId());
          rmSync(record);
          mkdirSync(record);
          return call;
        };
        const fakes = fakeDependencies();
        const invoke = fakes.deps.createInvoker;
        let broken = false;
        const result = await runCli(at('--feature', 'add 2FA'), {
          ...fakes.deps,
          createInvoker: config => {
            const inner = invoke(config);
            return async call => {
              if (!broken) {
                broken = true;
                breakRecord(call);
              }
              return inner(call);
            };
          }
        });
        expect(result).toBe(1);
        const output = [...fakes.logs, ...fakes.errors].join('\n');
        expect(output).toMatch(/Could not write the run record/);
        return output;
      },
      undefined
    ]
  ])("AC-42 'Resume with' is printed only when the run is resumable (%s)", async (_label, run, expected) => {
    const output = await run();
    if (expected) {
      expect(output).toMatch(expected);
    } else {
      expect(output).not.toContain('Resume with');
    }
  }, RUN_TIMEOUT_MS);
});
