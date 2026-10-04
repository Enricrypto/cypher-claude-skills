/**
 * The CLI has an injectable entry point (AC-63).
 *
 * `main()` used to reach straight for createSdkInvoker, readline, process.stdin.isTTY and
 * process.exit, so nothing about the CLI — its exit codes, its fail-closed checkpoint wiring —
 * could be tested without a real agent run. runCli takes those as dependencies, mirroring the
 * orchestrator's injected `invoke`, and the real main only wires in the real ones.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import childProcess = require('child_process');

import { CliDependencies, realCliDependencies, runCli } from '../../runner/cli';
import { createSdkInvoker, SdkInvokerConfig } from '../../runner/invoke-agent';
import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import { passingScript, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { recordingGates } from '../fixtures/gates';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-cli-');
});

afterEach(() => {
  project.cleanup();
  jest.restoreAllMocks();
});

/** Fakes for every dependency; the returned spies are what the tests assert on. */
function fakeDependencies(overrides: Partial<CliDependencies> = {}) {
  const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
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
    ...overrides
  };

  return { deps, invoker, invokerConfigs, exitCodes, logs, errors, approver, gates: recorded };
}

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
    expect(fakes.invoker.agents()).toContain('08-feature-consolidator');
    expect(fakes.gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditExecution']);
    // --yes approves without asking.
    expect(fakes.approver).not.toHaveBeenCalled();
    for (const spy of spawned) expect(spy).not.toHaveBeenCalled();
  });

  it('AC-63 with no TTY and no --yes the approver is not called and exit is 1', async () => {
    const fakes = fakeDependencies({ isTTY: () => false });

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir], fakes.deps);

    expect(code).toBe(1);
    expect(fakes.exitCodes).toEqual([1]);
    expect(fakes.approver).not.toHaveBeenCalled();
    expect(fakes.errors.join('\n')).toMatch(/No TTY/);
    // Fail closed: the run stopped at Checkpoint 1, before the Spec Writer.
    expect(fakes.invoker.agents()).not.toContain('03-spec-writer');
  });

  it('AC-63 on a TTY without --yes the injected approver decides each checkpoint', async () => {
    const fakes = fakeDependencies();

    const code = await runCli(['--feature', 'add 2FA', '--cwd', project.dir], fakes.deps);

    expect(code).toBe(0);
    expect(fakes.approver.mock.calls.map(([checkpoint]) => checkpoint.name)).toEqual([
      expect.stringMatching(/CHECKPOINT 1/),
      expect.stringMatching(/CHECKPOINT 2/)
    ]);
  });

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
