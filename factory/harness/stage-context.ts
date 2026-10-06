/**
 * Stage Context Builder
 *
 * Assembles the StageContext that canAdvanceStage() judges, from what the agents ACTUALLY
 * produced and what is ACTUALLY on disk.
 *
 * This file exists because the orchestrator used to fabricate it:
 *
 *     metadata: {
 *       filesIdentified: stage === 1 ? 5 : undefined,
 *       testPassRate:    stage === 3 ? 1.0 : undefined,   // <- CRITICAL criterion, hardcoded pass
 *       criticalIssuesCount: stage === 4 ? 0 : undefined,
 *     }
 *
 * Hardcoding testPassRate to 1.0 meant the "unit tests pass" gate could never fail, and
 * criticalIssuesCount to 0 meant the validator gate could never fail. The gates were real code
 * judging invented evidence. Replacing the mocked agent alone would not have fixed that — the
 * context is the other half of the moat, and this is it.
 *
 * Rule enforced here: every value the gates read is derived from an agent's output or read off
 * the filesystem. Nothing is assumed, and nothing defaults to a passing value.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';

import { ExecutionMeasurement, Stage4Metadata, StageContext } from './stage-gates';
import type { ValidationVerdict } from './state-tracker';
import { evaluateSecurityChecks } from './security-checks';
import { HARNESS_RENDERED_ARTIFACTS } from './harness-documents';
import { MAX_BUILDER_ATTEMPTS } from './loop-rules';
import { assertNoFollowWritable, UnsafeArtifactPathError, writeFileNoFollow } from './safe-write';
import { STATE_FILENAME } from './state-store';
import { BASELINE_FILENAME } from './regression-baseline';
import { ARCHIVE_DIRNAME, SUPERSEDED_DIRNAME } from './run-directory';
import {
  ArtifactRef,
  FeatureFactoryAgentOutput,
  ResearcherOutput,
  StoryWriterOutput,
  SpecWriterOutput,
  BackendBuilderOutput,
  FrontendBuilderOutput,
  TestVerifierOutput,
  ValidatorOutput,
  ValidatorFollowupOutput,
  SkepticOutput,
  FeatureConsolidatorOutput
} from './agent-output-schema';

export interface StageOutputs {
  researcher?: ResearcherOutput;
  story?: StoryWriterOutput;
  spec?: SpecWriterOutput;
  backend?: BackendBuilderOutput;
  frontend?: FrontendBuilderOutput;
  test?: TestVerifierOutput;
  validator?: ValidatorOutput;
  /** The follow-up review of the Test Verifier's files (PR B-2): its own slot, never `validator`. */
  validatorFollowup?: ValidatorFollowupOutput;
  /** Transient: one skeptic output, set only to persist its document. Skeptics have no step (D-7). */
  skeptic?: SkepticOutput;
  consolidator?: FeatureConsolidatorOutput;
}

export interface BuildStageContextInput {
  stage: number;
  /** The target project. Artifact paths resolve against this. */
  cwd: string;
  outputs: StageOutputs;
  /**
   * The attempts each builder used in its latest loop, and (`max`) the attempts it was allowed
   * there — MAX_BUILDER_ATTEMPTS plus any grant (AC-72). `max` defaults to MAX_BUILDER_ATTEMPTS.
   */
  loops?: { backend?: number; frontend?: number; max?: { backend?: number; frontend?: number } };
  /**
   * This run's directory, relative to `cwd` (`.factory/<featureId>`). Top-level documents in it
   * are readable by the gates even when no agent claimed them — that is how the harness-rendered
   * TEST_REPORT.md reaches the Stage 4 gate.
   */
  artifactDir?: string;
  /**
   * What the HARNESS measured, passed by the orchestrator and never by an agent (D-5): the latest
   * Gate 2 measurement and the regression reference it is judged against, and (PR B-2) the
   * validation verdict after the skeptics.
   */
  harness?: {
    execution?: ExecutionMeasurement;
    regressionReferenceCount?: number;
    /** PR B-2 (D-12, AC-131): the typed validation verdict the Stage 4 gate reads. */
    validation?: ValidationVerdict;
  };
}

/**
 * Paths are compared as sets, so they must be compared in one canonical form. With `cwd`, an
 * absolute path inside the project becomes project-relative; then a leading `./` and any leading
 * `/` are stripped.
 */
