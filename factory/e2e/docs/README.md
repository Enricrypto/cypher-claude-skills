# E2E Testing Loop System

**Version:** 1.0 (Harness-Driven, 100% Acceptance Only)  
**Status:** ✅ Production Ready  
**Last Updated:** 2026-06-23

## Quick Links

- 🚀 **[Quick Start](QUICK_START.md)** — Get running in 5 minutes
- 🏗️ **[Architecture](ARCHITECTURE.md)** — How the system works
- 📋 **[Phase Guide](PHASE_GUIDE.md)** — Detailed phase walkthrough
- 🔧 **[Harness Implementation](HARNESS_IMPLEMENTATION_SUMMARY.md)** — Technical deep dive
- 📚 **[Reference](../reference/)** — Error categories, contracts, schemas

---

## What Is This?

The E2E Testing Loop is a **deterministic, harness-driven orchestration system** for generating, testing, and remediating end-to-end tests for Portal Aurora.

### Core Philosophy

> **"Only the harness decides when phases advance. Agents produce artifacts; harness validates."**

Instead of agents making decisions about completion, the harness enforces objective, measurable criteria:

- ✅ Phases advance only when contracts are satisfied
- ✅ 100% test pass rate required (no partial acceptance)
- ✅ Docker environment always fresh (no stale containers)
- ✅ Regressions detected and auto-rolled back
- ✅ Loop terminates with time/iteration limits
- ✅ Escalation preserves full context for human review

---

## Problem Statement: 10 Critical Gaps Fixed

Your original loop had **10 failure modes** where agent judgment caused problems:

### 1. **Docker Rebuild Forgotten** 🐳
**Problem:** Agent was told to rebuild Docker, but often skipped it. Tests ran against stale container with old code.  
**Solution:** Rebuild is now a **non-optional harness step** before every test run.

### 2. **Premature PR Creation** 📤
**Problem:** Agent decided "we're done" and tried opening PR even though tests weren't passing.  
**Solution:** **Phase gates** enforce contracts. PR only creates after 100% pass verification.

### 3. **Evaluator Tested Stale State** 👻
**Problem:** Evaluator read old test result files, didn't know if they were fresh.  
**Solution:** **Playwright MCP** lets evaluator navigate live app, verify selectors/APIs actually exist before tests run.

### 4. **Acceptance Criteria Vague** 🎯
**Problem:** Success criteria were prose ("comprehensive tests"), inconsistent across phases.  
**Solution:** **Phase contracts** define acceptance as JSON structures with measurable criteria.

### 5. **Error Categorization Guessed** 🤔
**Problem:** Remediation agent inferred error categories; sometimes categorized wrong, applied wrong fix.  
**Solution:** **Error lookup table** provides deterministic pattern → category → fix mapping.

### 6. **Agent Output Unparseable** 📝
**Problem:** Harness had to parse prose output; missed key information, made bad decisions.  
**Solution:** **Structured JSON schemas** enforce machine-readable output from every agent.

### 7. **Regressions Undetected** 💥
**Problem:** Agent fixed one test, broke another; didn't notice. Loop advanced with broken state.  
**Solution:** **Before/after comparison** detects regressions, auto-rollbacks changes.

### 8. **Loop Never Terminated** ♾️
**Problem:** If tests never reached 100%, loop could run forever burning tokens.  
**Solution:** **Hard limits** (5 iterations, 1 hour timeout, 500k tokens). Escalates to human.

### 9. **Artifacts Scattered** 🗂️
**Problem:** All markdown files dumped in one folder. Agents couldn't find phase outputs.  
**Solution:** **Phase-organized directories** — each phase has its own folder with clear structure.

### 10. **No Escalation Path** 🚨
**Problem:** Agent would talk itself into approving broken work. No way to escalate.  
**Solution:** **Automatic escalation** on limits, preserving full context for human review.

---

