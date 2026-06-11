# Agent Coordination Guide

**How the 7 E2E agents work together**

---

## Agent Pipeline & Data Flow

```
START: User runs e2e-playwright /path/to/project
  │
  ├─ PHASE -1: Production Readiness (Infrastructure Audit + Fix)
  │
  ├─ [01-AUDITOR AGENT]
  │   Reads: Entire codebase (frontend, backend, infra)
  │   Compares: Against best practices + official docs
  │   Outputs: AUDIT_REPORT.md (findings with file:line refs)
  │   Memory: Stores audit findings
  │   ↓
  │   
  ├─ [02-AUDIT REVIEWER AGENT] ⭐ NEW
  │   Reads: AUDIT_REPORT.md
  │   Validates: Completeness of audit (spot-check critical areas)
  │   Outputs: AUDIT_VALIDATION_REPORT.md (approve or reject audit)
  │   Memory: Stores validation results
  │   ↓
  │   If REJECTED → Auditor re-checks flagged areas
  │   If APPROVED → Continue to Fixer
  │   ↓
  │   
  ├─ [03-FIXER AGENT]
  │   Reads: AUDIT_REPORT.md
  │   Actions: Auto-fixes identified issues (config, infrastructure)
  │   Commits: Each fix with git commit
  │   Outputs: FIX_REPORT.md (before/after, verification status)
  │   Memory: Stores fixes applied
  │   ↓
  │   
  ├─ [03-VERIFIER AGENT]
  │   Reads: FIX_REPORT.md
  │   Checks: Type checking, linting, Docker, health, API, env vars
  │   Outputs: VERIFICATION_REPORT.md (all checks PASS/FAIL)
  │   Memory: Stores verification results
  │   ↓
  │   If VERIFICATION FAILS → STOP, human review needed
  │   If VERIFICATION PASSES → Continue to PHASE 3
  │
  ├─ PHASE 3: Test Generation (Plan + Generate)
  │
  ├─ [04-PLANNER AGENT]
  │   Inputs: Verified infrastructure + actual codebase
  │   Reads: Routes, components, API handlers (code-reading)
  │   Explores: App via Playwright (user flows)
  │   Outputs: TEST_PLAN.md (scenarios with code references)
  │   Memory: Stores test plan + patterns
  │   ↓
  │   
  ├─ [05-GENERATOR AGENT]
  │   Reads: TEST_PLAN.md
  │   Verifies: Component selectors in actual code
  │   Verifies: API response structures in actual code
  │   Generates: test-file.spec.ts + POM classes
  │   Outputs: Test files ready to run
  │   Memory: Stores generated test patterns
  │   ↓
  │   Compilation: npm run typecheck
  │   If TYPE ERRORS → Generator fixes or escalates
  │   ↓
  │   
  ├─ [06-EXECUTOR AGENT] (automated)
  │   Runs: npm run test:e2e:local
  │   Parses: Test results
  │   Outputs: TEST_RESULTS.md
  │   Memory: Stores execution metrics
  │   
  │   If TESTS PASS → Go to Consolidator
  │   If TESTS FAIL → Go to Healer
  │   ↓
  │
  ├─ [07-HEALER AGENT] (if tests fail)
  │   Reads: Test failure output
  │   Diagnoses: Root cause (with code reading)
  │   Attempts: Fix (up to 3 tries)
  │   Outputs: HEALED_TESTS.md (diagnosis + fixes)
  │   Memory: Stores healing patterns
  │   ↓
  │   If FIXED after ≤3 attempts → Back to Executor
  │   If STILL BROKEN after 3 attempts → Escalate to human
  │   If ALL TESTS PASS → Go to Consolidator
  │   ↓
  │
  ├─ [08-CONSOLIDATOR AGENT]
  │   Reads: All prior reports (Audit through Healed)
  │   Extracts: Patterns (succeeded, watched, avoided)
  │   Computes: Metrics (time, confidence, quality)
  │   Outputs: CONSOLIDATION_REPORT.md
  │   Memory: Stores consolidated learning for future features
  │   ↓
  │
  END: Feature complete, ready for PR/merge
```

---

## Agent Responsibilities

### Agent 1: Auditor (Phase -1)
**Input:** Project path + codebase
**Output:** AUDIT_REPORT.md
**Time:** 5-10 minutes
**Responsibility:** Read entire codebase, compare against best practices

**Skills Loaded:**
- architecture-patterns
- api-design-principles
- e2e-best-practices

**What It Checks:**
- Frontend: TypeScript, React, error handling, loading states
- Backend: API design, validation, authentication, error handling
- Infrastructure: Docker, environment variables, migrations

**Success:** AUDIT_REPORT.md generated with findings

---

