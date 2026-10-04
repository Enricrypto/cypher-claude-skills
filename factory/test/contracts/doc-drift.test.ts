/**
 * SKILL.md drift (D-10, D-11; AC-59, AC-60).
 *
 * SKILL.md is what a human reads to learn what the factory does. It used to describe a 10-agent
 * chain, a PR-review checkpoint the program never enforced, a factory that opened PRs, builders that logged to memory and a
 * Gate 2 that looped back to the Test Verifier — none of which the code did. These tests pin the
 * document to the code: every claim that has a source of truth in the program is checked against
 * that source, and every claim that was retired is forbidden from coming back.
 *
 * The machine-readable claims block (`<!-- factory-claims -->` + a ```json fence) carries the
 * structured claims. The prose is checked too, because the prose is what people actually read.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AGENT_STAGE } from '../../runner/agent-registry';
import { CLI_FLAGS, EXIT_CODES, parseArgs } from '../../runner/cli';
import {
  CHECKPOINTS,
  LOOP_BACK_RULES,
  MAX_BUILDER_ATTEMPTS,
  MAX_VALIDATOR_ROUNDS
} from '../../feature/workflows/feature-factory-orchestrator';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SKILL_PATH = join(REPO_ROOT, 'factory', 'feature', 'SKILL.md');
const README_PATH = join(REPO_ROOT, 'README.md');
const AGENTS_DIR = join(REPO_ROOT, 'factory', 'feature', 'agents');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const ORCHESTRATOR_PATH = join(REPO_ROOT, 'factory', 'feature', 'workflows', 'feature-factory-orchestrator.ts');

const skill = readFileSync(SKILL_PATH, 'utf-8');
const readme = readFileSync(README_PATH, 'utf-8');

interface FactoryClaims {
  agents: string[];
  checkpoints: number[];
  loopBackRules: Array<{ situation: string; action: string; bound?: number }>;
  cliFlags: string[];
  exitCodes: Record<string, number>;
}

/**
 * Every `--flag` the prose names (not the `npm run factory --` separator, not `<!-- -->`). The
 * "Skill assignments" section is left out: its loading rule names other tools' flags (`rg --files`).
 */
