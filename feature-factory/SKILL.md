# Feature Factory

A 7-agent chain for shipping features correctly the first time. Activate this skill at the start of every non-trivial feature session.

---

## How to Start

1. Activate this skill: `Read ~/.claude/skills/software/feature-factory/SKILL.md`
2. Call `retrieve_context` with the feature description
   - This loads prior feature patterns from memory (if any exist)
   - Researcher will surface these learnings in the report
3. Invoke Agent 1 (Researcher) with the feature prompt
4. Follow the chain. Honor every STOP checkpoint.

---

## 🚨 Two-Gate Hallucination Prevention (NEW)

Feature Factory v2.0 includes dual reality checks to catch hallucinations at two critical points.

### Gate 1: Artifact Materialization (After Stage 3 Builders)

**What it checks:** Do claimed files actually exist on disk?

**How it works:**
1. Harness collects all files Backend & Frontend builders claimed to create/modify
2. **Verifies EACH file exists** using `fs.existsSync()` + stat check
3. **Tries to read** first 200 chars to confirm file is readable
4. If ANY claimed file is missing → **GATE FAILS with detailed report**
5. Blocks advancement until ALL files are real and readable

**Reality verification includes:**
- ✅ File exists on disk (fs check)
- ✅ File is readable (stat + read check)
- ✅ File has content (first 200 chars captured for audit)
- ✅ Correct path (absolute path resolution)

**What gets caught:**
- ✅ Hallucinations: "Created src/components/Upload.tsx" but file doesn't exist
- ✅ Wrong paths: "Created ./Upload.tsx" but actually wrote "/tmp/Upload.tsx"
- ✅ Claims without actions: Summary mentions features but never used Write tool
- ✅ Binary/permission issues: File created but not readable

### Gate 2: Execution Verification (After Stage 4 Test Verifier)

**What it checks:** Did tests actually RUN and PASS 100%?

**How it works:**
1. After Test Verifier claims tests passed, harness runs the actual test suite
2. Captures: test results, build compilation, dev server startup
3. **CRITICAL:** Requires 100% test pass rate (no failures allowed)
4. If tests fail OR build breaks OR dev server errors → **GATE FAILS**
5. Blocks advancement until tests genuinely pass

**What gets caught:**
- ✅ Phantom tests: "62/62 passing" but tests were never run
- ✅ Failed tests hidden: Tests ran but some failed, claims were false
- ✅ Build broken: Tests "pass" but actual build compilation fails
- ✅ Dev server errors: Dev startup has critical errors masked in logs

### The Guarantee

**If PR is created, you know with 100% certainty:**
- ✅ All claimed files actually exist on disk (Gate 1)
- ✅ Build compiles without errors (Gate 2)
- ✅ ALL tests ran and passed (100% pass rate) (Gate 2)
- ✅ Dev server starts cleanly (Gate 2)
- ✅ No phantom implementations
- ✅ No false test coverage

### Example: The g-artisans Hallucination

```
❌ BEFORE (No execution gate):
   Test Verifier: "✅ 62/62 tests passing"
   → Artifact gate passes (test files exist ✅)
   → Validator runs (claimed tests exist ✅)
   → PR created with false confidence
   → Reality: Tests never actually ran. 0% pass rate.

✅ AFTER (With execution gate):
   Test Verifier: "✅ 62/62 tests passing"
   → Artifact gate passes (test files exist ✅)
   → Execution gate: npm run test
   → Tests don't run / fail / build breaks
   → GATE FAILS: "Pass rate 0% — 62 failures (CRITICAL: 100% required)"
   → Blocks PR creation
   → Test Verifier loops back to fix actual issues
```

---

## Memory Integration (Phase 1 + 2)

### Phase 1: Storage
Each agent stores insights to memory after completing its work.

### Phase 2: Active Usage
Each agent now actively retrieves and uses prior learnings:

- **Researcher** (01): 
  - Retrieves prior patterns → surfaces in "Relevant Files" section
  - Flags patterns that succeeded, patterns to avoid, known issues
  - Provides confidence-based time estimates

