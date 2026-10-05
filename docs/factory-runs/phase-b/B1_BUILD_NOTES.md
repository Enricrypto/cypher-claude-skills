# B1_BUILD_NOTES.md: PR B-1 build hand-off

> A running file that every fresh Backend Builder reads before starting its step (pattern P-12). The orchestrating session writes it after it has verified each step.
> Branch `feat/phase-b1-commit`.
> Approved inputs: `USER_STORY.md` (CP1, SHA-256 7a05811e…), `B1_TECHNICAL_BRIEF.md` (CP2, SHA-256 4b4c87cc…), `B1_FILE_LIST.md` (CP2, SHA-256 58597ad7…), `B_DECISIONS.md`.

## Standing rules (every step)

- **Do only your step.** It is in brief §7. The ACs and test titles are in brief §5. Work only in `/Users/enriqueibarra/cypher-claude-skills`. If a path does not start with that, stop.
- **No git commands at all.** No commit, push, add, mv or stash. The session runs every git command.
- **No new dependencies.** Use node built-ins only.
- **Read-only paths:** `~/.claude/**` and `docs/factory-runs/**`.
- **No forbidden git subcommand in a string literal** (brief §0.5). No string literal may contain `git` followed by a forbidden subcommand, for example in an error message.
- **Escapes in source text.** When source or test text needs a direction character, build it from its code point, e.g. `String.fromCodePoint(0x202e)`. Never paste the raw character into a file. Tools can turn an escape you type into the real invisible character: it happened twice in this phase's own docs.
- **Existing-test policy (P-13).** If you break an existing test that brief §6 does not list as (a) pre-approved or (b) setup-only, STOP and report the test, its file:line and why it broke. The session approves setup-only fixes. Any assertion change goes to the operator.
  - Pre-approved assertion changes: the AC-45 guard (`repo-hygiene.test.ts:298-335`); MINOR-8 (`run-lifecycle.test.ts:191-196`); bidi (`cli.test.ts:371-379`); `change-diff.test.ts:66`, `:72` (I-2).
- **Before you report done**, all of these must pass:
  - `npm run typecheck`;
  - the test files for your step;
  - any test file that calls code you changed.
  
  The session runs the full suite after your step. Do not run the full suite yourself unless your step's done-check needs it.
- **Report back:**
  - the exported API you delivered;
  - files touched;
  - deviations from the brief, and why;
  - OPEN items, naming the step that owns each;
  - tests added, by AC title.

## Step log

(The session fills this in after verifying each step: API delivered, deviations, OPEN items with owning step, RULE, TIP, test count, time.)

| Step | Status | Tests (total after) | Time (min) |
|---|---|---|---|
| S-0 | done: AC-98 probe (.Factory NOT excluded), AC-103 baseline 191 s, 87% durable | 1076 | 7.5 |
| 10 | done, verified by the session (typecheck 0; suite 1079/1079 in 53 s) | 1079 | 4.5 builder + 2 check |
| 1 | done, verified by the session (typecheck 0; suite 1089 passed + 1 skipped in 58 s) | 1090 | 4.8 builder + 1 check |
| 2 | done, verified by the session (typecheck 0; 1113 passed + 1 skipped in 71 s; no refs/factory in this repo; no leftover temp dirs) | 1114 | 16.2 builder + 1.5 check |
| 3 | done, verified by the session (typecheck 0; two full runs green: 1150 passed + 1 skipped, 68–70 s) | 1151 | 17.3 builder + 4 check |
| 4 | done, verified by the session (typecheck 0; full suite green) | 1154 | 3.1 builder + 1.5 check |
| 5 | done, verified by the session (typecheck 0; 1170 passed + 1 skipped in 71 s; flake fixed) | 1171 | 25 builder + 2 check |
| 6 | done, verified by the session (typecheck 0; 1190 passed + 1 skipped in 76 s) | 1191 | 11 builder + 2 check |
| 7 | done, verified by the session (typecheck 0; 1218 passed + 1 skipped in 68 s; no hidden characters in any changed source file) | 1219 | 7.6 builder + 1.5 check |
| 8 | done, verified by the session (typecheck 0; 1240 passed + 1 skipped in 77 s; hidden-character scan clean) | 1241 | 10.5 builder + 1.5 check |
| 9 | done, verified by the session (typecheck 0; 1256 passed + 1 skipped in 78 s; hidden-character scan clean) | 1257 | 9.4 builder + 1.5 check |
| S-1 | done by the session: 8 git mv renames staged (R100), nothing else staged | 1257 | 1 |
| 11 | done, verified by the session (typecheck 0; 1270 passed + 1 skipped in 78 s; hidden-character scan clean over all 25+ touched files) | 1271 | 14.1 builder + 1.5 check |
| S-2 | done: final typecheck + suite; AC-103 re-measure 78 s (from 191 s) | 1271 | 1.5 |

