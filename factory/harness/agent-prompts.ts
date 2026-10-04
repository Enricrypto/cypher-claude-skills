/**
 * Every agent's prompt, in one place (D-8).
 *
 * The orchestrator sequences; this module says what each agent is told. Every prompt for 01..08:
 *   - names the absolute run-dir path of each upstream document that EXISTS for that agent
 *     (UPSTREAM_FOR_AGENT, filtered by existingUpstreamArtifacts) — never one that does not (AC-24);
 *   - carries runDirectoryRules: the archive rule (AC-28) and this run's directory. The one
 *     exception is `--consolidate` (AC-47): 08 is told its run's directory, possibly archived,
 *     is the only one it may read.
 *
 * Prompts are built at invocation time, so "exists" means "exists when the agent starts".
 */

import { resolve } from 'path';

import { getRemediationInstruction } from './error-categories';
import {
  existingUpstreamArtifacts,
  runDirectoryRules,
  RunDirectoryRuleOptions,
  UPSTREAM_FOR_AGENT,
  UpstreamArtifact
} from './upstream-artifacts';
import { stateFilePathIn } from './state-store';
import { FeatureFactoryAgent } from '../runner/agent-registry';
import { ValidatorIssue } from './agent-output-schema';
import { describeIssue } from './validator-routing';
import { MAX_BUILDER_ATTEMPTS } from './loop-rules';

/** What every prompt builder needs to know about the run. */
export interface PromptContext {
  /** The target project. */
  cwd: string;
  /** This run's directory, relative to `cwd` (`.factory/<featureId>`). */
  artifactDir: string;
  featureDescription: string;
}

/**
 * Why the builder is being invoked again: the previous attempt's test or schema failure, its own
 * verdict that it did not finish (`status`: FAIL or LOOP_BACK with a valid envelope, MINOR-6), or —
 * for a validator round (D-9) — the Validator's CRITICAL issues in files this builder owns.
 */
export type BuilderFailure =
  | { kind: 'test'; error: string }
  | { kind: 'schema'; error: string }
  | { kind: 'status'; error: string }
  | ValidatorRoundFailure;

/** The CRITICAL issues routed to this builder in validator round `round` of `maxRounds`. */
export type ValidatorRoundFailure = { kind: 'validator'; round: number; maxRounds: number; issues: ValidatorIssue[] };

/**
 * What a builder is told in a validator round, from the round's FIRST attempt. The build itself
 * passed; the Validator then found these problems in files this builder wrote. Fix them, not
 * the whole feature.
 */
export function validatorBriefing(failure: ValidatorRoundFailure): string {
  return [
    `Validator round ${failure.round} of ${failure.maxRounds}. Your earlier build passed its tests, then the`,
    `Validator found these CRITICAL issues in files you own. Fix exactly these; do not start over and`,
    `do not change unrelated code:`,
    ``,
    ...failure.issues.map(issue => `  - ${describeIssue(issue)}`)
  ].join('\n');
}

/**
 * Tell a retrying builder what went wrong last time.
 *
 * Every builder attempt is a FRESH agent invocation — new context, no transcript of the attempt
 * before it. The only thing carrying information across that boundary is this prompt, and it
 * used to carry almost none:
 *
 *     "This is attempt 2 of 3. A previous attempt failed — fix it, do not start over."
 *
 * Which failed? How? The harness knew. analyzeError() had already classified the failure into a
 * category and a fixClass with a confidence score, and getRemediationInstruction() had existed
 * all along to format exactly this briefing — imported by the orchestrator and never once called.
 * The classification went into the state record and nowhere else.
 *
 * So attempt 2 began blind, and its first move was necessarily to re-run the suite to rediscover
 * what attempt 1 had already discovered AND classified. Up to six full agent contexts per run,
 * each re-paying the contract and re-reading four artifacts, to re-derive a known answer.
 *
 * This is the dashed line in the recovery loop — FAIL · RETURN THE EXACT GAP · RETRY WITH A
 * BOUND. The bound was real (three attempts, then MAX_LOOPS). The exact gap was being dropped
 * on the floor.
 */
