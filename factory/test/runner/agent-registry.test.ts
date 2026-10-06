/**
 * Agent Registry Tests
 *
 * These lock down the tool grants. The agent contracts SAY the Researcher is read-only and
 * the Validator never fixes anything; this registry is what MAKES that true, by withholding
 * the tools. If a grant here drifts, an agent silently gains the ability to modify the
 * codebase it was supposed to only observe — so the grants are asserted explicitly rather
 * than derived.
 */

import { describe, it, expect } from '@jest/globals';
import {
  AGENT_COST,
  AGENT_TOOLS,
  AGENT_STAGE,
  FeatureFactoryAgent,
  REQUIRED_ARTIFACTS,
  REVIEW_DOCUMENTS,
  deniedToolsFor,
  isReadOnly,
  loadAgentContract
} from '../../runner/agent-registry';

const MUTATING = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

const READ_ONLY_AGENTS: FeatureFactoryAgent[] = [
  '01-researcher',
  '02-story-writer',
  '03-spec-writer',
  '07-validator',
  '08-feature-consolidator'
];

const BUILDER_AGENTS: FeatureFactoryAgent[] = [
  '04-backend-builder',
  '05-frontend-builder',
  '06-test-verifier'
];

describe('Agent Registry', () => {
  describe('tool grants', () => {
    it.each(READ_ONLY_AGENTS)('%s is read-only and is granted no mutating tool', agent => {
      expect(isReadOnly(agent)).toBe(true);

      for (const tool of MUTATING) {
        expect(AGENT_TOOLS[agent]).not.toContain(tool);
      }
    });

    it.each(READ_ONLY_AGENTS)('%s explicitly denies every mutating tool', agent => {
      expect(deniedToolsFor(agent).sort()).toEqual([...MUTATING].sort());
    });

    it.each(BUILDER_AGENTS)('%s can write, edit and run commands', agent => {
      expect(isReadOnly(agent)).toBe(false);
      expect(AGENT_TOOLS[agent]).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
    });

    it('grants no agent a tool outside the known set', () => {
      const known = new Set(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']);

      for (const [agent, tools] of Object.entries(AGENT_TOOLS)) {
        for (const tool of tools) {
          expect({ agent, tool, known: known.has(tool) }).toEqual({ agent, tool, known: true });
        }
      }
    });

    it('grants every agent the ability to read — none works blind', () => {
      for (const tools of Object.values(AGENT_TOOLS)) {
        expect(tools).toContain('Read');
      }
    });
  });

  describe('stage mapping', () => {
    it('assigns every agent to exactly one stage', () => {
      expect(Object.keys(AGENT_STAGE).sort()).toEqual(Object.keys(AGENT_TOOLS).sort());
    });

    it('orders agents by stage: discover -> plan -> execute -> verify -> deliver', () => {
      expect(AGENT_STAGE['01-researcher']).toBe(1);
      expect(AGENT_STAGE['02-story-writer']).toBe(2);
      expect(AGENT_STAGE['03-spec-writer']).toBe(2);
      expect(AGENT_STAGE['04-backend-builder']).toBe(3);
      expect(AGENT_STAGE['06-test-verifier']).toBe(4);
      expect(AGENT_STAGE['08-feature-consolidator']).toBe(5);
    });
  });

  describe('loadAgentContract', () => {
    it.each(Object.keys(AGENT_TOOLS) as FeatureFactoryAgent[])(
      'loads a non-empty contract for %s',
      agent => {
        const contract = loadAgentContract(agent);
        expect(contract.length).toBeGreaterThan(100);
      }
    );

    it('throws rather than inventing a system prompt for an unknown agent', () => {
      expect(() => loadAgentContract('99-nonexistent' as FeatureFactoryAgent)).toThrow(
        /contract not found/i
      );
    });
  });
});

/**
 * PR B-2 (D-6): the follow-up reviewer and the skeptic. Both are read-only reviewers in Stage 4,
 * registered right after the Validator (the claims-block order), each with its own document.
 */
describe('the Stage 4 follow-up and skeptic agents (AC-127, AC-132)', () => {
  const FOLLOWUP = '07b-validator-followup' as FeatureFactoryAgent;
  const SKEPTIC = '07c-validator-skeptic' as FeatureFactoryAgent;

  it("AC-132 the skeptic and follow-up tools are exactly the Validator's read-only tools", () => {
    expect(AGENT_TOOLS['07-validator']).toEqual(['Read', 'Grep', 'Glob']);
    for (const agent of [FOLLOWUP, SKEPTIC]) {
      expect({ agent, tools: AGENT_TOOLS[agent] }).toEqual({ agent, tools: AGENT_TOOLS['07-validator'] });
      expect(isReadOnly(agent)).toBe(true);
      expect(deniedToolsFor(agent).sort()).toEqual([...MUTATING].sort());
    }
  });

  it('AC-127 both are Stage 4 agents registered right after 07-validator', () => {
    expect(Object.keys(AGENT_STAGE)).toEqual([
      '01-researcher',
      '02-story-writer',
      '03-spec-writer',
      '04-backend-builder',
      '05-frontend-builder',
      '06-test-verifier',
      '07-validator',
      '07b-validator-followup',
      '07c-validator-skeptic',
      '08-feature-consolidator'
    ]);
    expect(AGENT_STAGE[FOLLOWUP]).toBe(4);
    expect(AGENT_STAGE[SKEPTIC]).toBe(4);
  });

  it('AC-127 each returns its own document, and both documents are review documents, not gate input', () => {
    expect(REQUIRED_ARTIFACTS[FOLLOWUP]).toEqual(['VALIDATION_FOLLOWUP.md']);
    expect(REQUIRED_ARTIFACTS[SKEPTIC]).toEqual(['SKEPTIC_REVIEW.md']);
    expect([...REVIEW_DOCUMENTS]).toEqual(['VALIDATION_FOLLOWUP.md', 'SKEPTIC_REVIEW.md']);
    // The follow-up never writes the main Validator's report (D-5: its own id, so its own document).
    expect(REQUIRED_ARTIFACTS[FOLLOWUP]).not.toContain('VALIDATION_REPORT.md');
  });

  it('AC-127 both run on the Validator model at high effort, with fewer turns than the Validator', () => {
    expect(AGENT_COST[FOLLOWUP]).toEqual({ model: 'claude-opus-5', effort: 'high', maxTurns: 20 });
    expect(AGENT_COST[SKEPTIC]).toEqual({ model: 'claude-opus-5', effort: 'high', maxTurns: 15 });
  });
});
