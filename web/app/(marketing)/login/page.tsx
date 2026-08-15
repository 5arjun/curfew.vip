import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./login-client";

// /login moved into the marketing group (Arjun, 2026-08-15: "create the
// login/signup page... make the signup page very convincing"). Same URL — the
// group is invisible to routing — but the page now stands inside the marketing
// shell: the nav pill, the mesh, the display face. The auth logic is untouched
// and lives in login-client.tsx; this file exists so a client page can still
// have its own metadata.

export const metadata: Metadata = {
  title: "Curfew — start your archive",
  description:
    "One plan, everything in it: $6.99/month billed yearly, or $7.99 month to month. Create the account tonight's set will land in, or sign back in.",
};

// Dynamic on purpose (Arjun, 2026-08-15: "when i click login it goes to
// intent join"). As a static route, the client router cache keyed this page
// by pathname alone — /login and /login?intent=join shared one entry, and
// clicking the nav's "Log in" restored whichever URL variant was cached
// first, address bar and all. Awaiting searchParams makes the route dynamic,
// so the two URLs are distinct cache entries and the Log in / Join links
// actually move between them. LoginClient still reads the param itself via
// useSearchParams (and follows changes to it); nothing here consumes the
// value — the await exists for the routing semantics.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await searchParams;
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
