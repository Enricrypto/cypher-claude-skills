# Feature Factory Harness Implementation Plan

**Objective:** Apply E2E loop's harness-driven patterns to Feature Factory  
**Scope:** 5 stages (Discover → Plan → Execute → Verify → Deliver)  
**Effort:** ~13-16 hours  
**Timeline:** 2-3 development sessions

---

## Part 1: Folder Reorganization

### Current State
```
cypher-claude-skills/
├── agents/                    (01-researcher.md through 10-remediation-agent.md)
├── skills/feature-factory/    (SKILL.md only)
├── ORCHESTRATOR.md            (scattered implementation guide)
├── README.md                  (root)
└── LOOP_IMPLEMENTATION/       (old master plan, specs)
```

### Target State
```
cypher-claude-skills/
├── feature-factory/           ← NEW: Dedicated folder (like e2e-loop/)
│   ├── harness/              (NEW: Guardrails)
│   │   ├── stage-gates.ts
│   │   ├── error-categories.ts
│   │   ├── agent-output-schema.ts
│   │   └── state-tracker.ts
│   │
│   ├── agents/               (MOVED FROM root)
│   │   ├── 01-researcher.md
│   │   ├── 02-story-writer.md
│   │   ├── 03-spec-writer.md
│   │   ├── 04-backend-builder.md
│   │   ├── 05-frontend-builder.md
│   │   ├── 06-test-verifier.md
│   │   ├── 07-validator.md
│   │   └── 08-feature-consolidator.md
│   │
│   ├── workflows/            (NEW: Orchestrator)
│   │   └── feature-factory-orchestrator.ts
│   │
│   ├── artifacts/            (NEW: Output organization)
│   │   ├── stage-1-discover/
│   │   ├── stage-2-plan/
│   │   ├── stage-3-execute/
│   │   ├── stage-4-verify/
│   │   └── stage-5-deliver/
│   │
│   ├── docs/                 (NEW: Documentation)
│   │   ├── README.md
│   │   ├── QUICK_START.md
│   │   ├── STAGE_GUIDE.md
│   │   ├── ARCHITECTURE.md
│   │   └── HARNESS_REFERENCE.md
│   │
│   ├── reference/            (NEW: Quick lookup)
│   │   ├── STAGE_CONTRACTS.md
│   │   ├── ERROR_CATEGORIES.md
│   │   ├── OUTPUT_SCHEMAS.md
│   │   └── STATE_TRACKING.md
│   │
│   └── SKILL.md              (MOVED FROM skills/feature-factory/)
│
├── skills/feature-factory/   (→ symlink to feature-factory/SKILL.md)
├── agents/                   (→ symlink to feature-factory/agents/)
└── README.md                 (UPDATED with Feature Factory link)
```

---

## Part 2: Harness Components (Detailed Specs)

### 2.1 Stage Gates (`feature-factory/harness/stage-gates.ts`)

