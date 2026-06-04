# cypher-claude-skills

A complete Claude Code toolkit for shipping software correctly. Install once per project and get a full suite of AI workflow skills covering architecture, testing, security, frontend design, blockchain development, and video production — plus the **Feature Factory**, a 7-agent chain that turns a rough idea into a merged PR without shortcuts.

---

## Installation

### New project

```bash
npm install --save-dev @cypher-digital/claude-skills
```

### Existing project

```bash
npx @cypher-digital/claude-skills init
```

### Update skills across all projects

```bash
npx @cypher-digital/claude-skills sync
```

Or install globally once so the shorter command works everywhere:

```bash
npm install -g @cypher-digital/claude-skills
# then from any project:
npx cypher-skills sync
```

### CLI commands

```bash
npx cypher-skills init    # Install all skills and agents into current project
npx cypher-skills list    # List all available skills
npx cypher-skills sync    # Re-sync skills and agents into current project
npx cypher-skills add <name>  # Scaffold a new skill file
```

---

## Skill Activation Policy

**Skills never activate automatically.** Claude will ask:

> "Would you like me to activate the [skill-name] skill now?"

You must explicitly approve before any skill runs. This applies to all skills in this repo.

---

## Feature Factory

The Feature Factory is a 7-agent chain that ships features correctly the first time.

**The problem it solves:** A single AI session cannot reliably be product analyst + architect + backend engineer + frontend engineer + QA + reviewer simultaneously. Mistakes compound silently when those roles collapse into one context. The factory splits the work — each agent gets one job, a clean context, and only the tools it needs.

### How to activate

```
Read .claude/skills/feature-factory/SKILL.md
```

Then describe your feature to Agent 1 (Researcher) and follow the chain.

---

### The chain

```
Feature idea
    ↓
[01] Researcher        → maps the codebase, flags risks, open questions
    ↓
[02] Story Writer      → user story + acceptance criteria
    ↓
⏸  CHECKPOINT 1 — approve the story before any technical decisions
    ↓
[03] Spec Writer       → technical blueprint (data model, API, frontend, tests)
    ↓
⏸  CHECKPOINT 2 — approve the brief before any file is touched
    ↓
[04] Backend Builder   → migrations, services, routes, unit tests
    ↓
[05] Frontend Builder  → components, hooks, loading/error/empty states, UI tests
    ↓
[06] Test Verifier     → acceptance tests mapped to each story criterion
    ↓ (loop back to builder if ❌ failures)
[07] Validator         → gap report: completeness, security, code quality
    ↓ (loop back to builder if Critical issues)
⏸  CHECKPOINT 3 — open the PR
```

---

### How each agent works and which skills it uses

#### [01] Researcher — read-only, tools: Read, Grep, Glob

The Researcher maps the codebase before a single line of code is written. It produces a **Researcher Report** that every downstream agent depends on. If the Researcher misses something, every agent after it inherits that blind spot.

**Loads:** `architecture-patterns`

Why: Understanding Clean Architecture, Hexagonal, and DDD patterns lets the Researcher identify which layer existing code lives in, spot pattern violations, and flag whether a proposed feature fits the existing architecture or will require a refactor.

**Produces:**
- Relevant files list (path + role)
- Existing patterns to follow (naming, error handling, test conventions)
- Closest existing feature to reuse from
- Risks and flags (multi-tenancy, auth boundaries, race conditions, timezone handling)
- Open questions — never guesses, always flags

---

#### [02] Story Writer — read-only, tools: Read

Turns the rough feature description into a precise, testable user story. No technical decisions happen here — only clarity about the user problem, expected behaviour, and boundaries.

**Loads:** no skills — reasoning only

**Produces:**
- User story (`As a… / I want… / so that…`)
- Numbered acceptance criteria (Given/When/Then — each one directly testable)
- Edge cases (in scope or explicitly out of scope)
- Open questions for product or tech to resolve

> ⏸ **CHECKPOINT 1** — the story is the contract. Read every acceptance criterion carefully before approving. Correcting a story takes minutes. Correcting the wrong feature after builders have run takes hours.

