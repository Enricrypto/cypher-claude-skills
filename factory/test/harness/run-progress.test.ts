/**
 * Run progress (A-2, D-2, D-5) [U]: pure decisions over a run's record.
 *
 * Step 5: which builders a CHECKPOINT 3 rejection sends back (`reworkAgentsForChange`, I-10).
 * Step 6: the rebuild of outputs from the record, the skip rule (hasPass, isCheckpointApproved,
 * isStageComplete), the pending validator round and the failure a resumed attempt is briefed with.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';

import {
  activeRework,
  checkpointApproval,
  lastInvalidation,
  reworkToStart,
  hasPass,
  isCheckpointApproved,
  isPreSuppliedRun,
  isStageComplete,
  lastBuilderFailure,
  pendingValidatorRound,
  rebuildOutputs,
  reworkAgentsForChange
} from '../../harness/run-progress';
import {
  createFeatureState,
  FeatureState,
  invalidateAgentSteps,
  recordAgentStep,
  recordCheckpointApproval,
  recordCheckpointRejection,
  recordExecutionGate,
  recordLoopBack,
  recordReworkStart,
  recordValidatorRound
} from '../../harness/state-tracker';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { backend, frontend, researcher, spec, story, testVerifier, validator } from '../fixtures/agent-outputs';

const CWD = '/projects/app';

describe('reworkAgentsForChange (D-5, I-10)', () => {
  const builders = {
    backend: backend({ files: ['src/api/users.ts', 'src/services/users.ts'] }),
    frontend: frontend({ files: ['src/components/Profile.tsx'] })
  };

  it.each<[string, string[], string[]]>([
    ['a backend file', ['src/api/users.ts'], ['04-backend-builder']],
    ['a frontend file', ['src/components/Profile.tsx'], ['05-frontend-builder']],
    ['files of both, backend first', ['src/components/Profile.tsx', 'src/services/users.ts'], ['04-backend-builder', '05-frontend-builder']]
  ])('AC-75 a change containing %s re-runs the builder that claimed it', (_label, changedFiles, expected) => {
    expect(reworkAgentsForChange(builders, changedFiles, CWD)).toEqual(expected);
  });

  it('AC-75 claimed and changed paths are compared after normalising with cwd (absolute, ./, ..)', () => {
    const absolute = { backend: backend({ files: [join(CWD, 'src/api/users.ts')] }) };

    expect(reworkAgentsForChange(absolute, ['./src/lib/../api/users.ts'], CWD)).toEqual(['04-backend-builder']);
  });

  it('I-10 with no builder file in the change, every builder that ran is re-run', () => {
    expect(reworkAgentsForChange(builders, ['README.md'], CWD)).toEqual(['04-backend-builder', '05-frontend-builder']);
    expect(reworkAgentsForChange(builders, [], CWD)).toEqual(['04-backend-builder', '05-frontend-builder']);
  });

  it('I-10 a builder that did not run is never named', () => {
    const backendOnly = { backend: backend({ files: ['src/api/users.ts'] }) };

    expect(reworkAgentsForChange(backendOnly, ['src/components/Profile.tsx'], CWD)).toEqual(['04-backend-builder']);
  });

  it('D-5 no builder ran: nothing to re-run', () => {
    expect(reworkAgentsForChange({}, ['src/a.ts'], CWD)).toEqual([]);
  });
});

// ============================================================================================
// Step 6: rebuilding outputs, the skip rule and the pending validator round (D-2)
// ============================================================================================

const HASH = 'b'.repeat(64);

const critical = (file: string): ValidatorIssue => ({
  severity: 'CRITICAL',
  file,
  line: 1,
  message: `Problem in ${file}`,
  suggestion: 'Fix it',
  canFix: true
});

/** A run that has passed 01-03 and both planning checkpoints, and built its backend in Stage 3. */
function builtRun(): FeatureState {
  let state = createFeatureState('progress', undefined, 'add 2FA');
  state = recordAgentStep(state, 1, '01-researcher', 'PASS', researcher());
  state = recordAgentStep(state, 2, '02-story-writer', 'PASS', story());
  state = recordCheckpointApproval(state, 2, 'CHECKPOINT 1: Approve the story', undefined, undefined, { checkpointId: 1, sha256: HASH });
  state = recordAgentStep(state, 2, '03-spec-writer', 'PASS', spec());
  state = recordCheckpointApproval(state, 2, 'CHECKPOINT 2: Approve the technical brief', undefined, undefined, { checkpointId: 2, sha256: HASH });
  state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend({ files: ['src/a.ts'] }), undefined, { phase: 'stage3' });
  return state;
}