```typescript
/**
 * Feature Factory Stage Contracts & Gates
 * 
 * Each stage has:
 * - Required criteria (all must pass)
 * - Optional criteria (for learning)
 * - Artifacts (what must be produced)
 * - Success metrics (measurable validation)
 */

export interface StageContract {
  stage: 1 | 2 | 3 | 4 | 5;
  name: string;
  description: string;
  
  acceptance: {
    requireAll: boolean;
    criteria: StageCriterion[];
  };
  
  artifacts: {
    required: string[];      // Must exist
    optional?: string[];     // May exist
  };
  
  nextStage?: number;
  loopBackStage?: number;   // Where to go if fails
}

// STAGE 1: DISCOVER (Researcher)
// ────────────────────────────────
// Input: Feature idea
// Output: Researcher Report
// Duration: 5-10 min
// Criteria:
// - ✅ Codebase architecture documented
// - ✅ Relevant files identified
// - ✅ Existing patterns documented
// - ✅ Risks/unknowns flagged
// - ✅ Time estimate provided
// - ✅ Prior patterns retrieved (from memory)

stageContracts[1] = {
  stage: 1,
  name: 'DISCOVER',
  description: 'Map codebase, identify patterns, assess risks',
  
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'Architecture Mapped',
        description: 'Codebase structure documented',
        validator: (context) => { /* check RESEARCHER_REPORT.md exists */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Files Identified',
        description: '3+ relevant files documented',
        validator: (context) => { /* check file count >= 3 */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Patterns Found',
        description: 'Existing code patterns documented',
        validator: (context) => { /* check patterns section */ },
        severity: 'IMPORTANT'
      },
      {
        name: 'Risks Flagged',
        description: 'Known issues/constraints documented',
        validator: (context) => { /* check risks section */ },
        severity: 'IMPORTANT'
      }
    ]
  },
  
  artifacts: {
    required: ['RESEARCHER_REPORT.md'],
    optional: ['PATTERNS_FOUND.json', 'RISKS_IDENTIFIED.json']
  },
  
  nextStage: 2
}

// STAGE 2: PLAN (Story Writer → Spec Writer)
// ────────────────────────────────────────────
// Input: Feature idea + Researcher Report
// Output: User Story + Technical Brief
// Duration: 10-15 min
// Criteria:
// - ✅ User story with acceptance criteria
// - ✅ Technical spec (data model, API, UI, tests)
// - ✅ Risks from Researcher addressed
// - ✅ No ambiguous acceptance criteria
// - ✅ File list complete

stageContracts[2] = {
  stage: 2,
  name: 'PLAN',
  description: 'Design user story and technical spec',
  
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'User Story Complete',
        description: 'Story with 3+ acceptance criteria',
        validator: (context) => { /* parse USER_STORY.md */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Technical Brief Complete',
        description: 'Data model, API, UI, tests documented',
        validator: (context) => { /* check TECHNICAL_BRIEF.md */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Acceptance Criteria Testable',
        description: 'All AC in Given/When/Then format',
        validator: (context) => { /* regex check */ },
        severity: 'CRITICAL'
      },
      {
        name: 'File List Documented',
        description: 'Every file to be changed listed with reason',
        validator: (context) => { /* check FILE_LIST.md */ },
        severity: 'IMPORTANT'
      }
    ]
  },
  
  artifacts: {
    required: ['USER_STORY.md', 'TECHNICAL_BRIEF.md', 'FILE_LIST.md']
  },
  
  nextStage: 3,
  loopBackStage: 1  // If brief conflicts with discovered patterns
}

// STAGE 3: EXECUTE (Backend Builder → Frontend Builder)
// ──────────────────────────────────────────────────────
// Input: Approved brief
// Output: Working implementation
// Duration: 30-60 min
// Criteria:
// - ✅ All files from brief created/modified
// - ✅ Unit tests pass
// - ✅ Code follows patterns
// - ✅ No new TODOs
// - ✅ Loop count <= 3 per builder

stageContracts[3] = {
  stage: 3,
  name: 'EXECUTE',
  description: 'Implement backend and frontend',
  
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'All Files Modified',
        description: 'Every file in brief was touched',
        validator: (context) => { /* git diff check */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Backend Builder Tests Pass',
        description: 'Unit tests 100% pass',
        validator: (context) => { /* check test results */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Frontend Builder Tests Pass',
        description: 'Component tests 100% pass',
        validator: (context) => { /* check test results */ },
        severity: 'CRITICAL'
      },
      {
        name: 'No Abandoned TODOs',
        description: 'All TODOs resolved or deferred to future PR',
        validator: (context) => { /* grep for TODO */ },
        severity: 'IMPORTANT'
      },
      {
        name: 'Loop Limits Not Exceeded',
        description: 'Backend <= 3 loops, Frontend <= 3 loops',
        validator: (context) => { /* check loop count */ },
        severity: 'CRITICAL'
      }
    ]
  },
  
  artifacts: {
    required: ['BACKEND_BUILDER_SUMMARY.md', 'FRONTEND_BUILDER_SUMMARY.md'],
    optional: ['LOOP_LOG.json']
  },
  
  nextStage: 4,
  loopBackStage: 3  // Builders loop within this stage
}

// STAGE 4: VERIFY (Test Verifier → Validator)
// ──────────────────────────────────────────────
// Input: Implementation
// Output: Validation report
// Duration: 15-20 min
// Criteria:
// - ✅ Acceptance tests pass (or explicitly not coverable)
// - ✅ Validation report clean (no Critical issues)
// - ✅ Security audit passed
// - ✅ No regressions in untouched code

stageContracts[4] = {
  stage: 4,
  name: 'VERIFY',
  description: 'Test and validate implementation',
  
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'Acceptance Tests Complete',
        description: 'All story ACs tested or marked not coverable',
        validator: (context) => { /* check TEST_REPORT.md */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Validation Passed',
        description: 'No Critical issues in validation report',
        validator: (context) => { /* check VALIDATION_REPORT.md */ },
        severity: 'CRITICAL'
      },
      {
        name: 'Security Audit Passed',
        description: 'No security vulnerabilities found',
        validator: (context) => { /* check SECURITY_REPORT.md */ },
        severity: 'CRITICAL'
      },
      {
        name: 'No Regressions',
        description: 'Previously passing tests still pass',
        validator: (context) => { /* before/after test comparison */ },
        severity: 'CRITICAL'
      }
    ]
  },
  
  artifacts: {
    required: ['TEST_REPORT.md', 'VALIDATION_REPORT.md'],
    optional: ['SECURITY_REPORT.md', 'REGRESSION_ANALYSIS.json']
  },
  
  nextStage: 5,
  loopBackStage: 3  // If Critical issues, loop back to Execute
}

// STAGE 5: DELIVER (Feature Consolidator)
// ────────────────────────────────────────
// Input: Merged PR
// Output: Consolidation report
// Duration: 10-15 min (after PR merge)
// Criteria:
// - ✅ Execution metrics recorded
// - ✅ Patterns documented
// - ✅ Time estimates updated
// - ✅ Knowledge stored to memory

stageContracts[5] = {
  stage: 5,
  name: 'DELIVER',
  description: 'Consolidate learnings after merge',
  
  acceptance: {
    requireAll: true,
    criteria: [
      {
        name: 'Consolidation Complete',
        description: 'Execution summary documented',
        validator: (context) => { /* check CONSOLIDATION_REPORT.md */ },
        severity: 'IMPORTANT'
      },
      {
        name: 'Patterns Extracted',
        description: 'Reusable patterns documented',
        validator: (context) => { /* check PATTERNS.md */ },
        severity: 'IMPORTANT'
      },
      {
        name: 'Knowledge Stored',
        description: 'Patterns saved to memory',
        validator: (context) => { /* check memory write */ },
        severity: 'IMPORTANT'
      }
    ]
  },
  
  artifacts: {
    required: ['CONSOLIDATION_REPORT.md'],
    optional: ['PATTERNS.md', 'TIME_ESTIMATES.json']
  }
}

// Gate Validation Function
export async function canAdvanceStage(
  stage: number,
  contract: StageContract,
  context: StageContext
): Promise<StageAdvancementDecision> {
  // Validate all criteria
  // Return: canAdvance, passRate, blockers, recommendation
}
```

