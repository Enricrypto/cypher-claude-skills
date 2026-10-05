/**
 * Run lifecycle (A-2, D-1 and D-3, pure parts): classification, resumability, attempt budgets,
 * resume-request refusals, next-step hints and safe run ids.
 *
 * Everything here is a pure function over FeatureState: no filesystem, no orchestrator. The
 * orchestrator calls checkResumeRequest BEFORE any write (step 6), which is why a refusal is a
 * thrown RunRefusedError and never a state transition.
 */

import { describe, it, expect } from '@jest/globals';
import {
  RunRefusedError,
  RunRefusalCode,
  ResumeRequest,
  MAX_GRANT_PER_RESUME,
  allowedAttempts,
  checkResumeRequest,
  classifyRun,
  exhaustedBuilder,
  isSafeRunId,
  nextStepHints,
  parseCheckpointId,
  checkResumeDescription,
  resumeDescription,
  usedAttempts
} from '../../harness/run-lifecycle';
import {
  FeatureState,
  completeFeature,
  createFeatureState,
  recordAttemptGrant,
  recordBuilderAttempt,
  recordEscalation,
  recordPause,
  serializeState
} from '../../harness/state-tracker';
import { MAX_BUILDER_ATTEMPTS } from '../../harness/loop-rules';

const HASH = 'a'.repeat(64);

function paused(checkpointId: 1 | 2 | 3 = 2): FeatureState {
  return recordPause(createFeatureState('paused', undefined, 'desc'), {
    checkpointId,
    name: `CHECKPOINT ${checkpointId}`,
    stage: checkpointId === 3 ? 4 : 2,
    artifactPaths: ['.factory/x/TECHNICAL_BRIEF.md'],
    sha256: HASH
  });
}

function finished(status: 'SUCCESS' | 'ESCALATED' | 'MANUAL_STOP'): FeatureState {
  return completeFeature(createFeatureState(status.toLowerCase()), status, 'done');
}

/** A run whose Backend Builder exhausted its Stage 3 attempts, finished ESCALATED. */
function exhausted(): FeatureState {
  let state = createFeatureState('exhausted');
  for (let i = 0; i < MAX_BUILDER_ATTEMPTS; i++) {
    state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
  }
  state = recordEscalation(state, 3, '04-backend-builder', 'MAX_LOOPS', 'Backend builder exceeded max attempts', {
    loopCount: MAX_BUILDER_ATTEMPTS,
    builderPhase: { phase: 'stage3' }
  });
  return completeFeature(state, 'ESCALATED', 'exhausted');
}

/** A run ESCALATED by something other than a builder running out of attempts. */
function escalatedOther(): FeatureState {
  const state = recordEscalation(createFeatureState('other'), 4, '06-test-verifier', 'CRITICAL_ISSUE', 'boom');
  return completeFeature(state, 'ESCALATED', 'boom');
}

function refusal(state: FeatureState, request: ResumeRequest): RunRefusalCode | undefined {
  try {
    checkResumeRequest(state, request);
    return undefined;
  } catch (err) {
    if (err instanceof RunRefusedError) return err.code;
    throw err;
  }
}

const CONTINUE: ResumeRequest = { action: { kind: 'continue' } };

