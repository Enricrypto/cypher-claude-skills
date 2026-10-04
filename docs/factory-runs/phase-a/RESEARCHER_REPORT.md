# Researcher Report — Phase A: "make the orchestrator do what it claims"

> Feature Factory run, by-hand mode. Agent 01 (Researcher), 2026-10-04. Read-only research of
> `/Users/enriqueibarra/cypher-claude-skills`. Saved verbatim by the orchestrating session, with one
> addendum (§9) recording a live verification run afterwards.

Skills loaded: `factory/feature/SKILL.md` ✓ · `~/.claude/skills/software/architecture-patterns.md` ✓ · `~/.claude/skills/software/feature-factory/SKILL.md` exists (first lines identical to the repo SKILL.md — consistent with a symlink) · `~/.claude/skills/software/factory/feature/SKILL.md` → Read error `File does not exist.` (confirms A9).

Memory: no `mcp__memorykit__*` tools were available to the subagent; no `retrieve_context` / `store_memory` was performed by it.

---

## 1. Relevant files

| Path | Role | Touched by |
|---|---|---|
| `factory/feature/workflows/feature-factory-orchestrator.ts` | The 5-stage flow, checkpoints, builder loops, gates | A1–A8, A10, A11 |
| `factory/harness/stage-context.ts` | `buildStageContext`, `persistArtifacts`, `clearStaleArtifacts`, `HARNESS_PERSISTED_AGENTS` | A1, A3, A7 |
| `factory/harness/stage-gates.ts` | Stage contracts + criterion validators (`validateAcceptanceTestsComplete` :577-589) | A1, A8 |
| `factory/harness/state-tracker.ts` | Pure `FeatureState` transitions; `isResumable` :375-377; `completeFeature` :274-292 | A2, A10 |
| `factory/harness/state-store.ts` | Durable `saveState`/`loadState`; comment :76-79 says reaping state is "intended" | A2, A3, A10 |
| `factory/harness/execution-gates.ts` | Runs `npm run build/test/dev` via execSync | A6, A8, other bugs |
| `factory/harness/infrastructure-gates.ts` | npm scripts / tsconfig / migrations / directory checks | A6 |
| `factory/harness/agent-output-schema.ts` | Output types, `validateOutputSchema`, `verifyArtifactMaterialization` | A1, A5 |
| `factory/runner/cli.ts` | Arg parsing, TTY approver, `--resume` | A2, A4, A10 |
| `factory/runner/invoke-agent.ts` | SDK invoker; `outputContract()`; `settingSources: []` | A7 |
| `factory/runner/agent-registry.ts` | `AGENT_STAGE`, `AGENT_TOOLS`, `AGENT_COST`, `REQUIRED_ARTIFACTS` (validator: `[]`) | A1, A7, A12 |
| `factory/runner/output-schemas.ts` | Per-agent JSON schemas sent to the SDK | A1, A7 |
| `factory/contracts/feature-spec.ts` | Pre-supplied spec path; `persistArtifacts(outputs, cwd)` :120 with no artifactDir | other bugs |
| `factory/feature/agents/01..08-*.md` | Agent contracts loaded verbatim as system prompts (09/10 exist but are not in the registry) | A9, A12 |
| `~/.claude/agents/01..08-*.md` | Second copy, used by in-session subagents | A9 |
| `factory/feature/SKILL.md` | The claims document | A12 |
| `docs/HARNESS_GAP_ANALYSIS.md` | GAP-1 = A9 (its line numbers are stale), GAP-7 = fake test | A9, A12 |
| `README.md:915` | Also has a wrong skill path (`.claude/skills/factory/feature/SKILL.md`) and says "7 agents" | A9, A12 |
| `factory/test/orchestrator.test.ts` | 404 lines that never import the orchestrator — asserts on self-built literals | rewrite |
| `factory/test/harness/checkpoints.test.ts`, `state-persistence.test.ts`, `retry-briefing.test.ts`, `factory/test/contracts/feature-spec.test.ts` | The real `runFeatureFactory` tests, scripted invoker | pattern to copy |
| `factory/test/harness/stage-gates.test.ts:225-238` | Stage 4 "PASS" test with wrong metadata keys (`acTestedCount`, `validationCriticalCount`) — passes only because everything defaults to 0 | breaks under A1 |
| `factory/test/harness/no-cwd-in-gates.test.ts` | Source-scanning guard test | pattern for A12 |
| Untracked: `run-cpf-factory.ts` | Runs the CPF feature with a file-based checkpoint approver (writes `CHECKPOINT_*.md`, polls `DECISION_*`), passes `resumeFromState` from `CPF_RESUME` | precursor to A10 |
| Untracked: `run-frontend-only.ts` | Invokes `05-frontend-builder` directly against `/private/tmp/cpf-clone` with a hand-written prompt; docblock: skips "re-running of four already-passed stages" → **workaround for A2**. Also records a sandbox escape (worktree run wrote 40 files into the shared repo) and `maxTurns: 200` | evidence A2, GAP-5 |
| Untracked: `probe-cwd.ts`, `probe-cwd.mjs` | One-off SDK probes (Bash `pwd` with `cwd: /private/tmp/cpf-factory`) | risk, see §5 |

