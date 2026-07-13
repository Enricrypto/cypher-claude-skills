/**
 * Error Categorization & Fix Mapping
 *
 * Deterministic lookup table for categorizing test failures.
 * Harness identifies error category → agent applies suggested fix.
 *
 * Key principle: "Error categorization is deterministic"
 * Don't ask agents to infer; tell them what category it is.
 * Agents apply fixes, harness validates.
 */

export interface ErrorPattern {
  pattern: RegExp; // Regex to match error message
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
  | 'UNKNOWN';

export type FixClass =
  | 'UPDATE_LOCATOR'
  | 'UPDATE_PAYLOAD'
  | 'INCREASE_TIMEOUT'
  | 'ADD_CLEANUP'
  | 'UPDATE_ASSERTION'
  | 'FIX_SETUP'
  | 'FIX_ENVIRONMENT'
  | 'MANUAL_REVIEW';

export interface ErrorAnalysis {
  category: ErrorCategory;
  fixClass: FixClass;
  confidence: number; // 0-1
  suggestedFix: string;
  suggestedCode?: string;
  requiresManualReview: boolean;
}

/**
 * Error Pattern Library
 * Ordered by specificity (most specific first, generic last)
 */
export const errorPatterns: ErrorPattern[] = [
  // ============================================================================
  // SELECTOR MISMATCHES
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
    pattern: /locator\.fill\(\): No matching element was found|No matching element|no element found/i,
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
    pattern: /Expected element, but element.textContent was null/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'Text content assertion failed — element exists but no text. Check innerHTML or use different selector.'
  },

  // ============================================================================
  // TIMING ISSUES
  // ============================================================================

  {
    pattern: /Timeout \d+ms.*waiting for|page\.goto.*Timeout/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Page load timeout — increase navigationTimeout in fixtures or add waitForLoadState()'
  },

  {
    pattern: /waitForFunction timed out|Timeout waiting for function to succeed/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Custom wait function timeout — increase timeout parameter or check condition logic'
  },

  {
    pattern: /expect.*toBeVisible.*timeout|not visible|not in viewport/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Element visibility timeout — wait longer before asserting visibility. May indicate slow render.'
  },

  {
    pattern: /waiting for locator to appear|Locator did not appear|timeout.*locator/i,
    category: 'TIMING_ISSUE',
    fixClass: 'INCREASE_TIMEOUT',
    suggestedFix: 'Locator wait timeout — increase timeout or verify element renders after state change'
  },

  // ============================================================================
  // API CONTRACT MISMATCHES
  // ============================================================================

  {
    pattern: /status.*40[1345]|401 Unauthorized|403 Forbidden|404 Not Found/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'API request failed with 4xx — verify endpoint exists, authentication headers correct, and path matches backend'
  },

  {
    pattern: /expected property.*but received undefined|Cannot read property.*of undefined/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'Response schema mismatch — API returned different structure than test expects. Check backend schema.'
  },

  {
    pattern: /Cannot find module|import.*failed|ERR_MODULE_NOT_FOUND/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'Missing dependency — verify API request helpers are imported correctly'
  },

  {
    pattern: /status 500|Internal Server Error|500 Server Error/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'Backend error — check API request payload, check backend logs, verify test data is valid'
  },

  {
    pattern: /assertion.*expected.*string.*received.*object|toEqual.*expected.*but received/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_ASSERTION',
    suggestedFix: 'Response data type mismatch — API returns object, test expects string (or vice versa). Update assertion.'
  },

  // ============================================================================
  // TEST DATA & POLLUTION
  // ============================================================================

  {
    pattern: /Unique constraint violation|duplicate key|already exists/i,
    category: 'DATA_COLLISION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Test data collision — previous test did not clean up. Add afterEach cleanup with UUID-based test data.'
  },

  {
    pattern: /foreign key constraint|constraint.*failed|violates constraint/i,
    category: 'DATA_COLLISION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Data dependency issue — parent record missing or deleted. Add proper setup/cleanup order.'
  },

  {
    pattern: /test.*pass.*individually.*fail.*together|passes when run alone|pollut/i,
    category: 'TEST_POLLUTION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Cross-test pollution — test A passes alone, fails with B. Add afterEach(() => cleanup) to delete test data.'
  },

  {
    pattern: /expected.*records.*got.*records|expected.*1.*got.*2/i,
    category: 'DATA_COLLISION',
    fixClass: 'ADD_CLEANUP',
    suggestedFix: 'Test data not isolated — multiple tests creating same record. Use UUID-based test IDs and cleanup.'
  },

  // ============================================================================
  // ASSERTION MISMATCHES
  // ============================================================================

  {
    pattern: /assertion.*expected.*but got|expect\(\).*to.*but/i,
    category: 'ASSERTION_MISMATCH',
    fixClass: 'UPDATE_ASSERTION',
    suggestedFix: 'Assertion failed — test expects X but code returns Y. Verify actual app behavior vs test expectation.'
  },