---

#### [03] Spec Writer — read-only, tools: Read, Grep, Glob

Translates the approved story into a concrete technical blueprint. Every builder agent reads this before touching a file.

**Loads:** `architecture-patterns` · `api-design-principles`

Why: `architecture-patterns` ensures the spec respects layering (no business logic in routes, no framework dependencies in the domain). `api-design-principles` drives correct endpoint design — resource-oriented naming, proper HTTP semantics, consistent error shapes, and pagination from day one.

**Produces:**
- Data model changes (tables, columns, indexes, migrations, foreign keys)
- Background / async flow (if applicable)
- API contract (method + path, auth, request/response shapes, all error codes)
- Frontend changes (pages, components, hooks, all three states: loading / empty / error)
- Full test list (unit, integration, acceptance — one per criterion)
- Complete file list with reasons — nothing surprises the builders
- Risks and constraints from the Researcher Report

> ⏸ **CHECKPOINT 2** — last chance to catch wrong assumptions before any file changes. Read the file list. Read the API contract. Read the data model. Only approve when satisfied.

---

#### [04] Backend Builder — tools: Read, Write, Edit, Bash

Implements the backend exactly as specified in the approved brief. Scope ends at the API contract.

**Loads:** `nodejs-backend-patterns` · `api-design-principles` · `test-driven-development`

Why:
- `nodejs-backend-patterns` enforces the layered structure (controllers stay thin, business logic goes in services, repositories handle data access) and provides patterns for middleware, error handling, auth, and database integration.
- `api-design-principles` keeps the implemented endpoints consistent with the spec — correct HTTP methods, status codes, and error response shapes.
- `test-driven-development` enforces RED → GREEN → REFACTOR: every new behaviour gets a failing test written first, watched fail, then implemented. No production code without a failing test first.

**Builds:** migrations · service layer · routes/controllers · background jobs · unit tests

**Does not touch:** any frontend file, component, page, or client-side hook

**Produces:** Backend Builder Summary with every file changed, every pattern reused, the API contract, and test results.

---

#### [05] Frontend Builder — tools: Read, Write, Edit, Bash

Implements the UI exactly as specified, consuming the API contract the Backend Builder produced. Never invents endpoints.

**Loads:** `frontend-architecture` · `frontend-design` · `test-driven-development`

Why:
- `frontend-architecture` enforces the 4-layer model (Presentation → Application → Domain → Infrastructure). Screens stay thin and wire-only. Business logic goes in use-case hooks. Domain rules live in framework-free domain files. Services are thin API wrappers.
- `frontend-design` prevents generic AI aesthetics (Inter font, purple gradients, cards on cards). Every UI decision — spacing, radius, shadow, typography, motion — is evaluated against a production design standard.
- `test-driven-development` applies the same RED → GREEN → REFACTOR discipline to UI components and hooks.

**Builds:** components · pages · use-case hooks · state management · loading/empty/error states · form validation · UI tests

**If the API contract doesn't match what the UI needs:** flags the mismatch explicitly and loops back to the Backend Builder — never silently works around it.

**Does not touch:** any backend file, service, route, migration, or worker

---

#### [06] Test Verifier — tools: Read, Write, Edit, Bash

Proves the feature does what the story said it should. Writes acceptance tests — not unit tests. The builders already wrote unit tests; this agent verifies from the outside, the way a real user would experience it.

**Loads:** `test-driven-development` · `verification-before-completion`

Why:
- `test-driven-development` keeps tests focused on behaviour, not implementation — tests exercise the feature through the API or UI, not internal functions.
- `verification-before-completion` enforces the iron law: no completion claim without running the suite and reading the output. Every criterion is either ✅ Covered / ❌ Failing / ⚠️ Not coverable — never assumed passing.

**For each acceptance criterion:**
- ✅ **Covered** — test written and passes
- ❌ **Failing** — test written, fails, reports which builder owns the fix
- ⚠️ **Not coverable** — explains why automated verification isn't possible

**Does not modify** any implementation file. Does not patch around failures. Routes them back.

---

#### [07] Validator — read-only, tools: Read, Grep, Glob