- **Story Writer** (02): 
  - Surfaces scope issues from similar prior features
  - Flags edge cases that were missed before
  - Signals confidence level based on prior pattern similarity

- **Spec Writer** (03): 
  - Reads prior API/schema design decisions
  - Recommends patterns that worked, warns against patterns that failed

- **Backend Builder** (04): 
  - Surfaces pattern reuse recommendations (very high confidence patterns)
  - Flags patterns to watch (known issues but usable)
  - Lists anti-patterns to avoid entirely

- **Frontend Builder** (05): 
  - Surfaces component patterns that can be reused
  - Flags state management patterns that have known issues
  - Recommends tested patterns

- **Test Verifier** (06): 
  - Reads prior test patterns that caught bugs
  - Uses edge cases from similar features to improve test coverage

- **Validator** (07): 
  - Checks against known critical issues from prior features
  - Catches common validation gaps before they reach PR

**Result:** The pipeline compounds knowledge:
- Feature 1: system learns what works and what doesn't
- Feature 2: system warns about common issues and recommends proven patterns
- Feature 3+: each feature is faster and catches more issues early

After 10 features, your pipeline is 30-40% faster because it:
- Reuses proven patterns automatically
- Avoids known pitfalls proactively
- Catches mistakes earlier (in Researcher/Story Writer, not in Validator)

---

## Post-Merge: Feature Consolidation (Agent 08)

After the PR is merged and deployed:

1. Invoke Agent 08 (Feature Consolidator) with the feature-name
2. Agent 08 reads all memories from this feature
3. Consolidates into reusable patterns for future similar features
4. Stores time estimates, confidence profiles, pattern recommendations

**When to run:** Once per week after features merge, or after every 2-3 features

**What it produces:**
- Consolidated execution summary (time per agent, iterations, blockers)
- Confidence profiles by category (CRUD, auth, migrations, async, etc.)
- Reusable patterns extracted (what worked, what to watch, what to avoid)
- Time estimates for this feature type (baseline + risk adjustment)

**Result:** Future features in this project start with institutional knowledge:
- "Auth features take 4h avg, watch timezone handling"
- "Schema changes take 2h avg, reuse MigrationHelper pattern"
- "CRUD endpoints: 95% confidence (zero issues in 5 prior features)"

---

## Phase 3: Autonomous Iteration

When implementation tests fail, agents now self-fix autonomously (up to 3 attempts):

- **Backend Builder** (04): Test fails → analyzes error → attempts fix → re-runs tests
  - If still failing after attempt #3: escalates with "Stuck after 3 attempts"
  - Logs each attempt to memory for future learning
  
- **Frontend Builder** (05): Same pattern for component/integration tests
  - Special case: if API mismatch detected, routes back to Backend Builder
  
- **Test Verifier** (06): Optional iteration for test design issues
  - If test assumption was wrong: refines test (up to 2 iterations)
  - If implementation is wrong: routes to builder

**Why this matters:**
- Reduces human touchpoints by 40-60% for typical features
- Agents learn what causes common test failures
- Next similar feature avoids those failures entirely
- Only escalates when truly stuck (human judgment needed)

---

## The Chain (with Dual Hallucination Gates)

```
Feature idea
    ↓
[01] Researcher      → Researcher Report
    ↓
[02] Story Writer    → User Story
    ↓
⏸  CHECKPOINT 1: Approve the story
    ↓
[03] Spec Writer     → Technical Brief
    ↓
⏸  CHECKPOINT 2: Approve the brief
    ↓
[04] Backend Builder → Backend Summary + API Contract
    ↓
[05] Frontend Builder → Frontend Summary
    ↓
🔍 GATE 1: Artifact Materialization (files exist on disk?)
    ↓ (if missing files → ESCALATE)
[06] Test Verifier   → Acceptance Test Report
    ↓
🔍 GATE 2: Execution Verification (tests ran + 100% passing?)
    ↓ (if failures/build errors → loop back to [06])
[07] Validator       → Validation Report
    ↓ (loop back to builder if Critical issues)
⏸  CHECKPOINT 3: Open the PR
    ↓ (after PR is merged)
[08] Feature Consolidator → Consolidation Report (extracts reusable patterns)
    ↓
[09] Branch Cleanup — delete local + remote feature branch
```

