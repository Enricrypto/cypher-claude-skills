# Skill: E2E Testing Pipeline (Manual Orchestration)

**Name:** e2e-pipeline  
**Type:** Manual orchestration with guided decision points  
**Status:** Ready to use  
**Invocation:** `/e2e-pipeline` or activate directly

---

## What This Skill Does

Guides you through the complete E2E testing pipeline:

```
Phase 0: Audit Preparation (✅ DONE)
  → Auditor: Generate audit
  → Reviewer: Validate completeness
  → Remediation: Fix gaps
  → Apply corrections

Phase 1: Infrastructure Fix (OPTIONAL)
  → Fixer: Apply config fixes

Phase 2: Test Generation
  → Planner: Map test scenarios
  → Generator: Create test files
  → Healer: Fix failures (on-demand)
```

**Output:** Production-ready test suite (~80 tests)

---

## Phase -1: Audit Preparation (Status: ✅ COMPLETE)

✅ docs/E2E_TEST_CATEGORIES.md (corrected)
✅ docs/AUDIT_VALIDATION_REPORT.md
✅ docs/REMEDIATED_AUDIT_REPORT.md

### Decision Point: What's Next?

**Option A (Fastest):** Skip Phase 0 → Go straight to Phase 3
- Time: ~2 hours to first tests
- Risk: May need fixes if config missing

**Option B (Recommended):** Do Phase 0 first, then Phase 3
- Time: ~3 hours total
- Benefit: Cleaner execution, fewer issues

**Option C:** Review audit first
- Read: docs/E2E_TEST_CATEGORIES.md
- Then choose A or B

---

## How to Invoke

### Direct Command
```bash
/e2e-pipeline
```

### In Conversation
```
Activate the e2e-pipeline skill
```

### Manual Orchestration
```
1. Choose your path (A, B, or C above)
2. Follow prompts for each phase
3. Review outputs before proceeding
4. Spawn agents as instructed
```

---

## Phase 0: Infrastructure Fix (OPTIONAL)

**Fixer Agent applies:**
- Add rl-age-gate rate limit config to Program.cs
- Ensure appsettings.Test.json has higher rate limits for tests
- Verify Docker health checks
- Isolate test database from dev

---

## Phase 3: Test Generation

### Step 1: Planner Agent
Creates comprehensive test plan from audit
- Maps all test scenarios
- Defines happy paths, error cases, edge cases
- Plans data isolation with UUIDs

### Step 2: Generator Agent
Creates actual Playwright test files
- Semantic locators only
- UUID test data
- Fixtures & cleanup
- ~80 test files total

### Step 3: Healer Agent (On-Demand)
Fixes failing tests
- Selector issues → new locators
- Timeouts → increased timeouts
- Logic issues → corrected assertions

---

## Quick Reference

**Files:**
- Input: docs/E2E_TEST_CATEGORIES.md (the audit)
- Output: frontend/e2e/tests/**/*.spec.ts (tests)

**Commands:**
```bash
npm run test:e2e              # Run tests locally
TEST_ENV=staging npm run test:e2e  # Run with staging config
npx playwright show-trace test-results/trace.zip  # View failures
```

**Timeline:**
- Phase -1: 60 min ✅ DONE
- Phase 0: 20 min (optional)
- Phase 3: ~2 hours
- **Total: ~3 hours**

---

## Next Step

**Ready to proceed? Choose:**

1. **Phase 3 (Planner)** - Start test generation now
2. **Phase 0 (Fixer)** - Fix infrastructure first
3. **Review audit** - Read E2E_TEST_CATEGORIES.md before deciding

Type your choice and I'll activate the right agent!