export function normalisePath(path: string, cwd?: string): string {
  let p = path;
  if (cwd && isAbsolute(p)) {
    const root = resolve(cwd);
    const abs = resolve(p);
    if (abs === root || abs.startsWith(root + sep)) p = relative(root, abs);
  }
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * The files the builders claim to have written: what the materialization gate (Gate 1) checks
 * and what the Stage 3 gate reads. ONE implementation, used by the orchestrator and by
 * buildStageContext alike, so the two can never disagree about what was claimed.
 *
 * Only the builders' own `filesModified`. Documents the harness renders (BACKEND_SUMMARY.md and
 * friends) are never claimed files: a gate that checked the harness's own output would prove
 * nothing about the builders.
 */
export function claimedFilesFromBuilders(
  backend?: BackendBuilderOutput,
  frontend?: FrontendBuilderOutput
): ArtifactRef[] {
  const claim = (who: string) => (file: { path: string; description: string }): ArtifactRef => ({
    name: basename(file.path),
    path: file.path,
    description: `${who}: ${file.description}`
  });
  return [
    ...(backend?.details?.filesModified ?? []).map(claim('Backend Builder')),
    ...(frontend?.details?.filesModified ?? []).map(claim('Frontend Builder'))
  ];
}

/**
 * The claimed paths that resolve inside `<cwd>/.factory/` — the harness's own directory.
 *
 * Everything there was written by the harness (run documents, state.json, baseline.json), so a
 * builder claiming such a file would satisfy the materialization gate with the harness's own
 * output: the gate would be verifying its own handiwork. The orchestrator rejects any claim this
 * returns before it checks existence. Paths are resolved (so `src/../.factory/x` counts) but
 * symlinks are not followed. Returned exactly as claimed, so the escalation names what the
 * builder wrote.
 */
export function claimsInsideFactoryDir(claims: ArtifactRef[], cwd: string): string[] {
  // Compared case-insensitively (MINOR-4): on a case-insensitive filesystem (APFS, NTFS by
  // default) `.Factory/x` IS `.factory/x`. Over-matching on a case-sensitive one fails closed.
  const factoryDir = resolve(cwd, '.factory').toLowerCase();
  return claims
    .map(claim => claim.path)
    .filter(path => {
      const absolute = (isAbsolute(path) ? resolve(path) : resolve(cwd, path)).toLowerCase();
      return absolute === factoryDir || absolute.startsWith(factoryDir + sep);
    });
}

const HARNESS_RENDERED: ReadonlySet<string> = new Set(HARNESS_RENDERED_ARTIFACTS);

/** Markers that mean a builder left work unfinished. */
const ABANDONED_MARKERS = /\b(TODO|FIXME|XXX|HACK)\b/g;

/**
 * Agents that may have their artifacts written to disk BY THE HARNESS.
 *
 * These are the read-only agents: they are granted no Write tool, but the gates require their
 * documents to exist on disk. So they return the text in artifact.content and we persist it.
 *
 * The builders are deliberately absent. They write their own files, and the materialization
 * gate then checks those paths against the filesystem. If the harness wrote a builder's files
 * for it, that gate would be verifying its own handiwork and the anti-hallucination guarantee
 * would be worth nothing. A builder that claims a file must have actually written it.
 */
const HARNESS_PERSISTED_AGENTS = new Set([
  '01-researcher',
  '02-story-writer',
  '03-spec-writer',
  '07-validator',
  '07b-validator-followup',
  '07c-validator-skeptic',
  '08-feature-consolidator'
]);

export interface PersistedArtifact {
  agent: string;
  path: string;
}

/**
 * An agent asked the harness to write a document somewhere it must not: a name that is not a
 * plain filename, or (with no run directory) a path that is absolute or escapes the project.
 *
 * Thrown, never skipped. The read-only agents have no Write tool precisely so they cannot touch
 * the filesystem; a document path that tries to leave the run directory is either a malformed
 * output or a prompt injection, and either way the run must stop and say so — silently dropping
 * the document would let the stage proceed on a run dir that is missing what the agent produced.
 *
 * The class lives in safe-write.ts (the no-follow writer throws it too) and is re-exported here,
 * so every existing import keeps working and there is one class, not two.
 */
export { UnsafeArtifactPathError };

