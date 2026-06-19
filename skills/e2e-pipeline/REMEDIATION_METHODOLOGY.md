# Phase 3: E2E Test Remediation (6-Phase Methodology)

**Purpose:** Systematically fix failing E2E tests without re-running generation  
**When to use:** After Phase 2 tests fail  
**Time:** 30-90 min per test category  
**Success criteria:** 100% pass rate across all 3 browsers (chromium, firefox, mobile-chrome)

---

## Integration with Cypher Claude Skills

This remediation methodology incorporates your core engineering skills:

- **`systematic-debugging`** — Phase 1-2 (Diagnosis & Analysis): Identify failure patterns and root causes
- **`test-driven-development`** — Phase 3 (Fix): Apply TDD principles when modifying tests
- **`code-review-excellence`** — Phase 4 (Verify): Quality-check fixes before committing
- **`verification-before-completion`** — Phase 4-5 (Verify & Commit): Ensure all fixes work end-to-end

**Activate skills as you work:**
```
Phase 1-2: Read ~/.claude/skills/software/systematic-debugging.md
Phase 3:   Read ~/.claude/skills/software/test-driven-development.md
Phase 4:   Read ~/.claude/skills/software/code-review-excellence.md
```

---

## Overview

When tests fail after generation, remediation follows a systematic 6-phase approach:

```
Test Suite Fails
       ↓
Phase 1: DIAGNOSE
├─ Run tests individually and as suite
├─ Identify which tests fail
└─ Check if failures are consistent across browsers
       ↓
Phase 2: ANALYZE
├─ Read error-context.md from test-results
├─ Compare expected vs actual (page/API behavior)
└─ Categorize root cause
       ↓
Phase 3: FIX
├─ Apply fixes based on root cause category
└─ Ensure fixes match actual code behavior
       ↓
Phase 4: VERIFY
├─ Re-run all tests
└─ Confirm 100% pass across all browsers
       ↓
Phase 5: COMMIT
└─ Create commit with clear fix summary
       ↓
Phase 6: PUSH
└─ Push to remote branch
```

---

## Phase 1: Diagnosis

### 1.1 Run Individual Test Groups
```bash
npm run test:e2e -- --grep "Category-HP"   # Happy path tests
npm run test:e2e -- --grep "Category-ER"   # Error handling tests
npm run test:e2e -- --grep "Category-EC"   # Edge cases tests
```

### 1.2 Observe Failure Patterns
Answer these questions:

- **Cross-test pollution?**
  - Tests pass individually but fail together → test data not cleaning up
  
- **Consistent failures?**
  - Same test fails in chromium, firefox, mobile-chrome → real issue
  - Fails only in one browser → browser-specific (rare)
  
- **All tests or subset?**
  - All tests in category fail → systemic issue (API contract, setup)
  - Some tests fail → isolated issue (selector, timing, data)

### 1.3 Collect Error Information
For each failing test:
- Save the error message
- Note the error-context.md location
- Capture which browsers fail
- Record whether it passes individually

### 1.4 Apply Systematic Debugging

**Use skill:** `systematic-debugging`

Treat failures like a puzzle:
- **Observation**: What actually failed? (error message, which test, which browser)
- **Hypothesis**: Why did it fail? (selector issue? API contract? timing? data?)
- **Test**: Run the failing test in isolation to confirm hypothesis
- **Root cause**: What's the actual problem in the code or test?

Don't assume — test your hypotheses:
```bash
# Isolate: Does it pass alone?
npm run test:e2e -- --grep "SpecificTest"

# Reproduce: Does it consistently fail?
npm run test:e2e -- --grep "SpecificTest" --repeat=3

# Compare: What changed from passing to failing?
git diff HEAD^ -- frontend/e2e/tests/...
```

---

## Phase 2: Analysis

### 2.1 Read Error Context
```bash
cat test-results/*/error-context.md
```

### 2.2 Compare Expected vs Actual
**Question:** What did the test expect vs what actually happened?

Examples:
- Expected: `campaignId` returned from API
- Actual: API returns 400 Bad Request
- **Root cause:** Test sending wrong payload format

---

## Phase 3: Fix Issues

### 3.1 Root Cause Categories & Fixes

