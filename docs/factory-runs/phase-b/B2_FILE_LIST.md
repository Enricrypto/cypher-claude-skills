# B2_FILE_LIST.md: Phase B, PR B-2

All paths are relative to `/Users/enriqueibarra/cypher-claude-skills`. The Backend Builder handles every file except those marked **session**. The Frontend Builder is not needed. "Step" is the brief's §7 step.

## CREATE

| Path | Purpose | Step |
|---|---|---|
| `factory/feature/agents/07b-validator-followup.md` | Contract: read-only follow-up review of exactly the files the Test Verifier changed; returns `VALIDATION_FOLLOWUP.md` and `filesReviewed` | 1 |
| `factory/feature/agents/07c-validator-skeptic.md` | Contract: read-only skeptic for one CRITICAL issue; default UPHELD; DISPROVED needs file:line evidence; echoes the issue key; returns `SKEPTIC_REVIEW.md` | 1 |
| `factory/harness/test-paths.ts` | The single "test path" rule (N-3): `TEST_DIRECTORY_NAMES`, `isTestPath`, `splitByTestPath` | 3 |
| `factory/harness/review-copy.ts` | Review directory creation, the AC-126 fallback copy, the fallback comparison, `sealReadOnly`, `copyIntact`, `mapReviewPath`, `insideReviewCopies` (fs only, no git) | 3 |
| `factory/harness/verification.ts` | Pure: `issueKey`, `mergeIssues`, `verdictOf`, `disprovedFinding`, `legacyVerdict`, `currentReworkCycle` | 4 |
| `factory/test/harness/review-copy.test.ts` | [U] AC-121 (isTestPath), AC-126/N-1 (fallback copy, symlinks, exclusions), path mapping | 3 |
| `factory/test/harness/verification-logic.test.ts` | [U] AC-129, AC-133 (write-once recorders), merge and verdict | 4 |
| `factory/test/harness/verification.test.ts` | [O] AC-116 to AC-126, AC-157 (fake tracker) | 6, 7 |
| `factory/test/harness/skeptics.test.ts` | [O] AC-128 to AC-134 | 7 |
| `docs/factory-runs/phase-b/B2_MEASUREMENTS.md` | **session**: S-0 probes and suite-time baseline, S-1 live smoke, S-2 final figures | S-0, S-1, S-2 |

## MODIFY

