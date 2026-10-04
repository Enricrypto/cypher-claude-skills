/**
 * The bounded Validator CRITICAL loop-back (D-9; AC-22 VL row, AC-29..33, AC-69, AC-70).
 *
 * A CRITICAL issue the Validator can pin to a file goes back to the builder that owns that file,
 * for at most MAX_VALIDATOR_ROUNDS rounds of at most MAX_BUILDER_ATTEMPTS attempts each. Every
 * round re-runs Gate 1 (materialization), the Stage 3 gate, Gate 1.5 and Gate 2 before the
 * Validator is asked again. Anything that cannot be routed escalates at once, at Stage 4.
 *
 * The orchestrator tests drive runFeatureFactory with the scripted invoker and injected gates:
 * no network, no child process.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';
import { executionAudit, recordingGates } from '../fixtures/gates';
import { backend, frontend, spec, validator } from '../fixtures/agent-outputs';
import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { FeatureState } from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { baselineFilePath, RegressionBaseline } from '../../harness/regression-baseline';
import {
  LOOP_BACK_RULES,
  MAX_BUILDER_ATTEMPTS,
  MAX_VALIDATOR_ROUNDS
} from '../../harness/loop-rules';
import * as orchestrator from '../../feature/workflows/feature-factory-orchestrator';
import { isFrontendPath, specRequiresFrontend } from '../../harness/frontend-files';
import { criticalIssues, mergeBuilderOutput, routeCriticalIssues } from '../../harness/validator-routing';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-loop-');
});

afterEach(() => {
  project.cleanup();
});

const issue = (overrides: Partial<ValidatorIssue> = {}): ValidatorIssue => ({
  severity: 'CRITICAL',
  file: 'src/a.ts',
  line: 1,
  message: 'Route has no auth check',
  suggestion: 'Add the guard',
  canFix: true,
  ...overrides
});

/** A Validator that reports `issues` as CRITICAL on its first `failing` calls, then passes. */
const validatorFailingFirst = (failing: number, issues: ValidatorIssue[]) =>
  (_call: AgentInvocation, n: number) =>
    n <= failing ? validator({ status: 'FAIL', issues }) : validator();

/** Wrap an invoker so a test sees agents and gate calls on one timeline. */
function timeline(invoke: AgentInvoker, events: string[]): AgentInvoker {
  return async call => {
    events.push(call.agent);
    return invoke(call);
  };
}

function eventGates(events: string[], script: Parameters<typeof recordingGates>[0] = {}) {
  const recorded = recordingGates(script);
  return {
    recorded,
    gates: {
      auditInfrastructure: async (root: string) => {
        events.push('gate-1.5');
        return recorded.gates.auditInfrastructure(root);
      },
      auditExecution: async (root: string) => {
        events.push('gate-2');
        return recorded.gates.auditExecution(root);
      }
    }
  };
}

const escalations = (state: FeatureState) => state.escalations.map(e => [e.stage, e.agent, e.reason]);
const count = (agents: string[], agent: string) => agents.filter(a => a === agent).length;

// ============================================================================================
// Unit: loop rules, frontend files, routing, merge
// ============================================================================================

