//! Golden segments fixture (Story 5.2, Task 5.4) — the bridge between the ONE
//! detection algorithm (`stats::segments`, Rust) and the two places `web/` needs
//! its output without being able to run it: `supabase/seed.sql` (so the local
//! browser pass has real `segments` rows to read) and the web unit tests.
//!
//! Unlike `export_real_fixtures.rs` this is **not** env-gated, because it needs
//! no private Serato data: it reads the already-committed
//! `web/lib/sets/recent-sets.fixture.json` — 58 real sets with real
//! `started_at`/`bpm` — and runs them through the real detector.
//!
//! It therefore doubles as a regression guard. If a tuning change moves a
//! boundary, this test fails and names the exact command to regenerate, instead
//! of letting `segments.fixture.json` (and the seed built from it) silently
//! drift away from the algorithm they claim to represent:
//!
//! ```sh
//! CURFEW_WRITE_SEGMENTS_FIXTURE=1 cargo test --test segments_fixture
//! node supabase/scripts/generate-seed.mjs
//! ```
//!
//! Sets are fed to the detector in TRUE chronological order (sorted by
//! `started_at`, not the committed file's own order — see `build_fixture`'s
//! comment), each calibrated against the ones before it (D-23) — the same
//! prefix rule the agent applies at runtime, so a fixture segment is what that
//! set would really have been given. Output stays in the committed file's own
//! order; only the internal processing order changed (code review finding,
//! 2026-08-10).

use std::path::{Path, PathBuf};

use agent_lib::stats::segments::{
    detect, window_stats, CalibrationPool, DetectionPlay, PooledSession,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    // <repo>/agent/src-tauri -> <repo>
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("manifest dir has a grandparent")
        .to_path_buf()
}

/// Parses the exact ISO-8601 UTC shape the committed fixture uses
/// (`2026-06-21T22:56:16.000Z`) into Unix epoch seconds.
///
/// Hand-rolled, and deliberately test-only: the agent has no date library at all
/// (epoch seconds everywhere is the whole convention — see the Consistency
/// table), and adding one so a fixture exporter can read ISO would be the tail
/// wagging the dog. Anything that does not match this shape returns `None` and
/// the play is treated as untimed, exactly as a `null` `started_at` would be.
fn iso_to_epoch(iso: &str) -> Option<i64> {
    let bytes = iso.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |from: usize, to: usize| iso[from..to].parse::<i64>().ok();
    let (y, m, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hh, mm, ss) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    Some(days_from_civil(y, m, d) * 86_400 + hh * 3_600 + mm * 60 + ss)
}

/// Days since the Unix epoch for a proleptic-Gregorian date (Howard Hinnant's
/// `days_from_civil`, the standard branch-free formulation).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = year - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn detection_plays(plays: &[Value]) -> Vec<DetectionPlay> {
    plays
        .iter()
        .enumerate()
        .map(|(i, p)| DetectionPlay {
            // The fixture carries its own `position`; fall back to input order
            // for a row that somehow lacks one, matching `capture::assemble`'s
            // `i + 1` numbering.
            position: p
                .get("position")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(i + 1),
            start_time: p
                .get("started_at")
                .and_then(Value::as_str)
                .and_then(iso_to_epoch),
            bpm: p.get("bpm").and_then(Value::as_f64),
        })
        .collect()
}

