# @curfew/shared — the sync contract

The single **agent ↔ cloud** seam (AD-3). The cloud ingests **only** the derived,
per-set payload defined here; raw Serato library/session data never crosses this line.

> ⚠️ **DRAFT — NOT FROZEN.** Everything here is provisional until **Story 1.10**.
> The parser-validation spike (Story 1.2) will reshape it. After 1.10 the contract
> freezes and becomes **additive-only, forever** (AD-15).

## Two consumers, one contract

| Consumer | Imports | How |
|----------|---------|-----|
| `web/` (TypeScript) | the payload **types** | `import type { SyncPayloadDraft } from "@curfew/shared"` |
| `agent/` (Rust) | the **JSON-schema** | reads `schema/sync-payload.schema.json` (Rust cannot import a TS type) |

The two representations MUST stay consistent. [`src/index.test.ts`](src/index.test.ts)
guards the TS ↔ JSON-schema enum/version parity; a Rust test in `agent/` parses the
same schema file to prove the seam.

## Contents

- [`src/index.ts`](src/index.ts) — `SyncPayloadDraft` + the AR-15 fixed enums
  (`Visibility`, `SegmentType`, `Source`) + `CONTRACT_VERSION`.
- [`schema/sync-payload.schema.json`](schema/sync-payload.schema.json) — the
  language-neutral mirror the Rust agent consumes.

## Scripts

```bash
pnpm --filter @curfew/shared build      # tsc -> dist/
pnpm --filter @curfew/shared typecheck  # tsc --noEmit
pnpm --filter @curfew/shared test       # vitest (contract parity)
```
