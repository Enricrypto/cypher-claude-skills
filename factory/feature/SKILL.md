# Feature Factory

An 8-agent chain that takes a feature description to tested, validated code, behind gates that
are code rather than prose. This document describes what the program does in this version
(Phase A, PR A-1). Where the code and this file disagree, the code is right and this file is a
bug: `factory/test/contracts/doc-drift.test.ts` checks the claims below against the code.

---

## Two ways to run it

### 1. As a program (preferred)

```bash
npm run factory -- --feature "add an endpoint to update a user's email" --cwd /path/to/project
```

`factory/runner/cli.ts` parses the flags and calls `runFeatureFactory` in
`factory/feature/workflows/feature-factory-orchestrator.ts`, which runs the five stages and the
gates below. Agents run through the Claude Agent SDK with the tool grants in
`factory/runner/agent-registry.ts`; each agent's system prompt is its contract file in
`factory/feature/agents/`.

Exit code: `0` only when the run ends SUCCESS; any escalation exits `1`.

### 2. By hand, in a session

Invoke the agents yourself in order and stop at both checkpoints. In this mode nothing enforces
the gates: you are the gate. Use it to learn the chain or for a one-off; use the program to ship.
Agents make no memory calls; memory is the operator's session's job, outside the factory.

---

## CLI flags (this version)

| Flag | Meaning |
|---|---|
| `--feature "<text>"` | Required. The feature description every agent is given. |
| `--name "<text>"` | Display name for the run. Defaults to the first 60 characters of `--feature`. |
| `--cwd <path>` | The target project. Defaults to the current directory. All paths and gates resolve against it. |
| `--model <id>` | Force one model for every agent. Without it each agent uses its own model from `AGENT_COST`. |
| `--yes` | Approve both checkpoints automatically. Must be typed; nothing else skips a checkpoint. |
| `--resume <featureId>` | Load `.factory/<featureId>/state.json`. Fails if the file is missing or the run already finished. |

`--resume` is limited today: the loaded state is reused, but the run starts again at Stage 1
and re-runs every agent. It does **not** skip completed stages. That is fixed in PR A-2.

A run supplied with a pre-built spec (the `preSuppliedSpec` option of `runFeatureFactory`, not a
CLI flag) skips Stages 1 and 2 if the spec passes the Stage 2 gate (and the Stage 1 gate, when
it includes a researcher report); otherwise it escalates. No checkpoint is asked on that path.

---

## The chain

| # | Agent file | Stage | Tools | Writes code? |
|---|---|---|---|---|
| 01 | `01-researcher.md` | 1 Discover | Read, Grep, Glob | No |
| 02 | `02-story-writer.md` | 2 Plan | Read | No |
| 03 | `03-spec-writer.md` | 2 Plan | Read, Grep, Glob | No |
| 04 | `04-backend-builder.md` | 3 Execute | Read, Write, Edit, Bash | Yes |
| 05 | `05-frontend-builder.md` | 3 Execute | Read, Write, Edit, Bash | Yes |
| 06 | `06-test-verifier.md` | 4 Verify | Read, Write, Edit, Bash | Yes (tests) |
| 07 | `07-validator.md` | 4 Verify | Read, Grep, Glob | No |
| 08 | `08-feature-consolidator.md` | 5 Deliver | Read, Grep | No |

Other files in `factory/feature/agents/` (the audit and remediation agents) are not part of this
chain and are not registered in `AGENT_STAGE`.

```
Feature description
  Stage 1  01 Researcher ............................ Stage 1 gate
  Stage 2  02 Story Writer
           ⏸ CHECKPOINT 1: Approve the story
           03 Spec Writer ........................... Stage 2 gate
           ⏸ CHECKPOINT 2: Approve the technical brief
  Stage 3  04 Backend Builder (up to 3 attempts)
           05 Frontend Builder (up to 3 attempts; only if the brief calls for UI)
           Gate 1 (materialization) ................. Stage 3 gate
  Stage 4  Gate 1.5 (infrastructure)
           06 Test Verifier
           Gate 2 (execution)
           07 Validator  ── CRITICAL issue on a builder's file → validator round (max 2)
           Stage 4 gate
  Stage 5  08 Feature Consolidator .................. Stage 5 gate (logged only)
  SUCCESS
```

**SUCCESS means: the Stage 4 gate passed and the consolidator ran.** There is no third
checkpoint. Opening and reviewing the pull request is a human step outside the program in this
version.

