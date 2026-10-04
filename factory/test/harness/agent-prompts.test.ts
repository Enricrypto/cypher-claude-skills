/**
 * The prompt builders (D-8), unit-level. The end-to-end assertions (AC-24, AC-28) live in
 * upstream-artifacts.test.ts; these pin each builder's own contract against a hand-made run dir.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  builderPrompt,
  consolidatorPrompt,
  PromptContext,
  researcherPrompt,
  retryBriefing,
  specPrompt,
  storyPrompt,
  testVerifierPrompt,
  validatorBriefing,
  validatorPrompt
} from '../../harness/agent-prompts';
import { ARCHIVE_RULE, UpstreamArtifact } from '../../harness/upstream-artifacts';
import { tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;
let ctx: PromptContext;

beforeEach(() => {
  project = tempProject('ff-prompts-');
  ctx = { cwd: project.dir, artifactDir: '.factory/run-1', featureDescription: 'add 2FA' };
});

afterEach(() => {
  project.cleanup();
});

function onDisk(...names: UpstreamArtifact[]): void {
  const dir = join(project.dir, ctx.artifactDir);
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), `# ${name}`);
}

const abs = (name: string) => join(project.dir, '.factory/run-1', name);

describe('agent prompts', () => {
  it('every prompt carries the run-directory rules, even with nothing upstream on disk', () => {
    const prompts = [
      researcherPrompt(ctx),
      storyPrompt(ctx),
      specPrompt(ctx),
      builderPrompt(ctx, 'backend', 1),
      builderPrompt(ctx, 'frontend', 1),
      testVerifierPrompt(ctx),
      validatorPrompt(ctx),
      consolidatorPrompt(ctx)
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain(ARCHIVE_RULE);
      expect(prompt).toContain(join(project.dir, '.factory/run-1'));
    }
  });

  it('the researcher prompt names the feature and no upstream document', () => {
    const prompt = researcherPrompt(ctx);

    expect(prompt).toContain('Analyze the codebase for feature: "add 2FA"');
    expect(prompt).not.toMatch(/RESEARCHER_REPORT\.md|USER_STORY\.md/);
  });

  it('the story prompt points at the researcher report by absolute path when it exists', () => {
    onDisk('RESEARCHER_REPORT.md');

    const prompt = storyPrompt(ctx);

    expect(prompt).toContain(abs('RESEARCHER_REPORT.md'));
    expect(prompt).toMatch(/USER_STORY\.md into artifacts\[\]\.content/);
  });

  it('the spec prompt names only the upstream documents that exist (pre-supplied run without a researcher)', () => {
    onDisk('USER_STORY.md');

    const prompt = specPrompt(ctx);

    expect(prompt).toContain(abs('USER_STORY.md'));
    expect(prompt).not.toContain('RESEARCHER_REPORT.md');
  });

  it('the backend builder prompt keeps its wording and names the four plan documents by absolute path', () => {
    onDisk('RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md');

    const prompt = builderPrompt(ctx, 'backend', 1);

    expect(prompt).toContain('Implement the backend for the APPROVED technical brief of this feature.');
    expect(prompt).toContain(`THE APPROVED BRIEF IS: ${abs('TECHNICAL_BRIEF.md')}`);
    expect(prompt).toContain(abs('USER_STORY.md'));
    expect(prompt).toContain(abs('FILE_LIST.md'));
    expect(prompt).toContain(abs('RESEARCHER_REPORT.md'));
    expect(prompt).toContain('Your scope ends at the API contract. Do not touch frontend files.');
    expect(prompt).not.toMatch(/attempt \d of 3/);
  });

  it('the frontend builder prompt adds the harness-generated backend summary and API contract', () => {
    onDisk('RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md', 'BACKEND_SUMMARY.md', 'API_CONTRACT.md');

    const prompt = builderPrompt(ctx, 'frontend', 1);

    expect(prompt).toContain(abs('BACKEND_SUMMARY.md'));
    expect(prompt).toContain(abs('API_CONTRACT.md'));
    expect(prompt).toMatch(/do not invent endpoints/);
  });

  it('the builder prompt appends the retry briefing from attempt 2', () => {
    const prompt = builderPrompt(ctx, 'backend', 2, { kind: 'schema', error: 'details.testing missing' });

    expect(prompt).toMatch(/attempt 2 of 3/);
    expect(prompt).toContain('details.testing missing');
  });

  it('the Test Verifier prompt says the harness renders TEST_REPORT.md and the agent must not write one', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'BACKEND_SUMMARY.md');

    const prompt = testVerifierPrompt(ctx);

    expect(prompt).toMatch(/harness renders TEST_REPORT\.md/);
    expect(prompt).toMatch(/do not write (a )?TEST_REPORT\.md/i);
    expect(prompt).toContain(abs('USER_STORY.md'));
    expect(prompt).toContain(abs('BACKEND_SUMMARY.md'));
    expect(prompt).not.toContain('FRONTEND_SUMMARY.md');
    expect(prompt).not.toContain('API_CONTRACT.md');
  });

  it('the Validator prompt marks the harness-generated summaries as derived, not as the builders\' claims verified', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'BACKEND_SUMMARY.md', 'API_CONTRACT.md', 'TEST_REPORT.md');

    const prompt = validatorPrompt(ctx);

    expect(prompt).toContain(abs('BACKEND_SUMMARY.md'));
    expect(prompt).toContain(abs('TEST_REPORT.md'));
    expect(prompt).toMatch(/harness-generated/i);
    expect(prompt).toMatch(/VALIDATION_REPORT\.md/);
    expect(prompt).not.toContain('FRONTEND_SUMMARY.md');
  });

  it('the Consolidator prompt lists every run-dir document including VALIDATION_REPORT.md', () => {
    onDisk('RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md', 'VALIDATION_REPORT.md');

    const prompt = consolidatorPrompt(ctx);

    for (const name of ['RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md', 'VALIDATION_REPORT.md']) {
      expect(prompt).toContain(abs(name));
    }
    expect(prompt).not.toContain('TEST_REPORT.md');
  });
});

describe('retryBriefing', () => {
  it('is empty on the first attempt', () => {
    expect(retryBriefing(1, { kind: 'test', error: 'boom' })).toBe('');
  });

  it('says plainly when the failure could not be classified', () => {
    expect(retryBriefing(2)).toMatch(/could not classify why/);
  });
});

describe('validator-round briefing (D-9)', () => {
  const round = {
    kind: 'validator' as const,
    round: 1,
    maxRounds: 2,
    issues: [
      { severity: 'CRITICAL' as const, file: 'src/a.ts', line: 7, message: 'Route has no auth check', suggestion: 'Add the guard', canFix: true },
      { severity: 'CRITICAL' as const, file: 'src/b.ts', message: 'Secret in source', suggestion: 'Read it from env', canFix: true }
    ]
  };

  it('names the round and lists each issue as [file:line] message — suggestion', () => {
    const briefing = validatorBriefing(round);

    expect(briefing).toContain('Validator round 1 of 2');
    expect(briefing).toContain('[src/a.ts:7] Route has no auth check — Add the guard');
    expect(briefing).toContain('[src/b.ts] Secret in source — Read it from env');
  });

  it('is in the builder prompt from attempt 1 of the round, with no Stage 3 retry header', () => {
    const prompt = builderPrompt(ctx, 'backend', 1, undefined, round);

    expect(prompt).toContain('Validator round 1 of 2');
    expect(prompt).toContain('[src/a.ts:7] Route has no auth check — Add the guard');
    expect(prompt).not.toMatch(/attempt \d of 3/);
  });

  it('a validator failure passed as the previous failure is briefed on attempt 1 too', () => {
    expect(builderPrompt(ctx, 'frontend', 1, round)).toContain('Validator round 1 of 2');
  });

  it('on attempts 2-3 of a round adds the usual test/schema briefing', () => {
    const prompt = builderPrompt(ctx, 'backend', 2, { kind: 'schema', error: 'details.testing missing' }, round);

    expect(prompt).toContain('Validator round 1 of 2');
    expect(prompt).toMatch(/attempt 2 of 3/);
    expect(prompt).toContain('details.testing missing');
  });

  it('a Stage 3 prompt mentions no validator round', () => {
    expect(builderPrompt(ctx, 'backend', 2, { kind: 'test', error: 'boom' })).not.toMatch(/Validator round/);
  });
});
