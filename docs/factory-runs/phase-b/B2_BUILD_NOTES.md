# B2_BUILD_NOTES.md: PR B-2 build hand-off

> A running file that every fresh Backend Builder reads before starting its step (P-12). The session writes it after verifying each step.
> Branch `feat/phase-b2-verification` (from main 0e64c6d).
> Approved inputs:
> - `USER_STORY.md` (CP1), plus AC-157 (approved at B-2 CP2);
> - `B2_TECHNICAL_BRIEF.md` and `B2_FILE_LIST.md` (CP2);
> - `B_DECISIONS.md`.

## Standing rules (every step)

- **Do only your step** (brief §7). The ACs and test titles are in brief §5. Work only in `/Users/enriqueibarra/cypher-claude-skills`.
- **No git command of any kind on this repo, read-only included** (P-27). The session runs every git command and every check of the repo.
- **No new dependency;** node built-ins only.
- **Read-only paths:** `~/.claude/**` and `docs/factory-runs/**`.
- **No string literal may contain `git <forbidden subcommand>`** (RH).
- **Invisible characters:** never type them. Build them with `String.fromCodePoint` (P-23). Your tool may turn a typed escape into the real character, even in a shell one-liner.
- **Self-check:** scan every file you touch for U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069 and U+FEFF, with the character class built from code points. 0 hits required.
- **Reuse:** grep for an existing helper before writing one (anti-pattern 10): `describeIssue`, `criticalIssues`, `routeCriticalIssues`, `addImportantFindingsOnce`, `normalisePath`, the snapshot tree builder.
- **Saving state:** state saves only through `save()` / `commit()`. Add no new `stateWriter` mention in the orchestrator, and keep the pre-flight order (B-1 rules).
- **Existing-test policy (P-13).** These assertion changes are approved (CP2: I-20 to I-23, brief §6 rows 1–14):
  - orchestrator-gates :82, :100, :358, :586;
  - validator-loop-back :252-258 and :296-302, with the interim sequence after step 6;
  - resume :107, :120;
  - upstream-artifacts :201, :300;
  - snapshot :704-747 (kill point moves to Gate 1.5);
  - repo-hygiene AC-80 (third array);
  - doc-drift :112 (row removed) and AC-115 version (step 8);
  - output-schemas :47-54 (`REVIEW_DOCUMENTS`).
  
  Setup-only changes are listed in §6 as (b). Any other existing test that breaks: STOP and report its file:line and why.
- **Before reporting done:** typecheck plus your step's test files and any test file that calls code you changed. You may run `npm test` once at the end (~85 s).
- **Report back:**
  - the API delivered (file:line);
  - files touched;
  - deviations, and why;
  - OPEN items, each with its owning step;
  - tests added, by title;
  - counts and the Time line;
  - the self-check result.

## Step log

| Step | Status | Tests (total after) | Time (min) |
|---|---|---|---|
| S-0 | done: Jest collects .factory copies (I-2 confirmed); rg finds files when run inside the copy (brief §0.9 partly wrong); cat-file --batch works; baseline 94 s | 1295 | 2 + 1.5 suite |
| 1 | done after D-B2-1 (2 assertion changes approved mid-step), verified by the session: typecheck 0; 1324 passed + 1 skipped in 85 s | 1325 | 10.3 + 2 builder + 2 check |
| 2 | done, verified by the session: typecheck 0; 1360 passed + 1 skipped in 101 s; no refs/factory, no temp leftovers | 1361 | ~18.6 builder (reported ~35) + 2 check |
| 3 | done, verified by the session: typecheck 0; 1463 passed + 1 skipped in 102 s; no temp leftovers | 1464 | 9.8 builder + 2 check |
| 4 | done incl. D-B2-2 digest, verified by the session: typecheck 0; 1573 passed + 1 skipped in 111 s; no pre-existing assertion changed | 1574 | 14 builder + 2 check |
| 5 | done, verified by the session: typecheck 0; 1597 passed + 1 skipped in 103 s | 1598 | 7.4 builder + 2 check |
| 6 | done after D-B2-3, verified by the session (see below) | 1627 | 35 builder + 2 approval fix + 2 check |
| 7 | done, verified by the session: typecheck 0; 1672 passed + 1 skipped; suite 186 s (builder run 142 s) | 1673 | 24.7 builder + 3 check |
| 8a | done (D-B2-4), verified by the session: typecheck 0; 1676 passed + 1 skipped in 151 s; contracts 04-07 contain no program-only rule | 1677 | ~1 (interrupted run, RED tests) + 5.3 + 2 check |
| 8b | done, verified by the session: typecheck 0; 1678 passed + 1 skipped in 122 s; contracts 04-07 free of program-only and "harness-generated" wording | 1679 | ~8 builder + 2 check |
| S-1 | live smoke PASS (P1-P6), 15 turns, $1.42 | — | 2.6 |
| S-2 | final checks done; 08 wording fix (operator-approved) | 1679 | 2 |

