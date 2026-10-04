/**
 * Gate fixtures (AC-1, AC-2).
 *
 * Orchestrator tests inject these through `OrchestrationOptions.gates`, so no test ever runs a
 * real `npm run build/test/dev` in a temp project. Only the AUDITS are faked; the decision
 * functions (validateInfrastructureGate / validateExecutionGate) stay real, so the tests
 * exercise the orchestrator's real judgement of the evidence.
 */

import { InfrastructureAudit, InfrastructureCheck } from '../../harness/infrastructure-gates';
import { ExecutionAudit, ExecutionResult } from '../../harness/execution-gates';
import { OrchestrationGates } from '../../feature/workflows/feature-factory-orchestrator';

/** An infrastructure audit. `critical` and `warnings` are the messages of failed checks. */
export function infraAudit({
  critical = [],
  warnings = []
}: { critical?: string[]; warnings?: string[] } = {}): InfrastructureAudit {
  const failed = (severity: InfrastructureCheck['severity']) => (message: string): InfrastructureCheck => ({
    name: message,
    severity,
    passed: false,
    message,
    remediation: `Fix: ${message}`
  });

  const criticalFailures = critical.map(failed('CRITICAL'));
  const warningChecks = warnings.map(failed('WARNING'));
  const passing: InfrastructureCheck = {
    name: 'npm script: test',
    severity: 'CRITICAL',
    passed: true,
    message: 'test script present'
  };

  return {
    timestamp: new Date().toISOString(),
    projectRoot: '/fixture',
    checks: [passing, ...criticalFailures, ...warningChecks],
    criticalFailures,
    warnings: warningChecks,
    canProceed: criticalFailures.length === 0,
    summary: criticalFailures.length === 0 ? 'Infrastructure ready' : `${criticalFailures.length} critical failure(s)`
  };
}

/**
 * An execution audit. Defaults: 10 tests, all passing; build and dev server clean. Give
 * `passed` or `failed` and the other is derived from `total`; any remainder is skipped.
 * `warnings` become the audit's non-blocking warnings (Gate 2 records them as findings).
 */
export function executionAudit({
  total = 10,
  passed: passedIn,
  failed: failedIn,
  buildFailed = false,
  warnings = []
}: { total?: number; passed?: number; failed?: number; buildFailed?: boolean; warnings?: string[] } = {}): ExecutionAudit {
  const failed = failedIn ?? (passedIn !== undefined ? total - passedIn : 0);
  const passed = passedIn ?? total - failed;

  const result = (type: ExecutionResult['type'], command: string, ok: boolean): ExecutionResult => ({
    type,
    command,
    status: ok ? 'PASSED' : 'FAILED',
    passed: ok,
    exitCode: ok ? 0 : 1,
    timedOut: false,
    stdout: '',
    stderr: ok ? '' : `${command} failed`,
    duration: 1,
    ...(ok ? {} : { failureReason: `${command} exited with code 1` })
  });

  const test: ExecutionResult = {
    ...result('test', 'npm run test', failed === 0),
    testStats: {
      total,
      passed,
      failed,
      skipped: Math.max(0, total - passed - failed),
      todo: 0,
      passRate: passed + failed === 0 ? 0 : passed / (passed + failed)
    }
  };
  const build = result('build', 'npm run build', !buildFailed);
  const dev = result('dev-server', 'npm run dev', true);
  const results = [build, test, dev];
  const allPassed = results.every(r => r.passed);

  return {
    stage: 6,
    timestamp: new Date().toISOString(),
    projectRoot: '/fixture',
    results,
    allPassed,
    failedTests: [],
    buildErrors: buildFailed ? [build.stderr] : [],
    warnings,
    summary: allPassed ? 'All execution checks passed' : 'Execution checks failed'
  };
}

/** A gate that throws, for the fail-closed paths. */
export function throwingGate(message: string): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}

type GateName = keyof OrchestrationGates;
type Scripted<T> = T | ((callNumber: number) => T | Promise<T>);

export interface GateScript {
  auditInfrastructure?: Scripted<InfrastructureAudit>;
  auditExecution?: Scripted<ExecutionAudit>;
}

export interface RecordingGates {
  /** Pass this as `OrchestrationOptions.gates`. */
  gates: OrchestrationGates;
  /** Every gate call, in order, with the project directory it was asked to audit. */
  calls: Array<{ gate: GateName; cwd: string }>;
}

/**
 * Fake gates that record the order they are called in. Each gate returns its scripted audit
 * (a value, or a function of the 1-based call number), defaulting to a passing audit.
 */
export function recordingGates(script: GateScript = {}): RecordingGates {
  const calls: RecordingGates['calls'] = [];
  const count = (gate: GateName) => calls.filter(c => c.gate === gate).length;

  const play = async <T>(entry: Scripted<T> | undefined, n: number, fallback: () => T): Promise<T> => {
    if (entry === undefined) return fallback();
    return typeof entry === 'function' ? (entry as (callNumber: number) => T | Promise<T>)(n) : entry;
  };

  return {
    calls,
    gates: {
      auditInfrastructure: async (cwd: string) => {
        calls.push({ gate: 'auditInfrastructure', cwd });
        return play(script.auditInfrastructure, count('auditInfrastructure'), () => infraAudit());
      },
      auditExecution: async (cwd: string) => {
        calls.push({ gate: 'auditExecution', cwd });
        return play(script.auditExecution, count('auditExecution'), () => executionAudit());
      }
    }
  };
}