## Operator decision D-B1-1 (11:18): step 10 runs first

S-0 measured durable writes at about 87% of `npm test` time, so AC-104 is adopted. The operator moved step 10 to the front of the build order, so that every between-step suite run is faster. The rest of the order (1 to 9, S-1, 11, S-2) is unchanged. Step 10 has no dependency on any other step.

## Step 10 (AC-104): delivered

- **API:** `OrchestrationOptions.stateWriter?: (cwd, state) => void`, tests only. Inside `runFeatureFactory`, `const save = options.stateWriter ?? saveState` is the single choice point (orch:430). All three run-time saves call `save`: orch:477 (resume without a description), orch:485 (change base), and orch:538 (`commit()`).
- **Fixture:** `factory/test/fixtures/state-writer.ts` exports `nonDurableStateWriter`. It writes the same path and the same bytes as the durable store, through a temp file and rename, and fails closed with `StatePersistenceError`. `runToEnd` uses it by default; tests that call `runFeatureFactory` directly stay durable.
- **Tests:**
  - SPT "AC-104 a test can inject…": spies on `saveState` and `fsyncSync`;
  - SPT "AC-104 the non-durable writer fails closed…": extra, beyond the brief;
  - RH "AC-104 no production call site passes stateWriter".
- **Deviation:** the RH guard is stricter than the brief. Outside the orchestrator, no file may mention `stateWriter` at all. Inside it, there must be exactly two mentions: the declaration and the `??` use.
- **RULE (steps 3 and 8, which edit the orchestrator):** a new state save must call `save(cwd, …)` or `commit(...)`, never `saveState` directly. The RH guard does not catch a direct `saveState` call. Adding a third `stateWriter` mention in the orchestrator fails the guard on purpose.
- **TIP:** tests that go through `runToEnd`, including step 3's snapshot kill and restore tests, inherit the non-durable writer. They can still read `state.json` normally.
- **OPEN:** none.

## Step 1 (AC-97): delivered

- **API:**
  - `assertNoFactoryCaseVariant(cwd)` in run-directory.ts. ENOENT counts as no entries; any other error fails closed. It refuses `FACTORY_DIR_CASE_CONFLICT`, naming the absolute path of every case variant, files as well as directories.
  - `RunRefusalCode` gains `FACTORY_DIR_CASE_CONFLICT`.
  - Called at orch:445, the first pre-flight check, for a fresh start and a resume alike.
- **Red step confirmed the probe:** without the call, the CLI test ran a fresh run through `.Factory/` and exited 0.
- **Deviation (accepted by the session):**
  - new fixture `factory/test/fixtures/factory-case-variant.ts`, with `tempFileSystemIsCaseInsensitive`, `plantFactoryCaseVariant` and `treeSnapshot`. It's shared by RDT and CLI, so there's no duplicate setup. It's not in B1_FILE_LIST and is added to the file list for CP3.
  - Extra tests, including one `it.skip` that only runs on a case-sensitive filesystem (the "several variants" case). That is the 1 skipped test.
