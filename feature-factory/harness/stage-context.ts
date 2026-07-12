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

import { existsSync, readFileSync, statSync } from 'fs';
import { basename, isAbsolute, resolve } from 'path';

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

/** Markers that mean a builder left work unfinished. */
const ABANDONED_MARKERS = /\b(TODO|FIXME|XXX|HACK)\b/g;

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

    // Expected file count comes from the approved spec. If there is no spec, we cannot claim
    // to know what was expected — fall back to what was written rather than inventing a target
    // the builders are guaranteed to hit.
    metadata.filesExpected = outputs.spec?.details.fileList?.length ?? filesModified.length;

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
    stageDir: `feature-factory/artifacts/stage-${stage}/`,
    artifacts,
    metadata
  };
}
