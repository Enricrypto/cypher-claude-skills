---
name: e2e-testing-playwright
description: Playwright E2E test suite architecture, fixtures, POMs, data isolation, mocking, and CI integration
metadata:
  type: skill
  applies_to: Test Verifier agents writing Playwright E2E suites
---

# E2E Testing with Playwright

Playwright E2E test suites require careful architecture to prevent flakiness and ensure test isolation. This skill defines the complete pattern for building production-grade E2E suites.

## Architecture Overview

Every Playwright E2E suite consists of:
1. **Playwright Config** — browsers, timeouts, retries, workers, projects
2. **Global Setup/Teardown** — seed data creation, cleanup
3. **Fixtures** — auth, seed, helpers (not Playwright's built-in fixtures; these are custom async functions)
4. **Page Objects (POMs)** — encapsulate selectors and page interactions
5. **Test Data Factories** — generate consistent, isolated test data
6. **Test Specs** — actual test cases using fixtures and POMs
7. **CI Workflow** — GitHub Actions job with Docker integration

## 1. Playwright Config (playwright.config.ts)

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,  // Global setup must run once first
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 1,
  reporter: 'html',
  timeout: 30_000,       // 30s per test
  expect: { timeout: 5_000 },  // 5s for assertions
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'docker compose up api frontend',
    port: 3000,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
})
```

**Key decisions:**
- `fullyParallel: false` — ensures global setup runs once before all tests
- `reuseExistingServer: false` — fresh Docker container per run (no stale state)
- `retries: 1 on CI, 0 locally` — catch flakiness in CI; fail fast locally
- Three browsers — chromium (primary), mobile-chrome (responsive), firefox (engine diversity)

## 2. Global Setup/Teardown

### global-setup.ts
```typescript
import { chromium, FullConfig } from '@playwright/test'
import fs from 'fs'

async function globalSetup(config: FullConfig) {
  // 1. Wait for Docker healthchecks
  await waitForHealthcheck('http://localhost:5000/health', 60_000)
  await waitForHealthcheck('http://localhost:3000/', 60_000)

  // 2. Create global seed data (1 advertiser + 1 listing)
  const seedData = await createGlobalSeed()

  // 3. Write to file for tests to reference
  fs.writeFileSync('seed-metadata.json', JSON.stringify(seedData, null, 2))

  console.log(`✓ Global setup complete. Seed advertiser: ${seedData.advertiserEmail}`)
}

async function waitForHealthcheck(url: string, maxWait: number): Promise<void> {
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`Healthcheck ${url} failed after ${maxWait}ms`)
}

async function createGlobalSeed() {
  // Create advertiser + listing via API or direct DB
  // Return { advertiserEmail, listingId, publishedAtTime }
}

export default globalSetup
```

### global-teardown.ts
```typescript
import fs from 'fs'
import { execa } from 'execa'
import { connectDb } from '@/lib/db'

async function globalTeardown() {
  // 1. Load seed metadata
  const seedData = JSON.parse(fs.readFileSync('seed-metadata.json', 'utf-8'))

  // 2. Delete test-marked data
  const db = await connectDb()
  const deletedAdvertisers = await db`
    DELETE FROM users 
    WHERE email LIKE 'test-%@e2e.test'
  `.then(r => r.count)
  
  const deletedListings = await db`
    DELETE FROM listings
    WHERE advertiser_id IN (
      SELECT id FROM users WHERE email LIKE 'test-%@e2e.test'
    )
  `.then(r => r.count)

  console.log(`✓ Cleanup: ${deletedAdvertisers} advertisers, ${deletedListings} listings deleted`)

  // 3. Docker cleanup
  await execa('docker', ['compose', 'down', '--volumes'])
}

export default globalTeardown
```

**Why separate setup/teardown:**
- Setup runs once before all tests (efficient)
- Teardown runs once after all tests (cleanup is isolated)
- Both run even if tests fail (via `always()` in CI)

## 3. Fixtures (Custom Functions)

Custom fixtures are **async functions that return test data or auth tokens**. They are NOT Playwright's built-in fixtures — they're reusable test helpers.

### auth.fixture.ts
```typescript
import { Page } from '@playwright/test'

/**
 * Logs in as advertiser via API (not UI clicks)
 * Stores JWT in localStorage for subsequent requests
 */
