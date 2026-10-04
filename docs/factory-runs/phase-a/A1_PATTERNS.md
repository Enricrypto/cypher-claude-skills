# PATTERNS.md — from Phase A, PR A-1

> Agent 08 (Feature Consolidator), 2026-10-04. Saved by the orchestrating session from the Consolidator's hand-back. Evidence references point to files in `docs/factory-runs/phase-a/` and the merged `factory/` code.

## Process patterns (how to run the factory)

| # | Pattern | Evidence (this run) | Apply when | Don't when |
|---|---|---|---|---|
| P-1 | Verify the riskiest research finding **live** before writing the story | RESEARCHER_REPORT §9: stdout 52 B vs stderr 43,098 B → AC-8 written against a known fact | A finding depends on external tool/runtime behaviour (test runner output, SDK schema, OS binaries) | Reading the code settles it |
| P-2 | Story Writer lists conflicts/open questions; operator answers become numbered requirements | USER_STORY "Resolved decisions" C-1..C-9, OQ-1..OQ-9; 2 revisions, then 0 failed build steps | Semantics with no precedent (pause/reject/close/resume) | Mechanical changes — don't manufacture questions |
| P-3 | Split the phase into PRs at CP1; the first PR leaves extension points | USER_STORY header; brief §10 hooks (`runDirectoryRules({readableRunDir})`, `RegressionBaseline`, `CheckpointRequest`, `runCli`) | Independent groups where one is a prerequisite for trusting the others | Groups share a data model that would be designed twice |
| P-4 | Brief maps every AC → test file → exact test title starting with the AC ID | A1_TECHNICAL_BRIEF §5; used directly by Test Verifier and Validator | Always (at minimum AC IDs in test titles) | Never skip |
| P-5 | Spec Writer pushes back on ACs that can't be met as written; resolutions in a binding section that wins over the rest | Brief §12 I-1, I-2, I-4 → §13 | Always | — |
| P-6 | One fresh builder per brief step + independent session re-verification between steps | 8 steps, typecheck + jest re-run after each, 0 failed gates | Ordered dependent steps, many files (19 CREATE / 32 MODIFY) | Small changes that fit one context |
| P-7 | Prove tests by mutation at builder steps and again at the Test Verifier; checksum implementation before/after | A1_TEST_VERIFIER_REPORT: AC-14 gap found; 81 files checksum-identical | Tests guarding a gate whose failure mode is "pass vacuously" | Mutations that only break compilation prove nothing |
| P-8 | Code-reading Validator that threat-models the harness, then a scoped re-check after the fix round | IMPORTANT-1, IMPORTANT-3 invisible to green suite and mutations; A1_VALIDATION_RECHECK | Changes touching file writes, child processes, trust boundaries | Never skip the re-check |
| P-9 | The session checks reviewer findings against the code before acting | NEW-MINOR-4 false alarm (test at `upstream-artifacts.test.ts:228`) | Always | — |
| P-10 | The session writes every run document to disk; subagents only hand back | Every record carries "Saved by the orchestrating session" | Always in by-hand mode; store memories from the session | — |
| P-11 | Merge the infrastructure PR before the feature PR | PR #2 then PR #3 (option A) | Feature branch depends on harness/CI changes still under review | — |

## Code patterns (harness and gate design)

