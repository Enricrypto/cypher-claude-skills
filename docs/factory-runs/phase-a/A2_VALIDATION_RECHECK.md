# A2_VALIDATION_RECHECK — PR A-2 Checkpoint 3 fix round

> Agent 07 (Validator), by-hand mode, read-only. 2026-10-04/05. Skills loaded by Read: `code-review-excellence.md`, `security-audit.md`.
> Saved by the orchestrating session from the Validator's hand-back. Session verification after the fix round: 35 suites / 1076 tests, typecheck 0.

**Verdict: all eight fix-round items RESOLVED. 0 CRITICAL / 0 IMPORTANT / 2 new MINOR (both fail closed). PR A-2 is ready for human PR review.**

## Per fix

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | IMPORTANT-1 — pre-A-2 resume needs a description | RESOLVED | `resumeDescription` (run-lifecycle.ts:221-229: saved description → non-blank `--feature` → `DESCRIPTION_REQUIRED` naming `--feature`); `recordFeatureDescription` (state-tracker.ts:899-906, refuses blank, never replaces); orchestrator pre-flight :436 (after `checkResumeRequest` :433, before any write); description saved at :463-466 after the AC-52 / I-7 checks and before any agent; prompts read it (:635); CLI cli.ts:460-461. Tests: run-lifecycle.test.ts:445-465, state-tracker.test.ts:460-470, resume.test.ts:312-361, cli.test.ts:633, :646 |
| 2 | MINOR-1 — symlinked `.factory` | RESOLVED | run-directory.ts:143-147: symlink / non-directory → UNREADABLE_RUN naming the path; missing `.factory` lists nothing. Fresh-start guard now fails closed. Tests: run-directory.test.ts:234, :251 |
| 3 | MINOR-7 — `_archive` letter case | RESOLVED | run-directory.ts:131-133 (lower-cased compare), used at :150; run ids can't start with `_`. Test: run-directory.test.ts:262 (passes on case-sensitive and case-insensitive file systems) |
| 4 | MINOR-6 — quote `--cwd` in refusals | RESOLVED | one exported `shellArg` (run-lifecycle.ts:235-237, also used by `nextStepHints` :248) for ARTIFACT_CHANGED (orch:2213-2214) and APPROVED_ARTIFACT_CHANGED (:2244). Tests: checkpoint-lifecycle.test.ts:755, :768 (space and `'` in the path) |
| 5 | MINOR-2 — SKILL.md resume wording | RESOLVED | SKILL.md:231-238 matches the code: story gate skipped once CP1 approved (orch:1383-1386), approved CP2 closes the stage (:1370-1373), I-7 in pre-flight (:455), `planningRework` only for 02/03 (:1402, :1440), Stage 1 and Stage 4 gates invalidate without a briefing |
| 6 | MINOR-3 — git filter drivers | RESOLVED as a documented ACCEPTED RISK | change-diff.ts:18-25 now states filter drivers do run; :73-76 corrected; `--no-ext-diff --no-textconv` (:224), fsmonitor off (:77). Reasoning holds: a filter's command comes only from git config (a committed `.gitattributes` can only select one); the same filters run on any `git status`/`git diff` the operator types; `--attr-source` (git 2.42) / `GIT_ATTR_SOURCE` (2.40) unavailable on 2.39.5 and would drop all attributes (changing the CP3 text and hash); naming drivers would need `git config`/`check-attr`, outside AC-45's allow-list; no privilege gain (GAP-5) |
| 7 | Follow-up MINOR-1 and MINOR-3 | RESOLVED | a2-acceptance-gaps.test.ts:93 title now "…blocks the Validator"; criterion assertions at :147 (`Security Audit Passed`), :167 (`Researcher Report Complete`), :215 (`Unit Tests Pass`) match stage-gates.ts:374 and the criterion names |

Builder deviation (a paused pre-A-2 run is refused even on a plain `--resume`): no substantive effect — a plain resume of a paused run is a no-op anyway, and `--approve`/`--reject` need `--feature` regardless; both library and CLI refuse with nothing written.

## No regressions in the touched code
AC-37 (A-2 runs resume from the saved description; DESCRIPTION_MISMATCH unchanged), AC-40/AC-41 (archive-then-refuse order unchanged; symlink gap closed), AC-52 (`assertPendingUnchanged` still before any write), I-7 (check at :455 precedes the :465 write; hashes don't include the description), SKILL.md "every refusal before anything is written" still true for DESCRIPTION_REQUIRED.

## New findings
- **NEW-MINOR-1** — the CLI calls `resumeDescription` (cli.ts:461) before `runFeatureFactory`, i.e. before `checkResumeRequest` (orch:433); the library order is the reverse. A pre-A-2 run that is finished (still in `.factory/<id>/`) or exhausted, resumed without `--feature`, reports DESCRIPTION_REQUIRED instead of RUN_FINISHED / NEEDS_GRANT. Fails closed; only the message and the number of steps are affected.
- **NEW-MINOR-2** — SKILL.md:255-256 said the description "is saved in the run, so later resumes do not need it"; on a paused pre-A-2 run a plain `--resume --feature` returns at orch:442 before the save at :463-466.

## Security (touched code)
authImplemented `not_applicable`; inputValidated `true` (blank descriptions refused; run ids validated; symlinked/non-directory `.factory` refused); noHardcodedSecrets `true`; sqlInjectionProtected / xssProtected `not_applicable`. Git still argv-only through the subcommand allow-list. A description supplied on resume reaches prompts verbatim, like `--feature` on a new run (trusted operator input). No security issues.

**Suggested PR wording for MINOR-3:** "Accepted risk (CP3 change capture): `git diff` runs any clean/process filter driver (e.g. git-lfs) that the operator's own git config defines and the repository's `.gitattributes` selects — the same filters any `git status`/`git diff` in that repo runs. External diff drivers, textconv and fsmonitor are disabled; `ls-files` runs none. Git ≤2.41 has no generic switch to disable filter drivers without also changing the diff (`--attr-source` needs 2.42); revisit when the minimum git version allows it."

✓ RE-CHECK COMPLETE

## Operator decisions (2026-10-05)
- **NEW-MINOR-2 fixed** before commit: SKILL.md:256 now says the description is saved when the resume continues the run, and a plain `--resume` of a paused run saves nothing.
- **NEW-MINOR-1 → A-2 backlog.**
- **CHECKPOINT 3 APPROVED.**