- **OPEN, for the operator, proposed for step 6:** on `--resume`, the CLI's `findRun` (via `liveRunToResume`, cli.ts:399-409) reads `.factory/<id>` before the library's refusal. On APFS that read can reach `.Factory/<id>`. It is read-only and AC-97 holds, but D-10 says "before any read". The proposal is that step 6, which thins the CLI resume path, makes `assertNoFactoryCaseVariant(cwd)` the CLI's first call on `--resume`, before `findRun`. That is a call to the library guard, not new CLI logic.
- **TIP:** `seedRun(cwd, 'ESCALATED')` makes a strong "nothing ran" fixture for pre-flight tests.

## Operator decision D-B1-2 (2026-10-05)

- The operator said "yes" to starting step 2. The session reads that as also accepting its proposal for the CLI read: **step 6 makes `assertNoFactoryCaseVariant(cwd)` the CLI's first call on `--resume`, before `findRun`.**
- **Confirmed by the operator: "step 6 YES".**

## Step 2 (AC-80, AC-83, plus the snapshot primitive): delivered

- **Allow-list:** `GIT_READ_SUBCOMMANDS` / `GIT_SNAPSHOT_SUBCOMMANDS` in change-diff.ts.
- **`git()`:** exported for tests only (an RH guard checks that no production file imports it). It is the single `spawnSync`. It throws for a subcommand outside the allow-list, and for `add` or `write-tree` without a snapshot index.
- **`SAFE_GIT_CONFIG`:** `core.fsmonitor=false`, `core.quotePath=true`, `core.hooksPath=/dev/null`, `commit.gpgSign=false`, `core.logAllRefUpdates=false`, `core.splitIndex=false`, `gc.auto=0`.
- **Index guard (`isSnapshotIndex`):** an absolute path ending in `index`, in a real (non-symlink) directory named `factory-snapshot-*` directly under `os.tmpdir()`.
- **Exports:**
  - `factoryRef(runId, name)`;
  - `HeadState` and `SnapshotResult`;
  - `ChangeTracker.snapshot` (never throws);
  - `captureBase`, which now records `branch` and `preExisting`;
  - `SNAPSHOT_TMP_PREFIX` and `GitResult`.
- **Fixture:** `fakeChangeTracker` gains a `snapshot` option, a separate `snapshotCalls` log (I-1), `FAKE_SNAPSHOT_COMMIT` and `FAKE_SNAPSHOT_TREE`.
- **Deviations (accepted by the session):**
  - D1: one wiring line in the orchestrator (`snapshot: options.changes?.snapshot ?? DEFAULT_CHANGE_TRACKER.snapshot`). Typecheck required it, and it adds no behaviour.
  - D2: the RH guard is stricter. It also scans `contracts`, guards against any import of `git()`, and treats `git commit-tree` inside a literal as forbidden.
  - Additions:
    - an empty subdirectory gets the empty tree;
    - `GIT_LITERAL_PATHSPECS=1` on the force-add;
    - `preExisting` uses the same diff flags as `collectGit`.
- **Findings:**
  - On git 2.39, `commit-tree` ignores `commit.gpgSign`, so the two gpg settings are backups. The test still asserts the commit is unsigned.
  - Mutation checks showed that each of the following is caught: removing `hooksPath`, the identity, the force-add, the index guard, the reflog and split-index settings, the CAS, or the cleanup.
- **RULE for step 3:**
  - `snapshot()` returns `written`, `head-moved` (`{recorded, current}`; `recorded` is `{}` for an unborn base) or `failed` (`error` is the harness's text or git's first stderr line; none contains a forbidden subcommand).
  - Call it only for `base.kind === 'git'`; for `none` it returns `failed`.
  - To inject a fake: `fakeChangeTracker({ snapshot: async () => ({ kind: 'failed', error: 'boom' }) })`; calls go to `tracker.snapshotCalls`.
- **TIP:**
  - The real tracker already records `branch` and `preExisting` at a fresh start, so the D-6 note needs no orchestrator change to capture them.
  - The header of change-diff.test.ts says it is "the ONLY test file that runs real git"; step 3's SN file must update that comment.
- **Minor, unassigned:**
  - `GIT_NAMESPACE` is not stripped from the git env.
  - `recordChangeBase` makes a shallow copy (the `preExisting` array is shared). Harmless.

