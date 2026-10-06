# Phase B — operator decisions

> Binding decisions made by the operator (Enrique) before the Story Writer ran, 2026-10-05.
> Where they differ from `B_RESEARCHER_REPORT.md`, these win.

## Plan and split

- Plan of record: Phase B items B1–B5, A-1 MINOR-1/2/3, GAP-3, GAP-5, and C5 (pulled in from Phase C).
- Order B → C → E. Phase B ships as three PRs, each merged before the next starts:
  - **B-1:** B3 orchestrator-owned snapshot after Stage 3, B2, A-1 MINOR-1/2/3, `docs/ROADMAP.md`, and from the A-2 backlog: the case-sensitive `:(exclude).factory` pathspec, NEW-MINOR-1, MINOR-8, suite time, bidi escaping in `printableForTerminal`, and the factual doc fixes (D-3 below).
  - **B-2:** B1 parallel verification, isolated against B-1's snapshot, plus B5 (the Skeptic step).
  - **B-3:** C5 cost per agent, the GAP-3 budget cap, GAP-5 builder sandboxing, and B4 parallel builders.
- A-2 backlog moved to Phase C: MINOR-4/5 (pre-supplied path, with C1), the existence-only spec check (C1), and the test-style follow-ups. Phase E keeps the README restructure and polish for outside users.
- MINOR-3 (git filter drivers) stays an accepted risk. Revisit trigger: minimum supported git ≥ 2.42 (`--attr-source`). Recorded in `docs/ROADMAP.md`.

## D-1 — B3: where the snapshot lives

- A private ref, `refs/factory/<id>/stage3-<n>`, written with git plumbing:
  - build the tree with a temporary `GIT_INDEX_FILE`, then `write-tree`, `commit-tree --no-gpg-sign` and `update-ref`;
  - `--no-gpg-sign` is required because `commit-tree` respects `commit.gpgSign` and could hang;
  - plumbing commands don't run hooks;
  - `refs/factory/*` is not pushed by default, so the snapshots stay local;
  - extend the allow-list in the single git module (`change-diff.ts`), nowhere else.
- The user's branch, index and working tree are never touched.
- Changes the user already had uncommitted go into the snapshot, flagged in the CHECKPOINT 3 text. This matches how the CP3 diff already behaves.
- **AC-45 is reworded in the story**, from "the factory never commits" to: "The factory never touches your branch, index or working tree, never pushes, and writes git objects only under `refs/factory/<id>/`." The guard-test change (`repo-hygiene.test.ts:298-335`) is a planned AC.

## D-2 — Budget cap (B-3)

- A cap hit **escalates with `BUDGET_EXCEEDED`**, and the run continues with a grant flag that mirrors `--grant-attempts`: the same resume path, refusal codes and tests.
- Not a pause: PAUSED exists only for checkpoints.

## D-3 — Docs

- Move all 5 `factory/feature/docs/*.md` files to `docs/archive/`, each with a one-line header: "historical — not maintained; see SKILL.md".
- Archive the 3 reference files too (`STAGE_CONTRACTS.md`, `STATE_TRACKING.md`, `OUTPUT_SCHEMAS.md`) rather than editing them line by line. Put short pointers in their place: `SKILL.md` for behaviour, the TypeScript types for schemas.
- Any doc that is kept is added to the drift test's scope.
- Fix the README "five stages" section where it contradicts the code (B-1). Restructuring the README stays in Phase E.

## D-4 — B5: the Skeptic step (B-2)

- CRITICAL findings only (no HIGH severity exists in the code).
- Two skeptics, both read-only, neither sees the other's verdict.
- A finding is disproved only if both skeptics disprove it. A disproved finding becomes an IMPORTANT finding shown at CHECKPOINT 3, never dropped.
- Skeptic cost counts toward the budget cap.

## D-5 — B1 isolation: reversed

