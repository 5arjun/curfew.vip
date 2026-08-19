import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalList, LegalP } from "@/app/components/landing/LegalDoc";
import { pageMetadata } from "@/lib/seo";

// /privacy — the policy the FAQ's "Your data" section was already promising:
// music never leaves the laptop, sets are private, export/deletion on
// request. Every claim here is grounded in how the product actually works —
// the processor list matches what's really wired (Supabase, Vercel, Resend,
// Sentry in both the agent and web/ as of 2026-08-16 — see
// EMAIL-PROVISIONING.md, agent/src-tauri, and web/lib/sentry-shared.ts; that
// last one pins sendDefaultPii:false, which is what keeps this page's
// collection claims true, so it and this file move together), the
// cookies section names the real cookies (Supabase session +
// curfew_phone_on_file), and the rights section matches
// ACCOUNT-DELETION-EXPORT-RUNBOOK.md's manual, person-handled process. The
// FAQ's two content rules hold here too: no mechanism spillage, and the
// archive starts at signup.
//
// Reviewed 2026-08-18 — docs/legal-review-2026-08-18.md, which closes the
// launch checklist's §1.7 and supersedes the "pre-launch legal review still
// owed" note that stood here. That pass added the two CalOPPA §22575(b)
// disclosures (Do Not Track, cross-site collection) to the cookies section,
// named the three processors this list had been missing, and narrowed the
// rights paragraph to the US-only posture actually ruled in PRD §11.
//
// AMENDED 2026-08-19 — product analytics (PostHog) shipped, which this page
// previously ruled out in three separate places: "no behavioral tracking to
// switch off", "no third party collect anything about what you do here", and
// a cookies list of exactly two. All three are now written to what actually
// runs. This also closes the review's own flagged follow-up under finding D
// ("if Vercel Web Analytics and Speed Insights ship, revisit this section") —
// they had already shipped in app/layout.tsx and were never named here.
//
// The two CalOPPA disclosures SURVIVE the change rather than being dropped:
// §22575(b)(6) is still a clean "no" (PostHog is proxied through this origin
// and sees only Curfew), and §22575(b)(5) got STRONGER, because respecting DNT
// went from vacuously true to actually implemented. That last sentence is a
// promise enforced by one line of code: `respect_dnt: true` in
// lib/posthog/client.ts. The two move together — turning the flag off makes
// this page false.
//
// ⚠️ ONE GATE SURVIVES THAT REVIEW. "How it's used" grants Curfew the right
// to email and text you about the product. Neither channel is built — there
// is no SMS provider in this repo and Resend carries transactional mail only
// — and the escape hatches named below ("reply STOP", "the unsubscribe link")
// don't exist either. That is safe only while nothing sends. Before the first
// marketing message of either kind: TCPA consent has to be collected on
// (onboarding)/phone-required (separate opt-in, not bundled into these
// terms), CAN-SPAM needs an unsubscribe link and a postal address, and SMS
// needs A2P 10DLC registration. See finding A of the review, and
// launch-checklist §5.

