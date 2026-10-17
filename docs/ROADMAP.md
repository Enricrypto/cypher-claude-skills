# Roadmap

> The plan of record, from the operator's decisions of 2026-10-05
> ([B_DECISIONS.md](factory-runs/phase-b/B_DECISIONS.md)). It supersedes the phase numbering of
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md), which is kept for its history; section 3 maps its phases
> onto this plan. What the Feature Factory does today is in
> [factory/feature/SKILL.md](../factory/feature/SKILL.md); this file says what comes next.

---

## 1. Plan of record

The work is organised in phases A to E, plus Phase R. Phase A and Phase D are done. Phase B is in
progress. The order from here is **Phase R first, then B → C → E** (B-3 is the remaining Phase B
PR): each phase ships as one or more PRs, and each PR is merged before the next one starts. Phase R
was added on 2026-10-16
([R_DECISIONS.md](factory-runs/phase-r/R_DECISIONS.md)) and runs before B-3 because it blocks real
use of the factory.

---

## 2. Phases

### Phase A — run integrity and lifecycle (done)

- **PR A-1 "Gates tell the truth":** the gates judge harness measurements, never an agent's own
  account of its work.
- **PR A-2 "Run lifecycle":** three checkpoints (CHECKPOINT 3 approves the validated change),
  pause, approve and reject, rework, resume from `state.json`, close, archive, `--consolidate`.

Run records: [docs/factory-runs/phase-a/](factory-runs/phase-a/).

### Phase B — snapshots, verification, sandboxing, cost (in progress)

Items:
- **B1** parallel verification: the Validator reviews a read-only copy extracted from the B3
  snapshot, while the Test Verifier keeps running in the real tree. Never a git worktree.
- **B2** builders run only the tests related to their change; Gate 2 runs the full suite. An
  instruction, not enforced: Gate 2 is the enforcement.
- **B3** an orchestrator-owned snapshot after every passing Stage 3 gate, a private commit at
  `refs/factory/<id>/stage3-<n>` written with git plumbing. The user's branch, index and working
  tree are never touched.
- **B4** parallel builders, in one tree, each limited to the files the file list assigns it;
  overlapping assignments run in sequence, with an IMPORTANT finding.
- **B5** the Skeptic step: two read-only skeptics review each CRITICAL finding; a finding both
  disprove becomes an IMPORTANT finding shown at CHECKPOINT 3, never dropped.
- **A-1 MINOR-1, MINOR-2, MINOR-3** (Gate 2): a dev script that exits 0 early and the grandchild
  it leaves running; unbounded output buffers; one runner's summary overriding another's.
- **GAP-3** a budget cap: hitting it escalates `BUDGET_EXCEEDED`, and a grant flag continues the
  run, like `--grant-attempts`.
- **GAP-5** builder sandboxing.
- **C5** cost per agent, pulled in from Phase C.

Three PRs:
- **B-1:** B3, B2, A-1 MINOR-1/2/3, this roadmap, and from the A-2 backlog: the refusal of a
  `.factory` look-alike that differs only in letter case, description refusals made by the
  library rather than the CLI (NEW-MINOR-1), the phase of a builder record written before A-2
  (MINOR-8), suite time, escaping of invisible and direction-control characters, and the factual
  doc fixes (eight stale docs archived, the README stages section corrected).
- **B-2:** B1 and B5. Binding entry condition: a crash or SDK/API error during the Test Verifier
  left no record, so a resume re-took the rework snapshot `stage3-<k>` with the Test Verifier's
  partial writes, and B1's Validator copy would have been extracted from that ref. Closed by
  AC-157: a "verification started" marker is saved before the Test Verifier is invoked, and a
  resume keeps `stage3-<k>`. Source: [B_DECISIONS.md](factory-runs/phase-b/B_DECISIONS.md).
- **B-3:** C5, GAP-3, GAP-5 and B4.

