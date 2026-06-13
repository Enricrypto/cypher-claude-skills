# MemoryKit Integration & Learning Patterns

**How E2E agents store and reuse learning across features**

---

## Memory Architecture

```
Feature 1 (Dashboard)
├─ Auditor stores: [audit findings]
├─ Planner stores: [test scenarios, code patterns]
├─ Consolidator stores: [consolidated learning]
└─ MemoryKit saves: {patterns, metrics, confidence}
    ↓ (retrieved by)
Feature 2 (Listings)
├─ Auditor retrieves: [prior audit findings patterns]
├─ Planner retrieves: [prior test patterns]
├─ Generator retrieves: [proven test code patterns]
├─ Healer retrieves: [prior failure solutions]
└─ Consolidator stores: [updated learning]
    ↓ (retrieved by)
Feature 3 (Payments)
├─ Uses learning from Features 1-2
├─ Adds new domain-specific patterns (payment flows)
└─ Consolidator stores: [cumulative learning]
```

**Result:** By Feature 5-10, agents work 30-40% faster because they reuse proven patterns.

---

## What Gets Stored

### Phase -1 (Audit + Fix) Learning

**Auditor stores:**
```json
{
  "title": "E2E Audit: Portal Aurora Dashboard",
  "date": "2026-06-11",
  "audit_findings": {
    "critical": 2,
    "important": 5,
    "nice_to_have": 3,
    "patterns": [
      {
        "issue_type": "TypeScript strict mode",
        "frequency": "always found",
        "fix_time": "2 min",
        "risk": "low"
      },
      {
        "issue_type": "Docker health checks missing",
        "frequency": "always found",
        "fix_time": "3 min",
        "risk": "low"
      }
    ]
  },
  "infrastructure_checklist": [
    "health checks",
    "environment variables",
    "database migrations",
    "rate limiting config"
  ]
}
```

**Fixer stores:**
```json
{
  "title": "E2E Fixes Applied: Portal Aurora Dashboard",
  "fixes_applied": [
    {
      "category": "config",
      "issue": "TypeScript strict mode",
      "time_to_fix": 2,
      "success": true,
      "difficulty": "easy"
    }
  ],
  "patterns": {
    "config_fixes_success_rate": "100%",
    "auto_fixable_avg_time": "2.5 min",
    "escalation_rate": "5% (API validation)"
  }
}
```

### Phase 3 (Test Generation) Learning

**Planner stores:**
```json
{
  "title": "E2E Test Plan: Portal Aurora Dashboard",
  "feature_type": "dashboard",
  "test_scenarios": {
    "happy_path": 5,
    "error_scenarios": 4,
    "edge_cases": 3
  },
  "code_reading_patterns": [
    {
      "component": "LoginForm",
      "pattern": "button text must match exactly (case sensitive)",
      "confidence": "100%"
    },
    {
      "endpoint": "GET /api/listings",
      "pattern": "response is {data: {listings: []}, meta: {total: 5}}",
      "confidence": "100%"
    }
  ],
  "time_estimate": {
    "plan": 12,
    "generate": 20,
    "total": 32
  }
}
```

**Generator stores:**
```json
{
  "title": "E2E Test Patterns Generated",
  "patterns_used": [
    {
      "name": "fixture-based-auth",
      "success_rate": "100%",
      "reusable": true,
      "confidence": "high"
    },
    {
      "name": "semantic-locators",
      "success_rate": "94%",
      "reusable": true,
      "confidence": "high"
    },
    {
      "name": "page-object-model",
      "success_rate": "100%",
      "reusable": true,
      "confidence": "high"
    }
  ],
  "test_quality_metrics": {
    "avg_lines_per_test": 12,
    "pom_classes": 5,
    "fixtures_created": 3
  }
}
```

**Consolidator stores:**
```json
{
  "title": "E2E Consolidation: Portal Aurora Dashboard",
  "feature_type": "dashboard",
  "phases": {
    "phase_minus_1": {
      "time": 18,
      "auditor": 6,
      "fixer": 8,
      "verifier": 4,
      "status": "pass"
    },
    "phase_3": {
      "time": 42,
      "planner": 12,
      "generator": 20,
      "executor": 3,
      "healer": 7,
      "status": "pass_after_healing"
    }
  },
  "patterns": {
    "succeeded": [
      "fixture-based-auth (3/3 uses)",
      "semantic-locators (94% success)",
      "docker-health-checks (100% success)"
    ],
    "watched": [
      "table-pagination (needed timing fix)",
      "api-response-assertions (structure mismatch)"
    ],
    "avoided": [
      "hardcoded-test-data (causes collisions)"
    ]
  },
  "confidence": 93,
  "recommendations": [
    "Code-reading before generation saves 30% healing time",
    "Semantic locators work 94% first try",
    "Fixture-based auth is 100% reliable"
  ]
}
```

