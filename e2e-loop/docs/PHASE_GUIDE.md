# Phase Guide: Detailed Walkthrough

**Purpose:** Step-by-step explanation of each phase, what agents do, what harness validates

---

## Phase -1: Audit Preparation

### Purpose
Create a comprehensive, validated audit of the codebase that serves as ground truth for test generation.

### Who Does What

#### Step 1: Code Auditor Agent
**Input:** Feature name, path, codebase  
**Output:** `AUDIT_REPORT.md`

Audits the feature across 5 dimensions:

1. **Routes & Pages** — What pages exist? What components used?
2. **API Endpoints** — What endpoints called? What schemas?
3. **State Management** — How is data managed? Zustand? Context? Hooks?
4. **Error Handling** — How are errors displayed? What error states?
5. **Edge Cases** — Empty states? Loading? Errors? Race conditions?

**Example Output:**
```markdown
# Feature Audit: Advertiser Dashboard

## Routes & Pages
- `/painel/dashboard` → DashboardPage component
- `/painel/dashboard/campaigns` → CampaignsList component
- ...

## API Endpoints
- GET /api/advertiser/dashboard → { stats, charts, ... }
- POST /api/campaigns → { campaignId, status, ... }
- ...

## Error Handling
- Network errors show toast notification
- Validation errors inline on form
- 404 Not Found → error page
```

#### Step 2: Audit Reviewer Agent
**Input:** AUDIT_REPORT.md  
**Output:** `AUDIT_VALIDATION_REPORT.json`

Validates the audit on these dimensions:

| Dimension | Target | Scoring |
|-----------|--------|---------|
| Routes Coverage | 100% | % of routes documented |
| API Coverage | 100% | % of endpoints documented |
| Error Scenarios | 95%+ | % of error cases documented |
| Edge Cases | 95%+ | % of edge cases identified |

**Scoring Logic:**
```
completenessScore = (routes% + apis% + errors% + edges%) / 4

Score >= 95% → APPROVED
Score 85-94% → APPROVED WITH NOTES
Score < 85%  → REJECTED (re-audit)
```

**Example Output:**
```json
{
  "completenessScore": 97,
  "routesCoverage": 100,
  "apisCoverage": 98,
  "errorsCoverage": 96,
  "edgeCasesCoverage": 94,
  "gaps": [
    {
      "type": "IMPORTANT",
      "area": "Campaigns API",
      "description": "Missing POST /api/campaigns response on error",
      "suggestion": "Verify 409 conflict handling"
    }
  ],
  "recommendation": "APPROVED"
}
```

#### Step 3: Harness Gate Check
**Harness validates:**
- ✅ Completeness score >= 95%
- ✅ All CRITICAL gaps identified (if any)

**If < 95%:**
- Trigger Gap Remediation agent
- Agent reads code, fixes audit
- Re-validate

### Artifacts

```
e2e-loop/artifacts/phase-0-audit/
├── AUDIT_REPORT.md              ← Comprehensive audit
├── AUDIT_VALIDATION_REPORT.json ← Validation scores & gaps
└── REMEDIATED_AUDIT_REPORT.md   ← Final audit (after fixes)
```

### Key Point
The audit is ground truth. Everything that follows depends on this being accurate. That's why we validate it.

---

## Phase 0: Infrastructure (Optional)

### Purpose
Apply optional infrastructure fixes (config, Docker, environment setup).

### Who Does What

#### Fixer Agent
**Input:** Audit report  
**Output:** `INFRASTRUCTURE_FIXES.md`

**Examples of infrastructure fixes:**
- Add rate limit config to backend
- Set environment variables in .env.test
- Configure Docker health checks
- Initialize test database

**Note:** This phase is optional. If no fixes needed, skip.

### Harness Gate Check
- ✅ Fixes documented (or explicitly skipped)

---

## Phase 1: Test Generation

### Purpose
Generate production-ready test files based on validated audit.

### Who Does What

#### Step 1: Test Planner Agent
**Input:** Remediated audit report  
**Output:** `TEST_PLAN.md`

Maps test scenarios in 3 categories:

```markdown
## Happy Path Tests (HP)
- AUTH-HP-001: User login with valid credentials
- AUTH-HP-002: User logout
- CAMPAIGNS-HP-001: Create campaign
- CAMPAIGNS-HP-002: List campaigns
- ...

## Error Handling Tests (ER)
- AUTH-ER-001: Login with invalid credentials → 401
- AUTH-ER-002: Login with expired token → 403
- CAMPAIGNS-ER-001: Create campaign with invalid budget → 400
- ...

## Edge Cases (EC)
- AUTH-EC-001: Login timeout
- CAMPAIGNS-EC-001: Create campaign with boundary values
- ...
```

**Requirements:**
- 3-5 tests per category
- Detailed steps and expected results
- Test data specifications
- Browser targets

