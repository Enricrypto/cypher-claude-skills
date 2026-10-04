/**
 * Checkpoint presentation (A-2, D-4).
 *
 * An approval is bound to the SHA-256 of the exact text the approver was given, and `--approve`
 * on resume re-builds that text and compares hashes (AC-50, AC-52). So the text is built ONLY
 * from files: the same files give the same text and the same hash, and any byte change gives
 * another.
 *
 * What is presented is the full artifact, never an agent's own summary of it (AC-43):
 *  - CP1: the exact bytes of `<runDir>/USER_STORY.md`;
 *  - CP2: `<runDir>/TECHNICAL_BRIEF.md`, then CP2_FILE_LIST_SEPARATOR, then `<runDir>/FILE_LIST.md`
 *    (I-5: FILE_LIST binds the builders too, so it is part of what is approved);
 *  - CP3: `<runDir>/VALIDATION_REPORT.md`, then every IMPORTANT finding the run recorded, then the
 *    change itself (change-diff.ts: the git diff since the run started, or a labelled manifest of
 *    the claimed files). CP3's text is built from files, state and the change, never from what an
 *    agent says about them.
 *
 * FAILS CLOSED. A document that is absent, empty, not a regular file, or a symlink cannot be
 * presented, so it throws CheckpointPresentationError and the orchestrator escalates without
 * asking the approver: a human cannot approve what they were not shown.
 */

import { createHash } from 'crypto';
import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';

import type { ChangeSet } from './change-diff';
import type { CheckpointId, ImportantFinding } from './state-tracker';

/**
 * Lowercase hex SHA-256 of the UTF-8 bytes of `text`, exactly as given: no newline, whitespace or
 * Unicode normalisation. Anything other than a string is a TypeError, never a hash of "undefined".
 */
