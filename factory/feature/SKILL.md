# Feature Factory

An 8-agent chain that takes a feature description to tested, validated code, behind gates that
are code rather than prose. This document describes what the program does in this version
(Phase A, PR A-2). Where the code and this file disagree, the code is right and this file is a
bug: `factory/test/contracts/doc-drift.test.ts` checks the claims below against the code.

---

## Two ways to run it

### 1. As a program (preferred)

```bash
npm run factory -- --feature "add an endpoint to update a user's email" --cwd /path/to/project
```

`factory/runner/cli.ts` parses the flags and calls the library: `runFeatureFactory` in
`factory/feature/workflows/feature-factory-orchestrator.ts` runs Stages 1 to 4, the gates and the
three checkpoints. Agents run through the Claude Agent SDK with the tool grants in
`factory/runner/agent-registry.ts`; each agent's system prompt is its contract file in
`factory/feature/agents/`.

### 2. By hand, in a session

Invoke the agents yourself in order and stop at each of the three checkpoints. In this mode nothing enforces
the gates: you are the gate. Use it to learn the chain or for a one-off; use the program to ship.
Agents make no memory calls; memory is the operator's session's job, outside the factory.

---

## The CLI

One invocation does one thing: start a run, resume one, close one, or consolidate one.

```bash
npm run factory -- --feature "add a health check endpoint" --cwd /path/to/project
npm run factory -- --resume <id> --cwd /path/to/project
npm run factory -- --resume <id> --approve <n>
npm run factory -- --resume <id> --reject <n> --notes "<why>"
npm run factory -- --resume <id> --grant-attempts <n>
npm run factory -- --close <id>
npm run factory -- --consolidate <id>
```

| Flag | Used with | Meaning |
|---|---|---|
| `--feature "<text>"` | a new run; optional with `--resume` | The feature description every agent is given. With `--resume` it must equal the description saved in the run, or the resume is refused; a run recorded without one needs it. |
| `--name "<text>"` | a new run only | Display name. Defaults to the first 60 characters of `--feature`. |
| `--cwd <path>` | every mode | The target project. Defaults to the current directory. All paths, runs and gates resolve against it. |
| `--model <id>` | a new run, `--resume`, `--consolidate` | Force one model for every agent. Without it each agent uses its own model from `AGENT_COST`. |
| `--yes` | a new run, `--resume` | Approve every checkpoint, CHECKPOINT 3 included, without asking. The run can then reach SUCCESS and write `.factory/baseline.json` unattended. Must be typed; nothing else skips a checkpoint. |
| `--resume <id>` | — | Continue the unfinished run `.factory/<id>/`. |
| `--approve <n>` | `--resume` | Approve the checkpoint the run is paused at (`1`, `2`, `3` or `cp1`, `cp2`, `cp3`). |
| `--reject <n>` | `--resume` | Reject the checkpoint the run is paused at. Needs `--notes`. |
| `--notes "<why>"` | `--reject` only | Why it was rejected: the agent that reworks it is briefed with this. Must not be blank. |
| `--grant-attempts <n>` | `--resume` | Give the builder that exhausted its attempts `n` more (1-3). |
| `--close <id>` | — | Finish an unfinished run as MANUAL_STOP. |
| `--consolidate <id>` | — | Run the Feature Consolidator on a SUCCESS run, live or archived. |

`--approve`, `--reject` and `--grant-attempts` are mutually exclusive. An unknown flag, a stray
word, a repeated flag, a missing or blank value, or a flag the mode does not take is a usage
error: the CLI prints the usage and exits 1 before anything runs. Run ids must start with a letter
or digit and contain only letters, digits, `.`, `_` and `-` (never `..`), so an id can never
point outside `.factory/`.

**Exit codes** (`EXIT_CODES` in `cli.ts`). CI or a script can trust them instead of the log.

| Code | Name | When |
|---|---|---|
| 0 | SUCCESS | The run ended SUCCESS; or `--close` closed the run; or `--consolidate` passed its Stage 5 gate. |
| 1 | STOPPED | The run escalated (a rejection included), a request was refused, a usage error, an unexpected error, or a `--consolidate` whose gate failed. |
| 3 | PAUSED | The run is waiting at a checkpoint for `--approve` or `--reject`. |

