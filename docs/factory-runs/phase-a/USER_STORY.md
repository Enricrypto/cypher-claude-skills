# User Story — Phase A: "make the Feature Factory orchestrator do what it claims" (Revision 2)

> Feature Factory run, by-hand mode. Agent 02 (Story Writer), read-only. 2026-10-04.
> Inputs: `docs/factory-runs/phase-a/RESEARCHER_REPORT.md`, `factory/feature/SKILL.md` (context only), and the operator's answers to C-1..C-9 and OQ-1..OQ-9 (now requirements).
>
> **Status: ✅ CHECKPOINT 1 APPROVED by the operator (Enrique), 2026-10-04.**
> **Delivery: two PRs.** PR **A-1 "Gates tell the truth"** = groups F, G, P, V, C. PR **A-2 "Run lifecycle"** = groups R, K. A-1 lands first.
> The three Story Writer interpretations flagged under "Resolved decisions" (AC-70, AC-75, AC-65) were accepted with the approval.

IDs AC-1..AC-62 are kept from Revision 1; **(revised)** marks a criterion whose behaviour changed; new criteria are AC-63..AC-79, placed at the end of their group.

---

## Prior Feature Context

No MemoryKit tools were available to the subagent. Git history (from the Researcher Report) shows the same bug class fixed repeatedly — gates judging fabricated evidence, dead imports, prose claims with no code behind them. Hence: every criterion is verified by a test or source check (never by docs), and every known vacuous pass (0/0 counts, missing `timeout` binary, empty stdout) gets its own failure-path criterion.

**Confidence: Medium.** The test pattern is established; pause/approve/reject/close/resume semantics are new with no precedent in this repo.

---

## User Stories

**Story 1 — Operator.** As the operator running `npm run factory` from a terminal or a Claude Code session, I want every gate, checkpoint and resume path to behave as reported — so SUCCESS means "tests ran green, the validator found no CRITICAL issues, and I approved the PR" — and I want to stop, reject, close or resume a run without losing work or approvals.

**Story 2 — Agents in a run.** As an agent in the chain, I want the absolute paths of every upstream artifact and no instructions for tools I don't have, so I work from the real story, brief and builder outputs.

**Story 3 — Future maintainers.** As a maintainer relying on `SKILL.md` and the README, I want the docs checked against the code by a test, so untrue claims fail CI instead of shipping.

---

## Test method legend

- **[O] Orchestrator test** — `runFeatureFactory` with a scripted invoker, a `mkdtempSync` temp project and injected gates (AC-1); assertions on the return value, `state.json`, files on disk, captured prompts and approver calls.
- **[G] Gate test** — the execution or infrastructure gate run directly against a temp project whose `package.json` scripts are tiny real Node commands.
- **[U] Unit test** — pure functions (parsers, `validateOutputSchema`, stage-gate criteria, hashing, routing).
- **[C] CLI test** — the injectable CLI entry point (AC-63) with injected invoker, approver, TTY check and exit handling; no process spawned, no network.
- **[S] Static check** — a source-scanning test in the style of `no-cwd-in-gates.test.ts`.

---

## Acceptance Criteria

### F. Foundations — PR A-1

- **AC-1 [O]** Given `OrchestrationOptions` with injected `gates.auditInfrastructure` and `gates.auditExecution`, when the run reaches Gate 1.5 and Gate 2, then the injected functions are called and no `npm` process starts. **[S]** When `gates` is omitted, the defaults are the real functions from `infrastructure-gates.ts` and `execution-gates.ts`.
- **AC-2 [S]** Researcher, story, spec and builder fixtures live in `factory/test/fixtures/`; no orchestrator test file defines its own copy.
- **AC-3 [S]** Either `factory/test/orchestrator.test.ts` does not exist, or every test in it imports and calls `runFeatureFactory`, with no assertions on literals the test built itself.
- **AC-4 [S]** `tsconfig` excludes `run-cpf-factory.ts`, `run-frontend-only.ts`, `probe-cwd.ts`, `probe-cwd.mjs`, and `npm run typecheck` passes while they are present.
- **AC-63 [C] [S]** The CLI has an injectable entry point (invoker, approver, TTY check, exit handling passed in, mirroring the `invoke` injection). **[C]** With injected fakes, a full CLI invocation runs with no child process and no network; the exit code is captured via the injected exit handler. **[S]** The real CLI main calls this entry point with the real dependencies.

