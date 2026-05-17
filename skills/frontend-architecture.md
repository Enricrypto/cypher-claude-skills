---
name: frontend-architecture
description: |
  Project-agnostic frontend architecture reference for React Native (Expo) and Next.js projects.
  Defines the 4-layer model, 6 rules, data flow patterns, file naming conventions, and a
  "where does this go?" decision checklist. Use when starting a new project, adding a feature,
  or reviewing whether code belongs in the right layer.
when_to_use: |
  - Starting a new React Native or Next.js project and need to set up the folder structure
  - Adding a new feature and unsure where the code belongs
  - Reviewing a PR and something feels like it's in the wrong place
  - Onboarding a collaborator and need to explain the architecture
  - Refactoring an existing codebase toward layered architecture
allowed-tools:
  - Read
  - Bash
---

# Frontend Architecture — 4-Layer Model

## Mental Model

```
┌─────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                             │
│  Screens / Pages / UI Components / Design System               │
│  "What the user sees and touches"                               │
├─────────────────────────────────────────────────────────────────┤
│  APPLICATION LAYER                                              │
│  Use-Case Hooks / Business Logic / State Orchestration          │
│  "What happens when the user does something"                    │
├─────────────────────────────────────────────────────────────────┤
│  DOMAIN LAYER                                                   │
│  Entities / Value Objects / Validation Rules / Use Cases        │
│  "The rules of the business, independent of any framework"      │
├─────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER                                           │
│  API Clients / State Management / External Services / Storage   │
│  "How the app talks to the outside world"                       │
└─────────────────────────────────────────────────────────────────┘

Dependency rule: arrows point INWARD only.
Presentation → Application → Domain ← Infrastructure
No layer imports from a layer above it.
```

---

## Layer Definitions

### Presentation Layer

**React Native (Expo):** `app/`, `components/`
**Next.js:** `app/` or `pages/`, `components/`

**What belongs here:**
- Screen/page files — layout skeleton + event wiring only
- Pure UI components — receive props, emit callbacks, no server state
- Design system tokens — colors, spacing, typography constants

**What does NOT belong here:**
- `useState` for business data (form fields, API state, step navigation)
- `async` functions that call APIs
- Validation logic
- Permission checks based on user role

**Size budget:** Screens <200 lines. Components <300 lines.

**Rule:** A screen file should be readable in 30 seconds. If you can't understand what it renders
by scanning the JSX, it has too much logic.

---

### Application Layer

**React Native (Expo):** `hooks/use-cases/`
**Next.js:** `hooks/` or `lib/use-cases/`

**What belongs here:**
- Use-case hooks — one hook per user flow (`useCreateListingFlow`, `useCheckoutFlow`)
- Form state consolidated into one place per form
- Step navigation for multi-step flows
- Orchestration: calls domain to validate, calls infrastructure to persist
- Action handlers extracted from screens (`handleSubmit`, `handlePhotoUpload`)

**Naming convention:**
- `use[Concept]Flow` — multi-step form or wizard (`useCreateListingFlow`)
- `use[Concept]Actions` — action handlers on a detail screen (`useListingDetailActions`)
- `use[Concept]Calc` — calculator or derived state (`useCommissionCalc`)

**Size budget:** Use-case hooks <250 lines.

**Rule:** The hook orchestrates. It does not contain business rules. If you're writing
"commission must be between 0-10%" inside a hook, that belongs in the domain layer.

---

### Domain Layer

**All stacks:** `domain/`

**What belongs here:**
- Entities — objects with identity and behavior (`ListingDraft`, `PurchaseOffer`)
- Value Objects — immutable, validated, defined by attributes (`Price`, `Email`, `Commission`)
- Validation rules — expressed as methods returning `ValidationResult`
- Business logic — rules that are true regardless of framework or UI

**What does NOT belong here:**
- React imports
- Expo imports
- Service/API calls
- Store references
- Any framework dependency

**Structure:**
```
domain/
├── [concept]/
│   ├── [concept].entity.ts
│   └── [concept].value-object.ts
└── shared/
    ├── validation-result.ts
    └── [shared-value-objects].ts
```

**The test signal:** Every file in `domain/` must be testable with plain Jest — no mocks,
no React test renderer, no fetch mocking. If you need to mock something to test domain code,
the domain has a dependency it shouldn't have.

---

### Infrastructure Layer