export function sha256Hex(text: string): string {
  if (typeof text !== 'string') {
    throw new TypeError(`sha256Hex expects a string; got ${text === null ? 'null' : typeof text}.`);
  }
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** What a checkpoint shows: the exact text, its hash, and the documents it was built from. */
export interface CheckpointPresentation {
  /** The exact text presented. Approvals bind to sha256(text). */
  text: string;
  sha256: string;
  /** Absolute paths of the documents the text was built from, in presentation order. */
  artifactPaths: string[];
  /** CP3 only: the files in the presented change (ChangeSet.files). */
  changedFiles?: string[];
}

/** A checkpoint that cannot be presented, because a document it must show is not there. */
export class CheckpointPresentationError extends Error {
  /** Absolute paths of the documents that could not be read. */
  readonly missing: string[];

  constructor(message: string, missing: string[]) {
    super(message);
    this.name = 'CheckpointPresentationError';
    this.missing = [...missing];
  }
}

/** The documents each checkpoint presents, in order. */
export const CHECKPOINT_DOCUMENTS = Object.freeze({
  1: Object.freeze(['USER_STORY.md']),
  2: Object.freeze(['TECHNICAL_BRIEF.md', 'FILE_LIST.md']),
  3: Object.freeze(['VALIDATION_REPORT.md'])
} as const);

/** Between the brief and the file list in the CP2 text (I-5). Part of what is hashed. */
export const CP2_FILE_LIST_SEPARATOR = '\n\n---\n\n## FILE_LIST.md\n\n';

/** Between the parts of the CP3 text. Part of what is hashed. */
export const CP3_SECTION_SEPARATOR = '\n\n---\n\n';

/** The full USER_STORY.md of the run in `runDirAbs` (CP1). */
export function presentStory(runDirAbs: string): CheckpointPresentation {
  const [story] = readDocuments(runDirAbs, CHECKPOINT_DOCUMENTS[1], 'CHECKPOINT 1');
  return presentation(story.content, [story.path]);
}

/** The full TECHNICAL_BRIEF.md and FILE_LIST.md of the run in `runDirAbs` (CP2, I-5). */
export function presentBrief(runDirAbs: string): CheckpointPresentation {
  const [brief, fileList] = readDocuments(runDirAbs, CHECKPOINT_DOCUMENTS[2], 'CHECKPOINT 2');
  return presentation(`${brief.content}${CP2_FILE_LIST_SEPARATOR}${fileList.content}`, [brief.path, fileList.path]);
}

/**
 * CP3, the validated change (AC-43, AC-44): the full VALIDATION_REPORT.md of the run in
 * `runDirAbs`, then `## IMPORTANT findings (N)` with one line per finding
 * (`- [Stage s · source] message`, line breaks in a message folded to spaces), then
 * `## Change (source: git | claimed-files)` and the change's text. `changedFiles` is the change's
 * file list, kept with a pause so a rejection can route the rework (D-5).
 *
 * Throws CheckpointPresentationError when the report cannot be presented, or when `change` is not
 * a well-formed ChangeSet: nothing is approved that was not shown in full.
 */
export function presentChange(
  runDirAbs: string,
  findings: readonly ImportantFinding[],
  change: ChangeSet
): CheckpointPresentation {
  const problem = changeSetProblem(change);
  if (problem) {
    throw new CheckpointPresentationError(`CHECKPOINT 3 cannot be presented: the change is ${problem}.`, []);
  }
  const [report] = readDocuments(runDirAbs, CHECKPOINT_DOCUMENTS[3], 'CHECKPOINT 3');

  const lines = findings.map(f => `- [Stage ${f.stage} · ${f.source}] ${String(f.message).replace(/\r?\n/g, ' ')}`);
  const text =
    `${report.content}${CP3_SECTION_SEPARATOR}` +
    `## IMPORTANT findings (${findings.length})\n\n${lines.length > 0 ? lines.join('\n') : 'None.'}\n` +
    `${CP3_SECTION_SEPARATOR.slice(1)}` +
    `## Change (source: ${change.source})\n\n${change.text}`;

  return { ...presentation(text, [report.path]), changedFiles: [...change.files] };
}

/** Why `change` is not a ChangeSet that can be presented, or undefined when it is one. */
function changeSetProblem(change: unknown): string | undefined {
  if (typeof change !== 'object' || change === null) return 'missing';
  const c = change as Record<string, unknown>;
  if (c.source !== 'git' && c.source !== 'claimed-files') return `from an unknown source ${JSON.stringify(c.source)}`;
  if (!Array.isArray(c.files) || !c.files.every(f => typeof f === 'string')) return 'missing its file list';
  if (typeof c.text !== 'string' || c.text.length === 0) return 'empty';
  return undefined;
}

/** What CP3 is built from besides VALIDATION_REPORT.md: the run's IMPORTANT findings and the collected change. */
export interface ChangePresentationInput {
  findings: readonly ImportantFinding[];
  change: ChangeSet;
}

/**
 * The presentation of checkpoint `id`, re-built exactly as it was first built, so a later re-build
 * compares like with like (AC-52, I-7). CP1 and CP2 come from files only. CP3 also needs the run's
 * findings and the change (collected by the caller from the run's change base and the builders'
 * claims — the same inputs it was presented from); without them it is refused, never guessed.
 */
export function presentationFor(id: CheckpointId, runDirAbs: string, change?: ChangePresentationInput): CheckpointPresentation {
  if (id === 1) return presentStory(runDirAbs);
  if (id === 2) return presentBrief(runDirAbs);
  if (id === 3 && change) return presentChange(runDirAbs, change.findings, change.change);
  throw new CheckpointPresentationError(
    `CHECKPOINT ${String(id)} cannot be re-built without the findings and the change it presented.`,
    []
  );
}

function presentation(text: string, artifactPaths: string[]): CheckpointPresentation {
  return { text, sha256: sha256Hex(text), artifactPaths };
}

/** Read every document, or throw naming ALL the ones that cannot be presented. */
function readDocuments(
  runDirAbs: string,
  names: readonly string[],
  checkpoint: string
): Array<{ path: string; content: string }> {
  const read: Array<{ path: string; content: string }> = [];
  const missing: string[] = [];

  for (const name of names) {
    const path = join(runDirAbs, name);
    const content = readRegularFile(path);
    if (content === undefined) missing.push(path);
    else read.push({ path, content });
  }

  if (missing.length > 0) {
    throw new CheckpointPresentationError(
      `${checkpoint} cannot be presented: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} missing, empty, or not a regular file. ` +
        `Nothing can be approved that was not shown in full.`,
      missing
    );
  }
  return read;
}

/** The content of a non-empty regular file (a symlink is refused, not followed); otherwise undefined. */
function readRegularFile(path: string): string | undefined {
  try {
    if (!lstatSync(path).isFile()) return undefined;
    const content = readFileSync(path, 'utf8');
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}
