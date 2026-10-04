```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                  📋 FEATURE LOOP IMPLEMENTATION ROADMAP                      ║
║                                                                              ║
║            Complete Guide for Building the Automation Layer                 ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

# Implementation Roadmap

This document guides the next developer through implementing the automation layer for the Feature Loop system.

**Target Date:** July 1, 2026  
**Total Effort:** 46-67 hours (1.5-2.5 weeks, 1 developer)  
**Current State:** Design 100% complete, manual operation ready

---

## Before You Start

### Prerequisites
- ✅ Read `ORCHESTRATOR.md` (practical implementation guide)
- ✅ Review all 10 agent definitions in `agents/` directory
- ✅ Understand the 5-stage pipeline (DISCOVER → PLAN → EXECUTE → VERIFY → DELIVER)
- ✅ Familiarize yourself with `LOOP_IMPLEMENTATION/` specs

### What You'll Need
- Node.js 18+
- Git
- Access to the project repo
- Understanding of Claude Code + Agent SDK
- Familiarity with async/await and state management

---

## Week 1: Foundation (Days 1-5)

### Day 1-2: TASK 1 - Feature State Tracker (4-6 hours)

**Objective:** Create persistent state tracking for feature execution

**Files to Create:**
```
lib/
├── feature-state.js          (main state manager)
├── state-schema.json         (JSON schema for validation)
└── state-migrations.js       (schema version upgrades)
```

**What state-state.js should do:**
```javascript
// Save feature state after each stage
async function saveState(featureName, mode, stageData) {
  // Create .feature-state.json in project root
  // Track: current stage, agent, time, loop attempts
  // Enable resume from failure
}

// Load state to resume feature
async function loadState(featureName) {
  // Read .feature-state.json
  // Return: current stage, loop history, escalations
}

// Get loop count for agent
function getLoopCount(agent, component) {
  // Return: current attempt number (1, 2, or 3)
}

// Increment loop counter
function incrementLoop(agent, component) {
  // Increment: 1 → 2 → 3
  // When 3: trigger escalation
}
```

**Testing:**
- Create test suite: `test/feature-state.test.js`
- Test save/load cycle
- Test loop counter increment
- Test escalation triggers

**Done criteria:**
- [ ] State saved after each agent completes
- [ ] State loaded on resume
- [ ] Loop counts tracked correctly
- [ ] Tests passing

---

### Day 2-3: TASK 2 - Loop-Back Handler (6-8 hours)

**Objective:** Automatic retry + escalation when agents fail

**Files to Create:**
```
lib/
├── failure-detector.js       (parse agent output for errors)
├── retry-manager.js          (manage retry attempts)
├── escalation-handler.js     (handle escalations)
└── error-patterns.js         (regex patterns for error detection)

test/
├── failure-detector.test.js
├── retry-manager.test.js
└── escalation-handler.test.js
```

**failure-detector.js should:**
```javascript
// Parse agent output for failures
function detectFailure(agentOutput) {
  return {
    hasFailed: true/false,
    type: 'test-failure' | 'validation-error' | 'architecture-issue',
    severity: 'critical' | 'important' | 'minor',
    details: {
      message: 'Exact error message',
      file: 'path/to/file.ts',
      line: 42,
      suggestion: 'How to fix it'
    }
  };
}

// Determine if should retry or escalate
function shouldRetry(loopCount, maxAttempts) {
  return loopCount < maxAttempts;
}
```

**retry-manager.js should:**
```javascript
// Manage retry attempts
async function attemptRetry(agent, previousError, attemptNumber) {
  // Ask agent to fix based on previous error
  // Update state with attempt info
  // Return: new agent invocation with context
}