### G. Gates fail closed and report the truth — PR A-1

- **AC-5 [O]** Given the injected infrastructure gate throws, the run ends ESCALATED with reason `INFRASTRUCTURE_FAILURE`, and the Test Verifier is never invoked.
- **AC-6 [O]** Given the injected execution gate throws, the run ends ESCALATED with reason `EXECUTION_FAILURE`, and the Validator is never invoked.
- **AC-7 [O]** Given the execution gate returns a blocking result (pass rate below 100%), the run escalates with the failing details and the Validator is never invoked. No loop-back to the Test Verifier in Phase A.
- **AC-8 [G]** Given a temp project whose `test` script exits 0 and writes `Tests: 2 passed, 2 total` to **stderr only**, the execution gate reports total 2, passed 2, pass rate 100%, and does not block.
- **AC-9 [U]** Given `Tests: 1 failed, 4 passed, 5 total`, the parser returns failed 1, passed 4, total 5. Given output with no detectable counts, the gate blocks with "no tests detected" — never a 0/0 pass.
- **AC-10 [U]** Given test output naming failing tests, `failedTests` is non-empty and contains those names.
- **AC-11 [G]** Given no `dev` script, the dev-server check is skipped with a recorded WARNING and does not block.
- **AC-12 [G]** Given no `build` script, the build check is skipped with a recorded WARNING and does not block.
- **AC-13 [G] [S]** **[G]** Given a `dev` script that keeps running, the dev-server check ends within its configured timeout on a machine with no GNU `timeout`. **[S]** `execution-gates.ts` calls no shell `timeout` command; the timeout is Node-based.
- **AC-14 (revised) [G]** Given a `dev` script that exists and exits non-zero (or reports errors) before the timeout, the check fails as CRITICAL and the execution gate blocks.
- **AC-15 [S]** The execution gate does not wrap synchronous `execSync`-based checks in `Promise.all` in a way that implies parallelism.
- **AC-16 [U] [O]** **[U]** Given an output with no `details`, `validateOutputSchema` returns a schema failure naming `details` and does not throw. **[O]** Given the invoker returns such an output, the run escalates with reason `SCHEMA_VALIDATION`, not `MANUAL`.
- **AC-17 [U]** Given a stage contract where every CRITICAL criterion passes and an IMPORTANT one fails, `canAdvanceStage` allows advancement and the IMPORTANT failure is added to the run's list of IMPORTANT findings.
- **AC-18 [O] [U]** **[O]** Given a story with 5 ACs and a Test Verifier reporting 3 tested, 0 not coverable, "Acceptance Tests Complete" fails. **[U]** totalAC = 0 → fails. **[U]** tested + notCoverable ≥ totalAC and totalAC equals the story's AC count → passes. **[U]** totalAC differs from the story's AC count → fails.
- **AC-19 [O]** Given the Test Verifier returns `status` FAIL or ESCALATE, or `testExecution.failed > 0`, or any CRITICAL issue, the step is not recorded as PASS, the run escalates, and the Validator is never invoked. No loop-back in Phase A.
- **AC-20 [O]** Given the Validator returns `status` ESCALATE, the run escalates; that step is never recorded as PASS.
- **AC-21 [O] [U]** **[O]** Given a run that reaches Stage 4, `TEST_REPORT.md` and `VALIDATION_REPORT.md` exist in the run's artifact directory and neither exists in the project root. **[U]** Given either required Stage 4 artifact is missing, `canAdvanceStage` fails — `artifacts.required` is enforced.
- **AC-22 (revised) [O]** "No Regressions" passes only when the harness-measured Gate 2 result shows 100% passing **and** the test count is at least the reference count. Reference for the first Gate 2 evaluation in a run = the project baseline from the last SUCCESS run (AC-65); reference for later Gate 2 evaluations in the same run (validator loop-back rounds) = that run's first Gate 2 count. A count below the reference fails. The Validator's `details.regressions` is ignored (a Validator claiming `regressions: 5` against a green harness result changes nothing).
- **AC-23 [O]** The injected execution gate is called only at Gate 2 — no baseline test run before the build stage.
- **AC-64 [G]** Given a `build` script that exists and exits non-zero, the build check fails as CRITICAL and the execution gate blocks.
- **AC-65 [O]** Given a run reaches SUCCESS (CP3 approved), a baseline file under `.factory/` — outside any run directory and never moved by archiving — records that run's Gate 2 test count and run id; a later run in the same project reads it as the AC-22 reference. *(Delivered in PR A-2, since SUCCESS = CP3; A-1 implements the reading side and AC-66.)*
- **AC-66 [O]** Given no baseline file exists and it is the run's first Gate 2 evaluation, only the 100%-pass rule applies; "No Regressions" does not fail for lack of a reference.
- **AC-67 [U] [O]** Security checks are tri-state `true` / `false` / `"not_applicable"`. `false` blocks; `true` does not; `"not_applicable"` with a non-empty reason does not block, provided the approved brief declares the feature has no such surface. **[O]** Given a feature whose brief declares no auth surface and a Validator reporting `authImplemented: "not_applicable"` with a reason, Stage 4 is not blocked.
- **AC-68 [U]** `"not_applicable"` blocks when the reason is missing or empty, or when the approved brief does not declare that surface absent. The Spec Writer defines how the brief records this (e.g. a field in its structured output).

