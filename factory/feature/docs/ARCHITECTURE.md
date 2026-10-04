# Architecture — Design Decisions

The Feature Factory harness is built on 4 core principles and 5 key components.

---

## Core Principles

### 1. Deterministic > Subjective

**Problem:** In v1.0, agents decide when they're ready. Humans approve based on reading prose. Both can be wrong.

**Solution:** The harness has **explicit contracts** per stage. All CRITICAL criteria must pass. No exceptions, no override.

```typescript
Stage 3 Gate:
  ✓ All files from brief modified (checkable)
  ✓ Tests 100% passing (measurable)
  ✓ Loops ≤ 3 per builder (countable)

If even 1 CRITICAL fails → gate fails → no advance
Harness decides, not human mood or agent confidence.
```

### 2. Structured > Parsed

**Problem:** Agents output prose. Downstream agents parse it. Parsing errors → wrong decisions.

**Solution:** All agents **produce JSON** matching stage-specific schemas. Harness validates before processing.

```typescript
// OLD (v1.0)
// Agent outputs prose narrative
"I've analyzed the codebase. Here's what I found:
- 3 relevant files
- Auth pattern used elsewhere
- May need migrations"

// Validator reads this and guesses what was done.
// If validator misreads, feature breaks.

// NEW (v2.0)
{
  stage: 1,
  agent: "01-researcher",
  status: "PASS",
  details: {
    filesIdentified: [
      { path: "src/auth.ts", role: "service", reason: "..." }
    ],
    existingPatterns: [
      { name: "AuthGuard", locations: [...] }
    ]
  }
}

// Harness validates: validateOutputSchema(1, "01-researcher", output)
// If invalid → reject, re-ask agent
// If valid → downstream agent gets machine-readable data
```

### 3. Deterministic Error Recovery

**Problem:** Builders fail tests. Agents guess what went wrong. Guess wrong → wrong fix → still failing.

**Solution:** **Error lookup table** maps patterns to fix classes with code templates.

```typescript
// OLD (v1.0)
// Test fails: "Cannot find module X"
// Agent thinks: "Maybe import error? Maybe missing file? Maybe typo in name?"
// Agent tries something, hopes it works.

// NEW (v2.0)
errorPatterns = [
  {
    pattern: /Cannot find module|MODULE_NOT_FOUND/,
    category: 'IMPORT_ERROR',
    fixClass: 'FIX_IMPORT',
    suggestedFix: 'Verify path exists, check for typos in imports'
  }
]

analyzeError("Cannot find module 'speakeasy'")
  → { category: 'IMPORT_ERROR', fixClass: 'FIX_IMPORT' }

getFixCodeTemplate('FIX_IMPORT')
  → 
    "import { speakeasy } from 'speakeasy';  // Check: file exists"
    "import { spec } from './spec.ts';      // Check: path correct"
```

### 4. Observable > Hidden

**Problem:** Loops happen. Tests fail. Regressions occur. No one knows why.

**Solution:** **Full state tracking.** Every decision recorded. Resumable. Auditable.

```typescript
FeatureState {
  featureId: 'uuid',
  stageHistory: [
    { stage: 3, agent: '04-backend-builder', attempt: 1, error: "...", fix: "FIX_IMPORT" },
    { stage: 3, agent: '04-backend-builder', attempt: 2, error: "...", fix: "FIX_TYPES" },
    { stage: 3, agent: '04-backend-builder', attempt: 3, status: 'PASS' }
  ],
  escalations: [
    { stage: 4, reason: 'CRITICAL_ISSUE', count: 5, tests: [...] }
  ]
}

// Can resume:
feature-factory --resume <feature-id>
// or
// Analyze why it escalated:
feature-factory --debug <feature-id>
```

---

## Key Components

### Component 1: Stage Gates (`harness/stage-gates.ts`)

**Purpose:** Define acceptance criteria per stage. Validate before advancement.

**How It Works:**

```typescript
stageContracts[1] = {
  stage: 1,
  name: 'DISCOVER',
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'Architecture Mapped',
        validator: (context) => { /* checks exist */ },
        severity: 'CRITICAL'  // Must pass
      },
      {
        name: 'Files Identified',
        validator: (context) => { /* checks >= 3 */ },
        severity: 'CRITICAL'  // Must pass
      },
      {
        name: 'Patterns Found',
        validator: (context) => { /* checks exist */ },
        severity: 'IMPORTANT'  // Advisory
      }
    ]
  }
}

// Gate validation
const decision = await canAdvanceStage(1, contract, context);
// Returns: { canAdvance, passRate, blockers, recommendation }

// If blockers → no advance, escalate with blockers
// If no blockers → advance
```

