/**
 * The shared set of invisible and direction-control characters (AC-105, AC-106, D-11).
 *
 * One module holds the set. The terminal (printableForTerminal), the document check and the
 * checkpoint presentation all import it, so the three can never disagree about which characters
 * are dangerous. These tests pin the set exactly, at every range boundary and its neighbours,
 * and pin the finder, the escapes and the finding message built on it.
 *
 * No test text here holds a raw set character: each is built from its code point, so this file
 * stays clean under its own scan.
 */

import { describe, it, expect } from '@jest/globals';

import {
  DIRECTION_CHARACTER_RANGES,
  DOCUMENT_CHECK_SOURCE,
  directionCharacterPattern,
  documentFinding,
  escapeCodePoint,
  escapeDirectionCharacters,
  findDirectionCharacters,
  formatCodePoint,
  isDirectionCharacter
} from '../../harness/direction-characters';

const ch = (codePoint: number): string => String.fromCodePoint(codePoint);
/** The visible escape text, built without typing an escape sequence into this file. */
const escaped = (hex: string): string => '\\' + `u{${hex}}`;
const hex = (codePoint: number): string => codePoint.toString(16).toUpperCase().padStart(4, '0');
const rows = (codePoints: number[]): Array<[string, number]> => codePoints.map(cp => [`U+${hex(cp)}`, cp]);

const EXPECTED_MEMBERS: number[] = [
  0x061c,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
  0xfeff
];

/** Whether the shared regex flags the one-character string for this code point. */
const patternFlags = (codePoint: number): boolean => directionCharacterPattern().test(ch(codePoint));

describe('direction characters: the shared set', () => {
  it('AC-105 the shared set is exactly U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069 and U+FEFF', () => {
    expect(DIRECTION_CHARACTER_RANGES).toEqual([
      [0x061c, 0x061c],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2066, 0x2069],
      [0xfeff, 0xfeff]
    ]);

    // Every code point of the BMP, plus a few astral ones: the predicate and the regex agree
    // with the expected list and with each other, and flag nothing else.
    const flagged: number[] = [];
    const disagreements: number[] = [];
    const candidates = [...Array.from({ length: 0x10000 }, (_, i) => i), 0x1f600, 0xe0001, 0xe007f, 0x10ffff];
    for (const codePoint of candidates) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue; // lone surrogates are not characters
      const byPredicate = isDirectionCharacter(codePoint);
      if (byPredicate) flagged.push(codePoint);
      if (byPredicate !== patternFlags(codePoint)) disagreements.push(codePoint);
    }
    expect(flagged).toEqual(EXPECTED_MEMBERS);
    expect(disagreements).toEqual([]);
  });

  it('AC-105 directionCharacterPattern returns a fresh global unicode regex on every call', () => {
    const first = directionCharacterPattern();
    const second = directionCharacterPattern();

    expect(first).not.toBe(second);
    expect(first.flags).toBe('gu');
    // A used regex does not leak its lastIndex into the next caller.
    expect(first.test(`a${ch(0x202e)}b`)).toBe(true);
    expect(first.lastIndex).toBeGreaterThan(0);
    expect(directionCharacterPattern().lastIndex).toBe(0);
  });

  it.each(rows([0x061c, 0x200b, 0x200f, 0x2028, 0x202e, 0x2066, 0x2069, 0xfeff]))(
    'AC-106 boundary %s is flagged',
    (_label, codePoint) => {
      expect(isDirectionCharacter(codePoint)).toBe(true);
      expect(patternFlags(codePoint)).toBe(true);
      expect(findDirectionCharacters(`x${ch(codePoint)}y`)).toEqual([{ line: 1, codePoint }]);
    }
  );

  it.each(rows([0x061b, 0x061d, 0x200a, 0x2010, 0x2027, 0x202f, 0x2065, 0x206a, 0xfefe, 0xff00]))('AC-106 neighbour %s is not flagged', (_label, codePoint) => {
    expect(isDirectionCharacter(codePoint)).toBe(false);
    expect(patternFlags(codePoint)).toBe(false);
    expect(findDirectionCharacters(`x${ch(codePoint)}y`)).toEqual([]);
  });

  it('AC-106 ordinary non-ASCII text (é, U+0627) is not flagged', () => {
    const text = `caf${ch(0xe9)} ${ch(0x627)}${ch(0x644)} ${ch(0x1f600)} — ✓`;

    expect(findDirectionCharacters(text)).toEqual([]);
    expect(directionCharacterPattern().test(text)).toBe(false);
    expect(escapeDirectionCharacters(text)).toBe(text);
    expect(documentFinding('USER_STORY.md', text)).toBeUndefined();
  });
});