/** builtRun, then Stage 4 with a Validator FAIL that opened validator round 1 (Gate 2 round 0 recorded). */
function roundOpened(issues: ValidatorIssue[] = [critical('src/a.ts')]): FeatureState {
  let state = builtRun();
  state = recordAgentStep(state, 4, '06-test-verifier', 'PASS', testVerifier());
  state = recordExecutionGate(state, { round: 0, total: 10, passed: 10, failed: 0, passRate: 1, canAdvance: true });
  state = recordAgentStep(state, 4, '07-validator', 'FAIL', validator({ status: 'FAIL', issues }));
  return recordValidatorRound(state, 1);
}

describe('hasPass (D-2 skip rule: an agent unit)', () => {
  it('D-2 only a non-invalidated PASS completes an agent unit; FAIL and ESCALATED steps do not', () => {
    let state = createFeatureState('pass');
    state = recordAgentStep(state, 4, '06-test-verifier', 'FAIL', testVerifier({ failed: 1 }));
    state = recordAgentStep(state, 4, '07-validator', 'ESCALATED', validator({ status: 'ESCALATE' }));
    expect(hasPass(state, '06-test-verifier')).toBe(false);
    expect(hasPass(state, '07-validator')).toBe(false);

    state = recordAgentStep(state, 4, '06-test-verifier', 'PASS', testVerifier());
    expect(hasPass(state, '06-test-verifier')).toBe(true);

    state = invalidateAgentSteps(state, ['06-test-verifier'], 'Stage 4 gate failed');
    expect(hasPass(state, '06-test-verifier')).toBe(false);
  });

  it("D-2 a step is keyed by its output's agent, so a tier-1 step completes the planning agent it stands in for", () => {
    let state = createFeatureState('tier-1');
    state = recordAgentStep(state, 2, 'tier-1', 'PASS', story());

    expect(hasPass(state, '02-story-writer')).toBe(true);
    expect(hasPass(state, '03-spec-writer')).toBe(false);
    expect(isPreSuppliedRun(state)).toBe(true);
    expect(isPreSuppliedRun(builtRun())).toBe(false);
  });

  it('D-2 a builder PASS completes only its own phase and round', () => {
    let state = builtRun();
    expect(hasPass(state, '04-backend-builder', { phase: 'stage3' })).toBe(true);
    expect(hasPass(state, '04-backend-builder', { phase: 'validator-round', round: 1 })).toBe(false);

    state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend(), undefined, { phase: 'validator-round', round: 1 });
    expect(hasPass(state, '04-backend-builder', { phase: 'validator-round', round: 1 })).toBe(true);
    expect(hasPass(state, '04-backend-builder', { phase: 'validator-round', round: 2 })).toBe(false);
    expect(hasPass(state, '05-frontend-builder', { phase: 'stage3' })).toBe(false);
  });
});

describe('isCheckpointApproved (D-2 skip rule: a checkpoint unit)', () => {
  it('D-2 a checkpoint is complete only with an approval bound to its id', () => {
    let state = createFeatureState('cp');
    state = recordCheckpointApproval(state, 2, 'an unbound pre-A-2 approval');
    expect(isCheckpointApproved(state, 1)).toBe(false);

    state = recordCheckpointApproval(state, 2, 'CHECKPOINT 1: Approve the story', undefined, undefined, { checkpointId: 1, sha256: HASH });
    expect(isCheckpointApproved(state, 1)).toBe(true);
    expect(isCheckpointApproved(state, 2)).toBe(false);
    expect(checkpointApproval(state, 1)).toMatchObject({ checkpointId: 1, sha256: HASH });
  });

  it('D-5 an approval older than the latest rejection of the same checkpoint does not complete it', () => {
    let state = createFeatureState('cp');
    state = recordCheckpointApproval(state, 4, 'CHECKPOINT 3: Approve the validated change', undefined, undefined, { checkpointId: 3, sha256: HASH });
    state.checkpointApprovals[0].approvedAt = '2026-10-04T10:00:00.000Z';
    state = recordCheckpointRejection(state, {
      checkpointId: 3,
      name: 'CHECKPOINT 3: Approve the validated change',
      stage: 4,
      notes: 'no',
      sha256: HASH,
      artifactPaths: ['x'],
      reworkAgents: ['04-backend-builder'],
      source: 'approver'
    });

    expect(isCheckpointApproved(state, 3)).toBe(false);
    expect(checkpointApproval(state, 3)).toBeUndefined();

    // The re-presented checkpoint, approved after the rejection, completes it again.
    state = recordCheckpointApproval(state, 4, 'CHECKPOINT 3: Approve the validated change', undefined, undefined, { checkpointId: 3, sha256: HASH });
    state.checkpointApprovals[1].approvedAt = '2099-01-01T00:00:00.000Z';
    expect(isCheckpointApproved(state, 3)).toBe(true);
  });
});