### Agent 2: Audit Reviewer (Phase -1)
**Input:** AUDIT_REPORT.md + project path
**Output:** AUDIT_VALIDATION_REPORT.md
**Time:** 5 minutes
**Responsibility:** Validate audit completeness (critical quality gate)

**Skills Loaded:**
- architecture-patterns
- api-design-principles
- e2e-best-practices

**What It Validates:**
- Frontend checks: TypeScript, error handling, validation, hooks, loading states
- Backend checks: Input validation, error format, authentication, migrations
- Infrastructure checks: Health checks, env vars, rate limiting, test setup

**Success:** AUDIT_VALIDATION_REPORT.md shows APPROVED (or flags gaps for re-audit)

---

### Agent 3: Fixer (Phase -1)
**Input:** AUDIT_REPORT.md + AUDIT_VALIDATION_REPORT.md (must be APPROVED) + project path
**Output:** FIX_REPORT.md + git commits
**Time:** 10-15 minutes
**Responsibility:** Automatically fix infrastructure issues

**Skills Loaded:**
- code-review-excellence
- e2e-best-practices

**What It Fixes:**
- ✅ TypeScript strict mode
- ✅ Docker health checks
- ✅ Environment variables
- ✅ ESLint/Prettier configuration
- ✅ Database migration setup
- ✅ Rate limiting configuration

**What It Escalates:**
- ⚠️ API endpoint design changes
- ⚠️ Business logic refactoring
- ⚠️ Database schema changes
- ⚠️ Authentication flow changes

**Success:** All fixable issues fixed, FIX_REPORT.md generated

---

### Agent 4: Verifier (Phase -1)
**Input:** FIX_REPORT.md + project path
**Output:** VERIFICATION_REPORT.md
**Time:** 5 minutes
**Responsibility:** Verify all fixes actually work

**Skills Loaded:**
- verification-before-completion

**What It Verifies:**
- [ ] TypeScript compilation pass
- [ ] ESLint linting pass
- [ ] Docker Compose syntax valid
- [ ] Docker services start healthy
- [ ] Database accessible
- [ ] API health endpoint responds
- [ ] Environment variables loaded
- [ ] Rate limiting configured

**Success:** All 8 checks show PASS

---

### Agent 5: Planner (Phase 3)
**Input:** Verified codebase + app running
**Output:** TEST_PLAN.md
**Time:** 10-15 minutes
**Responsibility:** Map test scenarios by reading code + exploring app

**Skills Loaded:**
- test-driven-development
- e2e-playwright-patterns

**Code-Reading Enforcement:**
- Reads actual route handlers (verify routes exist, auth)
- Reads actual components (find UI elements, exact text)
- Reads actual API handlers (copy response structure)
- References every assumption with file:line

**What It Plans:**
- Happy path scenarios (primary user flows)
- Error scenarios (what can go wrong)
- Edge cases (empty states, limits, conflicts)

**Success:** TEST_PLAN.md with 10-15 scenarios, all code-referenced

---

### Agent 6: Generator (Phase 3)
**Input:** TEST_PLAN.md + codebase
**Output:** test-files.spec.ts + POM classes
**Time:** 15-20 minutes
**Responsibility:** Generate production-ready Playwright test code

**Skills Loaded:**
- test-driven-development
- frontend-architecture
- e2e-playwright-patterns

**Code Verification:**
- Reads component code (verify selectors work)
- Reads API code (verify response structures)
- Verifies validation rules (test data matches schema)
- Includes code references in test comments

**What It Generates:**
- Test files following Arrange/Act/Assert pattern
- Page Object Model classes for reusability
- Fixtures for setup/cleanup
- Using semantic locators only (getByRole, getByLabel, getByText)

**Success:** All test files compile (npm run typecheck), ready to run

---

### Agent 7: Healer (Phase 3, if needed)
**Input:** Test failure output
**Output:** HEALED_TESTS.md + fixed test code
**Time:** 5 minutes per test (up to 3 attempts)
**Responsibility:** Diagnose and fix broken tests

**Skills Loaded:**
- test-driven-development
- e2e-debugging-patterns

**Root Cause Analysis:**
- Read error message
- Read actual component code
- Read actual API code
- Diagnose with code references

**What It Fixes:**
- Selector text mismatches
- Navigation timing issues
- API response structure mismatches
- Fixture setup failures
- Async/timing issues

**Escalation:**
- Tracks attempts (1, 2, 3)
- If still broken after 3: escalates to human with summary

**Success:** All tests passing OR clear escalation documented

---

### Agent 8: Consolidator (End)
**Input:** All prior reports
**Output:** CONSOLIDATION_REPORT.md + MemoryKit learning
**Time:** 10 minutes
**Responsibility:** Extract learning for future features

**Skills Loaded:**
- verification-before-completion

