import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Same experimental.passkey flag as the browser client (client.ts) for
// consistency, even though passkey ceremonies only run in the browser in
// practice — keeps both clients configured identically.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { experimental: { passkey: true } },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session instead, so this can be safely ignored there.
          }
        },
      },
    },
  );
}