#### Step 2: Test Generator Agent
**Input:** TEST_PLAN.md  
**Output:** Generated `.spec.ts` files

Creates actual Playwright test files:

```typescript
test.describe('Advertiser Dashboard', () => {
  let testData = {};

  test.beforeEach(async ({ api, page }) => {
    // 1. Register test user
    const user = await api.post('/api/auth/register', {
      email: `test-${randomUUID()}@example.com`,
      password: 'TestPassword123!'
    });
    // 2. Login
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Login' }).click();
    // 3. Navigate to feature
    await page.goto('/painel/dashboard');
  });

  test.afterEach(async ({ api }) => {
    // Cleanup: delete test user
    await api.delete(`/api/users/${testData.userId}`);
  });

  test('[HP-001]: User sees dashboard', async ({ page }) => {
    await expect(page.getByRole('heading')).toContainText('Dashboard');
  });
});
```

**Requirements:**
- ✅ Use semantic selectors (getByRole, getByLabel, getByTestId)
- ✅ UUID-based test data (unique per run)
- ✅ beforeEach + afterEach cleanup
- ✅ Explicit timeouts (toBeVisible with timeout)
- ✅ No hardcoded values

#### Step 3: Test Auditor Agent (Playwright MCP)
**Input:** Generated test files  
**Output:** `TEST_AUDIT_REPORT.md`

**This is critical.** Before running tests, verify they're correct:

1. **Selector Verification**
   - Navigate to live page
   - Try each selector
   - Verify it finds the element
   ```
   ✓ getByRole('button', {name: 'Login'}) exists
   ✗ getByRole('button', {name: 'Submit'}) not found
   ```

2. **API Verification**
   - Call each endpoint
   - Verify request payload accepted
   - Verify response schema matches
   ```
   ✓ POST /api/campaigns accepts { name, budget, ... }
   ✗ POST /api/campaigns returns { id, name, ... } but test expects { campaignId, ... }
   ```

3. **Ghost Feature Detection**
   - Flag any tests for non-existent features
   - Example: Test calls `/api/v2/campaigns` but only `/api/campaigns` exists

**Output:**
```markdown
# Test Audit Report

## Selector Verification
- ✓ 45/45 selectors found and verified
- ✗ Selector getByRole('button', {name: 'Submit'}) not found in AUTH-ER-002

## API Verification
- ✓ All endpoints exist and accept request schemas
- ✗ POST /api/campaigns response schema mismatch: test expects { campaignId }, backend returns { id }

## Ghost Features
- ✗ CAMPAIGNS-HP-003 tests POST /api/v2/campaigns (doesn't exist, use /api/campaigns)

## Verdict: FAIL
Cannot run tests until issues fixed.
```

#### Step 4: Harness Gate Check
**Before running tests, harness validates:**
- ✅ Test plan complete
- ✅ All tests generated
- ✅ Test audit passed (no ghost features, all selectors exist, API schemas match)

**If test audit fails:**
- Harness rejects phase advancement
- Developers fix issues
- Re-run test generator
- Re-run test auditor
- Only then proceed

#### Step 5: Mandatory Docker Rebuild (Harness)
Before running tests, harness executes:
```bash
docker-compose down --volumes
docker-compose build --no-cache  # Force fresh
docker-compose up -d
# Wait for services healthy
```

**Why?** Ensures tests run against fresh environment, not stale container.

#### Step 6: Run Tests (Harness)
```bash
npm run test:e2e --reporter=json
```

Harness captures:
- Total tests
- Passed / failed counts
- Pass rate
- Failed test details
- Browser results (chromium, firefox, mobile-safari)

### Artifacts

```
e2e-loop/artifacts/phase-2-test-generation/
├── TEST_PLAN.md
├── GENERATED_TESTS_MANIFEST.md
├── TEST_AUDIT_REPORT.md
└── TEST_RESULTS.json
```

### Key Points
- ✅ Test auditor prevents bad tests from running
- ✅ Docker rebuild ensures fresh state
- ✅ JSON results are machine-readable

---

## Phase 2: Remediation Loop (Only if tests failed)

### Purpose
Systematically fix failing tests until 100% pass rate is achieved.

### Loop Structure

```
Iteration 1-5:
  1. Mandatory Docker Rebuild
  2. Remediation Agent analyzes failures, applies fixes
  3. Run Tests (fresh results)
  4. Harness checks:
     - 100% pass? → Success, exit loop
     - Regressions? → Rollback, escalate
     - Max iterations? → Escalate
     - Improving? → Loop again
```

### Step 1: Mandatory Docker Rebuild (Harness)
Same as Phase 1: Fresh environment before every iteration.

### Step 2: Remediation Agent
**Input:** Failing test details from previous run  
**Output:** Fixed test files

Agent follows 6-phase methodology:

#### Phase 1: Diagnose
- Run tests individually and as suite
- Identify which tests fail
- Check cross-browser consistency
- Determine if it's pollution (pass alone, fail together) or real issue