export function retryBriefing(attempt: number, failure?: BuilderFailure, maxAttempts: number = MAX_BUILDER_ATTEMPTS): string {
  // A validator round is briefed from attempt 1, by validatorBriefing — not as a retry.
  if (failure?.kind === 'validator') return validatorBriefing(failure);
  if (attempt <= 1) return '';

  // `maxAttempts` is the budget this loop is allowed: MAX_BUILDER_ATTEMPTS plus any grant (AC-72).
  const header = `This is attempt ${attempt} of ${maxAttempts}. Do not start over — fix what is named below.`;

  if (!failure) {
    // No classified cause. Say so plainly rather than implying a diagnosis we do not have.
    return `${header}\nThe previous attempt failed, but the harness could not classify why.`;
  }

  if (failure.kind === 'schema') {
    return [
      header,
      ``,
      `The previous attempt produced work but returned a MALFORMED result envelope, so the`,
      `harness could not read it. The code may be fine; the output contract was not met:`,
      ``,
      `    ${failure.error}`,
      ``,
      `Put your findings in the STRUCTURED FIELDS this time, not only in \`summary\`.`
    ].join('\n');
  }

  if (failure.kind === 'status') {
    // MINOR-6: the builder itself said the attempt was not done. Its words are the only diagnosis.
    return [
      header,
      ``,
      `The previous attempt did not report the work as done. It returned a valid result envelope`,
      `with a status other than PASS, and said:`,
      ``,
      `    ${failure.error}`,
      ``,
      `Finish that work. Return PASS only when it is done; if it cannot be done, return ESCALATE and say why.`
    ].join('\n');
  }

  return [
    header,
    ``,
    `The previous attempt left a failing test. The harness has ALREADY classified it — fix`,
    `exactly this, and do not re-run the full suite merely to rediscover it:`,
    ``,
    getRemediationInstruction(failure.error)
  ].join('\n');
}

/**
 * Why an agent is producing its work AGAIN after a human or a gate did not accept it (D-5, D-B):
 * what refused it (a checkpoint's name, or a gate), the notes (a reviewer's words, or the gate's
 * reason), and the absolute paths of the rejected version.
 */
export interface CheckpointRework {
  checkpointName: string;
  notes: string;
  rejectedPaths: string[];
}

/**
 * The rework briefing (AC-75). The re-run agent is a fresh context: this is the only place it
 * learns that its earlier version was refused, why, and where that version is. Every line of the
 * notes is quoted as given; empty notes (a TTY rejection may have none) are said to be empty
 * rather than left out.
 */
export function checkpointReworkBriefing(rework: CheckpointRework): string {
  const notes = typeof rework.notes === 'string' ? rework.notes : '';
  return [
    `REWORK: ${rework.checkpointName} did not accept the previous version. Produce a new version that`,
    `addresses the notes below. Read the rejected version first and keep what was not objected to.`,
    ``,
    `Notes:`,
    ...(notes.trim() === '' ? ['  (no notes were given)'] : notes.split(/\r?\n/).map(line => `  > ${line}`)),
    ...(rework.rejectedPaths.length > 0
      ? [
          ``,
          `The rejected version (absolute paths; for reference only — it is NOT approved):`,
          ...rework.rejectedPaths.map(path => `  - ${path}`)
        ]
      : [])
  ].join('\n');
}

/** Optional extras for builderPrompt. */
export interface BuilderPromptOptions {
  /** The attempts this loop is allowed; defaults to MAX_BUILDER_ATTEMPTS. */
  attemptsAllowed?: number;
  /** Set during a CP3 rework (D-5): briefed on every attempt of the rework. */
  rework?: CheckpointRework;
}

/** How a document is described when it is listed in a prompt. */
const DESCRIPTION: Readonly<Record<UpstreamArtifact, string>> = {
  'RESEARCHER_REPORT.md': 'researcher report',
  'USER_STORY.md': 'approved user story',
  'TECHNICAL_BRIEF.md': 'approved technical brief',
  'FILE_LIST.md': 'file list',
  'BACKEND_SUMMARY.md': "backend summary, harness-generated from 04-backend-builder's structured output",
  'API_CONTRACT.md': "API contract, harness-generated from 04-backend-builder's structured output",
  'FRONTEND_SUMMARY.md': "frontend summary, harness-generated from 05-frontend-builder's structured output",
  'TEST_REPORT.md': "test report, harness-generated from 06-test-verifier's structured output",
  'VALIDATION_REPORT.md': "validation report, 07-validator's own document"
};

/** The documents marked harness-generated above. */
const HARNESS_GENERATED: ReadonlySet<UpstreamArtifact> = new Set<UpstreamArtifact>([
  'BACKEND_SUMMARY.md',
  'API_CONTRACT.md',
  'FRONTEND_SUMMARY.md',
  'TEST_REPORT.md'
]);

function existingFor(ctx: PromptContext, agent: FeatureFactoryAgent) {
  return existingUpstreamArtifacts(ctx.cwd, ctx.artifactDir, UPSTREAM_FOR_AGENT[agent]);
}

