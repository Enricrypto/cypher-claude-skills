# B1_TECHNICAL_BRIEF.md: Phase B, PR B-1 "Snapshots, Gate 2 fixes, lifecycle, invisible characters, docs"

> Feature Factory, by-hand mode. Agent 03 (Spec Writer), read-only. 2026-10-05.
> Inputs: `USER_STORY.md` (CHECKPOINT 1, sha256 7a05811e…), `B_DECISIONS.md` (binding), `B_RESEARCHER_REPORT.md`, A-2 brief/file list/patterns, A-1 patterns, `factory/feature/SKILL.md`, and the code. Every file:line below was re-read against the code on `feat/phase-b1-commit`.
> Skills loaded with Read: `~/.claude/skills/software/architecture-patterns.md` and `~/.claude/skills/software/api-design-principles.md` (both first Reads succeeded).
>
> **Scope:** AC-45 (revised) and AC-80 to AC-115. B-2/B-3 are context only; §2 names the seams they build on.
> **Out of scope:** everything in the story's Out of Scope list; the "test path" definition (AC-121, B-2, deferred).

Path abbreviations (all under `/Users/enriqueibarra/cypher-claude-skills/`): orch = `factory/feature/workflows/feature-factory-orchestrator.ts`; CD = `factory/harness/change-diff.ts`; EG = `factory/harness/execution-gates.ts`; RL = `factory/harness/run-lifecycle.ts`; ST = `factory/harness/state-tracker.ts`; CPR = `factory/harness/checkpoint-presentation.ts`; RD = `factory/harness/run-directory.ts`; cli = `factory/runner/cli.ts`; RH = `factory/test/contracts/repo-hygiene.test.ts`; DD = `factory/test/contracts/doc-drift.test.ts`.

## 0. Prior specification patterns

**Follow:**
- C-1 seams: `changes` (orch:401, :413-416) grows one method, `snapshot`; tests keep injecting `fakeChangeTracker()`. Only change-diff and the new snapshot tests run real git.
- C-20 single choke point + source-scan guard: all git through `git()` (CD:87-109), one `spawnSync`; all Stage 3 gate passes go through `stage3Gate` (orch:1081-1094; called at :1511, :1666, :2023), so the snapshot hooks there once.
- C-16 refuse before any write: every new refusal (AC-97, AC-99) sits in the pre-flight (orch:425-456), outside the try.
- C-14 hash-bound approval: `presentationFor` (CPR:142) stays the one presentation function; escaping happens inside it, so presenting, `--approve` and I-7 compare like with like.
- C-18 write primitives unchanged: documents still go through `writeFileNoFollow`, records through `writeFileAtomic`.
- C-2 fail closed: an ambiguous test summary blocks; a snapshot that cannot be written escalates.
- C-3 trust only harness measurement: the document check reads back what the harness wrote; it never trusts the agent's own flag.
- C-23 one helper per formatting rule: one `escapeCodePoint` for both terminal and checkpoint escaping.
- P-13 test policy, P-20 caller list (§6), P-12 build notes, P-14 timing.

**Avoid:** a second git spawner; logic in `cli.ts` (NEW-MINOR-1 is exactly that); a lossy fallback (refuse instead); a guard that reads an unexpected file type as empty.

**Problems the code shows that B-1 must design around:**
1. `ChangeTracker` (CD:49-54) is a required-method interface; `FakeChangeTracker` (fixtures/changes.ts:14) must grow with it.
2. `checkpoint-lifecycle.test.ts:539-542` pins the tracker call log exactly. A snapshot call in that log breaks it (I-1).
3. `change-diff.test.ts:66` and `:72` pin `captureBase` output with `toEqual` (I-2).
4. EG may import only node built-ins: `execution-gates.test.ts:520-529` transpiles EG alone and `require`s it. Any new Gate 2 helper must live inside EG. RH:185-207 bans `spawnSync`, `execSync`, `execFileSync`, `Promise.all/allSettled/race/any` and a shell `timeout` there.
5. RH:309-310 forbid the string literals `'commit'`/`'push'` and `git commit|push` in any literal in `feature/workflows`, `runner`, `harness`. `"git commit-tree"` in a message would match `\bgit\s+commit\b`. No string literal may contain `git <forbidden subcommand>`.
6. `orch:798` and `orch:821` call `presentStory`/`presentBrief` directly, bypassing `presentationFor` (AC-109 requires one function).
7. `checkpoint-lifecycle.test.ts:177` requires the CP3 text to END with the change section, and `:181` requires `CheckpointRequest` to have exactly six keys.
8. `docs/archive/README.md` already exists, so the 8 archived files cannot be moved flat into `docs/archive/` without colliding (`README.md`).

**Frontend Builder: not needed.** Nothing in the file list matches `isFrontendPath`; there is no UI. The Backend Builder implements every step.

## 1. Overview

A TypeScript library plus CLI; no HTTP, no database, no UI. "Data model" = `state.json` and git objects/refs; "API" = exported TypeScript and CLI behaviour.

What B-1 makes true:
1. Every passing Stage 3 gate writes a private snapshot commit at `refs/factory/<id>/stage3-<n>` with plumbing, recorded in state before the next agent runs. Branch, index and working tree are never touched.
2. Builders are told (not forced) to run only related tests and never to commit; Gate 2's full suite is the enforcement.
3. Gate 2: bounded output, streaming line scan, per-stream runner-marker parsing, dev exit-0 = SKIPPED, process group always killed.
4. Lifecycle: `.Factory` refused before any write; description refusals move into the library; pre-A-2 `MAX_LOOPS` infers its phase.
5. Invisible direction characters: one shared set; documents stored exactly as written plus an IMPORTANT finding; checkpoints escape and warn, and hash what was shown; the terminal shows `\u{XXXX}`.
6. Docs: `docs/ROADMAP.md`; 8 stale docs archived with pointers; drift test covers every kept doc; README and SKILL.md corrected.

## 2. Design decisions

### D-1 Git subcommand allow-list (AC-80)

```ts
// CD
export const GIT_READ_SUBCOMMANDS = ['rev-parse', 'diff', 'ls-files'] as const;
export const GIT_SNAPSHOT_SUBCOMMANDS = ['add', 'write-tree', 'commit-tree', 'update-ref'] as const;
type GitSubcommand = (typeof GIT_READ_SUBCOMMANDS)[number] | (typeof GIT_SNAPSHOT_SUBCOMMANDS)[number];
```
- This is the minimum set. `read-tree`, `hash-object`, `cat-file`, `status` and `symbolic-ref` are not needed (D-3, D-6). B-2 adds a third array for its extraction command, and the guard grows by one array.
- Never allowed: `push`, porcelain `commit`, `checkout`, `switch`, `reset`, `merge`, `rebase`, `stash`, `branch`, `tag`, `worktree`, `fetch`, `clone`. None of these may appear as a whole string literal, or after `git ` inside any literal, in `feature/workflows`, `runner`, `harness` or `contracts`. A grep of today's code finds none.

### D-2 Every git call: argv, config and env (AC-83)

`git(cwd, subcommand, args, env?)` stays the only function that calls `spawnSync`, and its argv shape stays `spawnSync('git', [...SAFE_GIT_CONFIG, subcommand, ...args], …)`. `SAFE_GIT_CONFIG` (CD:77) grows to cover every call:

| `-c` setting | Why |
|---|---|
| `core.fsmonitor=false`, `core.quotePath=true` | existing |
| `core.hooksPath=/dev/null` | No hook can run. `update-ref` fires `reference-transaction` (git ≥ 2.28), and `add` and index writes fire `post-index-change`. Git looks for `/dev/null/<hook>`, which can never be executable, so it runs nothing. A command-line `-c` overrides a repo's own `core.hooksPath` (AC-83's test sets one to prove it). POSIX only, like Gate 2 (A-1 I-14). |
| `commit.gpgSign=false` | Belt and braces with `--no-gpg-sign` (D-1 of B_DECISIONS). |
| `core.logAllRefUpdates=false` | No reflog is created for `refs/factory/…` |
| `core.splitIndex=false` | Writing the temporary index must not write a `sharedindex.*` file into `.git/`. |
| `gc.auto=0` | Defensive: no auto-maintenance from any call. |

None of these changes `diff`/`ls-files` output, so the CP3 text is unchanged (AC-89).

Env:
- The existing env stays (`GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`; `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` and `GIT_COMMON_DIR` stripped).
- Then the optional `env` argument is applied last.
- **Runtime guard:** `git()` throws unless `add` and `write-tree` carry `env.GIT_INDEX_FILE` inside the snapshot's own `mkdtemp` directory. A slip would otherwise write the user's `.git/index`.
- `commit-tree` gets `GIT_AUTHOR_NAME=GIT_COMMITTER_NAME=Feature Factory` and `GIT_AUTHOR_EMAIL=GIT_COMMITTER_EMAIL=feature-factory@localhost.invalid` (I-24). It therefore never needs `user.name`/`user.email`.
- stdin stays `'ignore'`: nothing can wait on input.

### D-3 The snapshot write (AC-81, AC-82, AC-85)

`ChangeTracker.snapshot(cwd, base, runId, n): Promise<SnapshotResult>` never throws. Steps, all with `SAFE_GIT_CONFIG`:
1. `rev-parse --is-inside-work-tree`. Not `true` → `failed` ("no longer a git work tree").
2. **HEAD check (D-4)**, before any object is written. If HEAD moved → `head-moved`; nothing is written.
3. `rev-parse --show-prefix`. This is the project's path inside the repo; empty at the top level.
4. `tmp = mkdtempSync(join(os.tmpdir(), 'factory-snapshot-'))`, `idx = join(tmp, 'index')`. The index file does not exist yet, which git reads as an empty index. The index and its lock live outside the repo.
5. `add -A -- . :(exclude).factory` with `GIT_INDEX_FILE=idx`. Starting from an empty index, this adds every non-ignored file in the project, tracked or untracked.
6. Tracked-but-ignored files (force-added earlier):
   - list them with `ls-files --cached -i --exclude-standard -z -- . :(exclude).factory` against the **user's** index (read-only; no temp env);
   - keep only those that exist (`lstatSync`);
   - add them with `add -f -- <paths>` and `GIT_INDEX_FILE=idx`, in chunks of 500 paths.
   
   So the tracked set equals the user's index, as CP3's `git diff <base>` sees it (I-3).