**What It Extracts:**
- Patterns that succeeded (100% success rate)
- Patterns that needed iteration (worked after healing)
- Patterns to avoid (failed, don't reuse)
- Time metrics per agent
- Confidence scores
- Reusable code artifacts

**What It Stores:**
- In MemoryKit for future feature automation
- Makes next similar feature 30-40% faster

**Success:** CONSOLIDATION_REPORT.md generated, learning in MemoryKit

---

## Memory Flow Between Agents

### What Each Agent Stores
```yaml
Auditor:
  - Audit findings (issue ID, severity, file:line, description)
  
Fixer:
  - Fixes applied (before/after, commit hash, verification status)
  
Planner:
  - Test plan findings (code-reading references, patterns observed)
  
Generator:
  - Generated test patterns (selectors, fixtures, POM structure)
  
Healer:
  - Failure patterns (root cause, solution, attempt count)
  
Consolidator:
  - Consolidated learning (patterns, metrics, recommendations)
```

### What Each Agent Retrieves
```yaml
Auditor:
  - Prior audit patterns (what issues were found before?)
  
Planner:
  - Prior test patterns (what scenarios were tested before?)
  
Generator:
  - Prior test patterns (what code patterns work?)
  
Healer:
  - Prior failure patterns (how were similar failures fixed?)
  
Consolidator:
  - ALL prior memories (compile comprehensive learning)
```

**Result:** Each feature compounds on prior feature learning.

---

## Failure & Escalation

### When Auditor Fails
- Can't read codebase
- Codebase not in git
- CLAUDE.md missing
→ Stop, ask human for help

### When Fixer Fails
- Fix breaks code
- Multiple fixes conflict
- Escalated issue can't be auto-fixed
→ Document attempt, flag for human review

### When Verifier Fails
- Check doesn't pass
- Service won't start
- Database not accessible
→ Stop, don't proceed to Phase 3

### When Planner Fails
- App not running
- Can't navigate to page
- Route doesn't exist
→ Stop, ask human to verify app is running

### When Generator Fails
- TypeScript compilation fails
- Selectors don't work
- Code references wrong
→ Fix and retry

### When Healer Fails (after 3 attempts)
- Test still failing
- Can't diagnose root cause
- Fix would require major refactoring
→ Escalate: document what tried, why failed

---

## Communication Between Agents

### Files Passed
```
Auditor → Fixer: AUDIT_REPORT.md
Fixer → Verifier: FIX_REPORT.md
Verifier → Planner: VERIFICATION_REPORT.md (+ fixed code)
Planner → Generator: TEST_PLAN.md
Generator → Executor: test-files.spec.ts (+ POM classes)
Executor → Healer: TEST_RESULTS.md (failure details)
Healer → Executor: HEALED_TESTS.md (fixed code)
Executor → Consolidator: TEST_RESULTS.md (final results)
Consolidator → (Memory): CONSOLIDATION_REPORT.md
```

### Critical Handoff Points
1. **Audit → Fixer:** Auditor must document findings clearly
2. **Fixer → Verifier:** Fixes must be validated (no breaking changes)
3. **Verifier → Planner:** Infrastructure must be proven working
4. **Planner → Generator:** Test plan must have code references
5. **Generator → Executor:** Tests must compile (TypeScript)
6. **Executor → Healer:** Failure output must be detailed
7. **Healer → Consolidator:** All attempts must be documented

---

## Success Criteria for Each Agent

| Agent | Done When |
|-------|-----------|
| **Auditor** | AUDIT_REPORT.md exists with findings + code refs |
| **Fixer** | All fixes applied, git commits created, FIX_REPORT.md generated |
| **Verifier** | VERIFICATION_REPORT.md shows all 8 checks PASS |
| **Planner** | TEST_PLAN.md exists with 10-15 scenarios, code-referenced |
| **Generator** | test-files.spec.ts generated, TypeScript compiles, code ready |
| **Executor** | TEST_RESULTS.md shows all tests pass (or failures for Healer) |
| **Healer** | All tests fixed (or clear escalation), HEALED_TESTS.md generated |
| **Consolidator** | CONSOLIDATION_REPORT.md generated, learning in MemoryKit |

---

## Time Budget

Expected time per phase:

| Phase | Activity | Budget |
|-------|----------|--------|
| **-1** | Auditor | 6-8 min |
| | Audit Reviewer | 4-5 min ⭐ NEW |
| | Fixer | 8-10 min |
| | Verifier | 4-5 min |
| | Subtotal | **22-28 min** |
| **3** | Planner | 10-15 min |
| | Generator | 15-20 min |
| | Executor | 2-3 min |
| | Healer (if needed) | 5-10 min |
| | Subtotal | **32-48 min** |
| **Post** | Consolidator | 8-10 min |
| | **TOTAL** | **62-86 min** |

**Avg:** 70 minutes end-to-end (includes critical audit validation)
**By Feature 5:** 60 minutes (faster with patterns)
