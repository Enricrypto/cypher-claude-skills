/**
 * TEST VERIFIER acceptance tests — Phase R, PR R-2 (R4, the scaled turn cap; R5, the brief-size
 * warning).
 *
 * This file is the Test Verifier's INDEPENDENT proof that the shipped code satisfies the approved
 * user story. It is deliberately not a copy of `phase-r-pr-r2.test.ts`, which the Backend Builder
 * wrote as part of brief item 8, and it differs from it in three ways on purpose:
 *
 *  1. **Every number is a literal taken from the approved story, never an imported constant.** The
 *     builder's file asserts `caps === TURN_CEILING`; this one asserts `caps === 150`. If a
 *     constant in `brief-size.ts` were edited, the builder's assertions would follow it and still
 *     pass — these would fail, which is the point of an outside-in test.
 *  2. **It follows the number all the way to the SDK.** A recorded invocation is replayed through
 *     the REAL `createSdkInvoker` against a fake `query`, so each criterion is proved at the
 *     boundary where the cap actually takes effect (`options.maxTurns`), not only at the call the
 *     orchestrator built.
 *  3. **It covers the story's in-scope edge cases outside-in:** DELETE entries counting toward the
 *     file count, the exact-ceiling file count, both R5 clauses in one finding, and a resume
 *     computing the same cap.
 *
 * One `describe` per acceptance criterion, named after the criterion it proves. No network, no
 * token: whole runs go through `runToEnd` with the real gates and a scripted invoker.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { createSdkInvoker } from '../../runner/invoke-agent';
import type { AgentInvocation } from '../../runner/invoke-agent';
import { AGENT_COST } from '../../runner/agent-registry';
import { backend, followup, frontend, spec, story, testVerifier } from '../fixtures/agent-outputs';
import { fakeChangeTracker } from '../fixtures/changes';
import {
  decisions,
  onDisk,
  passingScript,
  runToEnd,
  scriptedInvoker,
  tempProject,
  TempProject
} from '../fixtures/harness-run';

/** A whole scripted run is a few hundred milliseconds; three of them still fit comfortably. */
const RUN_TIMEOUT_MS = 60_000;

/** The repository root, from `factory/test/acceptance/`. */
const ROOT = resolve(__dirname, '..', '..', '..');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A fake Agent SDK, so a recorded invocation can be replayed to the boundary where the cap acts
// ─────────────────────────────────────────────────────────────────────────────────────────────

type QueryCall = { prompt: string; options: Record<string, unknown> };

const queryCalls: QueryCall[] = [];

function mockQuery(call: QueryCall): AsyncIterable<unknown> {
  queryCalls.push(call);
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      permission_denials: [],
      structured_output: { status: 'PASS' },
      result: '',
      num_turns: 1,
      total_cost_usd: 0
    };
  })();
}

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }));

/** The `maxTurns` the SDK is really asked for when `call` is invoked through the real invoker. */
async function sdkMaxTurnsFor(call: AgentInvocation): Promise<unknown> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  // If the mock ever stopped applying, this fails before the real SDK could be reached.
  expect(sdk.query).toBe(mockQuery);

  queryCalls.length = 0;
  await createSdkInvoker({ cwd: '/project' })(call);
  expect(queryCalls).toHaveLength(1);
  return queryCalls[0].options.maxTurns;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The story's own numbers, written out. Nothing here is imported from the code under test.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `AGENT_COST` exactly as PR R-9 left it. AC-001 and AC-004 both require it to be untouched. */
const BASE_AT_R9 = {
  '01-researcher': 80,
  '02-story-writer': 30,
  '03-spec-writer': 60,
  '04-backend-builder': 80,
  '05-frontend-builder': 80,
  '06-test-verifier': 80,
  '07-validator': 50,
  '07b-validator-followup': 40,
  '07c-validator-skeptic': 30,
  '08-feature-consolidator': 15
} as const;

/** The four agents the story scales, with the base each one must fall back to. */
const SCALED_BASE = {
  '04-backend-builder': 80,
  '05-frontend-builder': 80,
  '06-test-verifier': 80,
  '07-validator': 50
} as const;

type ScaledAgent = keyof typeof SCALED_BASE;

const SCALED = Object.keys(SCALED_BASE) as ScaledAgent[];

/** R4, written out by hand from the approved story rather than imported. */
const storyFormula = (base: number, files: number): number => Math.min(150, Math.max(base, 40 + 2 * files));

let project: TempProject;

