# B1_VALIDATION_FOLLOWUP.md: scoped review of the Test Verifier's added tests (PR B-1)

> Agent 07 (Validator), run by hand, read-only, 2026-10-05. Saved by the orchestrating session from the hand-back; the findings are verbatim.
> - Skill loaded by Read (the first Read worked): `code-review-excellence.md`.
> - Scope: only `factory/test/harness/b1-acceptance-gaps.test.ts`. It has 6 tests: AC-80 ×2, the AC-86 it.each ×2, AC-83 ×1 and AC-94 ×1.

**Checks across the whole file: all clean.**
- **Shared fixtures only.** No setup is duplicated.
- **No hidden characters:** no `agent: '0N-'` literal, and no byte above 0x7F.
- **No real git when the code is correct:** the AC-80 guard throws before `spawnSync`; AC-86 uses a fake tracker; AC-83 only reads a file; AC-94 is pure in-memory work.
- **Mutated code stays away from this repository:** under M07 or M07b, git would run with cwd set to the `mkdtemp` project, which is not a repo.
- **Temp directories:** the project is removed in `afterEach`, and the symlink and its target in a `finally`.
- **No wall-clock timing.**

## Per test

| # | Test (file:line) | Mutation | Verdict | Reason |
|---|---|---|---|---|
| 1 | AC-80, lookalike directory not directly under tmpdir (:60-70) | M07 | SOUND | Only the `dirname(dir) !== resolve(tmpdir())` check can refuse the lookalike, so the test isolates the mechanism its title names. Under M07, `git()` returns `{ok:false}` instead of throwing, so the test fails for the right reason. |
| 2 | AC-80, symlink named like the snapshot directory (:72-84) | M07b | SOUND (minor) | Only `lstatSync(dir).isDirectory()` refuses it. There is one small leak path (MINOR-1). |
| 3 | AC-86 HEAD_MOVED, branch at a new commit (:91-96, :100-122) | M34b | SOUND | The whole message is checked with `toBe`, along with the stage, agent, severity and `context.head`, that no snapshot was recorded, and the snapshot calls. |
| 4 | AC-86 HEAD_MOVED, unborn then detached (:97) | M34b, M34c | SOUND | It covers the `unborn`, `no commit` and `detached` wordings of `describeHead`. |
| 5 | AC-83 D-1 static (:128-141) | M03, M04 | SOUND (minor weakness) | `--no-gpg-sign` is anchored as the first element of the `commit-tree` call. The `SAFE_GIT_CONFIG` check is a plain substring match with no comment stripping (MINOR-2). |
| 6 | AC-94, beyond the maximum string length (:145-165) | M104 | SOUND (minor weakness) | Deterministic and cheap. It throws at a fixed push on Node 14–24 (64-bit). Its premise, the maximum length, is hard-coded rather than asserted (MINOR-3). |

## Findings (no CRITICAL or IMPORTANT)

- **FOLLOWUP-MINOR-1** (:74-76): `mkdtempSync(target)` and `symlinkSync(target, link)` run before the `try`.
  - **Gap:** if `symlinkSync` throws, the target directory leaks.
  - **Fix:** move `symlinkSync` inside the `try`.
- **FOLLOWUP-MINOR-2** (:131-133): the source is read raw, without the comment stripping that the AC-80 guard applies with `code()` (repo-hygiene.test.ts:27).
  - **Gap:** a commented-out `'-c', 'commit.gpgSign=false',` entry would let M04 survive.
  - **Fix:** share `code()` as a test fixture and use it here, or anchor the match to one line: `/^\s*'-c', 'commit\.gpgSign=false',?\s*$/m`.
  - **Optional:** assert `spawnSync(` occurs exactly once here too, or mock `child_process` and assert the argv.
- **FOLLOWUP-MINOR-3** (:146-149): the test hard-codes `pushes = 600` and "2^29 - 24".
  - **Gap:** on a runtime with a larger maximum string length, the test would silently stop killing M104.
  - **Fix:**
    - set `pushes = Math.ceil(buffer.constants.MAX_STRING_LENGTH / chunk.length) + 1`;
    - assert the premise: `expect(pushes * chunk.length).toBeGreaterThan(buffer.constants.MAX_STRING_LENGTH)`.
- **FOLLOWUP-MINOR-4** (:93, :95): a ternary that exists only for the type checker ties the expected string to `FAKE_BASE`.
  - **Fix:** use a local literal, for example `const RECORDED = 'a'.repeat(40)`.
- **FOLLOWUP-MINOR-5** (feature-factory-orchestrator.ts:2347): `describeHead`'s "a branch not recorded" wording is not exercised by any test.
  - **Fix:** add a third `it.each` row: recorded `{ commit: X }`, current `{ commit: Y, branch: 'refs/heads/main' }`.

## Verdict

All 6 tests are sound, and each kills the mutation it was written for. The 5 MINOR findings are hardening only.

**Status: PASS**
