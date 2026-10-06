# B2_TECHNICAL_BRIEF.md: Phase B, PR B-2 "Parallel verification against the snapshot, and the Skeptic step"

> Feature Factory, by-hand mode. Agent 03 (Spec Writer), read-only. 2026-10-05.
> Inputs: `USER_STORY.md` (CHECKPOINT 1, sha256 7a05811e…), `B_DECISIONS.md` (binding: D-4, D-5, D-8 N-3, and "Binding entry condition for PR B-2"), `B1_TECHNICAL_BRIEF.md` / `B1_FILE_LIST.md` (format, §2 D-17 seams), `B1_PATTERNS.md`, `B1_CONSOLIDATION_REPORT.md`, `A2_PATTERNS.md`, `A1_PATTERNS.md`, `factory/feature/SKILL.md` (Phase B, PR B-1) and the merged code on `feat/phase-b2-verification` (main 0e64c6d). Every file:line below was re-read against that code; the Researcher report's §3.12 line numbers predate B-1 and were not reused.
> Skills loaded with Read: `~/.claude/skills/software/architecture-patterns.md` and `~/.claude/skills/software/api-design-principles.md` (both first Reads succeeded).
>
> **Scope:** AC-116 to AC-134 (groups VR, SK), plus **AC-157 (added at B-2 per the binding entry condition; needs operator approval at CHECKPOINT 2, I-1)**. Open-question defaults that apply: Q2, Q5, Q16, N-1, N-3 (decided), N-4 (see I-2), N-5, N-6, N-10, N-16.
> **Out of scope:** B-3 (cost, budget cap, sandboxing, parallel builders); everything in the story's Out of Scope list. Budget interaction is deferred to B-3 (D-19).

Path abbreviations (under `/Users/enriqueibarra/cypher-claude-skills/`): orch = `factory/feature/workflows/feature-factory-orchestrator.ts`; CD = `factory/harness/change-diff.ts`; ST = `factory/harness/state-tracker.ts`; RP = `factory/harness/run-progress.ts`; SC = `factory/harness/stage-context.ts`; SG = `factory/harness/stage-gates.ts`; CPR = `factory/harness/checkpoint-presentation.ts`; AP = `factory/harness/agent-prompts.ts`; UA = `factory/harness/upstream-artifacts.ts`; AR = `factory/runner/agent-registry.ts`; OS = `factory/runner/output-schemas.ts`; AOS = `factory/harness/agent-output-schema.ts`; IA = `factory/runner/invoke-agent.ts`; RH = `factory/test/contracts/repo-hygiene.test.ts`; DD = `factory/test/contracts/doc-drift.test.ts`.

## 0. Prior specification patterns

**Follow:**
- **C-1 / hexagonal seams.** Git stays behind `ChangeTracker` (CD:78-89); it grows two methods. The filesystem review copy gets its own module. Tests keep injecting `fakeChangeTracker()`; only CD tests and `snapshot.test.ts` run real git.
- **C-20 single choke point + source guard.** All git through `git()` (CD:174-220), one `spawnSync`. All agent calls through `timedInvoke` (orch:717-735). Allow-list arrays extended by one array (B-1 D-17).
- **C-24 / C-25.** Snapshot plumbing is reused for the measurement; "passed-by" predicate (ST:1123-1134) extended with a start marker committed before the Test Verifier (anti-pattern 2, P-25).
- **C-13 / C-15.** Records committed before the next invocation; resume by recorded completion, per unit; never overwrite a recorded slot.
- **C-14 / C-28.** `presentationFor` stays the one presentation function; the follow-up document is one more labelled part, so escaping, banner and hash cover it (N-16).
- **C-2 fail closed.** Any copy, measurement or skeptic failure escalates; a missing verdict blocks the Stage 4 gate.
- **C-3 / C-4.** The harness measures the Test Verifier's changes itself (never the agent's word); the skeptic must echo the issue key it was given.
- **C-26.** A test-only option (`reviewRoot`) with an RH guard that production never passes it.
- **C-31.** New documents are persisted through `persist()` (orch:596-603), so the AC-107 read-back covers them with no new write path.
- **C-33.** Parallel-start tests use barriers with generous timeouts, never sleeps.
- **P-12, P-13, P-14, P-20, P-22, P-23, P-26, P-27, P-28** as in B-1. P-16: live smoke of the copy-based Validator after the build (S-1).
- Anti-pattern 8: every I-n below maps to a D-n and a build step (column "→").

**Avoid:** a second git spawner or a second `spawnSync`; `git archive` (attributes change the tree, D-1); a git worktree (D-5, AC-119); logic in the orchestrator that belongs in a service (merge, verdict, test-path rule, path mapping go into `verification.ts`, `test-paths.ts`, `review-copy.ts`); recording an invocation only when it returns (anti-pattern 2); duplicate helpers (anti-pattern 10: reuse `describeIssue`, `criticalIssues`, `routeCriticalIssues`, `addImportantFindingsOnce`, `normalisePath`, the snapshot tree builder).

**Problems the code shows that B-2 must design around:**
1. `timedInvoke` records nothing when the invoker throws (orch:713-719). AC-124 needs both parallel invocations recorded, and the entry condition needs a start marker.
2. `createSdkInvoker` uses one `cwd` for every agent (IA:183); `AgentInvocation` (IA:34-38) has no per-call working directory. The Validator cannot be pointed at a copy today.
3. `git()` decodes stdout as UTF-8 and closes stdin (CD:206-212). Binary blob extraction needs raw bytes and a batch request on stdin.
4. `DIFF_OPTIONS` includes `--relative` (CD:314). Snapshot trees are rooted at the project (B-1 D-3 step 7), so a tree-to-tree diff run from a subdirectory with `--relative` would drop every path. The measurement must not use `--relative`.
5. The Validator's step is recorded at return and `stage4` skips the whole loop on `hasPass('07-validator')` (orch:1705). With a follow-up and skeptics after it, a PASS recorded at return would let a resume skip them.
6. `UPSTREAM_FOR_AGENT['07-validator']` includes `TEST_REPORT.md` (UA:34, :44). It does not exist when the Validator starts in parallel (AC-24, AC-120).
7. `criticalIssuesCount` is computed from the raw issue list (SC:460-461) and read by "Validation Passed" (SG:720-738). AC-131 needs a typed verdict.
8. `stage3SnapshotPassedBy` sees only invocations recorded on return (ST:1112-1134). This is the binding entry condition.
9. Jest matches test files inside dot-directories (its glob matcher uses `dot: true`); this repo's `testMatch` is `**/test/**/*.test.ts` (`jest.config.js:5`) and `.factory/` is not ignored (`.gitignore`). A full source copy under `.factory/<id>/` would be collected by Gate 2, by the Test Verifier's own runs and by the operator's `npm test`, forever (archived runs stay under `.factory/_archive/`). This conflicts with N-4's default location (I-2). S-0 confirms it.
10. `AGENT_STAGE` grows from 8 to 10 agents. DD:206-213 requires the prose "N-agent" count to equal it, but DD:112 retires `\b10-agent\b`. DD:519-521 pins the intro version to "(Phase B, PR B-1)". OS test :47-54 requires every required document to be read by a gate. Each needs an operator-approved assertion change (I-20 to I-22).
11. `checkpoint-lifecycle.test.ts:539-542` and `resume.test.ts:283` pin the fake tracker's `calls` log. New tracker methods must log to a separate list (as B-1 I-1 did for `snapshotCalls`).
12. `passingScript()` (fixtures/harness-run.ts:127-137) has no entry for the new agents: an unscripted agent gets a schema-invalid placeholder and the run escalates. Every test with a CRITICAL Validator issue would break without default entries.
13. `presentChange` reads only `VALIDATION_REPORT.md` (CPR:124-153).
14. `claimsInsideFactoryDir` (SC:131-141) only guards `.factory/`; a copy outside it needs its own Gate 1 guard (AC-117).
15. `persistArtifacts` writes only for `HARNESS_PERSISTED_AGENTS` (SC:159-165), names files from a schema enum (OS:80-87), and refuses reserved names (SC:289-291).
16. `snapshot.test.ts:704-747` asserts that a rework killed at the Test Verifier's first call is re-evaluated. Under AC-157 that kill point is after the start marker, so the assertion inverts (I-23 item 10).

**Frontend Builder: not needed.** No file matches `isFrontendPath`; there is no UI. The Backend Builder does every step.

## 1. Overview

A TypeScript library plus CLI: no HTTP, no database, no UI. "Data model" = `state.json`, git objects and temp directories; "API" = exported TypeScript and agent contracts.

What B-2 makes true:
1. In Stage 4 the Test Verifier (real tree) and the main Validator (a read-only copy of the latest Stage 3 snapshot, outside the project) run at the same time. Gate 2 runs after both have settled.
2. The harness measures what the Test Verifier changed against the reviewed snapshot. Test files only → a scoped follow-up review (`07b-validator-followup`); anything else → escalate.
3. The two reviews' issues are merged. Every CRITICAL is challenged by two blind, read-only skeptic invocations (`07c-validator-skeptic`, instances A and B). Both must disprove it, or it stands. A disproved CRITICAL becomes an IMPORTANT finding.
4. The Stage 4 gate reads a typed verdict. CHECKPOINT 3 presents both review documents.
5. Every step is recorded per evaluation, so a kill resumes only unfinished work and no slot is overwritten. A "verification started" record is committed before the Test Verifier is invoked, which closes the B-1 residual (AC-157).

## 2. Design decisions

### D-1 Extraction: `ls-tree` + `cat-file --batch`, not `git archive` (AC-117, AC-80)

- `git archive` applies the tree's `export-ignore` and `export-subst` attributes, so its output can differ from the tree (AC-117 "equals that tree exactly"). No `-c` setting turns that off before git 2.42 (`--attr-source`, same limit as MINOR-3). It is also a tar stream that would need an in-process parser. Rejected.
- `checkout-index --prefix` runs smudge filters and EOL conversion, and its name trips RH's `git checkout` literal guard. Rejected.
- **Chosen:** `ls-tree -r -z -l --full-tree <tree>` lists `mode type oid size<TAB>path`. Then `cat-file --batch` with the oids on stdin returns the raw blob bytes: no filters, no attributes.
- **New allow-list array (CD):** `export const GIT_EXTRACTION_SUBCOMMANDS = ['ls-tree', 'cat-file'] as const;`. `GitSubcommand` becomes the union of the three arrays. RH AC-80's two regexes and its set check grow by this array (I-3, (c)).
- **`git()` changes (CD:174), still the one `spawnSync`:**
  - It always spawns with `encoding: 'buffer'`. It returns `{ ok: true, stdout: raw.toString('utf8'), raw }`. Text output is byte-for-byte what `encoding: 'utf8'` gave, so AC-89 holds.
  - An optional 5th argument `io?: { input?: string }`. When `input` is given, stdio[0] is `'pipe'` and spawnSync writes the input and closes stdin. Otherwise stdin stays `'ignore'`. Nothing can wait on input either way.
  - Every extraction call is spelled `git(cwd, 'ls-tree', …)` / `git(cwd, 'cat-file', …)`, so RH's "literal subcommand at every call site" scan still sees all subcommands.
