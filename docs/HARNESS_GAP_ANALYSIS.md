# Harness Gap Analysis

**Date:** 2026-09-20 · **Branch:** `feat/phase-0a-harness-ci` · **Method:** read the code, not the docs.

This is a diagnosis, not a plan. `REFACTOR_PLAN.md` says what we intend to build; this says what
is actually wired up right now, with file and line evidence for every claim.

It scores the harness against two models:

1. **The seven jobs of an agent harness** — contract, context, tools, state, sensors, policy,
   traces. The jobs a harness must do so that one model call becomes a controlled system.
2. **The recovery loop** — run, observe, classify, repair, verify, accept; and the second loop
   underneath it, where a failure becomes a permanent harness change rather than a patch.

Neither model competes with the Feature Factory. The Factory is the assembly line — eight agents,
five stages, three checkpoints. These are the chassis the line bolts to, and the repair bay it
rolls into when a station fails. We built most of both without the diagrams; this records which
parts are load-bearing and which are decorative.

---

## Summary

| # | Job | Status |
|---|---|---|
| 01 | Contract — goal, limits, done | **Strong** |
| 02 | Context — maps, rules, facts | **Broken** — see GAP-1 |
| 03 | Tools — sandbox, shell | **Strong**, with one soft edge (GAP-5) |
| 04 | State — artifacts, decisions | **Strong** — GAP-2 fixed 2026-09-20 |
| 05 | Sensors — tests, logs | **Strong** |
| 06 | Policy — scope, approval, budget | **Partial** — approval strong, budget absent (GAP-3) |
| 07 | Traces — events, cost, rollback | **Partial** — the run record exists (GAP-2); no cost ledger, no rollback (GAP-3, GAP-4) |

Recovery loop: the top row (run → observe → classify → repair → verify) is complete and good.
`accept` ships without a receipt. The permanent-harness-update loop underneath runs on human
conscientiousness and nothing else.

---

## 01 — CONTRACT · Strong

An agent's contract is enforced in three independent places, none of which is prose:

- **Its instructions.** `loadAgentContract()` in
  [`factory/runner/agent-registry.ts`](../factory/runner/agent-registry.ts) reads
  `factory/feature/agents/<agent>.md` and it becomes the system prompt verbatim. An agent with no
  contract file cannot run — the harness refuses to invent a system prompt for it.
- **Its output shape.** `outputFormat: { type: 'json_schema', ... }` in
  [`factory/runner/invoke-agent.ts`](../factory/runner/invoke-agent.ts). The SDK retries the model
  until the envelope is valid, so a malformed response never reaches the gates.
- **Its definition of done.** `stageContracts` + `canAdvanceStage()` in
  [`factory/harness/stage-gates.ts`](../factory/harness/stage-gates.ts). Functions returning
  `false`, not instructions asking nicely.

`REQUIRED_ARTIFACTS` deserves a specific mention. A live Researcher once named its report
`RESEARCH.md` and was blocked, having done the work correctly; on a previous run the same agent
had happened to guess `RESEARCHER_REPORT.md`. That was our bug, not the agent's — the gate demanded
an exact filename nothing ever told it. The fix compiled the names into the JSON schema as an enum,
so guessing became impossible. That is the correct shape of a fix: the class of failure was
removed, not the instance.

**Soft spot.** "Limits" in this job means more than `maxTurns: 40` (`DEFAULTS` in
`invoke-agent.ts`). There is no wall-clock limit and no cost ceiling per agent. See GAP-3.

---

## 02 — CONTEXT · Broken

What works: the artifact chain is real. Read-only agents have no Write tool, so they return
document text in `artifacts[].content` and `persistArtifacts()` writes it to
`.factory/<featureId>/` immediately — not at the stage gate, which is what once left the Spec
Writer with no `USER_STORY.md` to translate. Run-namespaced directories, and `builderPrompt()`
names the four approved files explicitly, because a live Backend Builder found four contradictory
"approved" briefs from four parallel runs and correctly refused to write any code.

