/**
 * RCT: the review copy (B-2 D-3) and the test-path rule (B-2 D-2, N-3, I-4). Unit tests in temp
 * directories, no git.
 *
 * - test-paths.ts decides which of the Test Verifier's changed files are test files (AC-121).
 * - review-copy.ts makes the directory the main Validator reviews, the AC-126 fallback copy of the
 *   working tree (N-1: links kept as links, never followed; I-5: no .factory, .git or
 *   node_modules), the fallback comparison, the read-only seal, the intact check a resume uses,
 *   and the path mapping from the copy back to the project.
 *
 * Sealed directories are read-only, so every cleanup gives write permission back before removing.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'fs';
import { createHash } from 'crypto';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';

import { isTestPath, splitByTestPath, TEST_DIRECTORY_NAMES, TEST_FILE_NAME_PATTERNS } from '../../harness/test-paths';
import {
  compareWithCopy,
  copyIntact,
  copyWorkingTree,
  createReviewDir,
  insideReviewCopies,
  leafDigest,
  mapReviewPath,
  REVIEW_DIR_PREFIX,
  reviewRootProblem,
  sealReadOnly
} from '../../harness/review-copy';

// ---------------------------------------------------------------------------------------------
// Temp directories, always removed (write permission restored first).

// fs, passed through, so the order of the copy's writes can be observed (fs's own properties
// cannot be redefined by jest.spyOn).
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(actual.writeFileSync),
    mkdirSync: jest.fn(actual.mkdirSync),
    symlinkSync: jest.fn(actual.symlinkSync)
  };
});

const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

/** Give write permission back to every directory under `dir` (never through a link), so it can be removed. */
function unseal(dir: string): void {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return;
  chmodSync(dir, 0o755);
  for (const name of readdirSync(dir)) unseal(join(dir, name));
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    unseal(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(root: string, path: string, content: string | Buffer = `${path}\n`, mode?: number): string {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  if (mode !== undefined) chmodSync(full, mode);
  return full;
}

function link(root: string, path: string, target: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  symlinkSync(target, join(root, path));
}

/** Every path under `dir`, project-relative, with its kind: what a copy holds. */
function listing(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(dir, name));
    if (stat.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(join(dir, name))}`);
    else if (stat.isDirectory()) out.push(`${rel}/`, ...listing(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// ---------------------------------------------------------------------------------------------
// test-paths.ts

describe('test-paths (N-3, I-4)', () => {
  it('AC-121 N-3 TEST_DIRECTORY_NAMES are exactly the approved directory names, and e2e is not one', () => {
    expect([...TEST_DIRECTORY_NAMES]).toEqual(['test', 'tests', '__tests__', 'spec', 'specs', '__snapshots__', '__mocks__']);
    expect(TEST_DIRECTORY_NAMES).not.toContain('e2e');
  });

  it.each<[string, boolean]>([
    // A directory segment names a test directory.
    ['test/a.ts', true],
    ['src/test/a.ts', true],
    ['tests/a.py', true],
    ['pkg/__tests__/x.js', true],
    ['spec/models/user_model.rb', true],
    ['specs/x.md', true],
    ['src/__snapshots__/a.ts.snap', true],
    ['src/__mocks__/fs.js', true],
    ['factory/test/harness/review-copy.test.ts', true],
    ['factory/test/fixtures/real-git.ts', true],
    // The file name matches a test-file pattern.
    ['src/a.test.ts', true],
    ['a.spec.js', true],
    ['src/login.e2e.ts', true],
    ['src/app.e2e-spec.ts', true],
    ['pkg/foo_test.go', true],
    ['test_foo.py', true],
    ['pkg/test_foo.py', true],
    ['x/y.snap', true],
    ['component.test.tsx.snap', true],
    // Compared in lower case.
    ['SRC/Tests/A.TS', true],
    ['src/A.Test.TS', true],
    ['Test_Foo.PY', true],
    ['X/Y.SNAP', true],
    // Windows separators and a leading ./ or / are normalised.
    ['src\\test\\a.ts', true],
    ['src\\a.spec.ts', true],
    ['./test/a.ts', true],
    ['/tests/a.ts', true],
    // Not test paths.
    ['factory/e2e/x.ts', false],
    ['e2e/login.ts', false],
    ['src/test', false],
    ['tests', false],
    ['src/__tests__', false],
    ['src/testing/a.ts', false],
    ['src/latest/a.ts', false],
    ['src/contest.ts', false],
    ['src/a.ts', false],
    ['src/attest.test', false],
    ['test_foo.js', false],
    ['src/mytest.ts', false],
    ['src/a_test', false],
    ['src/a.snapx', false],
    ['src\\e2e\\a.ts', false],
    ['', false]
  ])('AC-121 N-3 isTestPath(%s) is %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });

  it('AC-121 N-3 splitByTestPath keeps every path once, in order, on its side', () => {
    expect(splitByTestPath(['src/a.ts', 'src/a.test.ts', 'factory/e2e/x.ts', 'tests/b.py', 'README.md'])).toEqual({
      tests: ['src/a.test.ts', 'tests/b.py'],
      outside: ['src/a.ts', 'factory/e2e/x.ts', 'README.md']
    });
    expect(splitByTestPath([])).toEqual({ tests: [], outside: [] });
  });

  it('D-B2-4 N-3 TEST_FILE_NAME_PATTERNS, the wording the Test Verifier prompt uses, describe the names isTestPath accepts', () => {
    expect([...TEST_FILE_NAME_PATTERNS]).toEqual(['*.test.*', '*.spec.*', '*.e2e.*', '*.e2e-spec.*', '*_test.*', 'test_*.py', '*.snap']);
    // Each pattern, with its wildcards filled in, is a test path at the top level and below src/.
    for (const pattern of TEST_FILE_NAME_PATTERNS) {
      const name = pattern.replace(/\*/g, 'x');
      expect({ name, top: isTestPath(name), nested: isTestPath(`src/${name}`) }).toEqual({ name, top: true, nested: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// createReviewDir

describe('createReviewDir (D-3, I-2)', () => {
  it('AC-117 creates a fresh 0700 real directory named factory-review-<runId>-e<e>- under the root, creating the root', () => {
    const root = join(tempDir('ff-review-root-'), 'nested', 'root');

    const first = createReviewDir(root, 'run-1', 2);
    const second = createReviewDir(root, 'run-1', 2);

    expect(REVIEW_DIR_PREFIX).toBe('factory-review-');
    expect(first).not.toBe(second);
    for (const dir of [first, second]) {
      expect(dirname(dir)).toBe(realpathSync(root));
      expect(basename(dir).startsWith('factory-review-run-1-e2-')).toBe(true);
      expect(realpathSync(dir)).toBe(dir);
      const stat = lstatSync(dir);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it('AC-117 returns the realpath when the root is reached through a symlink', () => {
    const real = tempDir('ff-review-real-');
    const holder = tempDir('ff-review-holder-');
    symlinkSync(real, join(holder, 'via-link'));

    const dir = createReviewDir(join(holder, 'via-link'), 'run-1', 1);

    expect(dirname(dir)).toBe(real);
  });

  it.each<[string, string, number, string]>([
    ['an unsafe run id with a separator', 'a/b', 1, '/tmp-root'],
    ['a run id with ..', 'a..b', 1, '/tmp-root'],
    ['an empty run id', '', 1, '/tmp-root'],
    ['a hidden run id', '.hidden', 1, '/tmp-root'],
    ['a negative evaluation number', 'run-1', -1, '/tmp-root'],
    ['a fractional evaluation number', 'run-1', 1.5, '/tmp-root'],
    ['a relative root', 'run-1', 1, 'relative/root']
  ])('AC-117 refuses %s and creates nothing', (_, runId, e, rootSuffix) => {
    const base = tempDir('ff-review-refuse-');
    const root = rootSuffix.startsWith('/') ? join(base, rootSuffix) : rootSuffix;

    expect(() => createReviewDir(root, runId, e)).toThrow();
    expect(readdirSync(base)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// copyWorkingTree

/** A working tree with every case the fallback copy must handle. */
function richTree(): { src: string; outside: string } {
  const src = tempDir('ff-review-src-');
  const outside = tempDir('ff-review-outside-');
  write(outside, 'secret.txt', 'outside the project\n');
  write(outside, 'dir/inner.txt', 'inside the outside directory\n');

  write(src, 'README.md', 'readme\n');
  write(src, 'src/a.ts', 'export const a = 1;\n');
  write(src, 'src/deep/b.ts', 'export const b = 2;\n');
  write(src, 'bin/run.sh', '#!/bin/sh\necho run\n', 0o755);
  write(src, 'assets/logo.bin', Buffer.from([0x89, 0x50, 0x00, 0x0a, 0xff, 0x0d, 0x00]));
  mkdirSync(join(src, 'empty'));
  // Excluded (I-5): top-level .factory, .git and node_modules at any depth.
  write(src, '.factory/run-1/state.json', '{}');
  write(src, '.git/HEAD', 'ref: refs/heads/main\n');
  write(src, 'node_modules/dep/index.js', 'module.exports = 1;\n');
  write(src, 'pkg/node_modules/dep/index.js', 'module.exports = 2;\n');
  write(src, 'pkg/sub/.git/config', '[core]\n');
  write(src, 'only-deps/node_modules/x.js', 'x\n');
  // A .factory below the top level is ordinary project content.
  write(src, 'docs/.factory/keep.md', 'kept\n');
  // Symlinks: never followed.
  link(src, 'link-to-a', 'src/a.ts');
  link(src, 'src/link-up', '../README.md');
  link(src, 'secret-link', join(outside, 'secret.txt'));
  link(src, 'outside-dir', join(outside, 'dir'));
  link(src, 'dangling', '/factory-test/absent');
  link(src, 'src-dir-link', 'src');
  return { src, outside };
}

const RICH_COPY = [
  'README.md',
  'assets/',
  'assets/logo.bin',
  'bin/',
  'bin/run.sh',
  'dangling -> /factory-test/absent',
  'docs/',
  'docs/.factory/',
  'docs/.factory/keep.md',
  'empty/',
  'link-to-a -> src/a.ts',
  'only-deps/',
  // outside-dir and secret-link: compared below, their targets are temp paths.
  'pkg/',
  'pkg/sub/',
  'src/',
  'src/a.ts',
  'src/deep/',
  'src/deep/b.ts',
  'src/link-up -> ../README.md',
  'src-dir-link -> src'
];

describe('copyWorkingTree (AC-126, N-1, I-5)', () => {
  it('AC-126 N-1 copyWorkingTree keeps symlinks as links, follows none, and skips .factory, .git and node_modules', () => {
    const { src, outside } = richTree();
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);

    const record = copyWorkingTree(src, dest);
    const { entries } = record;

    expect(listing(dest).filter(line => !line.startsWith('outside-dir') && !line.startsWith('secret-link'))).toEqual(RICH_COPY);
    // Byte for byte, with the executable bit.
    expect(readFileSync(join(dest, 'assets/logo.bin'))).toEqual(readFileSync(join(src, 'assets/logo.bin')));
    expect(readFileSync(join(dest, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(statSync(join(dest, 'bin/run.sh')).mode & 0o777).toBe(0o755);
    expect(statSync(join(dest, 'src/a.ts')).mode & 0o777).toBe(0o644);
    // Links to outside the project are copied as links, never followed or traversed.
    expect(lstatSync(join(dest, 'secret-link')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dest, 'secret-link'))).toBe(join(outside, 'secret.txt'));
    expect(lstatSync(join(dest, 'outside-dir')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dest, 'outside-dir'))).toBe(join(outside, 'dir'));
    expect(lstatSync(join(dest, 'src-dir-link')).isSymbolicLink()).toBe(true);
    expect(listing(outside)).toEqual(['dir/', 'dir/inner.txt', 'secret.txt']);
    // Nothing excluded is in the copy.
    for (const excluded of ['.factory', '.git', 'node_modules', 'pkg/node_modules', 'pkg/sub/.git', 'only-deps/node_modules']) {
      expect(existsSync(join(dest, excluded))).toBe(false);
    }
    // The leaves, the count copyIntact checks: 6 files, 6 symlinks and 3 directories left empty
    // (empty, only-deps and pkg/sub, whose only children are excluded); never pkg, src or docs.
    expect(entries).toBe(6 + 6 + 3);
    expect(copyIntact(dest, record)).toBe(true);
  });

  it('AC-126 N-1 copyWorkingTree creates every symlink after every file and directory', () => {
    const { src } = richTree();
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    const [writeFile, makeDir, makeLink] = [fs.writeFileSync, fs.mkdirSync, fs.symlinkSync].map(fn => fn as unknown as jest.Mock);
    for (const mock of [writeFile, makeDir, makeLink]) mock.mockClear();

    copyWorkingTree(src, dest);

    const order = (mock: jest.Mock) => mock.mock.invocationCallOrder;
    expect(order(writeFile)).toHaveLength(6);
    expect(order(makeLink)).toHaveLength(6);
    expect(Math.max(...order(writeFile), ...order(makeDir))).toBeLessThan(Math.min(...order(makeLink)));
  });

  it('AC-126 copyWorkingTree skips a file type it cannot copy (a socket or FIFO) and counts only what it copied', () => {
    const src = tempDir('ff-review-src-');
    write(src, 'a.txt', 'a\n');
    // A listening unix socket is a file type the copy cannot hold, made without a shell command.
    const server = createServer();
    const socketPath = join(src, 's.sock');
    return new Promise<void>((done, fail) => {
      server.on('error', fail);
      server.listen(socketPath, () => {
        try {
          const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
          const { entries } = copyWorkingTree(src, dest);
          expect(readdirSync(dest)).toEqual(['a.txt']);
          expect(entries).toBe(1);
          server.close(() => done());
        } catch (error) {
          server.close(() => fail(error));
        }
      });
    });
  });

  it.each<[string, (root: string) => string]>([
    ['a destination that does not exist', root => join(root, 'missing')],
    ['a destination that is not empty', root => dirname(write(root, 'full/x.txt'))],
    ['a destination that is a file', root => write(root, 'file.txt')],
    [
      'a destination that is a symlink to an empty directory',
      root => {
        mkdirSync(join(root, 'real'));
        symlinkSync(join(root, 'real'), join(root, 'via-link'));
        return join(root, 'via-link');
      }
    ]
  ])('AC-126 copyWorkingTree refuses %s and writes nothing', (_, destOf) => {
    const src = tempDir('ff-review-src-');
    write(src, 'a.txt');
    const root = tempDir('ff-review-root-');
    const dest = destOf(root);
    const before = listing(root);

    expect(() => copyWorkingTree(src, dest)).toThrow();
    expect(listing(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// compareWithCopy

describe('compareWithCopy (D-2 fallback measurement)', () => {
  function copied(): { src: string; dest: string } {
    const { src } = richTree();
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    copyWorkingTree(src, dest);
    sealReadOnly(dest);
    return { src, dest };
  }

  it.each<[string, (src: string) => void, string[]]>([
    ['nothing changed', () => undefined, []],
    ['a file added', src => write(src, 'src/new.test.ts', 'new\n'), ['src/new.test.ts']],
    ['a file modified', src => write(src, 'src/a.ts', 'export const a = 3;\n'), ['src/a.ts']],
    ['a file deleted', src => unlinkSync(join(src, 'src/deep/b.ts')), ['src/deep/b.ts']],
    ['a binary file modified by one byte', src => write(src, 'assets/logo.bin', Buffer.from([0x89, 0x50, 0x00, 0x0a, 0xff, 0x0d, 0x01])), ['assets/logo.bin']],
    ['the executable bit removed', src => chmodSync(join(src, 'bin/run.sh'), 0o644), ['bin/run.sh']],
    [
      'a symlink retargeted',
      src => {
        unlinkSync(join(src, 'link-to-a'));
        symlinkSync('src/deep/b.ts', join(src, 'link-to-a'));
      },
      ['link-to-a']
    ],
    [
      'a file replaced by a symlink to identical content',
      src => {
        write(src, 'copy-of-a.ts', 'export const a = 1;\n');
        unlinkSync(join(src, 'README.md'));
        symlinkSync('copy-of-a.ts', join(src, 'README.md'));
      },
      ['README.md', 'copy-of-a.ts']
    ],
    [
      'a symlinked directory replaced by a real one',
      src => {
        unlinkSync(join(src, 'src-dir-link'));
        write(src, 'src-dir-link/a.ts', 'export const a = 1;\n');
      },
      ['src-dir-link', 'src-dir-link/a.ts']
    ],
    ['an empty directory added (not a file)', src => mkdirSync(join(src, 'new-empty')), []],
    [
      'files written only under excluded paths',
      src => {
        write(src, '.factory/run-1/TEST_REPORT.md', 'report\n');
        write(src, 'node_modules/dep/index.js', 'changed\n');
        write(src, 'pkg/sub/.git/config', '[changed]\n');
        write(src, 'src/node_modules/new.js', 'new\n');
      },
      []
    ],
    [
      'a file written through a symlinked directory lands outside and is not seen',
      src => write(src, 'outside-dir/new.txt', 'through the link\n'),
      []
    ]
  ])('AC-126 compareWithCopy reports %s', (_, change, expected) => {
    const { src, dest } = copied();

    change(src);

    expect(compareWithCopy(src, dest)).toEqual(expected);
  });

  it('AC-126 compareWithCopy reports a file deleted from the copy (presence both ways), sorted', () => {
    const src = tempDir('ff-review-src-');
    write(src, 'b.txt');
    write(src, 'a.txt');
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    copyWorkingTree(src, dest);
    unlinkSync(join(dest, 'b.txt'));
    write(dest, 'z.txt');

    expect(compareWithCopy(src, dest)).toEqual(['b.txt', 'z.txt']);
  });
});

// ---------------------------------------------------------------------------------------------
// sealReadOnly

describe('sealReadOnly (D-3, defence in depth)', () => {
  it('AC-117 sealReadOnly makes files 0400 (0500 when executable) and directories 0500, so writes fail with EACCES', () => {
    const { src } = richTree();
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    copyWorkingTree(src, dest);

    sealReadOnly(dest);

    expect(lstatSync(dest).mode & 0o777).toBe(0o500);
    expect(lstatSync(join(dest, 'src')).mode & 0o777).toBe(0o500);
    expect(lstatSync(join(dest, 'empty')).mode & 0o777).toBe(0o500);
    expect(lstatSync(join(dest, 'src/a.ts')).mode & 0o777).toBe(0o400);
    expect(lstatSync(join(dest, 'bin/run.sh')).mode & 0o777).toBe(0o500);
    if (IS_ROOT) return; // root ignores permission bits
    expect(() => writeFileSync(join(dest, 'src/a.ts'), 'changed')).toThrow(expect.objectContaining({ code: 'EACCES' }));
    expect(() => writeFileSync(join(dest, 'src/new.ts'), 'new')).toThrow(expect.objectContaining({ code: 'EACCES' }));
    expect(() => unlinkSync(join(dest, 'README.md'))).toThrow(expect.objectContaining({ code: 'EACCES' }));
    expect(() => mkdirSync(join(dest, 'empty/x'))).toThrow(expect.objectContaining({ code: 'EACCES' }));
    expect(readFileSync(join(dest, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('CRITICAL-1 sealReadOnly is owner-only: no group or other bit on the root, any directory or any file, and the owner can still read', () => {
    const { src } = richTree();
    write(src, 'deep/er/x.txt', 'deep\n', 0o664);
    write(src, 'deep/tool.sh', '#!/bin/sh\n', 0o775);
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    copyWorkingTree(src, dest);

    sealReadOnly(dest);

    const seen: string[] = [];
    const check = (path: string): void => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return;
      seen.push(path);
      expect({ path, groupOrOther: stat.mode & 0o077 }).toEqual({ path, groupOrOther: 0 });
      expect({ path, ownerRead: stat.mode & 0o400 }).toEqual({ path, ownerRead: 0o400 });
      if (stat.isDirectory()) for (const name of readdirSync(path)) check(join(path, name));
      else expect(readFileSync(path).length).toBeGreaterThanOrEqual(0);
    };
    check(dest);
    expect(seen).toContain(dest);
    expect(seen).toContain(join(dest, 'deep/er/x.txt'));
    expect(seen).toContain(join(dest, 'deep/tool.sh'));
  });

  it('AC-117 N-1 sealReadOnly leaves symlinks alone and never changes what they point at', () => {
    const { src, outside } = richTree();
    chmodSync(join(outside, 'secret.txt'), 0o644);
    chmodSync(join(outside, 'dir'), 0o755);
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    copyWorkingTree(src, dest);

    sealReadOnly(dest);

    expect(lstatSync(join(dest, 'secret-link')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dest, 'outside-dir')).isSymbolicLink()).toBe(true);
    expect(statSync(join(outside, 'secret.txt')).mode & 0o777).toBe(0o644);
    expect(statSync(join(outside, 'dir')).mode & 0o777).toBe(0o755);
    expect(statSync(join(outside, 'dir/inner.txt')).mode & 0o777).not.toBe(0o444);
  });
});

// ---------------------------------------------------------------------------------------------
// copyIntact and leafDigest (D-3 resume check; D-B2-2 leaf count and digest)

/** The digest format, spelled out independently of the module: sha256 over `<type>\t<path>\0`, sorted by the path's UTF-8 bytes. */
function expectedDigest(leaves: Array<[string, string]>): string {
  const sorted = [...leaves].sort((a, b) => Buffer.compare(Buffer.from(a[1]), Buffer.from(b[1])));
  return createHash('sha256').update(sorted.map(([type, path]) => `${type}\t${path}\0`).join('')).digest('hex');
}

describe('copyIntact and leafDigest (D-3 resume check; D-B2-2: leaves = files, symlinks, empty directories)', () => {
  /** The layout extractSnapshot writes: 3 files, 1 symlink, 1 gitlink (an empty directory) = 5 leaves. */
  function extractedLayout(): string {
    const dir = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    write(dir, 'src/a.ts');
    write(dir, 'src/deep/b.ts');
    write(dir, 'bin/run.sh', '#!/bin/sh\n', 0o755);
    link(dir, 'link-to-a', 'src/a.ts');
    mkdirSync(join(dir, 'vendor/lib'), { recursive: true });
    return dir;
  }

  /** extractedLayout's leaves, by the D-B2-2 format. */
  const EXTRACTED_LEAVES: Array<[string, string]> = [
    ['f', 'src/a.ts'],
    ['f', 'src/deep/b.ts'],
    ['f', 'bin/run.sh'],
    ['l', 'link-to-a'],
    ['d-empty', 'vendor/lib']
  ];

  it('D-B2-2 leafDigest is sha256 over "<type>\\t<path>\\0" per leaf, sorted by path, with types f, l, d-empty and o', () => {
    const dir = extractedLayout();

    expect(leafDigest(dir)).toEqual({ entries: 5, digest: expectedDigest(EXTRACTED_LEAVES) });
    expect(leafDigest(dir).digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('D-B2-2 leafDigest of an empty directory is 0 leaves and the sha256 of nothing', () => {
    const dir = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);

    expect(leafDigest(dir)).toEqual({ entries: 0, digest: createHash('sha256').update('').digest('hex') });
  });

  it('D-B2-2 leafDigest types any other entry (a unix socket) as o, and hashes paths and types only, never contents or modes', () => {
    // A short path: a unix socket path is limited to about 100 bytes.
    const dir = tempDir('ff-review-src-');
    write(dir, 'a.txt', 'one\n');
    const before = leafDigest(dir);
    write(dir, 'a.txt', 'two, longer\n');
    chmodSync(join(dir, 'a.txt'), 0o755);
    expect(leafDigest(dir)).toEqual(before);

    const server = createServer();
    return new Promise<void>((done, fail) => {
      server.on('error', fail);
      server.listen(join(dir, 's.sock'), () => {
        try {
          expect(leafDigest(dir)).toEqual({ entries: 2, digest: expectedDigest([['f', 'a.txt'], ['o', 's.sock']]) });
          server.close(() => done());
        } catch (error) {
          server.close(() => fail(error));
        }
      });
    });
  });

  it('D-B2-2 leafDigest is the same for a fallback copy, an extraction-shaped copy of the same tree, and either one sealed', () => {
    // The source tree as extractSnapshot would lay it out from a snapshot of it.
    const src = tempDir('ff-review-src-');
    write(src, 'src/a.ts');
    write(src, 'src/deep/b.ts');
    write(src, 'bin/run.sh', '#!/bin/sh\n', 0o755);
    link(src, 'link-to-a', 'src/a.ts');
    mkdirSync(join(src, 'vendor/lib'), { recursive: true });
    const extracted = extractedLayout();
    const copy = createReviewDir(tempDir('ff-review-root-'), 'run-1', 2);

    const record = copyWorkingTree(src, copy);

    expect(record).toEqual(leafDigest(extracted));
    sealReadOnly(copy);
    sealReadOnly(extracted);
    expect(leafDigest(copy)).toEqual(record);
    expect(leafDigest(extracted)).toEqual(record);
  });

  it('D-B2-2 copyWorkingTree returns the leaf count and digest of what it wrote (the exclusions are not in it)', () => {
    const { src } = richTree();
    const dest = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);

    const record = copyWorkingTree(src, dest);

    expect(record).toEqual(leafDigest(dest));
    expect(Object.keys(record).sort()).toEqual(['digest', 'entries']);
  });

  it.each<[string, (dir: string) => void]>([
    ['a file is added', dir => write(dir, 'src/extra.ts')],
    ['a file is removed', dir => unlinkSync(join(dir, 'src/a.ts'))],
    ['a file is renamed in place (same count)', dir => renameSync(join(dir, 'src/a.ts'), join(dir, 'src/z.ts'))],
    ['a file is moved to another directory (same count)', dir => renameSync(join(dir, 'src/a.ts'), join(dir, 'bin/a.ts'))],
    [
      'a file becomes a symlink (same path)',
      dir => {
        unlinkSync(join(dir, 'src/a.ts'));
        symlinkSync('../bin/run.sh', join(dir, 'src/a.ts'));
      }
    ],
    [
      'a symlink becomes a file (same path)',
      dir => {
        unlinkSync(join(dir, 'link-to-a'));
        write(dir, 'link-to-a', 'now a file\n');
      }
    ],
    [
      'a file becomes an empty directory (same path)',
      dir => {
        unlinkSync(join(dir, 'bin/run.sh'));
        mkdirSync(join(dir, 'bin/run.sh'));
      }
    ],
    ['the empty directory gets a file (same count)', dir => (rmSync(join(dir, 'vendor/lib'), { recursive: true }), write(dir, 'vendor/lib'))]
  ])('D-B2-2 leafDigest changes when %s', (_, change) => {
    const dir = extractedLayout();
    const before = leafDigest(dir);

    change(dir);

    expect(leafDigest(dir).digest).not.toBe(before.digest);
  });

  it('D-B2-2 leafDigest throws when the directory is missing or not a real directory (copyIntact turns that into false)', () => {
    const root = tempDir('ff-review-root-');
    expect(() => leafDigest(join(root, 'missing'))).toThrow();
    expect(() => leafDigest(write(root, 'file.txt'))).toThrow();
  });

  it('AC-123 copyIntact counts the leaves extractSnapshot counts: files, symlinks and gitlink empty directories, not intermediate directories', () => {
    const dir = extractedLayout();
    const { digest } = leafDigest(dir);

    expect(copyIntact(dir, { entries: 5, digest })).toBe(true);
    expect(copyIntact(dir, { entries: 4, digest })).toBe(false);
    expect(copyIntact(dir, { entries: 9, digest })).toBe(false);
    sealReadOnly(dir);
    expect(copyIntact(dir, { entries: 5, digest })).toBe(true);
  });

  it('AC-123 copyIntact counts an empty copy as 0 leaves', () => {
    const dir = createReviewDir(tempDir('ff-review-root-'), 'run-1', 1);
    const { digest } = leafDigest(dir);

    expect(copyIntact(dir, { entries: 0, digest })).toBe(true);
    expect(copyIntact(dir, { entries: 1, digest })).toBe(false);
  });

  it.each<[string, (dir: string) => string]>([
    ['a file was deleted', dir => (unlinkSync(join(dir, 'bin/run.sh')), rmSync(join(dir, 'bin'), { recursive: true }), dir)],
    ['a file was deleted from a directory that still holds another leaf', dir => (unlinkSync(join(dir, 'src/a.ts')), dir)],
    ['a file was added', dir => (write(dir, 'src/extra.ts'), dir)],
    ['a symlink was deleted', dir => (unlinkSync(join(dir, 'link-to-a')), dir)],
    ['the gitlink directory was deleted with its parent', dir => (rmSync(join(dir, 'vendor'), { recursive: true }), dir)],
    ['a file was renamed, so the count still matches', dir => (renameSync(join(dir, 'src/a.ts'), join(dir, 'src/z.ts')), dir)],
    ['the directory is gone', dir => (rmSync(dir, { recursive: true }), dir)],
    [
      'the path is now a file',
      dir => {
        rmSync(dir, { recursive: true });
        writeFileSync(dir, 'not a directory');
        return dir;
      }
    ],
    [
      'the path is a symlink to an intact copy',
      dir => {
        const via = join(dirname(dir), 'via-link');
        symlinkSync(dir, via);
        return via;
      }
    ]
  ])('AC-123 copyIntact is false when %s', (_, damage) => {
    const dir = extractedLayout();
    const record = leafDigest(dir);

    expect(copyIntact(damage(dir), record)).toBe(false);
  });

  it('AC-123 D-B2-2 copyIntact detects a deletion that leaves its directory empty (the count alone could not: the directory counts in its place)', () => {
    // The step-3 known limit, closed by the digest (operator decision D-B2-2): a temp cleaner that
    // deletes a file but keeps its emptied directory leaves the count at 5.
    const dir = extractedLayout();
    const record = leafDigest(dir);
    unlinkSync(join(dir, 'src/deep/b.ts'));
    rmSync(join(dir, 'vendor/lib'), { recursive: true });

    expect(leafDigest(dir).entries).toBe(record.entries);
    expect(copyIntact(dir, record)).toBe(false);
  });

  it.each<[string, { entries: number; digest: string }]>([
    ['a negative count', { entries: -5, digest: 'a'.repeat(64) }],
    ['a fractional count', { entries: 5.5, digest: 'a'.repeat(64) }],
    ['a digest that is not 64 lowercase hex', { entries: 5, digest: 'A'.repeat(64) }],
    ['a missing digest', { entries: 5 } as { entries: number; digest: string }],
    ['no record at all', undefined as unknown as { entries: number; digest: string }]
  ])('AC-123 copyIntact is false for %s', (_, record) => {
    const dir = extractedLayout();

    expect(copyIntact(dir, record)).toBe(false);
  });

  it('D-B2-2 copyIntact is false when the count matches but the digest is another tree\'s', () => {
    const dir = extractedLayout();
    const other = createReviewDir(tempDir('ff-review-root-'), 'run-1', 2);
    for (const name of ['a', 'b', 'c', 'd', 'e']) write(other, name);

    expect(copyIntact(dir, { entries: 5, digest: leafDigest(other).digest })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// mapReviewPath and insideReviewCopies

describe('mapReviewPath and insideReviewCopies (D-3, D-15)', () => {
  const COPY = '/private/var/folders/ab/T/factory-review-run-1-e1-XyZ123';
  const TWIN = '/var/folders/ab/T/factory-review-run-1-e1-XyZ123';

  it.each<[string, string, string]>([
    ['a file inside the copy', `${COPY}/src/a.ts`, 'src/a.ts'],
    ['a nested file inside the copy', `${COPY}/src/deep/b.ts`, 'src/deep/b.ts'],
    ['the copy itself', COPY, ''],
    ['a path with .. that stays inside', `${COPY}/src/../README.md`, 'README.md'],
    ['a file inside the non-realpath twin (/var for /private/var)', `${TWIN}/src/a.ts`, 'src/a.ts'],
    ['a relative path', 'src/a.ts', 'src/a.ts'],
    ['a ./ relative path', './src/a.ts', './src/a.ts'],
    ['a project-absolute path', '/Users/dev/project/src/a.ts', '/Users/dev/project/src/a.ts'],
    ['a sibling whose name extends the copy', `${COPY}x/src/a.ts`, `${COPY}x/src/a.ts`],
    ['a path that leaves the copy through ..', `${COPY}/../other/a.ts`, `${COPY}/../other/a.ts`]
  ])('AC-117 mapReviewPath maps %s', (_, file, expected) => {
    expect(mapReviewPath(file, COPY)).toBe(expected);
  });

  it('AC-117 mapReviewPath maps the /private/var twin when the copy is recorded as /var', () => {
    expect(mapReviewPath(`${COPY}/src/a.ts`, TWIN)).toBe('src/a.ts');
    expect(mapReviewPath('/private/tmp/factory-review-r-e1-a/x.ts', '/tmp/factory-review-r-e1-a')).toBe('x.ts');
    expect(mapReviewPath('/tmp/factory-review-r-e1-a/x.ts', '/private/tmp/factory-review-r-e1-a')).toBe('x.ts');
    // Only the macOS /var, /tmp and /etc links have a twin.
    expect(mapReviewPath('/private/home/x/a.ts', '/home/x')).toBe('/private/home/x/a.ts');
  });

  it('AC-117 mapReviewPath maps a path under os.tmpdir() as given into a copy created by createReviewDir (realpath)', () => {
    const root = tempDir('ff-review-root-');
    const copy = createReviewDir(root, 'run-1', 1);
    const unresolvedTmp = tmpdir();
    const asGiven = join(unresolvedTmp, copy.slice(realpathSync(unresolvedTmp).length), 'src', 'a.ts');

    expect(mapReviewPath(asGiven, copy)).toBe('src/a.ts');
    expect(mapReviewPath(join(copy, 'src', 'a.ts'), copy)).toBe('src/a.ts');
  });

  it('AC-117 insideReviewCopies returns, as claimed and in order, every claim inside any copy or its twin', () => {
    const cwd = '/Users/dev/project';
    const other = '/private/tmp/factory-review-run-1-e2-Abc';
    const claims = [
      'src/a.ts',
      `${COPY}/src/a.ts`,
      `${TWIN}/README.md`,
      `../../../private/var/folders/ab/T/factory-review-run-1-e1-XyZ123/x.ts`,
      '/tmp/factory-review-run-1-e2-Abc/y.ts',
      `${COPY.toUpperCase()}/CASE.ts`,
      `${COPY}x/sibling.ts`,
      COPY,
      '/Users/dev/project/src/b.ts'
    ];

    expect(insideReviewCopies(claims, [COPY, other], cwd)).toEqual([
      `${COPY}/src/a.ts`,
      `${TWIN}/README.md`,
      `../../../private/var/folders/ab/T/factory-review-run-1-e1-XyZ123/x.ts`,
      '/tmp/factory-review-run-1-e2-Abc/y.ts',
      `${COPY.toUpperCase()}/CASE.ts`,
      COPY
    ]);
    expect(insideReviewCopies(claims, [], cwd)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// reviewRootProblem (MINOR-6)

describe('reviewRootProblem (MINOR-6)', () => {
  it('MINOR-6 a review root outside the project is accepted: a sibling whose name extends it, another directory, or one holding the project (copies go directly under the root)', () => {
    const project = tempDir('ff-project-');
    expect(reviewRootProblem(`${project}-review`, project)).toBeUndefined();
    expect(reviewRootProblem(tempDir('ff-elsewhere-'), project)).toBeUndefined();
    expect(reviewRootProblem(dirname(project), project)).toBeUndefined();
  });

  it.each<[string, (project: string) => string, RegExp]>([
    ['the project itself', project => project, /is inside the project/],
    ['a directory inside the project, not yet created', project => join(project, 'a', 'b'), /is inside the project/],
    ['a directory inside the project, in another letter case', project => join(project.toUpperCase(), 'copies'), /is inside the project/]
  ])('MINOR-6 refuses a review root that is %s', (_label, root, message) => {
    const project = tempDir('ff-project-');
    expect(reviewRootProblem(root(project), project)).toMatch(message);
  });

  it('MINOR-6 sees through a symlinked review root and a project reached through a symlink', () => {
    const project = tempDir('ff-project-');
    const holder = tempDir('ff-holder-');
    symlinkSync(project, join(holder, 'link-to-project'));

    expect(reviewRootProblem(join(holder, 'link-to-project', 'copies'), project)).toMatch(/is inside the project/);
    expect(reviewRootProblem(join(project, 'copies'), join(holder, 'link-to-project'))).toMatch(/is inside the project/);
  });
});
