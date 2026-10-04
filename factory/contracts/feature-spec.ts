/**
 * The Spec Contract — the seam between Tier 1 (product/architecture) and Tier 2 (this pipeline).
 *
 * NO NEW SCHEMA IS AUTHORED HERE.
 *
 * The original design doc called the spec contract "the keystone — build this FIRST" and
 * proposed drafting a fresh Markdown template plus a JSON schema. That would have been a
 * mistake. The contract already exists: `ResearcherOutput`, `StoryWriterOutput` and
 * `SpecWriterOutput` in harness/agent-output-schema.ts. `StoryWriterOutput` already carries
 * acceptance criteria as `{id, given, when, then, priority, testable}` — the exact
 * Given/When/Then structure a Decomposer would need to emit.
 *
 * So a Tier 1 Decomposer's job is not "produce a new artifact that Tier 2 must learn to read."
 * It is "produce the same objects Tier 2's own stages 1 and 2 already produce."
 *
 * That reframe is what makes Tier 1 OPTIONAL, which is the invariant this whole file exists to
 * protect:
 *
 *     Feature Factory must remain runnable standalone on an existing project,
 *     with no Tier 1 artifacts, at every single commit.
 *
 * And it is what makes Tier 1 SWAPPABLE. A Decomposer, a human writing YAML, gstack, or
 * whatever ships next can produce these objects. Tier 2 neither knows nor cares who wrote them
 * — only whether the gate passed.
 *
 * THE GATE IS THE CONTRACT. `acceptFeatureSpec()` below validates a supplied spec with the
 * *same* `canAdvanceStage` the orchestrator runs on its own agents' output. There is one
 * validator, so the producer and the consumer cannot drift apart.
 */

import {
  ResearcherOutput,
  StoryWriterOutput,
  SpecWriterOutput,
  validateOutputSchema
} from '../harness/agent-output-schema';

import { canAdvanceStage, stageContracts } from '../harness/stage-gates';
import { buildStageContext, persistArtifacts, StageOutputs } from '../harness/stage-context';

/**
 * One feature, planned upstream and ready for Tier 2 to build.
 *
 * `researcher` is optional: a Tier 1 Architect working from a TRD may know the story and the
 * technical brief without having mapped an existing codebase (there may not BE one yet, on a
 * greenfield build). When it is absent, Tier 2 runs its own Researcher and then checks the
 * supplied story and spec against the result.
 */
export interface FeatureSpec {
  featureName: string;
  featureDescription: string;

  researcher?: ResearcherOutput;
  story: StoryWriterOutput;
  spec: SpecWriterOutput;

  /** Names of other features that must be built before this one. */
  dependsOn?: string[];
}

/** Tier 1's total output: N specs plus the order they must be built in. */
export interface FeaturePlan {
  features: FeatureSpec[];
}

export interface SpecAcceptance {
  accepted: boolean;
  /** Which stages the supplied spec already satisfies, so Tier 2 can skip them. */
  satisfies: { stage1: boolean; stage2: boolean };
  blockers: string[];
  passRate: number;
}

/**
 * Decide whether a pre-supplied spec is good enough to skip Tier 2's own planning stages.
 *
 * This runs the real gates. A spec that a Decomposer *asserts* is complete but that cannot pass
 * `canAdvanceStage(2, ...)` is rejected — the same way Tier 2's own Story Writer would be
 * rejected for producing a story with untestable criteria. Being upstream buys no leniency.
 */
