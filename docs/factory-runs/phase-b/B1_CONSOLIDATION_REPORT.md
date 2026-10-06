# B1_CONSOLIDATION_REPORT.md — Phase B, PR B-1 "Snapshots, Gate 2 fixes, lifecycle, invisible characters, docs"

> Agent 08 (Feature Consolidator), by hand, read-only. 2026-10-05. PR B-1 (#6) was merged to `main` at 0e64c6d.
> Sources: `docs/factory-runs/phase-b/{B_RESEARCHER_REPORT, B_DECISIONS, USER_STORY, B1_TECHNICAL_BRIEF, B1_FILE_LIST, B1_BUILD_NOTES, B1_MEASUREMENTS, B_TIMINGS, B1_TEST_VERIFIER_REPORT, B1_VALIDATION_REPORT, B1_VALIDATION_FOLLOWUP, B1_VALIDATION_RECHECK}.md`, `docs/ROADMAP.md`, the A-2 baseline (`docs/factory-runs/phase-a/A2_*.md`, `A1_PATTERNS.md`), facts from the orchestrating session (marked "session fact"), and spot checks of the merged code.
> Saved verbatim by the orchestrating session from the Consolidator's hand-back, with one change. The hand-back contained a real invisible U+202E character in §4, item 3. The session replaced it with the visible text "U+202E" (the D-7 scan-after-save rule).

**Limits:**
- **Timings.** They are the session's wall-clock figures from `B_TIMINGS.md`. The harness's `agentInvocations` record doesn't apply, because this run was by hand.
- **Builder time vs session-check time.** These are separated per step, as recorded.
- **Operator waiting time was not timed anywhere in this run.** The `B_TIMINGS.md` "Waiting" column says "not timed" or "—" throughout. So no work/wait split is possible.
- **Untimed time.** The 09:03–16:56 window is 473 min, of which 269 min was timed after the branch was created. The other ~204 min includes:
  - operator review at CP1, CP2 and CP3, and waits mid-build;
  - the session writing prompts and build notes, and saving and scanning reports.
  
  It can't be attributed further.
- **Confidence** is qualitative.

**Where the records disagree (minor, flagged and not reconciled):**
1. **Test Verifier start and length.** The TV report says "about 15:10–16:05 (about 55 minutes)". `B_TIMINGS` says 15:13–16:05 (a 52-min window), with 55 active.
2. **Step 9 test delta.** The build notes say "+15". `B_TIMINGS` says +16 (1241 → 1257).
3. **Step 7 test delta.** The build notes say "+27". `B_TIMINGS` says +28 (1191 → 1219).
4. **Step 8.** The builder couldn't trace one of its +22 tests.
5. **Step windows vs active plus check time.** These are minute-granularity, so a 1–1.5 min mismatch is possible:
   - step 10: a 5-min window vs 6.5 min;
   - step 5: 26 vs 27;
   - step 6: 12 vs 13.
6. **Between-step suite time.** Session fact: ~53–85 s. The recorded runs are 53–78 s during the build and 82 s (durable) after the fix round.
7. **AC-103 verdict.** The Validator marked it PASS. The Test Verifier marked it WEAK (record): the durable share was measured only at the baseline. It was resolved by the re-measure in the fix round (87% → ~47%).
8. **The brief contradicted itself on `HARNESS_GAP_ANALYSIS.md`.** I-17 gives it a "superseded" line; D-16 doesn't. The build notes flagged it OPEN, and it became Validator MINOR-1.

## 1. What happened

| Stage | Agent / actor | Outcome | Iterations |
|---|---|---|---|
| Research | 01 Researcher | PASS, 94 tool calls, 9.3 min. Found 10 points; several recommendations later superseded by `B_DECISIONS` (B1 isolation direction, budget cap, docs scope). Its hand-back contained a literal U+202E | 1 |
| Pre-story decisions | Operator | D-1..D-6 and a split of Phase B into 3 PRs; B1 isolation reversed (D-5). **Scope added mid-run: D-7**, invisible direction characters (group TX), plus the scan-after-save process rule (D-7 b); D-8 answered N-2/3/8/13 | — |
| Story | 02 Story Writer | Draft 1 (AC-80..150 + AC-45 revised), then revision 1 (AC-80..156; TX added). B-1 scope: AC-45 and AC-80..115 (37 ACs). Bidi scan clean | 2 drafts (1 revision) |
| CP1 | Operator, 10:06 | Approved with hash 7a05811e…; 3 existing-assertion changes pre-approved (D-6) | — |
| Spec | 03 Spec Writer | 23.9 min, 94 tool calls. D-1..D-17; 11 builder steps + 3 session steps; 24 issues; FILE_LIST 16 CREATE / 8 MOVE / 30 MODIFY / 0 DELETE | 1 |
| CP2 | Operator, 10:45 | All 24 accepted. I-2 assertion change approved. I-19 answered (Phase D = README diagram, done; it was missing from the decisions, a session error) | — |
| S-0 | Session | AC-98 probe: `.Factory/` is NOT excluded by `:(exclude).factory` under any `core.ignorecase`, so AC-97 is required. AC-103 baseline: 191 s durable vs 25 s with fsync off = **87%**, which adopts AC-104. **D-B1-1: step 10 moved first** | 1 |
| Build | 04 Backend Builder ×11 (fresh per step) | Tests 1076 → 1271; **0 failed session checks; 0 existing-test policy stops**; all assertion changes were pre-approved. 1 flake under load (step 3; fixed in step 5, setup-only). 3 fixtures created outside FILE_LIST (accepted). Frontend Builder not needed | 11 steps |
| Mid-build decisions | Operator | D-B1-1 (step order). D-B1-2: the CLI calls `.Factory` refusal before `findRun`. The session first read it from a "yes" to step 2; the operator then confirmed it explicitly, "step 6 YES" | 2 |
| S-1 / S-2 | Session | 8 `git mv` (staged as R100); final checks; AC-103 re-measured at 78 s | — |
| Test verification | 06 TV, real tree (∥ 07) | 103 valid mutants: 95 caught, 8 survived; 7 killed by 6 gap tests (`b1-acceptance-gaps.test.ts`), 1 equivalent (M115). 0 defects. AC-80/86/94 went from WEAK to PROVEN; AC-103 WEAK (record). 1277 tests | 1 |
| Isolation | Session (session fact) | The Validator read an rsync'd read-only copy (no `.git`/`node_modules`/`.factory`, `chmod a-w`). Checksums of 136 `factory/` files taken before verification: **0 mismatches** after. The Validator never saw a mutation | — |
| Validation | 07 (∥ 06), on the copy | PASS: 0 CRITICAL / 1 IMPORTANT / 7 MINOR. 26 doc claims checked, 24 true | 1 |
| Follow-up review | 07, scoped to the TV's added tests | 6 SOUND, 5 FOLLOWUP-MINOR | 1 |
| CP3 | Operator, 16:13 | Fix round: IMPORTANT-1, MINOR-1..7 (MINOR-6 accepted and documented), FOLLOWUP-1..5. Session items: AC-103 re-measure, and deleting 12 leftover `factory-snapshot-*` temp dirs from M17. Backlog: pre-A-1 records get 3+n attempts | 1 fix round |
| Re-check | 07 | 13/13 RESOLVED; 2 NEW-MINOR; a residual (TV crash) became the **binding entry condition for B-2**. 1291 tests | 1 |
| Final small fix | 04 + session | NEW-MINOR-1/2 fixed and the ROADMAP B-2 condition added; 1295 tests | 1 |
| Delivery | Operator | PR #6 merged after CI verify (1m5s). Process slips (session facts) are in §4 | — |

## 2. Time profile (wall clock)

| Unit | Agent (min) | Session (min) | Estimate in brief (min) |
|---|---|---|---|
| Researcher | 9.3 | — | — |
| Bidi fix in the researcher report | — | <1 | — |
| Story Writer: draft 1 + revision 1 | 6.0 + 2.8 | — | — |
| Spec Writer | 23.9 | — | — |
| S-0: probe + baseline | — | 7.5 | 10 |
| Step 10: `stateWriter` seam (moved first) | 4.5 | 2 | 15 |
| Step 1: `.Factory` refusal | 4.8 | 1 | 15 |
| Step 2: git snapshot plumbing | 16.2 | 1.5 | 30 |
| Step 3: orchestrator snapshots | 17.3 | 4 | 40 |
| Step 4: builder contracts and prompt | 3.1 | 1.5 | 15 |
| Step 5: Gate 2 + flake fix | 25 | 2 | 30 |
| Step 6: lifecycle and CLI | 11 | 2 | 20 |
| Step 7: character set + terminal | 7.6 | 1.5 | 15 |
| Step 8: document check | 10.5 | 1.5 | 20 |
| Step 9: checkpoint presentation | 9.4 | 1.5 | 30 |
| S-1: 8 `git mv` | — | 1 | 5 |
| Step 11: docs + drift test | 14.1 | 1.5 | 30 |
| S-2: final checks + re-measure | — | 1.5 | 10 |
| **Build subtotal** | **123.5** (mean 11.2/step, range 3.1–25) | **30** (20 checks + 10 S-steps) | 260 builder + ~35 session |
| Verification: TV 55 ∥ Validator 10.3 | 55 elapsed (65.3 agent-min) | — | — |
| Follow-up review | 2.8 | — | — |
| CP3 fix round | 9.3 | 4.5 | — |
| Re-check | 3.9 | — | — |
| NEW-MINOR fix + ROADMAP | 4.9 | 1.5 | — |
| **Total timed** | **241.4** | **36.5** | — |
| **Active total** | **~278 min (~4 h 38 m)** | | brief: "plan about 5 h" |
| Operator waiting | **not timed** | | |

| Part | Minutes | Share of active |
|---|---|---|
| Build (builders 123.5 + session checks 20 + S-steps 10) | 153.5 | ~55% (builders alone ~44%) |
| Verification (TV ∥ Validator, follow-up) | 57.8 | ~21% |
| Research + Story + Spec (+ bidi fix) | ~42.5 | ~15% |
| Fix round + re-check + final fix | 24.1 | ~9% |

**Not included:**
- the operator's review time at CP1, CP2 and CP3, and all waiting;
- untimed between-step time. The build window 10:47–15:06 is 259 min, of which 153.5 was timed. Visible gaps: 10:54–11:18 (24 min, around D-B1-1), 11:23–11:40 (17), 13:55–14:26 (31).

**Where time went:**
- **Builders ran at 47% of the brief's estimate** (123.5 of 260 min).
  - Every step came in under its estimate. The largest gaps were step 3 (17.3 vs 40), step 9 (9.4 vs 30) and step 2 (16.2 vs 30).
  - Step 5 (Gate 2, plus a flake fix the brief didn't plan) came closest (25 vs 30).
  - Likely causes (inference, not measured):
    - builders ran only their step's tests;
    - the suite was 2.5–3.6× faster after step 10;
    - the build notes carried exact APIs and line numbers forward.
- **Moving step 10 first cut between-step checks.** The suite went from 191 s to 53–78 s, and session checks averaged 1.8 min.
  - Estimated saving: ~11 checks × (191 − ~70) s ≈ 22 min of suite time. This is an estimate: step 3 ran the suite twice, and the TV's runs aren't included.
- **Verification is now bound by the Test Verifier**: 55 min, about 38 of them on mutation runs. That is 2.3× A-2's 24 min, for 103 mutants vs 54. The Validator took 10.3 min.
- **Tests:** 1076 → 1079 → 1090 → 1114 → 1151 → 1154 → 1171 → 1191 → 1219 → 1241 → 1257 → 1271 (build) → 1277 (TV gaps) → 1291 (fix round) → 1295 (final fix).
- **Durable-write share** of suite time: 87% → ~47% (82 s durable, 43.5 s with fsync off). fsync calls: 8,672 → 2,388.

## 3. What worked

1. **The B1 isolation, done by hand** (session fact).
   - The Validator reviewed a read-only rsync copy; the TV mutated the real tree.
   - Checksums of 136 `factory/` files gave 0 mismatches after verification, and all 114 mutant runs report `restored=true`.
   - The Validator never saw a mutation. That closes A-2 anti-pattern 1, where the session had to re-confirm findings against real code.
2. **A session step (S-0) before the builders.**
   - The live probe turned AC-97 from "defensive" into "required": `core.ignorecase` does not affect the exclude pathspec.
   - The baseline (87%) settled the conditional step 10 by the CP2 threshold (I-20, ≥20%).
   - The operator then moved step 10 first (D-B1-1).
3. **Build notes (P-12) a second time:** 11 steps, 0 failed session checks. RULE/OPEN items were carried with an owning step, for example:
   - step 3's orchestrator comment, owned by step 11;
   - the RH AC-105 importer tightening, from step 7 to step 9;
   - the `save()`-only rule for steps 3 and 8.
4. **The P-20 caller list and assertion changes pre-approved at CP1** (D-6, I-2).
   - **0 existing-test policy stops** (A-2: 3).
   - No assertion decision went to the operator mid-build (A-2: 2).
   - The step 3 → 5 flake was handled setup-only, with no assertion changed.
5. **Builders ran their own mutation checks** in steps 2, 3, 5, 6 and 8, so only 8 of 103 TV mutants survived (7.8%; A-2: 5 of 54, 9.3%).
6. **The scoped review chain held:**
   - Validator + follow-up + re-check;
   - all 13 fix items RESOLVED;
   - both NEW-MINORs fixed before merge (A-2 backlogged one).
7. **The re-check's residual became a binding B-2 entry condition** (`B_DECISIONS`; ROADMAP:57-62), not a backlog line.
8. **The scan-after-save rule** (D-7 b) caught the real invisible characters that tool parameters had put into two run documents (session fact).
9. **Hidden-character scans at every step check from step 7 on**: all clean.

## 4. What didn't work, or cost extra

1. **IMPORTANT-1**, a design gap: on a Stage 4 resume during an active rework, the rework's Stage 3 gate was re-run and `stage3-<k>` was re-taken with the TV's files in it. It was harmless in B-1 but latent for B-2. Fixed with the `stage3SnapshotPassedBy` predicate (state-tracker.ts:1123, orch:2178).
2. **A residual that wasn't fixed:** a crash or SDK error *during* the TV leaves no invocation record, so the rework snapshot can still be re-taken. Deferred to B-2 as a binding AC (verification-started marker).
3. **Process slips** (session facts):
   1. A builder ran a read-only `git for-each-ref` on the repo, breaking the no-git-by-builders rule (reported by the builder; the rule was restated).
   2. The session ran an unapproved `git add -N .` + `git reset -q`, which unstaged the S-1 renames. No content was lost, and rename tracking was unachievable anyway once pointers existed at the old paths. Reported at CP3.
   3. Tool parameters turned a typed U+202E escape into the real invisible character in two run docs (caught by the scan rule). A builder hit the same thing in a `node -e` one-liner (command only, no file).
   4. The session's first commit carried a Claude co-author trailer. The operator's rule: commits are OK, but never Claude/Claude Code as co-author, and no Claude attribution in PRs. It was amended before push.
4. **A flake under load** (EG dev-server tests, 1.5 s windows) at step 3, fixed at step 5. It costs +17 s on `execution-gates.test.ts`. Residual: AC-13's `elapsed < 10_000` took 7.0 s under heavy load.
5. **Planning gaps in the brief:**
   - FILE_LIST missed 3 fixtures (`state-writer.ts` was listed; `real-git.ts` and `factory-case-variant.ts` were not; build notes count all three as additions);
   - I-17 vs D-16 left `HARNESS_GAP_ANALYSIS.md` unassigned (MINOR-1);
   - the builder-time estimate was ~2× too high.
6. **Duplicate logic reached review** despite the non-negotiable: the dedup-and-log logic (MINOR-3) and the `OBJECT_ID` regex (MINOR-4).
7. **Docs still overclaimed:**
   - "the run escalates" on `--consolidate` (MINOR-2);
   - "500 names" when the cap is per stream, and "always changes the hash" (MINOR-7);
   - the new rework rule was undocumented (NEW-MINOR-1).
   
   The drift test checks phrases, not semantics.
8. **AC-103 was measured only at the baseline** until the TV flagged it.
9. **Mutation leftovers:** M17 left 12 `factory-snapshot-*` directories in `$TMPDIR`. The session removed them.
10. **Verification time doubled** (TV 55 min), and ~204 min of the day is untimed and can't be attributed. Operator waiting isn't separated.

## 5. A-2 vs B-1

| Dimension | A-2 | B-1 | What the A-2 patterns changed |
|---|---|---|---|
| Time data | per step, waits separated; between-step checks untimed | per step, builder and session check separated; **waits not timed** | P-14 applied to session checks; regression on waits |
| Research / Story | reused from A-1 | ran: 9.3 + 8.8 min, 1 story revision | — |
| Mid-run scope additions | 0 | 1 (D-7, TX group) + 1 process rule | entered via a story revision before CP1 |
| Spec / CP2 issues | 20 min / 19 issues | 23.9 min / 24 issues, all accepted | P-20 caller table in brief §6 |
| Build steps / failed checks | 11 / 0 | 11 / 0 (+3 session steps) | P-12, P-13 kept |
| Builder minutes | 196 (mean ~18) | 123.5 (mean 11.2) | faster suite (C-26); step-scoped test runs |
| Existing-test policy stops | 3 | 0 | P-20 + CP1 pre-approval |
| Mid-build operator decisions | 2 (D-A, D-B) | 2 (D-B1-1, D-B1-2) | P-15 kept |
| Suite time at between-step checks | ~180 s | 53–78 s | S-0 measurement; step 10 first |
| TV mutations / survivors / gap tests | 54 / 5 / 5 | 103 / 8 (1 equivalent) / 6 | P-7 kept, wider |
| TV time | 24 min | 55 min | — |
| Validator first pass | 0 C / 1 I / 8 M; 20/22 claims true | 0 C / 1 I / 7 M; 24/26 claims true | — |
| Follow-up review | 5 SOUND / 5 MINOR | 6 SOUND / 5 MINOR | P-17 kept |
| Re-check new MINOR | 2 (1 fixed, 1 backlog) | 2 (both fixed before merge) | P-18 kept |
| Validator and TV mutations | shared tree (anti-pattern 1) | **isolated copy, 0 mismatches** | P-17 isolation applied |
| Live facts | S-1 agent smoke ($1.21) | S-0 git probe + suite measurement; no live agent call | P-16 applied to git behaviour |
| Tests | 471 → 1076 | 1076 → 1295 | — |
| Process slips | 2 | 4 (+1 builder tool conversion) | new git/attribution rules (P-27) |

## 6. Confidence profile (qualitative)

| Area | Confidence | Basis |
|---|---|---|
| Snapshot primitive (temp index guard, plumbing, CAS, hooks/signing off) | High | AC-45 byte check on `.git/index`; M05, M18–M23, M120/121 caught; M07/M07b killed by gap tests; Validator traced; MINOR-5 env stripping fixed |
| Snapshot lifecycle across resume (phase key, kill window, rework) | Medium | IMPORTANT-1 found and fixed; [O] test of the rework kill window added (NEW-MINOR-2); the residual (crash during the TV) is open until B-2 |
| HEAD_MOVED / SNAPSHOT_FAILED escalation | High | M33/M34 caught; M34b/M34c killed by gap tests; all three `describeHead` wordings tested |
| Gate 2 (bound, scanner, per-stream summary, group kill, dev SKIPPED) | High | M100–M114 caught; M104 killed by a gap test that exceeds the maximum string length; M115 equivalent |
| Gate 2 timing under load | Medium-High | flake fixed with 5 s/30 s windows; AC-13 at 7.0 s against a 10 s cap under load |
| `.Factory` case-variant refusal | High | live probe (AC-98); M50/M60 caught; CLI guard before `findRun` |
| Lifecycle: library-owned description refusals, MINOR-8 inference | High | M51–M57 caught; RH AC-100 pins the CLI shapes; pre-A-1 3+n attempts in backlog |
| Direction-character set and terminal escaping | High | one module; RH bans other spellings; M70–M74, M122 caught |
| Checkpoint escaping and hash-what-was-shown | Medium-High | M80–M88 caught; not injective (MINOR-7, wording fixed); pre-B-1 runs refused with `--close` |
| Document read-back check | High | M75–M79 caught; fails closed on a non-regular file; MINOR-6 accepted and documented |
| Suite-time seam (`stateWriter`) | High | measured 87% → ~47%; RH: production never passes it |
| SKILL.md / README / ROADMAP truthfulness | Medium-High | 24/26 true on first pass; 3 doc fixes after review |
| Snapshots in a live factory run | Medium | real git only in temp repos in tests; no live run of the pipeline in B-1 |
| Verification isolation as harness behaviour | Low (not built) | done by hand in B-1; harness isolation is B-2 (D-5) |

## 7. Open backlog (as recorded)

- **B-2, binding entry condition:** record a "verification started" marker, or the TV's start, before invoking the TV, so that `stage3SnapshotPassedBy` holds after a crash or SDK error. The alternative is to treat a `written` rework entry as final. Source: `B1_VALIDATION_RECHECK.md` residual; `B_DECISIONS.md`; ROADMAP:57-62.
- **B-2 scope:** B1 parallel verification from the snapshot ref (~23 agent-order test updates expected, D-5); B5 Skeptic.
- **CP3 backlog:** a record from before A-1 with no `builderAttempts` gets 3+n attempts from `--grant-attempts n`. Whether such records exist is unverified.
- **ROADMAP backlog:** cleanup of `refs/factory/*`. Refs accumulate and may hold a stray non-ignored `.env`.
- **Accepted / documented limits:**
  - A-2 MINOR-3 git filter drivers (revisit at git ≥ 2.42);
  - I-6 a branch switch on an unborn repo goes undetected;
  - sparse-checkout files are absent from snapshots;
  - output after the 2 s grace is lost;
  - MINOR-6 a pre-B-1 CP3 finding can appear after approval.
- **Test residuals:** AC-13's 10 s cap (7.0 s under load); durable share still ~47% (direct `runFeatureFactory` callers, durable by design).
- **Moved earlier to Phase C:** A-2 MINOR-4/5, the spec gate's existence-only check, the A-2 test-style follow-ups.
- **Phase E:** the README status table and restructure.
- **B-3:** C5 cost per agent, GAP-3 budget cap, GAP-5 sandboxing, B4 parallel builders.
- **Process (session facts):** git rename tracking can't be kept when a pointer file replaces the moved file. Future archive moves should expect add + modify, not R100.

## 8. Time estimate for the next similar run
See `B1_PATTERNS.md`, "Time estimate for the next similar run".

✓ FEATURE CONSOLIDATION COMPLETE
