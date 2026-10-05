# B1_TEST_VERIFIER_REPORT.md: Phase B, PR B-1 (Agent 06, Test Verifier, by hand)

> Saved by the orchestrating session from the Test Verifier's hand-back, 2026-10-05.
> - The prose sections are verbatim. The mutation table is condensed to its result columns; every row is kept.
> - The Test Verifier ran in the real tree, in parallel with the Validator, which read a separate copy.
> - Skills loaded with Read (first Read worked): `test-driven-development.md`, `verification-before-completion.md`.

## Summary

All 37 in-scope criteria (AC-45 revised, AC-80 to AC-115) have tests whose titles carry the AC ID.
- **36 are PROVEN.**
  - 34 were proven by the builders' own tests. Their mutations were caught, or they are static or record checks.
  - AC-80, AC-86 and AC-94 started WEAK. Mutations survived there, and they are now PROVEN by the new gap tests.
  - AC-83 was already proven behaviourally. Its two redundant no-signing settings are now also pinned by a gap test.
- **1 is WEAK, and only in the run record:** AC-103. The durable-write share was measured once, at the baseline, and never re-measured after the change. The story requires both figures to be re-measured. This is not a code defect; it is the session's job.

**No implementation defects found.**

**Mutation testing:**
- 103 valid mutants, plus 3 that did not compile and were redone type-safely.
- 95 were caught by the existing suite.
- 8 survived: M03, M04, M07, M07b, M104, M115, M34b, M34c.
  - 7 of those are now killed by the new gap tests.
  - 1 (M115) is an equivalent mutation: no behaviour can tell it apart from the real code.
- Every mutated file was restored: SHA-256 checked after each run, all 114 runs `restored=true`.

**Final checks:**
- `npm test`: Test Suites 39 passed of 39. Tests: 1 skipped, 1276 passed, 1277 total. Time: 79.695 s.
- `npm run typecheck`: exit 0.
- The skipped test is the existing AC-97 case that only runs on a case-sensitive file system.

## Per-AC results