Compares what was actually built against what was approved. Finds everything the other agents missed. Reports it honestly by severity. Never fixes anything.

**Loads:** `code-review-excellence` · `security-audit`

Why:
- `code-review-excellence` provides a structured review methodology: architectural fit, logic correctness, test quality, maintainability, naming — with severity labels (🔴 blocking / 🟡 important / 🟢 nit).
- `security-audit` runs a full threat-surface check: secrets exposure, broken auth, injection vulnerabilities, missing input validation, tenant isolation gaps, supply chain concerns, and OWASP Top 10 — grounded in the 2026 threat landscape.

**Checks:**
- Completeness — every acceptance criterion and brief section implemented?
- Test coverage — every failure path and edge case tested?
- Security — auth checks, tenant isolation, input validation, no secrets in logs
- Code quality — logic in the right layer, no duplicate code, patterns consistent with the codebase
- Operational concerns — timezone handling, retry/idempotency, multi-tenant gaps

**Severity levels:**
- **Critical** — must fix before merge (security hole, data loss, auth gap, failing criterion)
- **Important** — should fix before merge (missing test, pattern violation)
- **Minor** — reviewer's call (naming, refactor opportunity)

> ⏸ **CHECKPOINT 3** — review the Validation Report. No Critical issues → open the PR.

---

### Artifacts that flow between agents

| From | To | Artifact |
|---|---|---|
| Researcher | All downstream agents | Researcher Report |
| Story Writer | Spec Writer, Test Verifier, Validator | User Story + acceptance criteria |
| Spec Writer | Both Builders, Test Verifier, Validator | Technical Brief |
| Backend Builder | Frontend Builder, Test Verifier, Validator | Backend Summary + API Contract |
| Frontend Builder | Test Verifier, Validator | Frontend Summary |
| Test Verifier | Validator | Acceptance Test Report |

Each agent must read all upstream artifacts before starting.

---

### Loop-back rules

| Situation | Action |
|---|---|
| Test Verifier finds ❌ failing criterion | Loop back to the builder who owns that layer |
| Validator finds Critical issue | Loop back to the builder who owns the file |
| Validator finds Important issue | Your call — fix before PR or note in PR description |
| Wrong architectural assumption mid-chain | Kill the session. Start fresh with the correct assumption baked into the first prompt. |

---

### Overriding skill assignments per project

The default skill assignments above apply to all projects. To override for a specific project, add this to the project's `CLAUDE.md`:

```markdown
## Active Skills
Backend: nodejs-backend-patterns, api-design-principles, test-driven-development
Frontend: frontend-architecture, frontend-design
Validator: code-review-excellence, security-audit
```

The agents will use this list instead of the feature-factory defaults.

---

### When to use the full chain

| Use full chain | Skip it (inline fix) |
|---|---|
| New user-facing behaviour | Typo or copy correction |
| New API endpoint | Single-line bug fix |
| Database schema change | Config tweak |
| Change touching > 3 files | One-line routing or styling fix |

---

### Branch cleanup after merge

After the PR merges, always run:

```bash
git checkout main
git pull origin main
git branch -d feat/<task-name>
git push origin --delete feat/<task-name>
```

---

## Skills Reference

The skills below are standalone — usable independently or as part of the Feature Factory chain. Each one can be activated on its own for any task that matches its description.

### Planning & Review

---

#### `plan-exit-review`

