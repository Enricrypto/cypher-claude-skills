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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { symlinkSync } from 'fs';
import { join } from 'path';

import {
  buildStageContext,
  claimedFilesFromBuilders,
  claimsInsideFactoryDir,
  countAbandonedMarkers,
  normalisePath,
  persistArtifacts,
  readArtifactContents,
  UnsafeArtifactPathError
} from '../../harness/stage-context';
import { ALL_SURFACES_PRESENT, backend, followup, frontend, skeptic, spec, story, testVerifier, validator } from '../fixtures/agent-outputs';
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

  it('AC-72 carries the attempts each builder used and the attempts it was allowed into the loop criterion', () => {
    const withMax = buildStageContext({
      stage: 3,
      cwd: projectDir,
      outputs: { backend: backend() },
      loops: { backend: 4, frontend: 1, max: { backend: 4 } }
    });
    expect(withMax.metadata).toMatchObject({ backendLoops: 4, frontendLoops: 1, maxBackendLoops: 4, maxFrontendLoops: 3 });

    const defaults = buildStageContext({ stage: 3, cwd: projectDir, outputs: { backend: backend() } });
    expect(defaults.metadata).toMatchObject({ backendLoops: 0, frontendLoops: 0, maxBackendLoops: 3, maxFrontendLoops: 3 });
  });
});