describe('loop rules (D-9)', () => {
  it('bounds are 3 builder attempts and 2 validator rounds', () => {
    expect(MAX_BUILDER_ATTEMPTS).toBe(3);
    expect(MAX_VALIDATOR_ROUNDS).toBe(2);
  });

  it('LOOP_BACK_RULES are exactly the D-9 table', () => {
    expect(LOOP_BACK_RULES).toEqual([
      { situation: 'BUILDER_TESTS_FAIL', action: 'RETRY_SAME_BUILDER', bound: 3 },
      { situation: 'BUILDER_SCHEMA_INVALID', action: 'RETRY_SAME_BUILDER', bound: 3 },
      { situation: 'GATE_2_FAILS', action: 'ESCALATE' },
      { situation: 'TEST_VERIFIER_FAILS', action: 'ESCALATE' },
      { situation: 'VALIDATOR_CRITICAL_ROUTABLE', action: 'RETRY_OWNING_BUILDER', bound: 2 },
      { situation: 'VALIDATOR_CRITICAL_UNROUTABLE', action: 'ESCALATE' },
      { situation: 'VALIDATOR_ESCALATES', action: 'ESCALATE' }
    ]);
  });

  it('the orchestrator re-exports the same rules and bounds', () => {
    expect(orchestrator.LOOP_BACK_RULES).toBe(LOOP_BACK_RULES);
    expect(orchestrator.MAX_BUILDER_ATTEMPTS).toBe(MAX_BUILDER_ATTEMPTS);
    expect(orchestrator.MAX_VALIDATOR_ROUNDS).toBe(MAX_VALIDATOR_ROUNDS);
  });
});

describe('frontend files', () => {
  it.each([
    ['src/components/Form.tsx', true],
    ['src/Widget.jsx', true],
    ['src/App.vue', true],
    ['src/App.svelte', true],
    ['pages/index.ts', true],
    ['src/app/layout.ts', true],
    ['src/views/home.ts', true],
    ['src/screens/login.ts', true],
    ['src/services/totp.ts', false],
    ['src/application/x.ts', false],
    ['src/a.ts', false]
  ])('isFrontendPath(%s) is %s', (path, expected) => {
    expect(isFrontendPath(path)).toBe(expected);
  });

  it('specRequiresFrontend: UI components or a frontend file in the file list, nothing otherwise', () => {
    expect(specRequiresFrontend(spec())).toBe(false);
    expect(specRequiresFrontend(spec({ ui: true }))).toBe(true);
    expect(specRequiresFrontend(spec({ files: ['src/a.ts', 'src/components/X.tsx'] }))).toBe(true);
    expect(specRequiresFrontend(undefined)).toBe(false);
  });
});