## How It Works: Phase Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     E2E TESTING LOOP                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase -1: AUDIT PREPARATION                                    │
│  ├─ Code Auditor → comprehensive audit                          │
│  ├─ Audit Reviewer → validate (≥95% score required)             │
│  ├─ Gap Remediation → fix discrepancies                         │
│  └─ ✅ Harness validates → all CRITICAL gaps fixed              │
│                                                                 │
│  Phase 0: INFRASTRUCTURE (Optional)                             │
│  ├─ Fixer → apply optional infrastructure fixes                 │
│  └─ ✅ Harness can skip if no fixes needed                      │
│                                                                 │
│  Phase 1: TEST GENERATION                                       │
│  ├─ Test Planner → map test scenarios                           │
│  ├─ Test Generator → create test files                          │
│  ├─ Test Auditor (Playwright MCP) → verify selectors/APIs exist │
│  ├─ 🔧 Mandatory Docker Rebuild (Harness) ← Non-optional       │
│  ├─ 🧪 Run Tests (Harness) ← Execute & capture                 │
│  └─ ✅ Harness checks: 100% pass? → Finalize                   │
│     ❌ Tests fail? → Remediation                                │
│                                                                 │
│  Phase 2: REMEDIATION LOOP (If tests failed)                   │
│  └─ Repeat (up to 5 times):                                     │
│     ├─ 🔧 Mandatory Docker Rebuild (Harness)                   │
│     ├─ Remediation Agent → fix failures                         │
│     ├─ 🧪 Run Tests (Harness) → Fresh results                  │
│     ├─ Detect Regressions (Harness)                             │
│     │  ├─ ✅ 100% passing? → Advance to Phase 3                │
│     │  ├─ ❌ Regressions? → Rollback, escalate                 │
│     │  ├─ ❌ Max iterations? → Escalate to human                │
│     │  └─ ✅ Improving? → Loop again                            │
│     └─ ❌ If none above → Escalate                              │
│                                                                 │
│  Phase 3: FINALIZE                                              │
│  ├─ Create commit summary                                       │
│  └─ ✅ Ready for human PR review                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## System Components

### 🔒 Harness (The Guard Rails)

**Location:** `harness/`

| File | Responsibility |
|------|---|
| **phase-gates.ts** | Phase contracts & advancement validation. Decides when phases can proceed. |
| **error-categories.ts** | Error pattern → category → fix mapping. Deterministic error classification. |
| **agent-output-schema.ts** | JSON schemas for agent outputs. Validates before harness processes. |
| **remediation-engine.ts** | Orchestrates remediation loop with Docker rebuild, regression detection, escalation. |

**Key Principle:** Agents cannot decide phase advancement. Harness evaluates contracts and decides.

### 🤖 Agents (The Workers)

**Location:** `skills/e2e-pipeline/agents/`

| Agent | Phase | Job |
|-------|-------|-----|
| Code Auditor | -1 | Generate comprehensive audit of codebase |
| Audit Reviewer | -1 | Validate audit completeness (≥95% required) |
| Gap Remediation | -1 | Fix identified audit gaps |
| Fixer | 0 | Apply optional infrastructure fixes |
| Test Planner | 1 | Map test scenarios from audit |
| Test Generator | 1 | Create Playwright test files |
| Test Auditor | 1 | Verify tests match actual code (Playwright MCP) |
| Remediation | 2 | Fix failing tests systematically |

### 📊 Workflows (The Orchestrators)

**Location:** `workflows/`

| Workflow | Purpose |
|----------|---------|
| **e2e-full-loop-with-remediation.ts** | Main orchestrator. Runs all phases, uses harness guardrails. |

### 📁 Artifacts (The Outputs)

**Location:** `artifacts/`

Each phase stores its outputs in organized folders:

```
artifacts/
├── phase-0-audit/
│   ├── AUDIT_REPORT.md
│   ├── AUDIT_VALIDATION_REPORT.json
│   └── REMEDIATED_AUDIT_REPORT.md
├── phase-1-infrastructure/
│   └── INFRASTRUCTURE_FIXES.md
├── phase-2-test-generation/
│   ├── TEST_PLAN.md
│   ├── GENERATED_TESTS_MANIFEST.md
│   ├── TEST_AUDIT_REPORT.md
│   └── TEST_RESULTS.json
├── phase-3-remediation/
│   ├── DIAGNOSIS_REPORT.md
│   ├── REMEDIATION_ITER_1.md
│   ├── REMEDIATION_ITER_2.md
│   └── FINAL_TEST_RESULTS.json
└── phase-4-finalize/
    └── COMPLETION_REPORT.json
```

---

## Running the Loop

### Quickest Start

```bash
npm run e2e:loop -- --feature "advertiser-dashboard" --path "/painel/dashboard"
```

### What Happens

