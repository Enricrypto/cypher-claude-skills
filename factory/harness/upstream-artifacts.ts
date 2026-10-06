/**
 * Which documents each agent reads, and where they are (D-8, AC-24, AC-28).
 *
 * Agents used to get one-line prompts ("Validate implementation against approved story and
 * spec") and were left to go looking. In a project with `.factory/` directories from other runs,
 * looking is how a live Backend Builder found four contradictory "approved" briefs and refused to
 * build. A prompt now carries the absolute path of every upstream document that EXISTS in this
 * run's directory — never one that does not — and the rule that keeps agents out of the archive.
 */

import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

import { FeatureFactoryAgent } from '../runner/agent-registry';

/** Every document an agent may be pointed at, in pipeline order. */
export const UPSTREAM_ARTIFACTS = [
  'RESEARCHER_REPORT.md',
  'USER_STORY.md',
  'TECHNICAL_BRIEF.md',
  'FILE_LIST.md',
  'BACKEND_SUMMARY.md',
  'API_CONTRACT.md',
  'FRONTEND_SUMMARY.md',
  'TEST_REPORT.md',
  'VALIDATION_REPORT.md'
] as const;

export type UpstreamArtifact = typeof UPSTREAM_ARTIFACTS[number];

const PLAN: readonly UpstreamArtifact[] = ['RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md'];
const AFTER_BACKEND: readonly UpstreamArtifact[] = [...PLAN, 'BACKEND_SUMMARY.md', 'API_CONTRACT.md'];
const AFTER_BUILD: readonly UpstreamArtifact[] = [...AFTER_BACKEND, 'FRONTEND_SUMMARY.md'];
const AFTER_TESTS: readonly UpstreamArtifact[] = [...AFTER_BUILD, 'TEST_REPORT.md'];

/**
 * What each agent reads: everything upstream of it (I-7: FILE_LIST.md from 04, VALIDATION_REPORT.md
 * for 08). PR B-2 (D-5): the Validator runs alongside the Test Verifier, so it never gets
 * TEST_REPORT.md (AC-120); the follow-up runs after it and does; a skeptic judges one issue against
 * the story and the brief only.
 */
export const UPSTREAM_FOR_AGENT: Readonly<Record<FeatureFactoryAgent, readonly UpstreamArtifact[]>> = Object.freeze({
  '01-researcher': [],
  '02-story-writer': ['RESEARCHER_REPORT.md'],
  '03-spec-writer': ['RESEARCHER_REPORT.md', 'USER_STORY.md'],
  '04-backend-builder': PLAN,
  '05-frontend-builder': AFTER_BACKEND,
  '06-test-verifier': AFTER_BUILD,
  '07-validator': AFTER_BUILD,
  '07b-validator-followup': AFTER_TESTS,
  '07c-validator-skeptic': ['USER_STORY.md', 'TECHNICAL_BRIEF.md'],
  '08-feature-consolidator': [...AFTER_TESTS, 'VALIDATION_REPORT.md']
});

/**
 * The upstream documents that are actually on disk in this run's directory, as absolute paths,
 * in the order asked. A name whose path is missing — or is not a regular file — is dropped, so a
 * prompt built from this never points an agent at something that is not there.
 */
export function existingUpstreamArtifacts(
  cwd: string,
  artifactDir: string,
  names: readonly UpstreamArtifact[]
): Array<{ name: UpstreamArtifact; absolutePath: string }> {
  const found: Array<{ name: UpstreamArtifact; absolutePath: string }> = [];
  for (const name of names) {
    const absolutePath = resolve(cwd, artifactDir, name);
    try {
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) found.push({ name, absolutePath });
    } catch {
      // Unreadable is the same as absent: do not name it.
    }
  }
  return found;
}

/** Said to every agent in every normal run (AC-28). */
export const ARCHIVE_RULE =
  'Do not read anything under .factory/_archive/ — it holds finished runs and is not part of this run.';

/**
 * Options for runDirectoryRules. `readableRunDir` is the single exception to ARCHIVE_RULE (AC-28,
 * AC-47): under `--consolidate <id>` the Consolidator reads a finished run that may sit in
 * `.factory/_archive/<id>/`. It must be THIS run's directory — an agent may read only its own run.
 */
export interface RunDirectoryRuleOptions {
  readableRunDir?: string;
}

/**
 * The archive rule plus this run's absolute directory, and the instruction to ignore every other one.
 *
 * With `readableRunDir` (consolidate only) the blanket archive rule is NOT emitted — the run being
 * read may itself be archived — and is replaced by a narrower one: that directory is the only one
 * under `.factory/` the agent may read; no other run, archived or live. A `readableRunDir` that is
 * not this run's directory throws: no prompt ever grants another run.
 */
export function runDirectoryRules(cwd: string, artifactDir: string, options: RunDirectoryRuleOptions = {}): string {
  const runDir = resolve(cwd, artifactDir);
  const otherRuns = [
    `Any other directory under .factory/ belongs to an unrelated run — ignore it completely: do not`,
    `read it, do not reconcile it, do not treat it as a revision.`
  ];

  if (options.readableRunDir === undefined) {
    return [ARCHIVE_RULE, `This run's directory is ${runDir}.`, ...otherRuns].join('\n');
  }

  if (resolve(cwd, options.readableRunDir) !== runDir) {
    throw new RangeError(
      `readableRunDir ${options.readableRunDir} is not this run's directory (${runDir}): an agent may read only its own run.`
    );
  }
  const factoryDir = resolve(cwd, '.factory');
  return [
    `This run's directory is ${runDir}. It is the only directory under ${factoryDir} you may read.`,
    `Read nothing else under ${factoryDir}: no other run, live or in ${factoryDir}/_archive/, and no other archived run.`,
    ...otherRuns
  ].join('\n');
}
