# B1_VALIDATION_REPORT.md: Phase B, PR B-1 (Agent 07, Validator, by hand)

> Saved verbatim by the orchestrating session from the Validator's hand-back, 2026-10-05. It ran in parallel with the Test Verifier, from 15:13, on a read-only copy of the working tree.

**Reviewed:** the read-only copy at `/private/tmp/claude-501/-Users-enriqueibarra-cypher-claude-skills/f0e6a0bc-5bee-4912-bf80-b4c782281694/scratchpad/b1-review-copy/`. All paths below are relative to that root and match the repo's paths.

**Read first:** USER_STORY.md (CP1), B1_TECHNICAL_BRIEF.md and B1_FILE_LIST.md (CP2), B_DECISIONS.md, B1_BUILD_NOTES.md and B1_MEASUREMENTS.md.

**Skills:** both loaded with Read on their first path.
- `~/.claude/skills/software/code-review-excellence.md` loaded.
- `~/.claude/skills/software/security-audit.md` loaded.

I ran no tests and no git. This is a static review of code, tests and docs only.

## Summary verdict

**PASS. 0 critical, 1 important, 7 minor.**

B-1 does what the approved story and brief say:
- **ACs:** every AC in scope (AC-45 revised, AC-80 to AC-115) has code. Each one has a test or record whose title names it, except the [L] and [M] items, which are recorded in B1_MEASUREMENTS.md.
- **Snapshot primitive:** it is sound.
  - The index guard is enforced at runtime inside `git()`.
  - The temporary index lives in its own mkdtemp directory, outside the repo.
  - The env is stripped and the harness identity is applied last.
  - The ref update is a compare-and-swap.
  - The HEAD check runs before any object is written.
  - Hooks, signing, reflog, split index and auto-gc are all off.
- **Gate 2, pre-flight order, shared character set, presentation and hashing:** all match the brief.

The one IMPORTANT finding is a design gap in how the CHECKPOINT 3 rework re-evaluates its Stage 3 gate on resume. It does not break any B-1 AC, but it weakens the seam B-2 depends on.

## Critical

None.

## Important

**IMPORTANT-1: the rework snapshot is re-taken and its ref replaced on every Stage 4 resume while a CHECKPOINT 3 rework is active, including after the Test Verifier and validator rounds have run.**