What is deliberately excluded: `settingSources: []` in `invoke-agent.ts`. No CLAUDE.md, no user
skills, no machine-local settings. The agent's contract is its only instruction source, so the same
agent behaves identically on any machine. This is right, and it is the reason for GAP-1.

### GAP-1 — Every builder's skill assignment is a dead link

Six agent contracts instruct the agent to read:

```
~/.claude/skills/software/factory/feature/SKILL.md
```

That path does not exist. The global skill lives at
`~/.claude/skills/software/feature-factory/SKILL.md`.

Affected: `01-researcher.md:18`, `03-spec-writer.md:22`, `04-backend-builder.md:20`,
`05-frontend-builder.md:23`, `06-test-verifier.md:24`, `07-validator.md:25`.
(`02-story-writer` is reasoning-only and correctly references nothing.)

So the **Skill Assignments** table in [`factory/feature/SKILL.md`](../factory/feature/SKILL.md) —
`frontend-design` for the Frontend Builder, `test-driven-development` for the builders,
`security-audit` for the Validator — is currently decorative. Every builder's "load and follow your
assigned skills" step silently no-ops.

Nothing caught this because skill loading is prose. There is no gate that asks "did you load what
you were told to load," and a `Read` of a missing path is not an error the harness observes. It
rotted in place.

**Two honest options, and they are genuinely different:**

- *Enforce it.* Ship the skill files into the agent's reachable context and gate on it. Costs
  determinism — the agent now depends on files outside the repo.
- *Delete the table.* Fold the handful of rules that matter directly into the agent contracts,
  which are already the single instruction source. Keeps `settingSources: []` honest.

The current state — a table that claims to assign skills, contracts that point at nothing, and a
runtime that loads neither — is the only option that is definitely wrong.

---

## 03 — TOOLS · Strong

`AGENT_TOOLS` in `agent-registry.ts` is the enforcement of each agent's read-only claim, not a
restatement of it. `01-researcher` is read-only because the table withholds `Write`/`Edit`/`Bash`
and `deniedToolsFor()` denies them explicitly, not because its markdown asks politely.

`permissionMode: 'dontAsk'` denies anything not pre-approved — the only mode that is safe
unattended. Denials are surfaced through `onToolDenied` and logged: an agent reaching past its
contract is not fatal, but it is never silent.

### GAP-5 — The builders' `Bash` is unbounded

`04-backend-builder`, `05-frontend-builder` and `06-test-verifier` hold `Bash`. Nothing pins their
writes to the target project root. The diagram's word for this job is *sandbox*; what we have is a
tool grant, which is a different thing.

We have already been bitten adjacently: a documented incident where a git worktree was used as an
isolated agent sandbox and was not one. Low likelihood, high blast radius, cheap to bound.

---

## 04 — STATE · Fixed 2026-09-20

**This was the largest gap in the harness, and it was almost entirely already built.**

[`factory/harness/state-tracker.ts`](../factory/harness/state-tracker.ts) models the full run:
`FeatureState` with stage history, loop-backs, typed escalations
(`HALLUCINATION_DETECTED`, `INFRASTRUCTURE_FAILURE`, `EXECUTION_FAILURE`, `MAX_LOOPS`, …),
checkpoint approvals, per-stage timings. It exports `serializeState`, `deserializeState`,
`isResumable`, `getRecommendedAction`, `getStateStats`.

### GAP-2 — None of it was ever written to disk *(FIXED)*

What the diagnosis found:

- `state-tracker.ts:9` stated: *"State persisted to JSON file in
  `feature-factory/artifacts/feature-states/`"*. It was not.
- The orchestrator imported `serializeState` and never called it.
- There was no `writeFileSync` anywhere in the orchestrator.
- `deserializeState`, `isResumable` and `getRecommendedAction` had no caller in the codebase.
- `OrchestrationOptions.resumeFromState` existed and was honoured on the first line of
  `runFeatureFactory` — but nothing could ever produce a `FeatureState` to pass to it.

