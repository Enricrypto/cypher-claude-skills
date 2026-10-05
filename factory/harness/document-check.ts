/**
 * The document check (AC-107, D-12).
 *
 * An agent's document can hold an invisible or direction-control character: a right-to-left
 * override that makes a line read differently from what it is, or a zero-width character hiding
 * inside a word. The harness stores every document exactly as written (it never edits an agent's
 * words), and after each write it reads the file back and reports what is there. Reading back,
 * rather than scanning the text it meant to write, judges what is actually on disk (C-3).
 *
 * Every harness write path for the agents' documents and the harness-rendered ones calls this:
 * the orchestrator's persist() and writeDocument(), its pre-supplied spec acceptance, and
 * consolidate-run. The caller records the findings once per message (addImportantFindingsOnce),
 * so a resume that re-renders identical content adds nothing.
 */

import { lstatSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';

import { documentFinding } from './direction-characters';

/** One written document: the name the finding uses, and where it is on disk. */
export interface DocumentFile {
  name: string;
  path: string;
}

/**
 * One finding per document that holds a character from the set, in the order given; none for a
 * clean document. Each file is read back as utf8 and must be a regular file: a symlink, a
 * directory or a missing file throws instead of being read as clean (fails closed).
 */
export function documentFindings(files: readonly DocumentFile[]): string[] {
  return files.flatMap(({ name, path }) => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw new Error(`Document check: ${name} at ${path} is not a regular file; it cannot be read back.`);
    }
    const finding = documentFinding(name, readFileSync(path, 'utf8'));
    return finding === undefined ? [] : [finding];
  });
}

/** The documents at `paths` (relative to `cwd`, or absolute), each named by its file name. */
export function writtenDocuments(cwd: string, paths: readonly string[]): DocumentFile[] {
  return paths.map(path => ({ name: basename(path), path: resolve(cwd, path) }));
}
