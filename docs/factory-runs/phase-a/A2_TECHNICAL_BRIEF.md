# A2_TECHNICAL_BRIEF.md: Phase A, PR A-2 "Run lifecycle"

> Feature Factory run, by-hand mode. Agent 03 (Spec Writer), read-only. 2026-10-04.
>
> **Scope:**
> - Group R: AC-34..42, AC-71..73.
> - Group K: AC-43..57, AC-74..78.
> - AC-61, AC-65 (the writing side) and AC-79.
> - The A-2 carry-overs from A1_VALIDATION_REPORT.
> - Triage of MINOR-1..11 and NEW-MINOR-1..3.
> - The I-13 live smoke step.
> - Per-agent timing.
>
> **Out of scope:**
> - Phase B, C and E items.
> - The README diagram.
> - Any change to `--yes` behaviour.
> - GAP-3 (cost/budget caps) and GAP-5 (builder sandboxing).
> - Simultaneous run starts.
> - A leftover-files briefing when resuming in Stage 3.

## 0. Prior specification patterns (from A-1 and the code)

**Patterns to follow:**
- **Inject side effects; keep decisions real** (A1_PATTERNS C-1). `invoke`, `gates` and `runCli(argv, deps)` already work this way. A-2 adds one more seam of the same shape, `changes` (the git diff for CP3), so tests stay offline.
- **Pure transitions in `state-tracker.ts`, the write in `state-store.ts`, and the decision of when to commit in the orchestrator** (state-tracker.ts:9-11, state-store.ts:15-17). Every new state field gets a pure recorder.
- **Helpers return the finished `FeatureState` when the run must stop, and `undefined` to continue** (orch:413-416, `materializationGate` / `stage3Gate`). The new checkpoint and stage functions use the same contract.
- **Every exit goes through `finish()`** (orch:280-295). PAUSE is the one deliberate exception: AC-49 requires `finish()` not to be called. A paused run is committed, not finished.
- **Fail closed when an input is missing** (C-2). This applies to every new criterion, every presentation (a missing artifact means no checkpoint), the baseline writer, the approver's return value and the run-id check.
- **AC → test title traceability** (P-4), **one fresh builder per step** (P-6) and **source-scan guards** (C-10).

**Anti-patterns to avoid:**
- Fabricated evidence: `knowledgeStored: true` at orch:1251. Deleted (AC-48).
- A helper that deletes or writes wherever it is pointed: `clearStaleArtifacts` deletes `_archive/` (stage-context.ts:203-206). Replaced.
- Prose that no code backs: the CLI prints "Resume with" unconditionally at cli.ts:218. Replaced by state-derived hints.

**Problems the code shows that A-2 must design around:**
1. **Resume is a no-op today.** `state = resumeFromState || create…` (orch:231) and `outputs = {}` (orch:245) mean every resume starts again at Stage 1. `isResumable` (state-tracker.ts:531-533) is false for every finished run, ESCALATED included.
2. **Step timings are meaningless.** `recordAgentStep` stamps `startedAt` and `completedAt` with the same `now` (state-tracker.ts:243-250). `metrics.timePerStage` is never filled. This is why A-1 had no time profile.
3. **Builder attempts are counted in state but never read.** The loop runs `attempt = 1..3` from memory (orch:443).
4. **An approval is not committed before the next agent runs** (orch:405, AC-38).
5. **CP1 is shown only the agent's `details.summary`** (orch:886), not the artifact.
6. **CP1 is asked before the Stage 2 gate** (orch:886 runs before orch:925).
7. **The pre-supplied path skips CP1 and CP2** (orch:759-787).
8. **`parseArgs` accepts any `--flag` and ignores stray tokens** (cli.ts:110-126). AC-79's "accepted by the parser" means nothing until unknown flags are rejected.

**Recommended approach:** turn the linear orchestrator into stage functions inside the same closure. Each one skips a unit only when state records it as done. Rebuild `outputs` from `stageHistory`. Put every decision in new pure harness modules (`run-lifecycle.ts`, `run-progress.ts`), and keep filesystem lifecycle in `run-directory.ts`. The CLI only parses, wires and prints.

## 1. Overview

This repo is a TypeScript library plus a CLI. There is no HTTP API, no database and no UI. In this brief:
- "Data model" means `FeatureState` / `state.json` plus the `.factory/` layout.
- "API" means the exported TypeScript surface and the CLI flags.

**Builder ownership:** the **Backend Builder (04)** implements everything. The **Frontend Builder (05) is not needed**: no file in FILE_LIST matches `isFrontendPath` (frontend-files.ts), and there is no UI.

What A-2 makes true:
1. **SUCCESS = Stage 4 gate passed + CHECKPOINT 3 approved.** The Consolidator moves behind `--consolidate <id>`.
2. **A checkpoint can APPROVE, REJECT or PAUSE.**
   - An approval is bound to the SHA-256 of the exact text presented, and that text is the full artifact.
   - A pause is resumable with `--approve` or `--reject --notes`.
   - A rejection is resumable, and the producing agent re-runs with the notes.
3. **`--resume` really resumes.** Completed agents and approved checkpoints are skipped. Attempts come from state. ESCALATED runs reopen. Gates are always re-evaluated.
4. **Run directories have a lifecycle.**
   - Finished runs are archived to `.factory/_archive/<id>/` and never deleted.
   - One unfinished run blocks new runs.
   - `--close` finishes a run as MANUAL_STOP.
5. **`.factory/baseline.json` is written at SUCCESS**, completing AC-65.
6. **SKILL.md documents all of it**, and the drift test checks the CLI flags against the parser.

## 2. Design decisions

### D-1 Run classification and resumability (pure; `harness/run-lifecycle.ts`)

```ts
export type RunClass = 'ACTIVE' | 'PAUSED' | 'ESCALATED' | 'SUCCESS' | 'MANUAL_STOP';
export function classifyRun(state: FeatureState): RunClass;
```

Classification rules:
- `status === 'PAUSED'` → PAUSED.
- `completionStatus` SUCCESS, MANUAL_STOP or ESCALATED → that value.
- Otherwise (IN_PROGRESS, BLOCKED, or ESCALATED without `completedAt`) → ACTIVE.

`isResumable` (state-tracker.ts:531) becomes `classifyRun ∈ {ACTIVE, PAUSED, ESCALATED}`. "Finished" means SUCCESS or MANUAL_STOP only (OQ-2).

### D-2 Resume semantics (AC-34..39, 71, 72; `harness/run-progress.ts` + orchestrator)

**Rebuilding outputs.** `rebuildOutputs(state): StageOutputs` walks `stageHistory` in order and keeps every step with `status === 'PASS'`, `output` set and `invalidated` unset.
- Steps are keyed by `output.agent`, not `step.agent`. This lets the pre-supplied path's `tier-1` steps restore the story and spec.
- Builders are folded with `mergeBuilderOutput` in order: the Stage 3 PASS, then each validator-round and rework PASS. This reproduces the runtime merge at orch:1176 and orch:1184.
- Persisted artifact paths are already rewritten into the run dir before `recordAgentStep` (orch:826-827), so artifact paths survive the rebuild unchanged.
- After the rebuild, the harness re-renders BACKEND_SUMMARY, API_CONTRACT, FRONTEND_SUMMARY and TEST_REPORT from the rebuilt outputs. This is deterministic and makes AC-34's prompt paths exist even if a document was removed.

**The skip rule (one rule everywhere).**
- A unit is skipped only when its completion is recorded in state:
  - an agent unit: a non-invalidated PASS step for that agent;
  - a checkpoint unit: an approval for that checkpoint id.
- Gate-only units (Gate 1, the Stage 3 gate, Gate 1.5, the Stage 4 gate) have no completion record. Whenever the flow reaches one, it is evaluated again (AC-39, OQ-6).
- Exception: stages the run has already advanced past (`stage < state.currentStage`) are skipped whole, agents and gates alike. They finished and were committed by `advanceToStage`.
- Gate 2 belongs to its Validator unit. A round whose Validator step is PASS is skipped with its Gate 2. An unfinished round always re-runs Gate 2.

**Units, in order:**

| # | Unit | Done when |
|---|---|---|
| U1 | 01 Researcher + Stage 1 gate | 01 PASS |
| U2 | 02 Story Writer + story gate (D-6) | 02 PASS |
| U3 | CP1 | CP1 approval |
| U4 | 03 Spec Writer + spec gate (D-6) | 03 PASS |
| U5 | CP2 | CP2 approval |
| U6 | Backend loop + render | 04 Stage 3 PASS |
| U7 | Frontend loop + render (only if `specRequiresFrontend`) | 05 Stage 3 PASS |
| U8 | Gate 1 + Stage 3 gate | — (gate) |
| U9 | Gate 1.5 | — (gate) |
| U10 | 06 Test Verifier + TEST_REPORT | 06 PASS |
| U11 | Per round: Gate 2 + 07 Validator (+ routing, round builders, Gate 1, Stage 3 gate, Gate 1.5) | 07 PASS |
| U12 | Stage 4 gate | — (gate) |
| U13 | CP3 → baseline → SUCCESS | CP3 approval |

**Attempt counts come from state (AC-36).**
- `usedAttempts(state, builder, phase)` reads `builderAttempts`.
- `allowedAttempts(state, builder, phase) = MAX_BUILDER_ATTEMPTS + Σ attemptGrants` matching that builder and phase.
- `runBuilderLoop` iterates `attempt = used + 1 .. allowed`. If `used >= allowed` on entry, it escalates `MAX_LOOPS` without invoking.
- A killed in-flight attempt was committed before invocation (orch:445), so it counts as spent. This is the existing contract at state-tracker.ts:381-383.
- A run killed during attempt 2 therefore gets exactly 1 more attempt.
- The retry briefing for the first resumed attempt is rebuilt from the last `StageLoopBack.failure` for that builder and phase. That field is new, and loop-backs are now committed.

**Stage 3 loop criterion with grants.** `validateLoopLimits` (stage-gates.ts:617-629) hard-codes `> 3`. Two changes:
- Stage 3 metadata gains `maxBackendLoops` / `maxFrontendLoops` from `allowedAttempts`.
- `lastAttempts` is rebuilt from `builderAttempts[agent].stage3` on resume.

Without this, a granted 4th attempt would fail the Stage 3 gate.

**Validator rounds on resume.**
- `round` starts at `state.validatorRoundsCompleted ?? 0`, not 0 (orch:1052).
- `pendingValidatorRound(state, outputs, cwd)` detects an unfinished round in which the latest Validator step is FAIL, `validatorRoundsCompleted = r > 0`, and a routed builder has no PASS with `{phase:'validator-round', round:r}`. Routing is recomputed from that FAIL step's issues with `routeCriticalIssues`.
- The orchestrator then enters round r's builder fix directly (with remaining attempts), followed by Gate 1, the Stage 3 gate and Gate 1.5, and then returns to the top of the loop.
- Otherwise it starts at the top of the loop with `round = r`.

