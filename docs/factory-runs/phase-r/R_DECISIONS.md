# Phase R — reliability hardening: operator decisions

> Binding decisions made by the operator (Enrique) before any Phase R run, 2026-10-16. They win
> over anything in a Researcher, Story Writer or Spec Writer output.

## Why this phase exists

The first real project built with the factory (`cypher-agents`, Phase 0, 2026-10-15/16) stopped
**12 times** before a checkpoint. No stop was a gate catching bad work; every one came from the
conditions the agents ran in:

| Cause | Stops | Item |
|---|---|---|
| The Mac idle-slept (1-minute sleep setting); the agent's connection dropped mid-reply | 3 | R1, R3 |
| A read-only agent's single reply exceeded Claude Code's 32,000-token default | 2 | R2 |
| `maxTurns` ran out: the builder three times, the Test Verifier and Validator together once | 4 | R4, R9 |
| Story gate counted 1 AC: the Story Writer put 17 ACs only in the structured field | 1 | R6 |
| Snapshot failed because the project's `.gitignore` lists `.factory/` | 1 | R8 |
| "Claude Code process exited with code 1", no message (probably the usage limit) | 1 | R10 |

Two more problems reached a checkpoint and were caught by the operator: an escape sequence (a
backslash, `u`, then `FEFF`) arrived in `TECHNICAL_BRIEF.md` as the real invisible character (R7),
and a brief far larger than one PR should carry (R5).

Interim, already merged: PR #9 raised `maxTurns` (builders and Test Verifier 40 → 80, Validator
25 → 50; the follow-up reviewer stays at 20, pinned by AC-127).

## Plan and split

- **Placement:** Phase R runs **before B-3**. These items block real use of the factory; B-3 (cost
  per agent, budget cap, builder sandboxing, parallel builders) does not.
- **Three PRs**, each merged before the next starts, each kept to about 10 acceptance criteria:
  - **R-1:** R1, R2, R3, R8. First, because it removes most of the stops.
  - **R-2:** R4, R5, R9.
  - **R-3:** R6, R7, R10.

## Items

| # | Item | Decision |
|---|---|---|
| **R1** | Keep the machine awake for the whole run | On macOS, hold `caffeinate -dims -w <orchestrator pid>` from run start to run end. A no-op on other platforms. Spawned from the single allow-listed spawn site, like every other child process. |
| **R2** | Raise the reply limit | Set `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` in the environment of every agent invocation. A ceiling, not a target: replies that already fit are unchanged. |
| **R3** | Retry once on a transient API error | One automatic retry of the same invocation after a **30-second** wait, recorded in `agentInvocations`. **Transient:** "Connection closed", HTTP 429 and 529 (overloaded), other 5xx, socket resets. **Never retried:** max-turns, output-token-limit and schema errors, which would fail the same way again. |
| **R4** | `maxTurns` scales with the brief | `maxTurns = min(150, max(base, 40 + 2 × files in FILE_LIST.md))`, where `base` is the current `AGENT_COST` value (80 for builders and the Test Verifier, 50 for the Validator). Agents with no file list keep `base`. |
| **R5** | Warn when a brief is too big | At CHECKPOINT 2, an IMPORTANT finding when the story has more than **12** ACs or `FILE_LIST.md` has more than **30** files, suggesting a split. A warning, never a block. |
| **R6** | Story gate reads the structured ACs | The story gate counts acceptance criteria in the Story Writer's structured output **and** in `USER_STORY.md`, and **blocks when the two counts disagree**. |
| **R7** | No invisible characters in documents meant to be copied into code | (a) The output contract tells agents to spell an escape by its parts in prose and never to write the escape itself. (b) The existing `document-check` finding becomes **CRITICAL** for `TECHNICAL_BRIEF.md` and `FILE_LIST.md` and stays IMPORTANT for every other document. |
| **R8** | Snapshots work when `.factory/` is ignored; the factory hides `.factory/` itself | (a) The Stage 3 snapshot succeeds whether or not the project ignores `.factory/` (today `git add -A -- . ':(exclude).factory'` exits 1 on git 2.39 when `.factory` is ignored). (b) At run start the factory adds `.factory/` to the project's `.git/info/exclude` (local only, never committed). Moving run state out of the project was rejected as too large a redesign. |
| **R9** | Proportionate effort | The Spec Writer labels every brief item **tidy-up** (no behaviour change: existing tests must still pass, no new tests), **behaviour change** (one focused test per changed behaviour) or **new feature** (full depth). The Test Verifier and the Validator follow the label. The labels are shown at CHECKPOINT 2, where a mislabel is caught. |
| **R10** | Clear message when the usage limit stops an agent | When an agent exits with a usage-limit message, or with code 1 and no message, the escalation says the plan's usage limit is the likely cause and that the run can be resumed once it resets. |