### P. Agents get real upstream inputs — PR A-1

- **AC-24 [O]** Prompts for 05, 06, 07 and 08 contain the absolute path, inside the run's artifact directory, of every upstream artifact that exists at that point — `RESEARCHER_REPORT`, `USER_STORY`, `TECHNICAL_BRIEF`, `BACKEND_SUMMARY`, `API_CONTRACT`, `FRONTEND_SUMMARY`, `TEST_REPORT` — and every path named in a prompt exists on disk when the agent is invoked.
- **AC-25 [O]** After the Backend Builder passes, the harness writes `BACKEND_SUMMARY.md` and `API_CONTRACT.md` into the artifact directory; after the Frontend Builder passes, `FRONTEND_SUMMARY.md`. Each is labelled harness-generated from the builder's structured output, and none appears in the materialization audit's claimed files.
- **AC-26 [S]** No file in the repo contains the path segment `skills/software/factory/feature/` (covers the 6 contracts and the README).
- **AC-27 [S]** No contract in `factory/feature/agents/` contains `mcp__memorykit__`.
- **AC-28 (revised) [O]** Every agent prompt in a normal run says `.factory/_archive/` must not be read. Single exception: under `--consolidate <id>`, the consolidator prompt names that run's own directory explicitly and permits reading only that directory (AC-47).

### V. Validator CRITICAL loop-back — PR A-1

- **AC-29 [O]** Given a Validator CRITICAL issue whose `file` is in the Backend Builder's `filesModified` with `canFix` true, the Backend Builder is re-invoked with a retry briefing of kind `validator` containing the issue text; then Gates 1, 1.5 and 2 run again; then the Validator is invoked again.
- **AC-30 [O]** Same as AC-29, for a file owned by the Frontend Builder → the Frontend Builder is re-invoked.
- **AC-31 (revised) [O]** Given a CRITICAL issue with no `file`, or `canFix` false, or a file in neither builder's `filesModified`, the run escalates to the human immediately with the issues listed; no builder is re-invoked.
- **AC-32 [O]** Given CRITICAL issues remain after 2 loop-back rounds, the run escalates. The Validator is invoked at most 3 times (first run + 2 rounds).
- **AC-33 [O]** Given an escalation during Stage 4, the final state shows `currentStage: 4`.
- **AC-69 [U] [O] [S]** A file in both builders' `filesModified` goes to the Frontend Builder when the existing frontend-file heuristic matches (extension `.tsx`/`.jsx`/`.vue`/`.svelte`, or path contains `components`/`pages`/`app`/`views`/`screens`); otherwise to the Backend Builder. **[S]** Routing reuses the existing heuristic rather than a second copy of it.
- **AC-70 [O]** Validator rounds have their own bound and do not consume the builder's 3 Stage 3 test-fix attempts: a builder that used all 3 Stage 3 attempts is still re-invoked by a validator round, and that re-invocation does not increase its Stage 3 attempt count. Within a round the builder's test-fix retries follow the normal rule (at most 3 attempts per round, then escalate).