**Gate 2 reference after a resume (MINOR-11, IN).** `regressionReference(prior, baseline)` changes from "the first record" to "the first record with `canAdvance === true`, else the baseline".
- Today a resumed run whose first Gate 2 counted 0 tests ("no tests detected", escalated) would make 0 the reference, lowering the bar.
- In the A-1 flow nothing changes: validator rounds only follow a passing round 0.
- See I-12.

**Reopening an ESCALATED run (AC-35).** `reopenFeature(state, resumeRecord)`:
- sets `status = 'IN_PROGRESS'`;
- deletes `completedAt`, `completionStatus` and `finalSummary`;
- sets `resolvedAt` and `resolution` on the latest unresolved escalation (`EscalationRecord` already has these fields, state-tracker.ts:103-104);
- appends `resumeHistory`.

Execution then continues at the first unit without a recorded completion.

**Invalidation on gate failure (I-6, recommended IN).** A step recorded PASS whose gate then failed would otherwise re-fail on every resume, because the agent is skipped and the gate re-reads the same documents. `invalidateAgentSteps(state, agents, reason)` marks those steps as follows:

| Gate that failed | Steps invalidated |
|---|---|
| Stage 1 gate | 01 |
| Story gate | 02 |
| Spec gate | 03 |
| Stage 4 gate | 06 and 07 |

- Builders are never invalidated: their attempts are budgeted, and the Stage 3 gate simply re-runs.
- Steps are kept, flagged and not deleted, so the record stays auditable.

**Approved-artifact integrity on resume (I-7, recommended IN).** When a resume will skip an approved CP1 or CP2 that recorded a `sha256`, the presentation is rebuilt (pure file read) and the hash compared. A mismatch is refused with `APPROVED_ARTIFACT_CHANGED`, naming the checkpoint and `--close`. This stops builders from implementing a brief that was edited after it was approved.

**`featureDescription` in state (AC-37).**
- `createFeatureState(featureName, createdBy?, featureDescription?)`; the orchestrator passes it.
- On resume, `promptCtx.featureDescription = state.featureDescription ?? options.featureDescription`.
- The CLI refuses `--feature` with `--resume` if it differs from state. If a pre-A-2 state has no description, `--feature` is required.

### D-3 Resume requests and refusals (AC-35, 51-54, 71-74)

```ts
export type CheckpointId = 1 | 2 | 3;
export type ResumeAction =
  | { kind: 'continue' }
  | { kind: 'approve'; checkpoint: CheckpointId }
  | { kind: 'reject'; checkpoint: CheckpointId; notes: string };
export interface ResumeRequest { action: ResumeAction; grantAttempts?: number }
export class RunRefusedError extends Error { constructor(readonly code: RunRefusalCode, message: string) }
export type RunRefusalCode =
  | 'RUN_FINISHED' | 'RUN_NOT_FOUND' | 'INVALID_RUN_ID' | 'ACTIVE_RUN_EXISTS' | 'UNREADABLE_RUN'
  | 'NEEDS_GRANT' | 'GRANT_NOT_APPLICABLE' | 'GRANT_OUT_OF_RANGE'
  | 'NO_PENDING_CHECKPOINT' | 'WRONG_CHECKPOINT' | 'NOTES_REQUIRED'
  | 'ARTIFACT_CHANGED' | 'APPROVED_ARTIFACT_CHANGED' | 'DESCRIPTION_MISMATCH' | 'NOT_SUCCESS';
export function checkResumeRequest(state: FeatureState, request: ResumeRequest): void; // pure; throws RunRefusedError
```

`runFeatureFactory` calls `checkResumeRequest` **before the try and before any commit**, so a refusal leaves `state.json` byte-identical (AC-52, 53, 71, 73). Decision table:

| Run class | Action | Outcome |
|---|---|---|
| SUCCESS / MANUAL_STOP | any | `RUN_FINISHED` |
| PAUSED | continue | **no-op**: state untouched, returned as is; CLI exits PAUSED (AC-54, see I-2) |
| PAUSED | approve n ≠ pending | `WRONG_CHECKPOINT` (AC-53) |
| PAUSED | approve = pending | orchestrator rebuilds the presentation and compares the hash. Mismatch → `ARTIFACT_CHANGED` (AC-52). Match → record approval `{checkpointId, sha256, approvedBy:'resume --approve'}`, clear the pending checkpoint, status IN_PROGRESS, commit, continue (AC-51) |
| PAUSED | reject n ≠ pending | `WRONG_CHECKPOINT` |
| PAUSED | reject, blank notes | `NOTES_REQUIRED` |
| PAUSED | reject = pending | record the rejection (D-5) and a `MANUAL` escalation, then `finish(ESCALATED)`; exit 1; resumable (AC-74) |
| ESCALATED or ACTIVE | approve / reject | `NO_PENDING_CHECKPOINT` |
| ESCALATED, builder exhausted (`exhaustedBuilder(state)`) | continue, no grant | `NEEDS_GRANT`; the message names `--grant-attempts <n>` (AC-71) |
| ESCALATED, builder exhausted | grant n ∈ 1..3 | `recordAttemptGrant({builder, attempts:n, at: phase, grantedAt})`, reopen, continue (AC-72) |
| any | grant when no builder is exhausted | `GRANT_NOT_APPLICABLE` |
| any | grant ∉ 1..3 | `GRANT_OUT_OF_RANGE` (I-8) |
| ESCALATED by a rejection | continue | reopen + start the rework (D-5) |
| ESCALATED, other reason | continue | reopen, continue (AC-35) |
| ACTIVE (killed) | continue | continue; no reopen needed |

`exhaustedBuilder(state)` returns the builder only when the latest unresolved escalation has reason `MAX_LOOPS`, a builder agent, and the new `context.builderPhase`. `runBuilderLoop` writes that field on exhaustion.

### D-4 Checkpoint model (AC-38, 43, 44, 49, 50, 55-57, 77, 78)

```ts
export const CHECKPOINTS = {
  STORY:  { id: 1, name: 'CHECKPOINT 1: Approve the story', stage: 2 },
  BRIEF:  { id: 2, name: 'CHECKPOINT 2: Approve the technical brief', stage: 2 },
  CHANGE: { id: 3, name: 'CHECKPOINT 3: Approve the validated change', stage: 4 }
} as const satisfies Record<string, CheckpointDefinition>;

export interface CheckpointRequest {
  id: CheckpointId; name: string; stage: number;
  /** The exact text presented: the full artifact(s). Approvals bind to sha256(text). */
  text: string;
  sha256: string;
  artifactPaths: string[];            // absolute
}
export type CheckpointDecision =
  | { decision: 'APPROVE'; approvedBy?: string }
  | { decision: 'REJECT'; notes?: string }
  | { decision: 'PAUSE' };
approveCheckpoint?: (request: CheckpointRequest) => Promise<CheckpointDecision | boolean>;
export function normaliseDecision(value: unknown): CheckpointDecision;
```

**`normaliseDecision`:**
- `true` → APPROVE and `false` → REJECT (legacy; keeps about 30 existing tests and `runToEnd` working).
- A well-formed object passes through.
- **Anything else → PAUSE.** This fails closed: nothing is approved and nothing is re-run.

`summary` is removed from `CheckpointRequest`, deliberately. Nothing may present a summary in place of the artifact (AC-43).

**What each checkpoint presents (`harness/checkpoint-presentation.ts`; `sha256Hex` uses node `crypto`):**

| CP | Text |
|---|---|
| CP1 | the exact bytes of `<runDir>/USER_STORY.md` |
| CP2 | the exact bytes of `<runDir>/TECHNICAL_BRIEF.md`, then `\n\n---\n\n## FILE_LIST.md\n\n`, then FILE_LIST.md (I-5) |
| CP3 | the full `VALIDATION_REPORT.md`, then `## IMPORTANT findings (N)` (one line per `state.importantFindings` entry, `[Stage s · source] message`), then `## Change (source: git \| claimed-files)` and `ChangeSet.text` (D-8). `changedFiles` = `ChangeSet.files` |

- A missing artifact throws `CheckpointPresentationError`. The orchestrator escalates `CRITICAL_ISSUE` with blockers and never asks the approver.
- **Determinism:** the text is built only from files, state and the diff, so a re-hash at `--approve` compares like with like.

**The checkpoint helper.** `checkpoint(def, presentation): Promise<FeatureState | undefined>`; `undefined` means approved.
- **No approver configured:** escalate `MANUAL` "requires human approval" (unchanged, orch:387-397). This is not a rejection record.
- **APPROVE:** `recordCheckpointApproval(..., {checkpointId, sha256})`, then **`commit()` immediately** (AC-38, fixing orch:405).
- **PAUSE:** `recordPause(state, {checkpointId, name, stage, artifactPaths (relative to cwd), sha256, changedFiles?})`. This sets `status = 'PAUSED'` and is followed by `commit()`, **not `finish()`** (AC-49). Return the state.
- **REJECT:** `recordCheckpointRejection(...)` (D-5), then `recordEscalation(stage, 'human', 'MANUAL', '<name> was rejected.', {checkpointId, notes})`, then `finish(ESCALATED)` (AC-46).

**The split Stage 2 gate (C-9).** `stage-gates.ts` exports two contracts, both with stage 2:
- `STAGE2_STORY_CONTRACT`: User Story Complete and AC Testable (CRITICAL); required `USER_STORY.md`.
- `STAGE2_SPEC_CONTRACT`: Technical Brief Complete (CRITICAL) and File List Documented (IMPORTANT); required `TECHNICAL_BRIEF.md` and `FILE_LIST.md`.

`stageContracts[2]` becomes their concatenation, a single source still used by `acceptFeatureSpec`. The order becomes:

> 02 → story gate → CP1 → 03 → spec gate → CP2 → `advanceToStage(3)`

Either part escalates `CRITICAL_ISSUE` with `{ blockers }` (AC-56, 57, 78).

**The pre-supplied spec path (AC-55, C-4).**
1. `acceptFeatureSpec(spec, cwd, artifactDir)` (unchanged I-11, plus the NEW-MINOR-3 catch).
2. Record one `tier-1` PASS step per supplied output: researcher at stage 1 when present, story and spec at stage 2.
3. Stay in Stage 2. Run the common path from the story gate onward, so CP1 and CP2 are presented.
4. A resumed pre-supplied run is detected by its `tier-1` steps, and the researcher unit is never run for it.

