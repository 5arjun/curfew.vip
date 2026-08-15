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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