| Category | Symptom | Fix |
|---|---|---|
| **API Payload Mismatch** | 400/422 errors | Update payload keys/format to match backend schema |
| **Selector Mismatch** | Element not found | Update selectors to match actual UI |
| **Cross-Test Pollution** | Pass individually, fail together | Add `test.afterEach()` cleanup |
| **Timing Issue** | Timeouts, element not visible | Add `.toBeVisible()` with timeout, use `waitForLoadState()` |
| **Test Data Issue** | Validation errors (missing fields) | Add required fields to test data |
| **API Contract Change** | Unexpected response shape | Update test assertions to match actual response |

### 3.2 Common Fixes

#### API Payload Mismatches
```typescript
// Before: Wrong format
const response = await api.post('/api/endpoint', {
  campaignId: id,
  status: 'Confirmed',
  amountCents: 10000
});

// After: Match backend expectations
const response = await api.post('/api/endpoint', {
  ExternalReference: id,      // Correct key name
  Status: 3,                   // Correct type (int, not string)
  TransactionId: 'tx-...'     // Correct key name
});
```

#### Selector Issues
```typescript
// Before: Looking for non-existent element
const button = page.locator('text=/register button/i');

// After: Match actual UI
const button = page.getByTestId('register-submit');
// or
const button = page.getByRole('button', { name: /registrar/i });
```

#### Cross-Test Pollution
```typescript
// Add cleanup
test.afterEach(async ({ api }) => {
  try {
    // Delete test data created during test
    await api.delete(`/api/resource/${testResourceId}`);
  } catch {
    // ignore cleanup errors
  }
});
```

#### Timing Issues
```typescript
// Before: Assumes element exists
const element = page.locator('[data-testid="result"]');

// After: Wait for visibility
await expect(element).toBeVisible({ timeout: 5000 });
await page.waitForLoadState('networkidle');
```

#### Test Data Issues
```typescript
// Before: Missing required fields
const listingResponse = await api.post('/api/listings', {
  title: 'Test',
  description: 'Test listing'
});

// After: Include all required fields
const listingResponse = await api.post('/api/listings', {
  title: 'Test',
  description: 'Test listing',
  firstName: 'Test',              // Required
  city: 'São Paulo',              // Required
  neighborhood: 'Centro'          // Required
});
```

### 3.4 Apply Test-Driven Development

**Use skill:** `test-driven-development`

When fixing tests:

1. **Red Phase**: Confirm the test fails with your understanding of the issue
2. **Green Phase**: Apply the minimal fix to make the test pass
3. **Refactor Phase**: Clean up the fix, ensure no duplication

Example workflow:
```typescript
// 1. RED: Run test, observe failure
npm run test:e2e -- --grep "CP-HP-03"

// 2. Understand the failure
// Error: Webhook returns 400 Bad Request
// Root cause: Wrong payload keys (campaignId vs ExternalReference)

// 3. GREEN: Apply minimal fix
// Change: { campaignId } → { ExternalReference }

// 4. Verify it passes
npm run test:e2e -- --grep "CP-HP-03"

// 5. REFACTOR: Clean up, check for duplication
// Is this pattern used elsewhere? Should we extract a helper?
```

---

## Phase 4: Verify

### 4.1 Apply Code Review Excellence

**Use skill:** `code-review-excellence`

Before committing, review your own fixes:

**Quality Checklist:**
- ✅ Does the fix address the ROOT cause (not a symptom)?
- ✅ Is the fix the MINIMAL change needed (no over-engineering)?
- ✅ Does it match the actual code behavior (not assumptions)?
- ✅ Are there similar issues elsewhere that need the same fix?
- ✅ Does the fix introduce any NEW test dependencies or brittleness?
- ✅ Is test cleanup complete (no pollution to other tests)?

**Common mistakes to catch:**
- Changing too much when only one line needs to change
- Fixing selectors without checking if the UI actually exists
- Adding waits that mask real timing issues instead of fixing them
- Forgetting to clean up created test data

### 4.2 Re-run All Tests

```bash
npm run test:e2e -- --grep "Category"
```

### 4.3 Success Criteria

**Use skill:** `verification-before-completion`

Verify BEFORE moving forward:

- ✅ All tests pass (or only intentional skips)
- ✅ No cross-test pollution detected (run tests multiple times)
- ✅ Tests pass in all 3 browsers (chromium, firefox, mobile-chrome)
- ✅ No timeouts or flakiness (run 3x to check for intermittent failures)
- ✅ Fixes don't break other test categories
- ✅ No console errors or warnings in test output

