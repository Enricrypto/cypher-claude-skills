# Stage Contracts Reference

Quick lookup for acceptance criteria per stage.

---

## Stage 1: DISCOVER

**Agent:** Researcher  
**Duration:** 5-10 minutes  
**Required Artifacts:** RESEARCHER_REPORT.md

### CRITICAL Criteria (All Must Pass)

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **Architecture Mapped** | Does RESEARCHER_REPORT.md have "Architecture" section? | Yes, 2-3 sentences describing layers |
| **Files Identified** | How many files documented in filesIdentified[]? | >= 3 files |
| **Files Have Roles** | Does each file have role (service, controller, etc)? | Yes, all files have explicit roles |
| **Patterns Found** | Are existing patterns documented? | >= 2 patterns documented |
| **Risks Flagged** | Are risks/unknowns documented? | >= 2 risks identified |

### IMPORTANT Criteria (Advisory)

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **Time Estimate** | Is there a time estimate per stage? | Yes, with confidence level |
| **Prior Patterns** | Are prior patterns from similar features mentioned? | Yes, if available in memory |

### Gate Decision

```
IF all CRITICAL pass
  THEN canAdvance = true
  recommendation = "ADVANCE"
ELSE
  canAdvance = false
  blockers = [list of failed criteria]
  recommendation = "ESCALATE" or "WAIT"
```

---

## Stage 2: PLAN

**Agents:** Story Writer, Spec Writer  
**Duration:** 10-15 minutes  
**Required Artifacts:** USER_STORY.md, TECHNICAL_BRIEF.md, FILE_LIST.md  
**Checkpoints:** Story Approval (manual), Brief Approval (manual)

### Story Writer: CRITICAL Criteria

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **Story Format** | Does it start with "As a..."? | Yes, persona defined |
| **Goal Defined** | Is there "I want to..."? | Yes, goal is clear |
| **Benefit Defined** | Is there "so that..."? | Yes, benefit is explicit |
| **ACs in Format** | Are ACs in Given/When/Then? | Yes, all follow format |
| **AC Count** | How many acceptance criteria? | >= 3 ACs |
| **Priorities Set** | Does each AC have priority (MUST/SHOULD/COULD)? | Yes, all have priority |

### Spec Writer: CRITICAL Criteria

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **Data Model Defined** | Is schema/database documented? | Yes, columns/types specified |
| **API Endpoints** | Are endpoints documented? | Yes, method/path/payload/response |
| **UI Components** | Are components documented? | Yes, with props/state |
| **File List Complete** | Is every file to be modified listed? | Yes, no surprises |
| **Test Strategy** | Are unit/integration/e2e tests planned? | Yes, coverage strategy clear |

### Checkpoints

**CHECKPOINT 1:** Approve Story
- Does story capture what you want? (Manual approval)

**CHECKPOINT 2:** Approve Brief
- Is technical approach correct? (Manual approval)

### Gate Decision

```
IF all Story ACs in Given/When/Then format
  AND Spec has data model, API, components, files
  AND file list matches Researcher files
  THEN canAdvance = true
ELSE
  canAdvance = false
  blockers = [specific issues]
```

---

## Stage 3: EXECUTE

**Agents:** Backend Builder, Frontend Builder  
**Duration:** 30-60 minutes  
**Required Artifacts:** BACKEND_BUILDER_SUMMARY.md, FRONTEND_BUILDER_SUMMARY.md  
**Loop-Backs:** Max 3 per builder

### CRITICAL Criteria

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **All Files Modified** | How many files from FILE_LIST were modified? | 100% (all files touched) |
| **Backend Tests Pass** | How many backend tests passing? | 100% (0 failures) |
| **Frontend Tests Pass** | How many frontend tests passing? | 100% (0 failures) |
| **Backend Loops <= 3** | How many times did backend builder retry? | <= 3 attempts |
| **Frontend Loops <= 3** | How many times did frontend builder retry? | <= 3 attempts |

### Loop-Back Handling

```
If tests fail:
  1. Analyze error → { category, fixClass }
  2. Record loop-back with fix class
  3. Retry (if attempt < 3)
  4. If attempt == 3 and still failing → Escalate

If max loops exceeded:
  Escalate with full loop history
  Include error messages and fixes tried
```

### Gate Decision

```
IF all files modified
  AND backend tests 100%
  AND frontend tests 100%
  AND loops <= 3 each
  AND code follows patterns (no new violations)
  THEN canAdvance = true
ELSE
  canAdvance = false
  recommendation = "LOOP_BACK" or "ESCALATE"
```

