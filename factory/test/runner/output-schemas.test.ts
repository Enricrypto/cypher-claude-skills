/**
 * The gates look documents up by an EXACT name (`ctx.artifacts['RESEARCHER_REPORT.md']`).
 * The agents have to produce documents by those exact names, or the work is invisible.
 *
 * A live Researcher named its report RESEARCH.md and was blocked, having done the analysis
 * correctly. On the previous run the same agent had happened to guess RESEARCHER_REPORT.md.
 * That is non-determinism — precisely what the gates exist to eliminate — and it was OUR bug:
 * the gate demanded a filename nothing ever told the agent.
 *
 * These tests keep the two halves welded together. If someone adds a gate that reads a new
 * document, the first test fails until the agents are told to produce it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { agentOutputSchema } from '../../runner/output-schemas';
import { REQUIRED_ARTIFACTS, AGENT_TOOLS, FeatureFactoryAgent } from '../../runner/agent-registry';
import { stageContracts } from '../../harness/stage-gates';
import { HARNESS_RENDERED_ARTIFACTS } from '../../harness/harness-documents';
import { SECURITY_CHECKS } from '../../harness/agent-output-schema';

/**
 * Every exact filename the gates demand: the literal `ctx.artifacts['…']` lookups scraped from
 * the source, plus every contract's `artifacts.required` (canAdvanceStage enforces those too).
 */
function filenamesTheGatesDemand(): string[] {
  const source = readFileSync(resolve(__dirname, '../../harness/stage-gates.ts'), 'utf-8');
  const matches = source.matchAll(/ctx\.artifacts\['([^']+)'\]/g);
  const required = Object.values(stageContracts).flatMap(contract => contract.artifacts.required);
  return [...new Set([...[...matches].map(m => m[1]), ...required])].sort();
}

describe('the gates and the agents agree on document names', () => {
  it('every document a gate demands is one some agent is REQUIRED to produce, or the harness renders', () => {
    const demanded = filenamesTheGatesDemand();
    const produced = new Set<string>([...Object.values(REQUIRED_ARTIFACTS).flat(), ...HARNESS_RENDERED_ARTIFACTS]);

    const orphaned = demanded.filter(name => !produced.has(name));

    // If this fails, a gate is reading a document that no agent has been told to write. The
    // stage can never pass, and the agent will be blamed for work it was never asked to do.
    expect({ orphaned, demanded }).toEqual({ orphaned: [], demanded });
  });

  it('every document an agent must produce is one a gate actually reads', () => {
    const demanded = new Set(filenamesTheGatesDemand());
    const produced = Object.values(REQUIRED_ARTIFACTS).flat();

    // The reverse: no agent should be forced to write a document nobody reads. (Harness-rendered
    // documents are not on this side: no agent is forced to write them.)
    expect(produced.filter(name => !demanded.has(name))).toEqual([]);
  });

  it('the Validator must return VALIDATION_REPORT.md, the document Stage 4 requires', () => {
    expect(REQUIRED_ARTIFACTS['07-validator']).toEqual(['VALIDATION_REPORT.md']);
    expect(stageContracts[4].artifacts.required).toContain('VALIDATION_REPORT.md');
  });

  it('no agent is asked to write TEST_REPORT.md — the harness renders it', () => {
    expect(Object.values(REQUIRED_ARTIFACTS).flat()).not.toContain('TEST_REPORT.md');
    expect(HARNESS_RENDERED_ARTIFACTS).toContain('TEST_REPORT.md');
  });
});

describe('security schemas (AC-67, AC-68)', () => {
  it('each Validator security check accepts true, false or "not_applicable", with optional reasons', () => {
    const schema: any = agentOutputSchema('07-validator');
    const security = schema.properties.details.properties.security;

    expect(security.required).toEqual([...SECURITY_CHECKS]);
    for (const check of SECURITY_CHECKS) {
      expect(security.properties[check].anyOf).toEqual([
        { type: 'boolean' },
        { type: 'string', enum: ['not_applicable'] }
      ]);
    }
    expect(security.properties.notApplicableReasons.type).toBe('object');
    expect(Object.keys(security.properties.notApplicableReasons.properties).sort()).toEqual([...SECURITY_CHECKS].sort());
    expect(security.required).not.toContain('notApplicableReasons');
  });

  it('the Spec Writer must declare its security surface, each one PRESENT or ABSENT', () => {
    const schema: any = agentOutputSchema('03-spec-writer');
    const details = schema.properties.details;
    const surface = details.properties.securitySurface;

    expect(details.required).toContain('securitySurface');
    const surfaces = ['auth', 'userInput', 'secrets', 'sqlDatabase', 'htmlRendering'];
    expect(surface.required).toEqual(surfaces);
    for (const name of surfaces) {
      expect(surface.properties[name].enum).toEqual(['PRESENT', 'ABSENT']);
    }
  });
});

describe('agentOutputSchema constrains the document names', () => {
  const agentsWithRequiredDocs = (Object.keys(REQUIRED_ARTIFACTS) as FeatureFactoryAgent[])
    .filter(agent => REQUIRED_ARTIFACTS[agent].length > 0);

  it.each(agentsWithRequiredDocs)('%s cannot invent a filename — the schema enumerates them', agent => {
    const schema: any = agentOutputSchema(agent);
    const nameSchema = schema.properties.details.properties.artifacts.items.properties.name;

    // An enum, not a free string. The SDK constrains the model to these and retries otherwise,
    // so "RESEARCH.md" is not a reachable output.
    expect(nameSchema.enum).toEqual(REQUIRED_ARTIFACTS[agent]);
  });

  it.each(agentsWithRequiredDocs)('%s must return one artifact per required document', agent => {
    const schema: any = agentOutputSchema(agent);
    const artifacts = schema.properties.details.properties.artifacts;

    expect(artifacts.minItems).toBe(REQUIRED_ARTIFACTS[agent].length);
  });

  it('read-only agents must return document CONTENT — they cannot write files themselves', () => {
    for (const agent of agentsWithRequiredDocs) {
      const schema: any = agentOutputSchema(agent);
      const item = schema.properties.details.properties.artifacts.items;

      // They have no Write tool, so the harness persists what they return. No content, no
      // document on disk, and the gate that reads it blocks the stage.
      expect({ agent, requiresContent: item.required.includes('content') })
        .toEqual({ agent, requiresContent: true });
    }
  });

  it('builders are NOT forced to return content — they write their own files', () => {
    const schema: any = agentOutputSchema('04-backend-builder');
    const item = schema.properties.details.properties.artifacts.items;

    // If the harness wrote a builder's files for it, the anti-hallucination gate would be
    // verifying its own handiwork.
    expect(item.required).not.toContain('content');
    expect(AGENT_TOOLS['04-backend-builder']).toContain('Write');
  });
});