describe('the materialization gate checks the PROJECT, not the harness', () => {
  /**
   * The gate used to resolve every claimed path against process.cwd() — the HARNESS's directory,
   * not the target project's. A live builder run caught it, and it was wrong in both directions:
   *
   *   false positive — the builder really did write four files into the target project. The gate
   *                    looked for them in the harness repo, did not find them, and cried
   *                    hallucination on honest work.
   *   false negative — WORSE. A builder could claim it wrote "package.json", never touch the
   *                    disk, and be APPROVED — because package.json exists in the harness's own
   *                    repo. The anti-hallucination gate could be fooled by the harness's own
   *                    directory listing.
   *
   * This test locks the second one out. It is the more dangerous of the two: a false positive is
   * loud and blocks a good build; a false negative is silent and ships a hallucination.
   */
  it('does NOT accept a file that exists in the harness repo but not in the project', async () => {
    // package.json exists where the harness runs. It does NOT exist in this empty project.
    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built it.', artifacts: [],
        filesModified: [{ path: 'package.json', type: 'MODIFY', description: 'deps', linesAdded: 1, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const context = buildStageContext({ stage: 3, cwd: projectDir, outputs: { backend } });
    expect(context.cwd).toBe(projectDir);

    const decision = await canAdvanceStage(3, stageContracts[3], context);

    expect(decision.canAdvance).toBe(false);
    expect(decision.blockers.join('\n')).toMatch(/HALLUCINATION/i);
  });

  it('DOES accept a file the builder really wrote into the project', async () => {
    // The approved brief (specOutput) lists exactly src/auth/totp.ts, so that is what the
    // builder must write. The gate compares the SETS — writing a different file, however good,
    // is a deviation from the approved contract.
    writeFile('src/auth/totp.ts', 'export const totp = () => {};');

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built it.', artifacts: [],
        filesModified: [{ path: 'src/auth/totp.ts', type: 'CREATE', description: 'TOTP', linesAdded: 1, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const decision = await canAdvanceStage(
      3,
      stageContracts[3],
      buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec: specOutput(), backend } })
    );

    expect(decision.canAdvance).toBe(true);
  });
});

describe('the approved brief is the contract', () => {
  /**
   * The gate used to compare COUNTS: `modifiedCount < expectedCount`. That is a fake gate. It
   * fails on 8-of-9, but would happily pass nine COMPLETELY DIFFERENT files — and its message,
   * "Only 8/9 files modified", never said which one was missing, so nobody could act on it.
   *
   * A live run blocked on exactly that and left us unable to tell whether the builder had
   * skipped work or the brief had over-listed.
   */
  it('BLOCKS when a file the brief called for was never written — and NAMES it', async () => {
    writeFile('src/auth/totp.ts', 'export const totp = () => {};');

    const spec = specOutput();
    spec.details.fileList = [
      { path: 'src/auth/totp.ts', type: 'CREATE', reason: 'TOTP', complexity: 'MODERATE' },
      { path: 'src/auth/recovery.ts', type: 'CREATE', reason: 'Recovery codes', complexity: 'MODERATE' }
    ] as any;

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built half of it.', artifacts: [],
        filesModified: [{ path: 'src/auth/totp.ts', type: 'CREATE', description: 'TOTP', linesAdded: 40, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const decision = await canAdvanceStage(
      3,
      stageContracts[3],
      buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec, backend } })
    );

    expect(decision.canAdvance).toBe(false);
    // The whole point: it says WHICH file.
    expect(decision.blockers.join('\n')).toContain('src/auth/recovery.ts');
  });

  it('does NOT block over a test filename — stage 4 is the authority on test coverage', async () => {
    writeFile('src/auth/totp.ts', 'export const totp = () => {};');
    writeFile('test/totpBehaviour.test.ts', 'it("works", () => {});');

    const spec = specOutput();
    spec.details.fileList = [
      { path: 'src/auth/totp.ts', type: 'CREATE', reason: 'TOTP', complexity: 'MODERATE' },
      // The brief guessed a test filename. The builder wrote equivalent tests under another.
      { path: 'test/totp.routes.test.ts', type: 'CREATE', reason: 'Tests', complexity: 'SIMPLE' },
      { path: 'package.json', type: 'MODIFY', reason: 'add speakeasy', complexity: 'SIMPLE' }
    ] as any;

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built it, named the test file differently.', artifacts: [],
        filesModified: [
          { path: 'src/auth/totp.ts', type: 'CREATE', description: 'TOTP', linesAdded: 40, linesRemoved: 0 },
          { path: 'test/totpBehaviour.test.ts', type: 'CREATE', description: 'tests', linesAdded: 20, linesRemoved: 0 }
        ],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const decision = await canAdvanceStage(
      3,
      stageContracts[3],
      buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec, backend } })
    );

    // The implementation is complete. A test filename and an unneeded package.json edit are
    // deviations worth reporting — not incomplete work. Blocking here would be theatre.
    expect(decision.canAdvance).toBe(true);
  });

  it('DOES block when a SOURCE file the brief called for is missing', async () => {
    writeFile('src/auth/totp.ts', 'export const totp = () => {};');

    const spec = specOutput();
    spec.details.fileList = [
      { path: 'src/auth/totp.ts', type: 'CREATE', reason: 'TOTP', complexity: 'MODERATE' },
      { path: 'src/auth/recovery.ts', type: 'CREATE', reason: 'Recovery codes', complexity: 'MODERATE' }
    ] as any;

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built half.', artifacts: [],
        filesModified: [{ path: 'src/auth/totp.ts', type: 'CREATE', description: 'TOTP', linesAdded: 40, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const decision = await canAdvanceStage(
      3,
      stageContracts[3],
      buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec, backend } })
    );

    // A missing SOURCE file IS incomplete work. This must never be softened.
    expect(decision.canAdvance).toBe(false);
    expect(decision.blockers.join('\n')).toContain('src/auth/recovery.ts');
    expect(decision.blockers.join('\n')).toMatch(/incomplete/i);
  });

  it('does not pass a builder that wrote the right NUMBER of the wrong files', async () => {
    writeFile('src/auth/somethingelse.ts', 'export const x = 1;');

    const spec = specOutput();   // brief asks for src/auth/totp.ts

    const backend: any = {
      stage: 3, agent: '04-backend-builder', timestamp: new Date().toISOString(), status: 'PASS',
      details: {
        summary: 'Built something.', artifacts: [],
        // One file for one file — the old count-based gate would have waved this through.
        filesModified: [{ path: 'src/auth/somethingelse.ts', type: 'CREATE', description: 'x', linesAdded: 1, linesRemoved: 0 }],
        implementation: { services: [], routes: [], migrations: [] },
        testing: { testsWritten: 5, testsPassed: 5, testsFailed: 0 },
        patterns: { reused: [], created: [] }
      }
    };

    const decision = await canAdvanceStage(
      3,
      stageContracts[3],
      buildStageContext({ stage: 3, cwd: projectDir, outputs: { spec, backend } })
    );

    expect(decision.canAdvance).toBe(false);
    expect(decision.blockers.join('\n')).toContain('src/auth/totp.ts');
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

describe('Stage 4 context — derived from the agents, never defaulted to a pass (AC-18, AC-21, AC-67)', () => {
  it('reads the AC counts from the Test Verifier and the story count from the story itself', () => {
    const ctx = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: {
        story: story({ acCount: 5 }),
        test: testVerifier({ totalAC: 5, tested: 3, notCoverable: 1 })
      }
    });

    expect(ctx.metadata).toMatchObject({
      acceptanceCriteriaTotalCount: 5,
      acceptanceCriteriaTestedCount: 3,
      acceptanceCriteriaNotCoverableCount: 1,
      storyAcceptanceCriteriaCount: 5
    });
  });

  it('AC-22 takes the Gate 2 measurement and the regression reference from the harness', () => {
    const ctx = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: { test: testVerifier(), validator: validator() },
      harness: { execution: { total: 12, passed: 12, failed: 0, passRate: 1 }, regressionReferenceCount: 10 }
    });

    expect(ctx.metadata.executionMeasurement).toEqual({ total: 12, passed: 12, failed: 0, passRate: 1 });
    expect(ctx.metadata.regressionReferenceCount).toBe(10);
  });

  it('AC-131 carries the harness\'s typed verdict as counts, and never a count from the raw issue list', () => {
    const raw = validator({
      status: 'FAIL',
      issues: [{ severity: 'CRITICAL', file: 'src/a.ts', message: 'disproved later', suggestion: 'none', canFix: true }]
    });
    const ctx = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: { test: testVerifier(), validator: raw },
      harness: { validation: { passed: true, standing: [], disproved: ['0123456789ab'], recordedAt: '2026-10-05T00:00:00.000Z' } }
    });

    expect(ctx.metadata.validationVerdict).toEqual({ passed: true, standing: 0, disproved: 1 });
    expect(ctx.metadata).not.toHaveProperty('criticalIssuesCount');
  });

  it('AC-131 without a harness verdict there is none, even with a clean Validator output, so the criterion fails closed', () => {
    const ctx = buildStageContext({ stage: 4, cwd: projectDir, outputs: { test: testVerifier(), validator: validator() } });

    expect(ctx.metadata).not.toHaveProperty('validationVerdict');
    expect(ctx.metadata).not.toHaveProperty('criticalIssuesCount');
  });

  it('AC-22 never reads the Validator\'s details.regressions', () => {
    const ctx = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: { validator: validator({ regressions: { count: 3, tests: ['a', 'b', 'c'] } }) }
    });

    expect(ctx.metadata.executionMeasurement).toBeUndefined();
    expect(ctx.metadata.regressionReferenceCount).toBeUndefined();
    expect(ctx.metadata).not.toHaveProperty('regressionCount');
  });

  it('leaves the story count undefined when there is no story, so the criterion fails closed', () => {
    const ctx = buildStageContext({ stage: 4, cwd: projectDir, outputs: { test: testVerifier() } });

    expect(ctx.metadata.storyAcceptanceCriteriaCount).toBeUndefined();
  });

  it('judges security through the tri-state evaluation, against the brief\'s declared surface', () => {
    const naAuth = validator({
      security: { authImplemented: 'not_applicable' },
      notApplicableReasons: { authImplemented: 'No request boundary.' }
    });

    const declaredAbsent = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: { spec: spec({ securitySurface: { ...ALL_SURFACES_PRESENT, auth: 'ABSENT' } }), validator: naAuth }
    });
    expect(declaredAbsent.metadata.securityIssuesCount).toBe(0);
    expect(declaredAbsent.metadata.securityBlockers).toEqual([]);

    const declaredPresent = buildStageContext({
      stage: 4,
      cwd: projectDir,
      outputs: { spec: spec(), validator: naAuth }
    });
    expect(declaredPresent.metadata.securityIssuesCount).toBe(1);
    expect(declaredPresent.metadata.securityBlockers[0]).toMatch(/authImplemented/);
  });

  it('readArtifactContents also reads top-level files in the run directory, without overriding claimed artifacts', () => {
    writeFile('.factory/run-1/TEST_REPORT.md', '# Rendered by the harness');
    writeFile('.factory/run-1/USER_STORY.md', '# From the run dir');
    writeFile('.factory/run-1/nested/IGNORED.md', 'not top level');
    writeFile('claimed/USER_STORY.md', '# Claimed by the agent');

    const claimed = story();
    claimed.details.artifacts = [{ name: 'USER_STORY.md', path: 'claimed/USER_STORY.md', description: 'Story' }];

    const contents = readArtifactContents({ story: claimed }, projectDir, '.factory/run-1');

    expect(contents['TEST_REPORT.md']).toBe('# Rendered by the harness');
    expect(contents['USER_STORY.md']).toBe('# Claimed by the agent');
    expect(contents['IGNORED.md']).toBeUndefined();
    expect(contents['nested']).toBeUndefined();
  });

  it('readArtifactContents without a run directory reads only the claimed artifacts', () => {
    writeFile('.factory/run-1/TEST_REPORT.md', '# Rendered by the harness');

    expect(readArtifactContents({}, projectDir)).toEqual({});
  });

  it('buildStageContext passes its run directory through, so the harness-rendered report reaches the gate', () => {
    writeFile('.factory/run-1/TEST_REPORT.md', '# Rendered by the harness');

    const ctx = buildStageContext({ stage: 4, cwd: projectDir, outputs: {}, artifactDir: '.factory/run-1' });

    expect(ctx.artifacts['TEST_REPORT.md']).toBe('# Rendered by the harness');
  });
});

