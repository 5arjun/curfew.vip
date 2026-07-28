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

Google sign-in additionally requires real provider-side app registration (a
Google Cloud Console OAuth client) and a secret — but that goes in
**`supabase/.env`** (gitignored, repo root), not `web/.env.local`. The
Supabase CLI itself, not the Next.js app, resolves `config.toml`'s `env(...)`
references from its own process environment, so that's where it looks:

- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` — Google OAuth Client Secret

**Apple is different — it cannot be configured locally at all.** Sign In with
Apple hard-requires an HTTPS Return URL; the local Auth server
(`http://127.0.0.1:54321`) can never satisfy that, so `[auth.external.apple]`
in `supabase/config.toml` stays permanently disabled. Apple is instead
configured per-environment via each Supabase project's **Dashboard**
(Authentication → Providers → Apple), not this repo — see
`supabase/generate-apple-client-secret.mjs` for generating the required
ES256 client-secret JWT from a downloaded `.p8` key (expires ~180 days,
no auto-refresh; renewal tracked in
`_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`).

Because the backend provider toggle lives outside this repo, the frontend
needs its own signal for whether to show the Apple button as clickable:

- `NEXT_PUBLIC_APPLE_SIGNIN_AVAILABLE` — set to `true` only in environments
  where the target Supabase project's Apple provider is actually enabled
  (prod: yes; local: never — leave unset/`false`). Showing the button as
  live while the backend has it disabled sends users to a raw GoTrue error
  page instead of this app's calm failure copy (2026-07-27 review finding).

See [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
and [Apple guide](https://supabase.com/docs/guides/auth/social-login/auth-apple).

Production email delivery (signup confirmation outside local dev) is wired
per-project via the Supabase dashboard, not an env var here — see
`supabase/EMAIL-PROVISIONING.md`.

## Notes

- `@curfew/shared` is consumed **from source** via `transpilePackages` — no build of
  `shared/` is required before typechecking or linting `web/`.
- The contract (`shared/`) was frozen in Story 1.10 (AR-1).
