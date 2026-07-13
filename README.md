# cypher-claude-skills

Two things live here:

1. **Feature Factory** — a deterministic, gate-driven engine that runs a feature through five stages with ten specialist agents. Hard gates, enforced in code.
2. **A library of Claude Code skills** — activated by `Read`-ing them in a session. Catalogued at the bottom of this file.

Not an npm package. Not a CLI you install. You clone this repo and run it.

---

## Status — read this before trusting anything else

| Component | Status |
|---|---|
| **Harness** (gates, schemas, error taxonomy, state tracking) | ✅ Compiles, tested, in CI |
| **Agent dispatch** (Claude Agent SDK) | ✅ Runs live, verified end-to-end |
| **Stage 1 (Discover)** | ✅ Verified live against a real repo |
| **Stages 2–5** | ⚠️ Compile and are gated, but have **not** been run live end-to-end |
| **E2E loop** (`factory/e2e/`) | ⚠️ Still a Claude Code Workflow script; not part of the Node build, not typechecked |
| **Tier 1** (Strategist / Architect / Decomposer) | ❌ Designed, not built. See [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) |

**Earlier versions of this README claimed things that were not true** — "PRODUCTION READY", "92% faster", "$0.08 per feature by feature #10". Those numbers were invented. The harness had never been compiled, its test suite had never run, and the orchestrator's agent calls were a mock that returned a hardcoded `status: 'PASS'`. That is all fixed now, but the claims are worth remembering as a caution: measure, then write it down.

**Real measured cost:** one read-only agent, on an 8-file repo, took ~15 turns / 2–4 minutes and reported $0.45–$0.75. A full ten-agent feature is meaningfully more. On a Claude subscription you pay in usage limits rather than dollars, but plan accordingly.

---

## The idea

A single AI session cannot reliably be product analyst, architect, backend engineer, frontend engineer, QA and reviewer at once. Mistakes compound silently when those roles collapse into one context.

So the work is split across ten agents, each with one job, a clean context, and **only the tools it needs** — and between them sit gates that are *code*, not prose.

That last part is the whole point. A "gate" that is an instruction in a prompt is a suggestion; the model can talk itself past it. A gate that is a function returning `false` cannot be talked past. Everything in `factory/harness/` exists to make the gates unbypassable.

### The one property that matters

> **An agent's opinion of its own work is not evidence.**

The gates never read an agent's self-reported status to decide whether it succeeded. They read what is **on disk** and what the agent **actually produced**:

- The Story Writer can return `status: "PASS"` with three acceptance criteria all flagged `testable: true` — and still be **blocked**, because the `USER_STORY.md` it wrote contains no Given/When/Then. A gate reads that file's text.
- A builder can claim it created `src/services/Foo.ts` — and be **blocked** as a hallucination, because the gate calls `fs.existsSync` on every claimed path.
- "No tests written" scores a pass rate of **0**, not a vacuous 100%.

Those are tested, offline, in CI, with no model and no tokens ([`stage-context.test.ts`](factory/test/harness/stage-context.test.ts)) — because the model's job is to *produce* output and the gate's job is to *judge* it, and judging is testable by handing the gate known-bad output directly.

---

## Running it

```bash
npm install
npm run typecheck     # tsc, strict
npm test              # 152 tests, no network, no tokens

npm run factory -- --feature "add an endpoint to update a user's email" --cwd /path/to/project
```

Exits `0` only if all five stages pass their gates. Any escalation exits `1`.

### Authentication

Agents run through the **Claude Agent SDK**, whose bundled binary *is* Claude Code. So it authenticates as whoever is signed in — including a **Claude subscription**. No `ANTHROPIC_API_KEY` is required if you're already logged into Claude Code.

Two caveats worth knowing:
- Subscription auth is not the path the Agent SDK documents (it lists API keys and cloud providers), so it could change.
- CI has no subscription login. If you want the factory to run unattended, that needs an API key. The gate tests run in CI regardless, because they need no model at all.

---

## The five stages

```
Stage 1  DISCOVER   01-researcher                        → Researcher Report
Stage 2  PLAN       02-story-writer → 03-spec-writer     → User Story + Technical Brief
                    ⏸ CHECKPOINT 1 (story)  ⏸ CHECKPOINT 2 (brief)
Stage 3  EXECUTE    04-backend-builder → 05-frontend-builder   (max 3 loop-backs each)
Stage 4  VERIFY     06-test-verifier → 07-validator      → regression + security check
                    ⏸ CHECKPOINT 3 (PR)
Stage 5  DELIVER    08-feature-consolidator              → reusable patterns
```