describe('shared path helpers (D-7, D-9)', () => {
  it('normalisePath strips a leading ./ or / and makes an absolute path under cwd relative', () => {
    expect(normalisePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalisePath('/src/a.ts')).toBe('src/a.ts');
    expect(normalisePath('src/a.ts')).toBe('src/a.ts');
    expect(normalisePath(join(projectDir, 'src/a.ts'), projectDir)).toBe('src/a.ts');
    // Without cwd an absolute path is only stripped of its leading slash, as before.
    expect(normalisePath('/abs/src/a.ts')).toBe('abs/src/a.ts');
  });

  it('claimedFilesFromBuilders lists both builders\' filesModified, labelled by builder, and nothing else', () => {
    const claimed = claimedFilesFromBuilders(
      backend({ files: ['src/a.ts'] }),
      frontend({ files: ['src/components/TwoFactorForm.tsx'] })
    );

    expect(claimed).toEqual([
      { name: 'a.ts', path: 'src/a.ts', description: 'Backend Builder: Backend Builder wrote src/a.ts' },
      {
        name: 'TwoFactorForm.tsx',
        path: 'src/components/TwoFactorForm.tsx',
        description: 'Frontend Builder: Frontend Builder wrote src/components/TwoFactorForm.tsx'
      }
    ]);
    expect(claimedFilesFromBuilders(undefined, undefined)).toEqual([]);
    expect(claimedFilesFromBuilders(backend({ files: ['src/a.ts'] })).map(f => f.path)).toEqual(['src/a.ts']);
  });

  it('claimsInsideFactoryDir names every claimed path that resolves inside <cwd>/.factory/, and nothing else', () => {
    const claims = claimedFilesFromBuilders(
      backend({
        files: [
          'src/a.ts',
          '.factory/run-1/BACKEND_SUMMARY.md',
          join(projectDir, '.factory', 'baseline.json'),
          'src/../.factory/x.md',
          '.factory',
          '.factory-notes/x.md',
          'src/.factory/x.md'
        ]
      })
    );

    expect(claimsInsideFactoryDir(claims, projectDir)).toEqual([
      '.factory/run-1/BACKEND_SUMMARY.md',
      join(projectDir, '.factory', 'baseline.json'),
      'src/../.factory/x.md',
      '.factory'
    ]);
    expect(claimsInsideFactoryDir([], projectDir)).toEqual([]);
  });

  it('MINOR-4 a claim under .Factory/ in any letter case is rejected as harness-owned', () => {
    const claims = claimedFilesFromBuilders(
      backend({
        files: [
          '.Factory/run-1/BACKEND_SUMMARY.md',
          '.FACTORY/baseline.json',
          join(projectDir, '.FaCtOrY', 'state.json'),
          'src/../.Factory/x.md',
          '.Factory-notes/x.md',
          'src/.FACTORY/x.md'
        ]
      })
    );

    expect(claimsInsideFactoryDir(claims, projectDir)).toEqual([
      '.Factory/run-1/BACKEND_SUMMARY.md',
      '.FACTORY/baseline.json',
      join(projectDir, '.FaCtOrY', 'state.json'),
      'src/../.Factory/x.md'
    ]);
  });

  it('buildStageContext claims exactly what claimedFilesFromBuilders claims (one implementation)', () => {
    const b = backend({ files: ['src/a.ts'] });
    const f = frontend();

    const ctx = buildStageContext({ stage: 3, cwd: projectDir, outputs: { backend: b, frontend: f } });

    expect(ctx.metadata.claimedFiles).toEqual(claimedFilesFromBuilders(b, f));
  });

  it('a harness-rendered run-dir document wins over an agent-claimed artifact of the same name', () => {
    writeFile('.factory/run-1/TEST_REPORT.md', '# Rendered by the harness');
    writeFile('elsewhere/TEST_REPORT.md', '# Claimed by an agent');
    writeFile('.factory/run-1/USER_STORY.md', '# From the run dir');
    writeFile('claimed/USER_STORY.md', '# Claimed story');

    const claimant = validator();
    claimant.details.artifacts = [{ name: 'TEST_REPORT.md', path: 'elsewhere/TEST_REPORT.md', description: 'x' }];
    const claimedStory = story();
    claimedStory.details.artifacts = [{ name: 'USER_STORY.md', path: 'claimed/USER_STORY.md', description: 'Story' }];

    const contents = readArtifactContents({ validator: claimant, story: claimedStory }, projectDir, '.factory/run-1');

    expect(contents['TEST_REPORT.md']).toBe('# Rendered by the harness');
    // Not harness-rendered: the agent's claimed document still wins, as before.
    expect(contents['USER_STORY.md']).toBe('# Claimed story');
  });
});