| Path | Purpose | Step |
|---|---|---|
| `factory/runner/agent-registry.ts` | `FeatureFactoryAgent` + 07b/07c; `AGENT_STAGE`, `AGENT_TOOLS` (read-only, as 07), `AGENT_COST`, `REQUIRED_ARTIFACTS`; `REVIEW_DOCUMENTS` | 1 |
| `factory/runner/output-schemas.ts` | `DETAILS_BY_AGENT` for 07b (filesReviewed, issues) and 07c (issueKey, verdict, reason, evidence) | 1 |
| `factory/harness/agent-output-schema.ts` | `ValidatorFollowupOutput`, `SkepticOutput`; `validateOutputSchema` cases for 07b and 07c | 1 |
| `factory/harness/upstream-artifacts.ts` | 07 → `AFTER_BUILD` (no `TEST_REPORT.md`); 07b → `AFTER_TESTS`; 07c → story and brief | 1 |
| `factory/harness/stage-context.ts` | `HARNESS_PERSISTED_AGENTS` + 07b/07c; `StageOutputs` + `validatorFollowup`, `skeptic`; `harness.validation` → `validationVerdict`; `criticalIssuesCount` removed | 1, 4 |
| `factory/harness/run-progress.ts` | `OUTPUT_SLOT` + 07b | 1 |
| `factory/feature/agents/06-test-verifier.md` | Write test files only; the test-path definition; a change outside a test path escalates | 1 |
| `factory/feature/agents/07-validator.md` | Review the read-only copy named in the prompt; do not run tests; no test report | 1 |
| `factory/feature/SKILL.md` | Step 1: claims block agents, "A 10-agent chain", table rows 07b/07c. Step 8: everything else in D-18 (version PR B-2, diagram, "Verification in Stage 4", resume semantics, git subcommands, invocation recording, artifacts, prompt table, Stage 4 evidence, CP3, replaced "Known limit" text) | 1, 8 |
| `factory/harness/change-diff.ts` | `GIT_EXTRACTION_SUBCOMMANDS`; `git()` raw output + stdin input; shared `workingTree()`; `extractSnapshot`; `changedSince`; `ChangeTracker`; header comment | 2 |
| `factory/feature/workflows/feature-factory-orchestrator.ts` | Step 2: the `changes` object. Step 4: interim `validation` passed to the Stage 4 gate. Step 6: `verification()` (evaluations, copy, parallel branches, throw recording, settle-then-decide, measurement, Gate 2 after, rounds, Gate 1 copy guard, `finish` closes evaluations, `reviewRoot`). Step 7: follow-up, merge, skeptics, verdict, findings, CP3 `followup`, SUPERSEDED/INVALIDATED maps | 2, 4, 6, 7 |
| `factory/harness/state-tracker.ts` | Evaluation types and write-once recorders; invocation fields; `REVIEW_COPY_FAILED`; `stage3SnapshotPassedBy` evaluation clause; `VERIFYING_AGENTS` + 07b/07c | 4 |
| `factory/harness/stage-gates.ts` | `Stage4Metadata.validationVerdict` replaces `criticalIssuesCount`; "Validation Passed" reads the typed verdict, fails closed when absent | 4 |
| `factory/runner/invoke-agent.ts` | `AgentInvocation.cwd?`; the SDK `cwd: call.cwd ?? config.cwd` | 5 |
| `factory/harness/agent-prompts.ts` | Step 5: `followupPrompt`, `skepticPrompt`, DESCRIPTION entries. Step 6: `validatorPrompt(ctx, review)` | 5, 6 |
| `factory/runner/smoke-validator.ts` | Review copy + per-call `cwd` + new `validatorPrompt` signature; criterion P6 (operator-only, imported by nothing) | 6 |
| `factory/harness/checkpoint-presentation.ts` | `ChangePresentationInput.followup`; `CP3_FOLLOWUP_DOCUMENT`; follow-up as a labelled part; header comment | 7 |
| `README.md` | "with eight specialist agents, plus a follow-up reviewer and a skeptic in Stage 4" | 8 |
| `docs/ROADMAP.md` | B-2 bullet (:57-62): the entry condition closed by AC-157 | 8 |
| `factory/test/fixtures/agent-outputs.ts` | `followup()` and `skeptic()` builders (setup) | 1 |
| `factory/test/fixtures/harness-run.ts` | `passingScript` + 07b (PASS) and 07c (UPHELD); `runToEnd` default `reviewRoot`; `tempProject` cleanup of `<dir>-review` (setup) | 1, 6 |
| `factory/test/fixtures/changes.ts` | Fake `extractSnapshot` and `changedSince`; separate `reviewCalls` log (setup) | 2 |
| `factory/test/contracts/repo-hygiene.test.ts` | Step 2: AC-80 three arrays (c, I-23). Step 5: cwd guard. Step 6: AC-119; `reviewRoot` guard | 2, 5, 6 |
| `factory/test/contracts/doc-drift.test.ts` | Step 1: remove the `"10-agent"` row (c, I-20). Step 8: AC-115 version to PR B-2 (c, I-21); new AC-127 test | 1, 8 |
| `factory/test/runner/output-schemas.test.ts` | Exempt `REVIEW_DOCUMENTS` (c, I-22) | 1 |
| `factory/test/runner/agent-registry.test.ts` | AC-132 test | 1 |
| `factory/test/harness/agent-output-schema.test.ts` | 07b/07c schema cases | 1 |
| `factory/test/harness/upstream-artifacts.test.ts` | Step 1: :300 (c). Step 7: :201 (c), 07b/07c lists | 1, 7 |
| `factory/test/harness/change-diff.test.ts` | AC-117 extraction cases; AC-121 `changedSince` (real git) | 2 |
| `factory/test/harness/stage-gates.test.ts` | `cleanStage4` key (setup); AC-131 [U] | 4 |
| `factory/test/harness/snapshot.test.ts` | Step 4: AC-157 [U] row. Step 6: :704-747 kill point moved (c, I-23); AC-117 and AC-157 real-git [O] | 4, 6 |
| `factory/test/harness/agent-prompts.test.ts` | AC-120 and AC-128 prompt tests | 5, 6 |
| `factory/test/harness/orchestrator-gates.test.ts` | :82, :100, :358, :586 (c, I-23) | 6 |
| `factory/test/harness/validator-loop-back.test.ts` | Step 6: :252-258, :296-302 interim (c). Step 7: final (c) | 6, 7 |
| `factory/test/harness/resume.test.ts` | D-13 timing :107, :120 (c, I-23) | 6 |
| `factory/test/harness/checkpoint-presentation.test.ts` | AC-122 [U] | 7 |
| `factory/test/harness/direction-documents.test.ts` | AC-127/AC-107 cases for `VALIDATION_FOLLOWUP.md` and a skeptic document | 7 |
| `factory/test/harness/checkpoints.test.ts` | Pass `reviewRoot` where the run reaches Stage 4 (setup) | 6 |
| `factory/test/harness/state-persistence.test.ts` | Same (setup) | 6 |
| `factory/test/harness/run-directory.test.ts` | Same (setup) | 6 |
| `factory/test/contracts/feature-spec.test.ts` | Same (setup) | 6 |

## MOVE

None.

## DELETE

None. (`criticalIssuesCount` is removed as code, not as a file.)

