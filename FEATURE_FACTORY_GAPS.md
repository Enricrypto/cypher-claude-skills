# Feature Factory Gap Analysis vs. E2E Loop Harness Model

**Date:** 2026-06-23  
**Comparing:** Feature Factory (current) vs. E2E Loop v1.0 (harness-driven)

---

## Summary

Your Feature Factory has **strong conceptual design** but **lacks harness guardrails**. It relies on:
- ✅ Memory-based learning
- ✅ Manual checkpoints
- ✅ Agent self-iteration (up to 3 tries)
- ❌ No deterministic phase gates
- ❌ No structured output validation
- ❌ No error categorization
- ❌ No regression detection
- ❌ No hard limits enforcement
- ❌ No phase-organized artifacts
- ❌ No clear escalation paths

**Result:** Manual approvals + self-iteration, but **no automated enforcement** of correctness. Tests can fail and pass without structural validation.

---

## The 10 Gaps (Side-by-Side Comparison)

### Gap 1: No Phase Gates (E2E Gap #2)

**E2E Loop:**
```typescript
phaseContracts['phase-1-test-generation'] = {
  acceptance: {
    requireAll: true,
    criteria: [
      { name: 'All Tests Passing', validator: (...), severity: 'CRITICAL' },
      { name: 'No Regressions', validator: (...), severity: 'CRITICAL' }
    ]
  }
}

canAdvancePhase(phase) // Returns: canAdvance, passRate, blockers
```

**Feature Factory:**
```
⏸ CHECKPOINT 1: Approve the story (manual, relies on human judgment)
⏸ CHECKPOINT 2: Approve the brief (manual, relies on human judgment)
⏸ CHECKPOINT 3: Open the PR (manual, relies on human judgment)
```

**Gap:** No automated contract validation. Agent decides it's ready; human approves based on reading. If human misses something, code ships broken.

**Risk:** Incomplete user stories approved → code doesn't match story → tests fail.

---

### Gap 2: No Acceptance Criteria Model (E2E Gap #5)

**E2E Loop:**
```typescript
// Contract is machine-checkable
{
  testsPassing: 100%,           // Must match
  browsersGreen: 3,             // Must match
  noRegressions: true,          // Must match
  allArtifactsCreated: true     // Must match
}
```

**Feature Factory:**
```
Story Writer creates:
- User story (prose)
- Acceptance criteria (prose: "Given... When... Then...")
Validator checks manually against story
```

**Gap:** No machine-readable acceptance criteria. If agent builds feature that passes user's eye-test but violates unstated constraints, it ships.

**Risk:** Validator misses edge case → feature ships with hidden bug.

---

### Gap 3: No Structured Output Schemas (E2E Gap #6)

**E2E Loop:**
```typescript
interface AgentPhaseOutput {
  phase: string,
  timestamp: ISO8601,
  status: 'PASS'|'FAIL'|'PARTIAL',
  details: {
    summary: string,
    artifacts: Array<{name, path, description}>,
    metrics: Record<string, number>,
    errors?: Array<{type, message, severity}>
  }
}

// Harness validates: JSON.parse(output) matches schema
```

**Feature Factory:**
```
Agent produces prose narrative:
"I've analyzed the codebase. Here's what I found:
- 3 relevant files
- Auth pattern used elsewhere
- May need migrations"

Downstream agent parses this manually.
```

**Gap:** Agents output prose → downstream agents parse → parsing errors → wrong decisions.

**Risk:** Validator misreads builder's output → approves incomplete feature.

---

### Gap 4: No Error Categorization (E2E Gap #5)

**E2E Loop:**
```typescript
errorPatterns = [
  { pattern: /no matching element/, category: 'SELECTOR_MISMATCH', fix: 'UPDATE_LOCATOR' },
  { pattern: /status 40[1345]/, category: 'API_CONTRACT', fix: 'UPDATE_PAYLOAD' },
  { pattern: /timeout/, category: 'TIMING_ISSUE', fix: 'INCREASE_TIMEOUT' }
]

analyzeError(errorMessage) // Returns: category, suggestedFix, code template
```

**Feature Factory:**
```
Backend Builder test fails:
"UserService test failed: User.email should be required"

Agent sees this and decides:
- "Maybe database schema issue"
- "Maybe validation logic issue"  
- "Maybe test expectation wrong"

Agent tries a fix (one of these above), hopes it works.
```

