# Quick Reference

## Phase Gates (Pass/Fail Criteria)

| Phase | Acceptance Criteria |
|-------|---|
| **-1: Audit** | Completeness score >= 95%, all CRITICAL gaps fixed |
| **0: Infrastructure** | Fixes documented or explicitly skipped (optional) |
| **1: Test Generation** | Test audit passed, 100% tests passing |
| **2: Remediation** | 100% pass rate OR max iterations/timeout reached |
| **3: Finalize** | All artifacts created, ready for PR |

## Error Categories & Fixes

| Error Pattern | Category | Fix |
|---|---|---|
| "no matching element" | SELECTOR_MISMATCH | Update locator to semantic selector |
| "Timeout" | TIMING_ISSUE | Increase timeout, add waitForLoadState |
| "status 40[1345]" | API_CONTRACT | Verify endpoint, auth, payload schema |
| "duplicate key" | DATA_COLLISION | Add UUID test data, cleanup in afterEach |
| "pass alone, fail together" | TEST_POLLUTION | Add afterEach cleanup |
| "expected X, got Y" | ASSERTION_MISMATCH | Verify actual behavior vs test expectation |

## File Locations

```
e2e-loop/
├── harness/              ← Guardrails (do not modify unless extending)
├── workflows/            ← Orchestrator (e2e-full-loop-with-remediation.ts)
├── skills/               ← Agent definitions
├── agents/               ← Agent prompt files
├── artifacts/            ← Phase outputs (auto-created)
└── docs/                 ← Documentation (you are here)
```

## Commands

```bash
# Run the loop
npm run e2e:loop -- --feature "feature-name" --path "/path/to/feature"

# Check Docker
docker ps
docker-compose ps

# View test results
cat e2e-loop/artifacts/phase-2-test-generation/TEST_RESULTS.json
cat e2e-loop/artifacts/phase-3-remediation/FINAL_TEST_RESULTS.json

# Review failures
cat e2e-loop/artifacts/phase-3-remediation/REMEDIATION_ITER_1.md
```

## Escalation Triggers

Loop escalates to human when:

| Trigger | Reason |
|---------|--------|
| Completeness < 95% | Audit insufficient, gaps need fixing |
| Test audit fails | Ghost features or selector/API mismatches |
| Regressions detected | Agent fix broke previously passing tests |
| Max iterations (5) | Unable to reach 100% pass rate |
| Timeout (1 hour) | Loop took too long |
| Token budget exceeded | Used 500k+ tokens |

## Phase -1 Completeness Scoring

```
Score = (routes% + apis% + errors% + edges%) / 4

Score >= 95%  → APPROVED (proceed)
Score 85-94%  → APPROVED WITH NOTES (proceed with gaps noted)
Score < 85%   → REJECTED (re-audit)
```

## Remediation Iteration Limits

```
Max iterations: 5
Max tokens: 500,000
Max time: 1 hour
```

If any limit exceeded → Escalate to human with full context.

## Test Results JSON

```json
{
  "timestamp": "ISO8601",
  "total": number,
  "passed": number,
  "failed": number,
  "passRate": 0-1,
  "browsers": {
    "chromium": {passed, failed},
    "firefox": {passed, failed},
    "mobile-safari": {passed, failed}
  },
  "failedTests": [
    {name, browser, error}
  ]
}
```

## Agent Output Schema

All agents output:

```json
{
  "phase": "phase-N-...",
  "timestamp": "ISO8601",
  "status": "PASS|FAIL|PARTIAL",
  "agent": "agent-name",
  "details": {
    "summary": "...",
    "artifacts": [...],
    "metrics": {...},
    "errors": [...]
  }
}
```

## When to Check What

| File | When to Check | What to Look For |
|------|---|---|
| AUDIT_REPORT.md | After Phase -1 audit | Coverage of routes, APIs, errors, edges |
| AUDIT_VALIDATION_REPORT.json | After Phase -1 review | Completeness score, gaps list |
| TEST_PLAN.md | After Phase 1 planning | Test scenario organization, coverage |
| TEST_AUDIT_REPORT.md | After Phase 1 audit | Ghost features, selector mismatches |
| TEST_RESULTS.json | After Phase 1 tests run | Pass rate, failed tests, browser results |
| REMEDIATION_ITER_*.md | During Phase 2 loop | What fixes were applied in each iteration |
| FINAL_TEST_RESULTS.json | After Phase 2 or escalation | Final pass rate, any remaining failures |
| COMPLETION_REPORT.json | After Phase 3 | Summary of entire run |

## Troubleshooting Checklist

- [ ] Docker running? `docker ps`
- [ ] Playwright MCP installed? Check `~/.claude/mcp.json`
- [ ] Test results are JSON? Check `TEST_RESULTS.json` format
- [ ] All phases have artifacts? Check `e2e-loop/artifacts/phase-*-*/`
- [ ] Agent outputs are valid JSON? Validate with `validateOutputSchema()`
- [ ] Docker healthy before tests? Check rebuild logs
- [ ] Selectors verified? Check TEST_AUDIT_REPORT.md
- [ ] APIs exist? Check TEST_AUDIT_REPORT.md

## Extending the System

### Add New Error Category

1. Add pattern to `harness/error-categories.ts`
2. Add fix class
3. Add code template
4. Test with failing test

### Add New Phase

1. Define contract in `harness/phase-gates.ts`
2. Implement validator
3. Add phase logic to workflow
4. Test end-to-end

### Modify Remediation Limits

Edit `harness/remediation-engine.ts`:
```typescript
const maxIterations = 5;        // Change to different value
const maxTotalTokens = 500_000; // Change to different value
const timeoutMs = 60 * 60 * 1000; // Change to different value
```

## Key Decisions Made

| Decision | Reasoning |
|----------|-----------|
| 100% acceptance | Partial pass = untested code = risk |
| Max 5 iterations | Prevent infinite loops, force escalation |
| Mandatory Docker rebuild | Prevent stale state bugs |
| Playwright MCP verification | Catch ghost features before test run |
| Phase gates | Prevent agent from deciding advancement |
| Error lookup table | Prevent mis-categorization |
| Structured JSON output | Enable machine-readable decisions |
| Before/after regression check | Detect agent-introduced breaks |
| Full context on escalation | Enable human to understand state |

## Contact & Questions

- Review [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for deep dive
- Review [PHASE_GUIDE.md](../docs/PHASE_GUIDE.md) for detailed phase info
- Review [README.md](../docs/README.md) for overview
