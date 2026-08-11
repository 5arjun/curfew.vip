//! Per-DJ-calibrated segment detection (Story 5.2, AD-17 / AR-13 / FR-28) — the
//! algorithm [`crate::stats`]'s own module doc used to name as "Epic 5's job
//! against this module later". This is that story.
//!
//! Detection is a pipeline of pure functions over one session's plays:
//!
//! ```text
//! plays[]
//!   -> timed, sorted by epoch                         (AC-5: UTC seconds, never local time)
//!   -> bucketed into WINDOW_SEC windows               (D-3, v0's shape)
//!   -> per window: density | median BPM | median |consecutive BPM delta|
//!   -> candidacy gate:  density >= floor AND median BPM >= floor    (D-4)
//!   -> runs of candidate windows, short gaps bridged, long silence hard-breaks (D-11/D-22)
//!   -> confirmation gate: run's median window-smoothness <= floor   (D-5/D-6/D-7)
//!   -> zero, one, or several `dancefloor` segments                  (D-15, AC-4)
//! ```
//!
//! The floors are never global constants (AR-13's binding requirement): they are
//! percentiles over *this DJ's own* historical window stats, blended with the
//! shared prior while that history is thin ([`floors_from_history`], D-8/D-9).
//! The prior is v0's retired `web/lib/sets/dancefloor.ts` constants, so a DJ's
//! very first session behaves exactly like v0 did and then drifts toward their
//! own numbers with no cliff and no empty state.
//!
//! **Design invariants inherited from [`crate::stats`]:**
//! - *Arithmetic-only.* Counting, medians, and a nearest-rank percentile. No ML,
//!   no DSP, no scoring heuristic beyond the documented gates.
//! - *Deterministic.* No `HashMap` iteration, no randomness. Every sort carries an
//!   explicit total tiebreak (epoch then position; `f64::total_cmp` for floats),
//!   because the whole calibration story rests on a re-derivation producing
//!   byte-identical output (D-23).
//! - *Absent stays absent* (AD-11). A window with no BPM data has no median BPM
//!   and passes the BPM gate rather than being scored against a guessed tempo —
//!   v0's `med == null ||` precedent, kept verbatim. A run with no transition
//!   data passes confirmation vacuously for the same reason.
//!
//! **What this module deliberately does not do:** it does not read the store, does
//! not write anything, and does not know what a cloud row is. [`crate::capture`]
//! loads the calibration pool at the edge and hands it in; the `('suggested',
//! false)` rows are materialized cloud-side by `sync_set` from the positions
//! emitted here (D-19/D-20, AD-23). It also only ever claims `dancefloor` (D-26)
//! — `dinner`/`performance`/`custom` are human labels Story 5.3 owns.

use super::EnrichedPlay;

// ---- TUNE block (D-22) ------------------------------------------------------
//
// Every number the algorithm turns on, in one place, all first-pass. They are
// dev-time picks closing the design doc's §5 open threads, not corpus-validated
// constants — retune them here against the golden fixtures, never in prod.

/// Window size the night is bucketed into. Carried from v0 unchanged (D-22).
pub const WINDOW_SEC: i64 = 600;

/// A defensive ceiling on how many windows a single session can bucket into
/// (~139 days at [`WINDOW_SEC`]) — far beyond any real DJ session. `start_time`
/// is a plain `u32` with no upper-bound validation upstream, so a single
/// corrupted timestamp could otherwise span decades and allocate a
/// correspondingly enormous `Vec` on every capture/backfill pass over that
/// session — unlike v0, which ran client-side in a browser tab rather than the
/// always-on agent process. A session whose span would exceed this declines
/// detection the same way a non-positive span already does (code review
/// finding, 2026-08-10) — never a guess, just a decline (AD-11).
pub const MAX_WINDOW_COUNT: usize = 20_000;

/// Below this many *timed* plays, detection is not worth attempting: zero
/// segments, zero idle gaps. Carried from v0 (D-22).
///
/// Note `web/lib/sets/hero.ts`'s `HERO_MIN_TRACKS` used to be an alias of v0's
/// copy of this constant. It is now its own literal on the web side: that is a
/// hero-*display* threshold and this is a detection floor, and the two are free
/// to move independently (Story 5.2 Task 5.2).
pub const MIN_PLAYS_FOR_DETECTION: usize = 6;

/// Percentile of the DJ's own historical windows each floor sits at (D-22).
/// A *lower* bound for density/BPM (the window must beat it) and an *upper*
/// bound for smoothness (the run must be at least as smooth as it). One shared
/// value until evidence says the three signals want different ones.
pub const FLOOR_PERCENTILE: f64 = 60.0;

/// Cold-start density prior — v0's retired `DENSITY_FLOOR` (D-9/D-22).
pub const DENSITY_PRIOR: f64 = 3.0;

/// Cold-start median-BPM prior — v0's retired `BPM_FLOOR` (D-9/D-22).
pub const BPM_PRIOR: f64 = 118.0;

/// Cold-start smoothness prior, in absolute BPM delta. **New in this story** —
/// v0 had no smoothness signal at all, which makes this the least-grounded
/// number here (D-22 says so out loud). ~6 BPM is the outer edge of a
/// beatmatched transition without a tempo ride, and AD-17's corpus observation
/// (65–78% small-delta pairs in real mixed sets) brackets it.
pub const SMOOTHNESS_PRIOR_ABS_BPM_DELTA: f64 = 6.0;

/// Blend half-weight point: `w = n / (n + BLEND_N)` (D-9/D-22). Session 1 lands
/// at 17% personal, session 5 at 50%, session 20 at 80% — asymptotic to fully
/// personal, no cliff anywhere.
pub const BLEND_N: f64 = 5.0;

/// An ordinary sub-floor gap of at most this many windows is bridged rather than
/// ending the run (v0's `GAP_MERGE_WINDOWS`, kept global — the design doc's
/// "maybe per-DJ" thread was explicitly not taken, D-22).
pub const GAP_MERGE_WINDOWS: usize = 1;

/// True inter-play silence at or above this is labeled an idle gap (D-10/D-22).
/// Descriptive only — never a gate. A zero-play window already fails candidacy
/// on density alone.
pub const IDLE_LABEL_MIN_SEC: i64 = 600;

/// True inter-play silence above this **hard-breaks** a run even when the gap
/// fits inside a single otherwise-bridgeable window (D-11/D-22).
///
/// This elapsed-time formulation is the whole point: a 1-window gap can hide up
/// to ~30 minutes of dead air between its bounding plays — the dinner break v0
/// would happily bridge. Window counts cannot express that; real seconds can.
pub const IDLE_HARD_BREAK_SEC: i64 = 1200;

