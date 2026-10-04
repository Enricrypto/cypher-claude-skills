# FILE_LIST.md — PR A-1

All paths are relative to `/Users/enriqueibarra/cypher-claude-skills`. Builder: **Backend Builder for every file**; the Frontend Builder is not needed.

## CREATE

| Path | Why | ACs |
|---|---|---|
| `factory/harness/regression-baseline.ts` | Baseline type, path and reader; `regressionReference()` | AC-22, AC-65 (read), AC-66 |
| `factory/harness/security-checks.ts` | `evaluateSecurityChecks()` tri-state logic | AC-67, AC-68 |
| `factory/harness/upstream-artifacts.ts` | `UPSTREAM_FOR_AGENT`, `existingUpstreamArtifacts()`, `ARCHIVE_RULE`, `runDirectoryRules()` | AC-24, AC-28 |
| `factory/harness/agent-prompts.ts` | All agent prompt builders; `retryBriefing` / `BuilderFailure` moved here, plus the `validator` kind | AC-24, AC-28, AC-29 |
| `factory/harness/harness-documents.ts` | Renderers and writer for BACKEND_SUMMARY, API_CONTRACT, FRONTEND_SUMMARY, TEST_REPORT | AC-21, AC-25 |
| `factory/harness/frontend-files.ts` | Single `isFrontendPath()` / `specRequiresFrontend()` | AC-69 |
| `factory/harness/validator-routing.ts` | `criticalIssues`, `routeCriticalIssues`, `mergeBuilderOutput` | AC-29, AC-30, AC-31, AC-69 |
| `factory/harness/loop-rules.ts` | `MAX_BUILDER_ATTEMPTS`, `MAX_VALIDATOR_ROUNDS`, `LOOP_BACK_RULES` | AC-32, AC-59, AC-70 |
| `factory/test/fixtures/agent-outputs.ts` | Shared agent output fixtures | AC-2 |
| `factory/test/fixtures/gates.ts` | Audit fixtures and recording or throwing gate fakes | AC-1, AC-2 |
| `factory/test/fixtures/harness-run.ts` | Temp project, scripted invoker, `runToEnd` helper | AC-2 |
| `factory/test/harness/orchestrator-gates.test.ts` | [O] Gate 1.5/2 and Stage 4 behaviour | AC-1, 5, 6, 7, 16, 18, 19, 20, 21, 22, 23, 65, 66, 67 |
| `factory/test/harness/validator-loop-back.test.ts` | [O]+[U] loop-back, routing, bounds | AC-22, 29, 30, 31, 32, 33, 69, 70 |
| `factory/test/harness/upstream-artifacts.test.ts` | [O] prompt paths, harness docs, archive rule | AC-24, 25, 28 |
| `factory/test/harness/execution-gates.test.ts` | [G]+[U] parser, timeouts, skip and fail rules | AC-8, 9, 10, 11, 12, 13, 14, 64 |
| `factory/test/harness/security-checks.test.ts` | [U] tri-state | AC-67, 68 |
| `factory/test/runner/cli.test.ts` | [C]+[S] injectable CLI | AC-63 |
| `factory/test/contracts/repo-hygiene.test.ts` | [S] source and contract scans | AC-1, 2, 3, 4, 13, 15, 26, 27, 58, 69 |
| `factory/test/contracts/doc-drift.test.ts` | [S] SKILL.md versus code | AC-59, 60 |

## MODIFY

