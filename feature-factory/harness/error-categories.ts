/**
 * Feature Factory Error Categorization & Fix Mapping
 *
 * Deterministic lookup table: error pattern → category → fix class → suggested fix
 *
 * Adapted from: e2e-loop/harness/error-categories.ts
 * Extended with: Feature Factory specific errors (TypeScript, imports, schema)
 */

export interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  fixClass: FixClass;
  suggestedFix: string;
  examples?: string[];
}

export type ErrorCategory =
  | 'SELECTOR_MISMATCH'
  | 'API_CONTRACT'
  | 'TIMING_ISSUE'
  | 'DATA_COLLISION'
  | 'TEST_POLLUTION'
  | 'ASSERTION_MISMATCH'
  | 'SETUP_FAILURE'
  | 'ENVIRONMENT_ISSUE'
  | 'TYPE_ERROR'
  | 'IMPORT_ERROR'
  | 'SYNTAX_ERROR'
  | 'MISSING_IMPLEMENTATION'
  | 'SCHEMA_MISMATCH'
  | 'MIGRATION_ERROR'
  | 'UNKNOWN';

export type FixClass =
  | 'UPDATE_LOCATOR'
  | 'UPDATE_PAYLOAD'
  | 'INCREASE_TIMEOUT'
  | 'ADD_CLEANUP'
  | 'UPDATE_ASSERTION'
  | 'FIX_SETUP'
  | 'FIX_ENVIRONMENT'
  | 'FIX_TYPES'
  | 'FIX_IMPORT'
  | 'FIX_SYNTAX'
  | 'IMPLEMENT'
  | 'UPDATE_SCHEMA'
  | 'CREATE_MIGRATION'
  | 'MANUAL_REVIEW';

export interface ErrorAnalysis {
  category: ErrorCategory;
  fixClass: FixClass;
  confidence: number;
  suggestedFix: string;
  suggestedCode?: string;
  requiresManualReview: boolean;
}

/**
 * Error Pattern Library (ordered by specificity — most specific first)
 */
