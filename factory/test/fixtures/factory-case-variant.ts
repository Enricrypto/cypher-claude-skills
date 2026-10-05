/**
 * AC-97 fixtures: a `.factory` case variant (`.Factory`) next to, or instead of, the harness
 * directory, on whatever file system the tests run on.
 *
 * On a case-INSENSITIVE file system (APFS, NTFS by default) `.factory` and `.Factory` cannot both
 * exist: they are one entry. So a variant is planted by renaming the real `.factory` to `.Factory`
 * (in two steps, through a temporary name, because a case-only rename can be a no-op). On a
 * case-SENSITIVE file system the real `.factory` stays and a separate `.Factory` file is added.
 * Either way, `readdirSync(cwd)` then lists an entry spelled `.Factory`.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** The variant spelling the AC-97 tests plant. */
export const FACTORY_CASE_VARIANT = '.Factory';

/** True when the file system holding `tmpdir()` (where every temp project lives) folds letter case. */
export function tempFileSystemIsCaseInsensitive(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'ff-case-probe-'));
  try {
    writeFileSync(join(probe, 'CaseProbe'), '');
    return existsSync(join(probe, 'caseprobe'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

/**
 * Plant a `.Factory` entry in `cwd` and return its absolute path.
 *
 *  - `cwd` has a `.factory/`: case-insensitive → it is renamed to `.Factory` (its runs keep their
 *    bytes, and `.factory/...` still resolves to them); case-sensitive → a `.Factory` file is added
 *    next to it.
 *  - `cwd` has no `.factory`: a `.Factory` directory (or, with `kind: 'file'`, a file) is created.
 */
export function plantFactoryCaseVariant(cwd: string, kind: 'directory' | 'file' = 'directory'): string {
  const real = join(cwd, '.factory');
  const variant = join(cwd, FACTORY_CASE_VARIANT);

  if (existsSync(real)) {
    if (tempFileSystemIsCaseInsensitive()) {
      const transit = join(cwd, '.factory-case-transit');
      renameSync(real, transit);
      renameSync(transit, variant);
    } else {
      writeFileSync(variant, 'not the harness directory\n');
    }
  } else if (kind === 'file') {
    writeFileSync(variant, 'not the harness directory\n');
  } else {
    mkdirSync(variant);
  }

  // The plant must be visible as its own spelling, or the test would prove nothing.
  if (!readdirSync(cwd).includes(FACTORY_CASE_VARIANT)) {
    throw new Error(`could not plant ${variant}: the directory lists ${JSON.stringify(readdirSync(cwd))}`);
  }
  return variant;
}

/**
 * Every entry under `dir`, recursively, as `relative path → bytes` (files) or `'<dir>'`: "nothing
 * was written" means this does not change. Entries are listed with their on-disk spelling.
 */
export function treeSnapshot(dir: string, prefix = ''): Record<string, string> {
  const tree: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(full);
    if (stat.isDirectory()) {
      tree[rel] = '<dir>';
      Object.assign(tree, treeSnapshot(full, rel));
    } else {
      tree[rel] = stat.isFile() ? readFileSync(full, 'utf-8') : '<other>';
    }
  }
  return tree;
}
