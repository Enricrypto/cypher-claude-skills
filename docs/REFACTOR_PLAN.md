# Software Factory — Refactoring Plan

> Phased plan to turn Feature Factory from a well-specified design into a running,
> deterministic execution engine, and then to grow it into a two-tier Software Factory.
> Written 2026-07-12.

---

## Premise *(the starting diagnosis — RESOLVED in Phases 0a/0b; kept for the record)*

> **This section describes the state of the repo on 2026-07-12, before any of this work.**
> It is no longer true: the harness compiles, is tested in CI, and agents run for real. It is
> preserved because it explains why the plan is shaped the way it is. For current status, see
> the Status table below.

The Feature Factory harness was a **well-specified design that had never executed.**
Three independent facts established this:

1. **Every agent call is a mock.** `factory/feature/workflows/feature-factory-orchestrator.ts:713`
   — `invokeAgent()` carries the comment `// In real implementation, would use Agent tool`
   and returns a hardcoded `status: 'PASS'`. The orchestrator never invokes an agent, so
   every gate it evaluates is validating a fake pass.
2. **The TypeScript has never compiled.** No `tsconfig.json`, no `typescript` dependency,
   no build script. 3,945 lines of harness, never typechecked.
3. **The test suite has never run.** 1,530 lines importing `@jest/globals`, but jest is not
   a dependency and `package.json` has exactly one script (`postinstall`). No CI.

**Consequence:** what actually runs today is Claude reading `SKILL.md` and the agent markdown
files as prose — i.e. **soft gates**, the exact weakness we diagnosed in gstack. The
deterministic moat exists only in `stage-gates.ts`, which nothing calls.

Nothing downstream (Tier 1, memory, parallelism) is safe to build until this is fixed.
Tier 1's entire value depends on the Decomposer's output being *hard-validated* by FF's
gates. If the gates don't run, Tier 1 is just three more prose agents.

### Runtime contradiction (resolved in Phase 0b)

The orchestrator is stuck between two incompatible runtimes. It opens with
`export const meta = { name, description, phases }` — the Claude Code **Workflow tool's**
script format, where `log()`/`phase()`/`agent()` are provided globals. But it is authored as
a **TypeScript module** with `import` statements and interfaces. Workflow scripts must be
plain JavaScript with no imports. So as written it runs as neither.

**Decision: it becomes a Node module** invoked via the Claude Agent SDK. Gates run as real
code, tests run in CI, the orchestrator is resumable and typecheckable.

---

## The invariant

> **Feature Factory must remain runnable standalone on a brownfield project, with no Tier 1
> artifacts, at every single commit.**

If any phase breaks that, the phase is wrong. This is non-negotiable: the ability to run FF
on an existing project without the product/architecture tier is the primary use case, and
Tier 1 is strictly an optional upstream producer.

---

## The key insight: the spec contract already exists

The original handoff doc called the spec contract "the keystone — build this FIRST," and
proposed authoring a new Markdown template + JSON schema. **Don't.**

`ResearcherOutput`, `StoryWriterOutput`, and `SpecWriterOutput` in
`factory/harness/agent-output-schema.ts` **are** the spec contract, already written.
`StoryWriterOutput` already carries:

```ts
acceptanceCriteria: Array<{
  id: string;          // AC-001
  given: string;
  when: string;
  then: string;
  priority: 'MUST' | 'SHOULD' | 'COULD';
  testable: boolean;
}>
```

— the exact Given/When/Then structure Tier 1 needs to emit. And `canAdvanceStage(2, ...)`
already hard-validates it via the `ac_testable` CRITICAL criterion.

So the Decomposer's job is **not** "produce a new artifact FF must learn to read." It is
**"produce the same object FF's own stage 2 already produces."**

That reframe is what makes Tier 1 optional for free:

```ts
interface OrchestrationOptions {
  featureName: string;
  featureDescription: string;
  resumeFromState?: FeatureState;
  preSuppliedSpec?: {              // <- the ONLY new field. Optional.
    researcher?: ResearcherOutput;
    story?: StoryWriterOutput;
    spec?: SpecWriterOutput;
    dependsOn?: string[];
  };
}
```

Stages 1 and 2 become **satisfy-or-run**:

