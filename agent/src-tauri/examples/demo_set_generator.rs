//! Demo-account **set generator** — stage 2 of the demo-account pipeline
//! (`_bmad-output/planning-artifacts/demo-account-spec.md` §5–§10.4).
//!
//! Stage 1 (`demo_catalog_extractor.rs`) turned Arjun's gig USB into a reviewed
//! catalog. This turns that catalog into ~78 reviewable sets — the calendar
//! (§5), the genre arc (§6), set composition (§7), segments (§8), and the mess
//! budget (§9) — and emits them as **local artifacts only**:
//!
//! 1. `demo-sets.json` — every set: `session_identity`, ET-anchored bounds,
//!    production `CapturedPlay[]` + `CapturedDerived`.
//! 2. `demo-sets-tier1.md` — full tracklists for the hand-designed sets, so a
//!    human reads the sets that end up on a screenshot.
//! 3. `demo-sets-verification.md` — every §5–§9 statistical check, pass/fail.
//!
//! Nothing here writes to Supabase, `supabase/seed.sql`, or the web fixtures —
//! that is stage 3, and it reads `demo-sets.json`.
//!
//! ## Why this is a cargo example, and what it reuses
//!
//! Same reasoning as the extractor: examples link `agent_lib` but are never
//! part of the shipped Tauri bundle, so the generator can run **the real
//! product code** over its own synthetic sessions rather than a lookalike:
//!
//! | Concern | Production code called |
//! | --- | --- |
//! | Track identity for overlay-corrected rows | `capture::track_id_from_title_artist` |
//! | Key parse + harmonic judgement | `stats::camelot::{parse, compatible}` |
//! | Genre normalization | `genre::normalize` (via `stats::enrich`) |
//! | Every per-set stat, arc, confidence | `capture::assemble` |
//! | **Dancefloor detection** | `stats::segments::{detect, CalibrationPool}` |
//!
//! The last row is the load-bearing one. §8's distribution target (~55 sets
//! with one dancefloor segment, ~14 with two, ~9 with none) is only meaningful
//! if the *real* detector produces it, calibrated the way production calibrates
//! it — per-DJ floors from strictly-earlier sessions
//! (`CalibrationPool::floors_before`), never a global constant. So sets are
//! assembled in chronological order and each one is scored against the floors
//! its predecessors imply, exactly as `capture` does at the edge. This mirrors
//! the rule `supabase/scripts/generate-seed.mjs` already follows.
//!
//! ## Determinism (§10.4)
//!
//! Fixed PRNG seed + `--anchor=YYYY-MM-DD`. Same seed + same anchor ⇒
//! byte-identical `demo-sets.json`. Randomness is a hand-rolled SplitMix64
//! (no `rand` dependency to add to the agent crate), every map that feeds
//! output is a `BTreeMap`, and every sort carries a total tiebreak.
//!
//! Re-anchoring slides the whole window by whole **local** days — and slides
//! the library add-dates by the same delta, so the library-conversion cohorts
//! and the "no track is played before its add-date" invariant survive a
//! re-anchor unchanged.
//!
//! Run:
//! ```sh
//! cargo run --release --example demo_set_generator -- \
//!     --catalog-dir _bmad-output/demo-catalog [--anchor 2026-08-10] [--seed 20260812]
//! ```

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;

use agent_lib::capture::{assemble, track_id_from_title_artist};
use agent_lib::joiner::JoinedMetadata;
use agent_lib::parser::Play;
use agent_lib::stats::camelot::{self, CamelotKey};
use agent_lib::stats::segments::{self, CalibrationPool, PooledSession};
use agent_lib::store::{CapturedDerived, CapturedPlay};
use serde::{Deserialize, Serialize};

// =============================================================================
// §10.4 — deterministic PRNG
// =============================================================================

/// SplitMix64 — the whole randomness budget of this generator.
///
/// Hand-rolled rather than pulling `rand` into the agent crate for a tool that
/// never ships: it is ten lines, it is exactly reproducible across platforms
/// and toolchains (fixed-width wrapping integer math, no float state), and
/// §10.4's "same seed ⇒ byte-identical output" is the only property required
/// of it. Statistical quality beyond "looks unpatterned in a tracklist" is not
/// a requirement here.
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, 1)`.
    fn unit(&mut self) -> f64 {
        // 53 bits — the full mantissa, so the value is uniform over the
        // representable doubles in range rather than banded.
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.unit() * (hi - lo)
    }

    fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.next_u64() % n as u64) as usize
    }

    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    /// A fresh, independent stream keyed by `label` — so adding a call site in
    /// one stage cannot shift every later draw in an unrelated stage. Without
    /// this, tuning one phase template silently re-rolls the whole account.
    fn substream(seed: u64, label: &str) -> Self {
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        for b in label.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Rng::new(seed ^ h)
    }
}

// =============================================================================
// §2.1 — America/New_York clock
// =============================================================================

/// Days from 1970-01-01 for a proleptic-Gregorian civil date (Howard Hinnant's
/// `days_from_civil`, the standard branch-free formulation).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday.
fn weekday(days: i64) -> i64 {
    (days + 4).rem_euclid(7)
}

/// `n`-th (1-based) `weekday` of a month, as days-from-epoch.
fn nth_weekday_of_month(y: i64, m: i64, wd: i64, n: i64) -> i64 {
    let first = days_from_civil(y, m, 1);
    let shift = (wd - weekday(first)).rem_euclid(7);
    first + shift + (n - 1) * 7
}

/// Whether a *local* America/New_York wall-clock instant is in daylight time.
///
/// Hand-rolled against the US federal rule in force since 2007 — DST runs from
/// 02:00 local on the second Sunday in March to 02:00 local on the first Sunday
/// in November — rather than adding `chrono-tz` (≈1 MB of IANA tables) to a
/// crate that ships a signed desktop binary, even as a dev-dependency.
///
/// The narrow scope is what makes that defensible: this generator only ever
/// *produces* timestamps for dates it chose itself, inside an anchor range this
/// function asserts on. It is not a general timezone conversion and must not be
/// reused as one. Anything outside 2007–2099 panics rather than silently
/// applying a rule that did not (or may not) hold — including the pre-2007
/// April/October rule, which is exactly the kind of one-hour-off drift §2.1
/// exists to prevent.
fn et_is_dst(local_days: i64, local_secs_of_day: i64) -> bool {
    let (y, _, _) = civil_from_days(local_days);
    assert!(
        (2007..2100).contains(&y),
        "et_is_dst: {y} is outside the 2007-2099 range this rule is asserted for \
         (see the function docs) — re-anchor inside the window or wire a real \
         IANA database"
    );
    let dst_start = nth_weekday_of_month(y, 3, 0, 2); // 2nd Sunday, March
    let dst_end = nth_weekday_of_month(y, 11, 0, 1); // 1st Sunday, November
    let after_start =
        local_days > dst_start || (local_days == dst_start && local_secs_of_day >= 2 * 3600);
    let before_end =
        local_days < dst_end || (local_days == dst_end && local_secs_of_day < 2 * 3600);
    after_start && before_end
}

/// ET wall-clock → Unix epoch seconds.
///
/// `secs_of_day` may exceed 86_400 — every set in this generator is described
/// as "the evening of day D", and a club night that runs to 02:30 is
/// `D + 26.5h`, not a second date the calendar has to carry. The DST decision
/// is made on the *resolved* local day so a set that crosses the spring-forward
/// boundary mid-night gets the right offset on each side.
fn et_to_epoch(days: i64, secs_of_day: i64) -> i64 {
    let day = days + secs_of_day.div_euclid(86_400);
    let sod = secs_of_day.rem_euclid(86_400);
    let offset = if et_is_dst(day, sod) {
        -4 * 3600
    } else {
        -5 * 3600
    };
    day * 86_400 + sod - offset
}

/// Unix epoch seconds → ET wall clock, as `(days, secs_of_day)`.
fn epoch_to_et(epoch: i64) -> (i64, i64) {
    // Guess EDT, verify, fall back to EST. The two candidate offsets differ by
    // an hour, so at most one of them is self-consistent outside the ambiguous
    // fall-back hour — where EST is the correct (second) reading.
    for offset in [-4 * 3600i64, -5 * 3600] {
        let local = epoch + offset;
        let (days, sod) = (local.div_euclid(86_400), local.rem_euclid(86_400));
        let dst = et_is_dst(days, sod);
        if (dst && offset == -4 * 3600) || (!dst && offset == -5 * 3600) {
            return (days, sod);
        }
    }
    let local = epoch - 5 * 3600;
    (local.div_euclid(86_400), local.rem_euclid(86_400))
}

/// ISO-8601 with the resolved ET offset — the review-readable form of every
/// timestamp in the emitted artifacts.
fn et_iso(epoch: i64) -> String {
    let (days, sod) = epoch_to_et(epoch);
    let (y, m, d) = civil_from_days(days);
    let dst = et_is_dst(days, sod);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}{}",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        if dst { "-04:00" } else { "-05:00" }
    )
}

fn et_date(epoch: i64) -> String {
    let (days, _) = epoch_to_et(epoch);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn et_month(epoch: i64) -> String {
    let (days, _) = epoch_to_et(epoch);
    let (y, m, _) = civil_from_days(days);
    format!("{y:04}-{m:02}")
}

fn parse_ymd(s: &str) -> (i64, i64, i64) {
    let parts: Vec<i64> = s
        .split('-')
        .map(|p| p.parse().expect("--anchor must be YYYY-MM-DD"))
        .collect();
    assert_eq!(parts.len(), 3, "--anchor must be YYYY-MM-DD");
    (parts[0], parts[1], parts[2])
}

// =============================================================================
// Inputs
// =============================================================================

#[derive(Debug, Deserialize)]
struct CatalogRow {
    track_id: String,
    title: Option<String>,
    artist: Option<String>,
    bpm: Option<f64>,
    key_camelot: Option<String>,
    genre_raw: Option<String>,
    genre_normalized: Option<String>,
    subgenre: Option<String>,
    file_mtime: Option<i64>,
    #[serde(default)]
    crates: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Overlay {
    #[serde(default)]
    tracks: BTreeMap<String, OverlayFields>,
    #[serde(default)]
    no_identity: BTreeMap<String, OverlayFields>,
}

/// Every overlay correction category §4.2 names. All optional: an entry sets
/// only the fields it is correcting, and anything absent keeps the catalog's
/// value. `title`/`artist` are load-bearing (§4.3) — changing either re-mints
/// `track_id` through the production hash.
#[derive(Debug, Deserialize)]
struct OverlayFields {
    title: Option<String>,
    artist: Option<String>,
    bpm: Option<f64>,
    key_camelot: Option<String>,
    genre_raw: Option<String>,
    #[allow(dead_code)]
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Duplicates {
    near_miss_clusters: Vec<DupCluster>,
}

#[derive(Debug, Deserialize)]
struct DupCluster {
    members: Vec<DupMember>,
}

#[derive(Debug, Deserialize)]
struct DupMember {
    track_id: String,
}

// =============================================================================
// The playable pool
// =============================================================================

/// One catalog row after the overlay, ready to be sequenced.
#[derive(Debug, Clone)]
struct Track {
    id: String,
    title: String,
    artist: String,
    bpm: f64,
    camelot: CamelotKey,
    camelot_raw: String,
    genre_raw: Option<String>,
    genre_norm: String,
    subgenre: String,
    /// Library add-date — `file_mtime`, already anchor-shifted. Per the
    /// session brief: `tadd`/`uadd` is 91% bulk-copy junk (2025-04-20), file
    /// mtime survived the copy and spreads organically, and Arjun pre-approved
    /// the substitution (§11 risk 1).
    added_at: i64,
    crates: Vec<String>,
    /// Index into the near-miss cluster table (§4.3). Two members of one
    /// cluster are Clean/Dirty-style variants of one song — they stay split as
    /// separate identities (Arjun's ruling), but must never co-occur in a set.
    cluster: Option<usize>,
    /// Weighted-rotation base: how much June likes this record. Heavy-tailed,
    /// so the library grows workhorses and one-and-dones rather than a flat
    /// shuffle (§12, `/library-utilization`).
    affinity: f64,
}

/// One `sync_library_roster()` entry — the DJ's whole library, not just what
/// they played. Mirrors `SyncLibraryRosterEntryWire`.
///
/// This is deliberately every identifiable catalog row, including the ~800
/// with a genre the taxonomy files under `Other` and the handful with no BPM:
/// `/library-utilization` measures rotation size, one-and-done and the aging
/// shelf *against the whole library*, and a roster filtered down to what is
/// playable would quietly turn "you own 4,000 records and rotate 765" into a
/// much flatter, much less true picture.
#[derive(Debug, Clone, Serialize)]
struct RosterEntry {
    track_id: String,
    title: Option<String>,
    artist: Option<String>,
    added_at: Option<i64>,
    /// Already in the library when Curfew was installed. Not a branch
    /// condition anywhere downstream (`agingShelf.ts` is explicit about that)
    /// — it is what suppresses the add event, nothing more.
    is_baseline: bool,
    absent_at: Option<i64>,
}

/// One `sync_library_add_events()` row — mirrors `SyncLibraryAddEventWire`.
#[derive(Debug, Clone, Serialize)]
struct AddEvent {
    track_id: String,
    added_at: Option<i64>,
}

/// A track the catalog carries with a genuine gap — no BPM, or no key. Held
/// separately and spent against §9's mess budget rather than filtered out and
/// forgotten: the exclusion disclosures are a feature, and they need real
/// counts to render.
#[derive(Debug, Clone)]
struct MessTrack {
    id: String,
    title: String,
    artist: String,
    bpm: Option<f64>,
    camelot_raw: Option<String>,
    genre_raw: Option<String>,
    added_at: i64,
    cluster: Option<usize>,
}

// =============================================================================
// §5 calendar / §7 composition types
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Kind {
    Residency,
    Club,
    Private,
    Wedding,
    Soundcheck,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Residency => "residency",
            Kind::Club => "club",
            Kind::Private => "private",
            Kind::Wedding => "wedding",
            Kind::Soundcheck => "soundcheck",
        }
    }
}

/// One stretch of a night with its own pacing, tempo ramp, and crate bias.
///
/// Pacing is the whole segment story (§8). `stats::segments` gates a dancefloor
/// candidate on **window density** (plays per 10 minutes) before it looks at
/// anything else, so "the dancefloor" is not a label the generator applies —
/// it is what a stretch of 170-second records *is*, next to a warm-up of
/// 7-minute ones. Every intended segment in this file is expressed as pace,
/// never asserted.
#[derive(Debug, Clone, Copy)]
struct Phase {
    minutes: f64,
    /// Mean start-to-start seconds inside the phase.
    pace_sec: f64,
    bpm_start: f64,
    bpm_end: f64,
    bias: Bias,
    /// Silence after this phase's last record, in seconds. ≥300 makes the set
    /// confidently classifiable (`confidence.rs`'s long-gap test); ≥1200 hard-
    /// breaks a detector run and is how a two-segment night is built.
    break_after_sec: i64,
}

/// Which corner of the library a phase pulls from, on top of the period's own
/// crate palette (§6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bias {
    /// The period palette, unmodified.
    Period,
    /// Warm-up/cocktail material: lower tempo, vocal, open-format.
    Cocktail,
    /// §7.2's deliberate mid-set hip-hop dip.
    HipHopDip,
    /// Bollywood/Bhangra/Punjabi and the crates they sit next to (§7.4).
    Bolly,
    /// Bollywood material at cocktail tempo — the wedding's dinner hour.
    BollyCocktail,
}

#[derive(Debug, Clone)]
struct SetPlan {
    session_identity: String,
    kind: Kind,
    tier: u8,
    /// Human name — only Tier 1 sets get one; it is review scaffolding, and
    /// nothing downstream keys on it (there is no venue field, §5).
    label: Option<String>,
    /// Local ET date of the *evening* the set belongs to.
    day: i64,
    /// Seconds after local midnight of `day` for the first record.
    start_sod: i64,
    phases: Vec<Phase>,
    /// §7.3 target for this set.
    camelot_target: f64,
    /// §9: deliberately dense and gapless, so `confidence::classify` reads it
    /// as ambiguous. Never Tier 1, never after mid-June.
    low_confidence: bool,
    /// What the pacing was built to produce (§8) — checked against the real
    /// detector, never substituted for it.
    intended_segments: u8,
    /// Whether the signature track gets its recurring slot in this set.
    signature: bool,
}

// =============================================================================
// Tuning block — every number §5–§9 turns on, in one place
// =============================================================================

/// Canonical window (§2): the anchor is its last day, and `--anchor` slides the
/// whole thing by whole local days.
const CANON_START: (i64, i64, i64) = (2026, 1, 6);
const CANON_ANCHOR: (i64, i64, i64) = (2026, 8, 10);

/// §5's three-week break in late April: no sets on these local days.
const GAP_START: (i64, i64, i64) = (2026, 4, 13);
const GAP_END: (i64, i64, i64) = (2026, 5, 3);

const DEFAULT_SEED: u64 = 2026_0812;

/// §7.3. Tier 1 is hand-designed and mixed harmonically; the wedding sets are
/// cut, not blended; everything else ramps across the window — January is the
/// spec's ~45% archive number and August is a DJ who has spent seven months
/// getting better at it, which is also the honest way to hold the account-wide
/// ~50% (see the verification report's note).
const CAMELOT_TIER1: f64 = 0.615;
const CAMELOT_WEDDING: f64 = 0.35;
const CAMELOT_ARCHIVE_START: f64 = 0.45;
const CAMELOT_ARCHIVE_END: f64 = 0.535;

/// §9 mess budget.
const MESS_NULL_TITLES: usize = 8;
const MESS_NO_BPM: usize = 9;
const MESS_NO_KEY: usize = 7;
const LOW_CONFIDENCE_SETS: usize = 5;

/// §12 `/track/[track_id]`: the signature track plays at the same time of
/// night every time, in this many sets, with these many recurring neighbours.
const SIGNATURE_TITLE: &str = "Move (Clean Extended)";
const SIGNATURE_ARTIST: &str = "Adam Port & Stryv ft Camila Cabello";
const SIGNATURE_SET_COUNT: usize = 34;
const SIGNATURE_TARGET_SOD: i64 = 24 * 3600 + 40 * 60; // 00:40 the next morning
const SIGNATURE_JITTER_SEC: i64 = 14 * 60;
/// All four must have been in the library **before** the window opens —
/// otherwise the add-date invariant silently blocks them for the first half of
/// the year and the "recurring cast" §12 asks for never becomes recurring. The
/// first pick here included two records added in June 2026 and produced
/// exactly two recurring neighbours instead of four. Two are harmonically
/// compatible with the signature's `1A` and two are not, which is the honest
/// ~50% §7.3 describes rather than four smooth transitions in a row.
const SIGNATURE_NEIGHBOURS: [(&str, &str); 4] = [
    (
        "DtMF (J Rythm Afro House Edit) (Clean Short Edit)",
        "Bad Bunny",
    ),
    ("Another World (HUGEL Remix) (Clean Extended)", "MEDUZA"),
    (
        "Loosen Up (Clean Short Edit)",
        "HUGEL & Dawty ft Preston Harris",
    ),
    (
        "All The Stars (Stoon Afroedit) (Dirty Extended)",
        "Kendrick Lamar & SZA",
    ),
];

/// §6's genre arc, as a per-period target mix over *plays*. The drift is
/// produced by which crates get sampled when (`palette`) — these numbers only
/// steer the sampler when a palette is broad enough to drift off them.
fn genre_targets(period: Period) -> &'static [(&'static str, f64)] {
    match period {
        Period::JanMar => &[
            ("Pop", 0.30),
            ("Hip-Hop", 0.25),
            ("House", 0.15),
            ("R&B", 0.12),
            ("Latin", 0.08),
        ],
        Period::AprMay => &[
            ("House", 0.28),
            ("Pop", 0.22),
            ("Hip-Hop", 0.22),
            ("Afrobeats", 0.04),
            ("Latin", 0.07),
        ],
        Period::JunAug => &[
            ("House", 0.38),
            ("Hip-Hop", 0.18),
            ("Pop", 0.14),
            ("Afrobeats", 0.05),
            ("Latin", 0.06),
        ],
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Period {
    JanMar,
    AprMay,
    JunAug,
}

impl Period {
    fn of(epoch: i64, window_start: i64) -> Self {
        let week = (epoch - window_start) / (7 * 86_400);
        match week {
            w if w < 13 => Period::JanMar,
            w if w < 21 => Period::AprMay,
            _ => Period::JunAug,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Period::JanMar => "Jan-Mar",
            Period::AprMay => "Apr-May",
            Period::JunAug => "Jun-Aug",
        }
    }
}

/// §6: the crate palette per period. A track's weight is the highest-weighted
/// palette entry any of its crates matches (prefix match, so `Hip Hop > A Hip
/// Hop > 2024+` inherits `Hip Hop`). A track in no palette crate is not a
/// candidate at all — which is what makes this a *crate* arc rather than a
/// genre histogram (§6).
fn palette(period: Period) -> &'static [(&'static str, f64)] {
    match period {
        // Open-format: the Pop and Hip Hop crates carry the night, with Club
        // and Spanish for texture and only a sliver of House.
        Period::JanMar => &[
            ("Pop", 1.00),
            ("Hip Hop > A Hip Hop", 0.85),
            ("Hip Hop > Old School", 0.45),
            ("Hip Hop > HH Open", 0.35),
            ("Club", 0.55),
            ("Club > Frat", 0.30),
            ("Spanish", 0.40),
            ("Dance pop", 0.35),
            ("EDM", 0.25),
            ("House", 0.22),
            ("Oldies", 0.12),
            ("Beats", 0.15),
            ("Indian", 0.10),
        ],
        // House climbing, Afro house appears at all, Pop receding.
        Period::AprMay => &[
            ("House", 0.75),
            ("House > Afro house", 0.70),
            ("FL Afrohouse set", 0.45),
            ("House > Tech House", 0.55),
            ("Pop", 0.62),
            ("Hip Hop > A Hip Hop", 0.62),
            ("Hip Hop > Old School", 0.25),
            ("Club", 0.45),
            ("EDM", 0.30),
            ("Spanish", 0.30),
            ("Dance pop", 0.20),
            ("Indian", 0.10),
        ],
        // A house DJ. Afro House and Tech House are the top subgenres.
        Period::JunAug => &[
            ("House > Afro house", 1.00),
            ("House > Tech House", 0.90),
            ("FL Afrohouse set", 0.70),
            ("House", 0.80),
            ("today", 0.35),
            ("Hip Hop > A Hip Hop", 0.45),
            ("Pop", 0.38),
            ("Club", 0.30),
            ("EDM", 0.22),
            ("Spanish", 0.22),
            ("Indian", 0.10),
        ],
    }
}