/**
 * Write the documents produced by read-only agents to disk, so the gates can read them.
 *
 * MUST be called immediately after each agent returns — not at stage-gate time. The gate runs at
 * the END of a stage, and stage 2 has TWO agents: if we waited, the Spec Writer would execute
 * against a disk with no USER_STORY.md on it and would have to invent the acceptance criteria
 * the builders are then graded against. A live run caught exactly that, and the Spec Writer
 * refused to proceed rather than fabricate them. It was right.
 *
 * `artifactDir` namespaces the output per feature run. Without it, every run writes
 * RESEARCHER_REPORT.md to the repo root and stomps the previous feature's — which a live
 * Researcher noticed and reported about itself.
 *
 * Artifact paths are REWRITTEN in place to the namespaced location, so persistArtifacts() and
 * readArtifactContents() can never disagree about where a document lives.
 *
 * Where a document is written (IMPORTANT-1, IMPORTANT-2):
 *  - With `artifactDir`, ALWAYS `<artifactDir>/<artifact.name>`. The path the agent supplied is
 *    ignored — absolute or relative — so a read-only agent cannot place a file anywhere else, and
 *    the file is saved under the name the gates and the next agent's prompt look it up by.
 *    A `name` that is not a plain filename (contains `/`, `\`, `..`, is absolute, or is `.`/empty)
 *    throws UnsafeArtifactPathError.
 *  - Without `artifactDir` (legacy callers), the agent's path is used only if it is relative and
 *    resolves inside `cwd`; an absolute path, or one that escapes `cwd`, throws.
 *
 * Every artifact is checked BEFORE anything is written, so a refused call leaves no partial
 * output behind. The throw is the fail-closed choice: in the orchestrator it reaches the outer
 * catch and escalates the run, naming the offending artifact.
 */
export function persistArtifacts(
  outputs: StageOutputs,
  cwd: string,
  artifactDir?: string
): PersistedArtifact[] {
  const root = resolve(cwd);
  const planned: Array<{ agent: string; artifact: ArtifactRef; path: string; absolutePath: string }> = [];

  for (const output of Object.values(outputs)) {
    const agentOutput = output as FeatureFactoryAgentOutput | undefined;
    if (!agentOutput?.details?.artifacts) continue;
    if (!HARNESS_PERSISTED_AGENTS.has(agentOutput.agent)) continue;

    for (const artifact of agentOutput.details.artifacts) {
      if (typeof artifact.content !== 'string' || artifact.content.length === 0) continue;

      const path = artifactDir
        ? join(artifactDir, plainArtifactName(agentOutput.agent, artifact.name))
        : legacyArtifactPath(agentOutput.agent, artifact.path);
      const absolutePath = resolve(root, path);

      const container = artifactDir ? resolve(root, artifactDir) : root;
      if (!absolutePath.startsWith(container + sep)) {
        throw new UnsafeArtifactPathError(
          `${agentOutput.agent}: artifact "${artifact.name}" would be written to ${absolutePath}, outside ${container}.`
        );
      }

      // NEW-MINOR-1: no symlinked target, no directory resolving outside the project. Checked
      // here, before anything is written, like every other refusal.
      assertNoFollowWritable(root, absolutePath);

      planned.push({ agent: agentOutput.agent, artifact, path, absolutePath });
    }
  }

  return planned.map(({ agent, artifact, path, absolutePath }) => {
    artifact.path = path;
    writeFileNoFollow(root, absolutePath, artifact.content as string);
    return { agent, path };
  });
}

/** The artifact name, if it is a plain filename; otherwise throw. */
function plainArtifactName(agent: string, name: unknown): string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name === '.' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\0') ||
    isAbsolute(name)
  ) {
    throw new UnsafeArtifactPathError(
      `${agent}: artifact name ${JSON.stringify(name)} is not a plain filename; refusing to write it.`
    );
  }
  if (name.startsWith('.') || RESERVED_ARTIFACT_NAMES.has(name.toLowerCase())) {
    throw new UnsafeArtifactPathError(
      `${agent}: artifact name ${JSON.stringify(name)} is reserved for the harness; refusing to write it.`
    );
  }
  return name;
}

/**
 * Names in a run directory that only the harness writes (NEW-MINOR-2), lower-cased: an agent's
 * document saved under one would overwrite the run's record (state.json), a harness-rendered
 * document, or stand where the harness keeps superseded and archived runs. Compared
 * case-insensitively, because `STATE.JSON` is `state.json` on a case-insensitive filesystem.
 * Hidden names (a leading `.`) are refused too.
 */
