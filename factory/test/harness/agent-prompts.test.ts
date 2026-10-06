/**
 * The prompt builders (D-8), unit-level. The end-to-end assertions (AC-24, AC-28) live in
 * upstream-artifacts.test.ts; these pin each builder's own contract against a hand-made run dir.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  builderPrompt,
  CheckpointRework,
  checkpointReworkBriefing,
  consolidatorPrompt,
  followupPrompt,
  PromptContext,
  researcherPrompt,
  retryBriefing,
  skepticPrompt,
  SkepticPromptInput,
  specPrompt,
  storyPrompt,
  testVerifierPrompt,
  validatorBriefing,
  validatorPrompt
} from '../../harness/agent-prompts';
import { ARCHIVE_RULE, UpstreamArtifact } from '../../harness/upstream-artifacts';
import { tempProject, TempProject } from '../fixtures/harness-run';
import { echoedIssueKey, skeptic } from '../fixtures/agent-outputs';
import { ValidatorIssue } from '../../harness/agent-output-schema';
import { describeIssue } from '../../harness/validator-routing';
import type { ReviewSource } from '../../harness/state-tracker';
import { TEST_DIRECTORY_NAMES, TEST_FILE_NAME_PATTERNS } from '../../harness/test-paths';

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

/** A review copy beside the project (PR B-2 D-3): a snapshot source unless `source` is given. */
const SNAPSHOT_SOURCE: ReviewSource = {
  kind: 'snapshot',
  n: 2,
  ref: 'refs/factory/run-1/stage3-2',
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40)
};
const review = (source: ReviewSource = SNAPSHOT_SOURCE) => {
  const dir = `${project.dir}-review`;
  mkdirSync(dir, { recursive: true });
  return { dir, source };
};

