# E2E Testing Pipeline Orchestration

**Version:** 2.0  
**Status:** Active  
**Last Updated:** 2026-06-11

Complete end-to-end pipeline for generating production-ready Playwright tests for Portal Aurora.

---

## 🎯 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    E2E TESTING PIPELINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PHASE -1: AUDIT PREPARATION                                    │
│  ├─ Auditor Agent         → Generate comprehensive audit        │
│  ├─ Audit Reviewer Agent  → Validate completeness               │
│  └─ Gap Remediation Agent → Fix discrepancies                   │
│                                                                 │
│  PHASE 0: INFRASTRUCTURE FIX                                    │
│  ├─ Fixer Agent           → Apply infrastructure fixes          │
│  └─ Verifier Agent        → Confirm fixes work                  │
│                                                                 │
│  PHASE 3: TEST GENERATION                                       │
│  ├─ Planner Agent         → Map test scenarios                  │
│  ├─ Generator Agent       → Create test files                   │
│  └─ Healer Agent          → Fix failures                        │
│                                                                 │
│  OUTPUT: Production-ready test suite                            │
│          (~80 tests across all features)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase -1: Audit Preparation

### Purpose
Validate that the audit is comprehensive and accurate before any fixes or test generation.

### Sequential Execution

#### Step 1: Run Audit Reviewer Agent
**Input:** `E2E_TEST_CATEGORIES.md` (audit document)  
**Output:** `AUDIT_VALIDATION_REPORT.md` (validation results)

```bash
# Manually spawn (or use orchestrator):
# Agent: Audit Reviewer
# Task: Validate audit completeness
# Check: All routes, APIs, errors, integrations documented
```

**Acceptance Criteria:**
- ✅ 95%+ completeness score
- ✅ All critical areas spot-checked
- ✅ Code references verified
- ✅ Best practices aligned

**Decision Rules:**
- **95%+** → APPROVED (proceed to Gap Remediation)
- **85-94%** → APPROVED WITH NOTES (proceed, gaps noted)
- **<85%** → REJECTED (request re-audit)

#### Step 2: Run Gap Remediation Agent
**Input:** `AUDIT_VALIDATION_REPORT.md` (gaps identified)  
**Output:** `REMEDIATED_AUDIT_REPORT.md` (corrections documented)

```bash
# Manually spawn:
# Agent: Gap Remediation
# Task: Investigate each gap, correct audit
# For each gap:
#   1. Read actual code
#   2. Verify claim vs reality
#   3. Update audit with accurate info
```

**Gap Types Handled:**
- **CRITICAL:** Contract mismatches, status codes, security issues
- **IMPORTANT:** Business logic, configuration, parameters
- **NICE-TO-HAVE:** Documentation, missing features

**Output:** Corrected audit + code references

#### Step 3: Apply Corrections
**Manual Step:** Update `E2E_TEST_CATEGORIES.md` with all gap fixes

```bash
# Corrections to apply:
# 1. Login status code: 201 → 200
# 2. Add Client Registration endpoint
# 3. Payment API: campaignId → listingId/planId
# 4. Campaign billing: amount from budget, not request
# 5. Age gate: add rate limit config
```

**Result:** Audit is now 100% accurate

---

## Phase 0: Infrastructure Fix (Optional)

### Purpose
Apply infrastructure fixes identified during audit (optional, not blocking).

### Execution

```bash
# Spawn: Fixer Agent
# Task: Apply infrastructure corrections
# Examples:
#   - Add rl-age-gate rate limit config to Program.cs
#   - Verify Docker health checks present
#   - Ensure .env.test has all required variables
#   - Add test database isolation if missing
```

**Output:** Fixed infrastructure, ready for testing

---

## Phase 3: Test Generation

### Purpose
Generate production-ready Playwright E2E tests based on validated audit.

### Step 1: Run Planner Agent
**Input:** `E2E_TEST_CATEGORIES.md` (validated audit)  
**Output:** `TEST_PLAN.md` (detailed test scenarios)

