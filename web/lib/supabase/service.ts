import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The service-role client (Story 7.3, AD-18). Mirrors `lib/billing/stripe.ts`'s
// discipline — one lazy factory, imported everywhere, never `createClient(...)`
// inline at a call site. Deliberately `@supabase/supabase-js`, not
// `@supabase/ssr`: its callers make server-to-server calls with no browser and
// no cookies, and there is no DJ session on it to refresh or persist.
//
// Never `.from("djs")...` or any other table read/write with it — the whole
// point of AD-18's scoped-function design is that the elevated key never
// touches a raw table statement. That prohibition is unchanged and absolute.
//
// Two sanctioned uses, not one (this said "ONLY ... `apply_subscription_event`"
// until 2026-08-20):
//
//   1. `apply_subscription_event` via `.rpc(...)` — Story 7.3's Stripe webhook.
//   2. `auth.admin.generateLink(...)` — `app/api/agent/session/route.ts`, which
//      mints the desktop agent its own Supabase session so it stops sharing a
//      refresh-token rotation family with the browser.
//
// (2) is widening the list deliberately rather than quietly. It respects
// AD-18's actual rule: `auth.admin` is GoTrue's own API, not a raw statement
// against a `public` table, so the elevated key still never issues one — which
// is also why the `Database` type below stays empty of `Tables`/`Views` and
// why it needed no entry to type-check.

// This project has no generated Database types (every other Supabase call
// site types selects inline instead, e.g. `.maybeSingle<{...}>()`). `.rpc()`
// has no equivalent inline escape hatch — without a `Functions` entry, its
// generics collapse to `never`/`undefined` and no args object type-checks.
// This is the minimal Database shape that unblocks just the one RPC this
// client is allowed to call; it intentionally declares no `Tables`/`Views`
// entries, so a `.from(...)` call on this client would still have no typed
// columns to work with.
type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      apply_subscription_event: {
        Args: {
          dj_id: string;
          status: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          current_period_end: string;
          event_created_at: string;
        };
        Returns: undefined;
      };
    };
  };
};

let client: SupabaseClient<Database> | null = null;

function resolveSecretKey(env: {
  SUPABASE_SECRET_KEY?: string;
  [key: string]: string | undefined;
}): string {
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SECRET_KEY, see web/README.md#Environment");
  }
  return key;
}

// Lazily constructed, same build-time-safety reasoning as `getStripe()`: a
// module-level client would throw at `next build` in any environment without
// the key, since the route's module graph is loaded during the build.
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL, see web/README.md#Environment");
  }

  client = createClient<Database>(supabaseUrl, resolveSecretKey(process.env), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