| AC | Main tests | Mutations | Verdict |
|---|---|---|---|
| AC-45 | snapshot "AC-45 a run from start to an approved CHECKPOINT 3 …"; change-diff "AC-45 a snapshot leaves HEAD, .git/index …"; repo-hygiene "AC-45 AC-80 …" | M06, M06b, M17, M22, M30 | PROVEN |
| AC-80 | repo-hygiene AC-45/AC-80; change-diff AC-80 ×3; **gaps** ×2 (lookalike directory, symlink) | M05, M18, M19, M23, M120, M121 caught; M07, M07b survived → killed by gaps | PROVEN (was WEAK) |
| AC-81 | snapshot AC-81 ×2; checkpoint-presentation AC-81 D-13 | M30, M31, M38, M39, M91 | PROVEN |
| AC-82 | snapshot it.each AC-82 (8 cases); change-diff AC-82 ×4 | M13, M14, M15, M16 | PROVEN |
| AC-83 | change-diff AC-83; **gaps** AC-83 D-1 static | M01, M02 caught; M03, M04 survived (redundant defences) → killed by gaps | PROVEN |
| AC-84 | snapshot it.each AC-84; change-diff AC-84 ×2; checkpoint-presentation AC-84 D-6 | M20, M24, M40, M89b | PROVEN |
| AC-85 | snapshot AC-85 ×4; change-diff AC-85 ×3 | M08, M09, M10b, M32, M91 | PROVEN |
| AC-86 | snapshot it.each AC-86; change-diff AC-86 ×4; **gaps** it.each AC-86 wording | M11, M12, M33, M34 caught; M34b, M34c survived → killed by gaps | PROVEN (was WEAK) |
| AC-87 | snapshot AC-87 ×3; checkpoint-presentation AC-87 | M36, M37, M90 | PROVEN |
| AC-88 | snapshot AC-88; change-diff it.each AC-88 | M35, M41 | PROVEN |
| AC-89 | snapshot AC-89 ×2 | M06b | PROVEN |
| AC-90 | repo-hygiene AC-90; agent-prompts AC-90/AC-91 | M124, M125 | PROVEN |
| AC-91 | repo-hygiene AC-91; agent-prompts AC-90/AC-91; doc-drift AC-91 | M124 | PROVEN |
| AC-92 | execution-gates AC-92 ×2; orchestrator-gates I-10 | M102, M107, M114 | PROVEN |
| AC-93 | execution-gates it.each AC-93 (test, dev); doc-drift AC-93 | M100, M101, M113, M126 | PROVEN |
| AC-94 | execution-gates AC-94 ×2; **gaps** AC-94 beyond the maximum string length | M103 caught; M104 survived → killed by gaps | PROVEN (was WEAK) |
| AC-95 | execution-gates it.each AC-95 (3); createLineScanner ×2 | M105, M106, M107, M108 | PROVEN |
| AC-96 | execution-gates it.each AC-96 (4); unmarked families; AC-8/AC-9 | M109, M110, M111, M112 | PROVEN |
| AC-97 | run-directory AC-97 ×6; cli AC-97 ×2; repo-hygiene AC-97 | M50, M60 | PROVEN |
| AC-98 [L] | `B1_MEASUREMENTS.md` probe (`.Factory/state.json` listed in all 4 commands) | record | PROVEN (record) |
| AC-99 | resume it.each AC-99 ×2; run-lifecycle AC-99 ×3; cli AC-99 | M51, M52, M53, M57 | PROVEN |
| AC-100 | repo-hygiene AC-100 (static, read) | — | PROVEN |
| AC-101 | run-lifecycle AC-101; resume it.each AC-101; cli AC-101 | M54, M55, M56 | PROVEN |
| AC-102 | cli SEC AC-102, AC-102; direction-characters AC-102 ×2 | M58, M59, M74 | PROVEN |
| AC-103 [M] | `B1_MEASUREMENTS.md`: baseline 191 s at an 87% share; re-measured wall clock 53 s and 78 s | record | **WEAK (record): the durable-write share was not re-measured** |
| AC-104 | state-persistence AC-104 ×2; repo-hygiene AC-104 | M123 | PROVEN |
| AC-105 | direction-characters AC-105 ×2; repo-hygiene AC-105 | M70, M71, M72, M122 | PROVEN |
| AC-106 | direction-characters AC-106 ×3 | M70, M71, M72, M73 | PROVEN |
| AC-107 | direction-documents it.each AC-107 (11 documents) plus clean, dedup, pre-supplied, new version and units; repo-hygiene AC-107 | M75, M76, M77, M78, M79 | PROVEN |
| AC-108 | checkpoint-presentation AC-108 ×4; direction-documents AC-108 ×2 | M80, M81, M82, M84, M85, M88 | PROVEN |
| AC-109 | direction-documents AC-109; cli AC-109; repo-hygiene AC-109 | M80, M83 | PROVEN |
| AC-110 | direction-documents it.each AC-110 plus CP1-approved; cli AC-110 | M83, M86b, M87 | PROVEN |
| AC-111 | doc-drift AC-111 | M129 | PROVEN |
| AC-112 | doc-drift it.each AC-112 (8) | M130, M131 | PROVEN |
| AC-113 | doc-drift AC-113 links; AC-60/AC-113 retired claims | M130, M132, M133 | PROVEN |
| AC-114 | doc-drift AC-114 | M128 | PROVEN |
| AC-115 | doc-drift AC-115; the AC-60 test is unchanged | M126, M127 | PROVEN |

## Mutation results (condensed)

- **Caught (95):**
  - **Snapshot and git plumbing:** M01, M02, M05, M06, M06b, M08, M09, M10b, M11–M24.
  - **Orchestrator snapshots:** M30–M34, M35–M41.
  - **Lifecycle, CLI and `.Factory`:** M50–M60.
  - **Direction characters, document check and presentation:** M70–M91 (including M86b, M89b).
  - **Gate 2:** M100–M103, M105–M114.
  - **Guards:** M120–M125.
  - **Docs drift:** M126–M133.
