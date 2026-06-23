# Production Standards Library

**For:** All agents in the Feature Factory loop  
**Purpose:** Quality guardrails that ensure code shipping is production-grade  
**Scope:** TDD, Security, Design Patterns, API Design, Database, Error Handling, Performance

---

## Executive Summary

Production code has non-negotiable standards. This document codifies them into:

1. **TDD Standards** — Every feature has tests. Tests are written first (TDD).
2. **Security Standards** — OWASP top 10 per layer. Auth boundaries enforced. No secrets in code.
3. **Design Patterns** — When to use what (CRUD, cache, async, etc.). Reuse over novelty.
4. **API Design** — REST conventions, versioning, deprecation. Consistent contracts.
5. **Database Standards** — Migrations, concurrency, timezone handling, idempotency.
6. **Error Handling** — What to log, how to surface errors, retry logic.
7. **Performance Targets** — Latency budgets, caching strategy, optimization checkpoints.

Every agent reads these before starting work. Violations are caught at VERIFY stage, not in production.

---

## 1. Test-Driven Development Standards

### Philosophy

**All production code starts with tests.** Tests aren't written after; they're written first.

```typescript
// ❌ Wrong order
Write code → Write tests → Deploy

// ✅ Right order
Write test → Watch it fail → Write code → Watch it pass → Deploy
```

**Why:** TDD prevents bugs at source, not in production. Test failures guide design. Code without tests is unfinished code.

---

### Test Structure

Every feature has THREE layers of tests:

#### Layer 1: Unit Tests (per function/method)

**What:** Test a single function in isolation

**Rules:**
- One assertion per test (or related assertions on same behavior)
- Mock external dependencies (database, API calls, file system)
- Fast (< 100ms per test)
- Independent (tests run in any order)

**Example:**

```typescript
// ✅ Good unit test
describe('validateEmail', () => {
  it('returns true for valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('returns false for missing @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('returns false for missing domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });
});

// ❌ Wrong: Multiple behaviors, no mocking
describe('createUser', () => {
  it('creates user, sends email, updates dashboard', async () => {
    // This test:
    // 1. Hits real database
    // 2. Hits real email service
    // 3. Updates real analytics
    // 4. Tests 3 unrelated things in 1 test
    // 5. Fails for any of the 3 reasons (unclear which)
  });
});
```

---

#### Layer 2: Integration Tests (per API endpoint / feature)

**What:** Test a slice of the system (e.g., API endpoint → database)

**Rules:**
- Use real database (but test database, not production)
- Mock external services (payment API, auth provider, etc.)
- Multiple assertions allowed (testing a complete flow)
- Slower than unit tests OK (< 1 second per test)

**Example:**

```typescript
// ✅ Good integration test
describe('POST /listings', () => {
  it('creates listing when valid data provided', async () => {
    const response = await request(app)
      .post('/listings')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        title: 'My Listing',
        description: 'A test listing',
        price: 100,
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();

    // Verify it's in the database
    const listing = await db.listings.findOne({ id: response.body.id });
    expect(listing.title).toBe('My Listing');
  });

  it('returns 400 when required field missing', async () => {
    const response = await request(app)
      .post('/listings')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        title: 'My Listing',
        // description missing
        price: 100,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('description required');
  });

  it('returns 401 when not authenticated', async () => {
    const response = await request(app)
      .post('/listings')
      .send({ title: 'Test', description: 'Test', price: 100 });

    expect(response.status).toBe(401);
  });
});
```

---

#### Layer 3: Acceptance Tests (per user story)

**What:** Test complete feature from user perspective (black-box, end-to-end)

**Rules:**
- Use real browser (Playwright)
- Real database
- Real backend (test environment)
- Test full happy path + error scenarios
- 3-4 interactions max per test
- Independent (can run in any order, parallel)

**Example:**