```
if (preSuppliedSpec) {
  const decision = await canAdvanceStage(2, contract, ctxFromSupplied);
  if (decision.canAdvance) -> jump to Stage 3
  else                     -> ESCALATE (the Decomposer produced garbage;
                              do NOT silently re-run stage 2)
} else {
  run 01-researcher -> 02-story-writer -> 03-spec-writer   // today's path, unchanged
}
```

Three properties fall out:

- **FF stays standalone.** No `preSuppliedSpec` means the identical code path as today.
  Purely additive; no regression surface.
- **The gate IS the contract.** The same `canAdvanceStage` validates both FF's own
  story-writer and the Decomposer's output. They cannot drift, because there is only one
  validator.
- **Tier 1 is swappable.** gstack, a human writing YAML, or a future planner can produce
  that object. FF neither knows nor cares who wrote it — only whether the gate passed.

**One rule to hold: data flows one way.** Tier 1 emits N spec objects + a dependency graph.
It never writes to FF's state and never calls FF's internals. FF reads the specs like a work
queue. Break that and you get the two-state-system impedance mismatch we refused to import
from gstack.

---

## Known repo problems (audit 2026-07-12) — ✅ ALL RESOLVED in Phase 0c

- **Broken symlink loop:** `skills/feature-factory/feature-factory` ->
  `/Users/.../skills/feature-factory` — points at its own parent. `install.js` walks
  `skills/` with a recursive `copyDir` calling `copyFileSync` on symlink entries, so the
  installer crashes (EISDIR) or recurses on this path. Dead only because the npm install
  path is no longer used.
- **~~Forked harness~~ — THIS FINDING WAS WRONG (corrected in Phase 1).**
  `factory/harness/error-categories.ts` and `factory/e2e/harness/error-categories.ts` export the
  identical six symbols, which is what the original grep matched on. But they are **not** a fork:
  they are two domain-specific taxonomies. The first categorises **compile and test** failures
  (`TYPE_ERROR`, `IMPORT_ERROR`, `SYNTAX_ERROR`, `MIGRATION_ERROR`, `SCHEMA_MISMATCH`,
  `MISSING_IMPLEMENTATION`); the second categorises **browser and infrastructure** failures
  (`ENVIRONMENT_ISSUE`, `SETUP_FAILURE`). Only 7 patterns genuinely overlap.
  **They must NOT be merged.** `analyzeError()` is first-match-wins, so flattening both tables
  into one would let a pattern from one domain shadow a specific pattern from the other — which
  is exactly BUG-3, already fixed once. Both files now carry a comment saying so.
- **Not actually duplicated (verified):** `agents/` -> `feature-factory/agents` and
  `skills/e2e-pipeline` -> `../factory/e2e/skills/e2e-pipeline` are **symlinks**, not copies.
  No content drift. These are fine; only the self-referential one is broken.
- **Dead npm channel:** `@cypher-digital/claude-skills` will not be published. The local repo
  is the single source of truth; the local system should always read the latest from it.
- **Stale docs:** six root planning docs (~3,200 lines) are historical.
- **README is 1,612 lines** and self-contradictory: it claims "Feature Factory v2.0:
  PRODUCTION READY" while also calling the Feature Loop "the successor to the Feature
  Factory" — two names for one system. It also carries unverifiable performance claims
  ("92% faster", "$0.08/feature").
- **Empty dir:** root `workflows/`.

**Resolution (0c):** the self-referential symlink is deleted; `install.js`/`cli.js` are deleted
and replaced by `scripts/link-skills.sh` (symlinks — cannot drift); the six stale root docs are
in `docs/archive/`; the README is rewritten (1,612 -> ~950 lines) with the invented metrics and
the "PRODUCTION READY" banner removed; the empty `workflows/` and the now-broken root `agents/`
symlink are gone. Root is `CLAUDE.md` + `README.md`.

**Resolved in Phase 1:** the "forked `error-categories.ts`" turned out not to be a fork at all —
see the corrected finding above. No merge was performed, and both files now document why.

---

## Status