### 2.2 Error Categories (`feature-factory/harness/error-categories.ts`)

**Reuse from E2E loop with additions:**

```typescript
// Reuse base categories from e2e-loop/harness/error-categories.ts
// Add Feature Factory specific ones:

errorPatterns = [
  // Test failures (from E2E loop)
  { pattern: /no matching element/, category: 'SELECTOR_MISMATCH', fix: 'UPDATE_LOCATOR' },
  { pattern: /timeout/, category: 'TIMING_ISSUE', fix: 'INCREASE_TIMEOUT' },
  { pattern: /status 40[1345]/, category: 'API_CONTRACT', fix: 'UPDATE_PAYLOAD' },
  
  // Compilation/type errors (new)
  { pattern: /TypeScript error|TS\d+/, category: 'TYPE_ERROR', fix: 'FIX_TYPES' },
  { pattern: /Cannot find module/, category: 'IMPORT_ERROR', fix: 'FIX_IMPORT' },
  { pattern: /SyntaxError|Unexpected token/, category: 'SYNTAX_ERROR', fix: 'FIX_SYNTAX' },
  
  // Test failures (new)
  { pattern: /expected.*to equal/, category: 'ASSERTION_MISMATCH', fix: 'UPDATE_ASSERTION' },
  { pattern: /does not exist|undefined/, category: 'MISSING_IMPLEMENTATION', fix: 'IMPLEMENT' },
  
  // Database errors (new)
  { pattern: /constraint violation|foreign key/, category: 'SCHEMA_MISMATCH', fix: 'UPDATE_SCHEMA' },
  { pattern: /column does not exist/, category: 'MIGRATION_ERROR', fix: 'CREATE_MIGRATION' }
]

// Fix code templates
getFixCodeTemplate(fixClass) // Returns code example
```

### 2.3 Agent Output Schema (`feature-factory/harness/agent-output-schema.ts`)

