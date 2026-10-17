/**
 * The brief's size, and what it changes (Phase R, PR R-2: R4 and R5).
 *
 * U1–U8 of the technical brief §6.1. One focused test per behaviour of the one module that spells
 * the five numbers: the formula, its ceiling in both directions, the scaled-agent set and its
 * exclusions, the DELETE-inclusive counting rule, the warning message, and the constants.
 *
 * Every assertion about an agent's base reads `AGENT_COST`, never a re-stated number: R4 computes
 * OVER that table and must keep doing so if a base is ever retuned.
 */

import { describe, it, expect } from '@jest/globals';

import {
  BRIEF_AC_LIMIT,
  BRIEF_FILE_LIMIT,
  TURN_ALLOWANCE_BASE,
  TURN_CEILING,
  TURN_SCALED_AGENTS,
  TURNS_PER_FILE,
  briefFileCount,
  briefSizeWarning,
  scaledMaxTurns,
  turnCap
} from '../../harness/brief-size';
import { AGENT_COST, FeatureFactoryAgent } from '../../runner/agent-registry';

describe('turnCap — min(150, max(base, 40 + 2 × files)), implemented literally (R4)', () => {
  it('U1 returns 40 + 2f when the formula exceeds the base and stays under the ceiling', () => {
    expect(turnCap(80, 30)).toBe(100);
    expect(turnCap(50, 31)).toBe(102);
    // The formula, not two magic numbers: it is the constants that decide.
    expect(turnCap(50, 31)).toBe(TURN_ALLOWANCE_BASE + TURNS_PER_FILE * 31);
  });

  it('U2 returns the base when the formula is smaller', () => {
    expect(turnCap(80, 5)).toBe(80);
    // 40 + 2×5 = 50, which is what a `max`-less implementation would have returned.
    expect(TURN_ALLOWANCE_BASE + TURNS_PER_FILE * 5).toBeLessThan(80);
  });

  it('U3 caps the RESULT in both directions: a large file count and a base above the ceiling alike', () => {
    expect(turnCap(80, 60)).toBe(150);
    // `min` after `max` lowers a base above 150 too. No base is today (the highest is 80), so this
    // branch is proved here rather than by mutating the registry.
    expect(turnCap(200, 0)).toBe(150);
    expect(turnCap(200, 0)).toBe(TURN_CEILING);
  });

  it('U3 never exceeds the ceiling, whatever the file count', () => {
    for (const files of [0, 1, 30, 55, 56, 100, 10_000]) {
      expect({ files, cap: turnCap(80, files) <= TURN_CEILING }).toEqual({ files, cap: true });
    }
  });

  it('U3 is total: a non-finite, negative or fractional count is never trusted', () => {
    // Each of these resolves to a usable number rather than NaN, which would reach the SDK.
    expect(turnCap(80, Number.NaN)).toBe(80);
    expect(turnCap(80, Number.POSITIVE_INFINITY)).toBe(TURN_CEILING);
    expect(turnCap(80, -5)).toBe(80);
    expect(turnCap(80, 30.9)).toBe(100);
    expect(turnCap(Number.NaN, 30)).toBe(100);
  });
});

describe('scaledMaxTurns — exactly the four agents R_DECISIONS.md names a base for (R4)', () => {
  const SCALED = ['04-backend-builder', '05-frontend-builder', '06-test-verifier', '07-validator'] as const;
  const UNSCALED = [
    '01-researcher',
    '02-story-writer',
    '03-spec-writer',
    '07b-validator-followup',
    '07c-validator-skeptic',
    '08-feature-consolidator'
  ] as const;

  it('U4 returns a number for 04, 05, 06 and 07', () => {
    for (const agent of SCALED) {
      expect({ agent, cap: typeof scaledMaxTurns(agent, 31) }).toEqual({ agent, cap: 'number' });
    }
  });

  it('U4 returns undefined for every other agent, so the caller omits the key entirely', () => {
    for (const agent of UNSCALED) {
      expect({ agent, cap: scaledMaxTurns(agent, 31) }).toEqual({ agent, cap: undefined });
    }
    // An agent name that is not in the registry at all is not an error either.
    expect(scaledMaxTurns('99-does-not-exist', 31)).toBeUndefined();
    expect(scaledMaxTurns('', 31)).toBeUndefined();
  });

  it('U5 computes over the LIVE AGENT_COST base, never a re-stated number', () => {
    for (const agent of SCALED) {
      const base = AGENT_COST[agent].maxTurns;
      // A 5-file brief is below every current base, so the cap IS the base...
      expect({ agent, cap: scaledMaxTurns(agent, 5) }).toEqual({ agent, cap: turnCap(base, 5) });
      // ...and a 31-file brief is above it, so the cap is the formula.
      expect({ agent, cap: scaledMaxTurns(agent, 31) }).toEqual({ agent, cap: turnCap(base, 31) });
    }
    // The Validator's narrower budget really is narrower than the builders' today, which is the
    // ordering `40 + 2f` would erase if it were applied to the agents the decision names no base for.
    expect(AGENT_COST['07-validator'].maxTurns).toBeLessThan(AGENT_COST['04-backend-builder'].maxTurns);
  });

  it('U5 TURN_SCALED_AGENTS has exactly those four members, in order, and is frozen', () => {
    expect([...TURN_SCALED_AGENTS]).toEqual([...SCALED]);
    expect(Object.isFrozen(TURN_SCALED_AGENTS)).toBe(true);
    // Every name in the set is a real agent, so a typo cannot silently un-scale a builder.
    const known = Object.keys(AGENT_COST) as FeatureFactoryAgent[];
    expect(TURN_SCALED_AGENTS.filter((agent: FeatureFactoryAgent) => !known.includes(agent))).toEqual([]);
  });
});