describe('persistArtifacts writes only inside the run directory (IMPORTANT-1, IMPORTANT-2)', () => {
  const RUN_DIR = '.factory/run-1';
  let elsewhere: string;

  beforeEach(() => {
    elsewhere = mkdtempSync(join(tmpdir(), 'ff-elsewhere-'));
  });

  afterEach(() => {
    rmSync(elsewhere, { recursive: true, force: true });
  });

  function validatorWith(artifacts: Array<{ name: string; path: string; content?: string }>) {
    const output = validator();
    output.details.artifacts = artifacts.map(a => ({ description: 'x', content: '# Report', ...a }));
    return output;
  }

  it('an absolute path the agent supplies is ignored: the document lands in the run dir and nowhere else', () => {
    const supplied = join(elsewhere, 'VALIDATION_REPORT.md');
    const output = validatorWith([{ name: 'VALIDATION_REPORT.md', path: supplied }]);

    const written = persistArtifacts({ validator: output }, projectDir, RUN_DIR);

    expect(existsSync(supplied)).toBe(false);
    expect(readFileSync(join(projectDir, RUN_DIR, 'VALIDATION_REPORT.md'), 'utf-8')).toBe('# Report');
    expect(written).toEqual([{ agent: '07-validator', path: join(RUN_DIR, 'VALIDATION_REPORT.md') }]);
    expect(output.details.artifacts[0].path).toBe(join(RUN_DIR, 'VALIDATION_REPORT.md'));
  });

  it('a system path the agent supplies (/etc/...) is ignored: nothing is written there', () => {
    const supplied = '/etc/ff-never-written/VALIDATION_REPORT.md';
    const output = validatorWith([{ name: 'VALIDATION_REPORT.md', path: supplied }]);

    expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).not.toThrow();

    expect(existsSync(supplied)).toBe(false);
    expect(existsSync(join(projectDir, RUN_DIR, 'VALIDATION_REPORT.md'))).toBe(true);
  });

  it('a name/path mismatch is saved under the artifact NAME, and readArtifactContents finds it by name', () => {
    const output = spec();
    output.details.artifacts = [
      { name: 'TECHNICAL_BRIEF.md', path: 'docs/brief.md', description: 'Brief', content: '# Brief' }
    ];

    persistArtifacts({ spec: output }, projectDir, RUN_DIR);

    expect(readFileSync(join(projectDir, RUN_DIR, 'TECHNICAL_BRIEF.md'), 'utf-8')).toBe('# Brief');
    expect(existsSync(join(projectDir, RUN_DIR, 'brief.md'))).toBe(false);
    expect(existsSync(join(projectDir, 'docs/brief.md'))).toBe(false);
    expect(readArtifactContents({ spec: output }, projectDir, RUN_DIR)['TECHNICAL_BRIEF.md']).toBe('# Brief');
  });

  it.each(['../evil.md', '../../evil.md', 'sub/evil.md', 'sub\\evil.md', '/tmp/evil.md', '..', '.', ''])(
    'FAILS CLOSED on an artifact name that is not a plain filename (%p): throws, writes nothing',
    name => {
      const output = validatorWith([
        { name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md' },
        { name, path: 'whatever.md' }
      ]);

      expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).toThrow(UnsafeArtifactPathError);

      // Validated before anything is written: not even the safe sibling is on disk.
      expect(existsSync(join(projectDir, RUN_DIR))).toBe(false);
      expect(existsSync(join(projectDir, '.factory', 'evil.md'))).toBe(false);
      expect(existsSync(join(projectDir, 'evil.md'))).toBe(false);
    }
  );

  it.each([
    'state.json',
    'STATE.JSON',
    'baseline.json',
    'Baseline.Json',
    'BACKEND_SUMMARY.md',
    'backend_summary.md',
    'API_CONTRACT.MD',
    'Frontend_Summary.md',
    'TEST_REPORT.md',
    'test_report.md',
    '_archive',
    '_ARCHIVE',
    '_superseded',
    '_Superseded',
    '.hidden.md',
    '.DS_Store'
  ])('NEW-MINOR-2 the reserved artifact name %s is refused in any letter case', name => {
    const output = validatorWith([
      { name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md' },
      { name, path: name }
    ]);

    expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).toThrow(UnsafeArtifactPathError);
    expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).toThrow(/reserved/);

    // Refused before anything is written: not even the safe sibling is on disk.
    expect(existsSync(join(projectDir, RUN_DIR))).toBe(false);
  });

  it('NEW-MINOR-2 a name that merely contains a reserved word is still an ordinary document', () => {
    const output = validatorWith([{ name: 'MY_TEST_REPORT.md', path: 'x' }, { name: 'state.json.md', path: 'y' }]);

    persistArtifacts({ validator: output }, projectDir, RUN_DIR);

    expect(existsSync(join(projectDir, RUN_DIR, 'MY_TEST_REPORT.md'))).toBe(true);
    expect(existsSync(join(projectDir, RUN_DIR, 'state.json.md'))).toBe(true);
  });

  it('without a run dir (legacy), an absolute path is refused, not honoured', () => {
    const supplied = join(elsewhere, 'RESEARCHER_REPORT.md');
    const output = researcherOutput();
    output.details.artifacts = [{ name: 'RESEARCHER_REPORT.md', path: supplied, description: 'R', content: '# R' }];

    expect(() => persistArtifacts({ researcher: output }, projectDir)).toThrow(UnsafeArtifactPathError);
    expect(existsSync(supplied)).toBe(false);
  });

  it('without a run dir (legacy), a relative path that escapes cwd is refused', () => {
    const output = researcherOutput();
    output.details.artifacts = [
      { name: 'RESEARCHER_REPORT.md', path: '../ff-escaped-RESEARCHER_REPORT.md', description: 'R', content: '# R' }
    ];

    expect(() => persistArtifacts({ researcher: output }, projectDir)).toThrow(UnsafeArtifactPathError);
    expect(existsSync(join(projectDir, '..', 'ff-escaped-RESEARCHER_REPORT.md'))).toBe(false);
  });

  it('without a run dir (legacy), a relative path inside cwd is still written where it says', () => {
    const output = researcherOutput();
    output.details.artifacts = [{ name: 'RESEARCHER_REPORT.md', path: 'docs/R.md', description: 'R', content: '# R' }];

    persistArtifacts({ researcher: output }, projectDir);

    expect(readFileSync(join(projectDir, 'docs/R.md'), 'utf-8')).toBe('# R');
  });
});

