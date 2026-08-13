# Demo Account Spec — "June"

**Status:** approved, not yet built
**Author:** Arjun + Claude, 2026-08-12
**Purpose:** a permanently-maintained, aged demo account in the production Supabase
project, used to record screenshots and screen captures for marketing materials and
the landing page.

---

## 1. Why this is not the existing seed

`supabase/seed.sql` (generated from `web/lib/sets/*.fixture.json`) holds 58 sets and
2,294 plays of real Serato data. It is the right artifact for testing and the wrong
one for marketing, because it was deliberately built to carry ugly states:

| Property | Existing seed | Demo account target |
| --- | --- | --- |
| Plays with no genre | 891 (39%) | ~2% |
| Plays normalizing to `Other` | 852 (37%) | ~5% |
| Genuinely nameable genre | **~24%** | ~93% |
| Null titles | 93 | ~8 total, none on a screenshot surface |
| BPM range | 50 → 162 | 88 → 160 |
| Sets under `HERO_MIN_TRACKS` | 7 | 2, archived |
| Low-confidence sets | 11 | 5, all pre-June |
| Tracks/set | 1 → 126 (median 27) | 18 → 80 (median 34) |

The demo account is a **separate generator**, not a change to the fixtures. The
fixtures and `seed.sql` stay exactly as they are.

---

## 2. Locked decisions

