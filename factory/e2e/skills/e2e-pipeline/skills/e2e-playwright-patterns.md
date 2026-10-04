# E2E Playwright Patterns

**For:** Planner Agent, Generator Agent
**Purpose:** Proven patterns for writing maintainable, reliable Playwright tests

---

## Semantic Locator Hierarchy

Always prefer in this order:

### 1. getByRole (Best - Semantic HTML)
```typescript
// ✅ BEST - matches accessibility tree
page.getByRole('button', { name: 'Save' })
page.getByRole('heading', { level: 1 })
page.getByRole('textbox', { name: 'Email' })
page.getByRole('link', { name: 'Home' })
page.getByRole('table')
page.getByRole('row')

// Works for: buttons, links, headings, inputs, selects, tables, modals, etc.
// Breaks if: text changes, button HTML changes (rarely)
// Reason: Uses actual semantic HTML (accessibility first)
```

**Common Roles:**
- `button` — clickable buttons
- `link` — anchor tags
- `textbox` — text inputs
- `checkbox` — checkboxes
- `radio` — radio buttons
- `option` — select options
- `heading` — h1-h6 tags
- `table`, `row`, `cell` — table elements
- `dialog` — modals

### 2. getByLabel (Good - Form Labels)
```typescript
// ✅ GOOD - for labeled form inputs
page.getByLabel('Email Address')
page.getByLabel('Password')
page.getByLabel('Remember me')

// Only works if input has <label for="inputId">
// Breaks if: label text changes
// When to use: Form inputs with labels
```

### 3. getByText (Good - Exact Text)
```typescript
// ✅ GOOD - for text-based locators
page.getByText('Welcome to Dashboard')
page.getByText('No listings yet')
page.getByText(/^Error/i)  // Regex for flexible matching

// Breaks if: Text changes or similar text exists elsewhere
// When to use: Unique text content (headings, messages)
```

### 4. getByPlaceholder (Acceptable - Placeholder Text)
```typescript
// ⚠️ ACCEPTABLE - less reliable
page.getByPlaceholder('Enter email')

// Only works if placeholder attribute exists
// Breaks if: Placeholder changes
// When to use: Inputs without labels
```

### 5. locator() (Last Resort)
```typescript
// ❌ AVOID - brittle
page.locator('[data-testid="submit-btn"]')
page.locator('#user-form')
page.locator('.error-message')

// Why avoid:
// - Test IDs change with refactoring
// - IDs not semantic
// - CSS classes not semantic
// - Only use if absolutely no other option
```

---

## Fixture Patterns

### Basic Fixture Setup
```typescript
// frontend/e2e/fixtures.ts

import { test as base, expect } from '@playwright/test'
import { LoginPage } from './pom/LoginPage'

type TestFixtures = {
  loginAsAdvertiser: void
  loginAsAdmin: void
}

export const test = base.extend<TestFixtures>({
  // Fixture: Auto-login as advertiser before test
  loginAsAdvertiser: async ({ page }, use) => {
    // Setup: Login before test
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.fillEmail('advertiser@example.com')
    await loginPage.fillPassword('Test123!')
    await loginPage.clickSignIn()
    
    // Wait for successful redirect
    await page.waitForURL(/.*\/dashboard/)
    
    // Yield to test (test now runs with auth)
    await use()
    
    // Cleanup: Logout after test
    await page.evaluate(() => localStorage.clear())
    await page.evaluate(() => sessionStorage.clear())
  },

  loginAsAdmin: async ({ page }, use) => {
    const loginPage = new LoginPage(page)
    await loginPage.goto()
    await loginPage.fillEmail('admin@example.com')
    await loginPage.fillPassword('Test123!')
    await loginPage.clickSignIn()
    
    await page.waitForURL(/.*\/admin/)
    
    await use()
    
    await page.evaluate(() => localStorage.clear())
  },
})

export { expect }
```

### Using Fixtures in Tests
```typescript
import { test, expect } from '../fixtures'

test('AC1: Advertiser can see dashboard', async ({ page, loginAsAdvertiser }) => {
  // loginAsAdvertiser fixture runs before this block
  // User is already logged in, JWT is in localStorage
  
  // Test code here
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toContainText('Dashboard')
  
  // Cleanup happens after this block (fixture handles it)
})
```

**Fixture Lifecycle:**
1. Setup runs (login, database seed, etc.)
2. Test code runs (with setup state available)
3. Cleanup runs (logout, database cleanup, etc.)

---

## Page Object Model Pattern

