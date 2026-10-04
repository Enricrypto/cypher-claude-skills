# A2_FILE_LIST.md: PR A-2

All paths are relative to `/Users/enriqueibarra/cypher-claude-skills`. The **Backend Builder handles every file**; the Frontend Builder is not needed. The step number is the brief's §7 step.

## CREATE

| Path | Why | ACs / items | Step |
|---|---|---|---|
| `factory/harness/run-lifecycle.ts` | `classifyRun`, `CheckpointId`, `parseCheckpointId`, `ResumeRequest`, `RunRefusedError`, `checkResumeRequest`, `exhaustedBuilder`, `used/allowedAttempts`, `nextStepHints` | AC-35, 41, 42, 53, 54, 71, 72, SEC | 1 |
| `factory/harness/run-progress.ts` | `rebuildOutputs`, `hasPass`, `isCheckpointApproved`, `activeRework`, `reworkAgentsForChange`, `pendingValidatorRound` | AC-34, 36, 39, 75 | 6 |
| `factory/harness/run-directory.ts` | `prepareNewRunDirectory` (archive/refuse), `findRun`, `closeRun`, `supersedeArtifacts`, `isSafeRunId` | AC-40, 41, 47, 73, 75, carry-over 2 | 3 |
| `factory/harness/checkpoint-presentation.ts` | `sha256Hex`, CP1/CP2/CP3 presentation text, `CheckpointPresentationError` | AC-43, 44, 50, 52 | 1 (hash), 4, 5 |
| `factory/harness/change-diff.ts` | `ChangeTracker`, `DEFAULT_CHANGE_TRACKER` (read-only git, claimed-files fallback) | AC-43, 45, 75 | 5 |
| `factory/harness/safe-write.ts` | `writeFileAtomic`, `writeFileNoFollow` | AC-65, NEW-MINOR-1 | 3 |
| `factory/feature/workflows/consolidate-run.ts` | `consolidateRun` for `--consolidate` | AC-28, 47, 48, 76 | 8 |
| `factory/runner/smoke-validator.ts` | Operator-only I-13 live check (not run by `npm test`) | I-13 | 10 |
| `factory/test/fixtures/changes.ts` | `fakeChangeTracker` | test support | 5 |
| `factory/test/harness/run-lifecycle.test.ts` | [U] classification, refusals, hints, ids | AC-41, 42, 53, 71, 72, SEC | 1 |
| `factory/test/harness/run-progress.test.ts` | [U] rebuild, skip, rework, pending round | AC-34, 36, 75 | 6 |
| `factory/test/harness/run-directory.test.ts` | [O]/[U] archive, refuse, close | AC-40, 41, 73 | 3 |
| `factory/test/harness/resume.test.ts` | [O] resume semantics | AC-34, 35, 36, 39, 71, 72, MINOR-11, TIMING | 2, 6 |
| `factory/test/harness/checkpoint-lifecycle.test.ts` | [O] checkpoints, pause, approve/reject, CP3, rework, baseline | AC-38, 43, 44, 46, 49-52, 54-57, 65, 74, 75, 78, MINOR-8 | 2, 4, 5, 7 |
| `factory/test/harness/checkpoint-presentation.test.ts` | [U] hashing and determinism | AC-50 | 1, 4 |
| `factory/test/harness/change-diff.test.ts` | [G] real git in temp repos; fallback | AC-43, 45 | 5 |
| `factory/test/harness/consolidate.test.ts` | [O] `--consolidate` | AC-28, 47, 48, 76 | 8 |
| `factory/test/harness/safe-write.test.ts` | [U] atomic and no-follow writes | NEW-MINOR-1 | 3 |

## MODIFY