// Record failed attempt
function recordAttempt(agent, component, error, fix, result) {
  // Save to state: what failed, what was tried, outcome
  // Used later for escalation summary
}
```

**escalation-handler.js should:**
```javascript
// Create human-readable escalation summary
function formatEscalation(agent, component, attempts) {
  return {
    agent: 'Backend Builder',
    component: 'UserService.ts',
    error: 'Tests failing: validation',
    attempts: [
      { number: 1, fix: 'Added email validation', result: 'Still failing' },
      { number: 2, fix: 'Tried different approach', result: 'Still failing' },
      { number: 3, fix: 'Last attempt', result: 'Still failing' }
    ],
    needsHuman: true,
    message: 'Max attempts reached. Please review error and decide on fix.'
  };
}
```

**Testing:**
- Test failure detection (various error formats)
- Test retry logic (attempt counting)
- Test escalation formatting (human readability)

**Done criteria:**
- [ ] Failures detected automatically
- [ ] Retries triggered up to max attempts
- [ ] Escalations formatted clearly
- [ ] Tests passing

---

### Day 4: TASK 3 - Memory Initialization Fallback (2-3 hours)

**Objective:** Handle empty MemoryKit gracefully

**Files to Create:**
```
lib/
├── memory-fallback.js        (graceful degradation)
└── baseline-patterns.js      (default patterns if memory empty)
```

**memory-fallback.js should:**
```javascript
// Try to retrieve patterns, handle empty gracefully
async function getPatternsForFeature(featureType) {
  try {
    const patterns = await memoryKit.retrieve({
      feature_type: featureType
    });
    
    if (patterns && patterns.length > 0) {
      return patterns; // Found prior patterns
    }
  } catch (error) {
    // Memory unavailable
  }
  
  // Fallback: return baseline patterns with 0% confidence
  return getBaselinePatterns(featureType);
}

// Bootstrap for first feature of type
function getBaselinePatterns(featureType) {
  return {
    patterns: [],
    confidence: 0,
    note: 'No prior features found. Building from scratch.',
    expectation: 'Feature will be slower. Feature #2 will learn from this.'
  };
}
```

**baseline-patterns.js should:**
```javascript
// Generic patterns when memory empty
const BACKEND_BASELINE = {
  service_pattern: { confidence: 0, example: 'src/services/UserService.ts' },
  route_pattern: { confidence: 0, example: 'src/routes/users.ts' },
  error_handling: { confidence: 0 }
};

const FRONTEND_BASELINE = {
  component_pattern: { confidence: 0, example: 'src/components/UserForm.tsx' },
  hook_pattern: { confidence: 0, example: 'src/hooks/useUser.ts' }
};
```

**Testing:**
- Test memory retrieval success case
- Test memory empty case
- Test fallback patterns returned
- Test agents handle empty patterns gracefully

**Done criteria:**
- [ ] Agents don't fail if memory empty
- [ ] Baseline patterns returned
- [ ] User informed (first feature slower)
- [ ] Tests passing

---

### Day 5: Integration & Testing (4-6 hours)

**Objective:** Ensure Tasks 1-3 work together

**Activities:**
1. Run manual feature loop with state tracking
   - Invoke agents manually
   - Watch state save/load work
   - Verify loop counts tracked
   - Test escalation on failure

2. Test edge cases:
   - Feature starts, paused, resumed
   - Agent fails, retries, succeeds
   - Agent fails all retries, escalates
   - Memory empty on first feature type

3. Code review:
   - Check error handling
   - Verify logging/debugging info
   - Ensure code is readable
   - Add comments for complex logic

**Done criteria:**
- [ ] Manual feature loop works with state tracking
- [ ] Loop-backs work correctly
- [ ] Escalations present info clearly
- [ ] Memory fallback works
- [ ] All tests passing
- [ ] Code review passed

---

## Week 2: Automation Layer (Days 6-10)

### Day 6-7: TASK 4 - Auto-Fix Framework (4-6 hours)

**Objective:** Validator can auto-fix common guardrail violations

**Files to Create:**
```
lib/
├── auto-fix-templates.js     (fix patterns)
├── guardrail-fixer.js        (apply fixes)
├── fix-tester.js             (verify fixes work)
└── fix-patterns/             (template directory)
    ├── error-state.js
    ├── loading-state.js
    ├── use-effect-cleanup.js
    └── naming-convention.js
```

**guardrail-fixer.js should:**
```javascript
// Auto-fix based on guardrail type
async function autoFix(violation, codeFile) {
  switch(violation.type) {
    case 'error_state_missing':
      return injectErrorState(codeFile);
    case 'loading_state_missing':
      return injectLoadingState(codeFile);
    case 'cleanup_missing':
      return addUseEffectCleanup(codeFile);
    case 'naming_convention':
      return fixNamingConvention(codeFile);
    default:
      return null; // Not auto-fixable
  }
}

// Apply fix and verify
async function applyAndTest(originalCode, fixedCode) {
  // Save fixed code to file
  // Re-run tests
  // Return: success/failure + test results
}
```

**Testing:**
- Test error state injection
- Test loading state injection
- Test cleanup function addition
- Test fixes pass tests
- Test non-fixable violations return null

**Done criteria:**
- [ ] Common guardrails auto-fixable
- [ ] Fixed code passes tests
- [ ] Non-fixable violations skipped
- [ ] Tests passing

---

### Day 8-9: TASK 5 - Parallel Execution Manager (8-10 hours)

**Objective:** Backend + Frontend build in parallel

**Files to Create:**
```
lib/
├── worktree-manager.js       (create/cleanup worktrees)
├── dependency-manager.js     (Frontend waits for Backend)
├── merge-handler.js          (merge worktrees back)
└── parallel-orchestrator.js  (coordinate parallel execution)

