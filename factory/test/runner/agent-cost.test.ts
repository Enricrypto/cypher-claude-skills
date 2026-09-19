/**
 * Each agent costs what its job is worth.
 *
 * createSdkInvoker used to take ONE model for the whole chain, so 02-story-writer — read-only,
 * granted nothing but Read, whose entire job is turning a report it is handed into three
 * Given/When/Then criteria — was billed identically to 04-backend-builder writing a migration
 * against an unfamiliar schema.
 *
 * AGENT_COST fixes that the same way AGENT_TOOLS fixes tool grants: one table, decided once,
 * enforced by the runner. These tests guard the two properties that make the table safe to
 * tune — every agent has a tier, and the expensive-when-wrong agents are not quietly cheapened.
 */

import { describe, it, expect } from '@jest/globals';
import {
  AGENT_COST,
  AGENT_TOOLS,
  AGENT_STAGE,
  FeatureFactoryAgent,
  isReadOnly
} from '../../runner/agent-registry';

const allAgents = Object.keys(AGENT_TOOLS) as FeatureFactoryAgent[];

describe('AGENT_COST', () => {
  it('covers every agent the runner can be asked to run', () => {
    for (const agent of allAgents) {
      expect(AGENT_COST[agent]).toBeDefined();
    }
    expect(Object.keys(AGENT_COST).sort()).toEqual(allAgents.sort());
  });

  it('gives every agent a positive turn budget', () => {
    for (const agent of allAgents) {
      expect(AGENT_COST[agent].maxTurns).toBeGreaterThan(0);
    }
  });

  it('gives every agent a non-empty model id', () => {
    for (const agent of allAgents) {
      expect(AGENT_COST[agent].model.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * The agents that WRITE are the ones whose mistakes cost a whole extra invocation to undo,
   * and the Researcher's mistakes are inherited by every stage after it. Cheapening these is
   * a false economy: one avoided loop-back pays for the tier difference many times over.
   *
   * This test is a tripwire, not a law. If a deliberate decision is made to run a builder
   * cheaper, change it here too — with a reason.
   */
  it('does not cheapen the agents whose errors cause loop-backs', () => {
    const expensiveWhenWrong: FeatureFactoryAgent[] = [
      '01-researcher',
      '03-spec-writer',
      '04-backend-builder',
      '05-frontend-builder',
      '06-test-verifier',
      '07-validator'
    ];

    for (const agent of expensiveWhenWrong) {
      expect(['high', 'xhigh', 'max']).toContain(AGENT_COST[agent].effort);
    }
  });

  it('gives the writing agents enough turns to actually write, test and self-correct', () => {
    for (const agent of allAgents) {
      if (isReadOnly(agent)) continue;
      expect(AGENT_COST[agent].maxTurns).toBeGreaterThanOrEqual(30);
    }
  });

  it('spends less on the agents nothing downstream depends on', () => {
    // The Consolidator runs after the PR is merged. Nothing in the run reads its output.
    const consolidator = AGENT_COST['08-feature-consolidator'];
    const researcher = AGENT_COST['01-researcher'];

    expect(consolidator.model).not.toEqual(researcher.model);
    expect(consolidator.maxTurns).toBeLessThan(researcher.maxTurns);
  });

  it('keeps every agent on a real stage, so cost and stage cannot drift apart', () => {
    for (const agent of allAgents) {
      expect(AGENT_STAGE[agent]).toBeGreaterThanOrEqual(1);
      expect(AGENT_STAGE[agent]).toBeLessThanOrEqual(5);
    }
  });
});