| Path | Why | ACs / items | Step |
|---|---|---|---|
| `factory/feature/workflows/feature-factory-orchestrator.ts` | Stage functions; skip rule; `timedInvoke`; approval commit; `CheckpointDecision` / PAUSE / REJECT; CP3 + `CHECKPOINTS.CHANGE`; split Stage 2 gate; pre-supplied CP1/CP2; resume / apply / rework; attempts from state + grants; validator-round resume; baseline at SUCCESS; Consolidator and `knowledgeStored` removed; `changes` seam; MINOR-6/9/10 in the builder and validator loops | AC-34-39, 43, 44, 46, 48, 49, 51-57, 65, 71, 72, 74, 75, 78, MINOR-6, 9, 10 | 2, 4-7, 11 |
| `factory/harness/state-tracker.ts` | New optional fields and pure recorders; `PAUSED`; `isResumable`; timing | AC-35-38, 49, 72, 74, TIMING | 1 |
| `factory/harness/state-store.ts` | `saveStateIn` / `loadStateFrom` / `stateFilePathIn`; `writeFileAtomic`; rewrite the :76-79 comment | AC-47, 73 | 3 |
| `factory/harness/stage-context.ts` | Delete `clearStaleArtifacts`; remove `knowledgeStored`; loop max metadata; case-insensitive `.factory` check; reserved names; no-follow writes | AC-40, 48, 72, MINOR-4, NEW-MINOR-1, 2 | 3, 5, 6, 11 |
| `factory/harness/stage-gates.ts` | `STAGE2_STORY_CONTRACT` / `STAGE2_SPEC_CONTRACT`; Stage 5 contract (CRITICAL, both docs required, no Knowledge Stored); loop limits from max | AC-48, 56, 57, 72, 76, 78 | 4, 5, 6 |
| `factory/harness/regression-baseline.ts` | `baselineFromRun`, `writeRegressionBaseline`; first-passing-record reference | AC-65, MINOR-11 | 5, 6 |
| `factory/harness/agent-prompts.ts` | Rework briefings; `consolidatorPrompt` options; `retryBriefing` `maxAttempts`; `status` failure kind | AC-28, 47, 72, 75, MINOR-6 | 6, 7, 8 |
| `factory/harness/upstream-artifacts.ts` | Implement `readableRunDir` in `runDirectoryRules` | AC-28, 47 | 8 |
| `factory/harness/agent-output-schema.ts` | Required-document content rule for read-only agents; a directory is not materialised | MINOR-7, 8 | 7, 11 |
| `factory/harness/harness-documents.ts` | `writeFileNoFollow` | NEW-MINOR-1 | 3 |
| `factory/harness/validator-routing.ts` | `mergeBuilderOutput(…, cwd?)` | MINOR-5 | 7 |
| `factory/harness/execution-gates.ts` | *(cut line)* dev early-exit warning + group kill on exit; last summary wins | MINOR-1, 3 | 11 |
| `factory/contracts/feature-spec.ts` | Catch `UnsafeArtifactPathError` → blockers | NEW-MINOR-3 | 11 |
| `factory/runner/cli.ts` | `CliCommand` `parseArgs` (modes, unknown-flag rejection); `CLI_FLAGS`; `EXIT_CODES`; `exitCodeFor`; dispatch to run/resume/close/consolidate; hints; TTY / no-TTY / `--yes` decisions; `printableForTerminal`; `changes` dependency | AC-37, 41, 42, 46, 47, 49, 51-54, 63, 71-75, 77, 79, SEC | 9 |
| `factory/feature/SKILL.md` | CP3 and claims [1,2,3] (step 5); full A-2 rewrite: flags, resume, lifecycle, archive, Stage 2 split, Stage 5, baseline, exit codes, `cliFlags` / `exitCodes` claims (step 10) | AC-59, 60, 79 | 5, 10 |
| `factory/feature/agents/05-frontend-builder.md` | Remove the "Loop back to Backend Builder" claims (:55-58, :77-82); point at BACKEND_SUMMARY / API_CONTRACT; ESCALATE on API mismatch | carry-over 1 | 10 |
| `factory/feature/agents/08-feature-consolidator.md` | Read only the directory the prompt names (may be under `_archive`); timings from `state.json` `agentInvocations`; runs via `--consolidate` | AC-47, TIMING | 8 |
| `README.md` | Remove "152 tests" (:56, :134) | carry-over 3 | 10 |
| `tsconfig.json` | Remove the four root-script exclusions (:30-36) | AC-61 | 10 |
| `factory/test/fixtures/harness-run.ts` | `changes` default; `killAt`, `restoreSnapshot`, `decisions`, `seedRun` | test support | 2-6 |
| `factory/test/fixtures/gates.ts` | Re-export or compose with `changes` if needed | test support | 5 |
| `factory/test/harness/checkpoints.test.ts` | AC-43 full text; workspace tests become archive/close | AC-40, 43 | 3, 4 |
| `factory/test/harness/orchestrator-gates.test.ts` | Drop 08 expectations; AC-21 (I-11); AC-65 / AC-66 updates; MINOR-6, 10; NEW-MINOR-3 | AC-21, 65, 66, backlog | 5, 7, 11 |
| `factory/test/harness/validator-loop-back.test.ts` | Drop 08 from the sequences; MINOR-5, 9 | MINOR-5, 9 | 5, 7 |
| `factory/test/harness/upstream-artifacts.test.ts` | Move the 08 cases to `consolidateRun`; invert the options-bag test | AC-24, 28 | 5, 8 |
| `factory/test/harness/stage-gates.test.ts` | Split Stage 2; Stage 5; loop max | AC-48, 56, 72, 76, 78 | 4-6 |
| `factory/test/harness/stage-context.test.ts` | MINOR-4, NEW-MINOR-1, 2 | backlog | 3, 11 |
| `factory/test/harness/agent-output-schema.test.ts` | MINOR-7, 8 | backlog | 7, 11 |
| `factory/test/harness/regression-baseline.test.ts` | Writer; MINOR-11 | AC-65, MINOR-11 | 5, 6 |
| `factory/test/harness/harness-documents.test.ts` | NEW-MINOR-1 | backlog | 3 |
| `factory/test/harness/execution-gates.test.ts` | *(cut line)* MINOR-1, 3 | backlog | 11 |
| `factory/test/harness/state-tracker.test.ts` | `isResumable` cases; new recorders | AC-35, 49, 72 | 1 |
| `factory/test/contracts/feature-spec.test.ts` | NEW-MINOR-3 | backlog | 11 |
| `factory/test/runner/cli.test.ts` | Updated AC-63; all [C] criteria; SEC | AC-35, 37, 41-47, 49, 51-54, 63, 71-75, 77 | 5, 9 |
| `factory/test/contracts/doc-drift.test.ts` | CP3; AC-79; new retired claims; README count | AC-59, 60, 79 | 5, 10 |
| `factory/test/contracts/repo-hygiene.test.ts` | AC-4/AC-61 replacement; AC-45; AC-48 [S]; AC-77 [S]; contract 05 | AC-45, 48, 61, 77 | 5, 9, 10 |
| `factory/test/harness/state-persistence.test.ts` | Verify unchanged; adjust only if the pinned-resume path needs it | — | 6 |

## DELETE

| Path | Why | ACs | Step |
|---|---|---|---|
| `run-cpf-factory.ts` (untracked) | Replaced by pause/approve/resume | AC-61 | 10 |
| `run-frontend-only.ts` (untracked) | Replaced by real resume | AC-61 | 10 |
| `probe-cwd.ts` (untracked) | One-off SDK probe | AC-61 | 10 |
| `probe-cwd.mjs` (untracked) | One-off SDK probe | AC-61 | 10 |

Removed but not deleted as files:
- `clearStaleArtifacts` (stage-context.ts:197-210);
- `validateKnowledgeStored` and the "Knowledge Stored" criterion (stage-gates.ts:303-308, :803-814);
- the inline Stage 5 block (orch:1217-1256).

─────────────────────────────────────────────────────────────────
