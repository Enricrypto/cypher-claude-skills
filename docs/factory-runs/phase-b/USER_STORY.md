# User Story — Phase B: faster verification, isolated review, bounded runs (Revision 1)

> Feature Factory, by-hand mode. Agent 02 (Story Writer), read-only. 2026-10-05.
> Inputs: `docs/factory-runs/phase-b/B_DECISIONS.md` (binding), `docs/factory-runs/phase-b/B_RESEARCHER_REPORT.md`, `docs/factory-runs/phase-a/USER_STORY.md` (format and AC numbering), `factory/feature/SKILL.md` (current behaviour, Phase A PR A-2), and the operator's revision round 1.
> Saved verbatim by the orchestrating session from the Story Writer's hand-back.
>
> **Status: awaiting CHECKPOINT 1.**
> **Delivery: three PRs, each merged before the next starts:**
> - PR **B-1** = groups SN, GT, LC, TX, DC: AC-45 (revised in Phase B) and AC-80 to AC-115.
> - PR **B-2** = groups VR, SK: AC-116 to AC-134.
> - PR **B-3** = groups CB, SX, PB: AC-135 to AC-156.

Phase A ends at AC-79, so Phase B uses AC-80 to AC-156. The numbers run without gaps. AC-45 keeps its ID, is marked "(revised in Phase B)", and replaces Phase A's AC-45.

---

## User Stories

**Story 1: Operator.** As the operator running `npm run factory`, I want:
- a private snapshot of every passing Stage 3 result;
- review running alongside the tests, against a copy nobody else is writing to;
- false CRITICAL findings challenged before they cost a validator round;
- spending capped;
- builders that cannot commit or touch the run record;
- any invisible direction characters in a document I am asked to approve shown to me.

I also want my branch, index and working tree left exactly as I had them.

**Story 2: Maintainer.** As a maintainer, I want:
- the known Gate 2 and lifecycle defects fixed;
- every kept doc checked against the code;
- stale docs archived rather than left to mislead.

---

## Test method legend

- **[O] Orchestrator test:** `runFeatureFactory` with a scripted invoker, a temp project and injected gates. Snapshot tests use a real temp git repo, with local git only.
- **[G] Gate test:** a gate run directly against a temp project with tiny real scripts, or against a temp git repo.
- **[U] Unit test:** a pure function.
- **[C] CLI test:** the injectable CLI entry point (AC-63).
- **[S] Static check:** a source-scan or doc-drift test.
- **[L] Live probe:** run once by hand against real git or the real SDK. The result is recorded in that PR's run records. Not an offline test.
- **[M] Measurement:** a figure recorded in that PR's run records.

Every criterion is an offline test (no model, no network) unless it is marked [L] or [M].

Format of each criterion: **ID · PR · priority · method · testable**, followed by Given / When / Then.

---

## Acceptance Criteria

### SN. Snapshot after Stage 3 (B3): PR B-1

- **AC-45 (revised in Phase B) · B-1 · MUST · [O] · testable: yes.** *This replaces Phase A's AC-45.* The factory never touches your branch, index or working tree, never pushes, and writes git objects only under `refs/factory/<id>/`.
  - **Given** a temp git repo with:
    - a checked-out branch;
    - a staged change;
    - an unstaged change;
    - an untracked file.
  - **When** a run goes from start to an approved CHECKPOINT 3, including a validator round,
  - **then** all of these are byte-identical to before:
    - HEAD's branch name and commit;
    - `.git/index`;
    - every working-tree file that no agent wrote;
    - every ref outside `refs/factory/<id>/`.
- **AC-80 · B-1 · MUST · [S] · yes.** **Given** the source tree, **when** `repo-hygiene.test.ts` runs, **then** it enforces AC-45 (revised). This replaces the assertion at `repo-hygiene.test.ts:298-335` (pre-approved). It checks that:
  - Exactly one file (`change-diff.ts`) spawns git, with exactly one spawn call.
  - The git subcommand allow-list is exactly:
    - the read set: `rev-parse`, `diff`, `ls-files`;
    - the snapshot plumbing set;
    - from B-2, the extraction command.

    The brief names the exact members.
  - None of these ever appears as a git subcommand: `push`, porcelain `commit`, `checkout`, `switch`, `reset`, `merge`, `rebase`, `stash`, `branch`, `tag`, `worktree`, `fetch`, `clone`.
  - Every ref the harness writes is built by one function that prefixes `refs/factory/<id>/`.
- **AC-81 · B-1 · MUST · [O] · yes.** **Given** a git project, **when** a Stage 3 gate passes (in Stage 3, in every validator round and in every CHECKPOINT 3 rework), **then**:
  - a commit exists at `refs/factory/<id>/stage3-<n>`, with n counting up from 1;
  - `state.json` records each snapshot before the next agent is invoked: n, ref, commit sha, tree sha, phase, time.
- **AC-82 · B-1 · MUST · [O] · yes.** **Given** a snapshot, its tree equals the working tree as the CHECKPOINT 3 change sees it:
  - tracked files with their current content;
  - untracked files that are not ignored;
  - no ignored files;
  - nothing under `.factory/`.

  Its parent is HEAD at that moment. On an unborn branch it is a root commit.
