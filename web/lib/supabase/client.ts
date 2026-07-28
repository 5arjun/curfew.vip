import { createBrowserClient } from "@supabase/ssr";

// experimental.passkey is required by Supabase for registerPasskey()/signInWithPasskey()
// to exist on the client at all (Passkeys Beta, https://supabase.com/docs/guides/auth/passkeys).
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — see web/README.md#Environment",
    );
  }

  return createBrowserClient(supabaseUrl, supabaseKey, {
    auth: { experimental: { passkey: true } },
  });
}
