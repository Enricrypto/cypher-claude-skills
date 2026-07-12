```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    🎯 FEATURE FACTORY ORCHESTRATOR                              ║
║                                                                              ║
║            Practical Implementation: How to Run the Loop                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

# Feature Factory Orchestrator — Implementation Guide

This document describes how to run the Feature Factory using the agents defined in this repository.

> **Naming:** this system was documented under two names — "Feature Factory" and "Feature Loop" —
> which made the docs look like they described two different things. There is one system. It is
> called Feature Factory.
>
> **It is now runnable as a Node program:** `npm run factory -- --feature "..." --cwd /path/to/project`.
> The manual, step-by-step invocation described below still works and is useful for understanding
> the chain, but the orchestrator no longer needs a human to drive it between stages.

---

## What We Have

✅ **10 Agents** (agents/ directory)
- 01-Researcher
- 02-Story Writer
- 03-Spec Writer  
- 04-Backend Builder
- 05-Frontend Builder
- 06-Test Verifier
- 07-Validator
- 08-Feature Consolidator
- 09-Audit Agent
- 10-Remediation Agent

✅ **The orchestrator** (`workflows/feature-factory-orchestrator.ts`)
- Drives all 5 stages, no human needed between them
- Enforces the gates in code (`harness/stage-gates.ts`)
- Handles loop-backs (max 3 per builder) with deterministic error categorisation
- Records escalations with structured context, and resumable state

✅ **The runner** (`runner/`)
- `cli.ts` — `npm run factory -- --feature "..." --cwd /path/to/project`; exits `1` on escalation
- `invoke-agent.ts` — dispatch via the Claude Agent SDK
- `agent-registry.ts` — per-agent tool grants, **enforced** by the SDK permission layer
- `output-schemas.ts` — full per-agent JSON Schema, so agents cannot bury findings in prose

⬜ **Not built:** cross-feature memory (Phase 3), parallel builder worktrees (Phase 3),
Tier 1 (Strategist / Architect / Decomposer).

---

## The implementation tasks below are DONE

> **This section is historical.** It was a to-do list written before the orchestrator existed.
> Tasks 1 and 2 are built (`harness/state-tracker.ts`, and the loop-back logic in the
> orchestrator). Tasks 3–5 are not, and are tracked in
> [../../docs/REFACTOR_PLAN.md](../../docs/REFACTOR_PLAN.md) instead.
>
> It is kept because the pseudocode still describes the intended behaviour accurately, which is
> useful when reading the implementation.

### TASK 1: Feature State Tracker — ✅ BUILT (`harness/state-tracker.ts`)

Tracks execution state so a run can be audited and resumed:

```json
{
  "feature": "feature name",
  "mode": "standard",
  "started_at": "ISO-8601-timestamp",
  "current_stage": 1,
  "current_agent": "01-researcher",
  
  "stages": {
    "1_discover": { "status": "complete", "time_ms": 180000 },
    "2_plan": { "status": "complete", "time_ms": 360000 },
    "3_execute": { "status": "in_progress", "agent": "04-backend-builder" },
    "4_verify": { "status": "pending" },
    "5_deliver": { "status": "pending" }
  },
  
  "loop_backs": [
    {
      "stage": 3,
      "agent": "04-backend-builder",
      "component": "UserService.ts",
      "attempt": 1,
      "reason": "test failed: validation",
      "fixed_at": "ISO-8601-timestamp"
    }
  ],
  
  "escalations": [],
  "checkpoints": {}
}
```

**Implementation steps:**
1. After each agent completes, save state
2. Track loop count per agent/component
3. Trigger escalation if max loops (3 for builders, 2 for reviewers) reached
4. Use state to resume after escalations

---

### TASK 2: Loop-Back Handler — ✅ BUILT (in the orchestrator)

When a test fails or agent has issues:

```
detect_failure():
  ├─ Parse agent output for errors/failures
  ├─ Increment loop counter in state
  ├─ If loop < max_attempts:
  │   ├─ Ask agent to fix
  │   ├─ Re-test
  │   └─ Loop back to same agent
  └─ If loop >= max_attempts:
      ├─ Record escalation
      ├─ Show human what tried + failed
      └─ Wait for human decision