export async function acceptFeatureSpec(
  featureSpec: FeatureSpec,
  cwd: string
): Promise<SpecAcceptance> {
  const blockers: string[] = [];

  // 1. Does each supplied output even conform to its agent's schema?
  const schemaChecks: Array<[string, any]> = [
    ['02-story-writer', featureSpec.story],
    ['03-spec-writer', featureSpec.spec]
  ];
  if (featureSpec.researcher) {
    schemaChecks.unshift(['01-researcher', featureSpec.researcher]);
  }

  for (const [agent, output] of schemaChecks) {
    if (!output) {
      blockers.push(`Spec is missing the ${agent} output.`);
      continue;
    }
    const stage = agent === '01-researcher' ? 1 : 2;
    const validation = validateOutputSchema(stage, agent, output);
    if (!validation.valid) {
      blockers.push(...validation.errors.map(e => `${agent}: ${e}`));
    }
  }

  if (blockers.length > 0) {
    return { accepted: false, satisfies: { stage1: false, stage2: false }, blockers, passRate: 0 };
  }

  // 2. Write the supplied documents to disk, so the gates have real evidence to read.
  //    (validateACTestable searches USER_STORY.md's TEXT for Given/When/Then — a spec whose
  //    story object looks fine but whose document says nothing testable is still rejected.)
  const outputs: StageOutputs = {
    researcher: featureSpec.researcher,
    story: featureSpec.story,
    spec: featureSpec.spec
  };
  persistArtifacts(outputs, cwd);

  // 3. Run the real gates — the same ones the orchestrator runs on its own agents.
  const stage1Ok = featureSpec.researcher
    ? (await canAdvanceStage(1, stageContracts[1], buildStageContext({ stage: 1, cwd, outputs })))
    : null;

  const stage2Decision = await canAdvanceStage(
    2,
    stageContracts[2],
    buildStageContext({ stage: 2, cwd, outputs })
  );

  if (stage1Ok && !stage1Ok.canAdvance) {
    blockers.push(...stage1Ok.blockers);
  }
  if (!stage2Decision.canAdvance) {
    blockers.push(...stage2Decision.blockers);
  }

  return {
    accepted: blockers.length === 0,
    satisfies: {
      stage1: stage1Ok !== null && stage1Ok.canAdvance,
      stage2: stage2Decision.canAdvance
    },
    blockers,
    passRate: stage2Decision.passRate
  };
}

/**
 * Order features so that every feature's dependencies are built before it.
 *
 * Features with no dependency edge between them are exactly the ones that can be built in
 * parallel — which is what Phase 3's worktree parallelism will consume.
 *
 * Throws on a cycle rather than silently picking an order. A dependency cycle in a plan is a
 * Tier 1 bug, and a build order invented to paper over it would fail confusingly much later.
 */
export function buildOrder(features: FeatureSpec[]): FeatureSpec[] {
  const byName = new Map(features.map(f => [f.featureName, f]));
  const ordered: FeatureSpec[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  function visit(feature: FeatureSpec, path: string[]): void {
    if (done.has(feature.featureName)) return;

    if (visiting.has(feature.featureName)) {
      throw new Error(
        `Dependency cycle in the feature plan: ${[...path, feature.featureName].join(' -> ')}`
      );
    }

    visiting.add(feature.featureName);

    for (const dependency of feature.dependsOn ?? []) {
      const dep = byName.get(dependency);
      if (!dep) {
        throw new Error(
          `Feature "${feature.featureName}" depends on "${dependency}", which is not in the plan.`
        );
      }
      visit(dep, [...path, feature.featureName]);
    }

    visiting.delete(feature.featureName);
    done.add(feature.featureName);
    ordered.push(feature);
  }

  for (const feature of features) {
    visit(feature, []);
  }

  return ordered;
}

/** Features that share no dependency edge and can therefore be built concurrently. */
export function parallelBatches(features: FeatureSpec[]): FeatureSpec[][] {
  const ordered = buildOrder(features);
  const batches: FeatureSpec[][] = [];
  const built = new Set<string>();

  let remaining = [...ordered];
  while (remaining.length > 0) {
    const ready = remaining.filter(f => (f.dependsOn ?? []).every(d => built.has(d)));

    // buildOrder() already proved the graph is acyclic, so `ready` cannot be empty here.
    batches.push(ready);
    ready.forEach(f => built.add(f.featureName));
    remaining = remaining.filter(f => !built.has(f.featureName));
  }

  return batches;
}
