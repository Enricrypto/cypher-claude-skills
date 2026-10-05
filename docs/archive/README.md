# Archive

Historical planning documents, kept for provenance. **They describe intentions, not the
system as it exists.**

Every one of them predates the discovery that the harness had never executed: the
orchestrator's agent calls were a mock returning a hardcoded `status: 'PASS'`, the
TypeScript had never been compiled, and the test suite had never run. They also carry
performance figures ("92% faster", "$0.08 per feature") that were never measured.

Two sub-folders hold the Feature Factory's own old docs, archived in Phase B (PR B-1) because
they no longer matched the code. Each starts with a "historical — not maintained" line, and a
short pointer stays at its old path:

- [feature-docs/](feature-docs/): the five files that were in `factory/feature/docs/`
  (README, ORCHESTRATOR, QUICK_START, STAGE_GUIDE, ARCHITECTURE).
- [feature-reference/](feature-reference/): three of the files that were in
  `factory/feature/reference/` (STAGE_CONTRACTS, STATE_TRACKING, OUTPUT_SCHEMAS). The schemas and
  contracts they described are TypeScript types now.

Do not treat anything here as a description of current behaviour. For that, read:

- [../../factory/feature/SKILL.md](../../factory/feature/SKILL.md) — what the Feature Factory does, kept in line with the code by a drift test
- [../../README.md](../../README.md) — what the system is and how to run it
- [../ROADMAP.md](../ROADMAP.md) — the plan of record (Phases A–E)
- [../REFACTOR_PLAN.md](../REFACTOR_PLAN.md) — the earlier phased plan, superseded by the roadmap, kept for its history and its known bugs
