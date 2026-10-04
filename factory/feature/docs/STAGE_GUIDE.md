# Stage Guide — Detailed Walkthrough

Deep dive into each of the 5 Feature Factory stages.

---

## Stage 1: DISCOVER

### What Happens

**Agent:** 01-Researcher  
**Duration:** 5-10 minutes  
**Input:** Feature description  
**Output:** RESEARCHER_REPORT.md

The Researcher analyzes your codebase to understand what exists, what patterns are in use, and what risks might exist.

### What Gets Validated

#### Architecture Mapped ✓
Does the Researcher understand your codebase structure?

```markdown
## Architecture

The codebase follows a standard 3-layer architecture:

**Controllers Layer:**
  - `src/controllers/` — HTTP request handlers
  - Express middleware for routing and validation

**Services Layer:**
  - `src/services/` — Business logic
  - Database queries, external API calls
  - Stateless, reusable across routes

**Data Layer:**
  - `src/models/` — TypeScript interfaces
  - `src/db/` — Database migrations and queries
```

**Gate checks:** Architecture description exists, layers identified, patterns clear.

#### Files Identified ✓
Are the relevant files documented with their roles?

```markdown
## Files to Modify

| File | Role | Why Modify |
|------|------|-----------|
| src/models/User.ts | Domain model | Add 2FA properties |
| src/services/AuthService.ts | Business logic | Implement 2FA logic |
| src/controllers/AuthController.ts | HTTP handler | Add 2FA endpoints |
| src/db/migrations/ | Schema | Add TOTP columns |
| src/components/Login.tsx | UI | Add 2FA prompt |

Total: 5 files identified
```

**Gate checks:** 3+ files identified, each with clear role and reason.

#### Patterns Found ✓
What reusable patterns exist?

```markdown
## Existing Patterns

| Pattern | Location | Confidence |
|---------|----------|------------|
| Auth Guard Middleware | src/middleware/auth.ts | HIGH |
| Service Pattern | src/services/ | HIGH |
| Database Transactions | src/db/queries.ts | MEDIUM |
| React Hooks | src/components/hooks/ | HIGH |

Recommendations:
- Reuse Auth Guard for 2FA check
- Follow Service pattern for TOTP logic
- Use transactions for atomic 2FA enable/disable
```

**Gate checks:** Patterns documented, confidence levels assigned, reuse recommendations clear.

#### Risks Identified ✓
What could go wrong?

```markdown
## Risks & Unknowns

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Session invalidation on 2FA enable | IMPORTANT | Test session handling thoroughly |
| Backward compatibility | IMPORTANT | Support users without 2FA enabled |
| TOTP seed generation | IMPORTANT | Use well-tested library (speakeasy) |
| Recovery codes | CRITICAL | Must implement before shipping |

Unknown:
- How to handle lost 2FA device (recovery codes?)
- Should we rate-limit failed TOTP attempts?
```

**Gate checks:** Major risks identified, severity assigned, mitigations proposed.

#### Time Estimate ✓
How long will each stage take?

```markdown
## Time Estimate

| Stage | Minutes | Confidence |
|-------|---------|-----------|
| Stage 1 (Discover) | 8 | HIGH |
| Stage 2 (Plan) | 12 | HIGH |
| Stage 3 (Execute) | 45 | MEDIUM |
| Stage 4 (Verify) | 20 | MEDIUM |
| Stage 5 (Deliver) | 10 | HIGH |
| **Total** | **95** | **MEDIUM** |

Confidence based on:
- 5 files to modify (medium complexity)
- Known patterns available
- No unknown dependencies
```

**Gate checks:** All stages estimated, confidence level assigned, reasoning clear.

### If Gate Fails

| Blocker | What to Do |
|---------|-----------|
| Files not identified | Researcher needs to dig deeper into codebase |
| Patterns not found | May indicate missing documentation or existing anti-patterns |
| Risks not flagged | Researcher may have missed edge cases (escalate or continue with caution) |
| Architecture unclear | Codebase may need better structure; clarify before proceeding |

### Success Criteria

✅ Architecture documented in 2-3 sentences  
✅ 3+ files identified with clear roles  
✅ 2+ existing patterns documented  
✅ 2+ risks flagged with mitigations  
✅ Time estimate with confidence level  

→ **Advance to Stage 2**

---

## Stage 2: PLAN

### What Happens

**Agents:** 02-Story Writer → 03-Spec Writer  
**Duration:** 10-15 minutes  
**Input:** Feature description + Researcher Report  
**Output:** USER_STORY.md, TECHNICAL_BRIEF.md, FILE_LIST.md

The Story Writer creates a user story with acceptance criteria. The Spec Writer creates a technical specification. Then two checkpoints: story approval, brief approval.

### Story Writer

**Job:** Turn the feature description into a formal user story with testable acceptance criteria.

**Validation:**

