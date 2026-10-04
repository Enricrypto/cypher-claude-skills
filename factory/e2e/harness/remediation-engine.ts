/**
 * Remediation Engine
 *
 * Orchestrates the Phase 3 remediation loop with:
 * - Mandatory Docker rebuild before each test run
 * - 100% acceptance (no partial passes)
 * - Regression detection
 * - Iteration limits + escalation to human
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RemediationConfig {
  projectRoot: string;
  phaseDir: string; // LOOP_IMPLEMENTATION/phase-3-remediation
  maxIterations: number; // Default: 5
  maxTokensPerIteration?: number; // Default: 100_000
  maxTotalTokens?: number; // Default: 500_000
  timeoutMs?: number; // Default: 60 * 60 * 1000 (1 hour)
  dockerComposePath?: string; // Default: ./docker-compose.yml
  testCommand?: string; // Default: npm run test:e2e
}

export interface RemediationContext {
  config: RemediationConfig;
  iteration: number;
  testsPassing: number;
  testsFailing: number;
  passRate: number; // 0-1
  beforeRemediation: TestSnapshot;
  currentRun: TestSnapshot;
  history: RemediationIteration[];
  regressions: RegressionDetected[];
}

export interface TestSnapshot {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failedTests: {
    name: string;
    browser: string;
    error: string;
  }[];
  browsers: {
    chromium: { passed: number; failed: number };
    firefox: { passed: number; failed: number };
    'mobile-safari': { passed: number; failed: number };
  };
}

export interface RemediationIteration {
  iteration: number;
  timestamp: string;
  before: TestSnapshot;
  after: TestSnapshot;
  fixesApplied: {
    category: string;
    count: number;
  }[];
  regressions: RegressionDetected[];
  recommendation: 'CONTINUE' | 'SUCCESS' | 'ESCALATE';
  reason: string;
}

export interface RegressionDetected {
  testName: string;
  browser: string;
  wasPassing: boolean;
  isNowPassing: boolean;
  error?: string;
}

export interface EscalationContext {
  reason: 'MAX_ITERATIONS' | 'REGRESSIONS' | 'TIMEOUT' | 'TOKEN_BUDGET';
  iteration: number;
  passRate: number;
  failingTests: number;
  message: string;
  artifacts: {
    testResultsFile: string;
    remediationLog: string;
    diagnosticsDir: string;
  };
}

/**
 * Main Remediation Loop Orchestrator
 */
export class RemediationEngine {
  private config: RemediationConfig;
  private context: RemediationContext;

  constructor(config: RemediationConfig) {
    this.config = config;
    this.context = {
      config,
      iteration: 0,
      testsPassing: 0,
      testsFailing: 0,
      passRate: 0,
      beforeRemediation: {} as TestSnapshot,
      currentRun: {} as TestSnapshot,
      history: [],
      regressions: []
    };
  }

  /**
   * Run the full remediation loop
   * Returns: 'SUCCESS' (100% pass), 'ESCALATE' (human review needed), or throws
   */
  async run(): Promise<'SUCCESS' | 'ESCALATE'> {
    try {
      // Step 0: Capture baseline (before remediation starts)
      console.log('📸 Capturing baseline test state...');
      this.context.beforeRemediation = await this.captureTestState();

      // Step 1: Loop until 100% pass or max iterations
      while (this.context.iteration < this.config.maxIterations) {
        this.context.iteration++;
        console.log(`\n🔄 Remediation Iteration ${this.context.iteration}/${this.config.maxIterations}`);

        // Step 1a: Mandatory environment rebuild (non-optional)
        await this.rebuildEnvironment();

        // Step 1b: Run tests
        const testResults = await this.runTests();
        this.context.currentRun = testResults;

        // Step 1c: Detect regressions (tests that were passing, now failing)
        const regressions = this.detectRegressions(
          this.context.beforeRemediation.failedTests,
          testResults.failedTests
        );
        this.context.regressions = regressions;

        if (regressions.length > 0) {
          console.log(`❌ REGRESSION DETECTED: ${regressions.length} previously passing tests now failing`);
          return await this.handleRegressions(regressions);
        }

        // Step 1d: Check if 100% pass
        if (testResults.passRate === 1.0) {
          console.log('✅ 100% PASS RATE ACHIEVED');
          await this.logSuccess();
          return 'SUCCESS';
        }

        console.log(
          `⚠️  Pass rate: ${(testResults.passRate * 100).toFixed(0)}% ` +
          `(${testResults.passed}/${testResults.total} passing)`
        );

        // Step 1e: Log iteration
        this.context.history.push({
          iteration: this.context.iteration,
          timestamp: new Date().toISOString(),
          before: this.context.iteration === 1 ? this.context.beforeRemediation : this.context.history[this.context.history.length - 1].after,
          after: testResults,
          fixesApplied: [], // Would be populated if we tracked fixes
          regressions: regressions,
          recommendation: testResults.passRate === 1.0 ? 'SUCCESS' : 'CONTINUE',
          reason: testResults.passRate === 1.0 ? 'All tests passing' : 'Continue fixing failures'
        });

        // Step 1f: Check if we should continue or escalate
        const shouldContinue = await this.shouldContinueRemediation(testResults);
        if (!shouldContinue) {
          return await this.escalateToHuman({
            reason: 'MAX_ITERATIONS',
            iteration: this.context.iteration,
            passRate: testResults.passRate,
            failingTests: testResults.failed,
            message: `Remediation unable to reach 100% pass rate after ${this.context.iteration} iterations`,
            artifacts: this.getArtifactPaths()
          });
        }
      }

      // Exceeded max iterations
      console.log(`❌ Max remediation iterations (${this.config.maxIterations}) reached`);
      return await this.escalateToHuman({
        reason: 'MAX_ITERATIONS',
        iteration: this.context.iteration,
        passRate: this.context.currentRun.passRate,
        failingTests: this.context.currentRun.failed,
        message: `Remediation reached iteration limit without achieving 100% pass rate`,
        artifacts: this.getArtifactPaths()
      });
    } catch (error) {
      console.error('❌ Remediation engine error:', error);
      throw error;
    }
  }

