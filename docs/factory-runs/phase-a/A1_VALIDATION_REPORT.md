# VALIDATION_REPORT.md — Phase A, PR A-1 "Gates tell the truth"

> Agent 07 (Validator), by-hand mode, read-only. 2026-10-04. Branch `feat/phase-a1-gates`, uncommitted working tree.
> Skills loaded by Read: `code-review-excellence.md`, `security-audit.md`.
> Saved by the orchestrating session from the Validator's hand-back (content unchanged except formatting). Operator decisions taken at Checkpoint 3 are recorded in the final section.

**Limits of this review:** no shell, so `git diff`, `npm test` and `npm run typecheck` were not run by the Validator; suite status rests on the Test Verifier and on the session's own verification (25 suites / 439 tests, typecheck exit 0). Final file contents on disk were reviewed against the story, the brief (§13 binding), the file list and the test suites.

---

## Summary verdict

**PASS with findings — 0 CRITICAL, 5 IMPORTANT, 13 MINOR.**

Every in-scope AC (AC-1..33, 58..60, 62..64, 66..70, AC-65 read side) is implemented, each with at least one test whose title names its ID. D-1..D-15 and the §13 resolutions (I-1..I-14, including the I-10 change) are implemented as written.

The bug class this PR targets is closed in every path traced: 0/0 passes; stderr dropped; self-reported regressions; vacuous Stage 4 metadata; warn-and-continue gates; harness-written documents treated as evidence.

---

## AC table

