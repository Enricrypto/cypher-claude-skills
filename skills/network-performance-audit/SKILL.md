---
name: network-performance-audit
description: Audit a web application for slow-connection (3G/poor network) issues. Explores the codebase, applies an 8-category checklist, and produces a severity-ranked findings report with file:line references and concrete fixes.
allowed-tools:
  - Read
  - Bash(find:*)
  - Bash(grep:*)
  - Bash(cat:*)
  - mcp__memorykit__retrieve_context
  - mcp__firecrawl__firecrawl_search
  - Write
when_to_use: |
  Use when the user wants to audit a web application for poor-network or slow-connection performance.
  Trigger phrases: "run a network audit", "network performance audit", "3G audit", "slow connection audit",
  "perf audit", "performance audit", "why is the app slow on mobile", "users on 3G have issues",
  someone reports loading problems on mobile or in a specific country/region.
---

# Network Performance Audit (3G / Poor Connectivity)

Audits the current project for slow-connection performance issues. Applies an 8-category checklist
to the codebase, identifies specific problems with file:line references, and produces a
severity-ranked report at `docs/NETWORK_PERFORMANCE_AUDIT.md`.

**Rules:**
- Read-only. Never modify implementation code. Report findings only.
- Always run MemoryKit `retrieve_context` first.
- Severity levels must be exactly: CRITICAL / HIGH / MEDIUM / LOW.
- Ask for explicit approval before writing the audit file.

## Goal

A `docs/NETWORK_PERFORMANCE_AUDIT.md` file containing:
- A brief "why this matters" section with 3G bandwidth/latency context
- One section per finding with: severity, file:line, problem description, and concrete fix
- A summary table of all findings
- A prioritised quick-win list (top 3–6 items)

---

## Steps

### 1. Retrieve project context

Call `mcp__memorykit__retrieve_context` with a query describing the project stack and the audit goal.
Also read `CLAUDE.md` (project-level) to understand the tech stack, architecture, and any relevant constraints.

**Success criteria:** Stack is known (framework, API type, web server, image CDN, data-fetching library).

---

### 2. Search for 3G best practices (optional)

If the stack has unusual characteristics not covered by the checklist below, run a focused web search
(e.g. "3G performance [framework]"). Skip this step if the 8-category checklist already covers the stack.

**Success criteria:** Any stack-specific gotchas are noted.

---

### 3. Explore the codebase

Investigate each of the 8 audit categories below. For each, note the specific files and line numbers
where problems are found.

#### Category 1 — Response compression
- Read the web server config (nginx.conf, Apache .htaccess, Express middleware, etc.)
- Check for `gzip`, `brotli`, `compression` directives
- In DevTools terms: `Content-Encoding` header should be `gzip` or `br` on all text responses

**What to grep:** `gzip`, `brotli`, `compression` in infra/server config files.
**Red flags:** No compression directive. All JSON/HTML/JS/CSS crossing the wire uncompressed.

#### Category 2 — Image optimisation
- Find all image-rendering components. Check for:
  - `unoptimized` flag (Next.js) — bypasses all optimisation
  - Missing or incorrect `sizes` attribute — browser downloads oversized images
  - Missing `loading="lazy"` on off-screen images
  - Galleries/sliders that render ALL images at mount (`.map()` with no lazy loading)
  - Lightboxes that load full originals
  - Format: images should be served as WebP or AVIF, not raw JPEG/PNG
- Check framework image config (`next.config.*`) for `formats`, `deviceSizes`

**What to grep:** `unoptimized`, `<img `, `Image` components, `.map(` inside gallery components.
**Red flags:** `unoptimized` anywhere; galleries with no lazy loading; no AVIF/WebP format config.

#### Category 3 — API waterfall (sequential requests)
- Trace every `fetch(` / `axios.get(` / HTTP call in server components, page loaders, and hooks
- Draw the dependency graph: does any call depend on the result of a previous call?
- Any chain of length > 1 where parallelisation is possible is a finding

**What to grep:** `await fetch(`, `await axios`, sequential `Promise.all` chains.
**Red flags:** Round 1 → Round 2 patterns where Round 2's inputs come from Round 1's output.

