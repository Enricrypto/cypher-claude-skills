/**
 * Stage Context Tests — the moat.
 *
 * These are the tests the whole system exists to justify. They assert that the gates judge
 * REAL evidence: files that actually exist on disk, with content that actually satisfies the
 * criteria — and that an agent cannot advance a stage by asserting it did good work.
 *
 * They run entirely offline. No model, no network, no token. That is deliberate: the model's
 * job is to PRODUCE output; the gate's job is to JUDGE it. Judging can be tested by handing
 * the gate a known-bad output directly, which is both cheaper and stricter than hoping a live
 * run happens to generate one.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildStageContext, countAbandonedMarkers } from '../../harness/stage-context';
import { canAdvanceStage, stageContracts } from '../../harness/stage-gates';
import {
  ResearcherOutput,
  StoryWriterOutput,
  SpecWriterOutput
} from '../../harness/agent-output-schema';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ff-gate-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const full = join(projectDir, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function researcherOutput(): ResearcherOutput {
  return {
    stage: 1,
    agent: '01-researcher',
    timestamp: new Date().toISOString(),
    status: 'PASS',
    details: {
      summary: 'Mapped the auth module.',
      artifacts: [
        { name: 'RESEARCHER_REPORT.md', path: 'RESEARCHER_REPORT.md', description: 'Report' }
      ],
      architecture: { layers: ['routes', 'services'], description: 'Layered' },
      filesIdentified: [
        { path: 'src/a.ts', role: 'service', reason: 'core', priority: 'MUST_MODIFY' },
        { path: 'src/b.ts', role: 'controller', reason: 'entry', priority: 'LIKELY' },
        { path: 'src/c.ts', role: 'util', reason: 'helper', priority: 'OPTIONAL' }
      ],
      existingPatterns: [
        {
          name: 'BaseService',
          description: 'Service base class',
          locations: ['src/a.ts'],
          confidence: 0.9,
          recommendation: 'REUSE'
        }
      ],
      risks: [{ type: 'TECHNICAL', severity: 'IMPORTANT', description: 'Timezone handling' }],
      timeEstimate: {
        discover: 2, plan: 3, execute: 8, verify: 5, deliver: 2, total: 20, confidence: 0.7
      }
    }
  } as ResearcherOutput;
}

/** A story output whose JSON is schema-valid: three criteria, all marked testable. */
function storyOutput(): StoryWriterOutput {
  return {
    stage: 2,
    agent: '02-story-writer',
    timestamp: new Date().toISOString(),
    status: 'PASS',
    details: {
      summary: 'User can enable 2FA.',
      artifacts: [{ name: 'USER_STORY.md', path: 'USER_STORY.md', description: 'Story' }],
      userStory: { persona: 'user', goal: 'enable 2FA', benefit: 'security' },
      acceptanceCriteria: [
        { id: 'AC-1', given: 'logged in', when: 'enabling 2FA', then: 'QR shown', priority: 'MUST', testable: true },
        { id: 'AC-2', given: 'QR shown', when: 'valid code submitted', then: '2FA enabled', priority: 'MUST', testable: true },
        { id: 'AC-3', given: '2FA enabled', when: 'invalid code submitted', then: 'rejected', priority: 'MUST', testable: true }
      ],
      edgeCases: [],
      assumptions: [],
      outOfScope: []
    }
  } as StoryWriterOutput;
}

function specOutput(): SpecWriterOutput {
  return {
    stage: 2,
    agent: '03-spec-writer',
    timestamp: new Date().toISOString(),
    status: 'PASS',
    details: {
      summary: 'Technical brief for 2FA.',
      artifacts: [
        { name: 'TECHNICAL_BRIEF.md', path: 'TECHNICAL_BRIEF.md', description: 'Brief' },
        { name: 'FILE_LIST.md', path: 'FILE_LIST.md', description: 'Files' }
      ],
      dataModel: { tables: [] },
      apiContract: { endpoints: [], errorHandling: 'RFC7807' },
      uiComponents: [],
      fileList: [
        { path: 'src/auth/totp.ts', type: 'CREATE', reason: 'TOTP', complexity: 'MODERATE' }
      ],
      testStrategy: { unitTests: [], integrationTests: [], e2eTests: [] }
    }
  } as SpecWriterOutput;
}

describe('Stage 1 gate — judges what the Researcher actually found', () => {
  it('advances when the report exists on disk and the findings are real', async () => {
    writeFile('RESEARCHER_REPORT.md', '# Researcher Report\n\nMapped the auth module.');

    const context = buildStageContext({ stage: 1, cwd: projectDir, outputs: { researcher: researcherOutput() } });
    const decision = await canAdvanceStage(1, stageContracts[1], context);

    expect(context.metadata.filesIdentified).toBe(3);
    expect(decision.canAdvance).toBe(true);
  });

  it('BLOCKS when the Researcher claims a report it never wrote', async () => {
    // Note: no file written. The agent's output still claims the artifact exists.
    const context = buildStageContext({ stage: 1, cwd: projectDir, outputs: { researcher: researcherOutput() } });
    const decision = await canAdvanceStage(1, stageContracts[1], context);

    expect(context.artifacts['RESEARCHER_REPORT.md']).toBeUndefined();
    expect(decision.canAdvance).toBe(false);
    expect(decision.recommendation).toBe('ESCALATE');
  });
});

