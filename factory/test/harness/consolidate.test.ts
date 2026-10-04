/**
 * `--consolidate <id>` as a library workflow (A-2 D-10: AC-28 exception, AC-47, AC-48, AC-76).
 *
 * The Feature Consolidator no longer runs inside a run (AC-44). It runs on a finished SUCCESS run,
 * live in `.factory/<id>/` or archived in `.factory/_archive/<id>/`, and is the only agent ever
 * allowed to read an archived run — its own, and nothing else under `.factory/`.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { consolidateRun } from '../../feature/workflows/consolidate-run';
import { ARCHIVE_DIRNAME, prepareNewRunDirectory } from '../../harness/run-directory';
import { RunRefusedError } from '../../harness/run-lifecycle';
import { loadStateFrom, stateFilePathIn } from '../../harness/state-store';
import { stageContracts } from '../../harness/stage-gates';
import { ARCHIVE_RULE } from '../../harness/upstream-artifacts';
import { AgentInvoker } from '../../runner/invoke-agent';
import { consolidator } from '../fixtures/agent-outputs';
import { removeOnPersist, scriptedInvoker, seedRun, tempProject, TempProject } from '../fixtures/harness-run';

const CONSOLIDATOR = '08-feature-consolidator';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-consolidate-');
});

afterEach(() => {
  project.cleanup();
});

const liveDir = (id: string) => resolve(project.dir, '.factory', id);
const archivedDir = (id: string) => resolve(project.dir, '.factory', ARCHIVE_DIRNAME, id);

/** A SUCCESS run, left live or moved into the archive by the next fresh start (AC-40). */
function successRun(location: 'live' | 'archive'): { id: string; runDir: string } {
  const { featureId } = seedRun(project.dir, 'SUCCESS');
  if (location === 'archive') prepareNewRunDirectory(project.dir);
  return { id: featureId, runDir: location === 'live' ? liveDir(featureId) : archivedDir(featureId) };
}

function passingConsolidator() {
  return scriptedInvoker({ [CONSOLIDATOR]: consolidator() }, { cwd: project.dir });
}

const silent = () => {};

