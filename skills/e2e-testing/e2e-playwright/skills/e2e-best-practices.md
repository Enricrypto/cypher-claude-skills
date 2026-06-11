# E2E Best Practices — Infrastructure & Environment

**For:** Auditor Agent, Fixer Agent
**Purpose:** Define best practices for infrastructure, Docker, environment variables, and test readiness

---

## Docker Best Practices

### Health Checks (CRITICAL)

Every service in docker-compose.yml must have a health check:

```yaml
services:
  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
    # start_period: wait this long before first check

  api:
    image: api:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 20s
    # start_period longer for API (needs dependencies ready)

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Why:** Tests fail if services aren't ready. Health checks prevent race conditions.

**Common Health Check Commands:**
- PostgreSQL: `["CMD", "pg_isready", "-U", "postgres"]`
- MySQL: `["CMD", "mysqladmin", "ping", "-u", "root"]`
- Redis: `["CMD", "redis-cli", "ping"]`
- API (HTTP): `["CMD", "curl", "-f", "http://localhost:5000/health"]`
- Node.js: `["CMD", "curl", "-f", "http://localhost:3000/health"]`

### Network Configuration

```yaml
services:
  postgres:
    networks:
      - backend

  api:
    networks:
      - backend
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/testdb
      # ✅ Use service name (postgres), not localhost
      # ❌ DON'T use: localhost:5432

networks:
  backend:
    driver: bridge
```

**Why:** Services communicate via service names in Docker networks, not localhost.

### Volume Configuration

```yaml
services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # Maps container directory to named volume
      
    environment:
      PGDATA: /var/lib/postgresql/data/pgdata
      # Specify where PG stores data

volumes:
  postgres_data:
    # Named volume - survives container restart
```

**Why:** Data persists between test runs. Clean start each test via `docker-compose down -v`.

---

## Environment Variables

### .env File Structure

```bash
# ✅ DO: Version-controlled example
# .env.example

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/myapp
DATABASE_TEST_URL=postgresql://user:password@postgres:5432/myapp_test
# Use `postgres` (service name) inside Docker
# Use `localhost` outside Docker

# API Configuration
API_PORT=5000
API_TIMEOUT=30000
API_RATE_LIMIT=100

# Auth
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=24h

# Logging
LOG_LEVEL=debug
LOG_FILE=/var/log/app.log
```

**Structure:**
- ✅ .env.example checked into git (documentation)
- ✅ .env.local in .gitignore (secrets)
- ✅ .env.test can be checked in (non-secret test config)
- ❌ Never commit actual secrets

### Environment-Specific Configs

```bash
# .env (development)
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp
LOG_LEVEL=debug
API_RATE_LIMIT=1000

# .env.test (E2E testing)
DATABASE_URL=postgresql://user:pass@postgres:5432/myapp_test
LOG_LEVEL=error
API_RATE_LIMIT=1000  # Relaxed for tests
AUTH_TIMEOUT=30000   # Longer timeout for tests

# .env.production (never commit with secrets)
DATABASE_URL=postgresql://...actual...
LOG_LEVEL=error
API_RATE_LIMIT=10    # Strict rate limit
AUTH_TIMEOUT=5000    # Short timeout
```

**Test Environment Specific:**
- Higher rate limits (1000 req/window vs 10 in production)
- Longer timeouts (for slower CI/CD)
- Debug logging (to diagnose failures)
- Test-specific database (separate from production)

---

## Database & Migrations

### Migration Strategy

```bash
# ✅ DO: Migrations tracked in version control

migrations/
├── 001_initial_schema.sql
├── 002_add_users_table.sql
├── 003_add_indexes.sql
└── 004_add_test_fixtures.sql

# ✅ Migrations run on app startup
# In application startup code:
# await runMigrations()  # Before serving requests

# ✅ Test data seeded separately
# migrations/fixtures/test_users.sql  # Only in test env

