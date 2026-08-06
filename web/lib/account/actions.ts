"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PHONE_ON_FILE_COOKIE } from "@/lib/supabase/phone-gate";
import { hasRecentInboxProof } from "./recovery";

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
  // front line; the column CHECK is the last line). Counted in code points
  // to match the CHECK's char_length — a ≤40-char name with astral
  // characters (D-3 allows any) must not be rejected here.
  if (typeof name !== "string" || [...name].length > 40) {
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
 *
 * Gated on a recent inbox-proof AMR claim (code-review ruling, Arjun
 * 2026-08-05): a session alone is not enough — without this, any hijacked or
 * left-open session could set a new password without knowing the old one.
 */
export async function updatePassword(password: string): Promise<UpdatePasswordResult> {
  if (typeof password !== "string" || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  try {
    const supabase = await createClient();

    const { data: claimsData } = await supabase.auth.getClaims();
    const amr = (claimsData?.claims as { amr?: unknown } | undefined)?.amr;
    if (!hasRecentInboxProof(amr, Date.now())) {
      return { ok: false, error: "Reset link expired — request a new one." };
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { ok: false, error: "Password not changed — try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Password not changed — try again." };
  }
}

export type SignOutResult = { ok: false };

/**
 * The product's first sign-out (D-16). Confirm ceremony lives in the client
 * dialog; by the time this runs the DJ has already said yes. The redirect
 * throws (Next control flow), so it sits outside the try.
 *
 * Failure is SURFACED, not swallowed (code-review ruling, Arjun 2026-08-05):
 * landing on /login with still-valid auth cookies is a false safety signal
 * on a shared machine, and the modal's "you're still signed in" state was
 * built for exactly this return value.
 */
export async function signOut(): Promise<SignOutResult | void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false };
  } catch {
    return { ok: false };
  }
  // The phone-gate pass is this DJ's, not the browser's: clear it so the
  // next account signing in here gets re-checked (AC-19 / D-9).
  (await cookies()).delete(PHONE_ON_FILE_COOKIE);
  redirect("/login");
}