describe('agent prompts', () => {
  it('every prompt carries the run-directory rules, even with nothing upstream on disk', () => {
    const prompts = [
      researcherPrompt(ctx),
      storyPrompt(ctx),
      specPrompt(ctx),
      builderPrompt(ctx, 'backend', 1),
      builderPrompt(ctx, 'frontend', 1),
      testVerifierPrompt(ctx),
      validatorPrompt(ctx, review()),
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

  it('AC-90 AC-91 D-B2-4 the builder prompt says run only related tests, Gate 2 runs the full suite, never commit, push, switch branches or write under .git/ or .factory/, and the harness snapshots the work', () => {
    // B2 is an instruction (AC-91): the prompt tells the builder; Gate 2's full suite enforces.
    // D-B2-4: these rules are the program's only, so the prompt carries them, not contracts 04 and 05.
    const relatedTests = 'Run only the tests related to the files you changed; the harness runs the full suite in Gate 2.';
    const neverGit = 'Never commit, push or switch branches, and never write under .git/ or .factory/.';
    const snapshots = 'The harness snapshots your work itself.';
    const prompts = [
      builderPrompt(ctx, 'backend', 1),
      builderPrompt(ctx, 'frontend', 1),
      builderPrompt(ctx, 'backend', 2, { kind: 'test', error: 'boom' }),
      builderPrompt(ctx, 'frontend', 3, { kind: 'schema', error: 'bad' })
    ];

    for (const prompt of prompts) {
      const lines = prompt.split('\n');
      expect(lines).toContain(relatedTests);
      expect(lines).toContain(neverGit);
      // Both lines follow the scope line, before any briefing.
      const scope = lines.findIndex(line => /^(Your scope ends at the API contract|The backend is already built)/.test(line));
      expect(scope).toBeGreaterThanOrEqual(0);
      expect(lines.slice(scope + 1, scope + 4)).toEqual([relatedTests, neverGit, snapshots]);
    }
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

  it('D-B2-4 N-3 I-4 the Test Verifier prompt carries the test-path rule from test-paths.ts, and that a change outside a test path escalates', () => {
    // The rule left contract 06 (by hand there is no measurement); the prompt states it from the
    // one definition, so the list cannot drift from isTestPath.
    const prompt = testVerifierPrompt(ctx);
    const text = prompt.replace(/\n/g, ' ');

    expect(prompt).toContain('Where you may write: test paths only.');
    expect(text).toContain(`a directory in it (not the file name) is one of ${TEST_DIRECTORY_NAMES.join(', ')};`);
    expect(text).toContain(`or the file name matches ${TEST_FILE_NAME_PATTERNS.join(', ')}.`);
    expect(text).toContain('A directory named e2e/ alone does not make a path a test path.');
    expect(text).toContain(
      'If you change any file outside a test path (a deletion counts), the run escalates and names the files; ' +
        'a human must revert them before the run can continue.'
    );
    expect(text).toContain('The test files you change are then reviewed by a follow-up reviewer.');
  });

  it('D-B2-4 the main Validator prompt says it gets no test report, that Gate 2 runs the full suite and that a follow-up review covers the new tests', () => {
    const prompt = validatorPrompt(ctx, review());

    expect(prompt).toContain(
      'You get no test report: the Test Verifier runs at the same time as you. Gate 2 runs the full suite, ' +
        'and a separate follow-up review covers the tests the Test Verifier writes.'
    );
    expect(prompt).not.toContain('TEST_REPORT.md');
  });

  it('the Validator prompt marks the harness-generated summaries as derived, not as the builders\' claims verified', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'BACKEND_SUMMARY.md', 'API_CONTRACT.md', 'TEST_REPORT.md');

    const prompt = validatorPrompt(ctx, review());

    expect(prompt).toContain(abs('BACKEND_SUMMARY.md'));
    expect(prompt).not.toContain('TEST_REPORT.md');
    expect(prompt).toMatch(/harness-generated/i);
    expect(prompt).toMatch(/VALIDATION_REPORT\.md/);
    expect(prompt).not.toContain('FRONTEND_SUMMARY.md');
  });

  it('AC-120 the main Validator prompt names the copy as a read-only snapshot, names only paths that exist, and never TEST_REPORT.md', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'BACKEND_SUMMARY.md', 'TEST_REPORT.md');
    const copy = review();

    const prompt = validatorPrompt(ctx, copy);

    expect(prompt).toContain(
      `Review the implementation in ${copy.dir}. It is a READ-ONLY SNAPSHOT of the project taken after the Stage 3 gate passed: ` +
        `stage3-2, refs/factory/run-1/stage3-2, commit ${'a'.repeat(40)}. It is your working directory.`
    );
    expect(prompt).toContain(`not the live project at ${project.dir}`);
    expect(prompt).toContain('Do not run anything.');
    expect(prompt).toContain(`Report file paths relative to ${copy.dir}.`);
    expect(prompt).not.toContain('TEST_REPORT.md');
    // Every absolute path the prompt names exists now (AC-24 holds).
    const paths = prompt.match(/\/[^\s,()]+/g) ?? [];
    const named = paths.map(path => path.replace(/[.:]$/, '')).filter(path => path.startsWith(project.dir));
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  });

  it('AC-120 AC-126 with the fallback copy the prompt names it as a read-only copy of the working tree made before the Test Verifier started, with the reason', () => {
    const copy = review({ kind: 'working-tree', reason: 'not a git work tree' });

    const prompt = validatorPrompt(ctx, copy);

    expect(prompt).toContain(
      `Review the implementation in ${copy.dir}. It is a read-only copy of the working tree made before the Test Verifier started (not a git work tree). It is your working directory.`
    );
    expect(prompt).not.toMatch(/SNAPSHOT/);
    expect(() => validatorPrompt(ctx, { dir: 'relative/copy', source: SNAPSHOT_SOURCE })).toThrow(RangeError);
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

  it('AC-72 counts against the allowed attempts: a granted 4th attempt is "attempt 4 of 4"', () => {
    expect(retryBriefing(2)).toMatch(/attempt 2 of 3\./);
    expect(retryBriefing(4, { kind: 'test', error: 'boom' }, 4)).toMatch(/attempt 4 of 4\./);
  });

  it('MINOR-6 a status failure is briefed as an unfinished attempt, with the builder\'s own words, not as a test diagnosis', () => {
    const briefing = retryBriefing(2, { kind: 'status', error: 'Builder returned status FAIL: could not wire the route' });
    expect(briefing).toMatch(/attempt 2 of 3\./);
    expect(briefing).toContain('Builder returned status FAIL: could not wire the route');
    expect(briefing).toMatch(/did not report the work as done/);
    expect(briefing).not.toMatch(/MALFORMED/);
    expect(briefing).not.toMatch(/failing test/);
  });

  it('AC-72 builderPrompt passes the allowed attempts through to the retry briefing', () => {
    expect(builderPrompt(ctx, 'backend', 4, { kind: 'schema', error: 'bad' }, undefined, { attemptsAllowed: 5 })).toMatch(/attempt 4 of 5\./);
    expect(builderPrompt(ctx, 'backend', 2, { kind: 'schema', error: 'bad' })).toMatch(/attempt 2 of 3\./);
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

describe('checkpoint rework briefing (D-5, AC-75)', () => {
  const superseded = (name: string) => join(project.dir, '.factory/run-1/_superseded/1', name);
  const rework = (overrides: Partial<CheckpointRework> = {}): CheckpointRework => ({
    checkpointName: 'CHECKPOINT 1: Approve the story',
    notes: 'Cover account recovery.\nAnd lockout.',
    rejectedPaths: [superseded('USER_STORY.md')],
    ...overrides
  });

  it('AC-75 names what was rejected, quotes every line of the notes and gives the rejected version\'s absolute path', () => {
    const briefing = checkpointReworkBriefing(rework());

    expect(briefing).toContain('CHECKPOINT 1: Approve the story');
    expect(briefing).toContain('  > Cover account recovery.');
    expect(briefing).toContain('  > And lockout.');
    expect(briefing).toContain(superseded('USER_STORY.md'));
  });

  it('AC-75 says plainly when the reviewer gave no notes (a TTY rejection may have none)', () => {
    expect(checkpointReworkBriefing(rework({ notes: '  ' }))).toMatch(/no notes were given/);
  });

  it('AC-75 the story prompt for a rework carries the briefing; a normal story prompt does not', () => {
    expect(storyPrompt(ctx, rework())).toContain(checkpointReworkBriefing(rework()));
    expect(storyPrompt(ctx)).not.toMatch(/REWORK/);
  });

  it('AC-75 the spec prompt for a rework carries the briefing; a normal spec prompt does not', () => {
    const brief = rework({ checkpointName: 'CHECKPOINT 2: Approve the technical brief', rejectedPaths: [superseded('TECHNICAL_BRIEF.md'), superseded('FILE_LIST.md')] });
    expect(specPrompt(ctx, brief)).toContain(checkpointReworkBriefing(brief));
    expect(specPrompt(ctx)).not.toMatch(/REWORK/);
  });

  it('AC-75 a builder in a CP3 rework is briefed from attempt 1, and later attempts add the usual retry briefing', () => {
    const change = rework({ checkpointName: 'CHECKPOINT 3: Approve the validated change', rejectedPaths: [superseded('VALIDATION_REPORT.md')] });

    const first = builderPrompt(ctx, 'backend', 1, undefined, undefined, { rework: change });
    expect(first).toContain(checkpointReworkBriefing(change));
    expect(first).not.toMatch(/attempt \d of/);

    const second = builderPrompt(ctx, 'backend', 2, { kind: 'test', error: 'boom' }, undefined, { rework: change, attemptsAllowed: 3 });
    expect(second).toContain(checkpointReworkBriefing(change));
    expect(second).toMatch(/attempt 2 of 3\./);

    expect(builderPrompt(ctx, 'backend', 1)).not.toMatch(/REWORK/);
  });
});

describe('follow-up prompt (PR B-2, D-5)', () => {
  const files = [
    { path: 'test/login.test.ts', deleted: false },
    { path: 'src/__tests__/old.test.ts', deleted: true }
  ];

  it('AC-121 lists exactly the given files as absolute paths in the live project, and marks the deleted ones', () => {
    const prompt = followupPrompt(ctx, files);
    const listed = prompt.split('\n').filter((line: string) => line.startsWith('  - ') && !line.includes('.factory'));

    expect(listed).toEqual([
      `  - ${join(project.dir, 'test/login.test.ts')}`,
      `  - ${join(project.dir, 'src/__tests__/old.test.ts')} (deleted)`
    ]);
    expect(prompt).toContain(`in the live project at ${project.dir}`);
    expect(prompt).toContain('The Test Verifier wrote or changed exactly these files in this verification cycle, each measured against the project as it was before the Test Verifier ran.');
  });

  it('AC-121 includes TEST_REPORT.md when it is on disk, and names no document that is not', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'TEST_REPORT.md');

    const prompt = followupPrompt(ctx, files);

    expect(prompt).toContain(abs('TEST_REPORT.md'));
    expect(prompt).toContain(abs('USER_STORY.md'));
    expect(prompt).not.toContain('FRONTEND_SUMMARY.md');
    expect(prompt).not.toContain('VALIDATION_REPORT.md');
  });

  it('AC-121 without TEST_REPORT.md on disk the prompt does not name it', () => {
    onDisk('USER_STORY.md');

    expect(followupPrompt(ctx, files)).not.toContain('TEST_REPORT.md');
  });

  it('AC-121 names VALIDATION_FOLLOWUP.md and the filesReviewed rule with the project-relative paths', () => {
    const prompt = followupPrompt(ctx, files);

    expect(prompt).toContain('Return VALIDATION_FOLLOWUP.md');
    expect(prompt).toContain(
      '`filesReviewed` lists exactly these project-relative paths: test/login.test.ts, src/__tests__/old.test.ts.'
    );
  });

  it('AC-28 the follow-up prompt ends with the run-directory rules', () => {
    const prompt = followupPrompt(ctx, files);

    expect(prompt).toContain(ARCHIVE_RULE);
    expect(prompt.endsWith(`ignore it completely: do not\nread it, do not reconcile it, do not treat it as a revision.`)).toBe(true);
  });

  it('refuses an empty file list: a follow-up runs only on files the Test Verifier changed', () => {
    expect(() => followupPrompt(ctx, [])).toThrow(RangeError);
  });
});

describe('skeptic prompt (PR B-2, D-5, D-11)', () => {
  const issue: ValidatorIssue = {
    severity: 'CRITICAL',
    message: 'the token is compared with ==, not in constant time',
    suggestion: 'use crypto.timingSafeEqual',
    canFix: true,
    file: 'src/auth.ts',
    line: 42
  };
  const treeDir = '/tmp/factory-review-run-1-e1-abc';
  const input = (instance: 'A' | 'B', extra: Partial<SkepticPromptInput> = {}): SkepticPromptInput => ({
    instance,
    issueKey: '0123456789ab',
    origin: '07-validator',
    issue,
    treeDir,
    ...extra
  });

  it('AC-128 the A and B prompts differ only in the instance letter', () => {
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md');
    const a = skepticPrompt(ctx, input('A')).split('\n');
    const b = skepticPrompt(ctx, input('B')).split('\n');

    expect(a).toHaveLength(b.length);
    const differing = a.map((line: string, i: number) => [line, b[i]] as const).filter(([x, y]) => x !== y);
    expect(differing).toEqual([['You are skeptic A.', 'You are skeptic B.']]);
  });

  it('AC-128 contains the issue as describeIssue renders it, its severity and the Echo issueKey line', () => {
    const prompt = skepticPrompt(ctx, input('A'));

    expect(prompt).toContain(describeIssue(issue));
    expect(prompt).toContain('Severity: CRITICAL');
    expect(prompt.split('\n')).toContain('Echo issueKey `0123456789ab`.');
  });

  it('AC-132 names the tree as the working directory, read-only, and the reviewer that reported the issue', () => {
    const prompt = skepticPrompt(ctx, input('A'));

    expect(prompt).toContain(`reported by 07-validator about the code in ${treeDir} (your working directory; read-only)`);
    const followup = skepticPrompt(ctx, input('A', { origin: '07b-validator-followup', treeDir: project.dir }));
    expect(followup).toContain(
      `reported by 07b-validator-followup about the code in ${project.dir} (your working directory; read-only)`
    );
  });

  it('AC-128 holds no recorded verdict: DISPROVED and UPHELD appear only in the instruction, and no other skeptic document is named', () => {
    // A skeptic document and a validation report already in the run directory, as after skeptic A.
    onDisk('USER_STORY.md', 'TECHNICAL_BRIEF.md', 'VALIDATION_REPORT.md');
    writeFileSync(
      join(project.dir, ctx.artifactDir, 'SKEPTIC_E1_0123456789ab_A.md'),
      '# Skeptic Review\n\nDISPROVED: skeptic A found the guard at src/auth.ts:40'
    );

    const prompt = skepticPrompt(ctx, input('B'));

    expect(prompt.match(/DISPROVED/g)).toHaveLength(1);
    expect(prompt.match(/UPHELD/g)).toHaveLength(1);
    expect(prompt).toContain('Default to UPHELD. Return DISPROVED only when');
    expect(prompt).not.toMatch(/SKEPTIC_E\d/);
    expect(prompt).not.toContain('skeptic A found');
    expect(prompt).not.toContain('VALIDATION_REPORT.md');
  });

  it('IMPORTANT-3 tells both skeptics not to read state.json or any SKEPTIC_* document, in the prompt and in contract 07c', () => {
    const rule = "Do not read this run's `state.json` or any `SKEPTIC_*` document: decide without the other skeptic's verdict.";
    for (const instance of ['A', 'B'] as const) expect(skepticPrompt(ctx, input(instance)).split('\n')).toContain(rule);

    const contract = readFileSync(join(__dirname, '..', '..', 'feature', 'agents', '07c-validator-skeptic.md'), 'utf8');
    expect(contract).toMatch(/Do not read the run's `state\.json` or any `SKEPTIC_\*` document/);
  });

  it('D-5 names only the user story and the technical brief as upstream documents, and ends with the run-directory rules', () => {
    onDisk('RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md', 'TEST_REPORT.md');

    const prompt = skepticPrompt(ctx, input('A'));

    expect(prompt).toContain(abs('USER_STORY.md'));
    expect(prompt).toContain(abs('TECHNICAL_BRIEF.md'));
    for (const name of ['RESEARCHER_REPORT.md', 'FILE_LIST.md', 'TEST_REPORT.md']) {
      expect(prompt).not.toContain(name);
    }
    expect(prompt).toContain(ARCHIVE_RULE);
    expect(prompt.endsWith(`ignore it completely: do not\nread it, do not reconcile it, do not treat it as a revision.`)).toBe(true);
  });

  it('AC-134 the step-1 skeptic fixture echoes the key it reads from a real skeptic prompt', () => {
    const prompt = skepticPrompt(ctx, input('A'));

    expect(echoedIssueKey(prompt)).toBe('0123456789ab');
    const output = skeptic()({ stage: 4, agent: '07c-validator-skeptic', prompt });
    expect(output.details.issueKey).toBe('0123456789ab');
  });

  it.each([
    ['a non-CRITICAL issue', { issue: { ...issue, severity: 'IMPORTANT' as const } }],
    ['an empty issue key', { issueKey: '' }],
    ['an issue key with a backtick', { issueKey: 'ab`c' }],
    ['a relative tree directory', { treeDir: 'review-copy' }]
  ])('AC-128 refuses %s', (_name, extra) => {
    expect(() => skepticPrompt(ctx, input('A', extra as Partial<SkepticPromptInput>))).toThrow(RangeError);
  });
});