describe('isStageComplete (D-2 skip rule: whole stages)', () => {
  it('D-2 a stage the run has advanced past is complete, agents and gates alike', () => {
    const state = createFeatureState('stage');
    expect(isStageComplete(state, 1)).toBe(false);
    state.currentStage = 3;
    expect([1, 2, 3, 4].map(stage => isStageComplete(state, stage))).toEqual([true, true, false, false]);
  });

  it("D-2 a stage whose closing checkpoint is approved is complete (CP2 closes Stage 2, CP3 closes Stage 4)", () => {
    let state = builtRun();
    state.currentStage = 2;
    expect(isStageComplete(state, 2)).toBe(true);

    state.currentStage = 4;
    expect(isStageComplete(state, 4)).toBe(false);
    state = recordCheckpointApproval(state, 4, 'CHECKPOINT 3: Approve the validated change', undefined, undefined, { checkpointId: 3, sha256: HASH });
    expect(isStageComplete(state, 4)).toBe(true);
  });
});

describe('rebuildOutputs (D-2)', () => {
  it("AC-34 rebuilds each completed agent's output from stageHistory, keyed by output.agent", () => {
    const state = builtRun();
    const outputs = rebuildOutputs(state);

    expect(outputs.researcher?.agent).toBe('01-researcher');
    expect(outputs.story?.agent).toBe('02-story-writer');
    expect(outputs.spec?.agent).toBe('03-spec-writer');
    expect(outputs.backend?.details.filesModified.map(f => f.path)).toEqual(['src/a.ts']);
    expect(outputs.frontend).toBeUndefined();
    expect(outputs.test).toBeUndefined();
    expect(outputs.validator).toBeUndefined();
  });

  it('D-2 a pre-supplied run restores its story and spec from the tier-1 steps', () => {
    let state = createFeatureState('tier-1');
    state = recordAgentStep(state, 2, 'tier-1', 'PASS', story());
    state = recordAgentStep(state, 2, 'tier-1', 'PASS', spec());

    const outputs = rebuildOutputs(state);
    expect(outputs.story?.agent).toBe('02-story-writer');
    expect(outputs.spec?.agent).toBe('03-spec-writer');
  });

  it('D-2 builder outputs are folded in order: the Stage 3 PASS, then each validator-round PASS', () => {
    let state = builtRun();
    state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend({ files: ['src/b.ts'] }), undefined, { phase: 'validator-round', round: 1 });

    expect(rebuildOutputs(state).backend?.details.filesModified.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('D-2 FAIL, ESCALATED and invalidated steps contribute nothing', () => {
    let state = builtRun();
    state = recordAgentStep(state, 4, '06-test-verifier', 'FAIL', testVerifier({ failed: 1 }));
    state = recordAgentStep(state, 4, '07-validator', 'PASS', validator());
    state = invalidateAgentSteps(state, ['07-validator'], 'Stage 4 gate failed');

    const outputs = rebuildOutputs(state);
    expect(outputs.test).toBeUndefined();
    expect(outputs.validator).toBeUndefined();
  });

  it('D-2 the rebuilt outputs are copies: changing them never changes the run record', () => {
    const state = builtRun();
    const outputs = rebuildOutputs(state);
    outputs.backend!.details.filesModified.push({ path: 'src/z.ts', type: 'CREATE', description: 'x', linesAdded: 1, linesRemoved: 0 });

    expect(rebuildOutputs(state).backend?.details.filesModified.map(f => f.path)).toEqual(['src/a.ts']);
  });
});

describe('pendingValidatorRound (D-2)', () => {
  it('D-2 a round entered but not yet judged by Gate 2 is pending, routed from the Validator FAIL that opened it', () => {
    const pending = pendingValidatorRound(roundOpened(), CWD);

    expect(pending?.round).toBe(1);
    expect(pending?.backend.map(i => i.file)).toEqual(['src/a.ts']);
    expect(pending?.frontend).toEqual([]);
  });

  it('D-2 the round stays pending after its builder passed, until Gate 2 judges it (its gates re-run on resume)', () => {
    let state = roundOpened();
    state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend({ files: ['src/b.ts'] }), undefined, { phase: 'validator-round', round: 1 });
    expect(pendingValidatorRound(state, CWD)?.round).toBe(1);

    state = recordExecutionGate(state, { round: 1, total: 10, passed: 10, failed: 0, passRate: 1, canAdvance: true });
    expect(pendingValidatorRound(state, CWD)).toBeUndefined();
  });

  it("D-2 routing uses the builders' claims from before the round, not what the round's fix added", () => {
    let state = roundOpened([critical('src/a.ts')]);
    // The round's fix claims src/a.ts again plus a new file; routing must be unchanged by it.
    state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend({ files: ['src/a.ts', 'src/c.ts'] }), undefined, { phase: 'validator-round', round: 1 });

    expect(pendingValidatorRound(state, CWD)?.backend.map(i => i.file)).toEqual(['src/a.ts']);
  });

  it('D-2 nothing is pending before any round, or when the latest Validator step is not a FAIL', () => {
    expect(pendingValidatorRound(builtRun(), CWD)).toBeUndefined();

    let state = roundOpened();
    state = recordAgentStep(state, 4, '07-validator', 'PASS', validator());
    expect(pendingValidatorRound(state, CWD)).toBeUndefined();
  });
});

