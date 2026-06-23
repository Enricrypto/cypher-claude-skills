# Loop Engineering Implementation Master Plan

**Version:** 1.0  
**Date Created:** 2026-06-10  
**Status:** Research & Planning Phase  
**Scope:** Consolidate cypher-claude-skills agentic flows into loop engineering architecture

---

## Executive Summary

This master plan reimagines the **Feature Factory** (7-agent chain) within the **loop engineering paradigm** defined by Peter Steinberger and Boris Cherny (2026). Your current system is a strong foundation — this plan upgrades it by:

1. **Formalizing loop stages** (DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE)
2. **Adding missing building blocks** (Automations, Worktrees, Plugins/Connectors, formal Subagent orchestration)
3. **Creating closed-loop verification** at each stage (not just end-of-chain)
4. **Consolidating all loops** into cypher-claude-skills (single source of truth)
5. **Documenting production-grade best practices** (TDD, design patterns, security, testing)
6. **Enabling MemoryKit-driven self-improvement** (loop compounds knowledge)

**Outcome:** By Phase 4, you'll have:
- ✅ Automated, self-correcting feature loops
- ✅ Reusable patterns across features (30-40% faster by feature 10)
- ✅ Production-grade code guardrails
- ✅ Full audit trail in MemoryKit
- ✅ Enterprise-ready agent orchestration

---

## Part 1: Current State Analysis

### What You Have (✅ Strengths)

**Feature Factory (7-agent chain):**
- ✅ Clear role separation (Researcher → Builders → Validator)
- ✅ 3 human checkpoints (story → brief → PR)
- ✅ Phase 1 & 2 memory integration (storage + active retrieval)
- ✅ Phase 3 autonomous iteration (self-fixing tests)
- ✅ Feature Consolidator (post-merge extraction)
- ✅ Agents stored in `agents/` with proper schemas
- ✅ Skills assigned per-agent (architecture, API design, TDD, etc.)

**E2E Test Pragmatism Guardrails:**
- ✅ Deduplication checks (prevent redundant tests)
- ✅ Pragmatism filters (max 3-4 interactions per test)
- ✅ Test design justification (comment every test with WHY)
- ✅ Focus on single-scenario tests (not complex multi-feature flows)

**Memory System:**
- ✅ MemoryKit integration (store/retrieve across sessions)
- ✅ Project-scoped memories (per-project learnings)
- ✅ 4-layer memory (working, facts, episodes, procedures)

### What's Missing (❌ Gaps)

**Loop Engineering Framework:**
1. ❌ Not formalized as explicit DISCOVER → PLAN → EXECUTE → VERIFY → ITERATE stages
2. ❌ No **Worktrees** (parallel agent execution without collisions)
3. ❌ No **Automations** (scheduled loop triggers, `/goal` integration)
4. ❌ No **Plugins/Connectors** (MCP-based tool integration beyond MemoryKit)
5. ❌ Subagent orchestration is implicit (not formalized as hierarchical)
6. ❌ No distinction between **single-agent loops** vs **fleet loops**
7. ❌ Verification gates are end-of-chain only (not per-stage)

**Production-Grade Code:**
1. ❌ No consolidated TDD guidelines (testing patterns not formalized)
2. ❌ No design pattern library (where to reuse vs build fresh)
3. ❌ No security audit checklist (per-agent)
4. ❌ No API design standards (beyond skill file)
5. ❌ No error handling / edge case playbook
6. ❌ No database migration guardrails
7. ❌ No performance optimization checklist

**Repository Organization:**
1. ❌ Agents and skills scattered (agents/ and skills/ are separate)
2. ❌ No consolidated agent orchestration config
3. ❌ No formal loop configuration file (LOOP_SCHEMA.md)
4. ❌ e2e-testing-setup is separate repo (should consolidate guardrails here)
5. ❌ No playbook for "when to use which loop" (single-agent vs fleet vs scheduled)

**Documentation:**
1. ❌ No "Loop Engineering 101" onboarding (how loops differ from prompts)
2. ❌ No deployment readiness checklist
3. ❌ No troubleshooting guide (when loops fail, what to fix)
4. ❌ No cost optimization guide (token burn tracking)