```bash
# Spawn: Planner Agent
# Task: Map all test scenarios from audit
# For each feature category:
#   1. Happy path tests
#   2. Error scenario tests
#   3. Edge case tests
#   4. Integration tests
```

**Output:** Comprehensive test plan covering:
- ✅ Happy paths for all major flows
- ✅ Error scenarios (validation, auth, not found, conflicts)
- ✅ Edge cases (boundary values, timeouts, concurrent requests)
- ✅ Data isolation strategy (UUIDs, cleanup)
- ✅ Multi-browser execution (Chromium, Firefox, Mobile)

### Step 2: Run Generator Agent
**Input:** `TEST_PLAN.md`  
**Output:** `e2e/tests/*.spec.ts` (test files)

```bash
# Spawn: Generator Agent
# Task: Create actual Playwright test files
# Requirements:
#   - Semantic locators only (getByRole > getByLabel > getByTestId)
#   - UUID test data (no collisions)
#   - Proper fixtures & cleanup
#   - Explicit timeouts (environment-aware)
#   - Try...finally for data cleanup
#   - Comments for non-obvious steps only
```

**Output:** 
- `e2e/tests/auth/*.spec.ts` (8-10 tests)
- `e2e/tests/listings/*.spec.ts` (10-12 tests)
- `e2e/tests/campaigns/*.spec.ts` (6-8 tests)
- `e2e/tests/media/*.spec.ts` (8-10 tests)
- `e2e/tests/payments/*.spec.ts` (8-10 tests)
- `e2e/tests/admin/*.spec.ts` (10-12 tests)
- `e2e/tests/browse/*.spec.ts` (6-8 tests)
- `e2e/tests/client/*.spec.ts` (4-6 tests)

**Total:** ~80 tests across all features

### Step 2b: Run Test Auditor Agent (CRITICAL)
**Input:** Generated test files  
**Output:** `TEST_AUDIT_REPORT.md` (verification results)

```bash
# Spawn: Test Auditor Agent
# Task: Verify tests match actual code before execution
# Checks:
#   1. All selectors exist in actual HTML
#   2. All API endpoints exist with correct methods
#   3. Test data matches database schema
#   4. All assertions match actual behavior
#   5. No "ghost" features (testing non-existent things)
```

**Purpose:** Catch preventable test failures before execution
- ❌ "Element not found" → Caught at audit
- ❌ "Endpoint 404" → Caught at audit  
- ❌ "Validation failed" → Caught at audit

**Output:** `TEST_AUDIT_REPORT.md` with:
- ✅ Selector verification (all selectors resolvable)
- ✅ Endpoint verification (all endpoints exist, correct methods/params)
- ✅ Test data validation (all data matches schema)
- ✅ Assertion verification (all assertions match code behavior)
- ✅ Ghost feature detection (no tests for non-existent features)

**Decision:**
- **PASS** → Proceed to Step 3 (Run Tests)
- **FAIL** → Generator re-creates tests, Test Auditor re-audits

### Step 3: Run Tests

```bash
# Execute the audited tests
npm run test:e2e
```

**Expected:** All tests pass (audit caught all preventable failures)

### Step 4: Run Healer Agent (if needed)
**Input:** Test failure reports  
**Output:** Fixed test code

```bash
# Spawn: Healer Agent (on-demand)
# Triggered: When tests fail
# Task:
#   1. Analyze failure trace
#   2. Identify root cause (timeout, selector, logic)
#   3. Apply fix (new locator, increased timeout, etc.)
#   4. Output corrected test code
```

**Typical Fixes:**
- ❌ Element not found → ✅ Update to semantic locator
- ❌ Timeout waiting for page → ✅ Increase navigationTimeout
- ❌ Wrong assertion → ✅ Verify actual behavior vs test expectation
- ❌ Test data collision → ✅ Ensure UUIDs used
- ❌ Missing cleanup → ✅ Add try...finally

---

## Quick Start: Run Full Pipeline

