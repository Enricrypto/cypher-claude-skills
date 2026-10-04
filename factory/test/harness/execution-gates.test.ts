/**
 * Gate 2 (execution) against real child processes.
 *
 * Each test builds a throwaway project whose package.json scripts call tiny `node <file>.js`
 * scripts, then runs the real audit against it. This is the only test file that runs the real
 * execution gate; orchestrator tests inject audits instead (AC-1), so `npm test` stays offline.
 *
 * Every spawned process is killed by the gate itself (process-group kill on timeout). afterEach
 * also kills any pid a fixture script recorded, so a failing assertion cannot leak a process.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import * as ts from 'typescript';

import {
  auditExecution,
  DEFAULT_EXECUTION_TIMEOUTS,
  DEV_SERVER_ERROR_PATTERN,
  ExecutionAudit,
  ExecutionResult,
  killTrackedProcessGroups,
  parseFailedTestNames,
  parseTestOutput,
  runShellCommand,
  trackedProcessGroups,
  validateExecutionGate
} from '../../harness/execution-gates';
import { tempProject, TempProject } from '../fixtures/harness-run';

const TEST_TIMEOUT = 20_000;
/** Short enough to keep the suite fast; long enough for `npm run` to start a node script. */
const DEV_TIMEOUT_MS = 1500;

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-eg-');
});

afterEach(() => {
  // Belt and braces: any process a fixture script started records its pid in a *.pid file.
  for (const name of readdirSync(project.dir).filter(n => n.endsWith('.pid'))) {
    const pid = Number(readFileSync(join(project.dir, name), 'utf-8'));
    if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  }
  project.cleanup();
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Write `package.json` with `scripts` (name → JS body run as `node <name>.js`), plus extra files. */
function writeProject(scripts: Record<string, string>, files: Record<string, string> = {}): void {
  const pkgScripts: Record<string, string> = {};
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(project.dir, `${name}.js`), body);
    pkgScripts[name] = `node ${name}.js`;
  }
  for (const [name, body] of Object.entries(files)) writeFileSync(join(project.dir, name), body);
  writeFileSync(
    join(project.dir, 'package.json'),
    JSON.stringify({ name: 'eg-fixture', version: '1.0.0', private: true, scripts: pkgScripts }, null, 2)
  );
}

const result = (audit: ExecutionAudit, type: ExecutionResult['type']): ExecutionResult => {
  const found = audit.results.find(r => r.type === type);
  if (!found) throw new Error(`no ${type} result`);
  return found;
};

/** A dev server that stays up and prints a clean banner. */
const LONG_RUNNING_DEV = `console.log('ready on http://localhost:0 (0 errors)'); setInterval(() => {}, 1000);`;
const GREEN_TEST = `console.error('Tests:       2 passed, 2 total');`;