Each stage has a contract in [`harness/stage-gates.ts`](factory/harness/stage-gates.ts) — a list of criteria tagged CRITICAL / IMPORTANT / NICE_TO_HAVE. **All CRITICAL criteria must pass or the stage does not advance.** The recommendation (ADVANCE / WAIT / ESCALATE) falls out of the pass rate.

### Tool grants are enforced, not documented

[`runner/agent-registry.ts`](factory/runner/agent-registry.ts) is what *makes* the Researcher read-only — not its markdown asking politely. The grants are passed to the SDK's permission layer, which runs in `dontAsk` mode: it never prompts, and denies anything not pre-approved.

| Agent | Tools | Can write files? |
|---|---|---|
| 01-researcher | Read, Grep, Glob | No |
| 02-story-writer | Read | No |
| 03-spec-writer | Read, Grep, Glob | No |
| 04-backend-builder | Read, Write, Edit, Bash | Yes |
| 05-frontend-builder | Read, Write, Edit, Bash | Yes |
| 06-test-verifier | Read, Write, Edit, Bash | Yes |
| 07-validator | Read, Grep, Glob | No |
| 08-feature-consolidator | Read, Grep | No |

If an agent reaches for a tool it wasn't granted, the SDK denies it **and reports the attempt** — it isn't silently swallowed.

**How read-only agents produce documents:** they can't write files, but the gates need `USER_STORY.md` and friends to exist on disk. So they return the document text in `artifacts[].content` and the **harness** writes it. Builders are deliberately excluded from this — they must write their own code, or the anti-hallucination gate would be verifying the harness's own work.

---

## What the agents are told

Each agent's system prompt is its contract file in [`factory/feature/agents/`](factory/feature/agents/), loaded verbatim. Nothing else is loaded — no `CLAUDE.md`, no user skills, no project settings (`settingSources: []`). Without that, the same agent would behave differently depending on whose machine it ran on, and the determinism the gates exist to provide would be gone.

Output is **schema-forced**: each agent gets a full JSON Schema ([`runner/output-schemas.ts`](factory/runner/output-schemas.ts)) with the gate-relevant fields marked required, and the SDK retries the model internally until it conforms. This matters more than it sounds. In the first live run the schema only required a summary, so the Researcher put all its findings in **prose** and returned `filesIdentified: []` — the gate then failed it on evidence it had genuinely gathered. **An agent fills the shape you give it.** Give it the right shape.

---

## Gates enforce process; agents contribute judgment

On the first successful live run, the **gate said ADVANCE (100%)** and the **agent said ESCALATE** — and both were right.

The gate was judging *"is this research complete?"* — 7 files mapped, 6 patterns, 8 risks, report on disk. Yes.

The agent was judging *"can this be built safely?"* — and found that `requireAuth` only checked that an `Authorization` header was *present*, never verifying a token or identifying the caller. Applied to an **email change** — the password-reset anchor — that's an account-takeover vector. It called the endpoint a 30-minute job and escalated anyway.

The orchestrator honors that. An agent declaring a blocker is a finding, not noise. Neither side overrides the other.

---

## Layout

```
factory/
├── harness/          SHARED: gates, schemas, error taxonomy, state, context building
├── runner/           SHARED: Agent SDK dispatch, tool grants, output schemas, CLI
├── test/             152 tests — all offline, no model, no tokens
│
├── feature/          Tier 2 — the feature pipeline (this is "Feature Factory")
│   ├── agents/       the 10 agent contracts (each becomes a system prompt)
│   ├── workflows/    the orchestrator
│   ├── docs/         deeper docs
│   ├── reference/    lookup tables (contracts, schemas, errors, state)
│   └── SKILL.md
│
├── e2e/              Tier 3 — post-merge E2E system (see status table above)
└── (product/)        Tier 1 — Strategist / Architect / Decomposer. NOT BUILT.

skills/               standalone Claude Code skills — catalogue below
scripts/link-skills.sh  symlink them into ~/.claude/skills/
docs/REFACTOR_PLAN.md   the phased plan, including known open bugs
```

