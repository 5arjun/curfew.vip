import { createBrowserClient } from "@supabase/ssr";

// experimental.passkey is required by Supabase for registerPasskey()/signInWithPasskey()
// to exist on the client at all (Passkeys Beta, https://supabase.com/docs/guides/auth/passkeys).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { experimental: { passkey: true } } },
  );
}
