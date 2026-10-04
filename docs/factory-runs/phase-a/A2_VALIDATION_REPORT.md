# VALIDATION_REPORT.md — Phase A, PR A-2 "Run lifecycle"

> Agent 07 (Validator), by-hand mode, read-only. 2026-10-04. Branch `feat/phase-a2-lifecycle`, uncommitted working tree.
> Skills loaded by Read: `code-review-excellence.md`, `security-audit.md`.
> Saved by the orchestrating session from the Validator's hand-back (content condensed into tables; findings, evidence and verdicts unchanged). Operator decisions at Checkpoint 3 are at the end.

**Limits:** no shell (no `git diff`, `npm test`, typecheck run by the Validator); suite status (34 suites / 1053 tests at the time, typecheck 0) rests on the session's verification. Test files added in parallel by the Test Verifier were not reviewed here (see A2_VALIDATION_FOLLOWUP.md). Note: the Test Verifier's mutations were live in the shared tree for 5–60 s each while this review read files; the session confirmed this report's IMPORTANT-1 and MINOR-1 against the real code.

## Verdict

**PASS with findings — 0 CRITICAL, 1 IMPORTANT, 8 MINOR.** Every in-scope item is implemented with tests naming its ID. The A-1 bug class stays closed: no gate passes on missing or fabricated evidence; no approval or SUCCESS without a hash-bound decision (except `--yes` and the library's legacy `true`); no refusal writes `state.json`; the regression bar cannot drop on any path (resume, validator rounds, CP3 rework).

## Item table

orch = `factory/feature/workflows/feature-factory-orchestrator.ts`. Test files: RS resume, CK checkpoint-lifecycle, RD run-directory, RL run-lifecycle, CS consolidate, CPR checkpoint-presentation, CD change-diff, RB regression-baseline, VL validator-loop-back, OG orchestrator-gates, SG stage-gates, SCX stage-context, AOS agent-output-schema, SW safe-write, HD harness-documents, FS feature-spec, RH repo-hygiene, DD doc-drift, CLI cli.

| Item | Status | Evidence |
|---|---|---|
| AC-34 | Met | orch:474, :1286, :1364, :1375, :1467; run-progress.ts:145-154; RS:231 |
| AC-35 | Met | orch:1911-1918; state-tracker.ts:924-951; RS:286; CLI:582 |
| AC-36 | Met | orch:869-879; run-lifecycle.ts:96-115; RS:313 |
| AC-37 | Met for A-2 runs; deviates for pre-A-2 runs (IMPORTANT-1) | state-tracker.ts:329-335; orch:453, :622; cli.ts:404-412, :451-454; CLI:594, :605 |
| AC-38 | Met | orch:722-724; CK:73 |
| AC-39 | Met | orch:1292, :1495-1499, :1523, :1542, :1694-1696; RS:391 |
| AC-40 | Met | run-directory.ts:184-210; RD:71, :109, :386 |
| AC-41 | Met (except a symlinked `.factory`, MINOR-1) | run-directory.ts:221-228; orch:452; RD:126, :407; CLI:623 |
| AC-42 | Met | run-lifecycle.ts:224-248; cli.ts:346; RL:340-395; CLI:781 |
| AC-71 / AC-72 / AC-73 | Met | run-lifecycle.ts:198-205, :110-115; orch:430, :1905-1909, :863, :1008; stage-gates.ts:656-671; run-directory.ts:261-282; RS:472, :528; RD:254, :274; CLI:636, :649, :671 |
| AC-43 / AC-44 / AC-45 | Met | checkpoint-presentation.ts:78-118; orch:785, :808, :2014-2020, :2061-2064; change-diff.ts:63, :84; CK:151, :510; CPR:69-225; RH:298 |
| AC-46 … AC-54 | Met | orch:744-758, :728-742, :723, :446, :1874-1882, :2186-2203, :433-437; consolidate-run.ts:100-136; stage-gates.ts:322-349; run-lifecycle.ts:174-180; CK/CS/CLI tests |
| AC-55 / AC-56 / AC-57 / AC-78 | Met | orch:1230-1270, :767-813; CK:368-472; SG:612-642 |
| AC-74 / AC-75 / AC-76 / AC-77 | Met | orch:1883-1900, :1919-2011; consolidate-run.ts:148-175; cli.ts:303-333; CK:747-906; CLI:155-570; RH:348 |
| AC-61, AC-4/I-3 | Met | root scripts gone; tsconfig.json:18-29; RH:121 |
| AC-65 (write) | Met | regression-baseline.ts:165-194; orch:2061; CK:603; RB:201-241 |
| AC-79 | Met | SKILL.md:36-59, :438-452; cli.ts:41-54; DD:222, :231, :256 |
| Carry-overs 1–8 | Met | 05 contract (RH:133); clearStaleArtifacts removed (RD:426); README count-free (DD:265); AC-48; AC-42; AC-38; AC-61; S-1 PASS |
| MINOR-4,5,6,7,8,9,10,11 | Met | stage-context.ts:131-141; validator-routing.ts:104-123; orch:985-993, :897-905, :1660-1671; agent-output-schema.ts:762-780, :922-926; regression-baseline.ts:125-135 |
| NEW-MINOR-1,2,3 | Met | safe-write.ts:146-164; stage-context.ts:245-291; harness-documents.ts:268; feature-spec.ts:136-141 |
| I-6 / I-7 | Met (I-7 covers CP1, CP2, CP3) | orch:772, :795, :1294, :1547-1551, :449, :2214-2234; RS:546, :593, :715 |
| D-A / D-B | Met | regression-baseline.ts:125-156; orch:557-560, :1943-1967; run-progress.ts:288-294; RB:162-176; VL:567, :587; RS:654; CK:985-1013 |
| TIMING | Met | orch:633-651; state-tracker.ts:886-893; consolidate-run.ts:131-146; RS:86 |
| MINOR-1, -2, -3 (A-1) | Deferred by operator (I-17) | execution-gates.ts unmodified |

## Findings

### CRITICAL
None.

### IMPORTANT
**IMPORTANT-1 — Resuming a pre-A-2 run without `--feature` silently briefs every agent with the truncated run name.** cli.ts:451-454 (`featureDescription ?? command.feature ?? featureName`), orch:622. Brief D-2 and SKILL.md:251-252 say `--feature` is required for pre-A-2 runs; the code never refuses and falls back to `featureName` (first 60 chars of the original `--feature`). Scenario: resuming an A-1 run left ESCALATED at Stage 4 — the I-13 migration population — makes the Test Verifier and Validator validate "<60-char prefix>". Passing `--feature` once doesn't fix later resumes (never written into state). No test. canFix true; backend.

### MINOR
1. **A symlinked `.factory` disables the unfinished-run guard (AC-41).** run-directory.ts:131-133 returns `[]` when `lstat` sees a symlink; a fresh start archives and refuses nothing, and `saveState` writes through the symlink. `findRun`/`closeRun` work through it, so the guard is the only fail-open part.
2. **SKILL.md overclaims resume re-evaluation and briefing.** SKILL.md:231-234: the story/spec halves of the Stage 2 gate are skipped once CP1/CP2 are approved (replaced by the I-7 hash check), and only 02/03 are briefed with the gate's reason (Researcher, Test Verifier, Validator re-run without it). Docs-without-code (A-1 C-9 pattern); the drift test doesn't catch it.
3. **change-diff.ts claims repo config "cannot make it run anything" — false.** change-diff.ts:15-17, :66: `git diff <commit>` still runs `.gitattributes` clean/process filter drivers (e.g. git-lfs) at CP3 presentation and on `--approve 3` / I-7. No privilege gain (only the user or a Bash-capable builder, GAP-5, configures it). Fix the comment or disable filters.
4. **Resuming a pre-supplied run whose spec `acceptFeatureSpec` rejected silently becomes a full planning run** (orch:2040-2047; contradicts orch:1237-1239). CP1/CP2 still gate it.
5. **A kill between `preSuppliedStages`' tier-1 commits loses the supplied story or brief** (orch:1253-1261); the factory's Story Writer then runs over it. CP1 still presents the result.
6. **Refusal messages don't quote `--cwd`** (orch:2200-2201, :2231); a path with a space breaks the copy-paste command. `nextStepHints` does quote it.
7. **`_archive` compared case-sensitively** (run-directory.ts:136): a `.factory/_Archive` on APFS is "renamed into itself" (EINVAL) and the start fails with a raw error. Nothing lost.
8. **A pre-A-2 builder MAX_LOOPS escalation has no `builderPhase`**, so a plain resume is allowed and immediately re-escalates (run-lifecycle.ts:131-132); only the next resume asks for `--grant-attempts`. Correct, one extra round.

### Paths traced with no defect
Resume skip rule (builders never skipped across phases); pending validator round re-entry; CP3 rework order and supersede idempotency; baseline write failure → escalate, resume rewrites after the CP3 re-hash; approve/reject/grant are single commits; all refusals before the try; exit codes 0/1/3 exactly per D-6; old state.json files load, pre-A-2 approvals without `checkpointId` never satisfy a checkpoint (fail closed).

## SKILL.md spot-check (22 claims)
20 true; #14 (gates "always evaluated again", "briefed with the gate's reason") partly true → MINOR-2; #17 (`--feature` needed for pre-A-2 runs) not enforced → IMPORTANT-1. Checked claims include: usage errors exit 1; exit codes 0/1/3; applicable hints only; terminal-safe output; approval saved before next agent with SHA-256 of full text; unpresentable document escalates without asking; no TTY pauses; CP3 diff rules; archive-then-refuse; `--approve` re-hash; PAUSED no-op; `_superseded/<n>/`; CP3 rework order; attempt continuation; approved-artifact re-hash; refusals before any write; baseline before SUCCESS; D-A wording; builder FAIL/null retried; `.factory` claims case-insensitive.

## Security notes
- authImplemented `not_applicable` (local CLI, auth ABSENT per brief §11); inputValidated `true` (run ids, checkpoint ids, grants, notes, artifact names, git base validated before git sees it); noHardcodedSecrets `true`; sqlInjectionProtected / xssProtected `not_applicable` (terminal escaping via `printableForTerminal`; bidi characters backlog).
- Git: `spawnSync` argv, no shell; only `rev-parse`, `diff`, `ls-files`; `GIT_DIR`-style vars stripped; `GIT_OPTIONAL_LOCKS=0`; bounded output (CP3 escalates past the limit). Filter drivers can still run (MINOR-3).
- Writes: `O_NOFOLLOW`, realpath containment, lstat; atomic rename; supersede/archive rename only, nothing deleted; checkpoint reads refuse symlinks.
- Accepted risks (GAP-5, state in the PR): a Bash-capable builder can delete/replace `baseline.json` (lowering the next run's bar), make `.factory/<id>` a symlink before `saveState`, or edit approved documents (I-7 then refuses to resume — fails closed). Operator `--notes` are quoted into prompts verbatim (trusted input).

## Backlog / carry-overs for the PR description
IMPORTANT-1 and MINOR-1,2,3,6,7 → fix round (operator-approved). MINOR-4,5,8 → backlog. Build-notes backlog: bidi controls; case-sensitive `:(exclude).factory` pathspec; README "ten agents"/"five stages"/old diagram (I-19); stale claims in `factory/feature/reference/STAGE_CONTRACTS.md:61, :273` and `factory/feature/docs/*.md` (I-19). Deferred to Phase B: MINOR-1, -2, -3 (A-1), GAP-3, GAP-5. I-13 closed by S-1. D-A and D-B implemented and tested. User-visible changes: brief §8 items 1–13 (notably `--yes` reaches SUCCESS and writes `baseline.json` unattended; old ESCALATED runs must be `--close`d once).

✓ VALIDATION COMPLETE — ready for human PR review

---

## Operator decisions at Checkpoint 3 (2026-10-04)
- **Fix round approved:** IMPORTANT-1 (refuse a pre-A-2 resume without `--feature`; save the description when given), MINOR-1 (refuse a symlinked/non-directory `.factory`), MINOR-2 (correct SKILL.md), MINOR-3 (disable filter drivers if git allows it generically, else correct the comment as an accepted risk), MINOR-6 (quote `--cwd` via the existing helper), MINOR-7 (`_archive` in any case), plus follow-up MINOR-1 and MINOR-3 (see A2_VALIDATION_FOLLOWUP.md).
- MINOR-4, 5, 8 → A-2 backlog / PR description.