**Gap:** Error categorization is agent-inferred (guessed), not deterministic. Agent picks wrong fix class.

**Risk:** Agent fixes wrong layer → test passes locally → fails in production.

---

### Gap 5: No Regression Detection (E2E Gap #7)

**E2E Loop:**
```typescript
beforeRemediation = runTests(); // baseline
// ... agent makes changes ...
afterRemediation = runTests();

regressions = afterRemediation.failed
  .filter(t => beforeRemediation.passed.includes(t));

if (regressions.length > 0) {
  rollback();
  escalateToHuman('Agent broke X tests');
}
```

**Feature Factory:**
```
Backend Builder fixes 4 failing tests.
Test Verifier re-runs tests.
Tests pass.
Test Verifier approves.

(But Builder's fix broke 2 other tests that Test Verifier didn't run)
```

**Gap:** No before/after comparison. If fix breaks something in a different layer, undetected.

**Risk:** Feature shipped with broken tests in untested path.

---

### Gap 6: No Hard Loop Limits (E2E Gap #8)

**E2E Loop:**
```typescript
const maxIterations = 5;
const maxTotalTokens = 500_000;
const timeoutMs = 60 * 60 * 1000;

while (iteration < maxIterations) {
  const result = await agent(remediationPrompt);
  if (iteration === maxIterations) {
    escalateToHuman('Max attempts reached');
    process.exit(1);
  }
}
```

**Feature Factory:**
```
Backend Builder attempts: up to 3 times
Frontend Builder attempts: up to 3 times
Test Verifier attempts: up to 2 times

(But no overall timeout or token limit)
(Agent could loop for hours)
(No explicit escalation message)
```

**Gap:** Agent can loop indefinitely if tests never pass. No timeout, no token budget, no clear "give up" condition.

**Risk:** Loop runs for 2 hours, consumes $50 in tokens, user manually stops it.

---

### Gap 7: No Artifact Organization (E2E Gap #9)

**E2E Loop:**
```
e2e-loop/artifacts/
├── phase-0-audit/
│   ├── AUDIT_REPORT.md
│   ├── AUDIT_VALIDATION_REPORT.json
│   └── REMEDIATED_AUDIT_REPORT.md
├── phase-1-infrastructure/
├── phase-2-test-generation/
└── phase-3-remediation/
```

**Feature Factory:**
```
No dedicated artifact folders.
Outputs mixed in:
- ORCHESTRATOR.md (in root, not organized)
- agents/ (agent definitions, not outputs)
- skills/feature-factory/ (skill definition, not outputs)

When running a feature:
- Researcher Report? (Where is it? No standard location)
- Story? (In user's prompt, not saved)
- Spec? (In user's prompt, not saved)
```

**Gap:** No standard artifact storage location. Each run starts fresh; no history of what was generated.

**Risk:** Can't compare feature #1 to feature #2 patterns. Memory can't load prior artifacts.

---

### Gap 8: No Deterministic Escalation (E2E Gap #10)

**E2E Loop:**
```typescript
// Clear escalation rules
if (regressions.length > 0) escalate('REGRESSIONS');
if (iteration >= maxIterations) escalate('MAX_ITERATIONS');
if (passRate < 1.0) escalate('INCOMPLETE');

escalateToHuman({
  reason: 'MAX_ITERATIONS',
  iteration: 5,
  passRate: 0.92,
  failingTests: ['Test A', 'Test B'],
  artifacts: {...}
});
process.exit(1); // Explicit stop
```

**Feature Factory:**
```
Builder loops 3 times, tests still failing.
Agent says: "Stuck after 3 attempts, manual review needed"

But:
- No structured escalation output
- No clear "why" (which tests, which layer)
- No artifact cleanup before stopping
- No explicit stop signal
```

**Gap:** Escalation is informal (agent message). No guarantee human sees it. No structured context.

**Risk:** Human misses escalation message → assumes feature is done → merges broken code.

---

### Gap 9: No Live Verification (E2E Gap #4)

**E2E Loop:**
```typescript
// Test Auditor uses Playwright MCP
const testAuditor = await agent(auditPrompt, { agentType: 'playwright-mcp' });
// Navigates actual pages
// Calls actual endpoints
// Verifies selectors exist
// Detects ghost features BEFORE tests run
```

**Feature Factory:**
```
Spec Writer designs API endpoint: POST /api/users
Backend Builder implements it: POST /api/users
Test Verifier tests it: POST /api/users

Tests pass locally. Code ships.
Production: Endpoint doesn't exist (typo in route registration)
Tests were testing the design, not the reality.
```

