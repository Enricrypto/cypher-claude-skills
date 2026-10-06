/**
 * Checkpoint presentation (A-2, D-4): the hash an approval is bound to (AC-50, step 1), the
 * CP1/CP2 presentation text (AC-43, step 4) and the CP3 text (AC-43, AC-44, step 5).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'crypto';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CheckpointPresentationError,
  CP2_FILE_LIST_SEPARATOR,
  CP3_FOLLOWUP_DOCUMENT,
  presentationFor,
  presentBrief,
  presentChange,
  presentStory,
  sha256Hex
} from '../../harness/checkpoint-presentation';
import { ChangeSet } from '../../harness/change-diff';
import { ChangeBase, ImportantFinding, Stage3Snapshot } from '../../harness/state-tracker';
import { directionCharacterPattern, escapeCodePoint, escapeDirectionCharacters } from '../../harness/direction-characters';
import { tempProject } from '../fixtures/harness-run';

describe('Checkpoint presentation (D-4)', () => {
  it('AC-50 sha256Hex is the SHA-256 of the exact UTF-8 bytes', () => {
    // FIPS 180-2 test vectors.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // UTF-8, not UTF-16 or Latin-1: 'é' is the two bytes C3 A9.
    const utf8 = createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex');
    expect(sha256Hex('é')).toBe(utf8);
  });

  it('AC-50 sha256Hex hashes the bytes as given: no newline, whitespace or Unicode normalisation', () => {
    expect(sha256Hex('a\nb')).not.toBe(sha256Hex('a\r\nb'));
    expect(sha256Hex('a')).not.toBe(sha256Hex('a\n'));
    // NFC 'é' (U+00E9) and NFD 'e' + U+0301 render alike but are different bytes.
    expect(sha256Hex('é')).not.toBe(sha256Hex('é'));
  });

  it('AC-50 sha256Hex is lowercase hex, 64 characters, and deterministic', () => {
    const text = '# USER_STORY\n\nAC-1 something\n';
    expect(sha256Hex(text)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(text)).toBe(sha256Hex(text));
  });

  it('AC-50 sha256Hex refuses a value that is not a string (fails closed)', () => {
    expect(() => sha256Hex(undefined as unknown as string)).toThrow(TypeError);
    expect(() => sha256Hex(Buffer.from('abc') as unknown as string)).toThrow(TypeError);
  });
});

describe('CP1 and CP2 presentation (D-4, step 4)', () => {
  let runDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const project = tempProject('ff-cpr-');
    cleanup = project.cleanup;
    runDir = join(project.dir, '.factory', 'run-1');
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => cleanup());

  const STORY = '# User Story\r\n\nGiven a\nWhen b\nThen c\n\n  trailing spaces  \n';
  const BRIEF = '# Technical Brief\n\nTOTP via speakeasy.';
  const FILES = '# Files\n\n- src/a.ts (CREATE)\n';

  it('AC-43 CP1 presents the exact bytes of USER_STORY.md, hashed, with its absolute path', () => {
    writeFileSync(join(runDir, 'USER_STORY.md'), STORY);

    const presentation = presentStory(runDir);

    expect(presentation.text).toBe(STORY);
    expect(presentation.sha256).toBe(sha256Hex(STORY));
    expect(presentation.artifactPaths).toEqual([join(runDir, 'USER_STORY.md')]);
  });

  it('AC-43 I-5 CP2 presents TECHNICAL_BRIEF.md, then the FILE_LIST.md separator, then FILE_LIST.md', () => {
    writeFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), BRIEF);
    writeFileSync(join(runDir, 'FILE_LIST.md'), FILES);

    const presentation = presentBrief(runDir);

    expect(presentation.text).toBe(`${BRIEF}\n\n---\n\n## FILE_LIST.md\n\n${FILES}`);
    expect(presentation.sha256).toBe(sha256Hex(presentation.text));
    expect(presentation.artifactPaths).toEqual([join(runDir, 'TECHNICAL_BRIEF.md'), join(runDir, 'FILE_LIST.md')]);
  });

  it('AC-50 two presentations of the same files give the same hash, and any byte change gives another', () => {
    writeFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), BRIEF);
    writeFileSync(join(runDir, 'FILE_LIST.md'), FILES);
    const first = presentBrief(runDir);
    expect(presentBrief(runDir)).toEqual(first);

    writeFileSync(join(runDir, 'FILE_LIST.md'), `${FILES}- src/b.ts (CREATE)\n`);
    expect(presentBrief(runDir).sha256).not.toBe(first.sha256);
  });

  it.each([
    ['CP1 with no USER_STORY.md', () => presentStory(runDir), 'USER_STORY.md'],
    ['CP2 with no TECHNICAL_BRIEF.md', () => (writeFileSync(join(runDir, 'FILE_LIST.md'), FILES), presentBrief(runDir)), 'TECHNICAL_BRIEF.md'],
    ['CP2 with no FILE_LIST.md', () => (writeFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), BRIEF), presentBrief(runDir)), 'FILE_LIST.md']
  ])('AC-43 %s throws CheckpointPresentationError naming the missing document (fails closed)', (_label, present, missing) => {
    let thrown: unknown;
    try {
      present();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CheckpointPresentationError);
    expect((thrown as CheckpointPresentationError).missing).toEqual([join(runDir, missing)]);
    expect((thrown as Error).message).toContain(missing);
  });

  it('AC-43 an empty document, a directory or a symlink is not presented', () => {
    writeFileSync(join(runDir, 'USER_STORY.md'), '');
    expect(() => presentStory(runDir)).toThrow(CheckpointPresentationError);

    rmSync(join(runDir, 'USER_STORY.md'));
    mkdirSync(join(runDir, 'USER_STORY.md'));
    expect(() => presentStory(runDir)).toThrow(CheckpointPresentationError);

    rmSync(join(runDir, 'USER_STORY.md'), { recursive: true });
    const elsewhere = join(runDir, '..', 'elsewhere.md');
    writeFileSync(elsewhere, STORY);
    symlinkSync(elsewhere, join(runDir, 'USER_STORY.md'));
    expect(() => presentStory(runDir)).toThrow(CheckpointPresentationError);
  });

  it('AC-43 presentationFor dispatches CP1 and CP2 and refuses any other checkpoint here', () => {
    writeFileSync(join(runDir, 'USER_STORY.md'), STORY);
    writeFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), BRIEF);
    writeFileSync(join(runDir, 'FILE_LIST.md'), FILES);

    expect(presentationFor(1, runDir)).toEqual(presentStory(runDir));
    expect(presentationFor(2, runDir)).toEqual(presentBrief(runDir));
    expect(() => presentationFor(3, runDir)).toThrow(CheckpointPresentationError);
  });
});

describe('CP3 presentation (D-4, step 5)', () => {
  let runDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const project = tempProject('ff-cpr3-');
    cleanup = project.cleanup;
    runDir = join(project.dir, '.factory', 'run-1');
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => cleanup());

  const REPORT = '# Validation Report\n\nAll five security checks pass.\n';
  const CHANGE: ChangeSet = {
    source: 'git',
    files: ['src/a.ts', 'src/b.ts'],
    text: 'Base: git commit abc\n\n```diff\n+export const a = 2;\n```\n'
  };
  const finding = (stage: number, source: string, message: string): ImportantFinding => ({
    stage,
    source,
    message,
    recordedAt: '2026-10-04T00:00:00.000Z'
  });

  it('AC-43 AC-44 CP3 presents the full VALIDATION_REPORT.md, then every IMPORTANT finding, then the change', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    const findings = [
      finding(3, 'stage-gate', '[Stage 3] Code Follows Patterns: 1 TODO'),
      finding(4, 'gate-2', '2 skipped tests\nsee the run output')
    ];

    const presentation = presentChange(runDir, findings, CHANGE);

    expect(presentation.text).toBe(
      `${REPORT}\n\n---\n\n## IMPORTANT findings (2)\n\n` +
        '- [Stage 3 · stage-gate] [Stage 3] Code Follows Patterns: 1 TODO\n' +
        '- [Stage 4 · gate-2] 2 skipped tests see the run output\n' +
        `\n---\n\n## Change (source: git)\n\n${CHANGE.text}`
    );
    expect(presentation.sha256).toBe(sha256Hex(presentation.text));
    expect(presentation.artifactPaths).toEqual([join(runDir, 'VALIDATION_REPORT.md')]);
    expect(presentation.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('AC-43 CP3 with no IMPORTANT findings says so, and names a claimed-files change as such', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);

    const presentation = presentChange(runDir, [], { ...CHANGE, source: 'claimed-files' });

    expect(presentation.text).toContain('## IMPORTANT findings (0)\n\nNone.\n');
    expect(presentation.text).toContain('## Change (source: claimed-files)');
  });

  it('AC-52 presentationFor(3) re-builds CP3 from the report, the findings and the change: the same inputs give the same hash', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    const findings = [finding(4, '07-validator', '[src/a.ts:3] Add a limiter')];

    const rebuilt = presentationFor(3, runDir, { findings, change: CHANGE });

    expect(rebuilt).toEqual(presentChange(runDir, findings, CHANGE));
    expect(presentationFor(3, runDir, { findings, change: CHANGE }).sha256).toBe(rebuilt.sha256);
    // Any byte of any input changes it.
    expect(presentationFor(3, runDir, { findings: [], change: CHANGE }).sha256).not.toBe(rebuilt.sha256);
    expect(presentationFor(3, runDir, { findings, change: { ...CHANGE, text: `${CHANGE.text} ` } }).sha256).not.toBe(rebuilt.sha256);
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), `${REPORT}edited\n`);
    expect(presentationFor(3, runDir, { findings, change: CHANGE }).sha256).not.toBe(rebuilt.sha256);
  });

  const FOLLOWUP = '# Validation Follow-up\n\nThe new test cannot fail: it asserts nothing.\n';

  it('AC-122 presentChange with the follow-up presents both documents in full and hashes both; without it the text is byte-identical to before', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    writeFileSync(join(runDir, CP3_FOLLOWUP_DOCUMENT), FOLLOWUP);
    const findings = [finding(4, '07b-validator-followup', '[test/a.test.ts:3] The test asserts nothing')];

    const withFollowup = presentationFor(3, runDir, { findings, change: CHANGE, followup: true });

    expect(CP3_FOLLOWUP_DOCUMENT).toBe('VALIDATION_FOLLOWUP.md');
    expect(withFollowup.text).toBe(
      `${REPORT}\n\n---\n\n## VALIDATION_FOLLOWUP.md\n\n${FOLLOWUP}` +
        `\n\n---\n\n## IMPORTANT findings (1)\n\n` +
        '- [Stage 4 · 07b-validator-followup] [test/a.test.ts:3] The test asserts nothing\n' +
        `\n---\n\n## Change (source: git)\n\n${CHANGE.text}`
    );
    expect(withFollowup.sha256).toBe(sha256Hex(withFollowup.text));
    expect(withFollowup.artifactPaths).toEqual([join(runDir, 'VALIDATION_REPORT.md'), join(runDir, CP3_FOLLOWUP_DOCUMENT)]);
    expect(withFollowup).toEqual(presentChange(runDir, findings, CHANGE, undefined, true));

    // The hash covers the follow-up: one byte of it changes the hash.
    writeFileSync(join(runDir, CP3_FOLLOWUP_DOCUMENT), `${FOLLOWUP} `);
    expect(presentationFor(3, runDir, { findings, change: CHANGE, followup: true }).sha256).not.toBe(withFollowup.sha256);

    // Without it: exactly the text before PR B-2, though the document is in the run directory.
    const without = presentationFor(3, runDir, { findings, change: CHANGE });
    expect(without.text).toBe(
      `${REPORT}\n\n---\n\n## IMPORTANT findings (1)\n\n` +
        '- [Stage 4 · 07b-validator-followup] [test/a.test.ts:3] The test asserts nothing\n' +
        `\n---\n\n## Change (source: git)\n\n${CHANGE.text}`
    );
    expect(without).toEqual(presentChange(runDir, findings, CHANGE));
    expect(without.artifactPaths).toEqual([join(runDir, 'VALIDATION_REPORT.md')]);
  });

  it('AC-122 with the follow-up, a missing VALIDATION_FOLLOWUP.md throws CheckpointPresentationError naming it (fails closed)', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    let thrown: unknown;
    try {
      presentationFor(3, runDir, { findings: [], change: CHANGE, followup: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CheckpointPresentationError);
    expect((thrown as CheckpointPresentationError).missing).toEqual([join(runDir, CP3_FOLLOWUP_DOCUMENT)]);
  });

  it('AC-52 presentationFor(3) without the findings and the change is refused (fails closed)', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    expect(() => presentationFor(3, runDir)).toThrow(CheckpointPresentationError);
  });

  it('AC-50 two CP3 presentations of the same inputs give the same hash, and a different change gives another', () => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
    const first = presentChange(runDir, [], CHANGE);

    expect(presentChange(runDir, [], CHANGE)).toEqual(first);
    expect(presentChange(runDir, [], { ...CHANGE, text: `${CHANGE.text}+1\n` }).sha256).not.toBe(first.sha256);
  });

  it('AC-43 CP3 with no VALIDATION_REPORT.md throws CheckpointPresentationError naming it (fails closed)', () => {
    let thrown: unknown;
    try {
      presentChange(runDir, [], CHANGE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CheckpointPresentationError);
    expect((thrown as CheckpointPresentationError).missing).toEqual([join(runDir, 'VALIDATION_REPORT.md')]);
  });

  it.each<[string, unknown]>([
    ['an empty text', { ...CHANGE, text: '' }],
    ['an unknown source', { ...CHANGE, source: 'svn' }],
    ['files that are not strings', { ...CHANGE, files: [1] }],
    ['no change at all', undefined]
  ])('AC-43 CP3 refuses a change set with %s (fails closed)', (_label, change) => {
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);

    expect(() => presentChange(runDir, [], change as ChangeSet)).toThrow(CheckpointPresentationError);
  });
});

describe('CP3 snapshot section (PR B-1, D-13, D-6)', () => {
  let runDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const project = tempProject('ff-cpr3s-');
    cleanup = project.cleanup;
    runDir = join(project.dir, '.factory', 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), REPORT);
  });

  afterEach(() => cleanup());

  const REPORT = '# Validation Report\n\nAll five security checks pass.\n';
  const CHANGE: ChangeSet = { source: 'git', files: ['src/a.ts'], text: 'Base: git commit abc\n' };
  const TAKEN = '2026-10-05T12:00:00.000Z';
  const sha = (c: string) => c.repeat(40);
  const writtenAt = (n: number, at: Stage3Snapshot['at']): Stage3Snapshot => ({
    status: 'written',
    n,
    ref: `refs/factory/run-1/stage3-${n}`,
    commit: sha(String(n)),
    tree: sha('f'),
    at,
    takenAt: TAKEN
  });
  const GIT_BASE: ChangeBase = { kind: 'git', commit: sha('c'), branch: 'refs/heads/main', preExisting: [] };

  it('D-13 without snapshots the CP3 text is exactly what it was before PR B-1', () => {
    const plain = presentChange(runDir, [], CHANGE);
    expect(plain.text).toBe(`${REPORT}\n\n---\n\n## IMPORTANT findings (0)\n\nNone.\n\n---\n\n## Change (source: git)\n\n${CHANGE.text}`);
    expect(presentationFor(3, runDir, { findings: [], change: CHANGE })).toEqual(plain);
  });

  it('AC-81 D-13 the section lists each snapshot with its phase, ref, commit and tree, no time, before the change', () => {
    const entries = [
      writtenAt(1, { phase: 'stage3' }),
      writtenAt(2, { phase: 'validator-round', round: 1 }),
      writtenAt(3, { phase: 'rework', round: 1 })
    ];

    const presentation = presentChange(runDir, [], CHANGE, { entries, base: GIT_BASE });

    expect(presentation.text).toBe(
      `${REPORT}\n\n---\n\n## IMPORTANT findings (0)\n\nNone.\n\n---\n\n` +
        '## Snapshots (3)\n\n' +
        `- stage3-1 · Stage 3 · refs/factory/run-1/stage3-1 · commit ${sha('1')} · tree ${sha('f')}\n` +
        `- stage3-2 · validator round 1 · refs/factory/run-1/stage3-2 · commit ${sha('2')} · tree ${sha('f')}\n` +
        `- stage3-3 · CHECKPOINT 3 rework 1 · refs/factory/run-1/stage3-3 · commit ${sha('3')} · tree ${sha('f')}\n` +
        `\n---\n\n## Change (source: git)\n\n${CHANGE.text}`
    );
    expect(presentation.text).not.toContain(TAKEN);
    expect(presentation.sha256).toBe(sha256Hex(presentation.text));
    expect(presentationFor(3, runDir, { findings: [], change: CHANGE, snapshots: { entries, base: GIT_BASE } })).toEqual(presentation);
  });

  it('AC-87 a not-git skip is listed and the section says no snapshot was taken', () => {
    const presentation = presentChange(runDir, [], CHANGE, {
      entries: [{ status: 'skipped', reason: 'not a git work tree', at: { phase: 'stage3' }, takenAt: TAKEN }],
      base: { kind: 'none', reason: 'not a git work tree (fatal: not a git repository)' }
    });

    expect(presentation.text).toContain(
      '## Snapshots (0)\n\n- skipped · Stage 3 · not a git work tree\n\nNo snapshot was taken: not a git work tree.\n\n---\n\n## Change'
    );
  });

  it.each<[string, ChangeBase | undefined, string | undefined]>([
    [
      'listed',
      { ...GIT_BASE, preExisting: ['notes.txt', 'src/a.ts'] },
      'The snapshots and the change include 2 path(s) that were already changed or untracked when the run started:\n- notes.txt\n- src/a.ts\n'
    ],
    ['none: no note', GIT_BASE, undefined],
    [
      'unknown (a git base recorded before B-1)',
      { kind: 'git', commit: sha('c') },
      'Whether the snapshots and the change include changes that were already in the working tree when the run started is unknown: ' +
        'this run started before the factory recorded them.\n'
    ],
    ['no base recorded (before A-2): no note', undefined, undefined]
  ])('AC-84 D-6 the pre-existing note (%s)', (_label, base, note) => {
    const text = presentChange(runDir, [], CHANGE, { entries: [writtenAt(1, { phase: 'stage3' })], ...(base ? { base } : {}) }).text;
    const section = text.slice(text.indexOf('## Snapshots'), text.indexOf('## Change'));

    if (note) expect(section).toContain(`\n\n${note}\n---\n\n`);
    else expect(section).toBe(`## Snapshots (1)\n\n- stage3-1 · Stage 3 · refs/factory/run-1/stage3-1 · commit ${sha('1')} · tree ${sha('f')}\n\n---\n\n`);
  });
});

describe('Invisible and direction-control characters at a checkpoint (PR B-1, D-13)', () => {
  let runDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const project = tempProject('ff-cpr-dir-');
    cleanup = project.cleanup;
    runDir = join(project.dir, '.factory', 'run-1');
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => cleanup());

  // No raw set character in this file: each is built from its code point.
  const RLO = String.fromCodePoint(0x202e);
  const ZWSP = String.fromCodePoint(0x200b);
  const LRI = String.fromCodePoint(0x2066);
  const typedEscape = escapeCodePoint(0x202e);

  /** The banner's first line, for `n` occurrences (D-13). */
  const bannerHead = (n: number) =>
    `WARNING: this presentation contains ${n} invisible or direction-control character(s). ` +
    'Each is shown below as \\u{XXXX}; the stored documents are unchanged.\n';
  const BANNER_END = '\n---\n\n';
  const holdsSetCharacter = (text: string) => directionCharacterPattern().test(text);

  it('AC-108 a presentation with a set character starts with one banner entry per occurrence, shows each as \\u{XXXX}, and its sha256 is over the escaped text', () => {
    const brief = `# Technical Brief\n\nThe fee is ${RLO}01 USD.\nZero${ZWSP}width and ${LRI}isolated.\n`;
    const files = `# Files\n\n- src/a${RLO}.ts (CREATE)\n`;
    writeFileSync(join(runDir, 'TECHNICAL_BRIEF.md'), brief);
    writeFileSync(join(runDir, 'FILE_LIST.md'), files);
    const raw = `${brief}${CP2_FILE_LIST_SEPARATOR}${files}`;

    const presentation = presentBrief(runDir);

    expect(presentation.text).toBe(
      bannerHead(4) +
        '- TECHNICAL_BRIEF.md, line 3: U+202E\n' +
        '- TECHNICAL_BRIEF.md, line 4: U+200B\n' +
        '- TECHNICAL_BRIEF.md, line 4: U+2066\n' +
        '- FILE_LIST.md, line 3: U+202E\n' +
        BANNER_END +
        escapeDirectionCharacters(raw)
    );
    expect(presentation.text).toContain(`The fee is ${typedEscape}01 USD.`);
    expect(presentation.text).toContain(`Zero${escapeCodePoint(0x200b)}width and ${escapeCodePoint(0x2066)}isolated.`);
    expect(holdsSetCharacter(presentation.text)).toBe(false);
    expect(presentation.sha256).toBe(sha256Hex(presentation.text));
    expect(presentation.unescapedSha256).toBe(sha256Hex(raw));
    expect(presentation.sha256).not.toBe(presentation.unescapedSha256);
    // Re-built from the same files: the same text and hash (AC-109).
    expect(presentationFor(2, runDir)).toEqual(presentation);
  });

  it('AC-108 AC-110 without a set character the text is the raw text, byte-identical, and both hashes are the same', () => {
    const story = `# User Story\n\nGiven a literal ${typedEscape} typed by a person\n`;
    writeFileSync(join(runDir, 'USER_STORY.md'), story);

    const presentation = presentStory(runDir);

    expect(presentation.text).toBe(story);
    expect(presentation.sha256).toBe(sha256Hex(story));
    expect(presentation.unescapedSha256).toBe(presentation.sha256);
  });

  it('AC-108 replacing a real character with its literal escape, or the reverse, changes the text and the hash', () => {
    const real = `# User Story\n\nThe fee is ${RLO}01 USD.\n`;
    const typed = `# User Story\n\nThe fee is ${typedEscape}01 USD.\n`;

    writeFileSync(join(runDir, 'USER_STORY.md'), real);
    const shownReal = presentStory(runDir);
    writeFileSync(join(runDir, 'USER_STORY.md'), typed);
    const shownTyped = presentStory(runDir);

    // The escaped body is the same; only the banner tells a real character from its typed escape.
    expect(shownReal.text).toBe(`${bannerHead(1)}- USER_STORY.md, line 3: U+202E\n${BANNER_END}${typed}`);
    expect(shownTyped.text).toBe(typed);
    expect(shownReal.text).not.toBe(shownTyped.text);
    expect(shownReal.sha256).not.toBe(shownTyped.sha256);
  });

  it('AC-108 the CHECKPOINT 3 change section is escaped and its occurrences are listed as the change', () => {
    const report = '# Validation Report\n\nAll five security checks pass.\n';
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), report);
    const findings: ImportantFinding[] = [
      { stage: 4, source: '07-validator', message: `[src/a.ts:3] a${ZWSP}b`, recordedAt: '2026-10-05T00:00:00.000Z' }
    ];
    const change: ChangeSet = {
      source: 'git',
      files: ['src/a.ts'],
      text: `Base: git commit abc\n\n\`\`\`diff\n+const access = "user${RLO} ${LRI}admin";\n\`\`\`\n`
    };
    const snapshots = {
      entries: [
        {
          status: 'written' as const,
          n: 1,
          ref: 'refs/factory/run-1/stage3-1',
          commit: '1'.repeat(40),
          tree: 'f'.repeat(40),
          at: { phase: 'stage3' as const },
          takenAt: '2026-10-05T12:00:00.000Z'
        }
      ],
      base: { kind: 'git' as const, commit: 'c'.repeat(40), branch: 'refs/heads/main', preExisting: [`notes${RLO}.txt`] }
    };

    const presentation = presentChange(runDir, findings, change, snapshots);

    // The raw text is exactly what PR B-1 built before escaping: the parts joined.
    const raw =
      `${report}\n\n---\n\n## IMPORTANT findings (1)\n\n- [Stage 4 · 07-validator] [src/a.ts:3] a${ZWSP}b\n\n---\n\n` +
      '## Snapshots (1)\n\n' +
      `- stage3-1 · Stage 3 · refs/factory/run-1/stage3-1 · commit ${'1'.repeat(40)} · tree ${'f'.repeat(40)}\n\n` +
      `The snapshots and the change include 1 path(s) that were already changed or untracked when the run started:\n- notes${RLO}.txt\n` +
      `\n---\n\n## Change (source: git)\n\n${change.text}`;

    expect(presentation.text).toBe(
      bannerHead(4) +
        '- the IMPORTANT findings, line 1: U+200B\n' +
        '- the snapshot notes, line 6: U+202E\n' +
        '- the change, line 4: U+202E\n' +
        '- the change, line 4: U+2066\n' +
        BANNER_END +
        escapeDirectionCharacters(raw)
    );
    // N-16: the diff is escaped too, and the text still ends with the (escaped) change.
    expect(presentation.text.endsWith(`## Change (source: git)\n\n${escapeDirectionCharacters(change.text)}`)).toBe(true);
    expect(holdsSetCharacter(presentation.text)).toBe(false);
    expect(presentation.sha256).toBe(sha256Hex(presentation.text));
    expect(presentation.unescapedSha256).toBe(sha256Hex(raw));
    expect(presentation.changedFiles).toEqual(['src/a.ts']);
    expect(presentationFor(3, runDir, { findings, change, snapshots })).toEqual(presentation);
  });
});