2 is deliberately unused. After every run the CLI prints the summary, the path of the run's
`state.json`, and only the next commands that apply to the run's state: approve / reject / close
for a paused run, resume (with `--grant-attempts` when a builder is out of attempts) and close for
an escalated one, consolidate for a SUCCESS run, nothing for a closed one. Everything printed is
made terminal-safe: control characters and escape sequences in agent text, documents or diffs are
shown as visible `\xNN` codes, never interpreted.

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
  Stage 2  02 Story Writer ........................... Stage 2 gate (story part)
           ⏸ CHECKPOINT 1: Approve the story
           03 Spec Writer ........................... Stage 2 gate (brief part)
           ⏸ CHECKPOINT 2: Approve the technical brief
  Stage 3  04 Backend Builder (up to 3 attempts)
           05 Frontend Builder (up to 3 attempts; only if the brief calls for UI)
           Gate 1 (materialization) ................. Stage 3 gate
  Stage 4  Gate 1.5 (infrastructure)
           06 Test Verifier
           Gate 2 (execution)
           07 Validator  ── CRITICAL issue on a builder's file → validator round (max 2)
           Stage 4 gate
           ⏸ CHECKPOINT 3: Approve the validated change
  SUCCESS  .factory/baseline.json written

  Later, on request:  --consolidate <id>  →  08 Feature Consolidator, Stage 5 gate