`harness/` and `runner/` sit at the top because they are **shared**. Tier 1, when it lands, gets a `product/` sibling to `feature/` and reuses the same gates — that is the whole point of the two-tier design: one deterministic harness, swappable tiers above it.

---

## Skills

Standalone, usable on their own. Activate by reading the file in a Claude Code session:

```
Read skills/security-audit.md
```

Some are single files; some are directories with a `SKILL.md` and a `reference/` folder. The full catalogue is below.

To wire them into `~/.claude/skills/` so Claude Code always reads the latest:

```bash
./scripts/link-skills.sh        # symlinks, so they can never go stale
```

> **Note:** this repo used to be published as `@cypher-digital/claude-skills` with an `npx cypher-skills sync` command that **copied** files into each project — which meant they went stale the moment you edited the source. That channel is dead; `install.js` and `cli.js` are deleted. The repo is the single source of truth, and the linker above uses symlinks, which cannot drift.

---

## Skill Activation Policy

Skills never activate automatically. Claude will ask:

> "Would you like me to activate the [skill-name] skill now?"

Approve explicitly before any skill runs.

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

#### `e2e-pipeline` _(directory skill)_

**Source:** cypher-claude-skills (custom)  
**Location:** `factory/e2e/` (organized harness-driven system)  
**Version:** 1.0 (Harness-Driven, 100% Acceptance)

Complete E2E test suite orchestration system with **guaranteed reliability**. Manages the full lifecycle from codebase audit through test generation, validation, and automated remediation with guardrails at every phase.

**Used by Feature Factory:** Test Verifier (Agent 6) — can invoke standalone or as part of feature factory

**When to use:** Building production E2E test suites for web applications. Especially valuable for:
- Complex user flows (auth, payments, multi-step interactions)
- Cross-browser compatibility testing (Chromium, Firefox, Mobile Safari)
- Guaranteed 100% pass rate with no stale-state bugs
- Systems that require deterministic, reliable test automation

**How to invoke:**

```bash
# Quick start (5 min)
Read factory/e2e/docs/README.md

# Full implementation guide
Read factory/e2e/docs/QUICK_START.md

# Architecture & design decisions
Read factory/e2e/docs/ARCHITECTURE.md

# Detailed phase-by-phase walkthrough
Read factory/e2e/docs/PHASE_GUIDE.md

# Quick reference (error categories, contracts, etc.)
Read factory/e2e/reference/QUICK_REFERENCE.md
```

**Workflow (4 Phases):**

1. **Phase -1: Audit Preparation** — Code Auditor + Reviewer validate codebase (≥95%)
2. **Phase 0: Infrastructure** — Optional infrastructure fixes (rate limiting, healthchecks)
3. **Phase 1: Test Generation** — Plan + Generate + Audit tests + Run
4. **Phase 2: Remediation** — Auto-fix failures (max 5 iterations) or escalate

**Key Features (v1.0):**
- ✅ **Harness-Driven Guardrails** — Only harness decides phase advancement
- ✅ **100% Acceptance** — No partial passes; escalates if unreachable
- ✅ **Mandatory Docker Rebuild** — Fresh environment before every test run
- ✅ **Playwright MCP Integration** — Live verification of selectors/APIs before tests
- ✅ **Regression Detection** — Before/after comparison with auto-rollback
- ✅ **Deterministic Error Handling** — Lookup table, not agent inference
- ✅ **Hard Limits** — Max 5 iterations, 1 hour, 500k tokens
- ✅ **Phase-Organized Artifacts** — Clean folder structure
- ✅ **Structured Output** — JSON schemas for all agent outputs
- ✅ **Clear Escalation** — Human review with full context when needed

**Files to Know:**
- `factory/e2e/harness/phase-gates.ts` — Phase contracts & validation
- `factory/e2e/harness/error-categories.ts` — Error → fix mapping
- `factory/e2e/harness/remediation-engine.ts` — Loop orchestrator
- `factory/e2e/workflows/e2e-full-loop-with-remediation.ts` — Orchestrator

**Learn more:** Pair with `e2e-testing-playwright` for tactical Playwright patterns.

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