- **AC-83 · B-1 · MUST · [G] · yes.** **Given** a repo where:
  - every hook, including `reference-transaction`, writes a marker file;
  - `commit.gpgSign=true` is set and `gpg.program` fails;
  - there is no `user.name` or `user.email`;

  **when** a snapshot is written, **then**:
  - it succeeds without waiting on input;
  - no marker file exists;
  - the commit is unsigned and carries the harness's own author identity.
- **AC-84 · B-1 · MUST · [O] · yes.** **Given** a fresh run starts, the harness records, using only read-only git, the paths that were already changed or untracked. Then:
  - **Given** that list is not empty, the CHECKPOINT 3 text says the snapshots and the change include these pre-existing changes, and lists them.
  - **Given** it is empty, no such note appears.
  - **Given** a run started before B-1 (no list recorded), the note says the pre-existing changes are unknown.
- **AC-85 · B-1 · MUST · [O] · yes.** **Given** the process is killed after the ref is written but before state is saved, **when** the run is resumed, **then**:
  - the Stage 3 gate is evaluated again;
  - state ends with exactly one entry for that n, and its ref exists and points at the recorded sha;
  - no `stage3-<n+1>` exists for the same gate pass;
  - an unchanged tree reuses the existing commit;
  - a changed tree replaces the `stage3-<n>` ref.
- **AC-86 · B-1 · MUST · [O] · yes.** **Given** HEAD's commit or branch differs from the base captured at the start of the run, **when** a Stage 3 gate passes, **then**:
  - no snapshot is written;
  - the run escalates `HEAD_MOVED`, naming the recorded and the current HEAD, and telling the operator to restore HEAD or close the run.

  Every HEAD move escalates, including a commit the operator made between a pause and a resume. This is a read-only check; hard enforcement is AC-144 (B-3).
- **AC-87 · B-1 · MUST · [O] · yes.** **Given** the base was captured as "not git", **when** a Stage 3 gate passes, **then**:
  - no snapshot is attempted;
  - state records "skipped: not a git work tree";
  - the run continues;
  - the CHECKPOINT 3 text says no snapshot was taken.

  What B-2 does in this case is AC-126.
- **AC-88 · B-1 · MUST · [O] · yes.** **Given** the snapshot write fails, **then** the run escalates `SNAPSHOT_FAILED` with git's error text, records no entry for n, and can be resumed.
- **AC-89 · B-1 · MUST · [O] · yes.**
  - **Given** the same working tree, the diff and untracked-file part of the CHECKPOINT 3 text is byte-identical with and without snapshots.
  - **Given** a run paused at CHECKPOINT 3, `--approve 3` is not refused because of any snapshot.
- **AC-90 · B-1 · MUST · [S] · yes.** Contracts `04-backend-builder.md` and `05-frontend-builder.md` both say: never commit, push or switch branches, and never write under `.git/` or `.factory/`.

### GT. Builder tests and Gate 2: PR B-1

- **AC-91 · B-1 · MUST · [S] · yes.** **Given** contracts 04 and 05 and the builder prompt, **then** they:
  - tell the builder to run only the tests related to the files it changed;
  - say the full suite runs in Gate 2.

  **B2 is an instruction, not something the factory enforces.** No test asserts which tests a builder ran. Gate 2's full suite is the enforcement, and SKILL.md says so.
- **AC-92 · B-1 · MUST · [G] · yes.** **Given** a `dev` script that exits 0 before the dev window ends, **then** the dev check is SKIPPED with a warning recorded as an IMPORTANT finding. It neither passes nor blocks.
- **AC-93 · B-1 · MUST · [G][S] · yes.**
  - [G] **Given** a `test` or `dev` script whose shell exits normally and leaves a grandchild running in its process group, **when** the command settles, **then** the grandchild is no longer running. Settling always kills the process group.
  - [S] SKILL.md documents that a process which calls `setsid()` escapes this.
- **AC-94 · B-1 · MUST · [U] · yes.** **Given** any amount of output, **then** Gate 2 keeps at most a fixed bound per stream (the brief sets the bound), with a visible truncation marker.
- **AC-95 · B-1 · MUST · [G] · yes.** **Given** output larger than the bound:
  - Mocha counts printed before more failure detail than the bound are still parsed correctly.
  - A failing test's name printed anywhere appears in `failedTests`.
  - A dev-server error line printed anywhere fails the dev check, including a line split across two chunks.
- **AC-96 · B-1 · MUST · [U] · yes.** Test counts are parsed per stream and chosen by runner marker:
  - **Given** a Vitest summary plus a stray `Tests: N … total` line without Jest's `Test Suites:` marker, **then** the Vitest counts are used.
  - **Given** a complete Jest summary on stderr, **then** the Jest counts are used.
  - **Given** complete summaries from two runner families:
    - with different counts, Gate 2 blocks with "ambiguous test summary";
    - with equal counts, those counts are used.

  AC-8 and AC-9 still hold.

### LC. Lifecycle and CLI: PR B-1

