/**
 * Feature Factory Execution Verification Gates
 *
 * Verifies that claimed work actually executed successfully:
 * - Tests ran and passed (100% pass rate required)
 * - Build compiled without errors
 * - Dev server starts cleanly
 *
 * Prevents hallucinations where agents claim "tests passing" without running them.
 *
 * Adapted from: e2e-loop/harness/phase-gates.ts
 * Specialized for: Feature Factory execution verification
 */

import { execSync } from 'child_process';

export interface ExecutionResult {
  type: 'test' | 'build' | 'dev-server';
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number; // milliseconds
  testStats?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number; // 0-1
  };
}

export interface ExecutionAudit {
  stage: 6; // After Test Verifier
  timestamp: string;
  projectRoot: string;
  results: ExecutionResult[];
  allPassed: boolean;
  failedTests: string[];
  buildErrors: string[];
  summary: string;
}

export interface ExecutionGateDecision {
  canAdvance: boolean;
  passRate: number;
  blockers: string[];
  remediation: string;
  reason: string;
}

/**
 * Run test suite and capture results
 */
export async function runTestSuite(
  projectRoot: string,
  testCommand: string = 'npm run test'
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    const stdout = execSync(testCommand, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const duration = Date.now() - startTime;

    // Parse test output for pass/fail counts
    const testStats = parseTestOutput(stdout);

    return {
      type: 'test',
      command: testCommand,
      passed: testStats.passRate === 1,
      exitCode: 0,
      stdout,
      stderr: '',
      duration,
      testStats
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    const stdout = err.stdout ? err.stdout.toString() : '';

    // Parse whatever output we got
    const testStats = parseTestOutput(stdout + stderr);

    return {
      type: 'test',
      command: testCommand,
      passed: false,
      exitCode: err.status || 1,
      stdout,
      stderr,
      duration,
      testStats
    };
  }
}

/**
 * Run build and verify it compiles
 */
export async function runBuild(
  projectRoot: string,
  buildCommand: string = 'npm run build'
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    const stdout = execSync(buildCommand, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const duration = Date.now() - startTime;

    return {
      type: 'build',
      command: buildCommand,
      passed: true,
      exitCode: 0,
      stdout,
      stderr: '',
      duration
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    const stdout = err.stdout ? err.stdout.toString() : '';

    return {
      type: 'build',
      command: buildCommand,
      passed: false,
      exitCode: err.status || 1,
      stdout,
      stderr,
      duration
    };
  }
}

/**
 * Verify dev server starts without critical errors
 */
export async function verifyDevServer(
  projectRoot: string,
  devCommand: string = 'npm run dev'
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Run with timeout — don't wait for full startup
    const stdout = execSync(`timeout 10 ${devCommand} 2>&1 || true`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      shell: '/bin/bash'
    });

    const duration = Date.now() - startTime;

    // Check for critical error patterns
    const hasCriticalErrors = /error|failed|cannot|undefined/i.test(stdout);

    return {
      type: 'dev-server',
      command: devCommand,
      passed: !hasCriticalErrors,
      exitCode: hasCriticalErrors ? 1 : 0,
      stdout,
      stderr: '',
      duration
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const output = err.stdout ? err.stdout.toString() : err.message;

    return {
      type: 'dev-server',
      command: devCommand,
      passed: false,
      exitCode: err.status || 1,
      stdout: output,
      stderr: '',
      duration
    };
  }
}

/**
 * Parse test output for pass/fail counts
 * Handles Jest, Vitest, Mocha, and Playwright output formats
 */
function parseTestOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
} {
  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0;

  // Jest/Vitest format: "Tests:  X passed, Y failed, Z skipped out of A total"
  const jestMatch = output.match(
    /Tests?:?\s+(\d+)\s+(?:passed|✓).*?(\d+)\s+(?:failed|✕)?.*?(\d+)\s+(?:skipped)?.*?(\d+)\s+total/is
  );
  if (jestMatch) {
    passed = parseInt(jestMatch[1]);
    failed = parseInt(jestMatch[2]);
    skipped = parseInt(jestMatch[3]);
    total = parseInt(jestMatch[4]);
  }

  // Simpler format: "X passed Y failed Z skipped"
  if (total === 0) {
    const simpleMatch = output.match(
      /(\d+)\s+(?:pass|✓).*?(\d+)\s+(?:fail|✕)?.*?(\d+)\s+(?:skip)?/is
    );
    if (simpleMatch) {
      passed = parseInt(simpleMatch[1]);
      failed = parseInt(simpleMatch[2] || '0');
      skipped = parseInt(simpleMatch[3] || '0');
      total = passed + failed + skipped;
    }
  }

  // Playwright format: "X passed, Y failed"
  if (total === 0) {
    const pwMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/is);
    if (pwMatch) {
      passed = parseInt(pwMatch[1]);
      failed = parseInt(pwMatch[2]);
      total = passed + failed;
    }
  }

  // Fallback: count from output
  if (total === 0) {
    const passCount = (output.match(/PASS|✓|\s+pass/gi) || []).length;
    const failCount = (output.match(/FAIL|✕|\s+fail/gi) || []).length;
    if (passCount > 0 || failCount > 0) {
      passed = passCount;
      failed = failCount;
      total = passed + failed;
    }
  }

  const passRate = total > 0 ? passed / total : 0;

  return { total, passed, failed, skipped, passRate };
}

