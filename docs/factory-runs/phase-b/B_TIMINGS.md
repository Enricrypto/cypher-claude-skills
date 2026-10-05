# Phase B — timings

> Recorded by the orchestrating session as each step completes (pattern P-14).
> Active = agent or session working; waiting = waiting on the operator.

| Date | Step | Actor | Active (min) | Waiting (min) | Notes |
|---|---|---|---|---|---|
| 2026-10-05 | Researcher, all of Phase B | 01 researcher (by hand) | 9.3 | — | 94 tool calls; status PASS. Duration from the agent result (559,928 ms) |
| 2026-10-05 | Pre-story decisions | Operator | — | not timed | 4 decisions + B1 isolation reversed; see `B_DECISIONS.md` |
| 2026-10-05 09:03 | Branch `feat/phase-b1-commit` created from `main` (0b3ce27) | Session | — | — | |
| 2026-10-05 | Bidi fix in `B_RESEARCHER_REPORT.md:205` | Session | <1 | — | A literal U+202E replaced by the visible text `\u202E`; led to D-7 |
| 2026-10-05 09:14 | Story Writer, draft 1 | 02 story-writer (by hand) | 6.0 | — | 5 tool calls; PASS; AC-80..150 + AC-45 (revised). Duration 359,156 ms |
| 2026-10-05 | Story revision 1 | 02 story-writer | 2.8 | — | 1 tool call; PASS; AC-80..156 + AC-45 (revised); D-7 (a) added as TX group; N-2/N-3/N-8/N-13 decided. Duration 167,003 ms. Bidi scan of USER_STORY.md: clean |
| 2026-10-05 10:06 | CHECKPOINT 1 approved | Operator | — | not timed | USER_STORY.md sha256 7a05811e53bc9b4886c17c67ab8357605dc3df183c448072708068c990a005d2 |
| 2026-10-05 | Spec Writer, PR B-1 brief and file list | 03 spec-writer (by hand) | 23.9 | — | 94 tool calls; PASS; 11 builder steps + 3 session steps, 24 issues. Duration 1,435,730 ms. Bidi scan of both files: clean |
| 2026-10-05 10:45 | CHECKPOINT 2 (B-1) approved | Operator | — | not timed | brief sha256 4b4c87cc1f0816a817392fcbda2b90b0846aaf3344eb93dce316372354024002; file list sha256 58597ad7fdd370b568f2262462582681847cfd2c79ef60be33ce7a7d17e6d1cb |
| 2026-10-05 10:47–10:54 | S-0: AC-98 probe + AC-103 baseline | Session | 7.5 | — | probe: .Factory NOT excluded (AC-97 required); suite 191 s durable vs 25 s fsync-off → 87% → step 10 adopted |
| 2026-10-05 11:18–11:23 | Step 10 (moved first): test-only state writer | 04 backend-builder + session check | 4.5 + 2 | — | 32 tool calls; 1079 tests; suite 191 s → 53 s |
| 2026-10-05 11:40–11:46 | Step 1: .Factory refusal (AC-97) | 04 backend-builder + session check | 4.8 + 1 | — | 26 tool calls; 1090 tests (1 skipped: case-sensitive FS only) |
| 2026-10-05 11:49–12:07 | Step 2: git snapshot plumbing (AC-80, AC-83) | 04 backend-builder + session check | 16.2 + 1.5 | — | 52 tool calls; 1114 tests (+24) |
| 2026-10-05 12:10–12:32 | Step 3: orchestrator snapshots | 04 backend-builder + session check | 17.3 + 4 | — | 69 tool calls; 1151 tests (+37); one EG dev-test flake under load (builder run 1), 3 later runs green |
| 2026-10-05 12:36–12:41 | Step 4: builder contracts and prompt (AC-90, AC-91) | 04 backend-builder + session check | 3.1 + 1.5 | — | 24 tool calls; 1154 tests (+3) |
| 2026-10-05 12:53–13:19 | Step 5: Gate 2 fixes (AC-92..96) + dev-test flake fix | 04 backend-builder + session check | 25 + 2 | — | 48 tool calls; 1171 tests (+17); EG test file 17 s → 34 s |
| 2026-10-05 13:20–13:32 | Step 6: lifecycle and CLI (AC-99..101, D-B1-2) | 04 backend-builder + session check | 11 + 2 | — | 56 tool calls; 1191 tests (+20) |
| 2026-10-05 13:33–13:42 | Step 7: direction-character set + terminal escaping (AC-102, 105, 106) | 04 backend-builder + session check | 7.6 + 1.5 | — | 40 tool calls; 1219 tests (+28) |
| 2026-10-05 13:43–13:55 | Step 8: document check (AC-107) | 04 backend-builder + session check | 10.5 + 1.5 | — | 57 tool calls; 1241 tests (+22) |
| 2026-10-05 14:26–14:36 | Step 9: checkpoint presentation (AC-108..110) | 04 backend-builder + session check | 9.4 + 1.5 | — | 40 tool calls; 1257 tests (+16) |
| 2026-10-05 14:42 | S-1: 8 git mv to docs/archive/feature-{docs,reference}/ | Session | 1 | — | staged R100 x8 |
| 2026-10-05 14:44–15:06 | Step 11: docs + drift test (AC-111..115) | 04 backend-builder + session check | 14.1 + 1.5 | — | 91 tool calls; 1271 tests (+14) |
| 2026-10-05 15:06 | S-2: final checks + AC-103 re-measure (78 s) | Session | 1.5 | — | BUILD COMPLETE: 1076 → 1271 tests; suite 191 s → 78 s |
| 2026-10-05 15:13–15:23 | Validator (on the read-only copy, ∥ TV) | 07 validator | 10.3 | — | 71 tool calls; PASS: 0 CRITICAL / 1 IMPORTANT / 7 MINOR; 26 doc claims, 24 true |
| 2026-10-05 15:13–16:05 | Test Verifier (real tree, ∥ Validator) | 06 test-verifier | 55 | — | 103 mutants: 95 caught, 7 killed by 6 new gap tests, 1 equivalent; 0 defects; 1277 tests |
| 2026-10-05 16:08–16:11 | Follow-up review of the TV gap tests | 07 validator (scoped) | 2.8 | — | 6 tests SOUND; 5 FOLLOWUP-MINOR; PASS |
| 2026-10-05 16:13–16:27 | CP3 fix round (IMPORTANT-1, MINOR-1..7, FOLLOWUP-1..5) + session checks + AC-103 re-measure | 04 backend-builder + session | 9.3 + 4.5 | — | 58 tool calls; 1291 tests (+14); durable share 87% → 47% |
| 2026-10-05 16:28–16:32 | Re-check of the fix round | 07 validator (scoped) | 3.9 | — | 13/13 RESOLVED; 2 NEW-MINOR; residual (TV crash) → B-2; PASS |
| 2026-10-05 16:49–16:56 | NEW-MINOR-1/2 + ROADMAP B-2 condition | 04 backend-builder + session check | 4.9 + 1.5 | — | 1295 tests (+4) |