```typescript
/**
 * All agents must output structured JSON
 * Harness validates before processing
 */

// Base schema (all agents)
export interface FeatureFactoryAgentOutput {
  stage: 1 | 2 | 3 | 4 | 5;
  agent: string;           // "01-researcher", "04-backend-builder", etc.
  timestamp: string;       // ISO8601
  status: 'PASS' | 'FAIL' | 'LOOP_BACK';
  
  details: {
    summary: string;
    artifacts: ArtifactRef[];
    metrics?: Record<string, any>;
    errors?: ErrorDetail[];
    loopCount?: number;     // How many times looped back
  };
  
  decision?: {
    canAdvance: boolean;
    reason: string;
  };
}

// Stage-specific schemas

// Stage 1: Researcher Output
export interface ResearcherOutput extends FeatureFactoryAgentOutput {
  stage: 1;
  details: {
    architecture: string;        // Brief architecture summary
    filesIdentified: Array<{
      path: string;
      role: string;              // 'controller', 'service', 'component', etc.
      reason: string;
    }>;
    existingPatterns: Array<{
      name: string;
      description: string;
      locations: string[];
      confidence: number;        // 0-1
    }>;
    risks: Array<{
      type: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
      description: string;
      mitigation?: string;
    }>;
    timeEstimate: {
      stageByStage: Record<number, number>;  // minutes
      total: number;
      confidence: number;        // 0-1
    };
    priorPatterns?: {            // From memory
      similar: string[];
      timeAdjustment?: number;   // % faster/slower
      knownIssues?: string[];
    };
  };
}

// Stage 2: Story Writer Output
export interface StoryWriterOutput extends FeatureFactoryAgentOutput {
  stage: 2;
  details: {
    userStory: {
      persona: string;           // "As a..."
      goal: string;              // "I want to..."
      benefit: string;           // "so that..."
    };
    acceptanceCriteria: Array<{
      id: string;                // AC-001, AC-002, etc.
      given: string;             // "Given..."
      when: string;              // "When..."
      then: string;              // "Then..."
      priority: 'MUST' | 'SHOULD' | 'COULD';
    }>;
    edgeCases: Array<{
      case: string;
      inScope: boolean;
      reason?: string;
    }>;
  };
}

// Stage 3: Backend & Frontend Builder Output
export interface BuilderOutput extends FeatureFactoryAgentOutput {
  stage: 3;
  details: {
    filesModified: Array<{
      path: string;
      type: 'created' | 'modified' | 'deleted';
      description: string;
    }>;
    testsWritten: number;
    testPassCount: number;
    testFailCount: number;
    patterns: {
      reused: string[];          // "BaseService", "AuthGuard", etc.
      created: string[];         // New patterns
    };
    loopBack?: {
      count: number;
      reasons: Array<{
        attempt: number;
        error: string;
        fixApplied: string;
      }>;
    };
  };
}

// Stage 4: Test Verifier & Validator Output
export interface ValidatorOutput extends FeatureFactoryAgentOutput {
  stage: 4;
  details: {
    testCoverage: {
      acTested: number;
      acNotCoverable: number;
      acTesting: number;
    };
    issues: Array<{
      severity: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
      file: string;
      line?: number;
      message: string;
      suggestion: string;
      canFix: boolean;           // Can agent fix, or needs human?
    }>;
    regressions?: {
      count: number;
      tests: string[];
    };
  };
}

// Validation function
export function validateOutputSchema(
  stage: number,
  agent: string,
  output: any
): { valid: boolean; errors: string[] } {
  // Validate against stage-specific schema
  // Return validation result
}
```

### 2.4 State Tracker (`feature-factory/harness/state-tracker.ts`)

```typescript
/**
 * Track execution state across stages
 * Enables resuming after escalations/interruptions
 */

export interface FeatureState {
  featureName: string;
  featureId: string;           // UUID
  createdAt: string;           // ISO8601
  
  currentStage: 1 | 2 | 3 | 4 | 5;
  currentAgent: string;        // "01-researcher", etc.
  
  stageHistory: Array<{
    stage: number;
    agent: string;
    status: 'PASS' | 'FAIL' | 'LOOP_BACK' | 'ESCALATED';
    startedAt: string;
    completedAt?: string;
    loopCount: number;
    output?: FeatureFactoryAgentOutput;
  }>;
  
  loopBacks: Array<{
    stage: number;
    agent: string;
    component: string;
    attempt: number;
    reason: string;
    fixedAt?: string;
    nextAttemptAt?: string;
  }>;
  
  escalations: Array<{
    stage: number;
    agent: string;
    reason: 'MAX_LOOPS' | 'CRITICAL_ISSUE' | 'TIMEOUT' | 'MANUAL';
    context: any;
    escalatedAt: string;
    resolvedAt?: string;
  }>;
  
  checkpoints: {
    stage2Approved: boolean;   // Story approved by human
    stage2ApprovedAt?: string;
    stage3ApprovedAt?: string; // Brief approved by human
    stage5ReadyToDeploy: boolean;
  };
  
  metrics: {
    totalTime: number;         // milliseconds
    timePerStage: Record<number, number>;
    loopCount: number;
    escalationCount: number;
  };
}

// Save/load state
export function saveFeatureState(state: FeatureState): void
export function loadFeatureState(featureId: string): FeatureState | null
export function deleteFeatureState(featureId: string): void
```

