/**
 * Test Verifier (Agent 06) acceptance tests for PR A-2: the gaps the builders' own tests left.
 *
 * Each test here was written because a mutation of the implementation survived the existing
 * suite, or because a Given/When/Then had no orchestrator-level test at all:
 *
 *  - AC-78: the existing test makes the spec gate fail by removing TECHNICAL_BRIEF.md, which also
 *    makes CP2 unpresentable — so "the approver is never called for CP2" held even with CP2 moved
 *    BEFORE the spec gate. The order itself is pinned here.
 *  - AC-39: the existing test reads "Stage 4 passed" from the log, which is printed after the gate;
 *    a resume that skipped the Stage 4 gate still printed it. Here the resumed gate must FAIL on
 *    evidence it only sees on resume, and Gate 1.5 must fail on a resume after it passed before.
 *  - I-6: the Stage 1 gate → 01 invalidation had no orchestrator test.
 *  - AC-75: removing the Stage 3 gate from the CP3 rework survived every test.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { AgentInvocation } from '../../runner/invoke-agent';
import { CheckpointRequest } from '../../feature/workflows/feature-factory-orchestrator';
import { loadState } from '../../harness/state-store';
import { FeatureState } from '../../harness/state-tracker';
import { baselineFilePath } from '../../harness/regression-baseline';
import { backend, validator } from '../fixtures/agent-outputs';
import { infraAudit, recordingGates } from '../fixtures/gates';
import {
  decisions,
  passingScript,
  removeOnPersist,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-a2-acceptance-');
});

afterEach(() => {
  project.cleanup();
});

/** Full orchestrator runs commit state.json at every transition; give them room under a parallel `npm test`. */
const RUN_TIMEOUT_MS = 30_000;

/** The state.json of the only run in the project. */
function onDisk(): FeatureState {
  const factoryDir = join(project.dir, '.factory');
  const runs = readdirSync(factoryDir).filter(name => existsSync(join(factoryDir, name, 'state.json')));
  expect(runs).toHaveLength(1);
  return loadState(project.dir, runs[0])!;
}

describe('AC-78 the spec part of the split Stage 2 gate runs after the Spec Writer and before CP2', () => {
  it('AC-78 the spec gate is evaluated after the Spec Writer and before CP2 is presented', async () => {
    const events: string[] = [];
    const invoker = scriptedInvoker(passingScript(), { cwd: project.dir });
    const approver = decisions(
      ...[1, 2, 3].map(() => (request: CheckpointRequest) => (events.push(`CP${request.id}`), true))
    );

    const state = await runToEnd({
      cwd: project.dir,
      invoke: async (call: AgentInvocation) => (events.push(call.agent), invoker.invoke(call)),
      approveCheckpoint: approver.approve,
      logger: message => {
        if (/Story gate passed/.test(message)) events.push('story-gate');
        if (/Spec gate passed/.test(message)) events.push('spec-gate');
      }
    });

    expect(state.completionStatus).toBe('SUCCESS');
    // 02 → story gate → CP1 → 03 → spec gate → CP2 → 04 (C-9, AC-56, AC-78).
    expect(events.slice(0, 8)).toEqual([
      '01-researcher',
      '02-story-writer',
      'story-gate',
      'CP1',
      '03-spec-writer',
      'spec-gate',
      'CP2',
      '04-backend-builder'
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-39 on resume a gate is judged again, never taken from an earlier result', () => {
  it('AC-39 Gate 1.5 passed before the run escalated, and on resume it is evaluated again and blocks the Validator', async () => {
    // First run: Gate 1.5 passes, the Validator escalates.
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), '07-validator': validator({ status: 'ESCALATE' }) }, { cwd: project.dir }).invoke
    });
    expect(first.completionStatus).toBe('ESCALATED');
    expect(first.escalations.at(-1)!.agent).toBe('07-validator');

    // Resume: the infrastructure is now broken. The earlier pass must not stand in for this one.
    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const gates = recordingGates({ auditInfrastructure: infraAudit({ critical: ['npm script: test is missing'] }) });
    const approver = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk(),
      gates: gates.gates,
      approveCheckpoint: approver.approve
    });

    expect(gates.calls.map(c => c.gate)).toEqual(['auditInfrastructure']);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)).toMatchObject({ stage: 4, agent: 'harness', reason: 'INFRASTRUCTURE_FAILURE' });
    expect(resumed.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('AC-39 the Stage 4 gate is evaluated again on resume: a resumed Validator reporting a failed security check ends the run before CP3', async () => {
    // First run: the Validator escalates, so the Stage 4 gate never got to judge this run.
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker({ ...passingScript(), '07-validator': validator({ status: 'ESCALATE' }) }, { cwd: project.dir }).invoke
    });
    expect(first.completionStatus).toBe('ESCALATED');

    // Resume: the Validator passes but reports auth missing. Only a Stage 4 gate that really runs sees it.
    const resumed = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ security: { authImplemented: false } }) },
      { cwd: project.dir }
    );
    const approver = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk(),
      approveCheckpoint: approver.approve
    });

    expect(resumed.agents()).toEqual(['07-validator']);
    expect(state.completionStatus).toBe('ESCALATED');
    const last = state.escalations.at(-1)!;
    expect([last.stage, last.agent, last.reason]).toEqual([4, 'harness', 'CRITICAL_ISSUE']);
    expect(last.context.message).toMatch(/^Stage 4 gate failed/);
    expect(last.context.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/^\[CRITICAL\] Security Audit Passed:/)]));
    expect(approver.requests).toEqual([]);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  }, RUN_TIMEOUT_MS);
});