describe('lastBuilderFailure (AC-36)', () => {
  it('AC-36 the first resumed attempt is briefed from the last loop-back failure of that builder and phase', () => {
    let state = createFeatureState('failure');
    state = recordLoopBack(state, 3, '04-backend-builder', 'r', 'FAIL', undefined, { phase: 'stage3' }, { kind: 'test', error: 'first' });
    state = recordLoopBack(state, 3, '04-backend-builder', 'r', 'FAIL', undefined, { phase: 'stage3' }, { kind: 'schema', error: 'second' });
    state = recordLoopBack(state, 3, '04-backend-builder', 'r', 'FAIL', undefined, { phase: 'validator-round', round: 1 }, { kind: 'test', error: 'round' });
    state = recordLoopBack(state, 3, '05-frontend-builder', 'r', 'FAIL', undefined, { phase: 'stage3' }, { kind: 'test', error: 'frontend' });

    expect(lastBuilderFailure(state, '04-backend-builder', { phase: 'stage3' })).toEqual({ kind: 'schema', error: 'second' });
    expect(lastBuilderFailure(state, '04-backend-builder', { phase: 'validator-round', round: 1 })).toEqual({ kind: 'test', error: 'round' });
    expect(lastBuilderFailure(state, '04-backend-builder', { phase: 'validator-round', round: 2 })).toBeUndefined();
  });

  it('AC-36 a last loop-back that named no failure briefs nothing, rather than an older failure', () => {
    let state = createFeatureState('failure');
    state = recordLoopBack(state, 3, '04-backend-builder', 'r', 'FAIL', undefined, { phase: 'stage3' }, { kind: 'test', error: 'old' });
    state = recordLoopBack(state, 3, '04-backend-builder', 'none named', 'FAIL', undefined, { phase: 'stage3' });

    expect(lastBuilderFailure(state, '04-backend-builder', { phase: 'stage3' })).toBeUndefined();
  });
});