describe('Stage 2 gate — the acceptance-criteria contract', () => {
  beforeEach(() => {
    writeFile('TECHNICAL_BRIEF.md', '# Technical Brief\n\nTOTP via speakeasy.');
    writeFile('FILE_LIST.md', '# Files\n\n- src/auth/totp.ts (CREATE)');
  });

  it('advances when the story is written in Given/When/Then', async () => {
    writeFile(
      'USER_STORY.md',
      [
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
        'Then 2FA is enabled on my account',
        '',
        '## AC-3',
        'Given 2FA is enabled',
        'When I submit an invalid TOTP code',
        'Then the login is rejected'
      ].join('\n')
    );

    const outputs = { researcher: researcherOutput(), story: storyOutput(), spec: specOutput() };
    const decision = await canAdvanceStage(2, stageContracts[2], buildStageContext({ stage: 2, cwd: projectDir, outputs }));

    expect(decision.canAdvance).toBe(true);
  });

  /**
   * THE MOAT. The story-writer's JSON output is schema-valid — three acceptance criteria, each
   * flagged `testable: true`. The agent asserts its work is good. But the story it actually
   * WROTE is prose with no Given/When/Then, so it is not testable, and the gate must refuse to
   * advance regardless of what the agent claims about itself.
   *
   * If this test ever passes with canAdvance === true, the deterministic guarantee is gone and
   * Feature Factory is just gstack with extra steps.
   */
  it('BLOCKS a story whose criteria are not testable, even though the agent reports PASS', async () => {
    writeFile(
      'USER_STORY.md',
      [
        '# User Story',
        'As a user I want to enable 2FA so that my account is secure.',
        '',
        '## Acceptance Criteria',
        '- It should work well.',
        '- The 2FA flow ought to be secure and intuitive.',
        '- Users will be happy with it.'
      ].join('\n')
    );

    const story = storyOutput();
    expect(story.status).toBe('PASS');
    expect(story.details.acceptanceCriteria.every(ac => ac.testable)).toBe(true);

    const outputs = { researcher: researcherOutput(), story, spec: specOutput() };
    const decision = await canAdvanceStage(2, stageContracts[2], buildStageContext({ stage: 2, cwd: projectDir, outputs }));

    expect(decision.canAdvance).toBe(false);
    expect(decision.recommendation).toBe('ESCALATE');
    expect(decision.blockers.join('\n')).toMatch(/Given|When|Then|testable/i);
  });
});

describe('Stage 3 gate — test pass rate is measured, not asserted', () => {
  /**
   * testPassRate used to be hardcoded to 1.0 in the orchestrator, which made this CRITICAL
   * criterion unfailable. These two tests exist so it can never be hardcoded again.
   */
  it('BLOCKS when the builders wrote tests that fail', async () => {
    writeFile('src/auth/totp.ts', 'export const totp = () => {};');

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built TOTP.', artifacts: [],
        filesModified: [{ path: 'src/auth/totp.ts', type: 'CREATE', description: 'TOTP', linesAdded: 40, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 10, testsPassed: 7, testsFailed: 3 },
        patterns: { reused: [], created: [] }
      }
    };

    const context = buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec: specOutput(), backend } });
    expect(context.metadata.testPassRate).toBeCloseTo(0.7, 2);

    const decision = await canAdvanceStage(3, stageContracts[3], context);
    expect(decision.canAdvance).toBe(false);
  });

  it('treats "no tests written" as a pass rate of 0, not a vacuous 100%', () => {
    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built it.', artifacts: [], filesModified: [],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 0, testsPassed: 0, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const context = buildStageContext({ stage: 3, cwd: projectDir, outputs: { backend } });
    expect(context.metadata.testPassRate).toBe(0);
  });
});

describe('countAbandonedMarkers', () => {
  it('counts unfinished-work markers left in the files the builders wrote', () => {
    writeFile('src/x.ts', 'const a = 1; // TODO: handle errors\n// FIXME: race condition\n');
    writeFile('src/y.ts', 'const b = 2; // all good\n');

    const count = countAbandonedMarkers([{ path: 'src/x.ts' }, { path: 'src/y.ts' }], projectDir);
    expect(count).toBe(2);
  });

  it('does not invent a passing zero for a file that does not exist', () => {
    expect(countAbandonedMarkers([{ path: 'src/ghost.ts' }], projectDir)).toBe(0);
  });
});
