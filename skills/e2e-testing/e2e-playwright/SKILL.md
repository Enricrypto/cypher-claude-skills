# E2E Playwright Testing — Autonomous Skill

**Transform any project into a fully tested, production-ready system with autonomous E2E testing.**

This skill audits your infrastructure, fixes issues, and generates comprehensive E2E tests — all without manual intervention.

---

## What This Skill Does

### Phase -1: Production Readiness (Automated)
- **Auditor Agent** reads your entire codebase (frontend, backend, infrastructure)
- Compares against best practices + official documentation
- Documents all gaps found (with file:line references)
- **Fixer Agent** automatically fixes infrastructure issues
- **Verifier Agent** confirms all fixes work correctly

### Phase 3: Test Generation (Automated)
- **Planner Agent** maps actual user flows in your app
- **Generator Agent** creates Playwright tests that match your real code
- **Executor Agent** runs tests and reports results
- **Healer Agent** fixes broken tests automatically (up to 3 attempts)

### Post-Merge: Learning (Automated)
- **Consolidator Agent** extracts reusable patterns
- Stores learnings in MemoryKit for future features
- System gets 30-40% faster by feature #5

---

## How to Use

### Step 1: Activate This Skill
```bash
Read ~/.claude/skills/e2e-testing/e2e-playwright/SKILL.md
```

### Step 2: Run the Automation
```bash
# From your project root
e2e-playwright

# System will:
# 1. Audit your infrastructure (Phase -1)
# 2. Fix issues found (Phase -1)
# 3. Generate E2E tests (Phase 3)
# 4. Execute tests
# 5. Store learnings (MemoryKit)
```

### Step 3: Review Results
```
.claude/e2e-audit-reports/
├── AUDIT_REPORT-{timestamp}.md      # What was found
├── FIX_REPORT-{timestamp}.md        # What was fixed
├── VERIFICATION_REPORT-{timestamp}.md # What works now
├── TEST_PLAN-{timestamp}.md         # Test scenarios
├── TEST_RESULTS-{timestamp}.md      # Pass/fail
└── CONSOLIDATION_REPORT-{timestamp}.md # Learnings
```

---

## What Gets Audited

### Frontend
- React/Next.js patterns
- TypeScript configuration (strict mode)
- Component structure
- State management
- API integration patterns
- Error handling
- Loading states
- Testing setup

### Backend
- API endpoint design
- Request validation (FluentValidation, Zod, etc.)
- Error response formats
- Authentication & authorization
- Rate limiting configuration
- Database migrations
- Service architecture
- Logging & monitoring

### Infrastructure
- Docker setup (health checks, networking)
- Environment variable management
- Database configuration
- Service dependencies
- Security (no hardcoded secrets)
- Port management
- Network isolation

---

## What Gets Fixed

### Auto-Fixed (Safe)
- ✅ Missing health checks in docker-compose
- ✅ Environment variables not loaded properly
- ✅ TypeScript strict mode not enabled
- ✅ ESLint/Prettier config issues
- ✅ Missing .env.example file
- ✅ Docker networking config
- ✅ Rate limiting environment variables
- ✅ Missing database migration tracking

### Escalated (Needs Judgment)
- ⚠️ API endpoint design changes
- ⚠️ Business logic refactoring
- ⚠️ Database schema changes
- ⚠️ Authentication flow changes
- ⚠️ Breaking changes to existing code

---

## What Gets Tested

### Happy Path
- User can complete primary flow
- Data displays correctly
- Navigation works
- Forms submit successfully

### Error Scenarios
- Invalid input → error message
- 401 Unauthorized → redirect to login
- 404 Not Found → appropriate page
- API timeout → retry or error state
- Network error → graceful degradation

### Edge Cases
- Empty state (no data)
- Maximum data (pagination, limits)
- Concurrent operations
- Stale tokens
- Race conditions

---

## Output Files

### AUDIT_REPORT.md
```markdown
# Infrastructure Audit Report

## Frontend Findings
- [ ] TypeScript strict mode enabled
- [ ] Error handling for API calls
- [x] CRITICAL: Missing loading state in UserForm (src/components/UserForm.tsx:45)

## Backend Findings
- [x] CRITICAL: API endpoint /users returns unvalidated data (src/handlers/users.ts:12)

## Infrastructure Findings
- [x] IMPORTANT: No health check for database service in docker-compose.yml

## Summary
- Critical: 2
- Important: 1
- Nice-to-have: 0
```

### FIX_REPORT.md
```markdown
# Infrastructure Fixes Applied

## Fixed Issues
1. ✅ TypeScript strict mode → enabled in tsconfig.json
2. ✅ Health check → added to docker-compose.yml (line 42)
3. ✅ Rate limiting → configured in appsettings.Test.json

## Attempted But Escalated
- API endpoint validation → requires business logic review

## Verification Status
- Tests passing: 8/8
- Type checking: ✅ Pass
- Linting: ✅ Pass
```

