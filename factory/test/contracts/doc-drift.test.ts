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
 *
 * PR B-1 (AC-111 to AC-115) widens the scope to every KEPT doc: SKILL.md, the README, the eight
 * pointers left where the archived docs used to be, docs/ROADMAP.md and ERROR_CATEGORIES.md. Their
 * relative links must resolve and none may make a retired claim (the README only above its skills
 * catalogue, which legitimately says "Before opening a PR").
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

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

/** Whitespace (newlines included) collapsed to single spaces: a claim wrapped across lines is still one claim. */
const collapsed = (text: string) => text.replace(/\s+/g, ' ');

/** Claims the code no longer makes. Each is forbidden in every kept doc (AC-60, AC-113). */
const RETIRED_CLAIMS: ReadonlyArray<[string, RegExp]> = [
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
  ['no TTY rejects the checkpoint (AC-77: it pauses, exit 3)', /no TTY[^.]*\b(is\s+rejected|rejects)\b/i],
  // PR B-1 (AC-113):
  ['the factory makes no commit (AC-45 revised: snapshots under refs/factory/<id>/)', /makes no[^.\n]{0,60}\bcommit/i],
  ['git is only asked to read (B-1 writes snapshots)', /only ever asked to read/i],
  ['PR review outside the program (CP3 is in it)', /PR review[^.\n]*outside the program/i]
];

/** README only (AC-114): the program runs Stages 1-4; Stage 5 runs only via --consolidate. */
const README_RETIRED_CLAIMS: ReadonlyArray<[string, RegExp]> = [['"five stages" (AC-114: Stages 1–4, Stage 5 only via --consolidate)', /five stages/i]];

/** The archive header every archived doc starts with (AC-112, D-16). */
const ARCHIVE_HEADER = 'historical — not maintained; see SKILL.md (factory/feature/SKILL.md)';

/** The eight docs PR B-1 archived: where each was, where it is now, and the types a reference pointer names. */
const ARCHIVED: ReadonlyArray<{ from: string; to: string; types: string[] }> = [
  ...['README', 'ORCHESTRATOR', 'QUICK_START', 'STAGE_GUIDE', 'ARCHITECTURE'].map(name => ({
    from: `factory/feature/docs/${name}.md`,
    to: `docs/archive/feature-docs/${name}.md`,
    types: [] as string[]
  })),
  {
    from: 'factory/feature/reference/STAGE_CONTRACTS.md',
    to: 'docs/archive/feature-reference/STAGE_CONTRACTS.md',
    types: ['factory/harness/stage-gates.ts']
  },
  {
    from: 'factory/feature/reference/STATE_TRACKING.md',
    to: 'docs/archive/feature-reference/STATE_TRACKING.md',
    types: ['factory/harness/state-tracker.ts', 'factory/harness/state-store.ts', 'factory/harness/run-lifecycle.ts']
  },
  {
    from: 'factory/feature/reference/OUTPUT_SCHEMAS.md',
    to: 'docs/archive/feature-reference/OUTPUT_SCHEMAS.md',
    types: ['factory/runner/output-schemas.ts', 'factory/harness/agent-output-schema.ts']
  }
];

/** Every doc that is kept and maintained, relative to the repo root (AC-113, I-17). */
const KEPT_DOCS: readonly string[] = [
  'factory/feature/SKILL.md',
  'README.md',
  ...ARCHIVED.map(doc => doc.from),
  'docs/ROADMAP.md',
  'factory/feature/reference/ERROR_CATEGORIES.md'
];

const readDoc = (relativePath: string) => readFileSync(join(REPO_ROOT, relativePath), 'utf-8');

