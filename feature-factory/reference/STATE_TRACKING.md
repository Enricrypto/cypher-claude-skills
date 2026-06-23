# State Tracking Reference

How Feature Factory tracks and resumes execution.

---

## The Feature State Object

```typescript
{
  // Identity
  "featureId": "550e8400-e29b-41d4-a716-446655440000",
  "featureName": "Add two-factor authentication",
  "createdAt": "2026-06-23T10:15:00Z",
  "createdBy": "engineer@company.com",

  // Current execution
  "currentStage": 3,
  "currentAgent": "04-backend-builder",
  "status": "IN_PROGRESS",

  // History of every step
  "stageHistory": [
    {
      "stage": 1,
      "agent": "01-researcher",
      "status": "PASS",
      "startedAt": "2026-06-23T10:15:00Z",
      "completedAt": "2026-06-23T10:22:00Z",
      "loopCount": 0,
      "output": { /* full agent output */ }
    },
    {
      "stage": 2,
      "agent": "02-story-writer",
      "status": "PASS",
      "startedAt": "2026-06-23T10:22:30Z",
      "completedAt": "2026-06-23T10:27:00Z",
      "loopCount": 0,
      "output": { /* full agent output */ }
    },
    {
      "stage": 3,
      "agent": "04-backend-builder",
      "status": "LOOP_BACK",
      "startedAt": "2026-06-23T10:30:00Z",
      "completedAt": "2026-06-23T10:35:00Z",
      "loopCount": 1,
      "error": { "message": "Cannot find module speakeasy" }
    }
  ],

  // Loop-back attempts
  "loopBacks": [
    {
      "stage": 3,
      "agent": "04-backend-builder",
      "reason": "IMPORT_ERROR: Cannot find module speakeasy",
      "attempt": 1,
      "fixApplied": "FIX_IMPORT",
      "result": "FAIL",
      "timestamp": "2026-06-23T10:35:00Z"
    },
    {
      "stage": 3,
      "agent": "04-backend-builder",
      "reason": "TYPE_ERROR: string not assignable to number",
      "attempt": 2,
      "fixApplied": "FIX_TYPES",
      "result": "PASS",
      "timestamp": "2026-06-23T10:40:00Z"
    }
  ],

  // Escalations
  "escalations": [],

  // Checkpoint approvals
  "checkpointApprovals": [
    {
      "stage": 2,
      "checkpointName": "Story Approval",
      "approvedAt": "2026-06-23T10:28:00Z",
      "approvedBy": "product-manager@company.com",
      "notes": "Looks good"
    }
  ],

  // Metrics
  "metrics": {
    "totalTime": 1800000,  // milliseconds (30 minutes)
    "timePerStage": {
      "1": 420000,    // 7 minutes
      "2": 720000,    // 12 minutes
      "3": 600000     // 10 minutes (still running)
    },
    "loopCount": 2,
    "escalationCount": 0
  },

  // Final state (only filled after completion)
  "completedAt": null,
  "completionStatus": null,
  "finalSummary": null,

  // Tags for searching/filtering
  "tags": ["auth", "security", "2fa"]
}
```

---

## Resumption Workflow

### 1. Feature Starts Fresh

```bash
feature-factory --feature "Add two-factor authentication"
```

→ Creates new `FeatureState`:
- featureId: new UUID
- status: "IN_PROGRESS"
- currentStage: 1
- stageHistory: []

### 2. Feature Gets Interrupted

```bash
# User interrupts mid-execution
# (Ctrl+C, browser closes, timeout, etc)
```

→ State persists to disk:
```
artifacts/feature-states/550e8400-e29b-41d4-a716-446655440000.json
```

### 3. Resume Feature

```bash
feature-factory --resume 550e8400-e29b-41d4-a716-446655440000
```

→ Orchestrator:
1. Loads saved state from disk
2. Reads currentStage and currentAgent
3. Picks up from that point
4. Continues with full history preserved

---

## State Persistence

### What Gets Persisted

✅ Full stageHistory (all steps taken)  
✅ All loopBack attempts (with errors and fixes)  
✅ All escalations (with reasons)  
✅ Checkpoint approvals (with timestamps)  
✅ Execution metrics (time, counts)  
✅ Full agent outputs (for debugging)

### Where It's Stored

```
feature-factory/artifacts/
  feature-states/
    550e8400-e29b-41d4-a716-446655440000.json
    a8b9c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6.json
    ...
```

Each feature gets its own JSON file.

### When It's Persisted

- ✅ After every successful stage
- ✅ After every loop-back attempt
- ✅ After every escalation
- ✅ On interruption (signal handler)

---

## Example Resumption Scenario

### Timeline

```
10:15  Start Stage 1
10:22  Stage 1 complete, save state
10:23  Start Stage 2 (Story Writer)
10:25  [USER INTERRUPTS] Browser crashes
       State saved with currentStage=2, currentAgent=02-story-writer
10:26  ??? (35 minutes later)
10:30  User resumes: feature-factory --resume <id>
       Orchestrator loads state
       Reads: currentStage=2, stageHistory=[Stage1 complete]
       Continues from Stage 2 (Story Writer)
       Doesn't re-run Stage 1 ✓
```

### State File at Interruption

```json
{
  "featureId": "550e8400...",
  "currentStage": 2,
  "currentAgent": "02-story-writer",
  "status": "IN_PROGRESS",
  "stageHistory": [
    {
      "stage": 1,
      "agent": "01-researcher",
      "status": "PASS",
      "completedAt": "2026-06-23T10:22:00Z"
    }
  ],
  "metrics": {
    "totalTime": 420000  // 7 minutes so far
  }
}
```

### Resumption Logic

