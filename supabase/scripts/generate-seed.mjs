#!/usr/bin/env node
// Regenerates `supabase/seed.sql` from the committed sample fixtures (Story
// 4.9, D-23).
//
// WHY THIS EXISTS. Story 4.6 retired `recent-sets.fixture.json` /
// `library-add-events.fixture.json` from the production read path — correctly,
// they were the day-one stand-in for the real Supabase read. But production
// holds 0 sets and 0 plays, and no seed file was ever committed
// (`config.toml`'s `[db.seed]` pointed at a file that did not exist), so from
// 4.6 onward there was NO WAY to get a populated page into a browser. Story
// 4.9's AC-9/AC-11 require driving 0/1/2/>10-set states against a real DOM,
// which made this the story that had to close it (GAP-5).
//
// The two ways this could have gone wrong, both deliberately avoided:
//   - Re-pointing `web/lib/sets/index.ts` back at the fixtures would silently
//     revert Story 4.6. The seam is untouched; the data goes into Postgres and
//     is read through the same Supabase query production uses.
//   - Hand-writing a seed would drift from the fixtures. This generates it, so
//     the local stack renders the same sample data the unit tests assert on.
//
// LOCAL DEV ONLY — and that is enforced by the seed, not merely asserted.
//
// An earlier version of this comment claimed "nothing applies a seed to a
// linked project". That is FALSE: `supabase db reset` accepts `--linked` and
// `--db-url`, and ships `--no-seed` precisely because seeding is the default
// after a reset. So a single mistyped flag would apply this file to a remote
// project — creating a working, email-confirmed login whose password is
// committed in plaintext just below. The claim was stated as settled fact in
// three files, which is what would have stopped the next reader checking.
//
// The real protection is the guard emitted at the top of `seed.sql`: it aborts
// if `auth.users` holds any row other than the dev account, so a database with
// real users refuses the seed instead of absorbing it. Passing `--linked` at a
// project that has never had a user is still on the developer; the guard
// covers the case that actually matters.
//
// It creates one `auth.users` row, and `public.handle_new_dj`'s existing
// trigger creates the matching `djs` row.
//
// Usage: node supabase/scripts/generate-seed.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = join(repoRoot, "web", "lib", "sets");

const sets = JSON.parse(readFileSync(join(fixtures, "recent-sets.fixture.json"), "utf-8"));
const addEvents = JSON.parse(readFileSync(join(fixtures, "library-add-events.fixture.json"), "utf-8"));
const roster = JSON.parse(readFileSync(join(fixtures, "library-roster.fixture.json"), "utf-8"));

// A fixed dev account. The uuid is a literal, not generated, so `db reset` is
// reproducible and a developer can log in with the same credentials every time.
const DJ_ID = "00000000-0000-4000-8000-00000000d15c";
const DJ_EMAIL = "dev@curfew.local";
const DJ_PASSWORD = "curfew-dev-password";
// `djs.phone` must be non-null or `updateSession`'s phone gate (Story 3.10,
// D-9) redirects every authenticated route to `/phone-required` — which would
// make the seeded data unreachable in exactly the browser pass it exists for.
const DJ_PHONE = "+15555550100";

/** A deterministic v4-shaped uuid from any stable string. */
function uuidFrom(input) {
  const h = createHash("sha256").update(input).digest("hex");
  const v4 = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return v4;
}

