# Loop Engineering Framework

**For:** cypher-claude-skills (Feature Factory 2.0)  
**Audience:** Team leads, AI engineers, architects  
**Purpose:** Understand loop engineering principles and how your Feature Factory maps to them

---

## Part 1: What is Loop Engineering?

### The Shift: Prompting → Looping

For 2 years (2024-2025), AI engineering looked like this:

```
You → Prompt → Agent → Output → You Review → You Fix → Repeat
```

You are the loop.

In 2026, the best teams do this instead:

```
You set Goal → Loop Runs → Agent Discovers → Plans → Executes → Verifies → Iterates → Done
```

The loop is the loop.

**The Difference:**
- **Prompting:** "Give me the output" (one-shot)
- **Looping:** "Achieve this goal" (repeating until done)

A prompt gives instructions. A loop gives a job and checks the work.

### Why This Matters

1. **Reduction of human touchpoints:** From 5-10 interventions per feature → 2-3 (checkpoints only)
2. **Self-correcting work:** Loop fixes its own mistakes, learns from them
3. **Token efficiency:** Cheaper models (DeepSeek) can run longer loops due to larger context windows
4. **Institutional knowledge:** Loop compounds (feature 10 is 30-40% faster than feature 1)

---

## Part 2: The 5 Loop Stages

Every loop, regardless of complexity, moves through these 5 stages:

### 1. DISCOVER
**Question:** What needs to be done?

**Who:** Researcher (single-agent) or multiple Specialists in parallel (fleet)

**Actions:**
- Read codebase + requirements
- Surface prior patterns from MemoryKit
- Map existing features + risks
- Identify unknowns
- Flag assumptions that need validation

**Verification:** Does the researcher understand the full scope?

**Loop Stop Condition:** If critical unknowns → ask for clarification before moving to PLAN

---

### 2. PLAN
**Question:** How should we do it?

**Who:** Story Writer (acceptance criteria) + Spec Writer (technical design)

**Actions:**
- Break requirement into acceptance criteria
- Design technical approach
- Identify dependencies
- Estimate effort
- Define success metrics

**Verification:** Do we agree this is the right approach?

**Loop Stop Condition:** CHECKPOINT 1 — human approval required

**If rejected:** DISCOVER again with corrected requirements

---

### 3. EXECUTE
**Question:** Build it.

**Who:** Backend Builder + Frontend Builder (in parallel, separate worktrees)

**Actions:**
- Implement according to spec
- Write tests as you go (TDD)
- Self-test as you write
- Commit regularly

**Verification:** Does the code match the spec?

**Loop Stop Condition:** All builders report ready

**If implementation reveals spec gap:** Route back to Spec Writer (tight feedback loop)

---

### 4. VERIFY
**Question:** Does it work and is it correct?

**Who:** Test Verifier (acceptance tests) + Validator (code review + security)

**Actions:**
- Run acceptance tests (per spec)
- Check against spec
- Security audit
- Performance review
- Linter + type checks

**Verification:** Does it pass all checks?

**Loop Stop Condition:** CHECKPOINT 2 — all verifications green before proceeding

**If failures:** ITERATE (self-fix up to 3 times), or escalate if stuck

---

### 5. ITERATE
**Question:** What's broken? Fix it.

**Who:** Same builder who owns the broken code (self-healing loop)

**Actions:**
- Analyze failure reason
- Attempt fix
- Re-test
- Log attempt to memory

**Verification:** Did the fix work?

**Loop Stop Condition:** Either success or "stuck after 3 attempts"

**If stuck:** Escalate to human (CHECKPOINT 3 — PR review)

---

## Part 3: The 6 Building Blocks

Every production loop has these 6 things. Your Feature Factory has some; this plan adds the rest.

### Block 1: AUTOMATIONS
**What it does:** Triggers discovery and manages loop lifecycle

**Your current state:** ❌ Missing

**Examples:**
- `/goal` — Autonomous loop (run until goal is met)
- `/loop 5m` — Scheduled loop (run every 5 minutes)
- GitHub PR created → auto-trigger test loop
- Nightly cron → daily standup loop

