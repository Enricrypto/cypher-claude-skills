/**
 * The regression reference, read side (D-12; AC-22, AC-65 read, AC-66).
 *
 * "No Regressions" used to read a count the Validator typed into its own report. The reference
 * is now the harness's: the run's first Gate 2 count, or — for the first evaluation — the test
 * count a previous successful run left in `.factory/baseline.json`. Nothing writes that file
 * until A-2; this module only reads it, and refuses to guess when it cannot.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  BASELINE_FILENAME,
  RegressionBaseline,
  RegressionBaselineError,
  baselineFilePath,
  readRegressionBaseline,
  regressionReference
} from '../../harness/regression-baseline';
import { ExecutionGateRecord } from '../../harness/state-tracker';
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
  it("AC-22 uses the run's first Gate 2 count once one exists, ignoring the baseline", () => {
    expect(regressionReference([record(10), record(7)], validBaseline())).toBe(10);
  });

  it("IMPORTANT-5 the run's first record contributes the tests that RAN (passed + failed), not its total", () => {
    const withSkipped: ExecutionGateRecord = { ...record(10), passed: 7, failed: 1 };
    expect(regressionReference([withSkipped], validBaseline())).toBe(8);
  });

  it('AC-65 uses the baseline count for the first evaluation (no prior records)', () => {
    expect(regressionReference([], validBaseline())).toBe(12);
    expect(regressionReference(undefined, validBaseline())).toBe(12);
  });

  it('AC-66 is undefined with neither prior records nor a baseline', () => {
    expect(regressionReference([], undefined)).toBeUndefined();
    expect(regressionReference(undefined, undefined)).toBeUndefined();
  });
});