beforeEach(() => {
  project = tempProject('ff-verify-r2-');
  queryCalls.length = 0;
});

afterEach(() => {
  project.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Driving a whole run
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `n` backend source paths the real Stage 3 gate will look for, none of them a frontend path. */
const listOf = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `src/item-${String(i + 1).padStart(3, '0')}.ts`);

type RunResult = {
  calls: AgentInvocation[];
  requests: ReturnType<typeof decisions>['requests'];
  state: any;
};

/**
 * One whole scripted run over an approved list of exactly `files.length` entries and a story with
 * `acCount` acceptance criteria. `deletes` turns the last `deletes` entries of the approved list
 * into DELETE entries without touching the shared fixture, which the brief forbids changing.
 */
async function wholeRun({
  files,
  acCount = 3,
  deletes = 0,
  pauseAtCheckpoint2 = false
}: {
  files: string[];
  acCount?: number;
  deletes?: number;
  pauseAtCheckpoint2?: boolean;
}): Promise<RunResult> {
  const brief = spec({ files, ui: true });
  const entries = brief.details.fileList;
  const withDeletes = {
    ...brief,
    details: {
      ...brief.details,
      fileList: entries.map((entry, index) =>
        index >= entries.length - deletes ? { ...entry, type: 'DELETE' as const } : entry
      )
    }
  };

  const invoker = scriptedInvoker(
    {
      ...passingScript(),
      '02-story-writer': story({ acCount }),
      '03-spec-writer': withDeletes,
      '04-backend-builder': backend({ files }),
      '05-frontend-builder': frontend(),
      // The Stage 4 gate compares the Test Verifier's total with the approved story's count.
      '06-test-verifier': testVerifier({ totalAC: acCount })
    },
    { cwd: project.dir }
  );
  const approver = pauseAtCheckpoint2 ? decisions(true, { decision: 'PAUSE' }) : decisions();

  const state = await runToEnd({
    cwd: project.dir,
    invoke: invoker.invoke,
    approveCheckpoint: approver.approve
  });

  return { calls: invoker.calls, requests: approver.requests, state };
}

/** The `maxTurns` every call of `agent` carried, in order. `undefined` means it carried none. */
const capsFor = (calls: AgentInvocation[], agent: string): Array<number | undefined> =>
  calls.filter(call => call.agent === agent).map(call => call.maxTurns);

/** The one call of `agent` the orchestrator built, for replaying through the real invoker. */
const firstCallTo = (calls: AgentInvocation[], agent: string): AgentInvocation => {
  const call = calls.find(entry => entry.agent === agent);
  if (!call) throw new Error(`${agent} was never invoked, so the criterion would prove nothing`);
  return call;
};

/** The R5 findings a run recorded, by message. */
const sizeFindings = (state: any): string[] =>
  (state.importantFindings ?? [])
    .map((finding: { message: string }) => finding.message)
    .filter((message: string) => message.includes('Brief Size Within Limits'));

const read = (repoRelative: string): string => readFileSync(join(ROOT, repoRelative), 'utf-8');

/** The same text with every run of whitespace folded to one space: these documents are hard-wrapped. */
const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-001 — 40 + 2 × files, when that exceeds the base and stays under the ceiling
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-001 a large approved list raises the cap to 40 + 2 × files', () => {
  it(
    'AC-001 a 31-entry list invokes each of the four scaled agents with 102, which is what the SDK is asked for',
    async () => {
      const { calls, state } = await wholeRun({ files: listOf(31) });

      expect(state.completionStatus).toBe('SUCCESS');

      for (const agent of SCALED) {
        // 40 + 2 × 31 = 102, written out, and genuinely above every one of the four bases.
        expect({ agent, caps: capsFor(calls, agent) }).toEqual({
          agent,
          caps: capsFor(calls, agent).map(() => 102)
        });
        expect({ agent, invocations: capsFor(calls, agent).length > 0 }).toEqual({ agent, invocations: true });
        expect({ agent, above: 102 > SCALED_BASE[agent] }).toEqual({ agent, above: true });

        // And the number really is what the SDK is asked to allow, not just what the call carried.
        expect({ agent, sdk: await sdkMaxTurnsFor(firstCallTo(calls, agent)) }).toEqual({ agent, sdk: 102 });
      }

      // Computed over the table, never written back to it.
      for (const [agent, base] of Object.entries(BASE_AT_R9)) {
        expect({ agent, base: AGENT_COST[agent as keyof typeof BASE_AT_R9].maxTurns }).toEqual({ agent, base });
      }
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-001 a DELETE entry counts toward the file count: 25 CREATE + 6 DELETE is still 102',
    async () => {
      const { calls, state } = await wholeRun({ files: listOf(31), deletes: 6 });

      expect(state.completionStatus).toBe('SUCCESS');

      // Had DELETE entries been dropped (as metadata.expectedFiles drops them) the count would be
      // 25 and the cap 90, not 102 — which is exactly the under-count the story rules out.
      expect(40 + 2 * 25).toBe(90);
      for (const agent of SCALED) {
        expect({ agent, caps: capsFor(calls, agent) }).toEqual({
          agent,
          caps: capsFor(calls, agent).map(() => 102)
        });
      }
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-001 a resumed run computes the same cap: the number is a function of the approved list, not of the attempt',
    async () => {
      const files = listOf(31);

      const paused = await wholeRun({ files, pauseAtCheckpoint2: true });
      expect(paused.state.status).toBe('PAUSED');
      expect(paused.state.pendingCheckpoint?.checkpointId).toBe(2);
      // Nothing past CHECKPOINT 2 ran yet, so the builders' caps cannot have been recorded.
      expect(capsFor(paused.calls, '04-backend-builder')).toEqual([]);

      const resumedInvoker = scriptedInvoker(
        {
          ...passingScript(),
          '02-story-writer': story({ acCount: 3 }),
          '03-spec-writer': spec({ files, ui: true }),
          '04-backend-builder': backend({ files }),
          '05-frontend-builder': frontend(),
          '06-test-verifier': testVerifier({ totalAC: 3 })
        },
        { cwd: project.dir }
      );
      const state = await runToEnd({
        cwd: project.dir,
        invoke: resumedInvoker.invoke,
        resumeFromState: onDisk(project.dir)!,
        // The operator's `--resume <id> --approve 2`: a plain continue of a PAUSED run changes
        // nothing (D-3), so the approval of the paused checkpoint is what reopens the run.
        resume: { action: { kind: 'approve', checkpoint: 2 } },
        approveCheckpoint: decisions().approve
      });

      expect(state.completionStatus).toBe('SUCCESS');
      for (const agent of SCALED) {
        const caps = capsFor(resumedInvoker.calls, agent);
        expect({ agent, invoked: caps.length > 0 }).toEqual({ agent, invoked: true });
        expect({ agent, caps }).toEqual({ agent, caps: caps.map(() => 102) });
      }
    },
    RUN_TIMEOUT_MS * 2
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-002 — a small list keeps the base, never the smaller formula result
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-002 a small approved list leaves each scaled agent on its own base', () => {
  it(
    'AC-002 a 3-entry list invokes the builders and the Test Verifier with 80 and the Validator with 50',
    async () => {
      // 40 + 2 × 3 = 46, which is strictly below all four bases — 50 included, so the Validator
      // distinguishes "the base" from "the formula" here, which a 5-file list could not (both 50).
      expect(40 + 2 * 3).toBe(46);

      const { calls, state } = await wholeRun({ files: listOf(3) });

      expect(state.completionStatus).toBe('SUCCESS');

      for (const agent of SCALED) {
        const base = SCALED_BASE[agent];
        expect({ agent, caps: capsFor(calls, agent) }).toEqual({
          agent,
          caps: capsFor(calls, agent).map(() => base)
        });
        expect({ agent, sdk: await sdkMaxTurnsFor(firstCallTo(calls, agent)) }).toEqual({ agent, sdk: base });
      }

      // Written out, because this ordering is the thing a base-blind formula would have flattened.
      expect(capsFor(calls, '04-backend-builder')[0]).toBe(80);
      expect(capsFor(calls, '06-test-verifier')[0]).toBe(80);
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
    'AC-003 a 60-entry list invokes the four scaled agents with exactly 150, and nothing in the run exceeds it',
    async () => {
      // 40 + 2 × 60 = 160, above the ceiling.
      expect(40 + 2 * 60).toBe(160);

      const { calls, state } = await wholeRun({ files: listOf(60) });

      expect(state.completionStatus).toBe('SUCCESS');

      for (const agent of SCALED) {
        expect({ agent, caps: capsFor(calls, agent) }).toEqual({
          agent,
          caps: capsFor(calls, agent).map(() => 150)
        });
        expect({ agent, sdk: await sdkMaxTurnsFor(firstCallTo(calls, agent)) }).toEqual({ agent, sdk: 150 });
      }

      expect(calls.filter(call => (call.maxTurns ?? 0) > 150)).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-003 a 55-entry list lands exactly on 150: the ceiling is reached, not overshot',
    async () => {
      expect(40 + 2 * 55).toBe(150);

      const { calls, state } = await wholeRun({ files: listOf(55) });

      expect(state.completionStatus).toBe('SUCCESS');
      for (const agent of SCALED) {
        expect({ agent, caps: capsFor(calls, agent) }).toEqual({
          agent,
          caps: capsFor(calls, agent).map(() => 150)
        });
      }
    },
    RUN_TIMEOUT_MS
  );

  it('AC-003 the ceiling is applied to the RESULT, so a base above 150 would be lowered too', () => {
    // No base is above 150 today, so the min-after-max branch is proved by the formula the story
    // states, hand-written here, rather than by mutating the pinned registry.
    expect(storyFormula(200, 0)).toBe(150);
    expect(Math.max(...Object.values(BASE_AT_R9))).toBeLessThan(150);
    expect(Math.max(...Object.values(AGENT_COST).map(cost => cost.maxTurns))).toBeLessThan(150);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-004 — an agent with no approved file list keeps its base, and no AGENT_COST value moved
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-004 the Researcher, Story Writer and Spec Writer keep their own base', () => {
  it(
    'AC-004 01, 02 and 03 carry no call-level cap on a 60-entry brief, and the SDK is asked for 80, 30 and 60',
    async () => {
      const { calls, state } = await wholeRun({ files: listOf(60) });

      expect(state.completionStatus).toBe('SUCCESS');

      for (const agent of ['01-researcher', '02-story-writer', '03-spec-writer'] as const) {
        const theirCalls = calls.filter(call => call.agent === agent);
        // They really ran, so "no cap" is not vacuously true.
        expect({ agent, invoked: theirCalls.length > 0 }).toEqual({ agent, invoked: true });
        // No key at all, so the call is byte-identical to the one made before this PR.
        expect({
          agent,
          anyKey: theirCalls.some(call => Object.prototype.hasOwnProperty.call(call, 'maxTurns'))
        }).toEqual({ agent, anyKey: false });
        // And the invoker therefore asks for that agent's own base, written out.
        expect({ agent, sdk: await sdkMaxTurnsFor(firstCallTo(calls, agent)) }).toEqual({
          agent,
          sdk: BASE_AT_R9[agent]
        });
      }

      // Not even on a 60-entry brief, where 40 + 2 × 60 would have been 160 for all of them.
      expect(capsFor(calls, '01-researcher')).toEqual([undefined]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-004 the follow-up reviewer gets no cap even on a 60-entry brief, though it does receive FILE_LIST.md',
    async () => {
      // 07b is the one excluded agent a normal run can be made to invoke, and it is the one the
      // brief flags: 40 + 2 × files does not depend on `base`, so scaling it would hand the
      // follow-up (base 40) the Validator's cap on any brief over 5 files. It only runs when the
      // Test Verifier changed test files, so this run makes it write one.
      const files = listOf(60);
      const brief = spec({ files, ui: true });
      const invoker = scriptedInvoker(
        {
          ...passingScript(),
          '03-spec-writer': brief,
          '04-backend-builder': backend({ files }),
          '05-frontend-builder': frontend(),
          '06-test-verifier': () => {
            mkdirSync(join(project.dir, 'test'), { recursive: true });
            writeFileSync(join(project.dir, 'test', 'r2-cap.test.ts'), 'it("caps", () => {});\n');
            return testVerifier();
          },
          '07b-validator-followup': followup({ files: ['test/r2-cap.test.ts'] })
        },
        { cwd: project.dir }
      );

      const state = await runToEnd({
        cwd: project.dir,
        invoke: invoker.invoke,
        changes: fakeChangeTracker({ base: { kind: 'none', reason: 'not a git work tree (fatal: not a git repository)' } })
      });

      expect(state.completionStatus).toBe('SUCCESS');

      const followupCalls = invoker.calls.filter(call => call.agent === '07b-validator-followup');
      // It really ran, so "no cap" is not vacuously true — the whole point of this test.
      expect(followupCalls.length).toBeGreaterThan(0);
      expect(followupCalls.map(call => call.maxTurns)).toEqual(followupCalls.map(() => undefined));
      // And the SDK is asked for its own narrow budget, written out, not the 150 the brief implies.
      expect(await sdkMaxTurnsFor(followupCalls[0])).toBe(40);

      // Meanwhile the four scaled agents on the same run did get the ceiling.
      expect(capsFor(invoker.calls, '04-backend-builder')).toEqual([150]);
    },
    RUN_TIMEOUT_MS
  );

  it('AC-004 every AGENT_COST turn budget still equals its PR R-9 value', () => {
    expect(Object.fromEntries(Object.entries(AGENT_COST).map(([agent, cost]) => [agent, cost.maxTurns]))).toEqual(
      BASE_AT_R9
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-005 — an oversized brief records ONE IMPORTANT finding and never blocks the checkpoint
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-005 a brief over either limit warns at CHECKPOINT 2 and still advances', () => {
  it(
    'AC-005 13 acceptance criteria and 31 files produce exactly ONE finding naming both counts and suggesting a split',
    async () => {
      const { requests, state } = await wholeRun({ files: listOf(31), acCount: 13 });

      // The warning never blocks: the run reached the checkpoint, was approvable, and finished.
      expect(state.completionStatus).toBe('SUCCESS');
      expect(state.escalations ?? []).toEqual([]);
      expect(requests.map(request => request.id)).toContain(2);

      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('[Stage 2] Brief Size Within Limits: ');
      expect(findings[0]).toContain('13 acceptance criteria (more than 12)');
      expect(findings[0]).toContain('31 files (more than 30)');
      expect(findings[0]).toMatch(/split/i);

      // It reaches the human again in CHECKPOINT 3's findings...
      const checkpoint3 = requests.find(request => request.id === 3);
      expect(checkpoint3?.text).toContain('Brief Size Within Limits');
      // ...but nothing was added to what CHECKPOINT 2 presents, whose SHA-256 the approval binds to.
      const checkpoint2 = requests.find(request => request.id === 2);
      expect(checkpoint2?.text).not.toContain('Brief Size Within Limits');
      expect(checkpoint2?.text).not.toMatch(/suggest splitting/);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-005 13 acceptance criteria alone warn, with only the acceptance-criteria clause',
    async () => {
      const { state } = await wholeRun({ files: listOf(3), acCount: 13 });

      expect(state.completionStatus).toBe('SUCCESS');
      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('13 acceptance criteria (more than 12)');
      expect(findings[0]).not.toMatch(/file list/);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-005 31 files alone warn, with only the file clause',
    async () => {
      const { state } = await wholeRun({ files: listOf(31), acCount: 3 });

      expect(state.completionStatus).toBe('SUCCESS');
      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('31 files (more than 30)');
      expect(findings[0]).not.toMatch(/acceptance criteria/);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-005 a 31-entry list whose last 6 entries are DELETE still warns: a deletion is brief size',
    async () => {
      const { state } = await wholeRun({ files: listOf(31), deletes: 6 });

      expect(state.completionStatus).toBe('SUCCESS');
      const findings = sizeFindings(state);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('31 files (more than 30)');
    },
    RUN_TIMEOUT_MS
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-006 — 12 and 30 are the limits, not the threshold for a warning
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-006 a brief at exactly the limits records no R5 finding', () => {
  it(
    'AC-006 exactly 12 acceptance criteria and exactly 30 files warn about neither',
    async () => {
      const { requests, state } = await wholeRun({ files: listOf(30), acCount: 12 });

      expect(state.completionStatus).toBe('SUCCESS');
      expect(sizeFindings(state)).toEqual([]);
      expect(
        (state.importantFindings ?? []).filter((finding: { message: string }) => /split/i.test(finding.message))
      ).toEqual([]);
      // The run still went through CHECKPOINT 2, so "no finding" is not "no gate".
      expect(requests.map(request => request.id)).toContain(2);
    },
    RUN_TIMEOUT_MS
  );

  it(
    'AC-006 one more of either count is the first that warns: 13 / 30 and 12 / 31 both do',
    async () => {
      const thirteenAc = await wholeRun({ files: listOf(30), acCount: 13 });
      expect(sizeFindings(thirteenAc.state)).toHaveLength(1);
      expect(sizeFindings(thirteenAc.state)[0]).toContain('13 acceptance criteria (more than 12)');

      project.cleanup();
      project = tempProject('ff-verify-r2-');

      const thirtyOneFiles = await wholeRun({ files: listOf(31), acCount: 12 });
      expect(sizeFindings(thirtyOneFiles.state)).toHaveLength(1);
      expect(sizeFindings(thirtyOneFiles.state)[0]).toContain('31 files (more than 30)');
    },
    RUN_TIMEOUT_MS * 2
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// AC-007 — the documents of record and the pinned claims moved in this same change
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('AC-007 SKILL.md, doc-drift and the ROADMAP are in step, and R-9 keeps its AGENT_COST pin', () => {
  it('AC-007 SKILL.md names PR R-2 and documents both the R4 formula and the R5 warning', () => {
    const skill = read('factory/feature/SKILL.md');
    const intro = skill.split('\n---')[0];
    const text = collapsed(skill);

    expect(intro).toContain('(Phase R, PR R-2)');
    expect(intro).not.toContain('PR R-9');

    // R4, the formula itself, on one source line so the collapsed read finds it.
    expect(text).toContain('maxTurns = min(150, max(base, 40 + 2 × files))');
    // R5, with both limits and the suggestion the operator is meant to act on.
    expect(text).toContain('Brief Size Within Limits');
    expect(text).toMatch(/more than 12 acceptance criteria/);
    expect(text).toMatch(/more than 30 files/);
    expect(text).toMatch(/split/i);
    // And the warning is documented as a warning, never a block.
    expect(text).toMatch(/warned about, never blocked/);

    const stage2Row = skill.split('\n').find(line => /^\|\s*2 Plan\s*\|/.test(line));
    expect(stage2Row).toContain('Brief Size Within Limits');
    expect(stage2Row).toContain('Effort Labels Declared');
  });

  it("AC-007 doc-drift pins PR R-2's version line and this PR's claim literals", () => {
    const docDrift = read('factory/test/contracts/doc-drift.test.ts');

    expect(docDrift).toContain("'Phase R, PR R-2'");
    expect(docDrift).toContain('/\\(Phase R, PR R-2\\)/');
    expect(docDrift).not.toContain("'Phase R, PR R-9'");
    expect(docDrift).toContain("'Brief Size Within Limits'");
    // The claims R-1 and R-9 pinned stay pinned: SKILL.md still makes them.
    for (const literal of ['CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'Effort Labels Declared']) {
      expect({ literal, pinned: docDrift.includes(`'${literal}'`) }).toEqual({ literal, pinned: true });
    }
  });

  it('AC-007 docs/ROADMAP.md shows R-2 done and R-3 next', () => {
    const roadmap = read('docs/ROADMAP.md');

    expect(roadmap).toMatch(/- \*\*R-2 \(done[^)]*\):\*\*/);
    expect(roadmap).toContain('- **R-3 (next):**');
    expect(roadmap).not.toContain('- **R-2 (next):**');
  });

  it("AC-007 PR R-9's acceptance file retired its three superseded assertions and kept its AGENT_COST pin", () => {
    const r9 = read('factory/test/acceptance/phase-r-pr-r9.test.ts');

    // Exactly the three this PR invalidates are gone, each replaced by a retirement note.
    expect(r9).not.toContain("toContain('(Phase R, PR R-9)')");
    expect(r9).not.toContain("toContain('- **R-2 (next):**')");
    expect(collapsed(r9)).toMatch(/retired by PR R-2/);

    // The pin AC-007 requires to keep passing is still in the file, unchanged...
    expect(r9).toContain('expect(AGENT_COST).toEqual({');
    expect(r9).toContain("'04-backend-builder': { model: 'claude-opus-5', effort: 'high', maxTurns: 80 }");
    expect(r9).toContain("'07-validator': { model: 'claude-opus-5', effort: 'high', maxTurns: 50 }");
    // ...and the claim that is still true was NOT retired with the others.
    expect(r9).toContain("expect(intro).not.toContain('PR R-1')");

    // R_MEASUREMENTS.md's 'After R9' row is out of scope for this PR and must still be asserted empty.
    expect(r9).toContain('R_MEASUREMENTS.md');
  });

  it('AC-007 no agent contract was changed for R4 or R5: both are harness behaviour', () => {
    // The story's own out-of-scope list. A rule in a shared contract would reach by-hand runs,
    // where neither the orchestrator nor the stage gate exists (D-B2-4).
    for (const contract of ['04-backend-builder', '05-frontend-builder', '06-test-verifier', '07-validator']) {
      const text = read(`factory/feature/agents/${contract}.md`);
      for (const token of ['brief-size', 'scaledMaxTurns', 'Brief Size Within Limits', 'maxTurns']) {
        expect({ contract, token, mentioned: text.includes(token) }).toEqual({ contract, token, mentioned: false });
      }
    }
  });
});
