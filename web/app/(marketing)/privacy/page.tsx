import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalList, LegalP } from "@/app/components/landing/LegalDoc";

// /privacy — the policy the FAQ's "Your data" section was already promising:
// music never leaves the laptop, sets are private, export/deletion on
// request. Every claim here is grounded in how the product actually works —
// the processor list matches what's really wired (Supabase, Vercel, Resend,
// Sentry in the agent; see EMAIL-PROVISIONING.md and agent/src-tauri), the
// cookies section names the real cookies (Supabase session +
// curfew_phone_on_file), and the rights section matches
// ACCOUNT-DELETION-EXPORT-RUNBOOK.md's manual, person-handled process. The
// FAQ's two content rules hold here too: no mechanism spillage, and the
// archive starts at signup. Pre-launch legal review still owed.

export const metadata: Metadata = {
  title: "Curfew — privacy policy",
  description:
    "What Curfew collects (the record of your sets — never your music files), who touches it, and how to get it out or delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="Privacy policy"
      title="What Curfew knows."
      sub="Exactly what Curfew collects, why, who touches it, and how you get it out. No tracking
        confessions buried in section nine — there's nothing to bury."
      updated="Effective August 16, 2026"
      sections={[
        {
          id: "short-version",
          title: "The short version",
          body: (
            <LegalList
              items={[
                "Your music files never leave your laptop. Curfew syncs the record of a set — titles, times, keys, BPMs — never audio.",
                "Your sets are private to your account. No public profiles, no feed.",
                "Curfew doesn't sell your data, and runs no advertising trackers.",
                "Curfew may email or text you about Curfew — new features, offers. One reply stops it.",
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
                which version it runs — so the dashboard can tell you plainly when something needs
                attention.
              </LegalP>
              <LegalP>
                <strong>Crash reports.</strong> If the agent hits an error, a technical report of
                what went wrong may be sent so it can be fixed. Those reports are about the
                software, not about your sets.
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
                needs either — your library stays on your laptop, whole. There is no microphone
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
                provider shares your name and email with Curfew — nothing more, and only because
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
                Curfew may also use your email or your number to tell you about the product itself
                — new features, offers, things worth knowing. That is Curfew writing to you about
                Curfew, and nothing more: your details are never sold, rented, or handed to anyone
                else to advertise with. Stop those messages any time — reply STOP to a text, use
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
                  "Supabase — the database and sign-in.",
                  "Vercel — hosting for the site and dashboard.",
                  "Resend — delivery of account email.",
                  "Sentry — crash reports from the agent.",
                ]}
              />
              <LegalP>
                When you pay for Curfew, your card details go to the payment processor and never
                touch Curfew&rsquo;s servers. None of these services may use your data for anything
                beyond the job named above.
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
                Two kinds, both in service of you staying signed in: the session cookies that keep
                your sign-in alive, and one small marker that remembers your account already has a
                phone number on file so you aren&rsquo;t asked twice. No advertising cookies, no
                cross-site tracking, nothing watching you leave.
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
                and your archive comes back to you in a portable format — or Curfew deletes the
                account and every row of data it owns. Requests are handled by a person, not a
                queue; a self-serve control is coming. The agent&rsquo;s own local database lives
                on your laptop and goes with the app.
              </LegalP>
              <LegalP>
                Depending on where you live, laws like the GDPR or the CCPA give you specific
                rights over your data — access, correction, deletion, portability. The same
                address honors all of them.
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
                As long as your account exists — the archive is the product, so nothing is aged
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
                section — the same promises, shorter.
              </LegalP>
            </>
          ),
        },
      ]}
    />
  );
}
