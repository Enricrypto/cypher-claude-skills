# Architecture: How the E2E Loop Works

**Purpose:** Deep dive into system design, decision points, and guardrails

---

## System Philosophy

### The Core Problem We Solved

Your original loop had a fundamental issue:

```
Agent produces code → Agent tests code → Agent says "looks good" → Phase advances
                                         └─ Self-approval = no skepticism
```

This breaks down because:
1. Agent talks itself into approving its own work
2. Agent can forget instructions (Docker rebuild, tests aren't at 100%)
3. No external validation that things actually work
4. Loop can run forever if agent never reaches "done"

### The Solution: Harness-Driven Orchestration

```
Agent produces artifact → Harness validates → Harness decides next action
                        (measurable rules)   (deterministic gates)
```

Key insight: **Only the harness decides advancement.** Agents only produce and fix.

---

## Component Architecture

### 1. Phase Gates (`harness/phase-gates.ts`)

**Responsibility:** Define and validate acceptance criteria for each phase.

```typescript
phaseContracts = {
  'phase-2-test-generation': {
    acceptance: {
      requireAll: true, // ALL criteria must pass
      criteria: [
        {
          name: 'All Tests Passing',
          validator: (context) => { /* checks JSON results */ },
          severity: 'CRITICAL' // Can't ignore
        },
        {
          name: 'No Regressions',
          validator: (context) => { /* checks before/after */ },
          severity: 'CRITICAL'
        }
      ]
    },
    artifacts: {
      required: ['TEST_RESULTS.json', 'TEST_AUDIT_REPORT.md']
    }
  }
}
```

**Decision Flow:**

```
Agent finishes phase → Harness calls canAdvancePhase(phase, context)
                     → Harness evaluates ALL criteria
                     → Harness returns:
                        - canAdvance: true/false
                        - passRate: 0-100
                        - blockers: ["reason 1", "reason 2", ...]
                     → Harness decides next action
```

### 2. Error Categories (`harness/error-categories.ts`)

**Responsibility:** Deterministically categorize test failures into fix classes.

**Design:** Pattern matching lookup table

```typescript
errorPatterns = [
  {
    pattern: /no matching element|not found/i,
    category: 'SELECTOR_MISMATCH',
    fixClass: 'UPDATE_LOCATOR',
    suggestedFix: 'Use semantic locator (getByRole, getByTestId)'
  },
  {
    pattern: /status.*40[1345]/i,
    category: 'API_CONTRACT',
    fixClass: 'UPDATE_PAYLOAD',
    suggestedFix: 'Verify endpoint exists, auth headers, request schema'
  },
  // ... more patterns
]

analyzeError(errorMessage) → Finds matching pattern → Returns ErrorAnalysis
```

**Why deterministic?** Prevents agent from inferring wrong category and applying wrong fix.

### 3. Agent Output Schema (`harness/agent-output-schema.ts`)

**Responsibility:** Define and validate machine-readable agent output.

**Design:** TypeScript interfaces + JSON validation

```typescript
interface AgentPhaseOutput {
  phase: string;           // Guaranteed present
  timestamp: ISO8601;      // When agent ran
  status: 'PASS'|'FAIL'|'PARTIAL';  // Not prose, enum
  agent: string;           // Which agent
  details: {
    summary: string;       // One-liner
    artifacts: [...];      // Files created
    metrics: {};           // Numbers, not text
    errors?: [...];        // Structured errors
  }
}
```

**Validation:**

```
Agent outputs JSON → Harness calls validateOutputSchema(phase, output)
                  → Returns: { valid: true/false, errors: [...] }
                  → If invalid, harness rejects and re-asks agent
```

### 4. Remediation Engine (`harness/remediation-engine.ts`)

**Responsibility:** Orchestrate the Phase 2 loop with guardrails.

**Key Features:**

#### a. Mandatory Docker Rebuild

```typescript
async rebuildEnvironment() {
  // CRITICAL: This happens BEFORE every test run
  // Non-optional, cannot be skipped
  await exec('docker-compose down --volumes');
  await exec('docker-compose build --no-cache'); // Force fresh
  await exec('docker-compose up -d');
  await waitForServicesHealthy();
  // THEN tests can run
}
```

**Why?** Prevents the stale-state bug where tests run against old container.

#### b. Regression Detection

```typescript
beforeRemediation = {
  passed: ['Test A', 'Test B', 'Test C'],
  failed: ['Test D', 'Test E']
}

afterRemediation = {
  passed: ['Test A', 'Test C'],  // Test B broken!
  failed: ['Test D', 'Test E']
}

regressions = afterRemediation.failed
  .filter(t => beforeRemediation.passed.includes(t))
  // Result: ['Test B'] ← Regression detected

if (regressions.length > 0) {
  rollback();
  escalateToHuman('Agent broke previously passing tests');
}
```

#### c. Iteration Limits

```typescript
const maxIterations = 5;
const maxTotalTokens = 500_000;
const timeoutMs = 60 * 60 * 1000;

while (iteration < maxIterations) {
  const result = await agent(remediationPrompt);
  if (result.passRate === 1.0) {
    log('Success');
    break;
  }
  if (iteration === maxIterations) {
    escalateToHuman('Unable to reach 100% in 5 tries');
    process.exit(1);
  }
}
```

**Why?** Prevents infinite loops, ensures human review when auto-fix exhausted.

---

## Execution Flow

### Phase -1: Audit Preparation

```
┌─────────────────────────────────────────┐
│ Agent: Code Auditor                     │
│ Input: Code paths, feature description  │
│ Output: AUDIT_REPORT.md                 │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ Agent: Audit Reviewer                   │
│ Input: AUDIT_REPORT.md                  │
│ Output: AUDIT_VALIDATION_REPORT.json    │
│ Scoring: 0-100% completeness            │
└────────────┬────────────────────────────┘
             │
             ▼
┌──────────────────────────────┐
│ Harness Gate Check:          │
│ completenessScore >= 95%?    │
└──────┬──────────┬────────────┘
       │ No       │ Yes
       ▼          ▼
   ┌─────────────────────────────┐
   │ Agent: Gap Remediation      │
   │ Fix identified gaps         │
   └──────┬──────────────────────┘
          │
          ▼
       ┌──────────────────────┐
       │ Harness: Advance?    │
       │ All gaps fixed?      │
       └──────┬───────────────┘
              ▼
         Phase 0: Infrastructure
```

**Key Decision Point:** Harness validates completeness score. If < 95%, triggers gap remediation.

### Phase 1: Test Generation

```
┌─────────────────────┐
│ Agent: Test Planner │ → TEST_PLAN.md
└──────┬──────────────┘
       │
       ▼
┌──────────────────────┐
│ Agent: Test Generator│ → test files
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ Agent: Test Auditor              │
│ (Playwright MCP)                 │
│ - Navigate live app              │
│ - Verify selectors exist         │
│ - Verify APIs exist & schemas    │
│ - Check no ghost features        │
└──────┬───────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ Harness Gate:                   │
│ Test audit passed?              │
└──────┬──────────────┬───────────┘
       │ No           │ Yes
       ▼              ▼
    Fail         ┌──────────────────┐
                 │ Mandatory Docker  │
                 │ Rebuild           │
                 │ (Non-optional)    │
                 └────┬─────────────┘
                      │
                      ▼
                 ┌──────────────────┐
                 │ Run Tests        │
                 │ (npm run ...)    │
                 └────┬─────────────┘
                      │
                      ▼
                 ┌──────────────────┐
                 │ Harness:         │
                 │ 100% pass?       │
                 └───┬──────────┬───┘
                     │ No       │ Yes
                     ▼         ▼
                  Phase 2   Phase 3
                Remediation (Finalize)
```

**Key Decision Point:** Test audit must pass before tests run. No ghost features allowed.

### Phase 2: Remediation Loop

```
Iteration 1:
  ┌────────────────────────────┐
  │ Mandatory Docker Rebuild   │
  └────┬───────────────────────┘
       ▼
  ┌────────────────────────────┐
  │ Agent: Remediation         │
  │ Analyze failures           │
  │ Apply fixes                │
  └────┬───────────────────────┘
       ▼
  ┌────────────────────────────┐
  │ Run Tests                  │
  └────┬───────────────────────┘
       ▼
  ┌────────────────────────────┐
  │ Harness: Check             │
  ├────────────────────────────┤
  │ ✓ 100% pass? → Phase 3     │
  │ ✓ Regressions? → Rollback  │
  │ ✓ Iterations? → Escalate   │
  │ ✓ Improving? → Loop again  │
  └────────────────────────────┘
       │
       ├─ If improving → Iteration 2
       ├─ If improving → Iteration 3
       ├─ If improving → Iteration 4
       ├─ If improving → Iteration 5
       └─ If still < 100% at 5 → Escalate
```

**Key Decision Points:**
1. Each iteration uses fresh Docker
2. Regressions roll back immediately
3. Loop terminates at 5 iterations max
4. Escalation preserves all context

---

## Data Structures

### Artifact Organization

```
factory/e2e/artifacts/
├── phase-0-audit/
│   ├── AUDIT_REPORT.md
│   ├── AUDIT_VALIDATION_REPORT.json
│   └── REMEDIATED_AUDIT_REPORT.md
├── phase-1-infrastructure/
├── phase-2-test-generation/
│   ├── TEST_PLAN.md
│   ├── GENERATED_TESTS_MANIFEST.md
│   ├── TEST_AUDIT_REPORT.md
│   └── TEST_RESULTS.json
├── phase-3-remediation/
│   ├── REMEDIATION_ITER_1.md
│   ├── REMEDIATION_ITER_2.md
│   ├── REMEDIATION_ITER_3.md
│   ├── REMEDIATION_ITER_4.md
│   ├── REMEDIATION_ITER_5.md
│   ├── FINAL_TEST_RESULTS.json
│   └── ESCALATION_REPORT.json
└── phase-4-finalize/
    └── COMPLETION_REPORT.json
```

**Principle:** Each phase has its own folder. Easy navigation.

### JSON Structure Example: Test Results

```json
{
  "timestamp": "2026-06-23T10:30:00Z",
  "total": 45,
  "passed": 45,
  "failed": 0,
  "passRate": 1.0,
  "browsers": {
    "chromium": { "passed": 15, "failed": 0 },
    "firefox": { "passed": 15, "failed": 0 },
    "mobile-safari": { "passed": 15, "failed": 0 }
  },
  "failedTests": []
}
```

**Principle:** Machine-readable. No ambiguity.

---

## Decision Trees

### Phase Advancement

```
Can phase advance?
├─ Contract defined for this phase? YES → Evaluate contract
│  ├─ All CRITICAL criteria pass? NO → CANNOT ADVANCE
│  │  ├─ Blocker list: [...]
│  │  └─ Action: Retry phase or escalate
│  │
│  ├─ All CRITICAL criteria pass? YES
│  │  ├─ All IMPORTANT criteria pass? YES → CAN ADVANCE
│  │  ├─ All IMPORTANT criteria pass? NO → CAN ADVANCE WITH NOTES
│  │  │  └─ Log warnings, proceed
│  │  └─ NICE_TO_HAVE can fail without blocking
└─ Contract undefined? → ESCALATE (harness misconfiguration)
```

### Remediation Loop

```
Run tests → Compare before/after

Regressions detected?
├─ YES → Rollback changes, escalate to human (agent broke something)
└─ NO → Check pass rate
        ├─ 100% pass? → SUCCESS, advance to Phase 3
        ├─ < 100% and iteration < 5? → CONTINUE (loop again)
        ├─ < 100% and iteration = 5? → ESCALATE (max attempts)
        └─ Pass rate declining? → ESCALATE (stuck in loop)
```

---

## Safety Properties

### Guaranteed Properties

1. **Phase Progression:** Phases only advance when contracts are satisfied
   - ✅ No vague acceptance
   - ✅ No agent mood-based decisions
   
2. **Environment Freshness:** Docker always rebuilt before tests
   - ✅ No stale state bugs
   - ✅ Deterministic test results

3. **100% Pass Rate:** Loop requires 100% or escalates
   - ✅ No partial acceptance
   - ✅ Clear go/no-go decision

4. **Loop Termination:** Hard limits prevent infinite loops
   - ✅ Max 5 iterations
   - ✅ 1 hour timeout
   - ✅ 500k token budget

5. **Regression Detection:** Before/after comparison catches breaks
   - ✅ Automatic rollback on regression
   - ✅ Escalation to human

6. **Escalation Path:** Clear, deterministic escalation when needed
   - ✅ Full context preserved
   - ✅ No silent failures

---

## Performance Characteristics

| Phase | Typical Duration | Token Cost |
|-------|-----------------|------------|
| Audit Preparation | 10-15 min | 30-50k |
| Infrastructure | 2-5 min | 5-10k |
| Test Generation | 15-30 min | 50-100k |
| Remediation (per iteration) | 5-10 min | 20-40k |
| Finalize | 1-2 min | 2-5k |

**Total (happy path):** ~40 min, ~100-150k tokens  
**Total (with 5 remediation iterations):** ~80 min, ~250-350k tokens

---

## Failure Modes & Mitigations

| Failure Mode | Mitigation |
|--------------|-----------|
| Docker not running | Loop detects, escalates with clear error |
| Test auditor finds ghost features | Loop rejects, prevents wasted test runs |
| Regressions introduced | Automatic rollback, escalation to human |
| Loop never reaches 100% | Hard limit (5 iterations), escalate |
| Agent output invalid | Schema validation rejects, re-asks agent |
| Stale container used | Mandatory rebuild before every run |

---

## Extending the System

### Adding New Phase

1. Define contract in `phase-gates.ts`
2. Implement validator functions
3. Add workflow logic
4. Test with sample feature

### Adding New Error Category

1. Add pattern to `error-categories.ts`
2. Add corresponding fix class
3. Add fix code template
4. Test with failing test

### Modifying Remediation Logic

1. Edit `remediation-engine.ts`
2. Update iteration limits if needed
3. Test with deliberately broken tests
4. Verify escalation triggers correctly

---

## Conclusion

The system trades **flexibility** (agent decision-making) for **reliability** (harness guardrails). This is the right trade-off for test automation, where:

- ✅ Determinism is more important than adaptability
- ✅ Safety is more important than speed
- ✅ Clear escalation is better than silent failure
- ✅ 100% is better than "good enough"
