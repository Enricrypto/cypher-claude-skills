# cypher-claude-skills

Centralized Claude Code skills for Cypher projects. Install once per project and get a full suite of AI workflow skills covering code review, architecture, testing, blockchain development, and frontend design.

---

## Installation

### New project

```bash
npm install --save-dev github:Enricrypto/cypher-claude-skills
```

### Existing project

```bash
npx cypher-skills init
```

### Update skills across all projects

```bash
npx cypher-skills sync
```

### CLI commands

```bash
npx cypher-skills init    # Install all skills into current project
npx cypher-skills list    # List all available skills
npx cypher-skills sync    # Re-sync skills into current project
npx cypher-skills add <name>  # Scaffold a new skill file
```

---

## Skill Activation Policy

**Skills never activate automatically.** Claude will ask:

> "Would you like me to activate the [skill-name] skill now?"

You must explicitly approve before any skill runs. This applies to all skills in this repo.

---

## Skills Reference

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

Forces Claude to verify its own work before declaring it done. Runs checks against the original spec, tests, and edge cases before marking a task complete.

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

**When to use:** Any time you're implementing a new feature or fixing a bug.

**How to invoke:**

```
"Use TDD for this feature"
"Activate test-driven-development"
```

---

#### `webapp-testing`

**Source:** [anthropics/skills](https://github.com/anthropics/skills)

Testing patterns for TypeScript and Node.js web applications. Covers unit, integration, and e2e testing strategies, mock patterns, and test organization.

**When to use:** Setting up or improving tests in a TypeScript/Node.js project.

**How to invoke:**

```
"Help me test this using webapp-testing"
"What's the right testing strategy for this?"
```

---

### Architecture

---

#### `architecture-patterns`

**Source:** [wshobson/agents](https://github.com/wshobson/agents)

Clean Architecture, Hexagonal Architecture, and Domain-Driven Design patterns for building maintainable, testable, and scalable backend systems.

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

**When to use:** Designing or reviewing an API.

**How to invoke:**

```
"Review this API design"
"Help me design this endpoint properly"
```

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
# Commit and push — all projects get it on next sync
```

---

## Updating Skills Across Projects

```bash
# In any project that has cypher-claude-skills installed
npx cypher-skills sync
```

---

## Skill Activation Quick Reference

| Skill                             | Trigger phrase                      |
| --------------------------------- | ----------------------------------- |
| `plan-exit-review`                | "Review this plan"                  |
| `systematic-debugging`            | "Debug this systematically"         |
| `verification-before-completion`  | "Verify before we move on"          |
| `dead-code-audit`                 | "Audit for dead code"               |
| `code-review-excellence`          | "Do a thorough code review"         |
| `requesting-code-review`          | "Prepare this for review"           |
| `receiving-code-review`           | "Help me respond to this review"    |
| `finishing-a-development-branch`  | "Finish this branch"                |
| `test-driven-development`         | "Use TDD for this"                  |
| `webapp-testing`                  | "Help me test this"                 |
| `architecture-patterns`           | "Design this architecture"          |
| `api-design-principles`           | "Review this API design"            |
| `typescript-advanced-types`       | "Help me type this"                 |
| `nodejs-backend-patterns`         | "Structure this Node.js service"    |
| `python-performance-optimization` | "Optimize this Python code"         |
| `defi-protocol-templates`         | "Implement this DeFi protocol"      |
| `solidity-security`               | "Security review this contract"     |
| `web3-testing`                    | "Test this smart contract"          |
| `solana-dev`                      | "Help me build this Anchor program" |
| `frontend-design`                 | "Build this UI component"           |
| `git-commit`                      | "Write a commit message"            |
