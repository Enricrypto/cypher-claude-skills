# Test Verifier Report — Phase A, PR A-2 "Run lifecycle"

> Agent 06 (Test Verifier), by-hand mode. 2026-10-04. Branch `feat/phase-a2-lifecycle`.
> Skills loaded by Read: `test-driven-development.md`, `verification-before-completion.md`.
> Saved by the orchestrating session from the Test Verifier's hand-back (content unchanged except formatting).

## Verdict

Every in-scope item is **PROVEN** by a test that fails when its behaviour is broken. **No implementation defects.** Five tests added to close gaps where a mutation survived the builders' suite.

- `npx tsc --noEmit`: exit 0. `npx jest`: **35 suites, 1058 tests passed**, exit 0 (before: 34 / 1053).
- Implementation checksum: all **89** files under `factory/` except `factory/test/` (SKILL.md and contracts included) **identical** before and after.
- **54** temporary one-edit mutations, each applied → named tests run → restored with `cp -p`, `cmp`-verified byte-identical.
- A temporary root `probe-cwd.ts` was created to test AC-61 and deleted (confirmed gone).
- **Caution recorded:** each mutation was live 5–60 s in the shared tree while the Validator read files in parallel (see the B1 isolation lesson in the PR backlog).

## Test files ADDED or MODIFIED

- **ADDED:** `factory/test/harness/a2-acceptance-gaps.test.ts` (5 tests). **MODIFIED:** none. (Confirmed by the session from test-file checksums.)

Each added test was seen RED under the surviving mutation and GREEN on the real code:
1. "AC-78 the spec gate is evaluated after the Spec Writer and before CP2 is presented" — kills M25 (CP2 asked before the spec gate).
2. "AC-39 Gate 1.5 passed before the run escalated, and on resume it is evaluated again and blocks the Test Verifier" — kills M33. *(Follow-up review: it actually blocks the Validator; title fixed in the CP3 fix round.)*
3. "AC-39 the Stage 4 gate is evaluated again on resume: a resumed Validator reporting a failed security check ends the run before CP3" — kills M34.
4. "I-6 a Stage 1 gate failure invalidates the Researcher step, so a resume re-runs it instead of failing on the same report" — kills M54. (First version used 2 `filesIdentified`, which the schema rejects before the gate; switched to `removeOnPersist` on RESEARCHER_REPORT.md.)
5. "AC-75 a rework builder whose own tests do not all pass fails the Stage 3 gate, before the Test Verifier and before CP3" — kills M50.

## Results by item

"Killed" = the named test failed under the mutation.

| Item | Status | Evidence |
|---|---|---|
| AC-34 | ✅ | M01 Stage-2 skip disabled → CP2 asked again, killed |
| AC-35 | ✅ | M20 reopen removed, killed |
| AC-36 | ✅ | M02 loop restarts at attempt 1, killed |
| AC-37 | ✅ | M39 description check removed, killed |
| AC-38 | ✅ | M04 approval commit removed, killed |
| AC-39 | ✅ (was ⚠️) | M33 killed; M34 survived the original (log-line proxy), killed by RS MINOR-11, RS I-12 and the new GAPS test |
| AC-40 / AC-41 | ✅ | M15 ESCALATED archived too, killed; M53 ACTIVE not counted, killed |
| AC-42 | ✅ | M52 MANUAL_STOP gets a Resume hint, killed by RL (the CLI "MANUAL_STOP: no" case is vacuous) |
| AC-43 | ✅ | M47 CP1 shows the agent summary, killed |
| AC-44 | ✅ | M30 and M31 (CP3 ordering) killed |
| AC-45 | ✅ static | scans for commit/push/gh pr; git only in change-diff (rev-parse, diff, ls-files) |
| AC-46 | ✅ | M27 reason → CRITICAL_ISSUE, 3 killed |
| AC-47 | ✅ | M37 killed; M38 readableRunDir dropped survived AC-47 tests, killed by CS AC-28 |
| AC-48 | ✅ | static scan + behavioural CS test |
| AC-49 / AC-50 / AC-51 | ✅ | M06, M05, M29 wrong hashes, all killed |
| AC-52 | ✅ | M07 hash comparison weakened, 4 of 5 killed (the 5th case is correctly unaffected) |
| AC-53 / AC-54 | ✅ | M26, M21 killed |
| AC-55 / AC-56 / AC-57 | ✅ | M46, M24, M25 killed |
| AC-71 / AC-72 / AC-73 / AC-74 | ✅ | M08, M03, M22, M28 killed |
| AC-75 | ✅ (was ⚠️) | M10 killed; M50 (Stage 3 gate removed from rework) survived all original tests, killed by GAPS |
| AC-76 | ✅ | read: files in the run dir only, required list |
| AC-77 | ✅ | M13 no-TTY → REJECT, killed |
| AC-78 | ✅ (was ⚠️) | M25 survived the CK test (a failing spec gate also makes CP2 unpresentable), killed by the GAPS order test |
| AC-61 / AC-4 | ✅ | temporary root `probe-cwd.ts` → killed |
| AC-65 (write) | ✅ | M23 baseline write removed, killed |
| AC-79 | ✅ | M48 undocumented `--force`, M49 renamed flag, killed |
| MINOR-4,5,6,7,8,9,10,11 | ✅ | M35, M42, M18, M40, M17/M16, M19, M43, M51 killed |
| NEW-MINOR-1 / 2 / 3 | ✅ | M14 (3 suites), M36 (8 mixed-case names), M41 killed |
| I-6 | ✅ | M44, M45 killed; Stage 1 → 01 case had no test, M54 killed by GAPS |
| I-7 | ✅ | M09 comparison removed, 4 killed (CP2 brief via the same generic loop) |
| I-12 / D-A | ✅ | M11 round-0 max dropped, M12 validator-round max dropped, killed |
| D-B | ✅ | M44 killed the gate-invalidated case |
| TIMING | ✅ | M32 step timing dropped, killed |
| Carry-overs (05 contract, archive never deleted, README count) | ✅ | static / covered by M15 |
| MINOR-1, -2, -3 (A-1) | ➖ not in this PR | deferred to Phase B (§13 I-17) |

No item ❌ FAILING; none ➖ not coverable within scope.

## Observations (no defect)
1. The spec gate's only CRITICAL check ("Technical Brief Complete") is existence-only, so a spec-gate failure can never be presented at CP2; the new order test fixes the proof. The contract predates A-2.
2. Weak supporting assertions: CK "AC-44 a Stage 4 gate failure ends the run before CP3" passes even under M30 (CP3 can't be presented without VALIDATION_REPORT.md); RS AC-39 checks a log line printed after the gate.
3. The AC-42 CLI "MANUAL_STOP: no" case is vacuous (`--close` never prints hints); the RL unit test proves it.

✓ TEST VERIFIER COMPLETE
