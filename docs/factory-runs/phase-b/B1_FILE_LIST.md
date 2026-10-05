# B1_FILE_LIST.md: Phase B, PR B-1

All paths are relative to `/Users/enriqueibarra/cypher-claude-skills`. The Backend Builder handles every file except those marked **session**. The Frontend Builder is not needed. "Step" is the brief's §7 step.

## CREATE

| Path | Purpose | Step |
|---|---|---|
| `factory/harness/direction-characters.ts` | The shared set (`DIRECTION_CHARACTER_RANGES`), finder, `escapeCodePoint`, `documentFinding` | 7 |
| `factory/harness/document-check.ts` | `documentFindings(files)`: reads back written documents and returns one finding per affected document | 8 |
| `factory/test/harness/snapshot.test.ts` | [O] real-git snapshot tests: AC-45, 81, 82, 84-89 | 3 |
| `factory/test/harness/direction-characters.test.ts` | [U] AC-105, AC-106 | 7 |
| `factory/test/harness/direction-documents.test.ts` | [O] AC-107 to AC-110 | 8, 9 |
| `factory/test/fixtures/state-writer.ts` | `nonDurableStateWriter` (only if AC-104 is adopted) | 10 |
| `docs/ROADMAP.md` | Phases A–E, the REFACTOR_PLAN mapping, MINOR-3 accepted risk | 11 |
| `factory/feature/docs/{README,ORCHESTRATOR,QUICK_START,STAGE_GUIDE,ARCHITECTURE}.md` (new content after the move) | Pointers to the archive, SKILL.md and README | 11 |
| `factory/feature/reference/{STAGE_CONTRACTS,STATE_TRACKING,OUTPUT_SCHEMAS}.md` (new content after the move) | Pointers to the archive, SKILL.md and the TypeScript types | 11 |
| `docs/factory-runs/phase-b/B1_MEASUREMENTS.md` | **session**: AC-98 probe and AC-103 figures | S-0, S-2 |

## MOVE (`git mv`, **session**, operator-approved)

| From | To | Step |
|---|---|---|
| `factory/feature/docs/README.md` | `docs/archive/feature-docs/README.md` | S-1 |
| `factory/feature/docs/ORCHESTRATOR.md` | `docs/archive/feature-docs/ORCHESTRATOR.md` | S-1 |
| `factory/feature/docs/QUICK_START.md` | `docs/archive/feature-docs/QUICK_START.md` | S-1 |
| `factory/feature/docs/STAGE_GUIDE.md` | `docs/archive/feature-docs/STAGE_GUIDE.md` | S-1 |
| `factory/feature/docs/ARCHITECTURE.md` | `docs/archive/feature-docs/ARCHITECTURE.md` | S-1 |
| `factory/feature/reference/STAGE_CONTRACTS.md` | `docs/archive/feature-reference/STAGE_CONTRACTS.md` | S-1 |
| `factory/feature/reference/STATE_TRACKING.md` | `docs/archive/feature-reference/STATE_TRACKING.md` | S-1 |
| `factory/feature/reference/OUTPUT_SCHEMAS.md` | `docs/archive/feature-reference/OUTPUT_SCHEMAS.md` | S-1 |

After the move, step 11 prepends the header line `historical — not maintained; see SKILL.md (factory/feature/SKILL.md)` to each archived file.

## MODIFY

