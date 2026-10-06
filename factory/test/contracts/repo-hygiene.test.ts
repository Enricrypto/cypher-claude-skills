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
import { join, relative, resolve, sep } from 'path';

import { DEFAULT_GATES } from '../../feature/workflows/feature-factory-orchestrator';
import { auditInfrastructure, parseJsonc } from '../../harness/infrastructure-gates';
import { auditExecution } from '../../harness/execution-gates';
import { GIT_EXTRACTION_SUBCOMMANDS, GIT_READ_SUBCOMMANDS, GIT_SNAPSHOT_SUBCOMMANDS } from '../../harness/change-diff';
import { DIRECTION_CHARACTER_RANGES, isDirectionCharacter } from '../../harness/direction-characters';
import { code } from '../fixtures/source-code';

const factoryRoot = resolve(__dirname, '../..');
const repoRoot = resolve(factoryRoot, '..');
const testRoot = join(factoryRoot, 'test');
const fixturesDir = join(testRoot, 'fixtures');
const thisFile = __filename;

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

  it('AC-4 AC-61 the four root scripts are gone and tsconfig no longer excludes them', () => {
    // AC-4 kept these untracked scratch scripts out of the typecheck; AC-61 replaced what they did
    // (pause/approve/resume) and deleted them, so the exclusions would only hide a new file that
    // happened to reuse a name (I-3).
    const tsconfig = parseJsonc(readFileSync(join(repoRoot, 'tsconfig.json'), 'utf-8'));
    const exclude: string[] = tsconfig.exclude ?? [];
    const scripts = ['run-cpf-factory.ts', 'run-frontend-only.ts', 'probe-cwd.ts', 'probe-cwd.mjs'];

    expect(scripts.filter(file => existsSync(join(repoRoot, file)))).toEqual([]);
    expect(scripts.filter(file => exclude.includes(file))).toEqual([]);
  });

  it('carry-over 05-frontend-builder.md claims no loop-back to the Backend Builder', () => {
    // The orchestrator never routes the Frontend Builder back to the Backend Builder: a builder
    // that cannot proceed returns ESCALATE, and the run stops for a human (carry-over 1).
    const contract = readFileSync(join(factoryRoot, 'feature', 'agents', '05-frontend-builder.md'), 'utf-8');

    expect(contract).not.toMatch(/loops?\s+back\s+to\s+(the\s+)?(Backend Builder|Agent 4)/i);
    expect(contract).not.toMatch(/routes?\s+back\s+to\s+(the\s+)?(Backend Builder|Agent 4)/i);
    // What it does instead, and where the API it consumes is written down.
    expect(contract).toMatch(/`ESCALATE`/);
    expect(contract).toMatch(/BACKEND_SUMMARY\.md/);
    expect(contract).toMatch(/API_CONTRACT\.md/);
  });

  it('S-1 smoke-validator.ts is operator-only: no test or module imports it, and it invokes only 07-validator through the SDK invoker', () => {
    const script = join(factoryRoot, 'runner', 'smoke-validator.ts');
    expect(existsSync(script)).toBe(true);

    // `npm test` stays offline: nothing under test/ (fixtures included) and no other module
    // imports or requires the script. The name is built by concatenation so this file does not
    // match itself.
    const needle = 'smoke-' + 'validator';
    const allTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === join(factoryRoot, 'e2e') ? [] : allTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });
    const importers = allTs(factoryRoot)
      .filter(file => file !== thisFile && file !== script)
      .filter(file => readFileSync(file, 'utf-8').includes(needle));
    expect(importers.map(file => relative(repoRoot, file))).toEqual([]);

    const source = code(readFileSync(script, 'utf-8'));

    // One agent, the Validator, through the production invoker, with the production prompt; judged
    // by the harness's own schema check and security evaluation.
    const agents = [...source.matchAll(/\bagent\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(agents.length).toBeGreaterThan(0);
    expect(new Set(agents)).toEqual(new Set(['07-validator']));
    expect(source).toMatch(/\bcreateSdkInvoker\(/);
    expect(source).toMatch(/\bvalidatorPrompt\(/);
    expect(source).toMatch(/\bvalidateOutputSchema\(\s*4\s*,\s*'07-validator'/);
    expect(source).toMatch(/\bevaluateSecurityChecks\(/);

    // It refuses a non-empty --cwd, and its exit codes are exactly PASS 0, FAIL 1, INCONCLUSIVE 2.
    expect(source).toMatch(/readdirSync\(/);
    expect(source).toMatch(/const EXIT = \{ PASS: 0, FAIL: 1, INCONCLUSIVE: 2 \} as const;/);
    const literalExits = [...source.matchAll(/process\.exit(?:Code\s*=|\()\s*(\d+)/g)].map(m => m[1]);
    expect(literalExits).toEqual([]);
    expect(source).toMatch(/require\.main === module/);
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

  it('AC-90 D-B2-4 contracts 04 and 05 leave the no-commit and snapshot rule to the builder prompt', () => {
    // By hand (other projects), builders commit per step and no harness snapshots anything, so
    // the rule lives only in builderPrompt; agent-prompts.test.ts pins the prompt's lines.
    for (const name of ['04-backend-builder.md', '05-frontend-builder.md']) {
      const contract = readFileSync(join(factoryRoot, 'feature', 'agents', name), 'utf-8');

      expect(contract).not.toMatch(/never commit/i);
      expect(contract).not.toMatch(/snapshots your work/i);
      expect(contract).not.toContain('`.factory/`');
    }
  });

  it('AC-91 D-B2-4 contracts 04 and 05 tell the builder to run the tests related to its changes, with no mention of Gate 2', () => {
    // An instruction only: no test checks which tests a builder ran. In the program, builderPrompt
    // adds that Gate 2 runs the full suite (pinned in agent-prompts.test.ts).
    for (const name of ['04-backend-builder.md', '05-frontend-builder.md']) {
      const contract = readFileSync(join(factoryRoot, 'feature', 'agents', name), 'utf-8');
      const beforeDone = /## Before Declaring Done\n([\s\S]*?)\n## /.exec(contract);
      expect(beforeDone).not.toBeNull();

      expect(beforeDone![1]).toContain(
        '3. Tests: run the tests related to the files you changed (for example `jest --findRelatedTests <files>` or `vitest related <files> --run`), and anything else your session asks for. All must pass.'
      );
      expect(beforeDone![1]).not.toMatch(/Gate 2/);
      // The old item 3 asked for a whole suite.
      expect(beforeDone![1]).not.toMatch(/test suite — all must pass/);
    }
  });

  it('D-B2-4 the shared contracts 04, 05, 06 and 07 contain no program-only rule', () => {
    // ~/.claude/agents/ links to these files, and by-hand runs in other projects read them: no
    // harness, no snapshot, no review copy, no Gate 2. Program-only rules live in agent-prompts.ts.
    const programOnly: ReadonlyArray<readonly [string, RegExp]> = [
      ['the harness snapshot', /harness snapshots/i],
      ['Gate 2', /Gate 2/i],
      ['the review copy', /review copy/i],
      ['the read-only copy', /read-only copy/i],
      ['the test-path rule', /test paths? only/i],
      ['the test-path section', /Where you may write/i],
      ['the review-copy section', /Where you review/i],
      ['no test report', /no test report/i],
      ['the no-commit rule', /never commit/i],
      ['.factory/', /\.factory\/`?(?!_archive)/]
    ];
    const offenders = ['04-backend-builder.md', '05-frontend-builder.md', '06-test-verifier.md', '07-validator.md'].flatMap(name => {
      const contract = readFileSync(join(factoryRoot, 'feature', 'agents', name), 'utf-8');
      return programOnly.filter(([, pattern]) => pattern.test(contract)).map(([label]) => `${name}: ${label}`);
    });
    expect(offenders).toEqual([]);
  });

  it('AC-45 AC-80 git is spawned only by change-diff.ts with one spawnSync, the subcommands are exactly GIT_READ_SUBCOMMANDS, GIT_SNAPSHOT_SUBCOMMANDS and GIT_EXTRACTION_SUBCOMMANDS, no forbidden subcommand appears in any literal, and the only refs/factory/ literal is in factoryRef', () => {
    const scanned = ['feature/workflows', 'runner', 'harness', 'contracts'].flatMap(dir =>
      readdirSync(join(factoryRoot, dir))
        .filter(name => name.endsWith('.ts'))
        .map(name => join(factoryRoot, dir, name))
    );
    const changeDiffPath = join(factoryRoot, 'harness', 'change-diff.ts');
    expect(scanned).toContain(changeDiffPath);
    expect(scanned).toContain(join(factoryRoot, 'contracts', 'feature-spec.ts'));

    // Every string literal in the code: an argv entry, a command line, a URL path, a message.
    const literal = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
    const literalsOf = (file: string) => code(readFileSync(file, 'utf-8')).match(literal) ?? [];

    // AC-80: never a PR, a push, a porcelain commit or anything that moves the branch, index or tree.
    const neverRun = ['push', 'commit', 'checkout', 'switch', 'reset', 'merge', 'rebase', 'stash', 'branch', 'tag', 'worktree', 'fetch', 'clone'];
    const forbidden = [
      new RegExp(`^['"\`](${neverRun.join('|')})['"\`]$`),
      new RegExp(`\\bgit\\s+(${neverRun.join('|')})\\b`),
      /\bgh\s+pr\b/,
      /\bpr\s+create\b/i,
      /\/pulls\b/
    ];
    const offenders = scanned.flatMap(file =>
      literalsOf(file)
        .filter(text => forbidden.some(pattern => pattern.test(text)))
        .map(text => `${relative(repoRoot, file)}: ${text}`)
    );
    expect(offenders).toEqual([]);

    // Git is spawned in exactly one place, with exactly one spawn call.
    const spawnsGit = scanned.filter(file => /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*['"`]git\b/.test(code(readFileSync(file, 'utf-8'))));
    expect(spawnsGit.map(file => relative(repoRoot, file))).toEqual([join('factory', 'harness', 'change-diff.ts')]);

    const changeDiff = code(readFileSync(changeDiffPath, 'utf-8'));
    expect(changeDiff.match(/spawnSync\(/g)).toHaveLength(1);
    // The subcommand passed to spawnSync is the typed parameter, never a literal.
    expect(changeDiff).toMatch(/spawnSync\('git', \[\.\.\.SAFE_GIT_CONFIG, subcommand, \.\.\.args\]/);

    // The allow-list is exactly the three arrays, and the type is built from them.
    expect(changeDiff).toMatch(/export const GIT_READ_SUBCOMMANDS = \['rev-parse', 'diff', 'ls-files'\] as const;/);
    expect(changeDiff).toMatch(/export const GIT_SNAPSHOT_SUBCOMMANDS = \['add', 'write-tree', 'commit-tree', 'update-ref'\] as const;/);
    expect(changeDiff).toMatch(/export const GIT_EXTRACTION_SUBCOMMANDS = \['ls-tree', 'cat-file'\] as const;/);
    expect(changeDiff).toMatch(
      /type GitSubcommand = \(typeof GIT_READ_SUBCOMMANDS\)\[number\] \| \(typeof GIT_SNAPSHOT_SUBCOMMANDS\)\[number\] \| \(typeof GIT_EXTRACTION_SUBCOMMANDS\)\[number\];/
    );
    expect([...GIT_READ_SUBCOMMANDS, ...GIT_SNAPSHOT_SUBCOMMANDS, ...GIT_EXTRACTION_SUBCOMMANDS]).toEqual([
      'rev-parse', 'diff', 'ls-files', 'add', 'write-tree', 'commit-tree', 'update-ref', 'ls-tree', 'cat-file'
    ]);
    // Every call site of git() and its two wrappers names its subcommand as a literal.
    const subcommands = [...changeDiff.matchAll(/\b(?:git|gitOrThrow|snapshotStep)\(\s*\w+\s*,\s*'([^']+)'/g)].map(m => m[1]);
    expect(new Set(subcommands)).toEqual(new Set([...GIT_READ_SUBCOMMANDS, ...GIT_SNAPSHOT_SUBCOMMANDS, ...GIT_EXTRACTION_SUBCOMMANDS]));

    // No production file other than change-diff.ts imports its git() choke point.
    const importsGit = scanned
      .filter(file => file !== changeDiffPath)
      .filter(file => /import\s*\{[^}]*\bgit\b[^}]*\}\s*from\s*['"][^'"]*change-diff['"]/.test(readFileSync(file, 'utf-8')));
    expect(importsGit.map(file => relative(repoRoot, file))).toEqual([]);

    // Every ref the harness writes is built by factoryRef: the only refs/factory/ literal is in it.
    const refLiterals = scanned.flatMap(file =>
      literalsOf(file)
        .filter(text => text.includes('refs/factory/'))
        .map(text => `${relative(repoRoot, file)}: ${text}`)
    );
    expect(refLiterals).toHaveLength(1);
    expect(refLiterals[0]).toMatch(/^factory\/harness\/change-diff\.ts: /);
    const factoryRefBody = /export function factoryRef\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(changeDiff);
    expect(factoryRefBody).not.toBeNull();
    expect(factoryRefBody![1]).toContain('refs/factory/');
  });

  it('AC-48 no knowledgeStored field or Knowledge Stored criterion exists in the Stage 5 contract, the stage context or the orchestrator', () => {
    const sources = [
      join(factoryRoot, 'harness', 'stage-gates.ts'),
      join(factoryRoot, 'harness', 'stage-context.ts'),
      join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts')
    ];

    const offenders = sources.filter(file => /knowledgeStored|Knowledge Stored|validateKnowledgeStored/.test(code(readFileSync(file, 'utf-8'))));
    expect(offenders.map(file => relative(repoRoot, file))).toEqual([]);
  });

  it('AC-77 the --yes approver returns APPROVE unconditionally', () => {
    const cli = code(readFileSync(join(factoryRoot, 'runner', 'cli.ts'), 'utf-8'));

    // --yes is decided before the TTY check and the human approver, and returns one constant decision.
    expect(cli).toMatch(/if\s*\(\s*yes\s*\)\s*return\s+approveAll\s*;/);
    const approveAll = /const approveAll = async \(\): Promise<CheckpointDecision> => (\(\{[^}]*\}\));/.exec(cli);
    expect(approveAll).not.toBeNull();
    expect(approveAll![1]).toBe(`({ decision: 'APPROVE', approvedBy: '--yes' })`);
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

  it('AC-104 no production call site passes stateWriter', () => {
    // The non-durable state writer is for tests only. Production code (everything under factory/
    // but test/) never names the option, so every production save is the durable saveState. The
    // one exception is the orchestrator, which declares it and resolves it in exactly one place.
    // The name is built by concatenation so this file does not match itself.
    const option = 'state' + 'Writer';
    const orchestratorPath = join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts');
    const productionTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === testRoot ? [] : productionTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });

    const sources = productionTs(factoryRoot);
    expect(sources).toContain(orchestratorPath);

    const holders = sources.filter(file => new RegExp(`\\b${option}\\b`).test(code(readFileSync(file, 'utf-8'))));
    expect(holders.map(file => relative(repoRoot, file))).toEqual([relative(repoRoot, orchestratorPath)]);

    // In the orchestrator: the optional declaration and one resolution against saveState, nothing else.
    const orchestrator = code(readFileSync(orchestratorPath, 'utf-8'));
    const mentions = orchestrator.match(new RegExp(`\\b${option}\\b`, 'g')) ?? [];
    expect(mentions).toHaveLength(2);
    expect(orchestrator).toMatch(new RegExp(`^\\s*${option}\\?:`, 'm'));
    expect(orchestrator).toMatch(new RegExp(`options\\.${option}\\s*\\?\\?\\s*saveState\\b`));
  });

  it('D-20 no production call site passes reviewRoot', () => {
    // The review root is a test-only option (PR B-2 D-20, C-26): production code (everything under
    // factory/ but test/) never names it, so production review copies always go to the OS temp
    // directory. The orchestrator declares it and resolves it in exactly one place. The name is
    // built by concatenation so this file does not match itself.
    const option = 'review' + 'Root';
    const orchestratorPath = join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts');
    const productionTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === testRoot ? [] : productionTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });

    const sources = productionTs(factoryRoot);
    expect(sources).toContain(orchestratorPath);

    const holders = sources.filter(file => new RegExp(`\\b${option}\\b`).test(code(readFileSync(file, 'utf-8'))));
    expect(holders.map(file => relative(repoRoot, file))).toEqual([relative(repoRoot, orchestratorPath)]);

    const orchestrator = code(readFileSync(orchestratorPath, 'utf-8'));
    expect(orchestrator.match(new RegExp(`\\b${option}\\b`, 'g')) ?? []).toHaveLength(2);
    expect(orchestrator).toMatch(new RegExp(`^\\s*${option}\\?:\\s*string;`, 'm'));
    expect(orchestrator).toMatch(new RegExp(`options\\.${option}\\s*\\?\\?\\s*realpathSync\\(tmpdir\\(\\)\\)`));
  });

  it('AC-119 no source file uses git worktree and no agent sandbox is a worktree', () => {
    // D-5: the Validator reviews a read-only copy extracted from the snapshot ref, never a git
    // worktree. No production source names one in code (comments aside), and git() cannot run it.
    const word = 'work' + 'tree';
    const productionTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === testRoot ? [] : productionTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });

    const sources = productionTs(factoryRoot);
    expect(sources.length).toBeGreaterThan(10);
    const users = sources.filter(file => new RegExp(`\\b${word}\\b`, 'i').test(code(readFileSync(file, 'utf-8'))));
    expect(users.map(file => relative(repoRoot, file))).toEqual([]);

    const subcommands: readonly string[] = [...GIT_READ_SUBCOMMANDS, ...GIT_SNAPSHOT_SUBCOMMANDS, ...GIT_EXTRACTION_SUBCOMMANDS];
    expect(subcommands).not.toContain(word);
  });

  it('AC-100 cli.ts makes no description comparison and no DESCRIPTION_* decision, and reads the description only for its banner', () => {
    const cli = code(readFileSync(join(factoryRoot, 'runner', 'cli.ts'), 'utf-8'));

    // No refusal code, no description helper from the library, no description check of its own.
    expect(cli).not.toMatch(/DESCRIPTION_/);
    expect(cli).not.toMatch(/\b(?:resumeDescription|checkResumeDescription|assertSameDescription)\b/);
    expect(cli).not.toMatch(/featureDescription\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*\w+(?:\.\w+)*\.featureDescription\b/);
    expect(cli).not.toMatch(/\bfeature\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*(?:command\.)?feature\b/);

    // featureDescription is read exactly once (the banner) and passed through exactly once.
    const reads = cli.match(/\.featureDescription\b/g) ?? [];
    expect(reads).toHaveLength(1);
    const bannerSource = /const\s+banner\s*=([^;]*);/.exec(cli);
    expect(bannerSource?.[1]).toMatch(/resumeFromState\.featureDescription\s*\?\?\s*command\.feature\s*\?\?\s*'\(not recorded\)'/);
    expect(cli).toMatch(/out\.log\(`  feature: \$\{banner\}`\)/);
    expect(cli.match(/\bfeatureDescription\s*:/g) ?? []).toHaveLength(1);
    expect(cli).toMatch(/\bfeatureDescription:\s*command\.feature\s*,/);
  });

  it('AC-97 the CLI resume path calls assertNoFactoryCaseVariant before it looks the run up, and --close and --consolidate do not', () => {
    const cli = code(readFileSync(join(factoryRoot, 'runner', 'cli.ts'), 'utf-8'));

    // The library guard, imported, not re-implemented.
    expect(cli).toMatch(/import\s*\{[^}]*\bassertNoFactoryCaseVariant\b[^}]*\}\s*from\s*'\.\.\/harness\/run-directory'/);
    expect(cli).not.toMatch(/toLowerCase\(\)/);

    const calls = [...cli.matchAll(/\bassertNoFactoryCaseVariant\s*\(/g)];
    expect(calls).toHaveLength(1);
    const guard = calls[0].index!;
    const lookup = cli.search(/\bliveRunToResume\s*\(\s*command\./);
    expect(lookup).toBeGreaterThan(guard);
    // The guard sits in the run/resume branch, after the close and consolidate branches.
    expect(guard).toBeGreaterThan(cli.indexOf(`case 'consolidate':`, cli.indexOf('async function execute')));
    // findRun is reached only through liveRunToResume.
    expect(cli.match(/\bfindRun\s*\(/g) ?? []).toHaveLength(1);
    expect(/function liveRunToResume[\s\S]*?\bfindRun\s*\(/.test(cli)).toBe(true);
  });

  it('AC-105 printableForTerminal, the document check and checkpoint presentation import the one set, and no other copy exists', () => {
    const home = join(factoryRoot, 'harness', 'direction-characters.ts');
    const homeSource = readFileSync(home, 'utf-8');

    // The module is pure: it imports nothing, and it holds the one set.
    expect(homeSource).not.toMatch(/^\s*import\b|\brequire\s*\(/m);
    expect(code(homeSource)).toMatch(/export const DIRECTION_CHARACTER_RANGES\b/);

    /**
     * Every way a source file can spell a member of the set: the raw character, a hex literal
     * (`0x202e`), a `\u` escape in either form, or a `\u` range that spans a member. Escapes and
     * literals are looked for in code only, so prose in a comment does not count.
     */
    const setSpellings = (source: string): string[] => {
      const found: string[] = [];
      const name = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
      for (const char of source) {
        if (isDirectionCharacter(char.codePointAt(0)!)) found.push(`raw ${name(char.codePointAt(0)!)}`);
      }
      const body = code(source);
      for (const match of body.matchAll(/\b0x0*([0-9a-f]{1,6})\b/gi)) {
        if (isDirectionCharacter(parseInt(match[1], 16))) found.push(`literal ${match[0]}`);
      }
      const escape = String.raw`\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))`;
      const value = (braced?: string, plain?: string) => parseInt(braced ?? plain ?? '', 16);
      for (const match of body.matchAll(new RegExp(`${escape}-${escape}`, 'g'))) {
        const [low, high] = [value(match[1], match[2]), value(match[3], match[4])];
        if (DIRECTION_CHARACTER_RANGES.some(([a, b]) => low <= b && high >= a)) found.push(`range ${match[0]}`);
      }
      for (const match of body.matchAll(new RegExp(escape, 'g'))) {
        if (isDirectionCharacter(value(match[1], match[2]))) found.push(`escape ${match[0]}`);
      }
      return found;
    };

    // The detector works: the module itself spells the set.
    expect(setSpellings(homeSource).length).toBeGreaterThan(0);

    // No other copy: no source file in the repo, tests aside (they build characters from code
    // points to exercise the set), spells a member of the set.
    const sources = repoFiles().filter(file => /\.(ts|js|mjs|cjs)$/.test(file) && !file.startsWith(testRoot + sep));
    expect(sources).toContain(home);
    const copies = sources
      .filter(file => file !== home)
      .flatMap(file => setSpellings(readFileSync(file, 'utf-8')).map(spelling => `${relative(repoRoot, file)}: ${spelling}`));
    expect(copies).toEqual([]);

    // Every production file that uses the set's API imports it from the module and defines none
    // of it. The names are built from a list, so a new consumer (the document check, the
    // checkpoint presentation) is held to this the moment it uses any of them.
    const api = [
      'DIRECTION_CHARACTER_RANGES',
      'isDirectionCharacter',
      'directionCharacterPattern',
      'findDirectionCharacters',
      'formatCodePoint',
      'escapeCodePoint',
      'escapeDirectionCharacters',
      'documentFinding',
      'DOCUMENT_CHECK_SOURCE'
    ];
    const uses = (source: string) => api.some(name => new RegExp(`\\b${name}\\b`).test(source));
    const consumers = sources.filter(file => file !== home && uses(code(readFileSync(file, 'utf-8'))));
    for (const file of consumers) {
      const source = code(readFileSync(file, 'utf-8'));
      const label = relative(repoRoot, file);
      expect({ label, imports: /import\s*\{[^}]*\}\s*from\s*'(?:\.\.?\/)+(?:harness\/)?direction-characters'/.test(source) }).toEqual({
        label,
        imports: true
      });
      const ownDefinitions = api.filter(name =>
        new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}\\b`).test(source)
      );
      expect({ label, ownDefinitions }).toEqual({ label, ownDefinitions: [] });
    }

    // The terminal is a consumer today: printableForTerminal escapes through the shared pattern
    // and the shared escape. The document check (step 8) is one as soon as it exists.
    const cliPath = join(factoryRoot, 'runner', 'cli.ts');
    expect(consumers).toContain(cliPath);
    const printable = /export function printableForTerminal\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(code(readFileSync(cliPath, 'utf-8')));
    expect(printable?.[1]).toMatch(/\bescapeCodePoint\s*\(/);
    expect(code(readFileSync(cliPath, 'utf-8'))).toMatch(/\bdirectionCharacterPattern\s*\(\s*\)/);
    const documentCheck = join(factoryRoot, 'harness', 'document-check.ts');
    if (existsSync(documentCheck)) expect(consumers).toContain(documentCheck);
    // The checkpoint presentation (step 9) finds, escapes and names the characters through the set's API.
    expect(consumers).toContain(join(factoryRoot, 'harness', 'checkpoint-presentation.ts'));
  });

  it('AC-109 presentationFor is the only checkpoint presentation the orchestrator uses, for presenting, --approve and the I-7 re-check', () => {
    const productionTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === testRoot ? [] : productionTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });
    const sources = productionTs(factoryRoot);
    const presentationPath = join(factoryRoot, 'harness', 'checkpoint-presentation.ts');
    const orchestratorPath = join(factoryRoot, 'feature', 'workflows', 'feature-factory-orchestrator.ts');
    expect(sources).toEqual(expect.arrayContaining([presentationPath, orchestratorPath]));
    const mentions = (name: string) =>
      sources
        .filter(file => file !== presentationPath && new RegExp(`\\b${name}\\b`).test(code(readFileSync(file, 'utf-8'))))
        .map(file => relative(repoRoot, file));

    // The per-checkpoint builders stay exported for unit tests, but no production file reaches past presentationFor.
    for (const name of ['presentStory', 'presentBrief', 'presentChange']) expect({ name, files: mentions(name) }).toEqual({ name, files: [] });
    // presentationFor is used by the orchestrator only, and there only inside presentCheckpoint.
    expect(mentions('presentationFor')).toEqual([relative(repoRoot, orchestratorPath)]);
    const orchestrator = code(readFileSync(orchestratorPath, 'utf-8'));
    const presentCheckpoint = /\nasync function presentCheckpoint\([\s\S]*?\n\}\n/.exec(orchestrator)?.[0] ?? '';
    const calls = (text: string, name: string) => (text.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length;
    expect(calls(presentCheckpoint, 'presentationFor')).toBeGreaterThan(0);
    expect(calls(orchestrator, 'presentationFor')).toBe(calls(presentCheckpoint, 'presentationFor'));

    // Presenting: every checkpoint is presented through presentCheckpoint.
    const presented = [...orchestrator.matchAll(/\bcheckpoint\(\s*CHECKPOINTS\.(\w+),\s*([^\n]*)/g)].map(m => [m[1], m[2]]);
    expect(presented.map(([name]) => name).sort()).toEqual(['BRIEF', 'CHANGE', 'STORY']);
    for (const [name, presenter] of presented) {
      expect({ name, presenter }).toEqual({
        name,
        presenter: expect.stringMatching(/^\(\) => presentCheckpoint\([123],|^presentValidatedChange\)/)
      });
    }
    expect(orchestrator).toMatch(/const presentValidatedChange = \(\): Promise<CheckpointPresentation> =>\s*presentCheckpoint\(3,/);

    // --approve and the I-7 re-check: both re-build through presentCheckpoint, and read it only through one helper.
    expect(orchestrator).toMatch(/const representCheckpoint = \(id: CheckpointId\) => presentCheckpoint\(id,/);
    expect(orchestrator).toMatch(/assertPendingUnchanged\(resumed, representCheckpoint, cwd\)/);
    expect(orchestrator).toMatch(/assertApprovedArtifactsUnchanged\(resumed, representCheckpoint, resumedRunDir, cwd\)/);
    for (const check of ['assertPendingUnchanged', 'assertApprovedArtifactsUnchanged']) {
      const body = new RegExp(`\\nasync function ${check}\\([\\s\\S]*?\\n\\}\\n`).exec(orchestrator)?.[0] ?? '';
      expect({ check, rebuilds: /\bcurrentPresentation\(represent,/.test(body) }).toEqual({ check, rebuilds: true });
    }
    // No other checkpoint text is hashed in the orchestrator.
    expect(orchestrator).not.toMatch(/\bsha256Hex\b/);
  });

  it('AC-107 every harness write path for agent and harness-rendered documents goes through the document check', () => {
    const productionTs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return full === testRoot ? [] : productionTs(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });
    const sources = productionTs(factoryRoot);
    const at = (...parts: string[]) => join(factoryRoot, ...parts);
    const orchestratorPath = at('feature', 'workflows', 'feature-factory-orchestrator.ts');
    const consolidatePath = at('feature', 'workflows', 'consolidate-run.ts');
    const featureSpecPath = at('contracts', 'feature-spec.ts');
    // Operator-only (D-12): it writes a Researcher's report for a person to read, outside any run,
    // so there is no run state to record a finding in. Excluded on purpose.
    const smokeResearcherPath = at('runner', 'smoke-researcher.ts');
    const callers = (name: string) =>
      sources
        .filter(file => new RegExp(`(?<!function\\s)\\b${name}\\s*\\(`).test(code(readFileSync(file, 'utf-8'))))
        .map(file => relative(repoRoot, file))
        .sort();
    const label = (...files: string[]) => files.map(file => relative(repoRoot, file)).sort();

    // The two document writers are the only callers of the no-follow document write, and each is
    // called only from the known paths below.
    expect(callers('writeFileNoFollow')).toEqual(label(at('harness', 'stage-context.ts'), at('harness', 'harness-documents.ts')));
    expect(callers('persistArtifacts')).toEqual(label(orchestratorPath, consolidatePath, featureSpecPath, smokeResearcherPath));
    expect(callers('writeHarnessDocument')).toEqual(label(orchestratorPath));
    // The pre-supplied spec is written only through acceptFeatureSpec, which only the orchestrator calls.
    expect(callers('acceptFeatureSpec')).toEqual(label(orchestratorPath));

    const orchestrator = code(readFileSync(orchestratorPath, 'utf-8'));
    const body = (name: string): string => {
      const match = new RegExp(`const ${name} = (?:async )?\\([^)]*\\)[^{]*=> \\{([\\s\\S]*?)\\n  \\};`).exec(orchestrator);
      expect({ name, found: match !== null }).toEqual({ name, found: true });
      return match![1];
    };

    // checkDocuments reads back and records once per message, under the document-check source.
    expect(body('checkDocuments')).toMatch(/recordFindingsOnce\(\s*stage,\s*DOCUMENT_CHECK_SOURCE,\s*documentFindings\(\s*files\s*\)\s*\)/);
    expect(body('recordFindingsOnce')).toMatch(/\baddImportantFindingsOnce\(/);
    expect(body('recordFindingsOnce')).toMatch(/state = commit\(/);

    // One call of each writer in the orchestrator, each inside its wrapper, followed by the check.
    expect(orchestrator.match(/\bpersistArtifacts\s*\(/g)).toHaveLength(1);
    expect(body('persist')).toMatch(/persistArtifacts\([\s\S]*\bcheckDocuments\(/);
    expect(orchestrator.match(/\bwriteHarnessDocument\s*\(/g)).toHaveLength(1);
    expect(body('writeDocument')).toMatch(/writeHarnessDocument\([\s\S]*\bcheckDocuments\(/);

    // The accepted pre-supplied spec: its documents are checked, at Stage 2, before the run goes on.
    const supplied = body('preSuppliedStages');
    const accepted = supplied.indexOf('acceptFeatureSpec(');
    const check = supplied.search(/\bcheckDocuments\(\s*2\s*,/);
    expect(accepted).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(accepted);
    expect(check).toBeLessThan(supplied.indexOf('recordAgentStep('));

    // The Validator's findings use the same once-only recorder: one dedup rule, not two.
    expect(body('recordValidatorFindings')).toMatch(/\brecordFindingsOnce\(\s*4,\s*'07-validator'/);
    expect(body('recordValidatorFindings')).not.toMatch(/new Set\(/);

    // consolidate-run checks what it persisted, once per message, and saves.
    const consolidate = code(readFileSync(consolidatePath, 'utf-8'));
    expect(consolidate.match(/\bpersistArtifacts\s*\(/g)).toHaveLength(1);
    expect(consolidate).toMatch(
      /persistArtifacts\([\s\S]*addImportantFindingsOnce\(\s*state,\s*STAGE,\s*DOCUMENT_CHECK_SOURCE,\s*documentFindings\(/
    );
  });

  it('AC-117 AC-118 AC-132 the SDK invoker runs each agent in call.cwd ?? config.cwd and in no other directory', () => {
    // D-4: the main Validator and its skeptics are pointed at the review copy by the call; a
    // regression to `cwd: config.cwd` would silently run them in the live project.
    const invokeAgent = code(readFileSync(join(factoryRoot, 'runner', 'invoke-agent.ts'), 'utf-8'));
    const invocation = invokeAgent.match(/export interface AgentInvocation\s*\{([^}]*)\}/);
    expect(invocation).not.toBeNull();
    expect(invocation![1]).toMatch(/\bcwd\?\s*:\s*string\s*;/);

    expect(invokeAgent).toContain('call.cwd ?? config.cwd');
    // One `cwd:` value in the module (type annotations aside): the SDK options'.
    expect(invokeAgent.match(/\bcwd\??\s*:(?!\s*string\b)/g)).toHaveLength(1);
    expect(invokeAgent).toMatch(/\bcwd\s*:\s*call\.cwd \?\? config\.cwd\b/);
  });
});