| Path | Why | ACs |
|---|---|---|
| `factory/feature/workflows/feature-factory-orchestrator.ts` | Gate seam; fail-closed catches; TV/Validator verdicts; outputs wiring; persistence; Gate 2 history; reference; `runBuilderLoop`; validator rounds; prompts via helpers; `CHECKPOINTS`; re-export of loop rules; dead code removal; `currentStage` 4 | AC-1, 5, 6, 7, 16, 17, 19–25, 28–33, 58, 59, 69, 70 |
| `factory/harness/stage-gates.ts` | Remove `requireAll`; `importantFindings` / `missingArtifacts`; required-artifact check; `Stage4Metadata`; new AC, regression and security criteria; Stage 3 artifact lists | AC-17, 18, 21, 22, 62, 66, 67 |
| `factory/harness/stage-context.ts` | `artifactDir` + `harness` inputs; read run-dir docs; Stage 4 metadata split; `normalisePath`, `claimedFilesFromBuilders` exported; stop reading `details.regressions` | AC-18, 21, 22, 25, 67, 68 |
| `factory/harness/execution-gates.ts` | Full rewrite per D-3 | AC-8–15, 64 |
| `factory/harness/infrastructure-gates.ts` | Export `parseJsonc` | AC-4 |
| `factory/harness/agent-output-schema.ts` | `validateOutputSchema` guard; tri-state security types; `securitySurface`; `ValidatorIssue` | AC-16, 67, 68 |
| `factory/harness/state-tracker.ts` | New optional state fields and pure recorders; `phase` / `round` on steps and loop-backs | AC-17, 22, 70 |
| `factory/runner/cli.ts` | `CliDependencies`, `realCliDependencies`, `runCli`; main delegates | AC-63 |
| `factory/runner/invoke-agent.ts` | Remove `maxAttempts` from `AgentInvocation` | AC-58 |
| `factory/runner/agent-registry.ts` | `REQUIRED_ARTIFACTS['07-validator'] = ['VALIDATION_REPORT.md']` | AC-21 |
| `factory/runner/output-schemas.ts` | Validator tri-state + `notApplicableReasons`; Spec Writer `securitySurface` (required) | AC-67, 68 |
| `factory/contracts/feature-spec.ts` | Optional `artifactDir` for `acceptFeatureSpec` (supporting, I-11) | AC-24 |
| `factory/feature/agents/01-researcher.md` | Fix skill path; remove memory tool calls | AC-26, 27 |
| `factory/feature/agents/02-story-writer.md` | Remove memory tool calls | AC-27 |
| `factory/feature/agents/03-spec-writer.md` | Fix skill path; remove memory calls; require "Security surface" section and `securitySurface` field | AC-26, 27, 67, 68 |
| `factory/feature/agents/04-backend-builder.md` | Fix skill path; remove memory calls | AC-26, 27 |
| `factory/feature/agents/05-frontend-builder.md` | Fix skill path; remove memory calls | AC-26, 27 |
| `factory/feature/agents/06-test-verifier.md` | Fix skill path; remove memory calls; read upstream paths from the prompt; don't write TEST_REPORT.md | AC-24, 26, 27 |
| `factory/feature/agents/07-validator.md` | Fix skill path; remove memory calls; tri-state security + reasons; return VALIDATION_REPORT.md; read harness summaries | AC-21, 24, 26, 27, 67 |
| `factory/feature/agents/08-feature-consolidator.md` | Remove memory calls; inputs = run-dir artifacts named in the prompt | AC-24, 27 |
| `factory/feature/SKILL.md` | Truthful rewrite: 8-agent chain, CP1/CP2 only, real gate rules, Phase A escalation statements, claims JSON block; retired claims removed | AC-59, 60 |
| `README.md` | Line 915: correct skill path and agent count | AC-26 |
| `docs/HARNESS_GAP_ANALYSIS.md` | Line 85: describe the wrong path without the literal segment | AC-26 |
| `tsconfig.json` | Exclude the 4 untracked root files | AC-4 |
| `factory/test/harness/stage-gates.test.ts` | Rewrite :211-238 with `Stage4Metadata`; add AC-17/18/21 cases | AC-17, 18, 21, 62 |
| `factory/test/harness/agent-output-schema.test.ts` | Add no-`details` case | AC-16 |
| `factory/test/runner/output-schemas.test.ts` | Include required lists and harness-rendered docs; tri-state and `securitySurface` schema assertions | AC-21, 67 |
| `factory/test/harness/checkpoints.test.ts` | Use shared fixtures | AC-2 |
| `factory/test/harness/retry-briefing.test.ts` | Use shared fixtures | AC-2 |
| `factory/test/harness/state-persistence.test.ts` | Use shared fixtures | AC-2 |
| `factory/test/contracts/feature-spec.test.ts` | Use shared fixtures | AC-2 |

## DELETE

| Path | Why | ACs |
|---|---|---|
| `factory/test/orchestrator.test.ts` | 404 lines that never import the orchestrator and assert on literals they built themselves; replaced by OG/VL/UA | AC-3 |

## Do not touch in A-1

- `run-cpf-factory.ts`, `run-frontend-only.ts`, `probe-cwd.ts`, `probe-cwd.mjs`: deletion is AC-61 (A-2); A-1 only excludes them from typecheck.
- `docs/factory-runs/**`: run records.
- `factory/harness/state-store.ts` (comment :76-79) and the `clearStaleArtifacts` semantics: A-2.
- `factory/e2e/**`.
- `~/.claude/agents/**`: OQ-7.