export async function loginAsAdvertiser(
  page: Page,
  email?: string,
  password?: string
): Promise<{ email: string; password: string; jwt: string }> {
  const testEmail = email || generateTestEmail()
  const testPassword = password || 'SecurePass123!'

  // 1. Register advertiser
  const registerRes = await page.request.post('/api/v1/auth/advertiser/register', {
    data: {
      email: testEmail,
      password: testPassword,
      phone: '11999999999',
      category: 'massoterapeuta',
      lgpdConsent: true,
    },
  })
  if (!registerRes.ok()) throw new Error(`Register failed: ${registerRes.status()}`)

  // 2. Verify email (mock verification)
  await mockEmailVerification(testEmail)

  // 3. Login and get JWT
  const loginRes = await page.request.post('/api/v1/auth/advertiser/login', {
    data: { email: testEmail, password: testPassword },
  })
  const { jwt } = await loginRes.json()

  // 4. Store in localStorage
  await page.context().addCookies([
    { name: 'jwt', value: jwt, url: 'http://localhost:3000' },
  ])

  return { email: testEmail, password: testPassword, jwt }
}

export async function loginAsClient(page: Page) {
  // Similar to advertiser but with different API endpoint
}

export async function loginAsAdmin(page: Page, totp?: string) {
  // Admin login with TOTP code generation
  const secret = process.env.TEST_ADMIN_TOTP_SECRET!
  const code = generateTOTPCode(secret)
  // ... login flow
}
```

### seed.fixture.ts
```typescript
/**
 * One-time global seed: creates 1 approved advertiser + 1 active listing
 * Called by global-setup.ts; data reused by all read-only tests
 */
export async function globalSeed(): Promise<{
  advertiserEmail: string
  listingId: string
  publishedAtTime: Date
}> {
  // Use direct DB or API to create
  // Return metadata for tests to reference
}

/**
 * Per-test seed: creates fresh account for mutation tests
 * Each test calls this at start to get isolated data
 */
export async function perSuiteSeed(role: 'advertiser' | 'client'): Promise<{
  email: string
  password: string
  jwt: string
}> {
  const email = generateTestEmail()
  const password = 'SecurePass123!'

  // Create account via API
  // Verify/activate automatically
  // Return { email, password, jwt }
}

/**
 * Cleanup: called at test end to delete test-marked data
 * Idempotent — safe to call even if rows already deleted
 */
export async function cleanup(testData: { email: string; listingIds?: string[] }): Promise<void> {
  // DELETE FROM users WHERE email = ?
  // DELETE FROM listings WHERE id IN (?, ...)
}
```

### helpers.fixture.ts
```typescript
import speakeasy from 'speakeasy'

/**
 * Generate TOTP code from secret (for admin login)
 */
export function generateTOTPCode(secret: string): string {
  return speakeasy.totp({
    secret: secret,
    encoding: 'base32',
    time: Math.floor(Date.now() / 1000),  // Current time
  })
}

/**
 * Mock payment webhook (simulate server-side confirmation)
 */
export async function mockPaymentWebhook(
  orderId: string,
  status: 'confirmed' | 'expired'
): Promise<void> {
  // POST /internal/webhooks/pix with mocked payload
  // DB updates order status_id to confirmed/expired
}

/**
 * Advance Playwright clock for timer tests
 * (no real time elapses; all test-time)
 */
export async function mockClockAdvance(page: Page, ms: number): Promise<void> {
  if (!page.context().locals?.clockInstalled) {
    await page.clock.install()
    page.context().locals = { clockInstalled: true }
  }
  await page.clock.fastForward(ms)
}

/**
 * Generate OTP code for SMS verification
 * (mocks SMS send; returns code for entry)
 */
export async function mockSMSSend(phone: string): Promise<{ code: string }> {
  // In real tests: mock the SMS service, generate code locally
  const code = Math.random().toString().slice(2, 8)  // 6 digits
  return { code }
}
```

## 4. Page Object Models (POMs)

POMs encapsulate selectors and page interactions. All POMs extend `BasePage`.

### BasePage.ts
```typescript
import { Page } from '@playwright/test'

export class BasePage {
  constructor(public page: Page) {}

  /**
   * Wait for navigation after action completes
   * Prevents "page navigated" errors
   */
  async waitForNav(action: () => Promise<void>): Promise<void> {
    const navPromise = this.page.waitForNavigation()
    await action()
    await navPromise
  }

  /**
   * Click + wait for navigation in one call
   */
  async clickAndWait(selector: string): Promise<void> {
    await this.waitForNav(() => this.page.click(selector))
  }

  /**
   * Assert element is visible
   */
  async expectVisible(selector: string, timeout = 5000): Promise<void> {
    await this.page.waitForSelector(selector, { timeout, state: 'visible' })
  }

  /**
   * Assert element is NOT visible or doesn't exist
   */
  async expectNotVisible(selector: string, timeout = 5000): Promise<void> {
    try {
      await this.page.waitForSelector(selector, { timeout, state: 'hidden' })
    } catch {
      // Element doesn't exist — that's fine
    }
  }