- **AC-97 · B-1 · MUST · [O][C] · yes.** **Given** the project directory contains an entry whose lowercase name is `.factory` but which is not spelled exactly `.factory` (for example `.Factory`), **when** a fresh run or a resume starts, **then**:
  - it is refused before any write, and the refusal names the entry;
  - nothing is created.

  The exact `:(exclude).factory` pathspec is kept.
- **AC-98 · B-1 · MUST · [L] · yes (live probe).** **Given** real git on macOS (APFS), **then** the probe records whether `core.ignorecase=true` makes `:(exclude).factory` exclude `.Factory/`. The result goes in the B-1 run records. AC-97 applies whatever the result.
- **AC-99 · B-1 · MUST · [O][C] · yes.** The library makes both description refusals, after `checkResumeRequest`:
  - a finished run given a different `--feature` → `RUN_FINISHED`;
  - an exhausted-builder run given a different `--feature` → `NEEDS_GRANT`;
  - a resumable run given a different description → `DESCRIPTION_MISMATCH`, also when `runFeatureFactory` is called directly;
  - a run recorded without a description and given none → `DESCRIPTION_REQUIRED`.

  Every refusal writes nothing and exits 1.
- **AC-100 · B-1 · MUST · [S] · yes.** `cli.ts` contains no description comparison and no `DESCRIPTION_*` decision. It reads the description only to print its banner.
- **AC-101 · B-1 · MUST · [O][C] · yes.** **Given** a record from before A-2 that escalated `MAX_LOOPS` without `builderPhase`:
  - a plain `--resume` is refused `NEEDS_GRANT`, naming `--grant-attempts`, and `state.json` stays byte-identical;
  - `--grant-attempts <n>` gives that builder exactly n attempts in the phase the harness infers:
    - escalation stage 3 → Stage 3;
    - escalation stage 4 → validator round number `validatorRoundsCompleted`.

  The pinned assertion at `run-lifecycle.test.ts:191-196` changes (pre-approved).
- **AC-102 · B-1 · MUST · [U] · yes.** **Given** text containing any character in the shared set (AC-105), **then** `printableForTerminal` escapes it:
  - code points above 0xFF are shown as `\u{XXXX}` (for example `\u{202E}`);
  - C0, DEL and C1 characters keep `\xNN`.

  Hashes are still taken over the raw text. The assertions at `cli.test.ts:371-379` change (pre-approved). U+200B–U+200D are now escaped in terminal output too.
- **AC-103 · B-1 · MUST · [M] · yes (measurement).** Before any suite-time change, the wall-clock time of `npm test` and the share of it spent on durable state writes are recorded in the B-1 run records. Both are measured again after the change.
- **AC-104 · B-1 · SHOULD · [O][S] · yes.** If AC-103 shows durable writes are a material share of suite time:
  - [O] tests can inject a non-durable writer through `OrchestrationOptions`; the default stays durable;
  - [S] a guard test asserts that no production call site passes it.

  The brief records whether this was adopted.

### TX. Invisible direction characters: PR B-1

- **AC-105 · B-1 · MUST · [S][U] · yes.** One exported character set is the single source of truth for these characters. It contains:
  - U+061C;
  - U+200B–U+200F;
  - U+2028–U+202E (U+2028, U+2029, then U+202A–U+202E);
  - U+2066–U+2069;
  - U+FEFF.

  This is the union of the document list and AC-102's terminal list. So the document check also flags U+2028 and U+2029, and the terminal escapes U+200B–U+200D.
  - [S] `printableForTerminal` and the document/checkpoint check both import this set, and no other copy of it exists.
- **AC-106 · B-1 · MUST · [U] · yes.** **Given** each range boundary, **then**:
  - every member is flagged: U+061C; U+200B and U+200F; U+2028 and U+202E; U+2066 and U+2069; U+FEFF;
  - every neighbour is not flagged: U+061B, U+061D, U+200A, U+2010, U+2027, U+202F, U+2065, U+206A, U+FEFE, U+FF00;
  - ordinary non-ASCII text (for example é, or Arabic letter U+0627) is not flagged.
- **AC-107 · B-1 · MUST · [O][S] · yes.**
  - [O] **Given** an agent returns a document containing U+202E, **when** the harness persists it, **then**:
    - the file on disk is byte-identical to the agent's text;
    - `state.importantFindings` gains exactly one IMPORTANT finding for that document, naming the document, the line number(s) and the code point(s).
  - This holds for:
    - every agent document: `RESEARCHER_REPORT.md`, `USER_STORY.md`, `TECHNICAL_BRIEF.md`, `FILE_LIST.md`, `VALIDATION_REPORT.md`, `CONSOLIDATION_REPORT.md`, `PATTERNS.md`, and in B-2 the follow-up and skeptic documents;
    - every harness-rendered document built from agent output: `BACKEND_SUMMARY.md`, `API_CONTRACT.md`, `FRONTEND_SUMMARY.md`, `TEST_REPORT.md`.
  - A clean document produces no finding.
  - A resume that re-renders identical content adds no duplicate finding.
  - [S] Every harness write path for these documents goes through the check.