## Step 1 (agents and schemas): delivered

- **AR:**
  - `07b-validator-followup` and `07c-validator-skeptic`: Stage 4, Read/Grep/Glob, opus at high effort, 20 and 15 turns;
  - `REQUIRED_ARTIFACTS`: `VALIDATION_FOLLOWUP.md` and `SKEPTIC_REVIEW.md`;
  - `REVIEW_DOCUMENTS` (:148), built from `REQUIRED_ARTIFACTS`.
- **AOS:** `ValidatorFollowupOutput`, `SKEPTIC_VERDICTS`, `SkepticOutput`, and the validate cases. **OS:** a shared `reviewIssue()`, and `DETAILS_BY_AGENT` for 07b and 07c.
- **UA:**
  - 07 uses `AFTER_BUILD` (no `TEST_REPORT.md`);
  - 07b uses `AFTER_TESTS`;
  - 07c gets `USER_STORY.md` and `TECHNICAL_BRIEF.md`.
- **SC:** `StageOutputs.validatorFollowup?` and `skeptic?` (transient); both agents are added to `HARNESS_PERSISTED_AGENTS`. **RP:** `OUTPUT_SLOT` gains 07b.
- **Contracts:** 07b and 07c are new. 07 gains "Where you review" (the copy is its working directory; no test report). 06 gains "Where you may write: test paths only", with the N-3 / I-4 rule.
- **SKILL.md:** "10-agent", the table rows, the claims block.
- **Fixtures:**
  - `followup({files?, issues?, status?})`, with files defaulting to `[]`;
  - `skeptic({verdict?, …})`, which echoes the key from the prompt's "Echo issueKey `<k>`" line; with no such line it returns `''`, which fails closed;
  - `passingScript` gains the 07b and 07c defaults (skeptics UPHELD).
- **Approved assertion changes applied:** rows 8, 9, 12 and 14, plus the D-B2-1 agent-prompts line.
- **OPEN items:**
  - **step 8:** the SKILL.md prompt table row "07 | as 06, plus Test Report" (≈:648) is now wrong, and the 07b/07c rows and the diagram need adding;
  - **step 8:** the comment at upstream-artifacts.test.ts:200 doesn't mention that 07b and 07c are excluded;
  - **step 6:** 07's contract names a copy that its prompt won't name until `validatorPrompt(ctx, review)` exists;
  - **step 5:** `outputContract` says "A gate looks each one up by that exact name", which isn't true for `REVIEW_DOCUMENTS`;
  - **step 7:** tests where the Test Verifier changes files must pass `followup({files})`, or the default `[]` triggers the `filesReviewed` mismatch finding.
- **TIP (P-20 gap):** the brief's §6 missed agent-prompts.test.ts:162. Later steps should grep every test that calls a changed prompt or list builder, not only the ones the brief names.

## Step 2 (git extraction and measurement): delivered

