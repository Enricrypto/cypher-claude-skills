# B2_VALIDATION_REPORT.md: Phase B, PR B-2 (Agent 07, Validator, by hand)

> Saved verbatim by the orchestrating session from the Validator's hand-back, 2026-10-06. It ran in parallel with the Test Verifier, from 08:22, on a read-only rsync copy of the working tree (`scratchpad/b2-review-copy`, 300 files).
> Static review: no tests run, no git. Paths are relative to the copy root, which matches the repo.
> Skills loaded (first Read): `code-review-excellence.md`, `security-audit.md`.

## Summary verdict

**FAIL: 1 critical, 4 important, 8 minor.**

Every AC in scope (AC-116 to AC-134, plus AC-157) has code and a test whose title names it.

Most of the core is sound:
- Extraction validates paths, writes symlinks last, checks the destination and checks every blob hash.
- The parallel branches never call `finish` and lose no state updates. `allSettled` leaves no agent running, and throws are recorded.
- Evaluation slots are write-once, and a kill and an escalation resume differently, as designed.
- A disproved CRITICAL is never dropped, the Stage 4 gate fails closed without a verdict, and the CP3 hash covers the follow-up document.
- AC-157's marker is committed before the Test Verifier runs.

The one CRITICAL is a security gap that comes from a contradiction in the approved brief: sealing the copy makes the 0700 review directory readable by every user. Two IMPORTANT findings are recovery and fail-closed gaps in how the Test Verifier's changes are measured.

## Critical

**CRITICAL-1: sealing the review copy makes it readable by every user, so the "0700 directory" that brief §11 relies on for secrets is not true. The fallback copy also includes gitignored secrets.**
- **Where:**
  - `factory/harness/review-copy.ts:46-48`: `SEALED_DIR_MODE = 0o555`, `SEALED_EXEC_MODE = 0o555`, `SEALED_FILE_MODE = 0o444`.
  - `:220`: `chmodSync(root, SEALED_DIR_MODE)` replaces mkdtemp's 0700.
  - The test pins it: `factory/test/harness/review-copy.test.ts:489-493`.
- **What happens:**
  - After `sealReadOnly`, the copy root is `r-x` for group and others, and every file is world-readable.
  - On Linux, `os.tmpdir()` is `/tmp` (mode 1777), so any local user can read every review copy. The copies are never deleted.
  - On macOS the per-user `/var/folders/.../T` parent hides this, which is why S-1 did not show it.
  - The fallback copy (`review-copy.ts:74-77`, `:121-152`) applies no `.gitignore` rules (I-5), so it copies a gitignored `.env` on purpose, not just "a stray non-ignored one".
- **Why it blocks:** the secrets surface is PRESENT, and §11's only mitigation is "a kept 0700 temp directory". The brief contradicts itself (D-3 seals directories 0555; §11 says 0700), and the build followed D-3. `SKILL.md:319-320` repeats the false "0700" claim.
- **Fix:**
  - Seal owner-only: directories and executables 0o500, files 0o400.
  - Add a test that `mode & 0o077 === 0` for the root, directories and files.
  - Change `review-copy.test.ts:489-493`. This is an assertion change, so it needs operator approval.
  - Correct SKILL.md.

## Important

**IMPORTANT-1: after any first-pass escalation, a hand fix to a non-test file is blamed on the Test Verifier, and the run cannot continue.**
- **Where:**
  - `feature-factory-orchestrator.ts:2177-2212`: `measureTestVerifier` always diffs against `copy.source.tree`, the Stage 3 or rework snapshot.
  - `:2242` and `:1992-2002`: every resume after an escalation runs a new first pass.
  - `change-diff.ts:647`.