/** "Upstream documents for this run" followed by one line per document that exists. */
function upstreamSection(ctx: PromptContext, agent: FeatureFactoryAgent): string[] {
  const found = existingFor(ctx, agent);
  if (found.length === 0) {
    return [`No upstream document exists in this run's directory yet.`];
  }
  return [
    `Upstream documents for this run (absolute paths; each exists now — read them before you start):`,
    ...found.map(({ name, absolutePath }) => `  - ${name} (${DESCRIPTION[name]}): ${absolutePath}`)
  ];
}

/** Said whenever a harness-generated document is among an agent's inputs. */
function harnessGeneratedNote(ctx: PromptContext, agent: FeatureFactoryAgent): string[] {
  if (!existingFor(ctx, agent).some(a => HARNESS_GENERATED.has(a.name))) return [];
  return [
    ``,
    `Documents marked harness-generated were rendered by the harness from that agent's structured`,
    `output. They record what the agent REPORTED; they are not the agent's own document and not`,
    `evidence that the work is correct. Verify every claim against the code on disk.`
  ];
}

function withRules(ctx: PromptContext, lines: string[], rules: RunDirectoryRuleOptions = {}): string {
  return [...lines, ``, runDirectoryRules(ctx.cwd, ctx.artifactDir, rules)].join('\n');
}

export function researcherPrompt(ctx: PromptContext): string {
  return withRules(ctx, [`Analyze the codebase for feature: "${ctx.featureDescription}"`]);
}

/** The rework briefing as a prompt section, or nothing. */
function reworkSection(rework?: CheckpointRework): string[] {
  return rework ? [``, checkpointReworkBriefing(rework)] : [];
}

/** `rework`: set when the story is produced again after CP1 rejected it or a gate refused it (D-5, D-B). */
export function storyPrompt(ctx: PromptContext, rework?: CheckpointRework): string {
  return withRules(ctx, [
    `Write the user story for: "${ctx.featureDescription}".`,
    ``,
    ...upstreamSection(ctx, '02-story-writer'),
    ...reworkSection(rework),
    ``,
    `Write your USER_STORY.md into artifacts[].content; the harness will persist it for you.`
  ]);
}

/** `rework`: set when the brief is produced again after CP2 rejected it or a gate refused it (D-5, D-B). */
export function specPrompt(ctx: PromptContext, rework?: CheckpointRework): string {
  return withRules(ctx, [
    `Write the technical brief for the approved user story.`,
    ``,
    ...upstreamSection(ctx, '03-spec-writer'),
    ``,
    `Read ALL of them before you start; the acceptance criteria in the story are what the builders`,
    `will be graded against, so do not invent them.`,
    ...reworkSection(rework),
    ``,
    `Write your TECHNICAL_BRIEF.md and FILE_LIST.md into artifacts[].content.`
  ]);
}

/** The builder's lines keep their original wording; the brief comes first. */
const BUILDER_LABEL: Readonly<Partial<Record<UpstreamArtifact, string>>> = {
  'TECHNICAL_BRIEF.md': 'THE APPROVED BRIEF IS:',
  'USER_STORY.md': 'The approved user story is:',
  'FILE_LIST.md': 'The file list is:',
  'RESEARCHER_REPORT.md': 'The researcher report is:',
  'BACKEND_SUMMARY.md': 'The backend summary (harness-generated) is:',
  'API_CONTRACT.md': 'The API contract (harness-generated) is:'
};
const BUILDER_ORDER: readonly UpstreamArtifact[] = [
  'TECHNICAL_BRIEF.md',
  'USER_STORY.md',
  'FILE_LIST.md',
  'RESEARCHER_REPORT.md',
  'BACKEND_SUMMARY.md',
  'API_CONTRACT.md'
];

/**
 * Point the builder at ITS OWN approved brief.
 *
 * The prompt used to be "Implement backend for approved spec" — with no path. Meanwhile
 * .factory/ accumulates one directory per run. A live Backend Builder read the project, found
 * FOUR technical briefs for the same feature from four different runs, all still saying "reply
 * 'approved' when ready", and refused to write any code:
 *
 *     "No spec in this repo is approved... 'Newest wins' is not a safe inference: these are
 *      parallel runs, not revisions of one another."
 *
 * It was right. An agent cannot implement an approved spec if nothing tells it which spec is
 * approved.
 */
