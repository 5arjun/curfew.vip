//! One-off, env-gated exporter that dumps the DJ's **whole library catalogue** —
//! every track `database V2` knows about, played or not — as the opaque
//! `(track_id, added_at)` pairs Story 4.2's `library_track_events` stores.
//!
//! **Why this exists.** The committed set fixture (`export_real_fixtures.rs`)
//! is derived from the play log, so every track in it is by definition a track
//! that was PLAYED. That makes it structurally incapable of showing the half
//! FR-10 actually cares about: music that was bought and never touched. A
//! library-conversion chart built on it reads ~100% and means nothing. This
//! exporter supplies the missing denominator from real data.
//!
//! **It reads exactly what the shipping agent reads.** No parallel query path:
//! it calls the same [`DateAddedIndex::all_tracks`] the watch loop's add-scan
//! calls (`capture::scan_library_adds`), through the same lazily-loaded
//! `LegacyLibrary` catalogues, with the same volume discovery. If this exporter
//! sees a track, the agent would have too — which is the point of exporting
//! through it rather than reimplementing the read.
//!
//! **It emits no paths.** Identity is [`capture::track_id_from_title_artist`]
//! — `fnv1a_hex` of normalized title+artist (Story 4.3, Decision E-2; was the
//! volume-root-relative path under D-2) — the same opaque value that crosses
//! the wire. Neither the raw path nor the raw title/artist leave this process,
//! so the output carries no local username, folder structure, or song
//! metadata, and is safe to commit, exactly like the set fixture's derived
//! stats are.
//!
//! This is NOT a CI test: skipped entirely unless `CURFEW_REAL_HOME` is set, so
//! `cargo test` in CI (which has no real Serato data, and never commits any) is
//! unaffected. Read-only throughout — every catalogue is opened through
//! `LegacyLibrary::load`, which opens read-only and refuses a path resolving
//! outside its own volume root (Story 2.7's symlink guard).
//!
//! ```sh
//! CURFEW_REAL_HOME="$HOME" \
//! CURFEW_LIBRARY_OUT=/tmp/real_library.json \
//! cargo test --test export_real_library -- --ignored --nocapture
//! ```
//!
//! Mount every drive you want counted before running: a track on an unmounted
//! volume has no reachable catalogue and is simply absent (the same honest gap
//! the agent has — see `DateAddedIndex`'s module doc). The run prints the
//! per-catalogue reach so you can tell a genuinely small library from a
//! half-mounted one.

use std::collections::BTreeMap;
use std::path::PathBuf;

use agent_lib::capture::track_id_from_title_artist;
use agent_lib::joiner::date_added::DateAddedIndex;
use serde::Serialize;

#[derive(Serialize)]
struct ExportedLibraryTrack {
    /// Opaque `fnv1a_hex` identity (Story 4.3, Decision E-2; D-2 originally)
    /// — never the path, title, or artist.
    track_id: String,
    /// Unix epoch seconds from `database V2`'s `tadd`/`uadd`; `null` when the
    /// catalogue holds no date for this track (the real ~6% gap). `web/`
    /// converts to ISO at fixture-build time, same as the set exporter.
    added_at: Option<i64>,
}

#[test]
#[ignore = "requires a real Serato library via CURFEW_REAL_HOME; run manually"]
fn export_real_library_catalogue() {
    let Ok(home) = std::env::var("CURFEW_REAL_HOME") else {
        eprintln!("CURFEW_REAL_HOME unset — skipping real-library export");
        return;
    };
    let home = PathBuf::from(home);

    // The exact index the watch loop builds, against the exact same home.
    let dates = DateAddedIndex::live(&home);
    let tracks = dates.all_tracks();

    assert!(
        !tracks.is_empty(),
        "no catalogued tracks found under {home:?} — is ~/Music/_Serato_/database V2 present, \
         and are the drives you expect actually mounted?"
    );

    // BTreeMap: dedup by identity (two catalogues can hold the same track, and
    // now also the same track under two different volume-relative paths — the
    // whole point of Decision E-2) and emit in a stable order, so re-running
    // against an unchanged library produces a byte-identical file and the
    // committed fixture diffs cleanly.
    let mut by_id: BTreeMap<String, Option<i64>> = BTreeMap::new();
    let mut no_identity = 0usize;
    let total = tracks.len();
    for (_portable_path, added_at, title, artist) in tracks {
        // Same "absent, never guessed" discipline as `capture::scan_library_adds`:
        // a track with no resolvable title/artist has no identity to record
        // under and is silently excluded, not fabricated a partial identity.
        let Some(id) = track_id_from_title_artist(title.as_deref(), artist.as_deref()) else {
            no_identity += 1;
            continue;
        };
        // First write wins, matching the cloud's own `on conflict do nothing`:
        // a duplicate must never downgrade a resolved date to `None`.
        by_id.entry(id).or_insert(added_at);
    }

    let exported: Vec<ExportedLibraryTrack> = by_id
        .into_iter()
        .map(|(track_id, added_at)| ExportedLibraryTrack { track_id, added_at })
        .collect();

    let dated = exported.iter().filter(|t| t.added_at.is_some()).count();
    let undated = exported.len() - dated;
    // Coverage is the number worth seeing before trusting anything built on
    // this: a low dated-count usually means an unmounted drive, not a DJ who
    // never tagged their library. `no_identity` is the Decision E-2-specific
    // gap: catalogue rows with no usable title/artist at all, out of `total`
    // rows read before dedup.
    println!(
        "library: {} tracks ({dated} with an add date, {undated} without — {:.0}% coverage); \
         {no_identity}/{total} catalogue rows had no resolvable title+artist and were excluded",
        exported.len(),
        100.0 * dated as f64 / exported.len().max(1) as f64
    );

    if let Some(oldest) = exported.iter().filter_map(|t| t.added_at).min() {
        let newest = exported
            .iter()
            .filter_map(|t| t.added_at)
            .max()
            .unwrap_or(oldest);
        println!("add-dates span epoch {oldest} → {newest}");
    }

    let json = serde_json::to_string_pretty(&exported).expect("serialize exported library");
    match std::env::var("CURFEW_LIBRARY_OUT") {
        Ok(out) => {
            std::fs::write(&out, &json).unwrap_or_else(|e| panic!("write {out}: {e}"));
            println!(
                "wrote {} tracks (opaque ids, epoch) -> {out}",
                exported.len()
            );
        }
        Err(_) => println!("{json}"),
    }
}