- **`extractSnapshot(cwd, snap: {ref, commit, tree}, dest)`** (CD, `ChangeTracker`, never throws). It returns `{kind:'extracted', entries}` or `{kind:'failed', error}`:
  1. Check that `rev-parse --verify --quiet <ref>^{commit}` equals `snap.commit`, and `<commit>^{tree}` equals `snap.tree`. Otherwise `failed` ("the recorded snapshot ref no longer points at the recorded commit").
  2. Run `ls-tree` on `snap.tree` (the recorded tree id, never the ref).
  3. Validate every path. Refuse it if it is empty or absolute, or has a segment `''`, `.` or `..`, or a segment equal to `.git` in any letter case.
  4. Modes: `100644` → file; `100755` → executable file; `120000` → symlink (target = blob bytes); `160000` (gitlink) → empty directory. Anything else → `failed`.
  5. Fetch the blobs in batches of at most 1000 oids and 64 MiB (sizes from `-l`). Parse `<oid> blob <size>\n<bytes>\n`; `<oid> missing` → `failed`. Verify each blob's object hash: `sha1` for a 40-hex oid, `sha256` for a 64-hex one, over `blob <size>\0<bytes>`. A mismatch → `failed`. A single blob above `MAX_GIT_OUTPUT_BYTES` (256 MiB) → `failed`.
  6. Write into `dest`, which must be an existing empty real directory. Directories are made with `mkdirSync(recursive)`. Files are written with flag `wx`, mode 0644 or 0755. **Symlinks are created last**, so no write can pass through a link the extraction made (N-1: links kept as links, never followed).
  7. Seal it (D-3).
- **Tracked-but-ignored files are in the copy,** because they are in the snapshot tree (B-1 I-3). AC-117's "no ignored files" means untracked ignored files, which the snapshot never holds.

### D-2 Measuring the Test Verifier's changes (AC-121, N-3)

- **`changedSince(cwd, tree)`** (CD, `ChangeTracker`, never throws). It returns `{kind:'files', files}` (sorted, project-relative) or `{kind:'failed', error}`.
  - It builds the tree of the working tree **now**, exactly as `snapshot()` steps 3-7 do. That code (CD:477-509) is factored into one private `workingTree(cwd)`, used by both, so there is no duplicate logic. It uses the same temp index guard, `add -A`, the force-add of tracked-ignored files and `write-tree --prefix`. It creates no commit and moves no ref.
  - Then `diff --no-color --no-ext-diff --no-textconv --no-renames --name-only -z <snapTree> <nowTree>`. **There is no `--relative`** (§0.4): both trees are rooted at the project directory.
  - Deleted, added and modified paths are all listed.
- **When:** after both parallel agents settle and the Test Verifier's result is accepted, **before Gate 2**. This attributes exactly the Test Verifier's changes; Gate 2's own side effects, such as new jest snapshots, come later (I-8).
- **Test path (N-3), single source `factory/harness/test-paths.ts`.** A project-relative path, compared in lower case, is a test path when either:
  - a directory segment (not the file name) is one of `test`, `tests`, `__tests__`, `spec`, `specs`, `__snapshots__`, `__mocks__`; or
  - the file name matches `*.test.*`, `*.spec.*`, `*.e2e.*`, `*.e2e-spec.*`, `*_test.*`, `test_*.py` or `*.snap`.

  `e2e/` is deliberately not a test directory: this repo's `factory/e2e/` holds production code (I-4).
  - Exports: `TEST_DIRECTORY_NAMES`, `isTestPath(path)`, `splitByTestPath(paths) → { tests, outside }`.
- **Outcomes** (recorded as `testVerifierChanges` on the evaluation, D-7):
  - `{kind:'none'}` → the follow-up is skipped, recorded `{status:'skipped', reason:'the Test Verifier changed no file'}`.
  - `{kind:'tests', files}` → the follow-up runs on exactly `files`. Deleted files are named as deleted in its prompt.
  - `{kind:'outside-tests', files, outside}` → escalate `CRITICAL_ISSUE`, agent `06-test-verifier`. Message: "06-test-verifier changed N file(s) outside a test path: <list>. Revert them or close the run." Blockers = `outside`. Nothing is invalidated. A resume measures again, so reverting the files lets the run continue.
- **Fallback (no snapshot, AC-126):** compare the working tree with the fallback copy using the D-3 walker (same exclusions; files by sha256, symlinks by target, presence both ways).

### D-3 The review copy: where, how, read-only, fallback (AC-117, AC-123, AC-126, N-1, N-4)

- **Location (I-2: deviates from the N-4 default, needs the operator):** `mkdtempSync(join(reviewRoot, 'factory-review-<runId>-e<e>-'))`.
  - `reviewRoot` defaults to `realpathSync(os.tmpdir())`. mkdtemp gives a 0700 directory, readable only by the user.
  - The path is recorded in state. The harness never deletes it. If it disappears (the OS cleans its temp directory, or a resume on another day), it is re-extracted from the same recorded snapshot (AC-123).
  - **Why not under `.factory/<id>/`:** see §0.9. A copy of the project's tests inside the project is collected by Jest (and Vitest) in Gate 2, in the Test Verifier's runs and in the operator's own `npm test`, in every later run too. Ripgrep (the Grep tool) also skips paths under a gitignored `.factory/`, so the Validator could not search its copy. The snapshot ref is the durable record; the copy is a derived view of it.
- **New module `factory/harness/review-copy.ts`** (fs only, no git, node built-ins):
  - `createReviewDir(reviewRoot, runId, e): string`: mkdirSync(reviewRoot, recursive), mkdtemp, realpath.
  - `copyWorkingTree(cwd, dest): { entries: number }`, the AC-126 fallback. It walks `cwd` with `lstat`:
    - it skips the top-level `.factory` and every directory named `.git` or `node_modules` at any depth (I-5);
    - it copies regular files byte for byte, keeping the executable bit;
    - it recreates symlinks with `readlink` + `symlinkSync`, never following one;
    - it skips other file types;
    - it creates symlinks last.
  - `compareWithCopy(cwd, copyDir): string[]`: the fallback measurement (D-2).
  - `sealReadOnly(dir)`: bottom-up `chmod` to files 0444 (0555 if executable) and directories 0555; symlinks are skipped. This is defence in depth: the enforcement is the agent's read-only tool grant (AR).
  - `copyIntact(dir, entries): boolean`: the directory exists and its entry count equals the recorded count (a partly cleaned temp copy fails it).
  - `mapReviewPath(file, copyDir): string`: an absolute path inside `copyDir`, or inside its non-realpath twin (`/private/var` vs `/var`), becomes copy-relative, i.e. project-relative. Anything else is returned unchanged; `normalisePath` (SC:87) then handles a project-absolute path.
  - `insideReviewCopies(claims, dirs): string[]` for Gate 1 (D-15).
- **Which snapshot:** `latestStage3Snapshot(state)` (ST:1137, the B-1 seam). Within one run every Stage 3 gate pass writes one (git base), so the latest is the current phase's (Q2).
- **No snapshot** (base `none`, or a run from before B-1 with no `written` entry; N-10): the fallback copy is made **before the Test Verifier is invoked** and recorded as `source: {kind:'working-tree', reason}`. The reason is `'not a git work tree'`, or `'no snapshot was recorded for this run (started before PR B-1)'`.
- **Copy before invoke:** in every evaluation the copy is made, sealed and recorded (committed) before either agent of the evaluation is invoked.
- **Resume:**
  - snapshot source: if the recorded `dir` fails `copyIntact` → re-extract into a new mkdtemp directory from the **same recorded `{ref, commit, tree}`**, record the new `dir` (the source must be unchanged; the recorder refuses another one) and commit;
  - fallback source: if the copy is not intact and the Test Verifier was invoked in this evaluation → escalate `REVIEW_COPY_FAILED`, because the working tree may now hold its writes (I-28). If the Test Verifier has not run, make a new fallback copy.
- **Failures:** extraction, fallback copy and measurement failures escalate `REVIEW_COPY_FAILED` (new, CRITICAL; I-18), with the error text.

### D-4 Per-call working directory (AC-117, AC-118, AC-132)

- `AgentInvocation` (IA:34) gains `cwd?: string`: "the agent's working directory; omitted = the invoker's project cwd".
- `createSdkInvoker` passes `cwd: call.cwd ?? config.cwd` (IA:183).
- The orchestrator sets `cwd`:
  - main Validator: the copy directory;
  - main-origin skeptics: the same copy;
  - Test Verifier, follow-up and follow-up-origin skeptics: no `cwd` (the real tree, AC-118, AC-132).
- RH guard: `invoke-agent.ts` contains `call.cwd ?? config.cwd` (static, C-32).

### D-5 Prompts (AC-120, AC-121, AC-128)

In AP; every prompt still ends with `runDirectoryRules`.
- `UPSTREAM_FOR_AGENT` (UA:37):
  - `'07-validator'` → `AFTER_BUILD` (no `TEST_REPORT.md`);
  - `'07b-validator-followup'` → `AFTER_TESTS`;
  - `'07c-validator-skeptic'` → `['USER_STORY.md', 'TECHNICAL_BRIEF.md']`.
- **`validatorPrompt(ctx, review: { dir: string; source: ReviewSource })`.** The second argument is required.
  - With a snapshot source: "Review the implementation in `<dir>`. It is a READ-ONLY SNAPSHOT of the project taken after the Stage 3 gate passed: stage3-<n>, `<ref>`, commit `<commit>`. It is your working directory. Review the code there, not the live project at `<cwd>`, where the Test Verifier may be writing tests now. Do not run anything."
  - With the fallback: "a read-only copy of the working tree made before the Test Verifier started (<reason>)".
  - Then: "Report file paths relative to `<dir>`." Then the upstream section (existing files only, AC-24) and the rules. `TEST_REPORT.md` never appears.
- **`followupPrompt(ctx, files: {path; deleted}[])`.** "The Test Verifier wrote or changed exactly these files after the snapshot the main Validator reviewed. Review only them, in the live project at `<cwd>`: do the tests really exercise the acceptance criteria they name; are assertions specific; is there a test that cannot fail?" Then the absolute paths (deleted ones marked "deleted"), the upstream section (incl. `TEST_REPORT.md`), and "Return VALIDATION_FOLLOWUP.md; `filesReviewed` lists exactly these project-relative paths."
- **`skepticPrompt(ctx, { instance, issueKey, origin, issue, treeDir })`.**
  - "You are skeptic <A|B>. One CRITICAL issue was reported by <origin> about the code in `<treeDir>` (your working directory; read-only). Try to disprove it. Default to UPHELD. Return DISPROVED only when you can show, with file:line evidence from that tree, that the issue as stated is not real."
  - Then the issue as `describeIssue(issue)` (validator-routing.ts:34), with its severity, and "Echo issueKey `<key>`."
  - Then the upstream section and the rules.
  - **Blindness:** the prompt is built only from the issue, the tree and the documents. The A and B prompts are identical except for the instance letter. Neither ever contains a recorded verdict (AC-128).