describe('briefFileCount — every entry of the approved list, DELETE included (R4, R5)', () => {
  const entry = (path: string, type: 'CREATE' | 'MODIFY' | 'DELETE') => ({ path, type, reason: 'r', complexity: 'SIMPLE' });

  it('U6 counts CREATE, MODIFY and DELETE alike: a deletion is still work and still brief size', () => {
    const list = [entry('a.ts', 'CREATE'), entry('b.ts', 'MODIFY'), entry('c.ts', 'DELETE')];

    expect(briefFileCount(list)).toBe(3);
    expect(briefFileCount([entry('only.ts', 'DELETE')])).toBe(1);
  });

  it('U6 returns 0 for anything unusable, and never throws', () => {
    for (const unusable of [undefined, null, 'src/a.ts', 42, {}, true, { length: 7 }]) {
      let count: number | undefined;
      expect(() => {
        count = briefFileCount(unusable);
      }).not.toThrow();
      expect({ unusable, count }).toEqual({ unusable, count: 0 });
    }
    expect(briefFileCount([])).toBe(0);
  });
});

describe('briefSizeWarning — one finding, suggesting a split (R5)', () => {
  it('U7 is silent at exactly 12 acceptance criteria and exactly 30 files: the limits, not the thresholds', () => {
    expect(briefSizeWarning({ acceptanceCriteria: BRIEF_AC_LIMIT, files: BRIEF_FILE_LIMIT })).toBeUndefined();
    expect(briefSizeWarning({ acceptanceCriteria: 12, files: 30 })).toBeUndefined();
    expect(briefSizeWarning({ acceptanceCriteria: 0, files: 0 })).toBeUndefined();
  });

  it('U7 names the acceptance-criteria count when only that limit is exceeded', () => {
    const warning = briefSizeWarning({ acceptanceCriteria: 13, files: 5 });

    expect(warning).toBe(
      'the approved story has 13 acceptance criteria (more than 12); suggest splitting this brief into more than one PR'
    );
    expect(warning).toMatch(/split/i);
    // The numbers in the message come from the constants, never from a literal in the string.
    expect(warning).toContain(`more than ${BRIEF_AC_LIMIT}`);
    expect(warning).not.toMatch(/file list/);
  });

  it('U7 names the file count when only that limit is exceeded', () => {
    const warning = briefSizeWarning({ acceptanceCriteria: 3, files: 31 });

    expect(warning).toBe(
      'the approved file list has 31 files (more than 30); suggest splitting this brief into more than one PR'
    );
    expect(warning).toMatch(/split/i);
    expect(warning).toContain(`more than ${BRIEF_FILE_LIMIT}`);
    expect(warning).not.toMatch(/acceptance criteria/);
  });

  it('U7 produces ONE message naming both clauses when both limits are exceeded', () => {
    const warning = briefSizeWarning({ acceptanceCriteria: 13, files: 31 });

    expect(warning).toBe(
      'the approved story has 13 acceptance criteria (more than 12) and ' +
        'the approved file list has 31 files (more than 30); suggest splitting this brief into more than one PR'
    );
    // One suggestion, not one per clause: this becomes a single IMPORTANT finding.
    expect(warning!.match(/suggest splitting/g)).toHaveLength(1);
  });

  it('U7 is total: a non-numeric or negative count reads as 0, so no warning is invented', () => {
    const malformed: Array<Record<string, unknown>> = [
      {},
      { acceptanceCriteria: 'thirteen', files: 'thirty-one' },
      { acceptanceCriteria: null, files: undefined },
      { acceptanceCriteria: Number.NaN, files: Number.NaN },
      { acceptanceCriteria: -13, files: -31 },
      { acceptanceCriteria: [13], files: {} }
    ];

    for (const counts of malformed) {
      let warning: string | undefined;
      expect(() => {
        warning = briefSizeWarning(counts as { acceptanceCriteria: number; files: number });
      }).not.toThrow();
      expect({ counts, warning }).toEqual({ counts, warning: undefined });
    }
  });

  it('U7 an infinite count is reported as exceeding the limit rather than printed as NaN', () => {
    const warning = briefSizeWarning({ acceptanceCriteria: Number.POSITIVE_INFINITY, files: 0 });

    expect(warning).toMatch(/split/i);
    expect(warning).not.toMatch(/NaN/);
  });
});

describe('the five numbers, spelled once (R4, R5)', () => {
  it('U8 the exported constants are 12, 30, 40, 2 and 150', () => {
    expect(BRIEF_AC_LIMIT).toBe(12);
    expect(BRIEF_FILE_LIMIT).toBe(30);
    expect(TURN_ALLOWANCE_BASE).toBe(40);
    expect(TURNS_PER_FILE).toBe(2);
    expect(TURN_CEILING).toBe(150);
  });
});