```typescript
const savedState = loadFeatureState(featureId);

if (savedState.status === 'IN_PROGRESS') {
  // Resume from current stage
  if (savedState.currentStage === 2) {
    // Continue with Story Writer
    const storyOutput = await invokeAgent('02-story-writer', ...);
    // Then continue to Spec Writer
    const specOutput = await invokeAgent('03-spec-writer', ...);
    // etc
  }
}
```

---

## Debugging with State

### View Full History

```bash
feature-factory --debug 550e8400-e29b-41d4-a716-446655440000
```

Output:
```
Feature: Add two-factor authentication (550e8400...)
Status: IN_PROGRESS
Current Stage: 3

Timeline:
[PASS] Stage 1: 01-researcher (7 minutes)
  Architecture mapped ✓
  Files identified ✓
  Patterns found ✓

[PASS] Stage 2: 02-story-writer (5 minutes)
  Story written ✓

[PASS] Stage 2: 03-spec-writer (5 minutes)
  Spec written ✓

[LOOP_BACK] Stage 3: 04-backend-builder (Attempt 1)
  Error: Cannot find module speakeasy
  Fix: FIX_IMPORT
  Result: FAIL

[LOOP_BACK] Stage 3: 04-backend-builder (Attempt 2)
  Error: Type string not assignable to number
  Fix: FIX_TYPES
  Result: PASS

Total Time: 22 minutes
Loop-backs: 2
Escalations: 0
```

### View Specific Escalation

```bash
feature-factory --escalation 550e8400-e29b-41d4-a716-446655440000
```

Output:
```
[ESCALATION] Stage 3: 04-backend-builder

Reason: MAX_LOOPS
Severity: CRITICAL

Loop History:
1. Cannot find module speakeasy → FIX_IMPORT → FAIL
2. Type string not assignable to number → FIX_TYPES → FAIL
3. Undefined reference to User → IMPLEMENT → FAIL

Max attempts (3) exceeded.

Status: Waiting for manual review
Action: Fix issues and run:
  feature-factory --resume 550e8400-e29b-41d4-a716-446655440000
```

---

## State Cleanup

### Mark as Complete

```bash
feature-factory --complete 550e8400-e29b-41d4-a716-446655440000
```

→ Sets `status: "COMPLETED"` and `completionStatus: "SUCCESS"`

### Archive Old Features

```bash
feature-factory --archive --older-than 30d
```

→ Moves features older than 30 days to `artifacts/feature-states/archive/`

### List All Features

```bash
feature-factory --list
```

Output:
```
Active Features:
  550e8400... | Add two-factor authentication   | IN_PROGRESS | 22m
  a8b9c3d4... | Fix login timeout               | COMPLETED   | 35m
  c5d6e7f8... | Refactor auth middleware        | ESCALATED   | 18m

Archived Features:
  x1y2z3a4... | Add password reset              | COMPLETED   | 47d ago
  b2c3d4e5... | Update session storage          | COMPLETED   | 60d ago
```

---

## State Migration

### Backup State

```bash
feature-factory --backup 550e8400-e29b-41d4-a716-446655440000
```

→ Copies state to:
```
artifacts/feature-states/backups/550e8400-...--2026-06-23T11-30-00Z.json
```

### Export State

```bash
feature-factory --export 550e8400-e29b-41d4-a716-446655440000 > feature.json
```

→ Outputs full state as JSON to stdout (for sharing/analysis)

### Import State

```bash
feature-factory --import < feature.json
```

→ Creates new feature from exported state

---

## State Analytics

### Summary Stats

```bash
feature-factory --stats
```

Output:
```
Completed Features: 23
Total Time Invested: 24 hours
Average Feature Time: 62 minutes
Loop-back Rate: 1.2 per feature (industry avg: 2.1)
Escalation Rate: 0.1 per feature (industry avg: 0.3)

Patterns Extracted: 45
Most Reused Pattern: Auth Guard (12 uses)
Confidence Trending: ↑ 78% (was 72% last month)
```

### Per-Feature Stats

```bash
feature-factory --stats 550e8400-e29b-41d4-a716-446655440000
```

Output:
```
Feature: Add two-factor authentication

Execution Summary:
  Total Time: 1 hour 25 minutes
  Time Breakdown:
    Discover: 8 min (estimated 8 min) ✓
    Plan: 12 min (estimated 12 min) ✓
    Execute: 45 min (estimated 45 min) ✓
    Verify: 20 min (estimated 20 min) ✓
    Deliver: n/a (post-merge)

Loop-backs: 2
  - FIX_IMPORT: FAIL → PASS (1m)
  - FIX_TYPES: FAIL → PASS (5m)

Escalations: 0

Confidence: MEDIUM (0.75)
Patterns Extracted: 3
```

---

## Advanced: State Hooks

### Hook: On Escalation

```bash
# In config
hooks:
  on_escalation: "notify_slack.sh"
```

→ Calls script with escalation details:
```bash
notify_slack.sh "Stage 3 escalation: Backend builder MAX_LOOPS exceeded"
```

### Hook: On Completion

```bash
# In config
hooks:
  on_completion: "log_analytics.sh"
```

→ Called when feature completes, passes state file

---

## State Format

```json
{
  "version": "2.0",
  "schema": "FeatureState",
  "data": { /* state object */ }
}
```

This allows versioning as the harness evolves.

---

## Summary

| Operation | Command | Result |
|-----------|---------|--------|
| Start fresh | `--feature "desc"` | Create new state |
| Resume | `--resume <id>` | Load and continue |
| Debug | `--debug <id>` | Show full history |
| Complete | `--complete <id>` | Mark as done |
| List | `--list` | See all features |
| Stats | `--stats <id>` | Execution metrics |
| Backup | `--backup <id>` | Save copy |
| Export | `--export <id>` | Output JSON |
| Import | `--import` | Load from JSON |