### R. Resume and run lifecycle — PR A-2

- **AC-34 [O]** Given state with PASS steps for 01–03 and approvals for CP1 and CP2, when resumed, 01–03 are not invoked, the approver is not called for CP1 or CP2, and the Backend Builder prompt has the same artifact paths a fresh run would have given it.
- **AC-35 (revised) [O] [C]** Given a run that ended ESCALATED for any reason other than a builder exhausting its attempts, when resumed, `status` becomes IN_PROGRESS, `completedAt` and `completionStatus` are cleared, and execution continues from the first step with no PASS.
- **AC-36 [O]** Given a run paused or killed after 2 failed Backend Builder attempts, when resumed, the builder gets at most 1 more attempt before escalating; the count comes from state.
- **AC-37 [C]** `--resume <id>` works without `--feature` (the feature description is saved in state).
- **AC-38 [O]** Given a checkpoint is approved, `state.json` on disk records the approval before the next agent is invoked (asserted from inside the invoker).
- **AC-39 [O]** On resume, every harness gate (1, 1.5, 2, stage gates) for unfinished steps is evaluated again; none is skipped because of an earlier result.
- **AC-40 (revised) [O]** Given `.factory/` holds a SUCCESS run, a run closed with `--close` (MANUAL_STOP), a PAUSED run and an ESCALATED run, when a new run starts, the SUCCESS and MANUAL_STOP directories are moved, contents intact, to `.factory/_archive/<id>/`, and the PAUSED and ESCALATED directories are untouched.
- **AC-41 (revised) [O] [C]** Given a PAUSED, ESCALATED or IN_PROGRESS run exists, when a new run (not a resume) starts, it is refused with a message naming the existing run id, the `--resume` command and the `--close` command; nothing is moved or deleted.
- **AC-42 [C]** The CLI prints "Resume with: … --resume <id>" only when that run is actually resumable.
- **AC-71 [O] [C]** Given a run that escalated because a builder exhausted its attempts, `--resume <id>` without `--grant-attempts` is refused with a message naming `--grant-attempts <n>`; state unchanged.
- **AC-72 [O] [C]** Given that run, `--resume <id> --grant-attempts <n>` grants exactly n additional attempts to that builder, recorded in state (builder, n, timestamp); the builder escalates again after exactly n more failed attempts.
- **AC-73 [C] [O]** `--close <id>` on a PAUSED, ESCALATED or IN_PROGRESS run sets it finished with MANUAL_STOP; it is archived on the next run start (AC-40). `--close` on a run already SUCCESS or MANUAL_STOP is refused; state unchanged.

### K. Checkpoints, CP3, SUCCESS, pause/approve/reject — PR A-2

