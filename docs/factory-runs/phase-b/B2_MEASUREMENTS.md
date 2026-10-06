# B2_MEASUREMENTS.md: PR B-2 probes, live smoke and measurements

> Run by the orchestrating session, operator-approved, 2026-10-05.

## S-0: probes (scratch folder in the session scratchpad, never the repo; deleted afterwards)

**Environment:** git 2.39.5 (Apple Git-154), macOS 15.7.9, APFS. Jest is the repo's own binary.

### 1. Does Jest collect tests inside a `.factory/` dot-directory? (I-2 evidence)

**Setup:** `test/a.test.js`, `.factory/run-1/copy/test/b.test.js`, and a `jest.config.js` with this repo's `testMatch` shape (`**/test/**/*.test.js`). The repo uses `**/test/**/*.test.ts`.

**Result:** `jest --listTests` lists **both** `test/a.test.js` and `.factory/run-1/copy/test/b.test.js`.

So a review copy under `.factory/<id>/` would be collected:
- by Gate 2;
- by the Test Verifier's own runs;
- by the operator's `npm test`;
- in every later run too, since archived runs stay under `.factory/_archive/`.

**I-2 (copy in `os.tmpdir()`) is confirmed.** (The first attempt failed only because the scratch folder had no Jest config, so it was re-run with one.)

### 2. Does ripgrep see files inside a gitignored `.factory/`?

**Setup:** `git init`, with `.factory/` in `.gitignore`.

| Run from | `rg` finds `b.test.js`? |
|---|---|
| inside `.factory/run-1/copy/` (the copy as working directory) | **yes** (exit 0) |
| the project root | no (exit 1) |

**Correction to brief §0.9 / D-3:** the claim that "the Validator could not search its copy" holds only when searching from the project root. With the copy as the working directory, which is the B-2 design (D-4), `rg` finds files. **I-2 still stands on the Jest evidence alone.**

### 3. Does `git cat-file --batch` return raw blob bytes via stdin?

**Result:** yes. Fed one oid on stdin, it returned `<oid> blob 17` followed by the raw bytes. D-1's extraction mechanism works on git 2.39.5.

### 4. Suite-time baseline (branch `feat/phase-b2-verification`, no code changes yet)

| Run | Wall clock (s) | Jest Time (s) | Tests |
|---|---|---|---|
| S-0 baseline | 94 | 92.6 | 1294 passed + 1 skipped (1295) |

(B-1's final re-measure was 82 s durable. Machine load varies by about ±10 s.)

## S-1: live smoke of the copy-based Validator (2026-10-06 08:07, operator-approved)

- **Run:** `npx ts-node factory/runner/smoke-validator.ts --cwd /private/tmp/ff-smoke-validator-b2`, in a fresh empty folder outside the repo. Exit 0, 154 s wall clock.
- **Review copy:** `/private/var/folders/.../T/factory-review-smoke-validator-e1-JhgE4p` (3 entries), sealed read-only and used as the Validator's working directory. It is left in the temp folder by design.
- **07-validator:** 15 turns, $1.4175, claude-opus-5 at high effort, read-only. Status PASS.

| Check | Result |
|---|---|
| P1 structured output | PASS (150.5 s) |
| P2 output schema | PASS |
| P3 security checks | PASS (auth, SQL and XSS not_applicable; input validated; no hardcoded secrets) |
| P4 not_applicable needs a reason | PASS |
| P5 no blocker | PASS |
| **P6 every issue file maps under the copy, and no tool was denied** | **PASS** (3 issue files, 0 denials) |

**Result:** the real SDK honours a per-call working directory outside the project. Read, Grep and Glob worked inside the sealed copy, and the Validator stated that it read exactly the copy's three files. This closes the S-1 risk in the brief's §8.

## S-2: final checks (2026-10-06)

- **Typecheck:** clean.
- **Full suite after step 8b:** 1678 passed + 1 skipped (1679), 120.8 s Jest, 122 s wall clock.
- **After the one-line 08 contract wording fix:** typecheck and the contracts + runner suites green.
- **Suite time:** 94 s at the S-0 baseline, now about 120 s (single runs; machine load varies about ±20 s). The growth comes from about +384 tests, many with real git or real processes.
- **Hidden characters:** none in any changed file.