- **AC-108 · B-1 · MUST · [O] · yes.** **Given** CHECKPOINT 1, 2 or 3 presents a document containing a character from the set, **then** the presented text:
  - starts with a warning banner with one entry per occurrence, giving document, line and code point;
  - shows each such character as a visible `\u{XXXX}`.

  The SHA-256 is taken over this escaped presented text, so the approval binds to what was shown. Because there is one banner entry per occurrence, replacing a real character with its literal escape text, or the reverse, always changes the presented text and the hash. For the CHECKPOINT 3 change section, see N-16.
- **AC-109 · B-1 · MUST · [O][C][S] · yes.**
  - [O][C] **Given** a run paused at a checkpoint whose documents contain U+202E and are unchanged, **when** `--resume <id> --approve <n>` is run, **then** it is not refused: the hash is stable across presentations.
  - The resume check of approved artifacts (I-7 included) also passes for those unchanged documents.
  - [S] `presentationFor` is the single presentation function (A-2 C-14). It is used for presenting, for `--approve`, and for the I-7 re-check. No other code builds checkpoint text.
- **AC-110 · B-1 · MUST · [O][C] · yes.** **Given** a run paused before B-1 (its hash was taken over unescaped text):
  - **if** its documents contain no character from the set, the presented text and hash are unchanged, and `--approve` works;
  - **if** they do, `--approve` is refused `ARTIFACT_CHANGED`, with a message saying the presentation changed in this version and telling the operator to close the run (`--close <id>`). `state.json` stays byte-identical.

  The same applies to a pre-B-1 approved checkpoint re-checked on resume. See N-15.

### DC. Docs: PR B-1

- **AC-111 · B-1 · MUST · [S] · yes.** `docs/ROADMAP.md` exists. It contains:
  - Phases A–E as the plan of record;
  - a table mapping the `docs/REFACTOR_PLAN.md` phases into A–E;
  - MINOR-3 (git filter drivers) as an accepted risk, with the revisit trigger "minimum supported git ≥ 2.42 (`--attr-source`)".
- **AC-112 · B-1 · MUST · [S] · yes.** These files move to `docs/archive/`:
  - the 5 `factory/feature/docs/*.md`;
  - the 3 reference files: `STAGE_CONTRACTS.md`, `STATE_TRACKING.md`, `OUTPUT_SCHEMAS.md`.

  Each archived file starts with "historical — not maintained; see SKILL.md". A short pointer stays at each original path: SKILL.md for behaviour, the TypeScript types for schemas.
- **AC-113 · B-1 · MUST · [S] · yes.** Every kept doc is in the drift test's scope: the pointers, `README.md` and `SKILL.md`.
  - Their links resolve.
  - None contains a retired claim.
  - The retired-claims list gains the old "makes no … commit" sentence.
- **AC-114 · B-1 · MUST · [S] · yes.** The README "five stages" section says:
  - the program runs Stages 1–4 with three checkpoints, CHECKPOINT 3 included;
  - Stage 5 runs only via `--consolidate`;
  - PR review is not presented as outside the program.

  The drift test asserts the README does not say "five stages".
- **AC-115 · B-1 · MUST · [S] · yes.** SKILL.md describes all B-1 behaviour:
  - the version line names "Phase B, PR B-1";
  - snapshots (AC-81 to AC-88) and the AC-45 (revised) sentence;
  - B2 as instructed, not enforced;
  - AC-92 to AC-96, AC-97, AC-99 and AC-101;
  - **TX:**
    - the shared set;
    - documents stored exactly as written, with an IMPORTANT finding;
    - the checkpoint banner and escaping;
    - the hash over the escaped text;
    - the pre-B-1 paused-run behaviour;
    - the terminal `\u{XXXX}` format.

  The AC-60 "Phase A … Gate 2 … Test Verifier … escalate" line stays.

### VR. Parallel verification (B1, per D-5): PR B-2

- **AC-116 · B-2 · MUST · [O] · yes.** **Given** Stage 4 after Gate 1.5:
  - the Test Verifier and the main Validator review both start before either finishes (a fake invoker waits for both to start);
  - Gate 2 runs after the Test Verifier finishes;
  - then the follow-up review (AC-121), the merge (AC-122), the skeptics (AC-128) and routing run;
  - then the Stage 4 gate.
- **AC-117 · B-2 · MUST · [O] · yes.** The main Validator works in a read-only copy extracted from the latest snapshot ref:
  - the copy equals that tree exactly: no `.git`, no `.factory`, no ignored files;
  - nothing the Test Verifier writes appears in it;
  - it never appears in the CHECKPOINT 3 change and is never a Gate 1 claimed path.
- **AC-118 · B-2 · MUST · [O] · yes.** The Test Verifier runs in the real project tree, as today.
- **AC-119 · B-2 · MUST · [S] · yes.** No source file uses `git worktree`. No agent sandbox is a worktree.
- **AC-120 · B-2 · MUST · [O] · yes.** The main Validator prompt:
  - names the copy and says it is a read-only snapshot;
  - names only paths that exist (AC-24 holds);
  - does not name `TEST_REPORT.md`.
