/**
 * The one "test path" rule (B-2 D-2, N-3, I-4): which of the files the Test Verifier changed are
 * test files. The Test Verifier's prompt (testVerifierPrompt, agent-prompts.ts) states the same rule
 * from TEST_DIRECTORY_NAMES and TEST_FILE_NAME_PATTERNS; contract 06 does not (D-B2-4: by hand,
 * nothing measures what the Test Verifier changed).
 *
 * A project-relative path, compared in lower case, is a test path when either:
 * - a DIRECTORY segment (never the file name) is one of TEST_DIRECTORY_NAMES; or
 * - the file name matches `*.test.*`, `*.spec.*`, `*.e2e.*`, `*.e2e-spec.*`, `*_test.*`,
 *   `test_*.py` or `*.snap`.
 *
 * `e2e/` is deliberately not a test directory: this repo's `factory/e2e/` is production code.
 * Backslashes are read as separators, and a leading `./` or `/` is ignored (normalisePath).
 */

import { normalisePath } from './stage-context';

/** Directory names that make every path below them a test path. */
export const TEST_DIRECTORY_NAMES: readonly string[] = Object.freeze([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  '__snapshots__',
  '__mocks__'
]);

/** The file-name patterns as the Test Verifier's prompt words them; TEST_FILE_NAMES below is the same list as regexes. */
export const TEST_FILE_NAME_PATTERNS: readonly string[] = Object.freeze([
  '*.test.*',
  '*.spec.*',
  '*.e2e.*',
  '*.e2e-spec.*',
  '*_test.*',
  'test_*.py',
  '*.snap'
]);

/** The file-name patterns, for a lower-case name: `*.test.*`, `*.spec.*`, `*.e2e.*`, `*.e2e-spec.*`, `*_test.*`, `test_*.py`, `*.snap`. */
const TEST_FILE_NAMES: readonly RegExp[] = [/\.(test|spec|e2e|e2e-spec)\./, /_test\./, /^test_.*\.py$/, /\.snap$/];

/** Whether `path` is a test path (N-3). */
export function isTestPath(path: string): boolean {
  const segments = normalisePath(path.replace(/\\/g, '/')).toLowerCase().split('/').filter(segment => segment.length > 0);
  const name = segments.pop();
  if (name === undefined) return false;
  return segments.some(segment => TEST_DIRECTORY_NAMES.includes(segment)) || TEST_FILE_NAMES.some(pattern => pattern.test(name));
}

/** Every path once, in its original order and spelling, on its side of the rule. */
export function splitByTestPath(paths: readonly string[]): { tests: string[]; outside: string[] } {
  const tests: string[] = [];
  const outside: string[] = [];
  for (const path of paths) (isTestPath(path) ? tests : outside).push(path);
  return { tests, outside };
}
