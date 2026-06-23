# Error Categories Reference

Lookup table: error pattern → category → fix class.

---

## Error Patterns

### TypeScript / Compilation

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `Type.*is not assignable` | TYPE_ERROR | FIX_TYPES | `string not assignable to number` | Check type annotations |
| `Cannot find name` | IMPORT_ERROR | FIX_IMPORT | `Cannot find name 'User'` | Add import or declare |
| `Cannot find module` | IMPORT_ERROR | FIX_IMPORT | `Cannot find module 'speakeasy'` | Check path, add dependency |
| `Unexpected token\|SyntaxError` | SYNTAX_ERROR | FIX_SYNTAX | `Unexpected token }` | Fix brackets/parens |

### Test Assertions

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `expected.*to equal` | ASSERTION_MISMATCH | UPDATE_ASSERTION | `expected 5 to equal 10` | Check assertion logic |
| `does not exist\|is undefined` | MISSING_IMPLEMENTATION | IMPLEMENT | `Cannot read property of undefined` | Implement missing function |
| `null is not` | MISSING_IMPLEMENTATION | IMPLEMENT | `null is not a function` | Check implementation exists |

### Database

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `constraint violation\|duplicate key` | DATA_COLLISION | ADD_CLEANUP | `Duplicate key "email"` | Add test cleanup |
| `foreign key constraint\|violates constraint` | SCHEMA_MISMATCH | UPDATE_SCHEMA | `violates foreign key constraint` | Verify parent record exists |
| `column.*does not exist` | MIGRATION_ERROR | CREATE_MIGRATION | `column "totp_secret" does not exist` | Create migration |
| `table.*does not exist` | MIGRATION_ERROR | CREATE_MIGRATION | `table "users" does not exist` | Create table definition |

### UI / E2E

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `No matching element` | SELECTOR_MISMATCH | UPDATE_LOCATOR | `getByRole button not found` | Check selector/aria role |
| `target element is not visible` | SELECTOR_MISMATCH | UPDATE_LOCATOR | `click: element not visible` | Add waitFor visibility |
| `Timeout.*waiting for` | TIMING_ISSUE | INCREASE_TIMEOUT | `timeout waiting for element` | Increase timeout or fix load |

### API / Network

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `401\|Unauthorized` | API_CONTRACT | UPDATE_PAYLOAD | `401 Unauthorized` | Check auth headers |
| `404\|Not Found` | API_CONTRACT | UPDATE_PAYLOAD | `404 endpoint not found` | Verify endpoint exists/path |
| `500\|Internal Server Error` | API_CONTRACT | UPDATE_PAYLOAD | `500 backend error` | Check API request payload |

### Cross-Test

| Pattern | Category | Fix Class | Example | Template |
|---------|----------|-----------|---------|----------|
| `pollut\|cross-test\|together` | TEST_POLLUTION | ADD_CLEANUP | `passes individually, fails together` | Add afterEach cleanup |

---

## Fix Classes & Templates

### FIX_IMPORT

**Use When:** Cannot find module or variable not defined

```typescript
// Check 1: File exists at correct path
import { MyService } from './services/MyService';  // ./services/MyService.ts

// Check 2: Exported from source
export class MyService { }

// Check 3: Spelling matches
import { speakeasy } from 'speakeasy';  // Exact match (case sensitive)
```

### FIX_TYPES

**Use When:** Type mismatch between expected and actual

```typescript
// Check type annotations
interface User {
  id: string;        // string, not number
  email: string;     // required
  age?: number;      // optional
}

const user: User = {
  id: '123',        // string
  email: 'test@example.com'
};
```

### FIX_SYNTAX

**Use When:** Syntax error (brackets, semicolons, etc)

```typescript
const obj = { key: 'value' };    // Closing brace
const arr = [1, 2, 3];           // Closing bracket
const fn = async () => { };      // async keyword before fn

// No trailing commas in object/array
const list = [1, 2, 3];          // Not [1, 2, 3,]
```

### IMPLEMENT

**Use When:** Code or property not implemented

```typescript
// Function exists but body missing
class UserService {
  async createUser(email: string): Promise<User> {
    // TODO: Implement
    // → Must have actual implementation
    return { id: '1', email };
  }
}

// Property exists but not initialized
class Component {
  data: any;  // → Must initialize or set in constructor
}
```

### UPDATE_PAYLOAD

**Use When:** API request/response mismatch