**Implementation:** Loop trigger engine + cron configs

---

### Block 2: WORKTREES
**What it does:** Lets multiple agents work in parallel without colliding

**Your current state:** ❌ Missing

**Problem it solves:**
```
Without worktrees:
Backend Builder writes src/api/users.ts
Frontend Builder writes src/api/users.ts (collision!)
Result: merge conflict, one dev loses work
```

**Solution (git worktrees):**
```
Backend: /workspace/feature-auth-backend
  → branch: feat/auth-01-backend
  → edits src/api/users.ts

Frontend: /workspace/feature-auth-frontend
  → branch: feat/auth-02-frontend
  → edits src/components/Login.tsx

Same repo, different branches, zero collisions
```

**Implementation:** Automatic worktree creation per agent, cleanup after merge

---

### Block 3: SKILLS
**What it does:** Project knowledge stored once, read by every agent every loop

**Your current state:** ✅ Strong (6+ skills exist)

**Why it matters:**
```
Without skills:
Agent 1: "What's your database schema?" (reads schema file)
Agent 2: "What's your database schema?" (reads again)
Agent 3: "What's your database schema?" (reads again)
Agent 4: "What's your database schema?" (reads again)
Token cost: 100 tokens × 4 agents = 400 tokens wasted

With skills:
SKILL.md (one read): "Here's your schema with constraints"
Every agent reads it once, understands patterns
Token cost: 100 tokens × 1 read = 100 tokens saved
```

**Enhancement needed:** Add production standards library (TDD, security, patterns)

---

### Block 4: PLUGINS & CONNECTORS
**What it does:** Loop acts in your real tools (Slack, GitHub, Linear, etc.)

**Your current state:** ⚠️ Only MemoryKit

**Examples:**
- Slack connector: "Feature started → post in #engineering, link to ticket"
- GitHub connector: "Tests pass → auto-draft PR, link to Linear issue"
- Linear connector: "Feature deployed → close issue, move to Done column"
- Datadog connector: "Performance ↑ 10% → auto-alert #perf-team"

**Why it matters:** Loop automates communication. No manual "update the ticket."

**Implementation:** MCP-based connectors (Phase 2)

---

### Block 5: SUBAGENTS
**What it does:** Hierarchical agent orchestration (Orchestrator → Specialists → Workers)

**Your current state:** ⚠️ Implicit (7-agent chain is flat)

**Example (fleet loop):**
```
Orchestrator: "Analyze this codebase for technical debt"
  ↓
Specialist 1 (Architecture): Analyze schema design
  ↓ Worker: Schema auditor
  ↓ Worker: Migrations reviewer
Specialist 2 (Performance): Analyze hot paths
  ↓ Worker: Profiler analyzer
  ↓ Worker: DB query optimizer
Specialist 3 (Security): Analyze attack surface
  ↓ Worker: Vulnerability scanner
  ↓ Worker: Auth boundary auditor

Orchestrator: Synthesize findings → post to Slack
```

**Why it matters:** Parallel work + clear reporting structure + easier debugging

**Implementation:** Subagent orchestrator (Phase 3)

---

### Block 6: MEMORY
**What it does:** Loop never forgets between runs

**Your current state:** ✅ Present (MemoryKit integrated)

**Examples:**
- Run 1: "Auth features take 4h avg, watch timezone handling"
- Run 2 (same feature type): Researcher surfaces "watch timezone handling"
- Run 3: Team avoids timezone bug that plagued Run 1
- Run 10: Same feature now takes 2.5h (40% faster)

**Why it matters:** Loop compounds. Second feature learns from first. Tenth feature learns from nine before it.

**Enhancement needed:** Formalize memory scoping + tagging strategy

---

## Part 4: Your Feature Factory as a Loop

### Current Flow (Good Foundation)