**Gap:** No verification against live app. Tests designed against spec, not reality.

**Risk:** Ghost features (tests for endpoints that don't exist) ship to production.

---

### Gap 10: No Validation Schema Enforcement (E2E Gap #6)

**E2E Loop:**
```typescript
const schema = {
  phase: string,
  timestamp: ISO8601,
  status: 'PASS'|'FAIL'|'PARTIAL',
  details: { /* ... */ }
};

validateOutputSchema(phase, output);
// If invalid: reject, re-ask agent
// If valid: proceed
```

**Feature Factory:**
```
Validator reads Builder's output:
"Here's the code I wrote:

class UserService {
  constructor(db) { ... }
  async createUser(email) { ... }
}

I added a test for email validation."

Validator tries to parse this, extracts what it thinks was done.
But if Builder forgot to mention a file, Validator misses it.
```

**Gap:** No enforced output format. Parser relies on agent following implicit rules.

**Risk:** Builder forgets to mention a file → Validator misses it → Feature incomplete.

---

## Severity Summary

| Gap | Feature Factory Risk | E2E Loop Prevention |
|-----|---|---|
| 1: Phase Gates | ✅ Can approve incomplete feature | ✅ Harness validates contracts |
| 2: Acceptance Criteria | ✅ No machine-checkable standards | ✅ JSON contract validation |
| 3: Structured Output | ✅ Parser errors → wrong decisions | ✅ Schema validation before processing |
| 4: Error Categorization | ✅ Wrong fix applied | ✅ Deterministic lookup table |
| 5: Regression Detection | ✅ Agent breaks other tests undetected | ✅ Before/after comparison + rollback |
| 6: Hard Limits | ✅ Loop runs for hours | ✅ Max 5 iterations, 1 hour timeout |
| 7: Artifact Organization | ✅ No history, can't reuse patterns | ✅ Phase-organized folders |
| 8: Escalation | ✅ Human misses escalation message | ✅ Structured escalation report + exit(1) |
| 9: Live Verification | ✅ Ghost features ship | ✅ Playwright MCP verifies reality |
| 10: Validation Schema | ✅ Incomplete features approved | ✅ Output schema enforced |

---

## Implementation Priority for Feature Factory

### Phase 1 (Critical) — Harness Basics
1. **Feature State Tracker** — Track execution state (stage, agent, loop count)
2. **Phase Gates** — Define contracts for each stage
3. **Structured Output Schema** — Enforce JSON output from agents
4. **Artifact Folder Organization** — Store outputs by stage/run

### Phase 2 (Important) — Safety Rails
5. **Regression Detection** — Before/after test comparison
6. **Error Categorization** — Lookup table for common test failures
7. **Hard Limits** — Max iterations, timeout, token budget
8. **Escalation Handler** — Structured escalation with context

### Phase 3 (Enhancements) — Learning
9. **Live Verification** — Test spec against reality before implementation
10. **Acceptance Criteria Model** — Machine-checkable AC, not prose

---

## Quick Win: Harness Ports from E2E Loop

You can directly reuse these components:

```
e2e-loop/harness/
├── phase-gates.ts          ← Adapt for feature stages
├── error-categories.ts     ← Reuse for test failures (tests are tests!)
├── agent-output-schema.ts  ← Reuse exactly (rename types)
└── remediation-engine.ts   ← Adapt loop-back handler logic
```

**Estimated effort:**
- Port + adapt: 4-6 hours
- Test: 2-3 hours
- Integration: 3-4 hours
- **Total: ~10-13 hours to add harness to Feature Factory**

---

## Recommended Next Steps

1. **Read this analysis** to understand each gap
2. **Prioritize by severity** (Phase 1 critical for safety)
3. **Organize Feature Factory folder** (like E2E loop structure)
4. **Add harness components** (phase gates, schemas, error categorization)
5. **Add state tracking** (feature-state.json like ORCHESTRATOR mentioned)
6. **Add escalation handler** (explicit exit on limits)

---

## Conclusion

**Feature Factory is conceptually excellent** but needs **structural enforcement**. The E2E loop v1.0 shows how to do this with:
- Deterministic phase gates
- Structured output validation
- Error categorization
- Regression detection
- Hard limits
- Clear escalation

**Same patterns apply to Feature Factory.** Would you like me to outline the refactor plan for Feature Factory harness?