```typescript
// Verify API endpoint exists
const response = await api.post('/api/users', {
  email: 'test@example.com',
  name: 'Test User'
});

// Check response structure
expect(response).toHaveProperty('id');
expect(response.status).toBe(200);

// Verify auth headers
const response = await api.post('/api/protected', data, {
  headers: { Authorization: `Bearer ${token}` }
});
```

### UPDATE_LOCATOR

**Use When:** Element selector doesn't match anything

```typescript
// OLD: CSS class selector (fragile)
// page.locator('.btn-login')

// NEW: Semantic selector (stable)
const loginButton = page.getByRole('button', { name: 'Login' });

// OR with test ID
const loginButton = page.getByTestId('login-button');
// (requires: <button data-testid="login-button">)

// Wait for visibility
await loginButton.waitFor({ state: 'visible', timeout: 5000 });
```

### INCREASE_TIMEOUT

**Use When:** Operation times out

```typescript
// Navigation timeout
await page.goto(url, {
  waitUntil: 'networkidle',
  timeout: 30000  // 30 seconds
});

// Element wait timeout
await page.getByRole('button').first().waitFor({
  state: 'visible',
  timeout: 10000  // 10 seconds
});

// Custom wait
await page.waitForFunction(() => {
  return document.querySelectorAll('.item').length > 0;
}, { timeout: 15000 });
```

### ADD_CLEANUP

**Use When:** Test pollution (tests interfere with each other)

```typescript
test.afterEach(async ({ api }) => {
  // Clean up test data
  for (const id of createdUserIds) {
    await api.delete(`/api/users/${id}`);
  }
  createdUserIds = [];
});

// Use unique test IDs
const testEmail = `test-${randomUUID()}@example.com`;
const testName = `user-${Date.now()}`;
```

### UPDATE_SCHEMA

**Use When:** Database schema missing column/table

```sql
-- Add missing column
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(32);

-- Add missing index
CREATE INDEX idx_users_email ON users(email);

-- In ORM:
@Column()
totpSecret: string;

@Index()
email: string;
```

### CREATE_MIGRATION

**Use When:** Need to version schema changes

```sql
-- File: migrations/001_add_2fa.sql
CREATE TABLE totp_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  secret VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- File: migrations/002_add_totp_enabled.sql
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE;
```

---

## How to Use This Reference

### As an Agent

```
Test fails with error: "Cannot find module 'speakeasy'"

1. Look up pattern: /Cannot find module/
   → Category: IMPORT_ERROR
   → Fix class: FIX_IMPORT
   
2. Get template:
   import { speakeasy } from 'speakeasy';
   
3. Verify:
   - Is 'speakeasy' in package.json? (might need npm install)
   - Is import path correct? (case sensitive)
   - Check for typos
   
4. Apply fix and retry ✓
```

### As a Human (Debugging)

```
Loop-back recorded: attempt=2, fix="FIX_TYPES"

This means:
  - Error was categorized as TYPE_ERROR
  - Agent tried to fix by: checking type annotations
  - If still failing, something deeper is wrong
  - May need manual review
```

---

## Statistics

| Category | Count | Patterns | Confidence |
|----------|-------|----------|------------|
| IMPORT_ERROR | 3 | Module missing, name undefined, path wrong | HIGH |
| TYPE_ERROR | 2 | Type mismatch, assignment error | HIGH |
| SYNTAX_ERROR | 2 | Brackets, parentheses, tokens | HIGH |
| ASSERTION_MISMATCH | 2 | Expected vs actual | HIGH |
| MISSING_IMPLEMENTATION | 2 | Property undefined, function missing | HIGH |
| DATA_COLLISION | 2 | Duplicate key, constraint violation | HIGH |
| SCHEMA_MISMATCH | 2 | Foreign key, column/table missing | HIGH |
| API_CONTRACT | 3 | 404, 401, 500 status codes | HIGH |
| SELECTOR_MISMATCH | 3 | Element not found, not visible | HIGH |
| TIMING_ISSUE | 2 | Timeout, wait for element | HIGH |
| TEST_POLLUTION | 1 | Cross-test interference | HIGH |

**Total Patterns:** 30+

---

## Adding New Patterns

Found an error that doesn't match?

1. Add to `harness/error-categories.ts`
2. Document pattern, category, fix class
3. Add code template
4. Submit PR with example

```typescript
{
  pattern: /your new error pattern/i,
  category: 'YOUR_CATEGORY',
  fixClass: 'YOUR_FIX_CLASS',
  suggestedFix: 'Explanation of fix'
}
```