| # | Pattern | Evidence | Notes |
|---|---|---|---|
| C-1 | Inject side-effecting dependencies; keep decision logic real | D-1 `gates?: Partial<OrchestrationGates>` + `DEFAULT_GATES` (only audits injected; `validate*Gate` real); D-2 `runCli(argv, deps)` | For process/network/TTY paths; mirrors the `invoke` seam |
| C-2 | Every criterion fails closed when its input is missing | AC-9 `parseTestOutput` → `null` → "no tests detected"; AC-18 `total === 0` fails; D-6 undefined security blocks; D-4 throwing criterion blocks | Always. `|| 0` / `0 < 0` were the root bug |
| C-3 | Gates trust only harness measurements, never agent self-reports | D-5/D-12: Gate 2 records + `.factory/baseline.json`; Validator `details.regressions` ignored (AC-22) | For judgement values (CRITICAL issues) take the report but cross-check (C-4) |
| C-4 | Cross-check counts between two producers | AC-18: Test Verifier `totalAC` must equal the story's AC count | When one agent counts over another's artifact |
| C-5 | Harness-written documents are labelled, allow-listed, never evidence for the gate judging agents | D-7 `HARNESS_RENDERED_ARTIFACTS`; claims inside `.factory/` → `HALLUCINATION_DETECTED` (orchestrator :558, :580) | When the harness renders summaries for agents |
| C-6 | Persist agent artifacts under the declared name in the run dir; ignore the agent-supplied path; validate all before writing | `join(artifactDir, plainArtifactName(name))` (stage-context :258, :282) + containment check | Watch: symlinks (NEW-MINOR-1), reserved names (NEW-MINOR-2) |
| C-7 | Child processes: spawn detached, kill the group, Node timeout, track live pids, clean up on signal/exit | D-3 `runShellCommand`; IMPORTANT-3 fix (`cleanupInstalled`, execution-gates :182-196); AC-13 test shows shell-only kill leaves the grandchild | POSIX only (I-14) |
| C-8 | Parse combined stdout+stderr, order-independently, across runners | D-3, AC-8/9 (Jest, Vitest, Mocha) | `--json` rejected: `test` script is project-defined |
| C-9 | Machine-readable claims block in docs + drift test against exported constants | D-10 `factory-claims` vs `AGENT_STAGE`, `CHECKPOINTS`, `LOOP_BACK_RULES`; banned-claim regexes | When prose docs make behavioural claims |
| C-10 | Source-scanning guard tests for structural rules | `repo-hygiene.test.ts` (AC-13, 15, 58, 69); needle built by concatenation (I-1) | Only catches literal copies |
| C-11 | Typed metadata keys so a wrong key fails to compile | D-5 `Stage4Metadata`; AC-62 replaced the vacuous `acTestedCount` test | When a gate reads a loose metadata bag |
| C-12 | Only CRITICAL blocks; IMPORTANT becomes a persisted finding | D-4/I-3 removed `requireAll`; `state.importantFindings` | When IMPORTANT checks would otherwise block |
| C-13 | Bounded loops with their own counters, committed before each invocation | D-9/AC-70: validator rounds (2) separate from Stage 3 attempts (3) | Watch IMPORTANT-4: when merging partial re-runs, keep earlier evidence the new round doesn't replace |

## Anti-patterns observed

1. Defaults that pass: `0 < 0` → "All 0 acceptance criteria tested" (A1). → C-2
2. Evidence that never reaches the gate: `outputs.test` / `outputs.validator` never assigned (A1).
3. Fabricated evidence: hard-coded `knowledgeStored: true` (still present; A-2 AC-48).
4. Fail-open gates: `catch → WARN → continue` (A6).
5. Tests that never import the code: the 404-line `orchestrator.test.ts` (deleted, AC-3).
6. Agent self-report used as a measurement: `validator.details.regressions` (A8).
7. Comparing different populations: builders' `testsPassed` vs Test Verifier count (A8).
8. A shared helper that writes wherever it's told: `checkStageGate` → `persistArtifacts` without `artifactDir`; absolute agent paths honoured (IMPORTANT-1).
9. Relying on OS binaries: GNU `timeout` missing on macOS → vacuous dev check.
10. ACs that match their own run records: AC-26 (I-1) — exclude `docs/factory-runs/` from repo-wide scans.
11. Docs claiming behaviour with no code: "100% certainty", CP3, branch cleanup, memory logging. → C-9
12. Parallel Test Verifier + Validator without a cross-read: run them in sequence when the Test Verifier is expected to add tests, or have the re-check cover the added tests.
