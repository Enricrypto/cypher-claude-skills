# E2E Debugging Patterns

**For:** Healer Agent
**Purpose:** Diagnose and fix E2E test failures efficiently

---

## Failure Classification

### Category 1: Selector Failures
**Symptoms:**
```
Error: locator expected single element matching selector,
       but found 0 elements
```

**Root Causes:**
1. Text changed in component code
2. Selector too generic (matches multiple elements)
3. Element not visible/rendered
4. Case sensitivity mismatch
5. Element in iframe or shadow DOM

**Diagnosis:**
```bash
# Read the component code
# src/components/LoginForm.tsx

# Compare:
# Test expects: getByRole('button', { name: 'Sign In' })
# Code has: <button>SignIn</button>  # Missing space!

# OR

# Test expects: getByText('Welcome')
# Code has: <h1>Welcome, {name}!</h1>  # Has dynamic content
```

**Fix Examples:**
```typescript
// ❌ BEFORE: Text doesn't match
page.getByRole('button', { name: 'SignIn' })

// ✅ AFTER: Exact text match
page.getByRole('button', { name: 'Sign In' })

// OR: Use regex for partial match
page.getByRole('button', { name: /sign in/i })

// OR: Scope to reduce matches
page.locator('form').getByRole('button', { name: 'Save' })
```

---

### Category 2: Navigation & Routing Failures
**Symptoms:**
```
Error: Target page, context or browser has been closed
Error: Timeout waiting for navigation
Error: Expected URL /dashboard but got /login
```

**Root Causes:**
1. App not running on expected port
2. API not responding (401, 500, timeout)
3. Auth token missing/invalid
4. Redirect URL incorrect
5. Navigation takes longer than expected

**Diagnosis:**
```bash
# Check if app is running
curl http://localhost:3000
# Should return HTML (200)

# Check if API is running
curl http://localhost:5000/health
# Should return {"status":"healthy"} (200)

# Check browser console for errors
# (Often shows actual error before timeout)

# Review fixture setup
# Did loginAsAdvertiser actually set token?
```

**Fix Examples:**
```typescript
// ❌ BEFORE: No wait for navigation
await loginPage.clickSignIn()
await expect(page).toHaveURL(/.*\/dashboard/)

// ✅ AFTER: Wait for intermediate states
await loginPage.clickSignIn()
// Wait for navigation to actually start
await page.waitForLoadState('networkidle')
// THEN verify URL
await expect(page).toHaveURL(/.*\/dashboard/)

// OR: More explicit
const navigationPromise = page.waitForNavigation()
await loginPage.clickSignIn()
await navigationPromise
```

---

### Category 3: Timeout Failures
**Symptoms:**
```
Error: Timeout waiting for getByRole('button', { name: 'Save' })
       to be enabled (30000ms)
```

**Root Causes:**
1. Form validation not complete
2. Async operation still running
3. Loading state not recognized
4. API request hanging
5. Component not rendering after state change

**Diagnosis:**
```bash
# Check component code for async operations
# src/components/forms/CreateListingForm.tsx

# Look for:
# 1. useState() hooks for loading state
# 2. useEffect() for side effects
# 3. API call promises
# 4. Form validation logic

# Check if loading state exists
# Look for isLoading, isPending flags
```

**Fix Examples:**
```typescript
// ❌ BEFORE: Element not actually enabled
await page.getByLabel('Name').fill('Test')
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()

// ✅ AFTER: Wait for validation to complete
await page.getByLabel('Name').fill('Test')
await page.getByLabel('Price').fill('99999')
// Button starts disabled, then becomes enabled after validation
await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
await page.getByRole('button', { name: 'Save' }).click()
```

---

### Category 4: Data Mismatch Failures
**Symptoms:**
```
Error: AssertionError: Expected [3] but got [undefined]
Error: Cannot read property 'listings' of undefined
```

**Root Causes:**
1. API response structure different from expected
2. Backend returning error instead of success
3. Database query returning null
4. Response not awaited before assertion
5. Field name changed in API

**Diagnosis:**
```bash
# Read API handler code
# src/handlers/listings.ts

# Compare:
# Test expects: response.listings[]
# API returns: response.data.listings[]  # Nested!

# Check API endpoint definition
# Verify status code on success (200 vs 201)
# Verify response structure matches code
```

