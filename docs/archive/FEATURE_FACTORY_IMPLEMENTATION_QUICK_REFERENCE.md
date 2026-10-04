# Feature Factory Harness: Quick Reference

## The 5 Phases of Implementation

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1A: Setup & Reorganization (2-3 hours)               │
│ ├─ Create feature-factory/ folder structure                 │
│ ├─ Move agents/ → feature-factory/agents/                  │
│ ├─ Move SKILL.md → feature-factory/SKILL.md                │
│ └─ Create symlinks for backward compatibility              │
│                                                             │
│ PHASE 1B: Harness Components (4-5 hours)                   │
│ ├─ stage-gates.ts (copy + adapt from E2E)                  │
│ ├─ error-categories.ts (copy + extend from E2E)            │
│ ├─ agent-output-schema.ts (copy + specialize from E2E)     │
│ └─ state-tracker.ts (new — feature state management)       │
│                                                             │
│ PHASE 2A: Orchestrator (3-4 hours)                          │
│ ├─ feature-factory-orchestrator.ts (main workflow)          │
│ ├─ Integrate stage gates                                    │
│ ├─ Implement loop-back handler                              │
│ ├─ Add regression detection                                 │
│ └─ Add escalation logic                                     │
│                                                             │
│ PHASE 2B: Documentation (2-3 hours)                         │
│ ├─ README.md (overview)                                     │
│ ├─ QUICK_START.md (15-min guide)                            │
│ ├─ STAGE_GUIDE.md (detailed stages)                         │
│ ├─ ARCHITECTURE.md (harness design)                         │
│ └─ reference/*.md (lookup tables)                           │
│                                                             │
│ PHASE 3: Integration & Testing (2-3 hours)                 │
│ ├─ Unit tests for harness components                        │
│ ├─ Integration tests for orchestrator                       │
│ ├─ Manual testing checklist (8+ scenarios)                  │
│ └─ End-to-end test with real feature                        │
│                                                             │
│ TOTAL: 13-18 hours over 5-8 days                            │
└─────────────────────────────────────────────────────────────┘
```

## What to Copy from E2E Loop

```typescript
// 1. phase-gates.ts → stage-gates.ts
// Copy: PhaseContract, ContractCriterion, gate validation logic
// Adapt: Rename phases to stages, create 5 stage contracts

import * as E2E from 'e2e-loop/harness/phase-gates';
// ~70% reusable, rename phase → stage

// 2. error-categories.ts (use entirely)
// Copy: errorPatterns array, analyzeError(), getFixCodeTemplate()
// Add: TypeScript errors, import errors, schema errors

import { errorPatterns, analyzeError } from 'e2e-loop/harness/error-categories';
// 100% reusable, just extend patterns

// 3. agent-output-schema.ts → agent-output-schema.ts
// Copy: Base schema, validation logic
// Adapt: Create stage-specific output types

import { AgentPhaseOutput } from 'e2e-loop/harness/agent-output-schema';
// 80% reusable, extend with stage-specific schemas
```

## Folder Structure (Before → After)

```
BEFORE:                          AFTER:
─────────────────────────────────────────────────────
agents/                          feature-factory/
├── 01-researcher.md            ├── agents/
├── 02-story-writer.md          │   ├── 01-researcher.md
├── ...                         │   └── ...
└── 08-feature-consolidator.md  ├── harness/
                                │   ├── stage-gates.ts
skills/feature-factory/         │   ├── error-categories.ts
└── SKILL.md                    │   ├── agent-output-schema.ts
                                │   └── state-tracker.ts
ORCHESTRATOR.md                 ├── workflows/
(at root)                       │   └── feature-factory-orchestrator.ts
                                ├── artifacts/
                                │   ├── stage-1-discover/
                                │   ├── stage-2-plan/
                                │   ├── stage-3-execute/
                                │   ├── stage-4-verify/
                                │   └── stage-5-deliver/
                                ├── docs/
                                │   ├── README.md
                                │   ├── QUICK_START.md
                                │   ├── STAGE_GUIDE.md
                                │   └── ARCHITECTURE.md
                                ├── reference/
                                │   ├── STAGE_CONTRACTS.md
                                │   ├── ERROR_CATEGORIES.md
                                │   └── OUTPUT_SCHEMAS.md
                                └── SKILL.md

+ Backward-compatible symlinks:
  agents/ → feature-factory/agents/
  skills/feature-factory/ → feature-factory/SKILL.md
```

## Stage Contracts at a Glance

```
STAGE 1: DISCOVER (Researcher)
├─ Input: Feature idea
├─ Output: RESEARCHER_REPORT.md
├─ Duration: 5-10 min
└─ Criteria: ✅ Architecture, ✅ Files, ✅ Patterns, ✅ Risks, ✅ Time estimate

STAGE 2: PLAN (Story Writer → Spec Writer)
├─ Input: Researcher Report
├─ Output: USER_STORY.md + TECHNICAL_BRIEF.md
├─ Duration: 10-15 min
├─ Criteria: ✅ Story, ✅ Brief, ✅ AC testable, ✅ File list
└─ ⏸️ CHECKPOINT: Human approves

STAGE 3: EXECUTE (Backend → Frontend)
├─ Input: Approved brief
├─ Output: Working code + tests
├─ Duration: 30-60 min
├─ Criteria: ✅ All files touched, ✅ Tests pass, ✅ Loops ≤ 3
└─ 🔄 Loop-back: If tests fail (max 3 attempts per builder)

STAGE 4: VERIFY (Test Verifier → Validator)
├─ Input: Implementation
├─ Output: TEST_REPORT.md + VALIDATION_REPORT.md
├─ Duration: 15-20 min
├─ Criteria: ✅ AC tested, ✅ Validation passed, ✅ Security passed, ✅ No regressions
└─ 🔄 Loop-back: If Critical issues (go back to stage 3)

STAGE 5: DELIVER (Feature Consolidator)
├─ Input: Merged PR
├─ Output: CONSOLIDATION_REPORT.md
├─ Duration: 10-15 min (after merge)
└─ Criteria: ✅ Consolidation complete, ✅ Patterns documented
```

## Harness Components Summary

| Component | Lines | Purpose |
|-----------|-------|---------|
| **stage-gates.ts** | 300-400 | Stage contracts + validation |
| **error-categories.ts** | 250-300 | Error lookup table + fix templates |
| **agent-output-schema.ts** | 200-250 | JSON schemas + validation |
| **state-tracker.ts** | 150-200 | Feature state persistence |
| **orchestrator.ts** | 400-500 | Main workflow + coordination |
| **Docs** | 5K-7K words | 5+ markdown guides |
| **Tests** | 300-400 | Unit + integration tests |

## Key Validations to Implement

```typescript
// Stage gate validation
canAdvanceStage(stage, contract, context)
  → { canAdvance, passRate, blockers, recommendation }

// Output validation
validateOutputSchema(stage, agent, output)
  → { valid, errors[] }

// Error categorization
analyzeError(errorMessage)
  → { category, fixClass, suggestedFix }

// Regression detection
detectRegressions(beforeTests, afterTests)
  → { regressions[], count }

// Loop-back logic
shouldLoopBack(agent, loopCount, maxLoops)
  → { shouldLoop, reason }

// State persistence
saveFeatureState(state) / loadFeatureState(id)
  → bool / FeatureState | null
```

## Testing Checklist

### Unit Tests (80%+ coverage)
- [ ] Stage 1 contract validation
- [ ] Stage 2 contract validation
- [ ] Stage 3 contract validation (including loop-back)
- [ ] Stage 4 contract validation
- [ ] Stage 5 contract validation
- [ ] Error categorization (10+ error patterns)
- [ ] Output schema validation (5+ schema types)
- [ ] State save/load/delete

### Integration Tests
- [ ] Full run: Stage 1 → 2 → 3 → 4 → 5
- [ ] Loop-back: Stage 3 fails → loops back → passes
- [ ] Escalation: Max loops reached → escalates
- [ ] Regression: Detected before advancing
- [ ] State persistence: Save → interrupt → resume

### Manual Tests (One per scenario)
- [ ] Researcher produces valid output
- [ ] Story/Spec approval gates work
- [ ] Builder loop-back works (fail 1x, pass)
- [ ] Regression detection catches breaks
- [ ] Validation gates reject Critical issues
- [ ] Escalation on max loops
- [ ] Escalation on regression
- [ ] State save/resume works

## Timeline Presets

### Dedicated Development (Part-time, 5-8 hours/week)
- **Week 1 (Tue-Fri):** Phase 1A + 1B
- **Week 2 (Mon-Tue):** Phase 2A + 2B
- **Week 2 (Wed-Fri):** Phase 3
- **Week 3 (Mon):** Phase 4 + Launch

### Sprint Development (Full-time, 8 hours/day)
- **Day 1 (2 sessions):** Phase 1A + 1B
- **Day 2 (2 sessions):** Phase 2A + 2B
- **Day 3 (2 sessions):** Phase 3 + testing
- **Day 4 (1 session):** Phase 4 + launch

### Parallel (2 people, 3-4 days)
- **Person A:** Phase 1B + 2A (harness + orchestrator)
- **Person B:** Phase 2B + 3 (docs + testing)
- **Both:** Phase 1A + Phase 4 (setup + launch)

## Success Metrics

| Metric | Target |
|--------|--------|
| Incomplete features shipped | < 1% (from 8-10%) |
| Manual escalations per session | < 0.5 (from 2-3) |
| Time to detect regression | < 5 min (from 24h) |
| Features with unfound gaps | < 5% (from 30%) |
| Test coverage | ≥ 80% |
| End-to-end test pass | 100% (before ship) |

## Quick Start (After Implementation)

```bash
# Run a feature through the harness
npm run feature-factory -- --feature "Build user auth"

# This will:
# 1. Run Stage 1 (Researcher) → validate → advance or escalate
# 2. Run Stage 2 (Story/Spec) → get approval → advance or escalate
# 3. Run Stage 3 (Builders) → auto-loop up to 3x → advance or escalate
# 4. Run Stage 4 (Verify) → detect regressions → advance or escalate
# 5. Run Stage 5 (Consolidate) → save patterns → done

# Or resume interrupted feature
npm run feature-factory -- --resume feature-id-123
```

## Files to Write

### Harness (Copy-Adapt from E2E, ~1200 lines)
```
feature-factory/harness/
├── stage-gates.ts                  ← Copy phase-gates.ts, rename phases→stages
├── error-categories.ts             ← Copy entirely, extend patterns
├── agent-output-schema.ts          ← Copy, add stage-specific schemas
└── state-tracker.ts                ← Write new (150-200 lines)
```

### Orchestrator (New, ~450 lines)
```
feature-factory/workflows/
└── feature-factory-orchestrator.ts ← Write new (orchestrates all stages)
```

### Documentation (Write new, ~6000 words)
```
feature-factory/docs/
├── README.md                       ← Overview + philosophy
├── QUICK_START.md                  ← 15-minute guide
├── STAGE_GUIDE.md                  ← Detailed stage breakdown
├── ARCHITECTURE.md                 ← Harness design decisions
└── HARNESS_REFERENCE.md            ← Technical reference

feature-factory/reference/
├── STAGE_CONTRACTS.md              ← Contract details
├── ERROR_CATEGORIES.md             ← Error → fix mapping
├── OUTPUT_SCHEMAS.md               ← JSON schema reference
└── STATE_TRACKING.md               ← Resume mechanics
```

### Tests (Write new, ~350 lines)
```
feature-factory/test/
├── harness/stage-gates.test.ts
├── harness/error-categories.test.ts
├── harness/agent-output-schema.test.ts
├── harness/state-tracker.test.ts
└── orchestrator.test.ts
```

---

**Start with Phase 1A.** It's the lightest lift and unblocks everything else.

**Got questions?** See `FEATURE_FACTORY_HARNESS_IMPLEMENTATION_PLAN.md` for the full breakdown.