#### Category 4 — Request cancellation
- Find all `fetch()` calls inside data-fetching hooks/services
- Check if an `AbortSignal` is passed via `signal:`
- Check if the query library's built-in signal is forwarded (TanStack Query, SWR both provide one)

**What to grep:** `fetch(` in service/API files; look for `signal` nearby.
**Red flags:** Any `fetch(url, { method: 'GET' })` with no `signal:` inside a query hook.

#### Category 5 — Redundant refetches / caching
- **Frontend:** Check data-fetching hooks for `staleTime`. Default of `0` means every mount refetches.
- **Backend:** Check API controllers/routes for `Cache-Control` headers on GET endpoints.
  - Stable data (listings, categories, cities) should have `max-age > 0`
  - Search endpoints often lack caching entirely

**What to grep:** `staleTime`, `Cache-Control`, `max-age`, `useQuery`, `useInfiniteQuery`.
**Red flags:** No `staleTime` on any hook; GET endpoints with no `Cache-Control`.

#### Category 6 — Hidden downloads
- Find elements rendered in the DOM with `opacity-0`, `display:none`, `visibility:hidden`, or
  off-screen CSS, that contain images or other heavy resources
- These still download even though the user cannot see them

**What to grep:** `opacity-0`, `opacity: 0`, `hidden` combined with `Image` or `img` or `src=`.
**Red flags:** Secondary/hover images always in DOM; tab panels rendering all tabs at once.

#### Category 7 — JS bundle size
- Read `next.config.*` (or equivalent) — is code splitting configured?
- Check `'use client'` usage — is it applied to components that have no interactivity?
- Grep for known heavy libraries: `moment`, `lodash` (full import), `date-fns` (full import)
- Run `npm run build` output mentally: routes over 200 KB "First Load JS" are candidates

**What to grep:** `'use client'`, `import moment`, `import _ from 'lodash'`, `import * from`.
**Red flags:** Server pages marked `'use client'` with no `useState`/`useEffect`/event handlers.

#### Category 8 — Perceived load / loading states
- Check if critical render paths have `<Suspense>` boundaries with skeleton fallbacks
- In Next.js: are there `loading.tsx` files for slow routes?
- Does a blank page appear while data loads, or does the shell render immediately?

**What to grep:** `<Suspense`, `loading.tsx`, skeleton components.
**Red flags:** Entire page `await`s all data before rendering anything; no fallback UI.

**Success criteria:** Every category has been checked. All findings have a file path and line number (or "clean" if the category passes).

---

### 4. Compile findings

Organise all findings by severity:
- **CRITICAL** — Multi-second to multi-minute delays on 3G; users will abandon
- **HIGH** — Adds 0.5–2 s of unnecessary latency or wastes significant bandwidth
- **MEDIUM** — Degrades UX noticeably on slow connections
- **LOW** — Small gains or hygiene

For each finding write:
1. Short title
2. File path and line number
3. What the problem is and why it hurts on 3G
4. Concrete fix (code snippet or config change)

Then compile:
- A summary table (ID | Severity | File | Fix Effort)
- A prioritised quick-win list (top 3–6 items, ordered by impact ÷ effort)

**Success criteria:** All findings documented. No finding is missing a file reference or a fix.

---

### 5. [human] Approval to write the audit file

Present a one-line summary of findings (e.g. "Found 2 CRITICAL, 4 HIGH, 3 MEDIUM, 2 LOW issues").
Ask explicit approval to write `docs/NETWORK_PERFORMANCE_AUDIT.md`.

**Human checkpoint:** Wait for explicit "yes" before writing any file.

---

### 6. Write the audit file

Write the full audit to `docs/NETWORK_PERFORMANCE_AUDIT.md` using this structure:

```
# Network Performance Audit — 3G / Poor-Connectivity Resilience
Date, scope, trigger

## Why This Matters
[3G bandwidth/latency context for the target market]

## Severity Key

## CRITICAL
[findings]

## HIGH
[findings]

## MEDIUM
[findings]

## LOW
[findings]

## Summary Table

## Prioritised Quick-Win Order
```

After writing the file, summarise the top 3 findings in chat so the user gets the gist without opening the file.

**Success criteria:** File written at `docs/NETWORK_PERFORMANCE_AUDIT.md`. Top 3 findings summarised in chat.