**Fix Examples:**
```typescript
// ❌ BEFORE: Assumes simple response structure
const listings = await page.evaluate(() => window.apiResponse.listings)
await expect(listings).toHaveLength(3)

// ✅ AFTER: Handles actual API structure
const response = await page.evaluate(() => window.apiResponse)
const listings = response.data.listings  // Nested structure
await expect(listings).toHaveLength(3)

// OR: Test through UI instead of API
// (More reliable - tests what user sees)
const tableRows = page.getByRole('row')
await expect(tableRows).toHaveCount(4)  // 1 header + 3 data rows
```

---

### Category 5: Fixture/Setup Failures
**Symptoms:**
```
Error: loginAsAdvertiser fixture failed
       Error: POST /api/auth/login returned 500
```

**Root Causes:**
1. Test database not initialized
2. Migrations didn't run
3. Test user doesn't exist
4. API crashed during fixture setup
5. Environment variables not set

**Diagnosis:**
```bash
# Check if database is running
docker-compose ps
# postgres should show "healthy"

# Check if migrations ran
docker-compose exec api npm run migrate:status

# Check API logs
docker-compose logs api | tail -50

# Manually test API
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

**Fix Examples:**
```typescript
// ❌ BROKEN: Assumes user exists
export async function loginAsAdvertiser() {
  return await loginAPI('test@example.com', 'Test123!')
}

// ✅ FIXED: Create user first
export async function loginAsAdvertiser() {
  const { v4: uuid } = require('uuid')
  const testId = uuid()
  const email = `advertiser-${testId}@example.com`
  
  // Create user via API
  const createResponse = await request.post('/api/users', {
    data: {
      email,
      password: 'Test123!',
      role: 'advertiser'
    }
  })
  
  if (!createResponse.ok()) {
    throw new Error(`Failed to create test user: ${await createResponse.text()}`)
  }
  
  // Then login
  return await loginAPI(email, 'Test123!')
}
```

---

### Category 6: Race Condition Failures
**Symptoms:**
```
Error: Flaky test - passes sometimes, fails sometimes
Error: Element detached from DOM
```

**Root Causes:**
1. Async operation not awaited
2. Element removed before assertion
3. State changes during test
4. Timing-dependent behavior

**Diagnosis:**
```bash
# Run test multiple times
# Does it fail consistently or intermittently?
# If intermittent, likely a race condition

# Add explicit waits/polling
# See "Async Handling Patterns" in e2e-playwright-patterns.md
```

**Fix Examples:**
```typescript
// ❌ BEFORE: Race condition possible
await page.getByRole('button', { name: 'Delete' }).click()
const deletedText = page.getByText('Item deleted')
await expect(deletedText).toBeVisible()

// ✅ AFTER: Explicit wait removes race
await page.getByRole('button', { name: 'Delete' }).click()
// Wait for toast/notification to appear (specific element)
await expect(page.getByRole('status', { name: /deleted/i })).toBeVisible()
// Wait for it to disappear (auto-dismiss)
await expect(page.getByRole('status')).not.toBeVisible()
```

---

## Debugging Tools & Techniques

### Browser Inspector
```typescript
// Pause test to inspect browser state
test('Debug selector', async ({ page }) => {
  await page.goto('/listings')
  
  // Inspector mode - browser stays open, can inspect elements
  await page.pause()
  
  // Test continues after you close inspector
})
```

### Console Logs in Browser
```typescript
// Access browser console from Node.js
page.on('console', (msg) => console.log('BROWSER:', msg.text()))
```

### Screenshots & Videos
```typescript
// Automatic screenshots on failure
test('Example', async ({ page }) => {
  // playwright.config.ts has:
  // screenshot: 'only-on-failure'
  // video: 'retain-on-failure'
  
  // On failure, screenshot and video saved to test-results/
})
```

### Trace Files
```typescript
// Enable tracing for debugging
// playwright.config.ts:
use: {
  trace: 'on-first-retry',  // Trace on first failure/retry
}

// Use: npx playwright show-trace test-results/trace.zip
// Opens interactive viewer showing all actions
```

---

## Systematic Debugging Process

### Step 1: Read the Error Message
```
What does it say exactly?
- Timeout waiting for X?
- Element not found?
- Navigation failed?
- Assertion failed?
```

### Step 2: Reproduce Manually
```bash
# Run the test in isolation
npx playwright test tests/dashboard.spec.ts -g "AC1"