/**
 * Verify execution gate passes
 * CRITICAL: 100% test pass rate required
 */
export function validateExecutionGate(audit: ExecutionAudit): ExecutionGateDecision {
  const blockers: string[] = [];
  let reason = '';

  // Check build
  const buildResult = audit.results.find((r) => r.type === 'build');
  if (buildResult && !buildResult.passed) {
    blockers.push(`Build FAILED: ${buildResult.command}`);
    reason += `Build compilation failed. `;
  }

  // Check tests — CRITICAL: must be 100% passing
  const testResult = audit.results.find((r) => r.type === 'test');
  if (testResult) {
    if (!testResult.testStats) {
      blockers.push('Could not parse test results');
      reason += 'Test output unreadable. ';
    } else if (testResult.testStats.passRate < 1) {
      blockers.push(
        `Test pass rate ${(testResult.testStats.passRate * 100).toFixed(1)}% — ` +
          `${testResult.testStats.failed} failing (CRITICAL: 100% required)`
      );
      reason += `${testResult.testStats.failed}/${testResult.testStats.total} tests failing. `;
    }
  } else {
    blockers.push('No test execution recorded');
    reason += 'Tests did not run. ';
  }

  // Check dev server
  const devResult = audit.results.find((r) => r.type === 'dev-server');
  if (devResult && !devResult.passed) {
    blockers.push('Dev server startup FAILED');
    reason += 'Dev server has errors. ';
  }

  const canAdvance = blockers.length === 0;
  const passRate = testResult?.testStats?.passRate ?? 0;

  const remediation = canAdvance
    ? 'All checks passed — ready for Validator'
    : `Fix failures and re-run: ${blockers[0]}`;

  return {
    canAdvance,
    passRate,
    blockers,
    remediation,
    reason: reason.trim()
  };
}

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
    lines.push(`**Status:** ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
    lines.push(`**Duration:** ${(result.duration / 1000).toFixed(2)}s`);
    lines.push(`**Exit Code:** ${result.exitCode}`);

    if (result.testStats) {
      lines.push(`**Test Results:**`);
      lines.push(
        `- Total: ${result.testStats.total} | ` +
          `Passed: ${result.testStats.passed} | ` +
          `Failed: ${result.testStats.failed} | ` +
          `Skipped: ${result.testStats.skipped}`
      );
      lines.push(`- **Pass Rate:** ${(result.testStats.passRate * 100).toFixed(1)}%`);

      if (result.testStats.passRate < 1) {
        lines.push(`⚠️ **CRITICAL:** 100% pass rate required. Failing tests block Stage 4.`);
      }
    }

    if (result.stderr && result.stderr.length > 0) {
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
    decision.blockers.forEach((b) => lines.push(`- ${b}`));
  }
  lines.push(`**Remediation:** ${decision.remediation}`);

  return lines.join('\n');
}

/**
 * Collect all execution audit data
 */
export async function auditExecution(
  projectRoot: string,
  testCommand: string = 'npm run test',
  buildCommand: string = 'npm run build'
): Promise<ExecutionAudit> {
  const timestamp = new Date().toISOString();

  // Run all verifications
  const [buildResult, testResult, devResult] = await Promise.all([
    runBuild(projectRoot, buildCommand),
    runTestSuite(projectRoot, testCommand),
    verifyDevServer(projectRoot)
  ]);

  const results = [buildResult, testResult, devResult];
  const allPassed = results.every((r) => r.passed);
  const failedTests = testResult.testStats ? [] : [];
  const buildErrors = buildResult.passed ? [] : [buildResult.stderr.substring(0, 200)];

  return {
    stage: 6,
    timestamp,
    projectRoot,
    results,
    allPassed,
    failedTests,
    buildErrors,
    summary: allPassed
      ? 'All execution checks passed ✅'
      : `${results.filter((r) => !r.passed).length} check(s) failed ❌`
  };
}