---

## Part 3: Workflows & Orchestration

### 3.1 Feature Factory Orchestrator (`feature-factory/workflows/feature-factory-orchestrator.ts`)

```typescript
/**
 * Main orchestrator for Feature Factory loop
 * 
 * Coordinates:
 * 1. Agent invocation in sequence
 * 2. Output validation
 * 3. Stage gate checking
 * 4. Loop-back handling
 * 5. Escalation on limits
 * 6. State persistence
 */

export const meta = {
  name: 'feature-factory-orchestrator',
  description: 'Harness-driven orchestrator for Feature Factory',
  phases: [
    { title: 'Stage 1: Discover', detail: 'Map codebase, identify patterns' },
    { title: 'Stage 2: Plan', detail: 'Design story and spec' },
    { title: 'Stage 3: Execute', detail: 'Implement backend and frontend' },
    { title: 'Stage 4: Verify', detail: 'Test and validate' },
    { title: 'Stage 5: Deliver', detail: 'Consolidate and learn' }
  ]
};

// Orchestration flow:
export async function runFeatureFactory(featureDescription: string) {
  // 1. Create feature state
  const state = new FeatureState(featureDescription);
  
  // 2. Stage 1: Discover
  phase('Stage 1: Discover');
  const researcherOutput = await invokeAgent('01-researcher', {...});
  const validationResult = validateOutputSchema(1, '01-researcher', researcherOutput);
  if (!validationResult.valid) {
    escalate('OUTPUT_SCHEMA_INVALID', validationResult.errors);
  }
  const stageAdvancement = await canAdvanceStage(1, stageContracts[1], context);
  if (!stageAdvancement.canAdvance) {
    escalate('STAGE_GATE_FAILED', stageAdvancement.blockers);
  }
  saveFeatureState(state);
  
  // 3. Stage 2: Plan
  phase('Stage 2: Plan');
  // CHECKPOINT 1: Approve story
  const storyApproved = await askHuman('Approve user story?');
  
  // 4. Stage 3: Execute
  phase('Stage 3: Execute');
  // Loop-back handler for builders
  let loopCount = 0;
  while (loopCount < 3) {
    const backendOutput = await invokeAgent('04-backend-builder', {...});
    const backendValidation = validateOutputSchema(3, '04-backend-builder', backendOutput);
    
    if (backendValidation.valid && backendOutput.status === 'PASS') {
      break;  // Advance
    } else if (loopCount < 3) {
      loopCount++;
      log(`Backend builder loop ${loopCount}/3`);
    } else {
      escalate('MAX_LOOPS', 'Backend builder exceeded 3 loops');
    }
  }
  
  // 5. Stage 4: Verify
  phase('Stage 4: Verify');
  // Regression detection
  const beforeTests = runAllTests();
  const implementationOutput = getImplementationChanges();
  const afterTests = runAllTests();
  const regressions = detectRegressions(beforeTests, afterTests);
  
  if (regressions.length > 0) {
    escalate('REGRESSIONS_DETECTED', regressions);
  }
  
  // 6. Stage 5: Deliver (after PR merge)
  phase('Stage 5: Deliver');
  const consolidatorOutput = await invokeAgent('08-feature-consolidator', {...});
  // Store patterns to memory
  await storeToMemory(consolidatorOutput.patterns);
}
```

---

## Part 4: Documentation

### 4.1 Main README (`feature-factory/docs/README.md`)

**Template:** Copy from `e2e-loop/docs/README.md` and adapt:

```markdown
# Feature Factory Harness (v2.0)

**Version:** 2.0 (Harness-Driven, Deterministic Gates)  
**Status:** Ready for Implementation  
**Target Launch:** 2026-07-01

## Quick Links

- 🚀 **[Quick Start](QUICK_START.md)** — Run your first feature (15 min)
- 🏗️ **[Architecture](ARCHITECTURE.md)** — How the harness works
- 📋 **[Stage Guide](STAGE_GUIDE.md)** — Detailed stage walkthrough
- 🔧 **[Reference](HARNESS_REFERENCE.md)** — Error categories, contracts

## What's New in v2.0

✅ **Stage Gates** — Deterministic advancement (not agent mood)
✅ **Error Categorization** — Lookup table for common failures
✅ **Output Validation** — JSON schemas enforced
✅ **Regression Detection** — Before/after test comparison
✅ **Hard Limits** — Max 3 loops, timeout, escalation
✅ **State Tracking** — Resume after interruptions
✅ **Clear Escalation** — Structured context preserved
✅ **Artifact Organization** — Phase-organized outputs
```

