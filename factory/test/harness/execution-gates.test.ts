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
  createBoundedOutput,
  createLineScanner,
  DEFAULT_EXECUTION_TIMEOUTS,
  DEV_SERVER_ERROR_PATTERN,
  ExecutionAudit,
  ExecutionResult,
  killTrackedProcessGroups,
  OUTPUT_HEAD_CHARS,
  OUTPUT_TAIL_CHARS,
  parseFailedTestNames,
  parseTestOutput,
  runShellCommand,
  runTestSuite,
  selectTestSummary,
  trackedProcessGroups,
  validateExecutionGate,
  verifyDevServer
} from '../../harness/execution-gates';
import { tempProject, TempProject } from '../fixtures/harness-run';

const TEST_TIMEOUT = 20_000;
/**
 * The dev window for tests whose dev script only has to be up (or absent) when the window ends.
 * Nothing in them depends on the script having started inside it, so it can stay short.
 */
const DEV_TIMEOUT_MS = 1500;
/**
 * The window for a script that must have STARTED and printed or spawned something before the window
 * ends, and then stays up (so every run pays the whole window). Under CPU load `npm run` alone can
 * take seconds to start a node script: 1.5 s made these tests flaky (B-1 step 3 FLAKE).
 */
const STARTUP_WINDOW_MS = 5_000;
/**
 * The window for a script that must EXIT (or print) before the window ends and then exits: the
 * command settles when it exits, so a long window costs nothing and no start-up delay under load
 * can reach it.
 */