```typescript
// ✅ Good acceptance test
test('user creates listing successfully', async ({ page }) => {
  // Setup: login
  await page.goto('/login');
  await page.fill('input[name="email"]', 'user@example.com');
  await page.fill('input[name="password"]', 'testpassword');
  await page.click('button:has-text("Sign In")');
  await page.waitForNavigation();

  // Action: create listing
  await page.goto('/create-listing');
  await page.fill('input[name="title"]', 'My Apartment');
  await page.fill('textarea[name="description"]', 'A great place to live');
  await page.fill('input[name="price"]', '1200');
  await page.click('button:has-text("Create Listing")');

  // Verify: success message visible
  await expect(page.getByText('Listing created successfully')).toBeVisible();
  
  // Verify: redirected to listing detail
  await expect(page).toHaveURL(/\/listings\/\d+/);
});

// ✅ Error scenario
test('shows validation error for invalid price', async ({ page }) => {
  await page.goto('/create-listing');
  await page.fill('input[name="title"]', 'My Apartment');
  await page.fill('input[name="description"]', 'A great place');
  await page.fill('input[name="price"]', 'not-a-number');
  await page.click('button:has-text("Create Listing")');

  await expect(page.getByText('Price must be a number')).toBeVisible();
  // Form should still be visible (not submitted)
  await expect(page.getByRole('button', { name: 'Create Listing' })).toBeVisible();
});
```

---

### Test Coverage Targets

| Layer | Coverage % | Notes |
|-------|-----------|-------|
| Unit | 80%+ | All public functions tested. Private helpers only if complex. |
| Integration | 70%+ | Happy path + error paths. All endpoints tested. |
| Acceptance | 60%+ | Happy path. Common error scenarios. |

**Definition:** Coverage = % of code lines executed by tests (use `nyc` / `jest --coverage`)

**Rule:** All new code requires tests before merge. Zero-coverage code is a blocker.

---

### TDD Workflow (Per Agent)

#### Backend Builder:

```
1. Read spec
2. Write failing unit test (test database schema)
3. Create migration + schema
4. Watch test pass
5. Write failing integration test (test API endpoint)
6. Implement API handler
7. Watch test pass
8. Repeat for each endpoint
9. Run full test suite (unit + integration)
10. Commit with test summary in message
```

#### Frontend Builder:

```
1. Read API contract from Backend Builder
2. Write failing component test (test UI behavior)
3. Mock API responses
4. Implement component
5. Watch test pass
6. Write failing integration test (test user flow)
7. Implement form submission, state management
8. Watch test pass
9. Verify against acceptance criteria
10. Commit with test summary
```

#### Test Verifier:

```
1. Read acceptance criteria
2. Check that unit/integration tests cover each criterion
3. Check that acceptance tests exist for happy path + errors
4. Run full test suite (must pass)
5. Check coverage (≥ targets above)
6. Run security scan (see Security Standards)
7. Report: PASS or identify gaps
```

---

### Common Test Pitfalls (Anti-Patterns)

| Anti-Pattern | Why It's Wrong | Fix |
|---|---|---|
| **Test has 2+ assertions on unrelated things** | Unclear which failed | One behavior per test |
| **Test creates real database records** | Hard to clean up, tests interfere | Use test database + reset between tests |
| **Test sleeps to wait for async** | Flaky, slow | Use async/await or waitFor() |
| **Test mocks everything** | Not testing real behavior | Unit tests mock, integration tests use real deps |
| **Test name doesn't explain what it tests** | Unclear what broke when it fails | `it('shows error when email invalid')` not `it('tests email')` |
| **Test depends on order** | Runs fail if order changes | Each test must be independent |
| **Test has magic values** | Unclear why that value matters | Use semantic variable names |

---

## 2. Security Standards

### Principle

**Security is not a feature.** It's a baseline. Every feature that touches auth, data, or external APIs must be security-audited before merge.

---

### OWASP Top 10 (Per Agent)

#### Backend Builder Responsibilities

| Threat | What It Is | How to Prevent | Check |
|--------|-----------|----------------|-------|
| **Injection (SQL/Command)** | Attacker injects code via user input | Parameterized queries, input validation | `SELECT * FROM users WHERE id = ?` not `...WHERE id = ${id}` |
| **Broken Authentication** | Weak auth logic, exposed tokens | Use established auth lib (passport, auth0). Never DIY JWT. | Token signed? Expiry checked? |
| **Sensitive Data Exposure** | Passwords, tokens, PII in logs/URLs | Hash passwords (bcrypt). Don't log secrets. HTTPS only. | Secrets in .env? Logs contain PII? |
| **XML External Entity (XXE)** | Parser loads malicious XML | Disable XML external entity processing | Not applicable unless parsing XML |
| **Broken Access Control** | User accesses another user's data | Check authorization at every endpoint | Before returning data: verify `user.id == data.owner_id` |
| **CSRF** | Attacker tricks user into unauthorized action | Use CSRF tokens for state-changing operations | POST/PUT/DELETE require CSRF token check |
| **Using Components w/ Known Vulnerabilities** | Old libraries with exploits | Run `npm audit`. Update regularly. | `npm audit` returns 0 critical? |
| **Broken Object Level Auth** | User can guess/enumerate IDs | Check permission before returning by ID | `GET /users/123` checks `user.id == 123`? |
| **Broken Function Level Auth** | User calls admin endpoint without permission | Check role at start of handler | Handler starts with `requireRole('admin')`? |
| **Insufficient Logging** | No record of what happened | Log security events (login, permission changes) | Log failed auth attempts? Success logs? |