```

**SUCCESS means: the Stage 4 gate passed and CHECKPOINT 3 was approved.** The run stays in
Stage 4. The factory makes no pull request, commit or push: what happens to an approved change
is a human step outside the program.

Any agent from 01 to 05 that returns `ESCALATE` (01 to 03 also on `FAIL`) is believed: the run
escalates. Any output that fails its schema escalates, except a builder's, which is retried.

---

## Checkpoints

The orchestrator exports `CHECKPOINTS`; there are three.

| Checkpoint | When | What is presented |
|---|---|---|
| CHECKPOINT 1: Approve the story | After the story passes its part of the Stage 2 gate, before the Spec Writer runs. | The full `USER_STORY.md`. |
| CHECKPOINT 2: Approve the technical brief | After the brief passes its part of the Stage 2 gate, before any builder runs. | The full `TECHNICAL_BRIEF.md`, then the full `FILE_LIST.md`. |
| CHECKPOINT 3: Approve the validated change | After the Stage 4 gate passes. Approving it ends the run SUCCESS. | The full `VALIDATION_REPORT.md`, every IMPORTANT finding the run recorded, and the change (below). |

A checkpoint presents whole documents, never an agent's summary of them, and an approval is
recorded, and saved before the next agent runs, with the SHA-256 of the exact text presented. A
document that cannot be presented (missing, empty, a symlink) escalates the run without asking
anyone. A story or brief that fails its part of the Stage 2 gate is never presented.

**The answer.** At each checkpoint the human approves, rejects or pauses:
- On a TTY the CLI prints the presented text and asks
  `Approve? [y = approve / n = reject / p = pause]`. `y` or `yes` approves; `p` or `pause` pauses;
  anything else rejects, and the CLI then asks for optional notes for the rework.
- With no TTY and no `--yes` there is nobody to ask, so the run pauses at the checkpoint (exit 3)
  and approves nothing. The CLI prints the `--approve` and `--reject` commands.
- `--yes` approves all three without asking.
- Called programmatically, `approveCheckpoint` returns `APPROVE`, `REJECT` (with optional notes)
  or `PAUSE`; `true` and `false` mean approve and reject, and any other value pauses. With no
  `approveCheckpoint` at all, the first checkpoint escalates the run.

What each answer does:
- **Approve:** the run continues.
- **Pause:** the run is saved as PAUSED, with the checkpoint, the presented documents and the hash.
  It is not finished. Resume it with `--approve <n>` or `--reject <n> --notes "<why>"`.
- **Reject:** the rejection (notes, hash, the agents that will rework it) is recorded with a
  `MANUAL` escalation, and the run ends ESCALATED. A plain `--resume <id>` then starts the rework
  (see the run lifecycle).

**The change at CHECKPOINT 3.** When a run starts, the harness records the project's git HEAD.
CHECKPOINT 3 shows `git diff` from that commit (committed and uncommitted changes alike) plus
every untracked, non-ignored file, with `.factory/` excluded. Changes that were already
uncommitted when the run started appear too. An untracked file is listed with its size and
SHA-256, and its text is shown unless it is binary or larger than 256 KiB. Git is only ever
asked to read (`rev-parse`, `diff`, `ls-files`). Outside a git work tree the change is instead a
manifest of the files the builders claimed, labelled as not a git diff.

---

## The run lifecycle

Each run lives in `<cwd>/.factory/<id>/`, and its `state.json` decides everything below. A run is
in one of five classes: ACTIVE (running, or killed mid-run), PAUSED, ESCALATED, SUCCESS or
MANUAL_STOP. Only SUCCESS and MANUAL_STOP are finished for good.

### Starting a run

A fresh start first moves every finished run directory (SUCCESS, MANUAL_STOP, and old directories
with no `state.json`), contents intact, into `.factory/_archive/<id>/`. It then refuses to start
while any ACTIVE, PAUSED or ESCALATED run exists, naming each one with its resume and close
commands; unfinished runs are never moved. A `state.json` that cannot be read or parsed also
refuses the start, naming the directory. Nothing is ever deleted, and regular files such as
`baseline.json` stay where they are. A run left ESCALATED by an older version therefore has to be
closed (`--close <id>`) once before a new run can start.

### Approving or rejecting a paused run

- `--resume <id> --approve <n>` approves what was presented, or nothing. The checkpoint's text is
  rebuilt from the same files (for CHECKPOINT 3, also the findings and the change collected now)
  and its SHA-256 compared with the hash saved at the pause. If they differ the approval is
  refused ("artifact changed"): nothing is recorded and the run stays PAUSED. If they match, the
  approval is recorded with that hash and the run continues past the checkpoint.
- `--resume <id> --reject <n> --notes "<why>"` records the rejection and ends the run ESCALATED,
  as a rejection at the prompt does. Nothing is re-run until the next resume.
- Either one is refused if `<n>` is not the checkpoint the run is paused at, or if the run is not
  paused. A plain `--resume <id>` of a paused run changes nothing: it exits 3 and prints the
  approve, reject and close commands again.

### Rework after a rejection

A plain `--resume <id>` of a run that ended on a rejection reopens it and starts the rework:
- The rejected documents are moved, never deleted, into `.factory/<id>/_superseded/<n>/`, where
  `<n>` counts the run's rejections from 1: `USER_STORY.md` for CHECKPOINT 1, `TECHNICAL_BRIEF.md`
  and `FILE_LIST.md` for CHECKPOINT 2, `TEST_REPORT.md` and `VALIDATION_REPORT.md` for
  CHECKPOINT 3. A superseded document can never satisfy a gate.
- **CHECKPOINT 1 or 2:** the Story Writer (or Spec Writer) runs again, briefed with the
  checkpoint, the notes and the path of the superseded document; then its gate, then the
  checkpoint again. Rejecting CHECKPOINT 2 keeps the CHECKPOINT 1 approval, which is hash-checked.
- **A pre-supplied story or brief** that is rejected, or that fails its gate, is reworked the same
  way: the factory's own Story Writer or Spec Writer produces a new version from the existing
  document, and the run continues.
- **CHECKPOINT 3:** the builders whose files are in the change (every builder that ran, if none
  is) run again, backend first, briefed with the notes, each with its own 3-attempt budget. Their
  outputs are merged with the earlier ones. Then Gate 1, the Stage 3 gate, Gate 1.5, the Test
  Verifier, Gate 2 and the Validator run again (validator rounds are not reset), then the Stage 4
  gate, then CHECKPOINT 3 is presented again with a new hash.

### Resuming

`--resume <id>` continues the run from where it stopped, deciding everything from `state.json`.
An archived run cannot be resumed (it is finished), and an unknown id is refused.

- **Skipped:** stages the run has advanced past, every agent with a recorded PASS, and every
  approved checkpoint (an approved CHECKPOINT 2 closes Stage 2, an approved CHECKPOINT 3 closes
  Stage 4). A pre-supplied run never runs the Researcher, and its supplied story and brief count
  as the Story Writer's and Spec Writer's PASS.
- **Always evaluated again:** every gate the run reaches: Gate 1, the Stage 1, 3 and 4 gates,
  Gate 1.5 and Gate 2, and the story and spec parts of the Stage 2 gate while their checkpoint is
  not yet approved. Once CHECKPOINT 1 or 2 is approved, its part of the Stage 2 gate is not run
  again: the approved-artifact hash check below takes its place. A gate failure invalidates the
  agent steps it judged (the Stage 1 gate the Researcher, the story gate the Story Writer, the spec
  gate the Spec Writer, the Stage 4 gate the Test Verifier and Validator), so a resume re-runs
  them. Only the Story Writer and Spec Writer re-runs are briefed with the gate's reason; the
  Researcher, Test Verifier and Validator re-run without one. Builders are never invalidated.
- **Builder attempts come from state:** an attempt is counted before it starts, so one killed in
  flight is spent, and a run killed during its 2nd attempt gets exactly one more. A builder that
  exhausted its attempts is refused a plain resume; `--grant-attempts <n>` (1-3) gives exactly
  that builder `n` more attempts in exactly the phase it ran out in (Stage 3, a validator round or
  a CHECKPOINT 3 rework). A grant on any other run is refused.
- An unfinished validator round re-enters at its builder fix, then re-runs its gates.
- An ESCALATED run is reopened (IN_PROGRESS, the escalation marked resolved). A killed ACTIVE run
  just continues.
- **Approved artifacts must be unchanged.** Every approved checkpoint is rebuilt and its hash
  compared before anything runs: `USER_STORY.md`, `TECHNICAL_BRIEF.md` and `FILE_LIST.md`, and for
  an approved CHECKPOINT 3 its report, findings and the change as it is now. If any differs, the
  resume is refused with nothing written: nothing runs on a story, brief or change nobody
  approved. Restore it, or close the run.
- A run whose CHECKPOINT 3 was approved writes the baseline and finishes SUCCESS without asking
  again. A resume never re-captures the change base the CHECKPOINT 3 diff starts from.
- Agents are briefed with the description saved in the run. A run recorded before descriptions
  were saved cannot be resumed without `--feature` (the resume is refused, with nothing written);
  given, that description is saved in the run when the resume continues it, so later resumes do
  not need it (a plain `--resume` of a paused run changes nothing, so it saves nothing either).

Every refusal (a finished run, a missing grant, the wrong checkpoint, a changed artifact) is made
before anything is written, so `state.json` stays byte-identical, and exits 1.

### Closing

`--close <id>` finishes an ACTIVE, PAUSED or ESCALATED run as MANUAL_STOP, in place. The next
fresh start archives it. Closing a finished or archived run is refused.

### Consolidating

`--consolidate <id>` runs the Feature Consolidator (08) on a SUCCESS run, live or archived, and
is refused for any other run. 08 is told to read only that run's directory (the one exception to
the archive rule) and its `state.json` for the per-agent timings. Its `CONSOLIDATION_REPORT.md`
and `PATTERNS.md` are written into that directory, the run's stage becomes 5, and it stays
SUCCESS. The Stage 5 gate judges only those two documents; output that fails its schema or
declares FAIL or ESCALATE writes nothing and fails. Exit 0 when the gate passes, else 1.

### SUCCESS, the baseline and timings

When CHECKPOINT 3 is approved the harness writes `.factory/baseline.json` atomically, outside the
run directory: the run's id and the number of tests that ran in its latest Gate 2 evaluation. Only
then is the run finished SUCCESS; if the write fails, the run escalates, and a resume writes it
and finishes.

Every agent invocation is recorded in `state.json` as it completes, under `agentInvocations`
(stage, agent, start, end, duration, and the builder phase, round and attempt), and added to
`metrics.timePerStage`. The agent's step carries the same real start and end.

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
| 5 Deliver | Consolidation Complete, Patterns Extracted | none | `CONSOLIDATION_REPORT.md`, `PATTERNS.md` |

The Stage 2 gate is judged in two parts: the story part (User Story Complete, AC Testable,
`USER_STORY.md`) before CHECKPOINT 1, and the brief part (the rest) before CHECKPOINT 2. Either
part escalates with its blockers. Loop Count Within Limits allows a builder its 3 attempts plus
any granted ones. Stage 5 is judged only by `--consolidate`, never inside a run.

### Gate 1: materialization (end of Stage 3, every validator round, and a CHECKPOINT 3 rework)

The claimed files are the builders' `filesModified` paths.
1. Any claimed path inside `.factory/` is rejected outright, in any letter case (`.Factory/` too):
   only the harness writes there, so a builder cannot have written it. The run escalates
   (`HALLUCINATION_DETECTED`).
2. Every other claimed file must exist on disk as a regular file; a claimed directory counts as
   missing. Any missing file escalates. (Readability is reported, but only existence blocks.)

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
  skipping a test cannot hold the count up. The reference is a ran-count too, and only a Gate 2
  evaluation that passed can set it. For the evaluation right after the Test Verifier (also when
  a resume repeats it) the reference is the higher of the run's first passing count and the
  `testCount` in `.factory/baseline.json`, or whichever of the two exists; for a validator round
  it is the higher of the run's first passing count and the reference recorded for that first
  evaluation (the baseline as it was then; a round never re-reads the file), so the bar never
  drops. With no reference only the 100% rule applies. A baseline
  file that exists but is unreadable or malformed escalates the run.

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

A builder that exhausts its attempts (3, plus any granted) escalates `MAX_LOOPS`; the run can be
resumed with `--grant-attempts`. A builder that returns `ESCALATE` is believed and the run stops.
A builder that returns FAIL (or LOOP_BACK) with a valid output and no failing test is retried: the
attempt counts, it is never recorded as a pass, and the next attempt is briefed with the builder's
own summary. A builder output that is not an object at all (`null`, say) is a schema failure and
is retried the same way.

**Validator rounds.** When the Validator reports CRITICAL issues and every one is pinned to a
file a builder claimed, each issue goes to the builder that owns the file (a file both builders
claimed goes to the frontend builder if it is a UI path, else the backend builder). If any issue
is unroutable, the whole set escalates before any builder runs. In a round, the owning builder
gets up to 3 attempts, briefed with the issues; its new output is merged with its earlier one;
then Gate 1, the Stage 3 gate and Gate 1.5 re-run, and the loop returns to Gate 2 and the
Validator. The run stays in Stage 4 throughout. If CRITICAL issues remain after 2 rounds, the run
escalates `MAX_LOOPS`. Every Validator output's IMPORTANT issues are recorded as findings, each
once.

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
  "checkpoints": [1, 2, 3],
  "loopBackRules": [
    { "situation": "BUILDER_TESTS_FAIL", "action": "RETRY_SAME_BUILDER", "bound": 3 },
    { "situation": "BUILDER_SCHEMA_INVALID", "action": "RETRY_SAME_BUILDER", "bound": 3 },
    { "situation": "GATE_2_FAILS", "action": "ESCALATE" },
    { "situation": "TEST_VERIFIER_FAILS", "action": "ESCALATE" },
    { "situation": "VALIDATOR_CRITICAL_ROUTABLE", "action": "RETRY_OWNING_BUILDER", "bound": 2 },
    { "situation": "VALIDATOR_CRITICAL_UNROUTABLE", "action": "ESCALATE" },
    { "situation": "VALIDATOR_ESCALATES", "action": "ESCALATE" }
  ],
  "cliFlags": [
    "feature",
    "name",
    "cwd",
    "model",
    "yes",
    "resume",
    "approve",
    "reject",
    "notes",
    "grant-attempts",
    "close",
    "consolidate"
  ],
  "exitCodes": { "SUCCESS": 0, "STOPPED": 1, "PAUSED": 3 }
}
```

