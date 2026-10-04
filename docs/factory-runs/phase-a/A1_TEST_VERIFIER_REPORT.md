# Test Verifier Report — Phase A, PR A-1 "Gates tell the truth"

> Agent 06 (Test Verifier), by-hand mode. 2026-10-04. Branch `feat/phase-a1-gates`.
> Skills loaded by Read: `test-driven-development.md`, `verification-before-completion.md`.
> Saved by the orchestrating session from the Test Verifier's hand-back (content unchanged except formatting).

## Verdict

All **41 in-scope acceptance criteria are PROVEN** by tests. **No implementation defects** found. AC-14 was only weakly tested (deleting either of its two failure branches left the test green); two acceptance tests were added and each fails when its branch is broken.

## Final run

- `npx tsc --noEmit` and `npm run typecheck`: exit 0, with all four untracked root scripts present.
- `npx jest`: exit 0 — **25/25 suites, 439/439 tests** (437 from the builders + 2 added here).
- **No implementation change left behind:** SHA checksums of every file under `factory/` except `factory/test/` (81 files) were identical before and after.
- **No leftover processes** after the timeout tests.

## Test file changed

`factory/test/harness/execution-gates.test.ts`, two tests added:
- "AC-14 a dev script that exits non-zero with clean output before the timeout fails CRITICAL and blocks"
- "AC-14 a dev script that stays up but reports an error before the timeout fails CRITICAL and blocks"

## Mutation testing

36 temporary single-behaviour edits to the implementation, each run against its matching tests, then restored byte-identical:
- **33 caught** by a failing test.
- **4 broke compilation** (proved nothing); 3 redone in compiling form — all caught; the 4th (AC-66) replaced by a different edit to the reference function — caught.
- **2 not caught:**
  - AC-14 "non-zero dev exit counts as pass" — a real gap, now closed by the two new tests.
  - AC-65 baseline filename rename — not a defect: the orchestrator test builds the path with the same helper; the unit test pinning the literal `.factory/baseline.json` catches it.

## Results by criterion

Key: OG `orchestrator-gates.test.ts`, VL `validator-loop-back.test.ts`, UA `upstream-artifacts.test.ts`, EG `execution-gates.test.ts`, SG `stage-gates.test.ts`, SC `security-checks.test.ts`, AOS `agent-output-schema.test.ts`, RB `regression-baseline.test.ts`, RH `repo-hygiene.test.ts`, DD `doc-drift.test.ts`, CLI `cli.test.ts`. "Caught" = a deliberate break made the named test fail.

