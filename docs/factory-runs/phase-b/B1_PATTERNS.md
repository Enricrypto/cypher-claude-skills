# PATTERNS.md — from Phase B, PR B-1

> Agent 08 (Feature Consolidator), 2026-10-05. Saved verbatim by the orchestrating session from the Consolidator's hand-back.
> - Only NEW or REVISED patterns relative to `A1_PATTERNS.md` (P-1..P-11, C-1..C-13) and `A2_PATTERNS.md` (P-12..P-20, C-14..C-23). Earlier patterns not listed here still stand.
> - Evidence points to `docs/factory-runs/phase-b/B*_*.md`, `docs/ROADMAP.md`, the merged `factory/` code, and facts from the orchestrating session (marked "session fact").

## Process patterns

| # | Pattern | Revises | Evidence (B-1) | Apply when | Don't when |
|---|---|---|---|---|---|
| P-21 | **Isolated parallel verification by hand.** The Validator reviews an rsync'd read-only copy (no `.git`/`node_modules`/`.factory`, `chmod a-w`) while the TV mutates the real tree. The session checksums the implementation files before verification and re-checks them after | P-17, A-2 anti-pattern 1 | Session fact: 136 `factory/` files, 0 mismatches; 114 mutant runs `restored=true`; mutations were live 2–96 s and the Validator saw none; no finding needed re-confirming against real code (A-2 needed 2) | The TV mutates, and the Validator only reads | The reviewer must run tests (it would need `node_modules`); or once B-2 builds this into the harness |
| P-22 | **A session step (S-0) before the builders** for live probes and baseline measurements. A conditional step is decided from the number against a threshold fixed at CP2. A step that speeds up every later check is moved first | P-14, P-16 | AC-98 probe made AC-97 required; 87% vs the I-20 threshold of 20% adopted AC-104; D-B1-1 moved step 10 first; checks then ran 53–78 s instead of 191 s (≈22 min of suite time saved, estimate) | A step's value depends on an external fact or a measurable cost; or an independent step makes the shared check loop faster | The step depends on other steps' code |
| P-23 | **Invisible-character hygiene in by-hand runs.** Scan every saved subagent report right after saving it (D-7 b). Scan every changed source file at each step check. Builders build such characters from code points, even in shell one-liners | — (new) | A literal U+202E arrived in the Researcher's hand-back; tool parameters turned typed escapes into real characters in 2 run docs (caught) and in a builder's `node -e` (session facts, build-notes TIP at step 7); step checks 7–11 scanned clean. The Consolidator's own hand-back also carried one (replaced on save) | Always, once any document or code handles such characters | — |
| P-24 | **Operator scope added mid-run goes in through a story revision before CP1**, as its own AC group, and becomes a numbered decision | P-2 | D-7 after draft 1 → revision 1 (2.8 min) added group TX (AC-102, 105–110); 0 build-time scope surprises | Before CP1 | After CP2: open a new PR or a new decision with operator approval |
| P-25 | **A re-check residual that has no consumer yet becomes a binding entry condition of the next PR**: an AC its story must carry, recorded in the decisions file and in ROADMAP. Not a backlog line | P-19 | TV-crash residual → `B_DECISIONS` "Binding entry condition for PR B-2"; ROADMAP:57-62; the re-checker reasoned that a fix in B-1 couldn't be validated, because nothing reads snapshot content yet | The defect only matters to behaviour that a later, already-planned PR adds | The current PR already has a consumer: fix it now |
| P-26 | **A builder's proposal needs the operator's explicit confirmation**, never one inferred from a "yes" to something else | P-15 | D-B1-2: the session first read "yes" to starting step 2 as acceptance; the operator then confirmed "step 6 YES" | Any proposal that changes behaviour or scope | Surface typos |
| P-27 | **Git is session-only and approval-gated.** That includes read-only and index commands (`for-each-ref`, `add -N`, `reset`). Before push, check commit metadata: never Claude/Claude Code as co-author, no Claude attribution in PRs | P-10, A-2 anti-pattern 8 | Build notes step 3 (a builder's `git for-each-ref`); session facts: `git add -N .` + `git reset -q` unstaged the S-1 renames (reported at CP3); a co-author trailer was amended before push | Always | — |
| P-28 | **The CP3 list includes session-owned items**: re-measure any record-only AC the TV marks WEAK, and clean up leftovers from mutations | P-18 | AC-103 re-measured (87% → ~47%); 12 `factory-snapshot-*` temp dirs from M17 deleted | Any [M]/[L] AC; any mutation run that touches temp or system dirs | — |

## Code patterns

| # | Pattern | Revises | Evidence | Apply when | Don't when / watch |
|---|---|---|---|---|---|
| C-24 | **Private-ref plumbing snapshot.** `add` with a temp `GIT_INDEX_FILE` in a real `mkdtemp` directory directly under `os.tmpdir()`, guarded at runtime inside `git()`; then `write-tree` → `commit-tree --no-gpg-sign` → `update-ref` compare-and-swap. Hooks, reflog, split index and auto-gc are off; `GIT_*` env is stripped and the harness identity applied last. The user's branch, index and tree are never touched | C-20, C-6 | AC-80..89; M07/M07b (lookalike and symlinked index dir) killed only by gap tests; MINOR-5 added pathspec/namespace env stripping | The harness must record a tree without touching user state | Watch: refs pile up and may hold a stray `.env` (backlog); on git 2.39 `commit-tree` ignores `commit.gpgSign`, so pin both defences (C-32) |
| C-25 | **Records keyed by phase and upserted, plus a "passed-by" predicate.** A re-entered gate reuses its number; a gate whose phase has later recorded steps (TV, Validator, Gate 2) is not re-run on resume (`stage3SnapshotPassedBy`, `>=` on timestamps) | C-15 | IMPORTANT-1: without the predicate, the rework snapshot absorbed the TV's files on resume; fixed with an [O] test and unit rows (re-check) | Any resumable gate whose input later steps change | Watch: the predicate only sees steps recorded *on return*; record start markers too (B-2 entry condition) |
| C-26 | **A test-only seam for an expensive durability primitive**, plus a source guard that production never passes it. The non-durable writer keeps the same path, bytes and fail-closed error | C-1 | `stateWriter` (orch `save` choice point); suite 191 → 53 s; fsync 8,672 → 2,388; RH AC-104 allows exactly two mentions in the orchestrator | A durability cost dominates suite time (measure first, P-22) | Tests of the durability itself stay durable (direct `runFeatureFactory` callers) |
| C-27 | **One module spells a character set.** Ranges are in one place, regexes are built from them, and code points are built with `String.fromCodePoint`. A source guard bans any other spelling and requires every consumer to import it. One `escapeCodePoint` serves the terminal and checkpoints | C-20, C-23 | `direction-characters.ts`; RH AC-105; M70–M72, M122 caught | Security-relevant character classes | — |
| C-28 | **Escape, warn and hash what was shown.** Documents are stored exactly as written, plus an IMPORTANT finding. Presentation escapes every occurrence under a banner that lists each one by labelled part and line, and hashes the escaped text. An `unescapedSha256` detects "changed only by this version" and gives a specific refusal (`--close`) | C-14 | AC-107..110; M80–M88 caught; CP1/CP2 bypass closed (one `presentationFor`) | Human approval of agent-written text | Not injective: a typed banner plus escapes presents the same text (MINOR-7). The approval binds the display, not the bytes |
| C-29 | **Bounded streaming process output.** Keep a head and a tail with a marker; a line scanner carries partial lines across chunks; summaries are chosen per stream by runner marker; disagreement fails closed ("ambiguous test summary"); the group is killed on settle with a fixed exit grace | C-7, C-8 | AC-92..96; M104 (unbounded tail) survived until a test went past the runtime's maximum string length | Any child process whose output you parse | Output after the grace is lost (documented, I-8) |
| C-30 | **Refuse a case variant of a reserved directory before any read or write**, when a live probe shows the exclusion is case-sensitive | C-16, C-17 | AC-98 probe: `core.ignorecase` doesn't help; `FACTORY_DIR_CASE_CONFLICT`, first in pre-flight and first on CLI `--resume` (D-B1-2) | Any pathspec or ignore rule on a case-insensitive filesystem | Skip it only if a probe proves the exclusion is case-insensitive |
| C-31 | **Read back what the harness wrote and check it**, failing closed on a missing or non-regular file. Findings are deduplicated by source through one shared helper (`addImportantFindingsOnce`) | C-3, C-18 | AC-107 hooks in `persist`, `writeDocument`, pre-supplied spec, consolidate; MINOR-3 removed the duplicate | Checks over persisted artifacts | — |
| C-32 | **Statically pin defences a live test can't see**, with a source scan that strips comments (shared `code()` fixture) and anchors the match | C-10 | M03/M04 (two no-signing defences) survived; gap test + FOLLOWUP-MINOR-2 (raw scan let a commented-out line pass) | Belt-and-braces settings the runtime ignores | Prefer a behavioural test when one exists |
| C-33 | **Load-robust tests with premises derived at runtime.** Timing windows are sized for process startup under load (5 s stay-up, 30 s exit), never tighter than the code's own timeouts. Limits come from runtime constants (`buffer.constants.MAX_STRING_LENGTH`), with the premise asserted | — (new) | EG flake at step 3 (1.5 s window; npm needs seconds under load); FOLLOWUP-MINOR-3 (`pushes = 600` hard-coded) | Tests with real processes or memory limits | Every widened window costs suite time (+17 s here) |

## New anti-patterns

1. **Re-running a gate on resume after later steps changed its input** (the rework snapshot re-taken with the TV's files, IMPORTANT-1). → C-25
2. **Recording an invocation only when it returns**: a crash leaves no trace, and the resume logic misreads the state. → B-2 entry condition, P-25
3. **Typing invisible-character escapes into tool parameters, docs or shell one-liners**: they become the real characters. → P-23, C-27
4. **Git outside the session's approved commands**, read-only included: a builder's `for-each-ref`; the session's `add -N` / `reset` unstaged renames. → P-27
5. **AI attribution in commits or PRs** (a co-author trailer). → P-27
6. **Treating an operator "yes" as approval of an adjacent proposal.** → P-26
7. **Test timing windows narrower than real startup under load, or premises hard-coded from one runtime's limits.** → C-33
8. **A CP2 answer not carried into the brief's design and file list** (I-17 vs D-16 → MINOR-1). Every accepted I-n must map to a D-n and a step.
9. **A measurement AC checked off with only the "before" figure** (AC-103). Record both figures. → P-28
10. **Duplicate logic introduced across two callers in one PR** (MINOR-3 dedup-and-log, MINOR-4 `OBJECT_ID`). The builder should grep for an existing helper before writing one.

## Time estimate for the next similar run

Based on B-1: by hand, Backend Builder only, Researcher and Story Writer run once for all of Phase B. B-2 reuses the CP1 story; its Spec Writer must add the binding entry-condition AC.

| Part | B-1 measured | Estimate rule |
|---|---|---|
| Researcher + Story (if not reused) | 9.3 + 8.8 min (1 revision) | ~20 min; add one revision per mid-run scope addition |
| Spec Writer | 23.9 min (24 issues) | ~25 min |
| S-0 probes/measurements | 7.5 min | ~10 min |
| Builders | 123.5 min / 11 steps (mean 11.2, range 3.1–25); brief estimated 260 | ~10 min per ordinary step; ~20–25 for an orchestrator-core or EG-core step. Halve the A-2 rule while the suite stays under ~80 s |
| Session checks | 20 min / 11 (mean 1.8) | ~2 min per step at a suite of ~80 s |
| Verification (TV ∥ Validator + follow-up) | 55 + 2.8 min elapsed; ~38 min on mutations (103) | ~60 min; it scales with mutant count (~0.4 min each) |
| Fix round + re-check + final fix | 13.8 + 3.9 + 6.4 min | ~25 min |
| Operator waiting | not timed | unknown. **Time it next run** |
| Untimed between-step time | ~105 min in the build window (~9.5 min/step) | ~10 min per step until it is timed |

**Plan ~4.5 h active plus ~2 h untimed or waiting (~6.5 h wall clock) for an 11-step PR of similar scope, if the story is reused** (B-1: ~4 h 38 m active including Research/Story; 473-min window).

For B-2 specifically, add risk:
- the ~23 agent-order test updates (D-5; list them per P-20);
- the entry-condition AC;
- a first live use of the snapshot ref as the Validator's copy: add a live smoke per P-16, ~5 min.

**Confidence: Medium.**
- Two measured runs, one builder type.
- B-1's builder speed may partly reflect its many small, well-specified steps.
- Waiting and between-step time are still unmeasured.