  /**
   * MANDATORY: Rebuild environment before EVERY test run
   * This is non-optional and prevents stale-state bugs
   */
  private async rebuildEnvironment(): Promise<void> {
    console.log('🔧 Step 1: Rebuilding environment (Docker)...');

    try {
      // Step 1a: Tear down
      console.log('  → docker-compose down');
      execSync('docker-compose down --volumes', {
        cwd: this.config.projectRoot,
        stdio: 'inherit'
      });

      // Step 1b: Rebuild with no cache (force fresh)
      console.log('  → docker-compose build --no-cache');
      execSync('docker-compose build --no-cache', {
        cwd: this.config.projectRoot,
        stdio: 'inherit'
      });

      // Step 1c: Bring up
      console.log('  → docker-compose up -d');
      execSync('docker-compose up -d', {
        cwd: this.config.projectRoot,
        stdio: 'inherit'
      });

      // Step 1d: Wait for services to be healthy
      console.log('  → Waiting for services to be healthy...');
      await this.waitForServicesHealthy(30_000);

      console.log('✅ Environment rebuilt and healthy');
    } catch (error) {
      console.error('❌ Environment rebuild failed:', error);
      throw error;
    }
  }

  /**
   * Wait for Docker services to be healthy
   */
  private async waitForServicesHealthy(timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check docker ps for healthy status
        const output = execSync('docker-compose ps --format json', {
          cwd: this.config.projectRoot,
          encoding: 'utf-8'
        });

        const services = JSON.parse(output);
        const allHealthy = services.every((s: any) => s.State === 'running' || !s.Health || s.Health === 'healthy');

        if (allHealthy) {
          return;
        }
      } catch (e) {
        // Continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Services did not become healthy within timeout');
  }

  /**
   * Run tests and capture results
   */
  private async runTests(): Promise<TestSnapshot> {
    console.log('🧪 Running tests...');

    try {
      const command = this.config.testCommand || 'npm run test:e2e';

      // Run tests with JSON reporter
      execSync(`${command} --reporter=json > test-results.json`, {
        cwd: this.config.projectRoot,
        stdio: 'pipe'
      });

      // Parse results
      const resultsFile = path.join(this.config.projectRoot, 'test-results.json');
      const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

      const snapshot: TestSnapshot = {
        timestamp: new Date().toISOString(),
        total: results.stats.tests,
        passed: results.stats.passes,
        failed: results.stats.failures,
        passRate: results.stats.passes / results.stats.tests,
        failedTests: this.extractFailedTests(results),
        browsers: {
          chromium: { passed: 0, failed: 0 },
          firefox: { passed: 0, failed: 0 },
          'mobile-safari': { passed: 0, failed: 0 }
        }
      };

      console.log(`📊 Test Results: ${snapshot.passed}/${snapshot.total} passed (${(snapshot.passRate * 100).toFixed(0)}%)`);
      return snapshot;
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      throw error;
    }
  }

  /**
   * Capture current test state (for comparison)
   */
  private async captureTestState(): Promise<TestSnapshot> {
    console.log('📸 Capturing test state...');

    try {
      await this.rebuildEnvironment();
      return await this.runTests();
    } catch (error) {
      console.error('❌ Failed to capture baseline:', error);
      throw error;
    }
  }

  /**
   * Detect regressions: tests that were passing before, now failing
   */
  private detectRegressions(beforeFailed: any[], afterFailed: any[]): RegressionDetected[] {
    const beforeFailedNames = new Set(beforeFailed.map(t => t.name));
    const afterFailedNames = new Set(afterFailed.map(t => t.name));

    // Tests that are now failing but weren't before
    const regressions: RegressionDetected[] = [];

    for (const test of afterFailed) {
      if (!beforeFailedNames.has(test.name)) {
        regressions.push({
          testName: test.name,
          browser: test.browser,
          wasPassing: true,
          isNowPassing: false,
          error: test.error
        });
      }
    }

    return regressions;
  }