| AC | Status | Evidence (file:line) |
|---|---|---|
| AC-1 | Met | orch:128-137 (seam, `DEFAULT_GATES`), orch:237-240, orch:617/680. Tests: OG:36, RH:59 |
| AC-2 | Met | `factory/test/fixtures/{agent-outputs,gates,harness-run}.ts`. Test: RH:74 |
| AC-3 | Met | `factory/test/orchestrator.test.ts` deleted. Test: RH:108 |
| AC-4 | Met ([S]; local typecheck per I-2) | tsconfig.json:33-36. Test: RH:121 |
| AC-5 | Met | orch:616-631. Test: OG:55 |
| AC-6 | Met | orch:679-694. Test: OG:71 |
| AC-7 | Met | orch:702-725. Test: OG:86 |
| AC-8 | Met | execution-gates.ts:355. Test: EG:82 |
| AC-9 | Met | execution-gates.ts:235-278, :465-466. Tests: EG:101, :139 |
| AC-10 | Met | execution-gates.ts:284-294, :587. Tests: EG:158, :187 |
| AC-11 | Met | execution-gates.ts:398, :421-423. Test: EG:192 |
| AC-12 | Met | execution-gates.ts:376. Test: EG:211 |
| AC-13 | Met | execution-gates.ts:140-190. Tests: EG:245, :284; RH:130 |
| AC-14 | Met | execution-gates.ts:406-412, :490-493. Test: EG:305 |
| AC-15 | Met | execution-gates.ts:578-583. Test: RH:144 |
| AC-16 | Met | agent-output-schema.ts:636-657. Tests: AOS:133, OG:126, :142 |
| AC-17 | Met | stage-gates.ts:328-369; orch:354-372, :659, :728, :1116. Tests: SG:428, :446; OG:169 |
| AC-18 | Met | stage-gates.ts:627-672; stage-context.ts:392-394. Tests: OG:217, :235; SG:321-387 |
| AC-19 | Met | orch:1020-1042, :1297-1327. Test: OG:251 |
| AC-20 | Met | orch:1084-1095. Test: OG:286 |
| AC-21 | Met for relative paths (see IMPORTANT-1) | stage-gates.ts:358-361; orch:1041, :1076, :1362-1365. Tests: OG:309, :328; SG:397 |
| AC-22 | Met (see IMPORTANT-5) | stage-gates.ts:725-765; orch:317-348; regression-baseline.ts:104-110. Tests: OG:403, :419, :430; VL:468, :489 |
| AC-23 | Met | orch:1054. Test: OG:457 |
| AC-24 | Met; depends on persisted filename = artifact name (IMPORTANT-2) | upstream-artifacts.ts:53-68; agent-prompts.ts:142-151, :227-265. Tests: UA:88, :119 |
| AC-25 | Met | harness-documents.ts:34-36, :254-271; orch:960-968; stage-context.ts:98-111. Test: UA:135 |
| AC-26 | Met | only `docs/factory-runs/**` contains the segment (excluded per I-1). Test: RH:154 |
| AC-27 | Met | Test: RH:191 |
| AC-28 | Met | upstream-artifacts.ts:71-96. Test: UA:175 |
| AC-29 | Met (+ Stage 3 gate re-run, I-8) | orch:1141-1196. Tests: VL:211, :249, :279 |
| AC-30 | Met | orch:1181-1186. Test: VL:300 |
| AC-31 | Met | orch:1152-1167; validator-routing.ts:53-84. Test: VL:347 |
| AC-32 | Met (`MAX_LOOPS`) | orch:1129-1139. Test: VL:373 |
| AC-33 | Met | orch:434, :1189, :1192. Test: VL:392 |
| AC-58 | Met | invoke-agent.ts:34-38. Test: RH:206 |
| AC-59 | Met | SKILL.md:234-258. Tests: DD:58-124 |
| AC-60 | Met | SKILL.md:220. Tests: DD:126, :148 |
| AC-62 | Met | stage-gates.ts:89-102. Tests: SG:293, :305 |
| AC-63 | Met | cli.ts:39-75, :231-245. Tests: CLI:66-124 |
| AC-64 | Met | execution-gates.ts:385-386, :445-447. Test: EG:340 |
| AC-65 (read) | Met | regression-baseline.ts:68-97; stage-context.ts:188. Test: OG:486 |
| AC-66 | Met | regression-baseline.ts:108-109; stage-gates.ts:748. Test: OG:500 |
| AC-67 | Met | security-checks.ts:30-74; output-schemas.ts:55-62, :233-245. Tests: SC:34, OG:340 |
| AC-68 | Met | security-checks.ts:46-60. Tests: SC:64, OG:358 |
| AC-69 | Met | frontend-files.ts:13-20; validator-routing.ts:72-73. Tests: VL:177, :327; RH:243 |
| AC-70 | Met | state-tracker.ts:383-398; orch:445-447. Tests: VL:405, :425 |

Corrupt baseline → outer catch → ESCALATED (MANUAL) at stage 4 (orch:673; OG:513). `.factory/` claims → `HALLUCINATION_DETECTED` (orch:550-563; OG:104).

---

## Findings

### CRITICAL
None.

### IMPORTANT

**IMPORTANT-1 — The harness writes a read-only agent's document to any absolute path the agent names.** `factory/harness/stage-context.ts:227-236`: `persistArtifacts` relocates a path into the run dir only when relative. Scenario A (AC-21): a Validator returning `path: '<cwd>/VALIDATION_REPORT.md'` lands in the project root; Stage 4 still passes (keyed by name); the 08 prompt omits it. Scenario B (security): a prompt-injected Researcher returning `path: '/Users/<u>/.zshrc'` gets that file written, defeating the read-only tool grant. Pre-existing; widened by A-1 (07 and 08 now go through `persist`). No test covers it. canFix true; backend.

**IMPORTANT-2 — Persisted documents are named after `basename(path)`, not the artifact `name`.** `stage-context.ts:228` / `:281`; `upstream-artifacts.ts:60`. A Spec Writer returning `{name:'TECHNICAL_BRIEF.md', path:'docs/brief.md'}` is saved as `brief.md`; the gate passes (keyed by name) but the builder prompt silently omits the approved brief. canFix true; backend. One fix closes 1 and 2: always write `join(artifactDir, artifact.name)`.

