import type { ReactNode } from "react";
import { FloatingNav } from "@/app/components/nav/FloatingNav";

// Story 3.5 Task 5.1: a route-group layout (no URL segment) that mounts
// FloatingNav alongside every authenticated screen. No auth-gating
// middleware/redirect exists yet for this group — see this story's Dev
// Agent Record for that flagged, pre-existing gap; out of scope here.
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <FloatingNav />
    </>
  );
}
