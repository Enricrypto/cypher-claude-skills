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

## 🚪 Deterministic Phase Gates

E2E loop enforces objective gates between phases. **Phases ONLY advance when ALL CRITICAL criteria are met.**

### Philosophy: "100% Acceptance Only"

No guessing. No "probably works." Only objective proof.

| Phase | Gate | Requirement |
|-------|------|---|
| **Phase 1** | Test Generation Valid | Tests planned, generated, audited ✅ |
| **Phase 2** | 100% Pass Rate | **ALL tests passing (0 failures)** |
| **Phase 3** | Phase 2 Passed | Only if Phase 2 gate approved ✅ |

### What This Prevents

**Before Gates:**
- ❌ Tests fail (30 failing)
- ❌ Remediation runs
- ❌ "Fixed" — but never verified
- ❌ Phase 3 advances anyway
- ❌ Broken tests shipped

**After Gates:**
- ❌ Tests fail (30 failing)
- Phase 2 gate: "BLOCKED — pass rate 33%"
- ✅ Loop back to remediation
- ✅ Re-run tests after each fix
- ✅ Only advance with proof (100% pass rate)
- ✅ Can't escape with <100% passing

### Remediation Loop Behavior

If tests fail in Phase 2:
1. Remediation Agent runs (fix tests)
2. **Tests re-run automatically**
3. **Gate checks new pass rate**
4. If 100% → **ADVANCE to Phase 3** ✅
5. If < 100% → **LOOP BACK** (max 5 iterations)
6. After 5 iterations → **ESCALATE to human** (no Phase 3)

### The Safety Guarantee

✅ Phase 3 (Finalize) ONLY runs if Phase 2 gate passed  
✅ Phase 2 gate ONLY passes with 100% test pass rate  
✅ No way to bypass this check  

**Result:** Every test suite that reaches Phase 3 has 100% passing tests.

---

## 🧠 Memory Integration (MemoryKit Learning System)

E2E loop agents learn from prior features and work faster each time.

### How It Works

**At start of loop:**
```
retrieve_context("e2e: prior test patterns and failure solutions")
```
This loads patterns from prior features (if any exist) so agents work ~30% faster.

**At end of each phase:**
Each agent stores what it learned:
- **Phase -1 (Audit):** Audit patterns + fix success rates
- **Phase 1 (Tests):** Test scenarios + proven patterns + what failed
- **Phase 2 (Remediation):** Failure solutions + root causes + fixes that worked
- **Consolidation:** All learning compiled for next feature

### Learning Progression

| Feature | Phase -1 | Phase 1 | Phase 2 | Total Time |
|---------|----------|---------|---------|-----------|
| **1** | 20 min | 60 min | 40 min | ~120 min (baseline) |
| **2** | 18 min | 50 min | 30 min | ~98 min (-18%) |
| **3-5** | 16 min | 45 min | 25 min | ~86 min (-28%) |
| **10+** | 14 min | 40 min | 20 min | ~74 min (-38%) |

**Result:** By feature 5, E2E testing is 30% faster. By feature 10, 40% faster.

### What Agents Retrieve & Use

- **Audit Reviewer:** Prior audit patterns + known issue types
- **Planner:** Prior test scenarios for similar features
- **Generator:** Proven test patterns (auth fixtures, selectors, waits)
- **Remediation:** Prior failure patterns + proven fixes
- **Consolidator:** All learning to extract reusable patterns

### Memory Tags

When stored, memories use these tags for easy retrieval:
- `e2e:audit` — Audit findings and patterns
- `e2e:test-patterns` — Proven test patterns
- `e2e:failures` — Failure patterns and solutions
- `e2e:consolidation` — Consolidated learning from full loop

See `reference/MEMORY_PATTERNS.md` for complete MemoryKit architecture.

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
