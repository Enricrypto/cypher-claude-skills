# A2_VALIDATION_FOLLOWUP — scoped review of the Test Verifier's added tests

> Agent 07 (Validator), by-hand mode, read-only. 2026-10-04. Skill loaded by Read: `code-review-excellence.md`.
> Saved by the orchestrating session from the Validator's hand-back. This pass exists because the Test Verifier and Validator ran in parallel (operator decision for Phase B item B1): the Validator reviews only the test files the Test Verifier added — here exactly one, `factory/test/harness/a2-acceptance-gaps.test.ts` (5 tests).

Read: the whole file; fixtures (`harness-run.ts`, incl. `removeOnPersist`, `decisions`); orchestrator paths it drives (`reviewBrief` ~:792, `stage1` ~:1277, `stage4` ~:1510, `changeRework` ~:1977, `stage3Gate`, `infrastructureGate`); `stage-gates.ts`; the story text for AC-39, AC-75, AC-78; the control tests in `resume.test.ts` and `checkpoint-lifecycle.test.ts`. Tests not run by this agent (the session ran the suite: 35 suites / 1058 passed).

Whole-file checks: repo-hygiene clean (no `agent: '0N-…'` literal, no fixture definitions); temp dirs from `tempProject`, removed in `afterEach`; no processes spawned; no wall-clock timing; `RUN_TIMEOUT_MS` matches `resume.test.ts`.

## Per test

| # | Test | Verdict | Notes |
|---|---|---|---|
| 1 | AC-78 spec gate after the Spec Writer, before CP2 | SOUND (minor weakness) | Pins the full order 01 → 02 → story-gate → CP1 → 03 → spec-gate → CP2 → 04; kills "CP2 before the spec gate". Gate evaluation seen via the "✅ Spec gate passed" log line; the existing failing-gate AC-78 test covers a dropped gate call. |
| 2 | AC-39 Gate 1.5 re-evaluated on resume | SOUND, title wrong | `gates.calls` is exactly `['auditInfrastructure']`; escalation stage 4 / harness / INFRASTRUCTURE_FAILURE; no agent, no checkpoint. Kills "skip Gate 1.5 on resume" and "reuse the earlier result". It blocks the **Validator**, not the Test Verifier (06 already passed and is skipped). Control: resume.test.ts:408. |
| 3 | AC-39 Stage 4 gate re-evaluated on resume | SOUND | The failure comes only from the resumed Validator's `authImplemented: false`; control resume.test.ts:398-412 reaches SUCCESS. Checks agent 'harness' and "Stage 4 gate failed", no approver request, no baseline written. Kills "skip the Stage 4 gate on resume". |
| 4 | I-6 Stage 1 gate failure invalidates the Researcher | SOUND | Full Given/When/Then: report removed → gate fails → step kept PASS with `invalidated` → resume re-runs 01 first → SUCCESS → history `[invalidated, not invalidated]`. |
| 5 | AC-75 Stage 3 gate in the CP3 rework | SOUND (minor weakness) | Kills removal of `stage3Gate(4)` from `changeRework` (Gate 1.5, 06, 07 and CP3 would all run). Control checkpoint-lifecycle.test.ts:906. Checks only the "Stage 3 gate failed" prefix. |

## Findings (no CRITICAL or IMPORTANT)

- **MINOR-1** (:93, :117) — title says Gate 1.5 "blocks the Test Verifier"; it actually blocks the Validator. Rename, or invalidate 06 in the setup.
- **MINOR-2** (:71-74) — gate evaluation detected via log lines (log-as-proxy); acceptable because only order is pinned. Suggest a seam called on actual evaluation.
- **MINOR-3** (:146, :165, :212) — only the message prefix is checked; pin the failing criterion name (`[CRITICAL] <criterion>`): security for test 3, "Researcher Report Complete" for test 4, "Unit Tests Pass" for test 5.
- **MINOR-4** (:52-57) — `onDisk()` is a third copy of the live-run lookup (also in resume.test.ts:55-60 and fixtures `onlyLiveRun`), and unlike the fixture it doesn't exclude `_archive`. Export one from the fixtures.
- **MINOR-5** (:64) — legacy boolean approver via a comma expression; readability only.

**Verdict:** all 5 tests are sound and each kills the mutation it was written for; nothing blocks merge.

✓ FOLLOW-UP COMPLETE

## Operator decision (Checkpoint 3, 2026-10-04)
MINOR-1 and MINOR-3 are included in the CP3 fix round (title rename; criterion-name assertions). MINOR-2, 4, 5 → backlog.
