# Error Categories & Root Cause Mapping

Quick reference for diagnosing and fixing E2E test failures.

---

## HTTP Status Errors

### 400 Bad Request
**Common causes:**
- ❌ Wrong JSON payload keys (case sensitivity)
- ❌ Wrong data types (string vs int, etc.)
- ❌ Missing required fields
- ❌ Invalid enum values

**How to fix:**
1. Read the actual backend endpoint code
2. Check request/response schema (OpenAPI spec, tests, handler)
3. Compare what you're sending vs what backend expects
4. Fix payload keys, types, values

**Example:**
```typescript
// WRONG
api.post('/webhook', { campaignId, status: 'Confirmed', amountCents: 100 })

// RIGHT (matches backend schema)
api.post('/webhook', { ExternalReference: campaignId, Status: 3, TransactionId: 'tx-...' })
```

---

### 401 Unauthorized
**Common causes:**
- ❌ API client has wrong/expired token
- ❌ Logged in as wrong user (test created resource with User A, API client is User B)
- ❌ Token not being passed in headers

**How to fix:**
1. Verify API client is initialized with correct token
2. Check that login happened before API call
3. If testing as different user, ensure API client re-authenticates
4. Use `api.post()` (not `page.request.post()`) to preserve auth context

**Example:**
```typescript
// WRONG: Different user contexts
const user1 = await api.post('/register', {...});  // User A creates resource
const user2 = await api.post('/register', {...});  // Switch to User B
await api.post(`/campaigns`, { ... });             // User B tries to access User A's resource → 401

// RIGHT: Stick with same user
const user = await api.post('/register', {...});
const campaign = await api.post('/campaigns', {...});
await api.post(`/campaigns/${campaign.id}`, {...});  // Same user throughout
```

---

### 403 Forbidden
**Common causes:**
- ❌ User doesn't own resource (created by different user)
- ❌ User doesn't have permission (wrong role)
- ❌ Resource is in wrong state for operation

**How to fix:**
1. Verify resource ownership (who created it?)
2. Check user role/permissions
3. Ensure resource is in correct state for operation

---

### 404 Not Found
**Common causes:**
- ❌ Resource ID doesn't exist (wrong ID, not created yet)
- ❌ Endpoint path is wrong
- ❌ Resource was deleted in previous test (pollution)

**How to fix:**
1. Verify resource was actually created (check response)
2. Verify ID format is correct
3. Add cleanup to `test.afterEach()` to prevent pollution

---

### 409 Conflict
**Common causes:**
- ❌ Resource in wrong state (trying to activate already-active listing)
- ❌ Duplicate action (trying to create duplicate, not unique constraint)
- ❌ State transition not allowed

**How to fix:**
1. Check resource state before action
2. Ensure action is allowed for current state
3. Check backend state machine logic

---

### 422 Unprocessable Entity
**Common causes:**
- ❌ Validation failed (missing required fields, invalid format)
- ❌ Business logic violation (amount too low, etc.)

**How to fix:**
1. Read error message (includes field names and reasons)
2. Add missing required fields
3. Fix field format/values

**Example:**
```
Error: 422 - "First Name' must not be empty.; The City field is required."

Fix:
await api.post('/listings', {
  title: '...',
  description: '...',
  firstName: 'Test',        // Was missing
  city: 'São Paulo',        // Was missing
  neighborhood: 'Centro'    // Was missing
});
```

---

### 429 Too Many Requests
**Common causes:**
- ❌ Rate limiting triggered (too many requests in time window)
- ❌ Test environment rate limit too low

**How to fix:**
1. Add delays between requests (use `await page.waitForTimeout(100)`)
2. Check test environment config (rate limits should be high/disabled in test)
3. Batch operations where possible

---

### 500 Internal Server Error
**Common causes:**
- ❌ Unhandled exception in backend
- ❌ Missing external service (e.g., CoinGecko for USDT rates)
- ❌ Database connection issue

**How to fix:**
1. Check backend logs (check test environment)
2. If external service, mock it or skip test in test env
3. Verify backend is running

---

## Selector/Timing Errors

### "Element not found"
**Common causes:**
- ❌ Selector is wrong (typo, changed UI)
- ❌ Element doesn't exist (feature not implemented)
- ❌ Element exists but not visible (hidden, display: none)
- ❌ Timing issue (element not rendered yet)