The consolidator runs straight after Stage 4, in the same run. Ignore the log line that says the
run is waiting for a PR merge: it does not wait. The Stage 5 gate is evaluated and its findings
recorded, but its result never blocks; its "Knowledge Stored" criterion is fed a hard-coded
`true` in this version and reflects nothing.

Any agent from 01 to 05 that returns `ESCALATE` (01 to 03 also on `FAIL`) is believed: the run
escalates. Any output that fails its schema escalates, except a builder's, which is retried.

---

## Checkpoints

The orchestrator exports `CHECKPOINTS`; there are two.

| Checkpoint | When |
|---|---|
| CHECKPOINT 1: Approve the story | After the Story Writer, before the Spec Writer runs. |
| CHECKPOINT 2: Approve the technical brief | After the Stage 2 gate passes, before any builder runs. |

How they work today:
- On a TTY, the CLI prints the agent's summary and asks `Approve? [y/N]`. Only `y` or `yes`
  approves. Anything else rejects, and the run escalates.
- `--yes` approves both without asking.
- With no TTY and no `--yes`, the CLI cannot ask anyone, so it fails closed: the checkpoint is
  rejected and the run escalates.
- Called programmatically without an `approveCheckpoint` function, the first checkpoint
  escalates the run.

An approval is recorded in the run's state; a rejection is recorded as a `MANUAL` escalation.

---

## The gates

Every gate is a function in `factory/harness/`. A gate that cannot run (it throws) escalates the
run; it is never read as a pass.

### Stage gates (`stage-gates.ts`)

Each stage has a contract: criteria tagged CRITICAL or IMPORTANT, plus required documents.
- **Only CRITICAL criteria block.** A failed IMPORTANT criterion becomes a finding in
  `state.importantFindings` and the stage advances.
- **Required documents are enforced.** A missing one blocks.
- A criterion whose check throws blocks, whatever its severity.

| Stage | CRITICAL | IMPORTANT | Required documents |
|---|---|---|---|
| 1 Discover | Researcher Report Complete, Files Identified | Patterns Found, Risks Flagged | `RESEARCHER_REPORT.md` |
| 2 Plan | User Story Complete, Technical Brief Complete, AC Testable | File List Documented | `USER_STORY.md`, `TECHNICAL_BRIEF.md`, `FILE_LIST.md` |
| 3 Execute | All Files Modified, Unit Tests Pass, Loop Count Within Limits, Artifacts Materialized | Code Follows Patterns, No Abandoned TODOs | none |
| 4 Verify | Acceptance Tests Complete, Validation Passed, Security Audit Passed, No Regressions | none | `TEST_REPORT.md`, `VALIDATION_REPORT.md` |
| 5 Deliver | none | Consolidation Complete, Patterns Extracted, Knowledge Stored | `CONSOLIDATION_REPORT.md` |

### Gate 1: materialization (end of Stage 3, and every validator round)

The claimed files are the builders' `filesModified` paths.
1. Any claimed path inside `.factory/` is rejected outright: only the harness writes there, so a
   builder cannot have written it. The run escalates (`HALLUCINATION_DETECTED`).
2. Every other claimed file must exist on disk. Any missing file escalates. (Readability is
   reported, but only existence blocks.)

Harness-rendered documents are never claimed files, so this gate never checks the harness's own
output.

### Gate 1.5: infrastructure (start of Stage 4, and every validator round)

`infrastructure-gates.ts` inspects the target project without running anything.
- **CRITICAL (blocks, escalates):** `package.json` missing or unparseable; no `test` script;
  `tsconfig.json` present but unparseable (comments and trailing commas are accepted).
- **Warnings (recorded as IMPORTANT findings, never block):** no `build` script; no `dev`
  script; an `e2e/` directory without a `test:e2e` script; no `tsconfig.json`; strict mode off;
  no migrations directory; no `app/`, `components/` or `lib/` directory.

### Gate 2: execution (after the Test Verifier, and every validator round)

`execution-gates.ts` runs the project's own scripts, one after another: `npm run build`,
`npm run test`, `npm run dev`.
- Each command runs in its own process group with a Node-side timeout (test 30 min, build
  15 min, dev 15 s). On timeout the whole group is killed. POSIX only.
- Test counts are parsed from **stdout and stderr together** (Jest, Vitest, Mocha summaries).
  Output with no recognisable counts is "no tests detected" and blocks.
- **Tests (CRITICAL):** no `test` script, a non-zero exit, a timeout, no counts, any failing
  test, or no passing test blocks. Pass rate is `passed / (passed + failed)`.
- **Skipped and todo tests** do not count against the pass rate; when there are any, Gate 2
  warns, and the warning is recorded as an IMPORTANT finding.