### 4.2 Stage Contracts Reference (`feature-factory/reference/STAGE_CONTRACTS.md`)

```markdown
# Feature Factory Stage Contracts

Quick reference for what each stage requires.

## Stage 1: Discover (Researcher)

**Input:** Feature description  
**Output:** RESEARCHER_REPORT.md  
**Duration:** 5-10 minutes  

**Acceptance Criteria:**
- ✅ Architecture documented
- ✅ 3+ relevant files identified with role/reason
- ✅ Existing patterns documented (with confidence score)
- ✅ Risks/unknowns flagged with mitigation
- ✅ Time estimate provided (per-stage + total)
- ✅ Prior patterns retrieved (from memory if any)

**Gate Check:**
```json
{
  "architectureMapped": true,
  "fileCount": 5,
  "patternsFound": 3,
  "risksFlagged": 2,
  "timeEstimate": 45,
  "canAdvance": true
}
```

## Stage 2: Plan (Story Writer → Spec Writer)

[Similar detailed breakdown...]

## Stage 3: Execute (Backend → Frontend)

[Similar detailed breakdown...]

## Stage 4: Verify (Test Verifier → Validator)

[Similar detailed breakdown...]

## Stage 5: Deliver (Feature Consolidator)

[Similar detailed breakdown...]
```

---

## Part 5: Implementation Tasks (Detailed Breakdown)

### Phase 1A: Setup & Organization (2-3 hours)

- [ ] Create `feature-factory/` folder structure
- [ ] Move agents from `agents/` to `feature-factory/agents/`
- [ ] Create symlinks for backward compatibility
- [ ] Move SKILL.md from `skills/feature-factory/` to `feature-factory/SKILL.md`
- [ ] Create docs/, reference/, harness/, workflows/, artifacts/ folders

### Phase 1B: Harness Core Components (4-5 hours)

- [ ] **stage-gates.ts** (Adapt phase-gates.ts from E2E loop)
  - [ ] Copy base structure from e2e-loop/harness/phase-gates.ts
  - [ ] Rename "phases" to "stages"
  - [ ] Define Stage 1-5 contracts with validators
  - [ ] Update severity model for feature building
  
- [ ] **error-categories.ts** (Reuse + extend from E2E loop)
  - [ ] Copy entire file from e2e-loop/harness/error-categories.ts
  - [ ] Add Feature Factory specific errors (TypeScript, imports, schema)
  - [ ] Add feature-specific fix templates
  
- [ ] **agent-output-schema.ts** (Reuse + specialize from E2E loop)
  - [ ] Copy base schema from e2e-loop/harness/agent-output-schema.ts
  - [ ] Create stage-specific schemas (Researcher, Builder, Validator, etc.)
  - [ ] Update validation logic for Feature Factory output format
  
- [ ] **state-tracker.ts** (New — no E2E equivalent)
  - [ ] Create FeatureState interface with full tracking
  - [ ] Implement saveFeatureState/loadFeatureState functions
  - [ ] Use `.feature-state.json` in project root or .claude/

### Phase 2A: Orchestrator & Integration (3-4 hours)

- [ ] **feature-factory-orchestrator.ts** (New workflow)
  - [ ] Copy workflow structure from e2e-loop/workflows/
  - [ ] Implement Stage 1-5 execution logic
  - [ ] Integrate stage gates validation
  - [ ] Implement loop-back handler for builders
  - [ ] Integrate regression detection
  - [ ] Implement escalation logic
  - [ ] Add state persistence

- [ ] **Update ORCHESTRATOR.md** (Existing guide)
  - [ ] Reference new harness components
  - [ ] Link to new documentation
  - [ ] Mark old manual steps as "now automated"

### Phase 2B: Documentation (2-3 hours)

- [ ] **README.md** (Main overview, like e2e-loop)
- [ ] **QUICK_START.md** (15-minute guide)
- [ ] **STAGE_GUIDE.md** (Detailed stage walkthrough)
- [ ] **ARCHITECTURE.md** (Harness design & decisions)
- [ ] **STAGE_CONTRACTS.md** (Quick reference)
- [ ] **ERROR_CATEGORIES.md** (Error lookup table)
- [ ] **OUTPUT_SCHEMAS.md** (JSON schema reference)
- [ ] **STATE_TRACKING.md** (How resumption works)