```

**Implementation steps:**
1. Create escalation detection logic
2. Create retry mechanism (up to 3 times per component)
3. Record all attempted fixes in state
4. Present human-readable escalation summaries

---

### TASK 3: Memory Initialization Fallback — ⬜ NOT BUILT (Phase 3)

When MemoryKit is empty (first feature of a type):

```
retrieve_patterns(feature_type):
  ├─ Query: retrieve_context("feature-type: {feature_type}")
  ├─ If result empty:
  │   ├─ Log: "No prior learnings for {feature_type}"
  │   ├─ Set baseline confidence: 0% (building from scratch)
  │   └─ Continue with codebase analysis only
  └─ If result found:
      ├─ Extract patterns with confidence scores
      └─ Use for pattern reuse (P3)
```

**Implementation steps:**
1. Handle "no results" case gracefully in all agents
2. Provide baseline context when memory empty
3. Agents should still work without prior features
4. Just slower (bootstrapping phase)

---

### TASK 4: Auto-Fix Framework — ⬜ NOT BUILT

Validator (P5) can auto-fix some guardrails:

```
auto_fix(finding, guardrail_type):
  ├─ If guardrail_type == "error_state_missing":
  │   └─ Inject error state pattern in component
  ├─ If guardrail_type == "loading_state_missing":
  │   └─ Inject loading state pattern
  ├─ If guardrail_type == "cleanup_missing":
  │   └─ Add useEffect cleanup function
  └─ Return: fixed_code, applied = true/false
```

**Implementation steps:**
1. Identify which guardrails are auto-fixable
2. Create templates for common fixes
3. Validator applies fixes automatically
4. Re-run tests after auto-fix
5. Report which fixes were applied

---

### TASK 5: Parallel Execution Manager — ⬜ NOT BUILT (Phase 3)

Standard mode runs Backend + Frontend in parallel:

```
execute_parallel(backend_brief, frontend_brief):
  ├─ Invoke 04-Backend Builder (worktree A)
  ├─ Worktree A: Generate + test backend code
  ├─ When backend ready:
  │   └─ Create API contract file (.feature-backend-api.md)
  ├─ Invoke 05-Frontend Builder (worktree B)
  ├─ Worktree B: Wait for API contract
  ├─ When API contract ready:
  │   └─ Frontend Builder starts
  └─ Both workers complete, merge changes back
```

**Implementation steps:**
1. Create worktree for each builder
2. Sync API contract between worktrees
3. Frontend waits on Backend output (dependency management)
4. Merge worktree changes to main branch
5. Clean up temporary worktrees

---

## Practical Quick-Start (Manual Mode)

> **The orchestrator is no longer manual** — run `npm run factory -- --feature "..." --cwd <project>`.
> The steps below remain useful for understanding what each agent receives and produces, and for
> driving a single agent in isolation. But note: when you drive the chain by hand, **you** are the
> gate, and a gate made of good intentions is the soft-gate failure this system exists to prevent.

### STEP 1: Prepare Project

```bash
# Ensure .claude/CLAUDE.md exists
cat .claude/CLAUDE.md

# Ensure .claude/GUARDRAILS.md exists (optional but recommended)
cat .claude/GUARDRAILS.md

# Verify test commands work
npm run test
```

### STEP 2: Choose Mode

```bash
# Standard mode (recommended)
feature start "Add user profiles" --mode=standard

# Safe mode (learning)
feature start "Add user profiles" --mode=safe
```

### STEP 3: Run Each Stage

**Stage 1: DISCOVER**
```bash
# Invoke researcher
agent invoke 01-researcher --feature="Add user profiles"

