/**
 * Feature Factory Execution Verification Gate (Gate 2)
 *
 * Verifies that claimed work actually executed successfully, by running the target project's
 * own scripts:
 * - `npm run build` compiles (skipped with a warning when there is no build script)
 * - `npm run test` runs, reports counts, and every test that ran passed
 * - `npm run dev` starts and stays up cleanly (skipped with a warning when there is no dev script)
 *
 * Prevents hallucinations where agents claim "tests passing" without running them.
 *
 * FAILS CLOSED. Output with no recognisable test counts is "no tests detected", never a pass;
 * a missing test script is a failure, not a skip.
 *
 * Process handling (D-3): one primitive, `runShellCommand`, runs each command detached in its own
 * process group, and on timeout kills the whole GROUP (SIGTERM, then SIGKILL). Killing only the
 * shell leaves the npm → node grandchild holding the output pipes, which is the hang GNU
 * `timeout` used to paper over. POSIX only (I-14). Groups still running when the orchestrator is
 * interrupted (SIGINT/SIGTERM) or exits are killed too: see killTrackedProcessGroups.
 *
 * Adapted from: e2e-loop/harness/phase-gates.ts
 * Specialized for: Feature Factory execution verification
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Test counts parsed from a runner's summary. `passRate` = passed / (passed + failed) (I-10). */
export interface TestStats {
  total: number;
  passed: number;
  failed: number;
  /** Skipped / pending tests. Reported, never counted against the pass rate. */
  skipped: number;
  /** `test.todo` entries. Reported, never counted against the pass rate. */
  todo: number;
  /** 0-1 over the tests that ran. */
  passRate: number;
}

export type ExecutionCheckStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

export interface ExecutionResult {
  type: 'test' | 'build' | 'dev-server';
  command: string;
  status: ExecutionCheckStatus;
  /** `status !== 'FAILED'`: a skipped check does not fail the audit (it warns). */
  passed: boolean;
  /** null when the command never exited on its own (killed, or never started). */
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  duration: number; // milliseconds
  failureReason?: string;
  skipReason?: string;
  testStats?: TestStats;
}

export interface ExecutionAudit {
  stage: 6; // After Test Verifier
  timestamp: string;
  projectRoot: string;
  results: ExecutionResult[];
  allPassed: boolean;
  failedTests: string[];
  buildErrors: string[];
  /** Non-blocking findings: skipped checks, skipped/todo tests. */
  warnings: string[];
  summary: string;
}

export interface ExecutionGateDecision {
  canAdvance: boolean;
  passRate: number;
  blockers: string[];
  warnings: string[];
  remediation: string;
  reason: string;
  testStats?: TestStats;
}

export interface ExecutionGateOptions {
  testTimeoutMs?: number;
  buildTimeoutMs?: number;
  /** How long the dev server must stay up, cleanly, to pass. It is then stopped. */
  devTimeoutMs?: number;
}

export const DEFAULT_EXECUTION_TIMEOUTS: Readonly<Required<ExecutionGateOptions>> = Object.freeze({
  testTimeoutMs: 30 * 60_000,
  buildTimeoutMs: 15 * 60_000,
  devTimeoutMs: 15_000
});

/** What one command did. */
export interface CommandOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  duration: number;
  /** Set when the command could not be started at all. */
  error?: string;
}

/**
 * Output that means a dev server is broken. Deliberately specific: the old
 * `/error|failed|cannot|undefined/i` matched "0 errors" and failed every healthy server.
 */
export const DEV_SERVER_ERROR_PATTERN =
  /\b[A-Za-z]*Error:|npm ERR!|npm error|EADDRINUSE|Failed to compile|Cannot find module/;

/** Grace period between SIGTERM and SIGKILL for a timed-out process group. */
const KILL_GRACE_MS = 2_000;
/** After SIGKILL, how long to wait for the pipes to close before giving up on them. */
const PIPE_CLOSE_GRACE_MS = 1_000;

const TEST_COMMAND = 'npm run test';
const BUILD_COMMAND = 'npm run build';
const DEV_COMMAND = 'npm run dev';