### Basic POM
```typescript
// frontend/e2e/pom/LoginPage.ts

import { Page, Locator } from '@playwright/test'

export class LoginPage {
  private page: Page
  
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly signInButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page
    
    // Locators defined in constructor
    // Not evaluated until used (lazy evaluation)
    this.emailInput = page.getByLabel('Email Address')
    this.passwordInput = page.getByLabel('Password')
    this.signInButton = page.getByRole('button', { name: 'Sign In' })
    this.errorMessage = page.getByRole('alert')
  }

  // Methods for actions
  async goto() {
    await this.page.goto('/login')
  }

  async fillEmail(email: string) {
    await this.emailInput.fill(email)
  }

  async fillPassword(password: string) {
    await this.passwordInput.fill(password)
  }

  async clickSignIn() {
    await this.signInButton.click()
    // Wait for navigation after click
    await this.page.waitForURL(/.*\/dashboard/)
  }

  async getErrorText(): Promise<string> {
    return await this.errorMessage.textContent() ?? ''
  }
}
```

### Using POM in Tests
```typescript
test('User can login', async ({ page }) => {
  // Arrange - Create POM instance
  const loginPage = new LoginPage(page)
  
  // Act - Use POM methods
  await loginPage.goto()
  await loginPage.fillEmail('test@example.com')
  await loginPage.fillPassword('Test123!')
  await loginPage.clickSignIn()
  
  // Assert - Use POM locators
  await expect(loginPage.errorMessage).not.toBeVisible()
})
```

**POM Benefits:**
- Readable tests (method names describe intent)
- Maintainable (change selector in one place)
- Reusable (use same POM across multiple tests)
- Scalable (easy to add new pages)

---

## Test Data Patterns

### UUID for Unique Data
```typescript
import { v4 as uuid } from 'uuid'

test('Create new listing', async ({ page }) => {
  // ✅ GOOD - guaranteed unique per test
  const testId = uuid()
  const listingName = `Test Listing ${testId}`
  const listingCode = `CODE-${testId.substring(0, 8)}`
  
  // Fill form with unique data
  await page.getByLabel('Name').fill(listingName)
  await page.getByLabel('Code').fill(listingCode)
  await page.getByRole('button', { name: 'Create' }).click()
  
  // Verify unique data created
  await expect(page.getByText(listingName)).toBeVisible()
})
```

### Realistic Test Data
```typescript
// ✅ Use data that looks real
const testData = {
  email: `advertiser-${uuid()}@example.com`,
  name: 'John Smith',
  phone: '+1 (555) 123-4567',
  price: 99999,
  description: 'Beautiful property in prime location',
}

// ❌ Avoid fake data
const badData = {
  email: 'test@test.com',
  name: 'Test User',
  phone: '1234567890',
  price: 123,
  description: 'test test test',
}
```

### Pre-Created Test Data
```typescript
// Use API to create data before test
test('Edit existing listing', async ({ page, request }) => {
  // Create listing via API (fast)
  const createResponse = await request.post('/api/listings', {
    data: {
      name: 'Test Listing',
      price: 99999,
      location: 'New York',
    }
  })
  const { id } = await createResponse.json()
  
  // Navigate to edit page (in UI)
  await page.goto(`/listings/${id}/edit`)
  
  // Test editing the listing
  await page.getByLabel('Name').fill('Updated Listing')
  await page.getByRole('button', { name: 'Save' }).click()
  
  // Verify update
  await expect(page.getByText('Updated Listing')).toBeVisible()
})
```

---

## Test Isolation Patterns

### Cleanup After Each Test
```typescript
import { test } from '@playwright/test'

test.afterEach(async ({ page }) => {
  // Close any open modals/dialogs
  const closeButtons = page.locator('button[aria-label="Close"]')
  const count = await closeButtons.count()
  for (let i = 0; i < count; i++) {
    await closeButtons.first().click()
  }
  
  // Clear storage
  await page.evaluate(() => localStorage.clear())
  await page.evaluate(() => sessionStorage.clear())
  
  // Navigate to clean page if needed
  await page.goto('/')
})
```

### Independent Tests
```typescript
// ✅ GOOD - tests don't depend on each other
test('AC1: Login works', async ({ page }) => {
  // Arrange, Act, Assert
})

test('AC2: Dashboard loads', async ({ page, loginAsAdvertiser }) => {
  // This test can run in any order
  // loginAsAdvertiser fixture ensures clean auth state
})

// ❌ BAD - tests depend on each other
test('AC1: Create listing', async ({ page }) => {
  // Creates data for next test
})

test('AC2: Edit listing', async ({ page }) => {
  // Depends on AC1 creating data
  // Fails if AC1 doesn't run first
})
```

---

## Async Handling Patterns

### Wait for Elements
```typescript
// ✅ Wait for element to appear
await expect(page.getByText('Loading')).not.toBeVisible()
await page.getByRole('table').waitFor({ state: 'visible' })

// ❌ Don't use hardcoded sleeps
await page.waitForTimeout(2000)  // BAD - flaky
```

### Wait for Navigation
```typescript
// ✅ Wait for navigation to complete
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForURL(/.*\/listings\/.*\/edit/)

// Or use WaitForNavigation
const navigationPromise = page.waitForNavigation()
await page.getByRole('button', { name: 'Save' }).click()
await navigationPromise
```