**Used by Feature Factory:** Test Verifier (Agent 6) · **Used by E2E Pipeline:** All phases (infrastructure → generation → verification)

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
- **⚠️ CRITICAL: Fixture Organization** — Fixtures MUST be in `e2e/tests/fixtures.ts` (test directory root), NOT in parent `e2e/` directory. This is the official Playwright pattern used by Stripe, Microsoft, and all major projects. Parent directory imports cause unrecoverable module resolution failures — only reorganization solves it. See "Fixture Organization (Critical Pattern)" section in skill.
- **POMs** — base class with stable data-testid selectors, page-specific methods, no assertions
- **Data isolation** — global seed for read-only tests, per-suite seed for mutations, cleanup patterns
- **Mocking** — Playwright clock for timers, speakeasy for TOTP, local code generation for SMS OTP, manual webhooks
- **Flakiness prevention** — explicit waits, no arbitrary sleep(), network wait patterns, navigation handling
- **Environment-based rate limiting** — separate rate limit configs for test vs production; test env should allow high throughput to prevent flaky tests
- **Code-first approach** — read component code before writing tests; know when validation runs, where errors appear, what elements exist
- **Docker networking** — inside containers use service names (`http://nginx`), not localhost; each container's localhost is isolated
- **CI integration** — Docker Compose healthchecks, artifact uploads, cleanup on always()

**Skill includes:** 11 detailed sections with code examples, critical patterns, common pitfalls, and testing checklist.

**Learn more:** Pair with `e2e-pipeline` skill for full orchestration (audit → plan → generate → verify).

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


---

## Skill Activation Quick Reference

| Skill | Type | Used in Feature Factory | Standalone | Trigger phrase |
|---|---|---|---|---|
| `feature-factory` | Chain (7 agents) | — | ✅ | `Read .claude/skills/factory/feature/SKILL.md` |
| `e2e-pipeline` | Orchestration (8 agents) | Test Verifier | ✅ | `Read .claude/skills/software/e2e-pipeline/E2E_PIPELINE_ORCHESTRATION.md` |
| `architecture-patterns` | Workflow | Researcher · Spec Writer | ✅ | "Design this architecture" |
| `api-design-principles` | Workflow | Spec Writer · Backend Builder | ✅ | "Review this API design" |
| `nodejs-backend-patterns` | Workflow | Backend Builder | ✅ | "Structure this Node.js service" |
| `frontend-architecture` | Workflow | Frontend Builder | ✅ | "Where should this code go?" |
| `frontend-design` | Workflow | Frontend Builder | ✅ | "Build this UI component" |
| `test-driven-development` | Workflow | Backend · Frontend · Test Verifier | ✅ | "Use TDD for this" |
| `e2e-testing-playwright` | Workflow | Test Verifier, E2E Pipeline | ✅ | "Build E2E tests using Playwright" |
| `verification-before-completion` | Workflow | Test Verifier | ✅ | "Verify before we move on" |
| `code-review-excellence` | Workflow | Validator | ✅ | "Do a thorough code review" |
| `security-audit` | Workflow | Validator | ✅ | "Security audit this codebase" |
| `plan-exit-review` | Workflow | — | ✅ | "Review this plan" |
| `systematic-debugging` | Workflow | — | ✅ | "Debug this systematically" |
| `dead-code-audit` | Workflow | — | ✅ | "Audit for dead code" |
| `requesting-code-review` | Workflow | — | ✅ | "Prepare this for review" |
| `receiving-code-review` | Workflow | — | ✅ | "Help me respond to this review" |
| `finishing-a-development-branch` | Workflow | — | ✅ | "Finish this branch" |
| `web3-testing` | Workflow | — | ✅ | "Test this smart contract" |
| `typescript-advanced-types` | Workflow | — | ✅ | "Help me type this" |
| `python-performance-optimization` | Workflow | — | ✅ | "Optimize this Python code" |
| `defi-protocol-templates` | Workflow | — | ✅ | "Implement this DeFi protocol" |
| `solidity-security` | Workflow | — | ✅ | "Security review this contract" |
| `solana-dev` | Workflow (dir) | — | ✅ | "Help me build this Anchor program" |
| `remotion-best-practices` | Workflow (dir) | — | ✅ | "Build this Remotion composition" |
| `create-onboarding-video` | Workflow (dir) | — | ✅ | "Create an onboarding video" |
| `git-commit` | Workflow | — | ✅ | "Write a commit message" |
| `code-reviewer` | Agent | — | ✅ | "Act as code-reviewer and review this" |
| `security-engineer` | Agent | — | ✅ | "Act as security-engineer" |
| `threat-detection-engineer` | Agent | — | ✅ | "Act as threat-detection-engineer" |