/** Signal a whole process group; a group that is already gone is not an error. */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group has already exited.
  }
}

/**
 * Live process groups (IMPORTANT-3). A Gate 2 command runs detached in its own group, so Ctrl-C at
 * the terminal reaches only the orchestrator: without this, `npm run test`/`dev` would keep running
 * after the orchestrator died, and a surviving dev server's port would block the next run with
 * EADDRINUSE. A group is tracked from spawn until its command settles.
 */
const liveGroups = new Set<number>();

/** The process-group ids of every Gate 2 command still running. */
export function trackedProcessGroups(): number[] {
  return [...liveGroups];
}

/** How long killTrackedProcessGroups waits after SIGTERM before it SIGKILLs what is left. */
const EXIT_KILL_GRACE_MS = 500;

/** True while any process in group `pgid` still exists. */
function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill every tracked group: SIGTERM, a short grace, then SIGKILL for any still present; ESRCH is
 * ignored. SYNCHRONOUS on purpose — it runs from the process `exit` handler, where nothing async
 * gets to run — so the grace is a blocking wait (Atomics.wait), bounded by EXIT_KILL_GRACE_MS.
 * Groups are untracked here; the commands' own promises still settle when their shells close.
 */
export function killTrackedProcessGroups(graceMs: number = EXIT_KILL_GRACE_MS): void {
  const groups = [...liveGroups];
  liveGroups.clear();
  if (groups.length === 0) return;

  groups.forEach(pgid => killGroup(pgid, 'SIGTERM'));

  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + graceMs;
  while (groups.some(groupExists) && Date.now() < deadline) Atomics.wait(sleeper, 0, 0, 25);

  groups.forEach(pgid => killGroup(pgid, 'SIGKILL'));
}

const TERMINATION_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
let cleanupInstalled = false;

/**
 * Install the SIGINT / SIGTERM / exit cleanup ONCE, on the first command — never at import, so
 * importing this module (Jest, the CLI) changes nothing about how the process handles signals.
 *
 * A listener on SIGINT/SIGTERM replaces Node's default "terminate", so after killing the groups the
 * handler restores it: if it is the only listener for that signal, it removes itself and re-raises
 * the signal, and the process dies OF the signal (shell exit status 128+n) exactly as it would
 * have without us — Ctrl-C still stops the orchestrator. If someone else also listens, they had
 * already replaced the default, and the decision to exit stays theirs.
 */
function installCleanupHandlers(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;

  process.on('exit', () => killTrackedProcessGroups());

  for (const signal of TERMINATION_SIGNALS) {
    const onSignal = () => {
      killTrackedProcessGroups();
      if (process.listenerCount(signal) === 1) {
        process.removeListener(signal, onSignal);
        process.kill(process.pid, signal);
      }
    };
    process.on(signal, onSignal);
  }
}

/**
 * Run `command` through the shell in `cwd`, in its own process group, for at most `timeoutMs`.
 *
 * Never rejects. stdout and stderr are collected separately. On timeout the whole group gets
 * SIGTERM, then SIGKILL after a grace period, so an npm → node grandchild cannot outlive it.
 */
export function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandOutcome> {
  const started = Date.now();

  return new Promise<CommandOutcome>(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    installCleanupHandlers();
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const pgid = child.pid;
    if (pgid !== undefined) liveGroups.add(pgid);

    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));

    const settle = (outcome: Omit<CommandOutcome, 'stdout' | 'stderr' | 'duration' | 'timedOut'>) => {
      if (settled) return;
      settled = true;
      if (pgid !== undefined) liveGroups.delete(pgid);
      timers.forEach(clearTimeout);
      // Anything still in the group after the shell is gone is an orphan; never leave it running.
      if (timedOut || outcome.error) killGroup(child.pid, 'SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ ...outcome, stdout, stderr, timedOut, duration: Date.now() - started });
    };

    timers.push(
      setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, 'SIGTERM');
        timers.push(
          setTimeout(() => {
            killGroup(child.pid, 'SIGKILL');
            // A process outside the group could still hold the pipes; do not wait for it forever.
            timers.push(setTimeout(() => settle({ exitCode: null, signal: 'SIGKILL' }), PIPE_CLOSE_GRACE_MS));
          }, KILL_GRACE_MS)
        );
      }, timeoutMs)
    );

    child.on('error', err => settle({ exitCode: null, signal: null, error: err.message }));
    child.on('close', (code, signal) => settle({ exitCode: timedOut ? null : code, signal }));
  });
}

