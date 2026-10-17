/**
 * ACCEPTANCE TESTS — Phase R, PR R-2 (R4, the scaled turn cap; R5, the brief-size warning).
 *
 * One test per acceptance criterion of the approved user story (AC-001 … AC-007), each named after
 * the criterion it proves, plus the choke-point assertion the house hygiene style asks for.
 * Numbering restarts at AC-001 for this PR, as PR R-1's and PR R-9's files did.
 *
 * These are deliberately OUTSIDE-IN. Where the criterion is about behaviour they drive whole runs
 * through `runFeatureFactory` (via the `runToEnd` fixture) with the REAL gates and no network, and
 * read the `maxTurns` each agent was actually invoked with off the scripted invoker's recorded
 * calls — not the module the builder happened to edit. Where the criterion is about a document of
 * record, the document IS the deliverable, so the test reads the shipped markdown.
 *
 * Every number is compared against an imported constant (`AGENT_COST`, `TURN_CEILING`,
 * `BRIEF_AC_LIMIT`, …) rather than re-stated, so the documents, the tests and the code cannot drift.
 */

import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

import {
  BRIEF_AC_LIMIT,
  BRIEF_FILE_LIMIT,
  TURN_ALLOWANCE_BASE,
  TURN_CEILING,
  TURN_SCALED_AGENTS,
  TURNS_PER_FILE,
  turnCap
} from '../../harness/brief-size';
import { AGENT_COST, FeatureFactoryAgent } from '../../runner/agent-registry';
import { AgentInvocation } from '../../runner/invoke-agent';
import { backend, frontend, spec, story, testVerifier } from '../fixtures/agent-outputs';
import {
  decisions,
  passingScript,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

/** A whole scripted run is a few seconds. */
const RUN_TIMEOUT_MS = 60_000;

/** The repository root, from `factory/test/acceptance/`. */
const ROOT = resolve(__dirname, '..', '..', '..');

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-accept-r2-');
});