describe('validator routing (unit)', () => {
  const cwd = '/project';
  const owners = { backend: ['src/a.ts', './src/shared/Widget.tsx', 'src/shared/types.ts'], frontend: ['src/components/Form.tsx', 'src/shared/Widget.tsx', 'src/shared/types.ts'] };

  it('criticalIssues keeps only CRITICAL issues and tolerates a missing list', () => {
    const minor = issue({ severity: 'MINOR' });
    const important = issue({ severity: 'IMPORTANT' });
    const critical = issue();
    expect(criticalIssues([minor, critical, important])).toEqual([critical]);
    expect(criticalIssues(undefined)).toEqual([]);
  });

  it('routes to the only owner, normalising absolute and ./ paths', () => {
    const routing = routeCriticalIssues(
      [issue({ file: '/project/src/a.ts' }), issue({ file: './src/components/Form.tsx' })],
      owners,
      cwd
    );
    expect(routing.backend.map(i => i.file)).toEqual(['/project/src/a.ts']);
    expect(routing.frontend.map(i => i.file)).toEqual(['./src/components/Form.tsx']);
    expect(routing.unroutable).toEqual([]);
  });

  it('names why an issue cannot be routed: NO_FILE, CANNOT_FIX, NOT_OWNED', () => {
    const noFile = issue({ file: undefined });
    const cannotFix = issue({ canFix: false });
    const notOwned = issue({ file: 'src/elsewhere.ts' });
    const routing = routeCriticalIssues([noFile, cannotFix, notOwned], owners, cwd);
    expect(routing.unroutable).toEqual([
      { issue: noFile, reason: 'NO_FILE' },
      { issue: cannotFix, reason: 'CANNOT_FIX' },
      { issue: notOwned, reason: 'NOT_OWNED' }
    ]);
    expect(routing.backend).toEqual([]);
    expect(routing.frontend).toEqual([]);
  });

  it('AC-69 a file owned by both builders routes to frontend when the heuristic matches, else backend', () => {
    const routing = routeCriticalIssues(
      [issue({ file: 'src/shared/Widget.tsx' }), issue({ file: 'src/shared/types.ts' })],
      owners,
      cwd
    );
    expect(routing.frontend.map(i => i.file)).toEqual(['src/shared/Widget.tsx']);
    expect(routing.backend.map(i => i.file)).toEqual(['src/shared/types.ts']);
  });

  it('mergeBuilderOutput: next wins, filesModified is the union by normalised path with next\'s entry winning', () => {
    const previous = backend({ files: ['src/a.ts', 'src/b.ts'] });
    const next = backend({ files: ['./src/b.ts', 'src/c.ts'] });
    next.details.summary = 'Fixed the guard.';
    next.details.filesModified[0].description = 'round 1 rewrite';

    const merged = mergeBuilderOutput(previous, next);

    expect(merged.details.summary).toBe('Fixed the guard.');
    expect(merged.details.filesModified.map(f => [f.path, f.description])).toEqual([
      ['src/a.ts', 'Backend Builder wrote src/a.ts'],
      ['./src/b.ts', 'round 1 rewrite'],
      ['src/c.ts', 'Backend Builder wrote src/c.ts']
    ]);
    // Inputs are not mutated.
    expect(previous.details.filesModified.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('mergeBuilderOutput test totals (IMPORTANT-4)', () => {
  const noNewTests = { testsWritten: 0, testsPassed: 0, testsFailed: 0, failingTests: [] };

  it('a round that reports no tests written keeps the previous testing totals', () => {
    const previous = backend();
    const next = backend();
    next.details.testing = { ...noNewTests };

    const merged = mergeBuilderOutput(previous, next);

    expect(merged.details.testing).toEqual(previous.details.testing);
  });

  it('a round that reports a failing test keeps ITS totals, even with testsWritten 0', () => {
    const previous = backend();
    const next = backend();
    next.details.testing = { testsWritten: 0, testsPassed: 0, testsFailed: 1, failingTests: [] };

    expect(mergeBuilderOutput(previous, next).details.testing).toEqual(next.details.testing);
  });

  it('a round that reports tests written replaces the totals (its failures win)', () => {
    const previous = backend();
    const next = backend({ testsFailed: 1, failingError: 'boom' });

    expect(mergeBuilderOutput(previous, next).details.testing).toEqual(next.details.testing);
  });
});

// ============================================================================================
// Orchestrator: the round loop
// ============================================================================================

describe('validator loop-back (orchestrator)', () => {
  it('AC-29 a fixable CRITICAL in a backend-owned file re-invokes the Backend Builder with a validator briefing, reruns Gates 1, 1.5, 2, then the Validator', async () => {
    const events: string[] = [];
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validatorFailingFirst(1, [issue()]) },
      { cwd: project.dir }
    );
    const { gates } = eventGates(events);

    const state = await runToEnd({ cwd: project.dir, invoke: timeline(invoker.invoke, events), gates });

    expect(state.completionStatus).toBe('SUCCESS');
    const firstValidator = events.indexOf('07-validator');
    expect(events.slice(firstValidator)).toEqual([
      '07-validator',
      '04-backend-builder',
      'gate-1.5',
      'gate-2',
      '07-validator'
    ]);

    const prompts = invoker.promptsFor('04-backend-builder');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(`Validator round 1 of ${MAX_VALIDATOR_ROUNDS}`);
    expect(prompts[1]).toContain('[src/a.ts:1] Route has no auth check — Add the guard');
    expect(prompts[0]).not.toMatch(/Validator round/);

    expect(state.executionGateHistory?.map(r => r.round)).toEqual([0, 1]);
    expect(state.validatorRoundsCompleted).toBe(1);
    expect(state.stageHistory.filter(s => s.agent === '07-validator').map(s => s.status)).toEqual(['FAIL', 'PASS']);
    const builderSteps = state.stageHistory.filter(s => s.agent === '04-backend-builder');
    expect(builderSteps.map(s => [s.stage, s.status, s.phase, s.round])).toEqual([
      [3, 'PASS', 'stage3', undefined],
      [3, 'PASS', 'validator-round', 1]
    ]);
    expect(invoker.agents()).not.toContain('05-frontend-builder');
  });

  it('IMPORTANT-4 a round whose builder honestly reports 0 tests written passes the Stage 3 gate and proceeds to Gate 2 and the Validator', async () => {
    const events: string[] = [];
    const noNewTests = backend();
    noNewTests.details.testing = { testsWritten: 0, testsPassed: 0, testsFailed: 0, failingTests: [] };
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) => (n === 1 ? backend() : noNewTests),
        '07-validator': validatorFailingFirst(1, [issue()])
      },
      { cwd: project.dir }
    );
    const { gates } = eventGates(events);

    const state = await runToEnd({ cwd: project.dir, invoke: timeline(invoker.invoke, events), gates });

    expect(escalations(state)).toEqual([]);
    expect(state.completionStatus).toBe('SUCCESS');
    const firstValidator = events.indexOf('07-validator');
    expect(events.slice(firstValidator)).toEqual([
      '07-validator',
      '04-backend-builder',
      'gate-1.5',
      'gate-2',
      '07-validator'
    ]);
  });

  it('AC-29 a round whose builder claims a file it never wrote fails Gate 1 and escalates at Stage 4', async () => {
    const base = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) =>
          n === 1 ? backend() : backend({ files: ['src/a.ts', 'src/ghost.ts'] }),
        '07-validator': validatorFailingFirst(1, [issue()])
      },
      { cwd: project.dir }
    );
    // The fake writes every claimed file; take the ghost back off the disk.
    let backendCalls = 0;
    const invoke: AgentInvoker = async call => {
      const output = await base.invoke(call);
      if (call.agent === '04-backend-builder' && ++backendCalls === 2) {
        rmSync(join(project.dir, 'src/ghost.ts'));
      }
      return output;
    };
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke, gates: recorded.gates });

    expect(escalations(state)).toEqual([[4, 'harness', 'HALLUCINATION_DETECTED']]);
    expect(state.escalations[0].context.missingFiles).toEqual(['src/ghost.ts']);
    expect(state.currentStage).toBe(4);
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditExecution']);
    expect(count(base.agents(), '07-validator')).toBe(1);
  });

  it('I-8 each round re-runs the Stage 3 gate on the merged builder outputs', async () => {
    const lowPassRate = backend();
    lowPassRate.details.testing = { testsWritten: 4, testsPassed: 3, testsFailed: 0, failingTests: [] };
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) => (n === 1 ? backend() : lowPassRate),
        '07-validator': validatorFailingFirst(1, [issue()])
      },
      { cwd: project.dir }
    );
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(escalations(state)).toEqual([[4, 'harness', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.message).toMatch(/Stage 3 gate failed/);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/Unit Tests Pass/);
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditExecution']);
  });

  it('AC-30 a fixable CRITICAL in a frontend-owned file re-invokes the Frontend Builder', async () => {
    const formFile = 'src/components/TwoFactorForm.tsx';
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '03-spec-writer': spec({ files: ['src/a.ts', formFile], ui: true }),
        '05-frontend-builder': frontend({ files: [formFile] }),
        '07-validator': validatorFailingFirst(1, [issue({ file: formFile, line: 12, message: 'Unescaped HTML', suggestion: 'Escape it' })])
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(count(invoker.agents(), '04-backend-builder')).toBe(1);
    const prompts = invoker.promptsFor('05-frontend-builder');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(`[${formFile}:12] Unescaped HTML — Escape it`);
    expect(
      state.stageHistory.filter(s => s.agent === '05-frontend-builder').map(s => [s.stage, s.phase, s.round])
    ).toEqual([
      [3, 'stage3', undefined],
      [3, 'validator-round', 1]
    ]);
  });

  it('AC-69 a shared .tsx file re-invokes the Frontend Builder', async () => {
    const shared = 'src/shared/Widget.tsx';
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '03-spec-writer': spec({ files: ['src/a.ts', shared], ui: true }),
        '04-backend-builder': backend({ files: ['src/a.ts', shared] }),
        '05-frontend-builder': frontend({ files: [shared] }),
        '07-validator': validatorFailingFirst(1, [issue({ file: shared })])
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(count(invoker.agents(), '04-backend-builder')).toBe(1);
    expect(count(invoker.agents(), '05-frontend-builder')).toBe(2);
  });

  it.each<[string, ValidatorIssue, string]>([
    ['no file', issue({ file: undefined }), 'NO_FILE'],
    ['canFix false', issue({ canFix: false }), 'CANNOT_FIX'],
    ['unowned file', issue({ file: 'src/not-built-here.ts' }), 'NOT_OWNED']
  ])('AC-31 a CRITICAL issue with %s escalates immediately and no builder is re-invoked', async (_label, unroutable, reason) => {
    const routable = issue({ message: 'Routable but never routed' });
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ status: 'FAIL', issues: [routable, unroutable] }) },
      { cwd: project.dir }
    );
    const recorded = recordingGates();

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(escalations(state)).toEqual([[4, '07-validator', 'CRITICAL_ISSUE']]);
    const listed = state.escalations[0].context.issues ?? [];
    // Every CRITICAL issue is listed, and the unroutable one says why.
    expect(listed).toHaveLength(2);
    expect(listed.some(i => i.includes('Routable but never routed'))).toBe(true);
    expect(listed.some(i => i.includes(unroutable.message) && i.includes(reason))).toBe(true);
    expect(count(invoker.agents(), '04-backend-builder')).toBe(1);
    expect(state.validatorRoundsCompleted).toBe(0);
    expect(recorded.calls.map(c => c.gate)).toEqual(['auditInfrastructure', 'auditExecution']);
  });

  it('AC-32 CRITICAL issues remaining after 2 rounds escalate; the Validator runs at most 3 times', async () => {
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validator({ status: 'FAIL', issues: [issue()] }) },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(escalations(state)).toEqual([[4, '07-validator', 'MAX_LOOPS']]);
    expect(state.escalations[0].context.message).toMatch(/after 2 rounds/);
    expect(state.escalations[0].context.issues).toEqual(['[src/a.ts:1] Route has no auth check — Add the guard']);
    expect(count(invoker.agents(), '07-validator')).toBe(MAX_VALIDATOR_ROUNDS + 1);
    expect(count(invoker.agents(), '04-backend-builder')).toBe(1 + MAX_VALIDATOR_ROUNDS);
    expect(state.validatorRoundsCompleted).toBe(2);
    expect(state.executionGateHistory?.map(r => r.round)).toEqual([0, 1, 2]);
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
  });

  it.each<[string, () => unknown]>([
    ['unroutable issue', () => validator({ status: 'FAIL', issues: [issue({ file: undefined })] })],
    ['rounds exhausted', () => validator({ status: 'FAIL', issues: [issue()] })]
  ])('AC-33 an escalation during Stage 4 leaves currentStage 4 (%s)', async (_label, output) => {
    const invoker = scriptedInvoker({ ...passingScript(), '07-validator': output }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.currentStage).toBe(4);
    expect(state.escalations.map(e => e.stage)).toEqual([4]);
  });

  it('AC-70 a builder that used 3 Stage 3 attempts is re-invoked by a validator round without its Stage 3 count changing', async () => {
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) =>
          n < 3 ? backend({ testsFailed: 1, failingError: 'expected 200, received 401' }) : backend(),
        '07-validator': validatorFailingFirst(1, [issue()])
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(count(invoker.agents(), '04-backend-builder')).toBe(4);
    expect(state.builderAttempts?.['04-backend-builder']).toEqual({ stage3: 3, validatorRounds: { 1: 1 } });
    // The round's first attempt is attempt 1 of the round: no Stage 3 retry header.
    expect(invoker.promptsFor('04-backend-builder')[3]).not.toMatch(/attempt \d of 3/);
  });

  it('AC-70 three failed attempts within one round escalate MAX_LOOPS', async () => {
    const error = 'expected 200, received 401';
    const invoker = scriptedInvoker(
      {
        ...passingScript(),
        '04-backend-builder': (_call: AgentInvocation, n: number) =>
          n === 1 ? backend() : backend({ testsFailed: 1, failingError: error }),
        '07-validator': validatorFailingFirst(1, [issue()])
      },
      { cwd: project.dir }
    );

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(escalations(state)).toEqual([[4, '04-backend-builder', 'MAX_LOOPS']]);
    expect(state.currentStage).toBe(4);
    expect(state.builderAttempts?.['04-backend-builder']).toEqual({ stage3: 1, validatorRounds: { 1: MAX_BUILDER_ATTEMPTS } });
    expect(count(invoker.agents(), '07-validator')).toBe(1);

    // Attempts 2-3 of the round carry both the validator briefing and the test diagnosis.
    const roundPrompts = invoker.promptsFor('04-backend-builder').slice(1);
    expect(roundPrompts).toHaveLength(3);
    for (const prompt of roundPrompts) expect(prompt).toContain('Validator round 1 of 2');
    expect(roundPrompts[0]).not.toContain(error);
    expect(roundPrompts[1]).toContain(error);
    expect(roundPrompts[2]).toContain(error);

    const roundLoopBacks = state.loopBacks.filter(l => l.phase === 'validator-round');
    expect(roundLoopBacks.map(l => [l.stage, l.round])).toEqual([[3, 1], [3, 1], [3, 1]]);
  });

  // ------------------------------------------------------------------------------------------
  // AC-22 (VL row): later rounds are judged against the run's own first Gate 2 record
  // ------------------------------------------------------------------------------------------

  const writeBaseline = (content: string) => {
    mkdirSync(join(project.dir, '.factory'), { recursive: true });
    writeFileSync(baselineFilePath(project.dir), content);
  };
  const baseline = (testCount: number): string =>
    JSON.stringify({ schemaVersion: 1, runId: 'prior', testCount, recordedAt: '2026-10-01T00:00:00.000Z' } satisfies RegressionBaseline);

  it('AC-22 in a validator round the reference is the run\'s first Gate 2 count', async () => {
    writeBaseline(baseline(8));
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validatorFailingFirst(1, [issue()]) },
      { cwd: project.dir }
    );
    const recorded = recordingGates({
      auditExecution: n => executionAudit({ total: n === 1 ? 10 : 9 })
    });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.executionGateHistory?.map(r => [r.round, r.total, r.referenceCount])).toEqual([
      [0, 10, 8],
      [1, 9, 10]
    ]);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(escalations(state)).toEqual([[4, 'harness', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/No Regressions: .*9.*10/);
  });

  it('AC-22 a validator round never re-reads the baseline file', async () => {
    writeBaseline(baseline(8));
    const base = scriptedInvoker(
      { ...passingScript(), '07-validator': validatorFailingFirst(1, [issue()]) },
      { cwd: project.dir }
    );
    // Corrupt the baseline once round 0 has been judged. A re-read would throw and escalate.
    const invoke: AgentInvoker = async call => {
      if (call.agent === '07-validator') writeFileSync(baselineFilePath(project.dir), '{ not json');
      return base.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(state.executionGateHistory?.map(r => r.referenceCount)).toEqual([8, 10]);
  });

  // ------------------------------------------------------------------------------------------
  // D-A (operator decision): the bar can never drop — not in a validator round either
  // ------------------------------------------------------------------------------------------

  it('D-A a validator round is judged against the round-0 reference when it is higher than the first passing count', async () => {
    writeBaseline(baseline(10));
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validatorFailingFirst(1, [issue()]) },
      { cwd: project.dir }
    );
    const recorded = recordingGates({
      auditExecution: n => executionAudit({ total: n === 1 ? 9 : 10 })
    });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    // Round 0 ran 9 against the baseline's 10; round 1 is judged against 10, not against 9.
    expect(state.executionGateHistory?.map(r => [r.round, r.total, r.referenceCount])).toEqual([
      [0, 9, 10],
      [1, 10, 10]
    ]);
    expect(state.completionStatus).toBe('SUCCESS');
  });

  it('D-A a validator round that runs 8 tests against a round-0 reference of 10 fails the Stage 4 gate', async () => {
    writeBaseline(baseline(10));
    const invoker = scriptedInvoker(
      { ...passingScript(), '07-validator': validatorFailingFirst(1, [issue()]) },
      { cwd: project.dir }
    );
    const recorded = recordingGates({ auditExecution: executionAudit({ total: 8 }) });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, gates: recorded.gates });

    expect(state.executionGateHistory?.map(r => [r.round, r.total, r.referenceCount])).toEqual([
      [0, 8, 10],
      [1, 8, 10]
    ]);
    expect(state.completionStatus).toBe('ESCALATED');
    expect(escalations(state)).toEqual([[4, 'harness', 'CRITICAL_ISSUE']]);
    expect(state.escalations[0].context.blockers?.join('\n')).toMatch(/No Regressions: .*8.*10/);
  });
});