describe('persistArtifacts never writes through a symlink (NEW-MINOR-1)', () => {
  const RUN_DIR = '.factory/run-1';
  let elsewhere: string;

  beforeEach(() => {
    elsewhere = mkdtempSync(join(tmpdir(), 'ff-elsewhere-'));
  });

  afterEach(() => {
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('NEW-MINOR-1 persistArtifacts refuses to write through a symlink in the run directory', () => {
    // A builder (Write/Bash) plants VALIDATION_REPORT.md -> a file outside the project.
    const victim = join(elsewhere, 'victim.txt');
    writeFileSync(victim, 'untouched');
    mkdirSync(join(projectDir, RUN_DIR), { recursive: true });
    symlinkSync(victim, join(projectDir, RUN_DIR, 'VALIDATION_REPORT.md'));

    const output = validator();
    output.details.artifacts = [
      { name: 'TEST_NOTES.md', path: 'TEST_NOTES.md', description: 'x', content: '# Notes' },
      { name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md', description: 'x', content: '# Report' }
    ];

    expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).toThrow(UnsafeArtifactPathError);

    expect(readFileSync(victim, 'utf-8')).toBe('untouched');
    // Checked before anything is written: the safe sibling is not on disk either.
    expect(existsSync(join(projectDir, RUN_DIR, 'TEST_NOTES.md'))).toBe(false);
  });

  it('refuses a run directory that is a symlink resolving outside the project', () => {
    mkdirSync(join(projectDir, '.factory'), { recursive: true });
    symlinkSync(elsewhere, join(projectDir, RUN_DIR));

    const output = validator();
    output.details.artifacts = [
      { name: 'VALIDATION_REPORT.md', path: 'VALIDATION_REPORT.md', description: 'x', content: '# Report' }
    ];

    expect(() => persistArtifacts({ validator: output }, projectDir, RUN_DIR)).toThrow(UnsafeArtifactPathError);
    expect(existsSync(join(elsewhere, 'VALIDATION_REPORT.md'))).toBe(false);
  });
});

describe('the follow-up and skeptic documents are persisted by the harness (AC-127, D-6)', () => {
  it('AC-127 persistArtifacts writes VALIDATION_FOLLOWUP.md and a skeptic document into the run directory, beside the Validator report', () => {
    const RUN_DIR = '.factory/run-1';
    const review = skeptic()({ stage: 4, agent: '07c-validator-skeptic', prompt: 'Echo issueKey `0123456789ab`.' });

    const written = persistArtifacts(
      { validator: validator(), validatorFollowup: followup({ files: ['test/a.test.ts'] }), skeptic: review },
      projectDir,
      RUN_DIR
    );

    expect(written).toEqual([
      { agent: '07-validator', path: join(RUN_DIR, 'VALIDATION_REPORT.md') },
      { agent: '07b-validator-followup', path: join(RUN_DIR, 'VALIDATION_FOLLOWUP.md') },
      { agent: '07c-validator-skeptic', path: join(RUN_DIR, 'SKEPTIC_REVIEW.md') }
    ]);
    expect(readFileSync(join(projectDir, RUN_DIR, 'VALIDATION_REPORT.md'), 'utf-8')).toBe('# Validation Report\n\nNo critical issues.');
    expect(readFileSync(join(projectDir, RUN_DIR, 'VALIDATION_FOLLOWUP.md'), 'utf-8')).toMatch(/^# Validation Follow-up/);
    expect(readFileSync(join(projectDir, RUN_DIR, 'SKEPTIC_REVIEW.md'), 'utf-8')).toMatch(/^# Skeptic Review/);
  });
});