afterEach(() => {
  project.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

const read = (repoRelative: string): string => readFileSync(join(ROOT, repoRelative), 'utf-8');

/**
 * The same text with every run of whitespace folded to one space. These documents are hard-wrapped
 * at ~100 columns, so a sentence a reader sees as one phrase is a literal with a newline in the
 * middle of it; `doc-drift.test.ts` reads SKILL.md this way for exactly this reason.
 */
const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

/** Directories no repository-wide scan descends into, matching the house convention. */
const NOT_SCANNED = new Set(
  ['node_modules', '.git', 'dist', 'coverage', '.factory', join('docs', 'factory-runs')].map(dir => join(ROOT, dir))
);

function repoFiles(dir: string = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return NOT_SCANNED.has(full) ? [] : repoFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

const textOf = (file: string): string => {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
};

/** `n` source paths the Stage 3 gate will look for, none of them a frontend path. */
const sourceFiles = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `src/unit-${String(i + 1).padStart(3, '0')}.ts`);

/**
 * A whole scripted run over an approved list of exactly `files.length` files, with `acCount`
 * acceptance criteria. The builders claim every file the brief lists, so the real Stage 3 gate
 * passes; `ui` brings the Frontend Builder in, since the brief's UI components are what invoke it.
 */
async function runOver({
  files,
  acCount = 3,
  ui = true
}: {
  files: string[];
  acCount?: number;
  ui?: boolean;
}): Promise<{ calls: AgentInvocation[]; requests: ReturnType<typeof decisions>['requests']; state: any }> {
  const invoker = scriptedInvoker(
    {
      ...passingScript(),
      '02-story-writer': story({ acCount }),
      '03-spec-writer': spec({ files, ui }),
      '04-backend-builder': backend({ files }),
      ...(ui ? { '05-frontend-builder': frontend() } : {}),
      // The Stage 4 gate compares the Test Verifier's total against the APPROVED story's count.
      '06-test-verifier': testVerifier({ totalAC: acCount })
    },
    { cwd: project.dir }
  );
  const approver = decisions();

  const state = await runToEnd({
    cwd: project.dir,
    invoke: invoker.invoke,
    approveCheckpoint: approver.approve
  });

  return { calls: invoker.calls, requests: approver.requests, state };
}

/** The `maxTurns` each call of `agent` carried, in order. `undefined` means the call carried none. */
const capsFor = (calls: AgentInvocation[], agent: string): Array<number | undefined> =>
  calls.filter(call => call.agent === agent).map(call => call.maxTurns);

/** Did any call of `agent` carry a call-level `maxTurns` key at all? */
const anyCapKey = (calls: AgentInvocation[], agent: string): boolean =>
  calls.filter(call => call.agent === agent).some(call => Object.prototype.hasOwnProperty.call(call, 'maxTurns'));

/** The four agents R4 scales, as names. */
const SCALED = [...TURN_SCALED_AGENTS];

/** The agents R4 leaves on their base. */
const UNSCALED: FeatureFactoryAgent[] = [
  '01-researcher',
  '02-story-writer',
  '03-spec-writer',
  '07b-validator-followup',
  '07c-validator-skeptic',
  '08-feature-consolidator'
];

/** `AGENT_COST` exactly as PR R-9 left it: the named boundary of this PR's scope. */
const AGENT_COST_AT_R9 = {
  '01-researcher': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
  '02-story-writer': { model: 'claude-sonnet-5', effort: 'medium', maxTurns: 30 },
  '03-spec-writer': { model: 'claude-opus-5', effort: 'high', maxTurns: 60 },
  '04-backend-builder': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
  '05-frontend-builder': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
  '06-test-verifier': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 },
  '07-validator': { model: 'claude-opus-5', effort: 'high', maxTurns: 50 },
  '07b-validator-followup': { model: 'claude-opus-5', effort: 'high', maxTurns: 40 },
  '07c-validator-skeptic': { model: 'claude-opus-5', effort: 'high', maxTurns: 30 },
  '08-feature-consolidator': { model: 'claude-haiku-4-5-20251001', effort: 'low', maxTurns: 15 }
} as const;

/** The R5 findings a run recorded, by their message. */
const sizeFindings = (state: any): string[] =>
  (state.importantFindings ?? [])
    .map((finding: { message: string }) => finding.message)
    .filter((message: string) => message.includes('Brief Size Within Limits'));

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-001 — a large approved list raises the cap to 40 + 2 × files
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-001 the four scaled agents are invoked with 40 + 2 × files when that exceeds their base', () => {
  it(
    'AC-001 a run over a 31-file list invokes 04, 05, 06 and 07 with maxTurns 102, and AGENT_COST is unchanged',
    async () => {
      const files = sourceFiles(31);

      const { calls, state } = await runOver({ files });

      expect(state.completionStatus).toBe('SUCCESS');

      // 40 + 2 × 31 = 102, computed fresh at invocation time from the approved list.
      const expected = TURN_ALLOWANCE_BASE + TURNS_PER_FILE * files.length;
      expect(expected).toBe(102);

      for (const agent of SCALED) {
        const caps = capsFor(calls, agent);
        expect({ agent, invoked: caps.length > 0 }).toEqual({ agent, invoked: true });
        expect({ agent, caps }).toEqual({ agent, caps: caps.map(() => expected) });
        // And it really is ABOVE that agent's stored base, or the criterion proves nothing.
        expect({ agent, above: expected > AGENT_COST[agent].maxTurns }).toEqual({ agent, above: true });
      }

      // The table is read-only input to the computation: nothing wrote back to it.
      expect(AGENT_COST).toEqual(AGENT_COST_AT_R9);
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-002 — a small approved list keeps the base, never the smaller formula result
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-002 a small file list leaves each scaled agent on its own base', () => {
  it(
    'AC-002 a run over a 5-file list invokes 04, 05, 06 and 07 with their AGENT_COST base',
    async () => {
      const files = sourceFiles(5);

      const { calls, state } = await runOver({ files });

      expect(state.completionStatus).toBe('SUCCESS');

      // 40 + 2 × 5 = 50, which is below every current base: the `max` is what keeps the base.
      const formula = TURN_ALLOWANCE_BASE + TURNS_PER_FILE * files.length;
      expect(formula).toBe(50);

      for (const agent of SCALED) {
        const base = AGENT_COST[agent].maxTurns;
        const caps = capsFor(calls, agent);
        expect({ agent, invoked: caps.length > 0 }).toEqual({ agent, invoked: true });
        expect({ agent, caps }).toEqual({ agent, caps: caps.map(() => base) });
      }

      // The builders and the Test Verifier keep 80 and the Validator 50 — the ordering the
      // registry sets deliberately, which a base-blind formula would have flattened.
      expect(capsFor(calls, '04-backend-builder')[0]).toBe(80);
      expect(capsFor(calls, '07-validator')[0]).toBe(50);
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-003 — the result is capped at 150 and never exceeds it
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-003 the cap is 150, whatever the base or the file count', () => {
  it(
    'AC-003 a run over a 60-file list invokes the four scaled agents with exactly 150',
    async () => {
      const files = sourceFiles(60);

      const { calls, state } = await runOver({ files });

      expect(state.completionStatus).toBe('SUCCESS');

      // 40 + 2 × 60 = 160, which the ceiling lowers.
      expect(TURN_ALLOWANCE_BASE + TURNS_PER_FILE * files.length).toBeGreaterThan(TURN_CEILING);

      for (const agent of SCALED) {
        const caps = capsFor(calls, agent);
        expect({ agent, invoked: caps.length > 0 }).toEqual({ agent, invoked: true });
        expect({ agent, caps }).toEqual({ agent, caps: caps.map(() => TURN_CEILING) });
      }
      // Nothing anywhere in the run went above it.
      expect(calls.filter(call => (call.maxTurns ?? 0) > TURN_CEILING)).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-003 the `min` is applied to the RESULT, so a base above 150 would be lowered too', () => {
    // No base is above 150 today (the highest is 80), so this branch is proved by the formula
    // itself rather than by mutating the registry — the decision asked for min-after-max, literally.
    expect(turnCap(200, 0)).toBe(TURN_CEILING);
    expect(Math.max(...Object.values(AGENT_COST).map(cost => cost.maxTurns))).toBeLessThan(TURN_CEILING);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-004 — an agent with no approved file list keeps its base, and no AGENT_COST value moved
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-004 every other agent is invoked with no call-level cap at all', () => {
  it(
    'AC-004 01, 02 and 03 carry no maxTurns key on any of the three runs, so the invoker uses their base',
    async () => {
      for (const files of [sourceFiles(5), sourceFiles(31), sourceFiles(60)]) {
        const { calls } = await runOver({ files });

        for (const agent of UNSCALED) {
          const invoked = calls.some(call => call.agent === agent);
          // 07b, 07c and 08 do not run in a clean scripted run; where they do, the rule is the same.
          if (!invoked) continue;
          expect({ files: files.length, agent, key: anyCapKey(calls, agent) }).toEqual({
            files: files.length,
            agent,
            key: false
          });
        }

        // The three the criterion names really were invoked, so "no key" is not vacuous.
        for (const agent of ['01-researcher', '02-story-writer', '03-spec-writer'] as const) {
          expect({ agent, invoked: calls.some(call => call.agent === agent) }).toEqual({ agent, invoked: true });
          expect({ agent, key: anyCapKey(calls, agent) }).toEqual({ agent, key: false });
        }
      }
    },
    RUN_TIMEOUT_MS * 3
  );

  it('AC-004 AGENT_COST deep-equals its PR R-9 values: R4 computes over the table, never on it', () => {
    expect(AGENT_COST).toEqual(AGENT_COST_AT_R9);

    // And the scaled set is exactly the four the decision names a base for: scaling 07b (40),
    // 07c (30) or 08 (15) would give them the Validator's cap on any brief over 5 files.
    expect(SCALED).toEqual(['04-backend-builder', '05-frontend-builder', '06-test-verifier', '07-validator']);
    expect(UNSCALED.filter(agent => (TURN_SCALED_AGENTS as readonly string[]).includes(agent))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-005 — an oversized brief records ONE IMPORTANT finding, and the stage still advances
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-005 a brief over either limit warns at CHECKPOINT 2 without ever blocking it', () => {
  it(
    'AC-005 a run with 13 acceptance criteria records one finding suggesting a split, is approvable at CHECKPOINT 2, and shows it at CHECKPOINT 3',
    async () => {
      const acCount = BRIEF_AC_LIMIT + 1;

      const { requests, state } = await runOver({ files: sourceFiles(5), acCount });

      // The stage advanced, the checkpoint was asked, and the run finished.
      expect(state.completionStatus).toBe('SUCCESS');
      expect(state.escalations ?? []).toEqual([]);
      expect(requests.map(request => request.id)).toContain(2);

      // Exactly one finding, naming the count and suggesting a split.
      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain(`${acCount} acceptance criteria`);
      expect(findings[0]).toMatch(/split/i);
      expect(findings[0]).toContain(`[Stage 2] Brief Size Within Limits: `);

      // CHECKPOINT 3 is where the run's findings are presented to the human.
      const cp3 = requests.find(request => request.id === 3);
      expect(cp3).toBeDefined();
      expect(cp3!.text).toContain('Brief Size Within Limits');
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-005 a run with 31 files records the same single finding, from the file clause',
    async () => {
      const files = sourceFiles(BRIEF_FILE_LIMIT + 1);

      const { requests, state } = await runOver({ files });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(requests.map(request => request.id)).toContain(2);

      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain(`${files.length} files`);
      expect(findings[0]).toMatch(/split/i);
      // Only the file clause applies: the story has the default three criteria.
      expect(findings[0]).not.toMatch(/acceptance criteria/);
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-006 — 12 and 30 are the limits, not the threshold for a warning
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-006 a brief at exactly the limits records no R5 finding', () => {
  it(
    'AC-006 a run with exactly 12 acceptance criteria and exactly 30 files warns about neither',
    async () => {
      const { state } = await runOver({ files: sourceFiles(BRIEF_FILE_LIMIT), acCount: BRIEF_AC_LIMIT });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(sizeFindings(state)).toEqual([]);
      // Nothing anywhere in the run mentioned a split.
      expect(
        (state.importantFindings ?? []).filter((finding: { message: string }) => /suggest splitting/.test(finding.message))
      ).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-007 — the documents of record and the pinned claims move in this same change
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-007 SKILL.md, doc-drift and the ROADMAP move with the code, and R-9 keeps its AGENT_COST pin', () => {
  it('AC-007 SKILL.md names this PR and states the R4 formula and the R5 warning', () => {
    const skill = read('factory/feature/SKILL.md');
    const intro = skill.split('\n---')[0];

    // The version line names this PR, and the retired one is gone from the intro.
    expect(intro).toContain('(Phase R, PR R-2)');
    expect(intro).not.toContain('PR R-9');

    // Read collapsed: the document is hard-wrapped and these claims span its line breaks.
    const text = collapsed(skill);
    expect(text).toContain('maxTurns = min(150, max(base, 40 + 2 × files))');
    expect(text).toContain('Brief Size Within Limits');
    // Each number the behaviour depends on is readable in the prose.
    for (const number of [BRIEF_AC_LIMIT, BRIEF_FILE_LIMIT, TURN_CEILING]) {
      expect({ number, stated: text.includes(String(number)) }).toEqual({ number, stated: true });
    }
    // The gates table's Stage 2 IMPORTANT cell lists both IMPORTANT criteria the gate really has.
    const stage2Row = skill.split('\n').find(line => /^\|\s*2 Plan\s*\|/.test(line));
    expect(stage2Row).toBeDefined();
    expect(stage2Row).toContain('Brief Size Within Limits');
    expect(stage2Row).toContain('Effort Labels Declared');
  });

  it('AC-007 doc-drift pins this PR\'s version line and claim literals', () => {
    const docDrift = read('factory/test/contracts/doc-drift.test.ts');

    expect(docDrift).toContain("'Phase R, PR R-2'");
    expect(docDrift).toContain('/\\(Phase R, PR R-2\\)/');
    expect(docDrift).not.toContain("'Phase R, PR R-9'");
    expect(docDrift).toContain("'Brief Size Within Limits'");
    // R-1's and R-9's content literals stay: SKILL.md still makes those claims.
    for (const literal of ['CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'Effort Labels Declared', 'briefItems']) {
      expect({ literal, pinned: docDrift.includes(`'${literal}'`) }).toEqual({ literal, pinned: true });
    }
  });

  it('AC-007 the ROADMAP shows R-2 done and R-3 next', () => {
    const roadmap = read('docs/ROADMAP.md');

    expect(roadmap).toMatch(/- \*\*R-2 \(done[^)]*\):\*\*/);
    expect(roadmap).toContain('- **R-3 (next):**');
    expect(roadmap).not.toContain('- **R-2 (next):**');
  });

  it('AC-007 PR R-9\'s acceptance file retired exactly its three superseded assertions and kept its AGENT_COST pin', () => {
    const r9 = read('factory/test/acceptance/phase-r-pr-r9.test.ts');

    // The three this PR invalidates are gone...
    expect(r9).not.toContain("toContain('(Phase R, PR R-9)')");
    expect(r9).not.toContain('"\'Phase R, PR R-9\'"');
    expect(r9).not.toContain("toContain('- **R-2 (next):**')");
    // ...and each is replaced by a retirement note, the way R-9 left one in R-1's file.
    expect(collapsed(r9)).toMatch(/retired by PR R-2/);

    // Everything else stays, the AGENT_COST pin above all: it is still there, and still true.
    expect(r9).toContain("expect(AGENT_COST).toEqual({");
    expect(r9).toContain("'08-feature-consolidator': { model: 'claude-haiku-4-5-20251001', effort: 'low', maxTurns: 15 }");
    // Line 563's claim is still true, so it stays.
    expect(r9).toContain("expect(intro).not.toContain('PR R-1')");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A8 — the choke point: one computation site, and CHECKPOINT 2's text cannot have moved
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('A8 one computation site, and nothing reached the checkpoint presentation', () => {
  /** Every non-test TypeScript source file, excluding the module that defines the helper. */
  const sourceModules = (): string[] =>
    repoFiles()
      .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
      .filter(file => !file.includes(`${join('factory', 'test')}`) && file !== __filename)
      .filter(file => file !== join(ROOT, 'factory', 'harness', 'brief-size.ts'));

  it('A8 scaledMaxTurns is referenced by exactly one non-test source file: the orchestrator', () => {
    const scanned = sourceModules();
    // The scan must actually be looking at something, or "exactly one" would prove nothing.
    expect(scanned.length).toBeGreaterThan(20);

    const callers = scanned.filter(file => textOf(file).includes('scaledMaxTurns')).map(file => relative(ROOT, file));

    expect(callers).toEqual(['factory/feature/workflows/feature-factory-orchestrator.ts']);
  });

  it('A8 checkpoint-presentation.ts mentions none of the new names, so CHECKPOINT 2 hashes the same text', () => {
    const presentation = read('factory/harness/checkpoint-presentation.ts');

    // Adding anything to CP2's presentation would refuse every run paused under the previous
    // version with ARTIFACT_CHANGED, because an approval binds to the SHA-256 of what was shown.
    for (const token of [
      'maxTurns',
      'scaledMaxTurns',
      'turnCap',
      'briefFileCount',
      'briefSizeWarning',
      'brief-size',
      'Brief Size Within Limits',
      'BRIEF_AC_LIMIT',
      'BRIEF_FILE_LIMIT',
      'TURN_CEILING'
    ]) {
      expect({ token, inPresentation: presentation.includes(token) }).toEqual({ token, inPresentation: false });
    }
  });
});