const RESERVED_ARTIFACT_NAMES: ReadonlySet<string> = new Set(
  [STATE_FILENAME, BASELINE_FILENAME, ...HARNESS_RENDERED_ARTIFACTS, ARCHIVE_DIRNAME, SUPERSEDED_DIRNAME].map(n => n.toLowerCase())
);

/** Legacy (no run dir): the agent's path, if relative; otherwise throw. Containment is checked by the caller. */
function legacyArtifactPath(agent: string, path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\0')) {
    throw new UnsafeArtifactPathError(
      `${agent}: artifact path ${JSON.stringify(path)} is absolute or empty; without a run directory only paths inside the project are written.`
    );
  }
  return path;
}

/**
 * Read every artifact the agents claimed, keyed by both its declared name and its filename,
 * mapping to the file's CONTENT — because the gates inspect content, not paths
 * (validateACTestable searches the user story's text for Given/When/Then).
 *
 * A claimed file that does not exist is simply absent from the map. That is deliberate: the
 * gate then sees nothing and fails, which is the correct outcome for a hallucinated artifact.
 *
 * With `artifactDir`, the top-level regular files of `<cwd>/<artifactDir>/` are read too, keyed
 * by filename, filling only keys no claimed artifact set. Subdirectories are not descended into.
 *
 * One exception to "claimed wins": for a name in HARNESS_RENDERED_ARTIFACTS, the run-dir file the
 * HARNESS wrote wins over any artifact an agent claimed under that name. The harness renders those
 * documents from the structured output the gates judge; an agent's same-named file cannot stand in
 * for — or overrule — them.
 */