The consequence: a forty-minute run that escalated at Stage 4 left behind the builders' files and
nothing else. No record of which gate failed, which agent looped how many times, which checkpoints a
human approved, or what it cost. The resume seam was designed, documented and unreachable.

**The fix.** [`factory/harness/state-store.ts`](../factory/harness/state-store.ts) is the missing
write: `saveState` / `loadState` / `stateFilePath`. `state-tracker.ts` stays pure, so transitions
remain testable without a temp dir.

The write is **durable**, not merely atomic — write to a temp file in the same directory, fsync
it, rename over the target, fsync the directory. `rename(2)` alone guarantees only that a reader
sees the old complete file or the new complete file, never a torn one; it guarantees nothing about
the bytes reaching the device. Without the fsyncs a power loss can leave a rename that survived and
contents that did not — a zero-length `state.json` that every reader agrees is current, which is
worse than no file at all. That matters more here than usual, because `saveState` now fails the run
closed: hard-failing on a bad write while leaving a silently empty file behind would be loud when
the disk is broken and silent when the data is gone. (Directory fsync is best-effort; some
platforms reject it on a directory handle, and that is not a reason to fail the save.)

Being killed mid-save is not exotic in this harness. Ctrl-C at a checkpoint is a *normal* way to
end a run, because a checkpoint is exactly where a human sits and decides not to continue.

The orchestrator decides *when*, and where it saves is the design:

- `commit()` wraps exactly the transitions a resume can restart from — a completed agent step and
  a stage advance. Nothing finer is saved because nothing finer is resumable.
- `finish()` replaces all 27 `completeFeature` call sites, so **every** terminal outcome leaves a
  record: twenty-six escalations and the one success. "A finished run always has a state file" is
  true by construction rather than by remembering to add a save next to each `return`.
- A failed save **fails the run closed**, like everything else here. An earlier draft warned and
  continued, reasoning that losing resumability was cheaper than discarding completed agent work.
  That traded the wrong thing away: every guarantee this harness makes is a guarantee about
  *evidence*, and a run that cannot write its record produces none — it keeps spending, keeps
  writing code into the project, and arrives at an outcome nobody can audit. Stopping costs the
  work in flight; continuing costs that plus everything spent after plus any way to reconstruct
  what happened. The orchestrator rethrows rather than recording a phantom escalation into a state
  it cannot persist, so the CLI exits non-zero with the real reason.

`npm run factory -- --feature "..." --resume <featureId>` now consumes it. A missing state file is
a hard error, never a quiet fallback to a fresh run.

Covered by [`state-persistence.test.ts`](../factory/test/harness/state-persistence.test.ts),
including that progress is durable *mid-run* (asserted from inside the invoker, at the moment the
Spec Writer is called), that a corrupt file throws rather than resuming from a guess, that a run
which cannot be recorded stops rather than returning a verdict nothing on disk backs up, and that
no `.tmp` scratch file is left in the run directory on either a successful or a failed save.

Job 07 is partially lifted as a result: the run record is the receipt the accept step was missing.
Cost (GAP-3) and rollback (GAP-4) remain open.

---

## 05 — SENSORS · Strong