- **change-diff.ts:**
  - `GIT_EXTRACTION_SUBCOMMANDS` (:155);
  - `GitResult` with `raw: Buffer` (:199);
  - `git(cwd, sub, args, extraEnv?, io?)` (:229): always spawns with encoding `buffer`; stdin is piped only when `input` is given, as a Buffer;
  - a private `workingTree(cwd)` (:533), shared by `snapshot()` and `changedSince()`;
  - `changedSince` (:647) and `extractSnapshot` (:797), both on `DEFAULT_CHANGE_TRACKER`.
- **orch** `changes` wiring: :440-441.
- **Fixtures:**
  - `fakeChangeTracker` gains `FAKE_COPY_FILE` / `FAKE_COPY_CONTENT`, a separate `reviewCalls` log, and the options `extract?` and `changed?`;
  - `real-git.ts`'s `setupGit` gains an optional `input` (setup only).
- **Deviations (accepted by the session):**
  - `TREE_DIFF_OPTIONS` adds `--no-relative` and `--ignore-submodules=none`, each with a test. Without them, a repo's `diff.relative` or `diff.ignoreSubmodules` setting would silently narrow the measurement. `--no-relative` needs git ≥ 2.28; older git fails closed.
  - `extractSnapshot` also refuses a duplicate path, and a path inside another leaf.
  - The gitlink type check is a regex, because the RH guard bans a lone `'commit'` literal.
  - The "unknown mode" branch can't be reached through git (git normalises modes), so it's untested defensive code.
  - A hash failure in a later batch can leave the earlier files in `dest`; the caller discards `dest`.
- **RH row 11 applied** (approved). No other assertion changed.
- **OPEN items:**
  - **step 3:** `copyIntact(dir, entries)` counts the tree's leaves (regular files, symlinks, gitlink empty directories), not intermediate directories, matching `extractSnapshot`;
  - **step 6:** extraction and measurement failures map to `REVIEW_COPY_FAILED` (step 4). Discard or replace `dest` after an extraction failure. Tests use `fakeChangeTracker({ extract, changed })` and `reviewCalls`;
  - **step 8:** SKILL.md's git subcommands list gains `ls-tree` and `cat-file`, plus the git ≥ 2.28 floor for `--no-relative`.
- **Suite time** went up: 85 s → 101 s, from the +36 real-git tests.

## Step 3 (review-copy.ts, test-paths.ts): delivered

- **test-paths.ts:**
  - `TEST_DIRECTORY_NAMES` (:17);
  - `isTestPath` (:31), which reuses `normalisePath`, handles backslashes and compares in lower case; `e2e/` is not a test directory;
  - `splitByTestPath` (:39).
- **review-copy.ts:**
  - `REVIEW_DIR_PREFIX` (extra export);
  - `createReviewDir` (:95): validates the run id, `e` and an absolute root before creating anything; mkdtemp at 0700; returns the realpath;
  - `copyWorkingTree` (:118): throws on failure; symlinks are created last, and `.factory` (top level), `.git` and `node_modules` are skipped at any depth and of any type, compared in lower case;
  - `compareWithCopy` (:193);
  - `sealReadOnly` (:210);
  - `copyIntact` (:257);
  - `mapReviewPath` (:277), with the macOS `/var`/`/tmp`/`/etc` ↔ `/private` twin;
  - `insideReviewCopies(claims, dirs, cwd)` (:292).
- **Leaf count (`leafCount`, :229-250):** every non-directory entry, plus every empty directory. It equals `extractSnapshot`'s `entries`.
- **Deviations (accepted):**
  - the wider exclusions (any type, lower case), which fail closed;
  - the relative-root refusal;
  - a one-line private `inside()` helper. It duplicates change-diff's `within`, but importing from the git module into an fs-only module would be worse.
  - the ordering test uses a pass-through `jest.mock('fs')`.