/// Crates a phase's [`Bias`] over-weights on top of the period palette.
fn bias_crates(bias: Bias) -> &'static [(&'static str, f64)] {
    match bias {
        Bias::Period => &[],
        Bias::Cocktail => &[
            ("Pop > Cocktail", 3.0),
            ("Pop > theo bacjground", 2.5),
            ("Oldies", 2.0),
            ("Pop", 1.4),
        ],
        Bias::HipHopDip => &[
            ("Hip Hop > A Hip Hop", 3.0),
            ("Hip Hop > Old School", 2.5),
            ("Hip Hop > HH Headline", 2.0),
            ("Club > Frat", 1.5),
        ],
        Bias::Bolly => &[
            ("Indian", 7.0),
            ("Indian > Punjabi", 6.0),
            ("Indian > Dance", 5.5),
            ("Bolly House", 5.5),
            ("sets > A Sangeet 6.29", 5.0),
            ("Muslim", 4.0),
            ("Hip Hop > A Hip Hop", 0.6),
            ("House > Afro house", 0.5),
            ("Spanish", 0.4),
        ],
        Bias::BollyCocktail => &[
            ("Indian > A Indian", 3.5),
            ("Indian", 2.5),
            ("Pop > Cocktail", 1.5),
            ("Pop > theo bacjground", 1.2),
        ],
    }
}

// =============================================================================
// Phase templates (§5 shapes, §7.2 arcs)
// =============================================================================

fn phase(
    minutes: f64,
    pace_sec: f64,
    bpm_start: f64,
    bpm_end: f64,
    bias: Bias,
    break_after_sec: i64,
) -> Phase {
    Phase {
        minutes,
        pace_sec,
        bpm_start,
        bpm_end,
        bias,
        break_after_sec,
    }
}

/// §5 residency: 8:30pm, ~3h, slow build. §7.2's `92 → 108 → 120` shape, with
/// the last 35 minutes tightened to a real closing peak — the only way a
/// 28-track night ever clears the detector's density floor, and what a Thursday
/// residency actually does before last call.
fn residency_phases(rng: &mut Rng, segments: u8) -> Vec<Phase> {
    let mut v = vec![
        phase(58.0, 425.0, 92.0, 104.0, Bias::Cocktail, 0),
        phase(
            62.0,
            410.0,
            104.0,
            116.0,
            Bias::Period,
            rng.range(320.0, 500.0) as i64,
        ),
        phase(
            38.0,
            196.0,
            124.0,
            128.0,
            Bias::Period,
            rng.range(380.0, 600.0) as i64,
        ),
        phase(24.0, 340.0, 126.0, 116.0, Bias::Period, 0),
    ];
    if segments == 0 {
        // A night that never took off: the room stayed a bar. No stretch is
        // ever dense enough to be a dancefloor, which is a state §8 needs.
        v = vec![
            phase(64.0, 430.0, 92.0, 102.0, Bias::Cocktail, 0),
            phase(
                66.0,
                420.0,
                102.0,
                112.0,
                Bias::Period,
                rng.range(340.0, 560.0) as i64,
            ),
            phase(52.0, 415.0, 112.0, 118.0, Bias::Period, 0),
        ];
    }
    if segments == 2 {
        // Two peaks either side of a genuine break — the break is over the
        // detector's `IDLE_HARD_BREAK_SEC`, which is what makes it two rather
        // than one bridged run.
        v = vec![
            phase(50.0, 430.0, 92.0, 106.0, Bias::Cocktail, 0),
            phase(
                30.0,
                196.0,
                124.0,
                127.0,
                Bias::Period,
                rng.range(1500.0, 2100.0) as i64,
            ),
            phase(26.0, 420.0, 108.0, 116.0, Bias::Period, 0),
            phase(34.0, 194.0, 125.0, 129.0, Bias::Period, 0),
            phase(20.0, 350.0, 124.0, 116.0, Bias::Period, 0),
        ];
    }
    v
}

/// §5 club: 11pm, ~3.5h, peak-time. §7.2's `118 → 124 → 128 → 122` with the
/// intentional ~100bpm hip-hop dip at roughly 60% through.
fn club_phases(rng: &mut Rng, segments: u8, low_confidence: bool) -> Vec<Phase> {
    if low_confidence {
        // §9: dense, continuous, no long gap anywhere — `confidence.rs`'s
        // explicitly-named ambiguous case. Every pace stays under the
        // 300-second long-gap threshold, deliberately.
        return vec![
            phase(46.0, 258.0, 116.0, 122.0, Bias::Period, 0),
            phase(48.0, 235.0, 122.0, 126.0, Bias::Period, 0),
            phase(10.0, 200.0, 104.0, 108.0, Bias::HipHopDip, 0),
            phase(50.0, 195.0, 124.0, 128.0, Bias::Period, 0),
            phase(24.0, 262.0, 127.0, 121.0, Bias::Period, 0),
        ];
    }
    // §7.2's intentional ~100bpm hip-hop dip is **one record**, not a stretch
    // of them — measured, not assumed. A three-track dip was tried first and
    // put 21 of 35 club nights on two segments: detection gates a window on its
    // *median* BPM, so three sub-floor plays drag two consecutive windows under
    // the floor and `GAP_MERGE_WINDOWS = 1` can only bridge one of them. A
    // single throwback bomb dropped into a 126bpm window leaves that window's
    // median where it was, which is also how the move actually works on a
    // floor: one record, then straight back up.
    //
    // The second measured lesson is in the pacing *bands*. A "ride" phase at
    // 260s sat at ~2.3 plays per window — right on top of the personal density
    // floor — so window-to-window jitter flipped it above and below the gate
    // and fragmented one dancefloor into three runs. Pacing here is therefore
    // deliberately bimodal: warm-up and close sit near 1.5 plays/window and the
    // dancefloor near 3, with nothing parked in the marginal band between them.
    let mut v = vec![
        phase(
            58.0,
            420.0,
            113.0,
            119.0,
            Bias::Period,
            rng.range(300.0, 470.0) as i64,
        ),
        phase(46.0, 200.0, 124.0, 127.0, Bias::Period, 0),
        phase(4.0, 210.0, 100.0, 104.0, Bias::HipHopDip, 0),
        phase(
            52.0,
            190.0,
            126.0,
            129.0,
            Bias::Period,
            rng.range(420.0, 650.0) as i64,
        ),
        phase(30.0, 340.0, 127.0, 119.0, Bias::Period, 0),
    ];
    if segments == 2 {
        v = vec![
            phase(52.0, 430.0, 113.0, 119.0, Bias::Period, 0),
            phase(
                44.0,
                200.0,
                125.0,
                128.0,
                Bias::Period,
                rng.range(1450.0, 1900.0) as i64,
            ),
            phase(20.0, 400.0, 104.0, 112.0, Bias::HipHopDip, 0),
            phase(48.0, 195.0, 126.0, 129.0, Bias::Period, 0),
            phase(26.0, 340.0, 127.0, 119.0, Bias::Period, 0),
        ];
    }
    if segments == 0 {
        v = vec![
            phase(
                68.0,
                435.0,
                112.0,
                119.0,
                Bias::Period,
                rng.range(340.0, 560.0) as i64,
            ),
            phase(70.0, 425.0, 119.0, 124.0, Bias::Period, 0),
            phase(48.0, 405.0, 122.0, 116.0, Bias::Period, 0),
        ];
    }
    v
}

