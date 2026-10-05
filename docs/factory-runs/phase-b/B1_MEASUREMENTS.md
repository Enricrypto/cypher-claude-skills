# B1_MEASUREMENTS.md: PR B-1 live probe and measurements

> Run by the orchestrating session (S-0), operator-approved, 2026-10-05.

## AC-98: does `:(exclude).factory` exclude `.Factory/`? (live probe)

**Environment:** git 2.39.5 (Apple Git-154), macOS 15.7.9, APFS. The scratch repo was in the session scratchpad (never the project), and was deleted afterwards. `core.ignorecase=true` was set by `git init`.

**Setup:** `.Factory/state.json` and `a.txt`, both untracked.

| Command (pathspec `-- . ':(exclude).factory'`) | `.Factory/state.json` listed? |
|---|---|
| `git ls-files --others --exclude-standard` (default, ignorecase=true) | **yes** |
| `git -c core.ignorecase=true ls-files --others …` | **yes** |
| `git -c core.ignorecase=false ls-files --others …` | **yes** |
| `GIT_INDEX_FILE=<tmp> git add -A …` then `ls-files --cached` | **yes** (it was added) |

**Result:** `core.ignorecase` does **not** make the exclude pathspec case-insensitive. With a `.Factory/` directory, harness state would enter both the CHECKPOINT 3 change and a B3 snapshot. AC-97's pre-flight refusal (`FACTORY_DIR_CASE_CONFLICT`) is therefore required, not just defensive. The exact pathspec stays.

## AC-103: suite time and the durable-write share (measurement)

**Branch:** `feat/phase-b1-commit`, no code changes yet (same code as `main` 0b3ce27). 35 suites, 1076 tests; every run passed.

**Method:** `npm test` was timed from the repo root. The fsync-off runs used `NODE_OPTIONS="--require <scratchpad>/fsync-noop.js"`, a preload that turns `fs.fsyncSync` and `fs.fsync` into counted no-ops. The script is outside the repo. The count proves the patch reached the Jest workers.

| Run | Wall clock (s) | Jest "Time" (s) | fsync calls skipped |
|---|---|---|---|
| durable 1 | 188 | 186.7 | — |
| durable 2 | 194 | 193.1 | — |
| fsync off 1 | 26 | 25.1 | 8,672 |
| fsync off 2 | 24 | 23.4 | 8,672 |

- Mean durable: 191 s. Mean fsync off: 25 s.
- **Durable-write share = (191 − 25) / 191 ≈ 87%.**
- This is far above the I-20 threshold of 20%, so **AC-104 is adopted: build step 10 runs.** It adds the test-only non-durable `stateWriter` seam and the guard that production never passes it.

**Expected after step 10:** tests that go through `runToEnd` stop paying for fsync. Direct `runFeatureFactory` callers stay durable by design, so the suite will not reach 25 s. The re-measure happens after step 10 and again at S-2.

| Re-measure | Wall clock (s) | Tests | Notes |
|---|---|---|---|
| after step 10 | 53 (session); builder run 57.6 | 1079 | from 191 s: about 72% less. Tests that call runFeatureFactory directly stay durable by design |
| S-2 (final) | 78 | 1271 | after all 11 steps; from 191 s (about 59% less). The +195 tests include real-git and process tests |
| after the CP3 fix round: durable | 82 | 1291 | fsync calls still made: 2,388 (was 8,672 at baseline) |
| after the CP3 fix round: fsync off (×2) | 44, 43 | 1291 | durable-write share now (82 − 43.5) / 82 ≈ 47% (was 87%). What remains is mostly direct runFeatureFactory callers (durable by design) plus real-git and process tests. AC-103 now has both figures re-measured. |