**Source:** [garrytan/plan-exit-review](https://gist.github.com/garrytan/001f9074cab1a8f545ebecbc73a813df)

Structured pre-implementation plan review. Challenges scope, reviews architecture, code quality, tests, and performance — interactively, with opinionated recommendations.

**When to use:** Before writing any code for a new feature or significant change.

**How to invoke:**

```
"Review this plan before we implement it"
"Activate plan-exit-review"
```

**Flow:**

1. Scope challenge — is the plan over-built?
2. Architecture review
3. Code quality review
4. Test review with diagram
5. Performance review
6. Completion summary with all findings

---

#### `systematic-debugging`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

4-phase structured debugging methodology: reproduce → isolate → trace → fix. Prevents ad-hoc guessing and ensures root cause is identified before any fix is applied.

**When to use:** Any time you hit a bug that isn't immediately obvious.

**How to invoke:**

```
"Use systematic-debugging on this error"
"Debug this systematically"
```

---

#### `verification-before-completion`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

Forces Claude to verify its own work before declaring it done. Runs the actual verification command, reads the full output, and only then makes a completion claim. No "should work" — evidence only.

**Used by Feature Factory:** Test Verifier (Agent 6)

**When to use:** Before closing any task or telling Claude a feature is done.

**How to invoke:**

```
"Verify this before we move on"
"Activate verification-before-completion"
```

---

#### `dead-code-audit`

**Source:** cypher-claude-skills (custom)

Scans the codebase for dead, redundant, or hallucinated code — unused imports, unreachable branches, orphaned mappings, ghost state, debug artifacts. Blockchain-aware: understands Solidity storage, Anchor account structs, unused PDAs.

**Never auto-deletes.** Presents a severity-ranked report and deletion plan for your approval.

**When to use:** Before a PR, after a long AI coding session, or when the codebase feels bloated.

**How to invoke:**

```
"Audit for dead code"
"Find unused code in this project"
"Run dead-code-audit"
```

**Severity levels:** Critical → High → Medium → Low

---

### Code Quality & Review

---

#### `code-review-excellence`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Structured code review methodology. Covers architectural concerns, security, performance, and maintainability. Uses labeled feedback (🔴 blocking, 🟡 important, 🟢 nit) and collaborative language.

**Used by Feature Factory:** Validator (Agent 7)

**When to use:** When reviewing a PR or asking Claude to review your own code.

**How to invoke:**

```
"Review this code using code-review-excellence"
"Do a thorough code review of these changes"
```

---

#### `requesting-code-review`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

Pre-review checklist. Ensures your code is ready for review before you submit — tests passing, diff clean, context documented.

**When to use:** Before opening a PR.

**How to invoke:**

```
"Prepare this for code review"
"Run requesting-code-review"
```

---

#### `receiving-code-review`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

Framework for responding to code review feedback. Helps categorize, prioritize, and action review comments systematically.

**When to use:** After receiving PR feedback.

**How to invoke:**

```
"Help me respond to this code review"
"Activate receiving-code-review"
```

---

#### `finishing-a-development-branch`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

End-of-branch checklist: verifies tests, presents merge/PR/keep/discard options, cleans up worktrees. Ensures no branch is merged incomplete.

**When to use:** When a feature branch is done and ready to ship.

**How to invoke:**

```
"Finish this branch"
"Run finishing-a-development-branch"
```

---

### Testing

---

#### `test-driven-development`

**Source:** [obra/superpowers](https://github.com/obra/superpowers)

Enforces strict RED → GREEN → REFACTOR cycle. Write failing test first, watch it fail, write minimal code to pass, refactor. Deletes code written before tests exist.

**Used by Feature Factory:** Backend Builder (Agent 4) · Frontend Builder (Agent 5) · Test Verifier (Agent 6)

**When to use:** Any time you're implementing a new feature or fixing a bug.

**How to invoke:**

```
"Use TDD for this feature"
"Activate test-driven-development"
```

---

#### `web3-testing`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Smart contract testing with Hardhat and Foundry. Covers unit tests, integration tests, mainnet forking, fuzz testing, and invariant testing.

**When to use:** Writing or improving smart contract tests.

**How to invoke:**

```
"Help me test this contract using web3-testing"
"Set up Foundry tests for this"
```

---

#### `e2e-testing-playwright`

**Source:** cypher-claude-skills (custom)

Production-grade Playwright E2E test suite architecture. Covers config setup, fixture patterns (auth, seed, helpers), Page Object Models (POMs), test data isolation strategies, mocking patterns (TOTP, SMS, timers, payment webhooks), flakiness prevention, and CI integration with Docker.

**Used by Feature Factory:** Test Verifier (Agent 7)

**When to use:** Writing end-to-end test suites for web applications. Especially valuable for multi-browser testing, complex auth flows, payment testing, and test data isolation.

**How to invoke:**

```
"Build E2E tests using e2e-testing-playwright"
"Set up Playwright with proper fixtures and POMs"
"Help me write non-flaky Playwright tests"
```

**Key patterns covered:**

- **Config** — 3 browser projects (chromium, mobile-chrome, firefox), retries on CI, workers optimization
- **Fixtures** — auth (login via API), seed (global + per-test), helpers (TOTP, SMS mock, clock, webhooks)
- **POMs** — base class with stable data-testid selectors, page-specific methods, no assertions
- **Data isolation** — global seed for read-only tests, per-suite seed for mutations, cleanup patterns
- **Mocking** — Playwright clock for timers, speakeasy for TOTP, local code generation for SMS OTP, manual webhooks
- **Flakiness prevention** — explicit waits, no arbitrary sleep(), network wait patterns, navigation handling
- **CI integration** — Docker Compose healthchecks, artifact uploads, cleanup on always()

**Skill includes:** 10 detailed sections with code examples, common pitfalls, and testing checklist.

---

### Architecture

---

#### `architecture-patterns`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Clean Architecture, Hexagonal Architecture, and Domain-Driven Design patterns for building maintainable, testable, and scalable backend systems.

**Used by Feature Factory:** Researcher (Agent 1) · Spec Writer (Agent 3)

**When to use:** Designing a new system, refactoring a monolith, or establishing architecture standards.

**How to invoke:**

```
"Design this using architecture-patterns"
"What architecture should I use for this?"
```

---

#### `api-design-principles`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

REST and GraphQL API design best practices. Covers endpoint naming, versioning, error responses, pagination, authentication patterns, and OpenAPI documentation.

**Used by Feature Factory:** Spec Writer (Agent 3) · Backend Builder (Agent 4)

**When to use:** Designing or reviewing an API.

**How to invoke:**

```
"Review this API design"
"Help me design this endpoint properly"
```

---

#### `frontend-architecture`

**Source:** cypher-claude-skills (custom)

Project-agnostic frontend architecture reference for React Native (Expo) and Next.js projects. Defines a strict 4-layer model (Presentation → Application → Domain → Infrastructure), 6 enforced rules, data flow patterns, file naming conventions, and a "where does this go?" decision checklist.

**Used by Feature Factory:** Frontend Builder (Agent 5)

**When to use:** Starting a new React Native or Next.js project, adding a feature and unsure which layer it belongs in, reviewing a PR for architectural correctness, or onboarding a collaborator.

**How to invoke:**

```
"Where should this code go in the architecture?"
"Review this for architectural correctness"
"Activate frontend-architecture"
```

**Layers:**

- **Presentation** — Screens, pages, pure UI components (`app/`, `components/`)
- **Application** — Use-case hooks, business logic, orchestration (`hooks/use-cases/`)
- **Domain** — Entities, value objects, validation rules — zero framework dependencies (`domain/`)
- **Infrastructure** — API clients, state management, external services (`services/`, `store/`)

---

### Language-Specific

---

#### `typescript-advanced-types`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Advanced TypeScript type system patterns: generics, conditional types, mapped types, template literal types, utility types, and type-safe patterns for complex data structures.

**When to use:** Working with complex TypeScript types or when the type system is fighting you.

**How to invoke:**

```
"Help me type this properly using typescript-advanced-types"
"What's the right TypeScript type for this?"
```

---

#### `nodejs-backend-patterns`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Production Node.js patterns: Express/Fastify setup, middleware, error handling, async patterns, database integration, background jobs, and WebSockets.

**Used by Feature Factory:** Backend Builder (Agent 4)

**When to use:** Building or reviewing a Node.js backend service.

**How to invoke:**

```
"Use nodejs-backend-patterns for this service"
"How should I structure this Node.js app?"
```

---

#### `python-performance-optimization`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Python profiling and optimization using cProfile, performance best practices, async patterns, memory optimization, and efficient data structure usage.

**When to use:** When Python code is slow or memory-intensive.

**How to invoke:**

```
"Optimize this Python code"
"Profile and improve this script"
```

---

### Blockchain & Web3

---

#### `defi-protocol-templates`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

DeFi protocol implementation templates: staking, AMMs, governance, and lending. Covers standard patterns, security considerations, and integration points.

**When to use:** Implementing a DeFi protocol or reviewing protocol architecture.

**How to invoke:**

```
"Use defi-protocol-templates for this staking contract"
"What's the standard pattern for an AMM?"
```

---

#### `solidity-security`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Smart contract security patterns. Covers reentrancy, access control, integer overflow, oracle manipulation, flash loan attacks, and secure coding patterns.

**When to use:** Reviewing Solidity contracts for security issues or implementing security patterns.

**How to invoke:**

```
"Security review this contract"
"Check for vulnerabilities using solidity-security"
```

---

#### `solana-dev` _(directory skill)_

**Source:** [solana-foundation/solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill)

Comprehensive Solana development skill from the Solana Foundation. Covers Anchor framework, Pinocchio (high-performance native), LiteSVM/Mollusk/Surfpool testing, IDL codegen, payments with Commerce Kit, and security vulnerabilities.

**Reference files loaded on demand:**

- `programs-anchor.md` — Anchor program development
- `programs-pinocchio.md` — CU optimization, zero-copy patterns
- `testing.md` — LiteSVM, Mollusk, Surfpool
- `security.md` — Solana-specific vulnerabilities
- `frontend-framework-kit.md` — `@solana/client` + `@solana/react-hooks`
- `idl-codegen.md` — IDL and client generation
- `payments.md` — Commerce Kit integration

**When to use:** Any Solana development work.

**How to invoke:**

```
"Help me build this Anchor program"
"Create an escrow using Solana best practices"
"Convert this to Pinocchio for better CU efficiency"
"Write LiteSVM tests for this instruction"
```

---

### Frontend Design

---

#### `frontend-design` _(directory skill)_

**Source:** [pbakaus/impeccable](https://impeccable.style) + [anthropics/skills](https://github.com/anthropics/skills)

Production-grade frontend design skill. Avoids generic AI aesthetics (Inter font, purple gradients, cards on cards). Commits to a bold aesthetic direction and implements it with precision.

**Used by Feature Factory:** Frontend Builder (Agent 5)

**Reference files loaded on demand:**

- `reference/typography.md` — modular scales, font pairing, web font loading
- `reference/color-and-contrast.md` — OKLCH, palettes, dark mode
- `reference/spatial-design.md` — grids, spacing systems, visual hierarchy
- `reference/motion-design.md` — timing, easing, reduced motion
- `reference/interaction-design.md` — states, focus, forms, loading patterns
- `reference/responsive-design.md` — mobile-first, container queries
- `reference/ux-writing.md` — labels, errors, empty states

**Impeccable slash commands (invoke directly in Claude Code):**

```
/polish      — Final pass: alignment, spacing, consistency
/audit       — Find design issues
/simplify    — Strip to essentials
/normalize   — Match to existing design system/tokens
/bolder      — Push design to be more distinctive
```

**When to use:** Building any UI component, dashboard, or web application.

**How to invoke:**

```
"Build this dashboard using the frontend-design skill"
"Design a [component] that avoids AI slop aesthetics"
/polish
/audit
```

---

### Video Production

---

#### `remotion-best-practices` _(directory skill)_

**Source:** cypher-claude-skills (custom)

Domain-specific knowledge for building videos with Remotion — React-based programmatic video. Covers composition setup, frame-based animation with `useCurrentFrame()` and `interpolate()`, `<Sequence>` timing patterns, asset loading via `staticFile()`, captions, FFmpeg integration, silence detection, audio visualization, 3D content with Three.js, transitions, and more.

**Key rules:**
- CSS transitions and Tailwind animation classes are **forbidden** — they won't render correctly
- All animation must use `useCurrentFrame()` and `interpolate()`
- Assets go in `public/` and are referenced with `staticFile()`

**When to use:** Any time you are writing or modifying Remotion code.

**How to invoke:**

```
"Build this video component using remotion-best-practices"
"Activate remotion-best-practices"
```

---

#### `create-onboarding-video` _(directory skill)_

**Source:** cypher-claude-skills (custom)

End-to-end workflow for producing short, punchy iOS app onboarding videos in Remotion. Each video showcases a feature in action by animating **isolated pieces of the UI** — not full screens — with UI-like transitions (springs, masked reveals, shared-element morphs). Designed to feel like an App Store preview.

**Workflow:**
1. **Intake** — collect 2–4 stills per screen (resting, mid-interaction, result states) + intent
2. **Shot planning** — identify the single UI piece that proves the feature works per beat
3. **Build** — Remotion compositions with spring-based motion, cursor-led taps, fixed caption band
4. **Iterate** — render preview, adjust pacing, restage beats

**Key rules:**
- Never animate the whole screen — crop to the component that carries the beat
- Cursor must lead every tap interaction along a single straight path
- Captions anchor to a fixed top position, rise in from below, stay visible the entire beat
- Always delegates Remotion code to `remotion-best-practices`

**When to use:** Creating app onboarding videos, App Store previews, or feature demo clips from screenshots.

**How to invoke:**

```
"Create an onboarding video for this feature"
"Build an App Store preview using these screenshots"
"Activate create-onboarding-video"
```

---

### Security

---

#### `security-audit`

**Source:** cypher-claude-skills (custom)

Comprehensive, multi-layer security audit grounded in the 2026 threat landscape. Covers web/API security, infrastructure, AI agents, blockchain/smart contracts, and Living Off the Land (LOTL) attack patterns. Checks for OWASP Top 10, secrets exposure, dependency vulnerabilities, threat modeling, and more.

**Used by Feature Factory:** Validator (Agent 7)

**When to use:** Before any release, when working on financial platforms, DeFi protocols, trading systems, or APIs that handle money.

**How to invoke:**

```
"Security audit this codebase"
"Check for vulnerabilities"
"Is this secure?"
"Audit my code"
```

---

#### `security-engineer` _(agent skill)_

**Source:** cypher-claude-skills (custom)

Expert application security engineer agent specializing in threat modeling, vulnerability assessment, secure code review, and security architecture. Uses STRIDE analysis, OWASP Top 10, and CWE Top 25 as frameworks. Delivers concrete, actionable remediation — not just vulnerability reports.

**Capabilities:**
- Threat modeling with STRIDE analysis and trust boundary mapping
- Secure code review with prioritized findings (Critical / High / Medium / Low)
- Security architecture design: zero-trust, defense-in-depth, OAuth 2.0/OIDC, secrets management
- CI/CD security pipeline setup (SAST, DAST, SCA, secrets scanning)
- Cloud security posture assessment (AWS, GCP, Azure)

**When to use:** Designing security architecture, reviewing code for vulnerabilities, setting up security pipelines, or responding to an incident.

**How to invoke:**

```
"Act as security-engineer and threat model this system"
"Review this auth implementation as security-engineer"
"Design a zero-trust architecture for this service"
```

---

#### `threat-detection-engineer` _(agent skill)_

**Source:** cypher-claude-skills (custom)

Expert detection engineer agent specializing in SIEM rule development, MITRE ATT&CK coverage mapping, threat hunting, and detection-as-code pipelines. Writes Sigma rules compiled to Splunk SPL, Microsoft Sentinel KQL, and Elastic EQL. Prioritizes signal quality over quantity — a noisy SIEM is worse than no SIEM.

**Capabilities:**
- Sigma detection rule authoring with ATT&CK mapping and false positive documentation
- MITRE ATT&CK coverage gap assessment and detection roadmaps
- Threat hunting hypotheses, hunt queries, and hunt-to-detection conversion
- Detection-as-code CI/CD pipelines (validate → compile → test → deploy)
- Alert tuning: false positive reduction, threshold tuning, contextual enrichment

**When to use:** Building or improving a detection program, writing SIEM rules, mapping ATT&CK coverage, or running a threat hunt.

**How to invoke:**

```
"Act as threat-detection-engineer and write a rule for this technique"
"Map our ATT&CK coverage and identify gaps"
"Write a threat hunt for lateral movement"
```

---

### AI Agent Skills

---

#### `code-reviewer` _(agent skill)_

**Source:** cypher-claude-skills (custom)

Expert code reviewer agent who provides constructive, actionable feedback focused on correctness, security, maintainability, and performance — not style preferences. Reviews like a mentor, not a gatekeeper: every comment teaches something.

**Priority system:**
- 🔴 **Blocker** — security vulnerabilities, data loss risks, race conditions, breaking API contracts
- 🟡 **Suggestion** — missing input validation, unclear naming, missing tests, performance issues
- 💭 **Nit** — style inconsistencies, minor naming improvements, docs gaps

**When to use:** When you want a thorough, structured code review from a dedicated reviewer persona — more focused than `code-review-excellence` which is a methodology skill.

**How to invoke:**

```
"Act as code-reviewer and review these changes"
"Review this PR as code-reviewer"
```

---

### Git Workflow

---

#### `git-commit`

**Source:** [github/awesome-copilot](https://github.com/github/awesome-copilot)

Structured commit message discipline. Enforces conventional commits format with proper scope, type, and description.

**When to use:** Before every commit.

**How to invoke:**

```
"Write a commit message for these changes"
"Help me commit this properly"
```

---

## Adding New Skills

```bash
# Scaffold a new skill file in the repo
npx cypher-skills add <skill-name>

# Then edit skills/<skill-name>.md with your instructions
# Bump version and publish — all projects get it on next sync
npm version patch
npm publish --access public
```

---

## Updating Skills Across Projects

```bash
# In any project that has cypher-claude-skills installed
npx cypher-skills sync
```

---

## Skill Activation Quick Reference

| Skill | Type | Used in Feature Factory | Trigger phrase |
|---|---|---|---|
| `feature-factory` | Chain (7 agents) | — | `Read .claude/skills/feature-factory/SKILL.md` |
| `architecture-patterns` | Workflow | Researcher · Spec Writer | "Design this architecture" |
| `api-design-principles` | Workflow | Spec Writer · Backend Builder | "Review this API design" |
| `nodejs-backend-patterns` | Workflow | Backend Builder | "Structure this Node.js service" |
| `frontend-architecture` | Workflow | Frontend Builder | "Where should this code go?" |
| `frontend-design` | Workflow | Frontend Builder | "Build this UI component" |
| `test-driven-development` | Workflow | Backend · Frontend · Test Verifier | "Use TDD for this" |
| `verification-before-completion` | Workflow | Test Verifier | "Verify before we move on" |
| `code-review-excellence` | Workflow | Validator | "Do a thorough code review" |
| `security-audit` | Workflow | Validator | "Security audit this codebase" |
| `plan-exit-review` | Workflow | — | "Review this plan" |
| `systematic-debugging` | Workflow | — | "Debug this systematically" |
| `dead-code-audit` | Workflow | — | "Audit for dead code" |
| `requesting-code-review` | Workflow | — | "Prepare this for review" |
| `receiving-code-review` | Workflow | — | "Help me respond to this review" |
| `finishing-a-development-branch` | Workflow | — | "Finish this branch" |
| `web3-testing` | Workflow | — | "Test this smart contract" |
| `typescript-advanced-types` | Workflow | — | "Help me type this" |
| `python-performance-optimization` | Workflow | — | "Optimize this Python code" |
| `defi-protocol-templates` | Workflow | — | "Implement this DeFi protocol" |
| `solidity-security` | Workflow | — | "Security review this contract" |
| `solana-dev` | Workflow | — | "Help me build this Anchor program" |
| `remotion-best-practices` | Workflow | — | "Build this Remotion composition" |
| `create-onboarding-video` | Workflow | — | "Create an onboarding video" |
| `git-commit` | Workflow | — | "Write a commit message" |
| `code-reviewer` | Agent | — | "Act as code-reviewer and review this" |
| `security-engineer` | Agent | — | "Act as security-engineer" |
| `threat-detection-engineer` | Agent | — | "Act as threat-detection-engineer" |