### Option A: Manual Sequential (Recommended for First Run)

```bash
# Phase -1: Audit Prep
1. Spawn: Audit Reviewer Agent
   Input: docs/E2E_TEST_CATEGORIES.md
   Output: docs/AUDIT_VALIDATION_REPORT.md

2. Spawn: Gap Remediation Agent
   Input: docs/AUDIT_VALIDATION_REPORT.md
   Output: docs/REMEDIATED_AUDIT_REPORT.md

3. Manual: Apply corrections to E2E_TEST_CATEGORIES.md

# Phase 0: Infrastructure (Optional)
4. Spawn: Fixer Agent
   Task: Apply infrastructure fixes
   Output: Updated configuration

# Phase 3: Test Generation
5. Spawn: Planner Agent
   Input: docs/E2E_TEST_CATEGORIES.md
   Output: docs/TEST_PLAN.md

6. Spawn: Generator Agent
   Input: docs/TEST_PLAN.md
   Output: e2e/tests/**/*.spec.ts

7. Run: npm run test:e2e
   Verify: All tests pass

8. Spawn: Healer Agent (if needed)
   Fix: Any failing tests
```

### Option B: Automated Pipeline Script

```bash
#!/bin/bash
# ./scripts/e2e-full-pipeline.sh

set -e

echo "🚀 E2E Pipeline: Audit Prep → Test Generation"

# Phase -1: Audit
echo "📋 Phase -1: Audit Preparation"
echo "  1. Audit Reviewer..."
# Spawn Audit Reviewer Agent

echo "  2. Gap Remediation..."
# Spawn Gap Remediation Agent

echo "  3. Apply Corrections..."
# Manual step: apply fixes to E2E_TEST_CATEGORIES.md

# Phase 0: Infrastructure (Optional)
if [ "$RUN_FIXER" = "true" ]; then
  echo "🔧 Phase 0: Infrastructure Fix"
  # Spawn Fixer Agent
fi

# Phase 3: Test Generation
echo "✅ Phase 3: Test Generation"
echo "  1. Planner..."
# Spawn Planner Agent

echo "  2. Generator..."
# Spawn Generator Agent

echo "  3. Running tests..."
cd frontend
npm run test:e2e
TEST_RESULT=$?

if [ $TEST_RESULT -ne 0 ]; then
  echo "⚠️  Some tests failed. Spawning Healer Agent..."
  # Spawn Healer Agent
  exit 1
fi

echo "✅ All tests passed!"
echo "📊 Summary: ~80 tests generated and passing"
```

---

## Agent Definitions

### Phase -1 Agents

#### Audit Reviewer Agent
**File:** `agents/phase-minus-1-audit-reviewer.md`  
**Responsibility:** Validate audit completeness (95%+)  
**Input:** `E2E_TEST_CATEGORIES.md`  
**Output:** `AUDIT_VALIDATION_REPORT.md`  
**Time:** ~30 min

#### Gap Remediation Agent
**File:** `agents/phase-minus-1-gap-remediation.md`  
**Responsibility:** Fix audit inaccuracies before downstream phases  
**Input:** `AUDIT_VALIDATION_REPORT.md`  
**Output:** `REMEDIATED_AUDIT_REPORT.md`  
**Time:** ~20 min

### Phase 0 Agents

#### Fixer Agent
**File:** `agents/phase-0-fixer.md` (TBD)  
**Responsibility:** Apply infrastructure fixes  
**Input:** `REMEDIATED_AUDIT_REPORT.md`  
**Output:** Updated configuration files  
**Time:** ~20 min

### Phase 3 Agents

#### Planner Agent
**File:** `agents/phase-3-planner.md` (TBD)  
**Responsibility:** Map test scenarios from audit  
**Input:** `E2E_TEST_CATEGORIES.md`  
**Output:** `TEST_PLAN.md`  
**Time:** ~45 min

