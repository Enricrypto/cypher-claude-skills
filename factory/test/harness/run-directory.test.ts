/**
 * RD — the run-directory lifecycle (A-2, D-9; AC-40, AC-41, AC-73; carry-over 2; I-1, I-13).
 *
 * A finished run (SUCCESS, MANUAL_STOP, or a pre-A-2 directory with no state.json) is archived,
 * intact, into `.factory/_archive/<id>/` when a new run starts. Nothing is ever deleted. An
 * unfinished run (ACTIVE, PAUSED, ESCALATED) is never moved, and blocks a new run until it is
 * resumed or closed. A corrupt state.json refuses the start, naming the directory.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  ARCHIVE_DIRNAME,
  assertNoFactoryCaseVariant,
  closeRun,
  findRun,
  isSafeRunId,
  listRunDirectories,
  prepareNewRunDirectory,
  SUPERSEDED_DIRNAME,
  supersedeArtifacts
} from '../../harness/run-directory';
import { UnsafeArtifactPathError } from '../../harness/safe-write';
import { isSafeRunId as lifecycleIsSafeRunId, RunClass, RunRefusedError } from '../../harness/run-lifecycle';
import { loadState, loadStateFrom, saveState, saveStateIn, stateFilePath, stateFilePathIn } from '../../harness/state-store';
import { createFeatureState, FeatureState } from '../../harness/state-tracker';
import { runFeatureFactory } from '../../feature/workflows/feature-factory-orchestrator';
import { researcher, story } from '../fixtures/agent-outputs';
import { scriptedInvoker, SEEDED_DOCUMENT, seedRun, tempProject, TempProject } from '../fixtures/harness-run';
import { fakeChangeTracker } from '../fixtures/changes';
import { plantFactoryCaseVariant, tempFileSystemIsCaseInsensitive, treeSnapshot } from '../fixtures/factory-case-variant';

let project: TempProject;
let cwd: string;

beforeEach(() => {
  project = tempProject('ff-run-dir-');
  cwd = project.dir;
});

afterEach(() => {
  project.cleanup();
});

const live = (id: string) => join(cwd, '.factory', id);
const archived = (id: string) => join(cwd, '.factory', ARCHIVE_DIRNAME, id);

/** Every file under a run directory, with its bytes: "intact" means this does not change. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) files[name] = readFileSync(join(dir, name), 'utf-8');
  return files;
}

function refusal(fn: () => unknown): RunRefusedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RunRefusedError) return error;
    throw error;
  }
  throw new Error('expected a RunRefusedError, nothing was thrown');
}

describe('prepareNewRunDirectory: archive finished runs, refuse while one is unfinished', () => {
  it('does nothing, and creates nothing, when there is no .factory/ yet', () => {
    expect(prepareNewRunDirectory(cwd)).toEqual({ archived: [] });
    expect(existsSync(join(cwd, '.factory'))).toBe(false);
  });

  it('AC-40 a new run start archives SUCCESS and MANUAL_STOP runs intact into .factory/_archive/<id>/ and leaves PAUSED and ESCALATED runs untouched', () => {
    const success = seedRun(cwd, 'SUCCESS');
    const stopped = seedRun(cwd, 'MANUAL_STOP');
    const paused = seedRun(cwd, 'PAUSED');
    const escalated = seedRun(cwd, 'ESCALATED');
    const before = {
      success: snapshot(live(success.featureId)),
      stopped: snapshot(live(stopped.featureId)),
      paused: snapshot(live(paused.featureId)),
      escalated: snapshot(live(escalated.featureId))
    };

    // Unfinished runs exist, so the start is refused — AFTER the finished ones are archived (I-1).
    expect(refusal(() => prepareNewRunDirectory(cwd)).code).toBe('ACTIVE_RUN_EXISTS');

    expect(existsSync(live(success.featureId))).toBe(false);
    expect(existsSync(live(stopped.featureId))).toBe(false);
    expect(snapshot(archived(success.featureId))).toEqual(before.success);
    expect(snapshot(archived(stopped.featureId))).toEqual(before.stopped);

    expect(snapshot(live(paused.featureId))).toEqual(before.paused);
    expect(snapshot(live(escalated.featureId))).toEqual(before.escalated);
    expect(existsSync(archived(paused.featureId))).toBe(false);
    expect(existsSync(archived(escalated.featureId))).toBe(false);
  });

  it('archives every finished run and reports them when nothing is unfinished', () => {
    const success = seedRun(cwd, 'SUCCESS');
    const stopped = seedRun(cwd, 'MANUAL_STOP');

    const result = prepareNewRunDirectory(cwd);

    expect(result.archived).toEqual([success.featureId, stopped.featureId].sort());
    expect(loadStateFrom(archived(success.featureId), success.featureId)).toEqual(success);
    expect(loadStateFrom(archived(stopped.featureId), stopped.featureId)).toEqual(stopped);
    expect(listRunDirectories(cwd)).toEqual([]);
  });

  it('AC-40 .factory/_archive/ and baseline.json are never moved or deleted', () => {
    mkdirSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'an-old-run'), { recursive: true });
    writeFileSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'an-old-run', 'NOTES.md'), 'kept');
    writeFileSync(join(cwd, '.factory', 'baseline.json'), '{"schemaVersion":1}');
    writeFileSync(join(cwd, '.factory', 'README.txt'), 'a regular file');
    const success = seedRun(cwd, 'SUCCESS');

    prepareNewRunDirectory(cwd);

    expect(readFileSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'an-old-run', 'NOTES.md'), 'utf-8')).toBe('kept');
    expect(readFileSync(join(cwd, '.factory', 'baseline.json'), 'utf-8')).toBe('{"schemaVersion":1}');
    expect(readFileSync(join(cwd, '.factory', 'README.txt'), 'utf-8')).toBe('a regular file');
    expect(existsSync(archived(success.featureId))).toBe(true);
    expect(existsSync(join(cwd, '.factory', ARCHIVE_DIRNAME, ARCHIVE_DIRNAME))).toBe(false);
  });

  it.each<RunClass>(['ACTIVE', 'PAUSED', 'ESCALATED'])(
    'AC-41 a new run is refused while a %s run exists, naming its id, --resume and --close, and nothing unfinished is moved',
    runClass => {
      const unfinished = seedRun(cwd, runClass);
      const before = snapshot(live(unfinished.featureId));

      const error = refusal(() => prepareNewRunDirectory(cwd));

      expect(error.code).toBe('ACTIVE_RUN_EXISTS');
      expect(error.message).toContain(unfinished.featureId);
      expect(error.message).toContain(`npm run factory -- --resume ${unfinished.featureId} --cwd`);
      expect(error.message).toContain(`--close ${unfinished.featureId}`);
      expect(snapshot(live(unfinished.featureId))).toEqual(before);
      expect(existsSync(join(cwd, '.factory', ARCHIVE_DIRNAME))).toBe(false);
    }
  );

  it('names every unfinished run when there are several', () => {
    const a = seedRun(cwd, 'PAUSED');
    const b = seedRun(cwd, 'ESCALATED');

    const error = refusal(() => prepareNewRunDirectory(cwd));

    expect(error.message).toContain(`--close ${a.featureId}`);
    expect(error.message).toContain(`--close ${b.featureId}`);
  });

  it('I-13 a directory without state.json (a pre-A-2 leftover) is archived intact', () => {
    mkdirSync(live('stale-run'), { recursive: true });
    writeFileSync(join(live('stale-run'), 'TECHNICAL_BRIEF.md'), '# An old brief');

    expect(prepareNewRunDirectory(cwd).archived).toEqual(['stale-run']);

    expect(existsSync(live('stale-run'))).toBe(false);
    expect(readFileSync(join(archived('stale-run'), 'TECHNICAL_BRIEF.md'), 'utf-8')).toBe('# An old brief');
  });

  it.each([
    ['not JSON', '{ not json'],
    ['JSON null', 'null'],
    ['a state for another run id', JSON.stringify(createFeatureState('someone-else'))]
  ])('I-13 a corrupt state.json (%s) refuses the start with UNREADABLE_RUN naming the directory, and it is not moved', (_label, content) => {
    mkdirSync(live('broken-run'), { recursive: true });
    writeFileSync(join(live('broken-run'), 'state.json'), content);
    const success = seedRun(cwd, 'SUCCESS');

    const error = refusal(() => prepareNewRunDirectory(cwd));

    expect(error.code).toBe('UNREADABLE_RUN');
    expect(error.message).toContain(live('broken-run'));
    expect(readFileSync(join(live('broken-run'), 'state.json'), 'utf-8')).toBe(content);
    // Finished runs are still archived first (I-1): the refusal is about the broken one only.
    expect(existsSync(archived(success.featureId))).toBe(true);
  });

  it('treats a state.json that is a symlink as unreadable, without following it', () => {
    const elsewhere = tempProject('ff-run-dir-elsewhere-');
    try {
      const real = createFeatureState('linked');
      writeFileSync(join(elsewhere.dir, 'state.json'), JSON.stringify(real));
      mkdirSync(live(real.featureId), { recursive: true });
      symlinkSync(join(elsewhere.dir, 'state.json'), join(live(real.featureId), 'state.json'));

      expect(refusal(() => prepareNewRunDirectory(cwd)).code).toBe('UNREADABLE_RUN');
      expect(existsSync(live(real.featureId))).toBe(true);
    } finally {
      elsewhere.cleanup();
    }
  });

  it('never deletes on a name collision in _archive/: the newcomer gets a timestamp suffix', () => {
    const success = seedRun(cwd, 'SUCCESS');
    mkdirSync(archived(success.featureId), { recursive: true });
    writeFileSync(join(archived(success.featureId), 'EARLIER.md'), 'earlier');

    prepareNewRunDirectory(cwd, new Date('2026-10-04T19:03:12.345Z'));

    expect(readFileSync(join(archived(success.featureId), 'EARLIER.md'), 'utf-8')).toBe('earlier');
    const suffixed = archived(`${success.featureId}.20261004T190312345Z`);
    expect(loadStateFrom(suffixed, success.featureId)).toEqual(success);
  });

  it('ignores a symlink in .factory/: it is neither followed nor moved', () => {
    const elsewhere = tempProject('ff-run-dir-elsewhere-');
    try {
      mkdirSync(join(cwd, '.factory'), { recursive: true });
      symlinkSync(elsewhere.dir, join(cwd, '.factory', 'linked-run'));

      expect(prepareNewRunDirectory(cwd)).toEqual({ archived: [] });
      expect(existsSync(join(cwd, '.factory', 'linked-run'))).toBe(true);
    } finally {
      elsewhere.cleanup();
    }
  });

  it('refuses to archive into an _archive that is not a real directory', () => {
    const elsewhere = tempProject('ff-run-dir-elsewhere-');
    try {
      const success = seedRun(cwd, 'SUCCESS');
      symlinkSync(elsewhere.dir, join(cwd, '.factory', ARCHIVE_DIRNAME));

      expect(refusal(() => prepareNewRunDirectory(cwd)).code).toBe('UNREADABLE_RUN');
      expect(existsSync(live(success.featureId))).toBe(true);
      expect(readdirSync(elsewhere.dir)).toEqual([]);
    } finally {
      elsewhere.cleanup();
    }
  });

  it('MINOR-1 a .factory that is a symlink refuses a fresh start with UNREADABLE_RUN naming it, never read as empty', () => {
    const elsewhere = tempProject('ff-run-dir-elsewhere-');
    try {
      mkdirSync(join(elsewhere.dir, 'someone-elses-run'));
      symlinkSync(elsewhere.dir, join(cwd, '.factory'));

      const error = refusal(() => prepareNewRunDirectory(cwd));

      expect(error.code).toBe('UNREADABLE_RUN');
      expect(error.message).toContain(join(cwd, '.factory'));
      expect(error.message).toMatch(/symlink/);
      expect(readdirSync(elsewhere.dir)).toEqual(['someone-elses-run']);
    } finally {
      elsewhere.cleanup();
    }
  });

  it('MINOR-1 a .factory that is a regular file refuses a fresh start with UNREADABLE_RUN naming it', () => {
    writeFileSync(join(cwd, '.factory'), 'not a directory');

    const error = refusal(() => prepareNewRunDirectory(cwd));

    expect(error.code).toBe('UNREADABLE_RUN');
    expect(error.message).toContain(join(cwd, '.factory'));
    expect(error.message).toMatch(/not a directory/);
    expect(readFileSync(join(cwd, '.factory'), 'utf-8')).toBe('not a directory');
  });

  it('MINOR-7 an archive directory spelled in another letter case is never listed or archived as a run (no raw EINVAL)', () => {
    const success = seedRun(cwd, 'SUCCESS');
    const otherCase = join(cwd, '.factory', '_Archive');
    mkdirSync(join(otherCase, 'an-old-run'), { recursive: true });
    writeFileSync(join(otherCase, 'an-old-run', 'OLD.md'), 'old');

    expect(listRunDirectories(cwd).map(entry => entry.name)).toEqual([success.featureId]);
    expect(prepareNewRunDirectory(cwd)).toEqual({ archived: [success.featureId] });

    // On a case-insensitive file system `_archive` IS `_Archive`; on a case-sensitive one it is a
    // separate directory. Either way the finished run is archived and the old one is untouched.
    expect(loadStateFrom(archived(success.featureId), success.featureId)).toEqual(success);
    expect(readFileSync(join(otherCase, 'an-old-run', 'OLD.md'), 'utf-8')).toBe('old');
  });
});

describe('listRunDirectories', () => {
  it('classifies every live run directory, never _archive, sorted by name', () => {
    const paused = seedRun(cwd, 'PAUSED');
    const success = seedRun(cwd, 'SUCCESS');
    mkdirSync(live('stale-run'), { recursive: true });
    mkdirSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'x'), { recursive: true });

    const entries = listRunDirectories(cwd);

    expect(entries.map(entry => entry.name)).toEqual([paused.featureId, success.featureId, 'stale-run'].sort());
    const byName = Object.fromEntries(entries.map(entry => [entry.name, entry]));
    expect(byName[paused.featureId]).toMatchObject({ kind: 'run', runClass: 'PAUSED', path: live(paused.featureId) });
    expect(byName[success.featureId]).toMatchObject({ kind: 'run', runClass: 'SUCCESS' });
    expect(byName['stale-run']).toMatchObject({ kind: 'unrecognised' });
  });
});

describe('closeRun (AC-73)', () => {
  it.each<RunClass>(['PAUSED', 'ESCALATED', 'ACTIVE'])(
    'AC-73 closing a PAUSED, ESCALATED or IN_PROGRESS run sets MANUAL_STOP and the next fresh start archives it (%s)',
    runClass => {
      const seeded = seedRun(cwd, runClass);
      const now = '2026-10-04T20:00:00.000Z';

      const closed = closeRun(cwd, seeded.featureId, now);

      expect(closed.completionStatus).toBe('MANUAL_STOP');
      expect(closed.finalSummary).toBe('Closed by operator (--close)');
      expect(closed.completedAt).toBe(now);
      expect(loadState(cwd, seeded.featureId)).toEqual(closed);
      if (runClass === 'PAUSED') expect(closed.pendingCheckpoint).toEqual(seeded.pendingCheckpoint);

      expect(prepareNewRunDirectory(cwd).archived).toEqual([seeded.featureId]);
      expect(loadStateFrom(archived(seeded.featureId), seeded.featureId)?.completionStatus).toBe('MANUAL_STOP');
      expect(readFileSync(join(archived(seeded.featureId), SEEDED_DOCUMENT), 'utf-8')).toContain(seeded.featureId);
    }
  );

  it.each<RunClass>(['SUCCESS', 'MANUAL_STOP'])(
    'AC-73 closing a SUCCESS or MANUAL_STOP run is refused and state.json is unchanged (%s)',
    runClass => {
      const seeded = seedRun(cwd, runClass);
      const before = readFileSync(stateFilePath(cwd, seeded.featureId), 'utf-8');

      expect(refusal(() => closeRun(cwd, seeded.featureId)).code).toBe('RUN_FINISHED');
      expect(readFileSync(stateFilePath(cwd, seeded.featureId), 'utf-8')).toBe(before);
    }
  );

  it('refuses an archived run as already finished', () => {
    const seeded = seedRun(cwd, 'SUCCESS');
    prepareNewRunDirectory(cwd);

    expect(refusal(() => closeRun(cwd, seeded.featureId)).code).toBe('RUN_FINISHED');
  });

  it('refuses an unknown run id', () => {
    expect(refusal(() => closeRun(cwd, 'no-such-run')).code).toBe('RUN_NOT_FOUND');
  });

  it.each(['../x', 'a/b', '.hidden', '_archive', ''])('SEC refuses the unsafe run id %p before touching the disk', id => {
    expect(refusal(() => closeRun(cwd, id)).code).toBe('INVALID_RUN_ID');
  });

  it('refuses a corrupt state.json, naming it, and leaves it as it was', () => {
    mkdirSync(live('broken-run'), { recursive: true });
    writeFileSync(join(live('broken-run'), 'state.json'), '{ not json');

    const error = refusal(() => closeRun(cwd, 'broken-run'));

    expect(error.code).toBe('UNREADABLE_RUN');
    expect(error.message).toContain(live('broken-run'));
    expect(readFileSync(join(live('broken-run'), 'state.json'), 'utf-8')).toBe('{ not json');
  });
});

describe('findRun', () => {
  it('prefers the live copy when an id exists both live and archived', () => {
    const success = seedRun(cwd, 'SUCCESS');
    mkdirSync(archived(success.featureId), { recursive: true });
    saveStateIn(archived(success.featureId), success);

    expect(findRun(cwd, success.featureId)?.location).toBe('live');
  });

  it('returns the location and directory of live and archived runs, and undefined for neither', () => {
    const success = seedRun(cwd, 'SUCCESS');
    expect(findRun(cwd, success.featureId)).toEqual({ state: success, location: 'live', runDir: live(success.featureId) });

    prepareNewRunDirectory(cwd);
    expect(findRun(cwd, success.featureId)).toEqual({
      state: success,
      location: 'archive',
      runDir: archived(success.featureId)
    });

    expect(findRun(cwd, 'no-such-run')).toBeUndefined();
  });

  it('refuses an unsafe id instead of joining it under .factory/', () => {
    expect(refusal(() => findRun(cwd, '../../etc')).code).toBe('INVALID_RUN_ID');
  });
});

describe('run ids', () => {
  it('re-exports isSafeRunId from run-lifecycle rather than duplicating it', () => {
    expect(isSafeRunId).toBe(lifecycleIsSafeRunId);
  });
});

describe('state-store directory variants (D-9)', () => {
  it('saveStateIn / loadStateFrom round-trip a state in any run directory, including an archived one', () => {
    const state = createFeatureState('archived-record');
    const dir = archived(state.featureId);
    mkdirSync(dir, { recursive: true });

    expect(saveStateIn(dir, state)).toBe(stateFilePathIn(dir));
    expect(stateFilePathIn(dir)).toBe(join(dir, 'state.json'));
    expect(loadStateFrom(dir, state.featureId)).toEqual(state);
    expect(loadStateFrom(join(cwd, 'nowhere'), state.featureId)).toBeUndefined();
  });

  it('saveState and loadState still write and read <cwd>/.factory/<id>/state.json', () => {
    const state = createFeatureState('live-record');

    saveState(cwd, state);

    expect(stateFilePath(cwd, state.featureId)).toBe(stateFilePathIn(live(state.featureId)));
    expect(loadStateFrom(live(state.featureId), state.featureId)).toEqual(state);
  });

  it('loadStateFrom refuses a state that belongs to another run', () => {
    const state = createFeatureState('impostor');
    const dir = live('claimed-id');
    mkdirSync(dir, { recursive: true });
    saveStateIn(dir, state);

    expect(() => loadStateFrom(dir, 'claimed-id')).toThrow(/belongs to run/);
  });
});

describe('runFeatureFactory uses the lifecycle on a fresh start (§4 pre-flight)', () => {
  /** Researcher and story pass; no approver, so the run stops at CP1 — enough to start a run. */
  function startInvoker(seen: string[]) {
    const invoker = scriptedInvoker({ '01-researcher': researcher(), '02-story-writer': story() });
    return async (call: Parameters<typeof invoker.invoke>[0]) => {
      seen.push(call.agent);
      return invoker.invoke(call);
    };
  }

  it('AC-40 a fresh start archives finished runs and keeps _archive/ and baseline.json', async () => {
    const success = seedRun(cwd, 'SUCCESS');
    mkdirSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'older'), { recursive: true });
    writeFileSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'older', 'NOTES.md'), 'kept');
    writeFileSync(join(cwd, '.factory', 'baseline.json'), '{"schemaVersion":1}');

    const state = await runFeatureFactory({
      featureName: 'fresh',
      featureDescription: 'add 2FA',
      cwd,
      changes: fakeChangeTracker(),
      invoke: startInvoker([]),
      logger: () => {}
    });

    expect(existsSync(archived(success.featureId))).toBe(true);
    expect(readFileSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'older', 'NOTES.md'), 'utf-8')).toBe('kept');
    expect(readFileSync(join(cwd, '.factory', 'baseline.json'), 'utf-8')).toBe('{"schemaVersion":1}');
    expect(existsSync(live(state.featureId))).toBe(true);
  });

  it('AC-41 a fresh start is refused while an unfinished run exists: no agent runs and no run directory is created', async () => {
    const paused = seedRun(cwd, 'PAUSED');
    const seen: string[] = [];

    await expect(
      runFeatureFactory({
        featureName: 'blocked',
        featureDescription: 'add 2FA',
        cwd,
        changes: fakeChangeTracker(),
        invoke: startInvoker(seen),
        logger: () => {}
      })
    ).rejects.toMatchObject({ name: 'RunRefusedError', code: 'ACTIVE_RUN_EXISTS' });

    expect(seen).toEqual([]);
    expect(readdirSync(join(cwd, '.factory')).sort()).toEqual([paused.featureId]);
  });

  it('carry-over 2 a resumed run moves and deletes nothing in .factory/', async () => {
    const other = seedRun(cwd, 'ESCALATED');
    const finished = seedRun(cwd, 'SUCCESS');
    mkdirSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'older'), { recursive: true });
    const pinned: FeatureState = createFeatureState('resumed');
    saveState(cwd, pinned);

    await runFeatureFactory({
      featureName: 'resumed',
      featureDescription: 'add 2FA',
      cwd,
      resumeFromState: pinned,
      invoke: startInvoker([]),
      logger: () => {}
    });

    expect(existsSync(live(other.featureId))).toBe(true);
    expect(existsSync(live(finished.featureId))).toBe(true);
    expect(existsSync(join(cwd, '.factory', ARCHIVE_DIRNAME, 'older'))).toBe(true);
  });
});

