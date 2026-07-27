# web — Curfew cloud app (Next.js 16)

The Vercel-deployed cloud surface for Curfew. Renders shared DJ-set reflections and
consumes the versioned sync contract from `@curfew/shared`. This is **not** the
Tauri-hosted agent frontend — it keeps default SSR/ISR output (no `output: 'export'`).

## Develop

From the repo root (pnpm workspace, frozen lockfile):

```bash
pnpm install --frozen-lockfile   # or `pnpm bootstrap` from the root for all workspaces
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `pnpm --filter web lint` — ESLint
- `pnpm --filter web typecheck` — `tsc --noEmit`
- `pnpm --filter web build` — production build
- `pnpm --filter web test` — Vitest

## Environment

Auth (`/login`) needs local Supabase running first — `supabase start` from the repo root.
Then create `web/.env.local` (gitignored) with the two vars from `supabase status`:

- `NEXT_PUBLIC_SUPABASE_URL` — local API URL (`http://127.0.0.1:54321`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — `supabase status`'s `PUBLISHABLE_KEY`
  (older CLI versions may still label this "anon key" — same value)

## Notes

- `@curfew/shared` is consumed **from source** via `transpilePackages` — no build of
  `shared/` is required before typechecking or linting `web/`.
- The contract (`shared/`) was frozen in Story 1.10 (AR-1).