/// §5 private: Sat 6–10pm, widest genre spread, §7.2's `85 → 128 → 95` swings.
fn private_phases(rng: &mut Rng, segments: u8) -> Vec<Phase> {
    let mut v = vec![
        phase(
            56.0,
            430.0,
            85.0,
            100.0,
            Bias::Cocktail,
            rng.range(900.0, 1150.0) as i64,
        ),
        phase(50.0, 420.0, 104.0, 118.0, Bias::Period, 0),
        phase(
            48.0,
            194.0,
            124.0,
            129.0,
            Bias::Period,
            rng.range(400.0, 620.0) as i64,
        ),
        phase(34.0, 370.0, 118.0, 95.0, Bias::Cocktail, 0),
    ];
    if segments == 0 {
        v = vec![
            phase(
                64.0,
                425.0,
                85.0,
                98.0,
                Bias::Cocktail,
                rng.range(600.0, 1100.0) as i64,
            ),
            phase(58.0, 405.0, 100.0, 112.0, Bias::Period, 0),
            phase(40.0, 375.0, 110.0, 95.0, Bias::Cocktail, 0),
        ];
    }
    if segments == 2 {
        v = vec![
            phase(40.0, 425.0, 85.0, 100.0, Bias::Cocktail, 0),
            phase(
                34.0,
                196.0,
                124.0,
                128.0,
                Bias::Period,
                rng.range(1400.0, 1850.0) as i64,
            ),
            phase(26.0, 400.0, 100.0, 110.0, Bias::Cocktail, 0),
            phase(40.0, 194.0, 125.0, 129.0, Bias::Period, 0),
            phase(24.0, 320.0, 116.0, 95.0, Bias::Cocktail, 0),
        ];
    }
    v
}

/// §7.4 Indian wedding dancefloor. Every number here is the signature the spec
/// asks to be left real rather than smoothed: 60–120s crowd-pleaser cuts, a
/// bimodal tempo map (bhangra at 95–105 and 140–155 against Bollywood pop at
/// 100–128), and ~35% key compatibility because you are cutting, not blending.
/// Only the dancefloor gets a segment (§8) — the cocktail hour is separated by
/// a real 25-minute break, which is also what keeps the set confidently
/// classifiable despite having no play longer than two minutes.
fn wedding_phases(rng: &mut Rng) -> Vec<Phase> {
    vec![
        phase(
            58.0,
            330.0,
            88.0,
            104.0,
            Bias::BollyCocktail,
            rng.range(1400.0, 1750.0) as i64,
        ),
        phase(62.0, 124.0, 124.0, 131.0, Bias::Bolly, 0),
        phase(34.0, 108.0, 133.0, 140.0, Bias::Bolly, 0),
        phase(16.0, 165.0, 134.0, 126.0, Bias::Bolly, 0),
    ]
}

/// §9's two soundchecks: below `HERO_MIN_TRACKS` and below the detector's
/// `MIN_PLAYS_FOR_DETECTION`, so they are archive-only and produce no segment
/// at all. Cueing gaps keep them confidently classifiable — they are mess, not
/// ambiguity.
fn soundcheck_phases() -> Vec<Phase> {
    vec![phase(18.0, 380.0, 118.0, 124.0, Bias::Period, 0)]
}

// =============================================================================
// Output shape
// =============================================================================

#[derive(Debug, Serialize)]
struct DemoSets {
    generator: GeneratorMeta,
    sets: Vec<DemoSet>,
}

#[derive(Debug, Serialize)]
struct GeneratorMeta {
    spec: &'static str,
    seed: u64,
    anchor: String,
    /// Whole local days every generated timestamp — plays **and** library
    /// add-dates — was slid by, relative to the canonical window.
    anchor_shift_days: i64,
    timezone: &'static str,
    window_start_et: String,
    window_end_et: String,
    add_date_source: &'static str,
    taxonomy_version: u32,
    set_count: usize,
    play_count: usize,
}

#[derive(Debug, Serialize)]
struct DemoLibrary {
    generator: LibraryMeta,
    roster: Vec<RosterEntry>,
    add_events: Vec<AddEvent>,
}

#[derive(Debug, Serialize)]
struct LibraryMeta {
    spec: &'static str,
    anchor: String,
    anchor_shift_days: i64,
    install_at: i64,
    install_at_et: String,
    roster_count: usize,
    baseline_count: usize,
    add_event_count: usize,
    note: &'static str,
    excluded_no_identity: usize,
    total_catalogue_rows: usize,
}

#[derive(Debug, Serialize)]
struct EmittedFloors {
    density: f64,
    median_bpm: f64,
    smoothness: f64,
}

#[derive(Debug, Serialize)]
struct DemoSet {
    session_identity: String,
    kind: &'static str,
    tier: u8,
    label: Option<String>,
    started_at: i64,
    ended_at: i64,
    started_at_et: String,
    ended_at_et: String,
    /// What the pacing was designed to produce (§8). `derived.suggested_
    /// segments` is what the real detector actually found — the two are
    /// reported side by side and never reconciled by fiat.
    intended_segments: u8,
    low_confidence_by_design: bool,
    /// The per-DJ detection floors this session was actually scored against —
    /// `CalibrationPool::floors_before` over its predecessors, the same value
    /// the agent would have computed at capture time. Emitted because "why did
    /// this night get no dancefloor?" is otherwise unanswerable from the
    /// artifact alone, and the answer is always one of these three numbers.
    floors: EmittedFloors,
    plays: Vec<CapturedPlay>,
    derived: CapturedDerived,
}

// =============================================================================
// main
// =============================================================================

fn main() {
    let mut catalog_dir = PathBuf::from("_bmad-output/demo-catalog");
    let mut anchor = CANON_ANCHOR;
    let mut seed = DEFAULT_SEED;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--catalog-dir" => {
                catalog_dir = PathBuf::from(args.next().expect("--catalog-dir needs a value"))
            }
            "--anchor" => anchor = parse_ymd(&args.next().expect("--anchor needs a value")),
            "--seed" => seed = args.next().expect("--seed needs a value").parse().unwrap(),
            other => panic!("unknown argument {other:?}"),
        }
    }

    let shift_days = days_from_civil(anchor.0, anchor.1, anchor.2)
        - days_from_civil(CANON_ANCHOR.0, CANON_ANCHOR.1, CANON_ANCHOR.2);

    // ---- Load -------------------------------------------------------------
    let catalog: Vec<CatalogRow> = read_json(&catalog_dir.join("demo-catalog.json"));
    let overlay: Overlay = read_json(&catalog_dir.join("demo-overlay.json"));
    let duplicates: Duplicates = read_json(&catalog_dir.join("duplicates.json"));
    eprintln!(
        "catalog {} rows | overlay {} track + {} no-identity corrections | {} near-miss clusters",
        catalog.len(),
        overlay.tracks.len(),
        overlay.no_identity.len(),
        duplicates.near_miss_clusters.len()
    );

    // The account's install moment. Everything already in the library at this
    // instant is production's silent first-run baseline (`LibraryScanOutcome`,
    // Story 4.2 D-1): it lands in the roster and emits **no** add event, which
    // is what keeps `/library-utilization`'s conversion cohorts a measure of
    // "how fast does new music reach a set" rather than a re-scored history.
    let window_start = et_to_epoch(
        days_from_civil(CANON_START.0, CANON_START.1, CANON_START.2) + shift_days,
        20 * 3600,
    );

    let (pool, mess, roster, overlay_report) = build_pool(
        &catalog,
        &overlay,
        &duplicates,
        shift_days,
        window_start,
        seed,
    );
    eprintln!(
        "pool {} playable | {} mess-budget rows | {} roster entries",
        pool.len(),
        mess.len(),
        roster.len()
    );

    // ---- Calendar and composition ----------------------------------------
    let plans = build_calendar(seed, shift_days);
    let composed = compose_all(&plans, &pool, &mess, window_start, seed);

    // ---- Assemble through production code --------------------------------
    let sets = assemble_all(&plans, &composed, &pool, &mess);

    // ---- Emit -------------------------------------------------------------
    let play_count: usize = sets.iter().map(|s| s.plays.len()).sum();
    let out = DemoSets {
        generator: GeneratorMeta {
            spec: "_bmad-output/planning-artifacts/demo-account-spec.md §5-§10.4",
            seed,
            anchor: format!("{:04}-{:02}-{:02}", anchor.0, anchor.1, anchor.2),
            anchor_shift_days: shift_days,
            timezone: "America/New_York",
            window_start_et: et_date(sets.first().map(|s| s.started_at).unwrap_or(window_start)),
            window_end_et: et_date(sets.last().map(|s| s.started_at).unwrap_or(window_start)),
            add_date_source: "file_mtime (spec §11 risk 1 — tadd/uadd is 91% bulk-copy junk)",
            taxonomy_version: 3,
            set_count: sets.len(),
            play_count,
        },
        sets,
    };

    std::fs::write(
        catalog_dir.join("demo-sets.json"),
        serde_json::to_string_pretty(&out).expect("serializes"),
    )
    .expect("demo-sets.json writes");

    // §10's other two write paths. Emitted as their own artifact rather than
    // folded into `demo-sets.json`: stage 3 posts them through different RPCs
    // at a different point in the build order, and `sync_set` re-runs must not
    // drag a 4,000-row roster along with them.
    let add_events: Vec<AddEvent> = roster
        .iter()
        .filter(|e| !e.is_baseline)
        .map(|e| AddEvent {
            track_id: e.track_id.clone(),
            added_at: e.added_at,
        })
        .collect();
    let library = DemoLibrary {
        generator: LibraryMeta {
            spec: "_bmad-output/planning-artifacts/demo-account-spec.md §10",
            anchor: format!("{:04}-{:02}-{:02}", anchor.0, anchor.1, anchor.2),
            anchor_shift_days: shift_days,
            install_at: window_start,
            install_at_et: et_iso(window_start),
            roster_count: roster.len(),
            baseline_count: roster.iter().filter(|e| e.is_baseline).count(),
            add_event_count: add_events.len(),
            note: "roster -> sync_library_roster(); add_events -> \
                   sync_library_add_events(). Baseline rows carry no add event, \
                   matching capture::LibraryScanOutcome. `excludedNoIdentityCount` \
                   and `totalCatalogueRows` have no synced carrier yet (Story 4.11 \
                   AC-6) and are reported here for the record only.",
            excluded_no_identity: overlay_report.no_identity_minted,
            total_catalogue_rows: catalog.len(),
        },
        roster: roster.clone(),
        add_events,
    };
    std::fs::write(
        catalog_dir.join("demo-library.json"),
        serde_json::to_string_pretty(&library).expect("serializes"),
    )
    .expect("demo-library.json writes");

    std::fs::write(
        catalog_dir.join("demo-sets-tier1.md"),
        tier1_markdown(&out, &plans),
    )
    .expect("demo-sets-tier1.md writes");

    std::fs::write(
        catalog_dir.join("demo-sets-verification.md"),
        verification_markdown(&out, &plans, &pool, &library, window_start, &overlay_report),
    )
    .expect("demo-sets-verification.md writes");

    eprintln!(
        "wrote {} sets / {} plays to {}",
        out.sets.len(),
        play_count,
        catalog_dir.display()
    );
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> T {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("{} parses: {e}", path.display()))
}

// =============================================================================
// Pool construction — overlay application (§4.2/§4.3)
// =============================================================================

struct OverlayReport {
    applied_track_corrections: usize,
    no_identity_minted: usize,
    no_identity_merged: usize,
    no_identity_unusable: usize,
}

#[allow(clippy::type_complexity)]
fn build_pool(
    catalog: &[CatalogRow],
    overlay: &Overlay,
    duplicates: &Duplicates,
    shift_days: i64,
    install_at: i64,
    seed: u64,
) -> (Vec<Track>, Vec<MessTrack>, Vec<RosterEntry>, OverlayReport) {
    // Cluster membership first — keyed by the catalog's own ids, then re-keyed
    // as corrections re-mint them.
    let mut cluster_of: HashMap<String, usize> = HashMap::new();
    for (i, c) in duplicates.near_miss_clusters.iter().enumerate() {
        for m in &c.members {
            cluster_of.insert(m.track_id.clone(), i);
        }
    }

    // ---- Apply overlay corrections to catalog rows ------------------------
    #[derive(Clone)]
    struct Row {
        id: String,
        title: Option<String>,
        artist: Option<String>,
        bpm: Option<f64>,
        key: Option<String>,
        genre_raw: Option<String>,
        genre_norm: Option<String>,
        subgenre: Option<String>,
        mtime: Option<i64>,
        crates: Vec<String>,
        cluster: Option<usize>,
    }

    let mut applied = 0usize;
    let mut rows: Vec<Row> = Vec::with_capacity(catalog.len());
    for r in catalog {
        let fix = overlay.tracks.get(&r.track_id);
        if fix.is_some() {
            applied += 1;
        }
        let title = fix
            .and_then(|f| f.title.clone())
            .or_else(|| r.title.clone());
        let artist = fix
            .and_then(|f| f.artist.clone())
            .or_else(|| r.artist.clone());
        // §4.3: title/artist corrections are load-bearing — they re-mint the
        // identity through the production hash, never a locally-invented one.
        let id = track_id_from_title_artist(title.as_deref(), artist.as_deref())
            .unwrap_or_else(|| r.track_id.clone());
        let cluster = cluster_of
            .get(&r.track_id)
            .or_else(|| cluster_of.get(&id))
            .copied();
        rows.push(Row {
            id,
            title,
            artist,
            bpm: fix.and_then(|f| f.bpm).or(r.bpm),
            key: fix
                .and_then(|f| f.key_camelot.clone())
                .or_else(|| r.key_camelot.clone()),
            genre_raw: fix
                .and_then(|f| f.genre_raw.clone())
                .or_else(|| r.genre_raw.clone()),
            genre_norm: r.genre_normalized.clone(),
            subgenre: r.subgenre.clone(),
            mtime: r.file_mtime,
            crates: r.crates.clone(),
            cluster,
        });
    }

    // ---- Overlay `no_identity`: mint identity for path-keyed corrections ---
    //
    // These rows carry a corrected title/artist and nothing else: the stage-1
    // artifacts record no bpm/key/genre/mtime for a row that had no identity
    // (the extractor keyed its per-track metadata by `track_id`, which is
    // exactly what these rows lacked). A minted identity that merges into an
    // existing catalog row inherits that row's metadata and is playable; one
    // that does not is a title and an artist with no tempo, no key, no genre
    // and no add-date, and there is nothing to sequence it *by*. Those are
    // counted and reported, never invented — see the verification report.
    let existing: BTreeSet<String> = rows.iter().map(|r| r.id.clone()).collect();
    let mut merged = 0usize;
    let mut unusable = 0usize;
    for fields in overlay.no_identity.values() {
        match track_id_from_title_artist(fields.title.as_deref(), fields.artist.as_deref()) {
            Some(id) if existing.contains(&id) => merged += 1,
            Some(_) => unusable += 1,
            None => unusable += 1,
        }
    }

    // ---- Split into the playable pool and the §9 mess budget --------------
    let mut affinity_rng = Rng::substream(seed, "affinity");
    let mut pool = Vec::new();
    let mut mess = Vec::new();
    let mut roster: Vec<RosterEntry> = Vec::new();
    for r in rows {
        // Roster first, and from every identifiable row — a track with no BPM
        // is still a record the DJ owns.
        if let (Some(title), Some(artist), Some(mtime)) =
            (r.title.clone(), r.artist.clone(), r.mtime)
        {
            let added_at = mtime + shift_days * 86_400;
            roster.push(RosterEntry {
                track_id: r.id.clone(),
                title: Some(title),
                artist: Some(artist),
                added_at: Some(added_at),
                is_baseline: added_at < install_at,
                // Nothing in this account is ever removed from the library.
                // `absent_at` exists for a track that vanished from the
                // catalogue between scans, which is a state worth having in the
                // product and not one worth manufacturing for a screenshot.
                absent_at: None,
            });
        }
        let (Some(title), Some(artist), Some(mtime)) = (r.title.clone(), r.artist.clone(), r.mtime)
        else {
            continue;
        };
        let added_at = mtime + shift_days * 86_400;
        let camelot = r.key.as_deref().and_then(camelot::parse);
        let nameable = matches!(r.genre_norm.as_deref(), Some(g) if g != "Other");

        match (r.bpm, camelot, nameable) {
            (Some(bpm), Some(camelot), true) => {
                // A heavy tail: `u^3` puts most of the library near the floor
                // and a handful of records far above it, which is what makes a
                // workhorse a workhorse and leaves a real one-and-done tail
                // (§12, `/library-utilization`).
                let u = affinity_rng.unit();
                pool.push(Track {
                    id: r.id,
                    title,
                    artist,
                    bpm,
                    camelot,
                    camelot_raw: r.key.clone().unwrap_or_default(),
                    genre_raw: r.genre_raw,
                    genre_norm: r.genre_norm.unwrap_or_else(|| "Other".into()),
                    subgenre: r.subgenre.unwrap_or_else(|| "Other".into()),
                    added_at,
                    crates: r.crates,
                    cluster: r.cluster,
                    affinity: 0.12 + 4.2 * u * u * u,
                });
            }
            // Real gaps in the real catalog: no BPM, or no parseable key.
            // Spent against §9's budget so the exclusion disclosures render
            // with honest counts.
            (bpm, key, _) if bpm.is_none() || key.is_none() => {
                mess.push(MessTrack {
                    id: r.id,
                    title,
                    artist,
                    bpm,
                    camelot_raw: r.key,
                    genre_raw: r.genre_raw,
                    added_at,
                    cluster: r.cluster,
                });
            }
            _ => {}
        }
    }
    pool.sort_by(|a, b| a.id.cmp(&b.id));
    mess.sort_by(|a, b| a.id.cmp(&b.id));
    roster.sort_by(|a, b| a.track_id.cmp(&b.track_id));
    // An overlay title/artist correction re-mints `track_id` (§4.3), so a
    // careless pair of corrections could fold two different records onto one
    // identity — which downstream would look like a single track that
    // mysteriously has two tempos. Caught here rather than discovered on a
    // track-detail page.
    for w in pool.windows(2) {
        assert_ne!(
            w[0].id, w[1].id,
            "overlay corrections collapsed two catalog rows onto one identity: \
             {:?} / {:?} both hash to {}",
            w[0].title, w[1].title, w[0].id
        );
    }

    (
        pool,
        mess,
        roster,
        OverlayReport {
            applied_track_corrections: applied,
            no_identity_minted: overlay.no_identity.len(),
            no_identity_merged: merged,
            no_identity_unusable: unusable,
        },
    )
}

