# RESEARCHER_REPORT — Phase B

> Agent 01 (Researcher), by-hand mode, read-only. 2026-10-05, against `main` at 0b3ce27.
> Saved verbatim by the orchestrating session from the Researcher's hand-back.
> Several recommendations below are SUPERSEDED by operator decisions — see `B_DECISIONS.md` (notably B1 isolation direction, budget cap, docs scope).

Skill loaded: `~/.claude/skills/software/architecture-patterns.md` (first Read succeeded). HEAD as given: 0b3ce27. This was read-only: I ran no commands, so nothing here was measured (suite time, the fsync cost and git's pathspec behaviour are taken from the docs or reasoned from the code, and flagged as such).

**Path abbreviations.** All are under `/Users/enriqueibarra/cypher-claude-skills/`:
- orch = `factory/feature/workflows/feature-factory-orchestrator.ts`
- EG = `factory/harness/execution-gates.ts`
- CD = `factory/harness/change-diff.ts`
- RL = `factory/harness/run-lifecycle.ts`
- ST = `factory/harness/state-tracker.ts`
- SC = `factory/harness/stage-context.ts`
- cli = `factory/runner/cli.ts`
- IA = `factory/runner/invoke-agent.ts`
- AR = `factory/runner/agent-registry.ts`
- RH = `factory/test/contracts/repo-hygiene.test.ts`
- DD = `factory/test/contracts/doc-drift.test.ts`

## 1. Summary
1. **B3 reverses a rule that is approved and tested.** AC-45 says the factory never commits. It is enforced by the RH:298-335 source scan (only CD spawns git, and only with `rev-parse|diff|ls-files`). It is also stated at orch:220-221, CD:13-14 and SKILL.md:122-123 and :168-169. Today nothing commits: neither builder contract mentions git, and no harness code commits.
2. **A Stage 3 commit leaves the CP3 diff text the same, as long as it is in the past and nothing is committed between a pause and `--approve`.** The diff is `git diff <base>` against the working tree (CD:225). Where the commit lives matters: on the user's branch with a porcelain commit, or on a private ref with plumbing. That is the main open design question.
3. **B2 can only be instructed, not enforced.** The Stage 3 "Unit Tests Pass" check uses the builder's own counts (SC:427-431). The harness never sees which tests a builder ran.
4. **MINOR-1, -2 and -3 are all confirmed in EG.** Locations: :490 and :249 (MINOR-1), :222-241 (MINOR-2), :321-345 (MINOR-3). Fixes are limited because EG may import only node built-ins (execution-gates.test.ts:520-529) and RH:199-207 bans spawnSync and Promise.all there.
5. **NEW-MINOR-1, MINOR-8, the bidi gap and the case-sensitive pathspec are all confirmed.** Two existing assertions pin current behaviour: run-lifecycle.test.ts:194 (MINOR-8) and cli.test.ts:371-379 (bidi).
6. **The doc errors are much wider than the two STAGE_CONTRACTS lines.** All five `factory/feature/docs/*.md` files and most of STAGE_CONTRACTS, STATE_TRACKING and OUTPUT_SCHEMAS are stale (§3.11).
7. **B1 changes the Stage 4 order.** At least 23 agent-order assertions in 7 test files, plus orchestrator-gates.test.ts:562-589 (AC-23: "Gate 2 before the Validator"), will break. The Test Verifier's output has no `filesModified` list.
8. **B5 targets "CRITICAL/HIGH", but no HIGH severity exists in the code.** The Validator's severities are CRITICAL, IMPORTANT and MINOR (`factory/runner/output-schemas.ts:314`).
9. **C5: the SDK already reports cost, but the harness throws it away.** Each result carries `total_cost_usd`, including failed results (sdk.d.ts:4153, :4183). IA:219 logs it and drops it; failed invocations record nothing (orch:643-644). SDK 0.3.207 also offers a per-query `maxBudgetUsd` and a `sandbox` option.
10. **A budget-cap pause does not fit the current PAUSED state.** PAUSED is tied to a checkpoint (RL:72-82, RL:167-197, ST:781-802). Pausing on a budget cap would reshape lifecycle, CLI and drift tests; an escalation plus a grant, like `--grant-attempts`, fits what already exists.

## 2. Files identified
| Path (absolute) | Role | Items |
|---|---|---|
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/workflows/feature-factory-orchestrator.ts | Sequencing, commit(), timedInvoke, Stage 3/4, validator loop, rework, CP3 | B3,B2,B1,B5,C5,B4,NEW-MINOR-1 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/change-diff.ts | Only git spawner; CP3 change; PATHSPEC | B3,pathspec,B1 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/execution-gates.ts | Gate 2 runner | MINOR-1/2/3, B2 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/safe-write.ts | writeFileAtomic (fsync) | suite time |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/state-store.ts | saveState → writeFileAtomic | suite time |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/run-lifecycle.ts | classifyRun, checkResumeRequest, exhaustedBuilder, resumeDescription | MINOR-8, NEW-MINOR-1, GAP-3 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/state-tracker.ts | FeatureState, recorders | B3, C5, GAP-3, MINOR-8 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/run-progress.ts | Skip rule, rebuildOutputs | B1, B5 (resume) |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/stage-context.ts | Gate inputs (testPassRate, criticalIssuesCount) | B2, B5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/stage-gates.ts | Stage contracts | B2, docs |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/validator-routing.ts | CRITICAL routing, merge | B5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/agent-prompts.ts | Builder/TV/Validator prompts | B2, B1, B4 |
| /Users/enriqueibarra/cypher-claude-skills/factory/harness/upstream-artifacts.ts | UPSTREAM_FOR_AGENT | B1, B5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/runner/cli.ts | CLI, printableForTerminal, CLI_FLAGS | bidi, NEW-MINOR-1, GAP-3 |
| /Users/enriqueibarra/cypher-claude-skills/factory/runner/invoke-agent.ts | SDK invoker (cost, cwd, dontAsk) | C5, GAP-3, GAP-5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/runner/agent-registry.ts | AGENT_STAGE/TOOLS/COST | B5, B1, GAP-5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/runner/output-schemas.ts | Per-agent JSON schemas | B1 (TV files), B5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/workflows/consolidate-run.ts | Second invoke site | C5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/agents/04-backend-builder.md, 05-frontend-builder.md | Builder contracts | B2, B3, B4 |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/agents/06-test-verifier.md, 07-validator.md | TV/Validator contracts | B1, B5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/SKILL.md | Program docs + factory-claims block | all |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/reference/{STAGE_CONTRACTS,STATE_TRACKING,OUTPUT_SCHEMAS}.md | Stale reference docs | docs |
| /Users/enriqueibarra/cypher-claude-skills/factory/feature/docs/{README,ORCHESTRATOR,QUICK_START,STAGE_GUIDE,ARCHITECTURE}.md | Stale docs | docs |
| /Users/enriqueibarra/cypher-claude-skills/README.md (:91-103) | "five stages" section | docs |
| /Users/enriqueibarra/cypher-claude-skills/docs/REFACTOR_PLAN.md | Phase 0–3 naming; no ROADMAP.md exists | ROADMAP |
| /Users/enriqueibarra/cypher-claude-skills/factory/test/contracts/{repo-hygiene,doc-drift}.test.ts | Guard and drift tests | all |
| /Users/enriqueibarra/cypher-claude-skills/factory/test/fixtures/{harness-run,changes,gates}.ts | runToEnd, fakeChangeTracker, recordingGates | B3, B1, C5 |
| /Users/enriqueibarra/cypher-claude-skills/factory/test/harness/*.test.ts, factory/test/runner/cli.test.ts | Callers (§3.13) | all |

## 3. Per-item findings

### 3.1 B3 — orchestrator-owned commit after Stage 3
**Current behaviour**
- Nothing in the factory commits.
- Builder contracts say nothing about git. 04-backend-builder.md:64-70 and 05:68-74 list typecheck, lint and tests only. Both builders have Bash (AR:41-42), so nothing stops them committing.
- The only git spawner is CD:87-109: `spawnSync`, argv only, the `GitSubcommand` type at CD:71, with GIT_DIR, GIT_INDEX_FILE and similar variables stripped at CD:91-93.
- RH:298-335 enforces this. It forbids the literals `'commit'` and `'push'` and `git commit`. It requires exactly one file to spawn git (CD) with exactly one `spawnSync`, and it requires the subcommand set {rev-parse, diff, ls-files}.
- The no-commit rule is also asserted in prose at orch:220-221, CD:13-14 and SKILL.md:122-123 and :168-169.

**What a commit does to the CP3 change**
- The change base is captured once, on a fresh run only (orch:468-474). A resume never captures it again (SKILL.md:253).
- `collectGit` diffs `<base>` against the working tree (CD:224-226), so committed and uncommitted changes look the same. change-diff.test.ts:84 already covers "a builder committed this". The diff text is therefore the same whether or not the Stage 3 work is committed.
- One thing does change. Files that were untracked move from the "Untracked files" section (describeFile, which shows sha256 and content) into the tracked diff hunks. This is consistent as long as every CP3 presentation comes after the commit.
- Risk: if a commit happens after a pause and before `--approve 3`, the hash differs and the approval is refused as ARTIFACT_CHANGED (orch:2199-2216). That fails closed. The same holds for the approved-CP3 check (I-7) at orch:2227-2247.

**Resume, validator rounds and rework**
- The Stage 3 gate passes at orch:1511, then `advanceToStage(4)` is committed at :1515.
- Validator rounds re-run Gate 1 and the Stage 3 gate inside Stage 4 (orch:1663-1669), and so does CP3 rework (orch:2021-2023). The plan does not say whether these commit again, amend, or add a new commit (Q2).
- Kill window: if the process dies after the git commit but before state is saved, the resume re-runs the Stage 3 gate and tries to commit again. The commit must be idempotent: compare tree hashes, or record the sha first.

**Outside a git work tree**
- `captureBase` returns `{kind:'none'}` (CD:186-189). No commit is possible, so B1 needs a filesystem copy instead. An unborn branch (`{kind:'git'}` with no commit) allows a root commit.

**Constraints and hazards a porcelain `git commit` would bring**
- Hooks run (pre-commit, commit-msg, post-commit; `-c core.hooksPath=/dev/null` disables all of them).
- `commit.gpgsign` can prompt or fail.
- `user.name` / `user.email` may be missing.
- It moves the user's branch.
- `git add -A` would sweep pre-existing operator changes into the factory's commit. Those changes are shown at CP3 by design (I-4, CD:7-9).
- `.factory/` must be excluded, with the same case issue as §3.9.

**A plumbing alternative**
- Steps: a temporary GIT_INDEX_FILE with `read-tree HEAD`, then `add -A -- . :(exclude).factory`, `write-tree`, `commit-tree`, `update-ref refs/factory/<id>/...`.
- It never touches the user's branch, index or working tree.
- It still needs `-c core.hooksPath=` (`update-ref` fires the reference-transaction hook), `-c commit.gpgsign=false`, and an author identity.

**No "lost commit", "#426" or "commit race" reference exists in the repo** (search of everything except `.factory/_archive`). The only nearby record is the worktree incident (docs/HARNESS_GAP_ANALYSIS.md:130-131; docs/factory-runs/phase-a/RESEARCHER_REPORT.md:40).

**What must change**
- An approved git-write path (extend `GitSubcommand` in CD, or move `git()` into a new module and update RH:323-334).
- A new `ChangeTracker` method so tests stay offline.
- New state fields for the snapshot sha(s).
- Contracts 04/05 must say "never commit, push or switch branches".
- Docs and the guard test must be rewritten, and the "never commits" sentences retired.
- Optional, B-1 scope: check that HEAD equals what the harness expects before committing (detects a builder commit).

**Tests affected**
- RH:298 (AC-45).
- change-diff.test.ts (whole file).
- checkpoint-lifecycle.test.ts:540-541 and resume.test.ts:280 pin the exact tracker call sequence.
- `fixtures/changes.ts:14-20`: FakeChangeTracker must implement the new method.
- Every test that reaches Stage 4 through runToEnd.

### 3.2 B2 — builders run only related tests; the full suite runs in Gate 2
**Current behaviour**
- Contract 04:66-68 says "run only the backend test suite". Contract 05:70-72 says "the frontend/component test suite".
- The builder prompt contains no test instruction (agent-prompts.ts:303-348). Retries are told "do not re-run the full suite merely to rediscover it" (agent-prompts.ts:133-134).
- **Stage 3 "Unit Tests Pass" is the builder's own report** (stage stage-gates.ts:239-244, :621-632): `testPassRate = Σ testsPassed / Σ testsWritten` (SC:427-431). If testsWritten is 0, the rate is 0 and the check blocks, even for a builder that only edited existing code. That is a pre-existing false-block risk; the round-merge mitigation at validator-routing.ts:126-132 applies only to rounds and rework.
- Gate 2 runs `npm run test` (the full suite) once per evaluation: round 0, plus every validator round (orch:1707-1709; EG:419-454, :660-687).

**How "related tests" could work mechanically**
- Jest: `jest --findRelatedTests <files>`. Vitest: `vitest related <files> --run`.
- The project's `test` script is arbitrary, so the harness cannot know the runner (C-8 rejected `--json` for the same reason).

**What can be enforced:** nothing about what the builder runs; it has Bash. What can be done:
1. Contract and prompt wording.
2. Optionally pass the brief's FILE_LIST paths in the prompt.
3. Measure the effect only through `agentInvocations` durations.

**Tests affected:** agent-prompts.test.ts (18 builderPrompt/TV/Validator calls) and retry-briefing.test.ts, if the prompt text changes.

### 3.3 A-1 MINOR-1 — dev script exits 0 early; a daemonised grandchild survives
- `verifyDevServer` fails only if the script exits non-zero before the window ends (EG:488-494). So `"dev":"echo ok"` (exit 0) passes.
- `settle` kills the process group only when the command timed out or failed to start: `if (timedOut || outcome.error) killGroup(...)` at EG:249. A grandchild that outlives a shell exiting normally survives. One that calls `setsid()` escapes the group anyway; that is a limitation to document.
- **Fix options:**
  - Always SIGKILL the group on settle.
  - Treat an early exit 0 as SKIPPED with a warning, or as FAILED (Q6).
- **Constraints:** EG may import only node built-ins (execution-gates.test.ts:520-529). RH:185-207 bans shell `timeout`, spawnSync, execSync and Promise.all in EG.
- **Tests affected:** execution-gates.test.ts AC-13 (:250, :289), AC-14 (:310-375), AC-11/12 (:196-231). SKILL.md:349-352 ("dev ... still running cleanly ... fails if it exits non-zero").

### 3.4 A-1 MINOR-2 — unbounded output buffers
- `stdout += chunk` and `stderr += chunk` with no limit (EG:240-241). A test run can last up to 30 minutes (EG:92).
- **Who reads these buffers, and why a plain tail buffer is not enough:**
  - `parseTestOutput` takes the last summary line (EG:321-345). A tail is fine for Jest and Vitest. Mocha prints its passing/failing counts **before** the failure details (EG:347-356), so a tail can lose them; that fails closed, but as "no tests detected".
  - `parseFailedTestNames` scans the whole output (EG:669).
  - `buildErrors` takes the last 500 characters (EG:672).
  - The report shows the first 500 characters of stderr (EG:632).
  - The dev-server error scan reads every line (EG:484-486).
- Recommendation: a head buffer plus a tail buffer with a truncation marker, plus a streaming line scanner for dev errors and failed-test names (it must handle lines split across chunks).
- The stdout/stderr text is never persisted; `recordGate2` stores counts only (orch:576-589).

### 3.5 A-1 MINOR-3 — a Jest pattern overrides a Vitest summary
- Patterns are tried in a fixed order: Jest at EG:321, then Vitest at :334, then Mocha at :348. Any `Tests: … total` line wins over a real Vitest summary.
- Picking "the last line by position" is not reliable either. The text is stdout followed by stderr (EG:437), not in time order: Jest writes its summary to stderr, Vitest to stdout.
- Options: parse each stream separately, then pick by runner markers ("Test Suites:" for Jest, "Test Files" for Vitest). If the two disagree, fail closed (C-2). See Q7.
- Tests affected: execution-gates.test.ts:106-141 (AC-9).

### 3.6 Suite time
- Every `commit()` (orch:525-528) calls `saveState` → `writeFileAtomic`, which fsyncs both the file and the directory (safe-write.ts:181-220).
- `regression-baseline.ts:192` also fsyncs.
- 171 `runFeatureFactory`/`runToEnd` calls across 12 test files pay this. The figures "~180 s" and "~45 ms per commit" come from the A-2 consolidation report §2; I did not verify them.
- Options:
  - (a) An injected durability or writer seam on `OrchestrationOptions`, defaulting to durable (C-1). Add an RH guard that production never passes it.
  - (b) An environment switch. Not recommended: it creates a production escape hatch.
  - (c) Jest worker tuning or tmpfs.
- Q9 asks for a measurement first (P-14).

### 3.7 NEW-MINOR-1 — the CLI refuses in a different order from the library
- The CLI checks, in order: `liveRunToResume` (RUN_NOT_FOUND, and RUN_FINISHED only for archived runs) at cli.ts:456, then `assertSameDescription` (DESCRIPTION_MISMATCH) at :457, then `resumeDescription` (DESCRIPTION_REQUIRED) at :460-461, and only then `runFeatureFactory`.
- The library checks `checkResumeRequest` (RUN_FINISHED, NEEDS_GRANT, …) at orch:433 before `resumeDescription` at :436.
- Two further findings:
  - **DESCRIPTION_MISMATCH exists only in the CLI** (cli.ts:413-420). That contradicts the cli.ts:16-18 header ("never re-implements" a decision). The library silently prefers the saved description (orch:635).
  - consolidate-run.ts:125 still uses `featureDescription ?? featureName`. That is the lossy fallback listed as A-2 anti-pattern 4. Low priority.
- **Fix:** move the description checks into the library after `checkResumeRequest`. The CLI then needs the description only for its "feature:" banner (cli.ts:464), and `OrchestrationOptions.featureDescription` (orch:337, required) may need to become optional on resume.
- **Tests affected:** cli.test.ts:594, :605, :633, :646; resume.test.ts:323-361; run-lifecycle.test.ts:445-465.

### 3.8 MINOR-8 — a pre-A-2 run gets an extra resume round on MAX_LOOPS
- `exhaustedBuilder` requires `context.builderPhase` (RL:132-133). A pre-A-2 builder MAX_LOOPS escalation lacks it, so `checkResumeRequest` lets a plain resume through (RL:199-212).
- `runBuilderLoop` then finds used = allowed (attempt counts exist since A-1, ST:288). It invokes nobody and re-escalates MAX_LOOPS, this time with `builderPhase` (orch:1015-1023). Only the next resume demands `--grant-attempts`.
- **Fix:** infer the phase. Escalation stage 3 means `stage3`. Stage 4 means `validator-round` with round `validatorRoundsCompleted`; pre-A-2 runs had no rework. Or refuse with NEEDS_GRANT.
- **Tests affected:** run-lifecycle.test.ts:191-196 explicitly pins "MAX_LOOPS without builderPhase (pre-A-2 record) → undefined". Changing it is an assertion change that needs the operator (P-13). SKILL.md:239-243.

### 3.9 Case-sensitive `:(exclude).factory` pathspec
- `PATHSPEC = ['--','.',':(exclude).factory']` (CD:80) is used by `diff` and `ls-files`.
- Scenario on APFS: a pre-existing `.Factory/` directory. The harness's `mkdir('.factory')` resolves into it. The run-directory guard accepts it, because `lstat` sees a directory (run-directory.ts:143-147). Git then lists `.Factory/...`, which the pathspec does not exclude.
- Effect: `state.json` enters the CP3 text, so the hash changes on every save. That fails closed, but makes approval impossible. With B3 it would also be committed.
- Gate 1 already matches case-insensitively (SC:131-141).
- `:(exclude,icase)` would hide a genuinely different `.FACTORY/` on a case-sensitive file system from CP3. That fails open on visibility.
- I could not verify whether `core.ignorecase=true` already makes pathspec matching case-insensitive; that needs a live probe (P-1). See Q8.

### 3.10 Unicode bidi controls not escaped by printableForTerminal
- `TERMINAL_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g` (cli.ts:112). It covers C0, DEL and C1 only.
- Not escaped:
  - U+061C ALM
  - U+200E LRM, U+200F RLM
  - U+202A–U+202E (LRE, RLE, PDF, LRO, RLO)
  - U+2066–U+2069 (LRI, RLI, FSI, PDI)
  - Worth considering too: U+2028/U+2029, U+200B–U+200D, U+FEFF.
- The `\xNN` format (`padStart(2)`, cli.ts:125) would print `\x202E`, which is ambiguous. Use `\u{202E}` or `\u202E` for code points above 0xFF.
- Display only: hashes are taken over the raw text (cli.ts:119).
- **Tests affected:** cli.test.ts:371-379, :382-404, :406. SKILL.md:79-80 ("shown as visible `\xNN` codes").

### 3.11 Doc errors, verified against code
- **STAGE_CONTRACTS.md:61** — `knowledgeStored | the consolidator step`. False: AC-48 removed it (stage-gates.ts:327-343; RH:337).
- **STAGE_CONTRACTS.md:273, :301, :367** — the Knowledge Stored criterion. False, for the same reason.
- **STAGE_CONTRACTS.md other errors:**
  - :60 says `regressionCount` comes from the Validator. False: deliberately not read (SC:469-470).
  - :75-83 lists the Stage 1 CRITICAL criteria as "Architecture Mapped, Files Have Roles, Patterns Found, Risks Flagged". Actual: Researcher Report Complete and Files Identified are CRITICAL; Patterns and Risks are IMPORTANT (stage-gates.ts:177-201).
  - :113-132 lists the wrong Stage 2 criteria (actual: stage-gates.ts:114-166).
  - :160 lists required artifacts BACKEND_BUILDER_SUMMARY/FRONTEND_BUILDER_SUMMARY. Actual: none are required (stage-gates.ts:274-277).
  - :166-171 lists the wrong Stage 3 criteria (actual: stage-gates.ts:232-268).
  - :217 and :228-232 describe regressions as P2 < P1. Actual: a ran-count compared against a ratchet reference (SKILL.md:371-382; regression-baseline.ts).
  - :238-242, :255, :317, :329-330 say "loop back to Stage 3". Actual: the validator round goes to the owning builder and the run stays in Stage 4 (orch:1686-1696). Regressions and Gate 2 failures escalate (loop-rules; orch:1191-1213, :1555-1573).
  - :264-265 lists only CONSOLIDATION_REPORT and says "after PR merged". Actual: CONSOLIDATION_REPORT.md and PATTERNS.md, run on SUCCESS via `--consolidate` (stage-gates.ts:345-347).
  - :312-318 the summary table has no CP3.
  - :326 says an invalid schema means "re-run agent". Actual: only builders retry; everything else escalates (orch:1335-1344).
  - :331 describes an orchestrator timeout. No such timeout exists.
- **STATE_TRACKING.md:**
  - :136 and :167-168 put state at `artifacts/feature-states/`. Actual: `.factory/<id>/state.json` (state-store.ts:75-82).
  - :142, :196, :307 show `feature-factory --resume`. Actual: `npm run factory -- --resume` (cli.ts:5-8).
  - :328 says archiving happens after 30 days. Actual: finished runs are archived on a fresh start (SKILL.md:180-188).
  - :360 describes backups. They do not exist.
- **OUTPUT_SCHEMAS.md:** :100, :167, :214, :308, :387, :441 use `artifacts/stage-N-*/` paths. Actual: documents go to the run directory (`persistArtifacts`). :437 says "knowledge stored".
- **docs/ORCHESTRATOR.md:**
  - :27-37 says "10 Agents". Actual: 8 registered (AR:25-34).
  - :40 and :370 say "Drives all 5 stages, no human needed". Actual: 4 stages plus 3 checkpoints; Stage 5 runs only via `--consolidate`.
  - :286 names `11-reviewer-agent`. It does not exist.
  - :373 says "✅ Auto-fixes applied". The same file says NOT BUILT at :160.
  - :379 says "ten-agent".
- **docs/README.md:**
  - :21 "10-agent chain"; :348 "10 agent definitions".
  - :88 says the Stage 1 gate checks "Architecture documented". It does not.
  - :107 names `BUILDER_SUMMARY.md`. Actual: BACKEND_SUMMARY.md and FRONTEND_SUMMARY.md, rendered by the harness.
  - :118-120 says Stage 5 runs after PR merge and stores knowledge.
  - :188, :335, :403 use the `feature-factory` CLI, which does not exist.
  - :266 and :288-289 "Advance to Stage 5".
  - :299-300 regressions and critical issues "loop back to Stage 3".
  - :361-366 an `artifacts/stage-N` layout.
  - :420 says "production-ready".
- **docs/QUICK_START.md:**
  - :20, :164, :195-209 use `feature-factory`, `--list` and `--status`, none of which are in CLI_FLAGS (cli.ts:49-62).
  - :155 and :159-161 put Stage 5 after merge.
  - :228 says the agent re-runs on an invalid schema. Actual: it escalates.
  - :235-238 says a Stage 3 gate failure loops back. Actual: it escalates (orch:1081-1094).
  - :256-267 says regressions loop back to Stage 3. Actual: they escalate.
  - CP3 is never mentioned.
- **docs/STAGE_GUIDE.md:** :451 and :456-465 have Stage 5 consuming a merged PR. :521 "knowledge stored". Only 2 checkpoints (:157, :340).
- **docs/ARCHITECTURE.md:**
  - :113 and :116 use `feature-factory --resume/--debug`.
  - :246 "all 5 stages".
  - :282-284 shows `detectRegressions` / `escalate('REGRESSIONS')`. That is not how the code works.
  - :428 "2 checkpoints".
- **README.md "The five stages" (:91-103):**
  - :99 says PR review is a human step outside the program. CP3 is now inside the program (orch:2027-2033).
  - :100 shows Stage 5 in sequence. It is not part of a run.
  - The diagram has no CP3, Gate 1.5 or Gate 2.
  - :5 says the run goes "through five stages".
- **SKILL.md residual inaccuracies:**
  - :239-243: a builder that exhausted its attempts "is refused a plain resume". False for pre-A-2 records (MINOR-8).
  - :283-285: "Every agent invocation is recorded". A throwing invocation records nothing (orch:643-644).

### 3.12 B1 / B5 (PR B-2, lighter depth)
**Today's Stage 4 order:** Gate 1.5, then TV (orch:1543-1546), then the validator loop: Gate 2 (:1708), then the Validator (:1711-1718), then the rounds. Then the Stage 4 gate (:1555). The TV is not re-run in rounds.

**Where the TV and Validator outputs go**
- Outputs land in single slots: `outputs.test` and `outputs.validator`. On resume the latest PASS per slot wins (run-progress.ts:145-153).
- So a follow-up 07 invocation recorded as a 07-validator PASS would **replace** the main review. It also overwrites VALIDATION_REPORT.md, which the schema requires by name (AR:121).
- The follow-up therefore needs its own agent id or slot. Adding to AGENT_STAGE triggers the DD:96-119 count and list checks and the 8-agent prose.

**Parallel prompts**
- The Validator's upstream inputs include TEST_REPORT.md (SKILL.md:495). Run in parallel, it would not exist yet.

**Copying the TV's tests back**
- The TV output has no file list (output-schemas.ts:251-280). Copy-back must be measured by the harness (a diff of the copy against the snapshot), and any non-test change rejected.

**Clone or copy**
- `git clone` or `git archive` from the snapshot lacks node_modules and gitignored `.env` files, so the TV cannot run tests there.
- A filesystem copy keeps them. But absolute symlinks (pnpm/workspace) would point writes back into the shared tree — the same class of failure as the worktree incident.

**Mutation testing**
- 06's contract (06-test-verifier.md:59-75) has no mutation step. "TV mutation isolation" applies to the by-hand runs unless the contract adds one.

**B5 hook point and gate interaction**
- Hook point: between `criticalIssues` (orch:1762) and `routeCriticalIssues` (:1805).
- The Stage 4 gate counts CRITICALs from `outputs.validator.details.issues` (SC:460-461). A disproved CRITICAL would still block unless the gate reads a typed verdict.
- Tools: read-only like 07 (AR:44).

**Tests affected:**
- orchestrator-gates.test.ts:562-589 (AC-23 order).
- Exact agent-order assertions (~23 across cli, upstream-artifacts, a2-acceptance-gaps, resume, orchestrator-gates, consolidate, checkpoint-lifecycle).
- validator-loop-back.test.ts gate sequences (:331, :353, :426).
- cli.test.ts:149; resume.test.ts:437, :461.
- upstream-artifacts.test.ts.

### 3.13 C5 / GAP-3 (PR B-3)
**Where invocations are recorded:** `recordAgentInvocation` at orch:652-661 and consolidate-run.ts:139-146 (two sites). ST:113-122 has no cost field.

**Cost**
- IA:219 logs `num_turns` and `total_cost_usd`, then discards them.
- The error path (IA:223-234) drops cost too. The SDK reports cost on error results (sdk.d.ts:4153).
- `AgentInvoker` returns the output only (IA:40). Changing it to `{output, usage}` touches scriptedInvoker (`fixtures/harness-run.ts:98-123`), killAt (:254-271) and every inline `invoke` fake. A side channel avoids that churn.

**Budget cap**
- Per agent: `maxBudgetUsd` (sdk.d.ts:1643) produces an `error_max_budget_usd` result.
- Aggregate: check in `timedInvoke` before each invocation.
- **On a cap hit:**
  - Pause (exit 3) is the operator's preference. It conflicts with today's model: classifyRun treats PAUSED as checkpoint-only (RL:73); approve/reject require `pendingCheckpoint` (RL:167-181); `recordPause` requires checkpoint 1-3 and a sha (ST:781-786); `nextStepHints` PAUSED assumes a checkpoint (RL:253-257).
  - Escalation plus a grant mirrors `NEEDS_GRANT` / `--grant-attempts` (RL:199-206).
  - Any new flag hits cli.test.ts:243 ("exactly the twelve flags"), DD:222-263 and the SKILL.md claims block `cliFlags`.

### 3.14 GAP-5 — builder sandboxing
**Today**
- `cwd: config.cwd`, `allowedTools` from AGENT_TOOLS, `disallowedTools` for mutating tools, `permissionMode:'dontAsk'`, `settingSources:[]` (IA:182-202). No `sandbox`, no `canUseTool`.
- Builders and the TV can edit the `test` script, `.factory/baseline.json` or `.git`, or commit (A1_VALIDATION_REPORT.md:140; A2_VALIDATION_REPORT.md:72).

**What the SDK offers**
- `sandbox` with `filesystem.allowWrite/denyWrite` and network settings (sdk.d.ts:1817, :2664-2670). It applies to Bash. `failIfUnavailable` defaults to true when enabled (sdk.d.ts:1790-1794).
- `canUseTool` (sdk.d.ts:1340) for Write/Edit paths.
- A deny-write on `.factory/` and `.git/` is what makes B3's "builders never commit" enforceable.

### 3.15 B4 — parallel builders
What two builders running at once would collide on:
- **Frontend prompt:** it assumes the backend is already built ("The backend is already built…", agent-prompts.ts:338-341). It reads API_CONTRACT.md, which is rendered only after the backend passes (orch:1487-1488). That is why the plan requires a full API contract in the brief.
- **Shared mutable state:** `state`, `outputs`, `lastAttempts`/`lastAllowed` (orch:841-842), and the commit closure. These are sync between awaits, so the risk is logical, not torn writes.
- **One working tree:** concurrent edits to shared files such as package.json or types; concurrent `npm install`; related-test runs seeing half-written files.
- **One builder escalating while the other runs:** `finish()` is called while an SDK query is still live. There is no abort; the SDK has an `abortController` option.
- **Gate 1:** runs after both (orch:1508).
- **"Full API contract"** has no mechanical test. The spec has `apiContract.endpoints` (output-schemas.ts:~195-213).

### 3.16 Doc-drift and SKILL.md claims block
DD will force:
- `agents` equal to AGENT_STAGE (DD:96-119), if B1 or B5 add agents.
- `cliFlags` and `exitCodes`, if GAP-3 adds flags or a pause (DD:231-263).
- AC-60 needs a line containing "Phase A" + Gate 2 + Test Verifier + "escalate" (DD:206-216). Rewording SKILL.md:401 to "Phase B" breaks it.
- The retired-claims list (DD:164-197) has no "commit" entry, so B3 needs no removal there, but RH:298 must change.

SKILL.md text that Phase B changes:
- :5 (version line)
- :79-80 (bidi)
- :86-95 (the agent table, if agents are added)
- :100-119 (the chain diagram; B1/B5)
- :122-123 and :164-171 (B3)
- :239-243 (MINOR-8)
- :283-285 (C5)
- :336-358 (MINOR-1/3)

## 4. Patterns to follow
- **C-1 injection seams:** `gates`, `changes` and `invoke` (orch:195-204, :397-401). Use the same approach for the snapshot or commit, the copy, durability and cost.
- **C-20 single choke point plus source-scan guard:** git only in CD (RH:323-334); `timedInvoke` the only invoker (orch:646). Extend it; do not add a second spawner.
- **C-16 refuse before any write:** pre-flight outside the try (orch:421-456). NEW-MINOR-1 is the case where the CLI and library diverge.
- **C-15 resume by recorded completion:** snapshot and cost records must be state-driven and idempotent.
- **C-18 two write primitives.** **C-17 rename, never delete:** applies to B1 copies and rollback, so print the command and never revert automatically (GAP-4, HARNESS_GAP_ANALYSIS.md:288-290).
- **C-2 fail closed:** for summary parsing and for a pathspec that cannot be resolved.
- **C-3 trust only harness measurement:** the TV's copied-back files and B5 verdicts must not be self-reported.
- **P-13:** pinned assertions need the operator (run-lifecycle.test.ts:194, RH AC-45, AC-23).
- **P-17:** isolate the TV, never through a worktree.
- **P-20:** every caller list above. **P-1/P-16:** live-probe the pathspec and sandbox behaviour.

## 5. Risks
1. **HIGH — B3 sweeps operator changes into the factory commit.** A porcelain `add -A` commits pre-existing uncommitted operator work (I-4), runs hooks (arbitrary project code), and may hang on gpg. Moving the user's branch is a visible side effect.
2. **HIGH — the B1 copy can leak writes back.** Symlinks in node_modules or workspaces can lead back to the shared tree (the worktree-incident class). A copy without node_modules or `.env` breaks the TV's tests.
3. **HIGH — B1 and B5 resume semantics.** The follow-up or skeptic outputs overwrite the validator slot or VALIDATION_REPORT.md in `rebuildOutputs` (run-progress.ts:145-153).
4. **MEDIUM — B5 could suppress true CRITICALs.** A skeptic is another agent's opinion (C-3). A HIGH severity does not exist.
5. **MEDIUM — the budget pause reshapes PAUSED.** It touches lifecycle, CLI, hints and drift tests (§3.13).
6. **MEDIUM — B2 is unenforceable.** Stage 3 still rests on self-reported counts, and the testsWritten = 0 false-block remains (SC:431).
7. **MEDIUM — the MINOR-2 tail buffer can drop Mocha counts** and the dev-error lines.
8. **MEDIUM — a new snapshot method breaks the fixture.** FakeChangeTracker fails to compile until updated, and the pinned tracker sequences break.
9. **LOW — cost under subscription auth** is notional (README.md:83-87).
10. **LOW — consolidate-run.ts:125** has the lossy description fallback.

## 6. Open questions (my recommended default in brackets)
1. **Where does the B3 commit live?** [A private ref `refs/factory/<id>/stage3-<n>` via plumbing, with a temporary index, `-c core.hooksPath=/dev/null` and `-c commit.gpgsign=false`, and a harness author identity. The user's branch, index and working tree are never touched.]
2. **Commit after every passing Stage 3 gate** (Stage 3, each validator round, each rework), recorded as a list in state? [Yes. B1 copies from the latest.]
3. **What goes into the snapshot when the run started with uncommitted changes?** [The whole tree minus `.factory/`, matching the CP3 diff. Log a warning that it includes pre-existing changes. Do not refuse dirty trees.]
4. **Builder commit detection in B-1?** [Yes, as a read-only check: HEAD must equal the recorded HEAD before snapshotting, else escalate. Hard enforcement comes with GAP-5.]
5. **Outside git,** skip B3 and record why? [Yes; B1 then uses a filesystem copy.]
6. **A dev script that exits 0 early:** [SKIPPED with a warning, recorded as an IMPORTANT finding (not blocking, not PASSED). Always kill the group on settle.]
7. **MINOR-3 resolution:** [Parse each stream; choose by runner marker. If two runner families report different counts, block as "ambiguous test summary".]
8. **Pathspec:** [Keep the exact pathspec. Refuse a run (pre-flight) when cwd has an entry whose lowercase is `.factory` but which is not spelled exactly `.factory`. Live-probe `core.ignorecase` first.]
9. **Suite time:** [Measure first (P-14). Then add an injected non-durable writer for tests only, with an RH guard that production never passes it.]
10. **MINOR-8:** [Infer the phase from the escalation stage. The operator approves the run-lifecycle.test.ts:194 assertion change.]
11. **NEW-MINOR-1:** [Move DESCRIPTION_MISMATCH and DESCRIPTION_REQUIRED into the library after `checkResumeRequest`. The CLI banner reads the state without deciding anything.]
12. **Bidi escape format:** [`\u{XXXX}` for code points above 0xFF. Escape U+061C, U+200E/F, U+202A-E, U+2066-9, U+2028/9 and U+FEFF.]
13. **Doc scope:** the five `factory/feature/docs/*.md` files are mostly fiction. [Replace each with a short pointer to SKILL.md, or move them to `docs/archive/`, rather than line-editing them. Fix STAGE_CONTRACTS, STATE_TRACKING and OUTPUT_SCHEMAS line by line or regenerate them from code.]
14. **ROADMAP.md naming** versus REFACTOR_PLAN "Phase 0-3": [ROADMAP.md uses A-E and maps the old phases into a table.]
15. **B1 mechanism:** [A filesystem copy (APFS clonefile or reflink where available) of the tree at the snapshot, without `.git`. Refuse to proceed if any symlink in the copy resolves outside it. Copy back only new or modified test files found by a harness diff.]
16. **B1 follow-up review:** [A distinct agent id (for example `07b-validator-followup`, read-only) with its own output slot and document name. Accept the AGENT_STAGE and drift-test changes.]
17. **B5 severity scope** (no HIGH in code): [CRITICAL only. A disproved CRITICAL becomes an IMPORTANT finding shown at CP3, never silently dropped. Disproof requires both skeptics to agree.]
18. **Budget cap hit:** [Escalate BUDGET_EXCEEDED, resumable with a grant flag, mirroring `--grant-attempts`. If the operator keeps pause and exit 3, accept the lifecycle redesign in B-3.]
19. **C5 transport:** [Attach usage via a side channel or a wrapper; record cost for failed invocations too, which changes D-13's "a throw records nothing".]
20. **B4 trigger:** [A typed field the spec sets plus explicit operator opt-in at CP2. Each builder runs in its own copy (reusing B1's copy mechanism), merged before Gate 1.]

## 7. Dependencies and the split
- **B-1 internal order:** pathspec fix → B3 (both in CD; B3 snapshots must exclude `.factory` correctly) → B2 (contracts) → doc fixes last (SKILL.md must describe B3).
- **B-2 needs B-1's snapshot sha** (B3) as the copy source. B5 is independent of B1, but both rewrite the validator loop and the same order-pinned tests, so doing them in one PR is right.
- **Possible issue with the split:**
  - B3's "builders never commit" can only be enforced with GAP-5 (B-3), so B-1 can only detect builder commits.
  - B4 depends on B-2's copy mechanism for isolation, and on GAP-5 if each builder is sandboxed.
  - C5 should land before the budget cap; it does, within B-3.
  - If the operator keeps "pause exit 3" for budget, B-3 grows considerably (lifecycle plus CLI plus drift).
  - Nothing in the split is unsafe as ordered.

Status: **PASS.** No blocker makes Phase B unsafe as planned. The HIGH risks (§5.1-5.3) are design decisions the Story Writer must settle; Q1, Q3, Q15 and Q16 matter most.

✓ RESEARCHER COMPLETE
Next step: Story Writer (Agent 2)