describe('D-5 which rework is due, and which is under way', () => {
  const HASH = 'c'.repeat(64);
  const reject = (state: FeatureState, checkpointId: 1 | 2 | 3, at: string): FeatureState => {
    const next = recordCheckpointRejection(state, {
      checkpointId,
      name: `CHECKPOINT ${checkpointId}`,
      stage: checkpointId === 3 ? 4 : 2,
      notes: 'Redo it',
      sha256: HASH,
      artifactPaths: ['x.md'],
      reworkAgents: [checkpointId === 1 ? '02-story-writer' : checkpointId === 2 ? '03-spec-writer' : '04-backend-builder'],
      source: 'approver'
    });
    next.checkpointRejections!.at(-1)!.rejectedAt = at;
    return next;
  };
  const approve = (state: FeatureState, checkpointId: 1 | 2 | 3, at: string): FeatureState => {
    const next = recordCheckpointApproval(state, 2, `CHECKPOINT ${checkpointId}`, undefined, undefined, { checkpointId, sha256: HASH });
    next.checkpointApprovals.at(-1)!.approvedAt = at;
    return next;
  };
  const start = (state: FeatureState, cycle: number, at: string): FeatureState => {
    const next = recordReworkStart(state, cycle, { supersededDir: `.factory/r/_superseded/${cycle}` });
    next.checkpointRejections![cycle - 1].rework!.startedAt = at;
    return next;
  };

  it('AC-75 a rejection whose rework has not started is due, numbered by its cycle', () => {
    const state = reject(approve(createFeatureState('r'), 1, '2026-10-04T10:00:00.000Z'), 2, '2026-10-04T10:01:00.000Z');

    expect(reworkToStart(state)).toEqual({ rejection: state.checkpointRejections![0], cycle: 1 });
    expect(activeRework(state)).toBeUndefined();
  });

  it('AC-75 once started the rework is under way until its checkpoint is approved after the start', () => {
    let state = reject(createFeatureState('r'), 3, '2026-10-04T10:00:00.000Z');
    state = start(state, 1, '2026-10-04T10:05:00.000Z');

    expect(reworkToStart(state)).toBeUndefined();
    expect(activeRework(state)).toEqual({ rejection: state.checkpointRejections![0], cycle: 1 });

    state = approve(state, 3, '2026-10-04T10:30:00.000Z');
    expect(activeRework(state)).toBeUndefined();
    expect(reworkToStart(state)).toBeUndefined();
  });

  it('AC-75 only the latest rejection counts: an earlier, finished rework is not re-opened', () => {
    let state = reject(createFeatureState('r'), 1, '2026-10-04T10:00:00.000Z');
    state = start(state, 1, '2026-10-04T10:01:00.000Z');
    state = approve(state, 1, '2026-10-04T10:02:00.000Z');
    state = reject(state, 2, '2026-10-04T10:03:00.000Z');

    expect(reworkToStart(state)).toEqual({ rejection: state.checkpointRejections![1], cycle: 2 });
    expect(activeRework(state)).toBeUndefined();
  });

  it('D-5 a state written before A-2 has no rework', () => {
    const old = createFeatureState('r');
    delete old.checkpointRejections;
    expect(reworkToStart(old)).toBeUndefined();
    expect(activeRework(old)).toBeUndefined();
  });
});

describe('D-B the invalidation a re-run planning agent is briefed with', () => {
  it('D-B names the reason when the agent\'s latest step is a PASS a gate invalidated, keyed by the output agent', () => {
    let state = recordAgentStep(createFeatureState('i'), 2, 'tier-1', 'PASS', story());
    state = invalidateAgentSteps(state, ['02-story-writer'], 'Story gate failed: no Given/When/Then');

    expect(lastInvalidation(state, '02-story-writer')).toEqual({ reason: 'Story gate failed: no Given/When/Then', at: expect.any(String) });
    expect(lastInvalidation(state, '03-spec-writer')).toBeUndefined();
  });

  it('D-B nothing once the agent has a PASS again', () => {
    let state = recordAgentStep(createFeatureState('i'), 2, '02-story-writer', 'PASS', story());
    state = invalidateAgentSteps(state, ['02-story-writer'], 'Story gate failed');
    state = recordAgentStep(state, 2, '02-story-writer', 'PASS', story());

    expect(lastInvalidation(state, '02-story-writer')).toBeUndefined();
  });
});

describe('MINOR-5 rebuilding builder outputs with the project root', () => {
  it('MINOR-5 rebuildOutputs folds an absolute and a relative claim to the same file into one, given cwd', () => {
    let state = recordAgentStep(createFeatureState('m'), 3, '04-backend-builder', 'PASS', backend({ files: [join(CWD, 'src/a.ts')] }), undefined, { phase: 'stage3' });
    state = recordAgentStep(state, 3, '04-backend-builder', 'PASS', backend({ files: ['src/a.ts'] }), undefined, { phase: 'validator-round', round: 1 });

    expect(rebuildOutputs(state, CWD).backend!.details.filesModified.map(f => f.path)).toEqual(['src/a.ts']);
  });
});
