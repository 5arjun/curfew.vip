import Link from "next/link";

// The marketing pages' one footer. Before this existed, three near-identical
// inline <footer> blocks (landing close, /features close, /faq close) each
// rendered "Privacy · Terms" as inert <span>s — a promise of pages that
// didn't exist. Now the pages exist and the footer is shared, so the link
// set can only ever drift in one place.
export function MarketingFooter({ className }: { className?: string }) {
  return (
    <footer className={["lp-footer", className].filter(Boolean).join(" ")}>
      <span>Curfew</span>
      <nav className="lp-footer-nav" aria-label="Site">
        <Link href="/features">Features</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  );
}