export function readArtifactContents(
  outputs: StageOutputs,
  cwd: string,
  artifactDir?: string
): Record<string, string> {
  const contents: Record<string, string> = {};

  for (const output of Object.values(outputs)) {
    const agentOutput = output as FeatureFactoryAgentOutput | undefined;
    if (!agentOutput?.details?.artifacts) continue;

    for (const artifact of agentOutput.details.artifacts) {
      const absolutePath = isAbsolute(artifact.path)
        ? artifact.path
        : resolve(cwd, artifact.path);

      if (!existsSync(absolutePath)) continue;

      try {
        if (!statSync(absolutePath).isFile()) continue;
        const content = readFileSync(absolutePath, 'utf-8');
        contents[artifact.name] = content;
        contents[basename(absolutePath)] = content;
      } catch {
        // Unreadable is the same as absent, for gate purposes.
      }
    }
  }

  if (artifactDir) {
    const runDir = resolve(cwd, artifactDir);
    if (existsSync(runDir)) {
      for (const entry of readdirSync(runDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (contents[entry.name] !== undefined && !HARNESS_RENDERED.has(entry.name)) continue;
        try {
          contents[entry.name] = readFileSync(join(runDir, entry.name), 'utf-8');
        } catch {
          // Unreadable is the same as absent, for gate purposes.
        }
      }
    }
  }

  return contents;
}

/** Count unfinished-work markers left in the files the builders claim to have written. */
export function countAbandonedMarkers(files: Array<{ path: string }>, cwd: string): number {
  let count = 0;

  for (const file of files) {
    const absolutePath = isAbsolute(file.path) ? file.path : resolve(cwd, file.path);
    if (!existsSync(absolutePath)) continue;

    try {
      if (!statSync(absolutePath).isFile()) continue;
      const matches = readFileSync(absolutePath, 'utf-8').match(ABANDONED_MARKERS);
      count += matches?.length ?? 0;
    } catch {
      // Unreadable — cannot assess; do not invent a passing zero for it either.
    }
  }

  return count;
}

export function buildStageContext(input: BuildStageContextInput): StageContext {
  const { stage, cwd, outputs } = input;

  const artifacts = readArtifactContents(outputs, cwd, input.artifactDir);
  const metadata: Record<string, any> = {};

  // --- Stage 1: what the Researcher actually found -------------------------------------
  if (outputs.researcher) {
    const details = outputs.researcher.details;
    metadata.filesIdentified = details.filesIdentified?.length ?? 0;
    metadata.patternsFound = details.existingPatterns?.length ?? 0;
    metadata.risksIdentified = details.risks ?? [];
  }

  // --- Stage 3: what the builders actually wrote ---------------------------------------
  const { backend, frontend } = outputs;
  if (backend || frontend) {
    const filesModified = [
      ...(backend?.details.filesModified ?? []),
      ...(frontend?.details.filesModified ?? [])
    ];

    metadata.filesModified = filesModified.length;
    metadata.modifiedFiles = filesModified.map(f => normalisePath(f.path, cwd));

    // The approved spec is the contract. Every file it says to CREATE or MODIFY must actually be
    // created or modified — and the gate compares the SETS, not the counts. Comparing counts was
    // a fake gate: "8 of 9" fails, but nine completely different files would have passed.
    //
    // DELETE entries are excluded: a deleted file is, correctly, not in filesModified.
    const expected = (outputs.spec?.details.fileList ?? [])
      .filter(f => f.type !== 'DELETE')
      .map(f => normalisePath(f.path, cwd));

    metadata.expectedFiles = expected;
    metadata.filesExpected = expected.length > 0 ? expected.length : filesModified.length;

    metadata.claimedFiles = claimedFilesFromBuilders(backend, frontend);

    // Real pass rate. Previously hardcoded to 1.0, which made this CRITICAL gate unfailable.
    // With zero tests written, the rate is 0 — "no tests" is not "all tests passed".
    const testsWritten =
      (backend?.details.testing?.testsWritten ?? 0) + (frontend?.details.testing?.testsWritten ?? 0);
    const testsPassed =
      (backend?.details.testing?.testsPassed ?? 0) + (frontend?.details.testing?.testsPassed ?? 0);
    metadata.testPassRate = testsWritten === 0 ? 0 : testsPassed / testsWritten;

    metadata.backendLoops = input.loops?.backend ?? 0;
    metadata.frontendLoops = input.loops?.frontend ?? 0;
    metadata.maxBackendLoops = input.loops?.max?.backend ?? MAX_BUILDER_ATTEMPTS;
    metadata.maxFrontendLoops = input.loops?.max?.frontend ?? MAX_BUILDER_ATTEMPTS;
    metadata.abandonedTODOs = countAbandonedMarkers(filesModified, cwd);
  }

  // --- Stage 4: what the Test Verifier and Validator actually reported ------------------
  // Nothing here defaults to a passing value: a missing input stays undefined and the Stage 4
  // criteria fail closed on it (AC-62).
  const stage4: Stage4Metadata = {};

  if (outputs.test) {
    const acceptance = outputs.test.details.acceptanceTests;
    stage4.acceptanceCriteriaTotalCount = acceptance?.totalAC;
    stage4.acceptanceCriteriaTestedCount = acceptance?.tested;
    stage4.acceptanceCriteriaNotCoverableCount = acceptance?.notCoverable;
  }

  // The denominator comes from the approved story, never from the agent being graded (AC-18).
  if (outputs.story && Array.isArray(outputs.story.details.acceptanceCriteria)) {
    stage4.storyAcceptanceCriteriaCount = outputs.story.details.acceptanceCriteria.length;
  }

  if (outputs.validator) {
    const details = outputs.validator.details;

    // Tri-state, judged against the brief's declared surface (AC-67, AC-68). A false check, an
    // unearned "not_applicable", a missing check and every listed issue each count as one.
    const security = evaluateSecurityChecks(details.security, outputs.spec?.details.securitySurface);
    stage4.securityIssuesCount = security.blockers.length;
    stage4.securityBlockers = security.blockers;

    // details.regressions is deliberately NOT read: "No Regressions" judges the harness's own
    // Gate 2 count below, never a number the Validator reports about the work it is grading.
  }

  // Harness-side: the orchestrator's Gate 2 measurement and the reference it is judged against.
  stage4.executionMeasurement = input.harness?.execution;
  stage4.regressionReferenceCount = input.harness?.regressionReferenceCount;

  // "Validation Passed" reads the harness's typed verdict (D-12, AC-131), never a count from the
  // raw issue list: a CRITICAL both skeptics disproved is still in that list.
  const validation = input.harness?.validation;
  if (validation) {
    stage4.validationVerdict = {
      passed: validation.passed,
      standing: validation.standing.length,
      disproved: validation.disproved.length
    };
  }

  for (const [key, value] of Object.entries(stage4)) {
    if (value !== undefined) metadata[key] = value;
  }

  // --- Stage 5: what the Consolidator actually extracted --------------------------------
  if (outputs.consolidator) {
    const patterns = outputs.consolidator.details.patterns;
    metadata.patternsFound =
      (patterns?.reusedPatterns?.length ?? 0) + (patterns?.newPatterns?.length ?? 0);
  }

  return {
    cwd,
    stageDir: `.factory/stage-${stage}/`,
    artifacts,
    metadata
  };
}
