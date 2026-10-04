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
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  acceptFeatureSpec,
  buildOrder,
  parallelBatches,
  FeatureSpec
} from '../../contracts/feature-spec';
import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { AgentInvocation } from '../../runner/invoke-agent';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-seam-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** A spec whose story is genuinely testable — Given/When/Then, three criteria, in the document. */
function goodSpec(name = 'add-2fa'): FeatureSpec {
  return {
    featureName: name,
    featureDescription: 'Let a user enable two-factor authentication',

    story: {
      stage: 2,
      agent: '02-story-writer',
      timestamp: new Date().toISOString(),
      status: 'PASS',
      details: {
        summary: 'User can enable 2FA.',
        artifacts: [
          {
            name: 'USER_STORY.md',
            path: 'USER_STORY.md',
            description: 'The story',
            content: [
              '# User Story',
              'As a user I want to enable 2FA so that my account is secure.',
              '',
              '## AC-1',
              'Given I am logged in',
              'When I enable 2FA',
              'Then a QR code is shown',
              '',
              '## AC-2',
              'Given a QR code is shown',
              'When I submit a valid TOTP code',
              'Then 2FA is enabled',
              '',
              '## AC-3',
              'Given 2FA is enabled',
              'When I submit an invalid TOTP code',
              'Then the login is rejected'
            ].join('\n')
          }
        ],
        userStory: { persona: 'user', goal: 'enable 2FA', benefit: 'security' },
        acceptanceCriteria: [
          { id: 'AC-1', given: 'logged in', when: 'enabling 2FA', then: 'QR shown', priority: 'MUST', testable: true },
          { id: 'AC-2', given: 'QR shown', when: 'valid code', then: 'enabled', priority: 'MUST', testable: true },
          { id: 'AC-3', given: 'enabled', when: 'invalid code', then: 'rejected', priority: 'MUST', testable: true }
        ],
        edgeCases: [],
        assumptions: [],
        outOfScope: []
      }
    } as any,

    spec: {
      stage: 2,
      agent: '03-spec-writer',
      timestamp: new Date().toISOString(),
      status: 'PASS',
      details: {
        summary: 'Technical brief for 2FA.',
        artifacts: [
          { name: 'TECHNICAL_BRIEF.md', path: 'TECHNICAL_BRIEF.md', description: 'Brief', content: '# Technical Brief\n\nTOTP via speakeasy.' },
          { name: 'FILE_LIST.md', path: 'FILE_LIST.md', description: 'Files', content: '# Files\n\n- src/auth/totp.ts (CREATE)' }
        ],
        dataModel: { tables: [] },
        apiContract: { endpoints: [], errorHandling: 'RFC7807' },
        uiComponents: [],
        fileList: [{ path: 'src/auth/totp.ts', type: 'CREATE', reason: 'TOTP', complexity: 'MODERATE' }],
        testStrategy: { unitTests: [], integrationTests: [], e2eTests: [] }
      }
    } as any
  };
}

