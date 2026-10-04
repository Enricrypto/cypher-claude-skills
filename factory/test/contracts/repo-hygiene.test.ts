/**
 * Repo hygiene: source and config scans that keep the test suite and the gate seam honest.
 *
 * Each check here guards a specific way this repo has misled itself before: a test file that
 * asserted on literals it built itself, five copies of the same fixture drifting apart, an
 * orchestrator that could only be tested by running real npm commands, and untracked scratch
 * scripts that broke the typecheck.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

import { DEFAULT_GATES } from '../../feature/workflows/feature-factory-orchestrator';
import { auditInfrastructure, parseJsonc } from '../../harness/infrastructure-gates';
import { auditExecution } from '../../harness/execution-gates';

const factoryRoot = resolve(__dirname, '../..');
const repoRoot = resolve(factoryRoot, '..');
const testRoot = join(factoryRoot, 'test');
const fixturesDir = join(testRoot, 'fixtures');
const thisFile = __filename;

/** Strip block and line comments, so prose that describes a bug does not trip the scan. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every regular file in the repo that a person or an agent could read, for whole-repo scans.
 *
 * Skipped: dependencies and build output, git internals, run directories, and
 * `docs/factory-runs/` (run records quote old bugs verbatim, by design). Symlinks are not
 * followed, so the walk never leaves the repo.
 */
const NOT_SCANNED = new Set(
  ['node_modules', '.git', 'dist', 'coverage', '.factory', join('docs', 'factory-runs')].map(dir =>
    join(repoRoot, dir)
  )
);