**IMPORTANT-3 (regression introduced by this PR) — Gate 2 child processes are orphaned when the orchestrator is interrupted.** `execution-gates.ts:150-155` (`detached: true`); no SIGINT/SIGTERM/exit handler exists. Ctrl-C reaches only the orchestrator; `npm run test`/`dev` keep running; a surviving dev server's port causes `EADDRINUSE` on the next run, which blocks as CRITICAL. canFix true (track live group pids; kill on SIGINT/SIGTERM/exit); backend.

**IMPORTANT-4 — A validator round false-blocks when the fixing builder reports writing no new tests.** `validator-routing.ts:107` (next wins for `testing`), `stage-context.ts:368-372`, orch:1192. An honest `testsWritten: 0` makes merged `testPassRate` 0 → Stage 3 "Unit Tests Pass" fails → escalation on correct work. Fail-closed but defeats AC-29. canFix true; backend.

**IMPORTANT-5 (operator decision) — "No Regressions" counts skipped/todo tests toward the reference.** orch:326, `stage-gates.ts:748`, `execution-gates.ts:222-225`. A round can `.skip` failing tests and still pass the count rule (only an IMPORTANT finding records it). canFix true (compare `passed + failed` against the reference); backend.

### MINOR

1. `execution-gates.ts:406-412`: a dev script that exits 0 early (`"dev": "echo ok"`) is PASSED; `:167` group SIGKILL only on timeout/error, so a daemonised grandchild of a normally-exiting command survives.
2. `execution-gates.ts:159-160`: unbounded stdout/stderr buffers over a 30-minute run.
3. `execution-gates.ts:239`: Jest pattern checked first; a stray `Tests: N passed, N total` line in a Vitest run overrides the real summary.
4. `stage-context.ts:124-130`: the `.factory/` claim check is case-sensitive; `.Factory/...` passes on case-insensitive APFS.
5. `validator-routing.ts:96, :101`: `mergeBuilderOutput` normalises without `cwd` (harmless today).
6. orch:457-520: a builder returning `status: 'FAIL'` with a valid schema and 0 failing tests is recorded PASS (pre-existing).
7. `agent-output-schema.ts:861-893`: Gate 1 counts a directory claim as materialised (pre-existing; documented).
8. `stage-context.ts:289-301` + `agent-output-schema.ts:730-740`: a stale/foreign `VALIDATION_REPORT.md` in the run dir can satisfy Stage 4 when the current Validator returns none (guarded in production by the SDK schema, not by `validateOutputSchema`).
9. orch:1116-1122: Validator IMPORTANT issues are recorded only from the final passing round.
10. orch:457: a builder invoker returning `null` escalates MANUAL rather than SCHEMA_VALIDATION.
11. orch:317-318: under A-1 `--resume` (restarts from Stage 1) round 0's reference is the previous attempt's first Gate 2 record (A-2 territory).
12. `execution-gates.test.ts:229`: test titled "AC-12 a missing test script…" covers a D-3 rule, not AC-12.
13. SKILL.md:179-180 lists "timeout" as a failure for dev (for dev, timeout is the pass condition); SKILL.md:182 says every Gate 2 evaluation is recorded, but an audit that throws records nothing.

---

## SKILL.md spot-check (17 claims)