describe('acceptFeatureSpec — the gate IS the contract', () => {
  it('accepts a spec whose story is genuinely testable, and writes its documents to disk', async () => {
    const acceptance = await acceptFeatureSpec(goodSpec(), projectDir);

    expect(acceptance.accepted).toBe(true);
    expect(acceptance.satisfies.stage2).toBe(true);

    // The harness persisted the upstream documents, so the gates had real evidence to read.
    expect(existsSync(join(projectDir, 'USER_STORY.md'))).toBe(true);
    expect(existsSync(join(projectDir, 'TECHNICAL_BRIEF.md'))).toBe(true);
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
    const spec = goodSpec();
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
    const spec = goodSpec();
    spec.story.details.acceptanceCriteria = [spec.story.details.acceptanceCriteria[0]];

    const acceptance = await acceptFeatureSpec(spec, projectDir);

    expect(acceptance.accepted).toBe(false);
    expect(acceptance.blockers.join('\n')).toMatch(/3\+ acceptance criteria/i);
  });

  it('rejects a spec that never wrote its story document at all', async () => {
    const spec = goodSpec();
    delete spec.story.details.artifacts[0].content;

    const acceptance = await acceptFeatureSpec(spec, projectDir);

    expect(acceptance.accepted).toBe(false);
    expect(existsSync(join(projectDir, 'USER_STORY.md'))).toBe(false);
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

    const invoke = async (call: AgentInvocation) => {
      invoked.push(call.agent);
      // Return something the schema gate will reject, so the run stops early — we are asserting
      // WHICH agents were called, not that the whole pipeline completes.
      return { stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(), status: 'PASS', details: { summary: 'x', artifacts: [] } };
    };

    await runFeatureFactory({
      featureName: 'standalone',
      featureDescription: 'add a health check endpoint',
      cwd: projectDir,
      invoke
    });

    expect(invoked[0]).toBe('01-researcher');
  });

  it('SKIPS its own planning agents when a valid spec IS supplied', async () => {
    const invoked: string[] = [];

    const invoke = async (call: AgentInvocation) => {
      invoked.push(call.agent);
      return { stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(), status: 'PASS', details: { summary: 'x', artifacts: [] } };
    };

    await runFeatureFactory({
      featureName: 'add-2fa',
      featureDescription: 'Let a user enable 2FA',
      cwd: projectDir,
      invoke,
      preSuppliedSpec: goodSpec()
    });

    // No planning agent ran — the upstream spec satisfied those stages.
    expect(invoked).not.toContain('01-researcher');
    expect(invoked).not.toContain('02-story-writer');
    expect(invoked).not.toContain('03-spec-writer');

    // It went straight to building.
    expect(invoked[0]).toBe('04-backend-builder');
  });

  /**
   * A rejected spec ESCALATES. It must NOT silently fall back to running stages 1-2, because a
   * broken Decomposer would then look like it worked while Tier 2 quietly re-did the planning.
   */
  it('ESCALATES on a bad spec rather than quietly re-planning around it', async () => {
    const invoked: string[] = [];
    const invoke = async (call: AgentInvocation) => {
      invoked.push(call.agent);
      return { stage: call.stage, agent: call.agent, timestamp: new Date().toISOString(), status: 'PASS', details: { summary: 'x', artifacts: [] } };
    };

    const spec = goodSpec();
    spec.story.details.artifacts[0].content = '# User Story\n\nIt should just work, really.';

    const state = await runFeatureFactory({
      featureName: 'add-2fa',
      featureDescription: 'Let a user enable 2FA',
      cwd: projectDir,
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
  const spec = (name: string, dependsOn?: string[]): FeatureSpec => ({
    ...goodSpec(name),
    featureName: name,
    dependsOn
  });

  it('builds dependencies before the features that need them', () => {
    const order = buildOrder([
      spec('checkout', ['cart', 'payments']),
      spec('cart', ['catalogue']),
      spec('payments'),
      spec('catalogue')
    ]).map(f => f.featureName);

    expect(order.indexOf('catalogue')).toBeLessThan(order.indexOf('cart'));
    expect(order.indexOf('cart')).toBeLessThan(order.indexOf('checkout'));
    expect(order.indexOf('payments')).toBeLessThan(order.indexOf('checkout'));
  });

  it('groups independent features into batches that can be built in parallel', () => {
    const batches = parallelBatches([
      spec('checkout', ['cart', 'payments']),
      spec('cart', ['catalogue']),
      spec('payments'),
      spec('catalogue')
    ]).map(batch => batch.map(f => f.featureName).sort());

    // catalogue and payments depend on nothing — they go first, together.
    expect(batches[0]).toEqual(['catalogue', 'payments']);
    expect(batches[batches.length - 1]).toEqual(['checkout']);
  });

  it('throws on a dependency cycle rather than inventing an order', () => {
    expect(() => buildOrder([spec('a', ['b']), spec('b', ['a'])])).toThrow(/cycle/i);
  });

  it('throws when a feature depends on something that is not in the plan', () => {
    expect(() => buildOrder([spec('a', ['ghost'])])).toThrow(/not in the plan/i);
  });
});