```markdown
As a user
I want to enable two-factor authentication on my account
So that I can protect my account from unauthorized access

## Acceptance Criteria

AC-001: Enable 2FA
  Given: I'm logged into my account
  When: I navigate to Security Settings and click "Enable 2FA"
  Then: I see a QR code and backup codes
  Priority: MUST

AC-002: Verify TOTP Token
  Given: I have a QR code displayed
  When: I scan it with an authenticator app and enter the 6-digit code
  Then: 2FA is enabled on my account
  Priority: MUST

AC-003: Login with 2FA
  Given: I have 2FA enabled
  When: I login with my password
  Then: I'm prompted for my TOTP code before gaining access
  Priority: MUST

AC-004: Disable 2FA
  Given: I have 2FA enabled
  When: I click "Disable 2FA" and confirm
  Then: 2FA is removed from my account
  Priority: SHOULD

## Edge Cases

- What if user loses access to authenticator app? (Out of scope — recovery codes are future work)
- What if user enters wrong TOTP code? (Rate limit after 5 attempts)
- Can user enable 2FA without a password? (No, password must be set first)
```

**Gate checks:**
- Story format: "As a... I want to... So that..."
- 3+ acceptance criteria in Given/When/Then format
- Priorities assigned (MUST/SHOULD/COULD)
- Edge cases documented

### Spec Writer

**Job:** Turn the approved story into a technical specification.

**Validation:**

```markdown
## Data Model

### users Table
```sql
ALTER TABLE users ADD COLUMN (
  totp_secret VARCHAR(32),        -- Encrypted TOTP seed
  totp_enabled BOOLEAN DEFAULT FALSE,
  backup_codes TEXT[]             -- Encrypted backup codes
);
```

## API Contract

### Enable 2FA
```
POST /api/auth/2fa/enable
Headers: Authorization: Bearer <token>
Response: {
  qrCode: "data:image/png;base64,...",
  backupCodes: ["AAAA-BBBB", "CCCC-DDDD", ...]
}
```

### Verify TOTP
```
POST /api/auth/2fa/verify
Body: { token: "123456" }
Response: { success: true }
```

### Disable 2FA
```
DELETE /api/auth/2fa
Headers: Authorization: Bearer <token>
Response: { success: true }
```

## Components

### TwoFactorSetup.tsx
- Props: user, onEnable
- State: qrCode, backupCodes, tokenInput
- Behavior: Show QR, accept token input, enable on validation

### TOTPVerification.tsx
- Props: onVerify, onForgotDevice
- State: tokenInput, attempts
- Behavior: Accept 6-digit code, rate-limit attempts

## File List

| File | Type | Reason |
|------|------|--------|
| src/services/TOTPService.ts | CREATE | TOTP generation/validation |
| src/models/User.ts | MODIFY | Add 2FA properties |
| src/controllers/AuthController.ts | MODIFY | Add 2FA endpoints |
| src/components/TwoFactorSetup.tsx | CREATE | Setup flow |
| src/components/TOTPVerification.tsx | CREATE | Login verification |
| src/db/migrations/001_add_2fa.sql | CREATE | Schema changes |

## Test Strategy

### Unit Tests
- TOTPService: Generate, verify, validate
- AuthController: Endpoint contracts

### Integration Tests
- Enable 2FA flow (database + service)
- Verify TOTP during login
- Disable 2FA flow

### E2E Tests
- Complete enable/disable flows
- Backup codes work
- Rate limiting works
```

**Gate checks:**
- Data model clear (schema, columns, types)
- API endpoints documented (method, path, payload, response)
- Components documented (props, state, behavior)
- File list complete (every file with reason)
- Test strategy documented (unit/integration/e2e)

### Checkpoints

#### CHECKPOINT 1: Approve Story
```
Human reviews: Does this story capture what you want?
  ✓ User story makes sense
  ✓ Acceptance criteria are clear
  ✓ Priorities are correct
  ✓ Edge cases documented

Human approves → Continue to Spec Writer
```

#### CHECKPOINT 2: Approve Brief
```
Human reviews: Is the technical approach correct?
  ✓ Schema makes sense
  ✓ API contract is RESTful
  ✓ Components match feature
  ✓ File list complete
  ✓ Tests cover all AC

Human approves → Advance to Stage 3
```

### If Gate Fails

| Blocker | What to Do |
|---------|-----------|
| AC not testable | Rewrite in Given/When/Then format |
| API design unclear | Define request/response more explicitly |
| Schema incomplete | Add all required columns before building |
| Edge cases missed | Identify and document them (in or out of scope) |
| File list wrong | Correct based on Researcher Report |

### Success Criteria

✅ User story in proper format  
✅ 3+ testable acceptance criteria  
✅ Technical brief complete (data model, API, components, files)  
✅ Both checkpoints approved by human  

→ **Advance to Stage 3**

---

## Stage 3: EXECUTE

### What Happens

**Agents:** 04-Backend Builder → 05-Frontend Builder  
**Duration:** 30-60 minutes  
**Input:** Approved brief  
**Output:** Working code + tests