describe('execution gate', () => {
  it(
    'AC-8 a green suite whose summary is on stderr only reports 2/2 at 100% and does not block',
    async () => {
      writeProject({ test: GREEN_TEST });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const test = result(audit, 'test');
      expect(test.stdout).not.toMatch(/Tests:/);
      expect(test.status).toBe('PASSED');
      expect(test.testStats).toMatchObject({ total: 2, passed: 2, failed: 0, passRate: 1 });
      expect(decision.passRate).toBe(1);
      expect(decision.testStats).toMatchObject({ total: 2, passed: 2, failed: 0 });
      expect(decision.blockers).toEqual([]);
      expect(decision.canAdvance).toBe(true);
    },
    TEST_TIMEOUT
  );

  it("AC-9 parses 'Tests: 1 failed, 4 passed, 5 total' as 1/4/5", () => {
    expect(parseTestOutput('Tests:       1 failed, 4 passed, 5 total')).toMatchObject({
      failed: 1,
      passed: 4,
      total: 5
    });
    // Order-independent: the same counts in a different order.
    expect(parseTestOutput('Tests:       4 passed, 1 failed, 5 total')).toMatchObject({
      failed: 1,
      passed: 4,
      total: 5
    });
    // Coloured output (the summary of an interactive Jest run).
    expect(
      parseTestOutput('\u001b[1mTests:       \u001b[22m\u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m, \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m, 5 total')
    ).toMatchObject({ failed: 1, passed: 4, total: 5 });
    // Pass rate counts only tests that ran.
    expect(parseTestOutput('Tests:       1 failed, 4 passed, 5 total')!.passRate).toBeCloseTo(0.8);
  });

  it('AC-9 parses Vitest and Mocha summaries', () => {
    expect(parseTestOutput(' Test Files  1 passed (1)\n      Tests  2 failed | 5 passed | 1 skipped (8)')).toMatchObject({
      total: 8,
      passed: 5,
      failed: 2,
      skipped: 1
    });
    expect(parseTestOutput('  7 passing (30ms)\n  2 pending\n  1 failing')).toMatchObject({
      total: 10,
      passed: 7,
      failed: 1,
      skipped: 2
    });
    expect(parseTestOutput('nothing to see here')).toBeNull();
    expect(parseTestOutput('Tests:       0 total')).toBeNull();
  });

  it(
    "AC-9 output with no counts blocks with 'no tests detected', never 0/0 pass",
    async () => {
      writeProject({ test: `console.log('all good, trust me');` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const test = result(audit, 'test');
      expect(test.exitCode).toBe(0);
      expect(test.testStats).toBeUndefined();
      expect(test.status).toBe('FAILED');
      expect(decision.canAdvance).toBe(false);
      expect(decision.passRate).toBe(0);
      expect(decision.blockers.filter(b => b.startsWith('no tests detected'))).toHaveLength(1);
    },
    TEST_TIMEOUT
  );

  it(
    'AC-10 failedTests lists the failing test names from the output',
    async () => {
      writeProject({
        test: [
          `console.error(' FAIL  src/totp.test.ts');`,
          `console.error('  TotpService');`,
          `console.error('    ✓ enables 2FA (3 ms)');`,
          `console.error('    ✕ rejects a reused code (5 ms)');`,
          `console.error('');`,
          `console.error('  ● TotpService › rejects a reused code');`,
          `console.error('');`,
          `console.error('  ● Console');`,
          `console.error('');`,
          `console.error('  ● TotpService › rejects a reused code');`,
          `console.error('Tests:       1 failed, 1 passed, 2 total');`,
          `process.exit(1);`
        ].join('\n')
      });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      expect(audit.failedTests).toEqual(['rejects a reused code', 'TotpService › rejects a reused code']);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /1 failing/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  it('AC-10 parseFailedTestNames ignores the Console block and passing tests', () => {
    expect(parseFailedTestNames('  ✓ passes (1 ms)\n  ● Console\n\n    console.log\n')).toEqual([]);
  });

  it(
    'AC-11 missing dev script is skipped with a WARNING and does not block',
    async () => {
      writeProject({ test: GREEN_TEST, build: `console.log('built');` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      expect(dev.status).toBe('SKIPPED');
      expect(dev.passed).toBe(true);
      expect(audit.warnings.some(w => /dev/.test(w))).toBe(true);
      expect(decision.warnings.some(w => /dev/.test(w))).toBe(true);
      expect(result(audit, 'build').status).toBe('PASSED');
      expect(decision.canAdvance).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'AC-12 missing build script is skipped with a WARNING and does not block',
    async () => {
      writeProject({ test: GREEN_TEST, dev: LONG_RUNNING_DEV });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const build = result(audit, 'build');
      expect(build.status).toBe('SKIPPED');
      expect(audit.warnings.some(w => /build/.test(w))).toBe(true);
      expect(decision.warnings.some(w => /build/.test(w))).toBe(true);
      expect(result(audit, 'dev-server').status).toBe('PASSED');
      expect(decision.canAdvance).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'D-3 a missing test script is not skipped: it fails and blocks',
    async () => {
      writeProject({ build: `console.log('built');` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const test = result(audit, 'test');
      expect(test.status).toBe('FAILED');
      expect(test.failureReason).toMatch(/no test script/);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /no test script/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'AC-13 a dev script that never exits is stopped within the configured timeout',
    async () => {
      // The dev script starts a grandchild that ignores SIGTERM, so stopping it needs the
      // process-group kill and the SIGKILL escalation, not just a kill of the shell.
      writeProject(
        {
          test: GREEN_TEST,
          dev: [
            `const { spawn } = require('child_process');`,
            `const fs = require('fs');`,
            `const child = spawn(process.execPath, ['grandchild.js'], { stdio: 'inherit' });`,
            `fs.writeFileSync('grandchild.pid', String(child.pid));`,
            `fs.writeFileSync('dev.pid', String(process.pid));`,
            `console.log('ready');`,
            `setInterval(() => {}, 1000);`
          ].join('\n')
        },
        { 'grandchild.js': `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);` }
      );

      const started = Date.now();
      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const elapsed = Date.now() - started;

      const dev = result(audit, 'dev-server');
      expect(dev.timedOut).toBe(true);
      expect(dev.status).toBe('PASSED');
      expect(elapsed).toBeLessThan(10_000);

      expect(existsSync(join(project.dir, 'grandchild.pid'))).toBe(true);
      for (const name of ['dev.pid', 'grandchild.pid']) {
        const pid = Number(readFileSync(join(project.dir, name), 'utf-8'));
        expect(isAlive(pid)).toBe(false);
      }
    },
    TEST_TIMEOUT
  );

  it(
    'AC-13 a test command that never exits is stopped and blocks',
    async () => {
      writeProject({ test: `require('fs').writeFileSync('test.pid', String(process.pid)); setInterval(() => {}, 1000);` });

      const started = Date.now();
      const audit = await auditExecution(project.dir, { testTimeoutMs: DEV_TIMEOUT_MS, devTimeoutMs: DEV_TIMEOUT_MS });
      const elapsed = Date.now() - started;
      const decision = validateExecutionGate(audit);

      const test = result(audit, 'test');
      expect(test.timedOut).toBe(true);
      expect(test.status).toBe('FAILED');
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /timed out/.test(b))).toBe(true);
      expect(elapsed).toBeLessThan(10_000);
      expect(isAlive(Number(readFileSync(join(project.dir, 'test.pid'), 'utf-8')))).toBe(false);
    },
    TEST_TIMEOUT
  );

  it(
    'AC-14 a dev script that exits non-zero before the timeout fails CRITICAL and blocks',
    async () => {
      writeProject({ test: GREEN_TEST, dev: `console.error('Error: listen EADDRINUSE :::3000'); process.exit(1);` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      expect(dev.timedOut).toBe(false);
      expect(dev.status).toBe('FAILED');
      expect(dev.passed).toBe(false);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /Dev server/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  // Added by the Test Verifier. The test above makes BOTH failure conditions true at once (a
  // non-zero exit AND an error line), so either branch alone could be deleted without it noticing.
  // These two pin each branch on its own.
  it(
    'AC-14 a dev script that exits non-zero with clean output before the timeout fails CRITICAL and blocks',
    async () => {
      writeProject({ test: GREEN_TEST, dev: `console.log('starting dev server'); process.exit(3);` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      expect(DEV_SERVER_ERROR_PATTERN.test(dev.stdout + dev.stderr)).toBe(false);
      expect(dev.timedOut).toBe(false);
      expect(dev.exitCode).not.toBe(0);
      expect(dev.status).toBe('FAILED');
      expect(dev.failureReason).toMatch(/exited with code/);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /Dev server/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'AC-14 a dev script that stays up but reports an error before the timeout fails CRITICAL and blocks',
    async () => {
      writeProject({
        test: GREEN_TEST,
        dev: [
          `require('fs').writeFileSync('dev.pid', String(process.pid));`,
          `console.error('TypeError: Cannot read properties of undefined (reading "listen")');`,
          `setInterval(() => {}, 1000);`
        ].join('\n')
      });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      // It never exited on its own: only the reported error can fail it.
      expect(dev.timedOut).toBe(true);
      expect(dev.status).toBe('FAILED');
      expect(dev.failureReason).toMatch(/reported an error: TypeError/);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /Dev server/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  it('AC-14 DEV_SERVER_ERROR_PATTERN flags real errors and not clean banners', () => {
    for (const clean of ['compiled successfully, 0 errors', 'no failed requests', 'ready in 300ms', 'value is undefined-safe']) {
      expect(DEV_SERVER_ERROR_PATTERN.test(clean)).toBe(false);
    }
    for (const bad of [
      'TypeError: x is not a function',
      'Error: boom',
      'npm ERR! missing script: dev',
      'npm error code ELIFECYCLE',
      'listen EADDRINUSE: address already in use',
      'Failed to compile.',
      "Cannot find module 'express'"
    ]) {
      expect(DEV_SERVER_ERROR_PATTERN.test(bad)).toBe(true);
    }
  });

  it(
    'AC-64 a build script that exits non-zero fails CRITICAL and blocks',
    async () => {
      writeProject({ test: GREEN_TEST, build: `console.error('src/a.ts(1,1): error TS2304'); process.exit(2);` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      const build = result(audit, 'build');
      expect(build.status).toBe('FAILED');
      expect(build.exitCode).toBe(2);
      expect(audit.buildErrors.join('\n')).toMatch(/TS2304/);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /Build FAILED/.test(b))).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'I-10 skipped tests are reported as a warning, not counted against 100%',
    async () => {
      writeProject({ test: `console.error('Tests:       2 skipped, 1 todo, 3 passed, 6 total');` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: DEV_TIMEOUT_MS });
      const decision = validateExecutionGate(audit);

      expect(result(audit, 'test').testStats).toMatchObject({ total: 6, passed: 3, failed: 0, skipped: 2, todo: 1 });
      expect(decision.passRate).toBe(1);
      expect(decision.canAdvance).toBe(true);
      const warning = decision.warnings.find(w => /\d+ skipped/.test(w));
      expect(warning).toMatch(/2 skipped/);
      expect(warning).toMatch(/1 todo/);
      expect(audit.warnings).toContain(warning);
    },
    TEST_TIMEOUT
  );

  it('AC-13 DEFAULT_EXECUTION_TIMEOUTS are 30 min test, 15 min build, 15 s dev', () => {
    expect(DEFAULT_EXECUTION_TIMEOUTS).toEqual({
      testTimeoutMs: 30 * 60_000,
      buildTimeoutMs: 15 * 60_000,
      devTimeoutMs: 15_000
    });
  });
});

/** True while any process in group `pgid` exists. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return condition();
}

/** A command whose group holds a shell and two grandchildren, all long-lived. */
const LONG_RUNNING = 'sleep 30 & sleep 30 & wait';

describe('Gate 2 child processes do not outlive the orchestrator (IMPORTANT-3)', () => {
  it(
    'killTrackedProcessGroups kills every process in a live command\'s group',
    async () => {
      const running = runShellCommand(LONG_RUNNING, project.dir, 60_000);
      const groups = trackedProcessGroups();
      expect(groups).toHaveLength(1);
      const [pgid] = groups;
      try {
        expect(await waitUntil(() => groupAlive(pgid), 2_000)).toBe(true);

        killTrackedProcessGroups();

        const outcome = await running;
        expect(outcome.exitCode).toBeNull();
        expect(await waitUntil(() => !groupAlive(pgid), 3_000)).toBe(true);
        expect(trackedProcessGroups()).toEqual([]);
      } finally {
        try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
      }
    },
    TEST_TIMEOUT
  );

  it(
    'a settled command is no longer tracked',
    async () => {
      const running = runShellCommand('true', project.dir, 10_000);
      expect(trackedProcessGroups()).toHaveLength(1);

      await running;

      expect(trackedProcessGroups()).toEqual([]);
    },
    TEST_TIMEOUT
  );

  it('importing the module installs no signal or exit handler', () => {
    const before = ['SIGINT', 'SIGTERM', 'exit'].map(e => process.listenerCount(e));
    jest.isolateModules(() => {
      require('../../harness/execution-gates');
    });
    expect(['SIGINT', 'SIGTERM', 'exit'].map(e => process.listenerCount(e))).toEqual(before);
  });

  /**
   * The real interrupt, in a separate node process: it starts a long-running command through
   * runShellCommand, prints the group id, and is then sent the signal (or exits). The group must be
   * dead afterwards, and a signalled orchestrator must still die OF that signal (Ctrl-C works).
   */
  const ORCHESTRATOR = (gatesJs: string, ending: string) => `
    const gates = require(${JSON.stringify(gatesJs)});
    gates.runShellCommand(${JSON.stringify(LONG_RUNNING)}, process.cwd(), 60000);
    process.stdout.write(JSON.stringify(gates.trackedProcessGroups()) + '\\n');
    ${ending}
    setInterval(() => {}, 1000);
  `;

  /** execution-gates.ts imports only node built-ins, so a plain CommonJS transpile runs as-is. */
  function transpiledGates(): string {
    const source = readFileSync(resolve(__dirname, '../../harness/execution-gates.ts'), 'utf-8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    });
    const file = join(project.dir, 'execution-gates.js');
    writeFileSync(file, outputText);
    return file;
  }

  async function runOrchestrator(ending: string, signal?: NodeJS.Signals) {
    const child = spawn(process.execPath, ['-e', ORCHESTRATOR(transpiledGates(), ending)], { cwd: project.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', c => (stdout += c));
    child.stderr.setEncoding('utf-8').on('data', c => (stderr += c));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(r =>
      child.on('exit', (code, sig) => r({ code, signal: sig }))
    );
    let pgid: number | undefined;
    try {
      expect(await waitUntil(() => stdout.includes('\n'), 15_000)).toBe(true);
      [pgid] = JSON.parse(stdout.split('\n')[0]) as number[];
      expect(await waitUntil(() => groupAlive(pgid!), 2_000)).toBe(true);
      if (signal) child.kill(signal);
      const exit = await exited;
      return { exit, pgid: pgid!, stderr };
    } finally {
      child.kill('SIGKILL');
      if (pgid !== undefined) {
        try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  }

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'on %s the orchestrator kills the tracked group, then still dies of the signal',
    async signal => {
      const { exit, pgid, stderr } = await runOrchestrator('', signal);

      expect({ exit, stderr }).toEqual({ exit: { code: null, signal }, stderr: '' });
      expect(await waitUntil(() => !groupAlive(pgid), 3_000)).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    'on process exit the orchestrator kills the tracked group',
    async () => {
      const { exit, pgid } = await runOrchestrator('setTimeout(() => process.exit(0), 100);');

      expect(exit).toEqual({ code: 0, signal: null });
      expect(await waitUntil(() => !groupAlive(pgid), 3_000)).toBe(true);
    },
    TEST_TIMEOUT
  );
});