---

## Part 2: Architecture Vision

### The Three Loop Types You'll Have

After Phase 4, you'll operate three loop types simultaneously:

#### **Type 1: Feature Factory Loop** (Single-Agent, Closed)
**Current:** Your 7-agent chain  
**Improved:** Formalizes as a closed loop with per-stage verification

```
DISCOVER (Researcher) 
  ↓ read codebase + memory
PLAN (Story Writer → Spec Writer)
  ↓ human checkpoint
EXECUTE (Backend/Frontend Builders)
  ↓ parallel worktrees
VERIFY (Test Verifier → Validator)
  ↓ test suite + linter gates
ITERATE (self-fix up to 3x)
  ↓ if still failing → escalate
CONSOLIDATE (Feature Consolidator)
  ↓ extract reusable patterns
DELIVER (PR merged → deploy)
```

**Governance:** Closed loop, 3 human checkpoints, max token burn per feature

#### **Type 2: Scheduled Loop** (Fleet, Closed)
**Purpose:** Async work that runs on a schedule (e.g., daily standup, backlog refinement)

```
TRIGGER (cron schedule or manual activation)
  ↓
DISCOVER (multiple specialists in parallel)
  ↓ worktrees prevent collision
PLAN (orchestrator synthesizes)
  ↓
EXECUTE (fleet of subagents)
  ↓ monitoring + alerts
VERIFY (automated checks)
  ↓
ITERATE (self-correct or escalate)
  ↓
REPORT (post findings to Slack/Linear)
```

**Governance:** Closed loop, automated handoff, escalation only on blockers

#### **Type 3: Interactive Refinement Loop** (Single-Agent, Open)
**Purpose:** User guidance during discovery phase (only on user approval)

```
USER INPUT → DISCOVER → ASK CLARIFYING QUESTIONS → USER RESPONSE
           → refined understanding
           → hand to Feature Factory
```

**Governance:** Human-in-loop, conversational, feeds into Feature Factory

---

### The 6 Building Blocks You'll Implement

| Block | What It Does | Your Current State | Implementation Phase |
|-------|---|---|---|
| **Automations** | Triggers DISCOVER, schedules loops, manages `/goal` | ❌ Missing | Phase 1 |
| **Worktrees** | Parallel agents without file collisions | ❌ Missing | Phase 1 |
| **Skills** | Project knowledge stored once, read every loop | ✅ Partial | Phase 2 (expand) |
| **Plugins/Connectors** | MCP-based integration (MemoryKit, Slack, Linear, etc.) | ⚠️ MemoryKit only | Phase 2 |
| **Subagents** | Formal orchestration hierarchy (Orchestrator → Specialists → Workers) | ⚠️ Implicit | Phase 3 |
| **Memory** | Persistent loop state across runs | ✅ Present | Phase 2 (enhance) |

---

## Part 3: Phased Implementation Roadmap

### Phase 0: Research & Decision (THIS PHASE — 2-3 days)

**Goals:**
- [ ] Map Feature Factory to loop engineering principles
- [ ] Identify gaps and trade-offs
- [ ] Document production-grade best practices
- [ ] Create detailed implementation specs per phase

**Deliverables:**
1. **LOOP_FRAMEWORK.md** — Loop engineering 101 + your architectural model
2. **PRODUCTION_STANDARDS.md** — TDD, security, API design, database patterns
3. **LOOP_SCHEMA.md** — Formal config for orchestration, worktrees, verification gates
4. **PHASE_1_SPEC.md** → PHASE_4_SPEC.md — Detailed per-phase implementation specs
5. **DECISION_LOG.md** — Trade-offs and justifications

**Decisions to Make (see Part 4):**
- Which MCP connectors to implement (Slack, Linear, GitHub, etc.)
- Token budget per loop type
- Subagent hierarchy structure
- MemoryKit storage strategy (scopes, tagging)

---

### Phase 1: Loop Foundations (2-3 weeks)

**Focus:** Automations, Worktrees, formal loop staging