  /**
   * Fill multiple form fields at once
   */
  async fillForm(data: Record<string, string>): Promise<void> {
    for (const [testid, value] of Object.entries(data)) {
      await this.page.fill(`[data-testid="${testid}"]`, value)
    }
  }

  /**
   * Screenshot for debugging
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `screenshots/${name}.png` })
  }
}
```

### Example POM: ListingDetailPage.ts
```typescript
import { Page } from '@playwright/test'
import { BasePage } from './BasePage'

export class ListingDetailPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  async goTo(slug: string) {
    await this.page.goto(`/anuncio/${slug}`)
    await this.expectVisible('[data-testid="listing-title"]')
  }

  async getTitle(): Promise<string> {
    return this.page.textContent('[data-testid="listing-title"]') || ''
  }

  async clickContact() {
    await this.page.click('[data-testid="contact-button"]')
  }

  async openImageGallery() {
    await this.page.click('[data-testid="image-gallery"]')
    await this.expectVisible('[data-testid="lightbox-modal"]')
  }
}
```

**POM principles:**
- One POM per page/flow
- Selectors are `data-testid` only
- Methods return values for assertions (not assertions themselves)
- No hard dependencies between POMs

## 5. Test Data Factories

```typescript
// utils/test-data.ts

export function generateTestEmail(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `test-${timestamp}-${random}@e2e.test`
}

export function createAdvertiserAccount(overrides?: Partial<AdvertiserInput>) {
  return {
    email: generateTestEmail(),
    phone: '11999999999',
    password: 'SecurePass123!',
    category: 'massoterapeuta',
    lgpdConsent: true,
    ...overrides,
  }
}

export function createListingData(overrides?: Partial<ListingInput>) {
  return {
    title: `Test Listing ${Date.now()}`,
    description: 'Test listing description',
    city: 'São Paulo',
    neighborhood: 'Centro',
    category: 'massoterapeuta',
    price: 100,
    ...overrides,
  }
}
```

## 6. Writing Tests

### Test Structure
```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdvertiser, perSuiteSeed, cleanup } from '@/e2e/fixtures/auth.fixture'
import { ListingDetailPage } from '@/e2e/pom/ListingDetailPage'

// Read-only test (uses global seed data)
test('Listing detail displays title and city', async ({ page }) => {
  const seedData = JSON.parse(fs.readFileSync('seed-metadata.json', 'utf-8'))
  
  const listingPage = new ListingDetailPage(page)
  await listingPage.goTo(seedData.listingSlug)
  
  const title = await listingPage.getTitle()
  expect(title).toBe('Expected Listing Title')
})

// Mutation test (creates fresh data, cleans up)
test('Create listing with valid data', async ({ page }) => {
  const { email, password, jwt } = await perSuiteSeed('advertiser')
  const testData = { email, listingIds: [] }

  try {
    // Test code here
    const listingId = '...'
    testData.listingIds.push(listingId)
  } finally {
    // Always cleanup, even if test fails
    await cleanup(testData)
  }
})
```

### Selector Best Practices

**DO:**
```typescript
// ✓ Data attributes (stable, semantic)
await page.click('[data-testid="submit-button"]')
await page.fill('[data-testid="email-input"]', 'test@example.com')
```

**DON'T:**
```typescript
// ✗ XPath (brittle, slow)
await page.click('//button[contains(text(), "Submit")]')

// ✗ Hardcoded indexes (brittle)
await page.click('button:nth-child(3)')

// ✗ Deep nesting (brittle)
await page.click('div > div > div > button')

// ✗ Arbitrary sleep (flaky)
await page.waitForTimeout(500)
```

### Flakiness Prevention

1. **Always wait explicitly:**
   ```typescript
   // DO: Wait for element before interaction
   await page.waitForSelector('[data-testid="card"]', { timeout: 5000, state: 'visible' })
   
   // DON'T: Assume element exists
   await page.click('[data-testid="card"]')  // May fail if not ready
   ```

2. **Wait for API responses:**
   ```typescript
   const responsePromise = page.waitForResponse(r => r.url().includes('/api/v1/listings'))
   await page.click('[data-testid="create"]')
   await responsePromise
   ```

3. **Use proper navigation waits:**
   ```typescript
   await page.goto(url)
   await page.waitForLoadState('networkidle')  // All network requests done
   ```

4. **No arbitrary timeouts:**
   ```typescript
   // Bad: Assumes animation takes 300ms
   await page.waitForTimeout(300)
   
   // Good: Wait for actual state change
   await page.waitForSelector('[data-testid="success"]', { timeout: 5000 })
   ```

## 7. Data Isolation Strategy

| Test Type | Data Source | Cleanup | Why |
|---|---|---|---|
| Read-only (browse, search) | globalSeed() | None (kept for all tests) | Fast, no risk |
| Mutations (create, edit, delete) | perSuiteSeed() | cleanup() at test end | Isolated, prevents pollution |
| Admin tests | globalAdmin (permanent) | None | Reused across runs |

**Key rule:** Each test must be independent. If test A creates data, test B must not depend on it.

## 8. Mocking Strategies

### Timers (Payment Expiry)
```typescript
test('Payment timer expires', async ({ page }) => {
  // Install clock (all times are mocked)
  await page.clock.install()
  
  await page.goto('/checkout')
  
  // Timer shows 30:00
  await expect(page.locator('[data-testid="pix-timer"]')).toContainText('30:00')
  
  // Skip 30 minutes
  await page.clock.fastForward(30 * 60 * 1000)
  
  // Timer shows "Expired"
  await expect(page.locator('[data-testid="pix-expired"]')).toBeVisible()
})
```

### TOTP (Admin 2FA)
```typescript
import speakeasy from 'speakeasy'

test('Admin login with TOTP', async ({ page }) => {
  const secret = process.env.TEST_ADMIN_TOTP_SECRET!
  const code = generateTOTPCode(secret)  // Generates valid code
  
  await page.goto('/admin/login')
  await page.fill('[data-testid="email"]', 'admin@test.com')
  await page.fill('[data-testid="password"]', 'password')
  await page.fill('[data-testid="totp"]', code)
  await page.click('[data-testid="submit"]')
  
  await expect(page).toHaveURL('/admin/dashboard')
})
```

### SMS OTP (Phone Verification)
```typescript
test('Phone OTP verification', async ({ page }) => {
  const { code } = await mockSMSSend('11999999999')
  
  await page.goto('/register')
  // ... fill email/password/phone
  await page.click('[data-testid="send-otp"]')
  
  // Code is already generated, user enters it
  await page.fill('[data-testid="otp-input"]', code)
  await page.click('[data-testid="verify"]')
  
  await expect(page).toHaveURL('/painel')
})
```

### Payment Webhooks
```typescript
test('Payment webhook updates order status', async ({ page }) => {
  const { paymentId } = await initiatePixPayment()
  
  // Simulate server webhook
  await mockPaymentWebhook(paymentId, 'confirmed')
  
  // Verify DB reflects change
  const payment = await fetchPayment(paymentId)
  expect(payment.status).toBe('confirmed')
})
```

## 9. CI Integration (.github/workflows/e2e.yml)

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: Install Playwright
        run: cd frontend && npx playwright install --with-deps

      - name: Start Docker Compose
        run: docker compose up -d --wait

      - name: Wait for healthchecks
        run: |
          timeout 60 bash -c 'until curl -f http://localhost:5000/health; do sleep 1; done'
          timeout 60 bash -c 'until curl -f http://localhost:3000/; do sleep 1; done'

      - name: Run E2E tests
        run: cd frontend && npm run test:e2e

      - name: Upload report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/

      - name: Cleanup Docker
        if: always()
        run: docker compose down --volumes
```

## 10. Common Pitfalls & Solutions

| Pitfall | Solution |
|---|---|
| Tests fail randomly (flaky) | Use explicit waits (`waitForSelector`, `waitForResponse`); no `sleep()` |
| Tests depend on execution order | Each test calls `perSuiteSeed()`; no shared state |
| Selectors break after styling refactor | Use `data-testid` only; never rely on classes/ids |
| Tests fail in CI but pass locally | Check timezone, network timing, Docker healthchecks |
| Payment timer tests take 30 min | Use `page.clock.fastForward()`; no real time |
| Admin login fails | Verify TOTP secret is set; use `generateTOTPCode()` |
| SMS OTP tests call Twilio | Mock SMS; generate code locally in tests |
| Cleanup doesn't run | Use `try...finally` or `test.afterEach()` |

## Testing Checklist

- [ ] All selectors use `[data-testid="..."]`
- [ ] No `sleep()` or `waitForTimeout()`; all waits are explicit
- [ ] Fixtures return test data; don't make assertions
- [ ] Each test is independent (can run in any order)
- [ ] Mutation tests call `perSuiteSeed()` + `cleanup()`
- [ ] Read-only tests reference `globalSeed()` via JSON file
- [ ] Payment tests use `page.clock` (no real timers)
- [ ] Admin tests use `generateTOTPCode()` (no manual codes)
- [ ] All 3 browsers pass (no browser-specific hacks)
- [ ] CI workflow includes Docker healthchecks
- [ ] HTML report generated on failure
- [ ] No hardcoded credentials (use env vars)
- [ ] Types are strict; no `any` in test code