  /**
   * Handle regressions (agent broke something that was working)
   */
  private async handleRegressions(regressions: RegressionDetected[]): Promise<'ESCALATE'> {
    console.log(`\n❌ REGRESSION DETECTION TRIGGERED`);
    console.log(`${regressions.length} test(s) were passing, now failing:`);

    for (const reg of regressions) {
      console.log(`  • ${reg.testName} (${reg.browser})`);
      if (reg.error) console.log(`    Error: ${reg.error.substring(0, 80)}...`);
    }

    // Rollback changes
    console.log('\n🔄 Rolling back all changes...');
    try {
      execSync('git checkout -- e2e/tests', {
        cwd: this.config.projectRoot
      });
      console.log('✅ Rolled back to pre-remediation state');
    } catch (e) {
      console.log('⚠️  Rollback failed — check git state manually');
    }

    return await this.escalateToHuman({
      reason: 'REGRESSIONS',
      iteration: this.context.iteration,
      passRate: this.context.currentRun.passRate,
      failingTests: regressions.length,
      message: `Agent fix caused ${regressions.length} regression(s). Changes rolled back.`,
      artifacts: this.getArtifactPaths()
    });
  }

  /**
   * Should we continue remediation or escalate?
   */
  private async shouldContinueRemediation(testResults: TestSnapshot): Promise<boolean> {
    // Continue if:
    // 1. Not at max iterations
    // 2. Pass rate is improving (or at least not getting worse)
    // 3. No regressions

    if (this.context.iteration >= this.config.maxIterations) {
      return false;
    }

    if (this.context.regressions.length > 0) {
      return false;
    }

    // If pass rate is declining too much, escalate
    const prevRate = this.context.history[this.context.history.length - 1]?.before.passRate || 0;
    if (testResults.passRate < prevRate * 0.9) {
      console.log(`⚠️  Pass rate declining (${prevRate.toFixed(2)} → ${testResults.passRate.toFixed(2)})`);
      return false;
    }

    return true;
  }

  /**
   * Extract failed test details from results
   */
  private extractFailedTests(results: any): { name: string; browser: string; error: string }[] {
    const failed = [];

    for (const test of results.tests || []) {
      if (test.status === 'failed') {
        failed.push({
          name: test.title,
          browser: test.project?.name || 'unknown',
          error: test.error?.message || test.error?.toString() || 'Unknown error'
        });
      }
    }

    return failed;
  }

  /**
   * Log successful remediation
   */
  private async logSuccess(): Promise<void> {
    const summary = {
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
      iterations: this.context.iteration,
      beforeRemediationPassRate: this.context.beforeRemediation.passRate,
      afterRemediationPassRate: this.context.currentRun.passRate,
      totalTestsPassing: this.context.currentRun.passed,
      totalTests: this.context.currentRun.total,
      regressions: this.context.regressions.length
    };

    const logPath = path.join(this.config.phaseDir, 'REMEDIATION_SUCCESS.json');
    fs.writeFileSync(logPath, JSON.stringify(summary, null, 2));

    console.log(`
✅ REMEDIATION COMPLETE
   Iterations: ${this.context.iteration}
   Pass Rate: ${(this.context.currentRun.passRate * 100).toFixed(0)}% (${this.context.currentRun.passed}/${this.context.currentRun.total})
   Summary: ${logPath}
    `);
  }

  /**
   * Get artifact paths for escalation report
   */
  private getArtifactPaths(): { testResultsFile: string; remediationLog: string; diagnosticsDir: string } {
    return {
      testResultsFile: path.join(this.config.projectRoot, 'test-results.json'),
      remediationLog: path.join(this.config.phaseDir, 'REMEDIATION_LOG.md'),
      diagnosticsDir: path.join(this.config.phaseDir, 'diagnostics')
    };
  }

  /**
   * Escalate to human review
   * Returns 'ESCALATE' to signal phase termination
   */
  private async escalateToHuman(escalation: EscalationContext): Promise<'ESCALATE'> {
    console.log(`
⛔ ESCALATING TO HUMAN REVIEW

Reason: ${escalation.reason}
Iteration: ${escalation.iteration}
Pass Rate: ${(escalation.passRate * 100).toFixed(0)}%
Failing Tests: ${escalation.failingTests}

Message: ${escalation.message}

Artifacts ready for review:
  • Test Results: ${escalation.artifacts.testResultsFile}
  • Remediation Log: ${escalation.artifacts.remediationLog}
  • Diagnostics: ${escalation.artifacts.diagnosticsDir}

Next Steps:
  1. Review the failing tests and error messages
  2. Identify root cause (selector, API, timing, data, etc.)
  3. Fix the test code or application code
  4. Re-run remediation

⏸️  Waiting for manual intervention...
    `);

    // Write escalation report
    const report: EscalationContext = escalation;
    const reportPath = path.join(this.config.phaseDir, 'ESCALATION_REPORT.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Escalation report: ${reportPath}`);

    return 'ESCALATE';
  }
}