| Phase | State |
|---|---|
| **0a** — compile, test, CI | ✅ done (`72eed7f`) |
| **0b** — real agent dispatch + real gate evidence | ✅ done (`e0f0ce8`, `ce1c548`), verified live |
| **0c** — reorg + honest docs | ✅ done (`7d0662e`, `7a300bd`, + this) |
| **1** — the `preSuppliedSpec` seam | ✅ done |
| **1.5** — prove stages 2–5 live (NEW — see below) | ⬜ next |
| **2** — Tier 1 (Decomposer first) | ⬜ |
| **3** — memory + parallelism | ⬜ |

**Verified live (2026-07-13):** one read-only Researcher against a realistic Express+Postgres
scratch repo. Schema valid, 7 files identified, 6 patterns, 8 risks, `RESEARCHER_REPORT.md`
persisted by the harness, **gate: ADVANCE at 100%**, zero tool denials.

**Measured cost:** ~15 turns, 2–4 min, $0.45–$0.75 reported per read-only agent on an 8-file
repo. The old README's "1 minute, $0.08 by feature #10" was fiction and has been deleted.

---

## Known harness bugs (found by Phase 0b's first LIVE run)

The smoke test found four defects that **no offline test could have** — they only appear when a
real model meets a real schema. All fixed in `ce1c548`.

### BUG-5 — The output schema was too loose *(FIXED)*

The SDK's `outputFormat` only required `summary` + `artifacts` and left `details` open. So the
Researcher did excellent analysis and put **all of it in `details.summary` as prose**, returning
`filesIdentified: []`. The gate then failed the stage for "0 files identified" — on evidence the
agent had genuinely gathered.

**Lesson worth keeping: an agent fills the shape you give it.** A field that isn't required by
the schema ends up in the summary. `runner/output-schemas.ts` now generates the full per-agent
JSON Schema with every gate-relevant field required, and the SDK retries the model until it
conforms. Result: `filesIdentified` 0 → 7, `patternsFound` 0 → 6, `risks` 0 → 8; stage 1 went
from 0% to 100%.

### BUG-6 — Read-only agents could not produce their documents *(FIXED)*

The Researcher is granted `Read/Grep/Glob` and **no `Write`** — by design. But
`validateResearcherReport` requires `RESEARCHER_REPORT.md` to exist on disk with readable
content. It physically could not create it, so **stage 1 was unpassable.**

`ArtifactRef` gained an optional `content`; `persistArtifacts()` writes it. Read-only agents
return the document text and the **harness** writes it — they stay read-only.

**Builders are deliberately excluded** (`HARNESS_PERSISTED_AGENTS`). They must write their own
code files. If the harness wrote a builder's files for it, the artifact-materialization gate
would be verifying the harness's own work and the anti-hallucination guarantee would be worth
nothing.

### BUG-7 — A self-reported ESCALATE was ignored *(FIXED)*

Agents return `status: PASS | FAIL | LOOP_BACK | ESCALATE`, but the orchestrator only checked
the schema and the gate. On the live run the Researcher correctly returned `ESCALATE` — it had
found that the feature could not be built safely — and the orchestrator would have carried on.
The agents are the ones reading the code; when one declares a blocker, that is a finding.
`agentDeclaredBlocked()` now stops the run and surfaces its reasoning.

### BUG-8 — `validateOutputSchema` switched on STAGE, not AGENT *(FIXED)*

Stages 2, 3 and 4 are each shared by two agents with entirely different output shapes, so the
stage-keyed checks were applied to the wrong agent:

- **Stage 2** demanded `userStory` + 3 acceptance criteria from the **Spec Writer**, which has
  `dataModel`/`apiContract`/`fileList` and no `userStory`. It could never pass.
- **Stage 4** demanded **both** `acceptanceTests` (Test Verifier) **and** `codeQuality`
  (Validator). Neither agent has both, so stage 4 was unpassable by either.

**The pipeline could never have got past the Spec Writer.** Now keyed on agent.

### The design property this validated

On the successful run the **gate said ADVANCE (100%)** while the **agent said ESCALATE** — and
both were correct. The gate judged *"is this research complete?"*; the agent judged *"can this
be built safely?"* and found that `requireAuth` only checked the `Authorization` header was
*present*, making an email change (the password-reset anchor) an account-takeover vector.

**The harness enforces process; the agent contributes judgment; neither overrides the other.**

---

## Known harness bugs (found by Phase 0a)

Running the test suite for the first time surfaced four real bugs in the harness — not test
bugs. Three are fixed; one is deferred with its test skipped rather than papered over.