export function builderPrompt(
  ctx: PromptContext,
  half: 'backend' | 'frontend',
  attempt: number,
  previousFailure?: BuilderFailure,
  /**
   * Set during a validator round (D-9): briefed on every attempt of the round. `attempt` and
   * `previousFailure` then count and describe the attempts WITHIN the round, so attempts 2–3 also
   * carry the usual test/schema briefing.
   */
  validatorRound?: ValidatorRoundFailure,
  /**
   * `attemptsAllowed`: the attempts this loop is allowed (MAX_BUILDER_ATTEMPTS plus any grant,
   * AC-72). `rework`: a CP3 rework (D-5), briefed on every attempt; `attempt` and
   * `previousFailure` then count and describe the attempts within the rework.
   */
  options: BuilderPromptOptions = {}
): string {
  const agent: FeatureFactoryAgent = half === 'backend' ? '04-backend-builder' : '05-frontend-builder';
  const found = existingFor(ctx, agent).sort(
    (a, b) => BUILDER_ORDER.indexOf(a.name) - BUILDER_ORDER.indexOf(b.name)
  );
  const hasApiContract = found.some(a => a.name === 'API_CONTRACT.md');

  return [
    `Implement the ${half} for the APPROVED technical brief of this feature.`,
    ``,
    ...(found.length > 0
      ? found.map(({ name, absolutePath }) => `${BUILDER_LABEL[name] ?? `${name}:`} ${absolutePath}`)
      : [`No upstream document exists in this run's directory yet.`]),
    ``,
    `Those files, and ONLY those, are the approved plan.`,
    runDirectoryRules(ctx.cwd, ctx.artifactDir),
    ...harnessGeneratedNote(ctx, agent),
    ``,
    half === 'frontend'
      ? hasApiContract
        ? `The backend is already built. Consume its API contract (listed above); do not invent endpoints.`
        : `The backend is already built. Consume its API contract; do not invent endpoints.`
      : `Your scope ends at the API contract. Do not touch frontend files.`,
    ...(validatorRound ? [``, validatorBriefing(validatorRound)] : []),
    ...reworkSection(options.rework),
    ``,
    retryBriefing(attempt, previousFailure, options.attemptsAllowed)
  ].join('\n');
}

export function testVerifierPrompt(ctx: PromptContext): string {
  return withRules(ctx, [
    `Write and run acceptance tests for the implemented feature: "${ctx.featureDescription}".`,
    `Cover every acceptance criterion in the approved user story.`,
    ``,
    ...upstreamSection(ctx, '06-test-verifier'),
    ...harnessGeneratedNote(ctx, '06-test-verifier'),
    ``,
    `The harness renders TEST_REPORT.md from your structured output (acceptanceTests, testExecution,`,
    `issues). Do not write a TEST_REPORT.md yourself: report in the structured fields — they are`,
    `what the Stage 4 gate judges.`
  ]);
}

export function validatorPrompt(ctx: PromptContext): string {
  return withRules(ctx, [
    `Validate the implementation of "${ctx.featureDescription}" against the approved user story and`,
    `technical brief.`,
    ``,
    ...upstreamSection(ctx, '07-validator'),
    ...harnessGeneratedNote(ctx, '07-validator'),
    ``,
    `Write your VALIDATION_REPORT.md into artifacts[].content; the harness writes it into this run's`,
    `directory.`
  ]);
}

/** Options for the Consolidator's prompt (D-10). */
export interface ConsolidatorPromptOptions {
  /**
   * `--consolidate <id>`: the finished run's own directory — possibly under `.factory/_archive/` —
   * named as the only directory the Consolidator may read (AC-28 exception, AC-47).
   */
  readableRunDir?: string;
}

/**
 * The Consolidator reads a FINISHED run: its documents, and its state.json for the per-agent
 * timings the harness recorded (D-13) — never an estimate.
 */
export function consolidatorPrompt(ctx: PromptContext, options: ConsolidatorPromptOptions = {}): string {
  const runDir = resolve(ctx.cwd, ctx.artifactDir);
  return withRules(
    ctx,
    [
      `Consolidate feature execution and extract reusable patterns for: "${ctx.featureDescription}".`,
      ``,
      ...upstreamSection(ctx, '08-feature-consolidator'),
      ``,
      `Per-agent timings: ${stateFilePathIn(runDir)}. Its \`agentInvocations\` list records every agent`,
      `invocation of this run (stage, agent, startedAt, completedAt, durationMs). Report times from it;`,
      `do not estimate them.`,
      ``,
      `Those documents and that state.json are your only inputs. Do not look for records of this feature anywhere else.`,
      ``,
      `Return CONSOLIDATION_REPORT.md and PATTERNS.md in artifacts[].content; the harness will persist them in this run's directory.`
    ],
    { readableRunDir: options.readableRunDir }
  );
}
