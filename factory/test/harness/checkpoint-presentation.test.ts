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
  presentationFor,
  presentBrief,
  presentChange,
  presentStory,
  sha256Hex
} from '../../harness/checkpoint-presentation';
import { ChangeSet } from '../../harness/change-diff';
import { ImportantFinding } from '../../harness/state-tracker';
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