7. `write-tree` (plus `--prefix=<prefix>` when the prefix is not empty) with `GIT_INDEX_FILE=idx` gives `tree`. **The snapshot tree's root is the project directory (cwd).** That equals the repo root when cwd is the top level, and it is exactly what CP3 shows (`--relative`, pathspec `.`).
8. `ref = factoryRef(runId, `stage3-${n}`)`. Idempotency compares trees (not record-first):
   - Read the existing ref: `rev-parse --verify --quiet <ref>^{commit}`. Absent → no existing commit.
   - If it exists, read its tree (`rev-parse --verify --quiet <c>^{tree}`) and parent (`rev-parse --verify --quiet <c>^1`; absent for a root commit).
   - Same tree and same parent as now → `written`, `reused: true`, no new object.
   - Otherwise `commit-tree --no-gpg-sign [-p <HEAD>] -m "Feature Factory snapshot <runId> stage3-<n>" <tree>`. There is no `-p` on an unborn branch, which gives a root commit (AC-82).
   - Then `update-ref <ref> <new> <old>`, where `<old>` is the existing commit or `''` (git: the ref must not exist). This is compare-and-swap; a race fails as `failed`.
9. `finally`: `rmSync(tmp, {recursive:true, force:true})`. This is the harness's own temp dir, not a run artifact, so C-17 does not apply.
10. Any non-zero git exit gives `{kind:'failed', error: <git's first stderr line>}`.

**Why compare-tree and not record-first:** record-first needs a second state write before the ref and a reconcile rule on resume. Compare-tree is local to one call and gives AC-85 directly: an unchanged tree reuses the commit, and a changed tree replaces the ref (CAS).

**Why no `read-tree HEAD`:** starting from HEAD would keep tracked files under `.factory/` and miss staged-new files. An empty index plus `add -A` plus the force-add list matches CP3 exactly, with no extra subcommand.

**`factoryRef(runId, name)`** (CD, exported) is the only place the literal `refs/factory/` appears in production code.
- It returns `refs/factory/${runId}/${name}`.
- It throws unless `isSafeRunId(runId)` holds, `runId` does not end in `.lock` or `.`, and `name` matches `/^stage3-[1-9]\d*$/`.
- A throw inside `snapshot()` becomes `failed`.

### D-4 The HEAD check (AC-86)

- **Where HEAD is read:** inside `snapshot()`, at step 2, in the same call that writes. This keeps the gap between the check and the write as small as possible.
  - commit: `rev-parse --verify --quiet HEAD^{commit}` (undefined on an unborn branch);
  - branch: only when a commit exists, `rev-parse --symbolic-full-name HEAD` (`refs/heads/<x>`, or `HEAD` when detached).
- **The base gains fields:** `ChangeBase = {kind:'git'; commit?; branch?; preExisting?: string[]} | {kind:'none'; reason}`. `captureBase` fills `branch` and `preExisting` at a fresh start (D-6).
- **The comparison:**
  - `recorded.commit !== current.commit` (undefined counts as a value, so an unborn base followed by a commit is a move);
  - or `recorded.branch !== undefined && recorded.branch !== current.branch`.
- A base recorded before B-1 has no `branch`, so only its commit is compared.
- On an unborn branch the branch name cannot be read with `rev-parse` (I-6).
- **Result:** `{kind:'head-moved', recorded, current}`. The orchestrator escalates `HEAD_MOVED` (D-8).

### D-5 Orchestrator wiring (AC-81, AC-85-88)

- `stage3Gate(escalationStage, at: BuilderPhase)`. The call sites pass `{phase:'stage3'}` (orch:1511), `{phase:'validator-round', round}` (:1666) and `{phase:'rework', round: cycle}` (:2023). After `decision.canAdvance` it calls `takeSnapshot(escalationStage, at)`, which returns `FeatureState | undefined` like every helper.
- **`takeSnapshot`:**
  - `base = state.changeBase`.
  - If `base` is missing or `kind:'none'`, commit a `skipped` record with reason `'not a git work tree'` (or `'the run recorded no change base'` for a pre-A-2 run), log it, and return `undefined` (AC-87: the run continues).
  - Otherwise `n = stage3SnapshotNumber(state, at)`:
    - the `n` of an existing `written` entry for the same phase key (`stage3` / `validator-round`+round / `rework`+round);
    - else 1 + the highest written `n`.
    
    A re-evaluated gate pass in the same phase therefore reuses its `n` (I-4). That covers both kill windows: before the ref is written, and after the ref but before the state save.
  - Then `changes.snapshot(cwd, base, state.featureId, n)`.
  - `written` → `state = commit(recordStage3Snapshot(state, {...}))`. This is committed before anything else runs (AC-81).
  - `head-moved` → escalate `HEAD_MOVED` and `finish`.
  - `failed` → escalate `SNAPSHOT_FAILED` with git's text, record no entry, `finish` (AC-88).
- **Resume:** the gate always re-runs (A-2 D-2).
  - In Stage 3: Stage 3 is not complete, so the gate runs again.
  - In a validator round: `pendingValidatorRound` (run-progress.ts:174-199) re-enters the round because no Gate 2 record exists for it. The builders are skipped and Gate 1 and `stage3Gate` run again.
  - In a rework: the rework is active until CP3 is approved.
- Escalations are not invalidations: builders stay PASS.

### D-6 Pre-existing changes (AC-84)

- `captureBase` (CD:186-194, fresh start only) adds `preExisting`. It is read-only and sorted unique.
  - Born HEAD: `diff --name-only -z --no-renames --relative <HEAD> -- . :(exclude).factory` ∪ `ls-files --others --exclude-standard -z -- . :(exclude).factory`.
  - Unborn: `ls-files --cached -z` ∪ `--others`.
- A failure leaves `preExisting` undefined ("unknown"). `captureBase` still never throws.
- The CP3 note (D-12):
  - non-empty → "The snapshots and the change include N path(s) that were already changed or untracked when the run started:" plus the list;
  - empty → no note;
  - `kind:'git'` with `preExisting` undefined (a run started before B-1) → "Whether the snapshots and the change include changes that were already in the working tree when the run started is unknown: this run started before the factory recorded them."

### D-7 Snapshot state (AC-81, AC-87)

```ts
// ST
export type Stage3Snapshot =
  | { status: 'written'; n: number; ref: string; commit: string; tree: string; at: BuilderPhase; takenAt: string; reused?: true }
  | { status: 'skipped'; reason: string; at: BuilderPhase; takenAt: string };
// FeatureState: + stage3Snapshots?: Stage3Snapshot[]   (NOT initialised by createFeatureState; absent = no B-1 snapshot event yet)
export function recordStage3Snapshot(state, s: Stage3Snapshot): FeatureState;   // upsert by phase key (I-4)
export function stage3SnapshotNumber(state, at: BuilderPhase): number;           // D-5
export function latestStage3Snapshot(state): Extract<Stage3Snapshot,{status:'written'}> | undefined;  // B-2 seam
```
AC-81's fields map as: n → `n`, ref → `ref`, commit sha → `commit`, tree sha → `tree`, phase → `at`, time → `takenAt`. A skipped record holds `reason: 'not a git work tree'`.

### D-8 Escalations

- `EscalationRecord.reason` gains `'HEAD_MOVED' | 'SNAPSHOT_FAILED'`, both CRITICAL. Add them to the severity list at ST:444.
- `context` gains `head?: { recorded: {commit?, branch?}; current: {commit?, branch?} }`.
- `HEAD_MOVED` message: "HEAD moved since the run started: recorded <branch|detached|unborn> at <commit|no commit>, now <…>. No snapshot was written. Restore HEAD to the recorded branch and commit, then `npm run factory -- --resume <id> --cwd <cwd>`; or close the run: `npm run factory -- --close <id> --cwd <cwd>`."
  - No literal may contain `git checkout`/`git switch` (§0.5).
- `SNAPSHOT_FAILED` message: "Snapshot stage3-<n> could not be written: <git error>. Nothing was recorded. Fix the cause, then resume."

### D-9 Gate 2 (AC-92 to AC-96), all inside EG

**Output bound (AC-94):**
- `OUTPUT_HEAD_CHARS = 64 * 1024` and `OUTPUT_TAIL_CHARS = 192 * 1024`. That is **256 Ki characters (UTF-16 code units) per stream**, plus one marker.
- **Why this number:**
  - Counts, failed-test names and dev-error lines no longer come from these buffers (see the scanner below). The buffers serve humans only: the report shows 500 characters of stderr (EG:632) and `buildErrors` keeps the last 500 (EG:672).
  - 256 Ki matches `MAX_INLINE_BYTES` (CD:65).
  - Worst-case memory is 3 commands × 2 streams × 256 Ki × 2 B, about 3 MiB.
- **Exported `createBoundedOutput()`:** the head fills to 64 Ki. The tail keeps the last 192 Ki; the builder slices it only when it passes 2 × tail, so the cost stays amortised. `text()` returns `head + marker + tail`, with marker `\n[... Gate 2 kept the first 65536 and the last 196608 characters of this stream; <k> characters were omitted ...]\n`, or the whole output when nothing was dropped.
- `CommandOutcome.stdout`/`stderr` (and so `ExecutionResult`) carry `text()`.

