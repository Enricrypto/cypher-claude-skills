# STATE_TRACKING.md (moved)

This document was out of date. It is archived, unmaintained, at [docs/archive/feature-reference/STATE_TRACKING.md](../../../docs/archive/feature-reference/STATE_TRACKING.md).

How the Feature Factory behaves: [SKILL.md](../SKILL.md). How to run it: [README.md](../../../README.md).

The run record and its lifecycle are code: [state-tracker.ts](../../harness/state-tracker.ts) (the `FeatureState` type and its recorders), [state-store.ts](../../harness/state-store.ts) (how `state.json` is saved and loaded) and [run-lifecycle.ts](../../harness/run-lifecycle.ts) (run classes, resume and refusals).
