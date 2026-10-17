# Phase R — measurements

> Baseline taken **before R9 and the Ponytail rules** (2026-10-16/17), from the run records
> (`state.json`) and logs of the factory runs on `cypher-agents` and of PR R-1 on this repository.
> Each later run adds a row, so the effect of R-9 (and then R-2 and R-3) can be read off this table.

## How to read it

- **Early stops**: the run stopped before a checkpoint for a reason other than an operator decision.
- **Priced usage**: the sum of the per-agent estimates the CLI prints. An invocation that crashed or
  ran out of turns prints no estimate, so real usage was higher, most of all where the stops were.
- **Test lines per code line**: lines added or removed under `test/`, divided by the same for source,
  from the run's commit. For a new build ~1.5 is reasonable; for small edits it should be low.
- The runs are different tasks, so this is a rough comparison, not a controlled experiment.
  Comparing per changed file, and tidy-ups with tidy-ups, makes it fairer.

## Baseline (before R9)

| Run | What | Early stops | Checkpoint rejections | Crashed / out-of-turns calls | Builder out of turns | Agent minutes | Priced usage | Source lines | Test lines | Test per code line |
|---|---|---|---|---|---|---|---|---|---|---|
| cypher-agents 0a `0fb17feb` (closed) | First try, story only | 4 | 1 | 3 of 7 | — | 179 | ≈ $48 | — | — | — |
| cypher-agents 0a-1 `dd9a5d9d` | 43 new files | 4 | 1 | 3 of 11 | 2 | 149 | ≈ $37 | 2,639 | 4,244 | 1.6 |
| cypher-agents cleanup `284f06fa` | Small fixes, 15 files | 4 | 1 | 4 of 12 | 2 | 87 | ≈ $25 | 235 | 1,321 | **5.6** |
| factory R-1 `94eaf6b1` | R1, R2, R3, R8; 33 files | 6 | 1 | 2 of 16 | 2 | 217 | ≈ $73 | 723 | 3,531 | **4.9** |

Causes of the early stops, before R-1 shipped: Mac idle sleep and dropped connections (3), replies
over 32,000 tokens (2), `maxTurns` exhausted (builder in all three building runs; Test Verifier and
Validator once), the story gate counting 1 AC (1), `.factory` ignored breaking the snapshot (1), an
unexplained "exit code 1" (1). In R-1 itself: builder out of turns (2), the Frontend Builder run on
a UI-less brief (1), Gate 2 failing on two hygiene rules in the Test Verifier's file and on
`execution-gates` timing under load (2), and a `git pull` by another session moving HEAD (1).

**What R9 should move:** test lines per code line, above all on small changes (5.6 and 4.9 today);
how often an agent runs out of turns; usage per changed file.

## After R9

| Run | What | Early stops | Checkpoint rejections | Crashed / out-of-turns calls | Builder out of turns | Agent minutes | Priced usage | Source lines | Test lines | Test per code line |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