- Contracts (one file each; AC-127):
  - `07b-validator-followup.md` (new): role, read-only, scope = the listed files, output.
  - `07c-validator-skeptic.md` (new): role, read-only, default UPHELD, evidence rule, output.
  - `07-validator.md`: it reviews the copy named in its prompt, does not run tests, and gets no test report.
  - `06-test-verifier.md`: write test files only; the test-path definition; a change outside a test path escalates.
- `runner/smoke-validator.ts` is updated to the new signature (D-18, S-1).

### D-6 Agents, tools, schemas (AC-127, AC-132, Q16, N-5)

- **AR:** `FeatureFactoryAgent` gains `'07b-validator-followup'` and `'07c-validator-skeptic'`, inserted after `'07-validator'` (the claims-block order):
  - `AGENT_STAGE` 4 for both;
  - `AGENT_TOOLS` `['Read', 'Grep', 'Glob']` for both, the same as 07 (AC-132);
  - `AGENT_COST` `{ model: 'claude-opus-5', effort: 'high', maxTurns: 20 }` for 07b and `{ … maxTurns: 15 }` for 07c;
  - `REQUIRED_ARTIFACTS`: 07b `['VALIDATION_FOLLOWUP.md']`, 07c `['SKEPTIC_REVIEW.md']`.
- **OS `DETAILS_BY_AGENT`:**
  - 07b: `filesReviewed: string[]` and `issues` (the 07 issue item shape: severity, message, suggestion, canFix required; file, line optional); required `['filesReviewed', 'issues']`. No security block: security is the main Validator's.
  - 07c: `issueKey: string`; `verdict: {enum: ['DISPROVED', 'UPHELD']}`; `reason: string`; `evidence: [{ file, line?, note }]`; required all four.
- **AOS:** new `ValidatorFollowupOutput` and `SkepticOutput` types. `validateOutputSchema` gains:
  - case 07b: `filesReviewed` and `issues` must be arrays;
  - case 07c: `verdict` must be in the enum, `reason` non-blank, `evidence` an array, with at least one entry when DISPROVED, and `issueKey` a non-blank string.

  `missingDocuments` covers both documents automatically (read-only agents).
- **SC `HARNESS_PERSISTED_AGENTS`** (SC:159) gains both. `StageOutputs` gains `validatorFollowup?` (a real slot) and `skeptic?` (transient, used only to persist).
- **RP `OUTPUT_SLOT`** (RP:46) gains `'07b-validator-followup': 'validatorFollowup'`. Skeptic results are not stageHistory steps (D-7), so they have no slot.
- **Skeptic document name.** The schema enum fixes `SKEPTIC_REVIEW.md`. After validation the orchestrator rewrites `artifact.name` to `SKEPTIC_E<e>_<issueKey>_<A|B>.md` and persists through `persist()`. One document per invocation; nothing is overwritten (I-11). It is not reserved (SC:289) and not superseded on rework (the names are unique).

### D-7 Evaluation records: data model (AC-123, AC-133, AC-157)

An **evaluation** is one main-Validator review with everything that hangs off it: the copy, the main output, the Test Verifier measurement, the follow-up, the skeptic verdicts and the decision. It is either a `first-pass` (after Gate 1.5, with the Test Verifier in parallel) or a `validator-round`.
- Its key is `(cycle, round)`, plus a run-wide number `e` (1-based).
  - `cycle` = the active CP3 rework cycle (`activeRework`, RP:275, with checkpointId 3), else 0.
  - `round` = `validatorRoundsCompleted` at the evaluation's Gate 2.
- The record is in `state.validatorEvaluations` (§3). It is not initialised by `createFeatureState`; absent = a run with no B-2 evaluation.
- **Write-once slots, enforced by the ST recorders (they throw):**
  - `validator` (the main output and its timing);
  - `followup`;
  - each `(issueKey, instance)` skeptic verdict;
  - `closed`.
  - `copy` may be replaced only with the same `source` (re-extraction).
- **Lifecycle:**
  - Start: `recordEvaluationStart` is committed **before** the copy is made and before any agent of the evaluation is invoked. This is the "verification started" marker (D-14).
  - Open: no `closed`. A resume continues the open evaluation of the same `(cycle, round)` (AC-123).
  - Decided: `closed: {outcome:'decided', verdict}` (D-12).
  - Escalated: `finish(state, 'ESCALATED', …)` (orch:581) calls `closeOpenEvaluations(state, 'escalated')` before `completeFeature`. A resume after an escalation therefore starts a **new** evaluation and re-runs the Validator. Only a kill, which never reaches `finish`, leaves one open (I-6). `killAt` tests restore the pre-kill snapshot, so they see it open.
- **The main Validator's completion is "its output is recorded on the evaluation"** (any schema-valid status). A resume never re-invokes it within that evaluation. The `07-validator` stageHistory step is recorded once, **at the decision**, with status PASS (verdict passed), FAIL (routed, I-6 rule or MAX_LOOPS) or ESCALATED. It carries the main output and its invocation timing. So:
  - `hasPass(state, '07-validator')` keeps meaning "the evaluation passed" and the Stage 4 skip rule (orch:1705) is unchanged;
  - `pendingValidatorRound` (RP:174) keeps reading the latest 07 FAIL as the round opener (I-7).
- The Test Verifier keeps its own step (PASS/FAIL/ESCALATED), recorded in its branch at return. The follow-up gets a step `07b-validator-followup` (PASS) at return. Skeptics get no stageHistory step: their record is the verdict list (AC-133).

### D-8 Parallel Test Verifier and main Validator (AC-116, AC-118, AC-124)

In orch, a new `verification()` replaces `runTestVerifier` + the first iteration of `validatorLoop` (orch:1700-1708, :1848-1994).
1. `referenceCount = gate2Reference(round)` is read **before** anything runs. A corrupt baseline still escalates before any agent is invoked; `orchestrator-gates.test.ts:620-635` and `validator-loop-back.test.ts:545-561` stay unchanged (I-9).
2. Open or resume the evaluation (D-7). Commit the start, then make or reuse the copy (D-3) and commit.
3. **Branches**, started in this order in the same tick, so the invoker sees the Test Verifier's call first:
   - Branch T, only if `!hasPass(state, '06-test-verifier')`: `timedInvoke(TV)`. Then, in the branch: schema check and `testVerifierVerdict` (orch:2271). On PASS: `TEST_REPORT.md` and the PASS step, committed. On failure: the FAIL/ESCALATED step, committed. The branch returns a typed result and **never calls `finish`**.
   - Branch V, only if the evaluation has no `validator`: `timedInvoke(07, {cwd: copy})`. Then, in the branch: the schema check. If valid: `persist({validator})`, `recordEvaluationValidator` (committed), and the IMPORTANT issues recorded once (source `07-validator`, MINOR-9 behaviour, so never dropped). It returns a typed result and never calls `finish`.
4. `await Promise.allSettled([T, V])`: no agent is left running (AC-124). RH bans `Promise.all*` only in execution-gates.ts (RH:197-205).
5. **Then decide, in this fixed order** (existing rules, AC-124):
   1. a rejected branch → rethrow the first rejection (T before V) → outer catch, `MANUAL` "Orchestration error" (as today);
   2. T's schema failure → `SCHEMA_VALIDATION`;
   3. T's verdict failure → `CRITICAL_ISSUE` (orch:1776-1784);
   4. V's schema failure → `SCHEMA_VALIDATION` (orch:1873-1882).
6. TV change measurement (D-2) → may escalate.
7. `executionGate(round, referenceCount)` (Gate 2; the signature gains the pre-read reference).
8. The main Validator's `ESCALATE` → record the 07 step ESCALATED, then escalate (AC-20 unchanged).
9. Follow-up (D-9), merge (D-10), skeptics (D-11), decision (D-12).

**Concurrency discipline:** JavaScript runs one branch at a time. Each `state = commit(recordX(state, …))` is synchronous, and every recorder mutates and returns the one `state` object, so the branches cannot lose each other's updates. `finish` is never called while a branch runs.

**`timedInvoke`** (orch:717):
- On a throw it now records the invocation with `outcome: 'threw'` and `error` (first line, at most 500 characters), commits, and rethrows (AC-124, I-16).
- `InvocationMeta` gains `evaluation?` and `instance?`.

**Legacy path:** `07-validator` PASS without a `06-test-verifier` PASS (only reachable from records written before B-2): run the Test Verifier alone, as today.

### D-9 The follow-up (AC-121, Q16)

- It runs only in a `first-pass` evaluation, only when `testVerifierChanges.kind === 'tests'`, and only if `followup` is not recorded.
- `timedInvoke(07b)` with no `cwd`. Then:
  - a schema failure → `SCHEMA_VALIDATION`;
  - `ESCALATE` → `CRITICAL_ISSUE` (agent 07b);
  - otherwise `persist({validatorFollowup})` (writes `VALIDATION_FOLLOWUP.md`, never `VALIDATION_REPORT.md`), the step PASS, and `recordFollowup(e, {status:'reviewed', files, output, timing})`, all committed;
  - its IMPORTANT issues are recorded once under source `07b-validator-followup`.
  - If `filesReviewed` differs from the list (as sets): one IMPORTANT finding, "07b-validator-followup reviewed <x> but was given <y>"; not blocking.
- No changed files → `recordFollowup(e, {status:'skipped', reason})`.
- In a `validator-round` the follow-up is not run (AC-125).

### D-10 Merge (AC-122)

`factory/harness/verification.ts` (pure):
- `issueKey(origin, issue)`: the first 12 hex digits of the sha256 of `JSON.stringify([origin, severity, file ?? null, line ?? null, message, suggestion])`. Stable and bound to the issue's content.
- `mergeIssues(main: {issues, copyDir?}, followup?: {issues}): MergedIssue[]`:
  - main issues first, each `file` mapped with `mapReviewPath(file, copyDir)` (D-3), then the follow-up's;
  - an exact duplicate (same severity, normalised file, line, message) is dropped, and the first one (main) wins.
  - `MergedIssue = { key, origin, issue }`.
- IMPORTANT findings: each merged IMPORTANT is recorded under its origin's source. Because duplicates are dropped before recording, an issue both reviews report is recorded once (AC-122).
- Routing, the Stage 4 gate and CHECKPOINT 3 all use the merged list (CP3 via both documents and the findings).
- Security checks remain the main Validator's (SC:465-467).

### D-11 Skeptics (AC-128 to AC-134, D-4, N-5, N-6)