### D-5 Rejection and rework (AC-46, 74, 75)

```ts
export interface CheckpointRejection {
  checkpointId: CheckpointId; name: string; stage: number;
  notes: string;                 // '' allowed from a TTY rejection; CLI --reject requires non-blank
  sha256: string; artifactPaths: string[];
  reworkAgents: string[];        // CP1 → ['02-story-writer']; CP2 → ['03-spec-writer']; CP3 → see below
  rejectedAt: string;
  source: 'approver' | 'resume --reject';
  rework?: { startedAt: string; supersededDir: string };  // set when a resume starts the rework
}
```

**Which builders a CP3 rework involves (`reworkAgentsForChange`):**
- Every builder whose merged `filesModified`, normalised with `cwd`, intersects `changedFiles`.
- If there is no intersection, every builder that ran in this run (I-10).
- The list is computed at rejection time and stored, so the resume is deterministic.

**Starting a rework** (a plain resume of a rejection-escalated run, in `applyResume`):
1. Reopen the run.
2. Move the rejected documents into `<runDir>/_superseded/<cycle>/` with `supersedeArtifacts`. Missing files are skipped, so a retry is idempotent.
   - CP1: USER_STORY.md.
   - CP2: TECHNICAL_BRIEF.md and FILE_LIST.md.
   - CP3: TEST_REPORT.md and VALIDATION_REPORT.md.
3. Invalidate the PASS steps to be re-run.
   - CP1: 02.
   - CP2: 03.
   - CP3: 06 and 07. Builders are not invalidated; they are merged.
4. Set `rejection.rework`, then commit.

`cycle` is the 1-based index of the rejection in `checkpointRejections`.

**The re-runs:**
- **CP1:** the Story Writer runs with `storyPrompt(ctx, rework)`. The rework briefing names the checkpoint, quotes the notes and gives the absolute path of the superseded document. Then the story gate, then CP1.
- **CP2:** the same, with `specPrompt`. The CP1 approval stays valid and is hash-checked (I-7).
- **CP3:** inside the Stage 4 function, before Gate 1.5:
  1. Each rework builder (backend first) runs `runBuilderLoop(half, {phase:'rework', round: cycle, rework})`. It has its own `MAX_BUILDER_ATTEMPTS` budget in `builderAttempts[agent].rework[cycle]`, and `builderPrompt` gets a `checkpointReworkBriefing`.
  2. Merge the outputs and re-render the documents.
  3. Gate 1 (escalation stage 4), Stage 3 gate, Gate 1.5.
  4. Test Verifier (re-run, since it was invalidated).
  5. The Gate 2 → Validator loop. Rounds are **not** reset (I-10).
  6. The Stage 4 gate, then CP3, presented again with a new hash (AC-75).

A rework is active while its checkpoint has no approval recorded after `rework.startedAt` (`activeRework(state)`).

**MINOR-8 (stale documents) is closed in two ways:**
- Superseding means no previous VALIDATION_REPORT.md or USER_STORY.md is left in the run dir to be read as current.
- `validateOutputSchema` requires each `REQUIRED_ARTIFACTS[agent]` document, with non-empty `content`, for read-only agents (§3).

### D-6 Exit codes and the end of a run (AC-44, 46, 49, 77)

`EXIT_CODES = { SUCCESS: 0, STOPPED: 1, PAUSED: 3 }`, exported from cli.ts.
- 0: SUCCESS. Also `--close` done, and `--consolidate` with the Stage 5 gate passed.
- 1: ESCALATED, a refusal, a usage error, an unexpected error, or a `--consolidate` whose gate failed.
- 3: PAUSED, including a no-op resume of a paused run.

2 is avoided because CLIs conventionally use it for usage errors (I-9).

**End of run:**
1. The Stage 4 gate passes.
2. CP3 is presented.
3. On APPROVE: commit the approval → `writeRegressionBaseline` → `finish('SUCCESS')`.

`currentStage` stays 4. Stage 5 belongs to `--consolidate`. The lines "Waiting for PR merge" / "--consolidate <feature-id>" and the inline Consolidator (orch:1217-1256) are deleted (AC-44).

If the baseline write throws, the outer catch escalates. A resume then skips the approved CP3, writes the baseline and succeeds, so the operation is idempotent.

### D-7 Baseline writer (AC-65, writing side)

In `regression-baseline.ts`:
```ts
export function baselineFromRun(state: FeatureState, now: string): RegressionBaseline;
export function writeRegressionBaseline(cwd: string, baseline: RegressionBaseline): string;
```
- `baselineFromRun` throws `RegressionBaselineError` unless the latest `executionGateHistory` record exists and has `canAdvance === true`. It sets `testCount = testsRan(latest)`, i.e. passed + failed, per IMPORTANT-5 and regression-baseline.ts:40-44.
- `writeRegressionBaseline` validates with `baselineProblem`, then writes atomically with `writeFileAtomic` (D-12) to `<cwd>/.factory/baseline.json`.
- The file is a regular file outside any run directory. Archiving moves directories only, so it is never moved.

### D-8 Diff for CP3 (`harness/change-diff.ts`; new seam `options.changes`)

```ts
// state-tracker.ts
export type ChangeBase = { kind: 'git'; commit?: string } | { kind: 'none'; reason: string };
// change-diff.ts
export interface ChangeSet { source: 'git' | 'claimed-files'; files: string[]; text: string }
export interface ChangeTracker {
  captureBase(cwd: string): Promise<ChangeBase>;
  collect(cwd: string, base: ChangeBase, claimedFiles: string[]): Promise<ChangeSet>;
}
export const DEFAULT_CHANGE_TRACKER: Readonly<ChangeTracker>;
```

**When the base is captured:** at the start of a fresh run, stored in `state.changeBase` and committed.

**Real implementation:** `spawnSync('git', args, { cwd, encoding:'utf8', maxBuffer })`, with no shell. It may use only `rev-parse`, `diff` and `ls-files`.
- Inside a git work tree:
  - `git diff --no-color --no-ext-diff <commit> -- . ':(exclude).factory'`. With no HEAD, there is no tracked diff.
  - Untracked files: `git ls-files --others --exclude-standard -z -- . ':(exclude).factory'`, sorted. Each gets a header with path, byte size and sha256. Its content is inlined only if it is text (no NUL) and ≤ 256 KiB.
  - The hash line binds content either way.
  - `files` = `diff --name-only` ∪ untracked, sorted.
- Not a work tree, or git missing: `source:'claimed-files'`. The builders' claimed files are listed with sha256 and inlined text, under the same rules. The text says plainly that it is not a git diff (I-4).

**Tests:** `runToEnd` and the CLI fakes inject `fakeChangeTracker()`. Only `change-diff.test.ts` runs real git, in temp repos. This is local and offline.

### D-9 Run-directory lifecycle (AC-40, 41, 73; `harness/run-directory.ts`)

`clearStaleArtifacts` (stage-context.ts:197-210) is **deleted**. It deletes `_archive/`, which is carry-over 2. The obsolete comment at state-store.ts:76-79 is rewritten.

```ts
export const ARCHIVE_DIRNAME = '_archive';
export function listRunDirectories(cwd): RunDirectoryEntry[];      // .factory/* directories except _archive
export function prepareNewRunDirectory(cwd): { archived: string[] }; // fresh runs only
export function findRun(cwd, id): FoundRun | undefined;               // live first, then _archive
export function closeRun(cwd, id, now): FeatureState;
export function supersedeArtifacts(cwd, artifactDir, names, cycle): { dir: string; moved: string[] };
export function isSafeRunId(id: string): boolean;                     // /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ and no '..'
```

