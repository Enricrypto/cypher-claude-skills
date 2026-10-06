/**
 * Agents get real upstream inputs (A7: AC-24, AC-25, AC-28).
 *
 * Every agent used to be handed a one-line prompt ("Write acceptance tests for implemented
 * feature") and left to find its inputs by searching a project that may hold other runs'
 * documents. These tests assert what each prompt now carries: the absolute run-dir path of every
 * upstream document that exists — and only those — plus the rule never to read the archive.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { consolidateRun } from '../../feature/workflows/consolidate-run';
import {
  ARCHIVE_RULE,
  existingUpstreamArtifacts,
  runDirectoryRules,
  UPSTREAM_ARTIFACTS,
  UPSTREAM_FOR_AGENT,
  UpstreamArtifact
} from '../../harness/upstream-artifacts';
import { harnessGeneratedLabel, HARNESS_RENDERED_ARTIFACTS } from '../../harness/harness-documents';
import { FeatureFactoryAgent, AGENT_STAGE } from '../../runner/agent-registry';
import { AgentInvocation, AgentInvoker } from '../../runner/invoke-agent';
import { backend, followup, frontend, researcher, spec, validator } from '../fixtures/agent-outputs';
import { fakeChangeTracker } from '../fixtures/changes';
import { passingScript, runToEnd, scriptedInvoker, tempProject, TempProject } from '../fixtures/harness-run';

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-upstream-');
});

afterEach(() => {
  project.cleanup();
});

const ALL_AGENTS = Object.keys(AGENT_STAGE) as FeatureFactoryAgent[];

/** A brief that calls for UI, so the Frontend Builder runs and FRONTEND_SUMMARY.md exists. */
const UI_FILES = ['src/a.ts', 'src/components/TwoFactorForm.tsx'];

function uiScript() {
  return {
    ...passingScript(),
    '03-spec-writer': spec({ files: UI_FILES, ui: true }),
    '04-backend-builder': backend({ files: ['src/a.ts'] }),
    '05-frontend-builder': frontend({ files: ['src/components/TwoFactorForm.tsx'] })
  };
}

/** Every `<abs run dir>/<UPSTREAM NAME>` a prompt names, and whether it existed at that moment. */
interface PromptObservation {
  agent: string;
  prompt: string;
  named: Array<{ name: string; path: string; existedAtInvocation: boolean }>;
}

/**
 * Wrap every script entry so that, at the moment of invocation, we record which upstream paths
 * the prompt names and whether each one is on disk RIGHT THEN — not after the run.
 */
function observing(script: Record<string, object>, observations: PromptObservation[]) {
  const wrapped: Record<string, (call: AgentInvocation) => unknown> = {};
  for (const [agent, output] of Object.entries(script)) {
    wrapped[agent] = (call: AgentInvocation) => {
      const pattern = new RegExp(
        `(${escapeRegExp(resolve(project.dir, '.factory'))}/[^/\\s]+/(${UPSTREAM_ARTIFACTS.map(escapeRegExp).join('|')}))`,
        'g'
      );
      const named = [...call.prompt.matchAll(pattern)].map(m => ({
        name: m[2],
        path: m[1],
        existedAtInvocation: existsSync(m[1])
      }));
      observations.push({ agent: call.agent, prompt: call.prompt, named });
      return structuredClone(output);
    };
  }
  return wrapped;
}

/**
 * The Feature Consolidator no longer runs inside a run (AC-44): it runs on the finished SUCCESS run
 * through `consolidateRun` (`--consolidate`, D-10), with the same invoker.
 */
