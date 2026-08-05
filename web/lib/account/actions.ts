"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server actions for the Settings screen (Story 3.10). Every mutation the
// screen can perform lives here: the DJ-name autosave (AC-16), the
// password-reset email (AC-8), the new-password set (AC-8), and the
// product's first sign-out (AC-17).

/**
 * Discriminated result for the autosave row: `ok: false` covers network
 * drop, expired session, and RLS rejection identically — the client renders
 * one line for all of them ("Change not saved — retry.", D-15) and never
 * reverts the typed value.
 */
export type UpdateDjNameResult = { ok: true } | { ok: false };

export async function updateDjName(name: string): Promise<UpdateDjNameResult> {
  // Server-side backstop for D-3's ≤40 rule (the input's maxLength is the
  // front line; the column CHECK is the last line).
  if (typeof name !== "string" || name.length > 40) {
    return { ok: false };
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { ok: false };

    // Optional field (D-3): clearing the input stores null, not "".
    const value = name.trim() === "" ? null : name;

    // .select("id") makes a zero-row update (RLS-filtered, or no djs row)
    // distinguishable from success — same pattern as /phone-required's
    // setPhone action.
    const { data: updated, error } = await supabase
      .from("djs")
      .update({ dj_name: value })
      .eq("id", data.user.id)
      .select("id");

    return !error && (updated?.length ?? 0) > 0 ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type PasswordResetRequestResult = { ok: true } | { ok: false };

/**
 * Emails the signed-in DJ a recovery link (D-5). The email is derived from
 * the session, never a parameter — Settings only ever resets the DJ's own
 * password. The link lands on `/auth/reset` (a route handler, which unlike a
 * server component can persist the exchanged session cookie), which forwards
 * to `/reset-password` where the new password is actually set — the minimal
 * COMPLETE flow, per the story's ruling; a button that mails a link landing
 * nowhere is explicitly rejected.
 */
export async function sendPasswordReset(): Promise<PasswordResetRequestResult> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    if (!email) return { ok: false };

    // Same origin derivation as login/actions.ts: server actions run as
    // same-origin POSTs, so the browser-sent Origin header is the real host.
    const origin = (await headers()).get("origin") ?? "http://localhost:3000";

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/reset`,
    });
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}

export type UpdatePasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Sets the new password for the recovery session `/auth/reset` established.
 * Minimum length mirrors the signup form's own floor (6).
 */
export async function updatePassword(password: string): Promise<UpdatePasswordResult> {
  if (typeof password !== "string" || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { ok: false, error: "Password not changed — try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Password not changed — try again." };
  }
}

/**
 * The product's first sign-out (D-16). Confirm ceremony lives in the client
 * dialog; by the time this runs the DJ has already said yes. The redirect
 * throws (Next control flow), so it sits outside the catch.
 */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // A failed server-side sign-out still redirects: the client's cookies
    // are cleared by signOut() when it succeeds, and landing on /login is
    // the honest destination either way — retrying from there is calmer
    // than stranding the DJ on a half-signed-out Settings page.
  }
  redirect("/login");
}