- Inputs: `criticalIssues(merged)` (validator-routing.ts:40). IMPORTANT and MINOR are never sent. No CRITICAL → no skeptic.
- Applies to every evaluation, first pass and round.
- **Order:** for each CRITICAL in merged order, instance A, then B, sequentially (I-11). An `(issueKey, instance)` with a recorded verdict is skipped (AC-133).
- **Tree:** origin `07-validator` → `cwd` = the evaluation's copy (made intact first, D-3); origin `07b` → no `cwd` (AC-132).
- **Each invocation** (`timedInvoke(07c, {cwd?}, {evaluation: e, instance})`), then:
  - throw → outer catch, MANUAL;
  - schema failure, `details.issueKey` ≠ the key given, or a status other than PASS → escalate. A schema failure or a key mismatch is `SCHEMA_VALIDATION`; ESCALATE, FAIL or LOOP_BACK is `CRITICAL_ISSUE` with agent `07c-validator-skeptic` (AC-134, I-12). Nothing is recorded as a verdict, so the issue is not disproved.
  - otherwise rename and persist its document (D-6) and `recordSkepticVerdict(e, {issueKey, origin, instance, verdict, reason, document})`, committed **before the next invocation**.
- **Disproved = both A and B returned DISPROVED** (AC-129). Otherwise the issue stands.
- **A disproved CRITICAL** is recorded once as an IMPORTANT finding, source `07c-validator-skeptic`: `CRITICAL disproved by both skeptics (kept as IMPORTANT): <describeIssue(issue)> | skeptic A: <reason> | skeptic B: <reason>`. It appears in the CHECKPOINT 3 findings section. It is never routed and never dropped (AC-130).

### D-12 Decision, typed verdict, Stage 4 gate (AC-131)

- `verdictOf(merged, skepticVerdicts)` (verification.ts) gives `{ standing: MergedIssue[], disproved: … }`.
- `ValidationVerdict = { passed, standing: string[] (keys), disproved: string[] (keys), recordedAt }`.
- **The Phase A I-6 rule, kept per reviewer (I-13):** a main (or follow-up) status other than PASS **with no CRITICAL in its own output** escalates `CRITICAL_ISSUE` as today (orch:1918-1930). A FAIL whose CRITICALs were all disproved does not.
- `standing` empty → the 07 step is PASS, `closeEvaluation(e, decided)`, and the Stage 4 gate follows.
- `standing` not empty → the 07 step is FAIL, `closeEvaluation(e, decided, passed:false)`. Then:
  - at the round bound → `MAX_LOOPS` (orch:1944-1954, over `standing`);
  - otherwise route `standing` (orch:1956-1982; unroutable → escalate);
  - otherwise `recordValidatorRound` and `validatorRoundFix` (orch:1799), then loop into a `validator-round` evaluation (D-13).
- **Stage 4 gate:**
  - SG `Stage4Metadata.criticalIssuesCount` is replaced by `validationVerdict?: { passed: boolean; standing: number; disproved: number }`.
  - `validateValidationPassed` (SG:720) fails closed when it is absent ("no validation verdict"), and fails when `!passed || standing > 0`.
  - SC sets it from a new harness input `harness.validation`, never from the raw list (SC:457-461 loses `criticalIssuesCount`).
  - `latestGate2()` (orch:638) is extended into `stage4Evidence()`, which also passes `validation`:
    - the current cycle's latest decided evaluation's verdict;
    - for a run whose 07 PASS was recorded before B-2 (no evaluation), `legacyVerdict(outputs.validator)` (verification.ts) = passed iff the raw list has no CRITICAL (I-27).
- Stage 4 gate failure invalidates `06-test-verifier`, `07-validator` and `07b-validator-followup` (orch:1717-1721). `INVALIDATED_ON_REWORK[3]` (orch:316-320) gains `07b`. `SUPERSEDED_ON_REWORK[3]` (orch:305-309) gains `VALIDATION_FOLLOWUP.md`.

### D-13 Validator rounds and CP3 rework (AC-125)