---

## Stage 4: VERIFY

**Agents:** Test Verifier, Validator  
**Duration:** 15-20 minutes  
**Required Artifacts:** TEST_REPORT.md, VALIDATION_REPORT.md  
**Special:** Regression Detection

### CRITICAL Criteria

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **ACs Tested** | How many ACs from story have tests? | 100% (all ACs covered) |
| **Validation Passed** | Are there CRITICAL issues in validation? | No CRITICAL issues |
| **Security Passed** | Are there security vulnerabilities? | No vulnerabilities |
| **No Regressions** | Did previously passing tests stay passing? | Yes, regression count = 0 |

### Regression Detection

```
Test state BEFORE:
  Total: T1, Passing: P1

Test state AFTER:
  Total: T2, Passing: P2

Regression check:
  IF P2 < P1
    THEN regressions = P1 - P2
         escalate with failing test names
    ELSE no regressions ✓
```

### CRITICAL Issue Handling

```
If CRITICAL validation issue found:
  → recordEscalation('CRITICAL_ISSUE')
  → Loop back to Stage 3
  → Builder fixes issues
  → Re-run Stage 4
```

### Gate Decision

```
IF all ACs tested
  AND validation passed (no CRITICAL)
  AND security passed
  AND no regressions
  THEN canAdvance = true
ELSE
  canAdvance = false
  recommendation = "LOOP_BACK" (to Stage 3) or "ESCALATE"
```

---

## Stage 5: DELIVER

**Agent:** Feature Consolidator  
**Duration:** 10-15 minutes (post-merge)  
**Required Artifacts:** CONSOLIDATION_REPORT.md  
**When to Run:** After PR is merged and deployed

### CRITICAL Criteria

| Criterion | Check | Pass Condition |
|-----------|-------|----------------|
| **Consolidation Complete** | Is execution summary documented? | Yes, metrics recorded |
| **Patterns Extracted** | Are reusable patterns identified? | Yes, 2+ patterns documented |
| **Knowledge Stored** | Are patterns saved to memory? | Yes, for future features |

### Consolidation Report Contents

```
Execution Metrics:
  - Total time (minutes)
  - Time per stage breakdown
  - Loop count
  - Escalation count

Patterns Found:
  - Pattern name
  - How it was used
  - Confidence level
  - Recommendation for next use

Learnings:
  - What worked
  - What could be better
  - Recommendations for similar features
```

### Gate Decision

```
IF execution summary documented
  AND patterns extracted
  AND knowledge stored to memory
  THEN canAdvance = true (feature complete)
ELSE
  canAdvance = false
  recommendation = "CONSOLIDATE_MANUALLY"
```

---

## Summary Table

| Stage | Duration | CRITICAL Count | Loop-Backs | Checkpoints |
|-------|----------|---|---|---|
| 1 | 5-10m | 5 | None | None |
| 2 | 10-15m | 8 | None | 2 (manual) |
| 3 | 30-60m | 5 | Max 3 per builder | None |
| 4 | 15-20m | 4 | Auto loop to S3 | None |
| 5 | 10-15m | 3 | None | Manual run post-merge |

---

## Escalation Triggers

| Trigger | When | Action |
|---------|------|--------|
| **Schema Invalid** | Output doesn't match stage schema | Re-run agent |
| **CRITICAL Gate Fails** | Required criterion not met | Escalate or loop-back |
| **Max Loops** | Builder exceeds 3 attempts | Escalate with history |
| **Regressions** | Previously passing tests now fail | Loop back to Stage 3 |
| **Validation CRITICAL** | Major issue found in Stage 4 | Loop back to Stage 3 |
| **Timeout** | Orchestrator times out | Save state, escalate |

---

## Success Checklist

### Before Stage 1
- [ ] Feature description clear
- [ ] Codebase accessible
- [ ] Agents activated

### After Stage 1
- [ ] Architecture documented
- [ ] Files identified
- [ ] Patterns found
- [ ] Risks flagged

### After Stage 2
- [ ] Story approved by human
- [ ] Brief approved by human
- [ ] File list complete

### After Stage 3
- [ ] All files modified
- [ ] Tests 100% passing
- [ ] Loops <= 3 each

### After Stage 4
- [ ] All ACs tested
- [ ] No CRITICAL issues
- [ ] No regressions
- [ ] Security passed

### After Stage 5 (post-merge)
- [ ] Consolidation complete
- [ ] Patterns documented
- [ ] Knowledge stored

→ **Feature shipped successfully** ✅