function consolidate(featureId: string, invoke: AgentInvoker) {
  return consolidateRun({ cwd: project.dir, runId: featureId, invoke, logger: () => {} });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('upstream artifacts in prompts', () => {
  it('AC-24 prompts for 05, 06, 07 (and 08 for the finished run) name the absolute run-dir path of every existing upstream artifact, and each named path exists at invocation', async () => {
    const observations: PromptObservation[] = [];
    const invoker = scriptedInvoker(observing(uiScript(), observations), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const runDir = resolve(project.dir, '.factory', state.featureId);

    // The Consolidator is not invoked in the run (AC-44); --consolidate invokes it on the finished run.
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
    await consolidate(state.featureId, invoker.invoke);

    for (const agent of ['05-frontend-builder', '06-test-verifier', '07-validator', '08-feature-consolidator'] as const) {
      const seen = observations.filter(o => o.agent === agent);
      expect(seen).toHaveLength(1);
      const { named } = seen[0];

      // Every upstream document for this agent existed in this run, so every one is named...
      const namedNames = [...new Set(named.map(n => n.name))].sort();
      expect(namedNames).toEqual([...UPSTREAM_FOR_AGENT[agent]].sort());

      // ...by its absolute path inside THIS run's directory, and it was on disk when the agent ran.
      for (const n of named) {
        expect(n.path).toBe(join(runDir, n.name));
        expect(n.existedAtInvocation).toBe(true);
      }
    }

    // I-7: FILE_LIST.md for every builder-and-later agent; VALIDATION_REPORT.md for 08.
    const consolidatorPrompt = observations.find(o => o.agent === '08-feature-consolidator')!.prompt;
    expect(consolidatorPrompt).toContain(join(runDir, 'FILE_LIST.md'));
    expect(consolidatorPrompt).toContain(join(runDir, 'VALIDATION_REPORT.md'));
  });

  it('AC-24 a prompt never names an upstream artifact that is not on disk (backend-only run: no FRONTEND_SUMMARY.md)', async () => {
    const observations: PromptObservation[] = [];
    const invoker = scriptedInvoker(observing(passingScript(), observations), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    for (const o of observations) {
      for (const n of o.named) expect(n.existedAtInvocation).toBe(true);
    }
    expect(invoker.agents()).not.toContain('08-feature-consolidator');
    await consolidate(state.featureId, invoker.invoke);
    for (const o of observations) {
      for (const n of o.named) expect(n.existedAtInvocation).toBe(true);
    }
    for (const agent of ['06-test-verifier', '07-validator', '08-feature-consolidator']) {
      const prompt = observations.find(o => o.agent === agent)!.prompt;
      expect(prompt).not.toContain('FRONTEND_SUMMARY.md');
    }
  });

  it('AC-25 BACKEND_SUMMARY, API_CONTRACT, FRONTEND_SUMMARY are harness-labelled and absent from the materialization audit', async () => {
    const logs: string[] = [];
    const invoker = scriptedInvoker(uiScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke, logger: m => logs.push(m) });

    expect(state.completionStatus).toBe('SUCCESS');
    expect(invoker.agents()).toContain('05-frontend-builder');
    const runDir = resolve(project.dir, '.factory', state.featureId);

    const expectedLabel: Record<string, string> = {
      'BACKEND_SUMMARY.md': '04-backend-builder',
      'API_CONTRACT.md': '04-backend-builder',
      'FRONTEND_SUMMARY.md': '05-frontend-builder'
    };
    for (const [name, agent] of Object.entries(expectedLabel)) {
      const path = join(runDir, name);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf-8').split('\n')[0]).toBe(harnessGeneratedLabel(agent));
      // Run dir only — never the project root.
      expect(existsSync(join(project.dir, name))).toBe(false);
    }

    // The materialization audit covers exactly the builders' claimed files, and nothing the harness wrote.
    const audit = logs.find(l => l.includes('Artifact Materialization Audit'));
    expect(audit).toBeDefined();
    for (const name of HARNESS_RENDERED_ARTIFACTS) expect(audit).not.toContain(name);
    expect(audit).toContain('src/a.ts');
    expect(audit).toContain('src/components/TwoFactorForm.tsx');
    expect(logs.some(l => l.includes('All 2 artifacts verified'))).toBe(true);

    // Nor do they enter any builder's recorded filesModified.
    for (const step of state.stageHistory.filter(s => s.stage === 3)) {
      const files = ((step.output as any)?.details?.filesModified ?? []).map((f: { path: string }) => f.path);
      for (const name of HARNESS_RENDERED_ARTIFACTS) {
        expect(files.some((p: string) => p.endsWith(name))).toBe(false);
      }
    }
  });

  it('AC-28 every agent prompt in a normal run says .factory/_archive/ must not be read', async () => {
    const invoker = scriptedInvoker(uiScript(), { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    // Every agent but the Consolidator runs in the run (AC-44), except the two PR B-2 Stage 4
    // reviewers this run has no work for: 07b runs only when the Test Verifier changed test files,
    // and 07c only on a CRITICAL issue. This run has neither.
    expect([...new Set(invoker.agents())].sort()).toEqual(
      ALL_AGENTS.filter(a => !['08-feature-consolidator', '07b-validator-followup', '07c-validator-skeptic'].includes(a)).sort()
    );
    expect(ARCHIVE_RULE).toContain('.factory/_archive/');
    const runDir = resolve(project.dir, '.factory', state.featureId);
    for (const prompt of invoker.calls.map(c => c.prompt)) {
      expect(prompt).toContain(ARCHIVE_RULE);
      expect(prompt).toContain(runDir);
    }

    // The single exception (AC-47): under --consolidate, 08 is told to read only that run's directory.
    await consolidate(state.featureId, invoker.invoke);
    const [consolidatorPrompt] = invoker.promptsFor('08-feature-consolidator');
    expect(consolidatorPrompt).not.toContain(ARCHIVE_RULE);
    expect(consolidatorPrompt).toContain(runDir);
    expect(consolidatorPrompt).toMatch(/only directory/i);
  });
});

describe('the follow-up and skeptic prompts (PR B-2, AC-24, AC-28)', () => {
  it('AC-24 AC-28 the 07b and 07c prompts name every existing upstream document of theirs, each on disk at invocation, and carry the archive rule', async () => {
    const observations: PromptObservation[] = [];
    const script = {
      ...uiScript(),
      '07-validator': (_call: AgentInvocation, n: number) =>
        n === 1
          ? validator({ status: 'FAIL', issues: [{ severity: 'CRITICAL', file: 'src/a.ts', line: 1, message: 'No guard', suggestion: 'Add it', canFix: true }] })
          : validator(),
      '07b-validator-followup': followup({ files: ['test/a.test.ts'] })
    };
    const base = scriptedInvoker(script, { cwd: project.dir });
    // The script holds functions (the Validator, the skeptic), so the prompts are observed around the invoker.
    const observe = observing({ '07b-validator-followup': {}, '07c-validator-skeptic': {} }, observations);
    const invoke: AgentInvoker = async call => {
      if (call.agent in observe) observe[call.agent](call);
      return base.invoke(call);
    };

    const state = await runToEnd({ cwd: project.dir, invoke, changes: fakeChangeTracker({ changed: ['test/a.test.ts'] }) });

    expect(state.completionStatus).toBe('SUCCESS');
    const runDir = resolve(project.dir, '.factory', state.featureId);
    for (const agent of ['07b-validator-followup', '07c-validator-skeptic'] as const) {
      const seen = observations.filter(o => o.agent === agent);
      expect(seen.length).toBeGreaterThan(0);
      for (const { named, prompt } of seen) {
        expect([...new Set(named.map(n => n.name))].sort()).toEqual([...UPSTREAM_FOR_AGENT[agent]].sort());
        for (const n of named) {
          expect(n.path).toBe(join(runDir, n.name));
          expect(n.existedAtInvocation).toBe(true);
        }
        expect(prompt).toContain(ARCHIVE_RULE);
      }
    }
  });
});

describe('persisted documents land in the run directory under their artifact name (IMPORTANT-1, IMPORTANT-2)', () => {
  it('a brief returned as {name: TECHNICAL_BRIEF.md, path: docs/brief.md} is saved as TECHNICAL_BRIEF.md and the builder prompt names it', async () => {
    const mismatched = spec();
    mismatched.details.artifacts[0] = { ...mismatched.details.artifacts[0], path: 'docs/brief.md' };
    const invoker = scriptedInvoker({ ...passingScript(), '03-spec-writer': mismatched }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('SUCCESS');
    const runDir = resolve(project.dir, '.factory', state.featureId);
    expect(existsSync(join(runDir, 'TECHNICAL_BRIEF.md'))).toBe(true);
    expect(existsSync(join(runDir, 'brief.md'))).toBe(false);
    expect(existsSync(join(project.dir, 'docs/brief.md'))).toBe(false);
    expect(invoker.promptsFor('04-backend-builder')[0]).toContain(join(runDir, 'TECHNICAL_BRIEF.md'));
  });

  it('a Validator report returned with an absolute path elsewhere lands only in the run dir, and the Consolidator prompt names it', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'ff-elsewhere-'));
    try {
      const supplied = join(elsewhere, 'VALIDATION_REPORT.md');
      const misplaced = validator();
      misplaced.details.artifacts[0] = { ...misplaced.details.artifacts[0], path: supplied };
      const invoker = scriptedInvoker({ ...passingScript(), '07-validator': misplaced }, { cwd: project.dir });

      const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

      expect(state.completionStatus).toBe('SUCCESS');
      const runDir = resolve(project.dir, '.factory', state.featureId);
      expect(existsSync(supplied)).toBe(false);
      expect(existsSync(join(project.dir, 'VALIDATION_REPORT.md'))).toBe(false);
      expect(existsSync(join(runDir, 'VALIDATION_REPORT.md'))).toBe(true);
      expect(invoker.agents()).not.toContain('08-feature-consolidator');
      await consolidate(state.featureId, invoker.invoke);
      expect(invoker.promptsFor('08-feature-consolidator')[0]).toContain(join(runDir, 'VALIDATION_REPORT.md'));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('a document whose name escapes the run dir FAILS CLOSED: the run escalates and nothing is written outside it', async () => {
    // The report itself is returned too (MINOR-8 refuses a Researcher without it at the schema);
    // the second document's name is the attack.
    const hostile = researcher();
    hostile.details.artifacts.push({ ...hostile.details.artifacts[0], name: '../../escaped.md' });
    const invoker = scriptedInvoker({ ...passingScript(), '01-researcher': hostile }, { cwd: project.dir });

    const state = await runToEnd({ cwd: project.dir, invoke: invoker.invoke });

    expect(state.completionStatus).toBe('ESCALATED');
    expect(state.escalations.at(-1)!.context.message).toMatch(/not a plain filename/i);
    expect(existsSync(join(project.dir, 'escaped.md'))).toBe(false);
    expect(existsSync(join(project.dir, '.factory', 'escaped.md'))).toBe(false);
    expect(invoker.agents()).toEqual(['01-researcher']);
  });
});

describe('upstream-artifacts helpers', () => {
  it('lists the upstream documents in pipeline order', () => {
    expect([...UPSTREAM_ARTIFACTS]).toEqual([
      'RESEARCHER_REPORT.md',
      'USER_STORY.md',
      'TECHNICAL_BRIEF.md',
      'FILE_LIST.md',
      'BACKEND_SUMMARY.md',
      'API_CONTRACT.md',
      'FRONTEND_SUMMARY.md',
      'TEST_REPORT.md',
      'VALIDATION_REPORT.md'
    ]);
  });

  it('gives each agent everything upstream of it, and nothing downstream', () => {
    const RR = 'RESEARCHER_REPORT.md', US = 'USER_STORY.md', TB = 'TECHNICAL_BRIEF.md', FL = 'FILE_LIST.md';
    const BS = 'BACKEND_SUMMARY.md', AC = 'API_CONTRACT.md', FS = 'FRONTEND_SUMMARY.md';
    const TR = 'TEST_REPORT.md', VR = 'VALIDATION_REPORT.md';

    expect(UPSTREAM_FOR_AGENT['01-researcher']).toEqual([]);
    expect(UPSTREAM_FOR_AGENT['02-story-writer']).toEqual([RR]);
    expect(UPSTREAM_FOR_AGENT['03-spec-writer']).toEqual([RR, US]);
    expect(UPSTREAM_FOR_AGENT['04-backend-builder']).toEqual([RR, US, TB, FL]);
    expect(UPSTREAM_FOR_AGENT['05-frontend-builder']).toEqual([RR, US, TB, FL, BS, AC]);
    expect(UPSTREAM_FOR_AGENT['06-test-verifier']).toEqual([RR, US, TB, FL, BS, AC, FS]);
    // AC-120: the Validator runs alongside the Test Verifier, so it never gets TEST_REPORT.md.
    expect(UPSTREAM_FOR_AGENT['07-validator']).toEqual([RR, US, TB, FL, BS, AC, FS]);
    // The follow-up runs after the Test Verifier and reviews its files; a skeptic judges one issue
    // against the story and the brief only (D-5).
    expect(UPSTREAM_FOR_AGENT['07b-validator-followup']).toEqual([RR, US, TB, FL, BS, AC, FS, TR]);
    expect(UPSTREAM_FOR_AGENT['07c-validator-skeptic']).toEqual([US, TB]);
    expect(UPSTREAM_FOR_AGENT['08-feature-consolidator']).toEqual([RR, US, TB, FL, BS, AC, FS, TR, VR]);
    expect(Object.keys(UPSTREAM_FOR_AGENT).sort()).toEqual([...ALL_AGENTS].sort());
  });

  it('existingUpstreamArtifacts returns only regular files that exist, as absolute run-dir paths, in the order asked', () => {
    const artifactDir = '.factory/run-1';
    const runDir = join(project.dir, artifactDir);
    mkdirSync(join(runDir, 'FILE_LIST.md'), { recursive: true }); // a directory, not a document
    writeFileSync(join(runDir, 'USER_STORY.md'), '# story');
    writeFileSync(join(runDir, 'RESEARCHER_REPORT.md'), '# report');
    // A document of the same name in the project root is not this run's.
    writeFileSync(join(project.dir, 'TECHNICAL_BRIEF.md'), '# stray');

    const names: UpstreamArtifact[] = ['RESEARCHER_REPORT.md', 'USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md'];

    expect(existingUpstreamArtifacts(project.dir, artifactDir, names)).toEqual([
      { name: 'RESEARCHER_REPORT.md', absolutePath: join(runDir, 'RESEARCHER_REPORT.md') },
      { name: 'USER_STORY.md', absolutePath: join(runDir, 'USER_STORY.md') }
    ]);
  });

  it('runDirectoryRules carries the archive rule and names this run\'s absolute directory', () => {
    const rules = runDirectoryRules(project.dir, '.factory/run-1');

    expect(rules).toContain(ARCHIVE_RULE);
    expect(rules).toContain(join(project.dir, '.factory/run-1'));
    expect(rules).toMatch(/unrelated run/i);
  });

  it('runDirectoryRules with readableRunDir names that directory as the only one readable and drops the blanket archive rule (AC-47)', () => {
    const archived = join(project.dir, '.factory/_archive/run-1');
    const rules = runDirectoryRules(project.dir, '.factory/_archive/run-1', { readableRunDir: archived });

    expect(rules).not.toBe(runDirectoryRules(project.dir, '.factory/_archive/run-1'));
    expect(rules).not.toContain(ARCHIVE_RULE);
    expect(rules).toContain(archived);
    expect(rules).toMatch(/only directory/i);
    expect(rules).toMatch(/other archived run/i);
  });

  it('runDirectoryRules refuses a readableRunDir that is not this run\'s directory', () => {
    expect(() =>
      runDirectoryRules(project.dir, '.factory/run-1', { readableRunDir: join(project.dir, '.factory/_archive/run-2') })
    ).toThrow(/only its own run/i);
  });
});