- **What happens:**
  1. Gate 1.5, Gate 2 or the Test Verifier fails, and the run escalates.
  2. The operator fixes `src/x.ts` or `package.json` by hand and resumes. (In Phase A this was the only way out, because these failures still escalate.)
  3. The new first pass measures against the snapshot, sees the fix, and escalates "06-test-verifier changed … outside a test path … Revert them or close the run".
  4. Reverting the fix brings back the original failure, so the only exit is `--close`.
  
  Test tooling output that is not gitignored (for example Playwright's `test-results/`) is blamed the same way.
- **Why it matters:**
  - It takes away the resume path for Stage 4 failures.
  - It names the wrong culprit.
  - Brief §8 assumed manual edits would only show at CP3.
- **Fix:**
  - Before the Test Verifier is invoked in each evaluation, record a measurement baseline (the working tree's tree id from `workingTree`, or a fingerprint in fallback mode) and commit it with the evaluation. Measure against that baseline.
  - Also measure when the Test Verifier's verdict fails, so its non-test writes are caught in the evaluation that made them.

**IMPORTANT-2: in fallback mode (AC-126), the N-3 rule can be bypassed after an escalation.**
- **Where:** `orchestrator:2051-2064` (the I-28 check looks only at `invocation.evaluation === e`) and `:2077-2079`.
- **What happens:**
  1. The run has no snapshot (non-git, or started before B-1).
  2. In e1 the Test Verifier changes `src/foo.ts` and then fails (verdict or schema), or the Validator's schema fails. The run escalates before the measurement.
  3. On resume, e2 makes a fresh working-tree copy that already holds the Test Verifier's change. The e2 measurement finds nothing, and the change is never flagged.
  4. For a non-git run, CP3 shows only the files the builders claimed, so a human never sees it either.
- **Fix:** either one of these closes the gap:
  - extend I-28 from one evaluation to the whole cycle: once a 06 invocation exists in this cycle, reuse the cycle's first fallback copy if it is intact, otherwise escalate `REVIEW_COPY_FAILED`;
  - or measure even when the Test Verifier fails (part of the IMPORTANT-1 fix).

**IMPORTANT-3: the skeptics are blind only through their prompts. Skeptic B can read skeptic A's verdict.**
- **Where:** `orchestrator:2380-2443` (A's document is persisted and A's verdict committed to `state.json` before B is invoked). `upstream-artifacts.ts:106` (every prompt names the run directory). Contract `07c-validator-skeptic.md:12` ("Neither of you ever sees the other's verdict").
- **What happens:**
  - For a follow-up-origin issue, B's working directory is the project, so Grep for the issue key finds `.factory/<id>/SKEPTIC_E<e>_<key>_A.md` and `state.json`.
  - For a main-origin issue, B can still read those files by absolute path (I-30).
- **Why it matters:** AC-128's literal wording ("neither prompt contains") holds. D-4's intent, "neither sees the other's verdict", does not.
- **Fix:**
  - Tell both skeptics, in the prompt and the contract, not to read `state.json` or any `SKEPTIC_*` document.
  - Preferably, start A and B together for each issue, so neither can read the other's recorded verdict when it starts. Record each verdict as it returns.

**IMPORTANT-4: `--no-relative` raises the minimum git to 2.28 for every git run, though it doesn't need to.**
- **Where:** `change-diff.ts:644`. `SKILL.md:228-231` documents the floor.
- **What happens:** with git older than 2.28 (Ubuntu 20.04 ships 2.25, Debian 10 ships 2.20), every first pass escalates `REVIEW_COPY_FAILED`.
- **Fix:**
  - Drop `--no-relative` and pass `-c diff.relative=false`. Git older than 2.28 ignores the unknown key and has no `diff.relative` to narrow anything, so this is the same defence on every version.
  - Keep the test at `change-diff.test.ts:1268`.
  - Remove the floor from SKILL.md.
  - The deviation's goal was right; the mechanism was not.

## Minor

- **MINOR-1 `SKILL.md:321-323`:** it still gives "ripgrep (the Grep tool) skips a gitignored `.factory/`" as a reason. S-0 showed this is false when the working directory is the copy (`B2_MEASUREMENTS.md:23-32`). Drop the clause.
- **MINOR-2 `verification.ts:66-70`, `orchestrator:1217-1221`:** the known limit.
  - After a re-extraction, the Validator's absolute paths into the old copy no longer map. Each such issue gets a new key, its skeptic pair re-runs, and the run escalates `NOT_OWNED`. It fails closed and recovers after one escalation.
  - The Gate 1 guard also sees only each evaluation's latest copy directory.
  - Fix: keep the replaced directories on the copy record and map and guard through all of them, or store the mapped issues when the Validator's output is recorded.
- **MINOR-3 `run-progress.ts:42-44` and `verification.ts:26`:** an import cycle that only bites at run time. It is safe today but fragile. Moving `currentReworkCycle` into run-progress removes it.
- **MINOR-4 orchestrator:** some decision logic is not unit-testable on its own and can only be reached through [O] runs:
  - `evaluationKind` (`:1992-2002`);
  - the verdict choice in `stage4Evidence` (`:711-726`);
  - the `TestVerifierChanges` classification (`:2193-2199`).
  
  Move them into `verification.ts` as pure functions.
- **MINOR-5 `orchestrator:2155-2169`, `:2251-2280`:** this deviates from brief D-8 ("recorded in branch V"). When a first pass escalates after the Validator's output was recorded, its IMPORTANT issues stay in `validatorEvaluations[e]` and never reach `importantFindings` or CP3. Impact is low, because the Validator re-runs on resume.
- **MINOR-6 `orchestrator:508`, `review-copy.ts:121-152`:** nothing checks that the review root is outside the project. If `TMPDIR` is inside the project, or the project contains it:
  - the copies land in the CP3 change, the snapshots and Jest's test run;
  - `copyWorkingTree` copies its own destination into itself until it fails.
  
  Refuse with `REVIEW_COPY_FAILED` in that case.
- **MINOR-7 contracts 06 and 07:** some program-only wording from before Phase B is still there:
  - `06:78`: "the harness renders TEST_REPORT.md";
  - `07:81`: "the harness writes it… the Stage 4 gate requires this document".
  
  So "04-07 mode-neutral" is true only for what B-1 and B-2 added. That is acceptable under D-B2-4's "from now on only"; it belongs in the Phase E backlog.
- **MINOR-8 doc nits:**
  - `SKILL.md:248` says every git call runs with "stdin closed", but `cat-file --batch` now pipes stdin (`change-diff.ts:274-275`). "Nothing waits for input" is still true.
  - The DD AC-115 test title still says "PR B-1".

## AC traceability

| AC | Code | Test (title names the AC) | Verdict |
|---|---|---|---|
| 116 | orch `evaluate` :2230-2284 (`allSettled` :2246); `validatorLoop` :2484-2627 | VER :187 (barrier) | Met |
| 117 | CD `extractSnapshot` :797-869, `treeLeaves` :705; orch :2047-2099; Gate 1 :1215-1234 | SN :1033; CDT :969, :999, :1018, :1197; VER :249, :295 | Met |
| 118 | orch :2113 (no cwd), :2157 (`cwd: copy.dir`); IA :199 | VER :249; RH :773 | Met |
| 119 | CD `GitSubcommand` :157 | RH :509 | Met |
| 120 | AP `validatorPrompt` :405-428; UA 07 uses `AFTER_BUILD` | APT :219; VER :330 | Met |
| 121 | orch :2177-2212, :2314-2360; CD `changedSince` :647; test-paths :44 | VER :688, :831, :841; RCT :175; CDT :1241-1299 | Met (see IMPORTANT-1 and IMPORTANT-2) |
| 122 | verification `mergeIssues` :81; orch :2544-2545; CPR :145-171 | VER :898; CPT :217 | Met |
| 123 | orch :2009-2020, :2049, :2243; ST :1376-1426 | VER :379, :407, :867 | Met |
| 124 | orch :2244-2249; `timedInvoke` :796-823 | VER :466 | Met |
| 125 | orch :2233-2236, :2316 | VER :506, :535 | Met |
| 126 | orch :2026-2033, :2077-2079; `copyWorkingTree` :121 | VER :567; RCT :307, :337 | Met (IMPORTANT-2 after an escalation) |
| 127 | AR; SKILL.md; contracts 07b and 07c | DD :535, :605; DDOC :315 | Met |
| 128 | orch :2377-2448; AP `skepticPrompt` :477 | SKP :101, :130 | Met as worded (IMPORTANT-3) |
| 129 | `verdictOf` :107-126 | VLT :243; SKP :154 | Met |
| 130 | orch :2562-2564; `disprovedFinding` :129 | SKP :171 | Met |
| 131 | SG :731-765; SC :489-497; orch :711 | SGT :468; SKP :202 | Met |
| 132 | AR `AGENT_TOOLS`; orch :2386-2395 | ARG :116; SKP :241 | Met |
| 133 | ST :1429-1454; orch :2381-2384 | SKP :277; VLT :425 | Met |
| 134 | orch :2399-2426; AOS :826-842 | SKP :361 | Met |
| 157 | ST :1234-1246; orch :2016, :2812 | SN :298, :1108; VER :708 | Met |

## Decisions and deviations judged

- **D-1 to D-20:** all honoured. The exceptions are the D-3 / §11 mode contradiction (CRITICAL-1) and D-8's place for recording findings (MINOR-5). The I-n answers accepted at CP2 are honoured.
- **The `evaluationKind` rule:** sound for every resume path: a kill, a Stage 4 gate failure or a rework, after a round fix, after a decided or an escalated first pass.
- **CP3 follow-up flag from the latest first pass:** sound. Using the current cycle would change after approval and break the I-7 re-check.
- **I-13 before the follow-up:** sound. The outcome is the same and one 07b call is saved.
- **The run-progress ↔ verification import cycle:** acceptable for now (MINOR-3).
- **`--no-relative` and git ≥ 2.28:** the goal is right, the mechanism is wrong (IMPORTANT-4).
- **The known limit after re-extraction:** it fails closed, which is acceptable (MINOR-2).
- **The name `recordValidatorFindings`:** fine. It is pinned at RH :762 and records both origins.
- **D-B2-1 and D-B2-3:** genuine gaps in the brief's list of affected tests (P-20).
- **D-B2-2 (the digest):** sound.
- **D-B2-4:** sound.
  - Every moved rule is in a program prompt: builder (AP :347-349), Test Verifier (`testPathRule` :378-390), Validator (:416-420).
  - RH :296-341 now checks AC-90 and AC-91 on the prompts. This supersedes the story's AC-90 wording, which the operator approved.
- **The step-2 to step-7 deviations:** all sound:
  - the extra path refusals;
  - `discardReviewDir`, which removes only a directory that was never recorded;
  - the wider fallback exclusions;
  - the `RangeError` guards in the prompts;
  - saving only the document the schema names.
- **Extras outside the file list:** all justified: contracts 04, 05 and 08 (D-B2-4, and the S-2 approval), `invoke-agent.test.ts`, `real-git.ts`, `checkpoint-lifecycle.test.ts` (D-B2-3), and the CLI test cleanup.

## Doc claims checked

28 claims checked: 24 true, 4 false or misleading.

| Claim | Where | Status |
|---|---|---|
| "0700 directory" | SKILL.md :319-320 | False (CRITICAL-1) |
| "ripgrep skips a gitignored `.factory/`" | SKILL.md :323 | Misleading (MINOR-1) |
| "two blind instances" / "Neither of you ever sees" | SKILL.md :373; 07c :12; README :55 | Not enforced (IMPORTANT-3) |
| "stdin closed" | SKILL.md :248 | Out of date (MINOR-8) |

Everything else matches the code: the version line, the 10-agent count, the table rows, the git subcommand list, the AC-157 rule, the evaluation kinds, the copy, its re-extraction, the fallback, Gate 1, the order, the test-path rule, the follow-up, the merge, the skeptics, the decision, CP3, `REVIEW_COPY_FAILED`, the known limit, resume semantics, throw recording, Validation Passed, the README diagram and tools table, and the ROADMAP B-2 and backlog entries.

## Security surface (brief §11)

- **userInput:**
  - `ls-tree` paths are validated (empty, absolute, `..`, `.git` in any case, duplicates, a path inside another leaf). Symlinks are written last, the destination must be an empty real directory, blobs are hash-checked, and the snapshot is checked against its recorded commit and tree.
  - Skeptic keys are checked against the harness's own key, and document names are built by the harness.
  - Verdicts are checked against the enum, and DISPROVED needs evidence.
  - Issue paths agents report are used only for mapping and routing, and fail closed.
  - Prompt injection through issue text is limited: the skeptics are read-only and both must agree.
- **secrets:** CRITICAL-1. No hardcoded secret. Error text is capped at 500 characters.
- **Hygiene:**
  - `spawnSync` is used once (CD :268) with an allow-list.
  - No forbidden git literal and no worktree (RH guards).
  - No new dependency.
  - No logic added to `cli.ts`.
  - `reviewRoot` is not passed in production (RH :483).
  - No debug code or TODOs in the new modules.

## Structured security fields

- `authImplemented`: `"not_applicable"`. Local CLI with no auth boundary; brief §11 declares auth ABSENT.
- `inputValidated`: `true`.
- `noHardcodedSecrets`: `true`.
- `sqlInjectionProtected`: `"not_applicable"`. No database; brief declares sqlDatabase ABSENT.
- `xssProtected`: `"not_applicable"`. Terminal and Markdown only; brief declares htmlRendering ABSENT.
- `security.issues`: CRITICAL-1, the review copy is sealed world-readable (`review-copy.ts:46-48`, `:220`).

## Summary

1 critical / 4 important / 8 minor issues found. **Status: FAIL.**