The gates read reality, and the fight to make that true is recorded in
[`factory/harness/stage-context.ts:9-17`](../factory/harness/stage-context.ts#L9-L17): the
orchestrator used to fabricate the very context the gates judged, hardcoding `testPassRate: 1.0`
and `criticalIssuesCount: 0`. The gates were real code judging invented evidence, so the two
CRITICAL criteria could never fail. Replacing the mocked agent alone would not have fixed it — the
context was the other half of the moat.

Now: `buildStageContext()` derives every gate input from an agent's output or the filesystem, and
nothing defaults to a passing value. Alongside it,
[`execution-gates.ts`](../factory/harness/execution-gates.ts) runs the actual test suite, the actual
build and the actual dev server; `infrastructure-gates.ts` verifies the project can be built in at
all; `verifyArtifactMaterialization()` checks every claimed file against `fs`.

`HARNESS_PERSISTED_AGENTS` in `stage-context.ts` excludes the builders on purpose. If the harness
wrote a builder's files for it, the materialization gate would be verifying its own handiwork and
the anti-hallucination guarantee would be worth nothing.

**Soft spot.** No screenshot sensor on the feature path. The e2e harness has browser evidence; the
feature harness is blind to anything that is visually wrong but technically passing.

---

## 06 — POLICY · Partial

**Scope: strong.** Tool grants, per above.

**Approval: strong, and hard-won.** The orchestrator used to log
`"⏸️ CHECKPOINT 1: Awaiting story approval"` and then immediately record its own approval. It never
waited for anyone. The system advertised a human-oversight guarantee it did not have — and a live
Spec Writer noticed, refusing to proceed because "Checkpoint 1 would have been skipped silently."

It now fails closed. No approver configured → escalate. No TTY → escalate
([`cli.ts`](../factory/runner/cli.ts)). `--yes` must be typed, because a checkpoint you can skip by
forgetting to configure something is not a checkpoint.

### GAP-3 — No budget, anywhere on the feature path

`invoke-agent.ts` prints `total_cost_usd` per agent and discards it. It is never accumulated,
never compared against a ceiling, never persisted.

**Partially addressed 2026-09-20.** `createSdkInvoker` used to take **one** model and **one**
effort for the entire chain, so `02-story-writer` — read-only, granted nothing but `Read`, whose
whole job is turning a report it is handed into three Given/When/Then criteria — was billed
identically to `04-backend-builder` writing a migration against an unfamiliar schema.
`AGENT_COST` in [`agent-registry.ts`](../factory/runner/agent-registry.ts) now sets model, effort
and turn budget per agent, the same way `AGENT_TOOLS` sets tool grants: one table, decided once,
enforced by the runner. `--model` still forces one model across the chain for A/B runs.

That lowers the floor cost of every run. It is **not** a budget: nothing yet stops a run from
exceeding a ceiling, because there is no ceiling.

The only bound on a run is `maxTurns: 40` per agent. A Stage 3 loop-back cycle can run three builder
attempts plus test re-runs with no aggregate limit on cost or wall-clock time.

The pieces already exist one directory over:
[`factory/e2e/harness/remediation-engine.ts:18-22`](../factory/e2e/harness/remediation-engine.ts#L18-L22)
has `maxTokensPerIteration`, `maxTotalTokens` and `timeoutMs`. They were never ported to the feature
orchestrator.

---

## 07 — TRACES · Missing

Everything goes to `log()` → console. On completion the orchestrator prints total time and loop
count, and the process exits. Every number needed for a trace is computed and then dropped:
per-agent turn counts and cost, denied tool attempts, gate decisions with their blockers, typed
escalations, checkpoint approvals with timestamps.

Since 2026-09-20 one thing does survive: the run record written by `state-store.ts` (GAP-2), which
carries the stage history, the typed escalations and the checkpoint approvals. What is still
dropped is the cost and turn counts per agent, the denied tool attempts, and the gate decisions
with their blockers.

### GAP-4 — No rollback path

There is no `git rev-parse HEAD` before Stage 3. When a run escalates after the builders have
written code, the half-built change sits in the working tree and nothing tells you how to get back.

The right fix is a recorded marker and a printed revert command, **not** an automatic revert. An
agent harness that destroys uncommitted work on its own initiative is a worse failure than the one
it is cleaning up after.

---

## The recovery loop

| Step | Where | Status |
|---|---|---|
| Run | `invokeAgent` | Strong |
| Observe | `execution-gates.ts`, `TestSnapshot` | Strong |
| Classify | `error-categories.ts` | **Strongest part of the repo** |
| Repair | builder loop-backs (max 3), remediation engine (max 5) | Strong |
| Verify | re-run gates + `detectRegressions()` | Strong |
| Accept | Checkpoint 3 → PR | Partial — ships without a receipt (GAP-2) |
| Fail → exact gap → bounded retry | `getRemediationInstruction()`, `MAX_LOOPS` | Strong |

**On classify.** `analyzeError()` returns `{ category, fixClass, confidence, requiresManualReview }`
— the gap named as a typed value rather than a vibe, which is what makes an automated repair
attempt legitimate instead of a guess.

The header of [`error-categories.ts`](../factory/harness/error-categories.ts) is worth reading
before anyone "simplifies" it. There are two domain-specific taxonomies — compile/test failures here,
browser/infrastructure failures in `factory/e2e/` — and an earlier audit wrongly flagged them as a
forked harness to be merged. `analyzeError()` is first-match-wins, so flattening the tables would let
a generic pattern shadow a specific one. That is not hypothetical: it is the bug this file already
had, where `MISSING_IMPLEMENTATION`'s `/does not exist/` swallowed `column X does not exist` and
returned `IMPLEMENT` instead of `CREATE_MIGRATION`.

### GAP-8 — The builder loop classified nothing, and told the retry nothing *(FIXED 2026-09-20)*

Found while tracing where a run's tokens actually go. Two faults, stacked.

**The classifier never ran.** `validateOutputSchema` does semantic validation, not just envelope
shape — `OUTPUT_SCHEMAS.md` describes it as checking "the output is *acceptable work*", and it
counts `testsFailed > 0` as an error: `"Builder has failing tests: N"`. The builder loop checked
schema validity first and `continue`d on failure. So a builder reporting a failing test was
classified as having returned a **malformed envelope**, and the branch below — the one calling
`analyzeError()` — was unreachable. `analyzeError` in the builder loop was dead code from the day
it was written, which is why nobody noticed the second fault:

**The retry was blind.** Each attempt is a *fresh* agent invocation: new context, no transcript of
the one before. All attempt 2 received was

> *"This is attempt 2 of 3. A previous attempt failed — fix it, do not start over."*

Not what failed. `getRemediationInstruction()` existed to format exactly that briefing, was
imported by the orchestrator, and was never called — the same dead-import shape as
`serializeState` in GAP-2. So attempt 2 began blind and its first move had to be re-running the
suite to rediscover what attempt 1 had already found. Up to six full agent contexts per run, each
re-paying the contract and re-reading four artifacts, to re-derive a known answer.

This is the dashed line in the recovery loop: **FAIL · RETURN THE EXACT GAP · RETRY WITH A BOUND.**
The bound was real. The exact gap was being dropped on the floor.

**The fix.** Failing tests are now checked *before* schema validation, because a builder that
honestly reports one has satisfied its contract exactly — that is a work result with a designed
remediation path, not a contract violation. The schema check still catches genuinely malformed
envelopes. `retryBriefing()` then carries the classification into the next attempt's prompt:
category, fix class, confidence, the error text, and an explicit instruction not to re-run the
suite to rediscover it. A schema failure gets its own briefing; an unnamed failure says plainly
that the harness could not classify it rather than implying a diagnosis.

Same family as the gate-ordering fixes already in the history (*"block on missing implementation,
not on a test filename"*): the check was real, it just ran against the wrong thing at the wrong
time.

### GAP-6 — "Failure becomes infrastructure" is a habit, not a mechanism

The second loop — where a failed run produces a permanent harness change rather than a patch — is
the thing this repo does best and automates least.

The recent commit history *is* that loop, executed by hand:

- *"the file-list gate compared counts, which is not a gate"*
- *"two more gates were auditing the harness's repo, not the project"*
- *"block on missing implementation, not on a test filename"*
- *"CRITICAL must mean 'the pipeline cannot run', not 'the repo offends me'"*
- *"the builder refused to build, and it was right"*

Every one names a class of failure and removes it. The `RESEARCH.md` fix (01) is the pattern in its
purest form. The incident narratives preserved in the file headers are the "add a guide" arm of the
loop, and they are genuinely effective — they are why this analysis could reconstruct the reasoning
behind decisions that look arbitrary from the outside.

But there is no mechanism. It happens because a human reads a failed run and decides to fix the
class. Agent 08 (Feature Consolidator) plus memory is the only automated arm, and it improves the
**agents' future prompts** — not the **harness's gates**. Nothing closes the loop from "this run
escalated" to "was there a gate for this class of failure, and should there be."

### GAP-7 — A test file that tests nothing

[`factory/test/orchestrator.test.ts`](../factory/test/orchestrator.test.ts) is 404 lines that import
no source module. Every test defines an object literal and asserts on the literal it just wrote:

```ts
const gateDecision = { canAdvance: false, passRate: 60, blockers: [...] };
expect(gateDecision.canAdvance).toBe(false);
```

Its docblock claims coverage of "Full 5-stage execution flow", "Gate validation between stages",
"Loop-back handling", "Escalation on failures" and "State persistence". It covers none of them, and
it passes, which is worse than not existing — it is green CI reporting confidence that was never
earned. This is precisely the false-coverage failure the execution gate exists to catch in *user*
projects, present in our own test suite.

[`factory/test/harness/checkpoints.test.ts`](../factory/test/harness/checkpoints.test.ts) is the
correct pattern: it imports `runFeatureFactory`, drives it against a temp directory with a scripted
invoker, and asserts on real behaviour.

---

## Fixes, ranked by leverage

1. ~~**Wire state persistence (GAP-2).**~~ **DONE 2026-09-20.** `state-store.ts`, `commit()`/
   `finish()` in the orchestrator, `--resume` in the CLI, 11 tests. Closed job 04 and gave the
   accept step its receipt.
2. ~~**Tell the retry what failed (GAP-8).**~~ **DONE 2026-09-20.** Also made `analyzeError`
   reachable for the first time. The only change here that cuts cost *and* improves quality.
3. ~~**Per-agent model and effort (GAP-3, partial).**~~ **DONE 2026-09-20.** `AGENT_COST` in the
   registry. Lowers the floor cost of every run; not a ceiling.
4. **Run ledger (GAP-3 / 07).** Per-agent turns and cost, denied tools, gate decisions with their
   blockers. Every number is already computed and still dropped. Now cheap: the run record exists,
   so this is adding fields to a file that is already written.
5. **Budget ceiling (GAP-3).** Port `maxTotalTokens` / `timeoutMs` from `remediation-engine.ts` to
   the feature orchestrator. A circuit breaker, not a saving — it caps the worst case and changes
   nothing about a healthy run.
6. **Rollback marker (GAP-4).** Capture HEAD before Stage 3; print the revert command on escalation.
   Never revert automatically.
7. **Resolve the skill contradiction (GAP-1).** Enforce the assignments or delete the table. Not both.
8. **Bound the builders' shell (GAP-5).**
9. **Delete or rewrite `orchestrator.test.ts` (GAP-7).** Deleting it is strictly better than keeping
   it, because it currently subtracts information.
10. **Make the harness-update loop a step (GAP-6).** On escalation, emit a gap record: what class of
    failure, was there a gate for it, should there be. Turns the discipline into a mechanism.

Items 4–6 are one focused session. Item 10 is the one that changes the system's character.

**On cost specifically.** Items 2 and 3 are the ones that reduce spend. Item 5 does not — it only
bounds it. The single full-suite run at the execution gate is not a cost problem: it executes once,
via `execSync` in the harness rather than inside an agent, so its output never enters a model
context. It costs wall-clock, not tokens.
