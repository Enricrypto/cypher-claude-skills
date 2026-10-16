/**
 * Hide `.factory/` from the target project's git (PR R-1, R8b / AC-010).
 *
 * The harness's own run state lives in `<project>/.factory/`, which means it shows up in the
 * operator's `git status` as a pile of untracked files. One line in the project's git exclude file
 * fixes that: LOCAL ONLY, never committed, never pushed — `.git/info/exclude` is per-clone, which
 * is exactly the right scope for a tool's scratch directory.
 *
 * APPEND, NEVER REWRITE. The operator's own entries must survive BYTE FOR BYTE: nothing here
 * reorders, dedupes, normalises or rewrites a single existing line. The only write this module
 * ever makes is appending `.factory/` to the end.
 *
 * IDEMPOTENT BY INSPECTION, not by a recorded flag (AC-010: "never duplicated on a second or
 * resumed run"). The file is read first and the line is added only when no existing line already
 * equals `.factory/` or `.factory` after trimming — so no new state field and no migration, and
 * a run that is resumed a hundred times still adds exactly one line.
 *
 * NEVER A STOP (P2). Every failure is `{ kind: 'skipped'; reason }`: not a git work tree, a
 * read-only git directory, `info` in the way as a regular file, a symlinked `exclude`, a full
 * disk. AC-010 makes that an explicitly tolerated outcome — the run still proceeds, having simply
 * not hidden its directory. This function does not throw.
 *
 * SAFE WRITES (P6). It writes OUTSIDE the run directory, so it cannot reuse `safe-write.ts`'s
 * container contract verbatim, and `writeFileAtomic` would rewrite the whole file instead of
 * appending — but it honours the same refusals: `O_NOFOLLOW` on every open (read and write), an
 * explicit refusal of a symlink or a non-regular file, and `info/` created ONE LEVEL only.
 *
 * IT MUST NOT SPAWN GIT, and must not import change-diff's `git()` choke point — a repo-hygiene
 * guard enforces both. Resolving WHICH directory to write is git's job, so the caller
 * (`hideFactoryFromGit` in change-diff.ts) does that through the one allow-listed `rev-parse` and
 * hands the resolved directory in. Three layers, each doing one thing (brief §6, D-5).
 */

import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'fs';
import { join } from 'path';

/** The line the harness adds. A trailing slash, so it can only ever match a directory. */
export const FACTORY_EXCLUDE_ENTRY = '.factory/';

/**
 * An existing line that already does the job. Both spellings count: `.factory` without the slash
 * excludes the directory too, and an operator who wrote it should not get a second line.
 */
const EQUIVALENT_ENTRIES: ReadonlySet<string> = new Set(['.factory/', '.factory']);

/** What one attempt did. `present` means a line was already there, so nothing was written. */
export type HideFactoryResult = { kind: 'added' } | { kind: 'present' } | { kind: 'skipped'; reason: string };

/** Read a file without ever following a symlink at its path. */
function readNoFollow(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Add `.factory/` to `<gitDir>/info/exclude` unless an equivalent line is already there
 * (AC-010). `gitDir` must be the real git directory, already resolved by the caller through
 * `rev-parse` (R8-4: it is a FILE, not a directory, in a linked worktree, so it can never be
 * `cwd + '/.git'`).
 *
 * Never throws. Follows no symlink. Appends at most one line, and rewrites nothing.
 */
export function addFactoryToExcludeFile(gitDir: string): HideFactoryResult {
  try {
    // 3. `info/`, created one level only — never recursively, so a missing parent is a skip
    //    rather than a directory tree the harness invented inside someone's `.git`.
    const info = join(gitDir, 'info');
    const infoStat = lstatSync(info, { throwIfNoEntry: false });
    if (!infoStat) {
      mkdirSync(info);
    } else if (infoStat.isSymbolicLink()) {
      return { kind: 'skipped', reason: `${info} is a symlink` };
    } else if (!infoStat.isDirectory()) {
      return { kind: 'skipped', reason: `${info} is not a directory` };
    }

    // 4. The exclude file must be absent or a plain regular file. A symlink is REFUSED, never
    //    followed: it would turn this write into a write anywhere the user can write.
    const exclude = join(info, 'exclude');
    const stat = lstatSync(exclude, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) return { kind: 'skipped', reason: `${exclude} is a symlink` };
    if (stat && !stat.isFile()) return { kind: 'skipped', reason: `${exclude} is not a regular file` };

    // 5. Already there? Then write NOTHING — this is what makes a resumed run quiet and the
    //    whole operation idempotent. Leading and trailing whitespace is tolerated on the match.
    const existing = stat ? readNoFollow(exclude) : '';
    if (existing.split('\n').some(line => EQUIVALENT_ENTRIES.has(line.trim()))) return { kind: 'present' };

    // 6. Append. A separator newline only when the file is non-empty and does not already end in
    //    one, so the operator's last line is never joined onto ours and a blank line is never
    //    invented. O_APPEND, so a concurrent writer cannot make us overwrite their bytes.
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    const fd = openSync(
      exclude,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o644
    );
    try {
      writeSync(fd, `${separator}${FACTORY_EXCLUDE_ENTRY}\n`, null, 'utf-8');
    } finally {
      closeSync(fd);
    }
    return { kind: 'added' };
  } catch (error) {
    // 7. Anything at all — EACCES on a read-only git directory, ELOOP from a symlink planted
    //    between the check and the open, ENOSPC — is a skip. The run goes on.
    return { kind: 'skipped', reason: error instanceof Error ? error.message : String(error) };
  }
}
