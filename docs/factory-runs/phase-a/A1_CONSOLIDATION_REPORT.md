# CONSOLIDATION_REPORT.md — Phase A, PR A-1 "Gates tell the truth"

> Agent 08 (Feature Consolidator), by-hand mode, read-only. 2026-10-04. PR A-1 (#3) merged to `main` at 9282d50, after the harness PR (#2).
> Sources: `docs/factory-runs/phase-a/{RESEARCHER_REPORT, USER_STORY, A1_TECHNICAL_BRIEF, A1_FILE_LIST, A1_TEST_VERIFIER_REPORT, A1_VALIDATION_REPORT, A1_VALIDATION_RECHECK}.md`, run facts from the orchestrating session, spot checks of the merged `factory/` code.
> Saved by the orchestrating session from the Consolidator's hand-back.

**Limits:** no per-agent timings were recorded (no time breakdown possible); confidence is qualitative (no data supports percentages); the Test Verifier's mutation counts overlap as written (36 edits vs 33 + 4 + 2 = 39 outcomes).

## 1. What happened

| Step | Agent / actor | Outcome | Iterations |
|---|---|---|---|
| Research | 01 Researcher | 12 claims checked (A1–A12), all confirmed, several wider than claimed; 10 other bugs found. Live check: Jest's summary goes to stderr (stdout 52 bytes, stderr 43,098 bytes). | 1 |
| Story | 02 Story Writer | 79 ACs in 9 groups; surfaced 9 conflicts and 9 open questions, answered by the operator as requirements. | **2 revisions before CP1** |
| CP1 | Operator | Approved; Phase A split into A-1 (F, G, P, V, C) and A-2 (R, K); 3 interpretations accepted. | — |
| Spec | 03 Spec Writer | D-1..D-15, full AC→test-title traceability, 8-step build order, 14 operator issues; FILE_LIST 19 CREATE / 32 MODIFY / 1 DELETE. | 1 |
| CP2 | Operator | All 14 issues accepted, I-10 changed (skipped/todo → IMPORTANT finding); binding §13. | — |
| Build | 04 Backend Builder ×8 (fresh per step) | Tests 231 → 437; session re-ran typecheck + jest after every step; **0 failed steps**. Frontend Builder not needed. | 8 steps |
| Test verification | 06 (parallel with 07) | 41/41 ACs proven; mutation testing found 1 real gap (AC-14), 2 tests added; 439 tests; 81 implementation files checksum-identical. | 1 |
| Validation | 07 (parallel with 06) | PASS: 0 CRITICAL, 5 IMPORTANT, 13 MINOR; 17 SKILL.md claims spot-checked. | 1 |
| CP3 | Operator | Fix round for IMPORTANT-1..4 + MINOR-12/13; IMPORTANT-5 decided: count tests that ran. | **1 fix round** |
| Re-check | 07 | All fixes resolved; 4 new MINOR (one false alarm); 471 tests, typecheck 0. | 1 |
| Delivery | Operator + session | PR #2 then PR #3 merged; `gh pr create` blocked by the auto-mode classifier until a permission rule was added. | — |

## 2. Time and iteration profile

- Wall-clock time per agent: **not recorded**.
- Researcher's estimate for all of Phase A: ~2–3 builder-days (low confidence); actuals unknown.
- Iterations: before build 2 story revisions + 1 brief change; during build 0 failed steps; after build 1 fix round (5 IMPORTANT + 2 MINOR). Validator CRITICAL loop-backs: 0.
- Tests: 231 → 437 → 439 → 471.

## 3. What worked

1. Researcher verification with file:line evidence, plus a live check of the riskiest finding before any AC was written.
2. Story Writer surfacing conflicts instead of resolving them silently — every answer became an AC.
3. Splitting the phase at CP1, with A-1 leaving extension points for A-2 (brief §10).
4. The brief's AC → test-title traceability table, used mechanically by the Test Verifier and Validator.
5. Fresh builder per step plus independent re-verification — no failure carried between contexts.
6. Mutation-proving tests — found the one weak AC the green suite hid.
7. A code-reading, threat-modelling Validator — found IMPORTANT-1 (writes to any absolute path) and IMPORTANT-3 (orphaned process groups), invisible to tests.
8. A scoped re-check after the fix round, with the session checking findings back against code (NEW-MINOR-4 was a false alarm).

## 4. What didn't work, or cost extra

1. Two story revisions — lifecycle semantics had no precedent in the repo.
2. ACs that couldn't be met as written (AC-26, AC-4 in CI, AC-21 for Stage 3) — caught by the Spec Writer, but shouldn't have been in the story.
3. Parallel Test Verifier + Validator — faster, but the Validator couldn't review the Test Verifier's added tests, and had no shell.
4. IMPORTANT-1..4 all passed a green suite and the mutation pass; only reading review found them.
5. Delivery friction (`gh pr create` permission).
6. No memory baseline for subagents; the session must write every run document itself.

## 5. Confidence profile (qualitative)

| Area | Confidence | Basis |
|---|---|---|
| Execution gate | High | 0 failed steps; mutation-proven; AC-14 closed; live stderr check |
| Stage 4 gate on real evidence | High | AC-18..22 mutation-proven at unit and orchestrator level |
| Validator loop-back | Medium | Tests only; IMPORTANT-4 found by review; never run live |
| Artifact persistence/containment | Medium-High | Two holes fixed; NEW-MINOR-1/2 open |
| SDK `anyOf` tri-state schema | Low (unverified) | I-13 live smoke run still owed |
| SKILL.md truthfulness | High | Drift test + 17-claim spot check |

## 6. A-2 backlog (as recorded)

**Scope:** groups R (AC-34..42, 71..73) and K (AC-43..57, 74..78); AC-61; writing side of AC-65 (ran-count); AC-79.

**Carry-overs:** `05-frontend-builder.md:58` loop-back claim; `clearStaleArtifacts` deletes `_archive/`; README "152 tests"; hard-coded `knowledgeStored` (AC-48); unconditional "Resume with" hint (AC-42); approval not committed before next agent (AC-38), no CP3 (I-9); root scripts (AC-61); I-13 live SDK smoke run.

**MINOR 1–11** (A1_VALIDATION_REPORT): early-exit dev pass and daemonised grandchild; unbounded output buffers; Jest pattern overriding Vitest; case-sensitive `.factory/` check; merge without `cwd`; builder FAIL with 0 failures recorded PASS; directory claim counts as materialised; stale VALIDATION_REPORT can satisfy Stage 4; Validator IMPORTANT issues only from final round; `null` builder output → MANUAL; `--resume` round-0 reference.

**NEW-MINOR-1..3** (A1_VALIDATION_RECHECK): writes follow symlinks in the run dir; reserved names not blocked; unsafe pre-supplied spec name mis-categorised.

**Out of scope, worth stating (GAP-5):** builders have Write/Bash before Gate 2 and could rewrite the `test` script or `.factory/baseline.json`.

## 7. Time estimate for the next similar run

No measured baseline. Risk adders: novel lifecycle semantics (≥2 story revisions), review-only findings (1 fix round + re-check), live-only facts (probe before the story). **Recommendation: record per-agent time from A-2 on.** Until then the only figure is the Researcher's ~2–3 builder-days for all of Phase A, with A-2 expected to take the larger share.