| AC | Test(s) | Status | Evidence |
|---|---|---|---|
| AC-1 | OG "AC-1 injected gates are called…"; RH "AC-1 DEFAULT_GATES…" | ✅ | Ignoring the injected execution gate caught (spawn spy fired) |
| AC-2 | RH "AC-2 no orchestrator or CLI test defines its own…" | ✅ | Static scan; shared fixtures present |
| AC-3 | RH "AC-3 orchestrator.test.ts is absent…" | ✅ | File deleted |
| AC-4 | RH "AC-4 tsconfig excludes…" + typecheck | ✅ | Typecheck exit 0 with the four files present |
| AC-5 | OG "AC-5 a throwing infrastructure gate…" | ✅ | `INFRASTRUCTURE_FAILURE`, stage 4, no Test Verifier |
| AC-6 | OG "AC-6 a throwing execution gate…" | ✅ | `EXECUTION_FAILURE`, no Validator |
| AC-7 | OG "AC-7 a blocking execution result…" | ✅ | Ignoring the block caught |
| AC-8 | EG "AC-8 a green suite whose summary is on stderr only…" | ✅ | Parsing stdout only caught |
| AC-9 | EG "AC-9 parses…", "AC-9 output with no counts blocks…", "AC-9 parses Vitest and Mocha" | ✅ | Order-dependent parsing caught; old 0/0 pass caught |
| AC-10 | EG "AC-10 failedTests lists…" | ✅ | Empty `failedTests` caught |
| AC-11 | EG "AC-11 missing dev script is skipped…" | ✅ | SKIPPED + warning + no block asserted |
| AC-12 | EG "AC-12 missing build script is skipped…" | ✅ | Removing the skip caught |
| AC-13 | EG "AC-13 a dev script that never exits…"; RH "AC-13 … no shell timeout" | ✅ | No `timeout`/`gtimeout` on this machine; killing only the shell caught (grandchild survived); ignoring the timeout caught |
| AC-14 | EG original + 2 new tests | ✅ (was WEAK) | Each failure branch broken on its own is now caught |
| AC-15 | RH "AC-15 … neither Promise.all nor execSync" | ✅ | Static; sequential `await` confirmed |
| AC-16 | AOS "AC-16 output with no details…"; OG "AC-16 … SCHEMA_VALIDATION" | ✅ | All 8 agents × 4 malformed shapes |
| AC-17 | SG ×2; OG "AC-17 IMPORTANT stage-gate failures…" | ✅ | Unit + full run |
| AC-18 | OG ×2; SG ×3 | ✅ | Covered-count removed, story-count removed, story count from Test Verifier, `<= 0`→`< 0` — all caught |
| AC-19 | OG it.each (FAIL, ESCALATE, LOOP_BACK, failed>0, CRITICAL) + "names…" | ✅ | Status, failures, CRITICAL issues ignored — all caught |
| AC-20 | OG "AC-20 Validator status ESCALATE…" | ✅ | ESCALATED, never PASS, no Consolidator |
| AC-21 | OG ×2; SG "AC-21 a missing required Stage 4 artifact…" | ✅ | Dropping the required-artifact check caught at both levels |
| AC-22 | OG ×3; VL ×2; SG cases | ✅ | Reference ignored, rounds vs baseline, 100% weakened — all caught |
| AC-23 | OG "AC-23 the execution gate is first called after the Test Verifier…" | ✅ | Order + one call per evaluation |
| AC-24 | UA ×2 | ✅ | Removing the exists filter caught |
| AC-25 | UA "AC-25 … harness-labelled…" | ✅ | Label, run dir only, absent from audit and `filesModified` |
| AC-26 | RH "AC-26 …" | ✅ | Excludes `docs/factory-runs/` (I-1) |
| AC-27 | RH "AC-27 …" | ✅ | Static |
| AC-28 | UA "AC-28 …" | ✅ | Removing the archive rule caught |
| AC-29 | VL ×2 | ✅ | Briefing removed, Gate 1.5 skipped, Gate 1 skipped — all caught |
| AC-30 | VL "AC-30 …" | ✅ | Frontend prompt, phase, round |
| AC-31 | VL it.each (no file, canFix false, unowned) | ✅ | Unroutable check ignored; canFix ignored — caught |
| AC-32 | VL "AC-32 …" | ✅ | Off-by-one in the bound caught |
| AC-33 | VL it.each + asserted in AC-19/20/70 tests | ✅ | Re-adding `advanceToStage(3)` caught |
| AC-58 | RH "AC-58 …" | ✅ | Static, whole identifiers |
| AC-59 | DD ×6 | ✅ | Claims block + prose vs `AGENT_STAGE`, `CHECKPOINTS`, `LOOP_BACK_RULES` |
| AC-60 | DD ×2 | ✅ | Regex-based |
| AC-62 | SG ×2 | ✅ | Typed `Stage4Metadata` |
| AC-63 | CLI ×5 | ✅ | No spawn/exec; exit via injected handler; source check of real entry |
| AC-64 | EG "AC-64 …" | ✅ | Exit 2, FAILED, blocker |
| AC-65 (read) | OG "AC-65 …"; RB units | ✅ | Reader always "no baseline" caught; rename caught by RB unit |
| AC-66 | OG; SG and RB cases | ✅ | Inventing a reference caught |
| AC-67 | SC; OG | ✅ | `false` as pass; surface not passed through — caught |
| AC-68 | SC it.each ×4; OG PRESENT | ✅ | Surface check removed; reason check removed — caught |
| AC-69 | VL ×2; RH | ✅ | Everything-to-backend caught at unit and orchestrator level |
| AC-70 | VL ×2 | ✅ | Round attempt counted against Stage 3 caught |

**Not in this PR (A-2):** AC-34..57, AC-61, AC-71..79, and the writing side of AC-65.

## Minor limits (not failures)

- AC-69's "single copy" check finds only literal copies of the regex text.
- AC-24's prompt scan checks only `.factory/<run>/<UPSTREAM_NAME>` paths.
- AC-13 live proof relies on this machine lacking GNU `timeout`; elsewhere the static check guarantees the binary isn't used.

✓ TEST VERIFIER COMPLETE