describe('MINOR-5 merging claims made with absolute and relative paths', () => {
  it('MINOR-5 mergeBuilderOutput unions an absolute and a relative path to the same file into one entry', () => {
    const cwd = '/project';
    const previous = backend({ files: ['/project/src/a.ts', 'src/b.ts'] });
    const next = backend({ files: ['src/a.ts'] });
    next.details.filesModified[0].description = 'round 1 rewrite';

    const merged = mergeBuilderOutput(previous, next, cwd);

    expect(merged.details.filesModified.map(f => [f.path, f.description])).toEqual([
      ['src/a.ts', 'round 1 rewrite'],
      ['src/b.ts', 'Backend Builder wrote src/b.ts']
    ]);
  });

  it('MINOR-5 a path outside the project is never folded into a project-relative one', () => {
    const merged = mergeBuilderOutput(backend({ files: ['/elsewhere/src/a.ts'] }), backend({ files: ['src/a.ts'] }), '/project');
    expect(merged.details.filesModified.map(f => f.path)).toEqual(['/elsewhere/src/a.ts', 'src/a.ts']);
  });
});

describe('MINOR-9 Validator IMPORTANT findings', () => {
  const important = (message: string): ValidatorIssue => issue({ severity: 'IMPORTANT', message, file: 'src/a.ts', line: 2 });

  it('MINOR-9 Validator IMPORTANT issues from every round are recorded as findings, each once', async () => {
    const script = {
      ...passingScript(),
      '07-validator': (_call: AgentInvocation, n: number) =>
        n === 1
          ? validator({ status: 'FAIL', issues: [issue(), important('Add rate limiting'), important('Log failed attempts')] })
          : validator({ issues: [important('Log failed attempts'), important('Cache the lookup')] })
    };
    const invoker = scriptedInvoker(script, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    expect((state.importantFindings ?? []).filter(f => f.source === '07-validator').map(f => [f.stage, f.message])).toEqual([
      // Round 0 failed, and its IMPORTANT issues are kept; the one round 1 repeats is not recorded twice.
      [4, '[src/a.ts:2] Add rate limiting'],
      [4, '[src/a.ts:2] Log failed attempts'],
      [4, '[src/a.ts:2] Cache the lookup']
    ]);
  });
});
