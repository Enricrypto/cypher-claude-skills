# B2_CONSOLIDATION_REPORT.md — Phase B, PR B-2 "Parallel verification against the snapshot, and the Skeptic step"

> Agent 08 (Feature Consolidator), by hand, read-only. 2026-10-06. PR B-2 (#7) was merged to `main` at 6756370.
> Sources:
> - `docs/factory-runs/phase-b/{B_DECISIONS, USER_STORY, B2_TECHNICAL_BRIEF, B2_FILE_LIST, B2_BUILD_NOTES, B2_MEASUREMENTS, B_TIMINGS (rows from 2026-10-05 17:43 on), B2_TEST_VERIFIER_REPORT, B2_VALIDATION_REPORT, B2_VALIDATION_FOLLOWUP, B2_VALIDATION_RECHECK}.md`;
> - `docs/ROADMAP.md`;
> - the B-1 baseline (`B1_CONSOLIDATION_REPORT.md`, `B1_PATTERNS.md`), plus `A1_PATTERNS.md` and `A2_PATTERNS.md`;
> - facts from the orchestrating session (marked "session fact");
> - spot checks of the merged code.
>
> Saved verbatim by the orchestrating session from the Consolidator's hand-back. It contains no raw invisible characters; code points are written as text.

**Limits:**
- **Timings.** These are the session's wall-clock figures from `B_TIMINGS.md`. The harness's `agentInvocations` record doesn't apply, because this run was by hand.
- **Builder time vs session-check time.** These are separated per step, as recorded.
- **Operator waiting time was not timed anywhere in this run**, as in B-1. So no work/wait split is possible.
- **The run spans two sittings** (session fact). The operator paused the session overnight, from about 22:15 on 10-05 to 07:20 on 10-06. The pause is untimed and excluded below.
- **Untimed time inside the windows** (estimates; minute-granularity rows):
  - **Day 1, 17:43–~22:15 (~272 min):** ~163 min timed, so ~109 min untimed. Visible gaps:
    - 18:24–18:39 (15 min, the step 1 stop and D-B2-1);
    - 20:31–21:22 (51 min, the step 6 stop and D-B2-3);
    - 21:59–~22:15 (the D-B2-4 investigation, the Aurora stop, and the interrupted 8a launch at 22:08).
  - **Day 2, 07:20–~11:48 (~268 min):** ~200 min timed, so ~68 min untimed. Visible gaps:
    - 07:42–08:05 (23);
    - 08:12–08:22 (10);
    - 10:14–10:33 (19, CP3 review);
    - 11:39–11:45 (6).
- **Confidence** is qualitative.

**Where the records disagree (flagged and not reconciled):**
1. **Step 1 time.** `B_TIMINGS` records 10.3 builder minutes and no session check; the build notes say "10.3 + 2 builder + 2 check" (after D-B2-1). The tables below use `B_TIMINGS`.
2. **Step 2 builder time.** The build notes say "~18.6 builder (reported ~35)". The builder's self-reported time is ~1.9× the session's clock.
3. **Step 8a time.** `B_TIMINGS` gives 5.3 min; the build notes add "~1" for the interrupted first run.
4. **S-1 / S-2.** `B_TIMINGS` gives one 7-min row; the build notes give S-1 2.6 and S-2 2; `B2_MEASUREMENTS` gives S-1 154 s. Consistent, but not separable.
5. **Step windows vs active plus check time:** step 5 (18 vs 9.4 min), step 7 (37 vs 27.7), step 2 (24 vs 20.6). The other steps match within ~1 min.
6. **Suite time.** `B2_MEASUREMENTS` S-2 says "about 120 s". Single runs: 101, 102, 111, 103 s; **186 s** (session, step 7; the builder's run was 142 s); 151 s (8a); 122 s (8b); 112.7 s (TV final); 124 s (fix round part 1). The 186 s outlier is noted, not explained.
7. **TV batch-test size.** The TV said it "writes 80 MiB"; the follow-up said about 160 MiB written and ~120 MiB held. Fixed (size plus spot bytes).
8. **The brief contradicted itself on the seal mode:** D-3 (0555/0444) vs §8, §10 and §11 ("a 0700 temp directory that is kept"). The build followed D-3, and this became CRITICAL-1. CP2 review did not catch it.
9. **The brief's S-0 rationale was partly wrong.** §0.9 and D-3 say ripgrep can't search a copy under a gitignored `.factory/`; S-0 showed it can when the copy is the working directory. The correction was logged in the step log, but not as an owned OPEN item. SKILL.md kept the clause, which became MINOR-1.
10. **IMPORTANT-3 was approved design, not a build slip.** Brief I-11 specified sequential skeptics, A then B; the Validator reported the resulting readability of A's verdict as a gap against D-4's intent.
11. **Approved vs actual assertion changes.** CP2 approved 14 rows. In the build:
    - row 7 was not needed;
    - 2 unlisted tests needed changes (D-B2-1, D-B2-3);
    - D-B2-4 moved the AC-90/91 guards onto prompts;
    - the fix round brought 3 approved groups and 1 forced change ratified afterwards (D-B2-5).

## 1. What happened

| Stage | Agent / actor | Outcome | Iterations |
|---|---|---|---|
| Research / Story | reused from B-1 | `USER_STORY.md` at its CP1 hash (7a05811e…). The B-1 re-check residual became a binding entry condition (P-25) | 0 |
| Spec | 03 Spec Writer | 24.5 min, 92 tool calls. D-1..D-20; 8 builder steps + 3 session steps; 30 issues; AC-157 proposed. FILE_LIST: 10 CREATE / 41 MODIFY. Bidi scan clean | 1 |
| CP2 | Operator, 18:09 | AC-157 approved (I-1); copy in `os.tmpdir()` (I-2); 14 assertion changes; S-0/S-1; the rest accepted. Backlog: review-copy cleanup | — |
| S-0 | Session | Jest collects tests in a `.factory/` dot-dir (I-2 confirmed); rg claim corrected; `cat-file --batch` returns raw bytes; baseline 94 s | 1 |
| Build | 04 Backend Builder ×10 runs (fresh per step), 1 interrupted run | Tests 1295 → 1679 (+384). **2 existing-test policy stops** (step 1: 2 assertions; step 6: 1 unlisted assertion). 0 failed session checks after decisions. Frontend Builder not needed | 8 steps + 8a |
| Mid-build decisions | Operator | D-B2-1 (P-20 gap `:162`); D-B2-2 (leaf digest for `copyIntact`); D-B2-3 (P-20 gap `:962`); **D-B2-4 (shared contracts mode-neutral, after the cross-project leak)** | 4 |
| Cross-project incident | Session + operator (session fact) | `~/.claude/agents/01-08` are symlinks into this repo's working tree. B-2's contract edits, and B-1's merged builder line "Never commit … The harness snapshots your work itself.", reached the operator's Aurora project (by-hand Feature Factory; builders commit per step). The operator stopped Aurora's #513 build before its Validator step; nothing in Aurora was changed. D-B2-4 moved program-only rules into prompts. Phase E will link agents to a stable copy | 1 decision, 1 extra step (8a) |
| Interrupted 8a (session fact) | 04, then the session | The first 8a builder (22:08) was interrupted after writing only RED tests (22:09–22:10). The session traced them by file timestamps, and the second 8a builder (07:20) implemented against them | 2 launches |
| S-1 / S-2 | Session | Live smoke of the copy-based Validator: PASS P1–P6, 15 turns, $1.42, 154 s, macOS per-user tmp. Final checks: typecheck clean, 1679 tests, 122 s, hidden-character scan clean. Contract 08 wording fix | 1 |
| Isolation | Session (as B-1, by hand) | The Validator read an rsync'd read-only copy (300 files); the TV mutated the real tree. 150-entry checksum: **0 mismatches**; 199 mutant runs restored | — |
| Test verification | 06 TV, real tree (∥ 07) | 166 valid mutants: 145 caught; 21 survived, of which 17 were killed by 17 gap tests and 4 are equivalent. 0 defects. 8 ACs went WEAK/MISSING → PROVEN. 1696 tests | 1 |
| Validation | 07 (∥ 06), on the copy | **FAIL: 1 CRITICAL / 4 IMPORTANT / 8 MINOR.** 28 doc claims checked, 24 true | 1 |
| Follow-up review | 07, scoped to the 17 gap tests | All 17 kill their mutant; 3 FOLLOWUP-IMPORTANT, 8 FOLLOWUP-MINOR; PASS | 1 |
| CP3 | Operator, 10:33 | Fix round, two parts. MINOR-7 deferred to Phase E | 1 fix round (2 builders) |
| Fix round | 04 ×2 + session | Part 1, code: 35 + 3 min, 1744 tests (+48). Part 2, tests and docs: 17 + 2.5 min | 2 |
| Re-check | 07 | 23/23 RESOLVED, MINOR-7 DEFERRED, 14 deviations acceptable, 3 NEW-MINOR | 1 |
| Final small fix | Session | NEW-MINOR-1/2 text only; NEW-MINOR-3 ratified as D-B2-5 | 1 |
| Delivery | Operator + session (session facts) | PR #7 merged as 6756370; branch deleted; review copies cleaned. **Slip:** the session switched this repo to `main` after merging without asking first (reported) | — |

## 2. Time profile (wall clock)

| Unit | Agent (min) | Session (min) | Estimate in brief (min) |
|---|---|---|---|
| Spec Writer | 24.5 | — | — |
| S-0: probes + baseline | — | 3.5 | 10 |
| Step 1: agents and schemas (stopped; D-B2-1) | 10.3 | — | 12 |
| Step 2: git extraction + measurement | 18.6 (builder reported ~35) | 2 | 20 |
| Step 3: `review-copy.ts` + `test-paths.ts` | 9.8 | 2 | 10 |
| Step 4: state, verdict, AC-157 clause, D-B2-2 digest | 14 | 2 | 15 |
| Step 5: per-call cwd + follow-up/skeptic prompts | 7.4 | 2 | 10 |
| Step 6: `verification()` core (stopped; D-B2-3) | 35 + 2 | 2 | 25 |
| Step 7: follow-up, merge, skeptics, verdict, CP3 | 24.7 | 3 | 25 |
| Step 8a: mode-neutral contracts (D-B2-4, unplanned) | 5.3 (+~1 interrupted) | 2 | — |
| Step 8b: docs | 8 | 2 | 15 |
| S-1 live smoke + S-2 + 08 wording fix | — | 7 | 10 |
| **Build subtotal** | **135.1** (mean 16.9 per brief step; runs range 2–35) | **27.5** (17 checks + 10.5 S-steps) | 132 builder + ~36 session |
| Verification: TV 102 ∥ Validator 12 | 102 elapsed (114 agent-min) | — | — |
| Follow-up review | 5.5 | — | — |
| CP3 fix round, part 1 (code) | 35 | 3 | — |
| CP3 fix round, part 2 (tests/docs) | 17 | 2.5 | — |
| Re-check | 7.2 | — | — |
| NEW-MINOR text fixes + D-B2-5 | — | 3 | — |
| **Total timed** | **338.3** agent-min (326.3 elapsed) | **36** | — |
| **Active total** | **~362 min (~6 h 2 m)** | | brief: "plan about 3.5 h active" |
| Operator waiting | **not timed** | | |

| Part | Minutes | Share of active |
|---|---|---|
| Build (builders 135.1 + session checks 17 + S-steps 10.5) | 162.6 | ~45% (builders alone ~37%) |
| Verification (TV ∥ Validator 102, follow-up 5.5) | 107.5 | ~30% |
| Fix round + re-check + final fix | 67.7 | ~19% |
| Spec | 24.5 | ~7% |

**Not included:** the operator's review time at CP2 and CP3, and all waiting; ~177 min of untimed time inside the two windows (estimate); the overnight pause.

**Where time went:**
- **Builders ran at 102% of the brief's estimate** (135.1 of 132 min). In B-1 they ran at 47%, so the B-1 rule ("~10 min per ordinary step") was well calibrated for ordinary steps here: steps 1–5 took 60.1 min vs 67 estimated; step 8b took 8 vs 15.
- **Step 6 (orchestrator core) overran:** 37 vs 25 (+48%), including a policy stop. Step 7 came in on its estimate (24.7 vs 25). Step 8a was unplanned scope.
- **The active total was ~1.7× the brief's 3.5 h.** The brief did not budget the TV (102 min) or a CRITICAL fix round (67.7 min).
- **Verification is now bound by the Test Verifier:** 102 min, 1.85× B-1's 55, for 166 mutants vs 103. About 85 min were mutation runs: ~0.51 min per valid mutant, vs B-1's ~0.37, consistent with a slower suite (94 → ~120 s) and real-git tests. The Validator took 12 min.
- **The fix round cost 2.8× B-1's** (67.7 vs 24.1 min). It carried 1 CRITICAL, 4 IMPORTANT, 7 MINOR and 11 FOLLOWUP items, split across two builders.
- **Tests:** 1295 → 1325 → 1361 → 1464 → 1574 → 1598 → 1627 → 1673 → 1677 → 1679 (build) → 1696 (TV gaps) → 1744 (fix round) → 1744 (final).
- **Suite time:** 94 s (S-0) → ~120–160 s during and after the build. The growth comes from +449 tests, many using real git or real processes. The durable-write share (B-1 AC-103) was not re-measured in B-2.

## 3. What worked

1. **The binding entry condition (P-25) landed as an AC and held.** The B-1 residual became AC-157 at CP2; SN real-git tests and the TV's O09 gap test prove it; ROADMAP marks it "Closed by AC-157".
2. **S-0 probes before the build (P-22), a second time:** the Jest probe settled I-2 with evidence; the `cat-file --batch` probe confirmed extraction on git 2.39.5; the rg probe corrected the brief, although the correction was not carried into the docs (§4).
3. **The live smoke (P-16) closed the brief's main §8 risk:** the real SDK honours a per-call `cwd` outside the project, and Read/Grep/Glob work in a sealed copy (0 denials). Cost: $1.42, 154 s.
4. **Isolated parallel verification by hand (P-21), a second time:** 0 checksum mismatches, 199 runs restored, and the Validator never saw a mutation.
5. **Build notes (P-12) carried the build across an overnight pause and an interrupted builder** (session fact). The 8a relaunch needed no re-planning.
6. **Mid-build stops worked as designed (P-13).** Both P-20 gaps stopped the builder instead of being silently "fixed", and each became a numbered decision (D-B2-1, D-B2-3), as did the forced change after the re-check (D-B2-5).
7. **Builder deviations were mostly sound and improved the design:** path refusals in `extractSnapshot`; `RangeError` guards in prompts; the D-B2-2 digest, raised by the step 3 builder; the follow-up reviewing the cycle's union of test files.
8. **The scoped review chain found real defects the TV could not.** The TV found 0 implementation defects; the Validator found 1 CRITICAL and 4 IMPORTANT design and recovery gaps. All were resolved before merge, and all 3 NEW-MINORs were closed or ratified.
9. **Splitting the CP3 fix round into code, then tests and docs, with an OPEN-list hand-off:** 23/23 RESOLVED on the first re-check.
10. **Hidden-character hygiene (P-23) held:** every step check, S-2 and the re-check scanned clean.
11. **Pure decision logic moved into services** (MINOR-4 → `verification.ts`), and the import cycle was removed, with a whole-harness cycle test (MINOR-3).

## 4. What didn't work, or cost extra

1. **CRITICAL-1 came from a contradiction inside the approved brief** (session fact): D-3 seals 0555/0444, while §8, §10 and §11 rely on "a 0700 temp directory". CP2 review did not catch it, and the live smoke could not reveal it: macOS's per-user `/var/folders/.../T` hides group/other bits, whereas Linux `/tmp` is 1777. Fixed with an owner-only seal (0500/0400) and a test that walks every node.
2. **Two IMPORTANT recovery gaps came from the measurement reference** (IMPORTANT-1/2). Measuring against the Stage 3 snapshot instead of a baseline taken just before the TV blamed operator hand fixes on the TV and allowed a fallback bypass.
3. **IMPORTANT-3 was approved design** (I-11, sequential skeptics), and it contradicted D-4's intent. Fixed: both start together, and a not-read instruction was added. Blindness is still instruction-only; path enforcement is B-3.
4. **The session accepted a deviation that raised a platform floor** (IMPORTANT-4): `--no-relative` needs git ≥ 2.28. Replaced by `-c diff.relative=false`.
5. **The P-20 caller table missed tests twice**, despite brief §6's 27 rows (D-B2-1, D-B2-3), plus one forced change in the fix round (D-B2-5). The two stops cost ~66 min of visible gaps, part of which was operator time.
6. **The cross-project leak** (session fact, D-B2-4). Editing shared agent contracts on a feature branch changed another project's by-hand factory, because `~/.claude/agents` points into this working tree. B-1's merged builder line had leaked the same way. Cost: an unplanned step (8a), an interrupted builder, and a stopped Aurora build. Pre-Phase-B program-only wording remains in contracts 06/07 (MINOR-7, Phase E).
7. **The S-0 correction did not reach the docs** (MINOR-1).
8. **Duplicate logic reached review again, this time in tests:** six barrier helpers copied verbatim, and real-git setup duplicated in a "no git" file. A test clause that could never fail also reached review.
9. **Docs still overclaimed on the first pass:** 4 of 28 claims were false or misleading ("0700", ripgrep, "blind" skeptics, "stdin closed").
10. **The fix-round code was not mutation-tested.** 48 new tests and the baseline, seal and skeptic changes were reviewed statically but not re-verified by the TV.
11. **Process slips** (session facts): after merging, the session switched this repo to `main` without asking first (reported); the first 8a builder was launched in the same minute as D-B2-4 and had to be interrupted. No unapproved git index command and no attribution slip this time.
12. **Time:** active time ran ~1.7× the brief's plan; ~177 min inside the windows is untimed; operator waiting is still not separated.

## 5. B-1 vs B-2

| Dimension | B-1 | B-2 | What the B-1 patterns changed |
|---|---|---|---|
| Time data | per step, builder and check separated; waits not timed | same; two sittings with an overnight pause | P-14 kept; waits still untimed |
| Research / Story | ran: 9.3 + 8.8 min | reused; entry condition added as AC-157 at CP2 | P-25 applied |
| Mid-run scope additions | 1 (D-7) before CP1 | 1 after CP2 (D-B2-4 → step 8a) | P-24 couldn't apply (scope came mid-build from an incident) |
| Spec / CP2 issues | 23.9 min / 24 issues | 24.5 min / 30 issues, all accepted | — |
| Build steps / failed checks | 11 / 0 (+3 S-steps) | 8 + 8a / 0 after decisions (+3 S-steps) | P-12, P-13 kept |
| Builder minutes vs brief | 123.5 vs 260 (47%) | 135.1 vs 132 (102%) | the B-1 estimate rule was adopted by the brief |
| Existing-test policy stops | 0 | 2 (P-20 gaps) | P-20 table larger, still incomplete |
| Mid-build operator decisions | 2 | 4 (+1 post-re-check ratification) | P-26 kept |
| Suite time at between-step checks | 53–78 s | 85–186 s (most 101–124) | +384 real-git and process tests |
| TV mutations / survivors / gap tests | 103 / 8 / 6 | 166 / 21 (4 equivalent) / 17 | survival 7.8% → 12.7% |
| TV time | 55 min | 102 min | — |
| Validator first pass | PASS 0 C / 1 I / 7 M; 24/26 claims | **FAIL 1 C / 4 I / 8 M; 24/28 claims** | — |
| Follow-up review | 6 SOUND / 5 MINOR | 17 SOUND / 3 IMPORTANT / 8 MINOR | P-17 kept |
| Re-check | 13/13 RESOLVED, 2 NEW-MINOR | 23/23 RESOLVED (1 deferred), 3 NEW-MINOR | P-18 kept |
| Fix round + re-check + final | 24.1 min | 67.7 min (2 builders) | — |
| Validator and TV isolation | rsync copy, 0 / 136 mismatches | rsync copy, 0 / 150 mismatches | P-21 kept |
| Live facts | S-0 git probe, no live agent | S-0 Jest/rg/cat-file probes + S-1 live smoke ($1.42) | P-16 and P-22 applied |
| Tests | 1076 → 1295 | 1295 → 1744 | — |
| Process slips | 4 (+1 tool conversion) | 1 session git action without asking + 1 cross-project leak | P-27 kept; leak is a new class |

## 6. Confidence profile (qualitative)

| Area | Confidence | Basis |
|---|---|---|
| Snapshot extraction (`ls-tree` + `cat-file --batch`, path validation, symlinks last, blob hash check, batch bounds) | High | S-0 probe; C01–C28 caught; C09 and C11 killed by gap tests; 3 equivalents reasoned |
| AC-157 verification-start marker | High | S01–S03 caught; O09 killed by a gap test; SN real-git |
| Parallel T ∥ V, settle-then-decide, throw recording | High | barrier tests; O01, O43, O44 caught; O02/O03b killed by gap tests |
| Review copy: location, seal, intact check, re-extraction | Medium-High | CRITICAL-1 fixed with a node-walking mode test; D-B2-2 digest; O12/O18c gap tests; MINOR-6 root check. **Linux `/tmp` behaviour not run live**; copies accumulate (backlog) |
| Measuring the TV's writes (baseline, test-path rule) | Medium | IMPORTANT-1/2 fixed only in the fix round, with VER tests; reviewed statically, **not mutation-tested**; inherited baseline over-flags (accepted, documented) |
| Skeptics (unanimity to disprove, demote not drop, key echo) | Medium | O21–O28 caught; started together after IMPORTANT-3; blindness is instruction-only until B-3 path enforcement |
| Evaluation records and resume (write-once, kill vs escalation) | Medium-High | S04–S14b caught; MINOR-2 fixed via `previousCopyDirs`; some gap tests use crafted state |
| Typed Stage 4 verdict | High | AC-131 tests; P05c killed by a gap test; fails closed without a verdict |
| Per-call cwd with the real SDK | High (macOS) | S-1 P1–P6 PASS, 0 denials |
| Git portability (`diff.relative=false` on git < 2.28) | Medium | reasoning plus a behaviour test on 2.39.5; never run on an old git |
| Mode-neutral shared contracts | Medium | D-B2-4 guard; contracts grep clean; MINOR-7 wording remains; symlinks still point at the working tree until Phase E |
| SKILL.md / README / ROADMAP truthfulness | Medium | 24/28 true on first pass; 4 fixed; drift test checks phrases, not semantics |
| Full Stage 4 in a live pipeline (TV + copy-based Validator + follow-up + skeptics) | Low-Medium | only the Validator was smoked live; the rest runs on fakes and real git in temp repos |

## 7. Open backlog (as recorded)

- **Phase E:**
  - link `~/.claude/agents` and skills to a stable copy (a clone on `main` or a release tag; D-B2-4, ROADMAP:90);
  - MINOR-7, pre-Phase-B program-only wording in contracts 06 and 07;
  - README restructure (carried over).
- **ROADMAP backlog:** cleanup of review copies in the temp directory, together with the `refs/factory/*` cleanup.
- **B-3:**
  - C5 cost per agent and the GAP-3 budget cap, with skeptic cost counted (D-4, D-19);
  - GAP-5 sandboxing, which would turn skeptic and Validator "do not read" from instruction into enforcement (I-30, IMPORTANT-3 residual);
  - B4 parallel builders;
  - throw recording in `consolidate-run.ts` (I-16).
- **Accepted / documented limits:**
  - an inherited measurement baseline flags other hand fixes in an N-3 window until reverted;
  - measuring before the escalation decision can hide the reason, never the escalation;
  - the B-1 limits (git filter drivers, unborn-repo branch switch, sparse checkout, output after the grace period).
- **Not verified live:** the seal on Linux `/tmp`; `diff.relative=false` on git < 2.28; a full live Stage 4 with skeptics.
- **Not re-verified:** the fix-round code had no mutation pass.
- **Carried from B-1:** pre-A-1 records get 3+n attempts; durable-share re-measure (not done in B-2); AC-13's 10 s cap under load.
- **Process (session facts):** ask before any post-merge branch switch; fix the step-log → OPEN-item gap for probe corrections.

## 8. Time estimate for the next similar run
See `B2_PATTERNS.md`, "Time estimate for the next similar run".

✓ FEATURE CONSOLIDATION COMPLETE