/** The part of a kept doc the retired claims apply to: the README only above its skills catalogue. */
function claimText(relativePath: string): string {
  const text = readDoc(relativePath);
  return relativePath === 'README.md' ? text.split(/^## Skills\b/m)[0] : text;
}

/**
 * Every relative markdown link target in `text` (code blocks and inline code left out), resolved
 * against `fromDir`, without its #anchor. http(s), mailto and same-page anchors are skipped.
 */
function relativeLinks(text: string, fromDir: string): Array<{ link: string; target: string }> {
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...withoutCode.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)]
    .map(m => m[1])
    .filter(link => !/^(https?:|mailto:|#)/i.test(link))
    .map(link => ({ link, target: resolve(fromDir, decodeURI(link.split('#')[0])) }));
}

/** Paragraphs and list items, each with its whitespace collapsed. */
function blocks(text: string): string[] {
  return text
    .split(/\n\s*\n|\n(?=\s*[-*] |\s*\d+\. )/)
    .map(collapsed)
    .filter(block => block.trim().length > 0);
}

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

  test("AC-60 AC-113 no kept doc makes a retired claim, including the old 'makes no … commit' sentence", () => {
    // The new patterns catch the sentences PR B-1 retired (a pattern that matches nothing guards nothing).
    const retiredSentences = [
      'The factory makes no pull request, commit or push: what happens to an approved change is a human step outside the program.',
      'Git is only ever asked to read (`rev-parse`, `diff`, `ls-files`).',
      '(PR review: a human step outside the program)'
    ];
    for (const sentence of retiredSentences) {
      expect({ sentence, caught: RETIRED_CLAIMS.some(([, pattern]) => pattern.test(sentence)) }).toEqual({ sentence, caught: true });
    }

    const found = KEPT_DOCS.flatMap(doc => {
      const text = claimText(doc);
      const claims = doc === 'README.md' ? [...RETIRED_CLAIMS, ...README_RETIRED_CLAIMS] : RETIRED_CLAIMS;
      return claims
        .filter(([, pattern]) => pattern.test(text) || pattern.test(collapsed(text)))
        .map(([claim, pattern]) => `${doc}: ${claim}: ${pattern}`);
    });
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

describe('doc drift: PR B-1 docs (AC-91, AC-93, AC-111 to AC-115)', () => {
  test('AC-91 SKILL.md says related-only tests are instructed, not enforced, and Gate 2\'s full suite is the enforcement', () => {
    const statement = blocks(prose(skill)).find(
      block => /related/.test(block) && /not enforced/.test(block) && /Gate 2's full suite is the enforcement/.test(block)
    );
    expect(statement).toBeDefined();
    // ...and builders are told never to commit, push, switch branches or write under .git/ or .factory/.
    expect(collapsed(prose(skill))).toMatch(/never to commit, push, switch branches or write under `\.git\/` or `\.factory\/`/);
  });

  test('AC-93 SKILL.md says a process that calls setsid() escapes the process-group kill', () => {
    const statement = blocks(prose(skill)).find(block => block.includes('setsid()') && /escapes/.test(block));
    expect(statement).toBeDefined();
    expect(statement).toMatch(/process group/);
    expect(statement).toMatch(/always/);
  });

  test('AC-111 docs/ROADMAP.md holds Phases A–E, a row for every REFACTOR_PLAN phase (0a, 0b, 0c, 1, 1.5, 2, 3), and MINOR-3 as an accepted risk with the git ≥ 2.42 --attr-source trigger', () => {
    const roadmap = readDoc('docs/ROADMAP.md');

    for (const phase of ['A', 'B', 'C', 'D', 'E']) {
      expect({ phase, heading: new RegExp(`^#{2,3} Phase ${phase}\\b`, 'm').test(roadmap) }).toEqual({ phase, heading: true });
    }
    expect(roadmap).toMatch(/B → C → E/);

    const row = (id: string) => roadmap.split('\n').find(line => new RegExp(`^\\|\\s*${id.replace('.', '\\.')}\\s*\\|`).test(line));
    for (const id of ['0a', '0b', '0c', '1', '1.5', '2', '3']) {
      expect({ id, row: row(id) !== undefined }).toEqual({ id, row: true });
    }
    // Tier 1 and memory are not scheduled; the worktree parallelism is superseded (D-5: never a worktree).
    expect(row('2')).toMatch(/not scheduled in A–E/i);
    expect(row('3')).toMatch(/not scheduled in A–E/i);
    expect(row('3')).toMatch(/worktree[^|]*superseded|superseded[^|]*worktree/i);

    const risk = blocks(roadmap).find(block => block.includes('MINOR-3') && /filter driver/i.test(block));
    expect(risk).toBeDefined();
    expect(risk).toMatch(/accepted risk/i);
    expect(risk).toMatch(/minimum supported git ≥ 2\.42 \(`--attr-source`\)/);

    // CHECKPOINT 2 backlog addition: the snapshot refs accumulate and are never cleaned up yet.
    expect(blocks(roadmap).some(block => /refs\/factory\//.test(block) && /\.env/.test(block))).toBe(true);
    // REFACTOR_PLAN says it is superseded, on its first line.
    expect(readDoc('docs/REFACTOR_PLAN.md').split('\n')[0]).toBe('Superseded as the plan of record by [ROADMAP.md](ROADMAP.md).');
  });

  test.each(ARCHIVED.map(doc => [doc.from, doc] as const))(
    'AC-112 %s is archived with the historical header and a pointer to SKILL.md (and the types) stays at its path',
    (_name, doc) => {
      const archived = readDoc(doc.to);
      expect(archived.split('\n')[0]).toBe(ARCHIVE_HEADER);

      const pointer = readDoc(doc.from);
      expect(pointer.split('\n')[0]).toBe(`# ${doc.from.split('/').pop()} (moved)`);
      expect(pointer).not.toContain(ARCHIVE_HEADER);
      const targets = relativeLinks(pointer, dirname(join(REPO_ROOT, doc.from))).map(link => link.target);
      expect(targets).toContain(join(REPO_ROOT, doc.to));
      expect(targets).toContain(SKILL_PATH);
      expect(targets).toContain(README_PATH);
      for (const type of doc.types) expect(targets).toContain(join(REPO_ROOT, type));
      expect(KEPT_DOCS).toContain(doc.from);
    }
  );

  test('AC-113 every relative link in a kept doc resolves', () => {
    let checked = 0;
    const broken = KEPT_DOCS.flatMap(doc => {
      const links = relativeLinks(readDoc(doc), dirname(join(REPO_ROOT, doc)));
      checked += links.length;
      return links.filter(({ target }) => !existsSync(target)).map(({ link }) => `${doc}: ${link}`);
    });
    expect(broken).toEqual([]);
    expect(checked).toBeGreaterThan(KEPT_DOCS.length);
  });

  test('AC-114 README says Stages 1–4 with three checkpoints, Stage 5 only via --consolidate, never \'five stages\', and does not put PR review outside the program', () => {
    expect(readme).not.toMatch(/five stages/i);
    expect(readme).not.toMatch(/PR review[^.\n]*outside the program/i);
    expect(readme.split('\n').slice(0, 8).join('\n')).toMatch(/four stages and three human checkpoints, with eight specialist agents/);

    const section = readme.split(/^## The stages\s*$/m)[1]?.split(/^## /m)[0];
    expect(section).toBeDefined();
    for (const label of ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'CHECKPOINT 1', 'CHECKPOINT 2', 'CHECKPOINT 3', 'Gate 1.5', 'Gate 2']) {
      expect({ label, shown: section!.includes(label) }).toEqual({ label, shown: true });
    }
    const stage5 = section!.split('\n').find(line => line.includes('Stage 5'));
    expect(stage5).toMatch(/only via `?--consolidate <id>`? on a SUCCESS run/);
  });

  test('AC-115 SKILL.md documents PR B-1: version line, snapshots, the AC-45 sentence, instructed-not-enforced tests, Gate 2 fixes, .Factory, description refusals, MINOR-8, and the invisible-character rules', () => {
    const text = collapsed(skill);
    const required = [
      'Phase B, PR B-1',
      'refs/factory/<id>/stage3-<n>',
      'HEAD_MOVED',
      'SNAPSHOT_FAILED',
      'The factory never touches your branch, index or working tree, never pushes, and writes git objects only under `refs/factory/<id>/`.',
      'not enforced',
      'ambiguous test summary',
      'SKIPPED',
      'setsid()',
      '.Factory',
      'DESCRIPTION_MISMATCH',
      '\\u{XXXX}',
      'stored exactly as written',
      'escaped',
      '--close',
      // the shared set, the Gate 2 bound, the other refusals and the MINOR-8 inference
      'U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069 and U+FEFF',
      '65536',
      '196608',
      'FACTORY_DIR_CASE_CONFLICT',
      'DESCRIPTION_REQUIRED',
      'APPROVED_ARTIFACT_CHANGED',
      'is inferred'
    ];
    const missing = required.filter(phrase => !text.includes(phrase));
    expect(missing).toEqual([]);

    // The version line names this PR, not the last one.
    const intro = collapsed(skill.split('\n---')[0]);
    expect(intro).toMatch(/\(Phase B, PR B-1\)/);
    expect(intro).not.toMatch(/PR A-2/);
  });
});