- **AC-121 · B-2 · MUST · [O] · yes.** **Given** the Test Verifier finishes, the harness measures which files differ between the real tree and the snapshot the main review used. Then:
  - **Given** every changed file is under a test path (the brief defines "test path"), a follow-up review agent runs on exactly that list. It has its own agent id, its own output slot and its own document name.
  - **Given** the list is empty, the follow-up is not invoked, and that is recorded as skipped.
  - **Given** any changed file is not under a test path, the run escalates and names those files (fail closed).
- **AC-122 · B-2 · MUST · [O] · yes.** The Stage 4 gate, routing and CHECKPOINT 3 use the merged issues of the main and follow-up reviews.
  - CHECKPOINT 3 presents both documents in full, and its hash covers both.
  - Each IMPORTANT finding is recorded once.
- **AC-123 · B-2 · MUST · [O] · yes.** **Given** a run killed during parallel verification, a resume:
  - re-runs only the agents without a recorded PASS;
  - never overwrites `VALIDATION_REPORT.md` or the main Validator output with the follow-up's;
  - re-extracts the copy from the same recorded ref when the copy is missing.
- **AC-124 · B-2 · MUST · [O] · yes.** **Given** one parallel agent fails or escalates while the other is still running:
  - the run waits for the other to finish;
  - both invocations are recorded;
  - the run then escalates under the existing rules;
  - no agent is still running when the run ends.
- **AC-125 · B-2 · MUST · [O] · yes.**
  - In a validator round, the Validator reviews a fresh copy of that round's snapshot. The Test Verifier and the follow-up are not re-run.
  - A CHECKPOINT 3 rework repeats the AC-116 flow on the rework's snapshot.
- **AC-126 · B-2 · MUST · [O] · yes.** **Given** no snapshot is recorded (outside git, or a run from before B-1), **then** the main Validator reviews a filesystem copy of the working tree:
  - excluding `.factory/`;
  - made before the Test Verifier starts;
  - recorded as such.

  This is Researcher Q5's default; see N-1.
- **AC-127 · B-2 · MUST · [S] · yes.** The follow-up and skeptic agents are listed in:
  - `AGENT_STAGE` and `AGENT_TOOLS`;
  - the SKILL.md agent table, chain diagram and claims block.

  The drift test passes. SKILL.md describes AC-116 to AC-134. AC-107 applies to the follow-up and skeptic documents.

### SK. Skeptic step (B5, per D-4): PR B-2

- **AC-128 · B-2 · MUST · [O] · yes.** **Given** the merged results of any Validator evaluation (first pass or round) contain a CRITICAL issue, **then** two skeptic invocations review it before routing.
  - Neither prompt contains the other's verdict.
  - IMPORTANT and MINOR issues are never sent to skeptics.
  - With no CRITICAL issue, no skeptic is invoked.
- **AC-129 · B-2 · MUST · [U][O] · yes.** A CRITICAL issue is disproved only if both skeptics return DISPROVED. Otherwise it stays CRITICAL and is routed or escalated as in Phase A.
- **AC-130 · B-2 · MUST · [O] · yes.** A disproved CRITICAL:
  - becomes an IMPORTANT finding in `state.importantFindings`, holding the issue and both skeptics' reasons;
  - is shown in the CHECKPOINT 3 text;
  - is not routed;
  - is never dropped.
- **AC-131 · B-2 · MUST · [O][U] · yes.** The Stage 4 gate's "Validation Passed" reads the typed verdict, not the raw issue list:
  - **Given** one CRITICAL issue that both skeptics disproved, **then** the gate passes, even though the raw list still contains that CRITICAL.
  - **Given** an issue that a skeptic upheld, **then** the gate blocks.
