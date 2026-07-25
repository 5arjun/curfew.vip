# @curfew/shared — the sync contract

The single **agent ↔ cloud** seam (AD-3). The cloud ingests **only** the derived,
per-set payload defined here; raw Serato library/session data never crosses this line.

> ✅ **FROZEN — additive-only forever.** Story 1.10 froze this shape after the
> parser-validation spike (Story 1.2) and the stat-engine (Story 1.7) / confidence
> signal (Story 1.8) it is derived from. Every future change must be additive-only
> (AD-15) — see "Adding a field after freeze" below.

## Two consumers, one contract

| Consumer | Imports | How |
|----------|---------|-----|
| `web/` (TypeScript) | the payload **types** | `import type { SyncPayload } from "@curfew/shared"` |
| `agent/` (Rust) | the **JSON-schema** | reads `schema/sync-payload.schema.json` (Rust cannot import a TS type) |

The two representations MUST stay consistent. [`src/index.test.ts`](src/index.test.ts)
guards the TS ↔ JSON-schema enum/version/shape parity; a Rust test in `agent/` parses the
same schema file to prove the seam.

## Contents

- [`src/index.ts`](src/index.ts) — `SyncPayload` (+ `SyncPlay`, `SyncSetDerived`) + the
  AR-15 fixed enums (`Visibility`, `SegmentType`, `Source`) + `CONTRACT_VERSION`.
- [`schema/sync-payload.schema.json`](schema/sync-payload.schema.json) — the
  language-neutral mirror the Rust agent consumes.
- [`schema/sync-payload.schema.frozen-baseline.json`](schema/sync-payload.schema.frozen-baseline.json) —
  a byte-for-byte snapshot of the schema as it stood at the moment of freeze (Story
  1.10). Never hand-edited after this story merges; it exists only as the regression
  baseline [`src/additive-only.test.ts`](src/additive-only.test.ts) diffs the current
  schema against.

## Adding a field after freeze

New fields are always **optional** (or nullable, but present) — never added to a
`$defs` object's `required` array unless the story explicitly re-derives every
already-synced historical payload (out of scope for any Epic 1/2/3 story today).
This is the mechanical rule [`src/additive-only.test.ts`](src/additive-only.test.ts)
enforces in CI: every property and every `required` entry present in the frozen
baseline must still be present, with a compatible type, in the current schema. New
properties not in the baseline pass freely — that's what "additive" means. Removing,
renaming, or re-typing an existing required field fails CI with a message pointing at
AD-15.

## `agent_version` acceptance policy

`agent_version` (semver) is a required field on every payload. AR-1's policy: contract
evolution is additive-only, and the cloud must accept the last **N** `agent_version`s —
**N is not yet chosen**, since no cloud exists yet to enforce a window against. This is
a placeholder for whichever Epic 2/3 story implements the sync-ingestion endpoint.
AD-13's backfill mechanism (raw data retained locally, re-synced after a fix ships) is
the safety net if an old agent version is ever rejected.

## Scripts

```bash
pnpm --filter @curfew/shared build      # tsc -> dist/
pnpm --filter @curfew/shared typecheck  # tsc --noEmit
pnpm --filter @curfew/shared test       # vitest (contract parity + additive-only guard)
```