- **Test count:** +103. That's 101 in RCT, plus 2 from `no-cwd-in-gates.test.ts`, which runs once per harness module and now covers the two new ones.
- **KNOWN LIMIT (operator decision pending):** `copyIntact` can't see a deletion that leaves its directory empty, because the directory then counts in place of the file. A test documents it ("AC-123 known limit").
- **OPEN, step 6:**
  - call `copyIntact(dir, record.entries)`, and `sealReadOnly` after either copy;
  - `mapReviewPath` returns `''` for the copy root itself: drop such issues or treat them as unmapped;
  - pass Gate 1's claim paths plus `cwd` to `insideReviewCopies`;
  - map the `compareWithCopy` and `copyWorkingTree` throws to `REVIEW_COPY_FAILED`;
  - add a real-git SN cross-check that `copyIntact(dest, extracted.entries)` holds on a rich snapshot.

## Step 4 (state, verdict, Stage 4 gate input, AC-157 clause, D-B2-2 digest): delivered

- **review-copy.ts:**
  - `CopyLeaves {entries, digest}` (:227) and `LeafType` (:235);
  - `leafDigest(dir)` (:285): sha256 over `<type>\t<path>\0` lines sorted by UTF-8 path bytes, type f / l / d-empty / o; paths and types only;
  - `copyIntact(dir, record)` (:302) checks the count AND the digest;
  - `copyWorkingTree` returns `CopyLeaves`.
- **verification.ts** (new, pure): `issueKey`, `mergeIssues(main, followup?, cwd?)`, `verdictOf`, `disprovedFinding`, `legacyVerdict`, `currentReworkCycle`.
- **state-tracker.ts:**
  - the evaluation types and `ReviewCopyRecord` with `digest`;
  - invocation fields `evaluation`, `instance`, `outcome: 'threw'`, `error`;
  - `REVIEW_COPY_FAILED` (CRITICAL);
  - `validatorEvaluations?`;
  - `VERIFYING_AGENTS` gains 07b and 07c;
  - `stage3SnapshotPassedBy`'s AC-157 clause (:1244);
  - recorders (:1333-1485), write-once and refusing malformed input. `recordEvaluationStart` throws if any evaluation is open.
- **Stage 4 gate:** SG `validationVerdict` (fails closed when absent); SC `harness.validation`; `criticalIssuesCount` is removed. The orchestrator's interim `validation: legacyVerdict(outputs.validator)` is at :1717.
- **Deviations (accepted):**
  - the review-copy tests use the new `copyIntact` signature, and the known-limit test is inverted (D-B2-2);
  - `mergeIssues` takes `cwd`;
  - an issue naming the copy root keeps its absolute path, so routing fails closed;
  - duplicates are dropped within one review too;
  - the whole of verification.ts was built;
  - +1 real-git CDT test: the extracted and fallback copies of the same tree have the same digest;
  - the "Validation Passed" detail texts changed (no test pinned them).
- **OPEN, step 6:**
  - record `{entries, digest}` with every copy. For an extraction, take `leafDigest(dest)` after `extractSnapshot` and before sealing, and check its `entries` against the extraction's;
  - `finish(ESCALATED)` calls `closeOpenEvaluations(state, now)`;
  - `timedInvoke` fills `outcome` / `error` (the caller truncates to 500 characters);
  - pass `cwd` to `mergeIssues`;
  - replace the interim `legacyVerdict` with `stage4Evidence()`: `currentValidationVerdict(state, currentReworkCycle(state))`, falling back to `legacyVerdict` when there is no evaluation (I-27).
- **OPEN, step 8:** SKILL.md :518 ("Validation Passed: the Validator reported no CRITICAL") needs the typed-verdict wording, plus `REVIEW_COPY_FAILED` and the digest.

## Step 5 (per-call cwd, follow-up and skeptic prompts): delivered

- **invoke-agent.ts:**
  - `AgentInvocation.cwd?` (:43) and `cwd: call.cwd ?? config.cwd` (:199);
  - `outputContract` (:128-140): for 07b and 07c it says "No gate reads it: the harness keeps it under that exact name as the record of your review…"; every other agent keeps the old sentence.
- **agent-prompts.ts:** `FollowupFile` (:382), `followupPrompt` (:392), `SkepticPromptInput` (:413), `skepticPrompt` (:428). They reuse `describeIssue`, `upstreamSection`, `harnessGeneratedNote` and `withRules`.
- **Skeptic prompt:**
  - A and B differ in one line only;
  - it contains "Echo issueKey `<key>`.";
  - DISPROVED and UPHELD appear only in the instruction.