**Key Insight:** The gate function is **async and testable**. Each criterion is a separate validator. Severity levels allow CRITICAL-only advancement vs IMPORTANT-advisory.

### Component 2: Error Categorization (`harness/error-categories.ts`)

**Purpose:** Map error messages to fix classes deterministically.

**How It Works:**

```typescript
errorPatterns = [
  { pattern: /Type.*not assignable/, category: 'TYPE_ERROR', fixClass: 'FIX_TYPES' },
  { pattern: /Cannot find module/, category: 'IMPORT_ERROR', fixClass: 'FIX_IMPORT' },
  // ... 30+ patterns
]

analyzeError(errorMessage)
  // Loops through patterns (most specific first)
  // Returns first match with confidence score

getRemediationInstruction(errorMessage)
  // Analyzes error
  // Returns formatted guidance

getFixCodeTemplate(fixClass)
  // Returns code example for fix class
  // Agent can copy-paste and adapt
```

**Key Insight:** Errors are **not random.** There's a deterministic pattern to failures. By cataloging patterns, we remove guessing.

### Component 3: Output Schemas (`harness/agent-output-schema.ts`)

**Purpose:** Define what each agent must produce. Validate before accepting output.

**How It Works:**

```typescript
interface ResearcherOutput extends FeatureFactoryAgentOutput {
  details: {
    architecture: { layers: string[] },
    filesIdentified: Array<{ path, role, reason }>,
    existingPatterns: Array<{ name, locations, confidence }>,
    risks: Array<{ severity, description }>
  }
}

validateOutputSchema(1, '01-researcher', output)
  // Checks: stage matches, agent matches, timestamp valid
  // Checks: architecture exists, filesIdentified.length >= 3
  // Returns: { valid, errors[] }

// If invalid → agent gets error list, re-runs
// If valid → harness processes output with confidence
```

**Key Insight:** Validation happens **before** processing, not after. Prevents cascading errors downstream.

### Component 4: State Tracker (`harness/state-tracker.ts`)

**Purpose:** Track every decision. Enable resumption and auditing.

**How It Works:**

```typescript
const state = createFeatureState('Add 2FA');

// Record steps
state = recordAgentStep(state, 1, '01-researcher', 'PASS', output);
state = recordLoopBack(state, 3, '04-backend-builder', 'Type error', 'FAIL', 'FIX_TYPES');
state = recordEscalation(state, 3, '04-backend-builder', 'MAX_LOOPS', '...');

// Persist
localStorage.set(state.featureId, serializeState(state));

// Resume
const loaded = loadFeatureState(featureId);
runFeatureFactory({ ...options, resumeFromState: loaded });
```

**Key Insight:** State is a **complete audit trail.** Can answer: "What happened at stage 3?" "Why did it escalate?" "Can we resume?"

### Component 5: Orchestrator (`workflows/feature-factory-orchestrator.ts`)

**Purpose:** Coordinate all 5 stages using harness components.

**How It Works:**

```typescript
async function runFeatureFactory(options) {
  let state = createFeatureState(options.featureName);

  // Stage 1
  const researcher = await invokeAgent('01-researcher', ...);
  if (!validateOutputSchema(1, '01-researcher', researcher).valid) {
    return escalate('SCHEMA_VALIDATION');
  }
  state = recordAgentStep(state, 1, '01-researcher', 'PASS', researcher);
  
  const gateDecision = await canAdvanceStage(1, stageContracts[1], context);
  if (!gateDecision.canAdvance) {
    return escalate('GATE_FAILED', gateDecision.blockers);
  }
  
  // Stage 2
  // ... (checkpoint, story writer, spec writer)
  
  // Stage 3
  while (loopCount < 3) {
    const builder = await invokeAgent('04-backend-builder', ...);
    if (builder.status === 'PASS') break;
    const analysis = analyzeError(builder.error);
    state = recordLoopBack(state, 3, '04-backend-builder', ..., analysis.fixClass);
    loopCount++;
  }
  
  // Stage 4
  const testBefore = runTests();
  const tests = await invokeAgent('06-test-verifier', ...);
  const testAfter = runTests();
  const regressions = detectRegressions(testBefore, testAfter);
  if (regressions.length > 0) {
    return escalate('REGRESSIONS', regressions);
  }
  
  // ... (continue through stages 4 & 5)
}
```

