# PATTERNS.md — from Phase A, PR A-2

> Agent 08 (Feature Consolidator), 2026-10-05. Saved by the orchestrating session from the Consolidator's hand-back. Only NEW or REVISED patterns relative to `A1_PATTERNS.md`; A-1 patterns not listed here still stand. Evidence points to `docs/factory-runs/phase-a/A2_*.md`, the session's build notes, and the merged `factory/` code.

## Process patterns

| # | Pattern | Revises | Evidence (A-2) | Apply when | Don't when |
|---|---|---|---|---|---|
| P-12 | **Running build-notes file** read by every fresh builder: per step the API delivered, deviations, OPEN items (with owning step), RULE, TIP — written by the session after verifying each step | P-6 | 11 steps, 0 failed checks; OPEN items honoured (e.g. `isSafeRunId` imported not duplicated; `timedInvoke` the only caller of `invokeAgent`, confirmed at orch:648); step-10 notes caught D-A half-applied | Builds of more than ~3 dependent steps with fresh contexts | Single-step changes |
| P-13 | **Written policy for existing-test changes**: a builder that breaks an unlisted existing test STOPS; setup-only fixes approved by the session and reported; any assertion change goes to the operator | P-6, P-8 | Fired 6 times (3 setup-only, 2 operator-approved assertion changes, plus file-list CK extensions); reused in the fix round | Always, from step 1 | — |
| P-14 | **Time every step, separating active and waiting time**, recorded as it happens | A-1 §7 | First measured profile: 196 build min, ~23 waiting; steps 5 and 7 stand out | Always; by-hand runs especially | — |
| P-15 | **Builders surface decisions; operator decisions become binding notes with named tests and a list of every code path they touch** | P-5 | D-A found a hole in approved I-12; D-B flagged at step 4, decided before step 7; D-A applied to round 0 only, validator rounds caught at step 10 | An approved rule proves incomplete mid-build | Surface typos — fix inline |
| P-16 | **Live smoke of a deferred external fact after the build, before verification** — one agent call, operator-approved, fresh empty directory | P-1 | S-1: 2 min, $1.21, 15 turns; closed I-13 (open since A-1) | Behaviour depends on an external SDK/runtime that tests mock | Tests already exercise the real dependency |
| P-17 | **Parallel TV ∥ Validator + scoped follow-up review of only the tests the TV added — with mutations isolated** (TV in a separate worktree/copy, or the Validator finishes before mutations start) | P-8, A-1 anti-pattern 12 | Saved ~9 min of serial Validator time; follow-up found a wrong title and prefix-only assertions; mutations were live 5–60 s while the Validator read files | TV is expected to mutate and add tests | They can't be isolated → run in sequence |
| P-18 | **Fix round as an exact, line-referenced list**, re-checked in scope only | P-8 | 8 items, all RESOLVED; 13 min fix, ~3 min re-check | Always after CP3 | — |
| P-19 | **An unfixable finding becomes a documented accepted risk**: research the options, correct the comment, draft PR wording, name a revisit trigger | — | MINOR-3: `--attr-source` needs git 2.42, here 2.39.5; comment corrected; trigger = minimum git version | The fix would change other behaviour (here the CP3 hash) | A fix exists within scope |
| P-20 | **The Spec Writer's test plan lists every existing test that calls a changed entry point**, not just intended edits (e.g. grep callers of `runFeatureFactory` on a fresh start) | P-4 | Brief §6 missed retry-briefing, feature-spec ×2, step 5 setup → 3 policy stops | Changing a widely-called harness entry point or default | Leaf modules |

## Code patterns

