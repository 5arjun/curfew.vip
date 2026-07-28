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

Google/Apple sign-in additionally require real provider-side app registration
(a Google Cloud Console OAuth client, or an Apple Developer Services ID with
Sign In with Apple enabled plus a `.p8` key used to generate a client-secret
JWT) and two more secrets — but those go in **`supabase/.env`** (gitignored,
new file, repo root), not `web/.env.local`. The Supabase CLI itself, not the
Next.js app, resolves `config.toml`'s `env(...)` references from its own
process environment, so that's where it looks:

- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` — Google OAuth Client Secret
- `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` — Apple Sign In client secret (a
  hand-generated ES256 JWT, not a static string — expires every 6 months)

See [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
and [Apple guide](https://supabase.com/docs/guides/auth/social-login/auth-apple).

Production email delivery (signup confirmation outside local dev) is wired
per-project via the Supabase dashboard, not an env var here — see
`supabase/EMAIL-PROVISIONING.md`.

## Notes

- `@curfew/shared` is consumed **from source** via `transpilePackages` — no build of
  `shared/` is required before typechecking or linting `web/`.
- The contract (`shared/`) was frozen in Story 1.10 (AR-1).