  {
    pattern: /expected status code.*got/i,
    category: 'ASSERTION_MISMATCH',
    fixClass: 'UPDATE_ASSERTION',
    suggestedFix: 'HTTP status code mismatch — backend returned different code than test expects. Update assertion or backend.'
  },

  // ============================================================================
  // SETUP & ENVIRONMENT
  // ============================================================================

  {
    pattern: /beforeEach|beforeAll|fixture.*undefined|Cannot read.*fixture/i,
    category: 'SETUP_FAILURE',
    fixClass: 'FIX_SETUP',
    suggestedFix: 'Test setup failed — fixture not initialized or beforeEach failed. Check fixture configuration and setup code.'
  },

  {
    pattern: /Cannot connect to database|connection.*refused|connection.*timeout/i,
    category: 'ENVIRONMENT_ISSUE',
    fixClass: 'FIX_ENVIRONMENT',
    suggestedFix: 'Database connection failed — verify Docker containers running, .env.test configured, database initialized'
  },

  {
    pattern: /docker.*not.*found|docker.*permission|Cannot connect to Docker|Docker.*error/i,
    category: 'ENVIRONMENT_ISSUE',
    fixClass: 'FIX_ENVIRONMENT',
    suggestedFix: 'Docker issue — ensure docker-compose up succeeded and containers are healthy. Run: docker ps'
  },

  {
    pattern: /ECONNREFUSED|connect.*ECONNREFUSED|connection.*refused/i,
    category: 'ENVIRONMENT_ISSUE',
    fixClass: 'FIX_ENVIRONMENT',
    suggestedFix: 'Application not running — ensure backend server and test environment are running'
  },

  // ============================================================================
  // FALLBACK (Generic)
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
        confidence: 0.9, // Confidence in categorization
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

  const instruction = `
## Error Analysis

**Category:** ${analysis.category}
**Fix Class:** ${analysis.fixClass}
**Confidence:** ${(analysis.confidence * 100).toFixed(0)}%

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

  return instruction;
}

/**
 * Get fix code template based on fix class
 */
export function getFixCodeTemplate(fixClass: FixClass): string {
  switch (fixClass) {
    case 'UPDATE_LOCATOR':
      return `
// OLD: locator.fill('input[name="email"]')
// NEW: Use semantic selector
await page.getByLabel('Email').fill(testEmail);
// OR with test ID
await page.getByTestId('email-input').fill(testEmail);
`;

    case 'UPDATE_PAYLOAD':
      return `
// Verify API request payload matches backend schema
const response = await api.post('/api/endpoint', {
  // Check backend API docs for required fields
  requiredField: 'value',
  typedField: number // not string
});
// Verify response structure
expect(response).toHaveProperty('id');
`;

    case 'INCREASE_TIMEOUT':
      return `
// OLD: page.goto(url)
// NEW: Add explicit timeout
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// OR wait for specific element
await page.getByRole('button').first().waitFor({ timeout: 5000 });
await page.getByRole('button').first().click();
`;

    case 'ADD_CLEANUP':
      return `
// Add afterEach cleanup
test.afterEach(async ({ api }) => {
  // Delete all test-created records
  for (const id of testDataIds) {
    await api.delete(\`/api/resource/\${id}\`);
  }
  testDataIds = [];
});

// Use UUID-based test IDs (unique per run)
const testEmail = \`test-\${randomUUID()}@example.com\`;
`;

    case 'UPDATE_ASSERTION':
      return `
// OLD: expect(response).toBe('success')
// NEW: Check actual response structure
const response = await api.get('/endpoint');
expect(response.status).toBe(200); // Status code, not body
expect(response.data).toEqual({ /* actual structure */ });
`;

    case 'FIX_SETUP':
      return `
// Verify fixtures are initialized
test.beforeEach(async ({ api, page }) => {
  // 1. Initialize test user
  const user = await createTestUser(api);
  // 2. Login
  await login(page, user);
  // 3. Navigate to feature
  await page.goto('/feature');
});
`;

    case 'FIX_ENVIRONMENT':
      return `
// Verify Docker and services are running
// Run: docker ps (should see all containers)
// Run: docker logs <container> (check for errors)
// Run: npm run test:setup (initialize test database)

// In test:
test('verify backend', async ({ api }) => {
  const health = await api.get('/health');
  expect(health.status).toBe(200);
});
`;

    case 'MANUAL_REVIEW':
    default:
      return `
// This error requires manual investigation
// Steps:
// 1. Review full error trace and context
// 2. Run test in isolation to narrow down cause
// 3. Check application logs
// 4. Verify environment state (Docker, database, etc.)
// 5. Update test or code as needed
`;
  }
}