describe('Run lifecycle (D-1, D-3)', () => {
  describe('D-1 classifyRun', () => {
    it.each([
      ['IN_PROGRESS', () => createFeatureState('fresh'), 'ACTIVE'],
      [
        'ESCALATED status without completedAt (killed before finish)',
        () => recordEscalation(createFeatureState('k'), 3, '04-backend-builder', 'MAX_LOOPS', 'x'),
        'ACTIVE'
      ],
      ['PAUSED', () => paused(), 'PAUSED'],
      ['completed SUCCESS', () => finished('SUCCESS'), 'SUCCESS'],
      ['completed MANUAL_STOP', () => finished('MANUAL_STOP'), 'MANUAL_STOP'],
      ['completed ESCALATED', () => finished('ESCALATED'), 'ESCALATED']
    ])('D-1 a %s run classifies as expected', (_label, make, expected) => {
      expect(classifyRun(make())).toBe(expected);
    });

    it('D-1 a state.json written before A-2 (no new fields) classifies by status and completionStatus alone', () => {
      const old = JSON.parse(serializeState(finished('ESCALATED'))) as FeatureState;
      for (const key of ['featureDescription', 'pendingCheckpoint', 'checkpointRejections', 'attemptGrants', 'agentInvocations', 'resumeHistory'] as const) {
        delete old[key];
      }
      expect(classifyRun(old)).toBe('ESCALATED');
    });
  });

  describe('D-3 parseCheckpointId', () => {
    it.each([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['cp1', 1],
      ['cp2', 2],
      ['CP3', 3]
    ])('D-3 %s parses to checkpoint %i', (raw, expected) => {
      expect(parseCheckpointId(raw)).toBe(expected);
    });

    it.each(['0', '4', 'cp4', '', ' 1', '1 ', '01', 'cp', 'one', '1.0'])('D-3 %p is not a checkpoint id', raw => {
      expect(parseCheckpointId(raw)).toBeUndefined();
    });

    it('D-3 a missing or non-string value is not a checkpoint id (fails closed)', () => {
      expect(parseCheckpointId(undefined as unknown as string)).toBeUndefined();
      expect(parseCheckpointId(2 as unknown as string)).toBeUndefined();
    });
  });

  describe('D-2 attempt budgets from state', () => {
    it('AC-36 usedAttempts reads builderAttempts per builder and phase, 0 when nothing was recorded', () => {
      let state = createFeatureState('t');
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'stage3' });
      state = recordBuilderAttempt(state, '04-backend-builder', { phase: 'validator-round', round: 1 });
      state = recordBuilderAttempt(state, '05-frontend-builder', { phase: 'rework', round: 1 });

      expect(usedAttempts(state, '04-backend-builder', { phase: 'stage3' })).toBe(2);
      expect(usedAttempts(state, '04-backend-builder', { phase: 'validator-round', round: 1 })).toBe(1);
      expect(usedAttempts(state, '04-backend-builder', { phase: 'validator-round', round: 2 })).toBe(0);
      expect(usedAttempts(state, '05-frontend-builder', { phase: 'rework', round: 1 })).toBe(1);
      expect(usedAttempts(state, '05-frontend-builder', { phase: 'stage3' })).toBe(0);
    });

    it('AC-36 usedAttempts tolerates a state file written before the counters existed', () => {
      const old = createFeatureState('old');
      delete old.builderAttempts;
      expect(usedAttempts(old, '04-backend-builder', { phase: 'stage3' })).toBe(0);
    });

    it('AC-72 allowedAttempts is MAX_BUILDER_ATTEMPTS plus the grants for exactly that builder and phase', () => {
      let state = createFeatureState('t');
      expect(allowedAttempts(state, '04-backend-builder', { phase: 'stage3' })).toBe(MAX_BUILDER_ATTEMPTS);

      state = recordAttemptGrant(state, { builder: '04-backend-builder', attempts: 2, at: { phase: 'stage3' } });
      state = recordAttemptGrant(state, { builder: '04-backend-builder', attempts: 1, at: { phase: 'stage3' } });
      state = recordAttemptGrant(state, { builder: '04-backend-builder', attempts: 1, at: { phase: 'validator-round', round: 1 } });
      state = recordAttemptGrant(state, { builder: '05-frontend-builder', attempts: 3, at: { phase: 'stage3' } });

      expect(allowedAttempts(state, '04-backend-builder', { phase: 'stage3' })).toBe(MAX_BUILDER_ATTEMPTS + 3);
      expect(allowedAttempts(state, '04-backend-builder', { phase: 'validator-round', round: 1 })).toBe(MAX_BUILDER_ATTEMPTS + 1);
      expect(allowedAttempts(state, '04-backend-builder', { phase: 'validator-round', round: 2 })).toBe(MAX_BUILDER_ATTEMPTS);
      expect(allowedAttempts(state, '04-backend-builder', { phase: 'rework', round: 1 })).toBe(MAX_BUILDER_ATTEMPTS);
      expect(allowedAttempts(state, '05-frontend-builder', { phase: 'stage3' })).toBe(MAX_BUILDER_ATTEMPTS + 3);
    });

    it('I-8 MAX_GRANT_PER_RESUME is MAX_BUILDER_ATTEMPTS', () => {
      expect(MAX_GRANT_PER_RESUME).toBe(MAX_BUILDER_ATTEMPTS);
    });
  });

  describe('D-3 exhaustedBuilder', () => {
    it('AC-71 names the builder and phase when the latest unresolved escalation is a builder MAX_LOOPS with builderPhase', () => {
      expect(exhaustedBuilder(exhausted())).toEqual({ builder: '04-backend-builder', at: { phase: 'stage3' } });
    });

    it('AC-71 also names a validator-round exhaustion', () => {
      let state = createFeatureState('vr');
      state = recordEscalation(state, 3, '05-frontend-builder', 'MAX_LOOPS', 'x', {
        builderPhase: { phase: 'validator-round', round: 2 }
      });
      expect(exhaustedBuilder(completeFeature(state, 'ESCALATED'))).toEqual({
        builder: '05-frontend-builder',
        at: { phase: 'validator-round', round: 2 }
      });
    });

    // MINOR-8 (pre-approved, AC-101): the pre-A-2 row "a MAX_LOOPS escalation without builderPhase"
    // used to expect undefined here. Its phase is now inferred; see the AC-101 test below.
    it.each([
      ['an escalation that is not MAX_LOOPS', () => escalatedOther()],
      [
        'a MAX_LOOPS escalation by a non-builder agent',
        () =>
          completeFeature(
            recordEscalation(createFeatureState('o'), 4, '07-validator', 'MAX_LOOPS', 'x', { builderPhase: { phase: 'stage3' } }),
            'ESCALATED'
          )
      ],
      [
        'a resolved builder exhaustion',
        () => {
          const state = exhausted();
          state.escalations[0].resolvedAt = new Date().toISOString();
          return state;
        }
      ],
      [
        'a builder exhaustion followed by a later, different escalation',
        () => {
          const state = exhausted();
          return recordEscalation(state, 4, '06-test-verifier', 'CRITICAL_ISSUE', 'later');
        }
      ],
      ['no escalation at all', () => createFeatureState('none')],
      ['a PAUSED run', () => paused()]
    ])('AC-71 is undefined for %s', (_label, make) => {
      expect(exhaustedBuilder(make())).toBeUndefined();
    });

    /** A pre-A-2 record: the builder escalated MAX_LOOPS at `stage` with no builderPhase. */
    function preA2Exhausted(stage: number, validatorRoundsCompleted?: number, agent = '04-backend-builder'): FeatureState {
      const state = recordEscalation(createFeatureState('pre-a2'), stage, agent, 'MAX_LOOPS', 'Builder exceeded max attempts');
      if (validatorRoundsCompleted === undefined) delete state.validatorRoundsCompleted;
      else state.validatorRoundsCompleted = validatorRoundsCompleted;
      expect(state.escalations.at(-1)!.context.builderPhase).toBeUndefined();
      return completeFeature(state, 'ESCALATED', 'exhausted');
    }

    it('AC-101 a MAX_LOOPS record without builderPhase infers Stage 3 from escalation stage 3, validator round validatorRoundsCompleted from stage 4, and nothing when the round is unknown', () => {
      // Escalation stage 3 → Stage 3, whatever the validator rounds say.
      expect(exhaustedBuilder(preA2Exhausted(3))).toEqual({ builder: '04-backend-builder', at: { phase: 'stage3' } });
      expect(exhaustedBuilder(preA2Exhausted(3, 2))).toEqual({ builder: '04-backend-builder', at: { phase: 'stage3' } });
      // A run killed before finish() (ACTIVE) infers the same.
      const killed = recordEscalation(createFeatureState('killed'), 3, '05-frontend-builder', 'MAX_LOOPS', 'x');
      expect(exhaustedBuilder(killed)).toEqual({ builder: '05-frontend-builder', at: { phase: 'stage3' } });

      // Escalation stage 4 → the validator round the run had entered.
      expect(exhaustedBuilder(preA2Exhausted(4, 1))).toEqual({
        builder: '04-backend-builder',
        at: { phase: 'validator-round', round: 1 }
      });
      expect(exhaustedBuilder(preA2Exhausted(4, 2, '05-frontend-builder'))).toEqual({
        builder: '05-frontend-builder',
        at: { phase: 'validator-round', round: 2 }
      });

      // I-11: stage 4 without a usable round infers nothing (the old behaviour).
      expect(exhaustedBuilder(preA2Exhausted(4, 0))).toBeUndefined();
      expect(exhaustedBuilder(preA2Exhausted(4))).toBeUndefined();
      expect(exhaustedBuilder(preA2Exhausted(4, 1.5))).toBeUndefined();
      expect(exhaustedBuilder(preA2Exhausted(4, -1))).toBeUndefined();
      // Any other stage is not a builder phase: nothing.
      expect(exhaustedBuilder(preA2Exhausted(2))).toBeUndefined();
      expect(exhaustedBuilder(preA2Exhausted(5, 1))).toBeUndefined();
      // A recorded builderPhase still wins over the inference.
      const recorded = recordEscalation(createFeatureState('a2'), 4, '04-backend-builder', 'MAX_LOOPS', 'x', {
        builderPhase: { phase: 'rework', round: 1 }
      });
      recorded.validatorRoundsCompleted = 2;
      expect(exhaustedBuilder(recorded)).toEqual({ builder: '04-backend-builder', at: { phase: 'rework', round: 1 } });

      // The refusal and the hint follow the inference.
      const stage3 = preA2Exhausted(3);
      expect(refusal(stage3, CONTINUE)).toBe('NEEDS_GRANT');
      expect(refusal(stage3, { action: { kind: 'continue' }, grantAttempts: 1 })).toBeUndefined();
      expect(() => checkResumeRequest(stage3, CONTINUE)).toThrow(/exhausted its attempts \(Stage 3\)\..*--grant-attempts <n>/);
      expect(() => checkResumeRequest(preA2Exhausted(4, 2), CONTINUE)).toThrow(/\(validator-round 2\)/);
      expect(nextStepHints(stage3, '/p')).toEqual([
        `Resume with: npm run factory -- --resume ${stage3.featureId} --cwd /p --grant-attempts <n>`,
        `Close with: npm run factory -- --close ${stage3.featureId} --cwd /p`
      ]);
      // Not inferable: a plain continue is accepted and a grant does not apply, as before.
      expect(refusal(preA2Exhausted(4, 0), CONTINUE)).toBeUndefined();
      expect(refusal(preA2Exhausted(4, 0), { action: { kind: 'continue' }, grantAttempts: 1 })).toBe('GRANT_NOT_APPLICABLE');
    });
  });

  describe('D-3 checkResumeRequest', () => {
    it.each(['SUCCESS', 'MANUAL_STOP'] as const)('D-3 any request on a %s run is refused RUN_FINISHED', status => {
      const state = finished(status);
      expect(refusal(state, CONTINUE)).toBe('RUN_FINISHED');
      expect(refusal(state, { action: { kind: 'approve', checkpoint: 1 } })).toBe('RUN_FINISHED');
      expect(refusal(state, { action: { kind: 'reject', checkpoint: 1, notes: 'no' } })).toBe('RUN_FINISHED');
      expect(refusal(state, { action: { kind: 'continue' }, grantAttempts: 1 })).toBe('RUN_FINISHED');
    });

    it('AC-54 a plain continue of a PAUSED run is accepted (the orchestrator treats it as a no-op)', () => {
      expect(refusal(paused(), CONTINUE)).toBeUndefined();
    });

    it('AC-51 approving the pending checkpoint of a PAUSED run is accepted (the hash check is the orchestrator\'s)', () => {
      expect(refusal(paused(2), { action: { kind: 'approve', checkpoint: 2 } })).toBeUndefined();
    });

    it('AC-74 rejecting the pending checkpoint with notes is accepted', () => {
      expect(refusal(paused(1), { action: { kind: 'reject', checkpoint: 1, notes: 'Too vague' } })).toBeUndefined();
    });

    it.each([
      ['approve', { action: { kind: 'approve', checkpoint: 1 } } as ResumeRequest],
      ['reject', { action: { kind: 'reject', checkpoint: 3, notes: 'x' } } as ResumeRequest],
      ['approve (not a checkpoint at all)', { action: { kind: 'approve', checkpoint: 7 } } as unknown as ResumeRequest]
    ])('AC-53 --%s naming a checkpoint other than the pending one is refused WRONG_CHECKPOINT', (_label, request) => {
      expect(refusal(paused(2), request)).toBe('WRONG_CHECKPOINT');
    });

    it.each([
      ['empty', ''],
      ['blank', '   \n\t'],
      ['missing', undefined]
    ])('AC-74 rejecting with %s notes is refused NOTES_REQUIRED', (_label, notes) => {
      const request = { action: { kind: 'reject', checkpoint: 2, notes } } as unknown as ResumeRequest;
      expect(refusal(paused(2), request)).toBe('NOTES_REQUIRED');
    });

    it.each([
      ['ESCALATED', () => escalatedOther()],
      ['ACTIVE', () => createFeatureState('active')],
      [
        'PAUSED with no pending checkpoint recorded',
        () => {
          const state = createFeatureState('odd');
          state.status = 'PAUSED';
          return state;
        }
      ]
    ])('D-3 approve or reject on an %s run is refused NO_PENDING_CHECKPOINT', (_label, make) => {
      expect(refusal(make(), { action: { kind: 'approve', checkpoint: 1 } })).toBe('NO_PENDING_CHECKPOINT');
      expect(refusal(make(), { action: { kind: 'reject', checkpoint: 1, notes: 'x' } })).toBe('NO_PENDING_CHECKPOINT');
    });

    it('AC-71 continuing a builder-exhausted run without a grant is refused NEEDS_GRANT, naming --grant-attempts <n>', () => {
      const state = exhausted();
      expect(() => checkResumeRequest(state, CONTINUE)).toThrow(RunRefusedError);
      expect(() => checkResumeRequest(state, CONTINUE)).toThrow(/--grant-attempts <n>/);
      expect(refusal(state, CONTINUE)).toBe('NEEDS_GRANT');
    });

    it('AC-71 a refusal leaves the state untouched', () => {
      const state = exhausted();
      const before = serializeState(state);
      refusal(state, CONTINUE);
      refusal(state, { action: { kind: 'continue' }, grantAttempts: 9 });
      expect(serializeState(state)).toBe(before);
    });

    it.each([1, 2, 3])('AC-72 a grant of %i attempts on a builder-exhausted run is accepted', n => {
      expect(refusal(exhausted(), { action: { kind: 'continue' }, grantAttempts: n })).toBeUndefined();
    });

    it.each([0, 4, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2' as unknown as number])(
      'I-8 a grant of %p is refused GRANT_OUT_OF_RANGE',
      n => {
        expect(refusal(exhausted(), { action: { kind: 'continue' }, grantAttempts: n })).toBe('GRANT_OUT_OF_RANGE');
      }
    );

    it.each([
      ['an ESCALATED run whose builder did not exhaust', () => escalatedOther(), CONTINUE],
      ['an ACTIVE run', () => createFeatureState('active'), CONTINUE],
      ['a PAUSED run (continue)', () => paused(2), CONTINUE],
      ['a PAUSED run (approve)', () => paused(2), { action: { kind: 'approve', checkpoint: 2 } } as ResumeRequest]
    ])('I-8 a grant on %s is refused GRANT_NOT_APPLICABLE', (_label, make, base) => {
      expect(refusal(make(), { ...base, grantAttempts: 1 })).toBe('GRANT_NOT_APPLICABLE');
    });

    it('AC-35 continuing an ESCALATED run that did not exhaust a builder is accepted', () => {
      expect(refusal(escalatedOther(), CONTINUE)).toBeUndefined();
    });

    it('D-3 continuing an ACTIVE (killed) run is accepted', () => {
      expect(refusal(createFeatureState('active'), CONTINUE)).toBeUndefined();
    });

    it.each([
      ['no request', undefined],
      ['no action', {}],
      ['an unknown action', { action: { kind: 'skip' } }]
    ])('D-3 %s fails closed with an error, never as an accepted continue', (_label, request) => {
      expect(() => checkResumeRequest(createFeatureState('a'), request as unknown as ResumeRequest)).toThrow();
    });

    it('D-3 RunRefusedError carries its code and message, and is an Error', () => {
      const err = new RunRefusedError('RUN_FINISHED', 'Run x already finished.');
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('RUN_FINISHED');
      expect(err.message).toBe('Run x already finished.');
      expect(err.name).toBe('RunRefusedError');
    });
  });

  describe('AC-42 nextStepHints', () => {
    const CWD = '/tmp/project';

    it('AC-42 a PAUSED run gets approve, reject and close commands for its pending checkpoint, and no Resume with', () => {
      const state = paused(2);
      const hints = nextStepHints(state, CWD);
      const id = state.featureId;
      expect(hints).toEqual([
        `Approve with: npm run factory -- --resume ${id} --cwd ${CWD} --approve 2`,
        `Reject with: npm run factory -- --resume ${id} --cwd ${CWD} --reject 2 --notes "<why>"`,
        `Close with: npm run factory -- --close ${id} --cwd ${CWD}`
      ]);
    });

    it('AC-42 a builder-exhausted run gets Resume with --grant-attempts <n>, and close', () => {
      const state = exhausted();
      const id = state.featureId;
      expect(nextStepHints(state, CWD)).toEqual([
        `Resume with: npm run factory -- --resume ${id} --cwd ${CWD} --grant-attempts <n>`,
        `Close with: npm run factory -- --close ${id} --cwd ${CWD}`
      ]);
    });

    it.each([
      ['ESCALATED', () => escalatedOther()],
      ['ACTIVE', () => createFeatureState('active')]
    ])('AC-42 an %s run gets a plain Resume with, and close', (_label, make) => {
      const state = make();
      const id = state.featureId;
      expect(nextStepHints(state, CWD)).toEqual([
        `Resume with: npm run factory -- --resume ${id} --cwd ${CWD}`,
        `Close with: npm run factory -- --close ${id} --cwd ${CWD}`
      ]);
    });

    it('AC-42 a SUCCESS run gets only the consolidate command', () => {
      const state = finished('SUCCESS');
      expect(nextStepHints(state, CWD)).toEqual([
        `Consolidate with: npm run factory -- --consolidate ${state.featureId} --cwd ${CWD}`
      ]);
    });

    it('AC-42 a MANUAL_STOP run gets no hints', () => {
      expect(nextStepHints(finished('MANUAL_STOP'), CWD)).toEqual([]);
    });

    it('AC-42 Resume with appears only for a resumable class', () => {
      for (const state of [finished('SUCCESS'), finished('MANUAL_STOP'), paused()]) {
        expect(nextStepHints(state, CWD).some(h => h.startsWith('Resume with:'))).toBe(false);
      }
      for (const state of [escalatedOther(), exhausted(), createFeatureState('a')]) {
        expect(nextStepHints(state, CWD).some(h => h.startsWith('Resume with:'))).toBe(true);
      }
    });

    it('AC-42 a PAUSED run with no pending checkpoint gets only the close command (fails closed)', () => {
      const state = createFeatureState('odd');
      state.status = 'PAUSED';
      expect(nextStepHints(state, CWD)).toEqual([`Close with: npm run factory -- --close ${state.featureId} --cwd ${CWD}`]);
    });

    it('SEC a cwd with spaces or shell metacharacters is single-quoted in the commands', () => {
      const state = finished('SUCCESS');
      expect(nextStepHints(state, "/tmp/my project's $HOME")).toEqual([
        `Consolidate with: npm run factory -- --consolidate ${state.featureId} --cwd '/tmp/my project'\\''s $HOME'`
      ]);
    });

    it('SEC a run whose id is not a safe run id gets no commands', () => {
      const state = escalatedOther();
      state.featureId = '../../etc';
      expect(nextStepHints(state, CWD)).toEqual([]);
    });
  });

  describe('SEC isSafeRunId', () => {
    it.each(['../x', 'a/b', '.hidden', '_archive', '', '..', 'a..b', 'a\\b', 'a b', '-rf', 'x'.repeat(129), 'é'])(
      'SEC run id %p is refused',
      id => {
        expect(isSafeRunId(id)).toBe(false);
      }
    );

    it.each(['8f14e45f-ceea-467a-9575-ec5a3a1b2c3d', 'run1', 'A.b_c-d', 'x'.repeat(128)])('SEC run id %p is accepted', id => {
      expect(isSafeRunId(id)).toBe(true);
    });

    it('SEC a run id containing a NUL byte is refused', () => {
      expect(isSafeRunId('a\u0000b')).toBe(false);
    });

    it('SEC a missing or non-string id is refused (fails closed)', () => {
      expect(isSafeRunId(undefined as unknown as string)).toBe(false);
      expect(isSafeRunId(42 as unknown as string)).toBe(false);
    });

    it('SEC every id createFeatureState generates is a safe run id', () => {
      for (let i = 0; i < 50; i++) {
        expect(isSafeRunId(createFeatureState('t').featureId)).toBe(true);
      }
    });
  });
});