#### Phase 2: Analyze
- Read error messages
- Compare what test expects vs what app actually does
- Categorize root cause:
  - API payload mismatch
  - Selector mismatch
  - Timing issue
  - Cross-test pollution
  - Test data issue

#### Phase 3: Fix
Apply fixes based on category:

```typescript
// Example: Selector Mismatch
// OLD: await page.locator('button.login').click();
// NEW: await page.getByRole('button', {name: 'Login'}).click();

// Example: API Contract
// OLD: const { campaignId } = await response.json();
// NEW: const { id } = await response.json(); // Backend returns 'id'

// Example: Timing
// OLD: await page.goto(url);
// NEW: await page.goto(url, {waitUntil: 'networkidle'});

// Example: Pollution
// OLD: (nothing)
// NEW: test.afterEach(async ({api}) => {
//   await api.delete(`/api/campaigns/${testData.campaignId}`);
// });
```

#### Phase 4: Verify
Agent confirms fixes work by re-running tests locally.

#### Phase 5: Commit
Document what was fixed and why.

#### Phase 6: Log
Create summary for harness.

### Step 3: Run Tests (Harness)
Execute tests with fresh Docker, capture results.

### Step 4: Harness Analysis

```
Check results:

✓ 100% pass rate?
  → Success, advance to Phase 3

✗ Regressions detected?
  → Rollback changes
  → Escalate to human (agent broke something)

✗ Iteration >= 5?
  → Escalate to human (max attempts reached)

✓ Pass rate improving?
  → Continue loop (iterate)

✗ Pass rate declining?
  → Escalate to human (stuck, getting worse)
```

### Artifacts

```
e2e-loop/artifacts/phase-3-remediation/
├── REMEDIATION_ITER_1.md
├── REMEDIATION_ITER_2.md
├── REMEDIATION_ITER_3.md
├── REMEDIATION_ITER_4.md
├── REMEDIATION_ITER_5.md
├── FINAL_TEST_RESULTS.json  (after 5 attempts)
└── ESCALATION_REPORT.json   (if escalated)
```

### Key Points
- ✅ Each iteration uses fresh Docker
- ✅ Max 5 iterations enforced
- ✅ Regressions auto-rollback
- ✅ Clear escalation to human

---

## Phase 3: Finalize

### Purpose
Create commit summary and prepare for PR review.

### Who Does What

#### Harness: Create Commit Summary
**Output:** `COMPLETION_REPORT.json`

```json
{
  "status": "COMPLETE",
  "timestamp": "2026-06-23T10:30:00Z",
  "feature": "advertiser-dashboard",
  "testsPassing": 45,
  "totalTests": 45,
  "passRate": 100,
  "remediationIterations": 0,
  "phases": {
    "audit": { "status": "PASS" },
    "infrastructure": { "status": "SKIPPED" },
    "testGeneration": { "status": "PASS" },
    "remediation": { "status": "PASS" },
    "finalize": { "status": "READY" }
  }
}
```

### Artifacts

```
e2e-loop/artifacts/phase-4-finalize/
└── COMPLETION_REPORT.json
```

### Key Points
- ✅ All phases complete
- ✅ 100% test pass rate
- ✅ Ready for human PR review

---

## Summary Table

| Phase | Purpose | Input | Output | Gate |
|-------|---------|-------|--------|------|
| -1 | Validate codebase | Code | Audit report | Score >= 95% |
| 0 | Infrastructure fixes | Audit | Config changes | Optional |
| 1 | Generate tests | Audit | Test files | Test audit + 100% pass |
| 2 | Fix failures | Failing tests | Fixed tests | 100% pass or escalate |
| 3 | Finalize | All tests | Commit summary | Ready for PR |

---

## Decision Points in Each Phase

### Phase -1
- Completeness score >= 95%?
  - YES → Advance to Phase 0
  - NO → Run gap remediation, re-validate

### Phase 0
- Infrastructure fixes completed?
  - YES → Advance to Phase 1
  - NO (skipped) → Advance to Phase 1

### Phase 1
- All tests generating correctly?
  - YES → Run test auditor
- Test auditor passed?
  - YES → Run tests with fresh Docker
  - NO → Fix issues, re-generate, re-audit
- 100% tests passing?
  - YES → Advance to Phase 3
  - NO → Advance to Phase 2 (remediation)

### Phase 2 (Remediation Loop)
For each iteration:
- 100% pass rate achieved?
  - YES → Advance to Phase 3
  - NO → Check next conditions
- Regressions detected?
  - YES → Rollback, escalate
  - NO → Check next conditions
- Iteration < 5?
  - YES → Loop again
  - NO → Escalate to human

### Phase 3
- All artifacts created?
  - YES → Pipeline complete, ready for PR
  - NO → Escalate

---

This structure ensures each phase is validated before advancing, with clear decision points and escalation paths.