**What Gets Built:**
1. **Loop Trigger Engine**
   - `/goal` integration for closed-loop autonomy
   - Scheduled loop cron setup
   - Manual trigger capability
   - Token budget enforcement per loop

2. **Worktree Manager**
   - Automatic worktree creation per agent
   - Branch naming conventions (loop-type/agent/timestamp)
   - Cleanup automation after merge
   - Collision detection

3. **Formal Loop Stages**
   - Rewrite Feature Factory skill as explicit loop stages
   - Per-stage verification gates
   - Per-stage escalation paths
   - Loop state tracking (MemoryKit)

4. **Enhanced Agent Prompts**
   - Each agent receives loop context (stage, budget, prior runs)
   - Stage-specific guardrails
   - Explicit "STOP" → "ITERATE" vs "ESCALATE" logic

**Deliverables:**
- Loop trigger CLI (`loop init`, `loop start`, `loop status`)
- Worktree automation scripts
- Updated agent prompts with loop awareness
- Loop state tracking schema (MemoryKit)

---

### Phase 2: Production Standards & Connectors (2 weeks)

**Focus:** Best practices, tool integration, knowledge consolidation

**What Gets Built:**
1. **Production Standards Library**
   - **TDD.md** — Test-first patterns, acceptance test structure, mocking strategy
   - **DESIGN_PATTERNS.md** — When to use what (CRUD, async, cache, etc.)
   - **SECURITY.md** — OWASP top 10 per agent, secrets management, auth boundaries
   - **API_DESIGN.md** — REST/GraphQL conventions, versioning, deprecation
   - **DATABASE.md** — Migration safety, timezone handling, concurrency
   - **ERROR_HANDLING.md** — What to log, how to surface errors, retry logic
   - **PERFORMANCE.md** — Optimization checklist, monitoring points, targets

2. **MCP Connectors**
   - MemoryKit enhancement (add loop-state tags)
   - Slack connector (post loop start/end summaries)
   - GitHub connector (auto-draft PR descriptions)
   - Linear connector (auto-link features to issues)
   - Optional: Datadog/monitoring connector for perf tracking

3. **Consolidated Documentation**
   - Move e2e pragmatism guardrails to cypher-claude-skills
   - Create unified "WHEN TO USE WHICH LOOP" guide
   - Build agent decision tree (which agent for this work?)
   - Deployment readiness checklist

**Deliverables:**
- Production standards library (6-8 comprehensive guides)
- MCP connector integration code
- Updated LOOP_SCHEMA.md with connector mapping
- Loop usage decision tree

---

### Phase 3: Subagent Orchestration & Self-Healing (2 weeks)

**Focus:** Fleet loops, hierarchical agents, autonomous error recovery

**What Gets Built:**
1. **Subagent Orchestrator**
   - Formal agent hierarchy (Orchestrator → Specialists → Workers)
   - Load balancing (token budget per subagent)
   - Handoff protocol (how one agent calls another)
   - Communication contract (input/output schemas)

2. **Self-Healing Intelligence**
   - Autonomous retry logic (up to 3 attempts, log each)
   - Error categorization (transient vs permanent)
   - Route-back protocol (Backend Builder ↔ Frontend Builder for API mismatches)
   - Escalation decision tree (when human review is needed)

3. **Fleet Loop Patterns**
   - Parallel discovery (multiple specialists in parallel)
   - Orchestrator synthesis (combine results)
   - Consensus checks (do results agree?)
   - Conflict resolution (what if specialists disagree?)

**Deliverables:**
- Subagent orchestrator engine
- Fleet loop templates (discovery, review, analysis)
- Self-healing playbook
- Agent communication contract (JSON schema)

---

### Phase 4: Loop Compounding & Automation (2 weeks)

**Focus:** MemoryKit-driven improvement, scheduled loops, cost optimization

**What Gets Built:**
1. **Loop Compounding**
   - Researcher reads prior feature patterns (Phase 2 exists; enhance here)
   - Time estimator uses historical data
   - Confidence scoring based on pattern similarity
   - Anti-pattern detector (flag risky approaches)

