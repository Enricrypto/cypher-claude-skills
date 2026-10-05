# Roadmap

> The plan of record, from the operator's decisions of 2026-10-05
> ([B_DECISIONS.md](factory-runs/phase-b/B_DECISIONS.md)). It supersedes the phase numbering of
> [REFACTOR_PLAN.md](REFACTOR_PLAN.md), which is kept for its history; section 3 maps its phases
> onto this plan. What the Feature Factory does today is in
> [factory/feature/SKILL.md](../factory/feature/SKILL.md); this file says what comes next.

---

## 1. Plan of record

The work is organised in five phases, A to E. Phase A and Phase D are done. Phase B is in
progress. The order from here is **B → C → E**: each phase ships as one or more PRs, and each PR
is merged before the next one starts.

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
  leaves no record, so a resume re-takes the rework snapshot `stage3-<k>` with the Test
  Verifier's partial writes, and B1's Validator copy is extracted from that ref. B-2's story must
  carry an AC that closes this: record a "verification started" marker before invoking the Test
  Verifier (preferred), or treat a recorded rework entry as final. Source:
  [B_DECISIONS.md](factory-runs/phase-b/B_DECISIONS.md).
- **B-3:** C5, GAP-3, GAP-5 and B4.

Run records: [docs/factory-runs/phase-b/](factory-runs/phase-b/).

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
