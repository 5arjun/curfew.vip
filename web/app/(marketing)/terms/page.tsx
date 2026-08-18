import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalList, LegalP } from "@/app/components/landing/LegalDoc";
import { pageMetadata } from "@/lib/seo";

// /terms — the agreement, written the way the FAQ talks: plain words, short
// sections, nothing doing the real talking in a footnote. Grounded in what
// the product actually does today: one plan at the two advertised rates,
// sets private by default, export/deletion on request through
// support@curfew.vip (the ACCOUNT-DELETION-EXPORT-RUNBOOK is the operator
// side of that promise).
//
// Reviewed 2026-08-18 — docs/legal-review-2026-08-18.md, which closes the
// launch checklist's §1.7 and supersedes the "pre-launch legal review still
// owed" note that stood here. Two things it found are still open by ruling,
// and both are ruled rather than forgotten:
//
//   • No governing-law clause (finding B). The draft section is ready to
//     paste in the review doc; it needs one fact this repo doesn't hold —
//     which state — and a clause naming the wrong one is worse than none.
//   • No legal entity behind "Curfew" (accepted risk, launch-checklist §3).
//     "What Curfew promises" caps liability for a party with no corporate
//     shield: the cap still binds the customer, there is just nothing
//     standing between a judgment and personal assets.
//
// ⚠️ "Your account" says that giving Curfew your number agrees you to
// marketing texts. The phone-collection screen never asks for that, and
// nothing in this repo sends one. Before the first marketing message,
// (onboarding)/phone-required has to collect real TCPA consent — separate
// opt-in, not bundled into these terms. Finding A; launch-checklist §5.

export const metadata: Metadata = pageMetadata({
  title: "Curfew — terms of service",
  description:
    "The agreement between you and Curfew, in plain words: one plan, your sets stay yours, cancel whenever.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalDoc
      eyebrow="Terms of service"
      title="The agreement."
      sub="What you're agreeing to when you use Curfew, in plain words. The short version is
        first, and the long version says the same things."
      updated="Effective August 16, 2026"
      sections={[
        {
          id: "short-version",
          title: "The short version",
          body: (
            <>
              <LegalList
                items={[
                  "One plan: $6.99 a month billed yearly, or $7.99 month to month. Cancel whenever.",
                  "Your sets are yours. Curfew stores and processes them only to run your archive.",
                  "The agent is licensed to you, not sold — install it on the machines you play from.",
                  "Don't abuse the service. Accounts that do can be suspended.",
                  "Curfew is provided as-is, and its estimates are estimates.",
                ]}
              />
              <LegalP>
                Everything below expands on those five lines. If anything reads two ways, write to{" "}
                <a href="mailto:support@curfew.vip">support@curfew.vip</a> and a person will say
                which way it means.
              </LegalP>
            </>
          ),
        },
        {
          id: "the-service",
          title: "What Curfew is",
          body: (
            <>
              <LegalP>
                Curfew is an archive of your DJ sets that builds itself: a small desktop app — the
                Curfew agent — reads Serato on your laptop, and the web dashboard shows every night
                you play from the day you join onward. These terms cover both, plus everything else
                under curfew.vip.
              </LegalP>
              <LegalP>
                Your archive starts at signup. Nights from before Curfew are not imported, and
                Curfew never reads or uploads your music files — what it keeps is the record of the
                set: titles, times, keys, BPMs, and the stats built from them.
              </LegalP>
            </>
          ),
        },
        {
          id: "your-account",
          title: "Your account",
          body: (
            <>
              <LegalP>
                An account is one DJ. Keep the email and phone number on it real — they are how
                Curfew reaches you if your archive needs attention — and keep your sign-in to
                yourself. What happens under your account is yours to answer for, so tell us
                straight away if you think someone else has gotten in.
              </LegalP>
              <LegalP>
                By giving Curfew that email and number you agree Curfew can contact you at both:
                account mail, and messages about the product itself — new features, offers. The
                second kind you can stop any time, by the means the{" "}
                <Link href="/privacy">privacy policy</Link> sets out. Message rates from your
                carrier are yours.
              </LegalP>
              <LegalP>You need to be at least 16 to hold an account.</LegalP>
            </>
          ),
        },
        {
          id: "the-plan",
          title: "The plan",
          body: (
            <>
              <LegalP>
                One plan, everything in it: $6.99 a month billed yearly, or $7.99 month to month.
                The plan renews on its own until you cancel. Prices can change, but never mid-term
                and never silently — you get notice by email first, and the new price only applies
                from your next renewal.
              </LegalP>
              <LegalP>
                Cancel whenever. Your plan runs to the end of the period you paid for, then simply
                stops — no wind-down call, no exit fee. Your data stays yours either way: export or
                deletion, on request, exactly as the <Link href="/privacy">privacy policy</Link>{" "}
                describes. If a charge ever looks wrong, write to us and we will sort it out.
              </LegalP>
            </>
          ),
        },
        {
          id: "the-agent",
          title: "The agent",
          body: (
            <>
              <LegalP>
                The Curfew agent is licensed to you for as long as you have an account: install it
                on the machines you play from and use it with the service. That license is the
                whole grant — don&rsquo;t redistribute the agent, resell it, or try to take it
                apart, except where the law says that last part can&rsquo;t be waived.
              </LegalP>
              <LegalP>
                The agent updates itself so the archive keeps working as Serato moves. Its local
                database lives on your laptop and leaves with the app.
              </LegalP>
            </>
          ),
        },
        {
          id: "your-data",
          title: "Your sets are yours",
          body: (
            <>
              <LegalP>
                The record of every set you play belongs to you. Curfew takes only the license it
                needs to run the service: to store your sets, compute your stats, and show them
                back to you. Sets are private to your account — no public profiles, no feed, and
                Curfew never sells your data or hands it to advertisers. How Curfew itself contacts
                you, and how to stop it, is in the <Link href="/privacy">privacy policy</Link>.
              </LegalP>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "Fair use",
          body: (
            <>
              <LegalP>
                Use Curfew to archive the sets you play. Don&rsquo;t probe, overload, or break the
                service; don&rsquo;t try to reach data that isn&rsquo;t yours; don&rsquo;t resell
                access or automate accounts. An account doing any of that can be suspended — with
                notice and a chance to respond where that&rsquo;s possible, immediately where
                it&rsquo;s not.
              </LegalP>
            </>
          ),
        },
        {
          id: "as-is",
          title: "What Curfew promises",
          body: (
            <>
              <LegalP>
                Curfew works to keep every night you play captured and every number honest — and is
                still provided as-is, without warranties. Estimates are estimates: dancefloor
                detection draws a window you can always overrule, and stats are only as good as the
                tags on your tracks. Outages, data loss, and mistakes are things we work hard
                against, not things we can promise away.
              </LegalP>
              <LegalP>
                If Curfew ever causes you loss, our liability is capped at what you paid for the
                service in the twelve months before the claim. Nothing in these terms limits
                liability that the law says can&rsquo;t be limited.
              </LegalP>
            </>
          ),
        },
        {
          id: "changes",
          title: "Changes to these terms",
          body: (
            <>
              <LegalP>
                These terms can change as Curfew does. Material changes come with notice by email
                before they take effect; keeping your account after that date means the new terms
                apply. The date at the top is always the version you&rsquo;re reading.
              </LegalP>
              <LegalP>
                Questions about any of it: <a href="mailto:support@curfew.vip">support@curfew.vip</a>
                . A person answers.
              </LegalP>
            </>
          ),
        },
      ]}
    />
  );
}