function repoFiles(dir: string = repoRoot): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return NOT_SCANNED.has(full) ? [] : repoFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return full === fixturesDir ? [] : testFiles(full);
    return entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('repo hygiene', () => {
  it('AC-1 DEFAULT_GATES are the real audit functions and the orchestrator calls audits only through the gates object', () => {
    expect(DEFAULT_GATES.auditInfrastructure).toBe(auditInfrastructure);
    expect(DEFAULT_GATES.auditExecution).toBe(auditExecution);

    const orchestrator = code(
      readFileSync(join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts'), 'utf-8')
    );

    // Every call of an audit goes through `gates.`; a bare call would bypass injection.
    const bareCalls = orchestrator.match(/(?<![.\w])audit(Infrastructure|Execution)\s*\(/g) ?? [];
    expect(bareCalls).toEqual([]);
    expect(orchestrator).toMatch(/gates\.auditInfrastructure\s*\(/);
    expect(orchestrator).toMatch(/gates\.auditExecution\s*\(/);
  });

  it('AC-2 no orchestrator or CLI test defines its own researcher/story/spec/builder fixture', () => {
    const drivesTheHarness = (source: string) =>
      /\brunFeatureFactory\b|\brunToEnd\b|runner\/cli['"]/.test(source);

    const files = testFiles(testRoot)
      .filter(file => file !== thisFile)
      .filter(file => drivesTheHarness(readFileSync(file, 'utf-8')));

    // The scan must actually be looking at something.
    expect(files.length).toBeGreaterThan(0);

    const fixtureNames =
      'researcher|story|spec|goodSpec|backend|failingBackend|frontend|builder|testVerifier|validator|consolidator';
    // A definition (`function story(` or `const story = (…) =>`), not a variable holding a
    // shared fixture (`const spec = featureSpec()`).
    const definesFixture = new RegExp(
      `(?:function\\s+(?:${fixtureNames})\\s*\\()|` +
        `(?:(?:const|let|var)\\s+(?:${fixtureNames})\\s*=\\s*(?:async\\s+)?(?:function\\b|\\())`
    );
    // An agent output literal: `agent: '01-researcher'` and friends.
    const agentLiteral = /\bagent\s*:\s*['"]0[1-8]-/;

    const offenders = files.flatMap(file => {
      const source = code(readFileSync(file, 'utf-8'));
      const label = relative(repoRoot, file);
      return [
        ...(definesFixture.test(source) ? [`${label}: defines a fixture function`] : []),
        ...(agentLiteral.test(source) ? [`${label}: builds an agent output literal`] : [])
      ];
    });

    expect(offenders).toEqual([]);
  });

  it('AC-3 orchestrator.test.ts is absent or every test in it calls runFeatureFactory', () => {
    const file = join(testRoot, 'orchestrator.test.ts');
    if (!existsSync(file)) return;

    const source = code(readFileSync(file, 'utf-8'));
    const tests = source.split(/\n\s*(?:it|test)(?:\.each\([^)]*\))?\s*\(/).slice(1);

    expect(tests.length).toBeGreaterThan(0);
    for (const body of tests) {
      expect(body).toMatch(/\brunFeatureFactory\s*\(/);
    }
  });

  it('AC-4 tsconfig excludes run-cpf-factory.ts, run-frontend-only.ts, probe-cwd.ts, probe-cwd.mjs', () => {
    const tsconfig = parseJsonc(readFileSync(join(repoRoot, 'tsconfig.json'), 'utf-8'));
    const exclude: string[] = tsconfig.exclude ?? [];

    for (const file of ['run-cpf-factory.ts', 'run-frontend-only.ts', 'probe-cwd.ts', 'probe-cwd.mjs']) {
      expect(exclude).toContain(file);
    }
  });

  it('AC-13 execution-gates.ts invokes no shell timeout command', () => {
    const gate = code(readFileSync(join(factoryRoot, 'harness', 'execution-gates.ts'), 'utf-8'));

    // GNU `timeout` is not on macOS by default, and killing only the shell it wraps left the
    // npm → node grandchild holding the pipes. The timeout is Node's job now.
    const timeoutCommand = /['"`][^'"`\n]*\btimeout\s+(?:-|\d|\$\{)/;
    expect(gate).not.toMatch(timeoutCommand);
    expect(gate).not.toMatch(/spawn(?:Sync)?\(\s*['"`]timeout['"`]/);

    // The kill must reach the whole process group, not just the shell.
    expect(gate).toMatch(/detached:\s*true/);
    expect(gate).toMatch(/process\.kill\(\s*-/);
  });

  it('AC-15 execution-gates.ts uses neither Promise.all nor execSync', () => {
    const gate = code(readFileSync(join(factoryRoot, 'harness', 'execution-gates.ts'), 'utf-8'));

    // Build, test and dev run one after another: in parallel they fight over ports, caches and
    // the CPU, and a slow build starves the test run into a timeout.
    expect(gate).not.toMatch(/Promise\.(all|allSettled|race|any)\b/);
    // execSync blocks the event loop, so no Node timeout could ever fire while it runs.
    expect(gate).not.toMatch(/\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/);
  });

  it('AC-26 no repo file contains the wrong feature-factory skill path segment', () => {
    // Built by concatenation so this file does not match itself.
    const wrongSegments = [
      'skills/software/' + 'factory/feature/',
      // The README's variant of the same dead link (it also dropped `software/`).
      '.claude/skills/' + 'factory/feature/'
    ];
    const rightPath = '~/.claude/skills/software/' + 'feature-factory/SKILL.md';

    const files = repoFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap(file => {
      const text = readFileSync(file, 'utf-8');
      return wrongSegments
        .filter(segment => text.includes(segment))
        .map(segment => `${relative(repoRoot, file)}: ${segment}`);
    });
    expect(offenders).toEqual([]);

    // Removing the dead link is not enough: the places that pointed at it must now point at the
    // skill that exists.
    const mustNameTheSkill = [
      'factory/feature/agents/01-researcher.md',
      'factory/feature/agents/03-spec-writer.md',
      'factory/feature/agents/04-backend-builder.md',
      'factory/feature/agents/05-frontend-builder.md',
      'factory/feature/agents/06-test-verifier.md',
      'factory/feature/agents/07-validator.md',
      'README.md'
    ];
    const missing = mustNameTheSkill.filter(
      file => !readFileSync(join(repoRoot, file), 'utf-8').includes(rightPath)
    );
    expect(missing).toEqual([]);
  });

  it('AC-27 no agent contract names an mcp__memorykit__ tool', () => {
    const agentsDir = join(factoryRoot, 'feature', 'agents');
    const contracts = readdirSync(agentsDir).filter(name => name.endsWith('.md'));

    // The eight chain contracts at least; the scan must be looking at them.
    for (let n = 1; n <= 8; n++) {
      expect(contracts.some(name => name.startsWith(`0${n}-`))).toBe(true);
    }

    const offenders = contracts.filter(name =>
      readFileSync(join(agentsDir, name), 'utf-8').includes('mcp__memorykit__')
    );
    expect(offenders).toEqual([]);
  });

  it('AC-58 orchestrator contains none of the A11 dead code and maxAttempts is removed', () => {
    const orchestrator = code(
      readFileSync(join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts'), 'utf-8')
    );

    const deadIdentifiers = [
      'getStageNameLowerCase',
      'StageContext',
      'MaterializationAudit',
      'getFixCodeTemplate',
      'ResearcherOutput',
      'StoryWriterOutput',
      'SpecWriterOutput',
      'TestVerifierOutput',
      'ValidatorOutput',
      'FeatureConsolidatorOutput',
      'backendPassed',
      'maxAttempts'
    ];
    // Whole identifiers only: `buildStageContext` is live and must not count as `StageContext`.
    const present = deadIdentifiers.filter(name => new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(orchestrator));
    expect(present).toEqual([]);

    // An audit declared `let … = null` outside the try that is its only user.
    expect(orchestrator).not.toMatch(/let\s+(infrastructureAudit|executionAudit)\b[^;]*=\s*null/);

    // Nothing honoured maxAttempts, so the port no longer offers it.
    const invokeAgent = code(readFileSync(join(factoryRoot, 'runner', 'invoke-agent.ts'), 'utf-8'));
    const invocation = invokeAgent.match(/export interface AgentInvocation\s*\{([^}]*)\}/);
    expect(invocation).not.toBeNull();
    expect(invocation![1]).not.toMatch(/\bmaxAttempts\b/);

    // getFixCodeTemplate is dead in the orchestrator, not dead everywhere: it stays exported.
    const errorCategories = readFileSync(join(factoryRoot, 'harness', 'error-categories.ts'), 'utf-8');
    expect(errorCategories).toMatch(/export function getFixCodeTemplate\b/);
  });

  it('AC-69 the frontend-file regexes exist only in frontend-files.ts', () => {
    // Built by concatenation so this file does not match itself.
    const needles = ['tsx|jsx|' + 'vue|svelte', 'components|pages|' + 'app|views|screens'];
    const home = join(factoryRoot, 'harness', 'frontend-files.ts');

    const sources = repoFiles().filter(file => /\.(ts|js|mjs|cjs)$/.test(file));
    expect(sources).toContain(home);

    const holders = sources.filter(file => {
      const text = readFileSync(file, 'utf-8');
      return needles.some(needle => text.includes(needle));
    });
    expect(holders.map(file => relative(repoRoot, file))).toEqual([relative(repoRoot, home)]);
  });
});