**React Native (Expo):** `services/`, `store/`, `hooks/` (React Query wrappers)
**Next.js:** `lib/api/`, `lib/db/`, `store/`, `hooks/` (React Query or SWR wrappers)

**What belongs here:**
- API clients — thin wrappers around HTTP calls (`listingService`, `authService`)
- State management — Zustand stores, Redux slices (auth state, UI state, cache)
- React Query / SWR hooks — data fetching with cache invalidation
- External service adapters — push notifications, analytics, file storage

**Rule:** Services are thin. A service method should be 3-10 lines: build params, call API,
return typed result. No business logic, no validation, no conditional branching beyond
dev fixture gating.

```typescript
// Correct — thin service
async create(input: CreateListingInput): Promise<Listing> {
  return apiPost<Listing>('/listings', input);
}

// Wrong — business logic in service
async create(input: CreateListingInput): Promise<Listing> {
  if (input.commission > 10) throw new Error('Commission too high'); // ← belongs in domain
  return apiPost<Listing>('/listings', input);
}
```

---

## The 6 Rules

### Rule 1 — Dependency Direction
```
Screens (app/)       →  hooks/use-cases/  →  domain/
                                           →  services/
Components           →  hooks/            →  domain/
                                           →  services/

No layer imports from a layer above it. Ever.
```
Enforcement: ESLint `import/no-restricted-paths`

---

### Rule 2 — File Size Budget
```
Screens / Pages          <200 lines    (hard error at 500)
Components               <300 lines    (hard error at 500)
Use-case hooks           <250 lines
Service files            <150 lines
Domain entities          <200 lines
```
Enforcement: ESLint `max-lines` (warn: 300, error: 500)

---

### Rule 3 — Screens Wire, They Don't Think
```
A screen MAY:       import hooks, render components, wire callbacks
A screen MAY NOT:   useState for business data, async API calls,
                    validation logic, StyleSheet > 5 rules
```
Signal: If you see `useState` in a screen file, ask "does this belong in a use-case hook?"

---

### Rule 4 — Domain Has Zero Dependencies
```
domain/ imports:    other domain/ files, TypeScript built-ins
domain/ never:      React, Expo, Next.js, services, store, hooks
```
Signal: `npm test domain/` should pass with zero mocks.

---

### Rule 5 — Components Are Props-In / Events-Out
```
Components receive:    data props, callback props
Components never:      useQuery, useMutation, service calls,
                       useState for server-affecting data
```
Exception: Provider wrapper components (`QueryClientProvider`, `ThemeProvider`) are exempt.

---

### Rule 6 — One Entity, One Concern
```
If naming a file requires "And"  →  split it
ListingAndOfferActions.tsx       →  ListingActions.tsx + OfferActions.tsx
```

---

## Data Flow: A User Action End-to-End

```
User taps "Submit"
        │
        ▼  PRESENTATION
   Screen / Page
   const { handlers, status } = useCheckoutFlow()
   <Button onPress={handlers.submit} loading={status.isSubmitting} />
        │  handlers.submit()
        ▼  APPLICATION
   useCheckoutFlow (use-case hook)
     1. const order = Order.create(form.values)       ← domain
     2. const result = order.validate()               ← domain
     3. if (!result.isValid) setErrors(result.errors) ← stays in hook
     4. await createOrderMutation.mutateAsync(         ← infrastructure
          order.toApiPayload()
        )
     5. router.push('/confirmation')
        │                    │
        ▼  DOMAIN            ▼  INFRASTRUCTURE
   Order.validate()      hooks/useOrders → React Query mutation
     checks items           → orderService.create(payload)
     checks totals              → apiPost('/orders', payload)
     checks stock           → cache invalidation
     → ValidationResult
```

**Change price validation?** → Edit `Order.validate()` only.
**Change API endpoint?** → Edit `orderService` only.
**Change button label?** → Edit the component only.
**Change navigation after submit?** → Edit the use-case hook only.

---

