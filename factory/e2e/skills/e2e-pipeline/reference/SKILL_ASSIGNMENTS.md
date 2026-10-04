# Skill Assignments & Loading

**Which skills each agent loads and why**

---

## Agent Skill Matrix

| Agent | Phase | Skills Loaded | Purpose |
|-------|-------|---------------|---------|
| **Auditor** | -1 | architecture-patterns<br>api-design-principles<br>e2e-best-practices | Compare code against best practices + official docs |
| **Fixer** | -1 | code-review-excellence<br>e2e-best-practices | Apply fixes that meet quality standards |
| **Verifier** | -1 | verification-before-completion | Verify all fixes work as intended |
| **Planner** | 3 | test-driven-development<br>e2e-playwright-patterns | Plan tests with proven patterns + TDD approach |
| **Generator** | 3 | test-driven-development<br>frontend-architecture<br>e2e-playwright-patterns | Generate tests following best practices + patterns |
| **Healer** | 3 | test-driven-development<br>e2e-debugging-patterns | Diagnose failures systematically, fix with patterns |
| **Consolidator** | Post | verification-before-completion | Verify learning completeness, consolidate patterns |

---

## Skill Details

### Existing Skills (from cypher-claude-skills)

#### architecture-patterns.md
- **Type:** Code structure best practices
- **Content:** Clean Architecture, separation of concerns, layer responsibilities
- **Used by:** Auditor (verify code organization)
- **When loaded:** Auditor phase, to evaluate frontend/backend structure

#### api-design-principles.md
- **Type:** API contract & design standards
- **Content:** Endpoint naming, request/response format, error responses, versioning
- **Used by:** Auditor (verify API contracts), Generator (generate tests matching contracts)
- **When loaded:** Auditor phase, to evaluate API design

#### code-review-excellence.md
- **Type:** Code quality standards
- **Content:** Readability, maintainability, testing, performance
- **Used by:** Fixer (apply fixes that meet standards)
- **When loaded:** Fixer phase, to ensure fixes are high-quality

#### test-driven-development.md
- **Type:** Testing best practices
- **Content:** Unit tests, integration tests, E2E tests, TDD approach
- **Used by:** Planner (plan testable scenarios), Generator (write tests), Healer (fix tests correctly)
- **When loaded:** Planning and generation phases

#### frontend-architecture.md
- **Type:** React/Next.js component architecture
- **Content:** Component patterns, hooks, state management, testing components
- **Used by:** Generator (understand component structure for selectors)
- **When loaded:** Generation phase, to generate tests for components

#### verification-before-completion.md
- **Type:** Verification & acceptance criteria
- **Content:** How to verify work is done, acceptance criteria, verification strategies
- **Used by:** Verifier (verify all checks pass), Consolidator (verify learning complete)
- **When loaded:** Verification and consolidation phases

---

### New Skills (Created for E2E)

#### e2e-best-practices.md
- **Type:** Infrastructure & environment best practices
- **Content:**
  - Docker best practices (health checks, networking, volumes)
  - Environment variable management (.env files, test vs production)
  - Database & migrations (schema tracking, test data setup)
  - Service startup order & dependencies
  - Rate limiting configuration
  - Secrets & security (no hardcoded values)
  - Port management
  - Readiness checks
- **Used by:** Auditor (audit infrastructure), Fixer (fix infrastructure issues), Verifier (verify setup works)
- **When loaded:** Phase -1 (Audit + Fix)

#### e2e-playwright-patterns.md
- **Type:** Playwright test writing best practices
- **Content:**
  - Semantic locator hierarchy (getByRole > getByLabel > getByText)
  - Fixture patterns (setup/cleanup, auth fixtures)
  - Page Object Model structure & benefits
  - Test data patterns (UUID, realistic data)
  - Test isolation & cleanup
  - Async handling patterns (wait for conditions, not sleeps)
  - Error & edge case patterns
  - Accessibility & semantic patterns
  - Anti-patterns to avoid
- **Used by:** Planner (understand good test patterns), Generator (write tests using patterns), Healer (use proven patterns to fix)
- **When loaded:** Phase 3 (Test generation)

#### e2e-debugging-patterns.md
- **Type:** Test failure diagnosis & remediation
- **Content:**
  - Failure classification (6 categories)
  - Root cause analysis techniques
  - Debugging tools & techniques
  - Systematic debugging process (6 steps)
  - Common fix patterns
  - Healing checklist
  - Root cause categories (for memory)
- **Used by:** Healer (diagnose failures), Auditor (understand common issues)
- **When loaded:** Phase 3 (Healing), or Phase -1 (Auditor understanding)

---

## How Skills Are Loaded

### Loading Mechanism
Each agent prompt includes a frontmatter section:

```yaml
---
skills:
  - architecture-patterns
  - api-design-principles
  - e2e-best-practices
memory:
  retrieve: "e2e: prior audit findings"
  store: "e2e: audit findings"
---

[Agent instructions follow]
```

### Loading Process
1. Agent prompt is generated
2. Skill names are included in frontmatter
3. Before agent execution, skills are fetched from `~/.claude/skills/`
4. Agent reads all skills before starting work
5. Agent applies skill guidelines throughout execution