- **AC-43 [O]** The text given to the approver is the full artifact: CP1 = full `USER_STORY.md`; CP2 = full `TECHNICAL_BRIEF.md`; CP3 = full `VALIDATION_REPORT.md` plus the diff.
- **AC-44 [O]** Given the Stage 4 gate passes, CHECKPOINT 3 is presented and its text includes the run's list of IMPORTANT findings. Given CP3 is approved, the result is SUCCESS, exit code 0, and the Feature Consolidator is not invoked.
- **AC-45 [S]** Neither the orchestrator nor the CLI creates a PR or pushes — no `gh pr`, `git push` or similar calls.
- **AC-46 (revised) [O] [C]** Given CP1, CP2 or CP3 is rejected, the run ends ESCALATED with reason `MANUAL`, exit code 1, and is resumable.
- **AC-47 (revised) [C] [O]** Given a SUCCESS run whose directory is `.factory/<id>/` or `.factory/_archive/<id>/`, `--consolidate <id>` invokes agent 08 with that run's directory named explicitly in its prompt, and the Stage 5 gate is evaluated. Given a non-SUCCESS run or an id found in neither location, `--consolidate` refuses.
- **AC-48 (revised) [S] [O]** **[S]** No `knowledgeStored` field or criterion exists in the Stage 5 contract, its metadata or the orchestrator. **[O]** Stage 5 never passes or fails on memory storage.
- **AC-49 [O] [C]** Given the approver returns PAUSE at a checkpoint, the state has status PAUSED and a `pendingCheckpoint` with name, stage, artifact paths and the SHA-256 of the exact presented text; `finish()` is not called; the exit code is neither 0 nor 1.
- **AC-50 [U] [O]** The stored hash equals the SHA-256 of the exact bytes presented.
- **AC-51 [C] [O]** Given a PAUSED run whose artifact is unchanged, `--resume <id> --approve <checkpoint>` records the approval with its hash and the run continues past the checkpoint without asking again.
- **AC-52 [C] [O]** Given the artifact changed after the pause, `--approve` is refused with "artifact changed"; the state stays PAUSED with no approval recorded; exit code non-zero.
- **AC-53 [C]** `--approve` or `--reject` naming a checkpoint other than the pending one is refused; state unchanged.
- **AC-54 [C] [O]** A PAUSED run resumed with neither `--approve` nor `--reject` does not move past the pending checkpoint.
- **AC-55 [O]** With a pre-supplied spec, the story and brief are saved in the run's artifact directory (not the project root), builder prompts reference paths that exist, and CP1 and CP2 are presented.
- **AC-56 (revised) [O]** The story part of the split Stage 2 gate (Given/When/Then and the other story criteria) is evaluated before CP1; a story that fails it ends the run before CP1, and the approver is never called for CP1.
- **AC-57 (revised) [O]** When either part of the split Stage 2 gate (story or spec) escalates, the escalation includes `blockers`, as Stage 1 does.
- **AC-74 [C] [O]** Given a PAUSED run, `--resume <id> --reject <checkpoint> --notes "<text>"` ends the run ESCALATED (reason `MANUAL`, exit 1), records the notes and the rejected checkpoint in state, and leaves the run resumable.
- **AC-75 [O] [C]** Resuming a run escalated by a checkpoint rejection: CP1 rejected → the Story Writer is re-invoked with the notes in its prompt, then the story gate, then CP1 again. CP2 rejected → the Spec Writer is re-invoked with the notes, then the spec gate, then CP2 again. CP3 rejected → each builder that modified files in the diff is re-invoked with the notes, then Gates 1, 1.5, 2, the Test Verifier, the Validator and the Stage 4 gate run again, then CP3 again. The approval hash binds to the new artifact.
- **AC-76 [O]** Given `--consolidate <id>` completes, `CONSOLIDATION_REPORT.md` and `PATTERNS.md` exist in that run's directory (live or archived); the Stage 5 gate requires both files and nothing memory-related.
- **AC-77 [C] [O] [S]** Given no TTY and no `--yes`, a checkpoint PAUSES the run as in AC-49 — it does not escalate, and pausing records no approval. **[S]** `--yes` behaviour is unchanged.
- **AC-78 [O]** The spec part of the split Stage 2 gate is evaluated after the Spec Writer and before CP2; a spec that fails it ends the run before CP2, and the approver is never called for CP2.

### C. Cleanup, docs and drift — PR A-1 (AC-61 and AC-79 complete in PR A-2)

