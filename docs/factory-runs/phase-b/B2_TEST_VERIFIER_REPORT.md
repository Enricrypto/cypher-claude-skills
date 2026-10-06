# B2_TEST_VERIFIER_REPORT.md: Phase B, PR B-2 (Agent 06, Test Verifier, by hand)

> Saved by the orchestrating session from the Test Verifier's hand-back, 2026-10-06. The prose and tables are verbatim; the "caught by the existing suite" list is condensed to its IDs.
> - It ran in the real tree, in parallel with the Validator, which read a separate copy. It ran no git command on this repo.
> - Skills loaded (first Read): `test-driven-development.md`, `verification-before-completion.md`.

**Status: PASS.** No implementation defects were found. All 20 in-scope ACs (AC-116 to AC-134, plus AC-157) and both decision checks (D-B2-2 digest, D-B2-4 guard) are now PROVEN. Eight of the ACs only reached PROVEN after the Test Verifier added gap tests.

## Summary

- **Mutation testing:** 166 valid mutants.
  - 145 were caught by the existing suite.
  - 21 survived:
    - 17 are now killed by new gap tests;
    - 4 are equivalent or unreachable.
  - 11 more mutants did not compile. Each was redone type-safely, and only the redone versions are counted.
  - Every mutated file was restored, sha256-checked after each of the 199 runs: all `restored=True`.
- **New file:** `factory/test/harness/b2-acceptance-gaps.test.ts`, with 17 tests. Each passes on the real code and fails under the mutant it was written for. No existing file was edited.

## Per-AC results

| AC | Main tests | Mutations | Verdict |
|---|---|---|---|
| AC-116 | VER AC-116 barrier timeline | O59, O60 caught | PROVEN |
| AC-117 | SN AC-117 (real git); CDT it.each AC-117 extract and refusals, batches, symlinks last; VER AC-117 Gate 1; RCT seal/map/inside; **gaps:** sha256 repo, 64 MiB batches, relative claim, earlier copy at Gate 1 | C01–C28 caught except C09 and C11; R08–R11, R16–R18, R20, R23 caught; R19 and O41b survived. All four survivors now killed by gaps | PROVEN (was WEAK) |
| AC-118 | VER AC-117 AC-118 (`call.cwd`) | O08, P06 caught | PROVEN |
| AC-119 | RH AC-119 (static) | — | PROVEN (static) |
| AC-120 | APT AC-120; VER AC-120 | P08 caught | PROVEN |
| AC-121 | VER it.each AC-121 (three outcomes), N-3 escalation, I-29; RCT isTestPath ×44; CDT changedSince ×4; **gaps:** I-29 same-size set, Stage 4 gate invalidates 07b | T01–T08, C21–C24, O05–O07, O64, O31–O34, O36, O39b–d, V12 all caught; O53 survived, now killed by a gap | PROVEN (was WEAK) |
| AC-122 | VER AC-122; CPT AC-122 ×2; VLT merge/findings; **gap:** follow-up paths never mapped | O29, O30, O30b, P01, P02, V02, V03, V05, V14 caught; V04 survived, now killed by a gap | PROVEN (was WEAK) |
| AC-123 | VER it.each AC-123, re-extract, follow-up never overwrites; **gaps:** re-extract from the recorded source; CP3 rework supersedes the follow-up document | O11b, O56, O57, S05–S07 caught; O12, O54, O54b survived, now killed by gaps | PROVEN (was WEAK) |
| AC-124 | VER it.each AC-124 (TV FAIL, VAL ESCALATE, TV throws); I-16; **gaps:** both throw (T before V); TV FAIL before V schema | O01, O43, O44 caught; O02, O03b survived, now killed by gaps | PROVEN (was WEAK) |
| AC-125 | VER AC-125 ×2; SKP round case | O31 caught | PROVEN |
| AC-126 | VER AC-126 (not git); RCT copyWorkingTree; I-28; **gaps:** pre-B-1 reason, case-insensitive exclusions | R01–R03b, R05, R06, R21, R22, R24, O13b caught. The pre-B-1 branch had **no test**: O68 survived and is now killed. R04 survived and is now killed | PROVEN (was MISSING on one branch) |
| AC-127 | DD AC-127 ×2; ARG; AOST; DDOC it.each AC-107 | (static) | PROVEN |
| AC-128 | SKP it.each AC-128 (first pass, round); IMPORTANT/MINOR; APT blindness | O21, O24, O25 caught | PROVEN |
| AC-129 | VLT it.each; SKP split verdict | V06b, V07, V08 caught | PROVEN |
| AC-130 | SKP AC-130 | O26, O27, O28 caught | PROVEN |
| AC-131 | SGT it.each; SKP AC-131; SC AC-131; **gap:** standing count carried | O47, P04b, P05, P05b, V09 caught; P05c survived, now killed | PROVEN |
| AC-132 | ARG tools; SKP AC-132; invoke-agent ×2; RH cwd; **gap:** skeptic reads a re-checked copy | O17, O18, O18b, P06 caught; O18c survived, now killed | PROVEN (was WEAK) |
| AC-133 | SKP AC-133; VLT write-once ×3; **gap:** only the schema-named skeptic document is kept | O19, O20, O67, S04, S06–S10b caught; O35 survived, now killed | PROVEN |
| AC-134 | SKP it.each AC-134 (5 cases) | O22, O23 caught | PROVEN |
| AC-157 | SN AC-157 (real git) and unit row; VER AC-157; **gap:** start marker on disk before the copy | S01, S02, S03 caught; O09 survived, now killed | PROVEN (was WEAK) |
| D-B2-2 digest | RCT D-B2-2 ×8; CDT; VER count mismatch | R12, R13, R14, R15, R15b, O14b caught | PROVEN |
| D-B2-4 guard | RH D-B2-4, AC-90, AC-91; APT | P09–P13 caught | PROVEN |