/// Recomputes the whole fixture's segments, chronologically calibrated.
fn build_fixture(sets: &[Value]) -> Value {
    // Code review finding (2026-08-10): `recent-sets.fixture.json` is committed
    // in REVERSE-chronological order (newest first — it's a "recent sets" list),
    // not chronological. Feeding it to the detector in file order while `pooled`
    // only ever holds previously-iterated entries meant every set except the one
    // processed last saw a `pooled` slice containing exclusively sessions that
    // are chronologically LATER than it — which `floors_before`'s strict-earlier
    // filter then always empties, regardless of `CalibrationPool::new`'s own
    // correct internal sort. The result was cold-start/pure-prior floors for
    // nearly every set. Fix: compute a chronological processing order up front,
    // walk the sets in THAT order, and only reorder the output back afterward so
    // downstream `external_id` lookups (`fixtureSegments.ts`, `generate-seed.mjs`)
    // are unaffected. Production code (`load_calibration_pool` in
    // `watcher/mod.rs`/`backfill.rs`) was independently verified NOT to have this
    // bug — it loads and sorts the whole pool in one call, with no progressive
    // per-item accumulation loop like this test harness had.
    let mut order: Vec<usize> = (0..sets.len()).collect();
    order.sort_by_key(|&i| {
        let started_at = sets[i]
            .get("started_at")
            .and_then(Value::as_str)
            .and_then(iso_to_epoch);
        let external_id = sets[i]
            .get("external_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        (
            started_at.unwrap_or(i64::MIN),
            format!("serato4:{external_id}"),
        )
    });

    let mut pooled: Vec<PooledSession> = Vec::new();
    let mut out: Vec<Option<Value>> = vec![None; sets.len()];

    for i in order {
        let set = &sets[i];
        let external_id = set
            .get("external_id")
            .and_then(Value::as_str)
            .expect("fixture set has an external_id")
            .to_string();
        let plays = detection_plays(
            set.get("plays")
                .and_then(Value::as_array)
                .expect("fixture set has plays"),
        );
        // The seed writes `serato4:<external_id>` as the session identity, so
        // the pool tiebreak here matches the one a real store would apply.
        let identity = format!("serato4:{external_id}");
        let started_at = set
            .get("started_at")
            .and_then(Value::as_str)
            .and_then(iso_to_epoch);

        let floors = CalibrationPool::new(pooled.clone()).floors_before(started_at, &identity);
        let detection = detect(&plays, &floors);

        out[i] = Some(json!({
            "external_id": external_id,
            "segments": detection.segments.iter().map(|s| json!({
                "type": "dancefloor",
                "first_position": s.first_position,
                "last_position": s.last_position,
            })).collect::<Vec<_>>(),
            "idle_gaps": detection.idle_gaps.iter().map(|g| json!({
                "start": g.start_epoch_s,
                "end": g.end_epoch_s,
            })).collect::<Vec<_>>(),
        }));

        pooled.push(PooledSession {
            started_at,
            session_identity: identity,
            windows: window_stats(&plays),
        });
    }

    Value::Array(
        out.into_iter()
            .map(|entry| entry.expect("every set index is filled exactly once"))
            .collect(),
    )
}

#[test]
fn committed_segments_fixture_matches_the_current_algorithm() {
    let root = repo_root();
    let sets_path = root.join("web/lib/sets/recent-sets.fixture.json");
    let fixture_path = root.join("web/lib/sets/segments.fixture.json");

    let sets: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(&sets_path).expect("recent-sets fixture is readable"),
    )
    .expect("recent-sets fixture is valid JSON");

    let computed = build_fixture(&sets);
    let rendered = format!(
        "{}\n",
        serde_json::to_string_pretty(&computed).expect("fixture serializes")
    );

    if std::env::var("CURFEW_WRITE_SEGMENTS_FIXTURE").is_ok() {
        std::fs::write(&fixture_path, &rendered).expect("fixture writes");
        println!("wrote {}", fixture_path.display());
        return;
    }

    let committed = std::fs::read_to_string(&fixture_path).unwrap_or_default();
    assert_eq!(
        committed,
        rendered,
        "web/lib/sets/segments.fixture.json is out of date with stats::segments. \
         It feeds supabase/seed.sql and the web unit tests, so a stale copy means the \
         local browser pass and the tests are asserting on segments the algorithm no \
         longer produces. Regenerate:\n  \
         CURFEW_WRITE_SEGMENTS_FIXTURE=1 cargo test --manifest-path agent/src-tauri/Cargo.toml --test segments_fixture\n  \
         node supabase/scripts/generate-seed.mjs"
    );
}

/// The reference gig (set 975 — 105 played rows, 5.9 h) is load-bearing for both
/// the seed and `web/lib/sets/setDetail.test.ts`, so its detected shape is
/// asserted directly rather than only via the whole-file diff above.
#[test]
fn the_reference_set_has_a_plausible_dancefloor() {
    let root = repo_root();
    let sets: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(root.join("web/lib/sets/recent-sets.fixture.json"))
            .expect("recent-sets fixture is readable"),
    )
    .expect("recent-sets fixture is valid JSON");

    let fixture = build_fixture(&sets);
    let reference = fixture
        .as_array()
        .expect("array")
        .iter()
        .find(|s| s["external_id"] == "975")
        .expect("set 975 is in the fixture -- it must never leave the export");

    let segments = reference["segments"].as_array().expect("segments array");
    assert!(
        !segments.is_empty(),
        "the reference gig is a real 5.9-hour dancefloor night; detecting nothing in it \
         would mean the floors are badly wrong"
    );
    for segment in segments {
        let first = segment["first_position"].as_u64().expect("first_position");
        let last = segment["last_position"].as_u64().expect("last_position");
        assert!(
            first >= 1 && first <= last,
            "{first}..{last} is not a valid span"
        );
        assert!(
            last <= 105,
            "{last} is past the reference set's play count -- the RPC would skip this entry"
        );
    }
}