| # | Pattern | Revises | Evidence | Apply when | Don't when / watch |
|---|---|---|---|---|---|
| C-14 | **Hash-bound approval**: store `{checkpointId, sha256}` of the full presented text (never `details.summary`); one presentation function (`presentationFor`) for presenting, `--approve` and the I-7 re-check | C-3 | M05/M06/M07/M09/M29 killed; Validator: no approval or SUCCESS without a hash-bound decision | Any human approval a later step relies on | `--yes` and the legacy `true` approver are deliberate exceptions |
| C-15 | **Resume by recorded completion**: skip a unit only when state records it done (non-invalidated PASS or an approval); always re-evaluate gates; rebuild outputs from `stageHistory` | C-2, C-13 | M01, M02, M33, M34, M54 killed; I-6 invalidation; skip rule traced | Any resumable pipeline | Watch pre-supplied/tier-1 steps (MINOR-4, MINOR-5) |
| C-16 | **Every refusal before any write**: pre-flight outside the `try`; coded `RunRefusedError`; `state.json` byte-identical on refusal; the CLI decides nothing | C-2 | Validator: no refusal writes `state.json`; DESCRIPTION_REQUIRED added the same way | Any command that can be refused | CLI and library must refuse in the same order (NEW-MINOR-1) |
| C-17 | **Rename, never delete**: archive to `_archive/<id>/`, supersede to `_superseded/<n>/`; reserved directory names matched in any letter case | C-6 | `clearStaleArtifacts` deleted; MINOR-7 fix | Run-artifact lifecycle | — |
| C-18 | **Two write primitives**: documents via `writeFileNoFollow` (`O_NOFOLLOW` + realpath containment), records via `writeFileAtomic` (rename); an unexpected file type at a guarded path refuses, never reads as empty | C-6 | NEW-MINOR-1 met; MINOR-1 fix (symlinked `.factory` → UNREADABLE_RUN) | Harness writes inside a tree agents can modify | — |
| C-19 | **Ratchet reference**: regression bar = max(first passing count, baseline), recorded on the round-0 gate record; later rounds read that record, never the file again | C-3, C-13 | D-A; `validatorRoundReference` (regression-baseline.ts:146); M11/M12 killed | Any "must not regress" threshold across resumes/rounds | — |
| C-20 | **Single choke point per side effect, guarded by a source scan**: `timedInvoke` is the only caller of `invokeAgent`; only change-diff spawns git (argv-only, allow-listed subcommands, env stripped, bounded output) | C-1, C-10 | orch:648; RH AC-45; M32 killed | Timing, auditing or sandboxing a side effect | Source scans catch only literal copies |
| C-21 | **Machine-readable CLI surface**: exported `CLI_FLAGS` / `EXIT_CODES` in the SKILL.md claims block; a drift test parses every documented command line | C-9 | AC-79; M48 (undocumented `--force`), M49 (renamed flag) killed | A CLI documented in prose | Prose semantics still drift (MINOR-2, NEW-MINOR-2) |
| C-22 | **Crash/resume fixtures**: `killAt(invoke, agent, n, cwd)`, `restoreSnapshot`, `removeOnPersist`, `decisions(...)` | — | Used by RS/CK and the TV's added tests | Testing resume and gate-invalidation paths | `killAt` never forwards the killed call — capture its prompt yourself |
| C-23 | **One helper per formatting rule** (e.g. `shellArg` for quoting `--cwd` in hints and refusals) | — | MINOR-6 fix (run-lifecycle.ts:235) | Any user-facing command text | — |

## New anti-patterns

1. Mutating the shared tree while another agent reads it (TV mutations during the Validator's review). → P-17
2. A decision applied to one code path (D-A at round 0 only). → P-15: list every path that reads the rule.
3. A guard that returns "empty" on an unexpected file type (symlinked `.factory` → `[]`) is fail-open. → C-18
4. A lossy fallback for missing input (`featureDescription ?? … ?? featureName`, a 60-char prefix). Refuse instead (IMPORTANT-1).
5. Proof by proxy or by a coincidental precondition (log-line assertions; a test passing because a later artifact is also missing). Assert the specific mechanism and criterion name.
6. A test plan listing only intended edits (brief §6). → P-20
7. Unchecked cost of per-commit fsync across orchestrator tests (suite ~51 s → ~180 s).
8. Session tool calls that skip a required approval (`update_memory`), and leftover patch files (`.orig`).

## Time estimate for the next similar run

Based on A-2: by hand, Backend Builder only, Researcher/Story reused.

| Part | A-2 measured | Estimate rule |
|---|---|---|
| Spec Writer | 20 min | ~20 min |
| Build | 196 min / 11 steps (mean ~18, range 11–32) | ~15 min per ordinary step; ~30 for an orchestrator-core step |
| Waiting on operator mid-build | ~23 min (~8%) | add ~10% |
| Live smoke | 2 min ($1.21) | ~2 min per live call |
| Verification (TV ∥ Validator + follow-up) | ~26 min elapsed | ~30 min (more if TV runs isolated or in sequence) |
| Fix round + re-check | 13 + ~3 min | ~15–20 min |
| Untimed between-step checks | ~28 min in the build window | scales with suite time (~180 s) × steps |

**Plan ~5 h for an 11-step run of similar scope** (A-2: ~4 h 20 m active + ~23 min waiting + untimed between-step time). Confidence: Medium (one measured run, one builder type, Research/Story not included). If the story isn't reused, add the Researcher and Story Writer (unmeasured; budget ≥2 story revisions on novel semantics, per A-1). Next: use the harness's `agentInvocations` for program runs and time the between-step checks.