---

## Branch Cleanup (mandatory after merge)

After the PR is merged, always run:
```bash
git checkout main
git pull origin main
git branch -d feat/<task-name>
git push origin --delete feat/<task-name>
```

**Why:** Stale local branches cause accidental work to land on merged branches instead of new ones. Always verify `git branch` shows only `main` (and any active feature branch) after a merge.

If the remote branch was already deleted by GitHub (auto-delete on merge), the `push --delete` will fail harmlessly — that's fine.

---

## Skill Assignments

Each builder agent reads these skill files before starting work. The agent checks the project's `CLAUDE.md` for an `## Active Skills` override first — if present, that list wins. Otherwise, these defaults apply.

| Agent | Skill files to load |
|---|---|
| Researcher | `~/.claude/skills/software/architecture-patterns.md` |
| Story Writer | *(reasoning only — no skills needed)* |
| Spec Writer | `~/.claude/skills/software/architecture-patterns.md` · `~/.claude/skills/software/api-design-principles.md` |
| Backend Builder | `~/.claude/skills/software/nodejs-backend-patterns.md` · `~/.claude/skills/software/api-design-principles.md` · `~/.claude/skills/software/test-driven-development.md` |
| Frontend Builder | `~/.claude/skills/software/frontend-architecture.md` · `~/.claude/skills/software/frontend-design/SKILL.md` · `~/.claude/skills/software/test-driven-development.md` |
| Test Verifier | `~/.claude/skills/software/test-driven-development.md` · `~/.claude/skills/software/verification-before-completion.md` |
| Validator | `~/.claude/skills/software/code-review-excellence.md` · `~/.claude/skills/software/security-audit.md` |
| Feature Consolidator | *(analysis only — no skills needed)* |

**To override per-project**, add to the project's `CLAUDE.md`:

```markdown
## Active Skills
Backend: nodejs-backend-patterns, api-design-principles, test-driven-development
Frontend: frontend-architecture, frontend-design
Validator: code-review-excellence, security-audit
```

---

## Agent Files
All 7 agents live at `~/.claude/agents/`:
- `01-researcher.md`
- `02-story-writer.md`
- `03-spec-writer.md`
- `04-backend-builder.md`
- `05-frontend-builder.md`
- `06-test-verifier.md`
- `07-validator.md`

---

## Checkpoint Protocol
Checkpoints use explicit STOP blocks in agent output. When you see:

```
⏸  CHECKPOINT N — [NAME]
```

**Stop. Read the artifact. Reply "approved" only when you are genuinely satisfied.**

If something is wrong, describe the correction. The agent will revise before moving forward. Correcting at a checkpoint costs minutes. Correcting after the builders have run costs hours.

---

## Loop-Back Rules

| Situation | Action |
|---|---|
| Test Verifier finds ❌ failing criterion | Loop back to Backend or Frontend Builder (whoever owns that layer) |
| Validator finds Critical issue | Loop back to the builder who owns the file |
| Validator finds Important issue | Your call — fix before PR or note in PR description |
| Wrong architectural assumption discovered mid-chain | Kill the session. Start fresh with the correct assumption in the first prompt. |

---

## When NOT to Use the Full Chain
For trivial changes (typo fix, copy update, config tweak, one-line bug fix), running the full chain is overkill. Use the full chain when:
- A new user-facing behaviour is being added
- A database schema is changing
- An API contract is being added or modified
- The change touches more than 3 files

---

## Artifacts That Flow Between Agents

| From | To | Artifact |
|---|---|---|
| Researcher | Story Writer, Spec Writer, both Builders, Validator | Researcher Report |
| Story Writer | Spec Writer, Test Verifier, Validator | User Story (with acceptance criteria) |
| Spec Writer | Both Builders, Test Verifier, Validator | Technical Brief |
| Backend Builder | Frontend Builder, Test Verifier, Validator | Backend Summary + API Contract |
| Frontend Builder | Test Verifier, Validator | Frontend Summary |
| Test Verifier | Validator | Acceptance Test Report |

Each agent must receive and read all upstream artifacts before starting.