# ❌ DON'T: Manual schema changes
# ❌ DON'T: Skip migrations in tests
# ❌ DON'T: Different schemas for test vs production
```

**Why:** Tests need consistent, known schema. Migrations ensure consistency.

### Test Database Setup

```bash
# ✅ DO: Separate test database
DATABASE_TEST_URL=postgresql://user:pass@postgres:5432/myapp_test
# Different database from development/production

# ✅ DO: Fresh start before test suite
docker-compose down -v          # Remove volumes
docker-compose up -d            # Start fresh
docker-compose exec api npm run migrate  # Apply migrations
docker-compose exec api npm run seed:test  # Seed test data

# ✅ DO: Cleanup after test suite
docker-compose down -v
```

**Why:** Each test run has clean state. No test pollution across runs.

---

## Service Startup Order

### Dependency Chain

```yaml
# ❌ WRONG - services start in random order
services:
  api:
    image: api:latest
  postgres:
    image: postgres:16

# ✅ CORRECT - declare dependencies
services:
  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
      retries: 3

  api:
    image: api:latest
    depends_on:
      postgres:
        condition: service_healthy
    # API waits for postgres to be healthy
```

**Order:**
1. Database (postgres, mongo, etc.) starts first
2. Message queue (redis, rabbitmq) starts
3. API/backend starts (depends on database + cache)
4. Frontend dev server starts (depends on nothing, but tests wait for it)

---

## Rate Limiting Configuration

### Test vs Production

```javascript
// appsettings.Test.json or .env.test
{
  "RateLimit": {
    "Enabled": true,
    "WindowSeconds": 60,
    "MaxRequests": 1000,  // Relaxed for tests
    "MaxRequestsPerUser": 500
  },
  "AuthTimeout": 30000,    // 30 sec (tests are slower)
  "DatabaseTimeout": 60000 // 60 sec (generous)
}

// appsettings.Production.json
{
  "RateLimit": {
    "Enabled": true,
    "WindowSeconds": 60,
    "MaxRequests": 10,     // Strict in production
    "MaxRequestsPerUser": 3
  },
  "AuthTimeout": 5000,     // 5 sec
  "DatabaseTimeout": 10000 // 10 sec
}
```

**Why:** Tests need high limits (1000 req/min) or they'll hit rate limits and fail falsely.

---

## Secrets & Security

### Secret Management

```bash
# ✅ DO: Environment variables for secrets
# In code:
const apiKey = process.env.STRIPE_SECRET_KEY
const dbPassword = process.env.DATABASE_PASSWORD

# ✅ DO: .env.local for local secrets (NOT in git)
# .gitignore:
.env.local
.env.*.local
*.pem
credentials.json

# ✅ DO: Use vault/secrets manager in production
# AWS Secrets Manager, HashiCorp Vault, etc.

# ❌ DON'T: Commit secrets to git
# ❌ DON'T: Log secrets
# ❌ DON'T: Hardcode passwords/keys
```

### Audit for Hardcoded Secrets

Search codebase for:
```bash
# ❌ Find and remove:
grep -r "password\s*=\s*['\"]" src/
grep -r "api_key\s*=\s*['\"]" src/
grep -r "secret\s*=\s*['\"]" src/

# ✅ Should use:
password = process.env.DB_PASSWORD
apiKey = process.env.STRIPE_SECRET_KEY
```

---

## Port Management

### Port Assignment

```yaml
services:
  frontend:
    ports:
      - "3000:3000"  # Dev server on 3000

  api:
    ports:
      - "5000:5000"  # API on 5000 (maps to 5001 in tests)

  postgres:
    ports:
      - "5432:5432"  # Database on 5432

  redis:
    ports:
      - "6379:6379"  # Cache on 6379
```

**Common Ports:**
- Frontend: 3000, 3001
- Backend API: 5000, 5001, 8000
- PostgreSQL: 5432
- MySQL: 3306
- Redis: 6379
- MongoDB: 27017

**Conflict Prevention:**
```bash
# Check if port is in use
lsof -i :5000