### TEST_PLAN.md
```markdown
# E2E Test Plan: User Dashboard

## Happy Path Tests
1. User logs in with valid credentials
2. Redirected to /dashboard
3. User greeting displays
4. Listings table shows all listings
5. Can click edit on any listing

## Error Scenarios
- Invalid credentials → error message
- Missing JWT → redirect to login
- Network timeout → retry button shows

## Edge Cases
- User with 0 listings → "No listings" message
- Very long username → text truncates
- Concurrent edits → conflict resolution
```

### TEST_RESULTS.md
```markdown
# E2E Test Results

## Summary
- Total: 15 tests
- Passed: 15 ✅
- Failed: 0
- Skipped: 0
- Duration: 2m 15s

## Test Breakdown
- Happy path: 6/6 ✅
- Error scenarios: 5/5 ✅
- Edge cases: 4/4 ✅

## Performance
- Average test: 9s
- Slowest: UserDashboard → 18s
- Fastest: LoginFlow → 3s
```

---

## Understanding the System

- **[AGENT_GUIDE.md](reference/AGENT_GUIDE.md)** — How agents interact & coordinate
- **[SKILL_ASSIGNMENTS.md](reference/SKILL_ASSIGNMENTS.md)** — Which skills each agent loads
- **[MEMORY_PATTERNS.md](reference/MEMORY_PATTERNS.md)** — How learning is stored & reused

---

## Best Practices

### For Best Results
- Keep code in version control (Git)
- Ensure app starts without errors
- Have database migrations tracked
- Environment files present (.env, appsettings.json)
- Docker Compose configured (if using Docker)

### What Works Best
- ✅ Next.js + React projects
- ✅ .NET backend with PostgreSQL
- ✅ Node.js/Express backends
- ✅ Any Docker-based infrastructure
- ✅ Any git repository

### Known Limitations
- Requires running app locally (on localhost)
- Works best with semantic HTML
- Assumes standard project structure
- Needs proper TypeScript configuration

---

## Troubleshooting

### "Auditor can't read my code"
- Ensure project is in git repository
- Verify `CLAUDE.md` exists in project root
- Check that source files are not gitignored

### "Fixer applied changes I don't want"
- All changes are in git commits
- Review the FIX_REPORT.md
- Can revert with `git reset HEAD~1`

### "Tests are failing"
- Healer will attempt fixes automatically (up to 3 times)
- Check TEST_RESULTS.md for error details
- Review test logs in `.claude/e2e-audit-reports/`

### "Escalation needed"
- Review the AUDIT_REPORT.md
- Address escalated issues manually
- Re-run skill when ready

---

## Memory & Learning

This skill uses **MemoryKit** to learn from each run:

### What Gets Stored
- Test patterns that succeeded
- Common failures and their solutions
- Infrastructure issues and fixes
- Time estimates for similar features

### How It Compounds
```
Feature 1: Dashboard → 40 min (baseline)
Feature 2: Admin panel → 35 min (5% faster, patterns reused)
Feature 5: Settings page → 25 min (35% faster)
Feature 10: Profile page → 24 min (40% faster)
```

MemoryKit works automatically — no configuration needed.

---

## Success Criteria

After running this skill, you should have:

✅ Infrastructure audited against best practices  
✅ All fixable issues automatically corrected  
✅ E2E tests generated for all major flows  
✅ Tests passing in all browsers/devices  
✅ Reusable test patterns documented  
✅ Zero false test coverage (all tests verify real code)  

---

## Next Steps

1. **Run the skill** → `e2e-playwright`
2. **Review the audit** → Read `AUDIT_REPORT.md`
3. **Verify the fixes** → Check `FIX_REPORT.md` + git log
4. **Inspect the tests** → Read `TEST_RESULTS.md`
5. **Merge and deploy** → Tests are production-ready

---

## Advanced Configuration

For project-specific overrides, add to your `CLAUDE.md`:

```markdown
## E2E Testing Overrides

### Auto-Fix Overrides
- Skip: API endpoint design (too risky)
- Add: Environment variable validation

### Skill Overrides
Auditor: architecture-patterns, api-design-principles, e2e-best-practices
Generator: test-driven-development, frontend-architecture, e2e-playwright-patterns

### Memory Tags
- Exclude: internal-tools (skip memory for this project)
```

---

## Questions?

- Read the reference docs: `reference/AGENT_GUIDE.md`
- Check troubleshooting section above
- Review actual agent prompts: `agents/*.md`
- Inspect skill files: `skills/*.md`

---

**Ready? Run: `e2e-playwright`**

Your infrastructure and tests will be production-ready in minutes. ✨
