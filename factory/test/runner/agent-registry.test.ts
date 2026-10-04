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
  AGENT_TOOLS,
  AGENT_STAGE,
  FeatureFactoryAgent,
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