# Kill process using port
kill -9 $(lsof -t -i:5000)
```

---

## Test-Specific Configuration

### Docker Compose for Testing

```yaml
# docker-compose.test.yml or .test override
services:
  api:
    environment:
      NODE_ENV: test
      DATABASE_URL: postgresql://user:pass@postgres:5432/myapp_test
      RATE_LIMIT: 1000
      LOG_LEVEL: error
      # Test-specific overrides
    
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    environment:
      POSTGRES_DB: myapp_test
      # Separate test database
```

**Usage:**
```bash
# Start test infrastructure
docker-compose -f docker-compose.yml -f docker-compose.test.yml up -d

# Run tests
npm run test:e2e

# Cleanup
docker-compose -f docker-compose.yml -f docker-compose.test.yml down -v
```

---

## Readiness Checks

### Pre-Test Verification

Before running E2E tests, verify:

```bash
# ✅ Docker is running
docker ps

# ✅ Services are healthy
docker-compose ps
# Status should be "healthy" or "Up"

# ✅ Database is accessible
docker-compose exec postgres pg_isready -U postgres

# ✅ API is responding
curl http://localhost:5000/health
# Should return HTTP 200

# ✅ Frontend is running
curl http://localhost:3000
# Should return HTML (200)

# ✅ Migrations are applied
docker-compose exec api npm run migrate:status
# All migrations should show as "applied"
```

---

## Infrastructure Audit Checklist

When auditing infrastructure, verify:

- [ ] docker-compose.yml has health checks for all services
- [ ] Services use correct network (service names, not localhost)
- [ ] Volumes configured for persistence
- [ ] .env.example exists and is complete
- [ ] Environment variables not hardcoded
- [ ] Database migrations tracked in version control
- [ ] Migrations run on app startup (not manual step)
- [ ] Test database separate from development database
- [ ] Test environment has relaxed rate limits (1000 req/window)
- [ ] Services have correct dependencies (depends_on)
- [ ] Port numbers don't conflict
- [ ] No secrets in version control (.env.local ignored)
- [ ] Health checks run successfully
- [ ] API health endpoint responds
- [ ] Database is accessible and ready

---

## Common Infrastructure Issues

### Issue 1: Services Start Before Database Ready
```yaml
# ❌ WRONG
services:
  api:
    depends_on:
      - postgres  # Just waits for container start, not readiness

# ✅ CORRECT
services:
  api:
    depends_on:
      postgres:
        condition: service_healthy
```

### Issue 2: Tests Fail with "Connection Refused"
```bash
# Check if services are healthy
docker-compose ps
# If status is "restarting", check logs
docker-compose logs postgres

# Solution: Restart with longer start_period
# docker-compose.yml: start_period: 30s (longer wait)
```

### Issue 3: Rate Limit Exceeded During Tests
```bash
# appsettings.Test.json must have higher limits
"RateLimit": {
  "MaxRequests": 1000  # High for tests
}

# If tests still hit limit, increase further
# 1000 requests per 60 seconds should be enough
# If not enough, analyze test count and adjust
```

### Issue 4: Database Not Seeding
```bash
# Ensure seed script runs
docker-compose exec api npm run seed:test

# Check if seed data was applied
docker-compose exec postgres psql -U postgres -d myapp_test \
  -c "SELECT COUNT(*) FROM users;"
```

---

## Infrastructure Best Practices Summary

✅ **Always use:**
- Health checks for all services
- docker-compose for consistent environment
- Environment variables for configuration
- Version-controlled migrations
- Separate test database
- Relaxed rate limits for test environment
- Service names in Docker networks

❌ **Never:**
- Hardcode secrets
- Skip migrations
- Use localhost inside Docker
- Assume services are ready (use health checks)
- Test against production database
- Commit .env files with secrets

✅ **Always verify before testing:**
- Docker running and services healthy
- Database accessible and migrations applied
- API responding to health check
- Frontend running
- Test environment configured