- **Round r** (orch:1858-1991 loop, kept):
  - round fix → Gate 1 → `stage3Gate(4, round r)` (snapshot) → Gate 1.5 → `executionGate(r)`;
  - then a `validator-round` evaluation: start, a **fresh** copy of `latestStage3Snapshot` (the round's), the main Validator alone (sequential), D-11, D-12.
  - No Test Verifier, no measurement, no follow-up.
  - The Gate 2 record before the Validator stays the round's "moved past" marker. The order Gate 2 → Validator is unchanged in rounds (I-10).
- **CP3 rework k:** `changeRework` (orch:2141) → Gate 1.5 → `verification()` as a `first-pass` evaluation with `cycle = k`, on the rework's snapshot (the latest).

### D-14 AC-157: the verification-start marker (binding entry condition)

- `stage3SnapshotPassedBy` (ST:1123) gains a third clause: `(state.validatorEvaluations ?? []).some(ev => after(ev.startedAt))`. Any evaluation (open, decided or escalated) whose start is at or after the snapshot's `takenAt` means the run has moved past that gate.
- `VERIFYING_AGENTS` (ST:1113) also gains 07b and 07c.
- `recordEvaluationStart` is committed before the copy, so before the Test Verifier is invoked. A kill, an SDK/API throw or a crash anywhere in verification leaves the marker.
  - The resumed rework does not re-evaluate its Stage 3 gate; `stage3-<k>` and its record stay as they are. The Validator's copy is (re-)extracted from `stage3-<k>`, which holds none of the Test Verifier's partial writes.
  - The window "snapshot recorded, verification not started" (a kill in Gate 1.5) is still re-evaluated (AC-85). `snapshot.test.ts:704-747` moves its kill point there (I-23 item 10).
- **Validator rounds:** the round snapshot is followed by Gate 1.5 and Gate 2 before any agent, and the Gate 2 record is already a passed-by marker for re-entry (`pendingValidatorRound`, RP:177). The evaluation start adds a second marker.
- **Alternative rejected:** "a written rework entry is final". It would also skip the AC-85 re-evaluation when the kill lands between the snapshot record and the next step.

### D-15 Gate 1 and the copy (AC-117)

- `materializationGate` (orch:1103) also rejects claims inside any recorded copy directory (`insideReviewCopies`): `HALLUCINATION_DETECTED`, "claimed file(s) inside a review copy, which only the harness writes".
- The copy is outside the project, so it is never in the CHECKPOINT 3 change (`collect` reads only the project tree).

### D-16 CHECKPOINT 3 presentation (AC-122, N-16, C-28)

- `ChangePresentationInput` gains `followup?: true`. When it is set, `presentChange` reads `VALIDATION_FOLLOWUP.md` too (fail closed when missing, like the report).
- Parts:
  1. `{label:'VALIDATION_REPORT.md'}`
  2. `{text: CP3_SECTION_SEPARATOR + '## VALIDATION_FOLLOWUP.md\n\n'}`
  3. `{label:'VALIDATION_FOLLOWUP.md'}`
  4. the existing findings, snapshot and change parts.
- `artifactPaths` = [report, follow-up].
- `presentCheckpoint` (orch:2316) passes `followup: true` iff the current cycle's `first-pass` evaluation has `followup.status === 'reviewed'`. This is derived from state only, so `--approve 3` and I-7 rebuild the same text.
- Without it the raw text is byte-identical to B-1. A run paused or approved before B-2 keeps its hash (as B-1 I-5 did for snapshots).
- No new "verification" section is added (I-15).

### D-17 Recording, findings and resume summary (AC-123, AC-133)

| Unit | Completion record | Resume rule |
|---|---|---|
| Evaluation start | `validatorEvaluations[e].startedAt` | an open evaluation of the same (cycle, round) is continued; a closed one never is |
| Copy | `copy` (dir, source, entries) | reused if `copyIntact`; else re-extracted from the same source (D-3) |
| Test Verifier | step PASS (not invalidated) | re-run iff no PASS |
| Main Validator | `evaluation.validator` | re-run iff absent in the open evaluation |
| TV measurement | `testVerifierChanges` | always re-measured (cheap, idempotent); the latest result is recorded |
| Follow-up | `evaluation.followup` | run iff absent and changes are tests |
| Skeptic (issue, instance) | `evaluation.skeptics[]` | each recorded pair skipped |
| Decision | `closed` + the 07 step | as in A-2 |

Every recorder commits before the next invocation. Findings use `recordFindingsOnce` (orch:669), so a resume adds no duplicates.

### D-18 Registry, docs and drift (AC-127)

- **SKILL.md:**
  - version "(Phase B, PR B-2)";
  - "A 10-agent chain";
  - chain table rows 07b, 07c (Stage 4 Verify; Read, Grep, Glob; No);
  - diagram: Stage 4 = Gate 1.5 → 06 (real tree) ∥ 07 (read-only copy of stage3-<n>) → Gate 2 → 07b (only if 06 changed test files) → merge → 07c A and B per CRITICAL → rounds → Stage 4 gate;
  - claims-block `agents` with the two ids after 07;
  - a new subsection "Verification in Stage 4": the copy, its location and why, read-only, re-extraction, the fallback with its exclusions, the test-path rule, the follow-up, the merge, the skeptics, the verdict, `REVIEW_COPY_FAILED`, "never a git worktree";
  - the B-1 "Known limit … PR B-2 closes this" sentences (SKILL.md:245-248, :338-339) are replaced by the verification-start rule;
  - Resuming: evaluation semantics, kill vs escalation;
  - git subcommands list: + `ls-tree`, `cat-file`;
  - invocation recording: including throws;
  - artifacts: `VALIDATION_FOLLOWUP.md`, `SKEPTIC_E<e>_<key>_<A|B>.md`;
  - prompt table rows for 07, 07b and 07c;
  - Stage 4 evidence: Validation Passed reads the typed verdict;
  - CHECKPOINT 3: both documents.
- **README:** "with eight specialist agents" becomes "with eight specialist agents, plus a follow-up reviewer and a skeptic in Stage 4". DD:477's regex still matches (I-26).
- **ROADMAP:** the B-2 bullet (ROADMAP:57-62) records the entry condition as closed by AC-157.
- **DD (I-20, I-21):**
  - the `"10-agent"` retired row (DD:112) is removed, because AC-59 (DD:206-213) already pins the count to `AGENT_STAGE`;
  - AC-115's version assertions move to "Phase B, PR B-2";
  - a new AC-127 test.
- Step 1 makes the structural SKILL.md edits (claims block, count, table rows) at the same time as the registry, so DD stays green after every step.

### D-19 Budget (B-3)

All new invocations go through `timedInvoke`, so B-3's cost recording and cap cover the follow-up and both skeptics (D-4: skeptic cost counts). B-2 adds no cost fields and no cap. The story's "two parallel invocations both start under the cap" edge stays B-3's.

### D-20 Test-only `reviewRoot` (C-26)

- `OrchestrationOptions.reviewRoot?: string`: "TESTS ONLY; omitted = os.tmpdir()".
- `runToEnd` defaults it to `${cwd}-review`, a sibling of the temp project and so outside it (it stays out of the real-git CP3 diff and snapshots). `tempProject().cleanup` also removes `${dir}-review`.
- Direct `runFeatureFactory` callers that reach Stage 4 pass it (setup-only).
- RH guard: no production call site names `reviewRoot` (like AC-104, RH:428).

## 3. Exact type and interface changes

```ts
// change-diff.ts
export const GIT_EXTRACTION_SUBCOMMANDS = ['ls-tree', 'cat-file'] as const;
type GitSubcommand = (typeof GIT_READ_SUBCOMMANDS)[number] | (typeof GIT_SNAPSHOT_SUBCOMMANDS)[number] | (typeof GIT_EXTRACTION_SUBCOMMANDS)[number];
export type GitResult = { ok: true; stdout: string; raw: Buffer } | { ok: false; error: string };
export function git(cwd, subcommand, args, extraEnv?, io?: { input?: string }): GitResult;   // still the only spawnSync
export type ExtractResult = { kind: 'extracted'; entries: number } | { kind: 'failed'; error: string };
export type ChangedFiles = { kind: 'files'; files: string[] } | { kind: 'failed'; error: string };
export interface ChangeTracker {
  captureBase; collect; snapshot;                                                     // unchanged
  extractSnapshot(cwd: string, snap: { ref: string; commit: string; tree: string }, dest: string): Promise<ExtractResult>;  // never throws
  changedSince(cwd: string, tree: string): Promise<ChangedFiles>;                     // never throws
}

// state-tracker.ts
export type ReviewSource = { kind: 'snapshot'; n: number; ref: string; commit: string; tree: string } | { kind: 'working-tree'; reason: string };
export interface ReviewCopyRecord { dir: string; source: ReviewSource; entries: number; madeAt: string }
export type IssueOrigin = '07-validator' | '07b-validator-followup';
export type SkepticInstance = 'A' | 'B';
export interface SkepticVerdictRecord { issueKey: string; origin: IssueOrigin; instance: SkepticInstance; verdict: 'DISPROVED' | 'UPHELD'; reason: string; document: string; recordedAt: string }
export type TestVerifierChanges = { kind: 'none' } | { kind: 'tests'; files: string[] } | { kind: 'outside-tests'; files: string[]; outside: string[] };
export interface ValidationVerdict { passed: boolean; standing: string[]; disproved: string[]; recordedAt: string }
export interface ValidatorEvaluation {
  e: number; cycle: number; round: number; kind: 'first-pass' | 'validator-round'; startedAt: string;
  copy?: ReviewCopyRecord;
  validator?: { output: ValidatorOutput; timing: { startedAt: string; completedAt: string } };
  testVerifierChanges?: TestVerifierChanges;
  followup?: { status: 'skipped'; reason: string } | { status: 'reviewed'; files: string[]; output: ValidatorFollowupOutput; timing: { startedAt: string; completedAt: string } };
  skeptics?: SkepticVerdictRecord[];
  closed?: { outcome: 'decided'; verdict: ValidationVerdict } | { outcome: 'escalated'; at: string };
}
// FeatureState: + validatorEvaluations?: ValidatorEvaluation[]   (not initialised by createFeatureState)
// AgentInvocationRecord: + evaluation?: number; instance?: SkepticInstance; outcome?: 'threw'; error?: string
// EscalationRecord.reason: + 'REVIEW_COPY_FAILED' (CRITICAL; added to the severity list at ST:488)
export function recordEvaluationStart(state, at: { cycle: number; round: number; kind }): FeatureState;   // throws if one is open
export function openEvaluation(state, cycle: number, round: number): ValidatorEvaluation | undefined;
export function recordReviewCopy(state, e, copy: ReviewCopyRecord): FeatureState;                       // same source only
export function recordEvaluationValidator(state, e, output, timing): FeatureState;                      // write-once
export function recordTestVerifierChanges(state, e, changes: TestVerifierChanges): FeatureState;
export function recordFollowup(state, e, followup): FeatureState;                                       // write-once
export function recordSkepticVerdict(state, e, verdict: Omit<SkepticVerdictRecord, 'recordedAt'>): FeatureState;  // one per (key, instance)
export function closeEvaluation(state, e, closed): FeatureState;                                        // write-once
export function closeOpenEvaluations(state, at: string): FeatureState;
export function currentValidationVerdict(state, cycle: number): ValidationVerdict | undefined;
// stage3SnapshotPassedBy: + evaluations started at/after takenAt; VERIFYING_AGENTS + 07b, 07c

// verification.ts (new, pure)
export interface MergedIssue { key: string; origin: IssueOrigin; issue: ValidatorIssue }
export function issueKey(origin: IssueOrigin, issue: ValidatorIssue): string;
export function mergeIssues(main: { issues: ValidatorIssue[]; copyDir?: string }, followup?: { issues: ValidatorIssue[] }): MergedIssue[];
export function verdictOf(merged: MergedIssue[], skeptics: readonly SkepticVerdictRecord[]): { standing: MergedIssue[]; disproved: Array<{ merged: MergedIssue; reasons: { A: string; B: string } }> };
export function disprovedFinding(d): string;
export function legacyVerdict(validator: ValidatorOutput | undefined): ValidationVerdict | undefined;
export function currentReworkCycle(state: FeatureState): number;

// test-paths.ts (new)
export const TEST_DIRECTORY_NAMES: readonly string[];
export function isTestPath(path: string): boolean;
export function splitByTestPath(paths: readonly string[]): { tests: string[]; outside: string[] };

// review-copy.ts (new)
export function createReviewDir(root: string, runId: string, e: number): string;
export function copyWorkingTree(cwd: string, dest: string): { entries: number };
export function compareWithCopy(cwd: string, copyDir: string): string[];
export function sealReadOnly(dir: string): void;
export function copyIntact(dir: string, entries: number): boolean;
export function mapReviewPath(file: string, copyDir: string): string;
export function insideReviewCopies(claims: readonly string[], dirs: readonly string[], cwd: string): string[];

// invoke-agent.ts
export interface AgentInvocation { stage: number; agent: string; prompt: string; cwd?: string }

// agent-registry.ts: FeatureFactoryAgent + '07b-validator-followup' | '07c-validator-skeptic'; entries in AGENT_STAGE/TOOLS/COST/REQUIRED_ARTIFACTS
// agent-output-schema.ts: + ValidatorFollowupOutput, SkepticOutput; validateOutputSchema cases
// stage-gates.ts: Stage4Metadata - criticalIssuesCount + validationVerdict?: { passed: boolean; standing: number; disproved: number }
// stage-context.ts: BuildStageContextInput.harness + validation?: ValidationVerdict; StageOutputs + validatorFollowup?, skeptic?
// checkpoint-presentation.ts: ChangePresentationInput + followup?: true; export const CP3_FOLLOWUP_DOCUMENT = 'VALIDATION_FOLLOWUP.md'
// agent-prompts.ts: validatorPrompt(ctx, review); followupPrompt(ctx, files); skepticPrompt(ctx, input)
// orchestrator: OrchestrationOptions + reviewRoot?: string (tests only); InvocationMeta + evaluation?, instance?
```

## 4. Process flow after B-2 (Stage 4)

1. `changeRework()` (if a CP3 rework is active; its Stage 3 gate is skipped once `stage3SnapshotPassedBy`, now including evaluation starts).
2. Gate 1.5.
3. If `!hasPass('07-validator')` → `verification()`:
   1. pre-read the Gate 2 reference;
   2. open or resume the first-pass evaluation `(cycle, round)` → commit `startedAt`;
   3. copy: extract `latestStage3Snapshot`, or the fallback working-tree copy; seal; commit;
   4. T: 06 (if no PASS) ∥ V: 07 in the copy (if not recorded); each records on return; `allSettled`;
   5. decide in order: rethrow → 06 schema/verdict → 07 schema → measure 06's changes (outside a test path → escalate) → Gate 2 → 07 ESCALATE → 07b (if test files changed) → merge → 07c A, B per CRITICAL → verdict;
   6. passed → 07 PASS, evaluation decided. Standing → 07 FAIL → MAX_LOOPS / unroutable escalate / round r+1: builders → Gate 1 (incl. copy-claim guard) → Stage 3 gate + snapshot → Gate 1.5 → Gate 2(r+1) → `validator-round` evaluation (fresh copy, 07 alone) → 07c → verdict → loop.
4. Stage 4 gate with `{ execution, regressionReferenceCount, validation }` → CHECKPOINT 3 (report, plus the follow-up when reviewed, findings, snapshots, change).
5. Any `finish(ESCALATED)` closes open evaluations. A kill leaves them open for the resume.

Idempotency: copies are re-made from a recorded source; every agent slot is write-once; findings are deduplicated; the measurement is re-run on resume; no background jobs.

## 5. Traceability (AC → test file → title). Every title contains its AC ID.

Test files, under `factory/test/`:
- VER = `harness/verification.test.ts` (new, [O], fake tracker);
- SKP = `harness/skeptics.test.ts` (new, [O]);
- VLT = `harness/verification-logic.test.ts` (new, [U]: verification.ts and the ST recorders);
- RCT = `harness/review-copy.test.ts` (new, [U]: review-copy.ts and test-paths.ts);
- CDT = `harness/change-diff.test.ts` (real git);
- SN = `harness/snapshot.test.ts` (real git);
- CPT = `harness/checkpoint-presentation.test.ts`;
- APT = `harness/agent-prompts.test.ts`;
- SGT = `harness/stage-gates.test.ts`;
- ARG = `runner/agent-registry.test.ts`;
- AOST = `harness/agent-output-schema.test.ts`;
- DDOC = `harness/direction-documents.test.ts`;
- RH; DD.

| AC | Test → title |
|---|---|
| AC-116 | VER "AC-116 the Test Verifier and the main Validator both start before either finishes, Gate 2 runs after the Test Verifier, then the follow-up, the merge, the skeptics and routing, then the Stage 4 gate" (barrier invoker: each waits up to 10 s for the other's start; one event timeline of agents and gates) |
| AC-117 | SN "AC-117 the main Validator's copy is extracted from the latest snapshot ref and equals its tree exactly (no .git, no .factory, no untracked ignored file) and holds nothing the Test Verifier writes"; CDT it.each "AC-117 extractSnapshot %s" (writes every blob byte-identical with its mode; keeps a symlink as a link without following it; makes a gitlink an empty directory; refuses a ref that moved, a hash mismatch and an unsafe path); VER "AC-117 a review copy is never in the CHECKPOINT 3 change and a builder claim inside it fails Gate 1 with HALLUCINATION_DETECTED" |
| AC-118 | VER "AC-118 the Test Verifier is invoked in the real project tree and the main Validator in the copy" (`call.cwd`) |
| AC-119 | RH "AC-119 no source file uses git worktree and no agent sandbox is a worktree" (code() scan of production .ts for `worktree`; `GitSubcommand` excludes it) |
| AC-120 | APT "AC-120 the main Validator prompt names the copy as a read-only snapshot, names only paths that exist, and never TEST_REPORT.md"; VER "AC-120 at invocation every path the main Validator's prompt names exists and none is TEST_REPORT.md" |
| AC-121 | VER it.each "AC-121 the harness measures the Test Verifier's changes against the reviewed snapshot: %s" (only test files → 07b runs on exactly them, with its own id, step and VALIDATION_FOLLOWUP.md; none → 07b not invoked, recorded skipped; a non-test file → escalates naming it, 07b not invoked); RCT it.each "AC-121 N-3 isTestPath(%s) is %s"; CDT "AC-121 changedSince lists the files that differ from a snapshot tree, untracked and deleted included, also from a subdirectory, without touching .git/index" |
| AC-122 | VER "AC-122 the Stage 4 gate, routing and CHECKPOINT 3 use the merged issues of both reviews, and an IMPORTANT issue both report is recorded once"; CPT "AC-122 presentChange with the follow-up presents both documents in full and hashes both; without it the text is byte-identical to before" |
| AC-123 | VER it.each "AC-123 a run killed during parallel verification resumes only the agent without a recorded result (%s)" (Test Verifier killed after the Validator's output was recorded; Validator killed after the Test Verifier's PASS); VER "AC-123 the follow-up never overwrites VALIDATION_REPORT.md or the main Validator's recorded output"; VER "AC-123 a missing copy is re-extracted from the same recorded snapshot" |
| AC-124 | VER it.each "AC-124 when one parallel agent %s while the other runs, the run waits, records both invocations, escalates under the existing rules and leaves no agent running" (the Test Verifier returns FAIL; the Validator returns ESCALATE; the Test Verifier's invocation throws) |
| AC-125 | VER "AC-125 a validator round reviews a fresh copy of that round's snapshot and re-runs neither the Test Verifier nor the follow-up"; VER "AC-125 a CHECKPOINT 3 rework repeats the parallel verification on the rework's snapshot" |
| AC-126 | VER "AC-126 with no snapshot the main Validator reviews a filesystem copy of the working tree without .factory/, made before the Test Verifier started, recorded as such"; RCT "AC-126 N-1 copyWorkingTree keeps symlinks as links, follows none, and skips .factory, .git and node_modules" |
| AC-127 | DD "AC-127 the follow-up and skeptic agents are in AGENT_STAGE, AGENT_TOOLS, the agent table, the chain diagram and the claims block, and SKILL.md documents PR B-2"; DDOC it.each "AC-127 AC-107 %s containing U+202E is stored byte-identical with exactly one IMPORTANT finding" (VALIDATION_FOLLOWUP.md; a SKEPTIC_ document) |
| AC-128 | SKP it.each "AC-128 every merged CRITICAL gets two skeptic invocations before routing, and neither prompt holds the other's verdict (%s)" (first pass; validator round); SKP "AC-128 IMPORTANT and MINOR issues are never sent to skeptics, and with no CRITICAL no skeptic runs" |
| AC-129 | VLT it.each "AC-129 a CRITICAL is disproved only when both skeptics return DISPROVED (%s)"; SKP "AC-129 a split verdict keeps the issue CRITICAL and it is routed as in Phase A" |
| AC-130 | SKP "AC-130 a disproved CRITICAL becomes one IMPORTANT finding with the issue and both reasons, is shown at CHECKPOINT 3, is not routed and is never dropped" |
| AC-131 | SGT it.each "AC-131 Validation Passed reads the typed verdict, not the raw issue list (%s)"; SKP "AC-131 one CRITICAL that both skeptics disproved passes the Stage 4 gate though the raw list still holds it, and an upheld one blocks" |
| AC-132 | ARG "AC-132 the skeptic and follow-up tools are exactly the Validator's read-only tools"; SKP "AC-132 a skeptic reads the tree its reviewer read: the copy for a Validator issue, the project for a follow-up issue" |
| AC-133 | SKP "AC-133 each verdict is recorded per issue and per skeptic before the next invocation, and a resume skips recorded verdicts and never overwrites a Validator slot"; VLT "AC-133 the evaluation recorders refuse a second main output, follow-up, verdict for the same issue and skeptic, or closing" |
| AC-134 | SKP it.each "AC-134 a skeptic that %s escalates and the issue is not treated as disproved" (fails its schema; echoes another issue key; throws; returns ESCALATE; returns FAIL) |
| AC-157 | SN "AC-157 the rework's Test Verifier writes a partial file and its invocation throws: a resume keeps stage3-<k>, its commit, tree and record, and extracts the Validator's copy from it, without the partial file" (real git); VER "AC-157 a run killed during the rework's Test Verifier resumes without re-evaluating the rework's Stage 3 gate and makes no snapshot call for that phase"; SN (unit row) "AC-157 a verification start at or after the snapshot counts as moving past it" |

## 6. Test plan

**Fixtures (setup-only, (b)):**
- `fixtures/agent-outputs.ts`: `followup({ files?, issues?, status? })` and `skeptic({ verdict?, reason?, issueKey?: (call) => string })`. The default `issueKey` is parsed from the prompt's "Echo issueKey `<k>`" line, so the fixture echoes correctly. RH AC-2 requires these builders here.
- `fixtures/harness-run.ts`:
  - `passingScript()` gains `'07b-validator-followup': followup()` and `'07c-validator-skeptic': skeptic({ verdict: 'UPHELD' })`, so every existing CRITICAL keeps its Phase A route;
  - `runToEnd` defaults `reviewRoot: \`${cwd}-review\``;
  - `tempProject().cleanup` also removes `${dir}-review`.
- `fixtures/changes.ts`:
  - `extractSnapshot` writes one file (`FAKE_COPY_FILE`, `src/a.ts`) into `dest` and returns `{extracted, entries: 1}`;
  - `changedSince` returns `{files: []}` unless `changed` is given;
  - both log to a **separate** `reviewCalls` list (as B-1 I-1), so CK:539-542 and RST:283 stay unchanged;
  - options: `extract?`, `changed?`.
- `stage-gates.test.ts:253` `cleanStage4` key `criticalIssuesCount: 0` → `validationVerdict: { passed: true, standing: 0, disproved: 0 }` (the compile-time key rename; assertions unchanged).
- Direct `runFeatureFactory` callers that reach Stage 4 (`checkpoints.test.ts`, `state-persistence.test.ts`, `run-directory.test.ts`, `contracts/feature-spec.test.ts`) pass `reviewRoot` under their temp area.

**Existing tests that call a changed entry point (P-20), classified.** None are pre-approved for B-2.
- (b) = setup only.
- (c) = an assertion change, needing operator approval at CHECKPOINT 2 (all collected in I-23).
- "unchanged" = expected to pass as is. A builder that sees one fail STOPS (P-13).

| # | Test (file:line) | Why it is affected | Class / expected change |
|---|---|---|---|
| 1 | orchestrator-gates.test.ts:71-84 AC-6 | Validator now runs in parallel before Gate 2 | **(c)** :82 `not.toContain('07-validator')` → the Validator was invoked exactly once, no `07-validator` step was recorded, and nothing reached CP3 |
| 2 | orchestrator-gates.test.ts:86-102 AC-7 | same | **(c)** :100, as row 1 |
| 3 | orchestrator-gates.test.ts:342-362 AC-19 (5 rows) | same | **(c)** :358 → invoked once, no `07-validator` step; title "…, Validator never invoked" → "…, the Validator's review is never recorded PASS" |
| 4 | orchestrator-gates.test.ts:562-589 AC-23 | Gate 2 is after both agents | **(c)** :586 `firstExecution < indexOf('07-validator')` → `firstExecution` after both `06` and `07`; title "…first called after the Test Verifier…" kept |
| 5 | validator-loop-back.test.ts:252-258 AC-29 events | Gate 2 after the parallel pair; skeptics before routing | **(c)** → `['07-validator','gate-2','07c-validator-skeptic','07c-validator-skeptic','04-backend-builder','gate-1.5','gate-2','07-validator']`. Interim state after step 6 (no skeptics yet): the same without the two `07c` entries |
| 6 | validator-loop-back.test.ts:296-302 IMPORTANT-4 | same | **(c)**, as row 5 |
| 7 | resume.test.ts:89-138 D-13 timing | 06 and 07 start together | **(c)** :107 order compared per agent (multiset), not by completion order; :120 `invocationsOnDiskAtCall` → 07's call sees the same count as 06's (both start before either records) |
| 8 | upstream-artifacts.test.ts:194-215 AC-28 | 07b/07c are not invoked in a clean run | **(c)** :201 expected set = ALL_AGENTS minus 08, 07b, 07c; a second assertion that 07b/07c prompts carry the rule is added in the new tests |
| 9 | upstream-artifacts.test.ts:289-303 | 07 loses TEST_REPORT.md (AC-120) | **(c)** :300 → `[RR, US, TB, FL, BS, AC, FS]`; plus new expectations for 07b and 07c |
| 10 | snapshot.test.ts:704-747 AC-85 I-4 rework kill | AC-157: a kill at the Test Verifier's call is after the start marker | **(c)** the kill point moves to Gate 1.5 throwing after the rework snapshot (still "before the next agent"); :725 and :741 keep their meaning there. AC-157 adds the kill-at-TV case |
| 11 | repo-hygiene.test.ts:321-390 AC-45 AC-80 | third allow-list array | **(c)** :361-368 regexes and the expected list gain `GIT_EXTRACTION_SUBCOMMANDS = ['ls-tree', 'cat-file']`; :370-371 set includes them; title names the three arrays |
| 12 | doc-drift.test.ts:112 retired `"10-agent"` | 10 agents is now true | **(c)** remove the row (AC-59 DD:206-213 pins the count) |
| 13 | doc-drift.test.ts:488-522 AC-115 | version line moves to PR B-2 | **(c)** `'Phase B, PR B-1'` → `'Phase B, PR B-2'` in `required`, and :520 → `/\(Phase B, PR B-2\)/` |
| 14 | runner/output-schemas.test.ts:47-54 | 07b/07c documents are presented or kept as evidence, not gate-read | **(c)** exempt a new exported `REVIEW_DOCUMENTS = ['VALIDATION_FOLLOWUP.md', 'SKEPTIC_REVIEW.md']` (AR) |
| 15 | stage-gates.test.ts:248-258 `cleanStage4` | metadata key renamed | (b) |
| 16 | fixtures/changes.ts, harness-run.ts, agent-outputs.ts | interfaces and defaults | (b) |
| 17 | checkpoint-lifecycle.test.ts:539-542, resume.test.ts:283 | tracker call log | unchanged (separate `reviewCalls`) |
| 18 | resume.test.ts:258, :305, :437, :463, :482, :603-604, :643; checkpoint-lifecycle.test.ts:687-688, :1033, :1067; cli.test.ts:661; a2-acceptance-gaps.test.ts:142, :209; snapshot.test.ts:353-354, :643, :740; validator-loop-back.test.ts:331, :426, :441-444, :499 | agent order / counts | unchanged: 06 is called before 07 in the same tick, so `agents()` order holds; an escalation closes the evaluation (D-7), so post-escalation resumes still re-run 07; default skeptics UPHOLD, so routing is unchanged |
| 19 | orchestrator-gates.test.ts:377-429 (AC-20, I-6, AC-21) | step statuses | unchanged (the 07 step is recorded once, at decision, with the same status) |
| 20 | orchestrator-gates.test.ts:620-635; validator-loop-back.test.ts:545-561 | baseline read time | unchanged (reference pre-read, D-8 step 1) |
| 21 | upstream-artifacts.test.ts:98-131 AC-24 | 07's list | unchanged: it compares with `UPSTREAM_FOR_AGENT`, and the copy path is outside the `.factory/<id>/<NAME>` pattern |
| 22 | checkpoint-lifecycle.test.ts:164-181, CPT:136-209, direction-documents.test.ts (all) | CP3 text and hash | unchanged (no follow-up part unless reviewed) |
| 23 | agent-registry.test.ts, agent-cost.test.ts | Records grow | unchanged (07b/07c read-only, high effort; contracts > 100 characters) |
| 24 | RH AC-27 (:244-257), AC-26 (:207-242), S-1 (:144-181) | new contracts; smoke script edited | unchanged (the S-1 regexes still match: only `07-validator`, `validatorPrompt(`, `createSdkInvoker(`) |
| 25 | RH AC-107 (:632), AC-105, AC-109 | write paths | unchanged (new documents go through `persist()`) |
| 26 | run-progress.test.ts, state-tracker.test.ts, stage-context.test.ts, harness-documents.test.ts, consolidate.test.ts, execution-gates.test.ts | additive fields | unchanged |
| 27 | checkpoints, state-persistence, run-directory, feature-spec (direct `runFeatureFactory`) | reviewRoot | (b) |

Per D-5's "~23 agent-order tests": the Researcher's count included every `agents()` / `not.toContain('07-validator')` site. Rows 1-10 are the ones that change; row 18 lists the rest, with the reason each holds.

**New tests:** §5. Real git only in CDT and SN (temp repos, `isolateHarnessGit`). Parallel tests use barriers with 10 s timeouts (C-33). `npm test` stays offline.

**Existing-test policy (P-13):** a builder that breaks a test not listed above STOPS and reports. Setup-only fixes are approved by the session. Assertion changes are limited to rows 1-14 as approved at CHECKPOINT 2.

## 7. Build order

One fresh Backend Builder per step. The session runs `npm test` + `npm run typecheck` + the bidi scan after each step, records wall clock (P-14) and keeps P-12 build notes.

| Step | Owner | Content | Files | ACs | Done-check | Est. |
|---|---|---|---|---|---|---|
| S-0 | **session**, operator-approved | §9 probes: Jest dot-directory collection and ripgrep under a gitignored dir (I-2 evidence); `git cat-file --batch` with stdin; suite-time baseline | `B2_MEASUREMENTS.md` | (I-2) | figures recorded | 10 |
| 1 | builder | Agents and schemas: AR (union, 4 records, `REVIEW_DOCUMENTS`), OS details, AOS types and validate cases, UA lists, SC persisted agents + StageOutputs, RP OUTPUT_SLOT, contracts 07b/07c (new) and 06/07 edits, fixtures `followup()`/`skeptic()` + passingScript; SKILL.md structural edits (claims block, "10-agent", table rows); DD row 12; OS row 14; UA row 9 | AR, OS, AOS, UA, SC, RP, agents/*, fixtures, SKILL.md, DD, OS test, UA test, ARG, AOST | AC-127 (structure), AC-132 [S] | green; rows 9, 12, 14 changed as approved | 12 |
| 2 | builder | Git: extraction array, `git()` raw+input, `workingTree()` factored, `extractSnapshot`, `changedSince`; `ChangeTracker`; orch `changes` object (orch:436-440); fake tracker `reviewCalls`; RH row 11 | CD, orch (3 lines), fixtures/changes.ts, CDT, RH | AC-117 [CDT], AC-121 [CDT], AC-80 ext. | CDT green; RH AC-80 per row 11; AC-89 tests unchanged | 20 |
| 3 | builder | `review-copy.ts`, `test-paths.ts` | new modules, RCT | AC-121 [U], AC-126 [U], N-1 | RCT green | 10 |
| 4 | builder | State and verdict: ST types/recorders, REVIEW_COPY_FAILED, invocation fields, `stage3SnapshotPassedBy` clause; `verification.ts`; SG `validationVerdict` + criterion; SC `harness.validation`; orch stage4 passes `validation: legacyVerdict(outputs.validator)` (interim) | ST, verification.ts, SG, SC, orch (1 call), VLT, SGT (b + AC-131), SN unit row | AC-129 [U], AC-131 [U], AC-133 [U], AC-157 [U] | green; every runToEnd test unchanged | 15 |
| 5 | builder | Per-call cwd (IA); `followupPrompt`, `skepticPrompt`; RH cwd guard | IA, AP, APT, RH | AC-128 (prompt blindness [U]), AC-132 | green | 10 |
| 6 | builder (orchestrator core) | `verification()`: pre-read reference, evaluations, copy (extract/fallback/re-extract), parallel branches, `timedInvoke` throw recording, settle-then-decide, TV measurement + N-3 escalation, Gate 2 after, rounds with fresh copies, Gate 1 copy guard, `finish` closes evaluations; `validatorPrompt(ctx, review)` + `smoke-validator.ts`; `reviewRoot` + fixtures + RH guard; rows 1-4, 7, 10 and interim rows 5-6 | orch, AP, smoke-validator.ts, harness-run.ts, VER, SN, RH, orchestrator-gates/validator-loop-back/resume/snapshot tests, direct callers (b) | AC-116 (without the skeptic part), AC-117 [O][SN], AC-118, AC-119, AC-120, AC-123, AC-124, AC-125, AC-126, AC-157 | VER green; only rows 1-7, 10 changed | 25 |
| 7 | builder (orchestrator core) | Follow-up, merge, skeptics, decision with the typed verdict, findings, CP3 two documents, SUPERSEDED/INVALIDATED; final rows 5-6, row 8 | orch, CPR, CPT, VER, SKP, DDOC, validator-loop-back, UA test | AC-116 (full), AC-121, AC-122, AC-127 (AC-107 part), AC-128-AC-134 | VER, SKP green | 25 |
| 8 | builder | Docs: SKILL.md (D-18), README line, ROADMAP B-2 bullet, DD AC-127 test, row 13 | SKILL.md, README.md, docs/ROADMAP.md, DD | AC-127 | DD and RH green; typecheck green | 15 |
| S-1 | **session**, operator-approved | Live smoke (P-16) of the copy-based Validator: `npx ts-node factory/runner/smoke-validator.ts --cwd <fresh empty dir>` (§9) | `B2_MEASUREMENTS.md` | AC-117/120 live evidence | P1-P6 recorded | 5 |
| S-2 | **session** | Final `npm test`, `npm run typecheck`, bidi scan of every changed file, suite time | `B2_MEASUREMENTS.md` | — | recorded | 5 |

**Builder time ≈ 132 min (8 steps) + session ≈ 20 min + ~2 min checks per step.** Steps 6 and 7 are orchestrator-core. Plan about 3.5 h active plus untimed and waiting time.

**Builder rules:**
- Only this repo, on `feat/phase-b2-verification`. No git commands of any kind (P-27). No commit or push.
- `~/.claude/**` and `docs/factory-runs/**` are read-only.
- No string literal may contain `git <forbidden subcommand>` (RH:336-349).
- No new dependency: node built-ins only (`fs`, `path`, `os`, `crypto`, `child_process` in CD only).
- Build invisible characters from code points; never type them (P-23).
- Grep for an existing helper before writing one (anti-pattern 10).

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The Validator can still Read the live tree by absolute path (the tool grant is read-only, not path-limited) | Prompt and contract name only the copy; `cwd` is the copy; B-3 sandboxing may add path limits. Accepted (I-30) |
| The SDK ignores a per-call `cwd` outside the project, or Grep/Glob behave differently there | S-1 live smoke (P-16); a failure stops before verification |
| The OS temp cleaner removes parts of a copy mid-run | `copyIntact` count check before each use; re-extraction from the recorded snapshot |
| A large repository: extraction time and memory | Batches of at most 1000 objects / 64 MiB; blobs over 256 MiB fail closed (REVIEW_COPY_FAILED); the same exposure as the snapshot's `add` |
| Copies accumulate in the temp directory and may hold a stray `.env` (0700 directory) | Documented; the cleanup belongs with the `refs/factory/*` cleanup backlog (ROADMAP) |
| Skeptic cost (two per CRITICAL per evaluation) | Recorded by `timedInvoke`; the cap is B-3 (D-19) |
| Skeptics disprove a real CRITICAL | Both must agree; the issue still shows at CP3 as IMPORTANT with both reasons; the human decides |
| Parallel tests flake under load | Barriers, not sleeps; 10 s timeouts (C-33) |
| The test-path rule misclassifies a project's layout | Fail closed (escalate) on anything outside the list; the operator can revert or close; the rule is one module |
| A slip writes the user's index during the measurement | `changedSince` uses the B-1 temp-index guard inside `git()` (CD:178); CDT checks `.git/index` bytes |
| Filter drivers run in the measurement's `add` | Same as the snapshot (MINOR-3, accepted). Extraction runs no filters |
| Manual edits to the tree during a run are not in the snapshot the Validator reviewed | CP3 still shows the real change; documented |

## 9. Live and measurement items

**S-0 (session, operator-approved, scratch directory under the session scratchpad, never the repo).** It uses the repo's own Jest binary; no network.
```
SCRATCH=$(mktemp -d <scratchpad>/ff-dotdir-XXXX) && cd "$SCRATCH"
mkdir -p test .factory/run-1/copy/test
echo 'test("a",()=>{})' > test/a.test.js
echo 'test("b",()=>{})' > .factory/run-1/copy/test/b.test.js
<repo>/node_modules/.bin/jest --rootDir "$SCRATCH" --testMatch '**/test/**/*.test.js' --listTests
git init -q && printf '.factory/\n' > .gitignore
(cd .factory/run-1/copy && rg -l test . ; echo "rg exit $?")
git --version
```
Record:
- whether `.factory/run-1/copy/test/b.test.js` is listed;
- whether `rg` finds the file under the gitignored directory;
- the git version.

Then remove `$SCRATCH`. Also time `npm test` once on the base branch (suite-time baseline; B-2 adds work to every Stage 4 run).

**S-1 live smoke (after step 8, before verification, operator-approved; one `07-validator` invocation, opus, at most 25 turns, about $1-2).** `smoke-validator.ts` keeps its fixture and P1-P5, and now:
- makes a review copy of the fixture with `copyWorkingTree` + `sealReadOnly` into a fresh `createReviewDir`;
- invokes 07 with `cwd: <copy>` and `validatorPrompt(ctx, { dir, source: working-tree })`;
- adds **P6**: every issue `file` (if any) maps under the copy with `mapReviewPath`, and the run reports no denied tool.

Record the result in `B2_MEASUREMENTS.md`. It stays operator-only and imported by nothing (RH S-1).

**S-2:** the final suite time vs S-0.

## 10. Data model, API, frontend

- **Data model:**
  - `state.json` gains `validatorEvaluations`;
  - `agentInvocations[]` gains the optional `evaluation`, `instance`, `outcome`, `error`;
  - the escalation reason `REVIEW_COPY_FAILED`.
  - Git: no new refs. The measurement writes unreferenced tree and blob objects (loose objects; gc reclaims them).
  - Temp: one 0700 directory per evaluation copy under `os.tmpdir()`.
  - No migrations: a pre-B-2 record loads. Without evaluations, the Stage 4 gate uses the legacy verdict (I-27), CP3 text is unchanged, and a pre-B-1 run without a snapshot uses the AC-126 fallback (N-10).
- **API:** no HTTP. The TypeScript surface is in §3. CLI flags unchanged (`cli.test.ts:243` "twelve flags" unchanged).
- **Frontend:** none. The Frontend Builder is not needed.

## 11. Security surface

| Surface | Declaration | Why |
|---|---|---|
| auth | **ABSENT** | Local CLI and library; no auth boundary, roles or sessions |
| userInput | **PRESENT** | Agent outputs drive file paths (issue files mapped from the copy; follow-up file lists; skeptic issue keys and verdicts); git tree paths from `ls-tree` are validated before any write; test-path classification of changed files; prompts carry agent text |
| secrets | **PRESENT** | The copy holds every snapshot file, possibly a stray non-ignored `.env`, in a 0700 temp directory that is kept. No credential is read or used |
| sqlDatabase | **ABSENT** | No database; JSON and Markdown files plus git |
| htmlRendering | **ABSENT** | Terminal text and Markdown, never rendered in a browser; direction characters are handled by the B-1 checks, which cover the new documents |

```json
{ "securitySurface": { "auth": "ABSENT", "userInput": "PRESENT", "secrets": "PRESENT", "sqlDatabase": "ABSENT", "htmlRendering": "ABSENT",
  "notes": "Local CLI/library. userInput = agent-supplied paths and verdicts, git tree paths (validated: no absolute, '..', '.git' segment), changed-file classification. secrets = the review copy duplicates non-ignored project files (maybe a stray .env) into a kept 0700 temp directory; nothing leaves the machine." } }
```

## 12. Issues for the operator (CHECKPOINT 2)

Each issue names the D-n and the step it maps to.

- **I-1 Approve AC-157 (added at B-2 per the binding entry condition).** → D-14, steps 4 and 6.
  > **AC-157 (added at B-2 per the binding condition) · B-2 · MUST · [O][U] · testable: yes.**
  > - **Given** a CHECKPOINT 3 rework whose Stage 3 gate passed and recorded `stage3-<k>`,
  > - **when** the run is killed, or the Test Verifier's invocation throws (an SDK or API error), while the Test Verifier is running,
  > - **then** a resume:
  >   - does not re-evaluate that rework's Stage 3 gate;
  >   - makes no snapshot call for that phase;
  >   - leaves `stage3-<k>`'s record and ref unchanged;
  >   - extracts the main Validator's copy from `stage3-<k>`, so it holds none of the Test Verifier's partial writes.
  > - [U] `stage3SnapshotPassedBy` is true when a verification start is recorded at or after the snapshot's time, with no invocation or Gate 2 record.
  > - A kill after the snapshot record and before verification starts is still re-evaluated (AC-85).

  **Recommend: approve as written.**
- **I-2 The copy lives outside the project, in `os.tmpdir()` (mkdtemp, 0700, path recorded, never deleted by the harness, re-extracted when missing). This replaces N-4's "under the run directory, archived with the run".** Reason: §0.9 (Jest collects tests in dot-directories; this repo's `.factory/` is not ignored; archived copies would run in every later `npm test`; ripgrep skips a gitignored `.factory/`). S-0 confirms it. The snapshot ref stays the durable record. → D-3, step 6. **Recommend: approve.** If you keep N-4, the brief needs a test-runner exclusion we cannot impose on target projects.
- **I-3 Extraction by `ls-tree` + `cat-file --batch`; allow-list array `GIT_EXTRACTION_SUBCOMMANDS = ['ls-tree', 'cat-file']`.** `git()` always reads raw bytes and accepts stdin input. `git archive` is rejected because export attributes change the tree. → D-1, step 2. Approve the RH AC-80 change (row 11). **Recommend: approve.**
- **I-4 Test-path definition** (D-2). Directory segments `test`, `tests`, `__tests__`, `spec`, `specs`, `__snapshots__`, `__mocks__`; file names `*.test.*`, `*.spec.*`, `*.e2e.*`, `*.e2e-spec.*`, `*_test.*`, `test_*.py`, `*.snap`. **Not `e2e/`** (this repo's `factory/e2e/` is production code). Deletions count. → step 3. **Recommend: approve.**
- **I-5 Fallback copy exclusions:** the top-level `.factory`, plus `.git` and `node_modules` at any depth. There is no `.gitignore` semantics in the fallback (outside git there is none; a git run with no snapshot exists only from before B-1). → D-3, step 3. **Recommend: approve.**
- **I-6 A kill keeps the open evaluation; an escalation closes it.** A resume after a kill re-runs only unfinished agents (AC-123). A resume after any escalation starts a new evaluation and re-runs the Validator. This keeps the post-escalation agent lists unchanged. → D-7, step 6. **Recommend: approve.**
- **I-7 "Recorded PASS" for the main Validator = its output recorded on the open evaluation (any schema-valid status).** Its stageHistory step is written once, at the decision, so `hasPass('07-validator')` keeps meaning "the evaluation passed". → D-7, steps 6-7. **Recommend: approve.**
- **I-8 Order after the parallel pair:** rethrow → 06 schema/verdict → 07 schema → measure 06's changes → Gate 2 → 07 ESCALATE → follow-up → merge → skeptics → decision. The measurement runs before Gate 2, so Gate 2's own writes are not attributed to the Test Verifier. → D-8, step 6. **Recommend: approve.**
- **I-9 The Gate 2 reference is read before the parallel phase**, so a corrupt baseline escalates before any agent runs. → D-8, step 6. **Recommend: approve.**
- **I-10 Validator rounds stay sequential:** Gate 2 → main Validator (fresh copy) → skeptics → routing; no Test Verifier, no follow-up. → D-13, step 6. **Recommend: approve.**
- **I-11 Skeptics:**
  - id `07c-validator-skeptic`;
  - instances A then B, sequential, per CRITICAL in merged order;
  - the two prompts are identical except the instance letter;
  - document `SKEPTIC_E<e>_<issueKey>_<A|B>.md`, renamed by the harness from the schema's `SKEPTIC_REVIEW.md`.

  → D-6, D-11, step 7. **Recommend: approve.**
- **I-12 AC-134 widened:** a skeptic status FAIL or LOOP_BACK also escalates; a DISPROVED needs at least one evidence entry; a wrong `issueKey` echo is a schema failure. → D-11, step 7. **Recommend: approve (fail closed).**
- **I-13 The Phase A I-6 rule with skeptics:** a reviewer's non-PASS status with no CRITICAL in its own output still escalates; a FAIL whose CRITICALs were all disproved passes. → D-12, step 7. **Recommend: approve.**
- **I-14 Merge:** main issues first, follow-up second, exact duplicates dropped (main wins); IMPORTANT recorded under the origin's source, once. → D-10, step 7. **Recommend: approve.**
- **I-15 CHECKPOINT 3 adds `VALIDATION_FOLLOWUP.md` only when this cycle's follow-up reviewed files; no new "verification" section.** Pre-B-2 paused or approved hashes stay valid. → D-16, step 7. **Recommend: approve.**
- **I-16 `timedInvoke` records a throwing invocation (`outcome: 'threw'`, `error`), then rethrows.** `consolidate-run.ts` is left for B-3. SKILL.md's "recorded as it completes" changes accordingly. → D-8, step 6. **Recommend: approve.**
- **I-17 Gate 1 also rejects claims inside any recorded copy** (`HALLUCINATION_DETECTED`). → D-15, step 6. **Recommend: approve.**
- **I-18 New escalation reason `REVIEW_COPY_FAILED` (CRITICAL)** for extraction, fallback-copy and measurement failures. A Test Verifier change outside a test path uses `CRITICAL_ISSUE`, agent `06-test-verifier`. → D-2, D-3, steps 4 and 6. **Recommend: approve.**
- **I-19 Test-only `reviewRoot`** option, with an RH guard; `runToEnd` uses the sibling `<cwd>-review`, removed by `tempProject` cleanup. → D-20, step 6. **Recommend: approve.**
- **I-20 Doc-drift: remove the retired `"10-agent"` row (DD:112).** `AGENT_STAGE` now has 10 agents, and AC-59 already pins the prose count to it. → D-18, step 1. **Recommend: approve (c).**
- **I-21 Doc-drift AC-115 version assertions move to "Phase B, PR B-2"** (DD:491, :520). → D-18, step 8. **Recommend: approve (c).**
- **I-22 `output-schemas.test.ts:47-54` exempts `REVIEW_DOCUMENTS`** (`VALIDATION_FOLLOWUP.md`, `SKEPTIC_REVIEW.md`: presented or kept as evidence, not gate input). → D-6, step 1. **Recommend: approve (c).**
- **I-23 The other (c) assertion changes, §6 rows 1-11:**
  1. orchestrator-gates :82 (AC-6);
  2. :100 (AC-7);
  3. :358 (AC-19, 5 rows);
  4. :586 (AC-23);
  5. validator-loop-back :252-258 (AC-29) and
  6. :296-302 (IMPORTANT-4), with the interim sequence after step 6;
  7. resume :107 and :120 (D-13);
  8. upstream-artifacts :201;
  9. :300;
  10. snapshot :704-747 (kill point moved to Gate 1.5; AC-157 covers the TV kill);
  11. RH AC-80.

  → steps 1, 2, 6, 7. **Recommend: approve all.**
- **I-24 Budget: nothing in B-2;** all new invocations go through `timedInvoke`, so B-3 covers them. → D-19. **Confirm.**
- **I-25 Session steps:** S-0 (local probes, no network) and S-1 (one live Validator call, about $1-2). → §9. **Recommend: approve both.**
- **I-26 README:** "with eight specialist agents, plus a follow-up reviewer and a skeptic in Stage 4". DD:477 is unchanged. → D-18, step 8. **Recommend: approve.**
- **I-27 A run whose `07-validator` PASS was recorded before B-2** (no evaluation record) gets the Stage 4 verdict from its raw issue list (no skeptics). → D-12, step 4. **Recommend: approve.**
- **I-28 A fallback copy that is missing on resume after the Test Verifier ran escalates `REVIEW_COPY_FAILED`** (the Test Verifier's changes can no longer be told apart). → D-3, step 6. **Recommend: approve (fail closed).**
- **I-29 The follow-up's `filesReviewed` mismatch is an IMPORTANT finding, not a block.** → D-9, step 7. **Recommend: approve.**
- **I-30 The copy's read-only bits are defence in depth;** the Validator could still read the live tree by absolute path (instructed not to). Path-level enforcement is B-3 territory. → D-3, D-4. **Accept.**

─────────────────────────────────────────────────────────────────
⏸  CHECKPOINT 2 — BRIEF REVIEW
Read the technical brief above carefully.
This is the last chance to catch wrong assumptions before files are changed.
Reply "approved" when ready to continue to the builders.
─────────────────────────────────────────────────────────────────

Status: **PASS**. No blocker. Operator answers are needed on:
- I-1 (approve the new AC-157);
- I-2 (the copy location deviates from the N-4 default; needed before step 6);
- I-20 to I-23 (assertion changes, needed before steps 1, 2, 6, 7 and 8).