- **AC-58 [S]** The orchestrator contains none of the A11 dead code: `getStageNameLowerCase`, `StageContext`, `MaterializationAudit`, `getFixCodeTemplate`, the six unused output types; `maxAttempts` is either honoured by `invoke-agent.ts` or removed.
- **AC-59 [S]** A drift test (e.g. `factory/test/contracts/doc-drift.test.ts`) asserts: SKILL.md's agent count equals `Object.keys(AGENT_STAGE).length`; every listed agent file exists in `factory/feature/agents/` and in `AGENT_STAGE`; the `CHECKPOINT N` entries in SKILL.md equal the orchestrator's checkpoint calls (or exported `CHECKPOINTS`); SKILL.md's loop-back rules equal an exported orchestrator constant; no SKILL.md or README text matches `/100% certainty/`; the Skill Assignments `~/.claude/skills/software/<x>` paths map to skills that exist in the repo.
- **AC-60 (revised) [S]** SKILL.md no longer claims: that the factory creates a PR; branch cleanup ([09]); that builders log to memory; frontend→backend API routing; "10-agent" or "All 7 agents"; that the consolidator stores to memory. SKILL.md states that in Phase A a Gate 2 failure and a Test Verifier failure escalate, with no loop-back claimed for either.
- **AC-61 [S]** At the end of the phase, `run-cpf-factory.ts`, `run-frontend-only.ts`, `probe-cwd.ts` and `probe-cwd.mjs` no longer exist, and the AC-4 typecheck exclusion is removed. *(PR A-2, once resume and pause/approve replace them.)*
- **AC-62 [U]** The Stage 4 PASS test in `stage-gates.test.ts` uses the real metadata keys and no longer passes vacuously.
- **AC-79 [S]** SKILL.md documents `--resume`, `--approve`, `--reject --notes`, `--close`, `--grant-attempts`, `--consolidate`, and the drift test asserts every CLI flag named in SKILL.md is accepted by the CLI parser. *(PR A-2, when those flags exist.)*

---

## Edge Cases

| Edge case | Disposition |
|---|---|
| Green Jest suite whose summary is on stderr | AC-8 |
| No test counts found (0/0) | AC-9, AC-18 |
| No GNU `timeout` on macOS | AC-13 |
| `dev` or `build` script missing | AC-11, AC-12 |
| `dev` or `build` script present but failing | AC-14, AC-64 |
| Validator output written to the project root | AC-21 |
| No regression baseline yet (first run in a project) | AC-66 |
| Feature with no auth surface | AC-67, AC-68 |
| Approval lost between approval and next commit | AC-38 |
| Artifact edited between pause and approve | AC-52 |
| Builder exhausted its attempts, then resumed | AC-71, AC-72 |
| Abandoned run blocking new runs | AC-41, AC-73 |
| Run archived before `--consolidate` | AC-47 |
| Validator issue on a file both builders touched | AC-69 |
| Checkpoint rejected, then resumed | AC-75 |
| No TTY at a checkpoint | AC-77 |
| Resuming in Stage 3 with a half-finished builder's files on disk | Builder re-invoked per AC-36; gates re-run per AC-39. A special leftover-files briefing is **out of scope**. |
| Two runs started at the same moment in one directory | **Out of scope.** AC-41 covers the sequential case only. |

---

## Resolved decisions