// =============================================================================
// §5 — the calendar
// =============================================================================

fn build_calendar(seed: u64, shift_days: i64) -> Vec<SetPlan> {
    let mut rng = Rng::substream(seed, "calendar");
    let start = days_from_civil(CANON_START.0, CANON_START.1, CANON_START.2);
    let end = days_from_civil(CANON_ANCHOR.0, CANON_ANCHOR.1, CANON_ANCHOR.2);
    let gap_start = days_from_civil(GAP_START.0, GAP_START.1, GAP_START.2);
    let gap_end = days_from_civil(GAP_END.0, GAP_END.1, GAP_END.2);
    let in_gap = |d: i64| (gap_start..=gap_end).contains(&d);

    // Which nights happen, before any shaping. §5's counts: ~28 Thursday
    // residencies, ~34 Fri/Sat club nights, ~12 private events, 2 soundchecks.
    struct Slot {
        day: i64,
        kind: Kind,
    }
    let mut slots: Vec<Slot> = Vec::new();
    let mut week = 0i64;
    let mut d = start;
    while d <= end {
        let wd = weekday(d);
        if !in_gap(d) {
            match wd {
                4 => slots.push(Slot {
                    day: d,
                    kind: Kind::Residency,
                }), // Thursday
                5 => {
                    // Friday club a bit over half the weeks.
                    if week % 2 == 0 || week % 7 == 1 {
                        slots.push(Slot {
                            day: d,
                            kind: Kind::Club,
                        });
                    }
                }
                6 => {
                    // Saturday: a club night most weeks, a private event on the
                    // rest — plus a handful of double-headers (an early private
                    // then straight to the club), which is what a working DJ's
                    // Saturday actually looks like.
                    let private = week % 5 == 1 || week % 7 == 3 || week % 9 == 5;
                    if private {
                        slots.push(Slot {
                            day: d,
                            kind: Kind::Private,
                        });
                    }
                    if !private || week % 10 == 6 {
                        slots.push(Slot {
                            day: d,
                            kind: Kind::Club,
                        });
                    }
                }
                _ => {}
            }
        }
        if wd == 6 {
            week += 1;
        }
        d += 1;
    }
    // Two soundchecks, on quiet weekdays.
    for (offset, _) in [(23i64, ()), (152, ())] {
        slots.push(Slot {
            day: start + offset,
            kind: Kind::Soundcheck,
        });
    }
    slots.sort_by_key(|s| (s.day, s.kind.label()));

    // The two Indian weddings (§7.4) — one in the open-format winter, one in
    // the June wedding season, so the set-detail page that looks unlike every
    // other set in the archive is reachable from both ends of the timeline.
    let private_days: Vec<i64> = slots
        .iter()
        .filter(|s| s.kind == Kind::Private)
        .map(|s| s.day)
        .collect();
    let wedding_days: BTreeSet<i64> = [
        private_days.get(1).copied(),
        private_days
            .get(private_days.len().saturating_sub(3))
            .copied(),
    ]
    .into_iter()
    .flatten()
    .collect();

    // §8's distribution, assigned before composition so the pacing can be built
    // to produce it: ~9 sets with no dancefloor at all (the two soundchecks are
    // two of them, by being under the detection floor), ~14 with two.
    let total = slots.len();
    let mut zero: BTreeSet<usize> = BTreeSet::new();
    let mut two: BTreeSet<usize> = BTreeSet::new();
    {
        // Zero-segment nights skew early (thin history means strict floors) and
        // toward private cocktail events, which is where they honestly belong.
        let mut candidates: Vec<usize> = (0..total)
            .filter(|&i| slots[i].kind != Kind::Soundcheck && slots[i].kind != Kind::Wedding)
            .collect();
        candidates.sort_by_key(|&i| (slots[i].day, i));
        let early: Vec<usize> = candidates.iter().copied().take(total / 3).collect();
        while zero.len() < 4 && !early.is_empty() {
            zero.insert(early[rng.below(early.len())]);
        }
        let mut pick = 0usize;
        // Fewer *designed* two-segment nights than §8 wants, because the
        // detector reliably finds extra ones on its own: a club night whose
        // dancefloor dips under the density or BPM floor for two consecutive
        // windows splits without being asked to. Designing 14 landed 21.
        while two.len() < 9 && pick < 4000 {
            pick += 1;
            let i = candidates[rng.below(candidates.len())];
            if !zero.contains(&i) && !wedding_days.contains(&slots[i].day) {
                two.insert(i);
            }
        }
    }

    // §9: five low-confidence sets, all before mid-June, none Tier 1.
    let mid_june = days_from_civil(2026, 6, 15);
    let mut low_conf: BTreeSet<usize> = BTreeSet::new();
    {
        let candidates: Vec<usize> = (0..total)
            .filter(|&i| {
                slots[i].kind == Kind::Club
                    && slots[i].day < mid_june
                    && !zero.contains(&i)
                    && !two.contains(&i)
            })
            .collect();
        let mut pick = 0usize;
        while low_conf.len() < LOW_CONFIDENCE_SETS && pick < 4000 && !candidates.is_empty() {
            pick += 1;
            low_conf.insert(candidates[rng.below(candidates.len())]);
        }
    }

    // §12: the signature track's sets — club nights (and the late half of a
    // double-header) whose span covers ~00:40, spread across all seven months.
    let signature_pool: Vec<usize> = (0..total)
        .filter(|&i| slots[i].kind == Kind::Club)
        .collect();
    let signature: BTreeSet<usize> = if signature_pool.len() <= SIGNATURE_SET_COUNT {
        signature_pool.iter().copied().collect()
    } else {
        // Even stride, so "every seven months" is literally true rather than a
        // clump the PRNG happened to produce.
        let stride = signature_pool.len() as f64 / SIGNATURE_SET_COUNT as f64;
        (0..SIGNATURE_SET_COUNT)
            .map(|k| signature_pool[((k as f64 + 0.5) * stride) as usize % signature_pool.len()])
            .collect()
    };

    // Tier 1 (§7.1): the six hand-designed sets.
    let last_club = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.kind == Kind::Club)
        .map(|(i, _)| i)
        .next_back()
        .expect("a club night exists");
    let july_club = slots
        .iter()
        .enumerate()
        .filter(|(i, s)| {
            s.kind == Kind::Club
                && s.day >= days_from_civil(2026, 7, 1)
                && s.day < days_from_civil(2026, 7, 26)
                && *i != last_club
                && !two.contains(i)
                && !zero.contains(i)
        })
        .map(|(i, _)| i)
        .next_back()
        .expect("a July club night exists");
    let july_residency = slots
        .iter()
        .enumerate()
        .filter(|(i, s)| {
            s.kind == Kind::Residency
                && s.day >= days_from_civil(2026, 7, 1)
                && s.day < days_from_civil(2026, 8, 1)
                && !two.contains(i)
                && !zero.contains(i)
        })
        .map(|(i, _)| i)
        .next_back()
        .expect("a July residency exists");
    let march_club = slots
        .iter()
        .enumerate()
        .filter(|(i, s)| {
            s.kind == Kind::Club
                && s.day >= days_from_civil(2026, 3, 1)
                && s.day < days_from_civil(2026, 3, 29)
                && !two.contains(i)
                && !zero.contains(i)
                && !low_conf.contains(i)
        })
        .map(|(i, _)| i)
        .next_back()
        .expect("a March club night exists");

    let tier1_labels: BTreeMap<usize, &str> = [
        (last_club, "Dashboard hero — the most recent night"),
        (july_club, "Set detail — peak-time club"),
        (july_residency, "Set detail — residency slow build"),
        (march_club, "Signature track — the early-window link"),
    ]
    .into_iter()
    .collect();

    // §5: `session_identity` is a plausibly increasing `serato4:NNN` run —
    // increments of 1–3, because a real Serato counter also burns numbers on
    // bedroom sessions that never became sets.
    let mut identity = 1_147u32;
    let mut plans = Vec::with_capacity(total);
    for (i, slot) in slots.iter().enumerate() {
        identity += 1 + rng.below(3) as u32;
        let is_wedding = slot.kind == Kind::Private && wedding_days.contains(&slot.day);
        let kind = if is_wedding { Kind::Wedding } else { slot.kind };
        let low_confidence = low_conf.contains(&i);
        let intended: u8 = if kind == Kind::Soundcheck {
            0
        } else if kind == Kind::Wedding {
            1
        } else if zero.contains(&i) {
            0
        } else if two.contains(&i) {
            2
        } else {
            1
        };

        let mut phase_rng = Rng::substream(seed, &format!("phases:{i}"));
        let phases = match kind {
            Kind::Residency => residency_phases(&mut phase_rng, intended),
            Kind::Club => club_phases(&mut phase_rng, intended, low_confidence),
            Kind::Private => private_phases(&mut phase_rng, intended),
            Kind::Wedding => wedding_phases(&mut phase_rng),
            Kind::Soundcheck => soundcheck_phases(),
        };

        // §5's start times, with a few minutes of human jitter.
        let start_sod = match kind {
            Kind::Residency => 20 * 3600 + 30 * 60 + phase_rng.below(14 * 60) as i64,
            Kind::Club => 23 * 3600 + phase_rng.below(22 * 60) as i64,
            Kind::Private | Kind::Wedding => 18 * 3600 + phase_rng.below(20 * 60) as i64,
            Kind::Soundcheck => 16 * 3600 + phase_rng.below(90 * 60) as i64,
        };

        let (tier, label) = if let Some(l) = tier1_labels.get(&i) {
            (1u8, Some((*l).to_string()))
        } else if kind == Kind::Wedding {
            (
                1u8,
                Some("Set detail — Indian wedding dancefloor".to_string()),
            )
        } else if slot.day >= end - 44 {
            // §7.1 Tier 2: everything in the last ~6 weeks, plus the archive
            // cards a dashboard shows without scrolling.
            (2u8, None)
        } else {
            (3u8, None)
        };

        let camelot_target = if tier == 1 && kind != Kind::Wedding {
            CAMELOT_TIER1
        } else if kind == Kind::Wedding {
            CAMELOT_WEDDING
        } else {
            let t = (slot.day - start) as f64 / (end - start).max(1) as f64;
            CAMELOT_ARCHIVE_START + t * (CAMELOT_ARCHIVE_END - CAMELOT_ARCHIVE_START)
        };

        plans.push(SetPlan {
            session_identity: format!("serato4:{identity}"),
            kind,
            tier,
            label,
            day: slot.day + shift_days,
            start_sod,
            phases,
            camelot_target,
            low_confidence,
            intended_segments: intended,
            signature: signature.contains(&i) && kind != Kind::Soundcheck,
        });
    }
    plans
}

// =============================================================================
// §7 — set composition
// =============================================================================

/// One generated play before it reaches production code.
#[derive(Debug, Clone)]
struct Slotted {
    /// Index into the pool, or — for a mess-budget row — into the mess list.
    source: Source,
    start: i64,
    /// Start-to-start spacing to the next record — the pacing knob everything
    /// in §8 turns on (window density) and §9 reads (`confidence.rs`'s
    /// long-gap test). Consumed as it is produced (it advances the cursor);
    /// retained on the row so a composed set can be inspected in a debugger
    /// without re-deriving it from adjacent start times.
    #[allow(dead_code)]
    spacing: i64,
    /// How long the record was actually on air, which is **not** the same
    /// number. A sparse warm-up phase spaces records 7 minutes apart; setting
    /// `played_ms` to the spacing would claim an 11-minute record, and
    /// `played_ms` is rendered directly ("played 4:12"). Capped at a real
    /// extended-mix length instead, with the remainder becoming genuine
    /// silence between records — which is also what the detector's idle-gap
    /// labels are describing.
    on_air: i64,
    /// §9: this play's title is dropped, so it has no identity at all (§4.3).
    null_title: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Pool(usize),
    Mess(usize),
}

struct RotationState {
    /// Last time each pool track was played — the cooldown that keeps a set
    /// from being the same twelve records every week.
    last_played: HashMap<usize, i64>,
    plays: HashMap<usize, usize>,
}