---

## Artifacts that flow between agents

Each run has a directory, `<cwd>/.factory/<id>/`. It holds:
- `state.json`: the run record, saved atomically after every transition a resume could restart
  from (each agent invocation and step, attempt, loop-back, approval, pause, rejection, grant and
  stage advance). A run that cannot save its record stops.
- Documents written by read-only agents: they return the text and the harness writes it here:
  `RESEARCHER_REPORT.md`, `USER_STORY.md`, `TECHNICAL_BRIEF.md`, `FILE_LIST.md`,
  `VALIDATION_REPORT.md`; and, after `--consolidate`, `CONSOLIDATION_REPORT.md` and `PATTERNS.md`.
  Each must carry content, or the agent's output fails its schema.
- Documents the harness renders from structured output, each labelled "Harness-generated" on its
  first line and never a claimed file: `BACKEND_SUMMARY.md` and `API_CONTRACT.md` (from 04),
  `FRONTEND_SUMMARY.md` (from 05), `TEST_REPORT.md` (from 06). A resume renders them again from
  the record.
- `_superseded/<n>/`: the documents of the n-th rejected checkpoint, moved aside by its rework.

Next to the run directories, `.factory/` holds `_archive/` (finished runs) and `baseline.json`.
The harness writes documents without following symlinks and only inside the run directory. A
document name must be a plain filename, and never one the harness reserves, in any letter case:
`state.json`, `baseline.json`, a harness-rendered name, `_archive`, `_superseded`, or a name
starting with a dot. An agent output naming one is refused, nothing of it is written, and a run
escalates; a pre-supplied spec naming one is rejected with its blockers.

Each prompt names, by absolute path, the upstream documents that exist in the run directory:

| Agent | Reads |
|---|---|
| 02 | Researcher Report |
| 03 | Researcher Report, User Story |
| 04 | Researcher Report, User Story, Technical Brief, File List |
| 05 | as 04, plus Backend Summary, API Contract |
| 06 | as 05, plus Frontend Summary |
| 07 | as 06, plus Test Report |
| 08 | as 07, plus Validation Report, and the run's `state.json` for timings |

**Archive rule.** Every prompt says: do not read anything under `.factory/_archive/`, and ignore
every other directory under `.factory/`; it belongs to an unrelated run. The one exception is
`--consolidate`: 08 may read the directory of the run it consolidates (which may be archived), and
nothing else under `.factory/`.

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