- **Build and dev:** a missing script is skipped with a warning (recorded as a finding). When the
  script exists and fails, it is CRITICAL and blocks. The build fails on a non-zero exit or a
  timeout. The dev server is the opposite: still running cleanly when the 15 s window ends is the
  pass condition (it is then stopped); it fails if it exits non-zero before then or prints an
  error line.
- If the orchestrator is interrupted (SIGINT, SIGTERM) or exits while a Gate 2 command is
  running, that command's whole process group is killed, and Ctrl-C still stops the run.

Every Gate 2 evaluation that completes, blocking or not, is recorded in
`state.executionGateHistory`. An audit that throws records nothing: the run escalates with
`EXECUTION_FAILURE`.

### Stage 4 evidence (the Stage 4 gate)

- **Acceptance Tests Complete:** the Test Verifier's acceptance-criteria total must be above 0
  and equal the number of criteria in the approved story; every criterion must be tested or
  marked not coverable.
- **Validation Passed:** the Validator reported no CRITICAL issue. No Validator output blocks.
- **Security Audit Passed:** five checks (`authImplemented`, `inputValidated`,
  `noHardcodedSecrets`, `sqlInjectionProtected`, `xssProtected`), each `true`, `false` or
  `"not_applicable"`. `true` passes; `false` blocks. `"not_applicable"` passes only when the
  Validator gives a non-blank reason **and** the Spec Writer's `securitySurface` declared the
  matching surface `ABSENT` before any code was written. A missing or invalid value blocks, and
  so does every listed security issue.
- **No Regressions:** judged on the harness's own latest Gate 2 count, never on anything the
  Validator says. Every test that ran must pass, and the number of tests that ran
  (`passed + failed`) must not fall below the reference; skipped and todo tests do not count, so
  skipping a test cannot hold the count up. The reference is a ran-count too: for the first
  Gate 2 evaluation, the `testCount` in `.factory/baseline.json`; for a validator round, the
  run's first Gate 2 ran-count. With no reference only the 100% rule applies.
  Nothing writes `.factory/baseline.json` in this version (the writer arrives in PR A-2); a file
  that exists but is unreadable or malformed escalates the run.

---

## Loop-back rules

The table is `LOOP_BACK_RULES` in `factory/harness/loop-rules.ts`, re-exported by the
orchestrator. Every retry is bounded; anything without a bound escalates to a human.

| Situation | Action | Bound | What happens |
|---|---|---|---|
| `BUILDER_TESTS_FAIL` | `RETRY_SAME_BUILDER` | 3 | The builder reports failing tests: the error is classified and the next attempt is briefed with it. |
| `BUILDER_SCHEMA_INVALID` | `RETRY_SAME_BUILDER` | 3 | The builder's output fails its schema: the next attempt is briefed with the schema error. |
| `GATE_2_FAILS` | `ESCALATE` | — | The run stops. |
| `TEST_VERIFIER_FAILS` | `ESCALATE` | — | Status other than PASS, any failing test, or any CRITICAL issue: the run stops. |
| `VALIDATOR_CRITICAL_ROUTABLE` | `RETRY_OWNING_BUILDER` | 2 | Validator rounds: see below. |
| `VALIDATOR_CRITICAL_UNROUTABLE` | `ESCALATE` | — | A CRITICAL issue with no file, marked not fixable, or on a file no builder claimed. |
| `VALIDATOR_ESCALATES` | `ESCALATE` | — | Also: FAIL or LOOP_BACK with no CRITICAL issue escalates. |

**In Phase A, a Gate 2 failure escalates and a Test Verifier failure escalates; neither loops back to a builder.**

A builder that exhausts its 3 attempts escalates `MAX_LOOPS`. A builder that returns `ESCALATE`
is believed and the run stops.

**Validator rounds.** When the Validator reports CRITICAL issues and every one is pinned to a
file a builder claimed, each issue goes to the builder that owns the file (a file both builders
claimed goes to the frontend builder if it is a UI path, else the backend builder). If any issue
is unroutable, the whole set escalates before any builder runs. In a round, the owning builder
gets up to 3 attempts, briefed with the issues; its new output is merged with its earlier one;
then Gate 1, the Stage 3 gate and Gate 1.5 re-run, and the loop returns to Gate 2 and the
Validator. The run stays in Stage 4 throughout. If CRITICAL issues remain after 2 rounds, the run
escalates `MAX_LOOPS`.