Run full validation:
```bash
# Run 3 times to catch intermittent failures
npm run test:e2e -- --grep "Category" --repeat=3

# Run all tests to ensure no regression
npm run test:e2e
```

### 4.4 If Still Failing
- Re-analyze error using systematic-debugging
- Check if multiple root causes (e.g., both API payload AND missing cleanup)
- Verify fix matches actual code behavior (read the backend endpoint)
- Consider if the test expectation is wrong (does the test expect wrong behavior?)

---

## Phase 5: Commit

### 5.1 Create Commit

**Use skill:** `verification-before-completion`

Commit only when ALL of Phase 4 success criteria are met:

```bash
git add frontend/e2e/tests/[category]/[category].spec.ts
git commit -m "fix(e2e): resolve [category] test failures - [test count] tests passing

Fixed [category] E2E test suite following remediation methodology:

Root causes identified:
- 3 API payload mismatches (selectors/format updated)
- 2 cross-test pollution (cleanup added)
- 1 test data issue (required fields added)

Methodology applied:
- Phase 1: Diagnosed cross-browser patterns
- Phase 2: Analyzed error contexts and root causes
- Phase 3: Applied fixes (TDD: Red → Green → Refactor)
- Phase 4: Verified across all 3 browsers
- Phase 5: Committed with clear messaging

Results: [X]/[X] tests passing across chromium, firefox, mobile-chrome"
```

### 5.2 Commit Message Format

- **Title:** fix(e2e): [clear summary of what was fixed]
- **Body:**
  - What failed and why (root causes with categories)
  - What was changed (specific changes by category)
  - Methodology applied (which phases, which skills)
  - Results (test count, pass rate, browsers)
  - Time taken (for pattern recognition across multiple remediation sessions)

**Example:**
```
fix(e2e): resolve campaigns test failures - 66 tests passing

Fixed campaigns E2E test suite (CP-HP, CP-ER, CP-EC):

Root causes identified:
- CP-HP-03: API payload mismatch (campaignId vs ExternalReference)
- CP-ER-02: Auth context issue (token not updated after login)
- CP-ER-04: Test expectation mismatch (backend ignores amountCents)
- CP-ER-09: Test data incomplete (missing firstName field)

Changes applied:
- Updated webhook payload to match Safe2Pay format
- Fixed API login flow to preserve token context
- Updated test data validation expectations
- Added required fields to test data

Methodology:
- systematic-debugging: Diagnosed patterns across 3 browsers
- test-driven-development: Red → Green → Refactor cycle
- code-review-excellence: Reviewed fixes for quality
- verification-before-completion: Verified across all browsers

Results: 66/66 tests passing (24 HP + 27 ER + 15 EC) across 3 browsers
Time: 45 minutes
```

---

## Phase 6: Push

```bash
git push origin [branch-name]
```

---

## Real Example: Campaigns Tests

**Problem:** CP-HP-03 Pix Webhook test failing with 400 Bad Request

### Phase 1: Diagnosis
- Run `npm run test:e2e -- --grep "CP-HP"` → 3 failures (chromium, firefox, mobile-chrome)
- Same test fails on all 3 browsers → systemic issue, not browser-specific

### Phase 2: Analysis
- Error: "Webhook call failed: httpStatus 400"
- Root cause: Test sending wrong payload format
  - Test sent: `{ campaignId, status: "Confirmed", amountCents }`
  - Backend expected: `{ ExternalReference, Status: 3, TransactionId }`

### Phase 3: Fix
```typescript
// Before (wrong)
const webhookResponse = await api.post('/internal/webhooks/pix', {
  campaignId,
  status: 'Confirmed',
  amountCents: 10000,
  transactionId: 'tx-' + Date.now(),
});

// After (correct)
const webhookResponse = await api.post('/internal/webhooks/pix', {
  ExternalReference: campaignId,
  Status: 3,
  TransactionId: 'tx-' + Date.now(),
});

// Also: Added missing initiate-billing call
const billingResponse = await api.post(
  `/api/v1/advertiser/campaigns/${campaignId}/initiate-billing`,
  { paymentMethod: 'PixAutomatico', amountCents: 10000 }
);
```

### Phase 4: Verify
- Run tests again: ✅ All 24 CP-HP tests pass (8 tests × 3 browsers)

