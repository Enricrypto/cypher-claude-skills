# Skill: E2E Testing Pipeline (Manual Orchestration)

**Name:** e2e-pipeline  
**Type:** Manual orchestration with guided decision points  
**Status:** Ready to use  
**Invocation:** Read `E2E_PIPELINE_ORCHESTRATION.md` for complete guide

---

## What This Skill Does

Guides you through the complete E2E testing pipeline with three phases:

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
  → Healer Agent: Fix failures (on-demand)
  → Verifier Agent: Confirm all fixes work
```

**Output:** Production-ready test suite (~80 tests)

---

## Quick Navigation

**🔗 Full Pipeline Guide:**
Read: `E2E_PIPELINE_ORCHESTRATION.md`

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
4. **Healer:** Fix any failing tests (on-demand)
5. **Verifier:** Confirm all fixes work end-to-end

**Input:** `E2E_TEST_CATEGORIES.md` (validated)  
**Output:** `e2e/tests/**/*.spec.ts` (~80 tests)  
**Time:** ~2.5 hours

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

1. **Read the full guide:**
   ```
   Read: E2E_PIPELINE_ORCHESTRATION.md
   ```

2. **Choose your path:**
   - Start with Phase 0 (recommended for new features)
   - Skip Phase 1 if infrastructure already configured
   - Follow Phase 2 to completion

3. **Spawn agents as documented** in the orchestration guide

4. **Review outputs** before proceeding to next phase

---

## Next Step

Ready to run the pipeline?

→ Read `E2E_PIPELINE_ORCHESTRATION.md` for complete details  
→ Decide: Phase 0 first, or skip to Phase 1/2?  
→ Get approval, then spawn agents
