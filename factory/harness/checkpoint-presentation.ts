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
 *    agent says about them. From PR B-1 a run with snapshot records also shows them, with the
 *    pre-existing-changes note, between the findings and the change (D-13, D-6).
 *
 * INVISIBLE AND DIRECTION-CONTROL CHARACTERS (PR B-1, D-13, AC-108). The text is built as an ordered
 * list of parts, some labelled with what they show (a document, the findings, the snapshot notes,
 * the change). The parts joined are the raw text, exactly the text built before PR B-1. When no
 * labelled part holds a character of the shared set, the raw text is what is presented, byte for
 * byte (AC-110). Otherwise the presentation starts with a warning banner, one entry per occurrence
 * (part, line within that part, code point), and every such character is shown as its visible
 * escape. The approval hash is over this escaped text, what the approver was actually shown; the
 * hash of the raw text is kept as `unescapedSha256` only so that a run paused before PR B-1 can be
 * recognised and told why it cannot be approved (AC-110).
 *
 * FAILS CLOSED. A document that is absent, empty, not a regular file, or a symlink cannot be
 * presented, so it throws CheckpointPresentationError and the orchestrator escalates without
 * asking the approver: a human cannot approve what they were not shown.
 */

import { createHash } from 'crypto';
import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';

import type { ChangeSet } from './change-diff';
import { escapeDirectionCharacters, findDirectionCharacters, formatCodePoint } from './direction-characters';
import type { BuilderPhase, ChangeBase, CheckpointId, ImportantFinding, Stage3Snapshot } from './state-tracker';

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
  /**
   * sha256 of the raw text, before any escaping (D-13). Equal to `sha256` when the text holds no
   * set character. Used only to recognise a hash recorded before PR B-1 (AC-110); never put into a
   * CheckpointRequest and never recorded as an approval.
   */
  unescapedSha256: string;
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
  return presentation([{ label: 'USER_STORY.md', text: story.content }], [story.path]);
}