describe('D-5 supersedeArtifacts: a rejected document is moved aside, never deleted', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = join(cwd, '.factory', 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'TEST_REPORT.md'), '# Test report\n');
    writeFileSync(join(runDir, 'VALIDATION_REPORT.md'), '# Validation report\n');
    writeFileSync(join(runDir, 'USER_STORY.md'), '# Story\n');
  });

  it('D-5 supersedeArtifacts moves the named documents into _superseded/<n>/ intact and leaves everything else', () => {
    const result = supersedeArtifacts(runDir, 1, ['TEST_REPORT.md', 'VALIDATION_REPORT.md']);

    const target = join(runDir, SUPERSEDED_DIRNAME, '1');
    expect(result).toEqual({ supersededDir: target, moved: ['TEST_REPORT.md', 'VALIDATION_REPORT.md'] });
    expect(readFileSync(join(target, 'TEST_REPORT.md'), 'utf8')).toBe('# Test report\n');
    expect(readFileSync(join(target, 'VALIDATION_REPORT.md'), 'utf8')).toBe('# Validation report\n');
    expect(existsSync(join(runDir, 'TEST_REPORT.md'))).toBe(false);
    expect(existsSync(join(runDir, 'VALIDATION_REPORT.md'))).toBe(false);
    expect(readFileSync(join(runDir, 'USER_STORY.md'), 'utf8')).toBe('# Story\n');
  });

  it('D-5 a missing document is skipped, so a retried supersede is idempotent', () => {
    supersedeArtifacts(runDir, 2, ['USER_STORY.md']);
    const again = supersedeArtifacts(runDir, 2, ['USER_STORY.md', 'FILE_LIST.md']);

    expect(again.moved).toEqual([]);
    expect(readFileSync(join(runDir, SUPERSEDED_DIRNAME, '2', 'USER_STORY.md'), 'utf8')).toBe('# Story\n');
    expect(readdirSync(join(runDir, SUPERSEDED_DIRNAME, '2'))).toEqual(['USER_STORY.md']);
  });

  it('D-5 each rejection cycle gets its own directory, and an earlier cycle is never overwritten', () => {
    supersedeArtifacts(runDir, 1, ['USER_STORY.md']);
    writeFileSync(join(runDir, 'USER_STORY.md'), '# Story, second version\n');
    supersedeArtifacts(runDir, 2, ['USER_STORY.md']);

    expect(readFileSync(join(runDir, SUPERSEDED_DIRNAME, '1', 'USER_STORY.md'), 'utf8')).toBe('# Story\n');
    expect(readFileSync(join(runDir, SUPERSEDED_DIRNAME, '2', 'USER_STORY.md'), 'utf8')).toBe('# Story, second version\n');

    writeFileSync(join(runDir, 'USER_STORY.md'), '# Story, third version\n');
    expect(() => supersedeArtifacts(runDir, 2, ['USER_STORY.md'])).toThrow(/already/);
    expect(readFileSync(join(runDir, SUPERSEDED_DIRNAME, '2', 'USER_STORY.md'), 'utf8')).toBe('# Story, second version\n');
    expect(readFileSync(join(runDir, 'USER_STORY.md'), 'utf8')).toBe('# Story, third version\n');
  });

  it.each<[string, () => [string, number, string[]]]>([
    ['a symlinked document', () => {
      const elsewhere = join(cwd, 'elsewhere.md');
      writeFileSync(elsewhere, 'not the run');
      symlinkSync(elsewhere, join(runDir, 'FILE_LIST.md'));
      return [runDir, 1, ['USER_STORY.md', 'FILE_LIST.md']];
    }],
    ['a symlinked _superseded directory', () => {
      const outside = join(cwd, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, join(runDir, SUPERSEDED_DIRNAME));
      return [runDir, 1, ['USER_STORY.md']];
    }],
    ['a document name that is a path', () => [runDir, 1, ['../USER_STORY.md']]],
    ['a hidden document name', () => [runDir, 1, ['.state.json']]],
    ['a cycle that is not a positive whole number', () => [runDir, 0, ['USER_STORY.md']]]
  ])('D-5 supersedeArtifacts refuses %s and moves nothing', (_label, arrange) => {
    const [dir, cycle, names] = arrange();
    expect(() => supersedeArtifacts(dir, cycle, names)).toThrow();
    expect(readFileSync(join(runDir, 'USER_STORY.md'), 'utf8')).toBe('# Story\n');
  });

  it('D-5 a symlinked document is refused as an unsafe path', () => {
    symlinkSync(join(runDir, 'USER_STORY.md'), join(runDir, 'FILE_LIST.md'));
    expect(() => supersedeArtifacts(runDir, 1, ['FILE_LIST.md'])).toThrow(UnsafeArtifactPathError);
  });
});

