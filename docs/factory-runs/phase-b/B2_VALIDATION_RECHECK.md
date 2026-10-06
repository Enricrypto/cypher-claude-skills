# B2_VALIDATION_RECHECK.md: PR B-2, scoped re-check of the CHECKPOINT 3 fix round

> Agent 07 (Validator), run by hand, read-only, 2026-10-06. Saved by the orchestrating session; the findings and judgements are verbatim and the evidence is condensed.
> - Static review of the real tree. The session ran the suite: 1743 passed + 1 skipped (1744); typecheck clean.
> - Skills loaded (first Read): `code-review-excellence.md`, `security-audit.md`.

**Verdict: PASS.**
- All 23 items in scope are RESOLVED: CRITICAL-1, IMPORTANT-1 to -4, MINOR-1 to -6 and -8, FOLLOWUP-IMPORTANT-1 to -3, FOLLOWUP-MINOR-1 to -8.
- MINOR-7 is DEFERRED to Phase E by decision.
- New findings: 0 CRITICAL, 0 IMPORTANT, 3 NEW-MINOR.
- All 14 deviations are acceptable.

## Per item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | CRITICAL-1 (world-readable seal) | RESOLVED | review-copy.ts:51-53 (0o500/0o500/0o400); `sealReadOnly` :209-226 seals every directory, every file and the root last, skipping symlinks; the 0700 mkdtemp root until the seal; tests RCT:490-494 (approved change) and :503-526 (walks every node, `mode & 0o077 === 0`, owner can read); SKILL.md:330-335; cleanup unseals first |
| 2 | IMPORTANT-1 (hand fix blamed on the TV) | RESOLVED | `recordBaseline` (orch:2190-2211) is committed at :2209, before `branchT` (:2310); the measurement runs after `allSettled`, whatever the branches returned (:2312-2317); write-once recorder (ST:1408-1429); tests VER:999, :1032, :1050, :1071, :1117 |
| 3 | IMPORTANT-2 (fallback bypass) | RESOLVED | the fallback baseline is the pre-TV copy (orch:2206-2207), compared only when intact; `earlierBaseline` carries over an uncleared baseline (verification.ts:290-302); I-28 also applies once a baseline exists (orch:2054-2056); test VER:1085 |
| 4 | IMPORTANT-3 (skeptic B can read A) | RESOLVED, within the design limit | started in the same tick (orch:2521-2522), each committed as it returns; the not-read instruction is in the prompt (AP:500) and contract 07c:12, pinned at APT:506; SKILL.md:410-411 states it is instruction-only; tests SKP:329, SKP:376 |
| 5 | IMPORTANT-4 (git 2.28 floor) | RESOLVED | `diff.relative=false` in SAFE_GIT_CONFIG (CD:192-195); `--no-relative` gone (CDT:1410-1420); behaviour test kept (CDT:1402); no minimum git in SKILL.md |
| 6 | MINOR-1 | RESOLVED | SKILL.md:323-329, Jest reason only |
| 7 | MINOR-2 | RESOLVED | `previousCopyDirs` (ST:1389-1400), used by Gate 1 (orch:1230-1234), `mergeIssues`, `standingIssues` and `escalatedReviewFindings`; tests VER:1224, :1238; VLT:851, :864 |
| 8 | MINOR-3 | RESOLVED | `currentReworkCycle` moved to run-progress.ts:297; the import goes one way only; whole-harness cycle test VLT:905 |
| 9 | MINOR-4 | RESOLVED | pure functions in verification.ts:241-340; the orchestrator only delegates |
| 10 | MINOR-5 | RESOLVED | `finish` (orch:663-667), also reached from the outer catch; deduplicated; test VER:1147; SKILL.md:543-544 |
| 11 | MINOR-6 | RESOLVED | `reviewRootProblem` (review-copy.ts:381-386), checked before `createReviewDir` (orch:2067-2070); tests RCT:836-853, VER:1179 |
| 12 | MINOR-7 | DEFERRED | Phase E backlog |
| 13 | MINOR-8 | RESOLVED | SKILL.md:251-253 stdin wording; DD AC-115 title |
| 14 | FOLLOWUP-IMPORTANT-1 | RESOLVED | b2-gaps:279-321: `INTRUDER.md` and a fake report; the report is read inside round 2 before its own persist; asserted at :319-320 |
| 15 | FOLLOWUP-IMPORTANT-2 | RESOLVED | moved to change-diff.test.ts's `extractSnapshot` describe (:1078, :1098), using its hooks and helpers; the C11 assertions kept |
| 16 | FOLLOWUP-IMPORTANT-3 | RESOLVED | `fixtures/barriers.ts`; `onDisk` and `evaluations` in harness-run.ts; no copies left |
| 17-24 | FOLLOWUP-MINOR-1 to -8 | RESOLVED | unordered compare; `writeFakeCopy`; comments and stripped fields; post-run asserts; fixed entry and `onDisk` defined; sha256 probe and skip; size plus spot bytes; mkdtemp in `try`, constants, merged imports |

