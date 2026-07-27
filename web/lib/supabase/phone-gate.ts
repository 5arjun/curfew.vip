import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by auth/callback/route.ts (OAuth) and auth/confirm/route.ts
// (email+password) — both gate their "account becomes usable" redirect on
// whether this DJ has a phone on file yet (Story 2.3c AC-1). Errors are
// swallowed and treated as "no phone needed" — the least-blocking path
// (Task 5.4); callers still don't need their own extra try/catch around
// this call as a result.
export async function needsPhone(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("djs")
      .select("phone")
      .eq("id", userId)
      .single();

    if (error || !data) return false;
    return !data.phone;
  } catch {
    return false;
  }
}