```
Feature Idea
    ↓
[01] DISCOVER — Researcher
    ↓ (reads codebase + MemoryKit)
[02] PLAN — Story Writer + Spec Writer
    ↓ (writes acceptance criteria + technical design)
⏸  CHECKPOINT 1
    ↓
[03] EXECUTE — Backend Builder + Frontend Builder
    ↓ (code in parallel, separate branches)
[04] VERIFY — Test Verifier + Validator
    ↓ (tests + linter + security audit)
[05] ITERATE — Self-fix (up to 3 attempts)
    ↓ (loop back if tests fail)
⏸  CHECKPOINT 2 (implicit — PR review)
    ↓
[06] DELIVER — Merge + Deploy
    ↓
[07] CONSOLIDATE — Feature Consolidator
    ↓ (extract patterns to MemoryKit)
Done
```

### Mapping to Loop Engineering

| Stage | Current | Loop Term |
|-------|---------|-----------|
| Researcher | ✅ Present | DISCOVER |
| Story + Spec Writers | ✅ Present | PLAN |
| Backend + Frontend Builders | ✅ Present | EXECUTE |
| Test Verifier + Validator | ✅ Present | VERIFY |
| Self-fix logic | ✅ Partial (Phase 3) | ITERATE |
| Feature Consolidator | ✅ Present | (Post-loop analysis) |

**You already have 70% of loop engineering.** This plan fills the remaining 30% (automations, worktrees, connectors, formal orchestration).

---

## Part 5: Single-Agent vs Fleet Loops

Your Feature Factory is a **single-agent loop** (one brain, 7 different hats).

You'll also build **fleet loops** (7 brains, one goal).

### Single-Agent Loop (Your Feature Factory)

```
Sequential chain: 01 → 02 → 03 → 04 → 05 → 06 → 07 → Done
One brain works through the whole pipeline.
Good for: Features, focused work, clear ownership
Cost: ~100K tokens per feature
Time: 2-4h elapsed (agent thinks + waits)
```

### Fleet Loop (New)

```
Parallel specialists:
  01 Research ──┐
  02 Design    ├→ Plan ──┐
  03 Execute   ├─────────┤
  04 Verify    ├─────────┤
  05 Iterate   │
  Orchestrator: Synthesize + check for conflicts
Result: Done
Good for: Concurrent work, multiple parallel analysis, high-leverage decisions
Cost: ~200K tokens per run (but faster wall-clock time)
Time: 30m-1h elapsed (agents work in parallel)
```

**When to use each:**
- **Single-agent:** One feature, limited scope, clear sequential steps (your current Feature Factory)
- **Fleet:** Multiple features in parallel, complex analysis, need speed, high token budget

---

## Part 6: Closed Loops vs Open Loops

### Closed Loop (Recommended)

**Structure:** Human designs the path. Agents execute within it.

```
Goal: Build auth feature
    ↓
Discover → Plan → Execute → Verify → Iterate → Done
    ↓
Loop stays within tight boundaries (spec, guardrails, verify gates)
```

**Characteristics:**
- Clear success criteria upfront
- Defined step sequence
- Quality gates at each step (prevents drift)
- Bounded token budget
- Predictable outcome

**Best for:** Feature development, well-scoped work, production code

**Token cost:** ~50-100K per feature (bounded)

---

### Open Loop (Exploratory)

**Structure:** Human gives goal. Agents discover best path.

```
Goal: "Reduce API latency by 20%"
    ↓
Loop explores: profiling → bottleneck discovery → optimization approaches
              → experimentation → testing → winner
    ↓
Outcome discovered by agent (not designed upfront)
```

**Characteristics:**
- Loose success criteria
- Agent decides best path
- High token burn
- Unpredictable, creative outcomes
- Requires strong model + budget

**Best for:** Research, exploration, refactoring unknown systems

**Token cost:** ~500K-2M per run (unbounded!)

**⚠️ Note:** Only viable with cheap models (DeepSeek V4). Standard Claude pricing makes this expensive.

**Your move:** Start closed-loop (Feature Factory). Open-loop is future exploration.

---

## Part 7: Cost & Time Models

### Token Burn Per Loop Type