- **AC-132 · B-2 · MUST · [S] · yes.** Skeptic tools are read-only (the same as 07's). Skeptics read the same tree the reviewing agent read.
- **AC-133 · B-2 · MUST · [O] · yes.** Each skeptic verdict is recorded per issue and per skeptic. A resume skips recorded verdicts and never overwrites a Validator slot.
- **AC-134 · B-2 · MUST · [O] · yes.** **Given** a skeptic's output fails its schema, its invocation throws, or it returns ESCALATE, **then** the run escalates and the issue is not treated as disproved.

### CB. Cost and budget (C5, GAP-3 per D-2): PR B-3

- **AC-135 · B-3 · MUST · [O] · yes.** Every agent invocation records the cost in USD that the SDK reports, in `agentInvocations`.
  - This includes failed and throwing invocations, and `--consolidate` invocations.
  - A cost the SDK did not report is recorded as unknown, never as 0.
- **AC-136 · B-3 · MUST · [C] · yes.** The run summary prints each agent's cost and the run total.
  - When any cost is unknown, the total is labelled a lower bound.
  - Records from before B-3 show unknown and still resume.
- **AC-137 · B-3 · MUST · [O][C] · yes.** **Given** a run started with `--max-cost-usd <n>` (saved in state) whose recorded cost has reached n plus any grants, **when** any agent is about to be invoked, **then**:
  - nothing is invoked;
  - the run escalates `BUDGET_EXCEEDED` (exit 1, not PAUSED).

  This covers builders, the Test Verifier, the Validator, the follow-up and the skeptics.
- **AC-138 · B-3 · MUST · [C][O] · yes.** **Given** a run escalated `BUDGET_EXCEEDED`, **then** a plain `--resume` is refused with a message naming `--grant-budget <usd>`. `state.json` stays byte-identical. Exit 1.
- **AC-139 · B-3 · MUST · [C][O] · yes.** **Given** that run, `--resume <id> --grant-budget <usd>`:
  - adds exactly that amount;
  - is recorded with the amount and a timestamp;
  - lets the run continue.

  The run escalates again when the raised cap is reached.
- **AC-140 · B-3 · MUST · [C] · yes.** `--grant-budget`:
  - is refused on a run that did not escalate `BUDGET_EXCEEDED`;
  - is mutually exclusive with `--approve`, `--reject` and `--grant-attempts`.

  `--max-cost-usd` is accepted on a new run only. A missing, blank or non-positive value for either flag is a usage error.
- **AC-141 · B-3 · MUST · [O] · yes.**
  - **Given** no `--max-cost-usd`, **then** no run ever escalates for budget.
  - `--consolidate` records cost but is never capped.
  - PAUSED and its rules are unchanged.
- **AC-142 · B-3 · MUST · [S] · yes.** These all list `max-cost-usd` and `grant-budget`:
  - the claims block's `cliFlags`;
  - the CLI parser;
  - SKILL.md.

  SKILL.md describes cost recording, the cap and the grant.
- **AC-143 · B-3 · COULD · [O] · yes.** Each invocation passes the SDK a per-query budget equal to the remaining budget.

### SX. Builder sandboxing (GAP-5): PR B-3

- **AC-144 · B-3 · MUST · [O][U] · yes.**
  - [O] Builders are invoked with writes to `<cwd>/.git/` and `<cwd>/.factory/` denied:
    - for Bash, through the SDK sandbox;
    - for Write and Edit, through a permission check.
  - [U] The permission check:
    - denies `.git/x`, `.factory/x`, `.Factory/x`, `src/../.git/x`, and a symlink that resolves into `.git/`;
    - allows `src/x`.
- **AC-145 · B-3 · MUST · [O] · yes.** **Given** the sandbox is unavailable, **then** the run escalates before the builder is invoked. A builder never runs unsandboxed.
- **AC-146 · B-3 · MUST · [L] · yes (live probe).** **Given** the real SDK and a sandboxed builder session, **then** each of these is denied, and HEAD and `.factory/` are left unchanged:
  - `git commit`;
  - `touch .factory/x`;
  - a Write to `.git/HEAD`.

  The result goes in the B-3 run records. With this, "builders never commit" is enforced. The AC-86 check stays as a second guard.
- **AC-147 · B-3 · SHOULD · [O] · yes.** The Test Verifier is invoked under the same write restrictions (N-9).
- **AC-148 · B-3 · MUST · [S] · yes.** SKILL.md says builders cannot write `.git/` or `.factory/`, and names what the sandbox does not cover.

### PB. Parallel builders (B4): PR B-3

- **AC-149 · B-3 · MUST · [O] · yes.** Builders run in parallel only when both of these hold:
  - the approved brief's typed full-API-contract field is complete (N-11);
  - the operator opted in (N-12).

  Otherwise they run in sequence, as today. An opt-in without a complete contract is recorded as an IMPORTANT finding.
- **AC-150 · B-3 · MUST · [O] · yes.** In parallel mode:
  - both builders start before either finishes;
  - Gate 1 and the Stage 3 gate run after both pass;
  - then one snapshot is taken (AC-81).
- **AC-151 · B-3 · MUST · [O] · yes.** In parallel mode, the Frontend Builder's prompt:
  - takes the API contract from the brief;
  - does not say the backend is already built;
  - names no document that does not exist yet.
- **AC-152 · B-3 · MUST · [O][U] · yes.** Both builders work in one tree; never a worktree, never a copy.
  - In parallel mode, each builder's writes are limited by the AC-144 permission check to the files `FILE_LIST.md` assigns it.
  - A write to the other builder's file is denied.
  - **Given** the assignments overlap, **then** the run falls back to sequential and records an IMPORTANT finding.
- **AC-153 · B-3 · MUST · [O] · yes.** **Given** one builder escalates while the other is running, **then**:
  - the other finishes its current attempt and starts no new one;
  - both are recorded;
  - the run escalates.
- **AC-154 · B-3 · MUST · [O] · yes.** Resuming a parallel Stage 3 re-runs only the builders without a PASS, each with its own attempt count from state.
- **AC-155 · B-3 · MUST · [O] · yes.** Validator rounds and CHECKPOINT 3 rework stay sequential.
- **AC-156 · B-3 · MUST · [S] · yes.** SKILL.md documents parallel builders: when they run, the opt-in, and the isolation. The drift test passes.

---

## Pre-approved assertion changes (approved at CHECKPOINT 1, per D-6)

1. **AC-45 guard:** `factory/test/contracts/repo-hygiene.test.ts:298` (the block at :298-335) is rewritten to AC-80.
2. **MINOR-8:** `factory/test/harness/run-lifecycle.test.ts:191-196` goes from "MAX_LOOPS without builderPhase → undefined" to the inferred phase (AC-101).
3. **Bidi:** `factory/test/runner/cli.test.ts:371-379` changes to the AC-102 escaping, using the shared set (AC-105).

No other existing assertion is pre-approved. The brief must list these for CHECKPOINT 2:
- the ~23 agent-order assertions and `orchestrator-gates.test.ts:562-589` (D-5);
- `cli.test.ts:243`, "exactly the twelve flags" (D-2);
- the pinned tracker call sequences: `checkpoint-lifecycle.test.ts:540-541` and `resume.test.ts:280`;
- any checkpoint-text or hash assertion that TX changes.

---

## Process rules (by-hand runs)

After saving any subagent report to disk, the orchestrating session runs the bidi scan on the saved file. It uses the same character set as AC-105. This is a working rule for by-hand runs, not a code change, and has no AC.

---

## Edge Cases

| Edge case | Disposition |
|---|---|
| Operator had uncommitted changes at start | AC-84 |
| Crash between ref write and state save | AC-85 |
| Builder or operator committed, or switched branch | AC-86 (B-1 detects, escalates); AC-144 (B-3 prevents builders) |
| Not a git work tree | AC-87, AC-126 |
| Unborn branch | AC-82 |
| Hooks, gpg signing, no git identity | AC-83 |
| `.Factory/` on APFS | AC-97, AC-98 |
| Dev script exits 0 at once; grandchild survives | AC-92, AC-93 |
| Huge test output; Mocha counts before the failure details | AC-94, AC-95 |
| Jest-like line inside Vitest output | AC-96 |
| Pre-A-2 MAX_LOOPS record | AC-101 |
| Bidi or invisible characters in terminal output | AC-102, AC-105 |
| Bidi characters in a persisted document | AC-107 |
| Bidi characters in a document at a checkpoint | AC-108, AC-109 |
| Real character swapped for its literal `\u{…}` text | AC-108 (per-occurrence banner changes the hash) |
| Run paused before B-1 with such characters | AC-110, N-15 |
| Bidi characters in builder source code shown in the CHECKPOINT 3 change | N-16 |
| Killed during parallel verification | AC-123 |
| One parallel agent fails while the other runs | AC-124, AC-153 |
| Test Verifier added no files | AC-121 (follow-up skipped) |
| Test Verifier changed a non-test file | AC-121 (escalate) |
| CRITICAL with no file, disproved by both skeptics | AC-130 |
| Skeptics disagree | AC-129 |
| Cost unknown (subscription auth) | AC-135, AC-136, N-7 |
| One invocation overruns the cap | Recorded; the next invocation is refused (AC-137); AC-143 optional |
| Two parallel invocations both start under the cap | Both recorded; accepted |
| Parallel builders' file assignments overlap | AC-152 (sequential plus finding) |
| `setsid()` escapes the group kill | Documented limitation (AC-93) |
| Two runs started at the same moment | **Out of scope** (as in Phase A) |

---

## Out of Scope

- **Phase C items:** AC IDs across the chain, tests-first, mutation testing, risk tiers, the existence-only spec check (C1), and MINOR-4/5 (the pre-supplied path, with C1).
- **A-2 test-style follow-ups.**
- **The `consolidate-run.ts:125` description fallback.**
- **README restructure and outside-user polish:** Phase E. Only the AC-114 factual fix is in scope.
- **MINOR-3 git filter drivers:** accepted risk, recorded in ROADMAP (AC-111).
- **Enforcing which tests a builder runs:** B2 is instructed only.
- **Loop-backs on a Gate 2 or Test Verifier failure:** they still escalate.
- **A budget pause, or any change to PAUSED.**
- **Pushing, PRs, and deleting `refs/factory/*` refs.**
- **Locking against simultaneous runs.**
- **A Test Verifier mutation step.**
- **The `testsWritten = 0` false block in Stage 3 "Unit Tests Pass".**
- **Rewriting or stripping direction characters on disk:** documents are stored exactly as written.

---

## Decided at CHECKPOINT 1 preparation (operator answers, revision round 1)

- **N-2:** `HEAD_MOVED` and `SNAPSHOT_FAILED` are accepted. Every HEAD move escalates, including an operator commit between a pause and a resume. → AC-86, AC-88
- **N-3:** a Test Verifier that changes a non-test file escalates (fail closed). The brief defines "test path". → AC-121
- **N-8:** the budget flags:
  - `--max-cost-usd <n>` on a new run, saved in state; no cap when it is absent;
  - `--grant-budget <usd>` grants more;
  - `--consolidate` records cost but is not capped.

  → AC-137 to AC-142
- **N-13:** parallel builders work in one tree.
  - Each builder's writes are limited by the B-3 permission check to the files `FILE_LIST.md` assigns it.
  - Overlapping assignments → sequential, plus an IMPORTANT finding.
  - Never a worktree.

  → AC-152

---

## Open questions for CHECKPOINT 1

Five Researcher questions are already settled: Q1 (D-1), Q13 (D-3), Q15 (D-5), Q17 (D-4), Q18 (D-2). Q16 is partly settled by D-5. **15** Researcher questions remain. The story assumes each default below; accept them in one go or correct any.

| Q | Default the story assumes | ACs |
|---|---|---|
| Q2 | Snapshot after every passing Stage 3 gate (Stage 3, rounds, rework), kept as a list in state; B1 copies from the latest | AC-81, AC-117, AC-125 |
| Q3 | Snapshot = whole tree minus `.factory/`, matching the CHECKPOINT 3 diff; dirty trees are not refused; pre-existing changes are flagged | AC-82, AC-84 |
| Q4 | Read-only HEAD check before each snapshot; escalate otherwise; hard enforcement in B-3 | AC-86, AC-144 |
| Q5 | Outside git: no snapshot, reason recorded; B1 uses a filesystem copy | AC-87, AC-126 |
| Q6 | A `dev` script that exits 0 early is SKIPPED with an IMPORTANT finding; the process group is always killed on settle | AC-92, AC-93 |
| Q7 | Parse per stream; choose by runner marker; counts that disagree block as "ambiguous test summary" | AC-96 |
| Q8 | Keep the exact pathspec; refuse case variants before the run starts; live-probe `core.ignorecase` | AC-97, AC-98 |
| Q9 | Measure first, then a test-only non-durable writer with a guard test | AC-103, AC-104 |
| Q10 | MINOR-8: infer the phase from the escalation stage | AC-101 |
| Q11 | Description refusals move into the library, after `checkResumeRequest` | AC-99, AC-100 |
| Q12 | `\u{XXXX}` above 0xFF. **The escape set is the shared AC-105 set** (U+061C, U+200B–U+200F, U+2028–U+202E, U+2066–U+2069, U+FEFF), so U+200B–U+200D are now escaped in the terminal too | AC-102, AC-105 |
| Q14 | ROADMAP uses A–E with a mapping table | AC-111 |
| Q16 | Follow-up agent `07b-validator-followup`, read-only, with its own slot and document; the `AGENT_STAGE` and drift-test changes are accepted | AC-121, AC-127 |
| Q19 | Cost reaches the harness through a side channel; failed invocations record their cost | AC-135 |
| Q20 | A typed field the spec sets, plus explicit opt-in. **Q20's own-copy-per-builder default is replaced by the N-13 decision** (one tree, writes limited per builder by `FILE_LIST.md`) | AC-149 to AC-152 |

**New questions still open** (recommended default in brackets):
- **N-1.** Does Q5's filesystem copy conflict with D-5? I see no conflict: D-5 forbids worktrees, not copies, and the Validator is read-only. [Exclude `.factory/` and ignored paths such as `node_modules/`. Copy symlinks as links. Never follow a link that points outside the copy.]
- **N-4.** Where the Validator copy lives, and for how long. [Under the run directory; kept and archived with the run; never deleted.]
- **N-5.** Skeptic ids and recording. [One read-only skeptic contract, invoked as two distinct recorded instances (A and B) per issue.]
- **N-6.** A skeptic's output fails its schema. [Escalate, per the existing rule (AC-134).]
- **N-7.** The SDK reports no cost. [Record it as unknown; the cap counts known costs only; the total is shown as a lower bound.]
- **N-9.** Is the Test Verifier sandboxed like the builders? [Yes, as a SHOULD (AC-147).]
- **N-10.** A pre-B-1 run resumed after B-1. [Snapshots start at n=1. Pre-existing changes show as unknown (AC-84). In B-2, AC-126 applies when no snapshot exists.]
- **N-11.** What counts as a "full API contract". [A typed flag the Spec Writer sets in the brief, plus a non-empty `apiContract.endpoints`. The harness checks both.]
- **N-12.** How the operator opts in to parallel builders. [A flag on a new run, recorded in state, honoured only if AC-149 holds after CHECKPOINT 2.]
- **N-14.** One builder escalates during a parallel Stage 3. [The other finishes its current attempt and starts no new one. Then the run escalates. No abort. (AC-153)]
- **N-15.** A run paused before B-1 whose presented documents contain set characters. Its saved hash was over unescaped text, and a plain `--resume` of a paused run changes nothing (SKILL.md), so it cannot be re-presented. [Refuse `--approve` with `ARTIFACT_CHANGED` and a message telling the operator to close the run with `--close <id>`. The same applies to a pre-B-1 approved checkpoint re-checked on resume. (AC-110)]
- **N-16 (new).** The CHECKPOINT 3 change section: builder source code can contain direction characters (Trojan Source). [The whole presented text is escaped, the diff included. The banner lists occurrences in the change as "the change", with the line within the presented change. No IMPORTANT finding is raised for source files; the banner is the warning.]

---

## Definition of Done

- **Tests:** every criterion (AC-45 revised, and AC-80 to AC-156) is covered by a test or source check whose title names the AC ID.
  - Exceptions: the [L] probes (AC-98, AC-146) and the [M] measurement (AC-103), which are recorded in that PR's run records.
- **Checks:** `npm test`, `npm run typecheck` and the drift test pass at the end of each PR.
- **Per PR:**
  - **B-1:** AC-45 (revised in Phase B), AC-80 to AC-115.
  - **B-2:** AC-116 to AC-134.
  - **B-3:** AC-135 to AC-156.

Status: **PASS** (Story Writer). All four revision items are applied; every open question has a recommended default.