const EXIT_WINDOW_MS = 30_000;
/** Jest's limit for a test that uses EXIT_WINDOW_MS. */
const EXIT_TEST_TIMEOUT = 90_000;

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
      // No test script: the test check then fails at once without spawning anything, so the
      // elapsed time below is the dev window plus the kill grace, not also a test run under load.
      writeProject(
        {
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
      const audit = await auditExecution(project.dir, { devTimeoutMs: STARTUP_WINDOW_MS });
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
      const audit = await auditExecution(project.dir, { testTimeoutMs: STARTUP_WINDOW_MS, devTimeoutMs: DEV_TIMEOUT_MS });
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

      const audit = await auditExecution(project.dir, { devTimeoutMs: EXIT_WINDOW_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      expect(dev.timedOut).toBe(false);
      expect(dev.status).toBe('FAILED');
      expect(dev.passed).toBe(false);
      expect(decision.canAdvance).toBe(false);
      expect(decision.blockers.some(b => /Dev server/.test(b))).toBe(true);
    },
    EXIT_TEST_TIMEOUT
  );

  // Added by the Test Verifier. The test above makes BOTH failure conditions true at once (a
  // non-zero exit AND an error line), so either branch alone could be deleted without it noticing.
  // These two pin each branch on its own.
  it(
    'AC-14 a dev script that exits non-zero with clean output before the timeout fails CRITICAL and blocks',
    async () => {
      writeProject({ test: GREEN_TEST, dev: `console.log('starting dev server'); process.exit(3);` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: EXIT_WINDOW_MS });
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
    EXIT_TEST_TIMEOUT
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

      const audit = await auditExecution(project.dir, { devTimeoutMs: STARTUP_WINDOW_MS });
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

/** An audit holding just these results, as auditExecution would assemble it. */
function auditOf(results: ExecutionResult[]): ExecutionAudit {
  return {
    stage: 6,
    timestamp: new Date(0).toISOString(),
    projectRoot: project.dir,
    results,
    allPassed: results.every(r => r.passed),
    failedTests: [],
    buildErrors: [],
    warnings: [],
    summary: ''
  };
}

/** Feed `text` to a fresh line scanner in `chunkSize`-character chunks and return its scan. */
function scan(text: string, chunkSize = 7) {
  const scanner = createLineScanner();
  for (let i = 0; i < text.length; i += chunkSize) scanner.push(text.slice(i, i + chunkSize));
  return scanner.end();
}

/** The summary lines the gate would hand to selectTestSummary for these two streams. */
const summaryLines = (stdout: string, stderr: string) => ({
  stdout: scan(stdout).summaryLines,
  stderr: scan(stderr).summaryLines
});

/** A node script body that writes `text` to stdout or stderr and lets node flush it before exiting. */
const writes = (stream: 'stdout' | 'stderr', text: string) => `process.${stream}.write(${JSON.stringify(text)});`;

/** Filler that matches no summary, failure or error pattern. */
const filler = (chars: number) => ('x'.repeat(99) + '\n').repeat(Math.ceil(chars / 100));

describe('Gate 2 fixes (PR B-1)', () => {
  it(
    'AC-92 a dev script that exits 0 before the dev window ends is SKIPPED with a warning (an IMPORTANT finding) and neither passes nor blocks',
    async () => {
      writeProject({ test: GREEN_TEST, dev: `console.log('compiled once, nothing left to do');` });

      const audit = await auditExecution(project.dir, { devTimeoutMs: EXIT_WINDOW_MS });
      const decision = validateExecutionGate(audit);

      const dev = result(audit, 'dev-server');
      expect(dev.timedOut).toBe(false);
      expect(dev.exitCode).toBe(0);
      expect(dev.status).toBe('SKIPPED');
      expect(dev.failureReason).toBeUndefined();
      expect(dev.skipReason).toMatch(
        /^the dev script exited with code 0 after \d+(\.\d)?s, before the 30s window ended; a dev server that is not running was not verified$/
      );
      // Neither blocks...
      expect(decision.canAdvance).toBe(true);
      expect(decision.blockers).toEqual([]);
      // ...nor passes silently: it is a warning, which the orchestrator records as an IMPORTANT
      // finding (recordFindings(4, 'gate-2', decision.warnings)).
      const warning = decision.warnings.find(w => w.startsWith('dev-server check skipped: the dev script exited with code 0'));
      expect(warning).toBeDefined();
      expect(audit.warnings).toContain(warning);
    },
    EXIT_TEST_TIMEOUT
  );

  it(
    'AC-92 a dev script that exits 0 but printed an error line still FAILS',
    async () => {
      writeProject({ test: GREEN_TEST, dev: `console.error('Error: config file not found');` });

      const dev = await verifyDevServer(project.dir, { devTimeoutMs: EXIT_WINDOW_MS });

      expect(dev.exitCode).toBe(0);
      expect(dev.status).toBe('FAILED');
      expect(dev.failureReason).toMatch(/reported an error: Error: config file not found/);
    },
    EXIT_TEST_TIMEOUT
  );

  /**
   * The script starts a grandchild in its own process group (the default for a non-detached
   * spawn) that would outlive the test (10 minutes), records its pid, and exits normally.
   */
  const grandchildScript = (stdio: 'ignore' | 'inherit', ownOutput: string) =>
    [
      `const { spawn } = require('child_process');`,
      `const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: '${stdio}' });`,
      `child.unref();`,
      `require('fs').writeFileSync('grandchild.pid', String(child.pid));`,
      ownOutput
    ].join('\n');

  it.each([
    {
      kind: 'test',
      script: grandchildScript('ignore', GREEN_TEST),
      run: () => runTestSuite(project.dir, { testTimeoutMs: EXIT_WINDOW_MS })
    },
    {
      kind: 'dev',
      // stdio 'inherit': the grandchild holds the gate's pipes open after the shell has exited.
      script: grandchildScript('inherit', `console.log('ready');`),
      run: () => verifyDevServer(project.dir, { devTimeoutMs: EXIT_WINDOW_MS })
    }
  ])(
    'AC-93 a $kind command that exits normally leaves no grandchild of its process group running once it settles',
    async ({ kind, script, run }) => {
      writeProject({ [kind]: script });

      const outcome = await run();

      // It settled because the shell exited (a grandchild holding the pipes is waited for at most
      // the exit grace), not because the window ran out, nor because the grandchild ended.
      expect(outcome.timedOut).toBe(false);
      expect(outcome.duration).toBeLessThan(EXIT_WINDOW_MS);
      expect(outcome.exitCode).toBe(0);
      const pid = Number(readFileSync(join(project.dir, 'grandchild.pid'), 'utf-8'));
      expect(pid).toBeGreaterThan(0);
      // The SIGKILL is sent on settle; poll for the process to be gone, with a generous deadline.
      expect(await waitUntil(() => !isAlive(pid), 10_000)).toBe(true);
    },
    EXIT_TEST_TIMEOUT
  );

  it('AC-94 createBoundedOutput keeps at most OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS per stream with a visible truncation marker', () => {
    expect([OUTPUT_HEAD_CHARS, OUTPUT_TAIL_CHARS]).toEqual([65536, 196608]);

    // Small output is kept whole, with no marker.
    const small = createBoundedOutput();
    small.push('hello ');
    small.push('world\n');
    expect(small.text()).toBe('hello world\n');
    expect(small.omitted()).toBe(0);

    // Output exactly at the bound is kept whole too.
    const exact = createBoundedOutput();
    const exactText = 'a'.repeat(OUTPUT_HEAD_CHARS) + 'b'.repeat(OUTPUT_TAIL_CHARS);
    exact.push(exactText);
    expect(exact.text()).toBe(exactText);

    // 1 Mi characters in uneven chunks: the first HEAD and the last TAIL survive, with the marker.
    const total = 1024 * 1024;
    const input = Array.from({ length: total }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    const big = createBoundedOutput();
    let at = 0;
    for (let size = 1; at < input.length; size = (size * 7 + 13) % 50_000 + 1) {
      big.push(input.slice(at, at + size));
      at += size;
    }
    const omitted = total - OUTPUT_HEAD_CHARS - OUTPUT_TAIL_CHARS;
    const marker =
      `\n[... Gate 2 kept the first ${OUTPUT_HEAD_CHARS} and the last ${OUTPUT_TAIL_CHARS} characters of this stream; ` +
      `${omitted} characters were omitted ...]\n`;
    expect(big.omitted()).toBe(omitted);
    expect(big.text()).toBe(input.slice(0, OUTPUT_HEAD_CHARS) + marker + input.slice(-OUTPUT_TAIL_CHARS));
    expect(big.text().length).toBe(OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS + marker.length);
  });

  it(
    'AC-94 a command\'s stdout and stderr in its result are each bounded, with the marker',
    async () => {
      const bound = OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS;
      writeProject({ build: writes('stdout', filler(bound * 2)) + writes('stderr', filler(bound * 2)) });

      const outcome = await runShellCommand('npm run build', project.dir, EXIT_WINDOW_MS);

      expect(outcome.exitCode).toBe(0);
      for (const text of [outcome.stdout, outcome.stderr]) {
        expect(text).toMatch(/\n\[\.\.\. Gate 2 kept the first 65536 and the last 196608 characters of this stream; \d+ characters were omitted \.\.\.\]\n/);
        expect(text.length).toBeLessThan(bound + 200);
      }
    },
    EXIT_TEST_TIMEOUT
  );

  const BEYOND_HEAD = filler(OUTPUT_HEAD_CHARS + 1000);
  const BEYOND_TAIL = filler(OUTPUT_TAIL_CHARS + 1000);

  it.each<{ name: string; scripts: Record<string, string>; check: () => Promise<void> }>([
    {
      name: 'Mocha counts printed before more failure detail than the bound are parsed',
      scripts: {
        test:
          writes('stdout', BEYOND_HEAD + '  3 passing (12ms)\n  1 pending\n  2 failing\n\n') +
          writes('stdout', '  1) parser\n       rejects a bad token:\n     AssertionError: expected 1 to equal 2\n' + BEYOND_TAIL) +
          `process.exitCode = 2;`
      },
      check: async () => {
        const test = await runTestSuite(project.dir, { testTimeoutMs: EXIT_WINDOW_MS });
        // The counts are not in the bounded text: the scanner saw them as they streamed past.
        expect(test.stdout).not.toMatch(/3 passing/);
        expect(test.testStats).toMatchObject({ total: 6, passed: 3, failed: 2, skipped: 1 });
        expect(test.failureReason).toBe('test command exited with code 2');
      }
    },
    {
      name: 'a failing test name printed anywhere is in failedTests',
      scripts: {
        test:
          writes('stderr', BEYOND_HEAD + '    ✕ rejects a reused code (5 ms)\n' + BEYOND_TAIL) +
          writes('stderr', 'Test Suites: 1 failed, 1 total\nTests:       1 failed, 1 passed, 2 total\n') +
          `process.exitCode = 1;`
      },
      check: async () => {
        const audit = await auditExecution(project.dir, { testTimeoutMs: EXIT_WINDOW_MS });
        expect(result(audit, 'test').stderr).not.toMatch(/rejects a reused code/);
        expect(audit.failedTests).toEqual(['rejects a reused code']);
      }
    },
    {
      name: 'a dev error line split across two chunks fails the dev check',
      scripts: {
        dev:
          writes('stdout', BEYOND_HEAD + 'Type') +
          `setTimeout(() => { ${writes('stdout', 'Error: split across two chunks\n' + BEYOND_TAIL)} }, 300);`
      },
      check: async () => {
        const dev = await verifyDevServer(project.dir, { devTimeoutMs: EXIT_WINDOW_MS });
        expect(dev.stdout).not.toMatch(/split across/);
        expect(dev.exitCode).toBe(0);
        expect(dev.status).toBe('FAILED');
        expect(dev.failureReason).toBe('dev server reported an error: TypeError: split across two chunks');
      }
    }
  ])(
    'AC-95 with output larger than the bound, $name',
    async ({ scripts, check }) => {
      writeProject(scripts);
      await check();
    },
    EXIT_TEST_TIMEOUT
  );

  it('AC-95 createLineScanner matches a line split across chunks once it is complete, caps a partial line at 16 Ki and flushes the last line on end', () => {
    // Split error line, one character per chunk.
    expect(scan('ready\nType' + 'Error: boom\nmore\n', 1).devErrorLine).toBe('TypeError: boom');
    // Only the FIRST error line is kept.
    expect(scan('Error: first\nError: second\n').devErrorLine).toBe('Error: first');
    // A line past 16 Ki characters is cut for scanning: an error at its start is still seen, and
    // the dropped rest does not leak into the next line.
    const long = scan('Error: long ' + 'y'.repeat(40_000) + 'Tests:       9 passed, 9 total\nTests:       1 passed, 1 total\n', 4096);
    expect(long.devErrorLine).toBe('Error: long ' + 'y'.repeat(16 * 1024 - 'Error: long '.length));
    expect(long.summaryLines).toEqual(['Tests:       1 passed, 1 total']);
    // The last line without a trailing newline is scanned on end().
    expect(scan('  ✕ last one').failedTestNames).toEqual(['last one']);
    // ANSI colour is stripped before matching.
    expect(scan('\u001b[1mTests:       \u001b[22m3 passed, 3 total\n').summaryLines).toEqual(['Tests:       3 passed, 3 total']);
  });

  it('AC-95 createLineScanner keeps the last 64 summary lines and the first 500 failed-test names, matching parseFailedTestNames', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Tests:       ${i + 1} passed, ${i + 1} total`);
    const kept = scan(lines.join('\n') + '\n', 333).summaryLines;
    expect(kept).toHaveLength(64);
    expect(kept[63]).toBe('Tests:       100 passed, 100 total');
    expect(kept[0]).toBe('Tests:       37 passed, 37 total');

    const names = Array.from({ length: 600 }, (_, i) => `  ✕ case ${i} (1 ms)`);
    const failed = scan(names.join('\n') + '\n  ● Console\n  ✕ case 0\n', 500).failedTestNames;
    expect(failed).toHaveLength(500);
    expect(failed[0]).toBe('case 0');
    expect(failed[499]).toBe('case 499');

    // One implementation: the same names as parseFailedTestNames for the A-1 AC-10 output.
    const ac10 = '    ✓ enables 2FA (3 ms)\n    ✕ rejects a reused code (5 ms)\n\n  ● TotpService › rejects a reused code\n\n  ● Console\n\n  ● TotpService › rejects a reused code\n';
    expect(scan(ac10).failedTestNames).toEqual(parseFailedTestNames(ac10));
    expect(parseFailedTestNames(ac10)).toEqual(['rejects a reused code', 'TotpService › rejects a reused code']);
  });

  const VITEST = ' Test Files  2 passed (2)\n      Tests  5 passed | 1 skipped (6)\n';
  const JEST = 'Test Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\n';

  it.each([
    {
      name: 'Vitest plus a stray unmarked Jest line → Vitest',
      stdout: 'Tests: 2 passed, 2 total\n' + VITEST,
      stderr: '',
      expected: { kind: 'stats', stats: { total: 6, passed: 5, failed: 0, skipped: 1 } }
    },
    {
      name: 'a complete Jest summary on stderr → Jest',
      stdout: '      Tests  9 passed (9)\n',
      stderr: JEST,
      expected: { kind: 'stats', stats: { total: 3, passed: 3, failed: 0, skipped: 0 } }
    },
    {
      name: 'two marked families with different counts → ambiguous',
      stdout: VITEST,
      stderr: JEST,
      expected: { kind: 'ambiguous' }
    },
    {
      name: 'two marked families with equal counts → used',
      stdout: ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n',
      stderr: JEST,
      expected: { kind: 'stats', stats: { total: 3, passed: 3, failed: 0, skipped: 0 } }
    }
  ])(
    'AC-96 counts are parsed per stream and chosen by runner marker: $name',
    async ({ stdout, stderr, expected }) => {
      // The pure selection, on the lines the scanners keep.
      const selected = selectTestSummary(summaryLines(stdout, stderr));
      expect(selected).toMatchObject(expected);

      // The same through the real gate.
      writeProject({ test: writes('stdout', stdout) + writes('stderr', stderr) });
      const test = await runTestSuite(project.dir, { testTimeoutMs: EXIT_WINDOW_MS });
      const decision = validateExecutionGate(auditOf([test]));

      if (expected.kind === 'stats') {
        expect(test.status).toBe('PASSED');
        expect(test.testStats).toMatchObject(expected.stats!);
        expect(test.summaryProblem).toBeUndefined();
        expect(decision.canAdvance).toBe(true);
      } else {
        expect(selected.kind === 'ambiguous' && selected.detail).toBe(
          'vitest on stdout: 5 passed, 0 failed, 1 skipped, 0 todo, 6 total; jest on stderr: 3 passed, 0 failed, 0 skipped, 0 todo, 3 total'
        );
        expect(test.status).toBe('FAILED');
        expect(test.testStats).toBeUndefined();
        expect(test.summaryProblem).toMatch(/^ambiguous test summary: /);
        expect(test.failureReason).toBe(test.summaryProblem);
        expect(decision.canAdvance).toBe(false);
        expect(decision.blockers).toContain(test.summaryProblem);
        expect(decision.blockers.some(b => /no tests detected/.test(b))).toBe(false);
      }
    },
    EXIT_TEST_TIMEOUT
  );

  it('AC-96 unmarked families that disagree are ambiguous too, and no summary at all is none', () => {
    expect(selectTestSummary(summaryLines('Tests: 2 passed, 2 total\n', '      Tests  4 passed (4)\n')).kind).toBe('ambiguous');
    expect(selectTestSummary(summaryLines('nothing here\n', ''))).toEqual({ kind: 'none' });
    // The same family on both streams, marked on one: the marked one wins.
    expect(selectTestSummary(summaryLines('Tests: 7 passed, 7 total\n', JEST))).toMatchObject({ kind: 'stats', stats: { total: 3 } });
  });

  it('AC-96 AC-8 AC-9 the A-1 Jest, Vitest and Mocha summaries still parse', () => {
    // AC-8: a Jest summary on stderr only.
    expect(selectTestSummary(summaryLines('', 'Tests:       2 passed, 2 total\n'))).toEqual({
      kind: 'stats',
      stats: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0, passRate: 1 }
    });
    // AC-9: every A-1 input, through parseTestOutput and through selectTestSummary.
    const cases: Array<[string, Record<string, number> | null]> = [
      ['Tests:       1 failed, 4 passed, 5 total', { failed: 1, passed: 4, total: 5 }],
      ['Tests:       4 passed, 1 failed, 5 total', { failed: 1, passed: 4, total: 5 }],
      [
        '\u001b[1mTests:       \u001b[22m\u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m, \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m, 5 total',
        { failed: 1, passed: 4, total: 5 }
      ],
      [' Test Files  1 passed (1)\n      Tests  2 failed | 5 passed | 1 skipped (8)', { total: 8, passed: 5, failed: 2, skipped: 1 }],
      ['  7 passing (30ms)\n  2 pending\n  1 failing', { total: 10, passed: 7, failed: 1, skipped: 2 }],
      ['Tests:       2 skipped, 1 todo, 3 passed, 6 total', { total: 6, passed: 3, failed: 0, skipped: 2, todo: 1 }],
      ['nothing to see here', null],
      ['Tests:       0 total', null]
    ];
    for (const [text, expected] of cases) {
      const selected = selectTestSummary(summaryLines(text, ''));
      if (expected === null) {
        expect(parseTestOutput(text)).toBeNull();
        expect(selected).toEqual({ kind: 'none' });
      } else {
        expect(parseTestOutput(text)).toMatchObject(expected);
        expect(selected).toMatchObject({ kind: 'stats', stats: expected });
      }
    }
    expect(parseTestOutput('Tests:       1 failed, 4 passed, 5 total')!.passRate).toBeCloseTo(0.8);
  });
});