| Type | Stage | Tokens | Notes |
|------|-------|--------|-------|
| **Single-Agent** | DISCOVER | 5-10K | Researcher reads codebase |
| | PLAN | 8-12K | Story + Spec writers design |
| | EXECUTE | 30-50K | Builders implement |
| | VERIFY | 10-20K | Tests + validation |
| | ITERATE | 5-10K | Self-fix (if needed) |
| | **Total** | **~60-100K** | **Per feature** |
| **Fleet** | All stages (parallel) | 150-250K | Higher burn, faster wall-clock |
| **Scheduled Loop** | (Daily standup) | 20-30K | Per run |

### Time Savings (Compounding)

| Feature # | Est. Time | Reason | Savings |
|-----------|-----------|--------|---------|
| 1 | 2-4h | Full discovery, learning | Baseline |
| 2 | 1.5-3h | Researcher surfaces patterns | 20% faster |
| 3 | 1.5-2.5h | Story writer avoids prior issues | 30% faster |
| 5 | 1-2h | All agents reuse patterns | 40% faster |
| 10 | 1-1.5h | System very mature | 40% faster |

**Example:** Build 10 similar features
- Without loop: 2h × 10 = 20h total
- With loop: 2h + 1.5h + 1.5h + 1h + 1h + 1h + 1h + 1h + 1h + 1h = 12h total
- **Savings: 8 hours (40%)**

---

## Part 8: Implementing Loop Engineering in Your Feature Factory

### Step 1: Formalize the Stages (Phase 1)

Currently your Feature Factory is implicit stages. Make it explicit:

```markdown
# Feature Factory Loop (Closed)

## DISCOVER Stage
- Agent: Researcher
- Duration: 20-30m
- Token Budget: 5-10K
- Success Criteria: Researcher Report complete, no unknowns

## PLAN Stage
- Agents: Story Writer + Spec Writer
- Duration: 30-45m
- Token Budget: 8-12K
- Success Criteria: User Story + Technical Brief approved at CHECKPOINT 1

## EXECUTE Stage
- Agents: Backend Builder + Frontend Builder (parallel, separate worktrees)
- Duration: 1.5-3h
- Token Budget: 30-50K
- Success Criteria: Code committed, tests passing locally

## VERIFY Stage
- Agents: Test Verifier + Validator (parallel)
- Duration: 30-60m
- Token Budget: 10-20K
- Success Criteria: All acceptance tests green, linter clean, security audit passed

## ITERATE Stage
- Agent: Original builder (self-healing)
- Duration: 30-60m per attempt (max 3)
- Token Budget: 5-10K per attempt
- Success Criteria: All tests passing or "stuck after 3 attempts"

## Total Duration: 3-5h (wall-clock) | 60-100K tokens
```

### Step 2: Add Worktrees (Phase 1)

```bash
# For each agent that writes code:

# Backend Builder
git worktree add --track -b feat/auth-backend /workspace/feat-auth-backend

# Frontend Builder
git worktree add --track -b feat/auth-frontend /workspace/feat-auth-frontend

# Each agent edits in isolation. Merge after VERIFY passes.
```

### Step 3: Add Verification Gates (Phase 1)

```markdown
DISCOVER → PLAN
  ↓ GATE: Researcher Report reviewed
  ↓ Does researcher understand scope? YES → continue, NO → ask for clarification

PLAN → EXECUTE
  ↓ GATE: CHECKPOINT 1 (human approval of story + spec)
  ↓ Is design correct? YES → continue, NO → back to PLAN

EXECUTE → VERIFY
  ↓ GATE: All builders report ready
  ↓ Code compiles + tests pass locally? YES → continue, NO → back to EXECUTE

VERIFY → ITERATE/DELIVER
  ↓ GATE: All verifications green
  ↓ Tests passing? Security audit passed? Type checks? YES → deliver, NO → iterate

ITERATE → VERIFY
  ↓ Loop back to VERIFY (max 3 attempts)
  ↓ Success? YES → deliver, NO (after attempt #3) → CHECKPOINT 3 (human review)
```

### Step 4: Add Automations (Phase 1)