function documentedFlags(text: string): string[] {
  const withoutSkillSection = prose(text).replace(/^## Skill assignments[\s\S]*?(?=^## )/m, '');
  return [...new Set([...withoutSkillSection.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map(m => m[1]))];
}

/**
 * Every `npm run factory -- …` command line SKILL.md shows, as argv: quoted words unquoted, and each
 * `<placeholder>` replaced by `1` — a valid run id, checkpoint, attempt count, path or text alike.
 */
function documentedCommands(text: string): string[][] {
  return [...text.matchAll(/npm run factory -- ([^\n`]+)/g)].map(m =>
    (m[1].trim().match(/"[^"]*"|\S+/g) ?? []).map(word => word.replace(/^"(.*)"$/, '$1').replace(/<[^>]+>/g, '1'))
  );
}

/** One valid command line per flag: the flag in a combination parseArgs accepts. */
const VALID_USE: Readonly<Record<string, string[]>> = {
  feature: ['--feature', 'add a health check'],
  name: ['--feature', 'add a health check', '--name', 'health'],
  cwd: ['--feature', 'add a health check', '--cwd', '/tmp/project'],
  model: ['--feature', 'add a health check', '--model', 'some-model'],
  yes: ['--feature', 'add a health check', '--yes'],
  resume: ['--resume', 'run-1'],
  approve: ['--resume', 'run-1', '--approve', '2'],
  reject: ['--resume', 'run-1', '--reject', '1', '--notes', 'the AC are vague'],
  notes: ['--resume', 'run-1', '--reject', '3', '--notes', 'the AC are vague'],
  'grant-attempts': ['--resume', 'run-1', '--grant-attempts', '1'],
  close: ['--close', 'run-1'],
  consolidate: ['--consolidate', 'run-1']
};

/** The JSON fenced block immediately after `<!-- factory-claims -->`. Throws if it is absent. */
function factoryClaims(text: string): FactoryClaims {
  const match = text.match(/<!-- factory-claims -->\s*```json\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error('SKILL.md has no <!-- factory-claims --> ```json block');
  return JSON.parse(match[1]) as FactoryClaims;
}

/** SKILL.md without its claims block: the prose people read. */
function prose(text: string): string {
  return text.replace(/<!-- factory-claims -->\s*```json\s*\n[\s\S]*?\n```/, '');
}

const ascending = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('doc drift: SKILL.md matches the code (AC-59, AC-60)', () => {
  const claims = factoryClaims(skill);

  test('AC-59 agent count equals AGENT_STAGE', () => {
    expect(claims.agents).toEqual(Object.keys(AGENT_STAGE));

    // The prose count ("an N-agent chain") is the same number, and no other count appears.
    const counts = [...prose(skill).matchAll(/\b(\d+)-agent\b/gi)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    expect(new Set(counts)).toEqual(new Set([Object.keys(AGENT_STAGE).length]));
  });

  test('AC-59 every listed agent file exists and is registered', () => {
    expect(claims.agents.length).toBeGreaterThan(0);
    for (const agent of claims.agents) {
      expect(existsSync(join(AGENTS_DIR, `${agent}.md`))).toBe(true);
      expect(Object.keys(AGENT_STAGE)).toContain(agent);
    }

    // Every NN-name agent file the prose lists is registered too.
    const listed = [...prose(skill).matchAll(/`(0\d-[a-z-]+)\.md`/g)].map(m => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const agent of listed) {
      expect(Object.keys(AGENT_STAGE)).toContain(agent);
      expect(existsSync(join(AGENTS_DIR, `${agent}.md`))).toBe(true);
    }
  });

  test('AC-59 CHECKPOINT entries equal CHECKPOINTS', () => {
    const ids = Object.values(CHECKPOINTS).map(c => c.id);

    expect(ascending(claims.checkpoints)).toEqual(ascending(ids));

    // Every "CHECKPOINT N" anywhere in SKILL.md names a checkpoint the program has, and every
    // checkpoint the program has is named.
    const inProse = new Set([...skill.matchAll(/CHECKPOINT (\d+)/g)].map(m => Number(m[1])));
    expect(inProse).toEqual(new Set(ids));
  });

  test('AC-59 loop-back rules equal LOOP_BACK_RULES', () => {
    expect(claims.loopBackRules).toEqual(JSON.parse(JSON.stringify(LOOP_BACK_RULES)));

    // The prose table says the same thing: | `SITUATION` | `ACTION` | bound |
    const rows = [...prose(skill).matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*`([A-Z_]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map(m => ({
      situation: m[1],
      action: m[2],
      bound: /^\d+$/.test(m[3]) ? Number(m[3]) : undefined
    }));
    expect(rows).toEqual(
      LOOP_BACK_RULES.map(r => ({ situation: r.situation, action: r.action, bound: r.bound }))
    );
  });

  test('AC-59 no SKILL.md or README text claims 100% certainty', () => {
    expect(skill).not.toMatch(/100% certainty/i);
    expect(readme).not.toMatch(/100% certainty/i);
  });

  test('AC-59 every skill assignment path maps to a skill in skills/', () => {
    const section = skill.split(/^## Skill assignments/im)[1]?.split(/^## /m)[0] ?? '';
    const paths = [...section.matchAll(/~\/\.claude\/skills\/software\/([\w./-]+?)`/g)].map(m => m[1]);

    expect(paths.length).toBeGreaterThan(0);
    for (const relative of paths) {
      expect({ path: relative, exists: existsSync(join(SKILLS_DIR, relative)) }).toEqual({
        path: relative,
        exists: true
      });
    }
  });

  test('AC-60 SKILL.md makes none of the retired claims', () => {
    const retired: Array<[string, RegExp]> = [
      ['the factory creates a PR', /\b(creates?|created|opens?|opening)\s+(a|the)\s+(PR|pull request)\b/i],
      ['the factory creates a PR', /\bPR\s+(is\s+)?(created|creation|opened)\b/i],
      ['branch cleanup [09]', /\[09\]/],
      ['branch cleanup [09]', /branch cleanup/i],
      ['builders log to memory', /\b(log|logs|logged|logging)\b[^.\n]{0,40}\bto memory\b/i],
      ['consolidator stores to memory', /\b(store|stores|stored|storing)\b[^.\n]{0,40}\b(to|in) memory\b/i],
      ['memory tool calls', /retrieve_context|store_memory|memorykit/i],
      ['frontend → backend API routing', /routes?\s+back\s+to\s+(the\s+)?Backend Builder/i],
      ['frontend → backend API routing', /API mismatch/i],
      ['"10-agent"', /\b10-agent\b/i],
      ['"All 7 agents"', /All 7 agents/i],
      ['"100% certainty"', /100% certainty/i],
      ['Gate 2 loops back to 06', /loops?\s+back\s+to\s+\[?06/i],
      ['Gate 2 loops back to 06', /Test Verifier\s+loops?\s+back/i],
      ['every Gate 2 evaluation is recorded (MINOR-13: a throwing audit records nothing)', /Every Gate 2 evaluation is recorded/i],
      ['dev fails on timeout (MINOR-13: for dev, the timeout is the pass condition)', /non-zero exit, timeout, or for dev/i],
      ['a Knowledge Stored criterion (AC-48: Stage 5 judges its two documents only)', /Knowledge Stored/],
      ['the run is waiting for a PR merge but does not wait (AC-44: there is no such log line)', /does not wait/i],
      ['there is no third checkpoint (AC-44: CHECKPOINT 3 approves the validated change)', /no third checkpoint/i],
      ['--resume starts again at Stage 1 (AC-34: a resume skips what state records as done)', /run starts again at Stage 1/],
      ['the old usage form --feature "…" --resume <featureId> (AC-37: --resume <id> alone; --feature is optional)', /--resume <featureId>/],
      ['the old usage form --feature "…" --resume <featureId> (AC-37: --resume <id> alone; --feature is optional)', /--feature\s+"[^"]*"\s+--resume\b/],
      ['the CLI refuses --resume of a run with completedAt (AC-35: an ESCALATED run is reopened)', /refuses `?--resume`? of a run that has a `?completedAt/i],
      ['decision and grant flags arrive later (AC-79: they exist)', /arrive with the CLI change later/i],
      ['--consolidate is still being added (AC-47: it exists)', /being added in PR A-2/i],
      ['a y/N checkpoint prompt (D-11: y / n / p)', /\[y\/N\]/],
      ['no TTY rejects the checkpoint (AC-77: it pauses, exit 3)', /no TTY[^.]*\b(is\s+rejected|rejects)\b/i]
    ];

    const found = retired.filter(([, pattern]) => pattern.test(skill)).map(([claim, pattern]) => `${claim}: ${pattern}`);
    expect(found).toEqual([]);
  });

  test('IMPORTANT-5 SKILL.md says No Regressions counts the tests that ran (passed + failed), not skipped/todo', () => {
    const noRegressions = prose(skill).split(/\n- \*\*/).find(item => item.startsWith('No Regressions:'));
    expect(noRegressions).toBeDefined();
    expect(noRegressions).toMatch(/passed \+ failed/);
    expect(noRegressions).toMatch(/skipped and todo tests do not count/i);
  });

  test('AC-60 SKILL.md states that Gate 2 and Test Verifier failures escalate in Phase A', () => {
    const statement = prose(skill)
      .split('\n')
      .find(line => /Phase A/.test(line) && /Gate 2/.test(line) && /Test Verifier/.test(line) && /escalate/i.test(line));
    expect(statement).toBeDefined();

    // ...and the structured claims agree: neither has a loop-back.
    const action = (situation: string) => claims.loopBackRules.find(r => r.situation === situation)?.action;
    expect(action('GATE_2_FAILS')).toBe('ESCALATE');
    expect(action('TEST_VERIFIER_FAILS')).toBe('ESCALATE');
  });
});

describe('doc drift: SKILL.md documents the CLI the parser accepts (AC-79)', () => {
  const claims = factoryClaims(skill);

  test('AC-79 SKILL.md documents --resume, --approve, --reject --notes, --close, --grant-attempts and --consolidate', () => {
    const flags = documentedFlags(skill);
    for (const flag of ['resume', 'approve', 'reject', 'notes', 'close', 'grant-attempts', 'consolidate']) {
      expect({ flag, documented: flags.includes(flag) }).toEqual({ flag, documented: true });
    }
    // --notes is documented as part of a rejection, the only place the parser accepts it.
    expect(prose(skill)).toMatch(/--reject\s+\S+\s+--notes\b/);
  });

  test('AC-79 every CLI flag named in SKILL.md is accepted by parseArgs', () => {
    const flags = documentedFlags(skill);
    expect(flags.length).toBeGreaterThan(0);

    for (const flag of flags) {
      // Named in the doc → the parser knows it, and it parses in a valid combination.
      expect({ flag, known: Object.prototype.hasOwnProperty.call(CLI_FLAGS, flag) }).toEqual({ flag, known: true });
      const argv = VALID_USE[flag];
      expect({ flag, hasValidUse: argv !== undefined }).toEqual({ flag, hasValidUse: true });
      expect(argv).toContain(`--${flag}`);
      expect(() => parseArgs(argv)).not.toThrow();
    }

    // Every command line the doc shows parses as written.
    const commands = documentedCommands(skill);
    expect(commands.length).toBeGreaterThan(0);
    for (const argv of commands) {
      expect({ argv, parsed: (() => { try { parseArgs(argv); return true; } catch (e) { return (e as Error).message; } })() })
        .toEqual({ argv, parsed: true });
    }

    // ...and the doc names every flag the parser has: none is undocumented.
    expect([...flags].sort()).toEqual(Object.keys(CLI_FLAGS).sort());
  });

  test('AC-79 the claims block lists exactly CLI_FLAGS and EXIT_CODES', () => {
    expect(claims.cliFlags).toEqual(Object.keys(CLI_FLAGS));
    expect(claims.exitCodes).toEqual({ ...EXIT_CODES });

    // The prose exit-code table says the same: | <code> | <NAME> | …
    const rows = [...prose(skill).matchAll(/^\|\s*(\d+)\s*\|\s*([A-Z_]+)\s*\|/gm)].map(m => [m[2], Number(m[1])]);
    expect(Object.fromEntries(rows)).toEqual({ ...EXIT_CODES });
  });

  test('carry-over README states no fixed test count', () => {
    // "152 tests" went stale within a PR. The README says how to run the suite, not how big it is.
    expect(readme).not.toMatch(/\b\d[\d,]*\s+(?:offline\s+|unit\s+)?tests\b/i);
  });

  test('AC-44 README does not say a run needs the Consolidator to succeed', () => {
    // SUCCESS = the Stage 4 gate passed and CHECKPOINT 3 was approved; the Consolidator runs later, on request.
    expect(readme).not.toMatch(/consolidator ran/i);
    expect(readme).toMatch(/CHECKPOINT 3/);
    expect(readme).toMatch(/--consolidate\b/);
  });
});

describe('the checkpoint definitions (D-11)', () => {
  test('D-11 CHECKPOINTS holds the story, brief and change checkpoints, numbered 1, 2 and 3', () => {
    expect(CHECKPOINTS.STORY).toEqual({ id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 });
    expect(CHECKPOINTS.BRIEF).toEqual({ id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 });
    expect(CHECKPOINTS.CHANGE).toEqual({ id: 3, name: 'CHECKPOINT 3: Approve the validated change', stage: 4 });
    expect(Object.keys(CHECKPOINTS)).toEqual(['STORY', 'BRIEF', 'CHANGE']);
    for (const def of Object.values(CHECKPOINTS)) {
      expect(def.name.startsWith(`CHECKPOINT ${def.id}:`)).toBe(true);
    }
  });

  test('D-11 the orchestrator calls checkpoints only through CHECKPOINTS', () => {
    const source = readFileSync(ORCHESTRATOR_PATH, 'utf-8');
    expect(source).not.toMatch(/checkpoint\(\s*['"`]CHECKPOINT/);
    expect(source).toMatch(/checkpoint\(CHECKPOINTS\.STORY\b/);
    expect(source).toMatch(/checkpoint\(CHECKPOINTS\.BRIEF\b/);
    expect(source).toMatch(/checkpoint\(CHECKPOINTS\.CHANGE\b/);
  });

  test('D-9 the documented bounds are the exported ones', () => {
    const bound = (situation: string) => LOOP_BACK_RULES.find(r => r.situation === situation)?.bound;
    expect(bound('BUILDER_TESTS_FAIL')).toBe(MAX_BUILDER_ATTEMPTS);
    expect(bound('VALIDATOR_CRITICAL_ROUTABLE')).toBe(MAX_VALIDATOR_ROUNDS);
  });
});
