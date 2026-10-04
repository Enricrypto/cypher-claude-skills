/**
 * SW — safe writes (A-2, D-12, NEW-MINOR-1).
 *
 * The harness writes its own documents into a run directory that builders (with Write and Bash)
 * can also touch. A symlink planted there must not turn a harness write into a write somewhere
 * else: `writeFileNoFollow` refuses a symlinked target and a directory that resolves outside the
 * container, and `writeFileAtomic` replaces a symlink by rename instead of writing through it.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import { UnsafeArtifactPathError, writeFileAtomic, writeFileNoFollow } from '../../harness/safe-write';
import { UnsafeArtifactPathError as StageContextUnsafeArtifactPathError } from '../../harness/stage-context';
import { tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;
let outside: TempProject;

beforeEach(() => {
  project = tempProject('ff-safe-write-');
  outside = tempProject('ff-safe-write-outside-');
});

afterEach(() => {
  project.cleanup();
  outside.cleanup();
});

describe('writeFileNoFollow', () => {
  it('writes a regular file inside the container, creating missing directories', () => {
    const path = writeFileNoFollow(project.dir, join('.factory', 'run-1', 'TEST_REPORT.md'), 'report\n');

    expect(path).toBe(join(project.dir, '.factory', 'run-1', 'TEST_REPORT.md'));
    expect(readFileSync(path, 'utf-8')).toBe('report\n');
  });

  it('overwrites an existing regular file', () => {
    mkdirSync(join(project.dir, 'docs'));
    writeFileSync(join(project.dir, 'docs', 'A.md'), 'old');

    writeFileNoFollow(project.dir, join(project.dir, 'docs', 'A.md'), 'new');

    expect(readFileSync(join(project.dir, 'docs', 'A.md'), 'utf-8')).toBe('new');
  });

  it('NEW-MINOR-1 writeFileNoFollow refuses a symlinked target or a directory resolving outside the container', () => {
    // A symlinked target: the write must not land in the file it points at.
    const victim = join(outside.dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    mkdirSync(join(project.dir, 'run'));
    symlinkSync(victim, join(project.dir, 'run', 'TEST_REPORT.md'));

    expect(() => writeFileNoFollow(project.dir, join('run', 'TEST_REPORT.md'), 'pwned')).toThrow(UnsafeArtifactPathError);
    expect(readFileSync(victim, 'utf-8')).toBe('untouched');

    // A symlinked directory resolving outside the container: refused, nothing written there.
    symlinkSync(outside.dir, join(project.dir, 'escape'));
    expect(() => writeFileNoFollow(project.dir, join('escape', 'X.md'), 'pwned')).toThrow(UnsafeArtifactPathError);
    expect(existsSync(join(outside.dir, 'X.md'))).toBe(false);

    // ...including a missing directory below it: nothing is created outside either.
    expect(() => writeFileNoFollow(project.dir, join('escape', 'deeper', 'X.md'), 'pwned')).toThrow(
      UnsafeArtifactPathError
    );
    expect(existsSync(join(outside.dir, 'deeper'))).toBe(false);
  });

  it('refuses a dangling symlink as the target', () => {
    symlinkSync(join(outside.dir, 'not-yet.txt'), join(project.dir, 'DANGLING.md'));

    expect(() => writeFileNoFollow(project.dir, 'DANGLING.md', 'pwned')).toThrow(UnsafeArtifactPathError);
    expect(existsSync(join(outside.dir, 'not-yet.txt'))).toBe(false);
  });

  it('refuses a target that is a directory, not a regular file', () => {
    mkdirSync(join(project.dir, 'A.md'));

    expect(() => writeFileNoFollow(project.dir, 'A.md', 'x')).toThrow(UnsafeArtifactPathError);
  });

  it('refuses a path that escapes the container lexically, or is the container itself', () => {
    expect(() => writeFileNoFollow(project.dir, join('..', 'x.md'), 'x')).toThrow(UnsafeArtifactPathError);
    expect(() => writeFileNoFollow(project.dir, join(outside.dir, 'x.md'), 'x')).toThrow(UnsafeArtifactPathError);
    expect(() => writeFileNoFollow(project.dir, project.dir, 'x')).toThrow(UnsafeArtifactPathError);
    expect(existsSync(join(outside.dir, 'x.md'))).toBe(false);
  });

  it('allows a symlinked directory that resolves inside the container', () => {
    mkdirSync(join(project.dir, 'real'));
    symlinkSync(join(project.dir, 'real'), join(project.dir, 'alias'));

    writeFileNoFollow(project.dir, join('alias', 'A.md'), 'ok');

    expect(readFileSync(join(project.dir, 'real', 'A.md'), 'utf-8')).toBe('ok');
  });

  it('refuses a container that does not exist', () => {
    expect(() => writeFileNoFollow(join(project.dir, 'missing'), 'A.md', 'x')).toThrow(UnsafeArtifactPathError);
  });

  it('is the same UnsafeArtifactPathError stage-context has always thrown', () => {
    expect(StageContextUnsafeArtifactPathError).toBe(UnsafeArtifactPathError);
  });
});

describe('writeFileAtomic', () => {
  it('writes the content and leaves no scratch file behind', () => {
    const target = join(project.dir, 'baseline.json');

    writeFileAtomic(target, '{"a":1}\n');

    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
    expect(readdirSync(project.dir)).toEqual(['baseline.json']);
  });

  it('replaces a symlinked target instead of writing through it', () => {
    const victim = join(outside.dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    const target = join(project.dir, 'state.json');
    symlinkSync(victim, target);

    writeFileAtomic(target, 'fresh');

    expect(readFileSync(victim, 'utf-8')).toBe('untouched');
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe('fresh');
  });

  it('throws and leaves no scratch file when the rename fails', () => {
    mkdirSync(join(project.dir, 'state.json')); // renaming a file onto a directory fails

    expect(() => writeFileAtomic(join(project.dir, 'state.json'), 'x')).toThrow();
    expect(readdirSync(project.dir).filter(entry => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to write through a symlink planted at its scratch-file name', () => {
    const victim = join(outside.dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(project.dir, `.state.json.${process.pid}.tmp`));

    expect(() => writeFileAtomic(join(project.dir, 'state.json'), 'pwned')).toThrow();
    expect(readFileSync(victim, 'utf-8')).toBe('untouched');
  });
});