Run records: [docs/factory-runs/phase-b/](factory-runs/phase-b/).

### Phase R — reliability hardening (in progress, before B-3)

Found by the first real project (`cypher-agents`, 2026-10-15/16), which stopped 12 times before a
checkpoint. Items R1–R10, binding decisions in
[R_DECISIONS.md](factory-runs/phase-r/R_DECISIONS.md):
- **R-1 (done):** R1 keep the machine awake, R2 reply limit 64,000 tokens, R3 one retry on a
  transient API error, R8 snapshots work when `.factory/` is ignored and the factory writes it to
  `.git/info/exclude`. Four of the six causes behind those 12 stops. R1 holds
  `caffeinate -dims -w <pid>` on macOS and is a no-op elsewhere, releasing itself with the
  process; R2 sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS` on top of the inherited environment, never in
  place of it; R3 retries one transient failure once after 30 seconds and records both attempts
  in `agentInvocations`, never spending a builder attempt on a dropped connection; R8 names the
  project's non-ignored top-level entries in the snapshot `add` instead of a `:(exclude)`
  pathspec, which git 2.39 refused once `.factory/` was ignored.
- **R-9 (done, PR #n):** R9 proportionate effort with the Ponytail rules. The Spec Writer now
  declares `briefItems`, one entry per unit of work, each labelled `tidy-up`, `behaviour change`
  or `new feature` — a field its SDK output schema requires, so the model is retried until every
  item carries one — and mirrors those labels in `TECHNICAL_BRIEF.md`'s prose, which is how they
  reach CHECKPOINT 2, the Test Verifier and the Validator, none of which receive structured
  output. The harness fails closed: a missing or unrecognised label reads as `new feature`, full
  depth, and a missing or unmirrored label is one IMPORTANT finding, `Effort Labels Declared`,
  that never blocks the stage — the enforcement stays the human at CHECKPOINT 2. Contracts 04 and
  05 carry the smallest-complete-change ladder, the never-cut list (trust-boundary validation,
  data-loss error handling, security, accessibility), the `shortcut: <the limit>, <when to
  upgrade>` comment form and the summary-ends-with-what-was-skipped rule; 06 carries the
  label→test-depth table and the one-small-test rule; 07 judges depth against the label, accepts
  a documented shortcut, and treats a cut to any never-cut item as Critical whatever the label.
  All five documents credit Ponytail by Dietrich Gebert (MIT) by absolute URL; the skill itself is
  not vendored. Moved ahead of R-2 so later runs can be measured against the baseline in
  [R_MEASUREMENTS.md](factory-runs/phase-r/R_MEASUREMENTS.md).
- **R-2 (done, 2026-10-17):** R4 `maxTurns` scaled to the approved file list, R5 a size warning at
  CHECKPOINT 2. Each of the two builders, the Test Verifier and the Validator (04, 05, 06, 07) is
  now invoked with `min(150, max(base, 40 + 2 × files))`, computed fresh at invocation time in
  `factory/harness/brief-size.ts` from the Spec Writer's structured `fileList` — every entry, a
  `DELETE` included — and carried on the call as `AgentInvocation.maxTurns`, which
  `createSdkInvoker` resolves as `config.maxTurns ?? call.maxTurns ?? cost.maxTurns`. The one
  computation site is the orchestrator's `timedInvoke`, the one call site of the invoker, so a
  transient retry re-invokes with the same cap and a resume computes the same number. Every other
  agent keeps its `AGENT_COST` value, 07b and 08 included: `40 + 2 × files` does not depend on
  `base`, so scaling them would erase the narrower budgets their jobs are given on purpose. No
  value in `AGENT_COST` changed — the table is read-only input to the computation. R5 is a third
  IMPORTANT criterion in the Stage 2 spec gate, `Brief Size Within Limits`: more than 12 acceptance
  criteria or more than 30 files records one finding suggesting a split, logged immediately above
  the CHECKPOINT 2 prompt and shown again in CHECKPOINT 3's findings. Exactly 12 and exactly 30 do
  not warn, a count that cannot be read is 0 and passes, and nothing was added to what CHECKPOINT 2
  presents or hashes.
- **R-3 (next):** R6 the story gate counts structured and document ACs, R7 invisible characters
  block in the brief and file list, R10 a clear usage-limit message.

Interim, merged in PR #9: `maxTurns` raised for the builders, Test Verifier and Validator.

Run records: [docs/factory-runs/phase-r/](factory-runs/phase-r/).

### Phase C — traceability and test discipline

- **C1** acceptance-criterion IDs traced story → brief → tests → Validator, with a gate. With it:
  the A-2 backlog items MINOR-4 and MINOR-5 (the pre-supplied spec path) and the spec gate's
  existence-only check.
- **C2** acceptance tests written before the build, and locked.
- **C3** optional mutation testing on high-risk files.
- **C4** a risk tier and an Invariants section: contracts, auth and payments get human review plus
  Slither / Foundry invariants.
- **C5** moved to PR B-3.
- The A-2 test-style follow-ups.

### Phase D — the README loop diagram (done, PR #5)

The diagram of the Feature Factory loop at the top of the [README](../README.md), drawn from
SKILL.md.

### Phase E — distribution and polish for outside users

- An install script that links the skills **and** the agents (extends
  [scripts/link-skills.sh](../scripts/link-skills.sh)).
- The operator's persistent-memory server made optional for other users.
- CI that runs typecheck, tests and the doc-drift test, and tagged releases.
- An optional Claude Code plugin with a `/factory` command.
- Link `~/.claude/agents` and the skills to a stable copy (a clone on `main`, or a release tag),
  so unmerged work never reaches other projects (B_DECISIONS D-B2-4).
- The README restructure.

---

## 3. REFACTOR_PLAN phases, mapped

| REFACTOR_PLAN phase | Its status there | Where it lives now |
|---|---|---|
| 0a | Compile, test, CI: done | Done before Phase A |
| 0b | Real agent dispatch and real gate evidence: done | Done before Phase A |
| 0c | Reorganisation and honest docs: done | Done before Phase A |
| 1 | The `preSuppliedSpec` seam: done | Done before Phase A |
| 1.5 | Prove Stages 2–5 live: next | Partly done: PR A-2's live smoke ran the Validator. A full live run through CHECKPOINT 3 is not yet scheduled |
| 2 | Tier 1, Decomposer first: not started | Not scheduled in A–E |
| 3 | Memory and parallelism: not started | Not scheduled in A–E. Its "parallel features via git worktrees" is superseded: the factory never uses a git worktree (B_DECISIONS D-5) |

---

## 4. Accepted risks

- **A-2 MINOR-3, git filter drivers.** Accepted risk (found in the PR A-2 validation). Building the CHECKPOINT 3 change (`git diff`)
  and a snapshot (`git add`) runs the `clean` filter that a repository's `filter=<driver>`
  attribute selects (git-lfs is the common case): the operator's own filters, which any `git diff`
  in that repository already runs. Git has no option that disables them for these commands
  without dropping every other attribute. Revisit trigger: minimum supported git ≥ 2.42 (`--attr-source`).

---

## 5. Backlog

- **Cleanup of `refs/factory/*` snapshot refs.** Every passing Stage 3 gate adds a snapshot under
  `refs/factory/<id>/`, and nothing deletes them yet, so they accumulate. A snapshot holds every
  non-ignored file, so one may hold a stray `.env` that is not in `.gitignore`. Not in PR B-1.
- **Cleanup of review copies.** Every verification evaluation makes a read-only review copy
  `factory-review-<id>-e<e>-XXXXXX` in the OS temp directory, and the harness never deletes one
  (PR B-2), so they accumulate until the OS cleans its temp directory. Clean them up together with
  the `refs/factory/` snapshot refs.