- The **Validator** reviews a read-only copy extracted from the B3 snapshot ref (for example with `git archive`).
- The **Test Verifier** keeps running in the real tree, where its tests work.
- The Validator never runs tests, so it doesn't need `node_modules`. A snapshot taken before verification can't see the Test Verifier's deliberate breakage.
- Never use a git worktree as an agent sandbox.
- The scoped follow-up review gets its own agent id, so a resume doesn't overwrite the main report.
- Updating the ~23 agent-order tests is expected and goes in the brief's test plan (P-20).

## D-6 — Smaller points

- **B2 is an instruction, not enforced.** The story says so explicitly. Gate 2 runs the full suite, which is the enforcement.
- **Assertion changes approved at CHECKPOINT 1**, since each follows from a decision above: the AC-45 guard (`repo-hygiene.test.ts:298`), MINOR-8 (`run-lifecycle.test.ts:191-196`), and bidi escaping (`cli.test.ts:371-379`).
- **"#426 lost commit"** came from another project's history, not this repo. It does not affect the plan.
- The Researcher's defaults for the other open questions are accepted for CHECKPOINT 1. (The count is 15, not 16 as first stated.)

## D-7 — Invisible direction characters (added 2026-10-05, after the Story Writer's first draft)

Origin: the Researcher's hand-back contained a literal U+202E, which was copied into `B_RESEARCHER_REPORT.md:205` and then replaced by the visible text `\u202E`.

- **(a) Harness, PR B-1.** The harness flags bidi and invisible direction characters (U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF) in every agent document it persists and in checkpoint text, not only in terminal output. Session's design default, sent to the Story Writer:
  - documents are stored exactly as the agent wrote them;
  - each affected document produces an IMPORTANT finding naming the document, line and code point;
  - checkpoint text shows the characters escaped, under a warning banner, and is hashed as presented.
- **(b) By-hand process rule.** After saving any subagent report to disk, the session runs the bidi scan on the saved file.

## D-8 — CHECKPOINT 1 preparation answers (session defaults, accepted by the operator)

- **N-2:** escalation reasons `HEAD_MOVED` and `SNAPSHOT_FAILED`. Every HEAD move escalates, including an operator commit between a pause and a resume.
- **N-3:** if the Test Verifier changes a non-test file, the run escalates (fails closed). The brief defines "test path".
- **N-8:** `--max-cost-usd <n>` on a new run, saved in state; no cap when absent. `--grant-budget <usd>` grants more. `--consolidate` records cost but is not capped.
- **N-13:** B4 parallel builders work in one tree. Each builder's writes are limited by the B-3 permission check to the files `FILE_LIST` assigns it. If the assignments overlap, the builders run in sequence and an IMPORTANT finding is recorded. Never a worktree.

## CHECKPOINT 1 — approved

- Approved by the operator on 2026-10-05 at 10:06: `USER_STORY.md` revision 1, SHA-256 `7a05811e53bc9b4886c17c67ab8357605dc3df183c448072708068c990a005d2`.
- All open-question defaults are accepted (Q2–Q20, N-1 to N-16).
- Carried into the B-1 brief: in AC-102, "raw text" means the text before terminal escaping. The checkpoint hash is taken over `presentationFor`'s escaped output (AC-108).

## CHECKPOINT 2 (PR B-1) — approved

- Approved by the operator on 2026-10-05 at 10:45:
  - `B1_TECHNICAL_BRIEF.md`, SHA-256 `4b4c87cc1f0816a817392fcbda2b90b0846aaf3344eb93dce316372354024002`;
  - `B1_FILE_LIST.md`, SHA-256 `58597ad7fdd370b568f2262462582681847cfd2c79ef60be33ce7a7d17e6d1cb`.