- **Deviations (accepted):**
  - a new `invoke-agent.test.ts` mocks the SDK module (with a guard that the fake is the module loaded); `createSdkInvoker` had no test seam before;
  - the prompts refuse bad input with a `RangeError`: an empty file list, a non-CRITICAL issue, a bad key, a relative `treeDir`, or an instance other than A/B;
  - no DESCRIPTION entries were needed.
- **OPEN, step 6:** pass `cwd: <copy>` on the 07 call and on skeptic calls about main-review issues. Follow-up calls, and skeptic calls about follow-up issues, pass none.
- **OPEN, step 7:**
  - `skepticPrompt` gets `treeDir` = the copy for 07 issues and `ctx.cwd` for 07b issues, with `origin` and `issueKey` from the `MergedIssue`;
  - `followupPrompt` gets `{path, deleted}` and is called only when `testVerifierChanges.kind === 'tests'` (an empty list throws);
  - fix `output-schemas.ts:105` and `:469`, which also claim "a gate looks it up" for 07b and 07c.

## Step 6 (verification() core): delivered

- **Orchestrator:**
  - `reviewRoot?` (:459), defaulting to `realpath(tmpdir())`;
  - `finish` closes open evaluations on an escalation (:625);
  - `stage4Evidence()` (:689), the switch done in this step: the current verdict, otherwise `legacyVerdict` only when the cycle has no evaluation, otherwise none (fails closed);
  - `timedInvoke` records throws (`outcome: 'threw'`, `error`, at most 500 characters) and rethrows;
  - the Gate 1 copy guard (:1194);
  - `executionGate(round, reference)`;
  - closures `evaluationKind`, `startEvaluation`, `prepareReviewCopy`, `testVerifierBranch`, `validatorBranch`, `measureTestVerifier`, `evaluate`, `decidedVerdict`, and a rewritten `validatorLoop` (:1941-2349).
- **Stage 4 flow:**
  1. the rework's Stage 3 gate is skipped once an evaluation has started;
  2. Gate 1.5;
  3. `evaluate`: pre-read the reference → (in a round, Gate 2 first) → start or continue the evaluation → prepare or reuse the copy (extract → `leafDigest` → seal) → T (06) ∥ V (07 in the copy) with `allSettled` → decide in order → first pass only: measure, then Gate 2;
  4. the decision on the **main output only**.