### Wait for API Response
```typescript
// ✅ Wait for specific API response
const responsePromise = page.waitForResponse(response => 
  response.url().includes('/api/listings') &&
  response.status() === 200
)
await page.getByRole('button', { name: 'Save' }).click()
const response = await responsePromise
const data = await response.json()
console.log('API returned:', data)
```

### Polling Pattern
```typescript
// ✅ Wait for condition with polling
await expect(async () => {
  const text = await page.getByRole('cell', { name: /^5$/ }).textContent()
  expect(text).toBe('5')
}).toPass()

// Retries up to 5 seconds (default)
// Useful for async updates in table cells
```

---

## Error & Edge Case Patterns

### Empty State
```typescript
test('Empty state shown when no listings', async ({ page, loginAsAdvertiser }) => {
  // Navigate to listings page (user has no listings)
  await page.goto('/listings')
  
  // Verify empty state message
  await expect(
    page.getByText('You have no listings yet')
  ).toBeVisible()
  
  // Verify create button available
  await expect(
    page.getByRole('button', { name: 'Create First Listing' })
  ).toBeVisible()
})
```

### Error State
```typescript
test('Error message shown on failed save', async ({ page, loginAsAdvertiser }) => {
  // Navigate to form
  await page.goto('/listings/new')
  
  // Try to save without filling required field
  await page.getByRole('button', { name: 'Create' }).click()
  
  // Verify error message
  const errorAlert = page.getByRole('alert')
  await expect(errorAlert).toContainText('Name is required')
})
```

### Loading State
```typescript
test('Loading indicator shown during save', async ({ page, loginAsAdvertiser }) => {
  // Navigate and fill form
  await page.goto('/listings/new')
  await page.getByLabel('Name').fill('Test Listing')
  
  // Click save and verify loading state appears
  const savePromise = page.getByRole('button', { name: 'Save' }).click()
  
  // Verify loading spinner visible
  await expect(page.getByRole('progressbar')).toBeVisible()
  
  // Wait for save to complete
  await savePromise
  
  // Verify loading spinner gone
  await expect(page.getByRole('progressbar')).not.toBeVisible()
})
```

---

## Accessibility & Semantic Patterns

### Use Semantic Selectors
```typescript
// ✅ Semantic
page.getByRole('button', { name: 'Save' })
page.getByRole('link', { name: 'Home' })
page.getByLabel('Email')

// ❌ Non-semantic (fragile)
page.locator('a.nav-link')
page.locator('input#email')
page.locator('[data-test-id="btn"]')

// Semantic selectors are also more accessible
// They match actual ARIA roles and labels
```

### Test with Accessibility in Mind
```typescript
test('Form is keyboard accessible', async ({ page }) => {
  await page.goto('/login')
  
  // Tab to email field
  await page.keyboard.press('Tab')
  const emailInput = page.getByLabel('Email')
  await expect(emailInput).toBeFocused()
  
  // Type email
  await page.keyboard.type('test@example.com')
  
  // Tab to password
  await page.keyboard.press('Tab')
  const passwordInput = page.getByLabel('Password')
  await expect(passwordInput).toBeFocused()
  
  // Type password
  await page.keyboard.type('Test123!')
  
  // Tab to submit and press Enter
  await page.keyboard.press('Tab')
  const submitButton = page.getByRole('button', { name: 'Sign In' })
  await expect(submitButton).toBeFocused()
  await page.keyboard.press('Enter')
})
```

---

## Common Anti-Patterns (Avoid These)

### ❌ Sleep Instead of Wait
```typescript
// BAD - unpredictable
await page.waitForTimeout(2000)
```

### ❌ Test ID Selectors
```typescript
// BAD - breaks if test ID removed
page.locator('[data-testid="user-name"]')
```

### ❌ Hardcoded Test Data
```typescript
// BAD - collides between tests
email = 'test@example.com'  // Same for every test
```

### ❌ Multiple Assertions
```typescript
// BAD - first failure stops test
test('Many things', async ({ page }) => {
  await expect(page.getByText('Welcome')).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(5)
  // If first fails, rest don't run
})
```

### ❌ Test Dependencies
```typescript
// BAD - tests depend on run order
test('Create user', async () => { /* creates user */ })
test('Edit user', async () => { /* depends on previous test */ })
```

---

## Summary: Playwright Best Practices

✅ **Always:**
- Use semantic locators (getByRole > getByLabel > getByText)
- Use fixtures for setup/cleanup
- Use POM classes for reusability
- Use UUID for unique test data
- Use wait for conditions (not sleeps)
- Write independent tests
- Test one thing per test
- Use clear test names (describe intent)

❌ **Never:**
- Use test IDs or CSS classes for selection
- Hardcode test data
- Use sleeps to wait for elements
- Have test dependencies
- Test implementation details (test behavior)
- Log secrets or sensitive data
- Commit hardcoded test passwords