**Streaming line scanner (AC-95):** `createLineScanner()`, one per stream, fed every chunk.
- It keeps a partial line across chunks, capped at 16 Ki characters; past the cap the line is cut for scanning and the rest dropped until `\n`. On settle it flushes the last partial line.
- Each complete line is `stripAnsi`'d, then:
  - (a) a test-summary or runner-marker line is kept, at most the last 64 per stream. These are Jest `^\s*Tests:`, `^\s*Test Suites:`, Vitest `^\s*Tests\s+\d+…\(\d+\)`, `^\s*Test Files\s`, and Mocha `^\s*\d+\s+(passing|failing|pending)\b`;
  - (b) a failed-test name, through a new single-line helper `failedTestNameOf(line)` (the same regexes as EG:369-372). `parseFailedTestNames` becomes `lines.map(failedTestNameOf)` (one implementation). The first 500 names are kept;
  - (c) the first `DEV_SERVER_ERROR_PATTERN` line.
- A line split across two chunks is matched once it is complete.

**Per-stream parse (AC-96):** `selectTestSummary({stdout: string[], stderr: string[]})` (pure, exported) returns `{kind:'stats', stats} | {kind:'ambiguous', detail} | {kind:'none'}`.
1. For each stream and each family (jest, vitest, mocha), the family's last summary line gives `stats()` (EG:299). `marked` = that family's marker line is in the same stream (Jest `Test Suites:`, Vitest `Test Files`; Mocha's `passing` line is its own marker).
2. `pool` = the marked candidates if there are any, else all candidates.
3. All pool counts (passed, failed, skipped, todo, total) equal → `stats`. More than one distinct → `ambiguous`, naming each family, stream and its counts. Empty → `none`.

- `parseTestOutput(text)` stays as the single-stream wrapper: `stats` or `null`. AC-8 and AC-9 hold unchanged.
- `runTestSuite` uses the two scanners. On `ambiguous` it sets `failureReason: 'ambiguous test summary: <detail>'` and a new `ExecutionResult.summaryProblem`.
- `validateExecutionGate` (EG:547) emits `ambiguous test summary: …` instead of "no tests detected" when `summaryProblem` is set.
- Unmarked families that disagree are also ambiguous (I-9).

**Dev exits 0 early (AC-92):** in `verifyDevServer`, after the error, non-zero-exit and error-line checks:
- `!timedOut && exitCode === 0` → `status:'SKIPPED'`, `passed:true`, with `skipReason: 'the dev script exited with code 0 after <s>, before the <window> window ended; a dev server that is not running was not verified'`.
- `resultWarnings` (EG:500-514) already turns SKIPPED into a warning, and orch:1217 records warnings as IMPORTANT findings.
- An error line still FAILS, even with exit 0.

**Process group (AC-93):**
- In `settle`, `killGroup(child.pid,'SIGKILL')` becomes unconditional (EG:249).
- New: on the child's `'exit'` event (the shell ended) the exit code and signal are recorded. If `'close'` has not followed after `EXITED_PIPE_GRACE_MS = 2_000`, the group is SIGKILLed and `settle` runs when the pipes close, or after `PIPE_CLOSE_GRACE_MS`.
  - A grandchild holding the pipes can no longer stretch a command to its timeout.
  - A `dev` that backgrounds itself and exits 0 is seen as exited early (AC-92), not as timed out (I-8).
- `exitCode` comes from `'exit'`.
- A process that calls `setsid()` leaves the group and is not killed. SKILL.md says so (AC-93 [S]).

### D-10 Lifecycle and CLI

**AC-97:**
- RD gains `assertNoFactoryCaseVariant(cwd)`. It reads `readdirSync(cwd)` (ENOENT = no entries) and throws `RunRefusedError('FACTORY_DIR_CASE_CONFLICT', …)` naming the absolute path of every entry whose `toLowerCase()` is `.factory` but which is not exactly `.factory`.
- Message: "<path> differs from the harness directory .factory only in letter case; git's `:(exclude).factory` would not exclude it. Rename or remove it, then run again."
- `RunRefusalCode` gains `FACTORY_DIR_CASE_CONFLICT`.
- **Placement:** the first check in the pre-flight, right after the TypeError guard (orch:426-428), for a fresh start and a resume alike. That is before `checkResumeRequest`, before `prepareNewRunDirectory` (orch:458), and before any read of the run directory that could follow a case-folded path.
- The exact pathspec (CD:80) is kept.
- `--close` and `--consolidate` are not checked (I-15).

**AC-99/100 (NEW-MINOR-1):**
- `OrchestrationOptions.featureDescription` becomes optional (`featureDescription?: string`, orch:337).
- RL gains `checkResumeDescription(state, supplied): string`:
  - `supplied` that is non-blank, with a saved description it does not equal → `DESCRIPTION_MISMATCH`. The message is today's CLI text (cli.ts:415-419): "--feature … does not match the description saved in run <id> (…). Omit --feature to resume it as it was started."
  - otherwise it returns `resumeDescription(state, supplied)` (RL:221-229; `DESCRIPTION_REQUIRED` unchanged). A blank `supplied` counts as not supplied (I-10).
- **Library pre-flight order on a resume:**
  1. `assertNoFactoryCaseVariant`;
  2. `checkResumeRequest` (`RUN_FINISHED`, `NEEDS_GRANT` and the rest win);
  3. `checkResumeDescription`;
  4. the PAUSED + continue no-op;
  5. the `--approve` hash check;
  6. I-7.
- **Fresh start:** a missing or blank description → `DESCRIPTION_REQUIRED` ("A new run needs a feature description (--feature)."), before `prepareNewRunDirectory`.
- orch:463-466 saves the value `checkResumeDescription` returned.
- **What the CLI still reads:**
  - it deletes `assertSameDescription` (cli.ts:412-420) and the `resumeDescription` call and import (cli.ts:37, :460-461);
  - it passes `featureDescription: command.feature` through (possibly `undefined` on resume);
  - it reads the description only for the banner (cli.ts:464): `run` → `command.feature`; `resume` → `resumeFromState.featureDescription ?? command.feature ?? '(not recorded)'`.
- The banner now prints before a library refusal; the existing CLI tests match on the message text, which is unchanged.

**AC-101 (MINOR-8):**
- In `exhaustedBuilder` (RL:123-135), `at = latest.context.builderPhase ?? inferBuilderPhase(state, latest)`:
  - escalation stage 3 → `{phase:'stage3'}`;
  - stage 4 → `{phase:'validator-round', round: state.validatorRoundsCompleted}` when it is an integer ≥ 1;
  - otherwise undefined (not inferable, so the old behaviour stays; I-11).
- `checkResumeRequest`, `nextStepHints` and `applyResume`'s grant (orch:1916-1923) all use `exhaustedBuilder`, so the refusal, the hint and the grant phase all follow.
- `runBuilderLoop` then runs attempts `used+1 .. 3+n` in that phase.

### D-11 Shared character set and terminal escaping (AC-102, AC-105, AC-106)

**New module `factory/harness/direction-characters.ts`** (pure, no imports):
```ts
export const DIRECTION_CHARACTER_RANGES: ReadonlyArray<readonly [number, number]> =
  [[0x061c,0x061c],[0x200b,0x200f],[0x2028,0x202e],[0x2066,0x2069],[0xfeff,0xfeff]];   // THE set (single source)
export function isDirectionCharacter(codePoint: number): boolean;
export function directionCharacterPattern(): RegExp;                 // fresh /[…]/gu built from the ranges
export function findDirectionCharacters(text: string): Array<{ line: number; codePoint: number }>;  // 1-based, lines split on '\n' only
export function formatCodePoint(cp: number): string;                // 'U+202E'
export function escapeCodePoint(cp: number): string;                // '\u{202E}': uppercase hex, at least 4 digits
export function escapeDirectionCharacters(text: string): string;
export function documentFinding(name: string, text: string): string | undefined;   // D-12
export const DOCUMENT_CHECK_SOURCE = 'document-check';
```
- `printableForTerminal` (cli.ts:121-127) runs one replace over `TERMINAL_CONTROL ∪ the set`:
  - code point ≤ 0xFF → `\xNN` (unchanged);
  - otherwise `escapeCodePoint` (every set member is above 0xFF; U+200B–U+200D are now escaped too).
- CRLF handling is unchanged. A backslash is never escaped.
- **Already-escaped text:** text that `presentationFor` escaped contains no set character, so `printableForTerminal` leaves its `\u{…}` text as is. There is no double escape. A literal backslash in a document stays a single backslash (the CP banner, D-13, is what tells a real character from its typed escape).
- **The hash:** in AC-102, "raw text" means the text before terminal escaping. Approvals hash `presentationFor`'s escaped output (CHECKPOINT 1 note).

### D-12 The document check (AC-107)

- **New module `factory/harness/document-check.ts`:** `documentFindings(files: Array<{ name: string; path: string }>): string[]`.
  - It reads back each written file (lstat: regular file only; utf8). That is exactly what is on disk (C-3).
  - It returns `documentFinding(name, content)` for each affected one.
- **Message format** (one per document, deterministic): `<NAME> contains invisible or direction-control characters (stored exactly as written): line 3: U+202E; line 7: U+200B, U+2066`. At most 20 occurrences are listed, then `; and <k> more` (I-13).
- `ST` gains `recordImportantFindingsOnce(state, stage, source, messages)`. It skips any message already recorded with the same source. `recordValidatorFindings` (orch:1673-1684) switches to it with identical semantics (no duplicate logic).
- **Every harness write path for these documents, and its hook:**

| Write path | Documents | Hook |
|---|---|---|
| orch:553-557 `persist()` → `persistArtifacts` (stage-context.ts:215-256); callers orch:1358, :1430, :1468, :1734 | RESEARCHER_REPORT, USER_STORY, TECHNICAL_BRIEF, FILE_LIST, VALIDATION_REPORT | `persist(partial)` calls `checkDocuments(state.currentStage, written)` |
| orch:667-669 `writeDocument()` → `writeHarnessDocument` (harness-documents.ts:254-269); callers orch:1487-1488, :1497, :1632, :1652-1653, :1660, :1942-1946, :2012-2013, :2017 | BACKEND_SUMMARY, API_CONTRACT, FRONTEND_SUMMARY, TEST_REPORT | `writeDocument` calls `checkDocuments(state.currentStage, [path])` |
| feature-spec.ts:137 `persistArtifacts`, reached from orch:1247 | pre-supplied RESEARCHER_REPORT, USER_STORY, TECHNICAL_BRIEF, FILE_LIST | after an accepted `acceptFeatureSpec`, the orchestrator calls `checkDocuments(2, <the supplied artifacts' rewritten paths>)` |
| consolidate-run.ts:152 `persistArtifacts` | CONSOLIDATION_REPORT, PATTERNS | `save(recordImportantFindingsOnce(state, 5, DOCUMENT_CHECK_SOURCE, documentFindings(…)))` |
| runner/smoke-researcher.ts:68 | operator-only, no run state | excluded, stated in the guard |

- `checkDocuments(stage, files)` = `recordFindings`-style log plus `state = commit(recordImportantFindingsOnce(…))`.
- Dedup on resume: `applyResume` re-renders the harness documents (orch:1940-1946); identical content gives the identical message, so nothing is added.
- `persistArtifacts` and `writeHarnessDocument` keep their signatures. `stage-context.test.ts:731` and `harness-documents.test.ts:74` are untouched (I-12).
- B-2's follow-up and skeptic documents are covered automatically: they are persisted through `persist()`.

### D-13 Presentation (AC-108, AC-109, AC-110)

- In CPR, `presentation(parts, artifactPaths)` replaces the plain helper (CPR:152-154). `parts` is an ordered list of `{ label?: string; text: string }`:
  - CP1: `[{label:'USER_STORY.md', story}]`.
  - CP2: `[{label:'TECHNICAL_BRIEF.md'}, {separator}, {label:'FILE_LIST.md'}]`.
  - CP3: `[{label:'VALIDATION_REPORT.md'}, {sep + findings header}, {label:'the IMPORTANT findings', lines}, {sep}, {label:'the snapshot notes', snapshot section, only when given}, {sep + '## Change (source: …)\n\n'}, {label:'the change', change.text}]`.
  - Lines are counted within each labelled part. "The change" counts lines of `change.text` (N-16).
- **Raw** = the parts joined; that is today's text exactly.
- **Occurrences** = `findDirectionCharacters` per labelled part.
- **None** → `text = raw`. Byte-identical to pre-B-1 when nothing else changed: AC-110's no-character case.
- **Some** → `text = banner + escapeDirectionCharacters(raw)`, where `banner =`
  ```
  WARNING: this presentation contains <N> invisible or direction-control character(s). Each is shown below as \u{XXXX}; the stored documents are unchanged.
  - <label>, line <L>: U+XXXX        (one line per occurrence, in order)
  
  ---
  
  ```
- `sha256 = sha256Hex(text)`.
- `CheckpointPresentation` gains `unescapedSha256 = sha256Hex(raw)`. It is never put into `CheckpointRequest`: the request keeps exactly six keys.
- A real character becomes a banner line plus `\u{XXXX}`; a typed `\u{XXXX}` gives no banner line. Swapping one for the other therefore always changes the text and the hash.
- **CP3 snapshot section** (`presentChange(runDirAbs, findings, change, snapshots?)`; `ChangePresentationInput.snapshots?`):
  - It is present only when the orchestrator passes it, which it does iff `state.stage3Snapshots !== undefined`.
  - Text: `## Snapshots (<count written>)`, then one line per entry: `- stage3-<n> · <Stage 3 | validator round r | CHECKPOINT 3 rework r> · <ref> · commit <sha> · tree <sha>`, or `- skipped · <phase> · <reason>`.
  - Then the not-git sentence "No snapshot was taken: not a git work tree." when any entry is a not-git skip, and the D-6 note.
  - No timestamps.
  - It is placed before the change section, so `checkpoint-lifecycle.test.ts:177` (`endsWith` the change) still holds.
- **One function (AC-109):**
  - orch:798 and :821 call `presentCheckpoint(1|2, …)`.
  - `presentCheckpoint` (orch:2157-2181) is the only caller of `presentationFor`, and it passes `snapshots` for CP3.
  - Presenting, `assertPendingUnchanged` (orch:2199) and I-7 (orch:2227) all use it.
  - `presentStory`, `presentBrief` and `presentChange` stay exported for unit tests, but no production file outside CPR references them (guard).
- **Pre-B-1 paused or approved runs (AC-110):**
  - `currentHash` (orch:2184-2191) returns the presentation.
  - On a mismatch where `unescapedSha256 === stored sha256`, the documents are unchanged and the presentation changed. The refusal is `ARTIFACT_CHANGED` for `--approve`, or `APPROVED_ARTIFACT_CHANGED` for I-7, with "… the presentation changed in this version: invisible or direction-control characters are now shown escaped under a warning banner, so the hash recorded before this version no longer matches. Close the run: `npm run factory -- --close <id> --cwd <cwd>`."
  - Any other mismatch keeps today's message.
  - No state field is added (I-14). Both checks are in the pre-flight, so `state.json` stays byte-identical.

### D-14 Suite time (AC-103, AC-104)

**Measurement (S-0, by the session, recorded in `docs/factory-runs/phase-b/B1_MEASUREMENTS.md`):**
1. `time npm test`, twice, from the repo root, on the base branch before step 1. Record `real`.
2. Write `<scratchpad>/fsync-noop.js` (outside the repo). It patches `require('fs').fsyncSync = () => {}`, counts calls, and prints the count to stderr on `process.on('exit')`.
3. `time NODE_OPTIONS="--require <scratchpad>/fsync-noop.js" npm test`, twice. Jest workers inherit `NODE_OPTIONS`. ts-jest emits `(0, fs_1.fsyncSync)(…)`, so the patch takes effect; the printed count proves it did.
4. Durable-write share = (mean(1) − mean(3)) / mean(1).

**Threshold:** adopt AC-104 if the share is **≥ 20 %** (I-20). Re-measure (1) after step 10 and again after step 11.

**Seam, only if adopted:**
- `OrchestrationOptions.stateWriter?: (cwd: string, state: FeatureState) => void`, documented "tests only; omitted = durable `saveState`".
- Every orchestrator save (orch:465, :473, :526) goes through `const save = options.stateWriter ?? saveState`.
- New fixture `factory/test/fixtures/state-writer.ts`: `nonDurableStateWriter`, which does `mkdirSync` + `writeFileSync(tmp)` + `renameSync`, with `serializeState`, and wraps any error in `StatePersistenceError`.
- `runToEnd` defaults to it. Direct `runFeatureFactory` callers (state-persistence, checkpoints, run-directory and feature-spec tests) stay durable.
- RH guard: no production `.ts` under `factory/` except the orchestrator declaration contains `stateWriter:`.
- If not adopted, the brief's record says "not adopted: <share>%".

### D-15 Builder tests and contracts (AC-90, AC-91)

- Contracts 04 (:64-70) and 05 (:68-74), "Before Declaring Done" item 3 becomes: "Tests: run only the tests related to the files you changed (for example `jest --findRelatedTests <files>` or `vitest related <files> --run`). All must pass. The full suite runs in Gate 2 after you finish."
- A new rule line in both: "Never commit, push or switch branches, and never write under `.git/` or `.factory/`. The harness snapshots your work itself."
- `builderPrompt` (agent-prompts.ts:327-347) adds, after the scope line:
  - "Run only the tests related to the files you changed; the harness runs the full suite in Gate 2."
  - "Never commit, push or switch branches, and never write under .git/ or .factory/."
- No test checks which tests a builder ran (AC-91).

### D-16 Docs (AC-111 to AC-115)

- **Moves (`git mv`, by the session before step 11; I-21):**
  - `factory/feature/docs/{README,ORCHESTRATOR,QUICK_START,STAGE_GUIDE,ARCHITECTURE}.md` → `docs/archive/feature-docs/`;
  - `factory/feature/reference/{STAGE_CONTRACTS,STATE_TRACKING,OUTPUT_SCHEMAS}.md` → `docs/archive/feature-reference/` (I-16).
- Each archived file gets a new first line: `historical — not maintained; see SKILL.md (factory/feature/SKILL.md)`.
- **A pointer is created at each original path**, for example `factory/feature/docs/QUICK_START.md`:
  ```
  # QUICK_START.md (moved)

  This document was out of date. It is archived, unmaintained, at [docs/archive/feature-docs/QUICK_START.md](../../../docs/archive/feature-docs/QUICK_START.md).

  How the Feature Factory behaves: [SKILL.md](../SKILL.md). How to run it: [README.md](../../../README.md).
  ```
  The reference pointers also name the TypeScript types:
  - STAGE_CONTRACTS → [stage-gates.ts](../../harness/stage-gates.ts);
  - STATE_TRACKING → [state-tracker.ts](../../harness/state-tracker.ts), [state-store.ts](../../harness/state-store.ts), [run-lifecycle.ts](../../harness/run-lifecycle.ts);
  - OUTPUT_SCHEMAS → [output-schemas.ts](../../runner/output-schemas.ts), [agent-output-schema.ts](../../harness/agent-output-schema.ts).
- **References to the 8 files that must change:**
  - `README.md:157-158` (layout lines `docs/` and `reference/`) → "docs/ pointers to archived docs" and "reference/ ERROR_CATEGORIES.md plus pointers".
  - `README.md:166` → add `docs/ROADMAP.md the plan of record (Phases A–E)`.
  - `docs/archive/README.md` → list the two new sub-folders and point at SKILL.md and ROADMAP.md.
  - Unchanged:
    - the links between the 8 files themselves (they are archived and not link-checked);
    - `docs/archive/FEATURE_FACTORY_*.md` and `docs/archive/IMPLEMENTATION_ROADMAP.md`, `DELIVERY_SUMMARY.md` (archived prose);
    - `docs/HARNESS_GAP_ANALYSIS.md:323` (prose naming OUTPUT_SCHEMAS.md; the pointer resolves);
    - `docs/factory-runs/**` (records).
  - None found in tests, agents, `skills/`, `scripts/`, SKILL.md or `factory/e2e/` (its own QUICK_START is unrelated).
- **`docs/ROADMAP.md` outline:**
  1. Plan of record (operator decisions 2026-10-05), superseding REFACTOR_PLAN's phase numbering. Order B → C → E.
  2. Phases:
     - A (run integrity and lifecycle: A-1, A-2; done);
     - B (B-1/B-2/B-3 with items B1–B5, A-1 MINOR-1/2/3, GAP-3, GAP-5, C5);
     - C (AC IDs across the chain, tests-first, mutation testing, risk tiers, C1, MINOR-4/5, A-2 test-style follow-ups);
     - D (operator to define; I-19);
     - E (distribution, README restructure, outside-user polish).
  3. Mapping table: REFACTOR_PLAN phase | its status there | where it lives now. Rows 0a, 0b, 0c, 1 (done before Phase A), 1.5, 2, 3. Row 3's "parallel features via git worktrees" is marked superseded by D-5 (never a worktree).
  4. Accepted risks: **MINOR-3 git filter drivers** run during `git diff`/`git add`. Revisit trigger: minimum supported git ≥ 2.42 (`--attr-source`).
- `docs/REFACTOR_PLAN.md` gains one line at the top: "Superseded as the plan of record by [ROADMAP.md](ROADMAP.md)."
- **README (AC-114):**
  - :5 → "runs a feature through four stages and three human checkpoints, with eight specialist agents";
  - :91-103 → "## The stages", whose diagram shows Stages 1–4, CP1–3, Gate 1.5/Gate 2, and "Stage 5 DELIVER 08-feature-consolidator: only via `--consolidate <id>` on a SUCCESS run";
  - the "(PR review: a human step outside the program)" line is deleted.
- **Drift test (DD):**
  - `KEPT_DOCS` = SKILL.md, README.md, the 8 pointers, `docs/ROADMAP.md` and `factory/feature/reference/ERROR_CATEGORIES.md` (I-17).
  - Every relative markdown link in them resolves (anchors stripped; http/mailto skipped).
  - The retired-claims list applies to every kept doc. For README, only the text before `## Skills`, because the skills catalogue legitimately says "Before opening a PR".
  - New retired claims:
    - `['the factory makes no commit (AC-45 revised: snapshots under refs/factory/<id>/)', /makes no[^.\n]{0,60}\bcommit/i]`;
    - `['git is only asked to read (B-1 writes snapshots)', /only ever asked to read/i]`;
    - `['PR review outside the program (CP3 is in it)', /PR review[^.\n]*outside the program/i]`;
    - README only: `/five stages/i`.
- **SKILL.md edits (AC-115; the :401 AC-60 line stays verbatim):**
  1. :3-6 version → "(Phase B, PR B-1)".
  2. :79-80 → `\xNN` for control characters, `\u{XXXX}` for the shared set (listed).
  3. :121-123 → "The factory never touches your branch, index or working tree, never pushes, and writes git objects only under `refs/factory/<id>/`." (verbatim), then what happens to an approved change.
  4. New "Snapshots after Stage 3" subsection after :170:
     - when, the ref name, the tree/root and parent rules;
     - plumbing with hooks off, no signing, harness identity, a temporary index;
     - not pushed by default; recorded before the next agent; idempotent on resume;
     - `HEAD_MOVED`, `SNAPSHOT_FAILED`; skipped outside git;
     - the pre-existing-changes note;
     - the AC-86 check is read-only (B-3 enforces).
  5. :169 → reads (`rev-parse`, `diff`, `ls-files`) and snapshot writes (`add`, `write-tree`, `commit-tree`, `update-ref`).
  6. Checkpoints → the banner, `\u{XXXX}` escaping, the hash over the escaped text, the CP3 change escaped and listed as "the change", and the pre-B-1 paused/approved refusal with `--close`.
  7. Artifacts (:466-476) → documents stored exactly as written, plus one IMPORTANT finding (document, line, code point), deduplicated.
  8. Starting a run (:180-188) → the `.Factory` refusal.
  9. Resuming (:239-243) → MINOR-8 inference; (:254-257) → the library makes every description refusal, after the run-state refusals.
  10. Gate 2 (:336-358):
      - per-stream parsing by runner marker, and the ambiguous block;
      - the 256 Ki head+tail bound with its marker;
      - the streaming scan;
      - dev exit 0 early = SKIPPED with a finding;
      - the group is always killed on settle, within 2 s of the shell's exit;
      - `setsid()` escapes the kill.
  11. Chain section → "Builders are told to run only the tests related to their change; that is an instruction, not enforced. Gate 2's full suite is the enforcement." and "Builders are told never to commit, push, switch branches or write under `.git/` or `.factory/`."

### D-17 Deferred

- "Test path" (AC-121) belongs to B-2.
- B-2 seams provided here:
  - `latestStage3Snapshot(state)`;
  - `factoryRef`;
  - the allow-list arrays (add an extraction array);
  - `documentFindings` (automatic for the new documents);
  - `presentationFor`'s parts list (B-2's two CP3 documents become two labelled parts).