The Backend Builder implements the API and data model. The Frontend Builder implements the UI. Both can loop back up to 3 times if tests fail.

### Backend Builder

**Job:** Implement API routes, database migrations, and business logic.

**Test Failures Trigger Loop-Back:**

```
Attempt 1:
  npm test
  × UserService test: 'should enable 2FA'
  Error: "Cannot find module speakeasy"
  
  → analyzeError() → IMPORT_ERROR
  → Backend retries ✓

Attempt 2:
  npm test
  ✓ 25 tests passing
  × 1 test failing
  Error: "Type 'string' not assignable to type 'Buffer'"
  
  → analyzeError() → TYPE_ERROR
  → Backend retries ✓

Attempt 3:
  npm test
  ✓ All 26 tests passing
  → recordAgentStep(status='PASS')
  → Advance to Frontend Builder
```

**Loop-Back Decision:**
- Tests pass? → Advance
- Tests fail? → Categorize error, retry (max 3)
- After 3 fails? → Escalate with full history

### Frontend Builder

**Job:** Implement React components and integrate with backend API.

**Same Loop-Back Pattern as Backend**

### Gate Check After Both Pass

```
✅ All files from FILE_LIST modified
✅ Backend tests: 26/26 passing (100%)
✅ Frontend tests: 18/18 passing (100%)
✅ Loop-backs: Backend 2, Frontend 1 (within limits of 3 each)
✅ Code follows patterns (AuthGuard, Service, etc)
✅ No abandoned TODOs

→ Advance to Stage 4
```

---

## Stage 4: VERIFY

### What Happens

**Agents:** 06-Test Verifier → 07-Validator  
**Duration:** 15-20 minutes  
**Features:** Regression detection  

The Test Verifier writes acceptance tests. The Validator checks implementation against the story and spec. Regression detection runs automatically.

### Regression Detection

```
Before Implementation (baseline):
  Total tests: 150
  Passing: 140
  Failing: 10

After Implementation:
  Total tests: 160 (150 + 10 new 2FA tests)
  Passing: 150 (140 existing + 10 new)
  Failing: 10 (unchanged baseline)

Check: Did any previously-passing tests break?
  Before: 140 passing
  After: 150 passing
  Result: 150 > 140 ✓ NO REGRESSIONS
```

### Gate Check

```
✅ All ACs tested (4 ACs, all tested)
✅ Validation passed (no Critical issues)
✅ Security audit passed (no vulnerabilities)
✅ No regressions (140 → 150 passing)

→ Advance to Stage 5
```

---

## Stage 5: DELIVER

### What Happens

**Agent:** 08-Feature Consolidator  
**Duration:** 10-15 minutes (post-merge)  
**Input:** Merged PR  
**Output:** CONSOLIDATION_REPORT.md

After your PR is merged and deployed, the Consolidator extracts patterns and learnings.

### Consolidation Report

```markdown
## Execution Summary

Feature: Add two-factor authentication  
Total Time: 47 minutes  
Loop-backs: 2 (both recovered)  
Escalations: 0  

## Patterns Extracted

### Pattern 1: Auth Feature Template
- Files touched: Service, Controller, Component (3 files)
- Avg time: 45 minutes
- Complexity: Medium
- Confidence: HIGH

Recommendation: Use this template for future auth features.

### Pattern 2: TOTP Integration
- Library: speakeasy
- Pattern: Generate → Store encrypted → Verify
- Reliability: HIGH

Recommendation: Reuse for multi-factor auth, FIDO2, etc.

## Learnings

### What Worked
- Clear separation between API and UI
- Reusing Auth Guard middleware
- Test-driven implementation

### What Could Be Better
- Pre-generate TOTP seed before showing QR code
- Had to retry on type errors (could have been caught earlier)

### Next Time
- Use stricter TypeScript settings upfront
- Test with authenticator apps earlier (not just unit tests)
- Plan recovery codes from day 1 (required by users)
```

---

## Summary

| Stage | Duration | Agent(s) | Validates | Next |
|-------|----------|---------|-----------|------|
| 1 | 5-10m | Researcher | Architecture, files, patterns, risks | 2 |
| 2 | 10-15m | Story Writer + Spec Writer | Story, brief, file list (+ 2 checkpoints) | 3 |
| 3 | 30-60m | Backend + Frontend | Tests pass, loops ≤ 3 | 4 |
| 4 | 15-20m | Test Verifier + Validator | AC tested, validation passed, no regressions | 5 |
| 5 | 10-15m | Consolidator | Patterns extracted, knowledge stored | Done |

---

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) — Design decisions
- [reference/STAGE_CONTRACTS.md](../reference/STAGE_CONTRACTS.md) — Detailed contracts
- [reference/ERROR_CATEGORIES.md](../reference/ERROR_CATEGORIES.md) — Error handling
- [reference/OUTPUT_SCHEMAS.md](../reference/OUTPUT_SCHEMAS.md) — JSON schemas