**Validator's Security Checklist (for backend code):**

```markdown
Auth:
  ☐ No passwords stored in plaintext (bcrypt hash)
  ☐ No API keys/tokens in code (use .env)
  ☐ Endpoints check authentication (not just frontend)
  ☐ Endpoints check authorization (right user/role)
  ☐ CSRF tokens required for state-changing operations
  ☐ JWT tokens have expiry
  ☐ Passwords hash verified, not plain text

Data:
  ☐ SQL queries use parameterized queries (? placeholders)
  ☐ User input validated before use
  ☐ Sensitive data (PII, passwords) never logged
  ☐ HTTPS only (no HTTP)
  ☐ Database credentials in .env (not hardcoded)

API:
  ☐ Rate limiting on auth endpoints (prevent brute force)
  ☐ Error messages don't leak system details
  ☐ CORS configured (not allow all origins)
```

#### Frontend Builder Responsibilities

| Threat | What It Is | How to Prevent | Check |
|--------|-----------|----------------|-------|
| **XSS (Cross-Site Scripting)** | Attacker injects JavaScript | Escape user input, use `textContent` not `innerHTML` | Form input rendered as `<span>{userInput}</span>` not `<div dangerouslySetInnerHTML>` |
| **CSRF** | Attacker tricks user into action | Send CSRF token with requests | Form includes CSRF token from backend |
| **Sensitive Data in URLs** | Passwords/tokens in query params | Never put secrets in URLs | URL never contains password/token |
| **Insecure Storage** | Passwords/tokens in localStorage | Use httpOnly cookies for tokens | Token in `httpOnly` cookie, not localStorage |

**Validator's Security Checklist (for frontend code):**

```markdown
Input:
  ☐ User input escaped before display (no XSS)
  ☐ Forms validate before submit
  ☐ No password/token in URL

Storage:
  ☐ Auth token in httpOnly cookie (not localStorage)
  ☐ No PII in localStorage/sessionStorage
  ☐ Sensitive data cleared on logout

API:
  ☐ CSRF token sent with POST/PUT/DELETE
  ☐ API responses validated (don't trust shape)
  ☐ Error messages don't leak system details
```

---

### Secret Management

**Rule:** No secrets in code. Ever. Not even in tests.

```typescript
// ❌ Wrong
const API_KEY = 'sk-1234567890';
const DB_PASSWORD = 'mypassword';

// ✅ Right
const API_KEY = process.env.API_KEY;
const DB_PASSWORD = process.env.DB_PASSWORD;

// ✅ In .env (never committed)
API_KEY=sk-1234567890
DB_PASSWORD=mypassword
```

**For tests:**

```typescript
// ✅ Use test doubles
beforeEach(() => {
  mockExternalAPI.setResponse({ status: 'ok' });
});

it('calls external API', async () => {
  const result = await service.fetchData();
  expect(mockExternalAPI.called).toBe(true);
});
```

---

## 3. Design Pattern Standards

### When to Use What

| Pattern | Use When | Example | Don't Use For |
|---------|----------|---------|---------------|
| **CRUD Service** | Simple read/write operations | `UserService.create(user)` | Complex business logic (multi-step, many rules) |
| **Repository Pattern** | Abstracting database access | `UserRepository.find(id)` | Simple single-table queries |
| **Pub/Sub (Event)** | Decoupling services | `EventBus.emit('user.created', user)` | Synchronous operations |
| **Factory** | Creating objects with logic | `UserFactory.create(type: 'admin')` | Simple object creation |
| **Middleware** | Cross-cutting concerns | Auth, logging, error handling | Business logic |
| **Strategy** | Multiple algorithms, switchable | Payment processor (stripe vs paypal) | Single clear algorithm |
| **Decorator** | Adding behavior to existing code | Caching, logging | Core business logic (use middleware instead) |