export const errorPatterns: ErrorPattern[] = [
  // ============================================================================
  // TEST FAILURES (from E2E loop, reused directly)
  // ============================================================================

  {
    pattern: /locator\.click\(\): target element is not visible|target element is not visible/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'Element not visible — check selector, wait for visibility, or verify element exists on page'
  },

  {
    pattern: /locator is not connected to a DOM tree|not connected to a DOM tree/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'Element not in DOM — element was removed or never created. Verify selector and element lifecycle.'
  },

  {
    pattern: /locator\.fill\(\): No matching element|No matching element|no element found/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'Selector does not match any element — use semantic locator (getByRole, getByLabel, getByTestId)'
  },

  {
    pattern: /received null for role.*expected element/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'getByRole failed — check aria roles, labels, or use getByTestId with data-testid attribute'
  },

  {
    pattern: /Timeout \d+ms.*waiting for|page\.goto.*Timeout/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Page load timeout — increase navigationTimeout in fixtures or add waitForLoadState()'
  },

  {
    pattern: /status.*40[1345]|401 Unauthorized|403 Forbidden|404 Not Found/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'API request failed with 4xx — verify endpoint exists, authentication headers, and request path'
  },

  {
    pattern: /status 500|Internal Server Error|500 Server Error/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'Backend error — check API request payload, backend logs, verify test data is valid'
  },

  // ============================================================================
  // TYPESCRIPT / COMPILATION ERRORS (Feature Factory specific)
  // ============================================================================

  {
    pattern: /TypeScript error|TS\d+:|Type.*is not assignable/i,
    category: 'TYPE_ERROR',
    fixClass: 'FIX_TYPES',
    suggestedFix: 'TypeScript type mismatch — check type annotations match function signatures'
  },

  {
    pattern: /Cannot find name|is not defined/i,
    category: 'IMPORT_ERROR',
    fixClass: 'FIX_IMPORT',
    suggestedFix: 'Variable/function not defined — check imports or verify declaration exists'
  },

  {
    pattern: /Cannot find module|MODULE_NOT_FOUND|no such file or directory/i,
    category: 'IMPORT_ERROR',
    fixClass: 'FIX_IMPORT',
    suggestedFix: 'Missing file or module — verify path exists, check for typos in imports'
  },

  {
    pattern: /SyntaxError|Unexpected token|Expected.*but got/i,
    category: 'SYNTAX_ERROR',
    fixClass: 'FIX_SYNTAX',
    suggestedFix: 'Syntax error in code — check brackets, parentheses, semicolons, or async/await placement'
  },

  // ============================================================================
  // UNIT TEST FAILURES (Feature Factory specific)
  // ============================================================================

  {
    pattern: /expected.*to equal|expect.*not.*toBe|assertion failed/i,
    category: 'ASSERTION_MISMATCH',
    fixClass: 'UPDATE_ASSERTION',
    suggestedFix: 'Assertion failed — verify actual behavior matches test expectation'
  },

  {
    pattern: /does not exist|is undefined|cannot read property|null is not/i,
    category: 'MISSING_IMPLEMENTATION',
    fixClass: 'IMPLEMENT',
    suggestedFix: 'Code or property not implemented — verify all required functions/properties exist'
  },

  // ============================================================================
  // DATABASE ERRORS (Feature Factory specific)
  // ============================================================================

  {
    pattern: /constraint violation|duplicate key|already exists|UNIQUE constraint/i,
    category: 'DATA_COLLISION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Test data collision — previous test did not clean up. Add cleanup in afterEach'
  },

  {
    pattern: /foreign key constraint|constraint.*failed|violates constraint/i,
    category: 'SCHEMA_MISMATCH',
    fixClass: 'UPDATE_SCHEMA',
    suggestedFix: 'Foreign key mismatch — verify parent record exists, check schema migrations'
  },

  {
    pattern: /column.*does not exist|table.*does not exist|relation.*not found/i,
    category: 'MIGRATION_ERROR',
    fixClass: 'CREATE_MIGRATION',
    suggestedFix: 'Database schema missing — create migration to add missing column/table'
  },

  {
    pattern: /pollut|cross-test|pass.*individually.*fail.*together/i,
    category: 'TEST_POLLUTION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Cross-test pollution — add afterEach cleanup, use UUID-based test data'
  },

  // ============================================================================
  // FALLBACK / GENERIC (catch-all)
  // ============================================================================

  {
    pattern: /timeout|timeout/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Generic timeout — increase timeout or check what element/condition is slow to load'
  },

  {
    pattern: /error|failed|failure/i,
    category: 'UNKNOWN',
    fixClass: 'MANUAL_REVIEW',
    suggestedFix: 'Unknown error — escalate to human review with full error trace'
  }
];

/**
 * Analyze an error and categorize it
 */
export function analyzeError(errorMessage: string): ErrorAnalysis {
  for (const pattern of errorPatterns) {
    if (pattern.pattern.test(errorMessage)) {
      return {
        category: pattern.category,
        fixClass: pattern.fixClass,
        confidence: 0.9,
        suggestedFix: pattern.suggestedFix,
        requiresManualReview: pattern.fixClass === 'MANUAL_REVIEW'
      };
    }
  }

  // No pattern matched
  return {
    category: 'UNKNOWN',
    fixClass: 'MANUAL_REVIEW',
    confidence: 0,
    suggestedFix: 'Unable to categorize error — escalate to human review',
    requiresManualReview: true
  };
}

/**
 * Generate remediation instruction for an error
 */