fn compose_all(
    plans: &[SetPlan],
    pool: &[Track],
    mess: &[MessTrack],
    window_start: i64,
    seed: u64,
) -> Vec<Vec<Slotted>> {
    let signature_idx = find_track(pool, SIGNATURE_TITLE, SIGNATURE_ARTIST);
    let neighbours: Vec<usize> = SIGNATURE_NEIGHBOURS
        .iter()
        .map(|(t, a)| find_track(pool, t, a))
        .collect();

    let mut state = RotationState {
        last_played: HashMap::new(),
        plays: HashMap::new(),
    };
    // §6 is measured per period over the whole period, so the deficit steering
    // has to accumulate across sets rather than reset every night.
    let mut period_counts: BTreeMap<(String, String), usize> = BTreeMap::new();

    let mut out = Vec::with_capacity(plans.len());
    for (i, plan) in plans.iter().enumerate() {
        let mut rng = Rng::substream(seed, &format!("compose:{i}"));
        let set = compose_set(
            plan,
            pool,
            &mut state,
            &mut period_counts,
            window_start,
            signature_idx,
            &neighbours,
            &mut rng,
        );
        out.push(set);
    }

    // §9's mess budget, spent last so it lands on already-composed archive sets
    // and can never touch a Tier 1 tracklist.
    apply_mess_budget(plans, &mut out, pool, mess, seed);
    out
}

fn find_track(pool: &[Track], title: &str, artist: &str) -> usize {
    pool.iter()
        .position(|t| t.title == title && t.artist == artist)
        .unwrap_or_else(|| panic!("hand-picked track not in the pool: {artist} — {title}"))
}

/// The per-position candidate score. Every factor is multiplicative and
/// documented, so a tracklist that reads wrong can be traced to one term.
#[allow(clippy::too_many_arguments)]
fn compose_set(
    plan: &SetPlan,
    pool: &[Track],
    state: &mut RotationState,
    period_counts: &mut BTreeMap<(String, String), usize>,
    window_start: i64,
    signature_idx: usize,
    neighbours: &[usize],
    rng: &mut Rng,
) -> Vec<Slotted> {
    let set_start = et_to_epoch(plan.day, plan.start_sod);
    let period = Period::of(set_start, window_start);
    let pal = palette(period);
    let targets = genre_targets(period);
    let period_key = period.label().to_string();

    // Precompute this period's palette weight per track once per set.
    let mut base_weight: Vec<f64> = vec![0.0; pool.len()];
    for (i, t) in pool.iter().enumerate() {
        base_weight[i] = palette_weight(&t.crates, pal);
    }

    let mut chosen: Vec<Slotted> = Vec::new();
    let mut used_ids: BTreeSet<usize> = BTreeSet::new();
    let mut used_clusters: BTreeSet<usize> = BTreeSet::new();
    // On a night the signature track is going to land, reserve its near-miss
    // cluster up front. Otherwise the sequencer is free to pick the record's
    // `(BeatBreaker Edit)` twin, and the only collision-free slot left for the
    // signature is wherever that twin happened to go — which is how the
    // "consistent time of night" §12 asks for became a two-hour spread.
    if plan.signature {
        if let Some(c) = pool[signature_idx].cluster {
            used_clusters.insert(c);
        }
    }
    // The signature record is *only* ever placed (below), never sequenced. It
    // is an ordinary pool track otherwise, and letting the sampler pick it too
    // was what smeared §12's "consistent time of night" across two hours: a
    // 9pm residency warm-up copy counts on the track-detail page exactly like
    // the 00:40 club copy does.
    used_ids.insert(signature_idx);
    let mut cursor = set_start;
    let mut prev: Option<usize> = None;
    let mut compatible_seen = 0usize;
    let mut transitions_seen = 0usize;

    for ph in &plan.phases {
        let phase_secs = (ph.minutes * 60.0) as i64;
        let n = ((ph.minutes * 60.0 / ph.pace_sec).round() as i64).max(1) as usize;
        let bias = bias_crates(ph.bias);
        for k in 0..n {
            let frac = if n <= 1 {
                0.0
            } else {
                k as f64 / (n - 1) as f64
            };
            let target_bpm = ph.bpm_start + frac * (ph.bpm_end - ph.bpm_start);

            // §7.3: decide what this transition should *be* before looking for
            // a record that is it, so the achieved rate tracks the target
            // instead of falling out of whatever the crate happened to hold.
            let want_compatible = if transitions_seen == 0 {
                true
            } else {
                let achieved = compatible_seen as f64 / transitions_seen as f64;
                if achieved < plan.camelot_target {
                    rng.chance(0.85)
                } else {
                    rng.chance(0.18)
                }
            };

            let pick = pick_track(
                pool,
                &base_weight,
                bias,
                targets,
                period_counts,
                &period_key,
                plan.kind,
                plan.tier,
                target_bpm,
                prev.map(|p| pool[p].camelot),
                want_compatible,
                cursor,
                state,
                &used_ids,
                &used_clusters,
                rng,
            );
            let Some(pick) = pick else { continue };

            if let Some(p) = prev {
                transitions_seen += 1;
                if camelot::compatible(pool[p].camelot, pool[pick].camelot) {
                    compatible_seen += 1;
                }
            }

            // Pace jitter: real records are not all the same length, and a
            // perfectly even cadence is the single most generated-looking thing
            // a tracklist can do. On a §9 low-confidence set the jitter is
            // clamped under `confidence.rs`'s 300-second long-gap threshold —
            // one 310-second record is all it takes to turn "dense and
            // continuous" back into "confidently classifiable."
            let mut spacing = (ph.pace_sec * rng.range(0.82, 1.18)).round() as i64;
            if plan.low_confidence {
                spacing = spacing.min(290);
            }
            let spacing = spacing.max(45);
            // The longest a record is allowed to claim it was on air. Extended
            // club mixes really do run past seven minutes; nothing runs eleven.
            let on_air = spacing.min(rng.range(330.0, 460.0) as i64);
            chosen.push(Slotted {
                source: Source::Pool(pick),
                start: cursor,
                spacing,
                on_air,
                null_title: false,
            });
            cursor += spacing;

            used_ids.insert(pick);
            if let Some(c) = pool[pick].cluster {
                used_clusters.insert(c);
            }
            state.last_played.insert(pick, cursor);
            *state.plays.entry(pick).or_default() += 1;
            *period_counts
                .entry((period_key.clone(), pool[pick].genre_norm.clone()))
                .or_default() += 1;
            prev = Some(pick);
            let _ = phase_secs;
        }
        cursor += ph.break_after_sec;
    }

    if plan.signature {
        place_signature(&mut chosen, pool, signature_idx, neighbours, state, rng);
    }
    chosen
}

/// A bare DJ tool rather than a record — an acapella or an instrumental with
/// nothing else going on in the title.
fn is_dj_tool(title: &str) -> bool {
    let t = title.to_lowercase();
    t.contains("(acapella)") || t.contains("(instrumental)") || t.contains("[instrumental]")
}

