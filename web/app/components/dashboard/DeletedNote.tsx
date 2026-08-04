"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Story 3.7 AC-34: shows once right after a delete, then scrubs the query
// param — otherwise a shared/bookmarked link, a refresh, or a back-navigation
// back to this URL re-shows "Set deleted" with nothing having just happened.
export function DeletedNote() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    router.replace(pathname);
  }, [router, pathname]);

  return <p className="dz-deleted-note">Set deleted. Your Serato history isn&apos;t touched.</p>;
}