- B-3 seams: snapshots are harness-side, so the sandbox's deny-write on `.git/` does not affect them; AC-86 stays as the second guard.

## 3. Exact type and interface changes

```ts
// change-diff.ts
export interface HeadState { commit?: string; branch?: string }
export type SnapshotResult =
  | { kind: 'written'; ref: string; commit: string; tree: string; reused: boolean }
  | { kind: 'head-moved'; recorded: HeadState; current: HeadState }
  | { kind: 'failed'; error: string };
export interface ChangeTracker {
  captureBase(cwd: string): Promise<ChangeBase>;                       // + branch, preExisting
  collect(cwd: string, base: ChangeBase, claimedFiles: string[]): Promise<ChangeSet>;
  snapshot(cwd: string, base: ChangeBase, runId: string, n: number): Promise<SnapshotResult>;  // never throws
}
export function factoryRef(runId: string, name: string): string;
export const GIT_READ_SUBCOMMANDS, GIT_SNAPSHOT_SUBCOMMANDS;
// state-tracker.ts
export type ChangeBase = { kind: 'git'; commit?: string; branch?: string; preExisting?: string[] } | { kind: 'none'; reason: string };
// EscalationRecord.reason: + 'HEAD_MOVED' | 'SNAPSHOT_FAILED'; context: + head?
// FeatureState: + stage3Snapshots?: Stage3Snapshot[]
export function recordStage3Snapshot, stage3SnapshotNumber, latestStage3Snapshot, recordImportantFindingsOnce;
// run-lifecycle.ts
// RunRefusalCode: + 'FACTORY_DIR_CASE_CONFLICT'
export function checkResumeDescription(state: FeatureState, supplied: string | undefined): string;
// exhaustedBuilder: infers the phase (D-10)
// run-directory.ts
export function assertNoFactoryCaseVariant(cwd: string): void;
// checkpoint-presentation.ts
// CheckpointPresentation: + unescapedSha256: string
// ChangePresentationInput: + snapshots?: { entries: readonly Stage3Snapshot[]; base?: ChangeBase }
export function presentChange(runDirAbs, findings, change, snapshots?): CheckpointPresentation;
// execution-gates.ts
export const OUTPUT_HEAD_CHARS = 65536, OUTPUT_TAIL_CHARS = 196608;
export function createBoundedOutput(): { push(chunk: string): void; text(): string; omitted(): number };
export function createLineScanner(): { push(chunk: string): void; end(): StreamScan };
export interface StreamScan { summaryLines: string[]; failedTestNames: string[]; devErrorLine?: string }
export function selectTestSummary(lines: { stdout: string[]; stderr: string[] }):
  { kind: 'stats'; stats: TestStats } | { kind: 'ambiguous'; detail: string } | { kind: 'none' };
// CommandOutcome: + scan: { stdout: StreamScan; stderr: StreamScan }
// ExecutionResult: + summaryProblem?: string; + failedTests?: string[]
// orchestrator
// OrchestrationOptions.featureDescription?: string; + stateWriter? (D-14, conditional)
```