| Item | Answer (now a requirement) | Affected ACs |
|---|---|---|
| C-1 | Resume after a builder exhausted its attempts is refused unless `--grant-attempts <n>` (adds exactly n, recorded in state) | AC-35, AC-71, AC-72 |
| C-2 | `--close <id>` sets a PAUSED/ESCALATED/IN_PROGRESS run to MANUAL_STOP; archived on next start | AC-40, AC-41, AC-73 |
| C-3 | Reference count = baseline file from the last SUCCESS run; within a run, the first Gate 2 count; no reference → 100%-pass rule only | AC-22, AC-65, AC-66 |
| C-4 | A pre-supplied spec still presents CP1 and CP2 | AC-55 |
| C-5 | Missing `build` script skipped with a recorded WARNING | AC-12 |
| C-6 | Gate 2 and Test Verifier failures escalate in Phase A; SKILL.md says so | AC-7, AC-19, AC-60 |
| C-7 | `--consolidate` finds the run live or archived; only the consolidator is given its own run directory | AC-28, AC-47 |
| C-8 | "Knowledge stored" criterion dropped; consolidator writes `CONSOLIDATION_REPORT.md` and `PATTERNS.md`; memory storage happens outside the factory | AC-48, AC-60, AC-76 |
| C-9 | Stage 2 gate split: story part before CP1, spec part before CP2 | AC-56, AC-57, AC-78 |
| OQ-1 | Security checks tri-state; only `false` blocks; `"not_applicable"` needs a reason and a declaration in the brief | AC-67, AC-68 |
| OQ-2 | "Finished" = SUCCESS, or MANUAL_STOP via `--close` | AC-40, AC-73 |
| OQ-3 | Rejection = ESCALATED (`MANUAL`, exit 1), resumable; `--reject --notes`; on resume the producing agent reruns with the notes, then the checkpoint is presented again | AC-46, AC-53, AC-54, AC-74, AC-75 |
| OQ-4 | A `build` or `dev` script that exists and fails is CRITICAL | AC-14, AC-64 |
| OQ-5 | No TTY → pause (approves nothing); `--yes` unchanged | AC-77 |
| OQ-6 | Gates always re-evaluated on resume | AC-39, AC-75 |
| OQ-7 | `~/.claude/agents/` out of scope; operator symlinks those copies after merge | AC-26, AC-27 (repo only) |
| OQ-8 | Validator rounds have their own bound (2) and don't consume builder attempts; normal attempt rule within a round; shared files routed by the frontend-file heuristic | AC-32, AC-69, AC-70 |
| OQ-9 | Injectable CLI entry point | AC-63; all [C] criteria |

Story Writer interpretations accepted at Checkpoint 1:
- **AC-70** — the within-round attempt bound is per round.
- **AC-75** — for CP3, "owning builder(s)" = every builder that modified files in the diff; the gates through the Validator re-run before CP3 is presented again.
- **AC-65** — the baseline file sits outside run directories, so archiving never moves it.

---

## Out of Scope

- Global `~/.claude/CLAUDE.md` changes and MemoryKit cleanup.
- Any edit to `~/.claude/agents/` (operator replaces those copies with symlinks after merge).
- Memory storage by the consolidator (done in the operator's session, outside the factory).
- Loop-backs on Gate 2 or Test Verifier failure (Phase B).
- Changing `--yes`.
- **Phase B:** parallel validator, targeted builder tests, orchestrator-owned commits, parallel builders, skeptic step.
- **Phase C:** AC IDs across the whole chain, tests-first, mutation testing, risk tiers, cost traces.
- **Phase E:** distribution.
- The README diagram (README path fixes, AC-26, are in scope).
- Creating PRs, pushing, branch cleanup.
- Locking against simultaneous run starts.
- Aggregate cost/budget caps (GAP-3); builder sandboxing (GAP-5).
- Enforcing SDK `Read` access to `~` paths (deeper half of GAP-1).
- A special leftover-files briefing when resuming in Stage 3.

---

## Definition of Done

- Every AC (AC-1..AC-79) is covered by at least one test or source check whose title names the AC ID.
- `npm test` and `npm run typecheck` pass (the repo has no lint script).
- The SKILL.md drift test (AC-59, AC-79) passes.
- The untracked root scripts are deleted (AC-61).
- Per PR: A-1 delivers groups F, G, P, V, C (except AC-61, AC-79, and the writing side of AC-65); A-2 delivers groups R, K plus AC-61, AC-65 (writing side) and AC-79.

─────────────────────────────────────────────────────────────────
✅ CHECKPOINT 1 — STORY REVIEW — APPROVED (operator, 2026-10-04)
─────────────────────────────────────────────────────────────────
