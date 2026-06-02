# Feature Factory

A 7-agent chain for shipping features correctly the first time. Activate this skill at the start of every non-trivial feature session.

---

## How to Start

1. Activate this skill: `Read .claude/skills/feature-factory/SKILL.md`
2. Call `retrieve_context` with the feature description (if MemoryKit is configured)
3. Invoke Agent 1 (Researcher) with the feature prompt
4. Follow the chain. Honor every STOP checkpoint.

---

## The Chain

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
[06] Test Verifier   → Acceptance Test Report
    ↓ (loop back to builder if ❌ failures)
[07] Validator       → Validation Report
    ↓ (loop back to builder if Critical issues)
⏸  CHECKPOINT 3: Open the PR
    ↓ (after PR is merged)
[08] Branch Cleanup — delete local + remote feature branch
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
| Researcher | `.claude/skills/architecture-patterns.md` |
| Story Writer | *(reasoning only — no skills needed)* |
| Spec Writer | `.claude/skills/architecture-patterns.md` · `.claude/skills/api-design-principles.md` |
| Backend Builder | `.claude/skills/nodejs-backend-patterns.md` · `.claude/skills/api-design-principles.md` · `.claude/skills/test-driven-development.md` |
| Frontend Builder | `.claude/skills/frontend-architecture.md` · `.claude/skills/frontend-design/SKILL.md` · `.claude/skills/test-driven-development.md` |
| Test Verifier | `.claude/skills/test-driven-development.md` · `.claude/skills/verification-before-completion.md` |
| Validator | `.claude/skills/code-review-excellence.md` · `.claude/skills/security-audit.md` |

**To override per-project**, add to the project's `CLAUDE.md`:

```markdown
## Active Skills
Backend: nodejs-backend-patterns, api-design-principles, test-driven-development
Frontend: frontend-architecture, frontend-design
Validator: code-review-excellence, security-audit
```

---

## Agent Files
All 7 agents live at `.claude/agents/`:
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