### BUG-1 — The anti-hallucination gate is blind *(OPEN — fix in Phase 0b)*

There are **two** artifact-materialization checkers, and the gate uses the fake one:

- `verifyArtifactMaterialization()` (`agent-output-schema.ts:716`) — **real**. Dynamically
  imports `fs` and calls `existsSync`/`statSync`/`readFileSync`.
- `validateArtifactsMaterialized()` (`stage-gates.ts:630`) — **the actual CRITICAL gate**, and a
  stub. It reads `ctx.metadata.fileExistsCheck?.[filePath] ?? false` — a caller-supplied map —
  under the comment *"In real implementation, this would use fs.existsSync"*. It never touches
  the disk, and never calls the real function that already exists.

**Impact:** the gate designed to catch agents claiming files they never wrote does not look at
the filesystem. Nothing populates `fileExistsCheck`, so it defaults to `false`, the CRITICAL
criterion can never pass, and **stage 3 can never advance.**

**Fix (Phase 0b):** have the gate delegate to `verifyArtifactMaterialization()`. Then unskip
`stage-gates.test.ts › canAdvanceStage - Stage 3 › should PASS when all files modified and
tests 100%`. Do **not** unskip it by adding a fake `fileExistsCheck` to the fixture.

### BUG-2 — Confidence score was a lie *(FIXED)*

`analyzeError()` hardcoded `confidence: 0.9` for **any** regex match, including the catch-all
`/error|failed|failure/i → UNKNOWN` pattern. Since nearly every error message contains the word
"error", uncategorisable errors were being reported as UNKNOWN **with 0.9 confidence**, and the
honest `confidence: 0` return at the bottom of the function was unreachable dead code.
Downstream code selects a fix class from this score. Now: an `UNKNOWN` category reports
confidence `0`.

### BUG-3 — Specific patterns shadowed by a generic one *(FIXED)*

`analyzeError()` is first-match-wins, but the generic `MISSING_IMPLEMENTATION` pattern
(`/does not exist|.../`) sat **above** the database patterns. So `"column X does not exist"`
matched `MISSING_IMPLEMENTATION` (fix: `IMPLEMENT`) instead of `MIGRATION_ERROR`
(fix: `CREATE_MIGRATION`) — the wrong fix class for the wrong root cause, which is precisely the
failure mode the deterministic error table exists to prevent. Database patterns now precede the
generic one, with a comment stating the ordering constraint.

### BUG-4 — `TYPE_ERROR` coverage gap *(FIXED)*

The regex missed the common phrasing `"Type mismatch: ..."`, so type errors fell through to
`UNKNOWN → MANUAL_REVIEW`. Added to the pattern.

### Gap (not a bug, worth noting)

`ResearcherOutput` carries an `architecture` field, but **no stage-1 criterion validates it**.
The stage-1 contract checks: researcher report exists, files identified, patterns found, risks
flagged. A test asserted a non-existent `Architecture Mapped` criterion — it had been passing
for the wrong reason. Consider whether architecture mapping should be a gated criterion.

---

## Phase 0a — Make it compile and test *(no behavior change)* — ✅ DONE

The smallest change that turns 3,945 lines of never-compiled TypeScript into a harness with
a green CI badge.

- [ ] Add `tsconfig.json` (strict), `jest.config.js`.
- [ ] Add devDependencies: `typescript`, `jest`, `ts-jest`, `@types/node`, `@types/jest`.
- [ ] Add scripts: `typecheck`, `test`, `build`.
- [ ] Add `.github/workflows/ci.yml` — typecheck + test on push.
- [ ] Set `"private": true` (the npm channel is dead — stop pretending).
- [ ] **Remove the `postinstall: node install.js` hook** — it walks `skills/` into the
      self-referential symlink and would crash on `npm install`. (`install.js` is deleted
      in 0c anyway.)
- [ ] **Fix whatever `tsc --noEmit` finds.** This is the unknown. Six harness files have
      never seen a compiler.

**Exit criteria:** `npm run typecheck` and `npm test` both pass, locally and in CI. The
existing tests go green, or are honestly marked `.skip` with a stated reason.

