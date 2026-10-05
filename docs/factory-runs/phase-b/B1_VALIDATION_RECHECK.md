# B1_VALIDATION_RECHECK.md: PR B-1, scoped re-check of the CHECKPOINT 3 fix round

> Agent 07 (Validator), run by hand, read-only, 2026-10-05. Saved by the orchestrating session from the hand-back; the findings and recommendation are verbatim, and the evidence is condensed.
> - Static review of the real tree.
> - The session ran the suite: 1290 passed and 1 skipped, out of 1291. Typecheck is clean.

**Verdict: PASS.**
- All 13 items are RESOLVED (IMPORTANT-1, MINOR-1 to 7, FOLLOWUP-MINOR-1 to 5), plus the AC-103 re-measure.
- 0 CRITICAL, 0 IMPORTANT, 2 NEW-MINOR.
- The builder's residual (a kill or crash during the Test Verifier) is real. Recommendation: defer it to B-2 as a binding entry condition.

## Per item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | IMPORTANT-1 | RESOLVED | `stage3SnapshotPassedBy` (state-tracker.ts:1112-1134), used by `changeRework` (orch:2175-2182); Gate 1 still runs. Predicate units at snapshot.test.ts:229-262; [O] test at :640-692. |
| 2 | MINOR-1 | RESOLVED | docs/HARNESS_GAP_ANALYSIS.md:1, the same line as REFACTOR_PLAN.md:1 |
| 3 | MINOR-2 | RESOLVED | SKILL.md:658-659 |
| 4 | MINOR-3 | RESOLVED | `addImportantFindingsOnce` (state-tracker.ts:577-586). The RH guards at :671 and :696 are pure name swaps and keep the same invariant. |
| 5 | MINOR-4 | RESOLVED | `OBJECT_ID` exported once (state-tracker.ts:1047), imported at change-diff.ts:55; no cycle |
| 6 | MINOR-5 | RESOLVED | change-diff.ts:185-204; test at change-diff.test.ts:488-509 |
| 7 | MINOR-6 | RESOLVED (accepted, documented) | SKILL.md:181-184 |
| 8 | MINOR-7 | RESOLVED | SKILL.md:469 and :170-171 |
| 9–13 | FOLLOWUP-MINOR-1 to 5 | RESOLVED | b1-acceptance-gaps.test.ts: :76-85, :139/:145-146 (shared `code()` in fixtures/source-code.ts), :160-161, :90-91, :101-106 |
| — | AC-103 re-measure | DONE | B1_MEASUREMENTS.md: 82 s durable; 44 s and 43 s with fsync off; share about 47% (was 87%) |

## Targeted questions

- **AC-85 kill window:** preserved. If the process is killed after the ref write but before the state save, there is no entry, so the gate runs again. If the state was saved but no later step is on record, the predicate is false, so the gate runs again.
- **Equal timestamps:** `>=` is correct. Within one process, the Test Verifier, Validator or Gate 2 can only start after the snapshot commit. Neither ordering error is harmful.
- **RH guard edits:** pure name swaps. The invariant is unchanged.
- **Env stripping:** no change in normal runs. It changes output only when the operator exports one of the variables, and then it fails closed.

## New findings

- **NEW-MINOR-1, documentation drift:** SKILL.md:238-240 and :323-327 do not describe the new rule. Once a Test Verifier or Validator invocation, or a Gate 2 record, exists after the rework snapshot, the rework's Stage 3 gate is not re-run and `stage3-<k>` is kept.
- **NEW-MINOR-2, test gap:**
  - there is no unit row for the equality boundary (`startedAt === takenAt` → true);
  - there is no [O] test of the rework kill window (b). It is covered only for a validator round and for Stage 3.

## Residual: a kill or crash during the Test Verifier

**What it is.** The Test Verifier's invocation is recorded only when `invokeAgent` returns. If the process dies while the Test Verifier is running, or `invokeAgent` throws (an SDK or API error, a timeout, Ctrl-C), nothing is on record. On resume, the rework's Stage 3 gate runs again and replaces `stage3-<k>` with a tree that includes the Test Verifier's partial writes. An API error during the Test Verifier is a fairly common failure, so this is more than a theoretical kill.

- **Consequence today (B-1): forensic only.** No gate, hash or CP3 text reads snapshot content.
- **Consequence for B-2: real.** AC-123 and AC-125 extract the Validator's copy from the recorded rework ref, which could then contain the Test Verifier's deliberate breakage.

**Recommendation: defer to B-2, but as a binding acceptance criterion, not a backlog line.** B-1 has no consumer of snapshot content, so a fix now cannot be validated against the behaviour that matters.

Two fix directions for the B-2 brief:
1. Record a "verification started" marker (or the Test Verifier invocation's start) before invoking it. This mirrors how builder attempts are counted before they start.
2. Treat a recorded `written` rework entry as final.

Log it now in B_DECISIONS.md and in ROADMAP's B-2 section.

## Housekeeping and security

- **Housekeeping:** no invisible characters anywhere in the repo (excluding `node_modules`). No stray files.
- **Security:** `inputValidated` and `noHardcodedSecrets` are true. `authImplemented`, `sqlInjectionProtected` and `xssProtected` are not applicable. No issues.

**Status: PASS**