#### Generator Agent
**File:** `agents/phase-3-generator.md` (TBD)  
**Responsibility:** Generate test code  
**Input:** `TEST_PLAN.md`  
**Output:** `e2e/tests/**/*.spec.ts`  
**Time:** ~60 min

#### Test Auditor Agent
**File:** `agents/phase-3b-test-auditor.md`  
**Responsibility:** Verify tests match actual code before execution  
**Input:** Generated test files  
**Output:** `TEST_AUDIT_REPORT.md`  
**Time:** ~30 min

#### Healer Agent
**File:** `agents/phase-3-healer.md` (TBD)  
**Responsibility:** Fix failing tests (post-execution)  
**Input:** Test failure logs  
**Output:** Corrected test code  
**Time:** ~30 min (on-demand)

---

## Files Generated at Each Phase

```
Phase -1 Output:
  ✅ docs/AUDIT_VALIDATION_REPORT.md
  ✅ docs/REMEDIATED_AUDIT_REPORT.md
  ✅ docs/E2E_TEST_CATEGORIES.md (corrected)

Phase 0 Output (optional):
  ✅ backend/appsettings.Test.json (if missing)
  ✅ docker-compose.test.yml (if missing)
  ✅ Program.cs (rate limit config added)

Phase 3 Output:
  ✅ docs/TEST_PLAN.md
  ✅ frontend/e2e/tests/**/*.spec.ts (~80 files)
  ✅ frontend/e2e/fixtures.ts (auth, cleanup)
  ✅ frontend/e2e/pom/*.ts (page objects)
  ✅ frontend/playwright-report/ (test results)
```

---

## Success Criteria

### Phase -1: Audit
- ✅ AUDIT_VALIDATION_REPORT.md shows 95%+ completeness
- ✅ All critical gaps identified and documented
- ✅ REMEDIATED_AUDIT_REPORT.md complete with code references
- ✅ E2E_TEST_CATEGORIES.md updated with corrections

### Phase 0: Infrastructure
- ✅ Rate limits configured in Program.cs
- ✅ Test environment variables set
- ✅ Docker health checks present
- ✅ Test database isolated

### Phase 3: Test Generation
- ✅ TEST_PLAN.md documents all scenarios
- ✅ 80+ test files generated
- ✅ All tests pass locally (npm run test:e2e)
- ✅ Tests pass in CI (docker + docker-compose.test.yml)
- ✅ Cross-browser coverage (Chromium, Firefox, Mobile)
- ✅ Trace/video retained for failures

---

## Timeline Estimate

| Phase | Task | Est. Time | Status |
|-------|------|-----------|--------|
| -1 | Audit Review | 30 min | ✅ Done |
| -1 | Gap Remediation | 20 min | ✅ Done |
| -1 | Apply Corrections | 10 min | ✅ Done |
| 0 | Infrastructure Fixes | 20 min | ⏳ Optional |
| 3 | Planner | 45 min | ⏳ Ready |
| 3 | Generator | 60 min | ⏳ Ready |
| 3b | **Test Auditor** (NEW) | 30 min | ⏳ Ready |
| 3 | Run Tests | 15 min | ⏳ Ready |
| 3 | Healer (if needed) | 30 min | ⏳ On-demand |
| **Total** | **Full Pipeline** | **~3.5 hours** | ✅ Ready to start |

---

## Next Steps

1. **Proceed to Phase 3 (Test Generation)**
   ```bash
   # Spawn: Planner Agent
   # Input: docs/E2E_TEST_CATEGORIES.md (now validated & corrected)
   # Task: Map all test scenarios
   ```

2. **Or fix infrastructure first (Phase 0)**
   ```bash
   # Spawn: Fixer Agent
   # Task: Add missing rate limit config, env vars, etc.
   ```

3. **Or run full pipeline automatically**
   ```bash
   ./scripts/e2e-full-pipeline.sh
   ```

---

**Pipeline Ready:** ✅ Phase -1 Complete  
**Status:** Ready for Phase 3 test generation  
**Approval:** User decision on Phase 0 vs direct to Phase 3