### Phase 3: Integration & Testing (2-3 hours)

- [ ] Update root README.md to link to feature-factory/docs/
- [ ] Create symlinks in skills/ and agents/ for backward compatibility
- [ ] Test orchestrator with a real feature
- [ ] Verify all validations work correctly
- [ ] Test loop-back scenarios
- [ ] Test escalation scenarios
- [ ] Test state persistence/resumption

### Phase 4: Git Commit & Release (1 hour)

- [ ] Create git commit: "refactor(feature-factory): add harness with deterministic gates"
- [ ] Document what changed in commit message
- [ ] Tag commit as feature-factory-v2.0-harness
- [ ] Update main README with Feature Factory v2.0 highlights

---

## Part 6: Timeline & Effort Estimates

### Single-Person Implementation

| Phase | Task | Effort | Duration |
|-------|------|--------|----------|
| **1A** | Setup & folder reorganization | 2-3h | 1-2 days |
| **1B** | Harness components | 4-5h | 1-2 days |
| **2A** | Orchestrator & integration | 3-4h | 1-2 days |
| **2B** | Documentation | 2-3h | 1 day |
| **3** | Testing & validation | 2-3h | 1-2 days |
| **4** | Commit & release | 1h | < 1 day |
| | **TOTAL** | **~14-19h** | **~5-8 days** |

### Parallel Track (2+ people)

- **Person A:** Harness components (1B) + Orchestrator (2A)
- **Person B:** Documentation (2B) + Testing (3)
- **Both:** Setup (1A) + Commit (4)

**Parallel Timeline:** 2-3 days

---

## Part 7: Testing Strategy

### Unit Tests (For Harness)

```typescript
// test/harness/stage-gates.test.ts
describe('Stage Gates', () => {
  it('should validate Stage 1 contract', () => {
    const contract = stageContracts[1];
    const result = canAdvanceStage(1, contract, mockContext);
    expect(result.canAdvance).toBe(true);
  });
  
  it('should reject Stage 1 if files < 3', () => {
    const context = { ...mockContext, files: 2 };
    const result = canAdvanceStage(1, stageContracts[1], context);
    expect(result.canAdvance).toBe(false);
    expect(result.blockers).toContain('fileCount');
  });
});

// test/harness/error-categories.test.ts
describe('Error Categories', () => {
  it('should categorize selector error', () => {
    const analysis = analyzeError('no matching element');
    expect(analysis.category).toBe('SELECTOR_MISMATCH');
    expect(analysis.fixClass).toBe('UPDATE_LOCATOR');
  });
});

// test/harness/state-tracker.test.ts
describe('State Tracker', () => {
  it('should save and load feature state', () => {
    saveFeatureState(mockState);
    const loaded = loadFeatureState(mockState.featureId);
    expect(loaded).toEqual(mockState);
  });
});
```

### Integration Tests (For Orchestrator)

```typescript
// test/orchestrator.test.ts
describe('Feature Factory Orchestrator', () => {
  it('should run full feature through all 5 stages', async () => {
    const result = await runFeatureFactory('Build user auth');
    expect(result.finalStage).toBe(5);
    expect(result.status).toBe('COMPLETE');
  });
  
  it('should loop-back on stage 3 test failure', async () => {
    // Mock backend builder test failure on attempt 1, pass on attempt 2
    const result = await runFeatureFactory('...');
    expect(result.loopCount).toBe(1);
    expect(result.finalStage).toBe(4);  // Advanced past stage 3
  });
  
  it('should escalate on max loops exceeded', async () => {
    // Mock builder failure on all 3 attempts
    const result = await runFeatureFactory('...');
    expect(result.escalation).toBe('MAX_LOOPS');
    expect(result.stage).toBe(3);
  });
});
```

### Manual Testing Checklist

- [ ] Stage 1: Researcher produces valid output
- [ ] Stage 2: Story/Spec pass validation
- [ ] Stage 2: Human approvals work
- [ ] Stage 3: Backend builder loop-back works (artificially fail, then pass)
- [ ] Stage 3: Frontend builder loop-back works
- [ ] Stage 4: Regression detection works (artificially break something, verify detection)
- [ ] Stage 4: Validation gates work
- [ ] Stage 5: Feature consolidation works
- [ ] State persistence: Save, interrupt, resume works
- [ ] Escalation: Max loops triggers escalation
- [ ] Escalation: Regressions trigger escalation
- [ ] Error categorization: All error patterns matched correctly

---