- **I-2 approved:** the assertions at `change-diff.test.ts:66` and `:72` change, because `captureBase`'s expected objects gain `branch` and `preExisting`.
- **I-19:** Phase D is the README loop diagram, DONE (PR #5). This was in the operator's plan but missing from this file, a session error. In ROADMAP's mapping table:
  - REFACTOR_PLAN Phases 2 and 3 (Tier 1, cross-run memory) are "not scheduled in A–E";
  - row 3's worktree parallelism is marked superseded (D-5).
- **All other issues** (I-1, I-3 to I-18, I-20 to I-24) are accepted with the brief's recommended answers.
- **ROADMAP backlog addition:** cleanup of `refs/factory/*` snapshot refs. Snapshots accumulate and may hold a stray non-ignored `.env`. Not in B-1.

## CHECKPOINT 3 (PR B-1): approved with a fix round (16:13)

- **Reports:** `B1_VALIDATION_REPORT.md` (PASS, 0 / 1 / 7), `B1_TEST_VERIFIER_REPORT.md` (PASS, 0 defects), `B1_VALIDATION_FOLLOWUP.md` (PASS, 5 minor).
- **Fix round, one builder:**
  - IMPORTANT-1, plus its test;
  - MINOR-1, -2, -3, -4, -5, -7;
  - MINOR-6, accepted and documented in SKILL.md;
  - FOLLOWUP-MINOR-1 to -5.
- **Session items, approved:**
  - the AC-103 durable-share re-measure on the final code;
  - deleting the leftover `factory-snapshot-*` temp folders from mutation M17.
- **Backlog:** a run from before A-1 with no `builderAttempts` gets 3+n attempts from `--grant-attempts n`.
- **Session slip, reported at CP3:** an unapproved `git add -N` / `git reset` unstaged the S-1 renames. No content was lost.

## Binding entry condition for PR B-2 (operator, 2026-10-05, after the B-1 re-check)

- **The problem:** a crash or SDK/API error **during** the Test Verifier leaves no record of it, because invocations are recorded only when they return. A resume then re-takes the rework snapshot, `stage3-<k>`, with the Test Verifier's partial writes in it.
- **Why B-2 must fix it:** B-2's Validator copy is extracted from that ref (AC-123, AC-125), so it must never contain the Test Verifier's work.
- **What B-2's story must include:** an AC that closes this. The preferred direction is to record a "verification started" marker (or the Test Verifier's start) **before** invoking it, mirroring how builder attempts are counted before they start; the existing `stage3SnapshotPassedBy` then picks it up. The alternative is to treat a recorded `written` rework entry as final.
- Source: `B1_VALIDATION_RECHECK.md`, "Residual".

## CHECKPOINT 2 (PR B-2) — approved

- Approved by the operator on 2026-10-05 at 18:09:
  - `B2_TECHNICAL_BRIEF.md`, SHA-256 `2bbd0b79360eee2229194d7900f005e08508635f1184682aa98f538a6452143d`;
  - `B2_FILE_LIST.md`, SHA-256 `b2b571088e9997dcbb36b1b5646366bb796177859110329af43aca2198ddf402`.
- **I-1: AC-157 approved** as written in brief §12. It is added to the Phase B story scope for B-2: a "verification started" record is committed before the Test Verifier is invoked.
- **I-2: the review copy lives in `os.tmpdir()`** (mkdtemp, 0700, path recorded, re-extracted when missing). This replaces the N-4 default; S-0 confirms the reason.
- **I-20 to I-23: the 14 existing-assertion changes in brief §6 rows 1–14 are approved.**
- **I-25: session steps S-0 and S-1 approved.** S-1 is one live Validator call, about $1–2.
- **All other issues** (I-3 to I-19, I-24, I-26 to I-30) are accepted with the brief's recommendations.
- **Backlog addition:** cleanup of review copies left in the temp folder, together with the `refs/factory/*` cleanup.

## PR B-2 mid-build decision D-B2-1 (operator, 2026-10-05 18:27)

- **Approved:** `upstream-artifacts.test.ts:201` (AC-28, brief §6 row 8) is applied in step 1 instead of step 7, because registering 07b and 07c breaks it immediately.
- **Approved:** `agent-prompts.test.ts:162` changes from `toContain(abs('TEST_REPORT.md'))` to `not.toContain('TEST_REPORT.md')` (AC-120). The brief's §6 had missed this test (P-20 gap).

## PR B-2 mid-build decision D-B2-2 (operator, 2026-10-05 19:18)

- **The gap:** `copyIntact`'s leaf count cannot see a deletion that leaves its directory empty.
- **Approved fix:** the review copy record also stores a digest (sha256) of the sorted list of leaf paths and their entry types, taken when the copy is made. `copyIntact` checks both the count and the digest. It hashes paths only, not contents.
- **Ownership:** step 4 (record type) adds it, together with the matching check in `review-copy.ts`. The step-3 "known limit" test is inverted to prove the gap is closed.