## Step 3 (AC-45, AC-81, AC-82, AC-84 to AC-89, orchestrator side): delivered

- **state-tracker.ts:**
  - `Stage3Snapshot`, `WrittenStage3Snapshot`, `HeadMove`;
  - the escalation reasons `HEAD_MOVED` and `SNAPSHOT_FAILED` (CRITICAL), and `context.head`;
  - `FeatureState.stage3Snapshots?`;
  - `recordStage3Snapshot`, an upsert by phase key that also validates its input;
  - `stage3SnapshotNumber` and `latestStage3Snapshot` (the B-2 seam).
- **checkpoint-presentation.ts:**
  - `presentChange(..., snapshots?)`, `SnapshotPresentationInput`, `NOT_GIT_SNAPSHOT_REASON`;
  - the section is `## Snapshots (<n>)`, built by `snapshotSection` (CPR:189), and placed before the change section;
  - without snapshots, the text is byte-identical to before.
- **Orchestrator:**
  - `takeSnapshot` (orch:1114);
  - `stage3Gate(escalationStage, at)` (orch:1172);
  - call sites at orch:1602 (Stage 3), :1757 (validator round) and :2114 (rework);
  - `presentCheckpoint` passes `snapshots` only when `stage3Snapshots !== undefined` (orch:2273);
  - `describeHead` (orch:2281).
- **Deviations (accepted by the session):**
  - `samePhase` is now exported from run-lifecycle.ts and reused, not copied;
  - new fixture `factory/test/fixtures/real-git.ts` (`setupGit`, `isolateHarnessGit`), shared with change-diff.test.ts; setup only;
  - `recordStage3Snapshot` validates its input (fails closed);
  - the scripted builder claims `src/a.ts` and `src/feature.ts`.
  - New fixtures to add to the file list at CP3: `real-git.ts`, `factory-case-variant.ts`, `state-writer.ts`.
- **PROCESS SLIP (reported by the builder):** it ran `git for-each-ref refs/factory` on this repo. That is read-only and printed 0 refs, but it breaks the standing rule. RULE restated for every builder: no git command on this repo, not even read-only ones. The session does all checks of the repo.
- **FLAKE (OPEN, owner step 5):** in the builder's first full run, 5 dev-server tests in `execution-gates.test.ts` failed (`dev.status` at :320, :343, :369). They passed in isolation, and in the builder's second run and both of the session's runs. This is likely timing under load; the new real-git file adds about 20 s of CPU. Step 5 rewrites the dev-server settle logic and must make these tests robust to load: no assertion that depends on wall-clock margins narrower than the timeouts.
- **OPEN, step 9:**
  - The snapshot section becomes the part labelled 'the snapshot notes', between the findings part and the change separator, and must stay byte-identical when no direction character is present.
  - `presentCheckpoint` must keep passing `snapshots`.
- **OPEN, step 11:** the orchestrator comment at orch:222-223 still says the factory "never opens a PR, commits or pushes". Reword it to the AC-45 (revised) sentence.
- **Test count:** 1151, +37: 30 in `snapshot.test.ts`, 7 in CPT. Mutation checks: breaking the n reuse, or dropping `snapshots` from CP3, is caught.

## Step 4 (AC-90, AC-91 static parts): delivered

- **Contracts 04 and 05:**
  - New last rule line: "Never commit, push or switch branches, and never write under `.git/` or `.factory/`. The harness snapshots your work itself."
  - "Before Declaring Done" item 3 now says: run only the tests related to the files you changed (`jest --findRelatedTests` / `vitest related --run`); the full suite runs in Gate 2.
- **`builderPrompt`:** two lines right after the scope line, on the first attempt and on a retry.
- **Tests:**
  - RH AC-90;
  - RH AC-91;
  - APT AC-90/AC-91, which also checks the lines come right after the scope line.
- **No deviations.** No existing assertion changed.
- **OPEN, step 11:** the DD AC-91 test and its SKILL.md text.

