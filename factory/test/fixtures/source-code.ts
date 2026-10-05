/**
 * Source-text helpers for the static guards (repo-hygiene.test.ts, b1-acceptance-gaps.test.ts), so
 * every guard that reads source strips comments the same way.
 */

/** Strip block and line comments, so prose that describes a bug does not trip the scan. */
export function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