**RESULT (2026-07-12): met.** `npm run typecheck` — **0 errors**. `npm test` — **116 passing,
1 skipped** (BUG-1, above), 5/5 suites green.

**Headline finding: the harness code is sound.** All 3,945 lines compile clean under `strict`.
`stage-gates.ts` — 658 lines, the file the entire deterministic thesis rests on — needed **zero**
changes. It had simply never been pointed at a compiler. The validators are real implementations,
not stubs (with the single exception of BUG-1).

The 214 initial `tsc` errors were concentrated in exactly the places already known to be broken:
130 in the e2e Workflow script (undefined Workflow globals — `log` x74, `args` x21, `agent` x7,
`phase` x5 — plus top-level await), 22 in the orchestrator that Phase 0b rewrites anyway, 46 in
stale tests, 60 from an over-strict `noUncheckedIndexedAccess` flag that was subsequently dropped,
and **0 in the harness proper**.

**Risk:** low. Purely additive; no source changes except compiler-forced fixes and the three
error-categoriser bug fixes (BUG-2/3/4).

**Why it's first:** this is where we learn how sound the harness actually is. Everything
downstream is sized by what it reveals.

---

## Phase 0b — Make the agents real — ✅ DONE

- [ ] Delete the mock `invokeAgent()` (orchestrator:713) and the local `log()`/`phase()` stubs.
- [ ] New `runner/invoke-agent.ts`: dispatch to a real agent via the Claude Agent SDK, load
      the agent's `.md` as its system prompt, force structured output against the stage's
      schema, return the validated object.
- [ ] New `runner/cli.ts` -> `npm run factory -- --feature "<description>"`.
- [ ] Drop `export const meta`; `log`/`phase` become real logger calls. It is a Node module.

**RESULT (2026-07-13): met, and it found more than expected.**