describe('AC-97 a .factory case variant is refused before any write', () => {
  const caseInsensitive = tempFileSystemIsCaseInsensitive();

  it('AC-97 assertNoFactoryCaseVariant passes an exact .factory, a missing cwd, and unrelated .factoryx or factory entries', () => {
    mkdirSync(join(cwd, '.factory'));
    expect(() => assertNoFactoryCaseVariant(cwd)).not.toThrow();
    expect(() => assertNoFactoryCaseVariant(join(cwd, 'does-not-exist'))).not.toThrow();

    mkdirSync(join(cwd, '.factoryx'));
    writeFileSync(join(cwd, 'factory'), '');
    writeFileSync(join(cwd, '.factory.bak'), '');
    expect(() => assertNoFactoryCaseVariant(cwd)).not.toThrow();
  });

  it.each(['.FACTORY', '.Factory', '.fACTORY'])(
    'AC-97 assertNoFactoryCaseVariant refuses a %s directory with FACTORY_DIR_CASE_CONFLICT, naming its absolute path',
    name => {
      mkdirSync(join(cwd, name));
      const error = refusal(() => assertNoFactoryCaseVariant(cwd));
      expect(error.code).toBe('FACTORY_DIR_CASE_CONFLICT');
      expect(error.message).toBe(
        `${join(cwd, name)} differs from the harness directory .factory only in letter case; ` +
          "git's `:(exclude).factory` would not exclude it. Rename or remove it, then run again."
      );
    }
  );

  it('AC-97 assertNoFactoryCaseVariant refuses a .Factory regular file as well as a directory', () => {
    writeFileSync(join(cwd, '.Factory'), 'a file');
    const error = refusal(() => assertNoFactoryCaseVariant(cwd));
    expect(error.code).toBe('FACTORY_DIR_CASE_CONFLICT');
    expect(error.message).toContain(join(cwd, '.Factory'));
  });

  (caseInsensitive ? it.skip : it)('AC-97 assertNoFactoryCaseVariant names every variant when there are several (case-sensitive file system only)', () => {
    mkdirSync(join(cwd, '.factory'));
    mkdirSync(join(cwd, '.Factory'));
    writeFileSync(join(cwd, '.FACTORY'), '');
    const error = refusal(() => assertNoFactoryCaseVariant(cwd));
    expect(error.code).toBe('FACTORY_DIR_CASE_CONFLICT');
    expect(error.message).toContain(join(cwd, '.Factory'));
    expect(error.message).toContain(join(cwd, '.FACTORY'));
    expect(error.message).not.toContain(`${join(cwd, '.factory')} differs`);
  });

  it('AC-97 assertNoFactoryCaseVariant fails closed: a cwd that cannot be listed (not ENOENT) propagates its error', () => {
    const notADirectory = join(cwd, 'plain-file');
    writeFileSync(notADirectory, '');
    expect(() => assertNoFactoryCaseVariant(notADirectory)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
  });

  type Start = 'fresh run' | 'fresh run (a .Factory file)' | 'resume';

  it.each<Start>(['fresh run', 'fresh run (a .Factory file)', 'resume'])(
    'AC-97 a %s next to a .Factory entry is refused FACTORY_DIR_CASE_CONFLICT before any write, naming the entry',
    async start => {
      const resumeFromState = start === 'resume' ? seedRun(cwd, 'ESCALATED') : undefined;
      const variant = plantFactoryCaseVariant(cwd, start === 'fresh run (a .Factory file)' ? 'file' : 'directory');
      const before = treeSnapshot(cwd);
      const tracker = fakeChangeTracker();
      const seen: string[] = [];

      await expect(
        runFeatureFactory({
          featureName: resumeFromState ? resumeFromState.featureName : 'case-variant',
          featureDescription: 'add 2FA',
          cwd,
          resumeFromState,
          changes: tracker,
          invoke: async call => {
            seen.push(call.agent);
            return researcher();
          },
          logger: () => {}
        })
      ).rejects.toMatchObject({
        name: 'RunRefusedError',
        code: 'FACTORY_DIR_CASE_CONFLICT',
        message: expect.stringContaining(`${variant} differs from the harness directory .factory only in letter case`)
      });

      expect(seen).toEqual([]);
      expect(tracker.calls).toEqual([]);
      expect(treeSnapshot(cwd)).toEqual(before);
    }
  );
});