# Or in headed mode to see browser
npx playwright test tests/dashboard.spec.ts -g "AC1" --headed
```

### Step 3: Inspect Code References
```bash
# Read actual component code
cat src/app/dashboard/page.tsx | head -50

# Read API handler code
cat src/handlers/listings.ts | head -50

# Compare with test expectations
```

### Step 4: Add Diagnostic Logs
```typescript
test('Dashboard loads', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  
  console.log('🔍 Navigating to dashboard...')
  await dashboard.goto()
  
  console.log('🔍 Waiting for table...')
  const table = page.getByRole('table')
  await table.waitFor({ state: 'visible' })
  console.log('✅ Table visible')
  
  console.log('🔍 Counting rows...')
  const rows = table.getByRole('row')
  const rowCount = await rows.count()
  console.log(`✅ Found ${rowCount} rows`)
  
  await expect(rows.count()).toBeGreaterThan(0)
})
```

### Step 5: Check External Systems
```bash
# Is database running?
docker-compose ps

# Is API responding?
curl http://localhost:5000/health

# Check API logs
docker-compose logs api | tail -20

# Check database
docker-compose exec postgres psql -U postgres -d myapp_test -c "SELECT COUNT(*) FROM listings;"
```

### Step 6: Apply Fix & Verify
```bash
# Make fix in test code
# Verify fix is correct by reading code references
# Re-run test
npx playwright test tests/dashboard.spec.ts -g "AC1" --headed

# Run full suite to ensure no regressions
npx playwright test
```

---

## Common Fix Patterns

### Fix 1: Wait for Condition, Not Time
```typescript
// ❌ WRONG
await page.waitForTimeout(2000)

// ✅ RIGHT
await expect(page.getByText('Loading')).not.toBeVisible()
```

### Fix 2: Use Specific Selectors, Not Generic
```typescript
// ❌ WRONG - might match unintended element
page.locator('button')  // Multiple buttons!

// ✅ RIGHT - specific, scoped
page.getByRole('button', { name: 'Save' })
// Or if in form context:
page.locator('form').getByRole('button', { name: 'Save' })
```

### Fix 3: Read Actual Code First, Then Test
```typescript
// ❌ WRONG - assume button text
page.getByRole('button', { name: 'Submit' })

// ✅ RIGHT - read code first
// src/components/LoginForm.tsx line 45 shows: <button>Sign In</button>
page.getByRole('button', { name: 'Sign In' })
```

### Fix 4: Verify Response Structure, Not Values
```typescript
// ❌ WRONG - API structure might differ
const name = response.user.name

// ✅ RIGHT - read API handler first
// src/handlers/auth.ts shows response structure
// { token, user: { id, email, name } }
const name = response.user.name
```

---

## Healing Checklist

When healing a failed test:

- [ ] Read error message and understand failure type
- [ ] Read actual component/API code (not assumptions)
- [ ] Verify selector matches code exactly
- [ ] Verify API response structure matches code
- [ ] Add appropriate wait conditions (no sleeps)
- [ ] Check for async/loading states
- [ ] Verify fixture setup is correct
- [ ] Check database is initialized
- [ ] Re-run test in isolation
- [ ] Re-run full suite (check for regressions)
- [ ] Document root cause (for MemoryKit)
- [ ] Verify fix in headed mode if possible

---

## Root Cause Categories (for Memory)

When documenting a fix, categorize as:

1. **Selector mismatch** — Component text/attributes changed
2. **Timing issue** — Missing waits, async not complete
3. **API structure** — Response format different than expected
4. **Fixture failure** — Setup couldn't create test data
5. **Navigation** — URL/routing different than expected
6. **Environment** — Database/API not ready
7. **Race condition** — Timing-dependent behavior

Example memory entry:
```
Pattern: Selector mismatch - button text changed
Root Cause: Component button text updated from "Submit" to "Create New"
Solution: Updated test to use getByRole('button', { name: 'Create New' })
Frequency: 2 times across 5 features (40% of failures)
Prevention: Always read component code before writing selectors
```

This helps future features avoid same mistakes.