### Phase 5-6: Commit & Push
```
commit 5494530
fix(e2e): resolve campaigns test failures - 66 tests passing

Fixed campaigns E2E test suite (CP-HP, CP-ER, CP-EC):
- CP-HP-03: Fixed Pix webhook payload to match Safe2Pay format
- CP-ER-02: Fixed API login to ensure proper token
- CP-ER-04: Updated validation test (backend ignores amountCents param)
- CP-ER-09: Added required fields to test data

Results: 66/66 tests passing (24 HP + 27 ER + 15 EC) across 3 browsers
```

---

## Error Categories Reference

See `ERROR_CATEGORIES.md` for:
- Complete error message → root cause mapping
- Common backend validation errors
- Timing/selector patterns by framework
- Test data schema templates

---

## Tips

1. **Always read actual backend code** before assuming test is wrong
   - Check endpoint contract
   - Look at validation rules
   - Understand request/response shape

2. **Run tests individually first** to separate pollution from real issues
   - If passes alone but fails in suite → pollution
   - If fails both ways → real issue

3. **Fix in batches by category**
   - All API payload issues together
   - All selectors together
   - All cleanup issues together
   - Easier to reason about, less chance of introducing bugs

4. **Verify across all browsers**
   - Don't assume chromium fix works in firefox/mobile
   - Run full suite before committing

5. **Test cleanup is critical**
   - Each test must leave clean state
   - `test.afterEach()` should delete all created resources
   - Previous test's data must not affect next test

---

## Skills Reference & Activation

This remediation methodology is built on four core engineering skills:

### `systematic-debugging` (Phases 1-2)
- **When**: Diagnosing why tests fail
- **How**: Observe patterns → form hypothesis → test → verify root cause
- **Read**: `~/.claude/skills/software/systematic-debugging.md`

### `test-driven-development` (Phase 3)
- **When**: Fixing failing tests
- **How**: Red (fail) → Green (minimal fix) → Refactor (clean up)
- **Read**: `~/.claude/skills/software/test-driven-development.md`

### `code-review-excellence` (Phase 4)
- **When**: Verifying fixes before committing
- **How**: Review your own fixes for quality, root-cause, minimal-change, coverage
- **Read**: `~/.claude/skills/software/code-review-excellence.md`

### `verification-before-completion` (Phases 4-5)
- **When**: Confirming all tests pass and committing
- **How**: Verify across all browsers, run multiple times, check for regressions
- **Read**: `~/.claude/skills/software/verification-before-completion.md`

**Recommended workflow:**
1. Open Phase 1 (Diagnosis) → Activate `systematic-debugging`
2. Open Phase 3 (Fix) → Activate `test-driven-development`
3. Open Phase 4 (Verify) → Activate `code-review-excellence` + `verification-before-completion`

---

## Integration with Full Loop

This Phase 3 runs automatically in the `e2e-full-loop-with-remediation` workflow:

```
Phase 0: Code audit (Researcher Agent)
Phase 1: Infrastructure fix (optional)
Phase 2: Test generation (Planner → Generator)
       ↓
Tests FAIL?
       ↓
Phase 3: REMEDIATION (This Guide - Systematic 6-Phase)
├─ Phase 1: DIAGNOSE (systematic-debugging)
├─ Phase 2: ANALYZE (systematic-debugging)  
├─ Phase 3: FIX (test-driven-development)
├─ Phase 4: VERIFY (code-review-excellence + verification)
├─ Phase 5: COMMIT (verification-before-completion)
└─ Phase 6: PUSH (to remote)
       ↓
Tests PASS?
       ↓
Phase 4: Finalize (Production-ready E2E suite)
```

When invoked:
```bash
npm run e2e:loop -- --feature "listing-search" --category "L-HP"
```

The Remediation Agent automatically:
1. Runs Phase 1-2 diagnosis (using systematic-debugging patterns)
2. Categorizes failures by root cause
3. Applies fixes from patterns library (using test-driven-development)
4. Verifies across all 3 browsers (using code-review-excellence + verification)
5. Commits with methodology summary (using verification-before-completion)

**Skills activated during remediation:**
- `systematic-debugging` (Phase 1-2) — Diagnose & Analyze
- `test-driven-development` (Phase 3) — Fix
- `code-review-excellence` (Phase 4) — Verify quality
- `verification-before-completion` (Phase 4-5) — Verify & Commit
