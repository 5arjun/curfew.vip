import type { ReactNode } from "react";
import { getNavAvatar } from "@/lib/account/profile";
import { FloatingNav } from "@/app/components/nav/FloatingNav";

// Story 3.5 Task 5.1: a route-group layout (no URL segment) that mounts
// FloatingNav alongside every authenticated screen. No auth-gating
// middleware/redirect exists yet for this group — each page self-guards
// (the 3.10 phone gate covers phone-on-file, not login).
//
// Story 3.10 (AC-1): the avatar is fetched HERE, on the server, and passed
// down — FloatingNav stays a dumb usePathname() client component that never
// fetches. Null (signed out / no Supabase env) keeps the nav's placeholder
// icon.
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const avatar = await getNavAvatar();
  return (
    <>
      {children}
      <FloatingNav avatar={avatar} />
    </>
  );
}