/// The only `segments.type` this algorithm ever claims (D-26).
pub const SEGMENT_TYPE_DANCEFLOOR: &str = "dancefloor";

// ---- Types ------------------------------------------------------------------

/// One window's three signals (D-3). `None` is genuinely "no data in this
/// window", never a zero (AD-11).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowStats {
    /// Plays whose `start_time` falls in this window.
    pub density: usize,
    /// Median BPM over this window's plays that have one.
    pub median_bpm: Option<f64>,
    /// Median absolute consecutive-pair BPM delta assigned to this window — see
    /// [`window_stats`] for the pair convention.
    pub median_abs_bpm_delta: Option<f64>,
}

/// The three per-DJ calibrated gates (D-4/D-5/D-8). Produced only by
/// [`floors_from_history`] or [`Floors::prior`] — never hand-assembled outside
/// tests, so "never a global constant" (AR-13) stays mechanically true.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Floors {
    /// Minimum plays for a window to be a dancefloor candidate.
    pub density: f64,
    /// Minimum window median BPM for a candidate, when the window has BPM at all.
    pub median_bpm: f64,
    /// Maximum median window-smoothness for a candidate run to confirm.
    pub smoothness: f64,
}

impl Floors {
    /// The shared cold-start prior (D-9): v0's retired constants, plus this
    /// story's new smoothness number. What a DJ's very first session is scored
    /// against, and what an empty pool always collapses to.
    pub fn prior() -> Self {
        Self {
            density: DENSITY_PRIOR,
            median_bpm: BPM_PRIOR,
            smoothness: SMOOTHNESS_PRIOR_ABS_BPM_DELTA,
        }
    }
}

/// One detected dancefloor span, as **1-based play positions** matching
/// `SyncPlay.position` / `CapturedPlay.position`.
///
/// Positions, not timestamps and not ids: the agent can never know the cloud's
/// `plays.id` values — `sync_set` mints (and re-mints) them inside its own
/// transaction — so the wire carries an index into the same payload's `plays[]`
/// and the RPC resolves it after its own insert (D-20).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SuggestedSegment {
    pub first_position: usize,
    pub last_position: usize,
}

/// A labeled stretch of silence (D-10). Descriptive data for future UI ("idle
/// 11:45–12:05"), never a gate, and deliberately **not** a `segments` row —
/// the type enum has no `idle` value on purpose (D-26).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdleGap {
    /// Start of the silence: the last timed play before it, Unix epoch seconds.
    pub start_epoch_s: i64,
    /// End of the silence: the first timed play after it, Unix epoch seconds.
    pub end_epoch_s: i64,
}

/// Everything one session's detection pass produces.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Detection {
    /// Zero, one, or several — never assume exactly one (D-15, AC-4).
    pub segments: Vec<SuggestedSegment>,
    pub idle_gaps: Vec<IdleGap>,
}

/// The minimal per-play shape detection needs, so this module works equally on a
/// freshly-enriched session ([`detection_plays`]) and on a stored one replayed
/// out of `plays_json` for the calibration pool — without either caller having to
/// reconstruct the other's type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DetectionPlay {
    /// 1-based position within the set.
    pub position: usize,
    /// Unix epoch **seconds**. `None` = the play carried no start time; it keeps
    /// its position but takes no part in any timing computation.
    pub start_time: Option<i64>,
    pub bpm: Option<f64>,
}

/// Projects an enriched session onto [`DetectionPlay`], numbering positions the
/// same way [`crate::capture`] does (`i + 1`) so a segment's positions address
/// exactly the rows that reach the wire.
pub fn detection_plays(plays: &[EnrichedPlay]) -> Vec<DetectionPlay> {
    plays
        .iter()
        .enumerate()
        .map(|(i, p)| DetectionPlay {
            position: i + 1,
            start_time: p.start_time.map(i64::from),
            bpm: p.bpm,
        })
        .collect()
}

// ---- Windowing --------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct TimedPlay {
    position: usize,
    epoch: i64,
    bpm: Option<f64>,
}

/// One session's windowed view: the timed plays in epoch order, which window
/// each landed in, and the per-window stats.
struct Analysis {
    timed: Vec<TimedPlay>,
    /// `window_of[i]` is the window index of `timed[i]`.
    window_of: Vec<usize>,
    stats: Vec<WindowStats>,
}

/// Timed plays in a total, deterministic order: epoch first, position as the
/// tiebreak. Sorting (rather than v0's "clamp whatever order arrives") is what
/// makes AC-5 hold by construction — consecutive-pair deltas over a sorted
/// epoch-seconds sequence are non-negative and monotonic even across a DST
/// transition, because a repeated local hour is not a repeated UTC instant.
fn timed_plays(plays: &[DetectionPlay]) -> Vec<TimedPlay> {
    let mut timed: Vec<TimedPlay> = plays
        .iter()
        .filter_map(|p| {
            p.start_time.map(|epoch| TimedPlay {
                position: p.position,
                epoch,
                bpm: p.bpm,
            })
        })
        .collect();
    timed.sort_by(|a, b| a.epoch.cmp(&b.epoch).then(a.position.cmp(&b.position)));
    timed
}

