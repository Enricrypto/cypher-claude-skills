/**
 * I-13 live smoke check (S-1, PR A-2 brief §9) — OPERATOR-ONLY.
 *
 * The Validator's five security checks are tri-state (true / false / "not_applicable"), and the
 * output schema expresses that with `anyOf`. Nothing offline can prove the Agent SDK accepts that
 * schema, or that a real Validator ever returns the string branch. This script asks once:
 *
 *   1. it refuses a --cwd that is not empty (it writes a fixture there);
 *   2. it writes a tiny fixture project: package.json, src/greet.ts (a pure function: no auth, no
 *      SQL, no HTML, no secrets) and its test, and a run directory `.factory/smoke-validator/`
 *      holding USER_STORY.md, TECHNICAL_BRIEF.md and FILE_LIST.md. The brief declares the
 *      securitySurface below: auth, sqlDatabase and htmlRendering ABSENT; userInput and secrets
 *      PRESENT;
 *   3. it invokes ONLY 07-validator, through the production createSdkInvoker (so the real
 *      agentOutputSchema('07-validator') is the outputFormat), with the production validatorPrompt;
 *   4. it judges the answer with the harness's own validateOutputSchema and evaluateSecurityChecks.
 *
 * Pass criteria, each printed:
 *   P1  no AgentInvocationError; structured output came back (the SDK accepted the anyOf schema)
 *   P2  validateOutputSchema(4, '07-validator', output).valid
 *   P3  each of the 5 checks is exactly true, false or "not_applicable"
 *   P4  at least one check is "not_applicable" with a non-blank notApplicableReasons[check]
 *   P5  evaluateSecurityChecks(security, fixture surface) has no blocker for any "not_applicable" check
 *
 * Exit codes:
 *   0  PASS          P1-P5 hold: "I-13 PASS".
 *   1  FAIL          a criterion failed. If P1 failed on the schema, apply the A-1 §13 fallback shape
 *                    { type: ['boolean', 'string'], enum: [true, false, 'not_applicable'] } and re-run.
 *                    Also used when the script refuses to run (usage, non-empty --cwd): nothing was
 *                    invoked, and the message says so.
 *   2  INCONCLUSIVE  P1-P3 hold but no check came back "not_applicable". Re-run once on a fresh empty
 *                    directory; inconclusive twice → record "anyOf accepted, string branch unobserved".
 *
 * Usage (costs one Validator invocation — opus, at most 25 turns):
 *   mkdir -p /private/tmp/ff-smoke-validator
 *   npx ts-node factory/runner/smoke-validator.ts --cwd /private/tmp/ff-smoke-validator
 *
 * Never part of `npm test`, never run in CI, and imported by nothing: repo-hygiene.test.ts checks
 * that statically. It writes only inside --cwd.
 */

import { lstatSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { AgentInvocationError, createSdkInvoker } from './invoke-agent';
import { agentOutputSchema } from './output-schemas';
import { PromptContext, validatorPrompt } from '../harness/agent-prompts';
import { SECURITY_CHECKS, SecurityCheckName, SecuritySurfaceDeclaration, validateOutputSchema } from '../harness/agent-output-schema';
import { evaluateSecurityChecks } from '../harness/security-checks';

const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2 } as const;
type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The fixture's run directory, relative to --cwd. */
const ARTIFACT_DIR = '.factory/smoke-validator';

/** What the fixture's TECHNICAL_BRIEF.md declares, and what P5 judges "not_applicable" against. */
const FIXTURE_SURFACE: SecuritySurfaceDeclaration = {
  auth: 'ABSENT',
  userInput: 'PRESENT',
  secrets: 'PRESENT',
  sqlDatabase: 'ABSENT',
  htmlRendering: 'ABSENT',
  notes: 'A pure greeting function: it takes a name (user input) and returns a string. No auth boundary, no database, no rendered HTML.'
};

const FEATURE = 'add a greet(name) function that returns a greeting for a trimmed, non-blank name';

