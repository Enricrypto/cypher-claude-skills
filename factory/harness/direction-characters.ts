/**
 * The shared set of invisible and direction-control characters (AC-105, D-11).
 *
 * These characters reorder or hide text: a right-to-left override can make code or a document
 * read differently from what it is, and a zero-width character can hide inside a word. The
 * terminal (`printableForTerminal`), the document check and the checkpoint presentation all
 * import this one set, so they can never disagree about which characters are flagged.
 *
 * Pure, with no imports. The set is written as numeric ranges only; the regex is built from them,
 * so no raw character and no second spelling of the set exists anywhere in the source.
 */

/** THE set, the single source: U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069, U+FEFF. */
export const DIRECTION_CHARACTER_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
];

/** The `source` of the regex character class, built once from the ranges. */
const CLASS_SOURCE = `[${DIRECTION_CHARACTER_RANGES.map(([low, high]) =>
  low === high ? unicodeEscape(low) : `${unicodeEscape(low)}-${unicodeEscape(high)}`
).join('')}]`;

/** The `\u{…}` text for a code point: uppercase hex, at least 4 digits. */
function unicodeEscape(codePoint: number): string {
  return `\\u{${hexDigits(codePoint)}}`;
}

function hexDigits(codePoint: number): string {
  return codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/** The source tag of the IMPORTANT findings the document check records (D-12). */
export const DOCUMENT_CHECK_SOURCE = 'document-check';

/** The most occurrences one finding message lists before it counts the rest (I-13). */
const FINDING_OCCURRENCE_LIMIT = 20;

export function isDirectionCharacter(codePoint: number): boolean {
  return DIRECTION_CHARACTER_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/** A fresh `/[…]/gu` regex on every call, so no caller shares another's `lastIndex`. */
export function directionCharacterPattern(): RegExp {
  return new RegExp(CLASS_SOURCE, 'gu');
}

/** Every occurrence, in order. Lines are 1-based and split on `\n` only: U+2028 does not start one. */
export function findDirectionCharacters(text: string): Array<{ line: number; codePoint: number }> {
  const found: Array<{ line: number; codePoint: number }> = [];
  text.split('\n').forEach((lineText, index) => {
    for (const char of lineText) {
      const codePoint = char.codePointAt(0)!;
      if (isDirectionCharacter(codePoint)) found.push({ line: index + 1, codePoint });
    }
  });
  return found;
}

/** `U+202E`. */
export function formatCodePoint(codePoint: number): string {
  return `U+${hexDigits(codePoint)}`;
}

/** The visible escape, e.g. a backslash, `u{202E}`. The one escape for terminal and checkpoint (C-23). */
export function escapeCodePoint(codePoint: number): string {
  return unicodeEscape(codePoint);
}

/** Every set character replaced by its escape. Everything else, a backslash included, is unchanged. */
export function escapeDirectionCharacters(text: string): string {
  return text.replace(directionCharacterPattern(), char => escapeCodePoint(char.codePointAt(0)!));
}

/**
 * The IMPORTANT finding for one document, or undefined when it holds no set character (D-12):
 * `<NAME> contains invisible or direction-control characters (stored exactly as written):
 * line 3: U+202E; line 7: U+200B, U+2066`. At most 20 occurrences are listed, grouped by line in
 * order, then `; and <k> more` (I-13).
 */
export function documentFinding(name: string, text: string): string | undefined {
  const occurrences = findDirectionCharacters(text);
  if (occurrences.length === 0) return undefined;

  const groups: Array<{ line: number; codePoints: string[] }> = [];
  for (const { line, codePoint } of occurrences.slice(0, FINDING_OCCURRENCE_LIMIT)) {
    const last = groups[groups.length - 1];
    if (last?.line === line) last.codePoints.push(formatCodePoint(codePoint));
    else groups.push({ line, codePoints: [formatCodePoint(codePoint)] });
  }
  const listed = groups.map(group => `line ${group.line}: ${group.codePoints.join(', ')}`).join('; ');
  const more = occurrences.length - FINDING_OCCURRENCE_LIMIT;

  return (
    `${name} contains invisible or direction-control characters (stored exactly as written): ${listed}` +
    (more > 0 ? `; and ${more} more` : '')
  );
}
