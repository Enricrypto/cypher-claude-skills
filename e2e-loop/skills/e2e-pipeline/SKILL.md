# Skill: E2E Testing Loop (Manual + Automated Remediation)

**Name:** e2e-pipeline  
**Type:** Multi-phase loop with automated remediation  
**Status:** Ready to use  
**Invocation:** Read `E2E_LOOP_ORCHESTRATION.md` for complete guide

---

## What This Skill Does

Guides you through the complete E2E testing loop with four phases:

```
Phase 0: Audit Preparation
  → Audit Reviewer Agent: Validate completeness
  → Gap Remediation Agent: Fix discrepancies
  → Apply Corrections: Update audit with fixes

Phase 1: Infrastructure Fix (OPTIONAL)
  → Fixer Agent: Apply config fixes

Phase 2: Test Generation
  → Planner Agent: Map test scenarios
  → Generator Agent: Create test files
  → Test Auditor Agent: Verify tests match code
  → Run Tests: Execute test suite

Phase 3: Remediation (NEW - AUTO if tests fail)
  → Remediation Agent: 6-phase fix methodology
  → Diagnose failures (cross-browser, patterns)
  → Analyze root causes (API, selectors, data, timing)
  → Fix issues (payload, cleanup, selectors, waits)
  → Verify fixes across all browsers
  → Commit with clear summary
```

**Output:** Production-ready test suite (100% pass rate across 3 browsers)

---

## Quick Navigation

**🔗 Full Loop Guide:**
Read: `E2E_LOOP_ORCHESTRATION.md`

This file contains:
- ✅ Complete Phase 0, 1, 2 structure
- ✅ Agent definitions and responsibilities
- ✅ Step-by-step execution guide
- ✅ Success criteria for each phase
- ✅ Timeline estimates

---

## Phase 0: Audit Preparation

**Agents:**
- **Audit Reviewer:** Validate audit completeness (95%+ target)
- **Gap Remediation:** Fix identified gaps in audit
- **Apply Corrections:** Manual step to update E2E_TEST_CATEGORIES.md

**Input:** `E2E_TEST_CATEGORIES.md`  
**Output:** `REMEDIATED_AUDIT_REPORT.md`  
**Time:** ~60 min

---

## Phase 1: Infrastructure Fix (OPTIONAL)

**Agent:**
- **Fixer:** Apply infrastructure corrections

**Typical fixes:**
- Rate limit config in Program.cs
- Test environment variables
- Docker health checks
- Test database isolation

**Time:** ~20 min

---

## Phase 2: Test Generation

**Agents:**
1. **Planner:** Map test scenarios from audit
2. **Generator:** Create Playwright test files
3. **Test Auditor:** Verify tests match actual code
4. **Run Tests:** Execute test suite

**Input:** `E2E_TEST_CATEGORIES.md` (validated)  
**Output:** `e2e/tests/**/*.spec.ts` (~80 tests)  
**Time:** ~2.5 hours

---

## Phase 3: Remediation (NEW - Automated)

**When:** Automatically runs if Phase 2 tests fail  
**Agent:** Remediation Agent (uses 6-phase methodology)

**What it does:**
1. **Diagnose:** Run tests, identify failures, check cross-browser consistency
2. **Analyze:** Read error contexts, compare expected vs actual, categorize root causes
3. **Fix:** Apply fixes based on error category (API payloads, selectors, cleanup, timing, test data)
4. **Verify:** Re-run tests, confirm 100% pass across chromium, firefox, mobile-chrome
5. **Commit:** Create commit with clear fix summary
6. **Push:** Push to remote branch

**Methodology:** `REMEDIATION_METHODOLOGY.md`  
**Error Reference:** `reference/ERROR_CATEGORIES.md`

**Input:** Failing test suite + error contexts  
**Output:** Fixed tests + commit + push  
**Time:** 30-90 min per category  
**Success:** 100% pass rate across all browsers

---

## Quick Reference

**Files:**
- Audit: `docs/E2E_TEST_CATEGORIES.md`
- Plan: `docs/TEST_PLAN.md`
- Tests: `frontend/e2e/tests/**/*.spec.ts`

**Commands:**
```bash
npm run test:e2e              # Run tests locally
TEST_ENV=staging npm run test:e2e  # Run with staging config
npx playwright show-trace test-results/trace.zip  # View failures
```

---

## How to Use This Skill

### Manual Orchestration (Phases 0-2)

1. **Read the full guide:**
   ```
   Read: E2E_LOOP_ORCHESTRATION.md
   ```

2. **Choose your path:**
   - Start with Phase 0 (recommended for new features)
   - Skip Phase 1 if infrastructure already configured
   - Follow Phase 2 to completion

3. **Spawn agents as documented** in the orchestration guide

4. **Review outputs** before proceeding to next phase

### Automatic Remediation (Phase 3)

If Phase 2 tests fail:

1. **Remediation Agent automatically runs:**
   - Diagnoses failures
   - Analyzes root causes
   - Applies fixes
   - Verifies across browsers

2. **Reference materials during remediation:**
   - `REMEDIATION_METHODOLOGY.md` — Step-by-step 6-phase guide
   - `reference/ERROR_CATEGORIES.md` — Error → root cause → fix mapping

3. **Review committed fixes** before merging

---

## Integration with Full Loop

For fully automated orchestration (Phases 0-3):

```bash
npm run e2e:loop -- --feature "feature-name" --category "Category"
```

The workflow:
- Phase 0: Audits code
- Phase 1: Fixes infrastructure (optional)
- Phase 2: Generates tests
- Phase 3: Auto-remediates if tests fail
- Commits and pushes when ready

---

## Next Step

**Manual flow:** Read `E2E_LOOP_ORCHESTRATION.md` for Phase 0-2  
**Automated flow:** Use the `e2e-full-loop-with-remediation` workflow  
**Fixing failures:** Follow `REMEDIATION_METHODOLOGY.md` when tests fail
