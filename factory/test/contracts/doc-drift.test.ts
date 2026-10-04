/**
 * SKILL.md drift (D-10, D-11; AC-59, AC-60).
 *
 * SKILL.md is what a human reads to learn what the factory does. It used to describe a 10-agent
 * chain, a third checkpoint, a factory that opened PRs, builders that logged to memory and a
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
}

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
      ['dev fails on timeout (MINOR-13: for dev, the timeout is the pass condition)', /non-zero exit, timeout, or for dev/i]
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

describe('the checkpoint definitions (D-11)', () => {
  test('D-11 CHECKPOINTS holds the story and brief checkpoints, numbered 1 and 2', () => {
    expect(CHECKPOINTS.STORY).toEqual({ id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 });
    expect(CHECKPOINTS.BRIEF).toEqual({ id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 });
    for (const def of Object.values(CHECKPOINTS)) {
      expect(def.name.startsWith(`CHECKPOINT ${def.id}:`)).toBe(true);
    }
  });

  test('D-11 the orchestrator calls checkpoints only through CHECKPOINTS', () => {
    const source = readFileSync(ORCHESTRATOR_PATH, 'utf-8');
    expect(source).not.toMatch(/checkpoint\(\s*['"`]CHECKPOINT/);
    expect(source).toMatch(/checkpoint\(CHECKPOINTS\.STORY\b/);
    expect(source).toMatch(/checkpoint\(CHECKPOINTS\.BRIEF\b/);
  });

  test('D-9 the documented bounds are the exported ones', () => {
    const bound = (situation: string) => LOOP_BACK_RULES.find(r => r.situation === situation)?.bound;
    expect(bound('BUILDER_TESTS_FAIL')).toBe(MAX_BUILDER_ATTEMPTS);
    expect(bound('VALIDATOR_CRITICAL_ROUTABLE')).toBe(MAX_VALIDATOR_ROUNDS);
  });
});
