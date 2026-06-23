# Quick Start: Run Your First E2E Loop

**Time:** 5 minutes  
**Prerequisites:** Docker running, npm installed

---

## Step 1: Verify Setup (1 min)

```bash
# Check Docker
docker ps

# Check npm
npm --version

# Check you're in the right repo
pwd  # Should end with: cypher-claude-skills
```

---

## Step 2: Run the Loop (3 min)

```bash
npm run e2e:loop -- --feature "advertiser-dashboard" --path "/painel/dashboard"
```

**Replace:**
- `advertiser-dashboard` with your feature name
- `/painel/dashboard` with the actual path to your feature

---

## Step 3: Watch the Output (1 min)

The loop will run through 5 phases:

```
Phase -1: Audit Preparation
  ✅ Audits codebase for your feature
  ✅ Validates audit completeness
  ✅ Fixes any gaps found

Phase 0: Infrastructure
  ⏭️  Skips (assumes ready) or applies fixes

Phase 1: Test Generation
  ✅ Plans test scenarios
  ✅ Generates test files
  ✅ Audits tests (Playwright MCP verifies selectors/APIs)
  ✅ Runs tests (mandatory Docker rebuild)

Phase 2: Remediation (Only if tests failed)
  ✅ Automatically fixes failing tests
  ✅ Re-runs until 100% pass rate

Phase 3: Finalize
  ✅ Creates commit summary
  ✅ Ready for your PR review
```

---

## Expected Outcomes

### All Tests Passing ✅
```
✅ PIPELINE COMPLETE
   Test Files: frontend/e2e/tests/advertiser-dashboard/...
   Pass Rate: 100% (45/45)
   Ready for PR review
```

**Next:** Review generated tests, create PR, merge when approved.

### Tests Failed, Auto-Fixed ✅
```
⚠️  5 test(s) failing - triggering remediation
🔄 Remediation Iteration 1/5
   ✅ Pass rate: 100% (45/45)
✅ PIPELINE COMPLETE
```

**Next:** Review what was fixed in `artifacts/phase-3-remediation/`.

### Human Review Needed ⛔
```
❌ Max remediation iterations (5) reached
⛔ ESCALATING TO HUMAN REVIEW
   Current: 95% passing (42/45)
   Failing tests: [test-1, test-2, test-3]
```

**Next:** 
1. Review failing tests in `artifacts/phase-3-remediation/FINAL_TEST_RESULTS.json`
2. Identify root cause
3. Fix test code or application code
4. Re-run loop

---

## Artifacts Location

All outputs are saved in organized folders:

```
e2e-loop/artifacts/
├── phase-0-audit/           ← Audit reports
├── phase-1-infrastructure/  ← Infrastructure fixes
├── phase-2-test-generation/ ← Test files & plans
├── phase-3-remediation/     ← Remediation attempts
└── phase-4-finalize/        ← Final summary
```

**Key files to review:**
- `phase-2-test-generation/TEST_AUDIT_REPORT.md` — What was verified
- `phase-2-test-generation/TEST_RESULTS.json` — Initial test results
- `phase-3-remediation/FINAL_TEST_RESULTS.json` — After remediation

---

## Common Issues

### ❌ "Docker not running"
```bash
docker-compose up -d
# Then re-run the loop
```

### ❌ "npm: command not found"
```bash
# Install Node.js and npm, then re-run
```

### ❌ "Playwright MCP not found"
Verify `~/.claude/mcp.json` has:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/playwright-mcp"]
    }
  }
}
```

### ❌ "Tests still failing after 5 iterations"
This is expected for complex issues. Escalation stops the loop so you can:
1. Manually investigate the failures
2. Fix the root cause
3. Re-run the loop

Check `artifacts/phase-3-remediation/FINAL_TEST_RESULTS.json` for details.

---

## Next Steps

- **[Full README](README.md)** — Understand the system
- **[Phase Guide](PHASE_GUIDE.md)** — Detailed phase breakdown
- **[Architecture](ARCHITECTURE.md)** — How it all works
- **[Reference](../reference/)** — Detailed specs

---

**That's it! You're ready to generate production-ready E2E tests.** 🚀
