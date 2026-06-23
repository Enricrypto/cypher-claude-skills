# Quick Start — 15 Minutes

Get your first feature through Feature Factory in 15 minutes.

---

## Prerequisites

- Your codebase in Git
- All 8 agents activated (01-researcher through 08-feature-consolidator)
- Harness installed (`feature-factory/harness/*.ts`)

---

## Step 1: Describe Your Feature (1 min)

What do you want to build?

```bash
feature-factory --feature "Add two-factor authentication to user login"
```

The orchestrator will:
1. Create a feature state (saved for resumption)
2. Start Stage 1: DISCOVER

---

## Step 2: Stage 1 — Discover (5 min)

**Researcher** analyzes your codebase:

```
✓ Maps authentication architecture
✓ Identifies 5+ relevant files
✓ Documents existing patterns (Auth service, middleware, etc)
✓ Flags risks (session management, backward compatibility)
✓ Estimates time per stage
```

**Gate Check:**
- Architecture documented ✓
- Files identified ✓
- Patterns found ✓
- Risks flagged ✓

**Result:** ✅ PASS → Advance to Stage 2

---

## Step 3: Stage 2 — Plan (5 min)

**Story Writer** creates the user story:

```
As a user
I want to enable two-factor authentication
So that my account is more secure

Acceptance Criteria:
- Given I'm logged in, When I enable 2FA, Then I get a QR code
- Given I scan the QR code, When I enter the code, Then 2FA is enabled
- Given I have 2FA enabled, When I login, Then I'm prompted for TOTP
```

**Spec Writer** creates the technical brief:

```
Data Model:
  - Add: users.totp_secret (encrypted)
  - Add: users.totp_enabled (boolean)

API Endpoints:
  - POST /api/2fa/enable → Returns QR code
  - POST /api/2fa/verify → Validates TOTP token
  - DELETE /api/2fa/disable → Removes 2FA

Components:
  - TwoFactorSetup component
  - TOTPVerification component
```

**Checkpoints:**
- ⏸️ Approve story (manual)
- ⏸️ Approve brief (manual)

**Result:** ✅ BOTH APPROVED → Advance to Stage 3

---

## Step 4: Stage 3 — Execute (2+ min)

**Backend Builder** implements the API:

```typescript
// Attempt 1: Tests run
  ✓ All tests pass

// Status: PASS → Advance to Frontend
```

**Frontend Builder** implements the UI:

```typescript
// Attempt 1: Tests run
  ✓ All tests pass

// Status: PASS → Advance to Verify
```

**Loop-Back Example (if tests failed):**

```
Attempt 1:
  Error: "Cannot find module 'speakeasy'"
  → analyzeError() → FIX_IMPORT
  → Backend Builder retries ✓

Attempt 2:
  Error: "Type error: Expected User, got UserDTO"
  → analyzeError() → FIX_TYPES
  → Backend Builder retries ✓

Attempt 3:
  ✓ All tests pass
```

**Result:** ✅ TESTS PASS → Advance to Stage 4

---

## Step 5: Stage 4 — Verify (1+ min)

**Test Verifier** writes acceptance tests:

```typescript
test('2FA enables successfully', async () => {
  // Tests all 3 acceptance criteria
  expect(qrCode).toBeDefined();
  expect(totpEnabled).toBe(true);
  expect(loginPrompt).toContain('TOTP');
});
```

**Validator** checks implementation against spec:

```
✓ Story compliance: ✅ All AC covered
✓ Brief compliance: ✅ Schema matches, API correct
✓ Code quality: ✅ Patterns followed
✓ Security: ✅ No hardcoded secrets, input validated
✓ Regressions: ✅ No previously passing tests broken
```

**Result:** ✅ ALL CHECKS PASS → Advance to Stage 5

---

## Step 6: Stage 5 — Deliver (1 min post-merge)

After your PR is merged and deployed:

```bash
feature-factory --consolidate <feature-id>
```

**Feature Consolidator** extracts patterns:

```
Execution Summary:
  - Total time: 45 minutes
  - Loop-backs: 0 (on first try!)
  - Escalations: 0

Patterns Found:
  - Auth feature template (reuse for future auth work)
  - TOTP integration pattern
  - QR code generation pattern

Learnings:
  - What worked: Clear separation between API and UI
  - Next time: Pre-generate seed in database before showing QR
```

**Result:** ✅ COMPLETE → Feature shipped!

---

## Resume After Interruption

If the orchestrator is interrupted:

```bash
# Find your feature
feature-factory --list

# Resume from where you left off
feature-factory --resume 550e8400-e29b-41d4-a716-446655440000

# Orchestrator picks up from current stage with full history
```

---

## Check Status Anytime

```bash
# See current state
feature-factory --status <feature-id>

# Output:
#   Feature: Add two-factor authentication
#   Current Stage: 4 (Verify)
#   Status: IN_PROGRESS
#   Loop-backs: 2 (both recovered)
#   Time: 28 minutes
```

---

## If Something Escalates

**Schema Validation Failed:**
```
[ESCALATE] Stage 2: 03-spec-writer
Reason: Output schema invalid: missing fileList

→ Agent re-runs and produces valid JSON
→ Advance
```

**Gate Failed:**
```
[ESCALATE] Stage 3: harness
Reason: Backend tests 85% passing (need 100%)

→ Shows specific failing tests
→ Backend Builder loops back (up to 3 attempts)
→ Advance or escalate if still failing
```

**Max Loops Exceeded:**
```
[ESCALATE] Stage 3: 04-backend-builder
Reason: Exceeded max 3 attempts
Loop history:
  1. "Cannot find module" → FIX_IMPORT
  2. "Type error" → FIX_TYPES
  3. "Undefined reference" → IMPLEMENT

→ Escalate to human with full context
→ Human reviews and fixes
→ Resume or restart
```

**Regressions Detected:**
```
[ESCALATE] Stage 4: harness
Reason: 5 regressions detected
Tests broken:
  - auth.spec.ts: "login flow"
  - session.spec.ts: "session expires"
  - middleware.spec.ts: "auth guard"

→ Your implementation broke existing tests
→ Loop back to Stage 3
→ Fix the issues and re-run verification
```

---

## Success Checklist

✅ Stage 1: Researcher reports generated  
✅ Stage 2: Story + Brief approved  
✅ Stage 3: All tests passing, loops ≤ 3  
✅ Stage 4: AC tested, validation passed, no regressions  
✅ Stage 5: Patterns consolidated  

→ **Feature shipped correctly the first time** 🚀

---

## Next Steps

- **Full guide:** Read [STAGE_GUIDE.md](STAGE_GUIDE.md)
- **Architecture:** Read [ARCHITECTURE.md](ARCHITECTURE.md)
- **References:** See `reference/` folder
- **Advanced:** See [README.md](README.md)

---

**That's it!** From idea to deployed feature in ~45 minutes, with deterministic gates and zero regressions. 🎉