### Project Overrides
Projects can override skill assignments in their `CLAUDE.md`:

```markdown
## E2E Testing Skill Overrides

### Phase -1 Auditor
- Add: security-audit (if project has security requirements)
- Skip: frontend-architecture (if backend-only project)

### Phase 3 Generator
- Add: typescript-advanced-types (if heavy TypeScript)
- Skip: frontend-architecture (if API-only tests)
```

---

## Skill Retrieval & Application

### What Each Skill Provides

#### architecture-patterns
**Auditor uses to:**
- Verify Clean Architecture layers (Domain, Application, Infrastructure, API)
- Check separation of concerns (business logic in services, thin controllers)
- Verify domain entities are pure (no ORM attributes)

**How to apply:** Read codebase structure, compare against patterns section

#### api-design-principles
**Auditor uses to:**
- Verify endpoint naming consistency
- Verify request/response format consistency
- Verify error response format matches standard
- Verify HTTP status codes are correct

**How to apply:** Read API handlers, compare against principle guidelines

#### e2e-best-practices
**Auditor uses to:**
- Verify Docker setup (health checks, networking)
- Verify environment configuration (no hardcoded values)
- Verify database setup (migrations tracked, test data separate)
- Verify readiness checks (before testing)

**How to apply:** Read docker-compose.yml, .env files, check for hardcoded values

#### e2e-playwright-patterns
**Planner uses to:**
- Design test scenarios following semantic HTML (accessible)
- Plan fixture usage for auth/setup
- Plan POM usage for maintainability

**Generator uses to:**
- Write tests using semantic locators (getByRole first)
- Create fixtures for common setup patterns
- Create POM classes for page-specific selectors
- Use UUID for unique test data

**How to apply:** Apply patterns shown in skill to generated code

#### e2e-debugging-patterns
**Healer uses to:**
- Classify failure by type
- Apply systematic debugging process
- Use debugging tools (inspector, console, trace files)
- Apply common fix patterns
- Document root cause for memory

**How to apply:** Follow failure classification, apply root cause analysis, apply fix patterns

---

## Skill Coverage by Feature Type

### Feature Type: Authentication Flow
**Auditor skills:**
- architecture-patterns (session storage pattern)
- api-design-principles (JWT response format)
- e2e-best-practices (token storage, secure practices)

**Generator skills:**
- e2e-playwright-patterns (fixture for auth, cleanup)
- frontend-architecture (login form component)

### Feature Type: List & Table Display
**Auditor skills:**
- api-design-principles (list endpoint response format, pagination)
- e2e-best-practices (rate limiting for test)

**Generator skills:**
- e2e-playwright-patterns (table selectors, pagination pattern)
- frontend-architecture (table component structure)

### Feature Type: Form Input & Validation
**Auditor skills:**
- api-design-principles (input validation, error format)
- code-review-excellence (validation best practices)

**Generator skills:**
- e2e-playwright-patterns (form fixtures, error handling)
- frontend-architecture (form component patterns)

---

## When Skills Are Missing

If a required skill is not available:

1. **Check if it exists:** `ls ~/.claude/skills/software/`
2. **If missing, create it:** Following the pattern in SKILL.md format
3. **If creating new skill:**
   - Name: kebab-case (e.g., `my-new-skill.md`)
   - Location: `~/.claude/skills/software/my-new-skill.md` or `~/.claude/skills/[category]/my-new-skill/SKILL.md`
   - Format: Markdown with clear sections and examples
   - Link in agent prompt via frontmatter

---

## Skill Evolution

### As Projects Accumulate Skills

**Feature 1:**
- Uses default skills
- Learns what works, what's missing
- Stores learnings in MemoryKit

**Feature 2-5:**
- Uses default skills + learnings
- May need new skill for domain-specific patterns
- Team creates domain skill (e.g., `payment-flow-patterns.md`)

**Feature 10+:**
- Uses default + 3-5 domain skills
- Project becomes highly specialized
- Agents work faster with specific patterns

---

## Skill Maintenance

### Keep Skills Updated
- Review failing tests → add pattern to debugging-patterns
- Review common auditor findings → add checklist item to best-practices
- Review repeated generator patterns → add to playwright-patterns

### Add Domain-Specific Skills
```
~/.claude/skills/software/
├── e2e-testing/
│   └── e2e-playwright/
│       ├── SKILL.md
│       ├── agents/
│       ├── skills/
│       │   ├── e2e-best-practices.md
│       │   ├── e2e-playwright-patterns.md
│       │   ├── e2e-debugging-patterns.md
│       │   └── [project-specific-patterns.md] ← NEW
│       └── reference/
```

Example domain-specific skill:
```markdown
# Payment Integration E2E Patterns

When testing payment flows, use these patterns:
- Mock payment gateway (Stripe sandbox)
- Test card numbers (visa, amex, etc.)
- Error scenarios (declined, timeout, etc.)
```

---

## Summary

✅ **Each agent loads 2-3 skills**  
✅ **Skills are shared across agents** (reuse proven patterns)  
✅ **Skills can be project-specific** (override in CLAUDE.md)  
✅ **Skills evolve over time** (add domain patterns as needed)  
✅ **Skills improve consistency** (all agents follow same standards)