/// Buckets a session and computes its three per-window signals, or `None` when
/// there is nothing to analyze.
///
/// Two declines, both v0's (D-3): fewer than [`MIN_PLAYS_FOR_DETECTION`] timed
/// plays, and a non-positive span (every play at the same instant — a clock
/// artifact, not a night).
fn analyze(plays: &[DetectionPlay]) -> Option<Analysis> {
    let timed = timed_plays(plays);
    if timed.len() < MIN_PLAYS_FOR_DETECTION {
        return None;
    }

    let first = timed[0].epoch;
    let span_sec = timed[timed.len() - 1].epoch - first;
    if span_sec <= 0 {
        return None;
    }

    // v0's shape verbatim (`dancefloor.ts:79-90`), including the clamp: a span
    // that is an exact multiple of the window size puts the final play one index
    // past the end.
    let window_count = (((span_sec + WINDOW_SEC - 1) / WINDOW_SEC).max(1)) as usize;
    if window_count > MAX_WINDOW_COUNT {
        return None;
    }
    let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); window_count];
    let mut window_of = Vec::with_capacity(timed.len());
    for (i, play) in timed.iter().enumerate() {
        let w = (((play.epoch - first) / WINDOW_SEC) as usize).min(window_count - 1);
        buckets[w].push(i);
        window_of.push(w);
    }

    // Smoothness pair convention (D-22, within D-6's intent): a delta needs BOTH
    // plays' BPM, and each pair is attributed to the window holding the SECOND
    // play's start — counted exactly once, no boundary double-count.
    //
    // A pair straddling a true silence gap of IDLE_LABEL_MIN_SEC or more is
    // skipped entirely (code review finding, 2026-08-10): nobody was dancing
    // between the two tracks, so the delta between them isn't a real mixing
    // transition, and folding it into the post-gap window's own median could
    // tip an otherwise-smooth bridged run below its floor for reasons unrelated
    // to actual mixing quality — a distinct failure mode from D-13's tolerated
    // in-window outlier. Reuses the already-locked idle threshold rather than
    // inventing a new number.
    let mut deltas: Vec<Vec<f64>> = vec![Vec::new(); window_count];
    for i in 1..timed.len() {
        if timed[i].epoch - timed[i - 1].epoch >= IDLE_LABEL_MIN_SEC {
            continue;
        }
        if let (Some(prev), Some(curr)) = (timed[i - 1].bpm, timed[i].bpm) {
            deltas[window_of[i]].push((curr - prev).abs());
        }
    }

    let stats = buckets
        .iter()
        .zip(deltas.iter())
        .map(|(indices, window_deltas)| {
            let bpms: Vec<f64> = indices.iter().filter_map(|&i| timed[i].bpm).collect();
            WindowStats {
                density: indices.len(),
                median_bpm: median(&bpms),
                median_abs_bpm_delta: median(window_deltas),
            }
        })
        .collect();

    Some(Analysis {
        timed,
        window_of,
        stats,
    })
}

/// This session's per-window signals — the raw material a *later* session's
/// calibration pool is built from (D-23). Empty when detection declines.
pub fn window_stats(plays: &[DetectionPlay]) -> Vec<WindowStats> {
    analyze(plays).map(|a| a.stats).unwrap_or_default()
}

// ---- Calibration (D-8, D-9, D-23) -------------------------------------------

/// Median of a slice, or `None` when it is empty. `total_cmp` rather than
/// `partial_cmp().unwrap()`: same determinism discipline as
/// [`crate::stats::bpm_distribution`], and no panic path on a stray `NaN`.
fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let n = sorted.len();
    Some(if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    })
}

/// Nearest-rank percentile (`ceil(p/100 * n)`, 1-based), no interpolation.
///
/// Deliberately the simplest defensible definition: it always returns a value
/// the DJ actually played, which is what makes a floor debuggable ("your 60th-
/// percentile window had 4 plays") rather than a synthesized number between two
/// observations.
fn percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let rank = (p / 100.0 * sorted.len() as f64).ceil().max(1.0) as usize;
    Some(sorted[rank.min(sorted.len()) - 1])
}

/// The per-DJ floors for a session, from that DJ's own historical window stats
/// (D-8) blended with the shared prior by how much history there is (D-9).
///
/// `history` is the flattened window-stat pool of the sessions that qualify
/// (see [`CalibrationPool`]); `n_sessions` is how many sessions contributed it —
/// the blend weight is per-*session*, not per-window, so one 8-hour night does
/// not out-vote five short ones on how much to trust personal data.
///
/// Empty pool → pure prior, exactly (`n = 0` gives `w = 0`). A pool that has
/// density data but, say, no BPM anywhere falls back to the prior for that one
/// signal only — absent stays absent per signal, never zeroed (AD-11).
pub fn floors_from_history(history: &[WindowStats], n_sessions: usize) -> Floors {
    let prior = Floors::prior();
    let w = n_sessions as f64 / (n_sessions as f64 + BLEND_N);

    let densities: Vec<f64> = history.iter().map(|s| s.density as f64).collect();
    let bpms: Vec<f64> = history.iter().filter_map(|s| s.median_bpm).collect();
    let smoothness: Vec<f64> = history
        .iter()
        .filter_map(|s| s.median_abs_bpm_delta)
        .collect();

    let blend = |personal: Option<f64>, prior: f64| match personal {
        Some(value) => w * value + (1.0 - w) * prior,
        None => prior,
    };

    Floors {
        density: blend(percentile(&densities, FLOOR_PERCENTILE), prior.density),
        median_bpm: blend(percentile(&bpms, FLOOR_PERCENTILE), prior.median_bpm),
        smoothness: blend(percentile(&smoothness, FLOOR_PERCENTILE), prior.smoothness),
    }
}

/// One already-captured session's contribution to the calibration pool.
#[derive(Debug, Clone, PartialEq)]
pub struct PooledSession {
    /// The session's own start, Unix epoch seconds. `None` sorts first (see
    /// [`CalibrationPool::floors_before`]).
    pub started_at: Option<i64>,
    /// The store's dedup key — the deterministic tiebreak when two sessions
    /// share a `started_at` (D-23).
    pub session_identity: String,
    pub windows: Vec<WindowStats>,
}

/// Every captured session's window stats, ordered, ready to be sliced into
/// chronological prefixes (D-23).
///
/// **Why prefixes and not "all history".** `backfill::backfill_captured_serato4`
/// re-derives every captured row on launch and re-queues any row whose derived
/// data changed. Floors computed from "everything known right now" would shift
/// with every new capture, silently rewriting suggestions (and the card stats
/// scoped to them) a DJ has already seen — and re-queueing ~491 sets on every
/// launch, forever. With predecessor-only pools a re-derivation is byte-stable,
/// each historical session is calibrated against what actually preceded it, and
/// a new session still sees the DJ's full history.
///
/// Held live, never persisted (D-16): this is a rollup of data the store already
/// has, so there is no second copy to keep in sync.
#[derive(Debug, Clone, Default)]
pub struct CalibrationPool {
    sessions: Vec<PooledSession>,
}

/// Total, deterministic pool order: `started_at`, then `session_identity`
/// (D-23). Sessions with no known start sort first — they cannot be placed in
/// the timeline, and putting them at the front means they calibrate everything
/// rather than nothing, which is the more useful of two arbitrary choices.
fn pool_key(session: &PooledSession) -> (i64, &str) {
    (
        session.started_at.unwrap_or(i64::MIN),
        session.session_identity.as_str(),
    )
}