describe('consolidateRun (--consolidate)', () => {
  it('AC-47 --consolidate on a live SUCCESS run invokes 08 naming that run\'s directory and evaluates the Stage 5 gate', async () => {
    const { id, runDir } = successRun('live');
    const invoker = passingConsolidator();

    const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    expect(invoker.agents()).toEqual([CONSOLIDATOR]);
    const [prompt] = invoker.promptsFor(CONSOLIDATOR);
    expect(prompt).toContain(runDir);
    expect(prompt).toContain(join(runDir, 'USER_STORY.md'));
    // The per-agent timings come from the run's own record (D-13).
    expect(prompt).toContain(join(runDir, 'state.json'));
    expect(prompt).toMatch(/agentInvocations/);

    expect(result.location).toBe('live');
    expect(result.runDir).toBe(runDir);
    expect(result.passed).toBe(true);
    expect(result.decision.canAdvance).toBe(true);
    expect(Object.keys(result.decision.criteriaResults).sort()).toEqual(['Consolidation Complete', 'Patterns Extracted']);

    // I-18: --consolidate moves the run to Stage 5; it stays SUCCESS.
    expect(result.state.currentStage).toBe(5);
    expect(result.state.completionStatus).toBe('SUCCESS');
    const onDisk = loadStateFrom(runDir, id)!;
    expect(onDisk.currentStage).toBe(5);
    expect(onDisk.completionStatus).toBe('SUCCESS');
    const step = onDisk.stageHistory.at(-1)!;
    expect([step.stage, step.agent, step.status]).toEqual([5, CONSOLIDATOR, 'PASS']);
  });

  it('AC-47 --consolidate finds an archived SUCCESS run in .factory/_archive/<id>/', async () => {
    const { id, runDir } = successRun('archive');
    expect(existsSync(liveDir(id))).toBe(false);
    const invoker = passingConsolidator();

    const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    expect(result.location).toBe('archive');
    expect(result.runDir).toBe(runDir);
    expect(result.passed).toBe(true);
    expect(invoker.promptsFor(CONSOLIDATOR)[0]).toContain(join(runDir, 'USER_STORY.md'));

    // Saved where it was found; the run is not brought back to life in .factory/<id>/.
    expect(loadStateFrom(runDir, id)!.currentStage).toBe(5);
    expect(existsSync(liveDir(id))).toBe(false);
  });

  const refusals: Array<[string, () => string, string]> = [
    ['an ESCALATED run', () => seedRun(project.dir, 'ESCALATED').featureId, 'NOT_SUCCESS'],
    ['a PAUSED run', () => seedRun(project.dir, 'PAUSED').featureId, 'NOT_SUCCESS'],
    ['an ACTIVE run', () => seedRun(project.dir, 'ACTIVE').featureId, 'NOT_SUCCESS'],
    [
      'an archived MANUAL_STOP run',
      () => {
        const { featureId } = seedRun(project.dir, 'MANUAL_STOP');
        prepareNewRunDirectory(project.dir);
        return featureId;
      },
      'NOT_SUCCESS'
    ],
    ['an unknown id', () => 'no-such-run', 'RUN_NOT_FOUND'],
    ['an unsafe id', () => '../../escape', 'INVALID_RUN_ID']
  ];

  it.each(refusals)('AC-47 --consolidate refuses %s', async (_label, arrange, code) => {
    const id = arrange();
    const statePaths = [liveDir(id), archivedDir(id)].map(stateFilePathIn).filter(path => existsSync(path));
    const before = statePaths.map(path => readFileSync(path));
    const invoker = passingConsolidator();

    const attempt = consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    await expect(attempt).rejects.toBeInstanceOf(RunRefusedError);
    await expect(attempt).rejects.toMatchObject({ code });
    expect(invoker.calls).toHaveLength(0);
    expect(statePaths.map(path => readFileSync(path))).toEqual(before);
  });

  it.each(['live', 'archive'] as const)(
    'AC-76 --consolidate writes CONSOLIDATION_REPORT.md and PATTERNS.md into that run\'s directory (live or archived) and the Stage 5 gate requires both (%s)',
    async location => {
      const { id, runDir } = successRun(location);

      const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: passingConsolidator().invoke, logger: silent });

      expect(result.passed).toBe(true);
      expect(readFileSync(join(runDir, 'CONSOLIDATION_REPORT.md'), 'utf-8')).toBe('# Consolidation Report');
      expect(readFileSync(join(runDir, 'PATTERNS.md'), 'utf-8')).toBe('# Patterns');
      for (const name of ['CONSOLIDATION_REPORT.md', 'PATTERNS.md']) {
        expect(existsSync(join(project.dir, name))).toBe(false);
        expect(existsSync(join(project.dir, '.factory', name))).toBe(false);
      }
      expect(stageContracts[5].artifacts.required).toEqual(['CONSOLIDATION_REPORT.md', 'PATTERNS.md']);
    }
  );

  it('AC-48 the Stage 5 gate passes and fails on the two documents only, never on memory storage', async () => {
    const passing = successRun('live');
    const passed = await consolidateRun({ cwd: project.dir, runId: passing.id, invoke: passingConsolidator().invoke, logger: silent });

    expect(passed.passed).toBe(true);
    const criteria = Object.keys(passed.decision.criteriaResults);
    expect(criteria.sort()).toEqual(['Consolidation Complete', 'Patterns Extracted']);
    expect(criteria.join(' ')).not.toMatch(/memory|knowledge/i);
    expect(JSON.stringify(passed.state)).not.toMatch(/knowledgeStored/);

    // Same run shape, PATTERNS.md gone before the gate reads it: the gate fails on that document alone.
    const failing = successRun('live');
    const failed = await consolidateRun({
      cwd: project.dir,
      runId: failing.id,
      invoke: passingConsolidator().invoke,
      logger: removeOnPersist(project.dir, CONSOLIDATOR, 'PATTERNS.md')
    });

    expect(failed.passed).toBe(false);
    expect(failed.decision.canAdvance).toBe(false);
    expect(failed.decision.missingArtifacts).toEqual(['PATTERNS.md']);
    expect(failed.decision.criteriaResults['Consolidation Complete'].passed).toBe(true);
    expect(failed.decision.criteriaResults['Patterns Extracted'].passed).toBe(false);
    expect(failed.decision.blockers.join('\n')).not.toMatch(/memory|knowledge/i);
    // A failed Stage 5 gate never changes how the run ended.
    expect(loadStateFrom(failing.runDir, failing.id)!.completionStatus).toBe('SUCCESS');
  });

  it('AC-28 the consolidate prompt permits reading only that run\'s directory: no blanket archive rule, no other run', async () => {
    const other = successRun('archive');
    const { id, runDir } = successRun('archive');
    const invoker = passingConsolidator();

    await consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    const [prompt] = invoker.promptsFor(CONSOLIDATOR);
    expect(prompt).not.toContain(ARCHIVE_RULE);
    expect(prompt).toContain(runDir);
    expect(prompt).toMatch(/only directory/i);
    expect(prompt).not.toContain(other.id);
  });

  it('records the 08 invocation\'s timing (D-13) and the step carries the same start', async () => {
    const { id, runDir } = successRun('live');

    await consolidateRun({ cwd: project.dir, runId: id, invoke: passingConsolidator().invoke, logger: silent });

    const state = loadStateFrom(runDir, id)!;
    const invocation = state.agentInvocations!.at(-1)!;
    expect([invocation.stage, invocation.agent]).toEqual([5, CONSOLIDATOR]);
    expect(invocation.durationMs).toBeGreaterThanOrEqual(0);
    expect(state.stageHistory.at(-1)!.startedAt).toBe(invocation.startedAt);
    expect(state.metrics.timePerStage[5]).toBe(invocation.durationMs);
  });

  it('a schema-invalid Consolidator output FAILS CLOSED: a FAIL step, no documents written, and the gate does not pass on stale ones', async () => {
    const { id, runDir } = successRun('live');
    // A first consolidation left both documents behind.
    await consolidateRun({ cwd: project.dir, runId: id, invoke: passingConsolidator().invoke, logger: silent });
    writeFileSync(join(runDir, 'PATTERNS.md'), '# stale');

    // No script entry: the invoker returns a schema-invalid placeholder.
    const invalid = scriptedInvoker({}, { cwd: project.dir });
    const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: invalid.invoke, logger: silent });

    expect(result.passed).toBe(false);
    expect(result.decision.canAdvance).toBe(false);
    expect(result.decision.blockers.join('\n')).toMatch(/schema/i);
    expect(readFileSync(join(runDir, 'PATTERNS.md'), 'utf-8')).toBe('# stale');
    const state = loadStateFrom(runDir, id)!;
    const step = state.stageHistory.at(-1)!;
    expect([step.stage, step.agent, step.status]).toEqual([5, CONSOLIDATOR, 'FAIL']);
    expect(state.currentStage).toBe(5);
    expect(state.completionStatus).toBe('SUCCESS');
  });

  it('a Consolidator that declares FAIL is believed: a FAIL step and nothing written', async () => {
    const { id, runDir } = successRun('live');
    const declared = { ...consolidator(), status: 'FAIL' };
    const invoker = scriptedInvoker({ [CONSOLIDATOR]: declared }, { cwd: project.dir });

    const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    expect(result.passed).toBe(false);
    expect(existsSync(join(runDir, 'CONSOLIDATION_REPORT.md'))).toBe(false);
    expect(loadStateFrom(runDir, id)!.stageHistory.at(-1)!.status).toBe('FAIL');
  });

  it('a document whose name escapes the run directory FAILS CLOSED: nothing is written anywhere', async () => {
    const { id, runDir } = successRun('archive');
    const hostile = consolidator();
    hostile.details.artifacts.push({ ...hostile.details.artifacts[0], name: '../../escaped.md' });
    const invoker = scriptedInvoker({ [CONSOLIDATOR]: hostile }, { cwd: project.dir });

    const result = await consolidateRun({ cwd: project.dir, runId: id, invoke: invoker.invoke, logger: silent });

    expect(result.passed).toBe(false);
    expect(result.decision.blockers.join('\n')).toMatch(/not a plain filename/i);
    expect(existsSync(join(runDir, 'CONSOLIDATION_REPORT.md'))).toBe(false);
    expect(existsSync(join(project.dir, '.factory', 'escaped.md'))).toBe(false);
    expect(existsSync(join(project.dir, 'escaped.md'))).toBe(false);
    expect(loadStateFrom(runDir, id)!.stageHistory.at(-1)!.status).toBe('FAIL');
  });

  it('an invocation that throws records nothing: state.json is unchanged and the error reaches the caller', async () => {
    const { id, runDir } = successRun('live');
    const before = readFileSync(stateFilePathIn(runDir));
    const failing: AgentInvoker = async () => {
      throw new Error('agent unavailable');
    };

    await expect(consolidateRun({ cwd: project.dir, runId: id, invoke: failing, logger: silent })).rejects.toThrow(
      'agent unavailable'
    );
    expect(readFileSync(stateFilePathIn(runDir))).toEqual(before);
  });
});