export function getRemediationInstruction(errorMessage: string): string {
  const analysis = analyzeError(errorMessage);

  return `
## Error Analysis

**Category:** ${analysis.category}
**Fix Class:** ${analysis.fixClass}
**Confidence:** ${Math.round(analysis.confidence * 100)}%

**Suggested Fix:**
${analysis.suggestedFix}

${
  analysis.requiresManualReview
    ? `
⚠️ **Requires Manual Review**
This error may need human investigation. If automated fix doesn't work, escalate.
`
    : ''
}

**Error Message:**
\`\`\`
${errorMessage}
\`\`\`
`;
}

/**
 * Get fix code template based on fix class
 */
export function getFixCodeTemplate(fixClass: FixClass): string {
  switch (fixClass) {
    case 'UPDATE_LOCATOR':
      return `
// OLD: element.querySelector('button.login')
// NEW: Use semantic selector
const loginButton = await page.getByRole('button', { name: 'Login' });
// OR with test ID
const loginButton = await page.getByTestId('login-button');
`;

    case 'UPDATE_PAYLOAD':
      return `
// Verify API request payload matches backend schema
const response = await api.post('/api/endpoint', {
  requiredField: 'value',
  typedField: 123  // not string!
});
// Verify response structure
expect(response.status).toBe(200);
expect(response.data).toHaveProperty('id');
`;

    case 'INCREASE_TIMEOUT':
      return `
// OLD: await page.goto(url);
// NEW: Add explicit timeout
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// OR wait for specific element
await page.getByRole('button').first().waitFor({ timeout: 5000 });
`;

    case 'ADD_CLEANUP':
      return `
// Add afterEach cleanup for test data
test.afterEach(async ({ api }) => {
  for (const id of testDataIds) {
    await api.delete(\`/api/resource/\${id}\`);
  }
  testDataIds = [];
});

// Use UUID-based test IDs
const testEmail = \`test-\${randomUUID()}@example.com\`;
`;

    case 'UPDATE_ASSERTION':
      return `
// OLD: expect(response).toBe('success')
// NEW: Check actual response structure
const response = await api.get('/endpoint');
expect(response.status).toBe(200);
expect(response.data).toEqual({
  id: expect.any(String),
  name: expect.any(String)
});
`;

    case 'FIX_SETUP':
      return `
// Verify test setup is complete
test.beforeEach(async ({ api, page }) => {
  // 1. Create test user
  const user = await createTestUser(api);
  // 2. Login
  await loginUser(page, user);
  // 3. Navigate to feature
  await page.goto('/feature');
});
`;

    case 'FIX_TYPES':
      return `
// Check type annotations match signatures
interface User {
  id: string;      // not number
  email: string;   // required
  age?: number;    // optional
}

const user: User = {
  id: '123',
  email: 'test@example.com'
};
`;

    case 'FIX_IMPORT':
      return `
// Verify import paths and file existence
import { MyService } from './services/MyService';  // file must exist
import { helper } from '../helpers';               // check relative path

// Or add missing export
export class MyService { ... }
`;

    case 'FIX_SYNTAX':
      return `
// Check for common syntax errors
const obj = { key: 'value' };    // not missing colon
const arr = [1, 2, 3];           // not trailing comma after last item
const fn = async () => { ... };  // async keyword placed correctly
`;

    case 'IMPLEMENT':
      return `
// Implement missing function or property
class UserService {
  async createUser(email: string): Promise<User> {
    // Implementation missing — add body
    return { id: '1', email };
  }
}
`;

    case 'UPDATE_SCHEMA':
      return `
// Add missing column to database schema
ALTER TABLE users ADD COLUMN phone_number VARCHAR(20);

// Or define schema in ORM
@Column()
phoneNumber: string;
`;

    case 'CREATE_MIGRATION':
      return `
// Create migration file for schema change
// File: migrations/001_add_user_phone.sql

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20)
);
`;

    case 'MANUAL_REVIEW':
    default:
      return `
// This error requires manual investigation
// Steps:
// 1. Review full error trace and context
// 2. Run failing code in isolation
// 3. Check logs (console, database, API)
// 4. Verify environment state
// 5. Update code based on findings
`;
  }
}
