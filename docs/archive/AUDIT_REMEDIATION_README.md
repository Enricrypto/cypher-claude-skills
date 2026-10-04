# Audit & Remediation Loop — Quick Start

**Purpose:** Scan your existing hcrefactory project for E2E readiness issues and fix them.

**Time:** 2-3 weeks to fix all issues  
**Cost:** ~$20-30 in Claude API tokens  
**Effort:** ~30h of agent work + ~5h of your review

---

## What This Does

```
Your Project (E2E not ready)
        ↓
[Agent 09: Audit]
  ├─ Scans all backend code
  ├─ Scans all frontend code
  ├─ Reviews tests
  └─ Generates report (23 issues found, severity levels, effort)
        ↓
You review report (30m)
        ↓
[Agent 10: Remediation]
  ├─ Fixes auto-fixable issues
  ├─ Provides guidance for complex issues
  └─ Generates remediation report with before/after code
        ↓
Your Project (E2E ready)
```

---

## Step 1: Run the Audit Agent

### Copy this entire prompt:

```
You are the Audit Agent. Your job is to inspect the hcrefactory project for E2E readiness issues.

Read these files first:
1. ~/cypher-claude-skills/LOOP_IMPLEMENTATION/PRODUCTION_STANDARDS.md (your checklist)
2. /Users/enriqueibarra/CLAUDE.md (understand the project)
3. /Users/enriqueibarra/hcrefactory/ (scan this project)

Then systematically audit:
1. Backend code (API endpoints, security, database)
2. Frontend code (components, forms, selectors, auth)
3. Tests (unit, integration, acceptance)
4. Configuration (secrets, environment variables)

For each issue found, document:
- Title
- Location (file + line number)
- Severity (CRITICAL, HIGH, MEDIUM)
- Category (backend, frontend, database, security, testing)
- Problem description
- Impact
- Suggested fix
- Effort estimate
- Is it auto-fixable? (yes/no)

Use the checklist in PRODUCTION_STANDARDS.md as your guide.

Generate TWO outputs:

OUTPUT 1: JSON Report (save as: audit-reports/hcrefactory-2024-06-10/audit-report.json)
```json
{
  "projectName": "hcrefactory",
  "auditDate": "2024-06-10",
  "overallReadiness": "X%",
  "issueCount": {
    "critical": 0,
    "high": 0,
    "medium": 0
  },
  "totalEffort": "Xh",
  "issues": [
    {
      "id": 1,
      "title": "...",
      "location": "...",
      "severity": "...",
      "category": "...",
      "problem": "...",
      "impact": "...",
      "effort": "...",
      "autoFixable": true/false,
      "fixDetails": "..."
    }
  ]
}
```

OUTPUT 2: Markdown Report (save as: audit-reports/hcrefactory-2024-06-10/audit-report.md)
Use the template from ~/cypher-claude-skills/agents/09-audit-agent.md

Include:
- Executive summary (readiness %, issues found)
- Detailed findings (critical, high, medium)
- Effort breakdown
- Recommended remediation path (what to fix first)
- Patterns extracted (for future features)

End with:
─────────────────────────────────────────────
✓ AUDIT COMPLETE
Issues found: [X]
Readiness: [X]%
Next step: Review report + invoke Remediation Agent
─────────────────────────────────────────────
```

### Then paste the prompt:

**Go to Claude (claude.ai or your IDE extension)**

1. Create new conversation
2. Paste the prompt above
3. Press Send
4. Wait for audit to complete (10-20 min)

### What you'll get back:

A detailed audit report with:
- List of all issues (numbered)
- Severity levels
- Effort estimates
- Which ones are auto-fixable

**Save the JSON report** — you'll pass it to Agent 10 next.

---

## Step 2: Review the Audit Report (30 minutes)

After the audit completes:

1. **Read through the issues**
2. **Verify they make sense** (do you agree?)
3. **Note the severities** (critical first, then high, then medium)
4. **Check effort estimates** (realistic?)

If something looks wrong, ask the agent to clarify that specific issue.

---

## Step 3: Run the Remediation Agent

### Copy this entire prompt:

```
You are the Remediation Agent. Your job is to fix the issues from the hcrefactory audit.

Read these files first:
1. ~/cypher-claude-skills/LOOP_IMPLEMENTATION/PRODUCTION_STANDARDS.md
2. ~/cypher-claude-skills/agents/10-remediation-agent.md (your instructions)
3. The audit report I'm about to give you (below)

AUDIT REPORT:
[PASTE THE AUDIT REPORT JSON HERE]

Now, for each issue:

IF auto-fixable = true:
  - Read the code file
  - Apply the fix
  - Update related tests
  - Verify tests pass locally
  - Document the change

IF auto-fixable = false:
  - Provide step-by-step guidance
  - Explain why it needs human review
  - Give code examples
  - List the choices (Option A, B, C)
  - Say what to do next

Generate remediation report:

OUTPUT: Markdown Report (save as: remediation-reports/hcrefactory-2024-06-10/remediation-report.md)

Include:
- Summary: How many fixed, how many guided, new readiness %
- Detailed fixes: For each auto-fixed issue, show:
  - What changed (file, lines)
  - Before/After code
  - Tests updated
  - Git commit message
- Guidance: For each guided issue, show:
  - Why can't auto-fix
  - Step-by-step instructions
  - Code templates
  - Your choices (Option A, B, C)
- Progress: Table showing fixed/guided/remaining
- Next steps: What the user should do

End with:
─────────────────────────────────────────────
✓ REMEDIATION COMPLETE

Summary:
- Fixed: X issues (auto-fixable)
- Guided: Y issues (needs your input)
- Readiness: 35% → X%
- Effort: Xh applied

Next Steps:
1. Review guided issues
2. Implement your chosen options
3. Commit changes
4. Re-audit to verify
─────────────────────────────────────────────
```