test/
├── worktree-manager.test.js
├── dependency-manager.test.js
└── parallel-orchestrator.test.js
```

**worktree-manager.js should:**
```javascript
// Create worktree for parallel execution
async function createWorktree(name, baseOn = 'HEAD') {
  // git worktree add .worktrees/{name} {baseOn}
  // Return: worktree path
}

// Cleanup worktree
async function cleanupWorktree(name) {
  // git worktree remove .worktrees/{name}
}

// Track active worktrees
function getActiveWorktrees() {
  // Return list of current worktrees
}
```

**dependency-manager.js should:**
```javascript
// Frontend waits for Backend API contract
async function waitForBackendAPI(timeoutMs = 30000) {
  const pollInterval = 500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (fileExists('.feature-backend-api.md')) {
      return readFile('.feature-backend-api.md');
    }
    await sleep(pollInterval);
  }
  
  throw new Error('Backend API not ready after timeout');
}
```

**parallel-orchestrator.js should:**
```javascript
// Run Backend + Frontend in parallel
async function executeParallel(spec, researchers) {
  const backendPromise = runBackendBuilder(spec);
  const frontendReady = backendPromise.then(() => 
    runFrontendBuilder(spec)
  );
  
  await Promise.all([backendPromise, frontendReady]);
  return mergeWorktrees();
}
```

**Testing:**
- Test worktree creation/cleanup
- Test dependency waiting (API contract)
- Test parallel execution timing
- Test worktree merge
- Test failure handling

**Done criteria:**
- [ ] Worktrees created cleanly
- [ ] Frontend waits for Backend API
- [ ] Both builders run in parallel
- [ ] Worktrees merge successfully
- [ ] Tests passing

---

### Day 10: TASK 6 - CLI Orchestrator (10-12 hours)

**Objective:** `feature start "name"` command works end-to-end

**Files to Create:**
```
cli/
├── commands/
│   ├── start.js              (feature start)
│   ├── resume.js             (feature resume)
│   ├── status.js             (feature status)
│   └── list.js               (feature list)
├── orchestrator.js           (main orchestration logic)
└── checkpoint-ui.js          (interactive approval)

test/
├── orchestrator.test.js
└── commands.test.js
```

**orchestrator.js should:**
```javascript
// Main feature loop orchestration
async function orchestrateFeature(description, mode = 'standard') {
  const state = new FeatureState(description, mode);
  
  // Stage 1: DISCOVER
  console.log('🔍 Discovering patterns...');
  const researched = await invokeAgent('01-researcher', { description });
  state.saveStage('1_discover', researched);
  
  // Stage 2: PLAN
  console.log('📋 Planning feature...');
  const story = await invokeAgent('02-story-writer', researched);
  await checkpoint('story', story); // CHECKPOINT 1
  
  const spec = await invokeAgent('03-spec-writer', story);
  state.saveStage('2_plan', { story, spec });
  
  // Stage 3: EXECUTE
  console.log('⚙️  Building feature...');
  if (mode === 'standard') {
    const { backend, frontend } = await executeParallel(spec);
  } else if (mode === 'safe') {
    const backend = await invokeAgent('04-backend-builder', spec);
    const frontend = await invokeAgent('05-frontend-builder', spec);
  }
  
  const tests = await invokeAgent('06-test-verifier', spec);
  const review = await invokeAgent('11-reviewer-agent', { backend, frontend });
  
  // Stage 4: VERIFY
  console.log('✅ Validating...');
  const validation = await invokeAgent('07-validator', { backend, frontend, spec });
  await checkpoint('validation', validation); // CHECKPOINT 2
  
  // Stage 5: DELIVER
  console.log('📦 Consolidating...');
  const consolidation = await invokeAgent('08-feature-consolidator', {
    feature: description,
    metrics: state.getMetrics()
  });
  
  console.log('✅ Feature complete!');
  return state.getReport();
}