/** Remove ANSI colour and cursor sequences, so coloured runner output parses like plain text. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '');
}

/** The scripts in `<projectRoot>/package.json`; empty when it is missing or unreadable. */
function readScripts(projectRoot: string): Record<string, unknown> {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  } catch {
    return {};
  }
}

const hasScript = (projectRoot: string, name: string): boolean =>
  typeof readScripts(projectRoot)[name] === 'string';

/** Count `(\d+) <word>` occurrences in a summary line, in any order. */
function countOf(line: string, word: string): number | undefined {
  const match = line.match(new RegExp(`(\\d+)\\s+${word}\\b`));
  return match ? parseInt(match[1], 10) : undefined;
}

function stats(counts: { passed?: number; failed?: number; skipped?: number; todo?: number; total?: number }): TestStats | null {
  const passed = counts.passed ?? 0;
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  const todo = counts.todo ?? 0;
  const total = counts.total ?? passed + failed + skipped + todo;
  if (total <= 0) return null;
  const ran = passed + failed;
  return { total, passed, failed, skipped, todo, passRate: ran > 0 ? passed / ran : 0 };
}

/**
 * Parse a test runner's summary (Jest, Vitest, Mocha). Counts are read in any order.
 *
 * Returns null when no summary is found or it reports 0 tests. There is no fallback that counts
 * PASS/✓ tokens: a guess is how "0/0" became a pass. Strip ANSI first if the text may be coloured
 * (`auditExecution` does); this function also strips it, so callers need not.
 */
export function parseTestOutput(output: string): TestStats | null {
  const text = stripAnsi(output);

  // Jest: "Tests:       1 failed, 2 skipped, 4 passed, 7 total". The summary is the last one.
  const jestLines = text.match(/^\s*Tests:\s+.*$/gm);
  if (jestLines) {
    const line = jestLines[jestLines.length - 1];
    return stats({
      passed: countOf(line, 'passed'),
      failed: countOf(line, 'failed'),
      skipped: countOf(line, 'skipped'),
      todo: countOf(line, 'todo'),
      total: countOf(line, 'total')
    });
  }

  // Vitest: "      Tests  2 failed | 5 passed | 1 skipped (8)".
  const vitestLines = text.match(/^\s*Tests\s+\d+\s+\w+.*\(\d+\)\s*$/gm);
  if (vitestLines) {
    const line = vitestLines[vitestLines.length - 1];
    const total = line.match(/\((\d+)\)\s*$/);
    return stats({
      passed: countOf(line, 'passed'),
      failed: countOf(line, 'failed'),
      skipped: countOf(line, 'skipped'),
      todo: countOf(line, 'todo'),
      total: total ? parseInt(total[1], 10) : undefined
    });
  }

  // Mocha: "7 passing (30ms)", "2 pending", "1 failing" on separate lines.
  const passing = text.match(/^\s*(\d+)\s+passing\b/m);
  const failing = text.match(/^\s*(\d+)\s+failing\b/m);
  const pending = text.match(/^\s*(\d+)\s+pending\b/m);
  if (passing || failing || pending) {
    return stats({
      passed: passing ? parseInt(passing[1], 10) : 0,
      failed: failing ? parseInt(failing[1], 10) : 0,
      skipped: pending ? parseInt(pending[1], 10) : 0
    });
  }

  return null;
}

/**
 * The names of failing tests: Jest's `● <name>` failure headers (not `● Console`) and `✕ <name>`
 * result lines, without the duration suffix. Deduplicated, in order of first appearance.
 */