---

## How Agents Retrieve & Use Learning

### Auditor Retrieves
```
Memory query: "e2e: prior audit findings"

Uses for:
- What issues were found in similar projects before?
- Which fixes were reliably auto-fixable?
- Which patterns keep appearing?
- What's the time estimate?

Example:
- "TypeScript strict mode missing": always found, 2 min fix, low risk
  → Focus audit time on items that always need fixing
- "API validation missing": critical but often escalated
  → Flag for human review early
```

### Planner Retrieves
```
Memory query: "e2e: prior test patterns for similar features"

Uses for:
- What scenarios were tested in similar features?
- How many test cases are typical?
- What edge cases were missed before?
- What code patterns should I expect?

Example:
- "Dashboard features typically have 12-15 test cases"
  → Aim for similar coverage
- "Table pagination pattern needs timing waits"
  → Plan explicit waits in test plan
- "API response structures are nested {data: {...}}"
  → Expect this pattern, verify in generator
```

### Generator Retrieves
```
Memory query: "e2e: test patterns (auth, pagination, validation)"

Uses for:
- What patterns are proven to work?
- What selectors work reliably?
- What fixtures are stable?
- What anti-patterns to avoid?

Example:
- "Semantic locators work 94% first try"
  → Use getByRole over testid
- "Fixture-based auth 100% reliable"
  → Reuse auth fixture without modification
- "Hardcoded test data causes collisions"
  → Always use UUID for unique data
```

### Healer Retrieves
```
Memory query: "e2e: prior failure patterns and solutions"

Uses for:
- How were similar failures fixed before?
- What's the root cause of this failure type?
- What's the fastest fix?

Example:
- "Selector failures: 40% of issues (text mismatch is most common)"
  → First check if component text changed
- "Timeout failures: 20% of issues (usually need explicit waits)"
  → Add polling or waitForCondition
- "API failures: 15% of issues (response structure mismatch)"
  → Read API handler code first
```

### Consolidator Retrieves
```
Memory query: "e2e: all prior learning"

Uses for:
- Compile comprehensive learning from all phases
- Calculate cumulative metrics
- Extract reusable patterns
- Update recommendations for next feature

Result:
- Consolidated patterns
- Time estimates by component type
- Confidence scores
- Domain-specific insights
```

---

## Memory Format & Structure

### Standard Memory Entry
```json
{
  "feature": "Feature Name",
  "date": "2026-06-11",
  "project": "portal-aurora-marketplace",
  "phase": "consolidation",
  "metrics": {
    "total_time": 65,
    "infrastructure_time": 18,
    "test_generation_time": 42,
    "tests_generated": 12,
    "tests_passing": 12,
    "confidence_score": 93
  },
  "patterns": {
    "succeeded": ["auth-fixture", "semantic-locators"],
    "watched": ["table-pagination"],
    "avoided": ["hardcoded-data"]
  },
  "recommendations": [
    "Code-reading before generation saves time",
    "Fixture-based auth is stable"
  ],
  "tags": ["e2e", "consolidation", "dashboard"]
}
```

### Memory Retrieval Tags
- `e2e:audit` — Audit findings and patterns
- `e2e:fixes` — Fixes applied successfully
- `e2e:test-patterns` — Proven test patterns
- `e2e:failures` — Failure patterns and solutions
- `e2e:consolidation` — Consolidated learning

---

## Memory Evolution Over Features

### Feature 1: Baseline
- Stores: All findings and patterns
- Time: 70-80 minutes (baseline)
- Learning: Foundation for future features
- Confidence: Low (new feature type)

```
Feature 1 Time Breakdown:
├─ Phase -1: 20 min (exploratory, first time)
├─ Phase 3: 50 min (new, not optimized)
└─ Total: 70 min
```

### Feature 2-3: Pattern Reuse Begins
- Retrieves: Feature 1 patterns
- Stores: Refined patterns + domain-specific learnings
- Time: 60-65 minutes (10-15% faster)
- Confidence: Medium (patterns validated)

```
Feature 2 Time Breakdown (with memory):
├─ Phase -1: 18 min (knows what to look for)
├─ Phase 3: 45 min (reuses auth fixture, selectors)
└─ Total: 63 min (-10% improvement)
```

### Feature 4-5: Optimization
- Retrieves: Features 1-3 patterns
- Stores: Optimized patterns + anti-patterns
- Time: 55-60 minutes (20-25% faster)
- Confidence: High (patterns validated 3x)

```
Feature 4 Time Breakdown (with 3 features memory):
├─ Phase -1: 16 min (skips obvious checks)
├─ Phase 3: 40 min (reuses 80% of code)
└─ Total: 56 min (-20% improvement)
```