function q(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? `${value}` : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonb(value) {
  return `${q(JSON.stringify(value))}::jsonb`;
}

const lines = [];
const w = (s = "") => lines.push(s);

/**
 * Emits an INSERT only when it has rows.
 *
 * An unconditional header followed by `rows.join(",\n")` writes
 * `insert into … values\n;` for an empty fixture array — syntactically invalid
 * SQL, from a script that then reports success and leaves `db reset` to fail.
 * The play and add-event loops were already conditional; sessions and sets
 * were not.
 */
function writeInsert(header, rows) {
  if (rows.length === 0) {
    w(`-- (no rows for: ${header.slice(0, 60)}…)`);
    w("");
    return;
  }
  w(header);
  w(`${rows.join(",\n")};`);
  w("");
}

w("-- GENERATED FILE — do not edit by hand.");
w("-- Regenerate with: node supabase/scripts/generate-seed.mjs");
w("--");
w("-- Local-development seed for `supabase db reset` (Story 4.9, D-23).");
w("-- Built from web/lib/sets/recent-sets.fixture.json and");
w("-- library-add-events.fixture.json — the sample data Story 4.6 retired from");
w("-- the production read path and kept as test-only fixtures.");
w("--");
w("-- LOCAL DEV ONLY, enforced by the guard below rather than assumed. Note");
w("-- `supabase db reset` is NOT local-only: it accepts `--linked` and");
w("-- `--db-url`, and `--no-seed` exists because seeding is the default after a");
w("-- reset. Nothing in CI or the deploy path runs it against a remote, but a");
w("-- mistyped flag would, so the guard refuses any database holding real users.");
w("-- It is committed in the same change that flips `[db.seed] enabled = true`,");
w("-- because config.toml's own comment warns that enabling the flag while the");
w("-- file is missing breaks the migration-apply CI gate.");
w("--");
w(`-- Sign in locally as ${DJ_EMAIL} / ${DJ_PASSWORD}.`);
w("--");
w("-- STATES THIS SEED CARRIES, so Story 4.9 Task 9 can drive every branch");
w("-- without hand-editing SQL (delete sets from the newest end to walk down to");
w("-- >10 / 2 / 1 / 0):");
const lowConfidence = sets.filter((s) => s.derived.confidence.value < 1.0).length;
const shortSets = sets.filter((s) => (s.derived.track_count ?? s.plays.length) < 6).length;
const nullTitlePlays = sets.reduce((a, s) => a + s.plays.filter((p) => p.title == null).length, 0);
const totalPlays = sets.reduce((a, s) => a + s.plays.length, 0);
w(`--   ${sets.length} sets, ${totalPlays} plays, ${addEvents.length} library add-events`);
w(`--   ${lowConfidence} sets with confidence < 1.0`);
w(`--   ${shortSets} sets under HERO_MIN_TRACKS (6) — the soundcheck case D-20 hides`);
w(`--   ${nullTitlePlays} plays with a null title — the D-18 exclusion + disclosure`);
w("--   0 undated sets, and that is not an omission: `sets.started_at` is NOT");
w("--   NULL in the schema, so an undated set is unreachable through the cloud");
w("--   read path. The undated handling in libraryUtilization.ts is defensive");
w("--   against a future nullable column, and is covered by unit tests instead.");
w("");
w("begin;");
w("");
w("-- ── LOCAL-ONLY GUARD ──────────────────────────────────────────────────────");
w("-- Aborts the whole seed (inside the transaction, so nothing is written) if");
w("-- this database holds any auth user other than the dev account.");
w("--");
w("-- `supabase db reset` DOES accept `--linked` and `--db-url`, and ships");
w("-- `--no-seed` precisely because seeding is the default after a reset — so");
w("-- the comments that used to claim a seed cannot reach a remote project were");
w("-- simply wrong. Below this line is an email-confirmed account whose password");
w("-- is committed in plaintext; applying it to a project with real users would");
w("-- create a working production login. A fresh local stack has no other users,");
w("-- so this is invisible in normal use.");
w("do $$");
w("begin");
w("  if exists (");
w("    select 1 from auth.users");
w(`    where id <> ${q(DJ_ID)}::uuid`);
w("  ) then");
w("    raise exception");
w("      'Refusing to seed: this database has real auth users. supabase/seed.sql is local-dev only (Story 4.9, D-23).';");
w("  end if;");
w("end $$;");
w("");
w("-- Idempotent: a second `db reset` (or a manual re-run) replaces rather than");
w("-- duplicates. `plays` and `sets` cascade from the deletes below.");
w(`delete from public.library_roster where dj_id = ${q(DJ_ID)};`);
w(`delete from public.library_track_events where dj_id = ${q(DJ_ID)};`);
w(`delete from public.plays where dj_id = ${q(DJ_ID)};`);
w(`delete from public.sets where dj_id = ${q(DJ_ID)};`);
w(`delete from public.sessions where dj_id = ${q(DJ_ID)};`);
w(`delete from public.deleted_sets where dj_id = ${q(DJ_ID)};`);
w("");
w("-- The dev account. `public.handle_new_dj`'s on_auth_user_created trigger");
w("-- creates the matching `public.djs` row, so this insert is the only identity");
w("-- write needed. `crypt`/`gen_salt` come from pgcrypto, which the auth schema");
w("-- already installs.");
w("-- The six token columns are EMPTY STRINGS, not NULL, and that is not");
w("-- cosmetic: GoTrue scans them into non-nullable Go strings, so a NULL makes");
w("-- every sign-in fail with `500 Database error querying schema` and");
w("-- `converting NULL to string is unsupported` — which looks like bad");
w("-- credentials from the browser and is not. Verified against the local stack.");
w("insert into auth.users (");
w("  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,");
w("  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,");
w("  confirmation_token, recovery_token, email_change_token_new, email_change,");
w("  email_change_token_current, reauthentication_token");
w(") values (");
w("  '00000000-0000-0000-0000-000000000000',");
w(`  ${q(DJ_ID)},`);
w("  'authenticated', 'authenticated',");
w(`  ${q(DJ_EMAIL)},`);
w(`  crypt(${q(DJ_PASSWORD)}, gen_salt('bf')),`);
w("  now(), now(), now(),");
w(`  '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb,`);
w("  '', '', '', '', '', ''");
w(") on conflict (id) do nothing;");
w("");
w("-- Password sign-in needs the matching identity row; without it the account");
w("-- exists but `signInWithPassword` reports invalid credentials.");
w("insert into auth.identities (");
w("  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at");
w(") values (");
w(`  ${q(DJ_ID)}, ${q(DJ_ID)},`);
w(`  jsonb_build_object('sub', ${q(DJ_ID)}, 'email', ${q(DJ_EMAIL)}, 'email_verified', true),`);
w("  'email', now(), now(), now()");
w(") on conflict (provider, provider_id) do nothing;");
w("");
w("-- Non-null phone: the Story 3.10 middleware gate redirects to");
w("-- /phone-required otherwise, making the seeded data unreachable.");
w(`update public.djs set phone = ${q(DJ_PHONE)}, dj_name = 'Dev DJ' where id = ${q(DJ_ID)};`);
w("");
// Deliberately NOT seeded: `public.agent_status`. Nothing in Story 4.9 reads
// it, and `agent_status_isolation_test.sql:34` asserts `count(*) from
// public.agent_status = 1` as the superuser — a global count that any seeded
// row breaks. Leaving the table alone keeps that assertion untouched rather
// than rewriting a test to accommodate data it does not need. (Its other
// count, at line 276, runs as `anon` and is seed-proof by RLS.) A future story
// that genuinely needs a seeded heartbeat should scope that assertion to the
// DJs the test creates, the same way this story had to for `sets`.

// One `sessions` row per set. `session_identity` is what `formatSessionLabel`
// parses into the human "SET 975" header — `sets.id` is a uuid and is never a
// display value (see web/lib/sets/types.ts on the `SET 872d5614-…` regression).
w("-- Sessions — one per set. `session_identity` carries the Serato-visible");
w("-- number that `formatSessionLabel` renders; `sets.id` is a uuid and must");
w("-- never reach a header.");
const sessionRows = sets.map((s) => {
  const sessionId = uuidFrom(`session:${s.external_id}`);
  return `  (${q(sessionId)}, ${q(DJ_ID)}, ${q(`serato4:${s.external_id}`)}, ${q(s.started_at)})`;
});
writeInsert("insert into public.sessions (id, dj_id, session_identity, created_at) values", sessionRows);

w("-- Sets. `derived` round-trips verbatim as jsonb — it is the render cache the");
w("-- stat engine wrote, and `hasRenderableDerived` in the read seam drops any");
w("-- row missing confidence/bpm_distribution/genre_breakdown.");
const setRows = sets.map((s) => {
  const setId = uuidFrom(`set:${s.external_id}`);
  const sessionId = uuidFrom(`session:${s.external_id}`);
  return `  (${q(setId)}, ${q(sessionId)}, ${q(DJ_ID)}, ${q(s.started_at)}, ${q(s.ended_at)}, ${jsonb(s.derived)}, 'private', ${q(s.started_at)})`;
});
writeInsert(
  "insert into public.sets (id, session_id, dj_id, started_at, ended_at, derived, visibility, created_at) values",
  setRows,
);

w("-- Plays. Column list matches SET_WITH_PLAYS_SELECT exactly, so a seeded row");
w("-- reconstructs into the same `SyncPlay` the fixture stage produced.");
const playRows = [];
for (const s of sets) {
  const setId = uuidFrom(`set:${s.external_id}`);
  for (const p of s.plays) {
    playRows.push(
      // `q(p.position)`, not a bare `${p.position}` — it was the one value in
      // this row interpolated raw, so a fixture play missing `position` emitted
      // the literal token `undefined` into the VALUES list and aborted
      // `db reset` on a syntax error with no indication which row. `q` emits
      // `null` for that case, like every neighbouring column.
      `  (${q(setId)}, ${q(DJ_ID)}, ${q(p.position)}, ${q(p.title)}, ${q(p.artist)}, ${q(p.started_at)}, ` +
        `${q(p.bpm)}, ${q(p.genre?.raw ?? null)}, ${q(p.genre?.normalized ?? null)}, ` +
        `${q(p.genre?.taxonomy_version ?? null)}, ${q(p.genre?.subgenre ?? null)}, ${q(p.camelot_key)}, ` +
        `${p.in_library ? "true" : "false"}, ${q(p.played_ms ?? null)}, ${q(p.library_added_at ?? null)}, ${q(p.track_id ?? null)})`,
    );
  }
}
// Chunked: one 2,000-row VALUES list is fine for Postgres but unreadable in a
// diff and slow to parse in some editors.
const CHUNK = 500;
for (let i = 0; i < playRows.length; i += CHUNK) {
  w(
    "insert into public.plays (set_id, dj_id, position, title, artist, started_at, bpm, genre_raw, genre_normalized, taxonomy_version, subgenre, camelot_key, in_library, played_ms, library_added_at, track_id) values",
  );
  w(`${playRows.slice(i, i + CHUNK).join(",\n")};`);
  w("");
}

w("-- Library add-events — the conversion pair's denominator (Story 4.2).");
const eventRows = addEvents.map(
  (e) => `  (${q(DJ_ID)}, ${q(e.track_id)}, ${q(e.added_at ?? null)}, now())`,
);
for (let i = 0; i < eventRows.length; i += CHUNK) {
  w("insert into public.library_track_events (dj_id, track_id, added_at, created_at) values");
  w(`${eventRows.slice(i, i + CHUNK).join(",\n")}`);
  w("on conflict (dj_id, track_id) do nothing;");
  w("");
}

// `library_roster` (Story 4.11, AD-22). Seeded as GROUNDWORK, and the reason
// is stated accurately here because the first version of this comment got it
// wrong and the browser pass caught it.
//
// It does NOT make Story 4.11's unidentifiable-tracks disclosure drivable.
// `getLibraryRoster()` (`web/lib/sets/index.ts`) is a hardcoded stub returning
// `{ entries: [], excludedNoIdentityCount: 0, totalCatalogueRows: 0 }` — it
// never reads this table, so seeding it changes nothing on screen (verified in
// a browser: the line still does not render). Its own doc comment explains the
// split: `entries` COULD be read today and was deliberately left for Story
// 4.4/4.10, the first stories with a consumer, while the two scalars the
// disclosure actually gates on CANNOT be read at all — they are scan-level
// values with no cloud carrier, computed by the agent and never shipped.
//
// So these rows are useful the moment 4.4/4.10 implement the paged select, and
// inert until then. That is worth having; pretending it closes a browser-state
// gap is not.
w("-- Library roster — the current-state catalogue (Story 4.11, AD-22).");
w("-- GROUNDWORK ONLY: `getLibraryRoster()` is still a stub that returns zeros");
w("-- and never reads this table, so these rows are inert until Story 4.4/4.10");
w("-- implements the paged select. `on conflict` mirrors the real write path.");
const rosterRows = (roster.entries ?? []).map(
  (e) =>
    `  (${q(DJ_ID)}, ${q(e.track_id)}, ${q(e.title ?? null)}, ${q(e.artist ?? null)}, ` +
    `${q(e.added_at ?? null)}, ${e.is_baseline ? "true" : "false"}, ${q(e.absent_at ?? null)}, now(), now())`,
);
for (let i = 0; i < rosterRows.length; i += CHUNK) {
  w(
    "insert into public.library_roster (dj_id, track_id, title, artist, added_at, is_baseline, absent_at, created_at, updated_at) values",
  );
  w(`${rosterRows.slice(i, i + CHUNK).join(",\n")}`);
  w("on conflict (dj_id, track_id) do nothing;");
  w("");
}

w("commit;");
w("");

writeFileSync(join(repoRoot, "supabase", "seed.sql"), lines.join("\n"));
console.log(
  `seed.sql written: ${sets.length} sets, ${playRows.length} plays, ${eventRows.length} add-events, ${rosterRows.length} roster rows`,
);
