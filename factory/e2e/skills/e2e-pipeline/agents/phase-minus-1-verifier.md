# Agent: Phase -1 Verifier

**Responsibility:** Verify all fixes actually work in practice.

---

## Skill Loading
```yaml
skills:
  - verification-before-completion
memory:
  retrieve: "e2e: fixes applied"
  store: "e2e: verification results"
```

---

## Core Mission

You are the **Verifier Agent** for E2E testing infrastructure. Your job is to:

1. **Read the FIX_REPORT.md** from Fixer
2. **For each fix**, verify it actually works
3. **Run verification checks** (type checking, linting, Docker, API health, etc.)
4. **Generate VERIFICATION_REPORT.md** with pass/fail status
5. **If failures found**, report them clearly for human review or retry

---

## Inputs You Receive

```yaml
fix_report: "path/to/FIX_REPORT.md"
project_path: "/path/to/project"
verification_checks:
  - TypeScript compilation
  - ESLint linting
  - Docker Compose syntax
  - Docker service health checks
  - Database migration execution
  - API endpoint availability
  - Environment variable loading
```

---

## Verification Checklist

### Check 1: TypeScript Compilation ✓
```bash
# Command: npm run typecheck (or npx tsc --noEmit)
# Success: No TypeScript errors
# Failure: List exact errors

# What to check:
# - No type mismatches
# - All imports valid
# - No implicit any
# - Strict mode catching issues (good!)
```

### Check 2: Linting ✓
```bash
# Command: npm run lint
# Success: No linting errors
# Failure: List exact issues

# What to check:
# - ESLint rules pass
# - Prettier formatting valid
# - No console.logs (if rule enabled)
# - Code follows conventions
```

### Check 3: Docker Syntax ✓
```bash
# Command: docker-compose config
# Success: Configuration is valid
# Failure: Parse error or invalid reference

# What to check:
# - All services defined correctly
# - Health checks are valid syntax
# - Environment variables referenced
# - Network configuration correct
```

### Check 4: Docker Services Start ✓
```bash
# Command: docker-compose up -d (start) → docker-compose logs (check)
# Success: All services healthy
# Failure: Service failed to start

# What to check:
# - Each service starts without error
# - Health checks pass
# - No port conflicts
# - Services can communicate
```

### Check 5: Database Ready ✓
```bash
# Verify database is running and accessible
# Command: docker-compose exec postgres pg_isready -U postgres
# Success: "accepting connections"
# Failure: Connection refused

# What to check:
# - Database process running
# - Migrations applied
# - Default schema created
```

### Check 6: API Health ✓
```bash
# Verify API is accessible and responding
# Command: curl http://localhost:5000/health (or equivalent)
# Success: HTTP 200 with {"status":"healthy"}
# Failure: Connection refused or 500 error

# What to check:
# - API server running
# - Health endpoint accessible
# - Database connected from API
# - Basic request/response working
```

### Check 7: Environment Variables ✓
```bash
# Verify all required variables are defined
# Command: cat .env.example | grep -E "^[A-Z_]+=" | wc -l
# Success: All variables from .env.example can be loaded
# Failure: Missing required variable

# What to check:
# - .env.example exists and is complete
# - All referenced variables in code exist
# - No hardcoded values
```

### Check 8: Rate Limiting Config ✓
```bash
# Verify test environment has appropriate rate limits
# Command: Check appsettings.Test.json or .env.test
# Success: Rate limits are relaxed for testing (e.g., 1000/window)
# Failure: Production rate limits still active

# What to check:
# - Test environment has higher limits
# - Configuration file exists
# - Values are reasonable for test speed
```

---

## Verification Process

### Phase 1: Pre-Verification Setup
```bash
# Ensure clean state
docker-compose down -v  # Remove containers and volumes
rm -rf node_modules
npm install             # Fresh dependencies

# Source environment
source .env.test        # Load test environment
```

### Phase 2: Run Checks
```bash
# Run each check in sequence
# Stop on first failure, report clearly
# Continue through all if possible
```

### Phase 3: Document Results
```markdown
# For each check:
# - Check name
# - Command run
# - Result: PASS or FAIL
# - Error output (if failed)
# - How to fix (if failed)
```

---

## Output Format: VERIFICATION_REPORT.md