export function parseFailedTestNames(output: string): string[] {
  const names: string[] = [];
  for (const raw of stripAnsi(output).split('\n')) {
    const header = raw.match(/^\s*●\s+(.+?)\s*$/);
    const cross = raw.match(/^\s*✕\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/);
    const name = header ? header[1] : cross ? cross[1] : undefined;
    if (!name || name === 'Console') continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function skipped(type: ExecutionResult['type'], command: string, script: string): ExecutionResult {
  return {
    type,
    command,
    status: 'SKIPPED',
    passed: true,
    exitCode: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    duration: 0,
    skipReason: `no "${script}" script in package.json`
  };
}

function fromOutcome(
  type: ExecutionResult['type'],
  command: string,
  outcome: CommandOutcome,
  failureReason: string | undefined
): ExecutionResult {
  return {
    type,
    command,
    status: failureReason ? 'FAILED' : 'PASSED',
    passed: !failureReason,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    duration: outcome.duration,
    ...(failureReason ? { failureReason } : {})
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/**
 * Run the test suite. PASSED requires exit 0, no timeout, recognised counts with total > 0,
 * no failures and at least one pass. A missing test script FAILS: it is never skipped.
 */
export async function runTestSuite(projectRoot: string, options: ExecutionGateOptions = {}): Promise<ExecutionResult> {
  if (!hasScript(projectRoot, 'test')) {
    return {
      type: 'test',
      command: TEST_COMMAND,
      status: 'FAILED',
      passed: false,
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      duration: 0,
      failureReason: 'no test script in package.json'
    };
  }

  const timeoutMs = options.testTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUTS.testTimeoutMs;
  const outcome = await runShellCommand(TEST_COMMAND, projectRoot, timeoutMs);
  const testStats = parseTestOutput(stripAnsi(outcome.stdout + '\n' + outcome.stderr));

  const failureReason = outcome.error
    ? `could not run "${TEST_COMMAND}": ${outcome.error}`
    : outcome.timedOut
      ? `test command timed out after ${seconds(timeoutMs)}`
      : outcome.exitCode !== 0
        ? `test command exited with code ${outcome.exitCode}`
        : testStats === null
          ? 'no tests detected in the test output'
          : testStats.failed > 0
            ? `${testStats.failed} test(s) failing`
            : testStats.passed === 0
              ? 'no test passed'
              : undefined;

  return { ...fromOutcome('test', TEST_COMMAND, outcome, failureReason), ...(testStats ? { testStats } : {}) };
}

/** Run the build. A missing build script is SKIPPED (with a warning), not failed. */
export async function runBuild(projectRoot: string, options: ExecutionGateOptions = {}): Promise<ExecutionResult> {
  if (!hasScript(projectRoot, 'build')) return skipped('build', BUILD_COMMAND, 'build');

  const timeoutMs = options.buildTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUTS.buildTimeoutMs;
  const outcome = await runShellCommand(BUILD_COMMAND, projectRoot, timeoutMs);

  const failureReason = outcome.error
    ? `could not run "${BUILD_COMMAND}": ${outcome.error}`
    : outcome.timedOut
      ? `build timed out after ${seconds(timeoutMs)}`
      : outcome.exitCode !== 0
        ? `build exited with code ${outcome.exitCode}`
        : undefined;

  return fromOutcome('build', BUILD_COMMAND, outcome, failureReason);
}

/**
 * Start the dev server and let it run for `devTimeoutMs`. Still up and clean at the timeout →
 * stopped, PASSED. Exits non-zero before then, or prints an error → FAILED. A missing dev script
 * is SKIPPED (with a warning).
 */
export async function verifyDevServer(projectRoot: string, options: ExecutionGateOptions = {}): Promise<ExecutionResult> {
  if (!hasScript(projectRoot, 'dev')) return skipped('dev-server', DEV_COMMAND, 'dev');

  const timeoutMs = options.devTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUTS.devTimeoutMs;
  const outcome = await runShellCommand(DEV_COMMAND, projectRoot, timeoutMs);
  const errorLine = stripAnsi(outcome.stdout + '\n' + outcome.stderr)
    .split('\n')
    .find(line => DEV_SERVER_ERROR_PATTERN.test(line));

  const failureReason = outcome.error
    ? `could not run "${DEV_COMMAND}": ${outcome.error}`
    : !outcome.timedOut && outcome.exitCode !== 0
      ? `dev server exited with code ${outcome.exitCode} before ${seconds(timeoutMs)}`
      : errorLine !== undefined
        ? `dev server reported an error: ${errorLine.trim().substring(0, 200)}`
        : undefined;

  return fromOutcome('dev-server', DEV_COMMAND, outcome, failureReason);
}

/** Warnings implied by the results: skipped checks, and skipped/todo tests (I-10). */
function resultWarnings(results: ExecutionResult[]): string[] {
  const warnings: string[] = [];
  for (const r of results) {
    if (r.status === 'SKIPPED') {
      warnings.push(`${r.type} check skipped: ${r.skipReason ?? 'no script'} — "${r.command}" was not verified`);
    }
    const s = r.testStats;
    if (r.type === 'test' && s && (s.skipped > 0 || s.todo > 0)) {
      warnings.push(
        `${s.skipped} skipped and ${s.todo} todo test(s) did not run — not counted in the pass rate, so not verified`
      );
    }
  }
  return warnings;
}

const unique = (items: string[]) => [...new Set(items)];

/**
 * Verify the execution gate passes.
 * CRITICAL: every test that ran must pass, build and dev must not FAIL. SKIPPED checks warn.
 */
export function validateExecutionGate(audit: ExecutionAudit): ExecutionGateDecision {
  const blockers: string[] = [];
  const reasons: string[] = [];

  const buildResult = audit.results.find(r => r.type === 'build');
  if (buildResult?.status === 'FAILED') {
    blockers.push(`Build FAILED: ${buildResult.command}${buildResult.failureReason ? ` — ${buildResult.failureReason}` : ''}`);
    reasons.push('Build failed.');
  }

  const testResult = audit.results.find(r => r.type === 'test');
  const testStats = testResult?.testStats;
  if (!testResult) {
    blockers.push('No test execution recorded');
    reasons.push('Tests did not run.');
  } else {
    const testBlockers: string[] = [];
    const ran = testResult.exitCode !== null || testResult.timedOut;

    if (!ran) {
      testBlockers.push(`Tests did not run: ${testResult.failureReason ?? testResult.command}`);
    } else {
      if (testResult.timedOut) testBlockers.push(`Test command timed out: ${testResult.failureReason ?? testResult.command}`);
      else if (testResult.exitCode !== 0) testBlockers.push(`Test command exited with code ${testResult.exitCode}`);

      if (!testStats) {
        testBlockers.push('no tests detected in the test output — a run that reports no counts cannot pass');
      } else if (testStats.failed > 0) {
        testBlockers.push(
          `Test pass rate ${(testStats.passRate * 100).toFixed(1)}% — ${testStats.failed} failing (CRITICAL: 100% required)`
        );
      } else if (testStats.passed === 0) {
        testBlockers.push(`no test passed (${testStats.total} reported, none ran to a pass)`);
      }
    }

    // Fail closed: a check marked FAILED blocks even if no specific reason was recognised above.
    if (testBlockers.length === 0 && testResult.status === 'FAILED') {
      testBlockers.push(`Test check FAILED: ${testResult.failureReason ?? testResult.command}`);
    }

    if (testBlockers.length > 0) {
      blockers.push(...testBlockers);
      reasons.push(
        testStats ? `${testStats.failed}/${testStats.passed + testStats.failed} tests failing.` : 'Test results not verified.'
      );
    }
  }

  const devResult = audit.results.find(r => r.type === 'dev-server');
  if (devResult?.status === 'FAILED') {
    blockers.push(`Dev server startup FAILED${devResult.failureReason ? `: ${devResult.failureReason}` : ''}`);
    reasons.push('Dev server has errors.');
  }

  const canAdvance = blockers.length === 0;
  const passRate = testStats?.passRate ?? 0;
  const warnings = unique([...(audit.warnings ?? []), ...resultWarnings(audit.results)]);

  return {
    canAdvance,
    passRate,
    blockers,
    warnings,
    remediation: canAdvance ? 'All checks passed — ready for Validator' : `Fix failures and re-run: ${blockers[0]}`,
    reason: reasons.join(' '),
    ...(testStats ? { testStats } : {})
  };
}

const STATUS_LABEL: Record<ExecutionCheckStatus, string> = {
  PASSED: '✅ PASS',
  FAILED: '❌ FAIL',
  SKIPPED: '⏭️  SKIPPED'
};

/**
 * Generate human-readable execution report
 */
export function generateExecutionReport(audit: ExecutionAudit): string {
  const lines: string[] = [
    `# Execution Verification Report`,
    `**Timestamp:** ${audit.timestamp}`,
    `**Project:** ${audit.projectRoot}`,
    ``
  ];

  for (const result of audit.results) {
    lines.push(`## ${result.type.toUpperCase()} Execution`);
    lines.push(`**Command:** \`${result.command}\``);
    lines.push(`**Status:** ${STATUS_LABEL[result.status]}`);
    if (result.skipReason) lines.push(`**Skipped:** ${result.skipReason}`);
    if (result.failureReason) lines.push(`**Failure:** ${result.failureReason}`);
    lines.push(`**Duration:** ${(result.duration / 1000).toFixed(2)}s`);
    lines.push(`**Exit Code:** ${result.exitCode ?? (result.timedOut ? 'stopped at timeout' : 'none')}`);

    if (result.testStats) {
      const s = result.testStats;
      lines.push(`**Test Results:**`);
      lines.push(`- Total: ${s.total} | Passed: ${s.passed} | Failed: ${s.failed} | Skipped: ${s.skipped} | Todo: ${s.todo}`);
      lines.push(`- **Pass Rate:** ${(s.passRate * 100).toFixed(1)}% of tests that ran`);

      if (s.failed > 0) {
        lines.push(`⚠️ **CRITICAL:** 100% pass rate required. Failing tests block Stage 4.`);
      }
    }

    if (result.status === 'FAILED' && result.stderr.length > 0) {
      lines.push(`**Errors:**`);
      lines.push('```');
      lines.push(result.stderr.substring(0, 500));
      if (result.stderr.length > 500) lines.push('... (truncated)');
      lines.push('```');
    }

    lines.push('');
  }

  const decision = validateExecutionGate(audit);
  lines.push(`## Gate Decision`);
  lines.push(`**Can Advance:** ${decision.canAdvance ? '✅ YES' : '❌ NO'}`);
  if (decision.blockers.length > 0) {
    lines.push(`**Blockers:**`);
    decision.blockers.forEach(b => lines.push(`- ${b}`));
  }
  if (decision.warnings.length > 0) {
    lines.push(`**Warnings:**`);
    decision.warnings.forEach(w => lines.push(`- ${w}`));
  }
  lines.push(`**Remediation:** ${decision.remediation}`);

  return lines.join('\n');
}

/**
 * Collect all execution audit data. Checks run one after another — build, test, dev — never in
 * parallel: concurrently they fight over ports and CPU, and a slow build starves the tests.
 */
export async function auditExecution(projectRoot: string, options: ExecutionGateOptions = {}): Promise<ExecutionAudit> {
  const timestamp = new Date().toISOString();

  const buildResult = await runBuild(projectRoot, options);
  const testResult = await runTestSuite(projectRoot, options);
  const devResult = await verifyDevServer(projectRoot, options);

  const results = [buildResult, testResult, devResult];
  const allPassed = results.every(r => r.passed);
  const failedTests = parseFailedTestNames(testResult.stdout + '\n' + testResult.stderr);
  const buildErrors =
    buildResult.status === 'FAILED'
      ? [(buildResult.stderr || buildResult.stdout || buildResult.failureReason || '').slice(-500)]
      : [];
  const failedCount = results.filter(r => r.status === 'FAILED').length;

  return {
    stage: 6,
    timestamp,
    projectRoot,
    results,
    allPassed,
    failedTests,
    buildErrors,
    warnings: resultWarnings(results),
    summary: allPassed ? 'All execution checks passed ✅' : `${failedCount} check(s) failed ❌`
  };
}
