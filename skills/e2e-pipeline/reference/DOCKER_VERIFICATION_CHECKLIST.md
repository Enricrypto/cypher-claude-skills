# Critical: Docker Verification Before Every Test Run

**MANDATORY STEP** — Must complete before ANY test execution (Phase 2 → Phase 3)

---

## Why This Matters

Tests fail silently when:
- ❌ Docker images are stale (old code from previous builds)
- ❌ Services aren't fully started (race conditions)
- ❌ Network connectivity is broken (container isolation)
- ❌ Database migrations didn't run (schema mismatch)

**Result:** Tests run against wrong code, false passes/fails reported

---

## Pre-Test Verification Checklist

### Step 1: Fresh Container Cleanup
```bash
# Remove old containers/volumes
docker compose -f docker-compose.yml down -v
sleep 2
```
**Verification:** `docker ps` shows NO old containers running

### Step 2: Rebuild with NO CACHE
```bash
# Critical: --no-cache forces full rebuild
docker compose -f docker-compose.yml build --no-cache
```
**Verification:** Build output shows ALL layers being processed (not cached)

### Step 3: Start All Services
```bash
docker compose -f docker-compose.yml up -d
```
**Verification:** `docker compose ps` shows all services in "Up" state

### Step 4: Wait for Health Checks (30s timeout per service)
```bash
# PostgreSQL: ping until responsive
docker compose exec -T postgres pg_isready -U postgres

# Redis: PING command
docker compose exec -T redis redis-cli ping

# API/App: health endpoint or process check
docker compose exec -T api [health-check-command]
```
**Verification:** All three return success (no timeouts)

### Step 5: Verify Service Connectivity
```bash
# From API container → can reach PostgreSQL?
docker compose exec -T api [test-db-connection]

# From API container → can reach Redis?
docker compose exec -T api [test-redis-connection]
```
**Verification:** No connection errors reported

### Step 6: Confirm Database State
```bash
# Migrations applied?
docker compose exec -T api [verify-schema-version]

# Fresh data (no test pollution)?
docker compose exec -T api [count-tables]
```
**Verification:** Schema version matches expected, tables empty except system data

---

## Automated Verification Script

Use the provided verification script for full automation:

```bash
# Backend tests
./scripts/verify-test-environment.sh

# Frontend tests (create similar script)
./frontend/scripts/verify-test-environment.sh
```

Both scripts handle all 6 steps above.

---

## When to Re-verify

**ALWAYS re-verify if ANY of these happened:**
- ✓ Code changes (especially to services, database, configuration)
- ✓ Docker files modified (Dockerfile, docker-compose.yml)
- ✓ Dependencies changed (package.json, .csproj)
- ✓ Environment variables changed
- ✓ Tests failed unexpectedly
- ✓ Switched branches
- ✓ Returned to this project after time away

**Quick re-verify:** Just run `docker compose -f docker-compose.yml restart` if only running additional tests

---

## Common Failures & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| "Connection refused" | Service not started | Re-run Step 3 |
| "Timeout waiting for postgres" | Migration failed | Check logs: `docker compose logs postgres` |
| "StackExchange.Redis admin mode" | Old Redis container | Run `docker compose down -v` + Step 2 |
| "Duplicate key constraint" | Stale database | Run verification script (Step 6) |
| "Test passes locally, fails in CI" | CI missing --no-cache | Ensure CI runs this verification first |

---

## Integration into Test Phases

### Phase 2: Test Generation (Frontend/E2E)
```bash
# Before running ANY E2E tests:
./frontend/scripts/verify-test-environment.sh

# Then run generation:
npm run test:e2e
```

### Phase 7: Test Execution (Backend Unit/Integration)
```bash
# Before running ANY backend tests:
./scripts/verify-test-environment.sh

# Then run tests:
docker compose -f docker-compose.test.yml exec api dotnet test Marketplace.sln
```

### Phase 3: Remediation (When tests fail)
```bash
# If tests fail:
# 1. Re-verify environment
./scripts/verify-test-environment.sh

# 2. Re-run tests
docker compose -f docker-compose.yml exec api dotnet test Marketplace.sln

# 3. If still failing, proceed to remediation
```

---

## Documenting Fresh Builds in PRs

When submitting PRs with test fixes, include this in the description:

```markdown
## Test Verification
Tests verified with fresh Docker build:
- ✅ `docker compose down -v`
- ✅ `docker compose build --no-cache`
- ✅ `./scripts/verify-test-environment.sh`
- ✅ Full test suite: 618/618 passing
```

This proves:
1. Tests run with latest code (not stale images)
2. All services are healthy
3. No flaky test false positives
4. CI will pass (same process)

---

## Next: Run Tests Safely

Once verification passes:

**Backend Tests:**
```bash
docker compose -f docker-compose.test.yml exec api dotnet test Marketplace.sln
```

**Frontend Tests:**
```bash
npm run test:e2e
```

**Key:** Never skip verification. Stale Docker is the #1 cause of confusing test failures.
