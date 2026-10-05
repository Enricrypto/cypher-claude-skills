# CONSOLIDATION_REPORT.md — Phase A, PR A-2 "Run lifecycle"

> Agent 08 (Feature Consolidator), by-hand mode, read-only. 2026-10-05. PR A-2 (#4) merged to `main` at b3d9f1e.
> Sources: `docs/factory-runs/phase-a/{A2_TECHNICAL_BRIEF, A2_FILE_LIST, A2_TEST_VERIFIER_REPORT, A2_VALIDATION_REPORT, A2_VALIDATION_FOLLOWUP, A2_VALIDATION_RECHECK, A1_CONSOLIDATION_REPORT, A1_PATTERNS}.md`, the session's A-2 build notes, run facts from the orchestrating session, and checks of the merged `factory/` code.
> Saved by the orchestrating session from the Consolidator's hand-back.

**Limits:**
- Timings are the session's wall-clock figures; the harness's `agentInvocations` record doesn't apply because this run was by hand.
- Step 5's note window (20:07–20:40, 33 min) is shorter than the given 27 min of work plus ~18 min waiting, so the work/wait split there is approximate.
- Time between steps (re-running checks, writing hand-offs) was not timed.
- Researcher and Story Writer did not run in A-2: the Phase A story was approved in A-1.
- Confidence is qualitative.
- Two records disagree on deferred A-1 items: the Validator's table lists A-1 MINOR-1, -2 and -3 as deferred under I-17; the brief's I-17 names only MINOR-1 and -3 (MINOR-2 was deferred separately in the brief's §5).

## 1. What happened

| Stage | Agent / actor | Outcome | Iterations |
|---|---|---|---|
| Research / Story | (reused from A-1) | Groups R (AC-34..42, 71..73) and K (AC-43..57, 74..78), plus AC-61, AC-65 writing side and AC-79, as split at A-1's CP1 | 0 |
| Spec | 03 Spec Writer | D-1..D-13, an 11-step build order, 19 operator issues; FILE_LIST 18 CREATE / 36 MODIFY / 4 DELETE | 1 |
| CP2 | Operator | I-1..I-16, I-18, I-19 accepted; I-17 accepted with a partial cut (A-1 MINOR-1/-3 to Phase B) | — |
| Build | 04 Backend Builder ×11 (fresh per step) | Tests 471 → 1053; session re-ran typecheck + jest after every step: 0 failed checks. Frontend Builder not needed | 11 steps |
| Mid-build decisions | Operator | D-A: regression reference = max(first passing, baseline) (closes a hole in I-12). D-B: rework of a pre-supplied story/brief re-runs 02/03. D-A found half-applied at step 10, completed in step 11 | 2 |
| Existing-test policy | Session / operator | Fired 6 times: 3 setup-only fixes, 2 operator-approved assertion changes (resume.test.ts TIMING; D-A regression-baseline tests), plus the CK extensions the file list assigned | — |
| S-1 live smoke (I-13) | Session (operator-approved) | PASS: 07-validator, 15 turns, $1.21, 117 s; SDK accepted the `anyOf` tri-state schema; I-13 closed (open since A-1) | 1 |
| Test verification | 06 (∥ 07) | All items PROVEN; 54 mutations; 5 survivors closed by 5 added tests (`a2-acceptance-gaps.test.ts`); 89 implementation files checksum-identical; 1058 tests | 1 |
| Validation | 07 (∥ 06) | PASS: 0 CRITICAL / 1 IMPORTANT / 8 MINOR; 22 SKILL.md claims checked, 20 true | 1 |
| Follow-up review | 07, scoped to tests 06 added | 5 SOUND / 5 MINOR (one wrong title) | 1 |
| CP3 | Operator | Fix round: IMPORTANT-1; MINOR-1, 2, 3, 6, 7; follow-up MINOR-1, 3. Backlog: MINOR-4, 5, 8 | 1 fix round |
| Re-check | 07 | All 8 RESOLVED (MINOR-3 as a documented accepted risk); 2 new MINOR (NEW-MINOR-2 fixed in docs before commit, NEW-MINOR-1 backlogged); 1076 tests | 1 |
| Delivery | Operator | PR #4 merged after CI. Session slip: `update_memory` called without the required approval (reported) | — |

## 2. Time profile (wall clock)

| Unit | Active (min) | Waiting on operator (min) |
|---|---|---|
| Spec Writer | 20 | — |
| Step 1: state model, pure lifecycle | 13 | — |
| Step 2: orchestrator refactor, timing, AC-38 | 19 | — |
| Step 3: run directories, safe writes | 15 | — |
| Step 4: checkpoint model | 15 | — |
| Step 5: CP3 and SUCCESS | 27 | ~18 |
| Step 6: resume core | 21 | — |
| Step 7: approve/reject/rework | 32 | ~5 |
| Step 8: `--consolidate` library | 11 | — |
| Step 9: CLI | 13 | — |
| Step 10: docs, cleanup, smoke script | 15 | — |
| Step 11: hardening, D-A completion | 15 | — |
| **Build subtotal** | **196** (mean ~18/step, range 11–32) | **~23** |
| S-1 live smoke | 2 | — |
| Verification: Test Verifier 24 ∥ Validator 9 | 24 elapsed (33 agent-minutes) | — |
| Follow-up review | ~2 | — |
| CP3 fix round | 13 | — |
| Re-check | ~3 | — |
| **Total** | **~260 active** | **~23** (~8% of ~283) |

| Part | Minutes | Share of active |
|---|---|---|
| Build | 196 | ~75% |
| Verification (S-1, TV ∥ Validator, follow-up, re-check) | 31 | ~12% |
| Spec | 20 | ~8% |
| Fix round | 13 | ~5% |

Not included: the operator's review time at CP2/CP3, and untimed between-step time (build window 18:58–23:05 = 247 min vs 219 timed).

**Where time went:** steps 5 (27) and 7 (32) are the orchestrator-heavy ones and the only ones that waited on the operator. The full suite grew ~51 s → ~180 s (per-commit fsync ~45 ms; more orchestrator-level tests), paid at every between-step check. Tests: 471 → 631 → 636 → 695 → 747 → 806 → 851 → 915 → 934 → 1011 → 1018 → 1053 → 1058 (TV) → 1076 (fix round).

## 3. What worked

1. **Build-notes hand-off file** read by every fresh builder (OPEN with owning step, RULE, TIP). The step-10 notes caught D-A applied to round 0 only.
2. **Written policy for existing-test changes** — fired 6 times; no assertion changed silently.
3. **Builders surfaced decisions instead of improvising** (D-A, D-B); both became binding notes with named tests.
4. **Timing every step** — the first measured profile; the harness now records `agentInvocations` for program runs (D-13).
5. **Live smoke after the build, before verification** — S-1 closed A-1's lowest-confidence item for 2 min / $1.21.
6. **Parallel TV ∥ Validator plus a scoped follow-up review** of the TV's added tests — closed A-1 anti-pattern 12 (found a wrong title and weak assertions).
7. **Mutation proving found real gaps again** — 5 of 54 survived (M25, M33, M34, M50, M54), each killed by a new test.
8. **Exact fix-round scope with a STOP rule** — every item resolved, no regressions.
9. **Researching an unfixable finding before closing it** — MINOR-3 documented as an accepted risk with PR wording.

## 4. What didn't work, or cost extra

1. Mutations ran in the same working tree the Validator was reading (5–60 s each); the session had to confirm IMPORTANT-1 and MINOR-1 against real code. B1 must isolate them.
2. D-A was only half-applied (round 0, not later rounds) until step 11.
3. The brief's §6 test plan missed existing tests the change would break (retry-briefing, feature-spec ×2, step 5 setup).
4. The pre-A-2 migration path was the weak spot (IMPORTANT-1, MINOR-8, NEW-MINOR-1).
5. A fail-open guard: a symlinked `.factory` listed as empty (MINOR-1).
6. Docs still overclaimed despite the drift test, which only checks mechanical claims (MINOR-2, NEW-MINOR-2).
7. Assertions passing for the wrong reason (log-line proxies; coincidental preconditions — AC-78 vs M25, CK AC-44 vs M30).
8. Suite time tripled (~51 s → ~180 s).
9. Process slips: a leftover `resume.test.ts.orig` from applying a patch (removed in step 8); `update_memory` without approval.

## 5. A-1 vs A-2

| Dimension | A-1 | A-2 | What the A-1 patterns changed |
|---|---|---|---|
| Time data | none | per step, waits separated | A-1 §7 "record per-agent time" applied |
| Story revisions | 2 | 0 (reused) | P-3 split at CP1 removed Research/Story from A-2 |
| Brief changes at CP2 | 1 (I-10) | 1 partial cut (I-17) | P-5 binding §13 reused |
| Build steps / failed checks | 8 / 0 | 11 / 0 | P-6 kept, plus build notes and test-change policy |
| Mid-build operator decisions | 0 recorded | 2 (D-A, D-B) | decisions surfaced rather than patched |
| TV gaps found | 1 (2 tests) | 5 (5 tests, 54 mutations) | P-7 kept; checksum proof kept |
| Validator first pass | 0 C / 5 I / 13 M | 0 C / 1 I / 8 M | C-1/C-2/C-6 applied in the brief's design |
| Re-check new MINOR | 4 (1 false alarm) | 2 (1 fixed before commit) | P-8/P-9 kept |
| Parallel TV ∥ Validator | no cross-read | scoped follow-up review | anti-pattern 12 addressed; new isolation issue |
| Live external facts | probe before the story | S-1 after the build | P-1 extended to deferred external facts |
| Tests | 231 → 471 | 471 → 1076 | — |

## 6. Confidence profile (qualitative)

| Area | Confidence | Basis |
|---|---|---|
| Hash-bound checkpoints (CP1–3, `--approve`, I-7) | High | One presentation path; M05/M06/M07/M09/M29 killed; Validator traced |
| Resume skip rule and output rebuild | Medium-High | M01/M02/M33/M34/M54 killed; traced; never exercised live end-to-end |
| Run-directory lifecycle | High | MINOR-1/7 fixed; rename-only; residual GAP-5 |
| Regression bar (D-A) | High | M11/M12 killed; can't drop on resume, rounds or CP3 rework |
| CP3 change capture (git) | Medium-High | argv-only, allow-listed; filter drivers accepted risk; case-sensitive pathspec in backlog |
| CLI flags and exit codes | High | AC-79 drift test against `CLI_FLAGS` / `EXIT_CODES` |
| `--consolidate` | Medium | Tests only; this consolidation was by hand |
| Pre-A-2 migration | Medium | MINOR-8, NEW-MINOR-1 open |
| Pre-supplied (tier-1) path | Medium | MINOR-4, MINOR-5 open; CP1/CP2 still gate |
| SDK `anyOf` tri-state schema | High (was Low in A-1) | S-1 PASS |
| SKILL.md truthfulness | Medium-High | 20/22 true on first pass; 2 doc fixes after review |

## 7. Open backlog (as recorded)

- **Validation:** MINOR-4, MINOR-5 (pre-supplied path), MINOR-8 (pre-A-2 MAX_LOOPS extra resume round).
- **Re-check:** NEW-MINOR-1 (CLI refusal order differs from the library; fails closed).
- **Follow-up:** MINOR-2 (log-line proof), MINOR-4 (third copy of the live-run lookup), MINOR-5 (readability).
- **Test Verifier observations:** CK AC-44 passes under M30; RS AC-39 relies on a log line; AC-42 CLI "MANUAL_STOP: no" case is vacuous; the spec gate's only CRITICAL check is existence-only.
- **Build notes:** Unicode bidi controls not escaped by `printableForTerminal`; case-sensitive `:(exclude).factory` pathspec; suite time ~180 s.
- **Docs (I-19):** README "ten agents" / "five stages" / old diagram; stale claims in `factory/feature/reference/STAGE_CONTRACTS.md:61, :273` and `factory/feature/docs/*.md`.
- **Accepted risk:** MINOR-3 git filter drivers — revisit when the minimum git version is ≥2.42.
- **Phase B:** A-1 MINOR-1 and -3 (and -2); GAP-3 cost caps; GAP-5 builder sandboxing; B1 isolation of TV mutations from the parallel Validator.

## 8. Time estimate for the next similar run
See `A2_PATTERNS.md`, "Time estimate for the next similar run".

✓ FEATURE CONSOLIDATION COMPLETE