Replacing the mock turned out to be only half the problem. `checkStageGate()` was FABRICATING
the context the gates judge — `testPassRate` hardcoded to `1.0` (so the stage-3 CRITICAL "unit
tests pass" gate was unfailable), `criticalIssuesCount` hardcoded to `0`, and `artifacts`
assigned an ARRAY where the gates do `ctx.artifacts['USER_STORY.md']`. Of the **23 fields the
gates read, the orchestrator supplied 3, all invented.** Fixing the mocked agent alone would not
have made a single gate real. `harness/stage-context.ts` now derives every one of them from
agent output and the filesystem.

Regression detection was also dead: the baseline read `testing.totalTests`, a field that does
not exist on the type, so the baseline was `{0, 0}` and the check compared
`after.passingTests < 0` — never true.

**The moat is tested offline** (`test/harness/stage-context.test.ts`): a story-writer output that
is schema-valid and self-reports PASS — three criteria, each `testable: true` — is still BLOCKED
when the `USER_STORY.md` it actually wrote has no Given/When/Then. No model, no network, no
tokens: the model PRODUCES output, the gate JUDGES it, and judging is testable by handing the
gate known-bad output directly. That keeps CI honest without drawing down the subscription.

**Auth:** agents run on the **Claude subscription**, not a metered API key. The Agent SDK's
bundled binary is Claude Code, already logged in (`authMethod: claude.ai`, `subscriptionType:
max`). Not the documented SDK auth path, so it could change; CI would still need an API key.

**Risk:** medium. This was the real work of Phase 0.

---

## Phase 0c — Reorganize + tell the truth

Target structure:

```
factory/
├── harness/     <- shared: gates, schemas, state, errors  (ONE copy)
├── contracts/   <- the Tier1<->Tier2 seam
├── runner/      <- Agent SDK dispatch + CLI
├── feature/     <- Tier 2 (was feature-factory/)
└── e2e/         <- Tier 3 (was factory/e2e/)
skills/          <- single source of truth for standalone skills
docs/archive/    <- the six stale root planning docs
scripts/link-skills.sh   <- symlinks repo -> ~/.claude/skills/
```

- [ ] Kill the self-referential symlink.
- [ ] Delete the empty root `workflows/`.
- [ ] Delete `install.js` / `cli.js` (dead npm path); replace with `link-skills.sh` —
      symlinks, so local Claude Code always reads the latest with zero copying or drift.
- [ ] Archive: `DELIVERY_SUMMARY.md`, `IMPLEMENTATION_ROADMAP.md`, `FEATURE_FACTORY_GAPS.md`,
      `FEATURE_FACTORY_HARNESS_IMPLEMENTATION_PLAN.md`,
      `FEATURE_FACTORY_IMPLEMENTATION_QUICK_REFERENCE.md`, `AUDIT_REMEDIATION_README.md`.
- [ ] **Rewrite the README**: 1,612 -> ~150 lines. Remove the "PRODUCTION READY" claim, the
      unverifiable performance numbers, and the Feature Loop / Feature Factory naming split.
      Three entrypoints, honest status, links.

**Open decision:** the `feature-factory/` -> `factory/feature/` rename. Recommended (do the
churn once), but deferred — `tsconfig` is written glob-based so this can be decided here
without rework.

---

## Phase 1 — The seam *(FF becomes Tier-1-ready; Tier 1 does not exist yet)*

- [ ] `factory/contracts/feature-spec.ts` — re-export `ResearcherOutput` +
      `StoryWriterOutput` + `SpecWriterOutput` as the spec contract, plus a
      `DependencyGraph` type. **No new schema is authored.** The contract already exists;
      this file only names it.
- [ ] Add optional `preSuppliedSpec` to `OrchestrationOptions`; make stages 1–2
      **satisfy-or-run** (validate through the *same* `canAdvanceStage`; advance if it
      passes, **escalate if it does not** — never silently fall back to running stage 2).
- [x] ~~Merge the forked `error-categories.ts`~~ — investigated and NOT merged. They are two domain-specific taxonomies, not a fork. See the corrected audit finding above.

**Exit criteria:** three integration tests — (1) no `preSuppliedSpec` -> identical behavior
to Phase 0b; (2) a hand-written spec fixture -> skips to stage 3; (3) a deliberately
malformed fixture -> escalates.

**Risk:** low. Highest-leverage phase in the plan.

---

## Phase 2 — Tier 1, Decomposer first

Build order is **deliberately inverted** from the original handoff doc:

1. **Decomposer** — the only component that must speak both languages (architecture <->
   gate criteria). It is the entire risk of the two-tier thesis. Prove it against the
   Phase 1 seam using a **hand-written TRD**, before any other Tier 1 agent exists. If a
   Decomposer cannot emit specs that pass `canAdvanceStage(2)`, we need to know that in
   week one, not week six.
2. **Architect** — owns the TRD (synthesis; one author, one artifact). `--scaffold` mode
   emits the greenfield project skeleton so the Researcher has something to map.
3. **Strategist** — pure prompt content (gstack's 6 forcing questions + 4 CEO modes).
   Lowest risk, so last.

**Ownership rules (keep strict):** the Architect *writes* the TRD; the Decomposer *reads the
finished TRD and slices it* and never creates it; Feature Factory *implements* each spec.
Keeping Architect and Decomposer separate means that when a feature spec is wrong, you know
whether the architecture was flawed or the slicing was. Fusing them makes every failure
ambiguous.

**Anti-scope-creep:** ~3 new agents, not gstack's 34. Do not adopt gstack plumbing
(gbrain/config/telemetry) — ideas only, ported as prompt content.

---

## Phase 3 — Memory and parallelism

- [ ] Grow the feature-consolidator into cross-product memory: **patterns** (level 2) and a
      **decision log** (level 3).
- [ ] Wire Architect + Decomposer to *query* that memory so product #2 reuses product #1's
      patterns. **Advisory only — gates stay code.**
- [ ] Run independent features' FF loops in **parallel** via git worktrees (features with no
      dependency edge between them).

**Design principle, held throughout:** *structure is hard, knowledge is advisory.* Structure
(stages, gates, agent contracts, build order) is deterministic code and acts the same for
every product. Knowledge (patterns, decisions) is memory the agents consult. gstack fuses
these and gets "soft everything." Keeping them split is what preserves reproducibility while
still letting product #5 be faster than product #1.

---

## Positioning note

The **builder is the harder, more valuable half.** Planning/strategy layers are commodity
now. Deterministic execution with hard gates, error categorization, regression detection,
and resumability is rare. Position the Software Factory as **the deterministic execution
engine that a (swappable) strategy layer feeds into** — not as "a smaller gstack." The spec
contract is what keeps the strategy layer pluggable.