2. **Scheduled Loops**
   - Daily standup loop (status → Slack)
   - Weekly backlog refinement loop (analyze issues → prioritize)
   - Post-merge consolidation loop (auto-extract patterns)
   - Monthly quality audit loop (test coverage, tech debt)

3. **Cost Optimization**
   - Token budget tracking per loop
   - Cost per feature estimate (learning curve)
   - Model routing (use cheaper model for certain stages)
   - Caching strategy (what to cache in MemoryKit to avoid re-reads)

**Deliverables:**
- Scheduled loop CLI and cron configs
- Token budget tracker and reporting
- Cost optimization playbook
- 90-day learning curve model (cost ↘︎ as system matures)

---

## Part 4: Critical Decision Points (Requires Your Input)

### Decision 1: MCP Connector Priority

**Question:** Which MCP connectors should Phase 2 implement first?

**Options:**
- A) **Slack-first** — Post loop summaries, escalations, approvals to Slack (low cost, high visibility)
- B) **GitHub-first** — Auto-draft PRs, link issues, update PR descriptions (moderate cost, high value for your workflow)
- C) **Linear-first** — Sync features with Linear board, auto-link, status updates (moderate cost, high org value)
- D) **All three** — Implement all in Phase 2 (higher cost, but maximum automation)
- E) **Minimal set** — Only MemoryKit in Phase 2, defer others to Phase 4

**Trade-off:** More connectors = more automation + more token cost + more maintenance. Fewer = less overhead but less visibility.

**Recommendation:** Option A (Slack-first) provides highest ROI. Start there, add others in Phase 4.

---

### Decision 2: Subagent Hierarchy

**Question:** How should the orchestrator manage subagents?

**Options:**
- A) **Hierarchical (tree)** — Orchestrator → Specialists (Backend, Frontend, QA) → Workers (code writer, test writer, reviewer)
  - Pros: Clear reporting structure, parallel work within specialists
  - Cons: More coordination overhead, harder debugging
  
- B) **Flat (peer)** — Orchestrator distributes to 8 agents as equals
  - Pros: Simpler, current Feature Factory model
  - Cons: Harder to scale beyond 8-10 agents, no specialization grouping
  
- C) **Hybrid** — Orchestrator → Specialists for parallel work, but within each specialist agents are peers
  - Pros: Best of both (parallelism + simplicity)
  - Cons: Middle complexity

**Recommendation:** Option C (Hybrid). Keeps Feature Factory simple while enabling fleet parallelism.

---

### Decision 3: Loop Type Default

**Question:** When should developers activate which loop type?

**Options:**
- A) **Always Feature Factory** — Use the 7-agent chain for any non-trivial feature (current approach)
- B) **Feature Factory for features, Single-Agent loops for bugs** — Separate paths based on task type
- C) **Smart routing** — Automatic detection (code-only bug → single agent, schema change → full factory, etc.)
- D) **User choice** — Developers choose at start of session

**Recommendation:** Option B (Feature Factory for features, single-agent for bugs) balances simplicity and efficiency.

---

### Decision 4: MemoryKit Scope Strategy

**Question:** How should memories be scoped and tagged?

**Options:**
- A) **Global + project** — memories live at two levels (reusable across all projects, project-specific learnings)
- B) **Feature-scoped only** — tag everything with feature name, retrieve by feature similarity
- C) **Agent-scoped** — each agent has its own memory namespace (Researcher memories ≠ Builder memories)
- D) **All of the above** — hybrid approach with cross-scoping

**Recommendation:** Option A (Global + project). Global for patterns, project for specifics.

---

### Decision 5: Token Budget Model

**Question:** How should you track and enforce token spending?

**Options:**
- A) **Soft limits** — Warn at 80%, stop at 100% (but allow override with approval)
- B) **Hard limits** — Absolutely stop at limit, no override
- C) **Per-stage budgets** — Budget is divided by stage (Researcher: 10K, Builders: 30K, Verifier: 20K, etc.)
- D) **Dynamic budgets** — Based on feature complexity (small bug: 5K, complex feature: 100K+)

**Recommendation:** Option C (per-stage budgets). Prevents runaway spending, but flexible per feature.