## 4. Process flow after B-1 (`runFeatureFactory`)

1. **Pre-flight, outside the try, nothing written on a refusal:**
   - TypeError guard;
   - `assertNoFactoryCaseVariant`.
   - **Resume:**
     1. `checkResumeRequest`;
     2. `checkResumeDescription`;
     3. PAUSED + continue: return;
     4. `--approve`: hash check, including the pre-B-1 message;
     5. I-7, including the pre-B-1 message.
   - **Fresh:** description required.
   - Then `prepareNewRunDirectory`, `createFeatureState`, `captureBase` (commit, branch, preExisting), commit.
2. The A-2 flow is unchanged, except that **every passing Stage 3 gate** (Stage 3, each validator round, each CP3 rework) runs `takeSnapshot`, which records `written`/`skipped` and commits, or escalates `HEAD_MOVED`/`SNAPSHOT_FAILED`.
3. Every document write (`persist`, `writeDocument`, the pre-supplied acceptance) is followed by `checkDocuments` (dedup), with a commit when anything is new.
4. Checkpoints: `presentCheckpoint` → `presentationFor` (escaped text plus banner; CP3 adds the snapshot section when the run has snapshot records).
5. Idempotency: snapshots are keyed by phase; the ref is CAS-updated; document findings are deduplicated; no background jobs.

## 5. Traceability (AC → test file → title). Every title starts with its AC ID.

Test-file abbreviations, under `factory/test/`: SN = `harness/snapshot.test.ts` (new, real git); CDT = `harness/change-diff.test.ts`; EGT = `harness/execution-gates.test.ts`; RDT = `harness/run-directory.test.ts`; RST = `harness/resume.test.ts`; RLT = `harness/run-lifecycle.test.ts`; CLI = `runner/cli.test.ts`; DCT = `harness/direction-characters.test.ts` (new); DDOC = `harness/direction-documents.test.ts` (new); CPT = `harness/checkpoint-presentation.test.ts`; APT = `harness/agent-prompts.test.ts`; SPT = `harness/state-persistence.test.ts`; RH; DD.