/// Highest-weighted palette entry any of a track's crates matches. Prefix
/// matching means a subcrate inherits its parent's weight (`Hip Hop > A Hip Hop
/// > 2024+` is Hip Hop), which is how §6's arc stays a statement about crates.
fn palette_weight(crates: &[String], pal: &[(&str, f64)]) -> f64 {
    let mut best = 0.0f64;
    for c in crates {
        for (prefix, w) in pal {
            if c == prefix || c.starts_with(&format!("{prefix} >")) {
                best = best.max(*w);
            }
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn pick_track(
    pool: &[Track],
    base_weight: &[f64],
    bias: &[(&str, f64)],
    targets: &[(&str, f64)],
    period_counts: &BTreeMap<(String, String), usize>,
    period_key: &str,
    kind: Kind,
    tier: u8,
    target_bpm: f64,
    prev_key: Option<CamelotKey>,
    want_compatible: bool,
    now: i64,
    state: &RotationState,
    used_ids: &BTreeSet<usize>,
    used_clusters: &BTreeSet<usize>,
    rng: &mut Rng,
) -> Option<usize> {
    let period_total: usize = period_counts
        .iter()
        .filter(|((p, _), _)| p == period_key)
        .map(|(_, n)| *n)
        .sum::<usize>()
        .max(1);

    // Two passes over the pool: the first refuses anything more than
    // `BPM_WINDOW` from the phase's target tempo, the second drops that guard
    // so a slot is never left unfilled.
    //
    // Without the guard, a Gaussian tempo term with a non-zero floor will
    // eventually seat a wildly off-tempo record — and it happens exactly where
    // it hurts most, at the tail of a set whose crate has been picked clean.
    // One 110bpm play landed in a 128bpm phase of the June wedding, and because
    // `GAP_MERGE_WINDOWS` bridges a single rough window, its 21.5-BPM
    // consecutive delta was pulled *inside* the dancefloor run and dragged the
    // run's median smoothness over the floor — turning a seven-window
    // dancefloor into no detected segment at all.
    // Tighter on a wedding. The detector's smoothness floor is this DJ's own
    // P60 consecutive-BPM delta, and by June that is ~3.3 BPM — calibrated on
    // house sets that beatmatch. A bimodal wedding is structurally the roughest
    // set in the account, so the only way its dancefloor clears a floor set by
    // everything else is to keep the scatter *inside* each tempo block small,
    // which is also how the cutting actually works: crowd-pleaser to
    // crowd-pleaser at a matched tempo, with the mode change made once.
    let bpm_window: f64 = if kind == Kind::Wedding { 7.0 } else { 13.0 };
    for pass in 0..2 {
        let strict = pass == 0;
        let mut scored: Vec<(usize, f64)> = Vec::with_capacity(256);
        for (i, t) in pool.iter().enumerate() {
            if strict && (t.bpm - target_bpm).abs() > bpm_window {
                continue;
            }
            if base_weight[i] <= 0.0 && palette_weight(&t.crates, bias) <= 0.0 {
                continue;
            }
            if used_ids.contains(&i) {
                continue;
            }
            if let Some(c) = t.cluster {
                if used_clusters.contains(&c) {
                    continue;
                }
            }
            // The hard invariant: nothing is ever played before the library had it.
            // The hour of slack absorbs the ET-vs-UTC-day difference between a
            // day-granular add-date and a wall-clock play time under a re-anchor.
            if t.added_at > now - 3600 {
                continue;
            }

            let mut score = base_weight[i].max(0.05) + palette_weight(&t.crates, bias);

            // Tempo fit — the energy arc is drawn from BPM (§7.2), so this is the
            // term that has to dominate.
            let d = (t.bpm - target_bpm) / 3.8;
            score *= (-0.5 * d * d).exp() + 0.004;

            // §7.3 harmonic intent.
            if let Some(pk) = prev_key {
                let compat = camelot::compatible(pk, t.camelot);
                score *= if compat == want_compatible { 1.0 } else { 0.16 };
            }

            // §6 steering. Ratio-based, not difference-based: the first version of
            // this was `1 + k·(want − have)`, and with `want = 0.12` the entire
            // correction a starved genre could earn was a factor of 1.2 — nowhere
            // near enough to pull R&B off 3% when its 45 eligible records are
            // competing against Pop's 408. A ratio says "you are at a third of
            // where you should be" and corrects by that much.
            //
            // Genres the period has no target for take a flat drag, so the broad
            // Electronica/Dance bucket cannot quietly eat the share §6 assigned to
            // named parents.
            if kind == Kind::Wedding {
                // §6's arc is a statement about June's *club* year, and applying it
                // to a wedding actively fought §7.4: Bollywood is in none of the
                // three period target lists, so it took the non-target drag while
                // House and Hip-Hop took a lift, and the first pass produced a
                // "wedding dancefloor" of Avicii, Showtek and Chief Keef. A wedding
                // is booked for the opposite reason, so it opts out of the arc and
                // steers on parentage instead — Bollywood as the spine, with the
                // Hip-Hop/Afrobeats/Reggaeton/House crossover §7.4 asks for left at
                // full weight around it.
                if t.genre_norm == "Bollywood" {
                    score *= 4.0;
                }
            } else {
                if let Some((_, want)) = targets.iter().find(|(g, _)| *g == t.genre_norm) {
                    let have = period_counts
                        .get(&(period_key.to_string(), t.genre_norm.clone()))
                        .copied()
                        .unwrap_or(0) as f64
                        / period_total as f64;
                    score *= (want / have.max(0.004)).powf(2.0).clamp(0.06, 10.0);
                } else {
                    score *= 0.55;
                }

                // §6's Jun–Aug line is specifically "House 38 (Afro House + Tech
                // House top subgenres)" — a statement about *subgenres*, which the
                // parent target alone cannot express: the generic `House` crate is
                // deep enough to satisfy House 38% without either ever surfacing.
                if period_key == "Jun-Aug"
                    && matches!(t.subgenre.as_str(), "Afro House" | "Tech House")
                {
                    score *= 1.7;
                }
            }

            // §9's rule, applied at the point it can still be obeyed: a bare
            // acapella or instrumental is a working tool, not a performance, and
            // three of them on the dashboard hero's tracklist reads like someone's
            // Serato folder rather than a night out. They stay in the archive,
            // where they are honest, and stay off the sets that get screenshotted.
            if tier == 1 && is_dj_tool(&t.title) {
                score *= 0.02;
            }

            score *= t.affinity;

            // Rotation cooldown.
            if let Some(last) = state.last_played.get(&i) {
                let days = (now - last) as f64 / 86_400.0;
                score *= match days {
                    d if d < 4.0 => 0.04,
                    d if d < 11.0 => 0.30,
                    d if d < 26.0 => 0.72,
                    _ => 1.0,
                };
            }

            // A new record gets hammered for the first few weekends, then
            // settles into the rotation — the behaviour
            // `/library-utilization`'s conversion cohorts exist to measure.
            // Two tiers rather than one flat 45-day boost: a single wide window
            // spread the lift so thinly that a small month-cohort (July has two
            // tracks) converted at 0%, which reads as a broken chart rather
            // than a quiet month.
            let age_days = (now - t.added_at) as f64 / 86_400.0;
            if age_days < 18.0 {
                score *= 6.5;
            } else if age_days < 60.0 {
                score *= 2.4;
            }

            if score > 0.0 {
                scored.push((i, score));
            }
        }
        if scored.is_empty() {
            continue;
        }
        // Total order (score desc, then id) so the shortlist is deterministic.
        scored.sort_by(|a, b| {
            b.1.total_cmp(&a.1)
                .then_with(|| pool[a.0].id.cmp(&pool[b.0].id))
        });
        scored.truncate(40);
        let total: f64 = scored.iter().map(|(_, s)| s).sum();
        let mut r = rng.unit() * total;
        for (i, s) in &scored {
            r -= s;
            if r <= 0.0 {
                return Some(*i);
            }
        }
        return Some(scored[0].0);
    }
    None
}

/// §12: the signature track lands at the same time of night every time, next to
/// one of a small recurring cast. Implemented as a substitution on the finished
/// sequence rather than a constraint inside it, so it can never distort the
/// energy arc it sits in — the slot it takes is chosen for clock time first and
/// tempo compatibility second.
fn place_signature(
    chosen: &mut [Slotted],
    pool: &[Track],
    signature: usize,
    neighbours: &[usize],
    state: &mut RotationState,
    rng: &mut Rng,
) {
    if chosen.is_empty() {
        return;
    }
    let already = chosen
        .iter()
        .any(|s| matches!(s.source, Source::Pool(i) if i == signature));
    if already {
        return;
    }
    let sig = &pool[signature];
    let target = {
        let (day, _) = epoch_to_et(chosen[0].start);
        let jitter = rng.range(-(SIGNATURE_JITTER_SEC as f64), SIGNATURE_JITTER_SEC as f64) as i64;
        et_to_epoch(day, SIGNATURE_TARGET_SOD + jitter)
    };
    // If the set already holds a near-miss variant of this record — the
    // `(BeatBreaker Edit)` of the same song, a separate identity that stays
    // split (§4.3) but must never co-occur — that slot *is* the signature's
    // slot. Substituting there rather than somewhere else is both the only way
    // to keep the one-per-cluster invariant and the musically right answer: it
    // is the same song, at the point in the night the sequencer already chose
    // for it.
    let collide = sig.cluster.and_then(|c| {
        chosen
            .iter()
            .position(|s| matches!(s.source, Source::Pool(i) if pool[i].cluster == Some(c)))
    });
    // Otherwise, the slot closest to the target clock time — tie-broken by how
    // near its tempo already is, so a 120bpm Afro House record is not dropped
    // into the middle of a 128bpm run just because the clock said so.
    let best = collide.or_else(|| {
        chosen
            .iter()
            .enumerate()
            .filter(|(_, s)| (s.start - target).abs() <= 40 * 60)
            .min_by_key(|(idx, s)| {
                let clock = (s.start - target).abs();
                let tempo = match s.source {
                    Source::Pool(i) => ((pool[i].bpm - sig.bpm).abs() * 45.0) as i64,
                    Source::Mess(_) => 0,
                };
                // A slot whose predecessor is harmonically compatible with the
                // signature's key is worth a few minutes of clock drift: this
                // record is the one a track-detail page is built around, and
                // landing it between two clash markers on the hero tracklist is
                // the most visible thing the placement can get wrong.
                let harmony = match idx.checked_sub(1).and_then(|k| match chosen[k].source {
                    Source::Pool(i) => Some(pool[i].camelot),
                    Source::Mess(_) => None,
                }) {
                    Some(prev) if camelot::compatible(prev, sig.camelot) => 0,
                    _ => 5 * 60,
                };
                clock + tempo + harmony
            })
            .map(|(i, _)| i)
    });
    let Some(at) = best else { return };
    if let Source::Pool(old) = chosen[at].source {
        if let Some(c) = state.plays.get_mut(&old) {
            *c = c.saturating_sub(1);
        }
    }
    chosen[at].source = Source::Pool(signature);
    *state.plays.entry(signature).or_default() += 1;
    state.last_played.insert(signature, chosen[at].start);

    // A recurring neighbour — §12 asks for 3–4 records that keep turning up
    // next to it. Both adjacent slots are tried before giving up: with only one
    // side attempted, most placements lost to an already-present copy or an
    // add-date that had not happened yet, and the cast never became recurring.
    let first = rng.below(2) == 0;
    let sides: [Option<usize>; 2] = if first {
        [at.checked_sub(1), (at + 1 < chosen.len()).then_some(at + 1)]
    } else {
        [(at + 1 < chosen.len()).then_some(at + 1), at.checked_sub(1)]
    };
    let offset = rng.below(neighbours.len());
    for k in 0..neighbours.len() {
        let n = neighbours[(offset + k) % neighbours.len()];
        for side in sides.into_iter().flatten() {
            let clash = chosen
                .iter()
                .any(|s| matches!(s.source, Source::Pool(i) if i == n))
                || pool[n].cluster.is_some_and(|c| {
                    chosen.iter().enumerate().any(|(k, s)| {
                        k != side
                            && matches!(s.source, Source::Pool(i) if pool[i].cluster == Some(c))
                    })
                })
                || pool[n].added_at > chosen[side].start - 3600;
            if clash {
                continue;
            }
            if let Source::Pool(old) = chosen[side].source {
                if let Some(c) = state.plays.get_mut(&old) {
                    *c = c.saturating_sub(1);
                }
            }
            chosen[side].source = Source::Pool(n);
            *state.plays.entry(n).or_default() += 1;
            return;
        }
    }
}

/// §9 — "mess exists, but never on a surface you would screenshot."
fn apply_mess_budget(
    plans: &[SetPlan],
    composed: &mut [Vec<Slotted>],
    pool: &[Track],
    mess: &[MessTrack],
    seed: u64,
) {
    let mut rng = Rng::substream(seed, "mess");
    // Older, non-Tier-1 sets only.
    let eligible: Vec<usize> = plans
        .iter()
        .enumerate()
        .filter(|(i, p)| p.tier == 3 && composed[*i].len() > 12)
        .map(|(i, _)| i)
        .collect();
    if eligible.is_empty() {
        return;
    }

    // Nulled titles: the play keeps its slot and its tempo but loses its
    // identity entirely (§4.3 — no title means no `track_id`, no roster join,
    // no track-detail page). ~0.3% of plays, all in the archive.
    for _ in 0..MESS_NULL_TITLES {
        let s = eligible[rng.below(eligible.len())];
        let n = composed[s].len();
        let at = 3 + rng.below(n.saturating_sub(6).max(1));
        if at < n {
            composed[s][at].null_title = true;
        }
    }

    // Real catalog rows with a real gap. Substituted in whole, rather than
    // blanking a good row's fields: these are tracks Arjun's library actually
    // holds without a BPM or without a readable key, and the exclusion
    // disclosures should be counting them.
    let no_bpm: Vec<usize> = (0..mess.len()).filter(|&i| mess[i].bpm.is_none()).collect();
    let no_key: Vec<usize> = (0..mess.len())
        .filter(|&i| mess[i].bpm.is_some() && mess[i].camelot_raw.is_none())
        .collect();
    for (budget, bucket) in [(MESS_NO_BPM, &no_bpm), (MESS_NO_KEY, &no_key)] {
        for _ in 0..budget {
            if bucket.is_empty() {
                break;
            }
            let s = eligible[rng.below(eligible.len())];
            let n = composed[s].len();
            let at = 2 + rng.below(n.saturating_sub(4).max(1));
            let m = bucket[rng.below(bucket.len())];
            // Never before its add-date, same invariant as everything else.
            if at < n && mess[m].added_at <= composed[s][at].start - 3600 {
                let dup = composed[s]
                    .iter()
                    .any(|p| matches!(p.source, Source::Mess(x) if x == m));
                // Same one-per-cluster invariant the sequencer holds (§4.3):
                // a `(Dirty)` variant substituted next to its `(Clean)` twin
                // would read as a mistake on any tracklist that showed both.
                let cluster_clash = mess[m].cluster.is_some_and(|c| {
                    composed[s].iter().enumerate().any(|(k, p)| {
                        k != at
                            && match p.source {
                                Source::Pool(x) => pool[x].cluster == Some(c),
                                Source::Mess(x) => mess[x].cluster == Some(c),
                            }
                    })
                });
                if !dup && !cluster_clash {
                    composed[s][at].source = Source::Mess(m);
                }
            }
        }
    }
}

// =============================================================================
// Assembly through production code (§4.1)
// =============================================================================

fn assemble_all(
    plans: &[SetPlan],
    composed: &[Vec<Slotted>],
    pool: &[Track],
    mess: &[MessTrack],
) -> Vec<DemoSet> {
    // Production calibration: each session is scored against floors derived
    // from the sessions strictly earlier than it (`CalibrationPool`), so the
    // demo account's detector behaviour is the behaviour a real DJ's account
    // would have had — thin-history sessions in January genuinely see stricter
    // floors than August's.
    let mut pooled: Vec<PooledSession> = Vec::new();
    let mut out = Vec::with_capacity(plans.len());

    for (plan, slots) in plans.iter().zip(composed.iter()) {
        if slots.is_empty() {
            continue;
        }
        let pairs: Vec<(Play, JoinedMetadata)> = slots
            .iter()
            .map(|s| {
                let (title, artist, bpm, key, genre, added) = match s.source {
                    Source::Pool(i) => {
                        let t = &pool[i];
                        (
                            Some(t.title.clone()),
                            Some(t.artist.clone()),
                            Some(t.bpm),
                            Some(t.camelot_raw.clone()),
                            t.genre_raw.clone(),
                            Some(t.added_at),
                        )
                    }
                    Source::Mess(i) => {
                        let m = &mess[i];
                        (
                            Some(m.title.clone()),
                            Some(m.artist.clone()),
                            m.bpm,
                            m.camelot_raw.clone(),
                            m.genre_raw.clone(),
                            Some(m.added_at),
                        )
                    }
                };
                let play = Play {
                    // Deliberately pathless: `EnrichedPlay.path` never reaches
                    // the wire, and a synthetic path would only invite someone
                    // to key something on it.
                    path: None,
                    title: if s.null_title { None } else { title },
                    artist,
                    label: None,
                    genre: None,
                    grouping: None,
                    year: None,
                    start_time: Some(s.start as u32),
                    deck: None,
                    duration_sec: None,
                    // `play.key` takes precedence over `joined.key` in
                    // `stats::enrich`; left `None` so the key travels the
                    // serato4 route (the joined value), which is the path the
                    // product actually runs today.
                    key: None,
                };
                let joined = JoinedMetadata {
                    in_library: true,
                    bpm,
                    key,
                    genre,
                    ended_at: Some(s.start + s.on_air),
                    played: Some(true),
                    total_length_ms: None,
                    portable_path: None,
                    library_added_at: added,
                };
                (play, joined)
            })
            .collect();

        let set_end = slots.last().map(|s| s.start + s.on_air);
        let started_at = slots[0].start;
        let floors = pooled_floors(&pooled, started_at, &plan.session_identity);
        let (plays, derived) = assemble(&pairs, set_end, &floors);

        // Feed this session forward into the pool, exactly as the store does.
        let detection_plays: Vec<segments::DetectionPlay> = plays
            .iter()
            .map(|p| segments::DetectionPlay {
                position: p.position,
                start_time: p.started_at.map(i64::from),
                bpm: p.bpm,
            })
            .collect();
        pooled.push(PooledSession {
            started_at: Some(started_at),
            session_identity: plan.session_identity.clone(),
            windows: segments::window_stats(&detection_plays),
        });

        let ended_at = plays
            .last()
            .and_then(|p| p.started_at)
            .map(i64::from)
            .unwrap_or(started_at);
        out.push(DemoSet {
            session_identity: plan.session_identity.clone(),
            kind: plan.kind.label(),
            tier: plan.tier,
            label: plan.label.clone(),
            started_at,
            ended_at,
            started_at_et: et_iso(started_at),
            ended_at_et: et_iso(ended_at),
            intended_segments: plan.intended_segments,
            low_confidence_by_design: plan.low_confidence,
            floors: EmittedFloors {
                density: floors.density,
                median_bpm: floors.median_bpm,
                smoothness: floors.smoothness,
            },
            plays,
            derived,
        });
    }
    out
}

fn pooled_floors(pooled: &[PooledSession], started_at: i64, identity: &str) -> segments::Floors {
    CalibrationPool::new(pooled.to_vec()).floors_before(Some(started_at), identity)
}

// =============================================================================
// Reports
// =============================================================================

fn tier1_markdown(out: &DemoSets, _plans: &[SetPlan]) -> String {
    let mut s = String::new();
    s.push_str("# Tier 1 — hand-designed sets, for review\n\n");
    s.push_str(
        "Spec §7.1. These are the sets that end up on a screenshot, so they are read by eye \
         rather than verified statistically. If a title here reads wrong, the fix belongs in \
         `demo-overlay.json` (§4.2) — never in `demo-sets.json`.\n\n",
    );
    for set in out.sets.iter().filter(|s| s.tier == 1) {
        s.push_str(&format!(
            "## {} — {}\n\n",
            set.label.clone().unwrap_or_default(),
            set.session_identity
        ));
        let compat = &set.derived.camelot_mixing_stats;
        let judged = compat.compatible_transitions + compat.incompatible_transitions;
        s.push_str(&format!(
            "- **{}** · {} · {} plays · {} \n- camelot {}/{} judged transitions = **{:.0}%** ({} excluded, no key)\n\
             - bpm {:.0}–{:.0}, median {:.0} · confidence {:.1}\n- detector: **{} dancefloor segment(s)** \
             (intended {}), {} idle gap(s)\n\n",
            set.kind,
            set.started_at_et,
            set.plays.len(),
            fmt_hms(set.ended_at - set.started_at),
            compat.compatible_transitions,
            judged,
            if judged > 0 {
                100.0 * compat.compatible_transitions as f64 / judged as f64
            } else {
                0.0
            },
            compat.excluded_no_key,
            set.derived.bpm_distribution.min,
            set.derived.bpm_distribution.max,
            set.derived.bpm_distribution.median,
            set.derived.confidence.value,
            set.derived.suggested_segments.len(),
            set.intended_segments,
            set.derived.idle_gaps.len(),
        ));
        let seg: Vec<(usize, usize)> = set
            .derived
            .suggested_segments
            .iter()
            .map(|g| (g.first_position, g.last_position))
            .collect();
        s.push_str("| # | time | on air | bpm | key | mix | genre | track |\n");
        s.push_str("| ---: | --- | ---: | ---: | --- | --- | --- | --- |\n");
        let mut prev: Option<&str> = None;
        for p in &set.plays {
            let in_seg = seg
                .iter()
                .any(|(a, b)| p.position >= *a && p.position <= *b);
            let mix = match (prev, p.camelot_key.as_deref()) {
                (Some(a), Some(b)) => match (camelot::parse(a), camelot::parse(b)) {
                    (Some(x), Some(y)) => {
                        if camelot::compatible(x, y) {
                            "smooth"
                        } else {
                            "clash"
                        }
                    }
                    _ => "nokey",
                },
                _ => "—",
            };
            s.push_str(&format!(
                "| {}{} | {} | {} | {} | {} | {} | {} | {} — {} |\n",
                p.position,
                if in_seg { "*" } else { "" },
                &et_iso(p.started_at.unwrap_or(0) as i64)[11..16],
                fmt_hms(p.played_ms.unwrap_or(0) as i64 / 1000),
                p.bpm
                    .map(|b| format!("{b:.0}"))
                    .unwrap_or_else(|| "—".into()),
                p.camelot_key.clone().unwrap_or_else(|| "—".into()),
                mix,
                p.genre
                    .as_ref()
                    .map(|g| g.subgenre.clone())
                    .unwrap_or_else(|| "—".into()),
                p.artist.clone().unwrap_or_else(|| "—".into()),
                p.title.clone().unwrap_or_else(|| "**(no title)**".into()),
            ));
            prev = p.camelot_key.as_deref();
        }
        s.push_str("\n`*` = inside a detected dancefloor segment.\n\n");
    }
    s
}

fn fmt_hms(secs: i64) -> String {
    if secs >= 3600 {
        format!("{}h{:02}m", secs / 3600, (secs % 3600) / 60)
    } else {
        format!("{}:{:02}", secs / 60, secs % 60)
    }
}

struct Check {
    name: String,
    target: String,
    actual: String,
    pass: bool,
}

fn verification_markdown(
    out: &DemoSets,
    _plans: &[SetPlan],
    pool: &[Track],
    library: &DemoLibrary,
    window_start: i64,
    overlay: &OverlayReport,
) -> String {
    let mut checks: Vec<Check> = Vec::new();
    let mut check = |name: &str, target: &str, actual: String, pass: bool| {
        checks.push(Check {
            name: name.into(),
            target: target.into(),
            actual,
            pass,
        })
    };

    let sets = &out.sets;
    let plays: Vec<&CapturedPlay> = sets.iter().flat_map(|s| s.plays.iter()).collect();
    let n_plays = plays.len();
    let hours: f64 = sets
        .iter()
        .map(|s| s.derived.set_length_sec.unwrap_or(0) as f64)
        .sum::<f64>()
        / 3600.0;

    // ---- §5 odometer ------------------------------------------------------
    check(
        "Odometer — sets",
        "~78",
        sets.len().to_string(),
        (74..=82).contains(&sets.len()),
    );
    check(
        "Odometer — hours on decks",
        "~247h",
        format!("{hours:.0}h"),
        (225.0..=270.0).contains(&hours),
    );
    check(
        "Odometer — tracks played",
        "~2,700",
        n_plays.to_string(),
        (2500..=2950).contains(&n_plays),
    );

    // ---- The hard invariant ----------------------------------------------
    let violations = plays
        .iter()
        .filter(|p| match (p.started_at, p.library_added_at) {
            (Some(s), Some(a)) => a > i64::from(s),
            _ => false,
        })
        .count();
    check(
        "Played before its add-date",
        "0",
        violations.to_string(),
        violations == 0,
    );

    // ---- §8 segments, from the real detector ------------------------------
    let seg_counts: Vec<usize> = sets
        .iter()
        .map(|s| s.derived.suggested_segments.len())
        .collect();
    let one = seg_counts.iter().filter(|&&n| n == 1).count();
    let two_plus = seg_counts.iter().filter(|&&n| n >= 2).count();
    let none = seg_counts.iter().filter(|&&n| n == 0).count();
    check(
        "Segments — sets with one",
        "~55",
        one.to_string(),
        (46..=62).contains(&one),
    );
    check(
        "Segments — sets with two+",
        "~14",
        two_plus.to_string(),
        (9..=20).contains(&two_plus),
    );
    check(
        "Segments — sets with none",
        "~9",
        none.to_string(),
        (5..=14).contains(&none),
    );

    // ---- §7.3 camelot -----------------------------------------------------
    let rate = |sel: &dyn Fn(&DemoSet) -> bool| -> (f64, usize) {
        let (mut c, mut t) = (0usize, 0usize);
        for s in sets.iter().filter(|s| sel(s)) {
            c += s.derived.camelot_mixing_stats.compatible_transitions;
            t += s.derived.camelot_mixing_stats.compatible_transitions
                + s.derived.camelot_mixing_stats.incompatible_transitions;
        }
        (if t > 0 { c as f64 / t as f64 } else { 0.0 }, t)
    };
    let (t1, _) = rate(&|s| s.tier == 1 && s.kind != "wedding");
    let (wed, _) = rate(&|s| s.kind == "wedding");
    let (arch, _) = rate(&|s| s.tier == 3);
    let (acct, _) = rate(&|_| true);
    check(
        "Camelot — Tier 1 hand-designed",
        "58-65%",
        format!("{:.0}%", t1 * 100.0),
        (0.56..=0.67).contains(&t1),
    );
    check(
        "Camelot — Indian wedding sets",
        "~35%",
        format!("{:.0}%", wed * 100.0),
        (0.29..=0.42).contains(&wed),
    );
    check(
        "Camelot — archive (Tier 3)",
        "~45%",
        format!("{:.0}%", arch * 100.0),
        (0.41..=0.52).contains(&arch),
    );
    check(
        "Camelot — account-wide",
        "~50%",
        format!("{:.0}%", acct * 100.0),
        (0.45..=0.55).contains(&acct),
    );

    // ---- §1 data quality --------------------------------------------------
    let no_genre = plays.iter().filter(|p| p.genre.is_none()).count();
    let other = plays
        .iter()
        .filter(|p| p.genre.as_ref().is_some_and(|g| g.normalized == "Other"))
        .count();
    let null_title = plays.iter().filter(|p| p.title.is_none()).count();
    let no_bpm = plays.iter().filter(|p| p.bpm.is_none()).count();
    let no_key = plays.iter().filter(|p| p.camelot_key.is_none()).count();
    let pct = |n: usize| 100.0 * n as f64 / n_plays as f64;
    check(
        "Plays with no genre",
        "~2%",
        format!("{n} ({:.1}%)", pct(no_genre), n = no_genre),
        pct(no_genre) <= 3.0,
    );
    check(
        "Plays normalizing to Other",
        "~5%",
        format!("{other} ({:.1}%)", pct(other)),
        pct(other) <= 7.0,
    );
    check(
        "Plays with a null title",
        "~8",
        null_title.to_string(),
        (4..=14).contains(&null_title),
    );
    check(
        "Plays with no BPM",
        "a handful",
        no_bpm.to_string(),
        no_bpm <= 25,
    );
    check(
        "Plays with no key",
        "a handful",
        no_key.to_string(),
        no_key <= 25,
    );

    // ---- §9 mess budget ---------------------------------------------------
    let low_conf: Vec<&DemoSet> = sets
        .iter()
        .filter(|s| s.derived.confidence.value < 1.0)
        .collect();
    let mid_june = et_to_epoch(
        days_from_civil(2026, 6, 15) + out.generator.anchor_shift_days,
        0,
    );
    let low_conf_late = low_conf.iter().filter(|s| s.started_at >= mid_june).count();
    check(
        "Low-confidence sets",
        "5",
        low_conf.len().to_string(),
        (3..=8).contains(&low_conf.len()),
    );
    check(
        "Low-confidence sets after mid-June",
        "0",
        low_conf_late.to_string(),
        low_conf_late == 0,
    );
    let low_conf_t1 = low_conf.iter().filter(|s| s.tier == 1).count();
    check(
        "Low-confidence Tier 1 sets",
        "0",
        low_conf_t1.to_string(),
        low_conf_t1 == 0,
    );
    let shorties = sets.iter().filter(|s| s.plays.len() < 6).count();
    check(
        "Sets under HERO_MIN_TRACKS",
        "2 (soundchecks)",
        shorties.to_string(),
        shorties == 2,
    );

    // ---- §1 set size ------------------------------------------------------
    let mut sizes: Vec<usize> = sets.iter().map(|s| s.plays.len()).collect();
    sizes.sort_unstable();
    let median = sizes[sizes.len() / 2];
    check(
        "Tracks per set (min-max, median)",
        "18-80, median 34",
        format!("{}-{}, median {}", sizes[0], sizes[sizes.len() - 1], median),
        (26..=42).contains(&median),
    );

    // ---- §5 calendar ------------------------------------------------------
    let kind_count = |k: &str| sets.iter().filter(|s| s.kind == k).count();
    check(
        "Thursday residencies",
        "~28",
        kind_count("residency").to_string(),
        (24..=32).contains(&kind_count("residency")),
    );
    check(
        "Fri/Sat club nights",
        "~34",
        kind_count("club").to_string(),
        (30..=40).contains(&kind_count("club")),
    );
    let private = kind_count("private") + kind_count("wedding");
    check(
        "Private events",
        "~12",
        private.to_string(),
        (9..=16).contains(&private),
    );
    check(
        "Indian wedding sets",
        "1-2",
        kind_count("wedding").to_string(),
        (1..=2).contains(&kind_count("wedding")),
    );
    check(
        "Soundchecks",
        "2",
        kind_count("soundcheck").to_string(),
        kind_count("soundcheck") == 2,
    );

    // The April gap.
    let mut gap_days = 0i64;
    let mut sorted: Vec<i64> = sets.iter().map(|s| s.started_at).collect();
    sorted.sort_unstable();
    for w in sorted.windows(2) {
        gap_days = gap_days.max((w[1] - w[0]) / 86_400);
    }
    check(
        "Longest break in the calendar",
        "~3 weeks",
        format!("{gap_days} days"),
        (17..=25).contains(&gap_days),
    );

    // Session identities strictly increasing.
    let mut ids: Vec<u32> = sets
        .iter()
        .map(|s| {
            s.session_identity
                .trim_start_matches("serato4:")
                .parse()
                .unwrap()
        })
        .collect();
    let increasing = ids.windows(2).all(|w| w[0] < w[1]);
    ids.dedup();
    check(
        "session_identity increasing + unique",
        "yes",
        increasing.to_string(),
        increasing && ids.len() == sets.len(),
    );

    // ---- §12 signature track ---------------------------------------------
    let sig_id = pool
        .iter()
        .find(|t| t.title == SIGNATURE_TITLE && t.artist == SIGNATURE_ARTIST)
        .map(|t| t.id.clone())
        .unwrap_or_default();
    let sig_plays: Vec<(&DemoSet, &CapturedPlay)> = sets
        .iter()
        .flat_map(|s| s.plays.iter().map(move |p| (s, p)))
        .filter(|(_, p)| p.track_id.as_deref() == Some(sig_id.as_str()))
        .collect();
    let sig_months: BTreeSet<String> = sig_plays
        .iter()
        .map(|(_, p)| et_month(p.started_at.unwrap_or(0) as i64))
        .collect();
    check(
        "Signature track — plays",
        "~34",
        sig_plays.len().to_string(),
        (28..=40).contains(&sig_plays.len()),
    );
    check(
        "Signature track — distinct months",
        "7",
        sig_months.len().to_string(),
        sig_months.len() >= 7,
    );
    let sig_hours: Vec<f64> = sig_plays
        .iter()
        .map(|(_, p)| {
            let (_, sod) = epoch_to_et(p.started_at.unwrap_or(0) as i64);
            let h = sod as f64 / 3600.0;
            if h < 12.0 {
                h + 24.0
            } else {
                h
            }
        })
        .collect();
    let mean_h = sig_hours.iter().sum::<f64>() / sig_hours.len().max(1) as f64;
    let spread = sig_hours
        .iter()
        .map(|h| (h - mean_h).abs())
        .fold(0.0f64, f64::max);
    check(
        "Signature track — time of night",
        "consistent (±1h)",
        format!(
            "mean {:02}:{:02}, max deviation {:.0} min",
            mean_h as i64 % 24,
            ((mean_h % 1.0) * 60.0) as i64,
            spread * 60.0
        ),
        spread <= 1.2,
    );
    // Recurring neighbours: what actually sits next to it, counted.
    let mut neighbour_counts: BTreeMap<String, usize> = BTreeMap::new();
    for s in sets {
        for (i, p) in s.plays.iter().enumerate() {
            if p.track_id.as_deref() != Some(sig_id.as_str()) {
                continue;
            }
            for j in [i.wrapping_sub(1), i + 1] {
                if let Some(n) = s.plays.get(j) {
                    if let (Some(t), Some(a)) = (n.title.clone(), n.artist.clone()) {
                        *neighbour_counts.entry(format!("{a} — {t}")).or_default() += 1;
                    }
                }
            }
        }
    }
    let mut top_neighbours: Vec<(String, usize)> = neighbour_counts.into_iter().collect();
    top_neighbours.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let recurring = top_neighbours.iter().filter(|(_, n)| *n >= 3).count();
    check(
        "Signature track — recurring neighbours",
        "3-4",
        recurring.to_string(),
        (3..=8).contains(&recurring),
    );

    // ---- §6 genre arc -----------------------------------------------------
    let mut period_mix: BTreeMap<&str, BTreeMap<String, usize>> = BTreeMap::new();
    let mut period_total: BTreeMap<&str, usize> = BTreeMap::new();
    for s in sets {
        let p = Period::of(s.started_at, window_start).label();
        for play in &s.plays {
            let g = play
                .genre
                .as_ref()
                .map(|g| g.normalized.clone())
                .unwrap_or_else(|| "(none)".into());
            *period_mix.entry(p).or_default().entry(g).or_default() += 1;
            *period_total.entry(p).or_default() += 1;
        }
    }
    for period in [Period::JanMar, Period::AprMay, Period::JunAug] {
        let total = *period_total.get(period.label()).unwrap_or(&1);
        for (g, want) in genre_targets(period) {
            let have = period_mix
                .get(period.label())
                .and_then(|m| m.get(*g))
                .copied()
                .unwrap_or(0) as f64
                / total as f64;
            let delta = (have - want).abs();
            check(
                &format!("§6 {} — {g}", period.label()),
                &format!("{:.0}%", want * 100.0),
                format!("{:.0}%", have * 100.0),
                delta <= 0.09,
            );
        }
    }

    // ---- §7.2 BPM arc shapes ---------------------------------------------
    let arc_shape = |kind: &str| -> (f64, f64, f64) {
        let mut open = Vec::new();
        let mut peak = Vec::new();
        let mut close = Vec::new();
        for s in sets.iter().filter(|s| s.kind == kind) {
            let n = s.plays.len();
            if n < 10 {
                continue;
            }
            for (i, p) in s.plays.iter().enumerate() {
                let Some(b) = p.bpm else { continue };
                let f = i as f64 / (n - 1) as f64;
                if f < 0.15 {
                    open.push(b);
                } else if (0.55..0.8).contains(&f) {
                    peak.push(b);
                } else if f > 0.9 {
                    close.push(b);
                }
            }
        }
        let mean = |v: &Vec<f64>| {
            if v.is_empty() {
                0.0
            } else {
                v.iter().sum::<f64>() / v.len() as f64
            }
        };
        (mean(&open), mean(&peak), mean(&close))
    };
    for (kind, want) in [
        ("residency", "open < peak, gentle build (§7.2 92→108→120)"),
        ("club", "open ~118, peak ~128, close ~122 (§7.2)"),
        ("private", "wide swings, 85→128→95 (§7.2)"),
        ("wedding", "bimodal, not a house arc (§7.4)"),
    ] {
        let (o, p, c) = arc_shape(kind);
        check(
            &format!("§7.2 BPM arc — {kind}"),
            want,
            format!("open {o:.0} · peak {p:.0} · close {c:.0}"),
            p > o && p >= c - 1.0,
        );
    }
    // §7.4's bimodality, measured rather than asserted.
    let wed_bpms: Vec<f64> = sets
        .iter()
        .filter(|s| s.kind == "wedding")
        .flat_map(|s| s.plays.iter().filter_map(|p| p.bpm))
        .collect();
    let fast = wed_bpms.iter().filter(|b| **b >= 132.0).count();
    let slow = wed_bpms.iter().filter(|b| **b < 132.0).count();
    // §7.4 asks for a 140-160 dhol mode. This library does not have one: across
    // every Indian/Bolly crate row with a usable BPM and key, exactly two
    // tracks sit above 148 and ~25 sit above 135, which is nowhere near enough
    // distinct records to fill a dancefloor block without repeating inside one
    // set. The fast mode is therefore built at 132-142 — still plainly a second
    // mode against the 122-130 Bollywood floor and the 88-104 cocktail hour,
    // and still nothing like a house set's arc. Recorded as a deviation rather
    // than papered over; see the report's §7.4 note.
    check(
        "§7.4 wedding BPM bimodality",
        "two modes (spec says 140-160; library tops out ~142 — see note)",
        format!("{slow} under 132bpm · {fast} at/over 132bpm"),
        fast >= 20 && slow >= 20,
    );
    let wed_ms: Vec<u64> = sets
        .iter()
        .filter(|s| s.kind == "wedding")
        .flat_map(|s| s.plays.iter().filter_map(|p| p.played_ms))
        .collect();
    let short = wed_ms.iter().filter(|m| **m <= 130_000).count();
    check(
        "§7.4 wedding play lengths",
        "60-120s crowd-pleaser cuts",
        format!("{short}/{} plays at or under 130s", wed_ms.len()),
        short * 2 >= wed_ms.len(),
    );

    // ---- §12 library utilization -----------------------------------------
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for p in &plays {
        if let Some(id) = &p.track_id {
            *counts.entry(id.clone()).or_default() += 1;
        }
    }
    let distinct = counts.len();
    let one_and_done = counts.values().filter(|n| **n == 1).count();
    let workhorses = counts.values().filter(|n| **n >= 8).count();
    check(
        "Rotation — distinct tracks played",
        "600-1,100",
        distinct.to_string(),
        (500..=1400).contains(&distinct),
    );
    check(
        "Rotation — one-and-done",
        "a real tail",
        one_and_done.to_string(),
        one_and_done >= 150,
    );
    check(
        "Rotation — workhorses (8+ plays)",
        "a real head",
        workhorses.to_string(),
        workhorses >= 25,
    );
    // ---- §10 / §12 library payloads --------------------------------------
    //
    // Measured the way `/library-utilization` will measure them: cohorts run
    // off the ADD EVENTS (`libraryConversion.ts`'s denominator), not off the
    // roster, so a baseline track can never inflate a rate.
    let first_play: BTreeMap<String, i64> = {
        let mut m: BTreeMap<String, i64> = BTreeMap::new();
        for p in &plays {
            if let (Some(id), Some(st)) = (&p.track_id, p.started_at) {
                let e = m.entry(id.clone()).or_insert(i64::MAX);
                *e = (*e).min(i64::from(st));
            }
        }
        m
    };
    let roster = &library.roster;
    let events = &library.add_events;
    let baseline = roster.iter().filter(|e| e.is_baseline).count();
    check(
        "Roster — entries",
        "the whole library",
        roster.len().to_string(),
        roster.len() > 3_500,
    );
    check(
        "Roster — baseline vs go-forward adds",
        "most of a 7-month-old install is baseline",
        format!(
            "{baseline} baseline · {} added in-window",
            roster.len() - baseline
        ),
        baseline > 0 && events.len() == roster.len() - baseline,
    );
    check(
        "Add events — one per non-baseline roster entry",
        "exact",
        events.len().to_string(),
        events.len() == roster.len() - baseline,
    );
    let no_baseline_event = events.iter().all(|e| {
        roster
            .iter()
            .any(|r| r.track_id == e.track_id && !r.is_baseline)
    });
    check(
        "Add events — never emitted for a baseline track",
        "true",
        no_baseline_event.to_string(),
        no_baseline_event,
    );
    let roster_ids: BTreeSet<&str> = roster.iter().map(|e| e.track_id.as_str()).collect();
    let orphan_plays = plays
        .iter()
        .filter_map(|p| p.track_id.as_deref())
        .filter(|id| !roster_ids.contains(id))
        .count();
    check(
        "Every identified play joins to a roster entry",
        "0 orphans",
        orphan_plays.to_string(),
        orphan_plays == 0,
    );

    let mut conversion_lines: Vec<String> = Vec::new();
    for window_days in [60i64, 30, 14] {
        let mut n = 0usize;
        let mut converted = 0usize;
        for e in events {
            let Some(added) = e.added_at else { continue };
            n += 1;
            if let Some(f) = first_play.get(&e.track_id) {
                if *f >= added && *f - added <= window_days * 86_400 {
                    converted += 1;
                }
            }
        }
        let rate = 100.0 * converted as f64 / n.max(1) as f64;
        conversion_lines.push(format!(
            "| {window_days} days | {n} | {converted} | {rate:.0}% |"
        ));
        check(
            &format!("Library conversion — {window_days}-day window"),
            "a non-degenerate rate",
            format!("{converted}/{n} = {rate:.0}%"),
            n >= 100 && (10.0..=90.0).contains(&rate),
        );
    }

    // ---- Duplicate-cluster guard -----------------------------------------
    let cluster_of: BTreeMap<String, usize> = pool
        .iter()
        .filter_map(|t| t.cluster.map(|c| (t.id.clone(), c)))
        .collect();
    let mut cluster_collisions = 0usize;
    for s in sets {
        let mut seen: BTreeSet<usize> = BTreeSet::new();
        for p in &s.plays {
            if let Some(c) = p.track_id.as_ref().and_then(|id| cluster_of.get(id)) {
                if !seen.insert(*c) {
                    cluster_collisions += 1;
                }
            }
        }
    }
    check(
        "Near-miss duplicates in one set",
        "0",
        cluster_collisions.to_string(),
        cluster_collisions == 0,
    );

    // ---- Render -----------------------------------------------------------
    let failed = checks.iter().filter(|c| !c.pass).count();
    let mut s = String::new();
    s.push_str("# Demo-set verification\n\n");
    s.push_str(&format!(
        "Generated from `demo-catalog.json` + `demo-overlay.json` by \
         `agent/src-tauri/examples/demo_set_generator.rs` — seed `{}`, anchor `{}` \
         (shift {} days), timezone `{}`.\n\n\
         Every segment number below is what `stats::segments::detect` produced over these \
         sets, calibrated per-session by `CalibrationPool::floors_before` — the real \
         detector, not a reimplementation.\n\n",
        out.generator.seed,
        out.generator.anchor,
        out.generator.anchor_shift_days,
        out.generator.timezone
    ));
    s.push_str(&format!(
        "**{} checks, {} failed.**\n\n| check | target | actual | |\n| --- | --- | --- | --- |\n",
        checks.len(),
        failed
    ));
    for c in &checks {
        s.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            c.name,
            c.target,
            c.actual,
            if c.pass { "ok" } else { "**FAIL**" }
        ));
    }

    s.push_str("\n## Per-period genre mix (§6)\n\n| period | plays | top parents |\n| --- | ---: | --- |\n");
    for period in [Period::JanMar, Period::AprMay, Period::JunAug] {
        let total = *period_total.get(period.label()).unwrap_or(&1);
        let mut m: Vec<(String, usize)> = period_mix
            .get(period.label())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();
        m.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let top: Vec<String> = m
            .iter()
            .take(6)
            .map(|(g, n)| format!("{g} {:.0}%", 100.0 * *n as f64 / total as f64))
            .collect();
        s.push_str(&format!(
            "| {} | {} | {} |\n",
            period.label(),
            total,
            top.join(" · ")
        ));
    }

    s.push_str("\n## Top subgenres, Jun–Aug (§6 wants Afro House + Tech House on top)\n\n");
    let mut subs: BTreeMap<String, usize> = BTreeMap::new();
    for set in sets
        .iter()
        .filter(|s| Period::of(s.started_at, window_start) == Period::JunAug)
    {
        for p in &set.plays {
            if let Some(g) = &p.genre {
                *subs.entry(g.subgenre.clone()).or_default() += 1;
            }
        }
    }
    let mut subs: Vec<(String, usize)> = subs.into_iter().collect();
    subs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (g, n) in subs.iter().take(8) {
        s.push_str(&format!("- {g}: {n}\n"));
    }

    s.push_str("\n## Signature track (§12 `/track/[track_id]`)\n\n");
    s.push_str(&format!(
        "**{SIGNATURE_ARTIST} — {SIGNATURE_TITLE}** (`{sig_id}`)\n\n\
         {} plays across {} months. Recurring mix neighbours:\n\n",
        sig_plays.len(),
        sig_months.len()
    ));
    for (n, c) in top_neighbours.iter().take(6) {
        s.push_str(&format!("- {n} — {c} times\n"));
    }

    s.push_str("\n## Segment distribution, by the real detector (§8)\n\n");
    s.push_str(&format!(
        "| segments found | sets |\n| ---: | ---: |\n| 0 | {none} |\n| 1 | {one} |\n| 2+ | {two_plus} |\n\n"
    ));
    s.push_str("| kind | sets | 0 seg | 1 seg | 2+ seg | median plays | median length |\n");
    s.push_str("| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for kind in ["residency", "club", "private", "wedding", "soundcheck"] {
        let group: Vec<&DemoSet> = sets.iter().filter(|s| s.kind == kind).collect();
        if group.is_empty() {
            continue;
        }
        let c = |n: usize| {
            group
                .iter()
                .filter(|s| s.derived.suggested_segments.len() == n)
                .count()
        };
        let two = group
            .iter()
            .filter(|s| s.derived.suggested_segments.len() >= 2)
            .count();
        let mut sizes: Vec<usize> = group.iter().map(|s| s.plays.len()).collect();
        sizes.sort_unstable();
        let mut lens: Vec<i64> = group
            .iter()
            .map(|s| s.derived.set_length_sec.unwrap_or(0) as i64)
            .collect();
        lens.sort_unstable();
        s.push_str(&format!(
            "| {kind} | {} | {} | {} | {} | {} | {} |\n",
            group.len(),
            c(0),
            c(1),
            two,
            sizes[sizes.len() / 2],
            fmt_hms(lens[lens.len() / 2])
        ));
    }
    s.push('\n');

    let agree = sets
        .iter()
        .filter(|s| s.derived.suggested_segments.len() as u8 == s.intended_segments)
        .count();
    s.push_str(&format!(
        "The pacing was *designed* to produce a given count per set; the detector agreed on \
         {agree}/{} of them. Disagreement is not corrected — the design intent is a knob on \
         pace and tempo, and the detector is the authority on what those knobs produced.\n",
        sets.len()
    ));

    s.push_str("\n## Library payloads (§10, `/library-utilization`)\n\n");
    s.push_str(&format!(
        "`demo-library.json` — **{} roster entries** ({} baseline, {} go-forward adds). \
         Baseline rows carry no add event, matching `capture::LibraryScanOutcome`.\n\n\
         Conversion, measured off the add events the way `libraryConversion.ts` will:\n\n\
         | window | cohort | converted | rate |\n| --- | ---: | ---: | ---: |\n{}\n\n",
        roster.len(),
        baseline,
        events.len(),
        conversion_lines.join("\n")
    ));
    let mut cohorts: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for e in events {
        let Some(added) = e.added_at else { continue };
        let c = cohorts.entry(et_month(added)).or_default();
        c.0 += 1;
        if let Some(f) = first_play.get(&e.track_id) {
            if *f >= added && *f - added <= 60 * 86_400 {
                c.1 += 1;
            }
        }
    }
    s.push_str("Month-added cohorts at the 60-day default:\n\n| cohort | added | converted | rate |\n| --- | ---: | ---: | ---: |\n");
    for (m, (n, c)) in &cohorts {
        s.push_str(&format!(
            "| {m} | {n} | {c} | {:.0}% |\n",
            100.0 * *c as f64 / (*n).max(1) as f64
        ));
    }
    s.push_str(
        "\n> Thin months are real, not a generator artifact: the add-dates are file mtimes off \
         Arjun's own drive, and some months genuinely saw almost no new music. A cohort of four \
         tracks will render as a spiky point on the trend line.\n\n",
    );

    s.push_str("\n## Deviations from the spec, and why\n\n");
    s.push_str(
        "**§7.4 — the 140–160 dhol mode does not exist in this library.** Across every \
         Indian/Bolly crate row with a usable BPM *and* key, two tracks sit above 148 and ~25 \
         above 135 — not enough distinct records to fill a dancefloor block without repeating \
         inside a single set. The wedding sets are built with a 132–142 fast mode against a \
         122–130 Bollywood floor and an 88–104 cocktail hour, which is still plainly bimodal \
         and still nothing like a house set's arc. Closing the gap properly needs library \
         material, not a generator change.\n\n\
         **§7.3 — archive camelot ramps rather than sitting flat at ~45%.** The spec's three \
         tier numbers (58–65% / ~45% / ~35%) and its account-wide ~50% cannot all hold at once \
         given how the play counts fall: a flat 45% archive lands the account at ~47.6%. The \
         account-wide number is the one §7.3 calls the honest picture, so the non-Tier-1 target \
         ramps from 45% in January to ~53.5% in August. That also reads better than a constant \
         — a DJ who got better at harmonic mixing over seven months is a story \
         `/style-evolution` can show.\n\n\
         **§7.2 — the club's hip-hop dip is one record, not a stretch.** Detection gates a \
         window on its median BPM, so three consecutive ~100bpm plays drag two windows under \
         the floor and split the night in two; a three-track dip put 21 of 35 club nights on \
         two segments. One throwback bomb inside a 126bpm window leaves the median where it \
         was, and is how the move actually works on a floor.\n\n\
         **§5 — residency nights run ~30 tracks over ~3h, so `played_ms` is capped.** Spacing \
         and on-air duration are separate numbers here: pacing sets the start-to-start gap \
         (which is what the detector and `confidence.rs` read), while the claimed on-air time \
         is capped near a real extended-mix length. Without that split a sparse warm-up phase \
         reported eleven-minute records.\n\n",
    );

    s.push_str("\n## Overlay application (§4.2/§4.3)\n\n");
    s.push_str(&format!(
        "- `tracks` corrections applied: **{}**\n\
         - `no_identity` path-keyed corrections: **{}** — of which **{}** minted an identity that \
         merges into an existing catalog row (and so inherits its bpm/key/genre/add-date), and \
         **{}** minted a *new* identity the stage-1 artifacts carry no metadata for.\n\n",
        overlay.applied_track_corrections,
        overlay.no_identity_minted,
        overlay.no_identity_merged,
        overlay.no_identity_unusable
    ));
    s.push_str(
        "> **RULED 2026-08-13 (Arjun): dropped.** A row that had no identity also had no \
         `track_id`, and stage 1 keyed all per-track metadata by `track_id` — so those rows exist \
         in `duplicates.json` as `{path, title, artist, crates}` and nothing else. Minting an \
         identity gives them a name; it does not give them a tempo, a key, a genre, or an \
         add-date, and there is nothing to sequence a play *by*. The options were a re-extraction \
         pass emitting metadata for identity-less paths, or hand-authored overlay fields. Neither \
         was taken: the wedding sets §7.4 needed them for are already carried by the 120 \
         `tracks` corrections, so the rescue bought nothing it did not already have.\n>\n\
         > The corrections themselves are **kept in `demo-overlay.json`, not deleted** — they are \
         hand-curated and correct, they cost nothing to carry, and they become usable the moment \
         anyone does run that extractor pass. They are simply never a candidate for a play, and \
         the whole identity-less population (these 150, the 12 ceremony tracks, the ~311 \
         non-Indian artist-less rows) is now invisible by choice rather than by omission.\n",
    );

    s
}