describe('direction characters: finding, formatting and escaping', () => {
  it('AC-107 findDirectionCharacters reports 1-based lines split on \\n only, in order', () => {
    const text = [
      `one ${ch(0x202e)}`,
      'two',
      `three\r`,
      `four ${ch(0x200b)}${ch(0x2066)} and ${ch(0x2028)} still four`,
      `${ch(0xfeff)}`
    ].join('\n');

    expect(findDirectionCharacters(text)).toEqual([
      { line: 1, codePoint: 0x202e },
      { line: 4, codePoint: 0x200b },
      { line: 4, codePoint: 0x2066 },
      // U+2028 is reported, and it does not start a new line.
      { line: 4, codePoint: 0x2028 },
      { line: 5, codePoint: 0xfeff }
    ]);
    expect(findDirectionCharacters('')).toEqual([]);
    // A surrogate pair before a member is one character, not two.
    expect(findDirectionCharacters(`${ch(0x1f600)}${ch(0x061c)}`)).toEqual([{ line: 1, codePoint: 0x061c }]);
  });

  it('AC-102 formatCodePoint gives U+XXXX and escapeCodePoint gives the \\u{XXXX} escape, uppercase with at least 4 digits', () => {
    expect(formatCodePoint(0x202e)).toBe('U+202E');
    expect(formatCodePoint(0x061c)).toBe('U+061C');
    expect(formatCodePoint(0x1f600)).toBe('U+1F600');

    expect(escapeCodePoint(0x202e)).toBe(escaped('202E'));
    expect(escapeCodePoint(0x061c)).toBe(escaped('061C'));
    expect(escapeCodePoint(0xfeff)).toBe(escaped('FEFF'));
    expect(escapeCodePoint(0x41)).toBe(escaped('0041'));
    expect(escapeCodePoint(0x1f600)).toBe(escaped('1F600'));
  });

  it('AC-102 escapeDirectionCharacters escapes every set member and leaves typed escapes and backslashes unchanged', () => {
    const raw = `a${ch(0x202e)}b\\c ${escaped('202E')} ${ch(0x200d)}${ch(0xfeff)}\n${ch(0xe9)}`;
    const expected = `a${escaped('202E')}b\\c ${escaped('202E')} ${escaped('200D')}${escaped('FEFF')}\n${ch(0xe9)}`;

    const once = escapeDirectionCharacters(raw);

    expect(once).toBe(expected);
    expect(findDirectionCharacters(once)).toEqual([]);
    // Escaped text has nothing left to escape: no double escape.
    expect(escapeDirectionCharacters(once)).toBe(once);
  });

  it('AC-107 documentFinding names the document, line and code point and caps at 20 occurrences', () => {
    expect(documentFinding('USER_STORY.md', 'clean\ntext')).toBeUndefined();
    expect(DOCUMENT_CHECK_SOURCE).toBe('document-check');

    const text = ['a', 'b', `c ${ch(0x202e)}`, 'd', 'e', 'f', `g ${ch(0x200b)} ${ch(0x2066)}`].join('\n');
    expect(documentFinding('TECHNICAL_BRIEF.md', text)).toBe(
      'TECHNICAL_BRIEF.md contains invisible or direction-control characters (stored exactly as written): ' +
        'line 3: U+202E; line 7: U+200B, U+2066'
    );

    // Exactly 20: all listed, no count.
    const twenty = Array.from({ length: 20 }, () => ch(0x200e)).join('\n');
    const twentyMessage = documentFinding('FILE_LIST.md', twenty)!;
    expect(twentyMessage).toContain('line 20: U+200E');
    expect(twentyMessage).not.toContain('more');

    // 25 occurrences on 3 lines: the first 20 are listed (grouped by line), then the rest are counted.
    const many = [
      Array.from({ length: 12 }, () => ch(0x202e)).join(''),
      Array.from({ length: 10 }, () => ch(0x2069)).join(''),
      `${ch(0xfeff)}${ch(0xfeff)}${ch(0xfeff)}`
    ].join('\n');
    expect(documentFinding('BACKEND_SUMMARY.md', many)).toBe(
      'BACKEND_SUMMARY.md contains invisible or direction-control characters (stored exactly as written): ' +
        `line 1: ${Array.from({ length: 12 }, () => 'U+202E').join(', ')}; ` +
        `line 2: ${Array.from({ length: 8 }, () => 'U+2069').join(', ')}; and 5 more`
    );
  });
});
