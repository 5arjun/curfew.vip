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
use agent_lib::joiner::date_added::DateAddedIndex;
use agent_lib::store::{CapturedDerived, CapturedPlay};
use serde::Serialize;

/// The real captured sets to export, as `(serato_session_id, external_id)`,
/// chronological. `external_id` is the local `captured_sessions.id` the Story
/// 3.6 Dev Notes name — a stable, URL-safe key the fixture uses for `/set/[id]`
/// until the Supabase read path supplies the real one. It follows that store's
/// own numbering, `2 * serato_session_id - 1`, the formula every hand-recorded
/// id in the original Story 3.6 pass already satisfies (488→975, 489→977,
/// 486→971, …), so extending the list stays consistent with the real local
/// store rather than inventing a parallel key space. Session 491 is the one
/// exception: its real captured id is 17577.
///
/// Play counts below are *played* rows (Story 3.7's flag filter drops
/// loaded-but-never-played previews), as of the 2026-08-06 export.
///
/// Coverage pass (Arjun, 2026-08-06): the window runs 2025-01 → 2026-08, every
/// session with >= 3 played rows. **2026-01 is the one true gap** — no session
/// exists in the library for that month; the chart's dashed bridge is exactly
/// the affordance for it. An earlier pass used a >= 15 threshold and so lost
/// 2026-05 (a 7-play night) to the filter, which read on the chart as a second
/// month off entirely. Small sessions land under the confidence floor and are
/// hidden behind the reveal toggle rather than dropped, which is the honest
/// place for them.
///
/// Note for future passes: play history lives ONLY in the boot-drive library.
/// Serato's removable drives (`/Volumes/*/_Serato_`) carry `database V2`,
/// `location.sqlite` and crates — no `master.sqlite`, no `History/Sessions` —
/// so plugging a USB or SSD in never yields new sessions. It does still matter
/// for `library_added_at`: with a drive mounted, set 975's date-added coverage
/// goes 25/105 → 105/105.
const SETS: &[(i64, &str)] = &[
    (417, "833"), // 2025-01-26 — 13 plays
    (418, "835"), // 2025-02-02 — 29 plays
    (419, "837"), // 2025-02-06 — 11 plays
    (420, "839"), // 2025-02-09 — 73 plays
    (421, "841"), // 2025-03-01 — 3 plays
    (422, "843"), // 2025-03-25 — 4 plays
    (423, "845"), // 2025-04-03 — 25 plays
    (424, "847"), // 2025-04-11 — 126 plays
    (425, "849"), // 2025-04-12 — 15 plays
    (426, "851"), // 2025-04-12 — 126 plays
    (427, "853"), // 2025-04-13 — 70 plays
    (428, "855"), // 2025-04-18 — 24 plays
    (430, "859"), // 2025-04-20 — 3 plays
    (431, "861"), // 2025-04-20 — 50 plays
    (432, "863"), // 2025-05-03 — 21 plays
    (433, "865"), // 2025-05-04 — 27 plays
    (434, "867"), // 2025-05-15 — 42 plays
    (436, "871"), // 2025-05-17 — 6 plays
    (437, "873"), // 2025-05-18 — 29 plays
    (439, "877"), // 2025-06-08 — 20 plays
    (440, "879"), // 2025-07-12 — 34 plays
    (441, "881"), // 2025-07-17 — 12 plays
    (442, "883"), // 2025-07-17 — 59 plays
    (446, "891"), // 2025-07-26 — 6 plays
    (447, "893"), // 2025-08-01 — 16 plays
    (448, "895"), // 2025-08-07 — 118 plays
    (450, "899"), // 2025-08-11 — 12 plays
    (451, "901"), // 2025-08-12 — 72 plays
    (453, "905"), // 2025-08-14 — 3 plays
    (455, "909"), // 2025-08-16 — 22 plays
    (456, "911"), // 2025-08-25 — 62 plays
    (457, "913"), // 2025-08-29 — 25 plays
    (459, "917"), // 2025-08-31 — 34 plays
    (460, "919"), // 2025-09-20 — 34 plays
    (461, "921"), // 2025-09-20 — 97 plays
    (463, "925"), // 2025-09-28 — 79 plays
    (465, "929"), // 2025-10-24 — 73 plays
    (466, "931"), // 2025-10-25 — 11 plays
    (469, "937"), // 2025-11-05 — 63 plays
    (470, "939"), // 2025-11-06 — 6 plays
    (471, "941"), // 2025-11-08 — 87 plays
    (472, "943"), // 2025-12-06 — 83 plays
    (473, "945"), // 2025-12-07 — 24 plays
    // 2026-01: no session in the library. A real gap, not a filtered one.
    (475, "949"), // 2026-02-15 — 6 plays
    (477, "953"), // 2026-02-16 — 34 plays
    (478, "955"), // 2026-03-13 — 15 plays
    (479, "957"), // 2026-03-13 — 98 plays
    (480, "959"), // 2026-04-28 — 3 plays
    (482, "963"), // 2026-04-30 — 28 plays
    (483, "965"), // 2026-05-01 — 7 plays
    (484, "967"), // 2026-06-13 — 90 plays
    (485, "969"), // 2026-06-19 — 9 plays
    (486, "971"), // 2026-06-20 — 78 plays
    (487, "973"), // 2026-06-21 — 16 plays
    // Reference gig — 105 played rows, 5.9h. LOAD-BEARING: both
    // web/lib/sets/setDetail.test.ts and dancefloor.test.ts assert against this
    // exact set, so it must never leave the export.
    (488, "975"), // 2026-06-21 — 105 plays
    (489, "977"), // 2026-06-26 — 51 plays
    (490, "979"), // 2026-07-31 — 4 plays
    // A 1-play soundcheck: id 17577 / serato4:491 — the sparse / low-confidence
    // state the dashboard must handle.
    (491, "17577"), // 2026-08-01 — 1 play
];

