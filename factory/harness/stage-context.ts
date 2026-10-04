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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';

import { StageContext } from './stage-gates';
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
  consolidator?: FeatureConsolidatorOutput;
}

export interface BuildStageContextInput {
  stage: number;
  /** The target project. Artifact paths resolve against this. */
  cwd: string;
  outputs: StageOutputs;
  loops?: { backend?: number; frontend?: number };
  knowledgeStored?: boolean;
}

/** Paths are compared as sets, so they must be compared in one canonical form. */
function normalise(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}

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
  '08-feature-consolidator'
]);

export interface PersistedArtifact {
  agent: string;
  path: string;
}

/**
 * Remove artifact directories from previous runs.
 *
 * Artifacts are namespaced per run (.factory/<featureId>/), which stops one feature's documents
 * overwriting another's. But nothing removed the old directories, so they accumulated inside the
 * project the agents READ.
 *
 * A live Backend Builder found FOUR technical briefs for the same feature, from four separate
 * runs, every one of them still saying "reply 'approved' when ready to continue" — and refused
 * to write any code:
 *
 *     "No spec in this repo is approved... 'Newest wins' is not a safe inference: these are
 *      parallel runs, not revisions of one another."
 *
 * It was right to refuse. The harness had littered the workspace with contradictory instructions
 * and then asked an agent to act on "the approved spec".
 *
 * The current run's directory is preserved; every other one is removed.
 */
export function clearStaleArtifacts(cwd: string, keepFeatureId: string): string[] {
  const factoryDir = resolve(cwd, '.factory');
  if (!existsSync(factoryDir)) return [];

  const removed: string[] = [];

  for (const entry of readdirSync(factoryDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keepFeatureId) continue;
    rmSync(join(factoryDir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }

  return removed;
}

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
 */
export function persistArtifacts(
  outputs: StageOutputs,
  cwd: string,
  artifactDir?: string
): PersistedArtifact[] {
  const written: PersistedArtifact[] = [];

  for (const output of Object.values(outputs)) {
    const agentOutput = output as FeatureFactoryAgentOutput | undefined;
    if (!agentOutput?.details?.artifacts) continue;
    if (!HARNESS_PERSISTED_AGENTS.has(agentOutput.agent)) continue;

    for (const artifact of agentOutput.details.artifacts) {
      if (typeof artifact.content !== 'string' || artifact.content.length === 0) continue;

      if (artifactDir && !isAbsolute(artifact.path)) {
        artifact.path = join(artifactDir, basename(artifact.path));
      }

      const absolutePath = isAbsolute(artifact.path)
        ? artifact.path
        : resolve(cwd, artifact.path);

      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, artifact.content, 'utf-8');
      written.push({ agent: agentOutput.agent, path: artifact.path });
    }
  }

  return written;
}

/**
 * Read every artifact the agents claimed, keyed by both its declared name and its filename,
 * mapping to the file's CONTENT — because the gates inspect content, not paths
 * (validateACTestable searches the user story's text for Given/When/Then).
 *
 * A claimed file that does not exist is simply absent from the map. That is deliberate: the
 * gate then sees nothing and fails, which is the correct outcome for a hallucinated artifact.
 */
export function readArtifactContents(
  outputs: StageOutputs,
  cwd: string
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

  const artifacts = readArtifactContents(outputs, cwd);
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
    metadata.modifiedFiles = filesModified.map(f => normalise(f.path));

    // The approved spec is the contract. Every file it says to CREATE or MODIFY must actually be
    // created or modified — and the gate compares the SETS, not the counts. Comparing counts was
    // a fake gate: "8 of 9" fails, but nine completely different files would have passed.
    //
    // DELETE entries are excluded: a deleted file is, correctly, not in filesModified.
    const expected = (outputs.spec?.details.fileList ?? [])
      .filter(f => f.type !== 'DELETE')
      .map(f => normalise(f.path));

    metadata.expectedFiles = expected;
    metadata.filesExpected = expected.length > 0 ? expected.length : filesModified.length;

    metadata.claimedFiles = filesModified.map(
      (file): ArtifactRef => ({
        name: basename(file.path),
        path: file.path,
        description: file.description
      })
    );

    // Real pass rate. Previously hardcoded to 1.0, which made this CRITICAL gate unfailable.
    // With zero tests written, the rate is 0 — "no tests" is not "all tests passed".
    const testsWritten =
      (backend?.details.testing?.testsWritten ?? 0) + (frontend?.details.testing?.testsWritten ?? 0);
    const testsPassed =
      (backend?.details.testing?.testsPassed ?? 0) + (frontend?.details.testing?.testsPassed ?? 0);
    metadata.testPassRate = testsWritten === 0 ? 0 : testsPassed / testsWritten;

    metadata.backendLoops = input.loops?.backend ?? 0;
    metadata.frontendLoops = input.loops?.frontend ?? 0;
    metadata.abandonedTODOs = countAbandonedMarkers(filesModified, cwd);
  }

  // --- Stage 4: what the Test Verifier and Validator actually reported ------------------
  if (outputs.test) {
    const acceptance = outputs.test.details.acceptanceTests;
    metadata.acceptanceCriteriaTotalCount = acceptance?.totalAC ?? 0;
    metadata.acceptanceCriteriaTestedCount = acceptance?.tested ?? 0;
  }

  if (outputs.validator) {
    const details = outputs.validator.details;

    metadata.criticalIssuesCount =
      details.issues?.filter(issue => issue.severity === 'CRITICAL').length ?? 0;

    // A security check that is false IS a security issue — the booleans are the findings, so a
    // clean `issues` array does not mean a clean security posture.
    const security = details.security;
    const failedSecurityChecks = security
      ? [
          security.authImplemented,
          security.inputValidated,
          security.noHardcodedSecrets,
          security.sqlInjectionProtected,
          security.xssProtected
        ].filter(passed => passed === false).length
      : 0;

    metadata.securityIssuesCount = failedSecurityChecks + (security?.issues?.length ?? 0);
    metadata.regressionCount = details.regressions?.count ?? 0;
  }

  // --- Stage 5: what the Consolidator actually extracted --------------------------------
  if (outputs.consolidator) {
    const patterns = outputs.consolidator.details.patterns;
    metadata.patternsFound =
      (patterns?.reusedPatterns?.length ?? 0) + (patterns?.newPatterns?.length ?? 0);
    metadata.knowledgeStored = input.knowledgeStored ?? false;
  }

  return {
    cwd,
    stageDir: `.factory/stage-${stage}/`,
    artifacts,
    metadata
  };
}