### Then paste the prompt:

**Go to Claude again**

1. Create new conversation
2. Paste the prompt above
3. **Replace `[PASTE THE AUDIT REPORT JSON HERE]` with the actual JSON** from Step 1
4. Press Send
5. Wait for remediation to complete (20-30 min)

### What you'll get back:

A remediation report showing:
- Code fixes (what changed, before/after)
- Guidance for complex issues (step-by-step instructions)
- New readiness percentage (should be 75%+)
- What you need to do manually

---

## Step 4: Apply the Fixes

### For Auto-Fixed Issues:
The agent has already modified your code. You just need to:
1. Review the changes
2. Run tests: `npm test`
3. Commit: Use the git messages from the report

### For Guided Issues:
1. Read the guidance
2. Choose your option (A, B, or C)
3. Follow the step-by-step instructions
4. Test your implementation
5. Commit

---

## Step 5: Re-Audit (Optional, Recommended)

After applying all fixes, run the audit again to verify:

```
Same as Step 1, but instead of scanning for all issues,
focus on the ones from the first audit.

Check: Are they fixed? Is readiness now 90%+?
```

---

## File Structure

After audit + remediation, you'll have:

```
audit-reports/
└── hcrefactory-2024-06-10/
    ├── audit-report.json     (structured data)
    └── audit-report.md       (human-readable)

remediation-reports/
└── hcrefactory-2024-06-10/
    ├── remediation-report.md (what's fixed, what's guided)
    └── remediation-report.json (optional, structured)

hcrefactory/
├── src/
│   ├── api/
│   │   └── (fixed code)
│   └── components/
│       └── (fixed code)
├── tests/
│   └── (updated tests)
└── (modified files)
```

---

## Common Issues & Fixes (Sneak Peek)

Based on typical projects, expect to find:

| Issue | Severity | Auto-Fix? | Effort |
|-------|----------|-----------|--------|
| API response shape inconsistent | CRITICAL | Yes | 2h |
| Form selectors use generated IDs | CRITICAL | Yes | 1h |
| No test data cleanup | CRITICAL | Guided | 4h |
| Auth token in localStorage | CRITICAL | Yes | 1h |
| Missing CSRF tokens | CRITICAL | Yes | 1h |
| No unit tests | HIGH | Partial | 3h |
| Flaky async tests | HIGH | Yes | 2h |
| No acceptance tests | HIGH | Guided | 5h |
| Missing input validation | MEDIUM | Yes | 2h |
| No API documentation | MEDIUM | Guided | 2h |

---

## Troubleshooting

### "Agent didn't complete the audit"
→ If response cuts off, ask it to continue: "Continue from issue #X"

### "Some issues seem wrong"
→ Ask agent to clarify: "Can you explain issue #5 in more detail?"

### "I disagree with severity level"
→ You're the authority. If you think it's not critical, note it and move forward.

### "Can't apply the guided fixes"
→ Reply with: "I chose Option A. Can you provide implementation code?"

---

## Timeline

```
Today:
  30m - Read this README
  1h  - Run Audit Agent
  30m - Review audit report

This Week:
  2h  - Run Remediation Agent
  3h  - Review remediation report
  4h  - Apply auto-fixes + commit

Next 1-2 Weeks:
  10h - Implement guided issues
  2h  - Run tests, verify nothing broke
  1h  - Re-audit (optional)

Total: ~30h of work (mostly agent work, ~5h of your time)
```

---

## After Audit & Remediation

Your project will be:
- ✅ **E2E-ready** (selectors stable, API contracts defined)
- ✅ **Security-ready** (CSRF tokens, auth boundaries, secrets in .env)
- ✅ **Test-ready** (unit + integration + acceptance structure)
- ✅ **Production-ready** (error handling, logging, monitoring)

Then if you use Feature Factory for new features, they'll inherit all these patterns automatically.

---

## Next: Deploy Feature Factory

After your project is E2E-ready, you can:

**Option A:** Continue with just audit + remediation loop (maintain existing project)

**Option B:** Deploy Feature Factory (Phase 1-4) for new features going forward
- New features are E2E-ready from day 1
- Patterns learned from audit are baked into Feature Factory
- Team gets 40% faster on feature 10

---

## Questions?

Before you start, confirm:

- [ ] You have Claude API access (using your $100 account)
- [ ] You can run `npm test` locally
- [ ] You have git configured
- [ ] You want to audit `/Users/enriqueibarra/hcrefactory`

If all yes, you're ready to go! Start with **Step 1: Run the Audit Agent**.

---

**Ready?** Copy the Step 1 prompt above and go to Claude now.

