//! One-off, env-gated exporter that re-derives real captured sets from the DJ's
//! live `master.sqlite` **through the fixed pipeline** and emits their local-shape
//! derived JSON — the faithful source for `web/`'s committed dashboard fixture
//! (Story 3.6 Task 4) and the real-data verification of Task 3 (set 975's Camelot
//! keys recovering 21/178 → ~177/178).
//!
//! This is NOT a CI test: it is skipped entirely unless `CURFEW_REAL_MASTER`
//! points at a real `master.sqlite`, so `cargo test` in CI (which has no real
//! Serato data, and never commits any) is unaffected. It is **read-only** on the
//! DJ's data — it opens `master.sqlite` read-only and does not touch the agent's
//! `local.sqlite` at all. Run it explicitly, e.g.:
//!
//! ```sh
//! CURFEW_REAL_MASTER="$HOME/Library/Application Support/Serato/Library/master.sqlite" \
//! CURFEW_FIXTURE_OUT=/tmp/real_sets.json \
//! cargo test --test export_real_fixtures -- --ignored --nocapture
//! ```
//!
//! `web/` then converts the emitted epoch timestamps to ISO-8601 and assembles
//! the frozen `SyncPayload` shape (the agent has no `chrono`; ISO conversion is a
//! payload-build-time concern per `shared/src/index.ts`).

use std::path::Path;

use agent_lib::capture::build_serato4;
use agent_lib::store::{CapturedDerived, CapturedPlay};
use serde::Serialize;

/// The real captured sets to export, as `(serato_session_id, external_id)`.
/// `external_id` is the local `captured_sessions.id` the Story 3.6 Dev Notes name
/// — a stable, URL-safe key the fixture uses for `/set/[id]` until the Supabase
/// read path supplies the real one.
const SETS: &[(i64, &str)] = &[
    // Reference gig: id 975 / session_identity serato4:488 — 178 plays, 5.9h.
    (488, "975"),
    // A 1-play soundcheck: id 17577 / serato4:491 — the sparse / low-confidence
    // state the dashboard must handle.
    (491, "17577"),
    // Dashboard-population pass (Arjun, 2026-08-03): the other substantial real
    // gigs in history, so the dashboard reads as lived-in. external_ids are the
    // real captured_sessions.id values from the agent's local store.
    (489, "977"), // Jun 26 — 75 plays
    (486, "971"), // Jun 20 — 154 plays
    (484, "967"), // Jun 13 — 184 plays
    (482, "963"), // Apr 30 — 49 plays
    (479, "957"), // Mar 13 — 164 plays
    (477, "953"), // Feb 16 — 49 plays
];

#[derive(Serialize)]
struct ExportedSet {
    external_id: String,
    serato_session_id: i64,
    /// Unix epoch seconds — `web/` converts to ISO at fixture-build time.
    started_at: Option<i64>,
    ended_at: Option<i64>,
    plays: Vec<CapturedPlay>,
    derived: CapturedDerived,
}

#[test]
#[ignore = "requires a real master.sqlite via CURFEW_REAL_MASTER; run manually"]
fn export_real_sets_and_verify_camelot_recovery() {
    let Ok(master) = std::env::var("CURFEW_REAL_MASTER") else {
        eprintln!("CURFEW_REAL_MASTER unset — skipping real-data export");
        return;
    };
    let master = Path::new(&master);

    let mut exported: Vec<ExportedSet> = Vec::new();
    for &(serato_session_id, external_id) in SETS {
        // File-shaped root: `open_read_only` scopes a file-shaped root against
        // its own parent, so passing the db path as both root and path is in
        // scope (see joiner::serato4::open_read_only's doc).
        let (plays, derived) = build_serato4(master, master, serato_session_id)
            .unwrap_or_else(|e| panic!("build_serato4 for session {serato_session_id}: {e}"));

        let (started_at, ended_at) = agent_lib::capture::session_bounds(&plays);

        // Task 3 verification, on the reference gig only: keys recover to ~177/178.
        if serato_session_id == 488 {
            let with_key = plays.iter().filter(|p| p.camelot_key.is_some()).count();
            println!(
                "set 975 (session 488): {with_key}/{} plays have a Camelot key (was ~21 pre-fix)",
                plays.len()
            );
            assert!(
                with_key >= 170,
                "expected ~177/178 keys recovered from key_value, got {with_key}/{}",
                plays.len()
            );
        }

        exported.push(ExportedSet {
            external_id: external_id.to_string(),
            serato_session_id,
            started_at,
            ended_at,
            plays,
            derived,
        });
    }

    let json = serde_json::to_string_pretty(&exported).expect("serialize exported sets");
    match std::env::var("CURFEW_FIXTURE_OUT") {
        Ok(out) => {
            std::fs::write(&out, &json).unwrap_or_else(|e| panic!("write {out}: {e}"));
            println!(
                "wrote {} sets (local shape, epoch) -> {out}",
                exported.len()
            );
        }
        Err(_) => println!("{json}"),
    }
}