| Decision | Value |
| --- | --- |
| Persona | **June** — fictional DJ name, real (Arjun's) library |
| Environment | Production Supabase project, real `auth.users` row |
| Login | `admin@curfew.vip` / `1234567890` |
| Timezone | **`America/New_York`** (IANA zone, not a fixed offset) |
| Window | 2026-01-06 → 2026-08-10 (~31 weeks), with a 3-week gap in late April |
| Track/artist names | Real, extracted from Arjun's USB |
| Camelot compatibility | Varies by set; hand-designed 58–65%, archive ~45%, account ~50% |
| Data quality | Realistic-with-mess (see §9) |
| Duplicate tracks | Deduped to one canonical `track_id` |
| Add-dates | Real `tadd`/`uadd` where usable; authored in the overlay where not |
| Library size | Unbounded — use as much of the drive as is useful |
| Special sets | 1–2 Indian wedding dancefloors (see §7.4) |

### 2.1 Why the IANA zone matters

`plays.started_at` is `timestamptz` and, per Story 4.10 D-32, is formatted **in the
viewer's zone** — there is no venue timezone, no DJ timezone on `djs`, and no
set-level offset anywhere in the system. US DST flips on **2026-03-08**, inside the
window. Anchoring to a fixed `-05:00` would render every pre-March set an hour off
from every post-March set and smear the track-detail "time of night" stat across two
clock hours for no reason. Generate against `America/New_York`; record in ET.

### 2.2 Password risk, stated once

The account holds only the `authenticated` role, and every write path available to it
is RLS-scoped to its own `dj_id`. A compromise defaces June's demo data; it cannot
reach another user's rows or the schema. Two operational notes:

- Hosted Supabase's optional **leaked-password protection** (HaveIBeenPwned) will
  reject `1234567890` outright if enabled for the project. Local `config.toml`
  (`minimum_password_length = 6`, empty `password_requirements`) does not govern the
  hosted project. If account creation bounces, escalate to Arjun — do not silently
  substitute a different password.
- The credential is read from env in the generator, never hardcoded, so it does not
  land in git.

---

## 3. Source data

**Drive:** `/Volumes/Samsung USB` (mounted; note the actual case — "Samsung", not
"SAMSUNG").

Confirmed present:

- `_Serato_/database V2` — the legacy-format catalogue carrying `pfil`, `tadd`/`uadd`,
  BPM, key, genre, title, artist at ~94% coverage on real data (Epic 1's measurement).
- `_Serato_/Subcrates/*.crate` — Arjun's own crate groupings.
- Top-level genre-ish folders: `A Indian`, `A Hip Hop`, `Club`, `House`, `Dance edm`,
  `Dance pop`, `Festival`, `holiday`, and others.

**Crates are the most valuable asset on the drive.** Sampling sets from crates
produces setlists that hang together; sampling from a genre histogram produces noise.
Nothing in the codebase reads `.crate` files today — the parser is ~30 lines of the
same `otrk`/`ptrk` chunk format `database V2` already uses.

**Privacy:** metadata only. No audio content is read beyond tag frames.

---

## 4. Pipeline

Four artifacts, in order. Each is reviewable and each stage is idempotent.

```
/Volumes/Samsung USB/_Serato_/
        │
        │  (1) extractor — reuses production code, writes nothing to the drive
        ▼
demo-catalog.json  ──────────  unmapped-genres report
                               duplicate report
                               add-date histogram
        │
        │  (2) human review; corrections land in the overlay, never in the catalog
        ▼
demo-overlay.json
        │
        │  (3) generator — calendar + crate-driven set composition
        ▼
production Supabase, as June
```

### 4.1 Code reuse — do not write a second parser

| Need | Existing production code |
| --- | --- |
| `database V2` → bpm/key/genre/date_added/title/artist | `agent/src-tauri/src/joiner/legacy.rs` — `LegacyLibrary::load`, `LibraryTrack` |
| Tag fallback for gaps | `agent/src-tauri/src/joiner/embedded_tags.rs` (ID3 `TCON`/`TKEY`, Serato Autotags `GEOB`, Vorbis) |
| Raw genre → normalized + subgenre | `agent/src-tauri/src/genre.rs`, `normalize()`, `TAXONOMY_VERSION = 2` |
| Key compatibility | `agent/src-tauri/src/stats/camelot.rs` |
| Dancefloor detection | `agent/src-tauri/src/stats/segments.rs` |

Running June's real genre strings through the real normalizer is what guarantees the
demo cannot drift from what the product would actually display. This mirrors the rule
`supabase/scripts/generate-seed.mjs` already follows for segments: call the Rust
detector, never reimplement it.

### 4.2 Catalog and overlay

`demo-catalog.json` — one row per deduped track: portable id (`track_id`), title,
artist, bpm, camelot key, raw genre, normalized genre, subgenre, real date-added,
source crate(s), source folder.

`demo-overlay.json` — corrections keyed by portable id. **Corrections never mutate the
catalog**, so re-extracting from the drive is idempotent and cannot wipe them.

Expected correction categories, in rough order of volume:

1. **Genre** — expected to be rare; the drive is well organized.
2. **BPM** — missing, or half/double-time (Serato reading 140 as 70). Highest-impact
   correction: BPM *is* the energy arc, so a wrong value visibly bends the curve.
3. **Camelot key** — missing on edits/bootlegs; possibly stored as musical notation
   rather than Camelot.
4. **Title / artist** — filename junk on edits: leading track numbers, `(Dirty)`,
   `(Intro Clean)`, `(Acap Out)`, `[Edit]`, remixer in the title instead of the artist
   field, `ft` vs `feat.`. These strings appear in every screenshot **and** they
   determine `track_id` — see §4.3, these corrections are load-bearing.
5. **Add-date** — authored where the real one is unusable (see §11 risk 1).

**Taxonomy patches are different from overlay patches.** If a raw genre string is
real and the taxonomy simply lacks a mapping, the fix belongs in `genre.rs`'s mapping
table, not in the overlay — it improves the product for every user. Bring the
frequency-ranked unmapped list to Arjun before editing `genre.rs`.

### 4.3 Track identity and deduplication

**`track_id` is NOT a path hash.** It is
`agent/src-tauri/src/capture.rs :: track_id_from_title_artist` — FNV-1a hex over
`normalize(title) + \x1e + normalize(artist)`, where the fold is trim → collapse
internal whitespace runs → lowercase. The extractor must call that exact function,
never invent its own.

Story 4.3 (Decision E-2) retired the earlier path-based id precisely because hashing
the volume-root-relative path split one song into two identities whenever it lived on
both a laptop and a gig USB — which, on Arjun's own real data, deflated whole cohorts
of conversion-rate months to 0%.

Two consequences that invert the naive dedup assumption:

1. **Cross-drive and cross-crate copies already collapse.** Same title + artist ⇒ same
   `track_id`, for free. This is not the duplicate problem.
2. **The real problem is near-miss strings splitting one song into several ids.**
   `(Dirty)` vs `(Clean)` vs `(Intro)` variants, `feat.` vs `ft`, remixer in the title
   vs the artist field, and — because the fold deliberately does no NFC/NFKC
   normalization (a known, documented gap) — precomposed vs combining-character
   accents. These are what silently split a play count.

**A track with a missing title or artist has no identity at all** (`None`, never a
partial hash). It cannot enter the roster, cannot join to any library stat, and cannot
have a track-detail page. This makes overlay title/artist corrections **load-bearing,
not cosmetic** — they decide whether a track exists in the library system.

The duplicate report should therefore surface *near-miss clusters* (tracks whose
normalized identities differ only by a parenthetical, a `feat.`/`ft` variant, or an
accent) for review, plus a list of tracks with no derivable identity at all.

---

## 5. Calendar — ~78 sets over 31 weeks

There is **no venue field** in the schema (`sessions.session_identity` is just
`serato4:NNN`). The residency/club/private distinction is only ever implicit in start
time, duration, track count, BPM shape, and genre mix. That is sufficient, but it
means those five things carry the whole narrative.

| Type | Count | Shape |
| --- | --- | --- |
| Thursday residency | ~28 | 8:30pm ET, ~3h, 24–32 tracks, slow build |
| Fri/Sat club | ~34 | 11pm ET, ~3.5h, 40–62 tracks, peak-time |
| Private events | ~12 | Sat 6–10pm, widest genre spread (incl. §7.4) |
| Soundchecks | 2 | <6 tracks, archived, never heroed |

Plus a **3-week gap in late April**. A metronomic calendar reads as generated; a real
DJ takes time off.

`session_identity` values form a plausibly increasing `serato4:NNN` sequence across the
window.

**Odometer target:** ~78 sets · ~247 hours · ~2,700 tracks.

---

## 6. Genre arc

A static genre mix makes `/style-evolution` pointless. The drift is produced by
**which crates get sampled when**, not by a weighted histogram:

| Period | Mix |
| --- | --- |
| Jan–Mar | Pop 30 · Hip-Hop 25 · House 15 · R&B 12 · Latin 8 |
| Apr–May | House 28 · Pop 22 · Hip-Hop 22 · Afrobeats appears |
| Jun–Aug | House 38 (Afro House + Tech House top subgenres) · Hip-Hop 18 · Pop 14 |

Read as one screenshot: *you started open-format and became a house DJ.*

---

## 7. Set composition

### 7.1 Tiering — not every set is hand-designed

~78 sets × ~34 tracks ≈ 2,650 play rows. Hand-sequencing all of them is weeks of work
for no marginal screenshot value; generating all of them looks wrong the moment anyone
reads a tracklist.

| Tier | Count | Treatment |
| --- | --- | --- |
| **1 — hand-designed** | ~6 | Track-by-track sequencing: real energy arc, intentional key relationships, transitions a DJ would nod at. The dashboard hero, two set-detail screenshots (one peak-time club, one residency slow-build), and the 2–3 sets the signature track's detail page links back to. |
| **2 — generated, then reviewed** | ~15 | Dashboard archive cards visible without scrolling, plus everything in the last ~6 weeks. Generated from crates, then hand-fixed wherever a tracklist reads wrong. |
| **3 — generated to spec** | ~57 | Everything older. Verified statistically, not by eye — these exist to drive Style Evolution, Library Utilization, the calendar, and the odometer, where the distribution is the product and no individual tracklist is ever read. |

### 7.2 Energy arcs

`derived.energy_arc` is drawn directly, so BPM gets a deliberate shape per set type:

- **Residency:** 92 → 108 → 120 over 3h, gentle.
- **Club:** 118 → 124 → 128 peak at ~60% through → 122 close, with one intentional
  ~100bpm hip-hop dip mid-set. The dip is a real DJ move and keeps the arc from being
  a featureless hump.
- **Private:** wide swings, 85 → 128 → 95.

### 7.3 Camelot

Account-wide ~50%, **varied by set** rather than flat. `setDetail.ts` labels every
adjacent transition `smooth`/`clash`/`nokey` and renders it inline, so a flat 50% puts
a clash marker on every other row of the flagship tracklist.

| Set group | Target |
| --- | --- |
| Tier 1 hand-designed | 58–65% |
| Archive | ~45% |
| Indian wedding sets | ~35% (see below) |
| **Account-wide** | **~50%** |

~50% is the honest picture for open-format — cutting on energy and vocal, not
keylocking — and it makes the product look like it is reporting something real rather
than congratulating the user.

### 7.4 Indian wedding dancefloors (1–2 sets)

Source folder: `A Indian`. **The taxonomy already handles these with no patch needed** —
`genre.rs` carries a `Bollywood` parent with `Bollywood`, `Bhangra`, `Punjabi`,
`Desi EDM`, and `Bollywood Hip-Hop/Trap` subgenres (taxonomy v2).

These are the most valuable non-obvious sets in the account: they prove Curfew is not
just a house-DJ tool, and the subgenre breakdown on that set-detail page looks
genuinely unlike every other set in the archive.

Distinctive data signature, all of which should be real rather than smoothed away:

- **High track count, short plays.** Crowd-pleaser cuts of 60–120s each → 60–80 tracks
  in ~3 hours. `played_ms` should reflect this.
- **Bimodal BPM.** Dhol-driven bhangra at 90–105 and 140–160; Bollywood pop 95–130. The
  energy arc will not look like a house set's, and should not be made to.
- **Low key compatibility (~35%).** You are cutting, not blending.
- **Mixed parentage.** Bollywood/Bhangra/Punjabi against Hip-Hop, Afrobeats, Reggaeton,
  and House.

Structure: cocktail/dinner opening into a dancefloor. Note that only the dancefloor
portion gets a segment — see §8.

---

## 8. Segments

**Dancefloor only.** `segments_validate()` raises
`only dancefloor segments can be written` for any `authenticated` caller — the Story
5.3 D-32 MVP guard. Do **not** reach for service-role to write `dinner`/`custom`
segments: putting a state in marketing footage that no real user can currently produce
is worse than not having it. The residency-vs-club-vs-wedding distinction already
reads through start time, duration, track count, and BPM shape.

Distribution: ~55 sets with one dancefloor segment, ~14 with two (a genuine mid-set
break), ~9 with none — the zero/one/several states FR-28 requires, plus the whole-set
fallback the card and hero take when a set has no segment.

---

## 9. Mess budget

Zero mess reads as fake. The rule: **mess exists, but never on a surface you would
screenshot.**

- 5 low-confidence sets, all before mid-June, none in the hero or the recent archive.
- 2 short soundchecks in the archive.
- ~8 plays with a null title total (~0.3%), all in older sets.
- A handful of plays with no BPM or no key, so the exclusion disclosures render with
  small honest counts. The disclosures are a feature; showing them beats hiding them.

---

## 10. Write path, safety, and build order

Every bulk write goes through **the same RPCs the agent uses**, signed in as June:

| Data | Path | Enforcement |
| --- | --- | --- |
| Sets + plays | `sync_set()` | `SECURITY DEFINER`, derives `dj_id` from `auth.uid()` |
| Roster | `sync_library_roster()` | same |
| Add events | `sync_library_add_events()` | same |
| Segments | direct insert | RLS `segments_insert_own` |
| `dj_name` / `phone` | column-scoped update grant | RLS `djs_update_own_phone` |

Because `auth.uid()` supplies `dj_id` in all of them, the generator **structurally
cannot write a row belonging to another user**. No service-role key, no direct table
access.

### 10.1 Build-order constraint

`sync_set()` **deletes and reinserts** a set's plays on every call, and `segments`
foreign-keys cascade on play delete. Therefore:

> sets → read back play ids → segments.

Segments must never be written before or during a set re-sync, or they vanish
silently.

### 10.2 The one elevated write

`agent_status` has **no write grant for `authenticated`** at all. Setting
`sync_state` (so the dashboard shows a connected agent rather than the onboarding
prompt) requires a single service-role upsert of one row. Keep it isolated and
obvious — it is the only place in the pipeline that touches elevated credentials.

### 10.3 Account plumbing that breaks the recording if missed

- `djs.dj_name = "June"` and `djs.phone` set — otherwise `/phone-required` intercepts.
- `agent_status.sync_state` synced with a recent `updated_at`.
- `sets.visibility` — all `private` is correct; June always views as owner.
- `track_id` stable across the roster and every play, or track detail and all library
  joins break.

### 10.4 Determinism and re-anchoring

Fixed PRNG seed and an `--anchor=YYYY-MM-DD` flag throughout:

- **Deterministic** — a screenshot retaken in October reproduces exactly.
- **Re-anchorable** — re-running slides the whole 7 months forward, so the dashboard
  never degrades into "last gig was 5 months ago."

`sync_set()` is idempotent on `(dj_id, session_identity)`, so a re-run updates in place
rather than duplicating. Re-anchoring must re-write segments after the set re-sync
(§10.1).

### 10.5 `seed.sql` is untouched

The local seed's guard (abort if `auth.users` holds any row but the dev account) stays
exactly as is. The demo account is a production account and must not weaken it.

---

## 11. Risks

1. **Clustered add-dates.** If the USB was populated by bulk-copying a library, every
   `tadd`/`uadd` may land on the copy date — which would flatten the library-conversion
   cohort chart into a single spike and take out most of the aging shelf. The
   extractor emits an add-date histogram specifically to surface this in the first two
   minutes. Fallbacks: file mtime, or author June's add-dates in the overlay. Arjun has
   pre-approved varying add-dates for realism.
2. **Leaked-password rejection** — see §2.2.
3. **Demo staleness** — mitigated by §10.4, but only if someone actually re-runs it.

---

## 12. Surfaces the data must serve

| Route | What it needs from the data |
| --- | --- |
| `/dashboard` | Hero set ≥ `HERO_MIN_TRACKS` (6), archive cards, calendar day-marks, most-played track/artist, latest-set confidence, odometer |
| `/set/[id]` | Full tracklist, energy arc, genre + subgenre breakdown, camelot transitions, segments |
| `/style-evolution` | Month **and** week buckets, both excluding and including low-confidence; enough months to clear the insufficient-history gate |
| `/library-utilization` | Conversion cohorts at 60/30/14-day windows, repeat rate, set similarity, workhorses, one-and-done, rotation size, aging shelf |
| `/track/[track_id]` | A signature track with ~34 plays across all 7 months, consistent time-of-night, 3–4 recurring mix neighbours |
| `/settings` | `dj_name`, phone, avatar/initials |

---

## 13. Execution checklist

- [ ] Crate parser (~30 lines, `otrk`/`ptrk`) + extractor binary in the agent crate
- [ ] Run extraction → `demo-catalog.json`, unmapped-genres report, duplicate report,
      add-date histogram
- [ ] Arjun reviews catalog; `genre.rs` patched only where the taxonomy is genuinely
      missing a mapping
- [ ] `demo-overlay.json` corrections
- [ ] Calendar generator (§5) with the April gap
- [ ] Set composition: Tier 1 hand-designed (§7.1), incl. 1–2 Indian wedding sets (§7.4)
- [ ] Tier 2 generate + review, Tier 3 generate + statistical check
- [ ] Create `admin@curfew.vip` in prod; set `dj_name` / phone
- [ ] Write sets → read back play ids → write segments (§10.1)
- [ ] Service-role `agent_status` upsert (§10.2)
- [ ] Browser pass over all six surfaces in §12; tune