/// The one session whose derived output is asserted below — kept separate from
/// the skip-on-failure path so a regression on it still fails loudly.
const REFERENCE_SESSION: i64 = 488;

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

    // Story 3.7 (§3d): the real date-added lookup — every reachable
    // `database V2` (boot-drive library + mounted volumes). Coverage is
    // honestly drive-dependent; the fixture carries whatever resolves today
    // and the UI disclosure owns the gap.
    let home = std::env::var("HOME").expect("HOME set on a dev machine");
    let dates = DateAddedIndex::live(Path::new(&home));

    let mut exported: Vec<ExportedSet> = Vec::new();
    for &(serato_session_id, external_id) in SETS {
        // File-shaped root: `open_read_only` scopes a file-shaped root against
        // its own parent, so passing the db path as both root and path is in
        // scope (see joiner::serato4::open_read_only's doc).
        // A short night can legitimately fail to build (every row a preview, or
        // nothing left after the played-flag filter). Skipping it with a notice
        // beats panicking the whole export: the list deliberately reaches down
        // to 3-play sessions so months with only a brief set still appear, and
        // one dud there should not cost the other fifty-seven. The reference
        // session keeps the hard failure — a regression on it is a real bug.
        let built = build_serato4(master, master, serato_session_id, &dates);
        let (plays, derived) = match built {
            Ok(v) => v,
            Err(e) if serato_session_id != REFERENCE_SESSION => {
                println!("skipping session {serato_session_id} ({external_id}): {e}");
                continue;
            }
            Err(e) => panic!("build_serato4 for reference session {serato_session_id}: {e}"),
        };

        let (started_at, ended_at) = agent_lib::capture::session_bounds(&plays);

        // Story 3.6's verification, on the reference gig only, restated as a
        // ratio: Story 3.7's played-flag filter drops the loaded-but-never-
        // played previews (178 → ~105 rows on set 975), so the absolute
        // ">= 170 of 178" count no longer applies — the claim that survives is
        // that nearly every *played* row recovers its Camelot key.
        if serato_session_id == REFERENCE_SESSION {
            let with_key = plays.iter().filter(|p| p.camelot_key.is_some()).count();
            let with_duration = plays.iter().filter(|p| p.played_ms.is_some()).count();
            let with_date = plays
                .iter()
                .filter(|p| p.library_added_at.is_some())
                .count();
            println!(
                "set 975 (session 488): {with_key}/{} played rows have a Camelot key;                  {with_duration} have played_ms; {with_date} have library_added_at",
                plays.len()
            );
            assert!(
                with_key as f64 >= plays.len() as f64 * 0.9,
                "expected >=90% of played rows to recover a key_value Camelot key, got {with_key}/{}",
                plays.len()
            );
            assert!(
                with_duration as f64 >= plays.len() as f64 * 0.9,
                "expected >=90% of played rows to carry a real played duration, got {with_duration}/{}",
                plays.len()
            );
            // Story 3.7 code review: unlike with_key/with_duration, coverage here
            // is legitimately drive-dependent (25/105 with the USB unplugged vs
            // the ~94% ceiling plugged in, per serato-capture-completeness.md) —
            // a fixed >=90% floor would be flaky. This sanity floor is weak on
            // purpose: it only exists to catch a live regression in the
            // date-added join collapsing to zero, not to police coverage.
            assert!(
                with_date > 0,
                "expected at least some played rows to resolve a library date-added \
                 (the ~/Music boot-drive catalogue alone should cover some tracks even \
                 with every external volume unplugged), got {with_date}/{}",
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
