/**
 * The Spec Contract — the Tier 1 ↔ Tier 2 seam.
 *
 * Three properties are asserted here, and they are the entire reason the seam exists:
 *
 *   1. FEATURE FACTORY STAYS STANDALONE. With no spec supplied, the orchestrator runs its own
 *      Researcher / Story Writer / Spec Writer — the identical path it always has. Tier 1 is
 *      optional, and this is the invariant that must hold at every commit.
 *
 *   2. THE GATE IS THE CONTRACT. A supplied spec is validated by the SAME canAdvanceStage() the
 *      Story Writer's own output goes through. Being upstream buys no leniency.
 *
 *   3. A BAD SPEC ESCALATES — it does not silently fall back to re-planning. If Tier 2 quietly
 *      re-did the work, a broken Decomposer would look like it worked.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

import { acceptFeatureSpec, buildOrder, parallelBatches } from '../../contracts/feature-spec';
import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation } from '../../runner/invoke-agent';
import { featureSpec, placeholder } from '../fixtures/agent-outputs';
import { tempProject, TempProject } from '../fixtures/harness-run';
import { fakeChangeTracker } from '../fixtures/changes';

let project: TempProject;
let projectDir: string;

beforeEach(() => {
  project = tempProject('ff-seam-');
  projectDir = project.dir;
});

afterEach(() => {
  project.cleanup();
});

/** Records which agents ran; every output is a schema-invalid placeholder. */
function recordingInvoker(invoked: string[]) {
  return async (call: AgentInvocation) => {
    invoked.push(call.agent);
    return placeholder(call.stage, call.agent);
  };
}

describe('acceptFeatureSpec — the gate IS the contract', () => {
  it('accepts a spec whose story is genuinely testable, and writes its documents to disk', async () => {
    const acceptance = await acceptFeatureSpec(featureSpec(), projectDir);

    expect(acceptance.accepted).toBe(true);
    expect(acceptance.satisfies.stage2).toBe(true);

    // The harness persisted the upstream documents, so the gates had real evidence to read.
    expect(existsSync(join(projectDir, 'USER_STORY.md'))).toBe(true);
    expect(existsSync(join(projectDir, 'TECHNICAL_BRIEF.md'))).toBe(true);
  });

  it('I-11 with an artifactDir, persists the supplied documents into the run directory, not the project root', async () => {
    const acceptance = await acceptFeatureSpec(featureSpec(), projectDir, '.factory/run-1');

    expect(acceptance.accepted).toBe(true);
    expect(existsSync(join(projectDir, '.factory/run-1', 'USER_STORY.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.factory/run-1', 'TECHNICAL_BRIEF.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.factory/run-1', 'FILE_LIST.md'))).toBe(true);
    expect(existsSync(join(projectDir, 'USER_STORY.md'))).toBe(false);
    expect(existsSync(join(projectDir, 'TECHNICAL_BRIEF.md'))).toBe(false);
  });

  /**
   * THE SEAM'S MOAT. The Decomposer asserts its work is good: schema-valid, `status: "PASS"`,
   * three acceptance criteria, every one flagged `testable: true`. But the USER_STORY.md it
   * actually wrote is vibes. The gate reads that document and refuses it.
   *
   * An upstream producer gets exactly the same scrutiny as Tier 2's own Story Writer. If this
   * ever passes, Tier 1 can inject unbuildable work into the pipeline and the two-tier design
   * is worthless.
   */
  it('REJECTS a spec that self-reports PASS but whose story is not testable', async () => {
    const spec = featureSpec();
    spec.story.details.artifacts[0].content = [
      '# User Story',
      'As a user I want 2FA so that I am secure.',
      '',
      '## Acceptance Criteria',
      '- It should work well.',
      '- The flow ought to be intuitive.',
      '- Users will be happy.'
    ].join('\n');

    // The producer insists the work is fine.
    expect(spec.story.status).toBe('PASS');
    expect(spec.story.details.acceptanceCriteria.every((ac: any) => ac.testable)).toBe(true);

    const acceptance = await acceptFeatureSpec(spec, projectDir);

    expect(acceptance.accepted).toBe(false);
    expect(acceptance.blockers.join('\n')).toMatch(/Given|When|Then|testable/i);
  });

  it('rejects a spec whose story has fewer than 3 acceptance criteria', async () => {
    const spec = featureSpec();
    spec.story.details.acceptanceCriteria = [spec.story.details.acceptanceCriteria[0]];

    const acceptance = await acceptFeatureSpec(spec, projectDir);

    expect(acceptance.accepted).toBe(false);
    expect(acceptance.blockers.join('\n')).toMatch(/3\+ acceptance criteria/i);
  });

  it('rejects a spec that never wrote its story document at all', async () => {
    const spec = featureSpec();
    delete spec.story.details.artifacts[0].content;

    const acceptance = await acceptFeatureSpec(spec, projectDir);

    expect(acceptance.accepted).toBe(false);
    expect(existsSync(join(projectDir, 'USER_STORY.md'))).toBe(false);
  });
});