**Key Insight:** Orchestrator is a **state machine**. Each stage is deterministic. Failures are categorized and handled explicitly. No silent failures.

---

## Design Patterns

### Pattern 1: Gate Before Advance

Every stage has a gate. Gate is checkable, not subjective.

```
Stage N finishes
  ↓
Validate output schema ← If invalid, escalate
  ↓
Run gate validators ← If Critical fails, escalate
  ↓
All criteria met?
  ↓ YES
Advance to Stage N+1
  ↓ NO
Escalate with blockers
```

### Pattern 2: Loop-Back with Error Classification

Builders retry on test failure, but only after error is categorized.

```
Agent runs tests
  ↓
Tests fail?
  ↓ YES
Analyze error → { category, fixClass }
  ↓
Record loop-back with fix class
  ↓
Can retry (count < max)?
  ↓ YES
Agent retries with guidance
  ↓ NO
Escalate with loop history
```

### Pattern 3: Regression Detection

Compare test state before and after to catch breakage.

```
Before implementation:
  Total: 150, Passing: 140

After implementation:
  Total: 160, Passing: 150

Check: Did passing tests decrease?
  150 > 140? YES → No regression ✓
  Or escalate with broken test names
```

### Pattern 4: Deterministic Escalation

When harness can't proceed, escalate with full context.

```
Escalation {
  stage: 3,
  agent: '04-backend-builder',
  reason: 'MAX_LOOPS',
  context: {
    loopCount: 3,
    attempts: [
      { error: "...", fix: "FIX_IMPORT" },
      { error: "...", fix: "FIX_TYPES" },
      { error: "...", fix: "IMPLEMENT" }
    ]
  }
}

// Includes full history, not vague message
```

---

## Comparison: v1.0 vs v2.0

| Aspect | v1.0 | v2.0 | Why |
|--------|------|------|-----|
| **Gate Model** | Agent decides + human approves | Harness validates + human approves | Objective criteria |
| **Output Format** | Prose narrative | Structured JSON | Machine-checkable |
| **Error Handling** | Agent guesses fix | Lookup table + templates | Deterministic |
| **Loop-Backs** | Manual "try again" | Automated with history | Transparent |
| **Regression Detection** | None | Before/after comparison | Catch breaks early |
| **Escalation** | "Stuck" message | Structured report + context | Debuggable |
| **State Tracking** | None | Full resumption | Interrupt-safe |
| **Lines of Code** | ~500 | ~3,650 | +2 harness files |

---

## Why This Matters

### Before (Silent Failure)
```
Builder: Tests fail, agent guesses wrong fix, tests still fail
Builder: "We're stuck, can't figure it out"
Human: Spends 30 min debugging why tests fail
Feature: Shipped with workaround, breaks in production
```

### After (Observable Failure)
```
Builder: Tests fail
Harness: Error is "Cannot find module speakeasy"
         Category: IMPORT_ERROR
         Fix class: FIX_IMPORT
         Template: import { speakeasy } from 'speakeasy';
Builder: Applies fix, tests pass, continues
Human: No involvement needed, feature ships clean
```

---

## Trade-Offs

### Trade-Off 1: Code Complexity
- **Cost:** More harness code (~2,100 lines)
- **Benefit:** Less debugging, faster shipping, better observability
- **Worth It?** YES — harness is read-once, used 100× per team per year

### Trade-Off 2: Upfront Validation
- **Cost:** Each stage validates strictly, may slow down initially
- **Benefit:** Catches issues early, prevents cascading failures
- **Worth It?** YES — 1 hour validation saves 10 hours debugging

### Trade-Off 3: Less Agent Autonomy
- **Cost:** Agents can't skip steps, must follow gates
- **Benefit:** Predictable execution, no guessing, safer shipping
- **Worth It?** YES — humans still approve at 2 checkpoints

---

## Future Extensions

### Phase 2: Live Verification
Use Playwright MCP to verify endpoints/selectors exist before testing.

### Phase 3: Acceptance Criteria Model
Machine-checkable AC instead of prose Given/When/Then.

### Phase 4: AI Repair
Auto-generate fixes instead of just templates.

### Phase 5: Cross-Feature Learning
Learn failure patterns across all past features.

---

## References

- [README.md](README.md) — Overview
- [STAGE_GUIDE.md](STAGE_GUIDE.md) — Detailed stages
- [reference/STAGE_CONTRACTS.md](../reference/STAGE_CONTRACTS.md) — Contract details
- [harness/stage-gates.ts](../harness/stage-gates.ts) — Source code