/** The fixture, path → content. Paths are relative to --cwd. */
function fixture(): Record<string, string> {
  return {
    'package.json': `${JSON.stringify(
      { name: 'ff-smoke-validator', version: '0.0.0', private: true, scripts: { test: 'node --test' } },
      null,
      2
    )}\n`,

    'src/greet.ts': [
      '/** A greeting for `name`. Pure: no I/O, no storage, no network, no HTML. */',
      'export function greet(name: string): string {',
      '  const trimmed = name.trim();',
      "  if (trimmed.length === 0) throw new RangeError('name must not be blank');",
      "  if (trimmed.length > 100) throw new RangeError('name must be at most 100 characters');",
      '  return `Hello, ${trimmed}!`;',
      '}',
      ''
    ].join('\n'),

    'src/greet.test.ts': [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './greet';",
      '',
      "test('AC-1 greets a trimmed name', () => assert.equal(greet('  Ada '), 'Hello, Ada!'));",
      "test('AC-2 refuses a blank name', () => assert.throws(() => greet('   '), RangeError));",
      "test('AC-3 refuses a name over 100 characters', () => assert.throws(() => greet('x'.repeat(101)), RangeError));",
      ''
    ].join('\n'),

    [`${ARTIFACT_DIR}/USER_STORY.md`]: [
      '# User Story: greet a person by name',
      '',
      'As a developer, I want a `greet(name)` function, so that every greeting in the app reads the same.',
      '',
      '## Acceptance criteria',
      '',
      '- **AC-1** Given the name "  Ada ", when greet is called, then it returns "Hello, Ada!".',
      '- **AC-2** Given a blank name, when greet is called, then it throws a RangeError.',
      '- **AC-3** Given a name longer than 100 characters, when greet is called, then it throws a RangeError.',
      ''
    ].join('\n'),

    [`${ARTIFACT_DIR}/TECHNICAL_BRIEF.md`]: [
      '# Technical Brief: greet(name)',
      '',
      '## Overview',
      'One pure function in `src/greet.ts`, with unit tests in `src/greet.test.ts`. No HTTP endpoint,',
      'no database, no UI, no configuration, no authentication.',
      '',
      '## Data model',
      'None.',
      '',
      '## API contract',
      '`greet(name: string): string`. Trims the name; throws RangeError when it is blank or over 100',
      'characters; otherwise returns `Hello, <name>!`.',
      '',
      '## Security surface',
      '```json',
      JSON.stringify({ securitySurface: FIXTURE_SURFACE }, null, 2),
      '```',
      '',
      '- auth ABSENT: no users, roles or sessions.',
      '- userInput PRESENT: `name` is caller-supplied and is validated (blank, length).',
      '- secrets PRESENT (declared conservatively): there must be no hard-coded credential.',
      '- sqlDatabase ABSENT: nothing is stored.',
      '- htmlRendering ABSENT: the result is a plain string; nothing is rendered as markup.',
      ''
    ].join('\n'),

    [`${ARTIFACT_DIR}/FILE_LIST.md`]: [
      '# File list',
      '',
      '| Path | Action | Why |',
      '|---|---|---|',
      '| `src/greet.ts` | CREATE | the function |',
      '| `src/greet.test.ts` | CREATE | AC-1..AC-3 |',
      ''
    ].join('\n')
  };
}

/** `--cwd <dir>` and nothing else. */
function parseCwd(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== '--cwd' || argv[1].trim() === '') {
    throw new Error('Usage: npx ts-node factory/runner/smoke-validator.ts --cwd <empty directory>');
  }
  return resolve(argv[1]);
}

/** Create `dir`, or accept it if it is an existing EMPTY real directory. Anything else is refused. */
function prepareEmptyDirectory(dir: string): void {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (!stat) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`--cwd ${dir} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a directory'}; refusing to write a fixture there.`);
  }
  const entries = readdirSync(dir);
  if (entries.length > 0) {
    throw new Error(`--cwd ${dir} is not empty (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}); refusing to write a fixture into it. Use a fresh empty directory.`);
  }
}