// Interactive checkpoint
async function checkpoint(name, data) {
  console.log(`\n⏸  CHECKPOINT: ${name}`);
  console.log(formatData(data));
  
  const answer = await promptUser('Approve? (yes/no/changes)');
  if (answer === 'no') throw new Error('Feature rejected');
  if (answer === 'changes') {
    // Handle requested changes
  }
}
```

**checkpoint-ui.js should:**
```javascript
// Interactive approval interface
async function promptApproval(title, data) {
  console.log(`\n╔════════════════════╗`);
  console.log(`║ ${title.padEnd(18)} ║`);
  console.log(`╚════════════════════╝\n`);
  
  console.log(formatAsTable(data));
  
  return await new Promise(resolve => {
    // Interactive prompt for user decision
    // Return: { approved, notes }
  });
}
```

**Testing:**
- Test full feature orchestration
- Test mode switching (safe/standard/fast)
- Test checkpoint interactions
- Test error handling + escalations
- Test state persistence

**Done criteria:**
- [ ] `feature start` command works
- [ ] All 5 stages execute in order
- [ ] Checkpoints work and pause
- [ ] Errors handled gracefully
- [ ] Tests passing

---

## Week 3: Polish & Metrics (Days 11-15)

### Day 11: TASK 7 - Checkpoint Automation (4-6 hours)

**Objective:** Automate approval gates with clear UI

**Files to Create:**
```
lib/
├── approval-ui.js            (formatted approval prompts)
└── approval-history.js       (track all approvals)
```

### Day 12-13: TASK 8 - Metrics & Reporting (6-8 hours)

**Objective:** Track cost/time + generate reports

**Files to Create:**
```
lib/
├── metrics-tracker.js        (token usage, time)
├── metrics-aggregator.js     (aggregate across features)
└── report-generator.js       (generate reports)
```

### Day 14-15: Polish & Final Testing (8-10 hours)

**Objective:** Ensure everything works smoothly

**Activities:**
- Run 3 complete feature loops end-to-end
- Verify all metrics collected correctly
- Test edge cases and error scenarios
- Code review entire implementation
- Write final documentation

---

## Testing Throughout

**Unit Tests:**
- Each module in isolation
- Test success and failure paths
- Mock external dependencies

**Integration Tests:**
- Modules working together
- State persistence + reload
- Agent invocation + response handling

**E2E Tests:**
- Full feature loop manual execution
- Verify all outputs + state saves
- Test escalations and resumptions

---

## Deployment Checklist

Before merging to main:

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] No console warnings/errors
- [ ] Performance acceptable
- [ ] Memory usage reasonable
- [ ] Works across different feature types

---

## What Success Looks Like

```bash
$ feature start "Add user profiles"

🔍 Discovering patterns...
   ✓ Mapped codebase
   ✓ Found 3 prior patterns
   ✓ Ready to build

📋 Planning feature...
   ✓ Story written: "As a user, I want..."
   ✓ Acceptance criteria: 5 items
   
   ⏸ CHECKPOINT 1: Plan Approval
   Ready to proceed? (yes/no) yes

⚙️  Building feature...
   Backend Builder
   ✓ Migration: users_add_profile
   ✓ Service: ProfileService
   ✓ Routes: POST /profiles
   
   Frontend Builder (waiting for Backend API...)
   ✓ Hook: useProfileUpload
   ✓ Component: AvatarUpload
   ✓ Page: /profile/edit
   
   ✓ Tests: All 7 acceptance criteria passing
   ✓ Code Review: Approved
   
✅ Validating...
   ✓ Spec compliance: All criteria met
   ✓ Guardrails: All 8 guardrails passing
   
   ⏸ CHECKPOINT 2: Validation Review
   Ready to merge? (yes/no) yes

📦 Consolidating...
   ✓ Code merged to main
   ✓ Patterns stored
   ✓ Metrics recorded
   
✅ Feature complete!

   Time: 11 minutes
   Cost: $0.18
   Pattern reuse: 65%
   Next feature: ~30% faster (based on patterns learned)
```

---

## Questions?

- **Architecture unclear?** → Read `LOOP_FRAMEWORK.md`
- **Agent responsibilities?** → Check `agents/*/`
- **How to invoke an agent?** → See `ORCHESTRATOR.md`
- **Testing strategy?** → Check this file's Testing section
- **State format?** → See example in TASK 1 section

---

## Success Criteria for Completion

✅ `feature start "name" --mode=standard` works end-to-end  
✅ All 5 stages execute automatically  
✅ Loop-backs happen automatically on failures  
✅ Escalations clear when human decision needed  
✅ Auto-fixes applied without manual intervention  
✅ Metrics tracked and reported  
✅ System 92% faster by feature #10 (projected)  
✅ Code well-tested and documented  

---

**Ready to build?** Start with Day 1: TASK 1 - Feature State Tracker. 🚀