| # | Claim (SKILL.md line) | Code | Verdict |
|---|---|---|---|
| 1 | Exit 0 only on SUCCESS (:24) | cli.ts:204-224 | True |
| 2 | Pre-supplied spec skips Stages 1-2; no checkpoint (:48-50) | orch:759-787; feature-spec.ts:129-154 | True |
| 3 | `--resume` restarts at Stage 1 (:45-46) | orch:231, :759+ | True |
| 4 | No approver → first checkpoint escalates (:118-119) | orch:387-397 | True |
| 5 | No TTY and no `--yes` fails closed (:116-117) | cli.ts:94-102 | True |
| 6 | Only CRITICAL blocks; throwing criterion blocks; required docs enforced (:133-136) | stage-gates.ts:335-369 | True |
| 7 | Stage contract table (:138-144) | stage-gates.ts:107-312 | True |
| 8 | Gate 1 `.factory/` rejection; only existence blocks (:148-152) | orch:550-585; agent-output-schema.ts:861-893 | True |
| 9 | Gate 1.5 CRITICAL/warning lists (:159-164) | infrastructure-gates.ts:80-258 | True |
| 10 | Gate 2 order, group kill, 30m/15m/15s (:168-171) | execution-gates.ts:90-94, :140-190, :578-583 | True |
| 11 | Skipped/todo excluded; warning → finding (:176-177) | execution-gates.ts:225, :418-432; orch:728 | True |
| 12 | Build/dev failures include "timeout" (:178-180) | execution-gates.ts:383-412 | Partly true (MINOR-13) |
| 13 | `not_applicable` needs reason + ABSENT surface (:190-195) | security-checks.ts:46-60 | True |
| 14 | Regression reference: baseline, then run's first count (:196-201) | regression-baseline.ts:104-110; orch:317-318 | True |
| 15 | Validator rounds mechanics; `MAX_LOOPS` after 2 (:225-232) | orch:1129-1196 | True |
| 16 | Startup deletes every `.factory/` dir except this run's (:287-289) | stage-context.ts:181-194 | True (also deletes `_archive/` — carry-over) |
| 17 | Stage 5 never blocks; Knowledge Stored hard-coded (:93-96) | orch:1251-1254 | True |

---

## Security notes

- **Command construction:** constant strings `npm run test|build|dev`; `cwd` passed as an option, never interpolated. No injection. Running the project's own scripts is by design.
- **Process-group kill:** only on pids of children spawned `detached: true`; cannot hit the orchestrator's group; ESRCH swallowed. Real gap: orphaning on interrupt (IMPORTANT-3).
- **Writes outside the run dir:** `writeHarnessDocument` is allow-listed and safe. `persistArtifacts` writes absolute agent paths (IMPORTANT-1) — the one real hole.
- **Run-dir reads:** top-level regular files only; `Dirent.isFile()` skips symlinks. Safe.
- **Out of scope (GAP-5), worth stating in the PR:** builders and the Test Verifier have Write/Bash before Gate 2 and could rewrite the `test` script to print a fake summary, or write/delete `.factory/baseline.json`. The harness has no defence against a builder changing the measurement tooling.
- **Secrets:** none. No new dependencies.
- **State-file compatibility:** all new `FeatureState` fields optional and defaulted; old `state.json` files load.

---

## A-2 carry-overs confirmed

1. `05-frontend-builder.md:58` still says "Loop back to Backend Builder to fix the API contract".
2. `clearStaleArtifacts` (`stage-context.ts:187-191`) deletes `.factory/_archive/` too.
3. `README.md:56`, `:134` still say "152 tests".
4. `knowledgeStored: true` hard-coded at orch:1251 (AC-48).
5. CLI prints "Resume with: … --resume" unconditionally (`cli.ts:218`; AC-42).
6. Checkpoint approval recorded at orch:405 but not committed before the next agent (AC-38); no CP3 (I-9, by design).
7. The four untracked root scripts remain, excluded at tsconfig.json:33-36 (AC-61).
8. I-13: one live SDK smoke run of the `anyOf` Validator security schema after merge.

✓ VALIDATION COMPLETE — ready for human PR review

---

## Operator decisions at Checkpoint 3 (2026-10-04)

- **Fix round approved** for IMPORTANT-1, 2, 3, 4 and MINOR-12, 13 before commit.
- **IMPORTANT-5:** the "No Regressions" count compares only tests that ran (`passed + failed`) against the reference; skipped/todo tests do not count.
- MINOR 1–11 go to the PR A-2 backlog together with the carry-overs above.