| Path | Purpose | Step |
|---|---|---|
| `factory/harness/change-diff.ts` | Allow-list arrays; `SAFE_GIT_CONFIG` additions; `git(env)` with the temp-index guard; `factoryRef`; `captureBase` branch/preExisting; `snapshot()`; header comment | 2 |
| `factory/harness/state-tracker.ts` | `ChangeBase` fields; `Stage3Snapshot` and its recorders; `HEAD_MOVED`/`SNAPSHOT_FAILED`; `context.head`; `recordImportantFindingsOnce` | 2, 3, 8 |
| `factory/feature/workflows/feature-factory-orchestrator.ts` | AC-97 pre-flight; `stage3Gate(at)` + `takeSnapshot`; `checkResumeDescription`, optional `featureDescription`; `checkDocuments` hooks; `presentCheckpoint`-only presentation; pre-B-1 messages; `stateWriter` (conditional); comment at :220-221 | 1, 3, 6, 8, 9, 10 |
| `factory/harness/checkpoint-presentation.ts` | Snapshot section; parts/banner/escaping; `unescapedSha256` | 3, 9 |
| `factory/harness/run-directory.ts` | `assertNoFactoryCaseVariant` | 1 |
| `factory/harness/run-lifecycle.ts` | `FACTORY_DIR_CASE_CONFLICT`; `checkResumeDescription`; MINOR-8 inference in `exhaustedBuilder` | 1, 6 |
| `factory/harness/execution-gates.ts` | Bounded output; line scanner; `selectTestSummary`; `summaryProblem`; dev SKIPPED; unconditional group kill and exit grace | 5 |
| `factory/harness/agent-prompts.ts` | Builder prompt: related tests, Gate 2, git/.factory rule | 4 |
| `factory/runner/cli.ts` | `printableForTerminal` uses the shared set; remove `assertSameDescription`/`resumeDescription`; banner-only description | 6, 7 |
| `factory/feature/workflows/consolidate-run.ts` | Document check after `persistArtifacts` | 8 |
| `factory/feature/agents/04-backend-builder.md` | Related tests only; full suite in Gate 2; never commit/push/switch, never write `.git/`/`.factory/` | 4 |
| `factory/feature/agents/05-frontend-builder.md` | Same as 04 | 4 |
| `factory/feature/SKILL.md` | All AC-115 edits (D-16 list); the :401 AC-60 line kept | 11 |
| `README.md` | :5, the stages section (:91-103), layout :157-158, :166 | 11 |
| `docs/archive/README.md` | List the new sub-folders; point at SKILL.md and ROADMAP.md | 11 |
| `docs/REFACTOR_PLAN.md` | One "superseded by ROADMAP.md" line at the top | 11 |
| `factory/test/fixtures/changes.ts` | `snapshot`, `snapshotCalls`, `FAKE_BASE` fields | 2 |
| `factory/test/fixtures/harness-run.ts` | `runToEnd` default `stateWriter` (conditional) | 10 |
| `factory/test/contracts/repo-hygiene.test.ts` | AC-45/80 rewrite (pre-approved); AC-90, 91, 100, 104 (conditional), 105, 107, 109 guards | 2, 4, 6, 7, 8, 9, 10 |
| `factory/test/contracts/doc-drift.test.ts` | Kept-docs scope, link check, retired claims for all kept docs, AC-91/93/111-115 | 11 |
| `factory/test/harness/change-diff.test.ts` | AC-80, AC-83; :66/:72 per I-2 | 2 |
| `factory/test/harness/execution-gates.test.ts` | AC-92 to AC-96 | 5 |
| `factory/test/harness/run-directory.test.ts` | AC-97 [O] | 1 |
| `factory/test/harness/run-lifecycle.test.ts` | AC-101 (pre-approved change at :191-196) | 6 |
| `factory/test/harness/resume.test.ts` | AC-99, AC-101 [O] | 6 |
| `factory/test/runner/cli.test.ts` | AC-97, 99, 101, 102 (pre-approved extension of :371-379), 109, 110 [C] | 1, 6, 7, 9 |
| `factory/test/harness/agent-prompts.test.ts` | AC-90/91 prompt test | 4 |
| `factory/test/harness/checkpoint-presentation.test.ts` | Snapshot section; AC-108 [U] | 3, 9 |
| `factory/test/harness/state-persistence.test.ts` | AC-104 [O] (conditional) | 10 |
| `factory/test/harness/consolidate.test.ts` | AC-107 08-document case, if not placed in direction-documents.test.ts | 8 |

## DELETE

None. (`assertSameDescription` in cli.ts is removed as code, not as a file.)

─────────────────────────────────────────────────────────────────
