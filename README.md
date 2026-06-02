# cypher-claude-skills

Centralized Claude Code skills for Cypher projects. Install once per project and get a full suite of AI workflow skills covering code review, architecture, testing, security, blockchain development, frontend design, and video production.

---

## Installation

### New project

```bash
npm install --save-dev @cypher_digital/claude-skills
```

### Existing project

```bash
npx @cypher_digital/claude-skills init
```

### Update skills across all projects

```bash
npx @cypher_digital/claude-skills sync
```

Or install globally once so the shorter command works everywhere:

```bash
npm install -g @cypher_digital/claude-skills
# then from any project:
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

## Feature Factory

The Feature Factory is a 7-agent chain that ships features correctly the first time. Instead of one AI session trying to be product analyst + architect + backend engineer + frontend engineer + QA + reviewer simultaneously, each agent gets one job, a clean context, and only the tools it needs.

### How to start

```
Read .claude/skills/feature-factory/SKILL.md
```

Then invoke Agent 1 (Researcher) with your feature prompt and follow the chain.

### The chain

```
Feature idea
    ↓
[01] Researcher      → Researcher Report
    ↓
[02] Story Writer    → User Story
    ↓
⏸  CHECKPOINT 1: Approve the story
    ↓
[03] Spec Writer     → Technical Brief
    ↓
⏸  CHECKPOINT 2: Approve the brief
    ↓
[04] Backend Builder → Backend Summary + API Contract
    ↓
[05] Frontend Builder → Frontend Summary
    ↓
[06] Test Verifier   → Acceptance Test Report
    ↓
[07] Validator       → Validation Report
    ↓
⏸  CHECKPOINT 3: Open the PR
```

### Three human checkpoints

| # | When | What you approve |
|---|---|---|
| 1 | After Story Writer | The user story and acceptance criteria |
| 2 | After Spec Writer | The technical blueprint before any file is touched |
| 3 | After Validator | The PR once all tests pass and validation is clean |

### Skill assignments per agent

Each builder agent loads these skills automatically:

| Agent | Skills |
|---|---|
| Researcher | `architecture-patterns` |
| Spec Writer | `architecture-patterns` · `api-design-principles` |
| Backend Builder | `nodejs-backend-patterns` · `api-design-principles` · `test-driven-development` |
| Frontend Builder | `frontend-architecture` · `frontend-design` · `test-driven-development` |
| Test Verifier | `test-driven-development` · `verification-before-completion` |
| Validator | `code-review-excellence` · `security-audit` |

Override per-project by adding an `## Active Skills` section to your `CLAUDE.md`.

### When to use the full chain

| Use full chain | Skip it (inline fix) |
|---|---|
| New user-facing behaviour | Typo or copy correction |
| New API endpoint | Single-line bug fix |
| Database schema change | Config tweak |
| Change touching > 3 files | One-line routing or styling fix |

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

#### `frontend-architecture`

**Source:** cypher-claude-skills (custom)

Project-agnostic frontend architecture reference for React Native (Expo) and Next.js projects. Defines a strict 4-layer model (Presentation → Application → Domain → Infrastructure), 6 enforced rules, data flow patterns, file naming conventions, and a "where does this go?" decision checklist.

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

| Skill | Type | Trigger phrase |
|---|---|---|
| `feature-factory` | Chain (7 agents) | "Read .claude/skills/feature-factory/SKILL.md" |
| `plan-exit-review` | Workflow | "Review this plan" |
| `systematic-debugging` | Workflow | "Debug this systematically" |
| `verification-before-completion` | Workflow | "Verify before we move on" |
| `dead-code-audit` | Workflow | "Audit for dead code" |
| `code-review-excellence` | Workflow | "Do a thorough code review" |
| `requesting-code-review` | Workflow | "Prepare this for review" |
| `receiving-code-review` | Workflow | "Help me respond to this review" |
| `finishing-a-development-branch` | Workflow | "Finish this branch" |
| `test-driven-development` | Workflow | "Use TDD for this" |
| `web3-testing` | Workflow | "Test this smart contract" |
| `architecture-patterns` | Workflow | "Design this architecture" |
| `api-design-principles` | Workflow | "Review this API design" |
| `frontend-architecture` | Workflow | "Where should this code go?" |
| `typescript-advanced-types` | Workflow | "Help me type this" |
| `nodejs-backend-patterns` | Workflow | "Structure this Node.js service" |
| `python-performance-optimization` | Workflow | "Optimize this Python code" |
| `defi-protocol-templates` | Workflow | "Implement this DeFi protocol" |
| `solidity-security` | Workflow | "Security review this contract" |
| `solana-dev` | Workflow | "Help me build this Anchor program" |
| `frontend-design` | Workflow | "Build this UI component" |
| `remotion-best-practices` | Workflow | "Build this Remotion composition" |
| `create-onboarding-video` | Workflow | "Create an onboarding video" |
| `security-audit` | Workflow | "Security audit this codebase" |
| `git-commit` | Workflow | "Write a commit message" |
| `code-reviewer` | Agent | "Act as code-reviewer and review this" |
| `security-engineer` | Agent | "Act as security-engineer" |
| `threat-detection-engineer` | Agent | "Act as threat-detection-engineer" |