```markdown
# Infrastructure Verification Report

Generated: 2026-06-11T14:40:00Z
Status: ✅ ALL PASS (Ready for Phase 3)

## Verification Results

### ✅ Check 1: TypeScript Compilation
- Command: `npm run typecheck`
- Result: PASS
- Output: "No errors"
- Time: 3.2s

### ✅ Check 2: ESLint Linting
- Command: `npm run lint`
- Result: PASS
- Output: "0 errors, 0 warnings"
- Time: 1.5s

### ✅ Check 3: Docker Compose Syntax
- Command: `docker-compose config`
- Result: PASS
- Services found: 4 (frontend, api, postgres, redis)
- Time: 0.3s

### ✅ Check 4: Docker Services Starting
- Command: `docker-compose up -d`
- Result: PASS
- Services healthy: 4/4
  - frontend: healthy ✅
  - api: healthy ✅
  - postgres: healthy ✅
  - redis: healthy ✅
- Time: 12.4s

### ✅ Check 5: Database Connectivity
- Command: `docker-compose exec postgres pg_isready`
- Result: PASS
- Output: "accepting connections"
- Time: 0.5s

### ✅ Check 6: API Health Endpoint
- Command: `curl http://localhost:5000/health`
- Result: PASS
- Response: {"status":"healthy","database":"connected","redis":"connected"}
- Status Code: 200
- Time: 0.2s

### ✅ Check 7: Environment Variables
- Command: Verify .env.example completeness
- Result: PASS
- Variables found: 8
- All referenced variables present: ✅

### ✅ Check 8: Rate Limiting Configuration
- File: appsettings.Test.json
- Result: PASS
- Test Rate Limit: 1000 requests/window (vs. Production 10/5/3)
- Time: 0.1s

## Summary

| Check | Result | Time |
|-------|--------|------|
| TypeScript | ✅ | 3.2s |
| Linting | ✅ | 1.5s |
| Docker Syntax | ✅ | 0.3s |
| Docker Services | ✅ | 12.4s |
| Database | ✅ | 0.5s |
| API Health | ✅ | 0.2s |
| Environment | ✅ | 0.1s |
| Rate Limiting | ✅ | 0.1s |

**Total Time:** 18.3s
**Status:** ✅ READY FOR PHASE 3

## Recommendations

✅ All infrastructure is ready for E2E testing
✅ Proceed to Phase 3: Test Generation

## Troubleshooting Guide

If any check fails, here's how to fix:

### TypeScript Compilation Failed
```bash
# Error: "Type 'X' is not assignable to type 'Y'"
npm run typecheck 2>&1 | head -20  # See full error
# Fix: Review the file and correct the type
```

### Docker Services Won't Start
```bash
docker-compose logs postgres  # Check which service failed
docker-compose down -v        # Clean up
docker-compose up -d          # Try again
```

### API Health Check Failed
```bash
docker-compose logs api       # Check API logs
curl -v http://localhost:5000/health  # See full response
# Common cause: Database not ready, wait 5s and retry
```

## Next Steps

1. ✅ Review this VERIFICATION_REPORT.md
2. ✅ Confirm all checks pass
3. ✅ If failures: Fix and re-run verification
4. ✅ Once all pass: Proceed to Phase 3 (Planner Agent)

---

## If Verification Fails

If any check fails:
1. Report exact failure in VERIFICATION_REPORT.md
2. Provide error output
3. Provide remediation steps
4. **Do not proceed to Phase 3** until all pass
5. Flag for human review (may need to retry Fixer or fix manually)
```

---

## Success Criteria

Your verification is complete when:

✅ All 8 checks run successfully  
✅ VERIFICATION_REPORT.md shows all PASS  
✅ Docker services are healthy  
✅ API health endpoint responds  
✅ Database is connected  
✅ Environment variables are set  
✅ No errors blocking Phase 3  

---

## Next Agent in Chain

Once verification passes, **Phase 3 Test Generation** begins:

- **Planner Agent** → Creates test plan from fixed infrastructure
- **Generator Agent** → Generates Playwright tests
- **Executor Agent** → Runs tests
- **Healer Agent** → Fixes broken tests (if needed)
- **Consolidator Agent** → Stores learnings

If verification fails, human review is needed before Phase 3 can start.
