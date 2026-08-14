import type { Metadata } from "next";
import { FaceSwitcher } from "../components/landing/FaceSwitcher";
import {
  archivo,
  bigShoulders,
  bricolageGrotesque,
  hankenGrotesk,
  instrumentSerif,
  spaceGrotesk,
  syne,
} from "../fonts";
import "../landing.css";

// Marketing route group (Story 6.1). Separate from the authenticated layout so
// the display serif and the Landing's motion budget stay on this side of the
// line — UX-DR16's "logged-in surfaces stay still" half is still in force, and
// D-2 only overrides the Landing's own restraint.

export const metadata: Metadata = {
  title: "Curfew — compared to what?",
  description:
    "Curfew reads the sets you already played and gives you the only baseline that means anything: your own.",
};

// D-4 is reopened and the challengers load in development only. In production
// the page ships exactly one display family, as it must. Hanken is in the list
// as the control — it is already loaded app-wide, so it costs nothing here.
const previewing = process.env.NODE_ENV !== "production";
const faces = previewing
  ? [archivo, spaceGrotesk, syne, bricolageGrotesque, bigShoulders, hankenGrotesk]
      .map((font) => font.variable)
      .join(" ")
  : "";

// data-face is set server-side so the incumbent is what paints first even in
// development — the switcher only ever replaces a value that is already there.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${instrumentSerif.variable} ${faces} lp-root`} data-face="instrument">
      {children}
      {previewing && <FaceSwitcher />}
    </div>
  );
}