**How to fix:**
```typescript
// Before
const btn = page.locator('text=/submit/i');  // Fragile, breaks on text change

// After
const btn = page.getByTestId('submit-btn');  // Stable, explicit contract
await expect(btn).toBeVisible({ timeout: 5000 });  // Wait for visibility
```

---

### "Timeout waiting for element"
**Common causes:**
- ❌ Element takes too long to render
- ❌ API call slow
- ❌ Network is slow
- ❌ Element never appears (real issue, not timing)

**How to fix:**
```typescript
// Increase timeout
await expect(element).toBeVisible({ timeout: 10000 });

// Or wait for network idle before checking
await page.waitForLoadState('networkidle');
const element = page.getByTestId('result');
```

---

### "Locator is not stable"
**Cause:** Using semantic selectors (getByRole, getByLabel, getByText) which break on UI changes

**How to fix:**
```typescript
// Before (semantic - fragile)
page.getByRole('button', { name: /registrar/i })  // Breaks if text changes

// After (test ID - stable)
page.getByTestId('register-submit')  // Stable, UI-text-independent
```

---

## Cross-Test Pollution

### "Test passes alone, fails in suite"

**Root cause:** Previous test didn't clean up

**How to fix:**
```typescript
test.afterEach(async ({ api }) => {
  // Delete everything created in this test
  if (createdListingId) {
    try {
      await api.delete(`/api/listings/${createdListingId}`);
    } catch {
      // ignore cleanup errors
    }
  }
});
```

---

### "Random test failures"

**Root cause:** Flaky cleanup or timing

**How to fix:**
1. Make cleanup more robust
2. Add explicit waits before assertions
3. Verify test data is unique (UUIDs for email, phone, etc.)

---

## Test Data Issues

### "Validation failed: [field] must not be empty"

**Root cause:** Required field missing

**How to fix:**
Read the error message to identify which field, then add it:

```typescript
// Common required fields by entity:

// Listings
{ 
  title: '...',
  description: '...',
  firstName: '...',      // Required
  city: '...',           // Required
  neighborhood: '...'    // Required
}

// Campaigns
{
  listingId: '...',
  placementType: 'Feed'  // Required
}

// Payments
{
  paymentMethod: 'PixAutomatico',  // Required
  // (amountCents is ignored - uses campaign price)
}
```

---

### "Invalid format: [field]"

**Root cause:** Wrong type or format

**How to fix:**
Check backend schema:

```typescript
// Wrong types
{ age: '25' }           // String, should be number
{ status: 'active' }    // String, should match enum

// Right types
{ age: 25 }             // Number
{ status: 'Active' }    // Match exact enum value (case-sensitive)
```

---

## API Contract Mismatches

### "Expected X but got Y"

**Root cause:** Test expects wrong response shape

**How to fix:**
1. Read actual backend endpoint code
2. Check what it returns
3. Update test assertion

```typescript
// Check what API actually returns
const response = await api.post('/campaigns', {...});
console.log(response);  // See actual shape

// Update test
expect(response.id).toBeDefined();           // Right
expect(response.campaignId).toBeDefined();   // Wrong if it's 'id'
```

---

## Quick Diagnosis Flowchart

```
Test fails
  ↓
Is it an HTTP error (4xx/5xx)?
  ├─ YES: Look up status code above
  └─ NO: Go to next
  ↓
Is it a selector/timing error?
  ├─ YES: Fix selector or add waits
  └─ NO: Go to next
  ↓
Does it pass alone but fail in suite?
  ├─ YES: Cross-test pollution → add cleanup
  └─ NO: Go to next
  ↓
Is error about required/invalid field?
  ├─ YES: Fix test data
  └─ NO: Go to next
  ↓
Read error-context.md and compare:
- What test expected
- What API actually returned
- What code actually does
  ↓
Apply fix from categories above
```

---

## Testing Your Fix

After applying a fix:

```bash
# Run just the failing test
npm run test:e2e -- --grep "TestName"

# Run all tests in category
npm run test:e2e -- --grep "Category"

# Run full suite (verify no new failures)
npm run test:e2e -- --grep "Campaigns & Payments"
```

**Success:** ✅ All tests pass in chromium, firefox, mobile-chrome