---

## Part 5: Success Criteria

### Phase 0 (Research) Success:
- ✅ All 5 decisions made and documented
- ✅ LOOP_FRAMEWORK.md written (production team agrees)
- ✅ PRODUCTION_STANDARDS.md complete (covers TDD, security, patterns)
- ✅ Phase 1-4 specs written and reviewed

### Phase 1-4 Cumulative Success:
- ✅ Feature Factory runs as explicit loop stages
- ✅ Worktrees prevent agent collisions
- ✅ Scheduled loops run without human intervention
- ✅ MemoryKit compounds knowledge (30-40% faster by feature 10)
- ✅ All MCP connectors integrated and working
- ✅ Subagent orchestrator handles fleet loops
- ✅ Self-healing loops reduce human escalations by 40-60%
- ✅ Cost per feature drops 20-30% as system matures
- ✅ All documentation updated and team trained

---

## Next Steps

1. **Your Input:** Decide on 5 critical decision points (Part 4)
2. **Phase 0 Spec Generation:** I'll create detailed Phase 1-4 specs
3. **Review & Approval:** You review, request changes
4. **Phase 1 Kickoff:** Start with loop trigger engine + worktrees
5. **Continuous Delivery:** One phase every 2-3 weeks

---

## File Structure (Final State)

```
cypher-claude-skills/
├── LOOP_IMPLEMENTATION/
│   ├── MASTER_PLAN.md                    (this file)
│   ├── LOOP_FRAMEWORK.md                 (loop engineering 101)
│   ├── PRODUCTION_STANDARDS.md           (TDD, security, patterns)
│   ├── LOOP_SCHEMA.md                    (formal orchestration config)
│   ├── PHASE_1_SPEC.md                   (worktrees, automations)
│   ├── PHASE_2_SPEC.md                   (connectors, standards library)
│   ├── PHASE_3_SPEC.md                   (subagent orchestration)
│   ├── PHASE_4_SPEC.md                   (scheduled loops, compounding)
│   ├── DECISION_LOG.md                   (decisions + justifications)
│   ├── TROUBLESHOOTING.md                (when loops fail)
│   └── COST_OPTIMIZATION.md              (token tracking, models, caching)
├── agents/                               (existing + enhanced)
│   ├── 01-researcher.md
│   ├── 02-story-writer.md
│   └── ... (updated with loop context)
├── skills/                               (existing + new)
│   ├── feature-factory/SKILL.md          (rewritten as loop stages)
│   ├── production-tdd/
│   ├── production-security/
│   ├── production-database/
│   └── ... (new standards library)
└── orchestration/                        (new folder)
    ├── loop-trigger-engine.js
    ├── worktree-manager.js
    ├── subagent-orchestrator.js
    └── mcp-connectors.js
```

---

## Timeline

| Phase | Duration | Start | Approval |
|-------|----------|-------|----------|
| Phase 0 (Research) | 2-3 days | Immediate | User reviews decisions |
| Phase 1 (Foundations) | 2-3 weeks | After Phase 0 approval | Worktrees & triggers working |
| Phase 2 (Standards) | 2 weeks | After Phase 1 | Connectors + docs complete |
| Phase 3 (Orchestration) | 2 weeks | After Phase 2 | Fleet loops working |
| Phase 4 (Automation) | 2 weeks | After Phase 3 | Scheduled loops working |
| **Total** | **~10 weeks** | Now | Production-grade system live |

---

## Questions for You

Before Phase 0 continues, please answer:

1. **Decision 1:** Which MCP connectors? (A, B, C, D, or E?)
2. **Decision 2:** Subagent hierarchy? (A, B, or C?)
3. **Decision 3:** Loop type routing? (A, B, C, or D?)
4. **Decision 4:** MemoryKit scoping? (A, B, C, or D?)
5. **Decision 5:** Token budget model? (A, B, C, or D?)
6. **Team size:** How many developers use this system? (impacts training scope)
7. **Current feature velocity:** How many features per week? (impacts ROI math)
8. **Biggest pain point:** What frustrates the team most about current loops?

---

**End of MASTER_PLAN.md**

