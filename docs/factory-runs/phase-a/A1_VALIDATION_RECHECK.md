# A1_VALIDATION_RECHECK — PR A-1 fix round

> Agent 07 (Validator), by-hand mode, read-only. 2026-10-04. Branch `feat/phase-a1-gates`, uncommitted.
> Skills loaded by Read: `code-review-excellence.md`, `security-audit.md`.
> Saved by the orchestrating session from the Validator's hand-back (content unchanged except formatting). Session verification at the time: 25 suites / 471 tests, typecheck exit 0, no orphaned processes.

**Verdict: all five approved fixes RESOLVED, plus MINOR-12 and MINOR-13. No new CRITICAL or IMPORTANT findings; 4 new MINOR. PR A-1 is ready for human PR review.**

---

## Per fix

### IMPORTANT-1 + IMPORTANT-2 (persistArtifacts) — RESOLVED
- With a run directory, files always go to `join(artifactDir, plainArtifactName(name))` (`factory/harness/stage-context.ts:257-258`); the agent-supplied path is ignored. Tests: `stage-context.test.ts:687`, `:699`.
- A name/path mismatch is saved under the artifact name, so AC-24 lookups match what is on disk. Test: `:709`.
- A second containment check (`:262-267`) rejects anything resolving outside the container.
- `plainArtifactName` (`:282-298`) rejects `/`, `\`, `..`, NUL, absolute, `.` and empty names.
- Legacy mode (no run dir): absolute and empty paths refused (`:301-308`); paths escaping `cwd` (including `cwd` itself) refused. Tests: `:740`, `:749`, `:759`.
- No partial writes: every artifact is validated before any write (`:247-278`); test `:731-736`.
- Case tricks, unicode, Windows separators, `CON`: none escape (separators rejected; unicode lookalikes aren't separators; `..` rejected; `CON` is Windows-only, out of scope). Symlinks: NEW-MINOR-1.
- state.json stays consistent after a throw: at every call site (orch `:826`, `:883`, `:921`, `:1076`, `:1246`) the throw happens before `outputs.*` is set or the step recorded; the outer catch (`:1269-1289`) records a MANUAL escalation and `finish()` commits.
- `acceptFeatureSpec` legitimate names still work (`feature-spec.ts:126`; `feature-spec.test.ts:60-66`).
- Rejecting `a..b.md` is harmless: production names are an enum (`output-schemas.ts:80-87`, `agent-registry.ts:112-123`), none containing `..`.

### IMPORTANT-3 (orphaned process groups) — RESOLVED
- Handlers installed lazily, once (`cleanupInstalled`, `execution-gates.ts:182-196`), on first `runShellCommand` (`:228`); importing installs nothing (test `:499`). At most three listeners per module instance — no leak.
- SIGINT/SIGTERM re-raise only when sole listener (`:203-206`), removing itself first; tests `:556-565` show exit `{code:null, signal}`. `cli.ts` registers no other listener.
- Exit-handler wait bounded: ≤ 500 ms (`EXIT_KILL_GRACE_MS`, `:149`) + one 25 ms tick, then SIGKILL (`:167-179`); returns immediately when nothing is tracked. (Observation: in the `exit` handler the dead shell is an unreaped zombie, so the wait usually runs the full 500 ms — not a defect.)
- Tracked at spawn (`:236`), untracked in `settle` (`:246`); every path reaches `settle`. Only a synchronous `spawn` throw (no pid) is never tracked.
- Tests: `:463`, `:486`, `:567`.

### IMPORTANT-4 (mergeBuilderOutput) — RESOLVED
- Previous `testing` kept only when the round reports `testsWritten === 0 && testsFailed === 0` and previous testing exists (`validator-routing.ts:117-123`); otherwise the round's totals win; absent `testing` stays absent (fails closed).
- Cannot hide a failing test: a round with `testsFailed > 0` is retried by the builder loop (orch `:480-511`) and the merge would pass it along anyway; kept totals already passed the Stage 3 100% rule (`stage-gates.ts:588-589`); Gate 2 re-runs at the top of every round (orch `:1054`).
- Tests: `validator-loop-back.test.ts:206-222`, `:278`.

### IMPORTANT-5 (count only tests that ran) — RESOLVED
- `testsRan = passed + failed` (`regression-baseline.ts:109-111`) used for the in-run reference (`:122`), the baseline `testCount` contract for the A-2 writer (`:41-44`), and the gate (`stage-gates.ts:755-765`). Orchestrator records numbers, never undefined (`:326-328`). 100% rule unchanged (`stage-gates.ts:746`). SKILL.md matches (`:202-209`) with a drift test (`doc-drift.test.ts:150`).
- Tests: `stage-gates.test.ts:281`, `:291`; `orchestrator-gates.test.ts:430`; `regression-baseline.test.ts:124`.

### MINOR-12 — RESOLVED
Retitled "D-3 a missing test script is not skipped: it fails and blocks" (`execution-gates.test.ts:234`).

### MINOR-13 — RESOLVED
Every new sentence in `SKILL.md:178-188` is true of the code (build: `execution-gates.ts:463-469`; dev: `:488-494`; interrupt/exit kill: `:194-210`; completed evaluations recorded: orch `:700`; throwing audit records nothing and escalates `EXECUTION_FAILURE`: orch `:682-693`). "Ctrl-C still stops the run" holds while no other SIGINT listener is registered (the Agent SDK was not inspected).

### AC regression check
Edits touch the code behind AC-21, 22, 24, 29, 66 — each still met, now more strictly. No other in-scope AC weakened.

---

## New findings (MINOR only) — A-2 backlog

- **NEW-MINOR-1 — writes follow symlinks inside the run dir.** `stage-context.ts:275-276`; containment at `:263` uses `resolve()`. A builder (Write/Bash) could plant `.factory/<id>/VALIDATION_REPORT.md → ~/.zshrc`; the harness then writes through it. No privilege gain (the builder could write it directly); confused-deputy, GAP-5 family.
- **NEW-MINOR-2 — reserved names not blocked.** `plainArtifactName` accepts `state.json`, harness-rendered names (`TEST_REPORT.md`, …) and case variants (`STATE.JSON` on APFS). Prevented in production by the SDK enum; not for pre-supplied specs or injected invokers. Pre-existing exposure.
- **NEW-MINOR-3 — unsafe name in a pre-supplied spec mis-categorised.** `feature-spec.ts:126` throws past `acceptFeatureSpec`'s rejection path → MANUAL "Orchestration error" instead of tier-1 `CRITICAL_ISSUE` with blockers. Still fails closed.
- **NEW-MINOR-4 — no orchestrator-level test for an unsafe artifact.** *Session note:* this one is already covered — `factory/test/harness/upstream-artifacts.test.ts:228` "a document whose name escapes the run dir FAILS CLOSED: the run escalates and nothing is written outside it".

---

✓ RE-CHECK COMPLETE

## Operator decision (2026-10-04)
**CHECKPOINT 3 APPROVED.** NEW-MINOR-1..3 added to the PR A-2 backlog with MINOR 1–11. Delivery: option A (merge the harness branch to `main` first, then PR A-1 against `main`).