describe('I-6 a Stage 1 gate failure invalidates the Researcher', () => {
  it('I-6 a Stage 1 gate failure invalidates the Researcher step, so a resume re-runs it instead of failing on the same report', async () => {
    // The report is gone when the Stage 1 gate reads it: "Researcher Report Complete" (CRITICAL)
    // fails. (A researcher naming fewer than 3 files never reaches the gate: the schema refuses it.)
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      logger: removeOnPersist(project.dir, '01-researcher', 'RESEARCHER_REPORT.md')
    });

    expect(first.completionStatus).toBe('ESCALATED');
    const failure = first.escalations.at(-1)!;
    expect([failure.stage, failure.agent, failure.reason]).toEqual([1, 'harness', 'CRITICAL_ISSUE']);
    expect(failure.context.message).toMatch(/^Stage 1 gate failed/);
    expect(failure.context.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/^\[CRITICAL\] Researcher Report Complete:/)]));
    const judged = onDisk().stageHistory.filter(step => step.agent === '01-researcher');
    expect(judged.map(step => step.status)).toEqual(['PASS']);
    expect(judged[0].invalidated?.reason).toMatch(/^Stage 1 gate failed/);

    const resumed = scriptedInvoker(passingScript(), { cwd: project.dir });
    const state = await runToEnd({ cwd: project.dir, invoke: resumed.invoke, resumeFromState: onDisk() });

    expect(resumed.agents()[0]).toBe('01-researcher');
    expect(state.completionStatus).toBe('SUCCESS');
    // The invalidated step is kept, flagged, for the record (I-6): never deleted.
    expect(state.stageHistory.filter(step => step.agent === '01-researcher').map(step => step.invalidated !== undefined)).toEqual([
      true,
      false
    ]);
  }, RUN_TIMEOUT_MS);
});

describe('AC-75 the CP3 rework is judged by the Stage 3 gate', () => {
  it('AC-75 a rework builder whose own tests do not all pass fails the Stage 3 gate, before the Test Verifier and before CP3', async () => {
    const first = await runToEnd({
      cwd: project.dir,
      invoke: scriptedInvoker(passingScript(), { cwd: project.dir }).invoke,
      approveCheckpoint: decisions(true, true, { decision: 'REJECT', notes: 'Use the existing rate limiter.' }).approve
    });
    expect(first.checkpointRejections!.map(r => [r.checkpointId, r.reworkAgents])).toEqual([[3, ['04-backend-builder']]]);

    // The rework builder reports no failing test, but fewer passing than written: "Unit Tests Pass"
    // (CRITICAL) in the Stage 3 gate must catch it over the merged outputs.
    const partial = backend();
    partial.details.testing.testsPassed = partial.details.testing.testsWritten - 1;
    const resumed = scriptedInvoker({ ...passingScript(), '04-backend-builder': partial }, { cwd: project.dir });
    const gates = recordingGates();
    const approver = decisions();
    const state = await runToEnd({
      cwd: project.dir,
      invoke: resumed.invoke,
      resumeFromState: onDisk(),
      gates: gates.gates,
      approveCheckpoint: approver.approve
    });

    expect(resumed.agents()).toEqual(['04-backend-builder']);
    expect(state.completionStatus).toBe('ESCALATED');
    const last = state.escalations.at(-1)!;
    // A rework happens while the run is in Stage 4 (AC-33).
    expect([last.stage, last.agent, last.reason]).toEqual([4, 'harness', 'CRITICAL_ISSUE']);
    expect(last.context.message).toMatch(/^Stage 3 gate failed/);
    expect(last.context.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/^\[CRITICAL\] Unit Tests Pass:/)]));
    expect(gates.calls).toEqual([]);
    expect(approver.requests).toEqual([]);
  }, RUN_TIMEOUT_MS);
});