---

### CRUD Service Template (Reusable)

Every CRUD endpoint follows this pattern:

```typescript
// ✅ Backend: CRUD Service
class UserService {
  constructor(private db: Database) {}

  async create(data: CreateUserInput): Promise<User> {
    // Validate input
    if (!data.email) throw new ValidationError('email required');
    if (!data.password) throw new ValidationError('password required');

    // Check uniqueness
    const existing = await this.db.users.findOne({ email: data.email });
    if (existing) throw new ConflictError('email already in use');

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create record
    const user = await this.db.users.create({
      email: data.email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    // Return (without password)
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  async getById(id: string): Promise<User> {
    const user = await this.db.users.findOne({ id });
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  }

  async update(id: string, data: UpdateUserInput): Promise<User> {
    // Validate user exists
    const user = await this.getById(id);

    // Update only allowed fields
    const updated = await this.db.users.updateOne(
      { id },
      { email: data.email, updatedAt: new Date() }
    );

    return { id: updated.id, email: updated.email, createdAt: updated.createdAt };
  }

  async delete(id: string): Promise<void> {
    const user = await this.getById(id); // Verify exists
    await this.db.users.deleteOne({ id });
  }
}

// ✅ Backend: API Endpoint
app.post('/users', authenticate, async (req, res) => {
  try {
    const user = await userService.create(req.body);
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof ValidationError) res.status(400).json({ error: error.message });
    else if (error instanceof ConflictError) res.status(409).json({ error: error.message });
    else res.status(500).json({ error: 'internal error' });
  }
});

// ✅ Frontend: Hook
function useCreateUser() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const create = React.useCallback(async (userData) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error);
      }
      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}
```

---

## 4. API Design Standards

### REST Conventions (Required)

| Operation | Method | URL | Status | Example |
|-----------|--------|-----|--------|---------|
| **List** | GET | `/users` | 200 | `GET /users?limit=10&offset=0` |
| **Get One** | GET | `/users/:id` | 200 (found) or 404 | `GET /users/123` |
| **Create** | POST | `/users` | 201 (created) | `POST /users` + body |
| **Update** | PUT | `/users/:id` | 200 | `PUT /users/123` + body |
| **Partial Update** | PATCH | `/users/:id` | 200 | `PATCH /users/123` + partial body |
| **Delete** | DELETE | `/users/:id` | 204 (no content) | `DELETE /users/123` |

### Error Responses (Standardized)

```typescript
// ✅ All error responses follow this shape
interface ErrorResponse {
  error: string;        // Human-readable message
  code: string;         // Machine-readable code
  statusCode: number;   // HTTP status
  details?: object;     // Additional context (validation errors, etc.)
}

// Examples:
// 400 Bad Request
{ "error": "email required", "code": "VALIDATION_ERROR", "statusCode": 400, "details": { "field": "email" } }

// 401 Unauthorized
{ "error": "missing or invalid auth token", "code": "AUTH_ERROR", "statusCode": 401 }

// 409 Conflict
{ "error": "email already in use", "code": "CONFLICT", "statusCode": 409 }

// 500 Internal Server Error
{ "error": "internal error", "code": "INTERNAL_ERROR", "statusCode": 500 }
```

### Pagination (Standardized)

```typescript
// ✅ Query params
GET /users?limit=10&offset=0
GET /users?page=1&pageSize=10

// ✅ Response shape
{
  "data": [ /* array of users */ ],
  "pagination": {
    "total": 100,           // Total items
    "limit": 10,            // Items per page
    "offset": 0,            // Items skipped
    "hasMore": true         // Is there a next page?
  }
}
```

### Versioning

```typescript
// ✅ Version in URL (preferred for breaking changes)
GET /v1/users        // Version 1
GET /v2/users        // Version 2 (breaking changes)

// ✅ Version in header (for minor changes)
GET /users
Accept: application/vnd.example.v1+json
```

---

## 5. Database Standards

### Migration Safety

Every schema change follows this pattern:

```sql
-- ✅ Good: Backward compatible
BEGIN;
  -- Add new column with default (existing rows get default)
  ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT false;
  -- Index for query performance
  CREATE INDEX idx_users_verified ON users(is_verified);
COMMIT;

-- ❌ Wrong: Not backward compatible
BEGIN;
  ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL;
  -- Error: existing rows have NULL, NOT NULL constraint fails
COMMIT;

-- ✅ Fix: Backfill first
BEGIN;
  ALTER TABLE users ADD COLUMN email VARCHAR(255);
  UPDATE users SET email = CONCAT('user', id, '@example.com');
  ALTER TABLE users ALTER COLUMN email SET NOT NULL;
COMMIT;
```

### Concurrency & Idempotency

```typescript
// ❌ Wrong: Not idempotent (calling twice creates 2 records)
async createListing(data) {
  const listing = await db.listings.create(data);
  return listing;
}
// Problem: If API call retries, creates duplicate

// ✅ Right: Idempotent (safe to call multiple times)
async createListing(data, idempotencyKey: string) {
  // Check if already created
  const existing = await db.listings.findOne({ idempotencyKey });
  if (existing) return existing;

  // Create new
  const listing = await db.listings.create({
    ...data,
    idempotencyKey,
  });

  return listing;
}
// Safe: Calling twice returns same record
```

### Timezone Handling

```typescript
// ❌ Wrong: Timezone ambiguity
const now = new Date(); // What timezone is this?
db.events.create({ scheduledAt: now });

// ✅ Right: Always UTC
const now = new Date(); // JavaScript Date is always UTC
const isoString = now.toISOString(); // "2024-06-10T14:30:00Z"
db.events.create({ scheduledAt: isoString });

// ✅ Database: Store as UTC
CREATE TABLE events (
  id UUID PRIMARY KEY,
  scheduledAt TIMESTAMP WITH TIME ZONE NOT NULL -- PostgreSQL
);

// ✅ Frontend: Convert on display
const event = await getEvent();
const localTime = new Date(event.scheduledAt).toLocaleString();
display(localTime); // User's timezone
```

---

## 6. Error Handling Standards

### What to Log

```typescript
// ✅ Log these (help debugging)
logger.error('database connection failed', {
  error: error.message,
  code: error.code,
  context: { database: 'users', operation: 'findOne' },
});

logger.warn('slow query', {
  query: 'SELECT * FROM users WHERE email = ?',
  duration: 2500, // ms
});

logger.info('user logged in', {
  userId: user.id,
  method: 'email',
  timestamp: new Date().toISOString(),
});

// ❌ Never log these (security issue)
logger.error('user login failed', {
  email: user.email,        // ❌ PII
  password: user.password,  // ❌ Secret
});

logger.info('api key used', {
  apiKey: 'sk-...',         // ❌ Secret
});
```

### Error Surface to Client

```typescript
// ✅ Good: Actionable
{ "error": "email already in use", "code": "CONFLICT" }

// ❌ Bad: Leaks system details
{ "error": "duplicate key value violates unique constraint users_email_key" }

// ❌ Bad: Not actionable
{ "error": "something went wrong" }
```

### Retry Logic

```typescript
// ✅ Retry transient errors (network, timeout)
async function callExternalAPI(data) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch('https://external-api.com/data', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    } catch (error) {
      lastError = error;
      if (error.code === 'ECONNREFUSED' && attempt < maxRetries) {
        // Transient: retry with exponential backoff
        await sleep(100 * Math.pow(2, attempt - 1));
        continue;
      }
      // Not transient or final attempt: throw
      throw error;
    }
  }
  throw lastError;
}

// ❌ Wrong: Retry everything (including permanent errors)
for (let i = 0; i < 3; i++) {
  try {
    // ...
  } catch (error) {
    // Retry even if error is "invalid API key" (permanent)
  }
}
```

---

## 7. Performance Standards

### Latency Targets

| Operation | Target | Example |
|-----------|--------|---------|
| **Simple query** | < 50ms | `SELECT * FROM users WHERE id = ?` |
| **List with filter** | < 200ms | `SELECT * FROM listings WHERE city = 'NYC'` |
| **Complex join** | < 500ms | `SELECT listings.* FROM listings JOIN reviews ON...` |
| **Aggregate** | < 1s | `SELECT COUNT(*), AVG(price) FROM listings` |
| **Page load** | < 2s | Initial HTML + critical JS |
| **Search** | < 500ms | Full-text search results |