describe('I-14 a pre-supplied spec must carry its documents', () => {
  /**
   * A document with no content is not persisted into the run directory, so the gate would read
   * whatever its claimed path names — a stale file in the project root would satisfy it, and the
   * checkpoint would present something nobody supplied. Refused at acceptance instead.
   */
  it.each<['story' | 'spec', string, number]>([
    ['story', 'USER_STORY.md', 0],
    ['spec', 'TECHNICAL_BRIEF.md', 0],
    ['spec', 'FILE_LIST.md', 1]
  ])('I-14 a pre-supplied %s whose %s carries no content is rejected with blockers, even with a stale copy in the project root', async (part, name, index) => {
    const spec = featureSpec();
    const artifact = spec[part].details.artifacts[index];
    expect(artifact.name).toBe(name);
    const content = artifact.content!;
    delete artifact.content;
    writeFileSync(join(projectDir, name), content);

    const acceptance = await acceptFeatureSpec(spec, projectDir, '.factory/run-1');

    expect(acceptance.accepted).toBe(false);
    expect(acceptance.blockers.join('\n')).toMatch(new RegExp(`${name.replace('.', '\\.')}.*content`));
    expect(existsSync(join(projectDir, '.factory/run-1', name))).toBe(false);
  });
});

describe('NEW-MINOR-3 an unsafe document name in a pre-supplied spec', () => {
  it.each<[string, RegExp]>([
    ['../evil.md', /not a plain filename/],
    ['STATE.JSON', /reserved/]
  ])('NEW-MINOR-3 an unsafe artifact name in a pre-supplied spec is rejected with blockers (%s)', async (name, reason) => {
    const spec = featureSpec();
    spec.story.details.artifacts.push({ name, path: name, description: 'Planted', content: '# planted' });

    const acceptance = await acceptFeatureSpec(spec, projectDir, '.factory/run-1');

    expect(acceptance.accepted).toBe(false);
    expect(acceptance.satisfies).toEqual({ stage1: false, stage2: false });
    expect(acceptance.blockers.join('\n')).toMatch(reason);
    // Refused before anything is written: not even the safe documents are on disk.
    expect(existsSync(join(projectDir, '.factory/run-1'))).toBe(false);
    expect(existsSync(join(projectDir, '.factory', 'evil.md'))).toBe(false);
  });
});