## File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| Domain entity | `[concept].entity.ts` | `listing-draft.entity.ts` |
| Domain value object | `[concept].value-object.ts` | `commission.value-object.ts` |
| Domain shared | `[concept].ts` | `validation-result.ts` |
| Use-case hook (flow) | `use[Concept]Flow.ts` | `useCreateListingFlow.ts` |
| Use-case hook (actions) | `use[Concept]Actions.ts` | `useListingDetailActions.ts` |
| Use-case hook (calc) | `use[Concept]Calc.ts` | `useCommissionCalc.ts` |
| Service | `[concept].service.ts` | `listing.service.ts` |
| Store | `[concept]Store.ts` | `authStore.ts` |
| Screen/page component | `[Concept].tsx` or Expo Router filename | `new.tsx`, `[id].tsx` |
| UI sub-component | `[Concept][Role].tsx` | `OfferAmountInput.tsx` |
| Co-located styles (rare) | `[Component].styles.ts` | `PurchaseOfferModal.styles.ts` |

---

## "Where Does This Go?" Decision Checklist

When adding code, run through this tree:

```
Is it a business rule?
  (e.g. "commission must be 0-10%", "price must be positive")
    → domain/    [entity or value object method]

Is it orchestration?
  (e.g. "validate, then call API, then navigate")
    → hooks/use-cases/    [use-case hook]

Is it a server interaction?
  (e.g. HTTP call, WebSocket, file upload)
    → services/    [service method]

Is it cached/shared client state?
  (e.g. auth user, notification count, dark mode preference)
    → store/    [Zustand slice]

Is it a data fetch with caching?
  (e.g. listing feed, user profile)
    → hooks/    [React Query hook wrapping a service]

Is it layout or UI?
  (e.g. what to render, how it looks)
    → components/    [pure component with props]

Is it the entry point for a user-facing route?
  (e.g. the screen itself)
    → app/    [screen — thin, wires hooks to components]
```

---

## Stack-Specific Notes

### React Native + Expo Router

```
app/                    Screens (Expo Router file-based routing)
  (auth)/               Auth stack
  (tabs)/               Main tab navigator
  (modals)/             Modal screens
components/             Pure UI components, grouped by domain
  ui/                   Design system atoms (Button, Input, Toast)
  [domain]/             Domain-specific components (listing/, profile/)
hooks/                  React Query wrappers + utility hooks
  use-cases/            Application layer hooks
domain/                 Business entities and rules
services/               API clients
store/                  Zustand stores
types/                  TypeScript types (pure shapes, no behavior)
utils/                  Pure utility functions
constants/              Design tokens, enums, static data
```

Styles: Prefer NativeWind (Tailwind) classes. Use `StyleSheet.create` in a co-located
`[Component].styles.ts` only when styles depend on runtime JS values (e.g. computed dimensions).
Never embed `makeStyles` functions inside screen files.

### Next.js (App Router)

```
app/                    Pages and layouts (Next.js App Router)
components/             Pure UI components
  ui/                   Design system atoms
  [domain]/             Domain-specific components
hooks/                  React Query / SWR wrappers + utility hooks
  use-cases/            Application layer hooks
domain/                 Business entities and rules
lib/
  api/                  API clients (server actions or fetch wrappers)
  db/                   Database access (Prisma, Drizzle)
store/                  Zustand or Jotai (client state only)
types/                  TypeScript types
utils/                  Pure utility functions
```

---

## ESLint Setup (enforce the rules)

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // File size budget
    'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],

    // Domain isolation
    'import/no-restricted-paths': ['error', {
      zones: [
        { target: './domain', from: './hooks',      message: 'Domain cannot import hooks.' },
        { target: './domain', from: './services',   message: 'Domain cannot import services.' },
        { target: './domain', from: './store',      message: 'Domain cannot import store.' },
        { target: './domain', from: './app',        message: 'Domain cannot import screens.' },
        { target: './domain', from: './components', message: 'Domain cannot import components.' },
      ],
    }],
  },
};
```

Install: `npm install --save-dev eslint eslint-plugin-import @typescript-eslint/eslint-plugin`

---

## Anti-Patterns to Flag in Code Review

| What you see | What it means | Fix |
|---|---|---|
| `useState` in a screen for form fields | Presentation layer doing Application work | Extract to use-case hook |
| `useQuery` inside a component | Component doing Infrastructure work | Move to parent hook, pass as props |
| Validation logic inside a service | Infrastructure doing Domain work | Move to domain entity |
| `if (commission > 10)` in a hook | Application layer containing Domain rules | Move to value object |
| 500+ line screen file | All layers collapsed into one file | Phase split: domain → hook → JSX decomposition |
| `makeStyles` at bottom of screen | Style layer mixed with logic layer | Extract to NativeWind or `.styles.ts` |
| Component with `useRouter` inside | Component doing navigation (app concern) | Pass navigation callback as prop |