**Tool:** Use APM (Application Performance Monitoring) to track actual latencies.

---

### Caching Strategy

```typescript
// ✅ Cache frequently accessed, rarely changed data
// Cache: User profiles (change infrequently)
const cachedUser = await cache.get(`user:${id}`);
if (cachedUser) return cachedUser;
const user = await db.users.findOne({ id });
await cache.set(`user:${id}`, user, { ttl: 3600 }); // 1 hour
return user;

// ❌ Don't cache: Data that changes frequently
// Don't cache: Real-time inventory counts

// ✅ Invalidate on change
async updateUser(id, data) {
  const user = await db.users.updateOne({ id }, data);
  await cache.delete(`user:${id}`); // Invalidate
  return user;
}

// ✅ Use query result caching for expensive queries
const cachedResults = await cache.get('popular_listings_nyc');
if (cachedResults) return cachedResults;
const results = await db.listings
  .find({ city: 'NYC', rating: { $gte: 4 } })
  .sort({ reviews: -1 })
  .limit(10);
await cache.set('popular_listings_nyc', results, { ttl: 300 }); // 5 min
return results;
```

---

### Database Query Optimization

```typescript
// ❌ Wrong: N+1 queries (slow)
const users = await db.users.find();
for (const user of users) {
  user.posts = await db.posts.find({ userId: user.id }); // 1+N queries
}

// ✅ Right: Single query with join
const users = await db.users
  .find()
  .populate('posts'); // Loads posts in one query

// ✅ Right: Select only needed columns
const users = await db.users
  .find()
  .select('id email name') // Don't load unused fields
  .limit(10);

// ✅ Right: Use indexes
CREATE INDEX idx_listings_city ON listings(city);
CREATE INDEX idx_posts_user_id ON posts(user_id);
```

---

## 8. Consolidation Checklist (Per Agent)

Every agent reviews this before reporting completion:

### Researcher
- [ ] No assumptions — all unknowns flagged
- [ ] Prior patterns surfaces from MemoryKit
- [ ] Risk assessment complete (security, concurrency, etc.)
- [ ] Clear recommendation on what to build vs reuse

### Story Writer
- [ ] Acceptance criteria are testable (not vague)
- [ ] Edge cases considered (empty data, errors, etc.)
- [ ] Scope is appropriately bounded (not feature creep)
- [ ] Clear definition of DONE

### Spec Writer
- [ ] API design follows REST conventions
- [ ] Database schema decisions documented
- [ ] Error handling strategy clear
- [ ] Security considerations addressed

### Backend Builder
- [ ] TDD: tests written first, all green
- [ ] All endpoints have unit + integration tests
- [ ] Security checklist passed (OWASP review)
- [ ] No hardcoded secrets
- [ ] Migrations backward compatible
- [ ] Error responses standardized
- [ ] API contract matches spec

### Frontend Builder
- [ ] TDD: component tests for all behaviors
- [ ] Forms validate before submit
- [ ] Error messages surface API errors clearly
- [ ] Security: no XSS, CSRF tokens sent, tokens in httpOnly cookies
- [ ] Performance: no unnecessary re-renders, list items keyed
- [ ] Accessibility: keyboard navigation, ARIA labels where needed

### Test Verifier
- [ ] Unit tests: 80%+ coverage
- [ ] Integration tests: 70%+ coverage
- [ ] Acceptance tests: happy path + error scenarios
- [ ] All acceptance criteria tested
- [ ] Tests are independent (can run in any order)
- [ ] Test names explain what they test

### Validator
- [ ] Code review against PRODUCTION_STANDARDS.md
- [ ] Security audit: OWASP checklist passed
- [ ] No performance regressions (vs baseline)
- [ ] Documentation: API changes documented, decisions logged
- [ ] Database migrations: backward compatible, tested
- [ ] Error handling: proper HTTP status codes, standardized error shape

---

## Conclusion

Production code is not written. It's **assembled** from proven patterns and verified at every stage. These standards are the checklist every agent uses before signing off.

**Agent who skips these standards ships broken code.**  
**Agent who follows these ships production-ready code.**

---

**Next:** Read LOOP_SCHEMA.md for formal orchestration configuration.