**`prepareNewRunDirectory` runs before `createFeatureState`, and only when there is no `resumeFromState`.**
1. Classify every directory.
   - A `state.json` that parses → `classifyRun`.
   - No `state.json` → "unrecognised" (pre-A-2 leftovers, the A-1 tests' `stale-run`).
   - A `state.json` that cannot be read or parsed, or whose id does not match → "unreadable".
2. Move SUCCESS, MANUAL_STOP and unrecognised directories, contents intact, with `renameSync` to `.factory/_archive/<name>/`. `_archive` is created lazily. On a name collision the target gets a `.<compact ISO timestamp>` suffix; nothing is ever deleted.
3. If any ACTIVE, PAUSED or ESCALATED run exists, throw `RunRefusedError('ACTIVE_RUN_EXISTS')`. The message names the run id, `npm run factory -- --resume <id> --cwd <cwd>` and `--close <id>`. An unreadable `state.json` → `UNREADABLE_RUN`, naming the directory.

Unfinished directories are never moved. Finished ones are archived first (the I-1 interpretation). `_archive/`, `baseline.json` and other regular files are never touched.

**`closeRun`:**
- Safe id, live directory only. An archived run is already finished → `RUN_FINISHED`.
- ACTIVE, PAUSED or ESCALATED → `completeFeature(state,'MANUAL_STOP','Closed by operator (--close)')`, saved in place. `pendingCheckpoint` is kept for the record.
- SUCCESS or MANUAL_STOP → `RUN_FINISHED`, state unchanged.
- The run is archived at the next fresh start (AC-73).

**`state-store.ts`** gains `stateFilePathIn(runDirAbs)`, `saveStateIn(runDirAbs, state)` and `loadStateFrom(runDirAbs, expectedId)`. `saveState` and `loadState` delegate to them, so archived runs can be read and updated.

**Run ids** from the CLI (`--resume`, `--close`, `--consolidate`) must pass `isSafeRunId`; otherwise `INVALID_RUN_ID`. Today `stateFilePath(cwd, '../../x')` resolves outside `.factory/`.

### D-10 `--consolidate` (AC-28 exception, 47, 48, 76; `feature/workflows/consolidate-run.ts`)

```ts
export interface ConsolidationOptions { cwd: string; runId: string; invoke: AgentInvoker; logger?: (m: string) => void }
export interface ConsolidationResult { state: FeatureState; location: 'live' | 'archive'; runDir: string; decision: StageAdvancementDecision; passed: boolean }
export async function consolidateRun(options: ConsolidationOptions): Promise<ConsolidationResult>;
```

1. `isSafeRunId` → `findRun`. Not found → `RUN_NOT_FOUND`. Classification other than SUCCESS → `NOT_SUCCESS`.
2. `artifactDir` = `.factory/<id>` or `.factory/_archive/<id>`.
3. The prompt is `consolidatorPrompt(ctx, { readableRunDir })`. `runDirectoryRules(cwd, artifactDir, { readableRunDir })` now honours the option (upstream-artifacts.ts:83-96 ignores it today). With the option, the rule says to read only `<abs dir>` and nothing else under `<cwd>/.factory/`, including other archived runs. The blanket ARCHIVE_RULE is not emitted. The prompt also names `<dir>/state.json` as the source of `agentInvocations` timings.
4. Invoke 08 and run `validateOutputSchema`. Persist into **that** directory, then record a step for 08 (PASS, or FAIL when the schema is invalid) at stage 5, plus `advanceToStage(5)`. Save with `saveStateIn(runDir)`. `completionStatus` stays SUCCESS.
5. Run the Stage 5 gate with `buildStageContext({stage:5, outputs:{consolidator}, artifactDir})` and record the findings.
6. `passed = decision.canAdvance`.

**The Stage 5 contract (AC-48, 76):**
- Criteria: "Consolidation Complete" and "Patterns Extracted", both **CRITICAL**.
- Required artifacts: `CONSOLIDATION_REPORT.md` and `PATTERNS.md`.
- "Knowledge Stored", `validateKnowledgeStored`, `BuildStageContextInput.knowledgeStored`, `metadata.knowledgeStored` (stage-context.ts:491) and the orchestrator's `stageGate(…, {knowledgeStored})` are **deleted**.

### D-11 CLI (thin; AC-37, 41, 42, 46, 47, 49, 51-54, 63, 71-75, 77, 79)

```ts
export const CLI_FLAGS: Readonly<Record<string, { takesValue: boolean; summary: string }>>;
// feature, name, cwd, model, yes, resume, approve, reject, notes, grant-attempts, close, consolidate
export type CliCommand =
  | { kind: 'run'; feature: string; name: string; cwd: string; model?: string; yes: boolean }
  | { kind: 'resume'; id: string; cwd: string; model?: string; yes: boolean; feature?: string; request: ResumeRequest }
  | { kind: 'close'; id: string; cwd: string }
  | { kind: 'consolidate'; id: string; cwd: string; model?: string };
export function parseArgs(argv: string[]): CliCommand;  // throws CliUsageError
export const EXIT_CODES: { SUCCESS: 0; STOPPED: 1; PAUSED: 3 };
export function exitCodeFor(state: FeatureState): number;
export function printableForTerminal(text: string): string;
// CliDependencies: approver → (r: CheckpointRequest) => Promise<CheckpointDecision | boolean>; + changes?: Partial<ChangeTracker>
```

**`parseArgs` rules:**
- Rejects unknown flags, positional tokens and duplicate flags.
- Exactly one mode: `--feature` (run), `--resume`, `--close` or `--consolidate`. With none, the error text contains `Missing --feature` (keeps the existing test).
- `--approve` / `--reject` / `--grant-attempts` require `--resume`, and are mutually exclusive.
- `--notes` is required with, and only allowed with, `--reject`, and must be non-blank.
- `<checkpoint>` ∈ `1|2|3|cp1|cp2|cp3` (`parseCheckpointId`).
- `--grant-attempts` must be an integer string.
- `--name` is not allowed with `--resume`.

**Dispatch (no decisions in `cli.ts`):**
- **run** → `runFeatureFactory`.
- **resume** → `loadState` (live directory).
  - Missing state, but `findRun` finds it archived → "archived and finished".
  - Missing → `RUN_NOT_FOUND`.
  - Description check, then `runFeatureFactory({ resumeFromState, resume: request, … })`.
- **close** → `closeRun`.
- **consolidate** → `consolidateRun`.
- `RunRefusedError` / `CliUsageError` → `deps.error(message)`, exit 1.

**After a run,** print the summary, the run record path and `nextStepHints(state, cwd)`:

| State | Hints |
|---|---|
| PAUSED | `Approve with: … --resume <id> --approve <n>` / `Reject with: … --resume <id> --reject <n> --notes "<why>"` / `Close with: … --close <id>` |
| ESCALATED, builder exhausted | `Resume with: … --resume <id> --grant-attempts <n>` + Close |
| ESCALATED, other | `Resume with: … --resume <id>` + Close |
| SUCCESS | `Consolidate with: … --consolidate <id>` |
| MANUAL_STOP | none |

`Resume with:` appears **only** for a resumable class (AC-42). The unconditional hint at cli.ts:218 is deleted.

**The approver:**
- `--yes` → `async () => ({ decision: 'APPROVE', approvedBy: '--yes' })`. This approves every checkpoint, CP3 included (unchanged semantics, I-15).
- No TTY → `{ decision: 'PAUSE' }` plus a message naming `--approve` / `--reject` (AC-77). Today this returns `false` (cli.ts:94-102).
- TTY:
  - print `printableForTerminal(request.text)`, which escapes C0/C1 controls and ESC sequences except `\n` and `\t`;
  - ask `Approve? [y = approve / n = reject / p = pause]`;
  - `n` asks for optional notes;
  - anything not `y`/`yes`/`p`/`pause` → REJECT (as today).

The hash stays over the raw `text`.

### D-12 Safe writes (NEW-MINOR-1; `harness/safe-write.ts`)

```ts
export function writeFileAtomic(path: string, content: string): void;  // temp in same dir + fsync + rename + dir fsync (logic extracted from state-store.ts:110-161)
export function writeFileNoFollow(containerAbs: string, path: string, content: string): void;
```

`writeFileNoFollow`:
- `realpath(dirname(path))` must equal or lie under `realpath(containerAbs)`.
- An existing target that is a symlink or not a regular file → `UnsafeArtifactPathError`.
- Opens with `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW`.

It is used by `persistArtifacts` (stage-context.ts:273-277) and `writeHarnessDocument` (harness-documents.ts:267-269). `saveState` and the baseline use `writeFileAtomic`; a rename replaces a symlink instead of following it.

### D-13 Per-agent timing (process improvement; cheap → IN)

```ts
export interface AgentInvocationRecord { stage: number; agent: string; startedAt: string; completedAt: string; durationMs: number; phase?: StepPhase['phase']; round?: number; attempt?: number }
export function recordAgentInvocation(state, record): FeatureState;   // appends + metrics.timePerStage[stage] += durationMs
```

- The orchestrator wraps every `invokeAgent` in `timedInvoke`, then calls `recordAgentInvocation` and commits.
- `recordAgentStep` gains an optional `timing` argument, so `startedAt` is the real start.
- An invocation that throws records nothing; the outer catch escalates.
- `totalTime` keeps its definition (state-tracker.ts:440-445) and includes any paused wall-clock.
- The 08 contract and prompt point the Consolidator at `state.json` `agentInvocations`.

**By-hand mode** (process note for the session): record the start and end time of each subagent in the run record (for example a `TIMINGS` table in the consolidation input). The program now does this itself.

## 3. Exact type and interface changes

**`harness/state-tracker.ts`.** All new fields are optional; old `state.json` files still load.

```ts
export type StepPhase = { phase?: 'stage3' | 'validator-round' | 'rework'; round?: number };
export type BuilderPhase = { phase: 'stage3' } | { phase: 'validator-round'; round: number } | { phase: 'rework'; round: number };
export interface BuilderAttemptCounts { stage3: number; validatorRounds: Record<number, number>; rework?: Record<number, number> }
export interface AttemptGrant { builder: BuilderAgent; attempts: number; at: BuilderPhase; grantedAt: string }
export interface PendingCheckpoint { checkpointId: 1|2|3; name: string; stage: number; artifactPaths: string[]; sha256: string; changedFiles?: string[]; pausedAt: string }
export interface CheckpointRejection { /* D-5 */ }
export interface ResumeRecord { resumedAt: string; fromClass: 'ACTIVE'|'PAUSED'|'ESCALATED'; action: 'continue'|'approve'|'reject'; checkpointId?: 1|2|3; grantedAttempts?: number }
export type ChangeBase = { kind: 'git'; commit?: string } | { kind: 'none'; reason: string };
export interface AgentInvocationRecord { /* D-13 */ }
// AgentStepRecord: phase gains 'rework'; + durationMs?: number; + invalidated?: { at: string; reason: string }
// StageLoopBack:   phase gains 'rework'; + failure?: { kind: 'test'|'schema'|'status'; error: string }
// EscalationRecord.context: + builderPhase?: BuilderPhase; + checkpointId?: 1|2|3; + notes?: string
// CheckpointApproval: + checkpointId?: 1|2|3; + sha256?: string
// FeatureState: status gains 'PAUSED'; + featureDescription?, changeBase?, pendingCheckpoint?, checkpointRejections?,
//               attemptGrants?, agentInvocations?, resumeHistory?
export function createFeatureState(featureName: string, createdBy?: string, featureDescription?: string): FeatureState;
export function recordAgentStep(state, stage, agent, status, output?, error?, phase?, timing?: { startedAt: string; completedAt: string }): FeatureState;
export function recordLoopBack(state, stage, agent, reason, result, fixApplied?, phase?, failure?): FeatureState;
export function recordBuilderAttempt(state, agent: BuilderAgent, at: BuilderPhase): FeatureState;
export function recordCheckpointApproval(state, stage, checkpointName, approvedBy?, notes?, binding?: { checkpointId: 1|2|3; sha256: string }): FeatureState;
export function recordPause(state, pending: Omit<PendingCheckpoint, 'pausedAt'>): FeatureState;     // status 'PAUSED'
export function clearPause(state): FeatureState;                                                    // status 'IN_PROGRESS'
export function recordCheckpointRejection(state, r: Omit<CheckpointRejection, 'rejectedAt'>): FeatureState;
export function recordAttemptGrant(state, g: Omit<AttemptGrant, 'grantedAt'>): FeatureState;
export function recordAgentInvocation(state, r: AgentInvocationRecord): FeatureState;
export function invalidateAgentSteps(state, agents: string[], reason: string): FeatureState;
export function reopenFeature(state, r: Omit<ResumeRecord, 'resumedAt'>): FeatureState;
export function isResumable(state): boolean; // D-1
```

**New harness modules:**
- `run-lifecycle.ts`: `RunClass`, `classifyRun`, `CheckpointId`, `parseCheckpointId`, `ResumeAction`, `ResumeRequest`, `RunRefusedError`, `RunRefusalCode`, `checkResumeRequest`, `exhaustedBuilder`, `usedAttempts`, `allowedAttempts`, `MAX_GRANT_PER_RESUME = MAX_BUILDER_ATTEMPTS`, `nextStepHints`.
- `run-progress.ts`: `rebuildOutputs`, `hasPass`, `isCheckpointApproved`, `activeRework`, `reworkAgentsForChange`, `pendingValidatorRound`.
- `run-directory.ts` (D-9), `checkpoint-presentation.ts` (D-4), `change-diff.ts` (D-8), `safe-write.ts` (D-12).

**Modified modules:**
- **`harness/stage-gates.ts`:**
  - `STAGE2_STORY_CONTRACT` and `STAGE2_SPEC_CONTRACT` exported; `stageContracts[2]` is their union.
  - Stage 5 as in D-10.
  - `validateLoopLimits` reads `maxBackendLoops` / `maxFrontendLoops` (default `MAX_BUILDER_ATTEMPTS`).
  - `validateKnowledgeStored` deleted.
- **`harness/stage-context.ts`:**
  - `knowledgeStored` removed.
  - `loops` input gains `max?: { backend?: number; frontend?: number }`.
  - `clearStaleArtifacts` deleted.
  - `claimsInsideFactoryDir` compares case-insensitively (MINOR-4).
  - `plainArtifactName` refuses reserved names, compared case-insensitively (NEW-MINOR-2): `state.json`, `baseline.json`, every `HARNESS_RENDERED_ARTIFACTS` name, names starting with `.`, `_archive`, `_superseded`.
  - Writes go through `writeFileNoFollow`.
- **`harness/regression-baseline.ts`:** `regressionReference` uses the first passing record (MINOR-11); adds `baselineFromRun` and `writeRegressionBaseline`.
- **`harness/agent-prompts.ts`:**
  - `CheckpointRework = { checkpointName: string; notes: string; rejectedPaths: string[] }`.
  - `storyPrompt(ctx, rework?)`, `specPrompt(ctx, rework?)`.
  - `builderPrompt(…, validatorRound?, rework?)`.
  - `consolidatorPrompt(ctx, opts?: { readableRunDir?: string })`.
  - `retryBriefing(attempt, failure?, maxAttempts = MAX_BUILDER_ATTEMPTS)`. The header stays "attempt N of 3" by default, so retry-briefing tests are unchanged.
  - `BuilderFailure` gains `{ kind: 'status'; error: string }` (MINOR-6).
- **`harness/upstream-artifacts.ts`:** `runDirectoryRules` implements `readableRunDir`.
- **`harness/agent-output-schema.ts`:**
  - For read-only agents, `validateOutputSchema` requires every `REQUIRED_ARTIFACTS[agent]` name in `details.artifacts`, with non-blank string `content` (MINOR-8).
  - `verifyArtifactMaterialization` counts a path that exists but is not a regular file as **missing** (MINOR-7).
  - A `null` or non-object builder output is already caught; the orchestrator now routes it to the schema-retry path (MINOR-10).
- **`harness/harness-documents.ts`:** `writeHarnessDocument` uses `writeFileNoFollow`.
- **`harness/validator-routing.ts`:** `mergeBuilderOutput(previous, next, cwd?)` normalises with `cwd` (MINOR-5).
- **`contracts/feature-spec.ts`:** catches `UnsafeArtifactPathError` around `persistArtifacts` (feature-spec.ts:126) and returns `{ accepted:false, blockers:[message] }` (NEW-MINOR-3).
- **`harness/state-store.ts`:** dir variants (D-9); `saveState` uses `writeFileAtomic`; comment rewritten.

**Orchestrator exports:**
- `CHECKPOINTS` with CHANGE; `CheckpointRequest`, `CheckpointDecision`, `normaliseDecision`.
- Re-exports `CheckpointId`, `ResumeRequest`, `RunRefusedError`.
- `OrchestrationOptions` gains `resume?: ResumeRequest` and `changes?: Partial<ChangeTracker>`; `approveCheckpoint`'s type widens.
- `runFeatureFactory` returns `FeatureState`; status may be `'PAUSED'`. It throws `RunRefusedError` before any write, and `StatePersistenceError` as today.

**Runner:**
- `runner/cli.ts`: D-11.
- `runner/smoke-validator.ts`: new, operator-only (§9).

## 4. Process flow after A-2 (`runFeatureFactory`)

1. **Pre-flight, outside the try, with no writes on refusal.**
   - Resume: `checkResumeRequest`. Then, for PAUSED + continue, return state untouched.
   - Fresh run: `prepareNewRunDirectory`, then `createFeatureState(name, undefined, description)`, then `changeBase = await changes.captureBase(cwd)`, then commit.
2. **`outputs = rebuildOutputs(state)`** and re-render the harness documents for the rebuilt outputs.
3. **`applyResume`** runs in the try, because it writes:
   - approve: hash check, then record the approval;
   - reject: record, escalate, `finish`;
   - grant: record the grant, then reopen;
   - rework start: supersede, invalidate, `rework.startedAt`;
   - reopen;
   - the I-7 approved-artifact checks.
   Each path commits.
4. **`stage1()` → `stage2()` → `stage3()` → `stage4()`**, each returning `FeatureState | undefined`, following the D-2 unit table and skip rule.
   - In `stage4()`, the CP3 rework block runs first when active.
   - IMPORTANT issues are recorded from **every** Validator output, deduplicated against existing `07-validator` findings (MINOR-9).
5. **CP3** → baseline → `finish(SUCCESS)`.

**Builder loop changes:**
- `null` or non-object output → schema failure, retried (MINOR-10).
- `status` not PASS (FAIL / LOOP_BACK) with a valid schema → failed attempt, `failure {kind:'status'}`, retried. It is never recorded PASS (MINOR-6; fixes orch:520).
- Every loop-back is committed.
- Exhaustion escalation carries `builderPhase`.

**Idempotency:** every transition a resume could restart from is committed (approval, pause, rejection, grant, reopen, invalidation, invocation, loop-back, step, stage advance). Superseding and archiving are moves that skip missing files, so retries are safe. No background jobs are added.

## 5. Traceability

**Test-file abbreviations.** All paths are under `factory/test/`.

| Abbr. | File |
|---|---|
| RL | `harness/run-lifecycle.test.ts` (new) |
| RP | `harness/run-progress.test.ts` (new) |
| RD | `harness/run-directory.test.ts` (new) |
| RS | `harness/resume.test.ts` (new) |
| CK | `harness/checkpoint-lifecycle.test.ts` (new) |
| CPR | `harness/checkpoint-presentation.test.ts` (new) |
| CD | `harness/change-diff.test.ts` (new) |
| CS | `harness/consolidate.test.ts` (new) |
| SW | `harness/safe-write.test.ts` (new) |
| OG | `harness/orchestrator-gates.test.ts` |
| VL | `harness/validator-loop-back.test.ts` |
| UA | `harness/upstream-artifacts.test.ts` |
| SG | `harness/stage-gates.test.ts` |
| SCX | `harness/stage-context.test.ts` |
| AOS | `harness/agent-output-schema.test.ts` |
| RB | `harness/regression-baseline.test.ts` |
| HD | `harness/harness-documents.test.ts` |
| EG | `harness/execution-gates.test.ts` |
| ST | `harness/state-tracker.test.ts` |
| FS | `contracts/feature-spec.test.ts` |
| CLI | `runner/cli.test.ts` |
| RH | `contracts/repo-hygiene.test.ts` |
| DD | `contracts/doc-drift.test.ts` |

Every title starts with its ID.

| ID | Change | Test → title |
|---|---|---|
| AC-34 | D-2 rebuild + skip | RS "AC-34 resuming a run killed at the Backend Builder skips 01–03, CP1 and CP2, and the Backend Builder prompt names the same artifact paths a fresh run did" |
| AC-35 | D-2 reopen | RS "AC-35 resuming a run ESCALATED by the Test Verifier reopens it (IN_PROGRESS, completedAt and completionStatus cleared) and restarts at the Test Verifier"; CLI "AC-35 --resume of an ESCALATED run reopens it and exits 0 when it then succeeds" |
| AC-36 | attempts from state | RS "AC-36 a run killed during the 2nd Backend Builder attempt gets exactly 1 more attempt on resume, counted from state" |
| AC-37 | `featureDescription` in state | CLI "AC-37 --resume <id> works without --feature, using the description saved in state"; CLI "AC-37 --feature that differs from the saved description is refused" |
| AC-38 | commit after approval | CK "AC-38 an approved checkpoint is on disk before the next agent is invoked" |
| AC-39 | D-2 skip rule | RS it.each "AC-39 on resume every gate for unfinished steps is evaluated again (%s)" (Gate 1.5 + Gate 2 + Stage 4 gate after a Validator ESCALATE; Stage 3 gate after a Stage 3 gate failure) |
| AC-40 | D-9 | RD "AC-40 a new run start archives SUCCESS and MANUAL_STOP runs intact into .factory/_archive/<id>/ and leaves PAUSED and ESCALATED runs untouched"; RD "AC-40 .factory/_archive/ and baseline.json are never moved or deleted" |
| AC-41 | D-9 refusal | RD it.each "AC-41 a new run is refused while a %s run exists, naming its id, --resume and --close, and nothing unfinished is moved"; CLI "AC-41 the CLI refuses a new run with the existing run's --resume and --close commands and exits 1" |
| AC-42 | `nextStepHints` | CLI it.each "AC-42 'Resume with' is printed only when the run is resumable (%s)" (SUCCESS: no; MANUAL_STOP: no; ESCALATED: yes; builder-exhausted: yes, with --grant-attempts; StatePersistenceError: no) |
| AC-71 | D-3 | RS "AC-71 resuming a builder-exhausted run without --grant-attempts is refused naming --grant-attempts <n> and state.json is unchanged"; CLI "AC-71 the refusal exits 1" |
| AC-72 | grants | RS it.each "AC-72 --grant-attempts %i gives the exhausted builder exactly that many attempts, recorded with builder, n and timestamp" (Stage 3; validator round); CLI "AC-72 --resume --grant-attempts 1 exits 0 when the granted attempt passes" |
| AC-73 | `closeRun` | RD "AC-73 closing a PAUSED, ESCALATED or IN_PROGRESS run sets MANUAL_STOP and the next fresh start archives it"; RD "AC-73 closing a SUCCESS or MANUAL_STOP run is refused and state.json is unchanged"; CLI "AC-73 --close exits 0, a second --close exits 1" |
| AC-43 | D-4 presentation | CK "AC-43 CP1 presents the full USER_STORY.md, CP2 the full TECHNICAL_BRIEF.md, CP3 the full VALIDATION_REPORT.md plus the diff" |
| AC-44 | CP3 / SUCCESS | CK "AC-44 CP3 is presented after the Stage 4 gate with the IMPORTANT findings, and approving it ends SUCCESS with no Consolidator invocation"; CLI "AC-44 a run whose CP3 is approved exits 0" |
| AC-45 | no PR / push / commit | RH "AC-45 no orchestrator, CLI, workflow or harness code creates a PR, commits or pushes, and change-diff.ts uses only rev-parse, diff and ls-files" |
| AC-46 | rejection | CK it.each "AC-46 rejecting CP%i ends ESCALATED with reason MANUAL and the run is resumable"; CLI "AC-46 a TTY rejection exits 1 and prints the resume command" |
| AC-47 | D-10 | CS "AC-47 --consolidate on a live SUCCESS run invokes 08 naming that run's directory and evaluates the Stage 5 gate"; CS "AC-47 --consolidate finds an archived SUCCESS run in .factory/_archive/<id>/"; CS it.each "AC-47 --consolidate refuses %s" (ESCALATED run, PAUSED run, unknown id, unsafe id); CLI "AC-47 --consolidate exits 0 when the Stage 5 gate passes and 1 when refused" |
| AC-48 | D-10 | RH "AC-48 no knowledgeStored field or Knowledge Stored criterion exists in the Stage 5 contract, the stage context or the orchestrator"; CS "AC-48 the Stage 5 gate passes and fails on the two documents only, never on memory storage" |
| AC-49 | PAUSE | CK "AC-49 a PAUSE records status PAUSED and a pendingCheckpoint with name, stage, artifact paths and hash, without finishing the run"; CLI "AC-49 a paused run exits 3" |
| AC-50 | `sha256Hex` | CPR "AC-50 sha256Hex is the SHA-256 of the exact UTF-8 bytes"; CK "AC-50 the stored hash equals the SHA-256 of the text the approver was given" |
| AC-51 | D-3 approve | CK "AC-51 --approve of the pending checkpoint with an unchanged artifact records its hash and continues without asking again"; CLI "AC-51 --resume --approve 2 continues the run" |
| AC-52 | D-3 hash check | CK "AC-52 --approve after the artifact changed is refused with 'artifact changed', no approval is recorded and the run stays PAUSED"; CLI "AC-52 the refusal exits non-zero" |
| AC-53 | D-3 | CLI it.each "AC-53 --%s naming a checkpoint other than the pending one is refused and state.json is unchanged" (approve, reject) |
| AC-54 | D-3 no-op | CK "AC-54 resuming a PAUSED run with neither --approve nor --reject does not pass the pending checkpoint"; CLI "AC-54 that resume exits 3 and prints the approve and reject commands" |
| AC-55 | D-4 pre-supplied | CK "AC-55 a pre-supplied spec saves the story and brief in the run directory, builder prompts name existing paths, and CP1 and CP2 are presented" |
| AC-56 | split gate | CK "AC-56 a story failing the story gate ends the run before CP1 and the approver is never called" |
| AC-57 | blockers | CK it.each "AC-57 a %s-part Stage 2 gate failure escalates with blockers" (story, spec) |
| AC-74 | D-3 reject | CK "AC-74 --reject <cp> --notes ends ESCALATED MANUAL, records the notes and the rejected checkpoint, and stays resumable"; CLI "AC-74 --reject without --notes is a usage error; with notes it exits 1" |
| AC-75 | D-5 | CK "AC-75 after a CP1 rejection, resume re-runs the Story Writer with the notes, then the story gate, then CP1"; CK "AC-75 after a CP2 rejection, resume re-runs the Spec Writer with the notes, then the spec gate, then CP2"; CK "AC-75 after a CP3 rejection, resume re-invokes each builder with files in the diff, then Gates 1, 1.5, 2, the Test Verifier, the Validator and the Stage 4 gate, then CP3, and the new approval binds to the new hash"; CLI "AC-75 --resume after a rejection re-runs the producing agent" |
| AC-76 | D-10 | CS "AC-76 --consolidate writes CONSOLIDATION_REPORT.md and PATTERNS.md into that run's directory (live or archived) and the Stage 5 gate requires both" |
| AC-77 | D-11 | CLI "AC-77 with no TTY and no --yes a checkpoint pauses the run, records no approval and exits 3"; CLI "AC-77 --yes still approves every checkpoint without asking (no TTY needed)"; RH "AC-77 the --yes approver returns APPROVE unconditionally" |
| AC-78 | split gate | CK "AC-78 a spec failing the spec gate ends the run before CP2 and the approver is never called for CP2" |
| AC-61 | delete + tsconfig | RH "AC-4 AC-61 the four root scripts are gone and tsconfig no longer excludes them" (replaces the AC-4 test; see I-3) |
| AC-65 (write) | D-7 | CK "AC-65 a SUCCESS run writes .factory/baseline.json with its Gate 2 ran-count and run id outside the run directory, and the next run uses it as the reference"; RB "AC-65 writeRegressionBaseline writes atomically and round-trips through readRegressionBaseline"; RB "AC-65 baselineFromRun refuses a run whose latest Gate 2 did not pass" |
| AC-79 | SKILL.md + `CLI_FLAGS` | DD "AC-79 SKILL.md documents --resume, --approve, --reject --notes, --close, --grant-attempts and --consolidate"; DD "AC-79 every CLI flag named in SKILL.md is accepted by parseArgs"; DD "AC-79 the claims block lists exactly CLI_FLAGS and EXIT_CODES" |
| AC-59 (update) | CP3 in claims | DD "AC-59 CHECKPOINT entries equal CHECKPOINTS" (now {1,2,3}); DD "D-11 CHECKPOINTS holds the story, brief and change checkpoints, numbered 1, 2 and 3" |
| AC-63 (update) | approver/exit | CLI "AC-63 a full CLI invocation with injected fakes spawns no process…" (08 no longer invoked; three checkpoints) |
| Carry-over 05 | contract | RH "carry-over 05-frontend-builder.md claims no loop-back to the Backend Builder" |
| Carry-over README | 152 tests | DD "carry-over README states no fixed test count" |
| TIMING | D-13 | RS "TIMING every agent invocation is recorded in state.json with start, end and duration, and timePerStage is filled" |
| SEC | `printableForTerminal` | CLI "SEC the TTY approver escapes terminal control sequences in presented text, and the hash stays over the raw text" |
| SEC | `isSafeRunId` | RL it.each "SEC run id %s is refused" (`../x`, `a/b`, `.hidden`, `_archive`) |
| MINOR-4 | IN | SCX "MINOR-4 a claim under .Factory/ in any letter case is rejected as harness-owned" |
| MINOR-5 | IN | VL "MINOR-5 mergeBuilderOutput unions an absolute and a relative path to the same file into one entry" |
| MINOR-6 | IN | OG "MINOR-6 a builder returning status FAIL with a valid schema and no failing test is retried, never recorded PASS" |
| MINOR-7 | IN | AOS "MINOR-7 a claimed path that is a directory is not materialised" |
| MINOR-8 | IN | AOS it.each "MINOR-8 a %s output missing a required document's content fails its schema"; CK "MINOR-8 a superseded VALIDATION_REPORT.md cannot satisfy the Stage 4 gate after a CP3 rework" |
| MINOR-9 | IN | VL "MINOR-9 Validator IMPORTANT issues from every round are recorded as findings, each once" |
| MINOR-10 | IN | OG "MINOR-10 a builder invoker returning null is a schema failure that is retried, not a MANUAL escalation" |
| MINOR-11 | IN | RB "MINOR-11 after a blocking first Gate 2 evaluation the reference is the baseline, not that evaluation's count"; RS "MINOR-11 a resumed Gate 2 is judged against the run's first passing count" |
| NEW-MINOR-1 | IN | SW "NEW-MINOR-1 writeFileNoFollow refuses a symlinked target or a directory resolving outside the container"; SCX "NEW-MINOR-1 persistArtifacts refuses to write through a symlink in the run directory"; HD "NEW-MINOR-1 writeHarnessDocument refuses a symlinked target" |
| NEW-MINOR-2 | IN | SCX it.each "NEW-MINOR-2 the reserved artifact name %s is refused in any letter case" |
| NEW-MINOR-3 | IN | FS "NEW-MINOR-3 an unsafe artifact name in a pre-supplied spec is rejected with blockers"; OG "NEW-MINOR-3 that spec escalates CRITICAL_ISSUE, not MANUAL" |
| MINOR-1 | IN (cut line) | EG "MINOR-1 a dev script that exits 0 before the window passes with a warning recorded as a finding"; EG "MINOR-1 a backgrounded child in the command's process group is killed when the command exits" |
| MINOR-3 | IN (cut line) | EG "MINOR-3 the summary that appears last in the output wins across Jest, Vitest and Mocha patterns" |
| MINOR-2 | DEFER | — Unbounded buffers are a resource concern, not false evidence. A cap risks truncating the summary, which comes last in the output; it needs a tail ring buffer. Phase B. |
| MINOR-12, 13 | already resolved in A-1 (A1_VALIDATION_RECHECK) | — |

## 6. Test plan

**Fixtures** (`factory/test/fixtures/`):
- `changes.ts` (new): `fakeChangeTracker({ files, text, source })`. It records calls and never spawns anything.
- `harness-run.ts`:
  - `runToEnd` defaults `changes: fakeChangeTracker()` and keeps `approveCheckpoint: async () => true`.
  - New `killAt(invoke, agent, callNumber)` wraps an invoker: at that call it captures `loadState` from disk and throws `SimulatedKill`.
  - New `restoreSnapshot(cwd, state)` calls `saveState`. Together they simulate a killed process for AC-34/36.
  - New `decisions(...list)`: a scripted approver.
  - New `seedRun(cwd, class)`: writes a valid state.json and one document per run class, for RD.

**Existing tests that change:**
- `checkpoints.test.ts`:
  - "shows the human what they are approving" now asserts the full USER_STORY.md text (AC-43).
  - "removes previous runs' artifacts" becomes "archives a previous unrecognised run directory intact" (D-9).
  - "namespaces artifacts per run" closes the first run (`closeRun`) and asserts it is in `_archive/`.
  - "stops when the human says no" keeps `async () => false`.
- `cli.test.ts`:
  - AC-63 full run: `not.toContain('08-feature-consolidator')`, `exitCodes [0]`, the approver is called for CP1-3.
  - The no-TTY test becomes exit **3**, status PAUSED.
  - Fakes add `changes`.
- `upstream-artifacts.test.ts`:
  - The 08 parts of AC-24 / AC-28 and "Consolidator prompt names it" move to a `consolidateRun` after a SUCCESS run.
  - The AC-28 agent set becomes `ALL_AGENTS` minus 08 for the run, plus a consolidate assertion.
  - The `runDirectoryRules` options-bag test is inverted: the options now change the output.
- `orchestrator-gates.test.ts`:
  - AC-21 (doc list loses CONSOLIDATION_REPORT/PATTERNS).
  - "AC-21 a Validator that returns no VALIDATION_REPORT.md…" now escalates `SCHEMA_VALIDATION` by 07 (MINOR-8, I-11); AC-21's [U] stays in SG.
  - AC-65 read: `stale-run` is archived, not deleted.
  - AC-66: assert the reference is undefined at Gate 2; the baseline now exists after SUCCESS.
- `validator-loop-back.test.ts`: the event sequences at :252-259 and :297-304 lose `08-feature-consolidator`.
- `stage-gates.test.ts`: Stage 2 split tests; Stage 5 tests; loop-limit max metadata.
- `state-tracker.test.ts`: new `isResumable` cases (completed ESCALATED → true, PAUSED → true, MANUAL_STOP → false) and the new recorders.
- `doc-drift.test.ts`: checkpoints [1,2,3], CHANGE, AC-79, new retired claims (`/Knowledge Stored/`, `/run starts again at Stage 1/`, `/does not wait/`, `/no third checkpoint/i`).
- `repo-hygiene.test.ts`: the AC-4 test is replaced (I-3), plus AC-45, AC-48, AC-77 and the carry-over 05 test.
- `stage-context.test.ts`, `agent-output-schema.test.ts`, `regression-baseline.test.ts`, `feature-spec.test.ts`, `harness-documents.test.ts`, `execution-gates.test.ts`: the backlog cases above.
- `state-persistence.test.ts`: expected unchanged (a pinned `resumeFromState` is an ACTIVE resume). The Builder confirms.

**CI rule:** `npm test` stays offline. Only CD runs real `git`, in temp repos, and only EG runs real child `node` processes. No test reaches the SDK.

## 7. Implementation order (one fresh Backend Builder per step)

At every gate: `npm test` and `npm run typecheck` are green, and the session re-runs both. The four root scripts stay on disk until step 10.

| Step | Content | ACs / items | Depends on | Gate before continuing |
|---|---|---|---|---|
| 1 | State model and pure lifecycle: state-tracker types and recorders; `run-lifecycle.ts`; `sha256Hex`; RL and ST tests | D-1, D-3 (pure), SEC run id, AC-50 [U] | — | RL/ST green; no orchestrator change |
| 2 | Orchestrator refactor into `stage1..4()` with zero behaviour change, plus `timedInvoke` (D-13), the approval commit (AC-38) and loop-back commits | TIMING, AC-38 | 1 | **All A-1 tests pass unchanged**; 2 new tests |
| 3 | `safe-write.ts`; `run-directory.ts`; state-store dir variants; `prepareNewRunDirectory` on fresh start; `closeRun`; delete `clearStaleArtifacts`; rewrite the checkpoints workspace tests | AC-40, 41 [O], 73 [O], carry-over 2, NEW-MINOR-1 (writers) | 2 | RD/SW green |
| 4 | Checkpoint model: decisions, presentation CP1/CP2, PAUSE / pending, rejection record, split Stage 2 gate, pre-supplied CP1/CP2 | AC-43 (1-2), 46 [O], 49 [O], 50 [O], 55, 56, 57, 78 | 2 | CK subset green |
| 5 | CP3 and SUCCESS: `change-diff.ts` + seam + `captureBase`; CP3; Consolidator out of the main run; baseline writer; Stage 5 contract; SKILL.md CP3 + claims [1,2,3] **in the same change**; update tests that expected 08 | AC-43 (3), 44, 45, 48 [S], 65 (write), 59 (update) | 3, 4 | CD green; doc-drift green |
| 6 | Resume core: `run-progress.ts`; skip rule; reopen; refusals in orchestrator; attempts from state; grants; validator-round resume; gate-failure invalidation (I-6); approved-artifact check (I-7); MINOR-11 | AC-34, 35 [O], 36, 39, 71 [O], 72 [O], MINOR-11 | 5 | RS green |
| 7 | Pause/approve/reject on resume plus rework: `applyResume`; supersede; rework prompts and phase; MINOR-8 schema rule; MINOR-9; MINOR-5 | AC-51, 52, 53 [O], 54 [O], 74 [O], 75 [O] | 6 | CK complete |
| 8 | `--consolidate`: `consolidate-run.ts`; `runDirectoryRules` exception; 08 contract | AC-47 [O], 48 [O], 76, 28 exception | 5 | CS green |
| 9 | CLI: `parseArgs` modes / unknown-flag rejection; `CLI_FLAGS`; `EXIT_CODES`; dispatch; hints; TTY / no-TTY decisions; `printableForTerminal` | AC-37, 41/46/47/49/51-54/71-75 [C], 42, 63 (update), 77, SEC | 6, 7, 8 | CLI green |
| 10 | Docs and cleanup: SKILL.md rewrite (flags, resume, lifecycle, CP3, Stage 5, baseline); AC-79 drift; contract 05; README; state-store comment; **delete the 4 root scripts and the tsconfig entries**; `smoke-validator.ts` | AC-61, 79, carry-overs 1 and 3 | 9 | DD/RH green; `npm run typecheck` green |
| 11 *(cut line)* | Backlog hardening: MINOR-4, 6, 7, 10, NEW-MINOR-2, 3; optional MINOR-1, 3 | backlog | 2 | each backlog test green |
| S-1 | **Operator, not a builder:** I-13 smoke run (§9) | I-13 | 10 | PASS criteria met |

**Scope check.** 11 builder steps against A-1's 8. If review load is too high, **cut step 11 into a follow-up "A-2b hardening" PR.** No in-scope AC depends on it.

Backlog items that interact with resume stay before the cut:
- MINOR-5, 8 and 9 (step 7);
- MINOR-11 (step 6);
- NEW-MINOR-1 (step 3).

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Refactoring a 1,379-line orchestrator breaks A-1 behaviour | Step 2 is a pure refactor gated on every A-1 test passing unchanged; the A-2 behaviour lands after it |
| Resume skips something it should re-run, or re-runs something approved | One written skip rule (D-2) with a unit table; RS tests per class; invalidation is explicit and recorded |
| Hash mismatch on `--approve` from non-deterministic text | The text is built only from files, state and a sorted, deterministic diff; CPR test: two presentations of the same inputs give the same hash |
| Large diffs at CP3 | Untracked files above 256 KiB or binary: hash only. Tracked diff in full |
| Pre-existing uncommitted changes appear in CP3 | Documented (I-4); the base is captured at run start |
| Old ESCALATED runs in `.factory/` now block new runs | One-time `--close <id>` per run; the refusal message names it (I-13 below) |
| `--yes` now reaches SUCCESS and writes a baseline unattended | Same semantics as "approve every checkpoint"; flagged (I-15) |
| A builder (Write/Bash, GAP-5) edits `baseline.json`, the run dir or the `test` script | Out of scope. Symlink planting is closed (NEW-MINOR-1); content tampering is not |
| Terminal-escape injection from agent text or diff at the TTY | `printableForTerminal` |
| Path traversal via run ids | `isSafeRunId` everywhere an id comes from the CLI |
| Concurrency (two runs at once) | Out of scope (story edge cases) |

**Changes visible to users of `npm run factory`:**
1. A third checkpoint (CP3) after the Stage 4 gate. SUCCESS needs it.
2. The Consolidator no longer runs in a run; use `--consolidate <id>`.
3. Checkpoints show full documents, and on a TTY accept `y` / `n` (with optional notes) / `p`.
4. No TTY and no `--yes` now **pauses** (exit 3) instead of escalating.
5. New flags: `--approve`, `--reject --notes`, `--grant-attempts`, `--close`, `--consolidate`. `--feature` is optional with `--resume`. Unknown flags and stray tokens are errors.
6. `--resume` continues from where the run stopped. A builder that exhausted its attempts needs `--grant-attempts`.
7. A new run is refused while another run is unfinished. Finished runs move to `.factory/_archive/` and are never deleted. Old ESCALATED runs must be `--close`d once.
8. SUCCESS writes `.factory/baseline.json`.
9. Exit code 3 means PAUSED.
10. CP1 is asked only after the story passes its gate.
11. The pre-supplied spec path now asks CP1 and CP2, and its documents must carry content.
12. A builder reporting FAIL is retried instead of passing.
13. `state.json` records real per-agent timings.

## 9. I-13 live SDK smoke check (operator-run; never part of `npm test`)

**S-1, mandatory, run after step 10, before CP3 of this PR.** Cost: one Validator invocation (opus, at most 25 turns).

```
mkdir -p /private/tmp/ff-smoke-validator
npx ts-node factory/runner/smoke-validator.ts --cwd /private/tmp/ff-smoke-validator
```

What the script does:
- Refuses a non-empty `--cwd`.
- Writes a fixture: `package.json`, `src/greet.ts` (a pure function: no auth, SQL, HTML or secrets), and `.factory/smoke-validator/` containing USER_STORY.md, TECHNICAL_BRIEF.md and FILE_LIST.md. The brief declares `securitySurface` with auth, sqlDatabase and htmlRendering ABSENT, and userInput and secrets PRESENT.
- Invokes **only** `07-validator` through `createSdkInvoker` with `validatorPrompt(ctx)` and the real `agentOutputSchema('07-validator')`.

Pass criteria, each printed:

| # | Criterion |
|---|---|
| P1 | No `AgentInvocationError`; `structured_output` is returned (the SDK accepted the `anyOf` schema) |
| P2 | `validateOutputSchema(4,'07-validator', out).valid` |
| P3 | Each of the 5 checks is `true`, `false` or `"not_applicable"` (strict) |
| P4 | At least one check is `"not_applicable"` with a non-blank `notApplicableReasons[check]` |
| P5 | `evaluateSecurityChecks(security, fixtureSurface)` has no blocker for any `"not_applicable"` check |

Results:
- **Exit 0** = "I-13 PASS".
- **Exit 1** = FAIL. If P1 fails on the schema, apply the A-1 §13 fallback shape `{type:['boolean','string'], enum:[true,false,'not_applicable']}` and re-run.
- **Exit 2** = INCONCLUSIVE: P1–P3 hold but no `"not_applicable"` was returned. Re-run once. If it is inconclusive again, record "anyOf accepted, string branch unobserved".

**S-2, recommended: the A-2 live walkthrough, where pause/resume makes it cheap.**
1. On a scratch project, run `npm run factory -- --feature "<toy>" --cwd <scratch> </dev/null`. It pauses at CP1 with no TTY.
2. `--resume <id> --approve 1`, then `--approve 2`. The run pauses at CP3 after the Validator.
3. Read `jq '.stageHistory[]|select(.agent=="07-validator")|.output.details.security' .factory/<id>/state.json`. This is a second real tri-state sample.
4. Then `--approve 3` (expect `baseline.json`) and `--consolidate <id>`, or `--close <id>`.

Each stop is free, and the operator can spread the run over time.

## 10. Data model, API and frontend (template)

- **Data model:**
  - `state.json` gains the optional fields in §3.
  - New `.factory/_archive/<id>/` and `.factory/<id>/_superseded/<n>/`.
  - `.factory/baseline.json` is now written.
  - No migrations. Old state files load; old ESCALATED runs classify as ESCALATED.
- **API:** no HTTP. The TypeScript surface is in §3; the CLI in D-11.
- **Frontend:** none. The Frontend Builder is not needed.

## 11. Security surface

| Surface | Declaration | Why |
|---|---|---|
| auth | **ABSENT** | A local CLI and library with no auth boundary, roles or sessions. The SDK login is the user's and is untouched |
| userInput | **PRESENT** | CLI arguments (run ids, notes, numbers, checkpoint ids), TTY answers, and agent outputs (artifact names, diffs) |
| secrets | **ABSENT** | No secret, key or credential is read, stored or written; `baseline.json` and `state.json` hold counts and run data only |
| sqlDatabase | **ABSENT** | No database; persistence is JSON and Markdown files |
| htmlRendering | **ABSENT** | Output is terminal text and Markdown files that the program never renders in a browser. Terminal escape injection is handled under userInput (`printableForTerminal`) |

```json
{ "securitySurface": { "auth": "ABSENT", "userInput": "PRESENT", "secrets": "ABSENT", "sqlDatabase": "ABSENT", "htmlRendering": "ABSENT",
  "notes": "Local CLI/library: no auth boundary, no secrets handled, no SQL, no browser-rendered markup. userInput = CLI args, TTY answers, agent outputs." } }
```

## 12. Issues for the operator

- **I-1 AC-40 and AC-41 interact.** I read them together:
  - finished runs (SUCCESS, MANUAL_STOP, plus directories with no state.json) are archived first;
  - then the start is refused if any unfinished run exists;
  - unfinished runs are never moved.
  
  This satisfies both literally: AC-41's scenario has only unfinished runs, so nothing moves. The alternative ("a refused start has no side effects at all") would fail AC-40's own scenario. **Confirm.**
- **I-2 AC-54.** A plain `--resume` of a PAUSED run is a status no-op (state untouched, exit 3, prints the `--approve` / `--reject` commands). It does not re-present the checkpoint, even on a TTY. Alternative: re-present on a TTY. **Recommend the no-op.**
- **I-3 AC-4 vs AC-61.** After AC-61 removes the exclusion, AC-4's [S] check ("tsconfig excludes them") is false by design. I replace the AC-4 test with "AC-4 AC-61 the four root scripts are gone and tsconfig no longer excludes them". **Confirm that AC-4 is superseded.**
- **I-4 What "the diff" is at CP3.**
  - It is `git diff <HEAD at run start>` plus untracked files, with `.factory/` excluded.
  - Pre-existing uncommitted changes appear in it.
  - Outside git it falls back to a hashed manifest of the builders' claimed files, labelled as not a git diff.
  - **Confirm**, or require a git work tree (escalate otherwise).
- **I-5 CP2 presents and hashes TECHNICAL_BRIEF.md plus FILE_LIST.md.** FILE_LIST binds the builders too. AC-43 names only the brief. **Recommend IN.**
- **I-6 (addition) Gate-failure invalidation.**
  - Stage 1, story, spec and Stage 4 gate failures invalidate the agent steps they judged, so a resume re-runs those agents.
  - Without it, those resumes re-fail forever.
  - Builders are never invalidated.
  - **Recommend IN.**
- **I-7 (addition) Approved-artifact integrity on resume.** If USER_STORY.md, TECHNICAL_BRIEF.md or FILE_LIST.md changed after its approval, the resume is refused (`APPROVED_ARTIFACT_CHANGED`). **Recommend IN.**
- **I-8 `--grant-attempts`.**
  - Integer 1..3 per resume.
  - Applies only to the builder and phase that exhausted (Stage 3, the validator round, or a rework).
  - Refused on any other run.
  - **Confirm the cap.**
- **I-9 The PAUSED exit code is 3.** 2 is left for a possible future usage-error code. **Confirm.**
- **I-10 CP3 rework details.**
  - Order follows the pipeline: rework builders → Gate 1 → Stage 3 gate → Gate 1.5 → Test Verifier → Gate 2 → Validator → Stage 4 gate → CP3. AC-75 lists the gates loosely.
  - Validator rounds are **not** reset, so a rework after 2 rounds gets no automatic round.
  - With no builder file in the diff, every builder that ran is re-invoked.
  - **Confirm.**
- **I-11 MINOR-8's schema rule changes an A-1 test.** "AC-21 a Validator that returns no VALIDATION_REPORT.md…" now escalates `SCHEMA_VALIDATION` (07) before the Stage 4 gate. AC-21's [U] stays in SG.
- **I-12 MINOR-11 refines AC-22's wording.** The in-run reference is "the run's first *passing* Gate 2 count", else the baseline. This is identical in A-1's flow and closes a 0-count reference after a resume. **Confirm.**
- **I-13 A one-time migration.** Pre-A-2 runs left ESCALATED in a project now block new runs until `--close <id>`. Directories without state.json are archived. Corrupt state.json refuses the start, naming the directory.
- **I-14 Pre-supplied specs must carry `content`** for USER_STORY.md, TECHNICAL_BRIEF.md and FILE_LIST.md (MINOR-8 generalised to every read-only agent's required documents).
- **I-15 `--yes` now also approves CP3.** It therefore reaches SUCCESS and writes `baseline.json` unattended. That is "unchanged" in the sense of "approve every checkpoint". **Confirm.**
- **I-16 The I-13 check uses a new operator script, `factory/runner/smoke-validator.ts`** (S-1), with S-2 as a second sample. Alternative: S-2 only, with no new file.
- **I-17 Scope.** 11 steps. The proposed cut line is step 11, moved to an A-2b PR.
- **I-18 Smaller choices for confirmation:**
  - CP3 name: "CHECKPOINT 3: Approve the validated change", stage 4.
  - A TTY rejection may have empty notes; `--reject` requires `--notes`.
  - An unrecognised approver return value means PAUSE.
  - `currentStage` stays 4 at SUCCESS; `--consolidate` moves it to 5.
  - `--feature` with `--resume` must match the saved description.
  - The builder `status` FAIL now consumes an attempt (MINOR-6).
- **I-19 Not covered here.** `factory/feature/docs/*.md` and `reference/*.md` may hold stale claims; only SKILL.md and README are drift-tested (out of scope). The README diagram stays out of scope.

**Builder rules for this run:**
- Work only in `/Users/enriqueibarra/cypher-claude-skills` on `feat/phase-a2-lifecycle`.
- No commit or push.
- Do not touch `~/.claude/**` or `docs/factory-runs/**` (read only).
- Delete the four root scripts only in step 10.


## 13. Operator resolutions (Checkpoint 2, 2026-10-04) — BINDING

The operator approved Checkpoint 2 and accepted every recommendation below. Where this section and §0–§12 differ, **this section wins**.

| Issue | Resolution |
|---|---|
| I-1 | Accepted. Starting a new run archives finished runs (SUCCESS, MANUAL_STOP, dirs without state.json) first, then refuses if any unfinished run exists; unfinished runs are never moved. |
| I-2 | Accepted. A plain `--resume` of a PAUSED run is a status no-op (state untouched, exit 3, prints the `--approve` / `--reject` commands). |
| I-3 | Accepted. AC-4 is superseded by AC-61; its test becomes "AC-4 AC-61 the four root scripts are gone and tsconfig no longer excludes them". |
| I-4 | Accepted. CP3 diff = `git diff <HEAD at run start>` + untracked files, `.factory/` excluded; outside git, a labelled hashed manifest of claimed files. Pre-existing uncommitted changes appear (documented). |
| I-5 | Accepted. CP2 presents and hashes TECHNICAL_BRIEF.md + FILE_LIST.md. |
| I-6 | Accepted. Stage 1, story, spec and Stage 4 gate failures invalidate the agent steps they judged; builders are never invalidated. |
| I-7 | Accepted. Resume refused with `APPROVED_ARTIFACT_CHANGED` if an approved USER_STORY.md / TECHNICAL_BRIEF.md / FILE_LIST.md changed after approval. |
| I-8 | Accepted. `--grant-attempts` integer 1..3, only for the builder and phase that exhausted; refused otherwise. |
| I-9 | Accepted. PAUSED exit code = 3. |
| I-10 | Accepted. CP3 rework order follows the pipeline; validator rounds are not reset; with no builder file in the diff, every builder that ran is re-invoked. |
| I-11 | Accepted. MINOR-8 schema rule: a Validator with no VALIDATION_REPORT.md escalates SCHEMA_VALIDATION before the Stage 4 gate. |
| I-12 | Accepted. In-run regression reference = the run's first *passing* Gate 2 count, else the baseline. |
| I-13 | Accepted. One-time migration: pre-A-2 ESCALATED runs block new runs until `--close <id>`; dirs without state.json are archived; corrupt state.json refuses the start, naming the directory. |
| I-14 | Accepted. Pre-supplied specs must carry `content` for USER_STORY.md, TECHNICAL_BRIEF.md and FILE_LIST.md. |
| I-15 | Accepted. `--yes` also approves CP3 (reaches SUCCESS and writes baseline.json unattended); intended for tests. |
| I-16 | Accepted. New operator script `factory/runner/smoke-validator.ts` (S-1) plus S-2 as a second sample. |
| I-17 | **Accepted with a change (partial cut):** step 11 stays in this PR for MINOR-4, 6, 7, 10 and NEW-MINOR-2, 3 (gate integrity / unsafe writes). **MINOR-1 and MINOR-3 are DEFERRED to the Phase B backlog**, not built in A-2. |
| I-18 | Accepted: CP3 name "CHECKPOINT 3: Approve the validated change" (stage 4); TTY rejection may have empty notes, `--reject` requires `--notes`; unrecognised approver value = PAUSE; `currentStage` stays 4 at SUCCESS, `--consolidate` moves it to 5; `--feature` with `--resume` must match the saved description; builder status FAIL consumes an attempt (MINOR-6). |
| I-19 | Accepted. Stale claims in `factory/feature/docs/*.md` and `reference/*.md` go to the backlog (not drift-tested in A-2). |

Process for this run (operator decisions): one fresh Backend Builder per §7 step; the session re-runs `npm test` and `npm run typecheck` between steps and records per-step wall-clock time; verification afterwards = Test Verifier and Validator in parallel, plus a scoped Validator follow-up on any test files the Test Verifier adds; S-1 smoke check after step 10, before CP3.

─────────────────────────────────────────────────────────────────
✅ CHECKPOINT 2 — BRIEF REVIEW — APPROVED (operator, 2026-10-04)
─────────────────────────────────────────────────────────────────