describe('IMPORTANT-1 resumeDescription', () => {
  it('IMPORTANT-1 the description saved in the run wins', () => {
    expect(resumeDescription(createFeatureState('n', undefined, 'add 2FA'), undefined)).toBe('add 2FA');
  });

  it('IMPORTANT-1 a run recorded without a description takes the --feature one', () => {
    expect(resumeDescription(createFeatureState('n'), 'add 2FA')).toBe('add 2FA');
  });

  it.each([[undefined], [''], ['  ']])(
    'IMPORTANT-1 a run recorded without a description and no --feature (%j) is refused with DESCRIPTION_REQUIRED naming --feature',
    feature => {
      const state = createFeatureState('n');
      let refusal: unknown;
      try {
        resumeDescription(state, feature);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(RunRefusedError);
      expect((refusal as RunRefusedError).code).toBe('DESCRIPTION_REQUIRED');
      expect((refusal as Error).message).toContain('--feature');
      expect((refusal as Error).message).toContain(state.featureId);
    }
  );
});

describe('AC-99 checkResumeDescription', () => {
  function descriptionRefusal(state: FeatureState, supplied: string | undefined): RunRefusedError | undefined {
    try {
      checkResumeDescription(state, supplied);
      return undefined;
    } catch (error) {
      if (error instanceof RunRefusedError) return error;
      throw error;
    }
  }

  it.each([[undefined], [''], ['   '], ['add 2FA']])(
    'AC-99 a run with a saved description resumes with it when the supplied one (%j) is absent, blank or equal',
    supplied => {
      expect(checkResumeDescription(createFeatureState('n', undefined, 'add 2FA'), supplied)).toBe('add 2FA');
    }
  );

  it('AC-99 a supplied description that differs from the saved one is refused DESCRIPTION_MISMATCH with the CLI wording', () => {
    const state = createFeatureState('n', undefined, 'add 2FA');
    const refused = descriptionRefusal(state, 'add SMS login');
    expect(refused?.code).toBe('DESCRIPTION_MISMATCH');
    expect(refused?.message).toBe(
      `--feature "add SMS login" does not match the description saved in run ${state.featureId} ("add 2FA"). ` +
        'Omit --feature to resume it as it was started.'
    );
    // Exact comparison: case and surrounding spaces count as a difference.
    expect(descriptionRefusal(state, 'Add 2FA')?.code).toBe('DESCRIPTION_MISMATCH');
    expect(descriptionRefusal(state, ' add 2FA')?.code).toBe('DESCRIPTION_MISMATCH');
  });

  it('AC-99 a run recorded without a description takes the supplied one, and is refused DESCRIPTION_REQUIRED when none (or a blank one) is supplied', () => {
    expect(checkResumeDescription(createFeatureState('n'), 'add 2FA')).toBe('add 2FA');
    for (const supplied of [undefined, '', '  ']) {
      const state = createFeatureState('n');
      const refused = descriptionRefusal(state, supplied);
      expect(refused?.code).toBe('DESCRIPTION_REQUIRED');
      expect(refused?.message).toContain('--feature');
      expect(refused?.message).toContain(state.featureId);
    }
  });
});