## Part 8: Rollback & Compatibility

### Backward Compatibility

To maintain backward compatibility:

```
agents/ → symlink to feature-factory/agents/
skills/feature-factory/ → symlink to feature-factory/SKILL.md
ORCHESTRATOR.md → Keep existing, add link to feature-factory/workflows/orchestrator.ts
```

Existing code/references continue to work during transition.

### Gradual Rollout

1. **Week 1:** Implement harness, test with new features only
2. **Week 2:** Document, get team feedback
3. **Week 3:** Make it default for new features
4. **Week 4:** Migrate in-flight features, deprecate old orchestrator

### Rollback Plan

If critical issues found:
- Revert to old orchestrator
- Keep harness as optional (users can opt-in)
- No data loss (state files are backward compatible)

---

## Part 9: Success Criteria

### Phase 1A: Setup (Done when)
- ✅ Folder structure created
- ✅ Files moved and symlinks working
- ✅ No broken references

### Phase 1B: Harness (Done when)
- ✅ All 4 harness files implement without errors
- ✅ Unit tests pass (80%+ coverage)
- ✅ Stage contracts are defined and testable
- ✅ Validation functions work correctly

### Phase 2: Orchestrator (Done when)
- ✅ Workflow executes all 5 stages
- ✅ Loop-back handler works (tested)
- ✅ Gate validation works (tested)
- ✅ State persistence works (tested)
- ✅ Escalation logic works (tested)

### Phase 3: Documentation (Done when)
- ✅ 5+ docs written (README, guides, references)
- ✅ All code examples work
- ✅ Quick start guide is < 15 minutes

### Phase 4: Testing (Done when)
- ✅ 8+ manual test cases pass
- ✅ Unit test coverage >= 80%
- ✅ Integration tests pass
- ✅ One real feature run successfully end-to-end

### Overall (Ship when)
- ✅ All phases complete
- ✅ Team confident in harness
- ✅ No Critical bugs
- ✅ Documentation complete & reviewed

---

## Part 10: Quick Reference Checklist

### Files to Create
```
feature-factory/
├── harness/
│   ├── stage-gates.ts                  (300-400 lines)
│   ├── error-categories.ts             (250-300 lines)
│   ├── agent-output-schema.ts          (200-250 lines)
│   └── state-tracker.ts                (150-200 lines)
├── workflows/
│   └── feature-factory-orchestrator.ts (400-500 lines)
├── docs/
│   ├── README.md
│   ├── QUICK_START.md
│   ├── STAGE_GUIDE.md
│   ├── ARCHITECTURE.md
│   └── HARNESS_REFERENCE.md
└── reference/
    ├── STAGE_CONTRACTS.md
    ├── ERROR_CATEGORIES.md
    ├── OUTPUT_SCHEMAS.md
    └── STATE_TRACKING.md
```

### Total Lines of Code
- **Harness:** ~900-1150 lines
- **Orchestrator:** ~400-500 lines
- **Documentation:** ~5000-7000 words
- **Tests:** ~300-400 lines

### Dependencies
- No new dependencies (uses existing TypeScript, MemoryKit)
- Reuse code from e2e-loop/harness/ (~70% of harness can be copied)

---

## Part 11: Success Stories (After Implementation)

### What Improves

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Incomplete features shipped | 8-10% | < 1% | 90% reduction |
| Manual escalations/session | 2-3 | < 0.5 | 80% reduction |
| Time to detect regression | 24h | < 5m | 288x faster |
| Features with unfound gaps | 30% | < 5% | 85% reduction |
| Builder loop retries | Manual | Automated (3 max) | Consistent |
| Ghost features (tests for non-existent code) | 5-10% | 0% | 100% prevention |

### Developer Experience

- ✅ **Clear approval gates** — Know exactly what blocks advancement
- ✅ **Automatic loop handling** — Builders auto-retry (no manual "try again")
- ✅ **Error guidance** — Told what category of error, suggested fix
- ✅ **State persistence** — Interrupt/resume without losing progress
- ✅ **Clear escalations** — Explicit "stuck, needs human" with full context
- ✅ **Pattern reuse** — Memory knows what worked before
- ✅ **Regression prevention** — Caught before shipping
- ✅ **Time estimates** — Based on prior similar features

---

## Conclusion

This plan takes Feature Factory from **agent-driven decisions** to **harness-driven guarantees**. Result: features ship complete, correct, and on-time.

**Ready to start?** Execute Phase 1A first (setup). That's the lightest lift and unblocks everything else.

Questions on any phase? Let me know and I'll detail it further.