describe('runFeatureFactory — Tier 1 is optional', () => {
  /**
   * THE INVARIANT. With no spec supplied, the orchestrator must run its own planning agents.
   * Feature Factory has to keep working standalone on an existing project — that is the primary
   * use case, and Tier 1 is strictly an optional producer on top of it.
   */
  it('runs its own Researcher and Story Writer when NO spec is supplied', async () => {
    const invoked: string[] = [];

    // Return something the schema gate will reject, so the run stops early — we are asserting
    // WHICH agents were called, not that the whole pipeline completes.
    const invoke = recordingInvoker(invoked);

    await runFeatureFactory({
      featureName: 'standalone',
      featureDescription: 'add a health check endpoint',
      cwd: projectDir,
      changes: fakeChangeTracker(),
      invoke
    });

    expect(invoked[0]).toBe('01-researcher');
  });

  it('SKIPS its own planning agents when a valid spec IS supplied', async () => {
    const invoked: string[] = [];

    const invoke = recordingInvoker(invoked);

    await runFeatureFactory({
      featureName: 'add-2fa',
      featureDescription: 'Let a user enable 2FA',
      cwd: projectDir,
      changes: fakeChangeTracker(),
      invoke,
      approveCheckpoint: async () => true,
      preSuppliedSpec: featureSpec()
    });

    // No planning agent ran — the upstream spec satisfied those stages.
    expect(invoked).not.toContain('01-researcher');
    expect(invoked).not.toContain('02-story-writer');
    expect(invoked).not.toContain('03-spec-writer');

    // It went straight to building.
    expect(invoked[0]).toBe('04-backend-builder');
  });

  it('I-11 a pre-supplied spec lands in the run directory, and the builder prompt points at it', async () => {
    const prompts: string[] = [];

    const state = await runFeatureFactory({
      featureName: 'add-2fa',
      featureDescription: 'Let a user enable 2FA',
      cwd: projectDir,
      changes: fakeChangeTracker(),
      logger: () => {},
      approveCheckpoint: async () => true,
      invoke: async (call: AgentInvocation) => {
        prompts.push(call.prompt);
        return placeholder(call.stage, call.agent);
      },
      preSuppliedSpec: featureSpec()
    });

    const brief = join(projectDir, '.factory', state.featureId, 'TECHNICAL_BRIEF.md');
    expect(existsSync(brief)).toBe(true);
    expect(existsSync(join(projectDir, 'TECHNICAL_BRIEF.md'))).toBe(false);
    expect(prompts[0]).toContain(`THE APPROVED BRIEF IS: ${brief}`);
    // No researcher was supplied, so the prompt does not point at a report that does not exist.
    expect(prompts[0]).not.toContain('RESEARCHER_REPORT.md');
  });

  /**
   * A rejected spec ESCALATES. It must NOT silently fall back to running stages 1-2, because a
   * broken Decomposer would then look like it worked while Tier 2 quietly re-did the planning.
   */
  it('ESCALATES on a bad spec rather than quietly re-planning around it', async () => {
    const invoked: string[] = [];
    const invoke = recordingInvoker(invoked);

    const spec = featureSpec();
    spec.story.details.artifacts[0].content = '# User Story\n\nIt should just work, really.';

    const state = await runFeatureFactory({
      featureName: 'add-2fa',
      featureDescription: 'Let a user enable 2FA',
      cwd: projectDir,
      changes: fakeChangeTracker(),
      invoke,
      preSuppliedSpec: spec
    });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations[0].agent).toBe('tier-1');

    // It did NOT quietly re-plan.
    expect(invoked).not.toContain('02-story-writer');
    expect(invoked).toHaveLength(0);
  });
});

describe('buildOrder — dependency-ordered work queue', () => {
  it('builds dependencies before the features that need them', () => {
    const order = buildOrder([
      featureSpec({ name: 'checkout', dependsOn: ['cart', 'payments'] }),
      featureSpec({ name: 'cart', dependsOn: ['catalogue'] }),
      featureSpec({ name: 'payments' }),
      featureSpec({ name: 'catalogue' })
    ]).map(f => f.featureName);

    expect(order.indexOf('catalogue')).toBeLessThan(order.indexOf('cart'));
    expect(order.indexOf('cart')).toBeLessThan(order.indexOf('checkout'));
    expect(order.indexOf('payments')).toBeLessThan(order.indexOf('checkout'));
  });

  it('groups independent features into batches that can be built in parallel', () => {
    const batches = parallelBatches([
      featureSpec({ name: 'checkout', dependsOn: ['cart', 'payments'] }),
      featureSpec({ name: 'cart', dependsOn: ['catalogue'] }),
      featureSpec({ name: 'payments' }),
      featureSpec({ name: 'catalogue' })
    ]).map(batch => batch.map(f => f.featureName).sort());

    // catalogue and payments depend on nothing — they go first, together.
    expect(batches[0]).toEqual(['catalogue', 'payments']);
    expect(batches[batches.length - 1]).toEqual(['checkout']);
  });

  it('throws on a dependency cycle rather than inventing an order', () => {
    expect(() => buildOrder([featureSpec({ name: 'a', dependsOn: ['b'] }), featureSpec({ name: 'b', dependsOn: ['a'] })])).toThrow(/cycle/i);
  });

  it('throws when a feature depends on something that is not in the plan', () => {
    expect(() => buildOrder([featureSpec({ name: 'a', dependsOn: ['ghost'] })])).toThrow(/not in the plan/i);
  });
});