Git history shows the same bug class fixed repeatedly: gate judging fabricated evidence, dead import, prose claim with no code behind it.

---

## 2. Verified findings

| # | Verdict | Evidence | Code that changes | Existing tests | Risks |
|---|---|---|---|---|---|
| **A1** | **CONFIRMED — wider than claimed** | `testOutput` (orch:911) and `validatorOutput` (:985) never assigned to `outputs.test`/`outputs.validator`; `buildStageContext` only fills AC/critical/security metadata `if (outputs.test)` / `if (outputs.validator)` (stage-context:293-320); `validateAcceptanceTestsComplete` uses `0 < 0` → pass "All 0 acceptance criteria tested" (stage-gates:578-588). Every Stage 4 criterion defaults to pass. **Also:** `outputs.consolidator` never assigned → Stage 5 always fails `CONSOLIDATION_REPORT.md not found`, only logged (:1092-1094); `knowledgeStored: true` hardcoded (:1091) — fabricated evidence. Stage 4 contract lists `required: ['TEST_REPORT.md','VALIDATION_REPORT.md']` but `canAdvanceStage` never checks `artifacts.required` (stage-gates:276-342). | Orch: assign `outputs.test` after :930; assign `outputs.validator` after :1002 **and `persist({validator})` before `checkStageGate`** — else `checkStageGate`'s own `persistArtifacts(outputs, cwd)` (:1150, no artifactDir) writes the validator's docs to project root. Same for consolidator. Stage-gates: fail on `totalAC === 0`; count `tested + notCoverable >= totalAC`; cross-check `totalAC` vs `outputs.story.details.acceptanceCriteria.length`. Consider `VALIDATION_REPORT.md` in `REQUIRED_ARTIFACTS['07-validator']`. | None for Stage 4 via orchestrator. `stage-gates.test.ts:225-238` asserts the vacuous pass — must be rewritten. | Turning the gate on exposes `securityIssuesCount`: any `false` security boolean blocks (stage-context:308-318) — `authImplemented:false` on a no-auth feature would block; semantics ambiguous. Test Verifier and Validator `status` also never checked (FAIL/ESCALATE recorded as PASS at :930/:1022); Test Verifier `testExecution.failed` and `issues[CRITICAL]` ignored. |
| **A2** | **CONFIRMED + second blocker** | `state = options.resumeFromState \|\| create…` (:199); `outputs = {}` (:207); Stage 1 always runs unless `preSuppliedSpec` (:360/:388); `state.currentStage` never read. **Second blocker:** every exit goes through `finish()` → `completeFeature` sets `status='COMPLETED'` + `completedAt` (state-tracker:279-282) → `isResumable` false (:375-377) → CLI throws "already finished" (cli:133-138) — yet cli:169 prints "Resume with: … --resume <id>" after every escalation. Only a killed/crashed run is resumable. `FeatureState` has no `featureDescription`; CLI requires `--feature` again (cli:85). | Rebuild `outputs` from `state.stageHistory[].output` (PASS steps store full output; artifact paths already rewritten to run dir by `persist()` before `recordAgentStep`). Skip agents with a PASS step; skip checkpoints in `state.checkpointApprovals`. Define "resumable after escalation" (reopen: clear `completedAt`/`completionStatus`, status→IN_PROGRESS). Persist `featureDescription`. **`commit()` right after `recordCheckpointApproval` (:330)** — today an approval is durable only at the next commit (:525/:546). | Only `state-persistence.test.ts:212-260` (uses `resumeFromState` to pin id; no resume semantics). | Builder attempt counters reset on resume (:557, :682) → 3-attempt bound can be exceeded across resumes; use `countLoopsForAgent` from state. Resuming in Stage 3: half-finished builder's files are on disk. |
| **A3** | **CONFIRMED (by design)** | `clearStaleArtifacts` removes every dir except `keepFeatureId` (stage-context:112-125), incl. `state.json`; state-store:76-79 documents it as intended; checkpoints.test:219-238 and :314-340 lock in deletion. | Keep dirs whose `state.json` is resumable/paused; archive completed ones instead of deleting (somewhere agents don't read); or move the run record out of `.factory/<id>/`. | `checkpoints.test.ts:219-238`, `:314-340` must be adjusted. | Concurrency: two runs in the same cwd delete each other's dirs mid-flight. Weigh against the original incident; `builderPrompt` already tells agents to ignore other dirs (:297-299). |
| **A4** | **CONFIRMED** | Only `checkpoint('CHECKPOINT 1…')` (:488) and `'CHECKPOINT 2…'` (:542). After Stage 4 gate: `advanceToStage(5)` (:1057), log "Waiting for PR merge" (:1065), consolidator invoked immediately (:1069). `feature-factory --consolidate <feature-id>` (:1066) does not exist in `parseArgs` (cli:63-97). Nothing creates a PR. CHECKPOINT 3 text exists only in `07-validator.md:121-127`. | Add CP3 `checkpoint()` after Stage 4 (summary = validation report + diff/HEAD); return SUCCESS-at-CP3 or PAUSED (A10); move consolidator behind `--consolidate <id>`; remove hardcoded `knowledgeStored`. | None. | Changes what "SUCCESS" means; CLI exit-code semantics change. |
| **A5** | **CONFIRMED** | :1004-1020: escalation, `advanceToStage(state, 3)`, comment "For now, escalate", `finish(ESCALATED)` — final state shows misleading `currentStage: 3`. | Bounded outer loop (Stage 3↔4): route issues to builder by `issue.file` ∈ `filesModified`; new `BuilderFailure` kind `'validator'` in `retryBriefing` (:89-146); rerun gates 1, 1.5, 2 after the fix. | None. | Unbounded cost without aggregate cap (GAP-3); ambiguous ownership for issues with no `file`; validator's `canFix` should gate auto-loop vs escalate. |
| **A6** | **CONFIRMED** | Infra: `catch → WARN → recordLoopBack(...,'WARN')` and continue (:881-891). Execution: same (:972-982), "human review will catch issues". Throw path rare (`run*` catch internally) but fail-open by design. | `recordEscalation(..., 'INFRASTRUCTURE_FAILURE'/'EXECUTION_FAILURE')` + `finish`. | None — no test injects or mocks either gate. | Needs a testing seam (§4). |
| **A7** | **CONFIRMED** | Test Verifier prompt `"Write acceptance tests for implemented feature"` (:914); Validator `"Validate implementation against approved story and spec"` (:988); Consolidator no paths (:1072). Builders get paths via `builderPrompt` (:284-306). `HARNESS_PERSISTED_AGENTS` excludes 04/05/06 (stage-context:80-86); builder schemas have no `content` (output-schemas:48-76). Frontend told "Consume its API contract" (:302) with no path; Stage 3 contract's `BACKEND_BUILDER_SUMMARY.md` never produced/checked. Contracts 06/07 say "Read the Backend Builder Summary (Agent 4 output)" — doesn't exist. | Shared `upstreamPaths()` prompt helper for 05/06/07/08; harness renders `BACKEND_SUMMARY.md` / `API_CONTRACT.md` / `FRONTEND_SUMMARY.md` from structured builder output into `artifactDir` — harness-authored docs, not builder code, so materialization principle holds (must NOT enter `claimedFiles`). | `checkpoints.test.ts:282-312` shows how to assert on prompt content. | Label harness-derived summaries clearly so the Validator doesn't treat them as the builder's own claims. |
| **A8** | **CONFIRMED** | Baseline = builders' `testsPassed` sum (:903-908); after = Test Verifier `testExecution.passed` (:1025-1028) — different populations. Stage 4 "No Regressions" reads `validator.details.regressions` (stage-context:319), from a read-only agent that can't run tests. | Use harness-measured counts (execution audit vs a pre-Stage-3 run), or drop the comparison and rely on 100% execution gate + "test count did not drop"; feed `metadata.regressionCount` from the harness, not the Validator. | None (orchestrator.test.ts "regression" tests are fake). | Execution gate's own parsing is unreliable (§3) — a baseline on it inherits that. |
| **A9** | **CONFIRMED** | Wrong path `~/.claude/skills/software/factory/feature/SKILL.md` in `01-researcher.md:26`, `03-spec-writer.md:30`, `04-backend-builder.md:28`, `05-frontend-builder.md:31`, `06-test-verifier.md:32`, `07-validator.md:33`. 02/08/09/10 reference no path. `~/.claude/agents` copies have the correct path on the same lines; per-file line counts identical. HARNESS_GAP_ANALYSIS.md:91 cites stale line numbers; README.md:915 has another wrong path. | Fix 6 lines + README + doc line numbers. | `agent-registry.test.ts:88-95` only checks contract length > 100. | Deeper (GAP-1): agents run with `settingSources: []` and Read-only grants — unverified whether SDK Read resolves `~` / permits paths outside `cwd` under `dontAsk`. Contracts also call `mcp__memorykit__*`, which no agent is granted → denied-tool noise, and the consolidator's whole input source is missing. |
| **A10** | **FEASIBLE after A2 + A3 + finish/isResumable fix** | `approveCheckpoint` returns `boolean` (:168-172) — no pause value; `CheckpointApproval` (state-tracker:81-87) has no hash field; no PAUSED status; `completeFeature` only SUCCESS/ESCALATED/MANUAL_STOP; CLI returns 0/1 only. `run-cpf-factory.ts` already polls for a file-based decision. | Approver returns `'APPROVE' \| 'REJECT' \| 'PAUSE'`; on pause store `pendingCheckpoint {name, stage, artifactPaths, sha256}` (node `crypto`) and `commit` with status PAUSED (not `finish`); CLI exits with distinct code; `--resume <id> --approve <checkpoint>[:<hash>]` re-hashes and refuses if changed, records approval with hash, resumes via A2 skip logic. | None. | Hash what the human was shown — today `summary` is only `details.summary` (:324), not USER_STORY.md / TECHNICAL_BRIEF.md. CP3's artifact should be commit SHA/diff + VALIDATION_REPORT. Needs `featureDescription` in state. |
| **A11** | **CONFIRMED — more than claimed** | `getStageNameLowerCase` (:1185-1194) unused. Unused imports: `StageContext` (:18), `MaterializationAudit` (:36), `getFixCodeTemplate` (:42), `ResearcherOutput`, `StoryWriterOutput`, `SpecWriterOutput`, `TestVerifierOutput`, `ValidatorOutput`, `FeatureConsolidatorOutput` (:26-33). Unneeded `let infrastructureAudit/executionAudit = null`; `backendPassed` redundant with `backendOutput`. `maxAttempts: 2` (:915, :989) ignored — `invoke-agent.ts` never reads `call.maxAttempts`. | Delete; optionally `noUnusedLocals` (expect fallout). | n/a | Low. |
| **A12** | **CONFIRMED** | See §6. | SKILL.md rewrite + drift test. | None. | Land last. |

---

## 3. Other bugs in the same files

1. **Execution gate fails every Jest project, including this repo.** Jest prints its summary to **stderr**; on success `runTestSuite` keeps only stdout and sets `stderr: ''` (execution-gates:63-83) → `parseTestOutput` gets total = 0 → `passRate` 0 → gate blocks "0.0%". The Jest regex also expects `passed` before `failed`, but Jest prints `N failed, M passed` (:213-221). **Confirmed live — see §9.**
2. **Execution gate contradicts infrastructure policy:** always runs `npm run build` and `npm run dev` and blocks on failure (:270-300), while the infrastructure gate made missing build/dev a WARNING. This repo has no `dev` script. `verifyDevServer` uses GNU `timeout` (:160) — absent on stock macOS; "command not found" doesn't match `/error|failed|cannot|undefined/` → passes vacuously. On Linux it fails on "npm error Missing script".
3. `failedTests` always `[]` (`testResult.testStats ? [] : []`, :393).
4. `Promise.all` over `execSync`-based functions (:385) runs them serially.
5. `validateOutputSchema` dereferences `output.details.summary` after only recording that `details` is missing (agent-output-schema:598-602) → TypeError → outer catch as MANUAL escalation instead of SCHEMA_VALIDATION.
6. **Pre-supplied spec path:** `acceptFeatureSpec` persists to the **project root** (feature-spec.ts:120) while `builderPrompt` points builders at `${artifactDir}/TECHNICAL_BRIEF.md`, which doesn't exist. CHECKPOINTS 1 and 2 are skipped entirely on this path (:360-387).
7. CP1 is asked (:488) before the Stage 2 gate validates Given/When/Then (:528) — a human can approve a story the gate later rejects.
8. Stage 2 gate escalation omits `blockers` (:530-536); Stage 1 includes them.
9. `requireAll: true` in every contract makes IMPORTANT criteria block exactly like CRITICAL (stage-gates:318-320), e.g. Stage 1 "Risks Flagged", Stage 3 "No Abandoned TODOs". Possibly unintended (open question).
10. CLI resume hint vs `isResumable` (A2).

---

## 4. Existing patterns and test infrastructure

**Faking the invoker** (checkpoints.test.ts:119-131, retry-briefing.test.ts:121-148): `invoke` is injected via `OrchestrationOptions.invoke: AgentInvoker` (orch:190; type invoke-agent.ts:34-41). Tests pass `async (call: AgentInvocation) => …` switching on `call.agent` to return fixtures (`researcher()`, `story()`, `spec()`, `failingBackend()`), capturing `call.prompt`/`call.agent`. Temp project via `mkdtempSync(join(tmpdir(),'ff-…'))`, `rmSync` in afterEach; `logger: () => {}`; `approveCheckpoint: async () => true` (or a spy); pin run id with `resumeFromState: createFeatureState(...)`; mid-run disk assertions from inside the invoker (state-persistence:181-210). Fixtures are copy-pasted across 3 files → extract to `factory/test/fixtures/`.

**Seam needed for Stage 4 tests:** no test gets past Stage 3, because that would execute real `npm run build/test/dev` via execSync in the temp dir. Add optional `gates?: { auditInfrastructure, auditExecution }` to `OrchestrationOptions`, defaulting to the real ones (mirrors the `invoke` injection rationale, orch:185-190). Alternative: `jest.mock('../../harness/execution-gates')` — no test currently uses `jest.mock`.

**Other patterns:** `commit()` for every resumable transition, `finish()` for every exit (:236-257); `recordEscalation` with typed reason; fail-closed philosophy (state-store, checkpoints); incident-narrative docblocks; source-scanning guard tests (`no-cwd-in-gates.test.ts`).

**Commands** (package.json): `npm test` (jest, ts-jest; `testMatch: **/test/**/*.test.ts`), `npm run typecheck` (`tsc --noEmit`), `npm run build`, `npm run factory`. **No lint script and no ESLint config.** CI (`.github/workflows/ci.yml`) runs typecheck + test only.

---

## 5. Risks

- **Untracked root files may break typecheck:** tsconfig `include: ["**/*.ts"]` covers the root; `probe-cwd.ts` statically imports the ESM-only SDK in a CommonJS/node16 project (invoke-agent.ts:63-70 explains why that fails) → likely TS1479. `run-*.ts` hardcode `/private/tmp/...`, a run id, and `claude-opus-4-8`. Decide delete / move / exclude before any commit.
- **Turning gates on creates new false blocks:** A1 security booleans; execution-gate parsing (§3 bugs 1–2). Fix those together with A1/A6, or the first real Stage 4 run escalates on a green suite.
- **Tests that must change:** `stage-gates.test.ts:225-238` (A1), `checkpoints.test.ts:219-238` and `:314-340` (A3), state-store comment :76-79 (A3), `orchestrator.test.ts` (delete or rewrite).
- **SUCCESS contract change** (A4/A10): exit codes and `completionStatus` union change; affects `run-cpf-factory.ts`-style wrappers.
- **Builder sandboxing (GAP-5):** `run-frontend-only.ts` documents a 40-file write outside the target; A5's extra loops increase exposure.
- **No aggregate budget:** A5 multiplies builder invocations.
- **Two contract copies** (repo vs `~/.claude/agents`) can drift again — no test compares them, and CI has no `~`.

---

## 6. A12 — SKILL.md vs code, and a drift test

| SKILL.md says | Code says |
|---|---|
| "A 10-agent chain" (:3); "All 7 agents" (:323, omits 08) | `AGENT_STAGE` has 8 (agent-registry:25-34); 09/10 unreachable |
| Gate 1.5: build, dev, test:e2e, migrations are CRITICAL (:68-75) | Only `test`, package.json parse, tsconfig parse are CRITICAL (infrastructure-gates:94-102, 124, 205-229) |
| Gate 2 failure → "loop back to [06]" (:133, :266) | Escalates (orch:946-969) |
| "100% certainty … if PR is created" (:106-114) | Nothing creates a PR; gates fail open (A6); Stage 4 vacuous (A1) |
| Validator Critical → loop back to builder (:268, :352) | Escalates (A5) |
| Test Verifier failure → loop back to builder (:351) | Test Verifier status/failures ignored |
| CHECKPOINT 3, then consolidator after merge (:269-271, :192) | No CP3; consolidator runs immediately (A4) |
| [09] Branch cleanup (:273, :278-290) | No git code at all |
| Checkpoint protocol: STOP block, reply "approved" (:334-343) | `approveCheckpoint` callback / TTY y/N / `--yes` (cli:41-61, :150) |
| Builders log to memory; "Frontend routes API mismatch to Backend" (:216-233) | No MCP tools granted; no such routing |
| Artifact flow: Backend Summary + API Contract downstream (:369-378) | Not persisted (A7) |

**Proposed drift test** (`factory/test/contracts/doc-drift.test.ts`, style of no-cwd-in-gates):
1. Agent count parsed from `/(\d+)-agent chain/` equals `Object.keys(AGENT_STAGE).length`; every `NN-name.md` listed in SKILL.md exists in `factory/feature/agents` and in `AGENT_STAGE`.
2. No contract / SKILL.md / README contains `skills/software/factory/feature/`; every `~/.claude/skills/software/<x>` in the Skill Assignments table maps to an existing `skills/<x>` in the repo.
3. Every `CHECKPOINT N` in SKILL.md appears as a `checkpoint('CHECKPOINT N` call in the orchestrator source, and vice versa.
4. Banned unverifiable phrases, e.g. `/100% certainty/`.
5. Cleaner: orchestrator exports `CHECKPOINTS` and `LOOP_BACK_RULES` constants; SKILL.md carries a fenced machine-readable claims block; the test asserts equality.
6. Optional, skipped when `~/.claude/agents` is absent (CI): repo vs `~` contracts byte-equal.

---

## 7. Recommended order

0. **Foundations:** gate-injection seam, shared test fixtures, delete/rewrite `orchestrator.test.ts`; resolve untracked root files before typecheck.
1. **A11 + A9** — independent, trivial.
2. **A6** — fail closed (needs step 0); fix execution-gate bugs 1–3 here too.
3. **A1** — wire `outputs.test/validator/consolidator`, persist validator before the gate, correct 0/0 and notCoverable, check Test Verifier/Validator `status`, fix stage-gates.test.
4. **A8** — same block; uses harness execution data from 2–3.
5. **A7** — prompt paths + harness-rendered builder summaries / API contract (A5's routing input).
6. **A5** — bounded validator→builder loop-back with a `'validator'` retry briefing.
7. **A2 + A3 together** — real resume; stop deleting resumable runs.
8. **A4** — CP3 and `--consolidate` (remove hardcoded `knowledgeStored`).
9. **A10** — pause/resume with hash-bound approval (needs 7 + 8).
10. **A12** — SKILL.md / README / GAP-analysis rewrite + drift test, last.

Estimate (low confidence, no memory baseline): ~2–3 builder-days (0–4 ≈ 1 day; 5–6 ≈ 0.5–1; 7–9 ≈ 1; 10 ≈ 0.25), plus risk for the Jest/stderr live verification.

---

## 8. Open questions

1. Is `requireAll: true` (IMPORTANT blocks like CRITICAL) intended (stage-gates:318-320)?
2. A3: archive finished runs (where?) or delete? Support two concurrent runs in one cwd?
3. A2: may a run ended via `finish(ESCALATED)` be reopened, or only killed/paused runs? Do builder attempt bounds carry across resumes?
4. A4: SUCCESS = "CP3 approved", consolidator a separate command? Should the factory create the PR or only stop?
5. A5: outer-loop bound; routing for Validator issues with no `file`?
6. A8: pre-Stage-3 baseline test run (wall-clock cost), or "100% pass + test count didn't drop"?
7. A9/GAP-1: enforce skill loading (can SDK Read resolve `~` / read outside `cwd` under `dontAsk` with `settingSources: []`?) or fold rules into the contracts? Remove contracts' `mcp__memorykit__*` instructions?
8. Does `timeout` exist on the operator's macOS (decides whether the dev-server check is vacuous)?
9. Commit, move, or delete `run-cpf-factory.ts`, `run-frontend-only.ts`, the probes? Is the file-based approver the intended UX for A10?
10. Should the checkpoint summary show the full artifact or only `details.summary`? (Decides what the A10 hash binds to.)

---

## 9. Addendum — live verification (orchestrating session, 2026-10-04)

`npm test` in this repo with stdout and stderr captured separately:

- Exit code **0**; **15 suites, 231 tests passed**.
- **stdout: 52 bytes** — only the npm header (`> @cypher-digital/claude-skills@1.1.0 test` / `> jest`).
- **stderr: 43,098 bytes** — contains the whole summary (`Test Suites: 15 passed, 15 total`, `Tests: 231 passed, 231 total`).

`runTestSuite` (execution-gates.ts:63-83) parses only `stdout` on success and sets `stderr: ''`. **§3 bug 1 is confirmed:** on a fully green Jest suite the execution gate sees no test counts. It must parse `stdout + stderr` (or use `jest --json`) before A1/A6 make the gate binding.