# Save output to .feature-researcher-report.md
# Update .claude/.feature-state.json
```

**Stage 2: PLAN**
```bash
# Invoke story writer (read researcher report)
agent invoke 02-story-writer --feature="Add user profiles"

# YOU: Review story, approve
# Save to .feature-story.md

# Invoke spec writer (read story)
agent invoke 03-spec-writer --feature="Add user profiles"

# Save to .feature-spec.md
```

**Stage 3: EXECUTE**
```bash
# Parallel backend + frontend
# OR sequential depending on mode

# Backend Builder
agent invoke 04-backend-builder \
  --brief=.feature-spec.md \
  --researcher-report=.feature-researcher-report.md

# Frontend Builder (after backend API ready)
agent invoke 05-frontend-builder \
  --brief=.feature-spec.md \
  --backend-api=.feature-backend-api.md

# Test Verifier
agent invoke 06-test-verifier \
  --story=.feature-story.md \
  --code-paths=src/

# Code Reviewer
agent invoke 11-reviewer-agent \
  --backend-code=src/services \
  --frontend-code=src/components
```

**Stage 4: VERIFY**
```bash
# Validator (spec + guardrails)
agent invoke 07-validator \
  --spec=.feature-spec.md \
  --code-paths=src/ \
  --guardrails=.claude/GUARDRAILS.md
```

**Stage 5: DELIVER**
```bash
# Consolidator
agent invoke 08-feature-consolidator \
  --feature="Add user profiles" \
  --merge-to=main
```

---

## Implementation Roadmap

### Week 1: Foundation
- [ ] Feature state tracker (.feature-state.json)
- [ ] Loop-back handler (retry logic)
- [ ] Escalation detection
- [ ] Manual orchestrator guide (this document)

### Week 2: Automation
- [ ] CLI orchestrator (feature start / feature status)
- [ ] Worktree manager (parallel execution)
- [ ] Memory initialization handler
- [ ] Auto-fix framework

### Week 3: Polish
- [ ] Automated sequencing (no manual invocation)
- [ ] Checkpoint automation (approval gates)
- [ ] Metrics & reporting
- [ ] Error recovery

---

## What This Enables

Once implemented:

✅ **Fully Automated Loop**
```bash
feature start "Add user profiles" --mode=standard
# System runs all 5 stages, handles retries, auto-fixes, approvals
# 10-12 min later: Feature complete and merged
```

✅ **Parallel Execution**
```bash
# Backend + Frontend build simultaneously
# Frontend waits for API contract (dependency managed automatically)
```

✅ **Automatic Error Recovery**
```bash
# Test fails → Agent retries (up to 3 times)
# Still fails → Escalates to human with clear summary
# Human fixes issue → System resumes from exact failure point
```

✅ **Learning System**
```bash
# Feature #1: 12 min (bootstrapping)
# Feature #5: 3 min (80% pattern reuse)
# Feature #10: 1 min (system "autopilot")
```

---

## Success Criteria

Implementation is complete when:

✅ `npm run factory -- --feature "..."` works end-to-end  
✅ All 5 stages execute without manual invocation  
✅ Loop-back happens automatically on failures  
✅ Escalations presented clearly when humans needed  
✅ Auto-fixes applied automatically  
⬜ Memory accumulates learning across features *(Phase 3 — not built)*

**On speed:** an earlier version of this document claimed "the system runs 92% faster by
feature #10." That number was never measured and has been removed. The only figure we have
actually observed is ~15 turns / 2–4 minutes / $0.45–$0.75 reported for **one read-only agent**
on an 8-file repo. A full ten-agent feature is meaningfully more. Measure before you claim.

---

## Next Steps

1. **Read:** agents/* (understand what each agent does)
2. **Create:** Feature state tracker (save/load logic)
3. **Create:** Loop-back handler (failure detection + retry)
4. **Build:** Orchestrator CLI (invoke agents in sequence)
5. **Test:** Run first feature manually, then automate

Ready to implement? Start with Task 1 above. 🚀