## Deviations judged (all acceptable)

1. **`diff.relative=false` for every call:** sound. The CP3 diff and `preExistingPaths` pass `--relative` explicitly, which overrides the config. Other subcommands are unaffected. No AC-89 regression.
2. **`previousCopyDirs` on the evaluation:** sound.
3. **MINOR-6 refuses only a root inside the project:** correct. A project inside the root is safe, because each copy is a new mkdtemp directory directly under the root.
4. **The follow-up reviews the whole cycle's test files:** needed. Without the union, an earlier run's tests would never be reviewed.
5. **An inherited baseline also flags other hand fixes in an N-3 window:** acceptable. It fails closed, is documented, and re-baselining instead would reopen IMPORTANT-2.
6. **The measurement runs before the escalation decision:** no harmful outcome change. It can only escalate earlier, never turn an escalation into a pass. What it can hide is only the reason (throws are still recorded, and failed agents re-run on resume). The T-before-V order holds when the measurement is clean.
7. **MINOR-5 on every escalated exit:** sound, and duplicates are dropped.
8. **One skeptic fails, the other is still recorded:** sound. No lost updates, nothing left running, resume runs only the missing instance, and the escalation order is fixed.
9. **SKILL.md keeps "git ≥ 2.28":** accurate.
10. **The fake's `workingTreeId`:** test-only and documented.
11-13. **The test 7 rewrite, the moved real-git tests, the shared fixtures:** sound.
14. **The forced assertion change at `agent-prompts.test.ts:400`:** fine on substance (an exact `toContain` of the new sentence), but not in the approved list (NEW-MINOR-3).

**The not-read rule being instruction-only:** acceptable, and SKILL.md says so explicitly. README:55's "two blind skeptics" is qualified by SKILL.md.

**The D-B2-4 guard holds** for contracts 04-07. Contract 08's new wording is mode-neutral.

## New findings

- **NEW-MINOR-1** (agent-prompts.ts:381-382): `testPathRule` still says the harness compares "with the snapshot the Validator reviews". Since IMPORTANT-1 it is measured against the pre-Test-Verifier baseline. No test pins these lines. Low impact.
- **NEW-MINOR-2** (state-tracker.ts:192-193): the `MeasurementBaseline` comment says a baseline is carried over only when the earlier measurement failed. It is also carried over after a measurement that found a change outside a test path.
- **NEW-MINOR-3:** the forced assertion change at `agent-prompts.test.ts:400` should be ratified by the operator in B_DECISIONS.md, as D-B2-1 did for :162.

## Housekeeping and security

- No invisible characters anywhere in the repo. No stray files.
- `inputValidated` and `noHardcodedSecrets` are true; the CRITICAL-1 exposure is closed. `authImplemented`, `sqlInjectionProtected` and `xssProtected` are not applicable. No issues.

## Summary

0 critical / 0 important / 3 minor (NEW-MINOR-1 to -3). **Status: PASS.**
