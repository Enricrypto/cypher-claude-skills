# B2_VALIDATION_FOLLOWUP.md: scoped review of the Test Verifier's added tests (PR B-2)

> Agent 07 (Validator), run by hand, read-only, 2026-10-06. Saved by the orchestrating session; the findings are verbatim and the per-test reasons condensed.
> - **Skill:** `code-review-excellence.md`, loaded on the first Read.
> - **Scope:** `factory/test/harness/b2-acceptance-gaps.test.ts` (17 tests).
> - Static review: no tests or git run.

**Checks across the whole file:**
- No `agent: '0N-'` literal, and no byte above 0x7F.
- Real git runs only in `mkdtemp` projects, and every temp folder is cleaned up; sealed copies are unsealed before removal.
- No sleeps: every wait is a barrier with a 10 s timeout.

## Per test

| # | Test (file:line) | Mutant | Verdict |
|---|---|---|---|
| 1 | AC-124: both throw; the run escalates on T's error (:113-144) | O02 | SOUND (minor: the order assertion rests on microtask hops) |
| 2 | AC-124 D-8: T FAIL decided before V's schema failure (:146-159) | O03b | SOUND |
| 3 | AC-157: the start marker is on disk before the copy (:166-189) | O09 | SOUND (minor: repeats the fake's write) |
| 4 | AC-126: pre-B-1 run, working-tree copy with the pre-B-1 reason (:196-222) | O68 | SOUND |
| 5 | AC-123: re-extract from the recorded snapshot (:229-264) | O12 | SOUND (crafted state; guards a future regression) |
| 6 | AC-132: the copy is re-extracted before the skeptics (:271-305) | O18c | SOUND |
| 7 | AC-133 I-11: only SKEPTIC_REVIEW.md is kept (:312-336) | O35 | **IMPORTANT**: kills O35, but its "VALIDATION_REPORT.md is untouched" clause can never fail |
| 8 | AC-117 D-15: a round-2 claim inside the FIRST copy fails Gate 1 (:343-365) | O41b | SOUND (minor: an `expect` inside the builder script) |
| 9 | AC-121 I-6: a Stage 4 gate failure invalidates 07b (:372-393) | O53 | SOUND (minor) |
| 10 | AC-123 D-12: a CP3 rework supersedes VALIDATION_FOLLOWUP.md (:395-421) | O54, O54b | SOUND (minor) |
| 11 | AC-117 D-1: sha256 repository (:451-470) | C09 | SOUND, but in the wrong file (IMPORTANT-2); no git-version guard |
| 12 | AC-117 D-1: two 40 MiB blobs take two requests (:472-504) | C11 | SOUND, but in the wrong file (IMPORTANT-2); about 160 MiB written |
| 13 | AC-122 D-10: mergeIssues never maps a follow-up path (:513-523) | V04 | SOUND |
| 14 | AC-121 I-29: same size, different files (:525-530) | V12 | SOUND |
| 15 | AC-117 D-15: relative claim resolved against cwd (:532-539) | R19 | SOUND |
| 16 | AC-126 I-5: exclusions in any letter case (:541-567) | R04 | SOUND (minor) |
| 17 | AC-131: the Stage 4 context carries the counts (:569-580) | P05c | SOUND |

**Result:** all 17 tests kill their named mutant. 16 assert exactly the mechanism their title names; test 7 has one clause that cannot fail.

## Findings (no CRITICAL)

**FOLLOWUP-IMPORTANT-1** (:312, :335): test 7's "VALIDATION_REPORT.md is untouched" clause cannot fail.
- **Why:** the round-2 Validator re-persists the report with the same fixture text.
- **Fix:** do both of these:
  - give the intruder a unique name (for example `INTRUDER.md`) and assert it is absent;
  - capture the report's content inside the round-2 Validator script, before it returns, and assert it equals round 1's.
- **Alternative:** have both skeptics DISPROVE, so no round runs.

**FOLLOWUP-IMPORTANT-2** (:6, :425-505): tests 11 and 12 run real git in a file whose header says "no git", against the convention that only change-diff.test.ts and snapshot.test.ts run git. Their setup duplicates `change-diff.test.ts:871-890` and its helpers (`hashBlob`, `mktree`, `snapOf`).
- **Fix:** move both tests into change-diff.test.ts's `extractSnapshot` describe, reuse its hooks and helpers, and drop the imports that become unused.

**FOLLOWUP-IMPORTANT-3** (:61-98): `signal`, `within`, `until`, `onDisk`, `evaluations` and `BARRIER_MS` are verbatim copies of `verification.test.ts:64-101`.
- **Fix:** move them to a shared fixture, for example `fixtures/barriers.ts`, with `onDisk` added to `harness-run.ts`, and import them in both files.

**FOLLOWUP-MINOR-1** (:116-142): test 1's order assertion rests on microtask hop counts.
- **Fix:** add a barrier, or compare the two records as an unordered set.

**FOLLOWUP-MINOR-2** (:170-176): the `extract` override repeats the fake's default write.
- **Fix:** export a `writeFakeCopy(dest)` from `fixtures/changes.ts` and use it in both places.

**FOLLOWUP-MINOR-3:** the crafted state needs clearer comments.
- Test 5: say its state cannot arise today, so it is a guard for the future.
- Test 4: also strip `changeBase.branch` and `preExisting`, or note why they do not matter.

**FOLLOWUP-MINOR-4** (:351-352): there is an `expect` inside the builder script.
- **Fix:** capture the value and assert it after the run.

**FOLLOWUP-MINOR-5:**
- (:376) the `n === 1` branch is never taken: use the fixed entry.
- (:413) `onDisk()` can be undefined: assert it is defined first.

**FOLLOWUP-MINOR-6** (:453): `--object-format=sha256` needs git 2.29 or later.
- **Fix:** probe once in `beforeAll` and skip, or fail with "requires git ≥ 2.29".

**FOLLOWUP-MINOR-7** (:476-503): the batch test writes about 160 MiB and holds about 120 MiB in buffers at once.
- **Fix:** compare by hash or by size plus a few spot bytes. Correct the figure in the report.

**FOLLOWUP-MINOR-8:**
- (:543-544) the second `mkdtempSync` runs before the `try`;
- the literals `'07c-validator-skeptic'` and `'07-validator'` are used although the file defines `VAL`: add a `SKEPTIC` constant and use the constants throughout;
- (:17, :23) two separate imports from `verification`: merge them.

## Verdict

- All 17 tests kill their mutant and are deterministic, with complete cleanup.
- IMPORTANT-1 to IMPORTANT-3 are should-fix-before-merge. MINOR-1 to MINOR-8 are hardening.

**Status: PASS** (no CRITICAL).