## Step 5 (AC-92 to AC-96, Gate 2): delivered

- **API (execution-gates.ts, node built-ins only):**
  - `OUTPUT_HEAD_CHARS = 65536` and `OUTPUT_TAIL_CHARS = 196608`;
  - `createBoundedOutput`, with the marker "[... Gate 2 kept the first 65536 and the last 196608 characters of this stream; <k> characters were omitted ...]";
  - `createLineScanner`, which keeps a 16 Ki partial line, the last 64 summary lines, the first 500 failed-test names and the first dev-error line;
  - `StreamScan`;
  - `selectTestSummary`, with `parseTestOutput` as its single-stream wrapper;
  - `CommandOutcome.scan`, and `ExecutionResult.summaryProblem` / `failedTests`;
  - `EXITED_PIPE_GRACE_MS = 2000`.
- **Behaviour:**
  - settle always kills the group with SIGKILL;
  - the group is killed at most 2 s after the shell exits;
  - a dev script that exits 0 early is SKIPPED with a `skipReason`, recorded as an IMPORTANT finding through the existing warnings path (orch:1308);
  - disagreeing families block with "ambiguous test summary: ...".
- **FLAKE, fixed (setup only, accepted by the session):**
  - **Cause:** the tests used a 1.5 s window that had to cover `npm run` starting node; under CPU load npm alone takes seconds.
  - **Fix:** `STARTUP_WINDOW_MS` (5 s) for stay-up scripts, `EXIT_WINDOW_MS` (30 s) for exit scripts, and the AC-13 dev project drops its `test` script. No assertion changed.
  - **Checked:** 3 runs in a row, a run concurrent with snapshot.test.ts, and 60 busy loops: all green. The cost is about +17 s on execution-gates.test.ts.
- **Interpretations (accepted):**
  - Mocha: the block from the last `passing` line.
  - A zero-count family stays in the pool.
  - `parseTestOutput` returns null when one stream holds two disagreeing families (I-9).
  - No timeout once the shell has exited.
  - AC-93 (dev) was hardened after a mutation check survived.
- **Residual risk:** AC-13's existing `elapsed < 10_000` caps that test; it took 7.0 s under heavy load.
- **OPEN, step 11 (SKILL.md and the drift test):**
  - the bound numbers and the marker text;
  - the scan limits;
  - the 2 s grace, after which output is lost;
  - the SKIPPED wording;
  - `setsid()` escaping the kill;
  - "ambiguous test summary: <family> on <stream>: ..." as the blocker text.

## Step 6 (AC-99, AC-100, AC-101, D-B1-2): delivered

- **API:**
  - `checkResumeDescription(state, supplied)` (RL:256): a blank description counts as not supplied; a mismatch is refused `DESCRIPTION_MISMATCH` with the old CLI text.
  - `exhaustedBuilder` infers the phase when `builderPhase` is missing (`inferBuilderPhase`, RL:125). Stage 4 needs `validatorRoundsCompleted` ≥ 1 (I-11).
  - `OrchestrationOptions.featureDescription?` is optional. A fresh run without one is refused `DESCRIPTION_REQUIRED` ("A new run needs a feature description (--feature).").
- **Library pre-flight order (orch):**
  1. TypeError: :450
  2. `assertNoFactoryCaseVariant`: :456
  3. On a resume:
     1. `checkResumeRequest`: :464
     2. `checkResumeDescription`: :468
     3. PAUSED no-op: :471
     4. `--approve` hash: :484
     5. I-7: :487
  4. On a fresh start: the description check at :492, then `prepareNewRunDirectory` at :497.
- **CLI resume order:**
  1. `assertNoFactoryCaseVariant(command.cwd)`: cli.ts:447 (D-B1-2; not on `--close` or `--consolidate`)
  2. `liveRunToResume`: :448
  3. banner: :452
  4. `featureDescription: command.feature` passed through: :465
  
  `assertSameDescription` and the `resumeDescription` call are removed from the CLI.