impl CalibrationPool {
    /// Sorts the given sessions into pool order and drops the ones that
    /// contribute nothing — a session below [`MIN_PLAYS_FOR_DETECTION`] produces
    /// no windows, and a 2-track cue-up must not pull a DJ's floors down (D-23).
    ///
    /// **No confidence-based practice filter, deliberately.** One was drafted for
    /// this pool and struck at story validation: `confidence.rs` is explicit that
    /// its value is *symmetric classifiability*, "not a live/practice
    /// probability" — sparse long-gap bedroom previewing scores `1.0` while a
    /// tight gapless club set scores `0.2`, so filtering on it would have
    /// excluded exactly the sessions worth calibrating from. No directional
    /// live/practice signal exists agent-side today; the pool therefore takes
    /// everything above the plays floor, and the accepted cost (a heavy-practice
    /// DJ's sparse windows pulling P60 down somewhat, damped by the percentile
    /// placement and the prior blend) is recorded rather than papered over.
    pub fn new(sessions: Vec<PooledSession>) -> Self {
        let mut sessions: Vec<PooledSession> = sessions
            .into_iter()
            .filter(|s| !s.windows.is_empty())
            .collect();
        sessions.sort_by(|a, b| pool_key(a).cmp(&pool_key(b)));
        Self { sessions }
    }

    /// How many sessions are in the pool at all (diagnostics/tests).
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// The floors for a session identified by `(started_at, session_identity)`,
    /// computed from the sessions **strictly earlier** than it.
    ///
    /// Strictness is what excludes the target session from its own pool — which
    /// matters, because by the time `backfill` re-derives a session it is already
    /// in the store.
    pub fn floors_before(&self, started_at: Option<i64>, session_identity: &str) -> Floors {
        let key = (started_at.unwrap_or(i64::MIN), session_identity);
        let cut = self.sessions.partition_point(|s| pool_key(s) < key);
        let predecessors = &self.sessions[..cut];
        let history: Vec<WindowStats> = predecessors
            .iter()
            .flat_map(|s| s.windows.iter().copied())
            .collect();
        floors_from_history(&history, predecessors.len())
    }
}

// ---- Detection --------------------------------------------------------------

/// Whether a window is a dancefloor **candidate** (D-4): density clears its
/// floor, and — only when the window actually has BPM data — so does the median
/// tempo. A dense window with no BPM at all still qualifies rather than being
/// judged against a tempo nobody knows (AD-11; v0's `med == null ||` verbatim).
fn clears_candidacy(stats: &WindowStats, floors: &Floors) -> bool {
    stats.density as f64 >= floors.density
        && stats.median_bpm.is_none_or(|bpm| bpm >= floors.median_bpm)
}

/// The longest true silence between consecutive timed plays anywhere in
/// `timed[from..=to]`.
///
/// Measured over *every* consecutive pair in the span, not just its endpoints:
/// a bridged window with two plays in it breaks a 40-minute void into three
/// shorter gaps, and only the real dead air should hard-break a run.
fn max_silence(timed: &[TimedPlay], from: usize, to: usize) -> i64 {
    let mut max = 0;
    for i in (from + 1)..=to {
        max = max.max(timed[i].epoch - timed[i - 1].epoch);
    }
    max
}