export const metadata: Metadata = pageMetadata({
  title: "Curfew · privacy policy",
  description:
    "What Curfew collects (the record of your sets, never your music files), who touches it, and how to get it out or delete it.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="Privacy policy"
      title="What Curfew knows."
      sub="Exactly what Curfew collects, why, who touches it, and how you get it out. Including the
        part most sites bury: how this site measures what you do on it, and how to switch that off."
      updated="Effective August 19, 2026"
      sections={[
        {
          id: "short-version",
          title: "The short version",
          body: (
            <LegalList
              items={[
                "Your music files never leave your laptop. Curfew syncs the record of a set: titles, times, keys, BPMs. Never audio.",
                "Your sets are private to your account. No public profiles, no feed.",
                "Curfew doesn't sell your data, and runs no advertising trackers.",
                "Curfew does measure how this site gets used, to find where it loses people. Switch on Do Not Track in your browser and none of that runs.",
                "Curfew may email or text you about Curfew: new features, offers. One reply stops it.",
                "Export everything or delete everything, any time, by asking.",
              ]}
            />
          ),
        },
        {
          id: "what-curfew-collects",
          title: "What Curfew collects",
          body: (
            <>
              <LegalP>
                <strong>Your account.</strong> An email address, a phone number, and the DJ name
                you choose. That&rsquo;s the whole profile.
              </LegalP>
              <LegalP>
                <strong>The record of your sets.</strong> When a set ends, the agent syncs what you
                played: track titles and artists, when each one ran, keys, BPMs, genres from the
                tags already on your tracks, and the stats Curfew builds from them.
              </LegalP>
              <LegalP>
                <strong>Agent status.</strong> Whether the agent is reachable and syncing, and
                which version it runs, so the dashboard can tell you plainly when something needs
                attention.
              </LegalP>
              <LegalP>
                <strong>Crash reports.</strong> If the agent or the website hits an error, a
                technical report of what went wrong may be sent so it can be fixed. Those reports
                are about the software, not about your sets.
              </LegalP>
              <LegalP>
                <strong>How you use this website.</strong> Which pages you open, what you click,
                how far down you read, and where you stopped if you started signing up and
                didn&rsquo;t finish. Some visits are also recorded as a replay: a reconstruction of
                the page and the cursor moving over it, so a stumble can be watched back instead of
                guessed at. Anything you type is masked out of those recordings before they leave
                your browser, and none of this reaches the agent, your library, or your sets. It
                covers this website only. The desktop agent measures nothing.
              </LegalP>
            </>
          ),
        },
        {
          id: "what-curfew-never-collects",
          title: "What Curfew never collects",
          body: (
            <>
              <LegalP>
                Your music. Curfew never listens to audio, never uploads a music file, and never
                needs either. Your library stays on your laptop, whole. There is no microphone
                access, no location tracking, and no reading of anything on your machine beyond
                what running your archive requires.
              </LegalP>
            </>
          ),
        },
        {
          id: "where-it-comes-from",
          title: "Where it comes from",
          body: (
            <>
              <LegalP>
                From you, when you create the account. From the agent on your laptop, which reads
                Serato and the tags on your tracks. And if you sign in with Google or Apple, that
                provider shares your name and email with Curfew. Nothing more, and only because
                you chose it.
              </LegalP>
            </>
          ),
        },
        {
          id: "how-its-used",
          title: "How it's used",
          body: (
            <>
              <LegalP>
                To run your archive, and to talk to you about it. Your email carries account mail:
                confirmation links, password resets, notices about the service. Your phone number
                is how a person reaches you if your archive needs attention.
              </LegalP>
              <LegalP>
                Curfew may also use your email or your number to tell you about the product itself:
                new features, offers, things worth knowing. That is Curfew writing to you about
                Curfew, and nothing more: your details are never sold, rented, or handed to anyone
                else to advertise with. Stop those messages any time. Reply STOP to a text, use
                the unsubscribe link in an email, or write to{" "}
                <a href="mailto:support@curfew.vip?subject=Unsubscribe">support@curfew.vip</a>.
                Account mail keeps coming, because it is how the service reaches you.
              </LegalP>
            </>
          ),
        },
        {
          id: "who-touches-it",
          title: "Who touches it",
          body: (
            <>
              <LegalP>
                Curfew runs on a short list of services, each holding only what its job needs:
              </LegalP>
              <LegalList
                items={[
                  "Supabase: the database and sign-in.",
                  "Vercel: hosting for the site and dashboard, plus its own page-speed and visitor counts.",
                  "Cloudflare: the domain, and the front door every request comes through.",
                  "Stripe: payment and billing.",
                  "Resend: delivery of account email.",
                  "Sentry: crash reports from the agent and the website.",
                  "PostHog: how this website gets used, and the session replays described above.",
                ]}
              />
              <LegalP>
                When you pay for Curfew, your card details go to Stripe and never touch
                Curfew&rsquo;s servers. If you signed in with Google or Apple, that provider knows
                you have an account here, which is what signing in with them means. None of these
                services may use your data for anything beyond the job named above.
              </LegalP>
            </>
          ),
        },
        {
          id: "cookies",
          title: "Cookies",
          body: (
            <>
              <LegalP>
                Three kinds. The session cookies that keep your sign-in alive. One small marker
                that remembers your account already has a phone number on file so you aren&rsquo;t
                asked twice. And one from the analytics described above, which tells one visit
                apart from the next, so a path through the site reads as one person rather than
                five strangers. No advertising cookies, and nothing watching you leave.
              </LegalP>
              <LegalP>
                No one is allowed to follow you off this site. The analytics is served from
                Curfew&rsquo;s own domain and sees only Curfew: no third party may collect anything
                about what you do on other sites, over time, through this one. There is no ad
                network in the page and nothing to sell if there were.
              </LegalP>
              <LegalP>
                <strong>Do Not Track.</strong> Some browsers send a &ldquo;do not track&rdquo;
                signal, and there is no agreed standard for answering it. Curfew answers it anyway.
                With that signal on, the analytics never starts: no pages counted, no clicks
                recorded, no session replayed, and no analytics cookie set. You get the entire
                product, minus the measuring, and you don&rsquo;t have to ask.
              </LegalP>
            </>
          ),
        },
        {
          id: "your-rights",
          title: "Export and deletion",
          body: (
            <>
              <LegalP>
                Both are yours on request: write to{" "}
                <a href="mailto:support@curfew.vip?subject=Data%20export%20request">
                  support@curfew.vip
                </a>{" "}
                and your archive comes back to you in a portable format, or Curfew deletes the
                account and every row of data it owns. Requests are handled by a person, not a
                queue; a self-serve control is coming. The agent&rsquo;s own local database lives
                on your laptop and goes with the app.
              </LegalP>
              <LegalP>
                Some places give you these rights by statute: to see your data, correct it, take
                it with you, have it erased. Curfew is sold in the US and built to that standard,
                and doesn&rsquo;t check which rules you fall under before answering: ask, and the
                address above does all four, for anyone.
              </LegalP>
            </>
          ),
        },
        {
          id: "retention",
          title: "How long it's kept",
          body: (
            <>
              <LegalP>
                As long as your account exists. The archive is the product, so nothing is aged
                out. Cancel and your data stays yours to export or delete, exactly as above; delete
                the account and it&rsquo;s gone from Curfew&rsquo;s side.
              </LegalP>
            </>
          ),
        },
        {
          id: "changes",
          title: "Changes to this policy",
          body: (
            <>
              <LegalP>
                If what Curfew collects or who touches it ever changes, this page changes first and
                material changes come with notice by email. The date at the top is always the
                version you&rsquo;re reading.
              </LegalP>
              <LegalP>
                Questions, or anything here that doesn&rsquo;t match what you see the product do:{" "}
                <a href="mailto:support@curfew.vip">support@curfew.vip</a>. See also the{" "}
                <Link href="/faq#music-files-uploaded">FAQ&rsquo;s &ldquo;Your data&rdquo;</Link>{" "}
                section, which makes the same promises in fewer words.
              </LegalP>
            </>
          ),
        },
      ]}
    />
  );
}