```bash
# Activate a feature loop
loop start "add auth feature"

# Loop automatically:
# 1. Creates worktrees for backend + frontend
# 2. Runs DISCOVER with Researcher
# 3. Reports back: "Ready for PLAN. Waiting for your input on story criteria"
# 4. Waits for CHECKPOINT 1 approval
# 5. Continues autonomously through EXECUTE → VERIFY
# 6. If tests fail, attempts ITERATE (up to 3 times)
# 7. If still failing, posts PR for CHECKPOINT 3 review
```

### Step 5: Add Connectors (Phase 2)

```bash
# Slack integration
loop start "add auth feature" --notify-slack #engineering

# Updates #engineering:
# ✅ DISCOVER complete. Feature scope: [summary]
# 📋 Ready for approval (CHECKPOINT 1)
# 🏗  EXECUTE in progress
# ✅ VERIFY passed. PR ready for review.

# GitHub integration
loop start "add auth feature" --auto-pr

# Creates PR draft with:
# - Feature summary
# - Linked issue
# - Test coverage
# - Performance impact (if any)
```

---

## Part 9: Your Competitive Advantage

Once implemented, you'll have:

1. **Production-grade code guarantee** — Every feature ships with:
   - Type-safe code
   - Tested to spec
   - Security audited
   - Performance checked
   - Documented

2. **40% faster features** — By feature 10, you ship 40% faster due to pattern reuse

3. **Self-correcting system** — Loop fixes its own mistakes (40-60% fewer human escalations)

4. **Institutional memory** — Team knowledge compounds. Junior devs learn from prior features.

5. **Cost control** — Token budget enforced per stage. Runaway spending prevented.

6. **Parallel work** — Fleet loops enable concurrent analysis + development

---

## Part 10: Common Questions

### Q: How is this different from CI/CD?
**A:** CI/CD validates code after humans write it. Loop engineering has agents write code + validate as they go. Different layer of automation.

### Q: Doesn't this cost more in tokens?
**A:** Initially, yes. But by feature 10, you're 30-40% faster AND shipping better code. Trade-off: high upfront cost → lower long-term cost + higher quality.

### Q: What if the agent makes a wrong architectural decision?
**A:** CHECKPOINT 2 catches it. And prior feature learnings surface risky decisions early (DISCOVER phase flags them). System is defensive at multiple layers.

### Q: Can I still use this for small bugs?
**A:** Yes. Single-agent loop: Researcher → Implementation → Test → Done (30m, 10-20K tokens).

### Q: What if I don't have MemoryKit?
**A:** Loop still works, but without compounding. Feature 10 is not 40% faster. MemoryKit is optional but strongly recommended.

### Q: How do I know when to use which loop type?
**A:** Decision tree (see Part 11)

---

## Part 11: Loop Selection Decision Tree

```
Task received
    ↓
Is it a feature?
    ├─ YES → Full Feature Factory (single-agent closed loop)
    │         Agents: 1-7 (Researcher → Consolidator)
    │         Duration: 3-5h
    │         Checkpoints: 3
    │
    └─ NO → Continue...
              ↓
              Is it a bug fix?
              ├─ YES, simple (one file) → Single-agent loop
              │                          Agents: 1-2 (Researcher → Backend Builder)
              │                          Duration: 30m
              │                          Checkpoints: 1 (PR)
              │
              └─ NO → Continue...
                      ↓
                      Is it a decision/analysis?
                      ├─ YES → Fleet loop (parallel specialists)
                      │        Agents: 3-4 in parallel (Architecture, Performance, Security)
                      │        Duration: 1-2h
                      │        Checkpoints: 1 (synthesis review)
                      │
                      └─ NO → Manual task or special case
```

---

## Conclusion

Loop engineering is not a new framework. It's a **formalization** of what you already do with your Feature Factory. This plan upgrades it by:

1. Making stages explicit (DISCOVER, PLAN, EXECUTE, VERIFY, ITERATE)
2. Adding missing blocks (Worktrees, Automations, Connectors)
3. Formalizing verification gates (not end-of-chain only)
4. Enabling fleet loops (parallel agents)
5. Compounding knowledge (MemoryKit + consolidation)

**Result:** Production-grade code, 40% faster features, 60% fewer escalations, team stays in control.

---

**Next:** Read PRODUCTION_STANDARDS.md for best practices per agent role.