/// Every maximal run of candidate windows, bridging short sub-floor gaps and
/// hard-breaking on long real silence (D-11/D-12/D-22).
///
/// Generalized from v0's single longest-run search: AC-4/D-15 require *all*
/// qualifying runs, so a night with a warm-up floor and a peak floor either side
/// of a dinner break yields two candidates, not one. A run simply stops where
/// the data stops — no inverse "dancefloor ended" signal, and no whole-night
/// fallback (D-12; `WHOLE_NIGHT_FRACTION` is dropped, D-22).
fn candidate_runs(analysis: &Analysis, floors: &Floors) -> Vec<(usize, usize)> {
    let clears: Vec<bool> = analysis
        .stats
        .iter()
        .map(|s| clears_candidacy(s, floors))
        .collect();

    // Last/first timed-play index inside each window, for the silence check.
    // `None` for an empty window.
    let mut first_in: Vec<Option<usize>> = vec![None; clears.len()];
    let mut last_in: Vec<Option<usize>> = vec![None; clears.len()];
    for (i, &w) in analysis.window_of.iter().enumerate() {
        if first_in[w].is_none() {
            first_in[w] = Some(i);
        }
        last_in[w] = Some(i);
    }

    let mut runs = Vec::new();
    let mut i = 0;
    while i < clears.len() {
        if !clears[i] {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i;
        let mut j = i + 1;
        while j < clears.len() {
            if clears[j] {
                end = j;
                j += 1;
                continue;
            }
            // A sub-floor stretch: find the next candidate window, and decide
            // whether to bridge to it.
            let mut next = j;
            while next < clears.len() && !clears[next] {
                next += 1;
            }
            if next >= clears.len() || next - j > GAP_MERGE_WINDOWS {
                break;
            }
            // Even a single-window gap hard-breaks when the plays either side of
            // it are more than IDLE_HARD_BREAK_SEC apart in real time (D-22).
            match (last_in[end], first_in[next]) {
                (Some(from), Some(to))
                    if max_silence(&analysis.timed, from, to) > IDLE_HARD_BREAK_SEC =>
                {
                    break;
                }
                _ => {}
            }
            end = next;
            j = next + 1;
        }
        runs.push((start, end));
        i = end + 1;
    }
    runs
}

/// Whether a candidate run confirms (D-5/D-6/D-7): the median of its windows'
/// median-|BPM delta| values is at or below the DJ's own smoothness floor.
///
/// A run whose windows carry no delta data at all passes vacuously — there is
/// nothing to judge it on, and inventing a failure would be guessing (AD-11).
fn confirms(analysis: &Analysis, run: (usize, usize), floors: &Floors) -> bool {
    let values: Vec<f64> = analysis.stats[run.0..=run.1]
        .iter()
        .filter_map(|s| s.median_abs_bpm_delta)
        .collect();
    match median(&values) {
        Some(smoothness) => smoothness <= floors.smoothness,
        None => true,
    }
}

/// Long stretches of silence, labeled (D-10). Independent of candidacy and of
/// runs: this is descriptive data, and computing it separately keeps it from
/// quietly becoming a gate.
fn idle_gaps(timed: &[TimedPlay]) -> Vec<IdleGap> {
    let mut gaps = Vec::new();
    for i in 1..timed.len() {
        if timed[i].epoch - timed[i - 1].epoch >= IDLE_LABEL_MIN_SEC {
            gaps.push(IdleGap {
                start_epoch_s: timed[i - 1].epoch,
                end_epoch_s: timed[i].epoch,
            });
        }
    }
    gaps
}

/// Runs one session's full detection pass against this DJ's floors.
///
/// Returns zero, one, or several segments (D-15/AC-4) plus any idle gaps
/// (AC-3). Below [`MIN_PLAYS_FOR_DETECTION`] timed plays it returns neither —
/// v0's "not worth attempting", carried forward.
pub fn detect(plays: &[DetectionPlay], floors: &Floors) -> Detection {
    let Some(analysis) = analyze(plays) else {
        return Detection::default();
    };

    let segments = candidate_runs(&analysis, floors)
        .into_iter()
        .filter(|&run| confirms(&analysis, run, floors))
        .filter_map(|run| segment_positions(&analysis, run))
        .collect();

    Detection {
        segments,
        idle_gaps: idle_gaps(&analysis.timed),
    }
}

/// A run's play-position bounds.
///
/// Min and max *position* over the run's plays rather than "first and last by
/// time": `enrich_session` already guarantees chronological order so the two
/// agree in practice, but taking the extremes guarantees `first <= last`
/// unconditionally — the exact invariant the RPC validates before resolving
/// these to `plays.id`s (D-20), and one that should never be able to fail from
/// the agent's side.
fn segment_positions(analysis: &Analysis, run: (usize, usize)) -> Option<SuggestedSegment> {
    let positions: Vec<usize> = analysis
        .window_of
        .iter()
        .enumerate()
        .filter(|&(_, &w)| w >= run.0 && w <= run.1)
        .map(|(i, _)| analysis.timed[i].position)
        .collect();
    Some(SuggestedSegment {
        first_position: *positions.iter().min()?,
        last_position: *positions.iter().max()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A play at `epoch` seconds with an optional BPM; positions are assigned in
    /// input order, the way `capture::assemble` numbers them.
    fn plays(spec: &[(i64, Option<f64>)]) -> Vec<DetectionPlay> {
        spec.iter()
            .enumerate()
            .map(|(i, &(epoch, bpm))| DetectionPlay {
                position: i + 1,
                start_time: Some(epoch),
                bpm,
            })
            .collect()
    }

    /// `count` plays starting at `start`, one every `every` seconds, all at `bpm`.
    fn run_of(start: i64, count: usize, every: i64, bpm: Option<f64>) -> Vec<(i64, Option<f64>)> {
        (0..count)
            .map(|i| (start + i as i64 * every, bpm))
            .collect()
    }

    // ---- Cold start == v0 -----------------------------------------------------

    /// (AC-2, D-9) With no history at all the floors ARE v0's retired constants —
    /// the "no cliff, no empty state" half of the cold-start rule.
    #[test]
    fn empty_pool_yields_exactly_the_prior() {
        let floors = floors_from_history(&[], 0);
        assert_eq!(floors, Floors::prior());
        assert_eq!(floors.density, 3.0);
        assert_eq!(floors.median_bpm, 118.0);
    }

    /// (AC-1, AC-2, D-9) The ported `dancefloor.test.ts:55-70` scenario: a sparse
    /// slow warm-up followed by a dense 128-BPM run. At cold start — prior floors,
    /// exactly v0's numbers — only the dense run is a dancefloor.
    #[test]
    fn cold_start_reproduces_v0_candidacy_on_the_warm_up_then_peak_shape() {
        let mut spec = Vec::new();
        // Warm-up: 2 plays per 10-min window at 100 BPM — under the density floor.
        spec.extend(run_of(0, 6, 300, Some(100.0)));
        // Peak: 4 plays per window at 128 BPM across three windows.
        spec.extend(run_of(1_800, 12, 150, Some(128.0)));

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1, "one dancefloor, not two");
        let segment = detection.segments[0];
        assert!(
            segment.first_position >= 7,
            "the warm-up must not be inside the floor (got {segment:?})"
        );
        assert_eq!(segment.last_position, 18, "the run extends to end-of-data");
    }

    /// (D-3, AD-11) A dense window with no BPM data anywhere still qualifies —
    /// v0's `med == null ||` precedent. Never judged against a guessed tempo.
    #[test]
    fn a_dense_window_with_no_bpm_still_clears_candidacy() {
        let spec = run_of(0, 12, 150, None);
        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(detection.segments[0].first_position, 1);
        assert_eq!(detection.segments[0].last_position, 12);
    }

    /// (D-3) Below the plays floor: no segments AND no idle gaps, even though the
    /// four plays below are 30 minutes apart and would otherwise be labeled idle.
    #[test]
    fn under_min_plays_yields_nothing_at_all() {
        let spec = run_of(0, 4, 1_800, Some(128.0));
        let detection = detect(&plays(&spec), &Floors::prior());
        assert!(detection.segments.is_empty());
        assert!(detection.idle_gaps.is_empty());
        assert!(window_stats(&plays(&spec)).is_empty());
    }

    /// (Code review finding, 2026-08-10) A session whose span would bucket into
    /// more than [`MAX_WINDOW_COUNT`] windows declines detection entirely rather
    /// than allocating a correspondingly enormous `Vec` — the same "decline, not
    /// guess" shape as a non-positive span or too few plays.
    #[test]
    fn a_span_beyond_the_window_count_ceiling_declines_detection() {
        let far_future = MAX_WINDOW_COUNT as i64 * WINDOW_SEC + WINDOW_SEC;
        let spec: Vec<(i64, Option<f64>)> = vec![
            (0, Some(124.0)),
            (150, Some(124.0)),
            (300, Some(124.0)),
            (far_future, Some(124.0)),
            (far_future + 150, Some(124.0)),
            (far_future + 300, Some(124.0)),
        ];
        let detection = detect(&plays(&spec), &Floors::prior());
        assert!(detection.segments.is_empty());
        assert!(detection.idle_gaps.is_empty());
        assert!(window_stats(&plays(&spec)).is_empty());
    }

    // ---- Domain edge cases ----------------------------------------------------

    /// (D-13) A single off-tempo request drop mid-floor must not break the run —
    /// the window-median floors and the median-of-medians smoothness aggregate
    /// tolerate it by construction, with no special case.
    #[test]
    fn an_isolated_request_drop_does_not_break_the_run() {
        let mut spec = run_of(0, 18, 150, Some(128.0));
        // "Special request, gentlemen" — one 92-BPM record in the sixth slot.
        spec[6].1 = Some(92.0);

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1, "still one continuous floor");
        assert_eq!(detection.segments[0].first_position, 1);
        // 16, not 18: the night's last window is a *partial* one (2 plays in its
        // first 150 s) and fails density on its own terms. That is v0's window
        // shape unchanged (D-3/D-22 carry it deliberately), and a boundary 5.3's
        // editor exists to nudge — not a break in the run.
        assert_eq!(detection.segments[0].last_position, 16);
    }

    /// (D-14) An end-of-night announcement cluster — several irregular tracks in a
    /// row, talking eating the density — ends the run before it rather than being
    /// bridged through.
    ///
    /// The accepted edge D-14 names is exercised by the sibling test below: a
    /// *short* cluster (one window) still gets absorbed by the ordinary bridge
    /// tolerance. That is documented v1 behavior, correctable in 5.3's editor, not
    /// a bug to engineer around here.
    #[test]
    fn a_multi_window_announcement_tail_ends_the_run() {
        let mut spec = run_of(0, 16, 150, Some(128.0));
        // Two sparse, tempo-unstable windows at the tail: one play each.
        spec.push((2_500, Some(95.0)));
        spec.push((3_100, Some(140.0)));
        spec.push((3_700, Some(88.0)));

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(
            detection.segments[0].last_position, 16,
            "the run ends before the announcement cluster"
        );
    }

    /// (D-14, accepted risk) The documented counterpart: a ONE-window cluster is
    /// absorbed by the regular bridge tolerance when the floor resumes after it.
    /// Asserted so the accepted edge is visible in the suite rather than folklore.
    #[test]
    fn a_single_window_announcement_cluster_is_absorbed_as_documented() {
        let mut spec = run_of(0, 12, 150, Some(128.0));
        spec.push((1_900, Some(95.0))); // one sparse window …
        spec.extend(run_of(2_400, 8, 150, Some(128.0))); // … then the floor resumes

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(
            detection.segments.len(),
            1,
            "documented D-14 edge: a short cluster is bridged, not split"
        );
    }

    // ---- Zero / one / several (D-15, AC-4) ------------------------------------

    /// (AC-4) Nothing qualifies → zero segments. Not "the whole set as a
    /// fallback": that was v0's UI-driven `null`, and D-22 dropped it.
    #[test]
    fn a_sparse_night_yields_zero_segments() {
        let spec = run_of(0, 8, 700, Some(128.0)); // ~1 play per window
        let detection = detect(&plays(&spec), &Floors::prior());
        assert!(detection.segments.is_empty());
    }

    /// (AC-4, D-15) The AD-17 two-dancefloor shape: an 8.6-hour night with a
    /// cocktail-hour floor, a real dinner break, and a peak floor. Two segments —
    /// never collapsed to one, never forced to one.
    #[test]
    fn an_86_hour_night_with_a_dinner_break_yields_two_segments() {
        let mut spec = Vec::new();
        spec.extend(run_of(0, 16, 150, Some(126.0))); // cocktail hour, 40 min
                                                      // 75 minutes of dinner: far past IDLE_HARD_BREAK_SEC.
        spec.extend(run_of(6_800, 40, 150, Some(130.0))); // peak, 100 min

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 2, "two floors, not one");
        assert_eq!(detection.segments[0].first_position, 1);
        assert_eq!(detection.segments[0].last_position, 16);
        assert_eq!(detection.segments[1].first_position, 17);
        // 55, not 56 — the trailing partial window again (see the request-drop
        // test's note); the peak's own last full window closes the run.
        assert_eq!(detection.segments[1].last_position, 55);
        assert_eq!(detection.idle_gaps.len(), 1, "the dinner break is labeled");
    }

    /// (AC-3, D-10) Idle labeling is independent of candidacy: a gap inside an
    /// otherwise-qualifying stretch is still labeled, and labeling it neither
    /// creates nor destroys a segment.
    #[test]
    fn idle_gaps_are_labeled_from_true_silence_not_from_windows() {
        let mut spec = run_of(0, 12, 150, Some(128.0));
        spec.extend(run_of(2_500, 12, 150, Some(128.0))); // ~19 min of silence
        let detection = detect(&plays(&spec), &Floors::prior());

        assert_eq!(detection.idle_gaps.len(), 1);
        assert_eq!(detection.idle_gaps[0].start_epoch_s, 1_650);
        assert_eq!(detection.idle_gaps[0].end_epoch_s, 2_500);
    }

    /// (D-12) A set that ends mid-peak — the common case — needs no special
    /// handling: the run stops where the data stops.
    #[test]
    fn a_run_extends_to_the_edge_of_the_data() {
        let spec = run_of(0, 30, 120, Some(130.0));
        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(detection.segments[0].last_position, 30);
    }

    /// (D-22) The whole night qualifying is a real, useful suggestion now — v0
    /// returned `null` above `WHOLE_NIGHT_FRACTION` because its only consumer
    /// wanted a stats *cut*; the row model has no such need.
    #[test]
    fn a_whole_night_floor_is_emitted_rather_than_suppressed() {
        let spec = run_of(0, 60, 120, Some(130.0));
        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(detection.segments[0].first_position, 1);
        assert_eq!(detection.segments[0].last_position, 60);
    }

    // ---- Bridge matrix (D-11, D-22) -------------------------------------------

    /// (D-11) One sub-floor window between two clearing ones bridges — a brief
    /// lull is not a new set. v0's behavior, kept.
    #[test]
    fn a_single_sub_floor_window_bridges() {
        let mut spec = run_of(0, 12, 150, Some(128.0));
        spec.push((1_900, Some(128.0))); // lone play in the next window
        spec.extend(run_of(2_400, 12, 150, Some(128.0)));

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(detection.segments[0].last_position, 25);
    }

    /// (D-11) TWO sub-floor windows break the run into two candidates.
    #[test]
    fn two_sub_floor_windows_break_the_run() {
        let mut spec = run_of(0, 12, 150, Some(128.0));
        spec.push((1_900, Some(128.0)));
        spec.push((2_500, Some(128.0)));
        spec.extend(run_of(3_000, 12, 150, Some(128.0)));

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(detection.segments.len(), 2);
    }

    /// (D-22, the load-bearing case) A gap that fits inside ONE bridgeable window
    /// but hides more than `IDLE_HARD_BREAK_SEC` of real dead air hard-breaks
    /// anyway. This is what makes the idle threshold genuinely shorter than the
    /// window-count bridge, and what stops a dinner break being bridged.
    #[test]
    fn a_single_window_gap_hiding_long_real_silence_hard_breaks() {
        let mut spec = run_of(0, 12, 150, Some(128.0)); // ends at t=1650
                                                        // Next play 1_500 s later — one window's worth of window-count distance,
                                                        // but 25 minutes of actual silence.
        spec.extend(run_of(3_150, 12, 150, Some(128.0)));

        let detection = detect(&plays(&spec), &Floors::prior());
        assert_eq!(
            detection.segments.len(),
            2,
            "true silence beats the window-count bridge"
        );
    }

    // ---- Confirmation gate (D-5, D-6, D-7) ------------------------------------

    /// (Code review finding, 2026-08-10) A BPM delta manufactured by resuming
    /// after a true silence gap must not count against smoothness — nobody was
    /// dancing between the two tracks, so it is not a real mixing transition.
    /// Without excluding it, the huge jump either side of a bridged gap can
    /// dominate the run's median-of-medians and fail an otherwise dead-smooth
    /// run; excluding gap-spanning pairs from delta computation (reusing the
    /// already-locked `IDLE_LABEL_MIN_SEC` threshold) fixes it. A minimal custom
    /// `Floors` (density/BPM floor of zero) isolates the smoothness gate from the
    /// candidacy gate, which is not what this test is about.
    #[test]
    fn a_cross_gap_bpm_delta_does_not_contaminate_smoothness() {
        let floors = Floors {
            density: 1.0,
            median_bpm: 0.0,
            smoothness: 6.0,
        };
        let spec: Vec<(i64, Option<f64>)> = vec![
            (0, Some(124.0)),     // window 0, alone
            (650, Some(300.0)),   // window 1 -- 650s true silence before it
            (1_300, Some(124.0)), // window 2 -- 650s true silence before it
            (1_850, Some(124.0)), // window 3 -- ordinary 550s transition
            (2_000, Some(124.0)), // window 3 -- ordinary 150s transition
            (2_150, Some(124.0)), // window 3 -- ordinary 150s transition
        ];

        let detection = detect(&plays(&spec), &floors);
        assert_eq!(
            detection.segments.len(),
            1,
            "the two 176-BPM cross-gap deltas must not fail a run whose real \
             transitions are all 0"
        );
        assert_eq!(detection.segments[0].first_position, 1);
        assert_eq!(detection.segments[0].last_position, 6);
    }

    /// (D-5) A run that clears density and BPM can still fail on smoothness, and a
    /// failing candidate is discarded — never emitted as a rougher segment.
    #[test]
    fn a_dense_but_jumpy_run_fails_confirmation_and_is_discarded() {
        // Dense and fast, but every transition swings ~20 BPM.
        let spec: Vec<(i64, Option<f64>)> = (0..18)
            .map(|i| {
                let bpm = if i % 2 == 0 { 122.0 } else { 142.0 };
                (i as i64 * 150, Some(bpm))
            })
            .collect();

        let detection = detect(&plays(&spec), &Floors::prior());
        assert!(
            detection.segments.is_empty(),
            "20-BPM jumps must not confirm against a 6.0 smoothness floor"
        );
    }

    /// (D-6, D-7) The same shape confirms once the DJ's OWN history says that is
    /// how they mix — the wedding-DJ-vs-club-DJ case, resolved without ever
    /// encoding a DJ "type".
    #[test]
    fn the_same_jumpy_run_confirms_against_a_jumpy_djs_own_floors() {
        let spec: Vec<(i64, Option<f64>)> = (0..18)
            .map(|i| {
                let bpm = if i % 2 == 0 { 122.0 } else { 142.0 };
                (i as i64 * 150, Some(bpm))
            })
            .collect();

        // A history of nights that all look like this one: dense, fast, and
        // habitually jumping ~25 BPM a transition.
        let history: Vec<WindowStats> = (0..20)
            .map(|_| WindowStats {
                density: 4,
                median_bpm: Some(130.0),
                median_abs_bpm_delta: Some(25.0),
            })
            .collect();
        let floors = floors_from_history(&history, 20);
        assert!(
            floors.smoothness > SMOOTHNESS_PRIOR_ABS_BPM_DELTA,
            "personal data moved the floor"
        );

        let detection = detect(&plays(&spec), &floors);
        assert_eq!(detection.segments.len(), 1);
    }

    /// (AD-11) A run with no BPM data anywhere has no transitions to judge, so it
    /// confirms vacuously rather than being failed on absent evidence.
    #[test]
    fn a_run_with_no_delta_data_confirms_vacuously() {
        let spec = run_of(0, 18, 150, None);
        // A floor tight enough that any real delta would fail it.
        let floors = Floors {
            smoothness: 0.0,
            ..Floors::prior()
        };
        assert_eq!(detect(&plays(&spec), &floors).segments.len(), 1);
    }

    // ---- AC-5: DST ------------------------------------------------------------

    /// (AC-5) A session spanning the US fall-back DST transition. In local time
    /// 01:30 happens twice; in epoch seconds — the only clock this module reads —
    /// the timeline is strictly increasing and every consecutive delta is
    /// non-negative, so neither density nor smoothness is corrupted by the
    /// repeated hour.
    #[test]
    fn a_dst_spanning_session_keeps_deltas_non_negative_and_monotonic() {
        // 2026-11-01 05:00 UTC = 01:00 EDT; the repeat lands at 06:00 UTC = 01:00 EST.
        const FALL_BACK_UTC: i64 = 1_793_509_200;
        let spec: Vec<(i64, Option<f64>)> = (0..40)
            .map(|i| (FALL_BACK_UTC + i as i64 * 150, Some(128.0)))
            .collect();
        let input = plays(&spec);

        let timed = timed_plays(&input);
        for pair in timed.windows(2) {
            assert!(
                pair[1].epoch - pair[0].epoch >= 0,
                "epoch deltas must never go backwards across a repeated local hour"
            );
        }
        assert!(
            timed.windows(2).all(|p| p[1].epoch > p[0].epoch),
            "the timeline is strictly increasing"
        );

        // And the pass over that timeline behaves like any other continuous run:
        // one segment spanning the whole thing, no phantom idle gap where the
        // local clock repeated.
        let detection = detect(&input, &Floors::prior());
        assert_eq!(detection.segments.len(), 1);
        assert_eq!(detection.segments[0].first_position, 1);
        assert_eq!(detection.segments[0].last_position, 40);
        assert!(detection.idle_gaps.is_empty());
    }

    /// (AC-5) Out-of-order input is sorted, not clamped into the wrong window —
    /// the property that makes the monotonicity above hold for real data rather
    /// than only for pre-sorted test data.
    #[test]
    fn out_of_order_plays_are_sorted_before_bucketing() {
        let mut spec = run_of(0, 12, 150, Some(128.0));
        spec.swap(2, 9);
        let timed = timed_plays(&plays(&spec));
        assert!(timed.windows(2).all(|p| p[0].epoch <= p[1].epoch));
    }

    // ---- Percentile / blend math (D-8, D-9) -----------------------------------

    /// (D-8) Nearest-rank P60 over a known pool, and the blend at a known weight.
    #[test]
    fn percentile_and_blend_math_are_exact() {
        // Ranks 1..10; ceil(0.60 * 10) = 6 -> the 6th smallest.
        let values: Vec<f64> = (1..=10).map(f64::from).collect();
        assert_eq!(percentile(&values, 60.0), Some(6.0));
        assert_eq!(percentile(&[], 60.0), None);
        assert_eq!(percentile(&[42.0], 60.0), Some(42.0));

        let history: Vec<WindowStats> = values
            .iter()
            .map(|&v| WindowStats {
                density: v as usize,
                median_bpm: Some(100.0 + v),
                median_abs_bpm_delta: Some(v),
            })
            .collect();

        // n = 5 is the half-weight point: exactly halfway between prior and personal.
        let floors = floors_from_history(&history, 5);
        assert!((floors.density - (0.5 * 6.0 + 0.5 * 3.0)).abs() < 1e-9);
        assert!((floors.median_bpm - (0.5 * 106.0 + 0.5 * 118.0)).abs() < 1e-9);
        assert!((floors.smoothness - (0.5 * 6.0 + 0.5 * 6.0)).abs() < 1e-9);
    }

    /// (D-9) A single-session pool leans mostly on the prior but has already
    /// moved — the "no cliff anywhere" property, asserted rather than assumed.
    #[test]
    fn a_single_session_pool_moves_the_floor_without_a_cliff() {
        let history = vec![WindowStats {
            density: 9,
            median_bpm: Some(140.0),
            median_abs_bpm_delta: Some(2.0),
        }];
        let floors = floors_from_history(&history, 1);
        let w = 1.0 / 6.0;
        assert!((floors.density - (w * 9.0 + (1.0 - w) * 3.0)).abs() < 1e-9);
        assert!(floors.density > DENSITY_PRIOR && floors.density < 9.0);
    }

    /// (AD-11) A pool with density data but no BPM/smoothness data anywhere falls
    /// back to the prior for those two signals only — never to zero, which would
    /// silently admit every window.
    #[test]
    fn signals_absent_from_the_pool_fall_back_to_their_own_prior() {
        let history = vec![
            WindowStats {
                density: 8,
                median_bpm: None,
                median_abs_bpm_delta: None,
            };
            4
        ];
        let floors = floors_from_history(&history, 4);
        assert_eq!(floors.median_bpm, BPM_PRIOR);
        assert_eq!(floors.smoothness, SMOOTHNESS_PRIOR_ABS_BPM_DELTA);
        assert!(floors.density > DENSITY_PRIOR);
    }

    // ---- Chronological pool (D-23) --------------------------------------------

    fn pooled(started_at: i64, identity: &str, density: usize) -> PooledSession {
        PooledSession {
            started_at: Some(started_at),
            session_identity: identity.to_string(),
            windows: vec![
                WindowStats {
                    density,
                    median_bpm: Some(130.0),
                    median_abs_bpm_delta: Some(3.0),
                };
                3
            ],
        }
    }

    /// (D-23) The no-churn property, asserted: adding a LATER session to the pool
    /// cannot change an earlier session's floors. This is what makes
    /// `backfill_captured_serato4` self-terminating instead of re-queueing every
    /// set on every launch.
    #[test]
    fn a_later_capture_never_changes_an_earlier_sessions_floors() {
        let before = CalibrationPool::new(vec![
            pooled(1_000, "serato4:1", 4),
            pooled(2_000, "serato4:2", 5),
        ]);
        let target = before.floors_before(Some(2_000), "serato4:2");

        let after = CalibrationPool::new(vec![
            pooled(1_000, "serato4:1", 4),
            pooled(2_000, "serato4:2", 5),
            pooled(9_000, "serato4:9", 40),
        ]);
        assert_eq!(after.floors_before(Some(2_000), "serato4:2"), target);
    }

    /// (D-23) A session is never in its own pool, and the tiebreak on
    /// `session_identity` makes same-`started_at` ordering total.
    #[test]
    fn the_pool_is_strictly_earlier_with_an_identity_tiebreak() {
        let pool = CalibrationPool::new(vec![
            pooled(1_000, "serato4:a", 9),
            pooled(1_000, "serato4:b", 9),
        ]);
        // "a" precedes "b": "a" sees nothing, "b" sees "a".
        assert_eq!(
            pool.floors_before(Some(1_000), "serato4:a"),
            Floors::prior()
        );
        assert_ne!(
            pool.floors_before(Some(1_000), "serato4:b"),
            Floors::prior()
        );
    }

    /// (D-23) A session below the plays floor contributes no windows and is
    /// dropped from the pool entirely — a 2-track cue-up must not drag the floors
    /// down, and must not count toward the blend weight either.
    #[test]
    fn a_sub_min_plays_session_is_excluded_from_the_pool() {
        let pool = CalibrationPool::new(vec![
            pooled(1_000, "serato4:1", 9),
            PooledSession {
                started_at: Some(1_500),
                session_identity: "serato4:cue-up".to_string(),
                windows: Vec::new(),
            },
        ]);
        assert_eq!(pool.len(), 1);
        assert_eq!(
            pool.floors_before(Some(9_000), "serato4:later"),
            floors_from_history(&pooled(1_000, "serato4:1", 9).windows, 1)
        );
    }

    /// (D-9) The very first session a DJ ever plays gets the pure prior — the
    /// cold-start path, through the pool rather than through the bare function.
    #[test]
    fn the_first_session_gets_the_pure_prior_through_the_pool() {
        let pool = CalibrationPool::new(Vec::new());
        assert!(pool.is_empty());
        assert_eq!(
            pool.floors_before(Some(1_000), "serato4:1"),
            Floors::prior()
        );
    }

    /// (D-23) `window_stats` is what the pool is built from, so it has to agree
    /// with what `detect` saw — same windows, same signals, one code path.
    #[test]
    fn window_stats_reports_the_signals_detection_ran_on() {
        let spec = run_of(0, 12, 150, Some(128.0));
        let stats = window_stats(&plays(&spec));
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].density, 4);
        assert_eq!(stats[0].median_bpm, Some(128.0));
        // Constant BPM: every delta is 0. The first window holds 3 of them (the
        // very first play begins no pair).
        assert_eq!(stats[0].median_abs_bpm_delta, Some(0.0));
    }
}