### Feature 10+: Maturity
- Retrieves: 9+ features of patterns
- Stores: Consolidated domain expertise
- Time: 45-50 minutes (35-40% faster)
- Confidence: Very High (patterns validated 9x)

```
Feature 10 Time Breakdown (with 9 features memory):
├─ Phase -1: 14 min (expert-level audit)
├─ Phase 3: 35 min (reuses 95% of patterns)
└─ Total: 49 min (-30% improvement)
```

---

## Memory Best Practices

### DO Store
✅ Patterns that worked (reusable, proven)
✅ Patterns that needed iteration (document gotchas)
✅ Time metrics (estimate for similar features)
✅ Confidence scores (avoid brittle patterns)
✅ Root causes (why failures happened)
✅ Fixes that worked (solutions for next feature)

### DON'T Store
❌ One-off fixes (project-specific workarounds)
❌ Bug fixes that aren't patterns
❌ Implementation details (code structure that changes)
❌ Temporary solutions (scaffolding, migration code)
❌ Failed attempts (unless instructive pattern)

### Memory Decay
- **1 week old:** Still valid, probably
- **1 month old:** Review before using (code may have changed)
- **3 months old:** Verify before applying (dependencies may have changed)
- **1 year old:** Archive (framework versions likely changed)

---

## Preventing Bad Patterns in Memory

### ❌ Anti-Pattern: Hardcoded Data
```json
{
  "pattern": "hardcoded-test-data",
  "status": "FAILED - causes test collisions",
  "why": "Multiple tests using same data hit rate limits and conflicts",
  "solution": "Use UUID + timestamp for unique data per test",
  "confidence": "AVOID THIS"
}
```

### ❌ Anti-Pattern: Brittle Selectors
```json
{
  "pattern": "testid-selectors",
  "status": "80% success rate, fails on refactoring",
  "why": "Test IDs often removed during component refactoring",
  "solution": "Use semantic locators (getByRole, getByLabel)",
  "confidence": "DON'T USE - prefer semantic"
}
```

### ✅ Good Pattern: Fixture-Based Auth
```json
{
  "pattern": "fixture-based-auth",
  "status": "100% success rate across 8 features",
  "why": "Fixture handles setup/cleanup automatically",
  "reusability": "High - same fixture works for all projects",
  "confidence": "HIGH - reuse freely"
}
```

---

## Querying Memory Effectively

### Query Pattern 1: By Phase
```
"e2e: phase 3 learnings"
→ Returns all Planner, Generator, Healer learning
```

### Query Pattern 2: By Pattern Type
```
"e2e: failed patterns to avoid"
→ Returns anti-patterns, what didn't work
```

### Query Pattern 3: By Feature Type
```
"e2e: dashboard feature learnings"
→ Returns all learning specific to dashboard-type features
```

### Query Pattern 4: By Confidence
```
"e2e: high-confidence patterns"
→ Returns patterns with 90%+ success rate (safe to reuse)
```

---

## Integration with MemoryKit

### How MemoryKit is Invoked

**At start of phase, agent retrieves:**
```python
retrieve_context(
  query="e2e: prior patterns for this feature type",
  scope="project"  # Or "global" for cross-project patterns
)
```

**At end of phase, agent stores:**
```python
store_memory(
  title="E2E Consolidation: Feature Name",
  content="[CONSOLIDATION_REPORT.md content]",
  tags=["e2e", "consolidation", "feature-name"],
  scope="project"
)
```

### Scope Rules
- `scope: "project"` — Learning for this specific project (Portal Aurora)
- `scope: "global"` — Learning across all projects (patterns everyone can use)

**Decision:** Most E2E patterns are **global** (work across projects).
Project-specific learning is **project-scoped** (infrastructure differences).

---

## Expected Memory Growth

### By Feature Count

| Feature | Phase -1 Entries | Phase 3 Entries | Consolidation | Total Size |
|---------|-----------------|-----------------|---------------|-----------|
| 1 | 5 | 8 | 1 | ~2 KB |
| 3 | 8 | 12 | 3 | ~6 KB |
| 5 | 10 | 15 | 5 | ~10 KB |
| 10 | 12 | 18 | 10 | ~18 KB |

**Growth pattern:** Logarithmic (not exponential)
- First features add many patterns
- Later features refine existing patterns
- Consolidation removes duplicates

---

## Summary

✅ **Memory compounds learning**  
✅ **Each feature makes next feature faster**  
✅ **Patterns are validated multiple times**  
✅ **Anti-patterns prevent repeated mistakes**  
✅ **By feature 10, agents work 30-40% faster**  

**Result:** E2E testing becomes increasingly automated and reliable.
