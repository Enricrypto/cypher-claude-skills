/**
 * The regression reference, read side (D-12; AC-22, AC-65 read, AC-66).
 *
 * "No Regressions" used to read a count the Validator typed into its own report. The reference
 * is now the harness's: the run's first Gate 2 count, or — for the first evaluation — the test
 * count a previous successful run left in `.factory/baseline.json`. The reader refuses to guess
 * when it cannot; the writer (AC-65, D-7) records a SUCCESS run's own latest passing count.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  BASELINE_FILENAME,
  RegressionBaseline,
  RegressionBaselineError,
  baselineFilePath,
  baselineFromRun,
  readRegressionBaseline,
  regressionReference,
  validatorRoundReference,
  writeRegressionBaseline
} from '../../harness/regression-baseline';
import { createFeatureState, ExecutionGateRecord, FeatureState, recordExecutionGate } from '../../harness/state-tracker';
import { tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-baseline-');
});

afterEach(() => {
  project.cleanup();
});

const validBaseline = (): RegressionBaseline => ({
  schemaVersion: 1,
  runId: 'prior-run',
  testCount: 12,
  recordedAt: '2026-10-01T00:00:00.000Z'
});

const writeBaseline = (content: string) => {
  mkdirSync(join(project.dir, '.factory'), { recursive: true });
  writeFileSync(join(project.dir, '.factory', BASELINE_FILENAME), content);
};

const record = (total: number): ExecutionGateRecord => ({
  round: 0,
  total,
  passed: total,
  failed: 0,
  passRate: 1,
  canAdvance: true,
  recordedAt: '2026-10-04T00:00:00.000Z'
});

describe('baselineFilePath', () => {
  it('is <cwd>/.factory/baseline.json — a regular file beside the run directories', () => {
    expect(BASELINE_FILENAME).toBe('baseline.json');
    expect(baselineFilePath(project.dir)).toBe(join(project.dir, '.factory', 'baseline.json'));
  });
});

describe('readRegressionBaseline', () => {
  it('AC-66 returns undefined when there is no baseline file', () => {
    expect(readRegressionBaseline(project.dir)).toBeUndefined();
  });

  it('AC-65 returns the baseline a previous run left', () => {
    writeBaseline(JSON.stringify(validBaseline()));

    expect(readRegressionBaseline(project.dir)).toEqual(validBaseline());
  });

  it('throws RegressionBaselineError, naming the file, when the file is not JSON', () => {
    writeBaseline('{ not json');

    expect(() => readRegressionBaseline(project.dir)).toThrow(RegressionBaselineError);
    expect(() => readRegressionBaseline(project.dir)).toThrow(baselineFilePath(project.dir));
  });

  it('throws RegressionBaselineError when the path cannot be read as a file', () => {
    mkdirSync(baselineFilePath(project.dir), { recursive: true });

    expect(() => readRegressionBaseline(project.dir)).toThrow(RegressionBaselineError);
  });

  it.each<[string, unknown]>([
    ['a JSON array', [validBaseline()]],
    ['JSON null', null],
    ['an unknown schemaVersion', { ...validBaseline(), schemaVersion: 2 }],
    ['no runId', { ...validBaseline(), runId: undefined }],
    ['a blank runId', { ...validBaseline(), runId: '  ' }],
    ['no testCount', { ...validBaseline(), testCount: undefined }],
    ['a string testCount', { ...validBaseline(), testCount: '12' }],
    ['a negative testCount', { ...validBaseline(), testCount: -1 }],
    ['a fractional testCount', { ...validBaseline(), testCount: 1.5 }],
    ['no recordedAt', { ...validBaseline(), recordedAt: undefined }]
  ])('throws RegressionBaselineError for %s — an invalid baseline is never read as "no baseline"', (_label, content) => {
    writeBaseline(JSON.stringify(content));

    expect(() => readRegressionBaseline(project.dir)).toThrow(RegressionBaselineError);
  });

  it('RegressionBaselineError is an Error with its own name', () => {
    writeBaseline('[]');

    let thrown: unknown;
    try {
      readRegressionBaseline(project.dir);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('RegressionBaselineError');
  });
});

describe('regressionReference', () => {
  it("AC-22 uses the run's first Gate 2 count once one exists, when the baseline is not higher (D-A)", () => {
    expect(regressionReference([record(10), record(7)], { ...validBaseline(), testCount: 9 })).toBe(10);
    expect(regressionReference([record(10), record(7)], undefined)).toBe(10);
  });

  it("IMPORTANT-5 the run's first record contributes the tests that RAN (passed + failed), not its total", () => {
    const withSkipped: ExecutionGateRecord = { ...record(10), passed: 7, failed: 1 };
    expect(regressionReference([withSkipped], undefined)).toBe(8);
  });

  it('AC-65 uses the baseline count for the first evaluation (no prior records)', () => {
    expect(regressionReference([], validBaseline())).toBe(12);
    expect(regressionReference(undefined, validBaseline())).toBe(12);
  });

  it("MINOR-11 after a blocking first Gate 2 evaluation the reference is the baseline, not that evaluation's count", () => {
    const blocking: ExecutionGateRecord = { ...record(0), canAdvance: false };
    expect(regressionReference([blocking], validBaseline())).toBe(12);
    expect(regressionReference([blocking], undefined)).toBeUndefined();
  });

  it('MINOR-11 I-12 the reference is the first PASSING evaluation, even when a blocking one came before it', () => {
    const blocking: ExecutionGateRecord = { ...record(3), passed: 1, failed: 2, passRate: 1 / 3, canAdvance: false };
    expect(regressionReference([blocking, record(10), record(7)], undefined)).toBe(10);
  });

  it('I-12 the reference is the higher of the first passing count and the baseline', () => {
    expect(regressionReference([record(8)], { ...validBaseline(), testCount: 10 })).toBe(10);
    expect(regressionReference([record(10)], { ...validBaseline(), testCount: 8 })).toBe(10);
    expect(regressionReference([record(10)], { ...validBaseline(), testCount: 10 })).toBe(10);
  });

  it('AC-66 is undefined with neither prior records nor a baseline', () => {
    expect(regressionReference([], undefined)).toBeUndefined();
    expect(regressionReference(undefined, undefined)).toBeUndefined();
  });
});

describe('validatorRoundReference (D-A)', () => {
  it('D-A is the higher of the first passing count and the reference recorded on round 0', () => {
    // Round 0 ran 8 against a baseline of 10 (recorded as its reference): the bar stays 10.
    expect(validatorRoundReference([{ ...record(8), referenceCount: 10 }])).toBe(10);
    // Round 0 ran 10 against a baseline of 8: the first passing count is the higher one.
    expect(validatorRoundReference([{ ...record(10), referenceCount: 8 }])).toBe(10);
    // A later round's own reference never feeds back in; only round 0's does.
    expect(validatorRoundReference([{ ...record(9), referenceCount: 9 }, { ...record(9), round: 1, referenceCount: 20 }])).toBe(9);
  });

  it('D-A takes the highest reference of every round-0 record, and only a passing count as the in-run count', () => {
    const blocking: ExecutionGateRecord = { ...record(3), passed: 1, failed: 2, passRate: 1 / 3, canAdvance: false, referenceCount: 12 };
    expect(validatorRoundReference([blocking, { ...record(10), referenceCount: 11 }])).toBe(12);
  });

  it('D-A with no round-0 reference it is the first passing count; with neither it is undefined', () => {
    expect(validatorRoundReference([record(7)])).toBe(7);
    expect(validatorRoundReference([])).toBeUndefined();
    expect(validatorRoundReference(undefined)).toBeUndefined();
  });
});

describe('the baseline writer (AC-65, write side; D-7)', () => {
  /** A run whose Gate 2 evaluations are `records`, in order. */
  function runWith(...records: Array<Omit<ExecutionGateRecord, 'recordedAt'>>): FeatureState {
    let state = createFeatureState('baseline-writer');
    for (const record of records) state = recordExecutionGate(state, record);
    return state;
  }
  const gate2 = (overrides: Partial<ExecutionGateRecord> = {}): Omit<ExecutionGateRecord, 'recordedAt'> => ({
    round: 0,
    total: 12,
    passed: 10,
    failed: 0,
    passRate: 1,
    canAdvance: true,
    ...overrides
  });
  const NOW = '2026-10-04T12:00:00.000Z';

  it('AC-65 baselineFromRun records the run id and the tests that RAN in its latest Gate 2 (passed + failed, never total)', () => {
    const state = runWith(gate2({ passed: 9 }), gate2({ round: 1, total: 15, passed: 11 }));

    expect(baselineFromRun(state, NOW)).toEqual({
      schemaVersion: 1,
      runId: state.featureId,
      testCount: 11,
      recordedAt: NOW
    });
  });

  it.each<[string, FeatureState]>([
    ['has no Gate 2 record', runWith()],
    ['has a latest Gate 2 record that did not pass', runWith(gate2(), gate2({ round: 1, failed: 1, passRate: 10 / 11, canAdvance: false }))]
  ])('AC-65 baselineFromRun refuses a run whose latest Gate 2 did not pass (%s)', (_label, state) => {
    expect(() => baselineFromRun(state, NOW)).toThrow(RegressionBaselineError);
  });

  it('AC-65 baselineFromRun refuses a state file written before executionGateHistory existed', () => {
    const legacy = createFeatureState('legacy');
    delete legacy.executionGateHistory;

    expect(() => baselineFromRun(legacy, NOW)).toThrow(RegressionBaselineError);
  });

  it('AC-65 writeRegressionBaseline writes atomically and round-trips through readRegressionBaseline', () => {
    const baseline = validBaseline();

    const path = writeRegressionBaseline(project.dir, baseline);

    expect(path).toBe(baselineFilePath(project.dir));
    expect(readRegressionBaseline(project.dir)).toEqual(baseline);
    // Atomic: written through a temp file and a rename, which leaves nothing else behind.
    expect(readdirSync(join(project.dir, '.factory'))).toEqual([BASELINE_FILENAME]);

    const next = { ...baseline, runId: 'next-run', testCount: 14 };
    writeRegressionBaseline(project.dir, next);
    expect(readRegressionBaseline(project.dir)).toEqual(next);
  });

  it('AC-65 writeRegressionBaseline refuses an invalid baseline and writes nothing', () => {
    const invalid = { ...validBaseline(), testCount: -1 };

    expect(() => writeRegressionBaseline(project.dir, invalid)).toThrow(RegressionBaselineError);
    expect(existsSync(baselineFilePath(project.dir))).toBe(false);
  });

  it('NEW-MINOR-1 writeRegressionBaseline replaces a symlink at baseline.json instead of writing through it', () => {
    const outside = tempProject('ff-baseline-outside-');
    try {
      const victim = join(outside.dir, 'victim.txt');
      writeFileSync(victim, 'untouched');
      mkdirSync(join(project.dir, '.factory'));
      symlinkSync(victim, baselineFilePath(project.dir));

      writeRegressionBaseline(project.dir, validBaseline());

      expect(readFileSync(victim, 'utf-8')).toBe('untouched');
      expect(readRegressionBaseline(project.dir)).toEqual(validBaseline());
    } finally {
      outside.cleanup();
    }
  });
});
