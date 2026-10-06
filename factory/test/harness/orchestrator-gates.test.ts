/**
 * Gate 1.5 and Gate 2 as the orchestrator actually runs them.
 *
 * Until the gate seam (AC-1) existed, no test could get past Stage 3: reaching Gate 1.5 meant
 * the orchestrator running real `npm run build/test/dev` in a temp project. The audits are now
 * injected through `OrchestrationOptions.gates`; the decisions on their results stay real.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import childProcess = require('child_process');

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { executionAudit, infraAudit, recordingGates, throwingGate } from '../fixtures/gates';
import { ALL_SURFACES_PRESENT, backend, featureSpec, researcher, spec, story, testVerifier, validator } from '../fixtures/agent-outputs';
import { AgentInvocation } from '../../runner/invoke-agent';
import { FeatureState } from '../../harness/state-tracker';
import { harnessGeneratedLabel } from '../../harness/harness-documents';
import { baselineFilePath, RegressionBaseline } from '../../harness/regression-baseline';
import { OrchestrationGates } from '../../feature/workflows/feature-factory-orchestrator';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-gates-');
});

afterEach(() => {
  project.cleanup();
  jest.restoreAllMocks();
});

describe('orchestrator gates', () => {
  it('AC-1 injected gates are called at Gate 1.5 and Gate 2 and no child process is spawned', async () => {
    const spawned = [
      jest.spyOn(childProcess, 'spawn'),
      jest.spyOn(childProcess, 'spawnSync'),
      jest.spyOn(childProcess, 'execSync')
    ];
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(recorded.calls).toEqual([
      { gate: 'auditInfrastructure', cwd: project.dir },
      { gate: 'auditExecution', cwd: project.dir }
    ]);
    for (const spy of spawned) expect(spy).not.toHaveBeenCalled();
  });

  it('AC-5 a throwing infrastructure gate escalates INFRASTRUCTURE_FAILURE and the Test Verifier is never invoked', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditInfrastructure: throwingGate('tsconfig.json is unreadable') });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => e.reason)).toEqual(['INFRASTRUCTURE_FAILURE']);
    expect(state.escalations[0].stage).toBe(4);
    expect(state.escalations[0].context.message).toMatch(/tsconfig\.json is unreadable/);
    expect(invoker.agents()).not.toContain('06-test-verifier');
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
    // Not a warn-and-continue: nothing records the error as a non-blocking loop-back.
    expect(state.loopBacks.filter(l => l.result === 'WARN')).toEqual([]);
  });

  it('AC-6 a throwing execution gate escalates EXECUTION_FAILURE and the Validator is never invoked', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: throwingGate('spawn npm ENOENT') });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => e.reason)).toEqual(['EXECUTION_FAILURE']);
    expect(state.escalations[0].stage).toBe(4);
    expect(state.escalations[0].context.message).toMatch(/spawn npm ENOENT/);
    expect(invoker.agents()).toContain('06-test-verifier');
    // PR B-2 (D-8): the Validator runs in parallel with the Test Verifier, before Gate 2; its review is never decided.
    expect(invoker.agents().filter(a => a === '07-validator')).toHaveLength(1);
    expect(state.stageHistory.filter(s => s.agent === '07-validator')).toEqual([]);
    expect(state.checkpointApprovals.some(a => a.checkpointId === 3)).toBe(false);
    expect(state.loopBacks.filter(l => l.result === 'WARN')).toEqual([]);
  });

  it('AC-7 a blocking execution result escalates with failing details, no Validator, no Test Verifier re-run', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const failing = { ...executionAudit({ total: 10, failed: 2 }), failedTests: ['TotpService › rejects a reused code'] };
    const recorded = recordingGates({ auditExecution: failing });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => e.reason)).toEqual(['EXECUTION_FAILURE']);
    const context = state.escalations[0].context;
    expect(context.blockers?.some(b => /2 failing/.test(b))).toBe(true);
    expect(context.failingTests).toEqual(['TotpService › rejects a reused code']);
    expect(context.passRate).toBeCloseTo(0.8);
    expect(invoker.agents().filter(a => a === '06-test-verifier')).toHaveLength(1);
    // PR B-2 (D-8): the Validator runs in parallel with the Test Verifier, before Gate 2; its review is never decided.
    expect(invoker.agents().filter(a => a === '07-validator')).toHaveLength(1);
    expect(state.stageHistory.filter(s => s.agent === '07-validator')).toEqual([]);
    expect(state.checkpointApprovals.some(a => a.checkpointId === 3)).toBe(false);
    expect(recorded.calls.filter(c => c.gate === 'auditExecution')).toHaveLength(1);
  });

  it.each([
    ['a relative path', (_dir: string) => '.factory/notes.md'],
    ['an absolute path', (dir: string) => join(dir, '.factory', 'BACKEND_SUMMARY.md')],
    ['a path that climbs back into it', (_dir: string) => 'src/../.factory/x.md']
  ])('a builder claiming a path inside .factory/ fails materialization (%s)', async (_label, claimed) => {
    const path = claimed(project.dir);
    const invoker = scriptedInvoker(
      { ...passingScript(), '04-backend-builder': backend({ files: ['src/a.ts', path] }) },
      { cwd: project.dir }
    );
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    // The file exists (the fake builder wrote it) — it is rejected for WHERE it is, not for absence.
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[3, 'harness', 'HALLUCINATION_DETECTED']]);
    expect(state.escalations[0].context.message).toContain(path);
    expect(state.escalations[0].context.message).toMatch(/\.factory/);
    expect(recorded.calls).toEqual([]);
  });

  it('AC-16 an invoker output with no details escalates SCHEMA_VALIDATION, not MANUAL', async () => {
    const noDetails = (call: AgentInvocation) => ({
      stage: call.stage,
      agent: call.agent,
      timestamp: new Date().toISOString(),
      status: 'PASS'
    });
    const invoker = scriptedInvoker({ '01-researcher': noDetails }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => e.reason)).toEqual(['SCHEMA_VALIDATION']);
    expect(state.escalations[0].context.message).toMatch(/details/);
  });

  it('AC-16 a builder output with no details is a schema loop-back, never an orchestration crash', async () => {
    const noDetails = (call: AgentInvocation) => ({
      stage: call.stage,
      agent: call.agent,
      timestamp: new Date().toISOString(),
      status: 'PASS'
    });
    const invoker = scriptedInvoker(
      { ...passingScript(), '04-backend-builder': noDetails },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.escalations.map(e => e.reason)).toEqual(['MAX_LOOPS']);
    expect(state.loopBacks.filter(l => l.agent === '04-backend-builder')).toHaveLength(3);
    for (const loop of state.loopBacks) expect(loop.reason).toMatch(/details/);
  });

  // ==========================================================================================
  // Backlog: a builder's own verdict and a missing envelope (MINOR-6, MINOR-10)
  // ==========================================================================================

  const builderSteps = (state: FeatureState, status: string) =>
    state.stageHistory.filter(s => s.agent === '04-backend-builder' && s.status === status);
  const builderLoopBacks = (state: FeatureState) => state.loopBacks.filter(l => l.agent === '04-backend-builder');

  /** A schema-valid backend build that reports `status` instead of PASS, and no failing test. */
  const backendWithStatus = (status: 'FAIL' | 'LOOP_BACK') => {
    const output = backend();
    return { ...output, status, details: { ...output.details, summary: 'Could not wire the enable route.' } };
  };

  it('MINOR-6 a builder returning status FAIL with a valid schema and no failing test is retried, never recorded PASS', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '04-backend-builder': () => backendWithStatus('FAIL') },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[3, '04-backend-builder', 'MAX_LOOPS']]);
    expect(builderSteps(state, 'PASS')).toEqual([]);
    expect(builderLoopBacks(state).map(l => l.failure?.kind)).toEqual(['status', 'status', 'status']);
    expect(builderLoopBacks(state)[0].reason).toMatch(/status FAIL/);
    // The retry is briefed with what the builder said about its own attempt.
    const prompts = invoker.promptsFor('04-backend-builder');
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain('Could not wire the enable route.');
    expect(prompts[1]).toContain('Could not wire the enable route.');
    expect(invoker.agents()).not.toContain('06-test-verifier');
  });

  it('MINOR-6 a builder returning LOOP_BACK with a valid schema uses an attempt and the next attempt can pass', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '04-backend-builder': (_call: AgentInvocation, n: number) => (n === 1 ? backendWithStatus('LOOP_BACK') : backend()) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(builderLoopBacks(state).map(l => [l.failure?.kind, l.attempt])).toEqual([['status', 1]]);
    expect(builderLoopBacks(state)[0].reason).toMatch(/status LOOP_BACK/);
    expect(builderSteps(state, 'PASS')).toHaveLength(1);
  });

  it('MINOR-10 a builder invoker returning null is a schema failure that is retried, not a MANUAL escalation', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '04-backend-builder': (_call: AgentInvocation, n: number) => (n === 1 ? null : backend()) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.escalations).toEqual([]);
    expect(builderLoopBacks(state).map(l => l.failure)).toEqual([{ kind: 'schema', error: 'output is not an object' }]);
    expect(invoker.promptsFor('04-backend-builder')[1]).toMatch(/MALFORMED/);
  });

  it.each<[string, unknown]>([
    ['a string', 'done'],
    ['a number', 42],
    ['undefined', undefined]
  ])('MINOR-10 a builder invoker returning %s on every attempt exhausts its attempts (MAX_LOOPS), not MANUAL', async (_label, value) => {
    const invoker = scriptedInvoker({ ...passingScript(), '04-backend-builder': () => value }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[3, '04-backend-builder', 'MAX_LOOPS']]);
    expect(builderLoopBacks(state).map(l => l.failure?.kind)).toEqual(['schema', 'schema', 'schema']);
  });

  it('NEW-MINOR-3 that spec escalates CRITICAL_ISSUE, not MANUAL', async () => {
    const supplied = featureSpec({ files: ['src/a.ts'] });
    supplied.story.details.artifacts.push({ name: 'state.json', path: 'state.json', description: 'Planted', content: '{}' });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, preSuppliedSpec: supplied });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[2, 'tier-1', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/state\.json.*reserved/);
    expect(invoker.agents()).toEqual([]);
    // The planted document never replaced the run's record.
    const record = JSON.parse(readFileSync(join(project.dir, '.factory', state.featureId, 'state.json'), 'utf-8'));
    expect(record.featureId).toBe(state.featureId);
  });

  // ==========================================================================================
  // A1: the Stage 4 gate judges real evidence
  // ==========================================================================================

  const runDir = (state: FeatureState, name: string) => join(project.dir, '.factory', state.featureId, name);
  const findings = (state: FeatureState, source: string) =>
    (state.importantFindings ?? []).filter(f => f.source === source);

  it('AC-17 IMPORTANT stage-gate failures and Gate 1.5 warnings do not block; they land in state.importantFindings', async () => {
    const noRisks = researcher();
    noRisks.details.risks = [];
    const invoker = scriptedInvoker({ ...passingScript(), '01-researcher': noRisks }, { cwd: project.dir });
    const recorded = recordingGates({ auditInfrastructure: infraAudit({ warnings: ['No .env.example file'] }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(findings(state, 'stage-gate').map(f => [f.stage, f.message])).toContainEqual([
      1,
      '[Stage 1] Risks Flagged: No risks or unknowns flagged (may indicate incomplete analysis)'
    ]);
    expect(findings(state, 'gate-1.5').map(f => [f.stage, f.message])).toEqual([[4, 'No .env.example file']]);
  });

  it('I-10 skipped tests in Gate 2 are recorded as an IMPORTANT finding, not counted against 100%', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 10, passed: 8, failed: 0 }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    const gate2 = findings(state, 'gate-2');
    expect(gate2).toHaveLength(1);
    expect(gate2[0].stage).toBe(4);
    expect(gate2[0].message).toMatch(/2 skipped and 0 todo/);
  });

  it('a Validator IMPORTANT issue is recorded as a finding and does not block', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '07-validator': validator({
          issues: [{ severity: 'IMPORTANT', file: 'src/a.ts', line: 3, message: 'No test for the expiry path', suggestion: 'Add one', canFix: true }]
        })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(findings(state, '07-validator').map(f => [f.stage, f.message])).toEqual([
      [4, '[src/a.ts:3] No test for the expiry path']
    ]);
  });

  it('AC-18 story with 5 ACs and 3 tested / 0 not coverable fails "Acceptance Tests Complete"', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '02-story-writer': story({ acCount: 5 }),
        '06-test-verifier': testVerifier({ totalAC: 5, tested: 3, notCoverable: 0 })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, 'harness', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/\[CRITICAL\] Acceptance Tests Complete: 3\/5/);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
  });

  it('AC-18 a Test Verifier total that disagrees with the story fails, even when every reported AC is tested', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '02-story-writer': story({ acCount: 5 }),
        '06-test-verifier': testVerifier({ totalAC: 3, tested: 3 })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/story has 5/);
  });

  it.each<[string, () => unknown, 'FAIL' | 'ESCALATED']>([
    ['status FAIL', () => testVerifier({ status: 'FAIL' }), 'FAIL'],
    ['status ESCALATE', () => testVerifier({ status: 'ESCALATE' }), 'ESCALATED'],
    ['status LOOP_BACK', () => testVerifier({ status: 'LOOP_BACK' }), 'FAIL'],
    ['failed>0', () => testVerifier({ failed: 2 }), 'FAIL'],
    ['CRITICAL issue', () => testVerifier({ criticalIssue: true }), 'FAIL']
  ])('AC-19 Test Verifier %s is not recorded PASS, escalates, the Validator\'s review is never recorded PASS', async (_label, output, recordedAs) => {
    const invoker = scriptedInvoker({ ...passingScript(), '06-test-verifier': output }, { cwd: project.dir });
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, '06-test-verifier', 'CRITICAL_ISSUE']]);
    const steps = state.stageHistory.filter(s => s.agent === '06-test-verifier').map(s => s.status);
    expect(steps).toEqual([recordedAs]);
    // PR B-2 (D-8): invoked once, in parallel with the Test Verifier; no 07-validator step is recorded.
    expect(invoker.agents().filter(a => a === '07-validator')).toHaveLength(1);
    expect(state.stageHistory.filter(s => s.agent === '07-validator')).toEqual([]);
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
    expect(existsSync(runDir(state, 'TEST_REPORT.md'))).toBe(false);
    expect(state.currentStage).toBe(4);
  });

  it('AC-19 the escalation names the failing acceptance criteria and issues', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '06-test-verifier': testVerifier({ criticalIssue: true, tested: 2 }) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    const context = state.escalations[0].context;
    expect(context.issues).toEqual(['[CRITICAL] AC-1: AC-1 is not actually exercised']);
    expect(context.failingTests).toEqual(['AC-3 (TESTING)']);
  });

  it('AC-20 Validator status ESCALATE escalates and is never recorded PASS', async () => {
    const invoker = scriptedInvoker({ ...passingScript(), '07-validator': validator({ status: 'ESCALATE' }) }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, '07-validator', 'CRITICAL_ISSUE']]);
    expect(state.stageHistory.filter(s => s.agent === '07-validator').map(s => s.status)).toEqual(['ESCALATED']);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
    expect(state.currentStage).toBe(4);
  });

  it.each(['FAIL', 'LOOP_BACK'] as const)('I-6 Validator status %s with no CRITICAL issue escalates, never PASS', async status => {
    const invoker = scriptedInvoker({ ...passingScript(), '07-validator': validator({ status }) }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, '07-validator', 'CRITICAL_ISSUE']]);
    expect(state.stageHistory.filter(s => s.agent === '07-validator').map(s => s.status)).toEqual(['FAIL']);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
  });

  it('AC-21 TEST_REPORT.md and VALIDATION_REPORT.md exist in the run dir and not in the project root', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const testReport = readFileSync(runDir(state, 'TEST_REPORT.md'), 'utf-8');
    expect(testReport.split('\n')[0]).toBe(harnessGeneratedLabel('06-test-verifier'));
    expect(readFileSync(runDir(state, 'VALIDATION_REPORT.md'), 'utf-8')).toContain('# Validation Report');
    // Every agent's documents land in the run directory. The Consolidator does not run in a run (AC-44).
    for (const name of [
      'RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md',
      'TEST_REPORT.md', 'VALIDATION_REPORT.md'
    ]) {
      expect({ name, inRunDir: existsSync(runDir(state, name)) }).toEqual({ name, inRunDir: true });
      expect({ name, inRoot: existsSync(join(project.dir, name)) }).toEqual({ name, inRoot: false });
    }
  });

  it('AC-21 a Validator that returns no VALIDATION_REPORT.md fails its schema and escalates SCHEMA_VALIDATION before the Stage 4 gate (MINOR-8, I-11)', async () => {
    const noReport = validator();
    noReport.details.artifacts = [];
    const invoker = scriptedInvoker({ ...passingScript(), '07-validator': noReport }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, '07-validator', 'SCHEMA_VALIDATION']]);
    expect(state.escalations[0].context.message).toMatch(/VALIDATION_REPORT\.md/);
  });

  it('AC-67 brief declaring no auth surface and a Validator auth not_applicable with reason does not block Stage 4', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '03-spec-writer': spec({ securitySurface: { ...ALL_SURFACES_PRESENT, auth: 'ABSENT' } }),
        '07-validator': validator({
          security: { authImplemented: 'not_applicable' },
          notApplicableReasons: { authImplemented: 'The feature adds a CLI flag; there is no request boundary.' }
        })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
  });

  it('AC-68 the same not_applicable blocks Stage 4 when the brief declared the auth surface PRESENT', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '07-validator': validator({
          security: { authImplemented: 'not_applicable' },
          notApplicableReasons: { authImplemented: 'No request boundary.' }
        })
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/authImplemented.*PRESENT/);
  });

  it('a false security check blocks Stage 4', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ security: { inputValidated: false } }) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/Security Audit Passed/);
  });
  // ==========================================================================================
  // A8: "No Regressions" is measured by the harness (D-5, D-12)
  // ==========================================================================================

  /** A baseline a previous successful run left in `.factory/` (seeded here; a SUCCESS run also writes one). */
  const writeBaseline = (testCount: number) => {
    const baseline: RegressionBaseline = {
      schemaVersion: 1,
      runId: 'prior-run',
      testCount,
      recordedAt: '2026-10-01T00:00:00.000Z'
    };
    mkdirSync(join(project.dir, '.factory'), { recursive: true });
    writeFileSync(baselineFilePath(project.dir), JSON.stringify(baseline));
  };

  it('AC-22 a Gate 2 count below the baseline reference fails No Regressions', async () => {
    writeBaseline(12);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 10 }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.map(e => [e.stage, e.agent, e.reason])).toEqual([[4, 'harness', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/\[CRITICAL\] No Regressions: .*10.*12/);
    expect(state.executionGateHistory).toEqual([
      expect.objectContaining({ round: 0, total: 10, passed: 10, failed: 0, passRate: 1, canAdvance: true, referenceCount: 12 })
    ]);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
  });

  it.each([10, 11])('AC-22 a count at or above the reference with 100% passes (%i tests, reference 10)', async total => {
    writeBaseline(10);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: executionAudit({ total }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.executionGateHistory).toEqual([expect.objectContaining({ total, referenceCount: 10 })]);
  });

  it('IMPORTANT-5 skipped tests do not count toward the reference: 10 reported, 8 ran, baseline 10 escalates', async () => {
    writeBaseline(10);
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 10, passed: 8, failed: 0 }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/\[CRITICAL\] No Regressions: .*8 tests ran.*10/);
    expect(state.executionGateHistory).toEqual([
      expect.objectContaining({ round: 0, total: 10, passed: 8, failed: 0, referenceCount: 10 })
    ]);
  });

  it('AC-22 Validator details.regressions is ignored', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ regressions: { count: 3, tests: ['a', 'b', 'c'] } }) },
      { cwd: project.dir }
    );

    const passes = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    // The Validator's self-reported "3 regressions" neither blocks a clean measurement...
    expect(passes.completionStatus).toBe('SUCCESS');

    // ...nor does its "0 regressions" rescue a measurement below the reference.
    project.cleanup();
    project = tempProject('ff-gates-');
    writeBaseline(12);
    const clean = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ regressions: { count: 0, tests: [] } }) },
      { cwd: project.dir }
    );
    const below = recordingGates({ auditExecution: executionAudit({ total: 10 }) });

    const fails = await runToEnd({ cwd: project.dir, invoke: clean.invoke, gates: below.gates });

    expect(fails.completionStatus).toBe('ESCALATED');
    expect(fails.escalations[0].context.blockers?.join('\n')).toMatch(/No Regressions/);
  });

  it('AC-23 the execution gate is first called after the Test Verifier, once per Gate 2 evaluation', async () => {
    const events: string[] = [];
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates();
    const gates: OrchestrationGates = {
      auditInfrastructure: async root => {
        events.push('auditInfrastructure');
        return recorded.gates.auditInfrastructure(root);
      },
      auditExecution: async root => {
        events.push('auditExecution');
        return recorded.gates.auditExecution(root);
      }
    };
    const invoke = async (call: AgentInvocation) => {
      events.push(call.agent);
      return invoker.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, gates });

    expect(state.completionStatus).toBe('SUCCESS');
    const firstExecution = events.indexOf('auditExecution');
    // PR B-2 (D-8): Gate 2 runs after both parallel agents, the Test Verifier and the Validator.
    expect(firstExecution).toBeGreaterThan(events.indexOf('06-test-verifier'));
    expect(firstExecution).toBeGreaterThan(events.indexOf('07-validator'));
    expect(events.filter(e => e === 'auditExecution')).toHaveLength(state.executionGateHistory?.length ?? -1);
    expect(state.executionGateHistory).toHaveLength(1);
  });

  it('AC-65 a baseline file in .factory/ survives cleanup and is used as the first Gate 2 reference', async () => {
    writeBaseline(10);
    // A stale run directory: startup cleanup removes it, but not the baseline beside it.
    mkdirSync(join(project.dir, '.factory', 'stale-run'), { recursive: true });
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(existsSync(join(project.dir, '.factory', 'stale-run'))).toBe(false);
    expect(existsSync(baselineFilePath(project.dir))).toBe(true);
    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.executionGateHistory?.[0].referenceCount).toBe(10);
  });

  it('AC-66 with no baseline the first Gate 2 evaluation applies only the 100% rule', async () => {
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 1 }) });

    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.executionGateHistory).toHaveLength(1);
    expect(state.executionGateHistory?.[0].total).toBe(1);
    expect(state.executionGateHistory?.[0].referenceCount).toBeUndefined();
    // The run itself now leaves a baseline at SUCCESS (AC-65, write side).
    expect(existsSync(baselineFilePath(project.dir))).toBe(true);
  });

  it('a corrupt baseline file fails closed: the run escalates before Gate 2 runs', async () => {
    mkdirSync(join(project.dir, '.factory'), { recursive: true });
    writeFileSync(baselineFilePath(project.dir), '{ "schemaVersion": 1, "testCount": ');
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations).toHaveLength(1);
    expect(state.escalations[0].stage).toBe(4);
    expect(state.escalations[0].context.message).toMatch(/baseline\.json/);
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
    expect(invoker.agents()).not.toContain('07-validator');
    expect(state.executionGateHistory).toEqual([]);
  });
});