| AC | Test → title |
|---|---|
| AC-45 | SN "AC-45 a run from start to an approved CHECKPOINT 3, with a validator round, leaves HEAD's branch and commit, .git/index, every file no agent wrote and every ref outside refs/factory/<id>/ byte-identical" (temp repo with a branch, a staged change, an unstaged change and an untracked file; real tracker; `.factory/` and claimed files excluded from the file comparison) |
| AC-80 | RH "AC-45 AC-80 git is spawned only by change-diff.ts with one spawnSync, the subcommands are exactly GIT_READ_SUBCOMMANDS and GIT_SNAPSHOT_SUBCOMMANDS, no forbidden subcommand appears in any literal, and the only refs/factory/ literal is in factoryRef" (replaces RH:298-335; keeps its PR/push checks); CDT "AC-80 factoryRef prefixes refs/factory/<id>/ and refuses an unsafe id or name"; CDT "AC-80 git() refuses add or write-tree without a temporary GIT_INDEX_FILE" |
| AC-81 | SN "AC-81 each passing Stage 3 gate (Stage 3, a validator round, a CHECKPOINT 3 rework) writes refs/factory/<id>/stage3-<n> from n=1, recorded with n, ref, commit, tree, phase and time before the next agent is invoked" |
| AC-82 | SN it.each "AC-82 the snapshot tree is the working tree as CHECKPOINT 3 sees it (%s)" (tracked changes, untracked, no ignored file, a tracked ignored file kept, no .factory/, parent = HEAD; an unborn branch: root commit; cwd a subdirectory: tree root is the project) |
| AC-83 | CDT "AC-83 a snapshot with every hook (reference-transaction included, and a repo core.hooksPath) writing a marker, commit.gpgSign on with a failing gpg.program, and no user identity succeeds without input, runs no hook, and is unsigned with the harness identity" (`GIT_CONFIG_GLOBAL` → empty temp file, `GIT_CONFIG_NOSYSTEM=1`, restored after) |
| AC-84 | SN it.each "AC-84 CHECKPOINT 3 notes the pre-existing changes (%s)" (listed; none → no note; base recorded before B-1 → unknown) |
| AC-85 | SN "AC-85 killed after the ref write and before the state save, a resume re-evaluates the gate, keeps one entry for n pointing at the ref, reuses the commit for an unchanged tree and writes no stage3-<n+1>"; SN "AC-85 the same kill with a changed tree replaces stage3-<n>" (tracker wrapper: real snapshot, then `SimulatedKill`; `restoreSnapshot`) |
| AC-86 | SN it.each "AC-86 a HEAD move escalates HEAD_MOVED naming the recorded and current HEAD and writes no snapshot (%s)" (builder commits during Stage 3; branch switch; operator commit between a CP1 pause and the resume) |
| AC-87 | SN "AC-87 outside a git work tree no snapshot is attempted, state records skipped: not a git work tree, the run continues and CHECKPOINT 3 says no snapshot was taken" |
| AC-88 | SN "AC-88 a failed snapshot write escalates SNAPSHOT_FAILED with git's error text, records no entry, and the run resumes" (fake `snapshot` returning `failed`) |
| AC-89 | SN "AC-89 the diff and untracked-file part of CHECKPOINT 3 is byte-identical with and without snapshots" (twin repos, fixed `GIT_*_DATE`, one with a no-op snapshot); SN "AC-89 --approve 3 of a run paused at CHECKPOINT 3 is not refused because of a snapshot" |
| AC-90 | RH "AC-90 contracts 04 and 05 say never commit, push or switch branches, and never write under .git/ or .factory/"; APT "AC-90 AC-91 the builder prompt says run only related tests, Gate 2 runs the full suite, and never commit, push, switch branches or write under .git/ or .factory/" |
| AC-91 | RH "AC-91 contracts 04 and 05 tell the builder to run only the tests related to its changes and say the full suite runs in Gate 2"; DD "AC-91 SKILL.md says related-only tests are instructed, not enforced, and Gate 2's full suite is the enforcement" |
| AC-92 | EGT "AC-92 a dev script that exits 0 before the dev window ends is SKIPPED with a warning (an IMPORTANT finding) and neither passes nor blocks" |
| AC-93 | EGT it.each "AC-93 a %s command that exits normally leaves no grandchild of its process group running once it settles" (test, grandchild with stdio ignored; dev, grandchild holding the pipes); DD "AC-93 SKILL.md says a process that calls setsid() escapes the process-group kill" |
| AC-94 | EGT "AC-94 createBoundedOutput keeps at most OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS per stream with a visible truncation marker" |
| AC-95 | EGT it.each "AC-95 with output larger than the bound, %s" (Mocha counts before more failure detail than the bound are parsed; a failing test name printed anywhere is in failedTests; a dev error line split across two chunks fails the dev check) |
| AC-96 | EGT it.each "AC-96 counts are parsed per stream and chosen by runner marker: %s" (Vitest plus a stray unmarked Jest line → Vitest; a complete Jest summary on stderr → Jest; two marked families with different counts → ambiguous, validateExecutionGate blocks "ambiguous test summary"; equal counts → used); EGT "AC-96 AC-8 AC-9 the A-1 Jest, Vitest and Mocha summaries still parse" |
| AC-97 | RDT it.each "AC-97 a %s next to a .Factory entry is refused FACTORY_DIR_CASE_CONFLICT before any write, naming the entry" (fresh run; resume) (case-insensitive FS: rename `.factory`→`.Factory`; case-sensitive: add a `.Factory` file); CLI "AC-97 --feature and --resume next to a .Factory entry exit 1, name it, and create nothing" |
| AC-98 | [L] `B1_MEASUREMENTS.md` |
| AC-99 | RST it.each "AC-99 the library refuses %s after checkResumeRequest and writes nothing" (finished + different description → RUN_FINISHED; exhausted builder + different → NEEDS_GRANT; resumable + different, runFeatureFactory called directly → DESCRIPTION_MISMATCH; none recorded + none given → DESCRIPTION_REQUIRED); CLI "AC-99 each description refusal exits 1 with state.json unchanged" |
| AC-100 | RH "AC-100 cli.ts makes no description comparison and no DESCRIPTION_* decision, and reads the description only for its banner" |
| AC-101 | RLT "AC-101 a MAX_LOOPS record without builderPhase infers Stage 3 from escalation stage 3, validator round validatorRoundsCompleted from stage 4, and nothing when the round is unknown" (pre-approved change at RLT:191-196); RST "AC-101 a plain resume of a pre-A-2 MAX_LOOPS record is refused NEEDS_GRANT with state.json byte-identical, and --grant-attempts n gives exactly n attempts in the inferred phase"; CLI "AC-101 the CLI names --grant-attempts and exits 1" |
| AC-102 | CLI "SEC AC-102 printableForTerminal escapes C0 and C1 controls as \xNN and every shared-set character as \u{XXXX}, keeping newlines and tabs" (pre-approved extension of CLI:371-379); CLI "AC-102 printableForTerminal leaves already-escaped text and a literal backslash unchanged" |
| AC-103 | [M] `B1_MEASUREMENTS.md` |
| AC-104 | SPT "AC-104 a test can inject a non-durable state writer through OrchestrationOptions and the default stays durable"; RH "AC-104 no production call site passes stateWriter" (both only if adopted) |
| AC-105 | DCT "AC-105 the shared set is exactly U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069 and U+FEFF"; RH "AC-105 printableForTerminal, the document check and checkpoint presentation import the one set, and no other copy exists" |
| AC-106 | DCT it.each "AC-106 boundary %s is flagged" (U+061C, U+200B, U+200F, U+2028, U+202E, U+2066, U+2069, U+FEFF); DCT it.each "AC-106 neighbour %s is not flagged" (U+061B, U+061D, U+200A, U+2010, U+2027, U+202F, U+2065, U+206A, U+FEFE, U+FF00); DCT "AC-106 ordinary non-ASCII text (é, U+0627) is not flagged" |
| AC-107 | DDOC it.each "AC-107 %s containing U+202E is stored byte-identical and adds exactly one IMPORTANT finding naming the document, line and code point" (all 11 documents: 7 agent documents including the 08 pair via consolidateRun, plus 4 harness-rendered); DDOC "AC-107 a clean document adds no finding"; DDOC "AC-107 a resume that re-renders identical content adds no duplicate finding"; RH "AC-107 every harness write path for agent and harness-rendered documents goes through the document check" |
| AC-108 | CPT "AC-108 a presentation with a set character starts with one banner entry per occurrence, shows each as \u{XXXX}, and its sha256 is over the escaped text"; CPT "AC-108 replacing a real character with its literal escape, or the reverse, changes the text and the hash"; CPT "AC-108 the CHECKPOINT 3 change section is escaped and its occurrences are listed as the change"; DDOC it.each "AC-108 CHECKPOINT %i presents a document with U+202E escaped under the warning banner" |
| AC-109 | DDOC "AC-109 --approve of a paused checkpoint whose unchanged documents contain U+202E is not refused, and the I-7 re-check passes"; CLI "AC-109 --resume --approve exits as the run continues"; RH "AC-109 presentationFor is the only checkpoint presentation the orchestrator uses, for presenting, --approve and the I-7 re-check" |
| AC-110 | DDOC it.each "AC-110 a run paused before B-1 %s" (no set character: hash unchanged, --approve works; with one: refused ARTIFACT_CHANGED naming the version change and --close, state.json byte-identical; approved CP1 re-checked on resume: refused APPROVED_ARTIFACT_CHANGED, same message); CLI "AC-110 the refusal exits 1" |
| AC-111 | DD "AC-111 docs/ROADMAP.md holds Phases A–E, a row for every REFACTOR_PLAN phase (0a, 0b, 0c, 1, 1.5, 2, 3), and MINOR-3 as an accepted risk with the git ≥ 2.42 --attr-source trigger" |
| AC-112 | DD it.each "AC-112 %s is archived with the historical header and a pointer to SKILL.md (and the types) stays at its path" |
| AC-113 | DD "AC-113 every relative link in a kept doc resolves"; DD "AC-60 AC-113 no kept doc makes a retired claim, including the old 'makes no … commit' sentence" (replaces DD:164-197's single-doc test; same list plus additions) |
| AC-114 | DD "AC-114 README says Stages 1–4 with three checkpoints, Stage 5 only via --consolidate, never 'five stages', and does not put PR review outside the program" |
| AC-115 | DD "AC-115 SKILL.md documents PR B-1: version line, snapshots, the AC-45 sentence, instructed-not-enforced tests, Gate 2 fixes, .Factory, description refusals, MINOR-8, and the invisible-character rules" (required phrases: `Phase B, PR B-1`, `refs/factory/<id>/stage3-<n>`, `HEAD_MOVED`, `SNAPSHOT_FAILED`, the AC-45 sentence verbatim, `not enforced`, `ambiguous test summary`, `SKIPPED`, `setsid()`, `.Factory`, `DESCRIPTION_MISMATCH`, `\u{XXXX}`, `stored exactly as written`, `escaped`, `--close`); DD AC-60 (:206-216) unchanged |

## 6. Test plan

**Fixtures (setup-only):**
- `fixtures/changes.ts`:
  - `FAKE_BASE` gains `branch: 'refs/heads/main', preExisting: []`.
  - `FakeChangeTracker` gains `snapshot` (default `written`: ref via `factoryRef`, fixed fake commit and tree ids, `reused:false`) and a **separate** `snapshotCalls` log (I-1).
  - Options: `snapshot?` override.
- `fixtures/harness-run.ts`: `runToEnd` defaults `stateWriter: nonDurableStateWriter` (only if AC-104 is adopted).
- `fixtures/state-writer.ts` (conditional).
- Tests that drive the harness must still use `fixtures/agent-outputs.ts` builders (RH AC-2). To plant U+202E, mutate `story().details.artifacts[0].content` as CK:897 does; never write an `agent: '0N-'` literal.
- Real-git tests (SN, CDT) set their own commit identity with `-c user.name=… -c user.email=…` for setup commits and fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` where byte comparison needs them.

**Existing tests that call a changed entry point (P-20), classified:**

| Entry point | Callers | Class |
|---|---|---|
| RH:298-335 AC-45 guard | RH | **(a) pre-approved**: rewritten to AC-80 |
| `exhaustedBuilder` pre-A-2 row | RLT:191-196 | **(a) pre-approved**: moves to the AC-101 expectation |
| `printableForTerminal` | CLI:371-379 | **(a) pre-approved**: extended with AC-102 assertions (no current assertion breaks) |
| `ChangeTracker` / `FakeChangeTracker` | fixtures/changes.ts | (b) setup: `snapshot`, `snapshotCalls`, `FAKE_BASE` |
| `captureBase` output | CDT:66 `toEqual({kind:'git', commit: head})`, CDT:72 `toEqual({kind:'git'})` | **(c) needs operator approval** (I-2): expected objects gain `branch` / `preExisting` |
| tracker call log | CK:539-542, RST:280 | unchanged if I-1 is accepted (snapshot calls in a separate log); **(c)** if rejected |
| `runFeatureFactory` / `runToEnd` (snapshot after Stage 3; CP3 snapshot section; optional description; document check) | checkpoint-lifecycle (34 calls), resume (44), orchestrator-gates (35), validator-loop-back (16), a2-acceptance-gaps (9), checkpoints (8), state-persistence (7), upstream-artifacts (7), feature-spec (4), run-directory (3), retry-briefing (2), cli (56 incl. `runCli`/`cli(at(…))`) | expected unchanged. CK:177 `endsWith` change ✓ (section placed before it); CK:181 six request keys ✓; CK:164/170 exact CP1/CP2 text ✓ (no set characters); pinned and pre-A-2 states carry no description, so there is no mismatch. A builder that sees any of these fail STOPS. |
| `presentationFor` / `presentChange` | CPT:136-137, :175-209 | expected unchanged (no set characters; `presentChange` without `snapshots`) |
| execution-gates runners/parsers | EGT (all), RH:185-207 | expected unchanged (AC-9 inputs are single-family; no existing dev script exits 0 early; the IMPORTANT-3 transpile test needs EG to stay built-ins-only) |
| `checkResumeRequest` / `resumeDescription` | RLT (rest), RLT:445-470 | unchanged: `resumeDescription` keeps its semantics; `checkResumeDescription` is new |
| CLI main | CLI:594-654 (AC-37, IMPORTANT-1) | expected unchanged: same messages, now thrown by the library |
| `builderPrompt` | APT:53-275 (`toContain`), retry-briefing | unchanged (new lines are additive; none says "attempt N of 3") |
| `consolidateRun` | consolidate.test.ts | unchanged (clean documents add no finding) |
| `persistArtifacts` / `writeHarnessDocument` | stage-context.test:727-885, harness-documents.test:74-166 | unchanged (signatures kept, I-12) |
| doc-drift | DD all | updated in step 11 together with SKILL.md/README (new tests; DD:164-197 generalised; :206-216 kept) |

**Existing-test policy for builders (A-2 P-13):**
- A builder that breaks an existing test not listed above as (a) or (b) STOPS and reports.
- Setup-only fixes are approved by the session and reported in the build notes.
- Any assertion change goes to the operator: only the (a) rows are pre-approved, and the (c) rows wait for CHECKPOINT 2.

**CI rule:** `npm test` stays offline. Real `git` runs only in CDT and SN, in temp repos; real child processes run only in EGT.

## 7. Build order (one fresh Backend Builder per step; the session re-runs `npm test` and `npm run typecheck` after each, records wall-clock time, and keeps P-12 build notes)

| Step | Owner | Content | Files | ACs | Done-check | Est. |
|---|---|---|---|---|---|---|
| S-0 | **session**, operator-approved | AC-98 probe (§9); AC-103 baseline (D-14) | `docs/factory-runs/phase-b/B1_MEASUREMENTS.md` | AC-98, AC-103 | figures recorded | 10 min |
| 1 | builder | AC-97: `assertNoFactoryCaseVariant`, the refusal code, the pre-flight call | RD, RL, orch, RDT, CLI | AC-97 | AC-97 tests green; all else unchanged | 15 |
| 2 | builder | Git plumbing: allow-list arrays, `SAFE_GIT_CONFIG`, `git(env)` with the index guard, `factoryRef`, `captureBase` branch/preExisting, `snapshot()`; ST `ChangeBase`; fake tracker; RH AC-80 rewrite | CD, ST, fixtures/changes.ts, CDT, RH | AC-80, AC-83 | CDT incl. AC-83 green; RH AC-80 green; CDT:66/:72 per I-2 | 30 |
| 3 | builder | Orchestrator snapshots: `stage3Gate(at)`, `takeSnapshot`, ST snapshot records and reasons, `HEAD_MOVED`/`SNAPSHOT_FAILED`, the CP3 snapshot section | orch, ST, CPR, SN, CPT | AC-45, AC-81, AC-82, AC-84 to AC-89 | SN green; every runToEnd test unchanged | 40 |
| 4 | builder | B2 contracts and prompt | 04/05 contracts, agent-prompts.ts, APT, RH | AC-90, AC-91 [S] parts | green | 15 |
| 5 | builder | Gate 2: bounded output, line scanner, `selectTestSummary`, `summaryProblem`, dev SKIPPED, the group kill and exit grace (EG only) | EG, EGT | AC-92 to AC-96 | EGT green incl. the IMPORTANT-3 transpile test; RH AC-13/AC-15 green | 30 |
| 6 | builder | Lifecycle: `checkResumeDescription`, optional `featureDescription`, CLI thinning; MINOR-8 inference | RL, orch, cli, RLT, RST, CLI, RH | AC-99, AC-100, AC-101 | green; RLT:191-196 changed as pre-approved | 20 |
| 7 | builder | The shared set and the terminal: `direction-characters.ts`, `printableForTerminal` | new module, cli, DCT, CLI, RH | AC-102, AC-105, AC-106 | green | 15 |
| 8 | builder | Document check: `document-check.ts`, `recordImportantFindingsOnce`, orch `checkDocuments` hooks (D-12 table), consolidate-run | new module, ST, orch, consolidate-run, DDOC, RH | AC-107 | green | 20 |
| 9 | builder | Presentation: parts, banner, escaping, `unescapedSha256`; the orchestrator uses `presentCheckpoint` only; the pre-B-1 messages | CPR, orch, CPT, DDOC, CLI, RH | AC-108, AC-109, AC-110 | green | 30 |
| 10 | builder, **conditional** on S-0 ≥ 20 % | `stateWriter` seam, fixture, guard | orch, fixtures/state-writer.ts, harness-run.ts, SPT, RH | AC-104 | green; the session re-measures AC-103 | 15 |
| S-1 | **session**, operator-approved | Eight `git mv` commands (D-16) | the 8 docs | AC-112 | moved, nothing else staged | 5 |
| 11 | builder | Docs: archive headers, 8 pointers, ROADMAP, REFACTOR_PLAN line, archive README, README, SKILL.md, DD | docs/*, README, SKILL.md, DD | AC-91 [S] (SKILL part), AC-93 [S], AC-111 to AC-115 | DD and RH green; typecheck green | 30 |
| S-2 | **session** | AC-103 re-measure; final `npm test` + `npm run typecheck` | B1_MEASUREMENTS.md | AC-103 | recorded | 10 |

**Builder time ≈ 260 min (11 steps) + session ≈ 35 min + ~10 % waiting → plan about 5 h.** Steps 3, 5 and 9 are orchestrator-core or EG-core.

**Builder rules:**
- Work only in this repo on `feat/phase-b1-commit`. No commit or push.
- `~/.claude/**` and `docs/factory-runs/**` are read-only.
- No string literal may contain `git <forbidden subcommand>` (§0.5).
- No new dependency (all node built-ins).

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A slip in `add`/`write-tree` writes the user's `.git/index` | Runtime guard in `git()` (D-2), CDT test, and the AC-45 byte check on `.git/index` |
| Hooks or gpg run, or a hang | `core.hooksPath=/dev/null` plus `--no-gpg-sign` plus `commit.gpgSign=false`, stdin ignored; AC-83 proves it, including a repo `core.hooksPath` |
| Secrets in non-ignored untracked files (e.g. `.env` not in `.gitignore`) go into git objects | The same files CP3 already shows; refs/factory are local and not pushed by default (a `push --mirror` would push them); SKILL.md says so (security surface: secrets PRESENT) |
| `add -A` is slow on a huge non-ignored tree (an unignored `node_modules`) | Same exposure as CP3's `ls-files`; noted in SKILL.md |
| Sparse checkout: excluded files are absent from the snapshot | Documented limitation (I-3) |
| Filter drivers run in `add` as in `diff` | MINOR-3 accepted risk, recorded in ROADMAP |
| Killing a reused pgid after the group has emptied | The kill comes immediately on settle (microseconds); the same exposure as today's timeout kill |
| Orphan output written after the shell exits is lost (2 s grace) | Documented (I-8); summaries are printed before runners exit |
| An unmarked multi-family disagreement now blocks | Fail closed (I-9); A-1 inputs unchanged |
| A banner with thousands of occurrences | Accepted: binding the hash needs one entry per occurrence; the finding message is capped (I-13) |
| A pre-B-1 run with set characters cannot be approved | By design (AC-110); the message names `--close` |
| CLI banner prints before a library refusal | Cosmetic; messages unchanged |
| Real-git tests are slow | Only CDT and SN; counted in AC-103's re-measure |

## 9. Live and measurement items

**AC-98 probe (S-0; run by the session, operator-approved, in a scratch dir, never the repo):**
```
SCRATCH=$(mktemp -d /private/tmp/ff-icase-XXXX) && cd "$SCRATCH"
git --version; sw_vers -productVersion; diskutil info / | grep -i 'personality'
git init -q && git config --get core.ignorecase
mkdir .Factory && echo x > .Factory/state.json && echo y > a.txt
git ls-files --others --exclude-standard -- . ':(exclude).factory'
git -c core.ignorecase=true  ls-files --others --exclude-standard -- . ':(exclude).factory'
git -c core.ignorecase=false ls-files --others --exclude-standard -- . ':(exclude).factory'
GIT_INDEX_FILE="$SCRATCH.idx" git add -A -- . ':(exclude).factory' && GIT_INDEX_FILE="$SCRATCH.idx" git ls-files --cached
```
Record whether `.Factory/state.json` is listed in each case. AC-97 applies whatever the result. Then `rm -rf "$SCRATCH" "$SCRATCH.idx"`.

**AC-103:** see D-14. Before step 1 (S-0), after step 10 if it runs, and at S-2.

## 10. Data model, API, frontend

- **Data model:**
  - `state.json` gains the optional `changeBase.branch`, `changeBase.preExisting`, `stage3Snapshots`, escalation reasons `HEAD_MOVED`/`SNAPSHOT_FAILED` and `context.head`.
  - Git gains objects plus refs `refs/factory/<id>/stage3-<n>`.
  - No migrations: old state files load. A pre-B-1 run gets snapshots from its next Stage 3 gate pass, n=1.
- **API:** no HTTP. TypeScript surface in §3. The CLI flags are unchanged; the CLI thins (AC-100).
- **Frontend:** none. The Frontend Builder is not needed.

## 11. Security surface

| Surface | Declaration | Why |
|---|---|---|
| auth | **ABSENT** | Local CLI and library; no auth boundary, roles or sessions |
| userInput | **PRESENT** | CLI args, agent documents (direction characters), file paths from git, test and dev output (bounded, scanned), run ids in refs (validated by `factoryRef`) |
| secrets | **PRESENT** | Snapshots copy every non-ignored project file, possibly a stray `.env`, into local git objects under a private ref. No credential is read or used; the harness identity is not a secret |
| sqlDatabase | **ABSENT** | No database; JSON and Markdown files plus git |
| htmlRendering | **ABSENT** | Terminal text and Markdown never rendered in a browser; terminal and bidi injection is handled under userInput |

```json
{ "securitySurface": { "auth": "ABSENT", "userInput": "PRESENT", "secrets": "PRESENT", "sqlDatabase": "ABSENT", "htmlRendering": "ABSENT",
  "notes": "Local CLI/library. userInput = CLI args, agent documents (bidi), git paths, runner output, run ids in ref names. secrets = snapshots store non-ignored project files (maybe a stray .env) as local git objects under refs/factory/<id>/; nothing pushed." } }
```

## 12. Issues for the operator (CHECKPOINT 2)

- **I-1 Snapshot calls in the fake tracker go to a separate `snapshotCalls` log.** Then CK:539-542 and RST:280 stay unchanged. Alternative: one log, which makes those two pinned assertions (c) changes. **Recommend the separate log.**
- **I-2 CDT:66 and :72 assertion change.** `captureBase` now also returns `branch` and `preExisting`. **Recommend approving:** the expected objects gain those fields.
- **I-3 The snapshot's "tracked" set is the user's index (not HEAD).** Tracked-ignored files are kept by a read-only `ls-files -i` plus `add -f`. The tree root is the project directory when cwd is a subdirectory. Sparse-checkout-excluded files are absent. **Confirm.**
- **I-4 "Same gate pass" = same phase key** (Stage 3 / validator round r / rework r). A re-evaluated pass reuses n, and only a different phase gets n+1. **Confirm.**
- **I-5 The CP3 snapshot section (and so the AC-84 note) appears only when the run has a B-1 snapshot record.** A pre-B-1 run that reaches CP3 without a new Stage 3 pass shows no note. This keeps AC-110's unchanged-hash case. **Confirm.**
- **I-6 On an unborn branch the branch name is not recorded** (`rev-parse` cannot read it). A branch switch on an unborn repo goes undetected; a commit is detected. **Accept.**
- **I-7 Gate 2 bound: 64 Ki head + 192 Ki tail characters per stream.** **Confirm.**
- **I-8 Gate 2 settles at most 2 s after the shell exits**, killing the group, even if a grandchild holds the pipes. Orphan output after that is lost. **Recommend IN** (AC-92 needs it for a self-backgrounding dev script).
- **I-9 Unmarked runner families that disagree also block "ambiguous"** (beyond AC-96's marked case). **Recommend IN (fail closed).**
- **I-10 Descriptions:** a blank `featureDescription` counts as not supplied. A fresh run without one is refused `DESCRIPTION_REQUIRED` by the library. **Confirm.**
- **I-11 MINOR-8 at stage 4 with `validatorRoundsCompleted` < 1 infers nothing** (old behaviour). **Confirm.**
- **I-12 The document check reads back the written files in the orchestrator and consolidate-run**; the writers' signatures are unchanged, and `smoke-researcher.ts` is excluded. **Confirm.**
- **I-13 The finding message lists at most 20 occurrences plus a count; the banner lists every occurrence.** **Confirm.**
- **I-14 AC-110 detection uses `unescapedSha256`**, with no new state field. **Confirm.**
- **I-15 The AC-97 check applies to a fresh run and a resume only**, not `--close`/`--consolidate`. **Recommend as-is** (the AC's scope).
- **I-16 Archive layout `docs/archive/feature-docs/` and `docs/archive/feature-reference/`.** A flat move collides with the existing `docs/archive/README.md`. **Confirm.**
- **I-17 `factory/feature/reference/ERROR_CATEGORIES.md` is kept but not named in AC-113.** **Recommend adding it (and `docs/ROADMAP.md`) to the drift scope.** `REFACTOR_PLAN.md` and `HARNESS_GAP_ANALYSIS.md` get only the "superseded" line, not drift checks.
- **I-18 README edits beyond the stages section:** :5 (the "five stages" phrase), :157-158 and :166 (docs layout plus ROADMAP). **Confirm these minimal factual edits.**
- **I-19 Phase D is not defined anywhere in the repo or the decisions.** ROADMAP needs it. **Proposal:** "Phase D: Tier 1 and cross-run memory (REFACTOR_PLAN Phases 2 and 3, without worktree parallelism), unscheduled; order B → C → E stands." Also confirm row 1.5 ("prove stages 2–5 live": partly done by A-2's S-1/S-2). **Operator to decide.**
- **I-20 AC-104 adoption threshold: a durable-write share ≥ 20 % of `npm test` wall clock.** **Confirm.**
- **I-21 The 8 `git mv` commands are run by the session (S-1, operator-approved), not a builder**, so builders never run git. **Confirm.**
- **I-22 `HEAD_MOVED` and `SNAPSHOT_FAILED` are CRITICAL.** **Confirm.**
- **I-23 Snapshot identity `Feature Factory <feature-factory@localhost.invalid>`**, message `Feature Factory snapshot <id> stage3-<n>`. **Confirm.**
- **I-24 Security surface: secrets is declared PRESENT** (snapshots may store a stray non-ignored `.env`). **Confirm the declaration and the SKILL.md wording.**

─────────────────────────────────────────────────────────────────
⏸  CHECKPOINT 2 — BRIEF REVIEW
Read the technical brief above carefully.
This is the last chance to catch wrong assumptions before files are changed.
Reply "approved" when ready to continue to the builders.
─────────────────────────────────────────────────────────────────

Status: **PASS**. No blocker. I-19 (Phase D) and I-2 (one assertion change) need operator answers before steps 11 and 2 respectively.

