/**
 * Feature Factory Agent Registry
 *
 * Maps each agent to the stage it belongs to, the tools it is permitted to use, and the
 * contract file that becomes its system prompt.
 *
 * The tool grants below are the ENFORCEMENT of each agent's contract, not a restatement of
 * it. "01-researcher — read-only" is true because this table withholds Write/Edit/Bash and
 * the runner passes it to the Agent SDK, not because the agent's markdown asks it politely.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

export type FeatureFactoryAgent =
  | '01-researcher'
  | '02-story-writer'
  | '03-spec-writer'
  | '04-backend-builder'
  | '05-frontend-builder'
  | '06-test-verifier'
  | '07-validator'
  | '08-feature-consolidator';

export const AGENT_STAGE: Record<FeatureFactoryAgent, 1 | 2 | 3 | 4 | 5> = {
  '01-researcher': 1,
  '02-story-writer': 2,
  '03-spec-writer': 2,
  '04-backend-builder': 3,
  '05-frontend-builder': 3,
  '06-test-verifier': 4,
  '07-validator': 4,
  '08-feature-consolidator': 5
};

/** Tools each agent may use. Anything absent is denied by the runner's permission mode. */
export const AGENT_TOOLS: Record<FeatureFactoryAgent, string[]> = {
  '01-researcher': ['Read', 'Grep', 'Glob'],
  '02-story-writer': ['Read'],
  '03-spec-writer': ['Read', 'Grep', 'Glob'],
  '04-backend-builder': ['Read', 'Write', 'Edit', 'Bash'],
  '05-frontend-builder': ['Read', 'Write', 'Edit', 'Bash'],
  '06-test-verifier': ['Read', 'Write', 'Edit', 'Bash'],
  '07-validator': ['Read', 'Grep', 'Glob'],
  '08-feature-consolidator': ['Read', 'Grep']
};

/** Mutating tools. Explicitly denied to any agent whose grant omits them. */
const MUTATING_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

export function deniedToolsFor(agent: FeatureFactoryAgent): string[] {
  const granted = new Set(AGENT_TOOLS[agent]);
  return MUTATING_TOOLS.filter(tool => !granted.has(tool));
}

export function isReadOnly(agent: FeatureFactoryAgent): boolean {
  return !AGENT_TOOLS[agent].some(tool => MUTATING_TOOLS.includes(tool));
}

/**
 * Load an agent's contract markdown, which becomes its system prompt verbatim.
 * Resolved against this file's location, not the target project's cwd — the agent runs
 * inside the user's repo but its instructions come from ours.
 */
export function loadAgentContract(agent: FeatureFactoryAgent): string {
  const contractPath = resolve(__dirname, '..', 'feature', 'agents', `${agent}.md`);

  try {
    return readFileSync(contractPath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Agent contract not found for "${agent}" at ${contractPath}. ` +
        `Every agent must have a contract file — the harness will not invent a system prompt for it.`
    );
  }
}