- **Pre-approved change applied:** the pre-A-2 row moved out of the RLT "AC-71 undefined" `it.each` into the AC-101 test. No other pre-existing assertion changed.
- **Mutation checks:**
  - removing the CLI guard → the AC-97 CLI test fails;
  - swapping `checkResumeRequest` and `checkResumeDescription` → 3 AC-99 tests fail.
- **RULE for step 7 (cli.ts):** the RH AC-100 guard pins three things: the banner expression, the single `.featureDescription` read, and the single `featureDescription: command.feature` pass-through. Keep those shapes.
- **RULE for step 9 (orchestrator pre-flight):** keep the order above. The pre-B-1 messages go inside the `--approve` hash check and the I-7 check.
- **OBSERVATION (for CP3):** a record from before A-1 with no `builderAttempts` would get 3+n attempts from `--grant-attempts n`, not n. AC-101's wording only covers a missing `builderPhase`. Whether such records exist is unverified. Since A-1 recorded attempts, this would only affect Phase 0 runs.
- **OPEN, step 11 (SKILL.md and DD):**
  - The library makes every description refusal, after the run-state refusals.
  - The `DESCRIPTION_MISMATCH` text and the fresh-run `DESCRIPTION_REQUIRED` text.
  - A blank description counts as none.
  - The `.Factory` refusal comes first on a CLI `--resume`.
  - The MINOR-8 inference.
  - DD AC-115 needs the phrase `DESCRIPTION_MISMATCH`.

## Step 7 (AC-102, AC-105, AC-106): delivered

- **`factory/harness/direction-characters.ts`** (pure, no imports):
  - `DIRECTION_CHARACTER_RANGES`, the only place the set is spelled; the regex is built from the ranges.
  - `isDirectionCharacter` and `directionCharacterPattern()` (a fresh `/gu` each call).
  - `findDirectionCharacters`: 1-based lines split on `\n` only; U+2028 does not break a line; a surrogate pair counts as one.
  - `formatCodePoint` (gives U+XXXX) and `escapeCodePoint` (gives backslash-u-brace, uppercase, at least 4 digits).
  - `escapeDirectionCharacters`, which is idempotent and never escapes a backslash.
  - `documentFinding(name, text)`, which groups occurrences per line and caps at 20, then "; and k more".
  - `DOCUMENT_CHECK_SOURCE`.
- **cli.ts:** `TERMINAL_UNSAFE` = control characters ∪ the set, in one replace pass. Code points up to 0xFF keep `\xNN`; everything else goes through `escapeCodePoint`. The AC-100 shapes are kept.
- **Tests:** +27. The pre-approved CLI:371-379 test was renamed and extended; all its assertions are kept.
- **RH AC-105 guard:** no non-test file may spell a set member in any form, and every user of the API must import it. It requires `document-check.ts` as an importer once that file exists.
- **Deviations (accepted):** CPR is not yet required as an importer (step 9 tightens this); `TERMINAL_CONTROL` lost its `g` flag (now used only for its `.source`).
- **The session's hidden-character scan of every changed or new source file found nothing.**
- **RULE, step 8:** use `documentFinding` and `DOCUMENT_CHECK_SOURCE` from `./direction-characters`, as they are.
- **RULE, step 9:**
  - Use `findDirectionCharacters` per labelled part, `escapeDirectionCharacters(raw)` and `formatCodePoint` for the banner.
  - Then add `expect(consumers).toContain(<checkpoint-presentation.ts>)` to the RH AC-105 guard.
- **TIP:** the builder's tool turned typed escapes inside `node -e` into real characters. It affected only a command, never a file. Build characters from code points even in shell one-liners.
- **OPEN, step 11:** the terminal escapes the whole set, U+200B to U+200D included; a backslash is never escaped; hashes are taken over the text before terminal escaping.

## Step 8 (AC-107): delivered

- **`factory/harness/document-check.ts`:**
  - `DocumentFile`;
  - `documentFindings(files)`: reads each file back, regular files only; a symlink, a directory or a missing file throws (fails closed);
  - `writtenDocuments(cwd, paths)`: an extra export, the shared path mapping.