/** The full TECHNICAL_BRIEF.md and FILE_LIST.md of the run in `runDirAbs` (CP2, I-5). */
export function presentBrief(runDirAbs: string): CheckpointPresentation {
  const [brief, fileList] = readDocuments(runDirAbs, CHECKPOINT_DOCUMENTS[2], 'CHECKPOINT 2');
  return presentation(
    [
      { label: 'TECHNICAL_BRIEF.md', text: brief.content },
      { text: CP2_FILE_LIST_SEPARATOR },
      { label: 'FILE_LIST.md', text: fileList.content }
    ],
    [brief.path, fileList.path]
  );
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
  change: ChangeSet,
  snapshots?: SnapshotPresentationInput
): CheckpointPresentation {
  const problem = changeSetProblem(change);
  if (problem) {
    throw new CheckpointPresentationError(`CHECKPOINT 3 cannot be presented: the change is ${problem}.`, []);
  }
  const [report] = readDocuments(runDirAbs, CHECKPOINT_DOCUMENTS[3], 'CHECKPOINT 3');

  const lines = findings.map(f => `- [Stage ${f.stage} · ${f.source}] ${String(f.message).replace(/\r?\n/g, ' ')}`);
  // The parts joined are exactly the CP3 text before PR B-1 (plus the snapshot section when given).
  // The change is a labelled part like any document: builder source can hold these characters too,
  // and the banner is the warning for it (N-16).
  const parts: PresentationPart[] = [
    { label: 'VALIDATION_REPORT.md', text: report.content },
    { text: `${CP3_SECTION_SEPARATOR}## IMPORTANT findings (${findings.length})\n\n` },
    { label: 'the IMPORTANT findings', text: lines.length > 0 ? lines.join('\n') : 'None.' },
    { text: CP3_SECTION_SEPARATOR },
    ...(snapshots
      ? [{ label: 'the snapshot notes', text: snapshotSection(snapshots) }, { text: CP3_SECTION_SEPARATOR.slice(1) }]
      : []),
    { text: `## Change (source: ${change.source})\n\n` },
    { label: 'the change', text: change.text }
  ];

  return { ...presentation(parts, [report.path]), changedFiles: [...change.files] };
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

/**
 * The run's snapshot records and its change base (PR B-1, D-13). Given only when the run has
 * snapshot records (`state.stage3Snapshots !== undefined`, I-5), so a run without any presents
 * exactly the pre-B-1 text.
 */
export interface SnapshotPresentationInput {
  entries: readonly Stage3Snapshot[];
  base?: ChangeBase;
}

/** What CP3 is built from besides VALIDATION_REPORT.md: the run's IMPORTANT findings, the collected change and, from PR B-1, the snapshots. */
export interface ChangePresentationInput {
  findings: readonly ImportantFinding[];
  change: ChangeSet;
  snapshots?: SnapshotPresentationInput;
}

/** The reason a snapshot is skipped outside git (D-5); the section then says no snapshot was taken (AC-87). */
export const NOT_GIT_SNAPSHOT_REASON = 'not a git work tree';

/** How a snapshot's phase reads at CP3. */
function snapshotPhase(at: BuilderPhase): string {
  switch (at.phase) {
    case 'stage3':
      return 'Stage 3';
    case 'validator-round':
      return `validator round ${at.round}`;
    case 'rework':
      return `CHECKPOINT 3 rework ${at.round}`;
  }
}

/**
 * The D-6 note on changes already in the tree when the run started (AC-84): listed when there are
 * some, nothing when there are none, "unknown" for a git base recorded before PR B-1. A run with no
 * git base (or none recorded) gets no note.
 */
function preExistingNote(base: ChangeBase | undefined): string | undefined {
  if (base?.kind !== 'git') return undefined;
  if (base.preExisting === undefined) {
    return (
      'Whether the snapshots and the change include changes that were already in the working tree when the run started ' +
      'is unknown: this run started before the factory recorded them.\n'
    );
  }
  if (base.preExisting.length === 0) return undefined;
  return (
    `The snapshots and the change include ${base.preExisting.length} path(s) that were already changed or untracked when the run started:\n` +
    `${base.preExisting.map(path => `- ${path}`).join('\n')}\n`
  );
}

/**
 * `## Snapshots (<written>)`, one line per record (no timestamps, so the text depends only on what
 * was recorded), then the not-git sentence and the pre-existing note when they apply (D-13).
 */
function snapshotSection({ entries, base }: SnapshotPresentationInput): string {
  const written = entries.filter(entry => entry.status === 'written').length;
  const lines = entries.map(entry =>
    entry.status === 'written'
      ? `- stage3-${entry.n} · ${snapshotPhase(entry.at)} · ${entry.ref} · commit ${entry.commit} · tree ${entry.tree}`
      : `- skipped · ${snapshotPhase(entry.at)} · ${entry.reason}`
  );
  const notGit = entries.some(entry => entry.status === 'skipped' && entry.reason === NOT_GIT_SNAPSHOT_REASON);
  const note = preExistingNote(base);
  return (
    `## Snapshots (${written})\n\n${lines.length > 0 ? lines.join('\n') : 'None.'}\n` +
    (notGit ? `\nNo snapshot was taken: ${NOT_GIT_SNAPSHOT_REASON}.\n` : '') +
    (note ? `\n${note}` : '')
  );
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
  if (id === 3 && change) return presentChange(runDirAbs, change.findings, change.change, change.snapshots);
  throw new CheckpointPresentationError(
    `CHECKPOINT ${String(id)} cannot be re-built without the findings and the change it presented.`,
    []
  );
}

/**
 * One part of a checkpoint's text. A labelled part is content (a document, the findings, the
 * snapshot notes, the change), and a banner entry names it with a line counted within it; an
 * unlabelled part is the harness's own separator or heading.
 */
interface PresentationPart {
  label?: string;
  text: string;
}

/** The first line of the warning banner (D-13). Part of what is hashed. */
function bannerHead(count: number): string {
  return (
    `WARNING: this presentation contains ${count} invisible or direction-control character(s). ` +
    'Each is shown below as \\u{XXXX}; the stored documents are unchanged.\n'
  );
}

/** Closes the banner, before the escaped text. Part of what is hashed. */
const BANNER_END = '\n---\n\n';

/**
 * The single place checkpoint text is assembled (D-13). Raw = the parts joined. No occurrence in
 * any labelled part: the raw text, unchanged. Otherwise: the banner, one line per occurrence in
 * order (`- <label>, line <L>: U+XXXX`), then the raw text with every set character escaped. The
 * hash is over what is presented; the raw text's hash is kept for the pre-B-1 check (AC-110).
 */
function presentation(parts: readonly PresentationPart[], artifactPaths: string[]): CheckpointPresentation {
  const raw = parts.map(part => part.text).join('');
  const entries = parts.flatMap(({ label, text }) =>
    label === undefined
      ? []
      : findDirectionCharacters(text).map(({ line, codePoint }) => `- ${label}, line ${line}: ${formatCodePoint(codePoint)}\n`)
  );
  const text =
    entries.length === 0 ? raw : `${bannerHead(entries.length)}${entries.join('')}${BANNER_END}${escapeDirectionCharacters(raw)}`;
  return { text, sha256: sha256Hex(text), unescapedSha256: sha256Hex(raw), artifactPaths };
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