- **validatorPrompt(ctx, review)** is required and gives no `TEST_REPORT.md`. `smoke-validator.ts` makes a review copy and adds a P6 check.
- **`evaluationKind` (the builder's reading, accepted; document it in step 8):**
  1. the open evaluation's kind;
  2. first-pass if there is no 06 PASS;
  3. validator-round after a round fix, or once this cycle's first pass is decided;
  4. otherwise first-pass.
- **Approved changes applied:**
  - rows 1–4;
  - interim rows 5–6;
  - row 10, with the kill point moved to a Gate 1.5 audit;
  - D-B2-3 (checkpoint-lifecycle :962).
  
  Row 7 turned out not to be needed.
- **Setup-only changes:**
  - snapshot AC-89's twin uses the fake extract and measure;
  - cli.test.ts removes temp review copies;
  - the direct callers pass `reviewRoot`;
  - `harness-run.ts` gains `removeTree` and `removeTmpReviewCopies`, used by `tempProject` cleanup.
- **OPEN, step 7:**
  - follow-up, merge, skeptics, and the final rows 5–6;
  - record `followup: skipped`;
  - `INVALIDATED_ON_REWORK[3]` and the Stage 4 gate invalidation gain 07b; `SUPERSEDED` gains `VALIDATION_FOLLOWUP.md`;
  - IMPORTANT findings are still recorded from the raw main issues in branch V; move them to the merged list;
  - **`pendingValidatorRound` recomputes routing from the raw 07 FAIL output.** Absolute copy paths won't route on a resumed round, so map them through the round opener's copy.
- **OPEN, step 8 (SKILL.md):** the `evaluationKind` rule, `REVIEW_COPY_FAILED`, throw recording, `reviewRoot`, and the copy living outside the project.
- **OPEN, S-1:** run `smoke-validator.ts`. It prints its copy path, and the copy is left in the temp folder.

## Step 7 (follow-up, merge, skeptics, typed verdict, CP3 with both documents): delivered

- **verification.ts:** `reviewFindingMessage`, `importantFindings` (per origin), `followupMismatch` (I-29), `standingIssues(evaluation, cwd)`, `followupPresented`.
- **run-progress.ts:** `pendingValidatorRound` routes the opener evaluation's standing issues, with copy paths mapped (:197-207). There is a run-time-only import cycle with verification.ts, documented in a comment.
- **CPR:** `CP3_FOLLOWUP_DOCUMENT`; `presentChange(..., followup?)`. A missing follow-up document fails closed; without the follow-up, the text is byte-identical.
- **AR:** `returnsOnlyReviewDocuments(agent)` (:157), used by invoke-agent and output-schemas (:105, :472).
- **Orchestrator:**
  - `SUPERSEDED_ON_REWORK[3]` gains `VALIDATION_FOLLOWUP.md`; `INVALIDATED_ON_REWORK[3]` and the Stage 4 gate invalidation gain 07b;
  - `recordValidatorFindings(merged)`;
  - `followupReview` (:2314), `challengeCriticals` (:2377), `decidedVerdict` (:2451), `validatorLoop` (:2484);
  - `presentCheckpoint` passes `followup` when `followupPresented(state)` (:2985).
- **Flow after Gate 2:** 07 ESCALATE → I-13 (main) → follow-up → merge + findings → I-13 (follow-up) → skeptics (A then B per CRITICAL) → `verdictOf` + disproved findings → decision → Stage 4 gate.
- **Deviations (accepted):**
  - the CP3 follow-up flag uses the run's latest first-pass evaluation; the current cycle would break the I-7 re-check after approval;
  - the main I-13 check runs before the follow-up;
  - the name `recordValidatorFindings` is kept (pinned by an RH guard);
  - only the schema-named document is persisted for 07b and 07c;
  - KNOWN LIMIT: after a re-extraction, absolute paths into the old copy no longer map. Keys change and routing escalates NOT_OWNED, which fails closed and overwrites nothing.
- **Approved final rows 5–6 applied.** No other existing assertion changed.
- **Suite time:** the session's run took 186 s, the builder's 142 s. Note this for the S-2 re-measure.
- **OPEN, step 8 (SKILL.md):**
  - the CP3 follow-up rule;
  - I-13 runs before the follow-up;
  - the 07b ESCALATED step;
  - only schema-named documents are persisted;
  - the skip reason text;
  - disproved findings under `07c-validator-skeptic`;
  - resumed rounds route the opener's standing issues;
  - the known limit.
- **NEW OPEN, step 8 (found by the session):** `~/.claude/agents/06-test-verifier.md` and `07-validator.md` are symlinks into this repo's working tree. Every by-hand Feature Factory run in **any project** reads them on whatever branch is checked out. 07's contract now says to review "the read-only copy named in your prompt". **By hand, no copy is named**, so the contract must say: "if your prompt names no copy, review the project as before".

## Step 8a (D-B2-4: shared contracts mode-neutral): delivered

- **Interrupted first run:** the first 8a builder (launched 22:08 on 10-05) started before the operator's interruption. It wrote only its RED tests: repo-hygiene AC-90 / AC-91 / D-B2-4 guard, three agent-prompts D-B2-4 tests, and the review-copy `TEST_FILE_NAME_PATTERNS` test. The session confirmed by file times that nothing else was touched. The second 8a builder (10-06, ~07:20) implemented against those tests.
- **Contracts:**
  - 04 and 05 lose the no-commit / snapshot line, and item 3 is now mode-neutral;
  - 06 loses the test-path section (now identical to pre-Phase-B main 0b3ce27);
  - 07 loses the review-copy section, and item 3 is reworded neutrally ("test report only if your prompt names it").
  
  Against pre-Phase-B main, contracts 04-07 now differ by one line each in 04, 05 and 07.
- **Prompts (agent-prompts.ts):**
  - `builderPrompt` :347-349: related tests and Gate 2; no commit; "The harness snapshots your work itself." as its own line;
  - `testPathRule()` :378, built from `TEST_DIRECTORY_NAMES` + `TEST_FILE_NAME_PATTERNS` (newly exported at test-paths.ts:30), included in `testVerifierPrompt`;
  - `validatorPrompt` :420: "You get no test report…".
- **SKILL.md:** the paragraph after SUCCESS now says the program's prompts carry these rules, because contracts 04-07 are shared with by-hand runs.
- **The session's check:** no "harness snapshots", "Gate 2", "review copy", "test paths only" or "never commit" in contracts 04-07.
- **OPEN, step 8b:**
  - SKILL.md :22 and the skill-assignments note say "each agent's prompt is its contract file". Make them exact: the prompt is the contract plus the program's per-run prompt.
  - The 06/07 "harness-generated" wording (Phase A) is not true by hand. **Operator to decide.**

## Step 8b (docs): delivered

- **SKILL.md:**
  - version "(Phase B, PR B-2)";
  - the "As a program" text is exact: the system prompt is the contract plus `outputContract`, and the per-run prompt carries the program-only rules;
  - the Stage 4 diagram;
  - the CP3 table and parts;
  - the git subcommands, with `ls-tree` / `cat-file` and git ≥ 2.28;
  - the AC-157 rule replaces the B-1 "known limit";
  - the rework supersede list;
  - a new "Verification in Stage 4" subsection;
  - resuming by evaluation;
  - throw recording;
  - the Gate 1 copy rule;
  - "Validation Passed" reads the typed verdict;
  - artifacts;
  - the prompt table (07 fixed, plus 07b and 07c rows);
  - the skill-assignments note.
- **README:** the I-26 line, the bounded-loops skeptic clause, the Stage 4 diagram, 07b/07c in the tools table, and the per-run prompt sentence.
- **ROADMAP:** the B-2 entry condition "Closed by AC-157"; the Phase E stable-copy item (D-B2-4); the review-copy cleanup backlog item.
- **DD:** row 13 (approved), plus 2 new AC-127 tests. AC-115's title still says "PR B-1" (cosmetic).
- **Contracts 06 and 07:** "harness-generated" changed to "generated from the builders' (and Test Verifier's) structured reports". No test pinned it.
- **Deviation:** SKILL.md says "batch mode" / "git's no-relative option", because DD AC-79 would read `--batch` / `--no-relative` as CLI flags.
- **OPEN, for the operator:** `08-feature-consolidator.md:21` also says "harness-generated", and it is shared and symlinked. Same fix? (Not approved yet.)
- **Not verified live:** the git 2.28 floor; the known-limit sentence (read from the code, not run).

## CP3 fix round, part 1 (code): delivered and verified by the session (1743 passed + 1 skipped, 124 s)

- **CRITICAL-1:** owner-only seal (0500/0400, root included), with a no-group/other-bits test. SKILL.md is corrected.
- **IMPORTANT-1 and -2:**
  - a `MeasurementBaseline` per first-pass evaluation (a git tree id via the new `workingTreeId`, or the fallback copy), committed before the Test Verifier;
  - the measurement runs after both branches settle, whatever they returned;
  - an uncleared earlier baseline is inherited;
  - I-28 also applies once a baseline is recorded.
- **IMPORTANT-3:** skeptics A and B start together (`allSettled`), each verdict is recorded as it returns, and the prompt and the 07c contract forbid reading `state.json` and `SKEPTIC_*`.
- **IMPORTANT-4:** `diff.relative=false` sits in `SAFE_GIT_CONFIG` (it applies to every call; harmless, because the CP3 diff passes `--relative` explicitly). `--no-relative` is removed.
- **MINOR-2:** `previousCopyDirs` on the evaluation, used for mapping and by the Gate 1 guard.
- **MINOR-3:** `currentReworkCycle` moved to run-progress; a cycle test is added.
- **MINOR-4:** `evaluationKind`, `stage4Verdict`, `classifyTestVerifierChanges` and three more are pure functions in verification.ts.
- **MINOR-5:** `finish()` records the IMPORTANT findings of open, reviewed evaluations on any escalation.
- **MINOR-6:** `reviewRootProblem` refuses a review root that is the project or inside it.
- **Assertion changes (approved):**
  - the seal-mode test (0555/0444 → 0500/0400);
  - SKP AC-133 (B waits for A on disk; "as it returns");
  - SKP AC-134 ×5 (2 skeptic calls).
  
  No `--no-relative` literal was pinned.
- **Deviations (accepted, reported at the re-check):**
  1. the config sits in `SAFE_GIT_CONFIG`;
  2. `previousCopyDirs` lives on the evaluation;
  3. MINOR-6 refuses only a root inside the project; refusing the reverse broke every project under tmp;
  4. the follow-up reviews the whole cycle's test files;
  5. baseline inheritance after an N-3 escalation flags other hand fixes in that window too, until the file is reverted;
  6. the measurement now runs before the escalation decision, so N-3 or REVIEW_COPY_FAILED can take precedence;
  7. MINOR-5 applies on every escalated exit;
  8. when one skeptic fails, the other is still recorded;
  9. SKILL.md keeps the "git ≥ 2.28" phrase, worded accurately;
  10. the fake's `workingTreeId` returns `FAKE_SNAPSHOT_TREE` and logs to `baselineCalls`.
- **OPEN, part 2:**
  - SKILL.md :338-342, :345-359, :373-383, :406-408 are stale, and `workingTreeId` is undocumented;
  - `followupPrompt` and the 07b contract say "after the snapshot";
  - README :55 (skeptics start together);
  - `until` is duplicated in skeptics.test.ts;
  - plus FOLLOWUP-IMPORTANT-1 to -3, FOLLOWUP-MINOR-1 to -8, MINOR-1 and MINOR-8.

## CP3 fix round, part 2 (tests and docs): delivered and verified by the session

- **Test 7** can now fail: an `INTRUDER.md` plus a fake `VALIDATION_REPORT.md`, and the report captured at round 2. RED was shown under the whole-artifact-list mutant and under O35.
- **The real-git gap tests** moved into change-diff.test.ts's `extractSnapshot` describe:
  - the sha256 probe runs at collection and skips with a reason;
  - the 40 MiB check uses size plus spot bytes;
  - C11 is still killed.
- **Shared fixtures:** `fixtures/barriers.ts` (`BARRIER_MS`, `signal`, `within`, `until`); `harness-run.ts` gains `onDisk(cwd)` and `evaluations`; `changes.ts` exports `writeFakeCopy`.
- **FOLLOWUP-MINOR-1 to -5 and -8** applied.
- **followupPrompt and the 07b contract:** "in this verification cycle, measured against the project as it was before the Test Verifier ran". The forced assertion change at `agent-prompts.test.ts:400` (the pinned sentence) follows from the approved item.
- **SKILL.md:**
  - the baseline and `workingTreeId`;
  - stdin (MINOR-8);
  - no ripgrep reason (MINOR-1);
  - I-28 with the baseline;
  - Gate 1 over every recorded copy;
  - the order;
  - the test-path rule with carry-over and clearing;
  - the follow-up over the cycle's union;
  - the skeptics together, with the not-read rule stated as an instruction;
  - the known limit resolved;
  - MINOR-5 in Resuming;
  - the diagram.
  
  README :55 is updated, and the DD AC-115 title is fixed.
- **Test counts:** none lost (b2-gaps 17 → 15, change-diff 88 → 90). Suite 1743 + 1 skipped.