function writeFixture(project: string): void {
  for (const [path, content] of Object.entries(fixture())) {
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
}

/** The schema node for one security check, as sent to the SDK — printed so the run records what was tested. */
function findProperty(schema: unknown, key: string): unknown {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const record = schema as Record<string, unknown>;
  const properties = record.properties as Record<string, unknown> | undefined;
  if (properties && key in properties) return properties[key];
  for (const value of Object.values(record)) {
    const found = findProperty(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

interface Criterion {
  id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  holds: boolean;
  detail: string;
}

function print(criterion: Criterion): void {
  console.log(`${criterion.id} ${criterion.holds ? 'PASS' : 'FAIL'}  ${criterion.detail}`);
}

async function main(argv: string[]): Promise<ExitCode> {
  let project: string;
  try {
    project = parseCwd(argv);
    prepareEmptyDirectory(project);
  } catch (error) {
    console.error(`NOT RUN: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.FAIL;
  }

  writeFixture(project);
  console.log('=== I-13 LIVE SMOKE CHECK: 07-validator ===');
  console.log(`project: ${project}`);
  console.log(`fixture run directory: ${join(project, ARTIFACT_DIR)}`);
  console.log(`schema under test (authImplemented): ${JSON.stringify(findProperty(agentOutputSchema('07-validator'), 'authImplemented'))}\n`);

  const denials: string[] = [];
  const invoke = createSdkInvoker({
    cwd: project,
    log: message => console.log(message),
    onToolDenied: (agent, tool) => denials.push(`${agent} -> ${tool}`)
  });
  const ctx: PromptContext = { cwd: project, artifactDir: ARTIFACT_DIR, featureDescription: FEATURE };

  // P1: the SDK accepted the schema and returned structured output.
  const started = Date.now();
  let output: any;
  try {
    output = await invoke({ stage: 4, agent: '07-validator', prompt: validatorPrompt(ctx) });
  } catch (error) {
    const detail = error instanceof AgentInvocationError ? [error.message, ...error.detail].join(' | ') : String(error);
    print({ id: 'P1', holds: false, detail: `the invocation failed: ${detail}` });
    console.log('P2-P5 not evaluated.');
    console.log(
      `\nI-13 FAIL. If the failure is the outputFormat schema, apply the A-1 §13 fallback shape ` +
        `{ type: ['boolean', 'string'], enum: [true, false, 'not_applicable'] } and re-run on a fresh empty directory.`
    );
    return EXIT.FAIL;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const p1: Criterion = {
    id: 'P1',
    holds: typeof output === 'object' && output !== null,
    detail: `structured output returned in ${seconds}s`
  };

  // P2: the harness's own schema check.
  const validation = p1.holds ? validateOutputSchema(4, '07-validator', output) : { valid: false, errors: ['no structured output'] };
  const p2: Criterion = {
    id: 'P2',
    holds: validation.valid,
    detail: validation.valid ? 'validateOutputSchema accepted the output' : `schema errors: ${validation.errors.join('; ')}`
  };

  // P3: strict tri-state values.
  const security = p1.holds ? output.details?.security : undefined;
  const values = Object.fromEntries(SECURITY_CHECKS.map(check => [check, security?.[check]])) as Record<SecurityCheckName, unknown>;
  const invalid = SECURITY_CHECKS.filter(check => !(values[check] === true || values[check] === false || values[check] === 'not_applicable'));
  const p3: Criterion = {
    id: 'P3',
    holds: invalid.length === 0,
    detail: invalid.length === 0 ? `checks: ${JSON.stringify(values)}` : `not true/false/"not_applicable": ${invalid.map(c => `${c}=${JSON.stringify(values[c])}`).join(', ')}`
  };

  // P4: the string branch was used, with a reason.
  const notApplicable = SECURITY_CHECKS.filter(check => values[check] === 'not_applicable');
  const reasons: Partial<Record<SecurityCheckName, unknown>> = security?.notApplicableReasons ?? {};
  const reasoned = notApplicable.filter(check => typeof reasons[check] === 'string' && (reasons[check] as string).trim() !== '');
  const p4: Criterion = {
    id: 'P4',
    holds: reasoned.length > 0,
    detail:
      notApplicable.length === 0
        ? 'no check came back "not_applicable"'
        : `"not_applicable": ${notApplicable.join(', ')}; with a reason: ${reasoned.join(', ') || 'none'}`
  };

  // P5: every "not_applicable" is earned against the declared surface.
  const evaluation = evaluateSecurityChecks(security, FIXTURE_SURFACE);
  const naBlockers = evaluation.blockers.filter(blocker => notApplicable.some(check => blocker.startsWith(`${check}:`)));
  const p5: Criterion = {
    id: 'P5',
    holds: notApplicable.length > 0 && naBlockers.length === 0,
    detail:
      notApplicable.length === 0
        ? 'nothing to judge: no "not_applicable" check'
        : naBlockers.length === 0
          ? 'no blocker for any "not_applicable" check'
          : `blockers: ${naBlockers.join(' | ')}`
  };

  console.log('');
  for (const criterion of [p1, p2, p3, p4, p5]) print(criterion);
  console.log(`\nall security blockers (informational): ${evaluation.blockers.length === 0 ? 'none' : evaluation.blockers.join(' | ')}`);
  console.log(`status: ${String(output?.status)}; summary: ${String(output?.details?.summary ?? '').slice(0, 400)}`);
  console.log(`tool denials: ${denials.length === 0 ? 'none' : denials.join(', ')}`);

  if (!p1.holds || !p2.holds || !p3.holds) {
    console.log('\nI-13 FAIL.');
    return EXIT.FAIL;
  }
  if (notApplicable.length === 0) {
    console.log(
      '\nI-13 INCONCLUSIVE: the schema was accepted, but no check came back "not_applicable". Re-run once on a fresh ' +
        'empty directory; if it is inconclusive again, record "anyOf accepted, string branch unobserved".'
    );
    return EXIT.INCONCLUSIVE;
  }
  if (!p4.holds || !p5.holds) {
    console.log('\nI-13 FAIL.');
    return EXIT.FAIL;
  }
  console.log('\nI-13 PASS');
  return EXIT.PASS;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(`\nSMOKE CHECK CRASHED: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = EXIT.FAIL;
    }
  );
}