## PR B-2 mid-build decision D-B2-3 (operator, 2026-10-05)

- **Approved:** `checkpoint-lifecycle.test.ts:961-962` (CP3 rework order) changes to Test Verifier ∥ Validator → Gate 2. It is the same change as row 4, in a test the brief's §6 missed (a second P-20 gap).

## PR B-2 decision D-B2-4 (operator, 2026-10-05 22:08): shared agent contracts stay mode-neutral

- **Finding:** `~/.claude/agents/01..08` are symlinks into this repo's working tree, and by-hand Feature Factory flows in other projects (Aurora: builders commit per step) read them. Program-only rules leaked into those flows:
  - the B-1 builder line "Never commit … The harness snapshots your work itself.";
  - B-2's 06 test-path rule;
  - B-2's 07 "review the copy named in your prompt / no test report".
  
  Aurora's #513 build was stopped by the operator before its Validator step. Nothing in Aurora was changed.
- **Decision:**
  - Program-only rules move out of the shared contract files (04, 05, 06, 07) and live only in the program's prompts (`agent-prompts.ts`), which the program already sends. The contracts keep only rules that are true both by hand and in the program.
  - The repo-hygiene checks that pinned the contract wording (AC-90, AC-91, and any B-2 equivalents) move onto the prompts. This assertion change is approved.
  - The change applies from now on only; nothing earlier is affected.
- **Phase E backlog:** link `~/.claude/agents` and skills to a stable copy (a clone on `main`, or a release tag), so unmerged work never reaches other projects.

## CHECKPOINT 3 (PR B-2): approved with a fix round (10:33, 2026-10-06)

- **Reports:**
  - `B2_VALIDATION_REPORT.md`: FAIL, 1 CRITICAL / 4 IMPORTANT / 8 MINOR;
  - `B2_TEST_VERIFIER_REPORT.md`: PASS, 0 defects, 17 gap tests;
  - `B2_VALIDATION_FOLLOWUP.md`: PASS, 3 IMPORTANT / 8 MINOR.
- **Fix 1 (code):**
  - CRITICAL-1: owner-only seal, folders and executables 0500, files 0400, plus a no-group/other-bits test, and fix SKILL.md;
  - IMPORTANT-1 and -2: record a pre-Test-Verifier baseline per evaluation, measure against it, and also measure when the Test Verifier fails;
  - IMPORTANT-3: skeptics A and B start together, and the prompt and contract forbid reading `state.json` and `SKEPTIC_*`;
  - IMPORTANT-4: `-c diff.relative=false` instead of `--no-relative`; no git floor;
  - MINOR-2 (map through all earlier copies), -3 (the import cycle), -4 (pure rules into `verification.ts`), -5 (findings on early escalation), -6 (refuse a review root inside the project).
- **Fix 2 (tests and docs):** FOLLOWUP-IMPORTANT-1 to -3, FOLLOWUP-MINOR-1 to -8, and MINOR-1 and -8 (SKILL.md).
- **Approved assertion changes:**
  - the seal-mode tests (0555/0444 → 0500/0400);
  - tests pinning skeptic A before B;
  - the test pinning `--no-relative` (the behaviour test stays).
- **Backlog (Phase E):** MINOR-7, program-only wording from before Phase B in contracts 06 and 07.

## PR B-2 decision D-B2-5 (operator, 2026-10-06, after the fix-round re-check)

- **Ratified (NEW-MINOR-3):** `agent-prompts.test.ts:400` now pins the follow-up prompt's new sentence ("in this verification cycle, measured against the project as it was before the Test Verifier ran"). The approved IMPORTANT-1 fix forced it.
- **NEW-MINOR-1 and -2** were fixed by the session, text only:
  - `testPathRule` now says the project is compared "with how it was just before you started";
  - the `MeasurementBaseline` comment describes carry-over as "not cleared (measurement failed, or found a change outside a test path)".
