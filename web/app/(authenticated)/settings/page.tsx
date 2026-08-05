import { redirect } from "next/navigation";
import { getAgentStatus } from "@/lib/sets";
import { getSettingsProfile, monogramLetter } from "@/lib/account/profile";
import { maskPhone } from "@/lib/account/phone-mask";
import { Avatar } from "@/app/components/ui/Avatar";
import { AgentSection } from "@/app/components/settings/AgentSection";
import { DjNameRow } from "@/app/components/settings/DjNameRow";
import { PasswordResetRow } from "@/app/components/settings/PasswordResetRow";
import { ProvidersRow } from "@/app/components/settings/ProvidersRow";
import { SavedBadge, SettingsSavedProvider } from "@/app/components/settings/SavedIndicator";
import { SignOutRow } from "@/app/components/settings/SignOutRow";
import pkg from "../../../package.json";

// Profile/Settings (Story 3.10) — the one calm home for identity, agent, and
// privacy controls. Deliberately the quietest surface in the product (D-2/
// D-17): a single centered ~720px column of flat console rows, whole-page
// scroll, no cards/glass/WebGL. Section order is D-1's: Profile header →
// Account → [Billing slot, 7.4] → Agent → Privacy → Appearance → About →
// Sign out; a section with nothing true to say does not render.
//
// Server component: the read-only facts render on the server; only the
// interactive rows (DJ name autosave, password reset, providers, sign-out)
// are client islands. Self-guarded with the link-agent page's getUser() →
// /login pattern — the (authenticated) group has no auth-gating middleware
// (the 3.10 phone gate assumes an authenticated caller; login-gating stays
// each page's job).

export default async function SettingsPage() {
  const [profile, agentStatus] = await Promise.all([getSettingsProfile(), getAgentStatus()]);

  if (!profile) {
    redirect("/login");
  }

  const headerName = profile.djName || profile.oauthName;
  const agentVersion = agentStatus.row?.agent_version ?? null;
  // About (D-14): with Sentry unprovisioned on both sides, these strings are
  // the only diagnostic a DJ can hand over. Build hash present on Vercel
  // deploys only — locally the row shows the version alone.
  const buildHash = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const webVersion = buildHash ? `${pkg.version} (${buildHash})` : pkg.version;

  return (
    <SettingsSavedProvider>
      <main className="st-main">
        <div className="st-heading-row">
          <h1 className="text-headline-md">Settings</h1>
          <SavedBadge />
        </div>

        {/* Profile header (3a) — facts, not a form; the editable DJ name
            lives once, in Account. */}
        <header className="st-profile">
          <Avatar imageUrl={profile.avatarUrl} monogram={monogramLetter(profile.djName, profile.email)} size={64} />
          <div>
            <p className="text-body-lg st-profile-name">{headerName ?? profile.email}</p>
            {headerName && profile.email && (
              <p className="text-body-md st-profile-email">{profile.email}</p>
            )}
          </div>
        </header>

        <section className="st-section" aria-labelledby="st-account-label">
          <h2 id="st-account-label" className="text-label-sm st-section-label">
            Account
          </h2>
          <DjNameRow initialName={profile.djName} />
          <div className="st-row">
            <span className="st-row-label">Email</span>
            <span className="st-row-value text-body-md">{profile.email ?? "—"}</span>
          </div>
          <div className="st-row">
            <span className="st-row-label">Phone</span>
            <div className="st-row-cell">
              <span className="st-row-value text-body-md">
                {profile.phone ? maskPhone(profile.phone) : "Not on file"}
                {profile.phone && (
                  <span className="text-label-sm st-affix">verified · locked</span>
                )}
              </span>
              <p className="st-row-note">Changing your number needs verification — coming later.</p>
            </div>
          </div>
          <PasswordResetRow />
          <ProvidersRow providers={profile.providers} />
        </section>

        {/* Billing slot (D-1): reserved between Account and Privacy; renders
            nothing until Story 7.4 populates it. */}

        <AgentSection snapshot={agentStatus} />

        <section className="st-section" aria-labelledby="st-privacy-label">
          <h2 id="st-privacy-label" className="text-label-sm st-section-label">
            Privacy
          </h2>
          <div className="st-row">
            <span className="st-row-label">Venue suggestion</span>
            <div className="st-row-cell">
              <span className="st-row-value text-body-md">Coming soon</span>
              <p className="st-row-note">
                Will suggest where you played from your device&apos;s location. You confirm it —
                nothing saves silently.
              </p>
            </div>
          </div>
          <div className="st-row">
            <span className="st-row-label">Your data</span>
            <div className="st-row-cell">
              <a href="mailto:support@curfew.vip?subject=Data%20export%20request" className="st-link text-body-md">
                Request an export
              </a>
              <p className="st-row-note">Handled manually, usually within a few days.</p>
            </div>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-appearance-label">
          <h2 id="st-appearance-label" className="text-label-sm st-section-label">
            Appearance
          </h2>
          {/* D-13: a text row, no control — a disabled toggle invites
              clicking and then lies. Obsidian is dark-only by design. */}
          <div className="st-row">
            <span className="st-row-label">Themes coming soon</span>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-about-label">
          <h2 id="st-about-label" className="text-label-sm st-section-label">
            About
          </h2>
          <div className="st-row">
            <span className="st-row-label">Curfew Web</span>
            <span className="st-row-value text-mono-data">{webVersion}</span>
          </div>
          {agentVersion && (
            <div className="st-row">
              <span className="st-row-label">Agent</span>
              <span className="st-row-value text-mono-data">{agentVersion}</span>
            </div>
          )}
          <div className="st-row">
            <span className="st-row-label">Support</span>
            <a href="mailto:support@curfew.vip" className="st-link text-body-md">
              support@curfew.vip
            </a>
          </div>
        </section>

        <SignOutRow />
      </main>
    </SettingsSavedProvider>
  );
}