- **ST:** `recordImportantFindingsOnce(state, stage, source, messages)`, which deduplicates per source and within the list.
- **Orchestrator:**
  - `logFindings`, `recordFindingsOnce`, `checkDocuments`;
  - `recordValidatorFindings` now uses the shared recorder, with the same semantics.
- **Hooks:**
  - `persist()` (orch:595-602);
  - `writeDocument()` (orch:731-735, all 13 calls, including the resume re-render);
  - the pre-supplied spec, after `acceptFeatureSpec` (orch ~:1418-1430);
  - consolidate-run.ts:155-175, which saves only when a finding is new.
  - `smoke-researcher.ts` is excluded, as stated in the RH guard.
- **Deviations (accepted):**
  - The read-back runs **before** the "📄 … → path" log line. The existing `consolidate.test.ts:148` `removeOnPersist` deletes the file when that line is logged. The test is unchanged.
  - The pre-supplied hook repeats `persistArtifacts`' content filter in one line, because `acceptFeatureSpec` returns no written list.
  - Consolidate saves only when there is something new.
- **Tests:** +22 (DDOC 20, RH 1, plus 1 more the builder didn't trace, possibly an existing guard that now also scans the new file). Mutation checks: removing the dedup or any hook is caught.
- **RULE, step 9:**
  - Add `expect(consumers).toContain(<checkpoint-presentation.ts>)` to the RH AC-105 guard.
  - DDOC is the home for the AC-108 to AC-110 cases.
- **OPEN, step 11:** SKILL.md describes:
  - the document check and its finding text;
  - the `document-check` source;
  - per-source dedup;
  - that a non-regular or missing document fails closed;
  - that `smoke-researcher` is excluded.

## Step 9 (AC-108, AC-109, AC-110): delivered

- **CPR:**
  - `CheckpointPresentation.unescapedSha256` (:63) is never put into `CheckpointRequest`, which still has six keys.
  - A private `PresentationPart` and `presentation(parts, …)` (:280) are the single assembler.
  - With no occurrence, `text = raw`, byte-identical to before. Otherwise the banner is followed by the escaped raw text. `sha256` is taken over `text`.
  - Part labels:
    - `USER_STORY.md`, `TECHNICAL_BRIEF.md`, `FILE_LIST.md`, `VALIDATION_REPORT.md`;
    - `the IMPORTANT findings`, `the snapshot notes`, `the change`.
    
    Lines are counted within each part.
- **Banner:** "WARNING: this presentation contains <N> invisible or direction-control character(s). Each is shown below as (backslash)u{XXXX}; the stored documents are unchanged." It is followed by one line per occurrence, "- <label>, line <L>: U+XXXX", then a blank line, `---` and a blank line.
- **Orchestrator:**
  - CP1 at :870 and CP2 at :893 now go through `presentCheckpoint`, closing the bypass; CP3 at :2002.
  - `--approve`: `representCheckpoint` (:482) → `assertPendingUnchanged` (:485) → `currentPresentation` (:2399).
  - I-7: (:488) → `currentPresentation` (:2434).
  - `presentCheckpoint` (:2307) is the only caller of `presentationFor`.
  - The pre-flight order is unchanged.
- **AC-110:**
  - `recordedBeforeEscaping` (:2374) and `presentationChangedInThisVersion` (:2379) give one shared message for ARTIFACT_CHANGED and APPROVED_ARTIFACT_CHANGED: "<checkpoint>: the presentation changed in this version: invisible or direction-control characters are now shown escaped under a warning banner, so the hash recorded before this version no longer matches. Close the run: npm run factory -- --close <id> --cwd <cwd>".
  - Any other mismatch keeps the old message.
- **Deviations (accepted):**
  - `currentHash` is renamed `currentPresentation`.
  - The findings part's trailing newline moved into the separator part; the bytes are the same.
  - The RH AC-109 guard is stricter: it bans `sha256Hex` in the orchestrator.
  - No backticks around the `--close` command, matching the existing messages.
  - Extra tests for N-16 and for "edited since B-1, so the old message is kept".
- **Tests:** +15. The RH AC-105 guard now also requires CPR as a consumer.
- **OPEN, step 11:** SKILL.md documents:
  - the banner;
  - the part labels and per-part line counting;
  - the hash over the escaped text, with terminal escaping coming after;
  - that a typed escape gets no banner line;
  - N-16, and that source files raise no finding;
  - the pre-B-1 refusal and `--close`.
  
  DD AC-115 phrases: `\u{XXXX}`, `escaped`, `--close`.

## S-1 (AC-112 moves): done by the session, operator-approved

- **Moved (staged as R100 renames; nothing else staged):**
  - `factory/feature/docs/{README,ORCHESTRATOR,QUICK_START,STAGE_GUIDE,ARCHITECTURE}.md` → `docs/archive/feature-docs/`
  - `factory/feature/reference/{STAGE_CONTRACTS,STATE_TRACKING,OUTPUT_SCHEMAS}.md` → `docs/archive/feature-reference/`
- `factory/feature/docs/` is now empty. `factory/feature/reference/` keeps `ERROR_CATEGORIES.md`.
- **RULE, step 11:**
  - Edit the archived files in place at their new paths (add the header line).
  - Create the 8 pointer files at the old paths.
  - Run no git command. The session stages the step-11 files later.

## Step 11 (docs: AC-91/AC-93 doc parts, AC-111 to AC-115): delivered

- **New:**
  - `docs/ROADMAP.md`: the plan of record; Phases A–E with D done (PR #5); a mapping table for rows 0a to 3 (rows 2 and 3 "not scheduled in A–E"; worktree parallelism superseded); the A-2 MINOR-3 accepted risk with the git ≥ 2.42 trigger; the `refs/factory/*` cleanup backlog.
  - 8 pointer files at the old paths.
- **Edited:**
  - the 8 archives, each with the header line;
  - SKILL.md (edits 1–11; the AC-60 line kept, now at :537);
  - README (four stages and three checkpoints; Stage 5 only via `--consolidate`; the PR-review line removed; the layout lines);
  - REFACTOR_PLAN (a "superseded" first line) and `docs/archive/README.md`;
  - comments in the orchestrator (:222-224, :409-411) and cli.ts:107.
- **DD:**
  - `KEPT_DOCS` = SKILL, README, the 8 pointers, ROADMAP, ERROR_CATEGORIES.
  - Retired claims are generalised and also matched with whitespace collapsed; the README is checked only before `## Skills`.
  - +14 tests. The AC-60 test is unchanged.
- **Deviations (accepted):**
  - Retired-claim matching also runs on whitespace-collapsed text.
  - The accepted risk is labelled "A-2 MINOR-3", to tell it apart from A-1 MINOR-3.
  - ROADMAP says "the operator's persistent-memory server", because `/memorykit/i` is a retired pattern.
  - Two more now-false "read-only git" comments were reworded.
- **Not verifiable against code:** ROADMAP row 1.5 ("partly done") comes from A2_CONSOLIDATION_REPORT.
- **OPEN, for CP3:**
  - `docs/HARNESS_GAP_ANALYSIS.md` gets no "superseded" line (brief I-17 mentioned it, D-16 does not).
  - The README status table is left for Phase E.

## Build totals (PR B-1)

- **11 builder steps plus S-0, S-1, S-2.**
- **Builder time:** about 123 min (steps 10, 1–9, 11). Session checks: about 20 min. S-0: 7.5 min.
- **Tests:** 1076 → 1271 (+195), with 1 skipped (case-sensitive filesystem only).
- **Suite time:** 191 s → 78 s.
- **Existing assertions changed, all approved:**
  - the AC-45 guard (RH);
  - MINOR-8 (RLT);
  - the bidi test (CLI, extended);
  - CDT:66 and :72 (I-2);
  - DD:164-197 generalised by design.
- **New files not in B1_FILE_LIST:** `fixtures/state-writer.ts`, `fixtures/factory-case-variant.ts`, `fixtures/real-git.ts`, `harness/document-check.ts`'s `writtenDocuments` export (in a planned file).