- **Survived, then killed by gap tests (7):**

  | ID | Location | Mutation |
  |---|---|---|
  | M03 | change-diff.ts:514 | drop `--no-gpg-sign` |
  | M04 | change-diff.ts:126 | drop `-c commit.gpgSign=false` |
  | M07 | change-diff.ts:160 | the index guard drops "directly under os.tmpdir()" |
  | M07b | change-diff.ts:162 | the index guard accepts a symlinked directory |
  | M34b | orch:1202 | the "Restore HEAD …" instruction dropped |
  | M34c | orch:2347 | `describeHead` "detached" replaced by the raw branch |
  | M104 | execution-gates.ts:378 | the tail is never trimmed (memory is unbounded, but the text is still correct) |
- **Equivalent (1):** M115, execution-gates.ts:780, where the SKIPPED condition drops `!timedOut`. A timed-out command always has `exitCode` null, so the two can't be told apart.
- **Did not compile, then redone type-safely (3):** M10, M86, M89.

## Gap tests added

One new file: `factory/test/harness/b1-acceptance-gaps.test.ts` (6 tests). No existing file was modified.
1. "AC-80 git() refuses add or write-tree when GIT_INDEX_FILE is in a factory-snapshot- directory that is not directly under the temp directory". Kills M07.
2. "AC-80 git() refuses add or write-tree when GIT_INDEX_FILE is in a symlink named like the snapshot directory, directly under the temp directory". Kills M07b. This is the dangerous case, because a symlink could point into `.git/`.
3. it.each "AC-86 HEAD_MOVED names the recorded and current HEAD (%s) and tells the operator to restore HEAD to the recorded branch and commit, or to close the run". Two cases. Kills M34b and M34c.
4. "AC-83 D-1 commit-tree always carries --no-gpg-sign and every git call carries -c commit.gpgSign=false" (static). Kills M03 and M04.
5. "AC-94 a stream longer than the longest string the runtime can hold is kept bounded, with the marker, and nothing throws". Kills M104. Unbounded concatenation fails with "Invalid string length" at push 511 of 600.

How the gap tests were checked:
- Each was seen GREEN on the real code and RED under its mutation.
- No real git runs when the code is correct.
- Only shared fixtures are used, and there is no `agent: '0N-'` literal.
- The hidden-character scan found 0 hits.

## Defects in the implementation

None.

## Observations

1. **AC-103 record is incomplete.** The fsync-off run should be repeated at the final state, and the share recorded.
2. **AC-83:** on git 2.39, `commit-tree` ignores `commit.gpgSign`. Both no-signing defences are invisible to a live test, so they are now pinned statically.
3. **AC-94:** nothing showed that the memory bound held until the gap test.
4. **M115 is equivalent.**
5. **Leftover temp directories from mutation M17:** 12 `factory-snapshot-*` directories in `$TMPDIR` (each holds only a temp-repo `index`), left at 15:27. The session should remove them. Final runs on the real code left none.
6. **Shared-tree exposure:** each mutation was live for 2–96 s. The Validator worked on a separate copy.
7. **Not tested, outside the ACs:** `GIT_NAMESPACE` is not stripped.

## Checksum proof

- The session's list (136 files under `factory/`): a fresh `shasum -a 256 -c` gives **0 mismatches**. The only new file is `b1-acceptance-gaps.test.ts`.
- The Test Verifier's own pre-mutation checksums of 13 doc files outside `factory/`: **0 mismatches**.
- All 114 mutant runs report `restored=true`.

## Test execution

- `npm test`, final: 39 suites passed. Tests: 1 skipped, 1276 passed, 1277 total. Time: 79.695 s.
- `npm run typecheck`: exit 0.
- **Time:** about 15:10–16:05 (about 55 minutes). Mutation runs took about 38 minutes of that.

**Status: PASS.**