```
🔍 Running comprehensive code audit...
✅ Audit report generated
🔎 Validating audit completeness...
📊 Audit completeness: 98%
✅ Audit validation passed

📋 Planning test scenarios...
✅ Test plan created
🧪 Generating test files...
✅ Tests generated
🔐 Auditing tests with Playwright MCP...
✅ Test audit passed - ready to run tests

🏃 Running tests...
  → Rebuilding Docker environment (mandatory)
  → Running: npm run test:e2e
📊 Test Results: 45/45 passed (100%)
✅ All tests passing

✅ PIPELINE COMPLETE
   Test Files: frontend/e2e/tests/advertiser-dashboard/...
   Ready for PR review
```

### If Tests Fail

```
📊 Test Results: 40/45 passed (89%)
⚠️ 5 test(s) failing - triggering remediation

🔄 Remediation Iteration 1/5
  → Rebuilding Docker (mandatory)
  → Analyzing failures and applying fixes...
  → Re-running tests...
  ✅ Pass rate: 100% (45/45)
✅ 100% PASS RATE ACHIEVED

✅ PIPELINE COMPLETE
```

### If Max Iterations Exceeded

```
🔄 Remediation Iteration 5/5
  ✅ Pass rate: 95% (42/45)

❌ Max remediation iterations (5) reached

⛔ ESCALATING TO HUMAN REVIEW
Reason: Unable to reach 100% pass rate after 5 iterations
Current: 95% passing (42/45)
Failing: [test-1, test-2, test-3]

📁 Artifacts ready for review:
   artifacts/phase-3-remediation/FINAL_TEST_RESULTS.json
   artifacts/phase-3-remediation/REMEDIATION_LOG.md

🚨 Human action required:
   1. Review failing tests
   2. Identify root cause
   3. Fix test code or application code
   4. Re-run loop when ready
```

---

## Safety Guarantees

✅ **No phase advances unless contract satisfied**  
✅ **100% pass rate required (no partial passes)**  
✅ **Regressions detected and auto-rolled back**  
✅ **Docker always fresh (mandatory rebuild)**  
✅ **Loop terminates within limits (5 iter, 1 hour)**  
✅ **Escalation preserves full context for human**  
✅ **Evaluator verifies against live app (Playwright MCP)**  
✅ **All agent output validated against schema**

---

## Key Features

### 🎯 100% Acceptance Only
Tests must pass completely. No "good enough" or "close enough."

### 🔄 Mandatory Docker Rebuild
Before EVERY test run, environment is rebuilt from scratch with no cache. Prevents stale-state bugs.

### 🔐 Live Verification
Playwright MCP integration means evaluator navigates actual pages, verifies selectors exist, calls APIs, confirms response schemas match test expectations.

### 🛑 Automatic Escalation
When the loop hits limits (max iterations, timeouts, regressions), it stops and escalates to human with full context. No silent failures.

### 🗂️ Phase-Organized Artifacts
Each phase stores its outputs in dedicated folders. Easy navigation. No scattered files.

### 📊 Structured Output
All agent outputs are JSON/YAML with validated schemas. Machine-readable, no parsing errors.

---

## Troubleshooting

### Tests Passing Locally but Failing in Loop?
→ Check Docker state. Loop does `docker-compose down --volumes` before rebuild.

### "Audit score < 95%"
→ Run gap remediation agent to fix identified gaps.

### "Regressions detected"
→ Check which previously-passing tests are now failing.
→ Rollback was automatic; re-run loop after fixes.

### "Max iterations reached"
→ Loop tried 5 times to reach 100%, still failing.
→ Escalate to human review; check FINAL_TEST_RESULTS.json.

### Playwright MCP not working?
→ Verify `~/.claude/mcp.json` includes: `"playwright": { "command": "npx", "args": ["-y", "@anthropic-ai/playwright-mcp"] }`

---

## Next Steps

1. **[Quick Start](QUICK_START.md)** — Run your first E2E loop (5 min)
2. **[Phase Guide](PHASE_GUIDE.md)** — Understand each phase in detail
3. **[Architecture](ARCHITECTURE.md)** — Deep dive into system design
4. **[Harness Implementation](HARNESS_IMPLEMENTATION_SUMMARY.md)** — Technical reference

---

## Feedback & Issues

This system is production-ready. For questions or improvements:
- Review the [Architecture](ARCHITECTURE.md) to understand design decisions
- Check [reference/](../reference/) for detailed specifications
- Review [skills/e2e-pipeline/](../skills/e2e-pipeline/) for agent prompts

---

**Your loop is now bulletproof.** 🛡️