<!-- factory-claims -->
```json
{
  "agents": [
    "01-researcher",
    "02-story-writer",
    "03-spec-writer",
    "04-backend-builder",
    "05-frontend-builder",
    "06-test-verifier",
    "07-validator",
    "08-feature-consolidator"
  ],
  "checkpoints": [1, 2],
  "loopBackRules": [
    { "situation": "BUILDER_TESTS_FAIL", "action": "RETRY_SAME_BUILDER", "bound": 3 },
    { "situation": "BUILDER_SCHEMA_INVALID", "action": "RETRY_SAME_BUILDER", "bound": 3 },
    { "situation": "GATE_2_FAILS", "action": "ESCALATE" },
    { "situation": "TEST_VERIFIER_FAILS", "action": "ESCALATE" },
    { "situation": "VALIDATOR_CRITICAL_ROUTABLE", "action": "RETRY_OWNING_BUILDER", "bound": 2 },
    { "situation": "VALIDATOR_CRITICAL_UNROUTABLE", "action": "ESCALATE" },
    { "situation": "VALIDATOR_ESCALATES", "action": "ESCALATE" }
  ]
}
```

---

## Artifacts that flow between agents

Each run has a directory, `<cwd>/.factory/<featureId>/`. It holds:
- `state.json`: the run record, saved after every completed step and stage advance. A run that
  cannot save its record stops.
- Documents written by read-only agents: they return the text and the harness writes it here:
  `RESEARCHER_REPORT.md`, `USER_STORY.md`, `TECHNICAL_BRIEF.md`, `FILE_LIST.md`,
  `VALIDATION_REPORT.md`, `CONSOLIDATION_REPORT.md`, `PATTERNS.md`.
- Documents the harness renders from structured output, each labelled "Harness-generated" on its
  first line and never a claimed file: `BACKEND_SUMMARY.md` and `API_CONTRACT.md` (from 04),
  `FRONTEND_SUMMARY.md` (from 05), `TEST_REPORT.md` (from 06).

Each prompt names, by absolute path, the upstream documents that exist in the run directory:

| Agent | Reads |
|---|---|
| 02 | Researcher Report |
| 03 | Researcher Report, User Story |
| 04 | Researcher Report, User Story, Technical Brief, File List |
| 05 | as 04, plus Backend Summary, API Contract |
| 06 | as 05, plus Frontend Summary |
| 07 | as 06, plus Test Report |
| 08 | as 07, plus Validation Report |

**Archive rule.** Every prompt says: do not read anything under `.factory/_archive/`, and ignore
every other directory under `.factory/`; it belongs to an unrelated run. At startup the harness
also deletes every directory under `.factory/` except this run's (regular files such as
`baseline.json` survive).

---

## Skill assignments

These are the defaults for running the agents by hand. In program mode the SDK loads no user
skills: each agent's prompt is its contract file only.

**Loading rule (all agents and orchestrators):** skill files are often symlinks, and Glob /
`find -type f` / `rg --files` skip symlinks, so a real skill can look missing. Load a skill ONLY
with **Read** on the exact path (`<name>.md`, then `<name>/SKILL.md`); never use a file listing
to decide it exists; report "missing" only if both Reads error (quote the error); never
substitute a `*.backup`. When briefing a subagent, pass the exact skill paths and repeat this
rule. Check the project's `CLAUDE.md` for an `## Active Skills` override first; if present, that
list wins.

| Agent | Skill files to load |
|---|---|
| Researcher | `~/.claude/skills/software/architecture-patterns.md` |
| Story Writer | none |
| Spec Writer | `~/.claude/skills/software/architecture-patterns.md` · `~/.claude/skills/software/api-design-principles.md` |
| Backend Builder | `~/.claude/skills/software/nodejs-backend-patterns.md` · `~/.claude/skills/software/api-design-principles.md` · `~/.claude/skills/software/test-driven-development.md` |
| Frontend Builder | `~/.claude/skills/software/frontend-architecture.md` · `~/.claude/skills/software/frontend-design/SKILL.md` · `~/.claude/skills/software/test-driven-development.md` |
| Test Verifier | `~/.claude/skills/software/test-driven-development.md` · `~/.claude/skills/software/verification-before-completion.md` |
| Validator | `~/.claude/skills/software/code-review-excellence.md` · `~/.claude/skills/software/security-audit.md` |
| Feature Consolidator | none |

Each path maps to a skill in this repo's `skills/` directory.

---

## When to use the full chain

Use it for new user-facing behaviour, a database schema change, a new or changed API contract,
or a change touching more than 3 files. For a typo, copy change, config tweak or one-line fix,
it is overkill.
