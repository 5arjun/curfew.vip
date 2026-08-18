import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getNavAvatar } from "@/lib/account/profile";
import { NOINDEX } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { FloatingNav } from "@/app/components/nav/FloatingNav";

// Launch checklist §1.6: noindex the whole group, as defence in depth behind
// robots.ts's disallow. A robots.txt rule is a request a crawler may ignore
// and it only prevents a re-crawl — this tag is what actually removes a page
// that already reached an index.
export const metadata: Metadata = NOINDEX;

// Story 3.5 Task 5.1: a route-group layout (no URL segment) that mounts
// FloatingNav alongside every authenticated screen.
//
// Launch checklist §1.4 (2026-08-18): this layout now LOGIN-GATES the group.
// It used to say "each page self-guards" — a convention exactly one of the six
// pages followed (settings/page.tsx). The other five rendered a signed-out
// empty shell to anyone who deep-linked them. Nothing leaked (RLS), but it
// read as a broken product, and the comment was the trap: /library-utilization
// and /style-evolution looked guarded to anyone who trusted it.
//
// The gate lives HERE rather than page-by-page because a layout has no list to
// keep in sync — every page added to this group is covered the day it is
// added. That is the property the page-by-page version lacked, and it is why
// the middleware (proxy.ts) is not the right home either: route groups are
// invisible to routing, so a middleware gate needs a literal prefix list,
// which is the same maintenance burden that produced this bug. The two prefix
// lists that DO live in middleware — phone-gate and subscription-gate — are
// there because they gate a narrower, deliberately-chosen subset of paths.
//
// getClaims() over getUser(): the JWT signature is verified locally, so this
// costs no network round-trip on every authenticated render (same call, same
// reason, as lib/supabase/middleware.ts). It is a UX guard, not the security
// boundary — RLS is that, and stays that.
//
// Fails OPEN on a thrown read (no configured Supabase env in a dev checkout, a
// transient auth hiccup): the old empty shell is the floor, whereas failing
// closed would bounce a signed-in DJ to /login mid-session. Same posture as
// the phone gate, and for the same reason — the paywall is the only gate here
// that fails closed, because that one guards revenue rather than polish.
async function signedIn(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return Boolean(data?.claims?.sub);
  } catch {
    return true;
  }
}

// Story 3.10 (AC-1): the avatar is fetched HERE, on the server, and passed
// down — FloatingNav stays a dumb usePathname() client component that never
// fetches. Null (signed out / no Supabase env) keeps the nav's placeholder
// icon.
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  if (!(await signedIn())) {
    redirect("/login");
  }

  const avatar = await getNavAvatar();
  return (
    <>
      {children}
      <FloatingNav avatar={avatar} />
    </>
  );
}