## Mutation results

**Caught by the existing suite (145), by file:**
- change-diff: C01, C02, C04, C05, C07, C08, C10, C12b, C13, C14, C14b, C16, C19–C25, C27, C28
- review-copy: R01–R03b, R05, R06, R08–R18, R20–R24
- test-paths: T01–T08
- verification: V01–V03, V05, V06b, V07–V15
- state-tracker: S01–S14b
- orchestrator:
  - O01, O05–O08, O10, O11b, O13b–O16;
  - O17–O34, O36, O38, O39b–d, O41, O43, O44, O47, O52, O56–O60, O64, O67;
  - P01–P15 (CPR, RP, SG, invoke-agent, UA, AP, contracts, smoke-validator, reviewRoot).

**Survived the existing suite, now killed by a gap test (17):**

| ID | file:line | Mutation | Gap test |
|---|---|---|---|
| C09 | change-diff.ts:698 | blob hash always sha1 | AC-117 D-1 sha256 repository |
| C11 | change-diff.ts:669 | 64 MiB batch bound raised to 1 GiB | AC-117 D-1 two 40 MiB blobs take two requests |
| R04 | review-copy.ts:75 | exclusions compared case-sensitively | AC-126 I-5 any letter case |
| R19 | review-copy.ts:342 | relative claim resolved against process.cwd | AC-117 D-15 relative claim |
| V04 | verification.ts:89 | follow-up paths mapped out of the copy | AC-122 D-10 follow-up never mapped |
| O02 | orch:2248 | rejected branches rethrown V before T | AC-124 both throw |
| O03b | orch:2251/2270 | V schema decided before T verdict | AC-124 D-8 TV FAIL first |
| O09 | orch:2016 | evaluation start not committed | AC-157 start on disk before copy |
| O12 | orch:2051 | re-extract from latest snapshot, not the recorded one | AC-123 recorded source |
| O18c | orch:2388 | skeptic uses the recorded copy without copyIntact | AC-132 copy re-checked before skeptics |
| O35 | orch:2430 | skeptic artifacts not filtered | AC-133 only SKEPTIC_REVIEW.md kept |
| O41b | orch:1219 | Gate 1 checks only the latest copy | AC-117 earlier copy at Gate 1 |
| O53 | orch:1831 | Stage 4 gate failure does not invalidate 07b | AC-121 I-6 invalidates follow-up |
| O54 | orch:368 | INVALIDATED_ON_REWORK[3] without 07b | AC-123 D-12 CP3 rework |
| O54b | orch:356 | SUPERSEDED_ON_REWORK[3] without VALIDATION_FOLLOWUP.md | AC-123 D-12 CP3 rework |
| O68 | orch:2031 | fallback reason always "not a git work tree" | AC-126 pre-B-1 run |
| P05c | stage-context.ts:495 | standing count forced to 0 | AC-131 counts carried |

**Equivalent or unreachable (4):**
- **C06** (change-diff.ts:692): the absolute-path check is dropped. An absolute path always has an empty first segment, which another check already refuses.
- **C20b** (change-diff.ts:722): the blob size `-` check is dropped. `ls-tree -l` always gives a blob's size.
- **C24b** (change-diff.ts:649): the tree id format check is dropped. The rev-parse round-trip already requires a full hex id.
- **O46** (orch:715): the "evaluated, none decided → no verdict" fallback goes to legacy. No orchestrator path reaches the Stage 4 gate in that state.

**Did not compile, then redone type-safely (11):** C12, V06, S09, S10, S14, O03, O11, O13, O14, O39, P04.

## Defects in the implementation

None.

## Observations

1. **Real git in the gap file.** Two gap tests (sha256 extraction and the 64 MiB batch) run real git in temp repositories. The convention is that only change-diff.test.ts and snapshot.test.ts run git; no guard enforces it. The batch test writes 80 MiB to temp for about 1.2 s and removes it.
2. **Crafted state.** Tests 4 and 5 use crafted state:
   - test 4 strips `stage3Snapshots` and `validatorEvaluations` to imitate a pre-B-1 record;
   - test 5 adds a later written snapshot.
   
   In normal runs the "recorded source" and the "latest snapshot" are the same, which is why the existing AC-123 test could not tell them apart.
3. **Untested defensive branches:** C06, C20b, C24b and O46 cannot be reached.
4. **sha256 repositories** are experimental in git 2.39, but extraction and measurement worked end to end there.
5. **Mutations ran in the real tree.** Each was live for 6–90 s, about 85 minutes in total. The Validator worked on a separate copy.

## Checksum proof

- `shasum -a 256 -c` against the session's 150-entry list: **150 OK, 0 mismatches**.
- **Expected difference:** one new file, `factory/test/harness/b2-acceptance-gaps.test.ts` (581 lines).

## Temp leftovers

None from this session. Three directories already in `$TMPDIR` were not created by the Test Verifier:
- the S-1 copy, left by design;
- `ff-resume-6Id1lv` and `ff-resume-Icb5vU`, dated Oct 4.

## Counts and test execution

- **`npm test`, final run:** 45 suites; 1695 passed + 1 skipped = 1696 (1679 + 17). Time 112.7 s.
- **`npm run typecheck`:** exit 0.
- **Timing:** 08:23–10:05 (about 102 minutes; mutation runs about 85).

**Status: PASS.**