- **Where:**
  - `factory/feature/workflows/feature-factory-orchestrator.ts:1686` (`stage4` calls `changeRework()` on every entry);
  - `:2142-2175` (`changeRework` skips the builders that already passed, then always runs `stage3Gate(4, {phase:'rework', round: cycle})`);
  - `:1167-1193` (`takeSnapshot` reuses the phase's `n`);
  - `factory/harness/state-tracker.ts:1076-1091` (upsert by phase key).
- **What happens:**
  1. A run is in rework cycle r. Its Stage 3 gate passed and `stage3-<k>` was written.
  2. Later it escalates in Stage 4, for example a Gate 2 failure, a Test Verifier failure, a validator MAX_LOOPS, or a later HEAD_MOVED.
  3. A plain `--resume` re-enters `changeRework`, runs the Stage 3 gate again and calls `snapshot()` with the same `n = k`.
  4. The working tree now holds the Test Verifier's test files, and any validator-round fixes. So the tree differs, a new commit is made, and `stage3-<k>` is CAS-replaced.
  5. The rework's state entry is overwritten with a new `takenAt`, commit and tree.
- **Side effect on ordering:** if a validator round happened in that cycle (`stage3-<k+1>`), the rework entry now holds newer content than a snapshot with a higher `n`, so `latestStage3Snapshot` no longer means "most recent content".
- **Why it matters:**
  - In B-1, `stage3-<k>` silently stops being the tree at the rework's Stage 3 gate pass. AC-85's "a changed tree replaces the ref" was meant for the kill window.
  - Stage 3 and validator rounds do not have this problem: Stage 3 is closed by `advanceToStage(4)`, and a round is re-entered only while it has no Gate 2 record.
  - It is a latent defect for B-2. D-5's premise is "a snapshot taken before verification can't see the Test Verifier's deliberate breakage". AC-123 and AC-125 re-extract the Validator's copy from the recorded rework ref, which would by then contain the Test Verifier's writes.
  - No test covers a resume after the Test Verifier in an active rework.
- **Fix:** do not re-run the rework's Stage 3 gate and snapshot once the run has moved past it in that cycle. Either:
  - skip `stage3Gate` in `changeRework` when a `written` snapshot for `{rework, cycle}` exists and any later step of the cycle is recorded (a Test Verifier invocation or a Gate 2 record after it); or
  - record a "rework Stage 3 gate passed" marker and check it.

  Add a [O] test: a rework, then the Test Verifier writes a test file, then Gate 2 escalates, then a resume. Assert that `stage3-<k>`'s commit and tree are unchanged.

## Minor

**MINOR-1: the CP2 answer to I-17 is not fully applied.**
- **Where:** `docs/HARNESS_GAP_ANALYSIS.md:1`.
- **What:** I-17 (accepted at CP2) said "`REFACTOR_PLAN.md` and `HARNESS_GAP_ANALYSIS.md` get only the 'superseded' line". REFACTOR_PLAN.md:1 has it; HARNESS_GAP_ANALYSIS.md does not. The build notes list this as OPEN for CP3.
- **Fix:** add the one-line "superseded / see ROADMAP.md" header, or record the operator's decision to drop it.

**MINOR-2: SKILL.md says a failed document read-back makes "the run escalate", which is not true for `--consolidate`.**
- **Where:** `factory/feature/SKILL.md:655-656`.
- **What:** in `consolidate-run.ts:166-171`, a `documentFindings` throw propagates out of `consolidateRun`. The CLI exits 1, and the SUCCESS run is neither escalated nor changed.
- **Fix:** say "the run escalates (in a run) or `--consolidate` fails with exit 1".

**MINOR-3: the dedup-and-log logic exists twice.**
- **Where:** `factory/feature/workflows/consolidate-run.ts:165-176` and orchestrator `recordFindingsOnce` (`feature-factory-orchestrator.ts:668-675`).
- **What:** both do before-length, `recordImportantFindingsOnce`, slice, log, then save.
- **Why it matters:** the rule "no duplicate logic" (CLAUDE.md).
- **Fix:** add a small shared helper in state-tracker or harness that returns `{ next, added }`. Both callers then only log and save.

**MINOR-4: the object-id rule is spelled twice.**
- **Where:** `factory/harness/change-diff.ts:147` and `factory/harness/state-tracker.ts:1029`.
- **What:** the same `OBJECT_ID` regex in two files.
- **Fix:** export it from one module and import it in the other. Note that run-lifecycle already imports state-tracker types only, so mind import direction to avoid a cycle.

**MINOR-5: env variables that change pathspec or ref behaviour are not stripped from git's environment.**
- **Where:** `factory/harness/change-diff.ts:187-193`.
- **What:**
  - `GIT_LITERAL_PATHSPECS`, `GIT_GLOB_PATHSPECS` and `GIT_NOGLOB_PATHSPECS` reach git, and so does `GIT_NAMESPACE`, which the build notes already list as unassigned.
  - With `GIT_LITERAL_PATHSPECS=1` in the operator's env, `:(exclude).factory` becomes a literal path:
    - the snapshot's `add -A` fails closed (SNAPSHOT_FAILED: pathspec did not match);
    - the CHECKPOINT 3 `ls-files --others` would list `.factory/` contents. This CP3 part is pre-existing from A-2.
- **Fix:** add these names to the deletion list. The force-add sets `GIT_LITERAL_PATHSPECS` explicitly through `extraEnv`, so that call is unaffected.

**MINOR-6: a run paused at CHECKPOINT 3 before B-1 can gain a document-check finding after its approval.**
- **Where:** `feature-factory-orchestrator.ts:2039-2046` then `:2092-2098`.
- **What:** `--approve 3` records and commits the approval first. Then it re-renders the harness documents, which now runs the document check.
- **Why it matters:** if BACKEND_SUMMARY or TEST_REPORT holds a set character, an IMPORTANT finding is recorded after CHECKPOINT 3 was approved, and no approver saw it. Only pre-B-1 runs are affected: for post-B-1 runs the finding already exists and is deduplicated.
- **Fix:** accept and document it, or re-render before recording the approval. Note that the latter changes no hash, because CP3 does not include the harness documents.

**MINOR-7: two documentation statements need correcting or qualifying.**
- **The 500 failing-test-name limit** (`factory/feature/SKILL.md:466`):
  - **What:** SKILL.md says "the first 500 failing test names". The cap is per stream (`execution-gates.ts:424`, `FAILED_NAMES_KEPT`), so up to 1000 are kept after merging (`:714`).
  - **Fix:** say "per stream".
- **The SKILL.md "always changes the hash" claim** (`factory/feature/SKILL.md:170-171`; code `factory/harness/checkpoint-presentation.ts:280-290`):
  - **What:** the claim is true for a pure swap of one character. But the presentation is not injective. A raw document that contains a typed copy of a banner followed by typed escapes presents the same text, with the same hash, as a document holding the real character.
  - **Why it matters:** an approval therefore binds what was shown, not the stored bytes. This is consistent with D-13, but "always" over-claims.
  - **Fix:** say "swapping one for the other alone always changes the text and the hash".

## AC traceability

Test-file abbreviations: SN = `test/harness/snapshot.test.ts`; CDT = `change-diff.test.ts`; EGT = `execution-gates.test.ts`; RDT = `run-directory.test.ts`; RST = `resume.test.ts`; RLT = `run-lifecycle.test.ts`; CLI = `test/runner/cli.test.ts`; DCT = `direction-characters.test.ts`; DDOC = `direction-documents.test.ts`; CPT = `checkpoint-presentation.test.ts`; APT = `agent-prompts.test.ts`; SPT = `state-persistence.test.ts`; RH = `contracts/repo-hygiene.test.ts`; DD = `contracts/doc-drift.test.ts`. Numbers are the lines of the test titles.

| AC | Code (file:line) | Test | Verdict |
|---|---|---|---|
| AC-45 | `harness/change-diff.ts:176-209` (git choke point), `:442-538` (snapshot) | SN:244; CDT:631; RH:325 | PASS |
| AC-80 | `change-diff.ts:105-111`, `:180-185` (index guard), `:223-231` (factoryRef) | RH:325; CDT:351, 363, 369 | PASS |
| AC-81 | `orch:1167-1193`, `:1225-1227` (call sites `:1669`, `:1824`, `:2175`); `state-tracker.ts:1050-1092` | SN:191, 278; CPT:285 | PASS (see IMPORTANT-1) |
| AC-82 | `change-diff.ts:466-498`, `:510-521` | SN:425; CDT:464, 488, 505, 526 | PASS |
| AC-83 | `change-diff.ts:122-141`, `:510-521` | CDT:686 | PASS |
| AC-84 | `change-diff.ts:324-347`; `checkpoint-presentation.ts:202-215` | SN:485; CDT:406, 427 | PASS |
| AC-85 | `change-diff.ts:500-524`; `state-tracker.ts:1076-1091` | SN:544, 555, 572; CDT:539, 554, 571 | PASS |
| AC-86 | `change-diff.ts:455-464`; `orch:1195-1207` | SN:659; CDT:592, 607, 622, 436 | PASS |
| AC-87 | `orch:1168-1174`; `CPR:228-233` | SN:682, 700, 215; CPT:307 | PASS |
| AC-88 | `orch:1209-1217`; `change-diff.ts:525-527` | SN:715; CDT:676 | PASS |
| AC-89 | `CPR:140-150`; `orch:2334-2338` | SN:749, 782 | PASS |
| AC-90 | `agents/04-backend-builder.md:41`; `05-frontend-builder.md:43`; `agent-prompts.ts:345` | RH:300; APT:121 | PASS |
| AC-91 | `04:69`; `05:73`; `agent-prompts.ts:344`; `SKILL.md:133-134` | RH:310; APT:121; DD:401 | PASS |
| AC-92 | `execution-gates.ts:780-788` | EGT:640, 668 | PASS |
| AC-93 | `execution-gates.ts:299-342`; `SKILL.md:460` | EGT:707; DD:410 | PASS |
| AC-94 | `execution-gates.ts:359-392` | EGT:726 | PASS |
| AC-95 | `execution-gates.ts:410-461`, `:711-714`, `:770` | EGT:827, 835, 851 | PASS |
| AC-96 | `execution-gates.ts:599-613`, `:713`, `:843-845` | EGT:899, 931, 938 | PASS |
| AC-97 | `run-directory.ts:92-117`; `orch:459`; `cli.ts:458` | RDT:567-621; CLI:741, 768; RH:479 | PASS |
| AC-98 | [L] `B1_MEASUREMENTS.md:5-18` | live probe recorded | PASS |
| AC-99 | `run-lifecycle.ts:256-266`; `orch:467-471`, `:493-496` | RST:923, 934; RLT:528-559; CLI:792 | PASS |
| AC-100 | `cli.ts:461-476` | RH:460 | PASS |
| AC-101 | `run-lifecycle.ts:125-153` | RLT:234; RST:961; CLI:829 | PASS |
| AC-102 | `cli.ts:112-137` | CLI:378, 404; DCT:129, 141 | PASS |
| AC-103 | [M] `B1_MEASUREMENTS.md:20-43` | measured 191 s, then 53 s and 78 s | PASS |
| AC-104 | `orch:423`, `:444`; `test/fixtures/state-writer.ts` | SPT:296, 352; RH:432 | PASS (adopted, 87%) |
| AC-105 | `direction-characters.ts:14-20` | DCT:45, 69; RH:498 | PASS |
| AC-106 | `direction-characters.ts:42-44` | DCT:82, 90, 96 | PASS |
| AC-107 | `document-check.ts:32-46`; `orch:595-602`, `:683-685`, `:739-743`, `:1410-1420`; `consolidate-run.ts:163-176`; `state-tracker.ts:560-569` | DDOC:229 (all 11 documents), 254, 265, 290, 309; RH:636 | PASS |
| AC-108 | `CPR:280-290` | CPT:367, 406, 422; DDOC:383, 407 | PASS (MINOR-7) |
| AC-109 | `orch:2309-2338`, `:484-490`, `:2358-2368` | DDOC:426; CLI:563; RH:587 | PASS |
| AC-110 | `orch:2376-2387`, `:2404-2406`, `:2439-2441` | DDOC:506, 519; CPT:395; CLI:574 | PASS |
| AC-111 | `docs/ROADMAP.md` | DD:417 | PASS |
| AC-112 | 8 pointers in `factory/feature/{docs,reference}/`; `docs/archive/feature-{docs,reference}/` | DD:446 | PASS |
| AC-113 | `doc-drift` KEPT_DOCS | DD:274, 463 | PASS |
| AC-114 | `README.md:5`, `:91-109` | DD:474 | PASS |
| AC-115 | `factory/feature/SKILL.md` | DD:488 | PASS |

## Brief decisions, CP2 answers and accepted deviations

**Decisions D-1 to D-17:** all honoured.
- D-3 step 6 forces tracked-but-ignored files back in, in chunks of 500, with `GIT_LITERAL_PATHSPECS`.
- D-8 wording is checked, and no message literal contains a forbidden git subcommand.
- D-9 constants are 64 Ki head, 192 Ki tail, a 16 Ki partial line, 64 summary lines, 500 failed-test names and a 2 s exit grace.
- D-13: CP1 and CP2 now go through `presentCheckpoint`, which closes the bypass.

**Issue answers I-1 to I-24:** all honoured, except I-17's HARNESS_GAP_ANALYSIS line (MINOR-1).

**Accepted deviations:** each one is sound.
- **Stricter repo-hygiene guards:** AC-104 limits the orchestrator to exactly two mentions of `stateWriter`; AC-80 also scans `contracts`; AC-109 bans `sha256Hex`.
- **Shared code:** `samePhase` is exported and reused; `recordStage3Snapshot` validates its input.
- **Ordering:** the document read-back runs before the log line.
- **Small additions:** a one-line pre-supplied filter; the empty-tree case; three fixtures (`real-git.ts`, `factory-case-variant.ts`, `state-writer.ts`).
- **Operator decisions:** D-B1-1 (step 10 first) and D-B1-2 (the CLI guard before `findRun`, in `cli.ts:458`).

**Build-note observation (pre-A-1 records, 3+n attempts):** outside AC-101's wording and correctly left open.

## Correctness and safety checks

**Snapshot.** Each property holds:
- `git()` refuses `add` and `write-tree` unless `GIT_INDEX_FILE` is `<tmpdir>/factory-snapshot-*/index` in a real directory. The user's `.git/index` can never satisfy this.
- `GIT_INDEX_FILE`, `GIT_DIR` and the related variables are stripped, then `extraEnv` is applied last.
- `update-ref` is given the old value, or `''` when the ref must not exist.
- An unchanged tree with the same parent is reused.
- The HEAD check reads the commit, and the branch only when a commit exists (I-6).
- The temporary directory is removed in `finally`.
- stdin is ignored and `GIT_TERMINAL_PROMPT=0` is set.
- Hooks are off through `core.hooksPath=/dev/null`, which a command-line `-c` makes override a repo's own setting.
- Signing is off twice: `--no-gpg-sign` plus `commit.gpgSign=false`.
- The harness identity is set only on `commit-tree`.

**Kill window.** On resume, the phase-keyed `n` is reused whether the kill came before or after the ref write. The tests cover reuse and replacement.

**Gate 2.**
- **Group kill:** the process group is SIGKILLed unconditionally on settle. `exit` starts the 2 s grace, and the timeout is ignored once the shell has exited.
- **Bounded output:** each stream keeps a head and a tail plus a marker.
- **Streaming scanner:** a partial line is carried across chunk boundaries, and the last line is flushed on end.
- **Counts:** summary lines are chosen per stream and by runner marker. Disagreeing counts give "ambiguous test summary", which `validateExecutionGate` surfaces.
- **Built-ins only:** `execution-gates.ts` still imports only node built-ins.

**Pre-flight order.** The order is:
1. TypeError check
2. `assertNoFactoryCaseVariant`
3. `checkResumeRequest`
4. `checkResumeDescription`
5. PAUSED no-op
6. `--approve` hash check
7. I-7 re-check
8. fresh start: DESCRIPTION_REQUIRED, then `prepareNewRunDirectory`

Every refusal is thrown before any write (`orch:452-500`).

**Direction set and escaping.**
- One source: `direction-characters.ts`. RH:498 forbids any other spelling of the set and requires the consumers to import it.
- Terminal escaping (`cli.ts`) and checkpoint escaping use the same `escapeCodePoint`.
- The hash is taken over the escaped presented text.
- `--approve` and I-7 both use `presentCheckpoint` → `presentationFor`.

## SKILL.md, README, ROADMAP and pointer claims checked

26 claims checked: 24 true, 2 imprecise (MINOR-2, and the "500 failing names" part of MINOR-7).

The true ones:
- **Version line:** names "Phase B, PR B-1".
- **AC-45 sentence:** verbatim at SKILL.md:128.
- **Git subcommand list:** :208-210.
- **Snapshot section, :214-261:** what the tree holds, the plumbing, the identity, recorded-before-next-agent, idempotency, local refs and `.env`, HEAD_MOVED, SNAPSHOT_FAILED, the not-git skip and the CP3 section.
- **`.Factory` refusal and its order:** :273-280.
- **DESCRIPTION_REQUIRED and DESCRIPTION_MISMATCH wording:** :282-284 and :362-370.
- **MINOR-8 inference:** :347-351.
- **Gate 2:** the group kill and `setsid()` (:456-460), the bound and its marker (:461-468), per-stream parsing (:469-476), and the dev-exit-0 SKIPPED rule (:485-488).
- **Banner, escaping and hash:** :159-174.
- **Pre-B-1 refusal:** :176-181.
- **Terminal escape format and hash before terminal escaping:** :80-86.
- **Documents stored exactly as written:** the finding text and the 20-occurrence cap (:647-653).
- **The AC-60 line is kept:** :537.
- **README:** :5 and :91-109 (no "five stages", no PR-review-outside line).
- **ROADMAP:** phases, the mapping table, the accepted risk with its git ≥ 2.42 trigger, and the backlog.
- **Pointers and archive README:** the 8 pointers resolve, and `docs/archive/README.md` is accurate.

## Security surface (brief §11: userInput PRESENT, secrets PRESENT, others ABSENT)

**Run ids into refs and paths.**
- `isSafeRunId` (`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, no `..`), plus `factoryRef` refusing `.lock` and a trailing `.`, plus the `stage3-[1-9]\d*` name rule.
- No ref injection is possible. CDT:351 tests `@{`, `/`, `..`, space and over-length ids.

**Paths from git.** Everything uses `-z`. The force-add uses `GIT_LITERAL_PATHSPECS`, and all argv goes through `spawnSync` with no shell.

**Terminal and bidi spoofing.**
- C0, C1, DEL and the whole set are escaped on every CLI print (`runCli` Printer, `terminalApprover`).
- Checkpoints carry a banner and escaping, and the hash is over the escaped text.
- Documents are stored exactly as written, with an IMPORTANT finding.

**Test and dev output.** It is bounded, and lines longer than 16 Ki are cut for the scan.

**Secrets.**
- No credential is read or stored.
- The harness identity is not a secret.
- A stray non-ignored `.env` ends up in local snapshot objects. This is documented at SKILL.md:238-241 and in the ROADMAP backlog (cleanup of `refs/factory/*`), and the refs are not pushed by default.

**Minor hardening:** MINOR-5 (env variables not stripped).

No security issue blocks.

## Repo hygiene and leftovers

**Repo hygiene.**
- One `spawnSync` for git, in `change-diff.ts`.
- No forbidden subcommand literal (RH:325).
- No new dependency: `package.json` holds only the SDK and the dev tooling.
- No business logic in `cli.ts`: it only calls the library guard, which RH:460 and RH:479 pin.
- Duplicate logic: MINOR-3 and MINOR-4.

**Leftovers.**
- No `.orig`, `.rej` or `.bak` files.
- No TODO, FIXME, `debugger` or `.only` in changed code.
- Files outside the file list: only the three accepted fixtures and the documented comment edits.

## Structured security fields

```json
{
  "authImplemented": "not_applicable",
  "inputValidated": true,
  "noHardcodedSecrets": true,
  "sqlInjectionProtected": "not_applicable",
  "xssProtected": "not_applicable",
  "notApplicableReasons": {
    "authImplemented": "Local CLI and library with no auth boundary, roles or sessions; brief §11 declares auth ABSENT.",
    "sqlInjectionProtected": "No database; state is JSON and Markdown files plus git objects; brief §11 declares sqlDatabase ABSENT.",
    "xssProtected": "Nothing is rendered in a browser; terminal and bidi injection are handled under userInput (printableForTerminal, checkpoint escaping); brief §11 declares htmlRendering ABSENT."
  },
  "issues": []
}
```

- **inputValidated true:** run ids are validated (`isSafeRunId`, `factoryRef`); CLI args, `.factory` case variants and descriptions are refused in the library; documents are checked for direction characters; Gate 2 output is bounded and scanned.
- **noHardcodedSecrets true:** nothing hardcoded; the harness identity is not a secret. Secrets PRESENT means only that snapshots may store a stray `.env`, which is documented.

## Summary

0 critical / 1 important / 7 minor issues found.

**Status: PASS** (no CRITICAL).
