//! Demo-account **writer** — stage 3 of the demo-account pipeline
//! (`_bmad-output/planning-artifacts/demo-account-spec.md` §10).
//!
//! Reads stage 2's local artifacts (`demo-sets.json`, `demo-library.json`) and
//! posts them into a Supabase project **as June**, through the same RPCs the
//! agent uses. Third and last cargo example in this pipeline; never shipped.
//!
//! ```sh
//! # rehearse against the local stack
//! CURFEW_DEMO_PASSWORD=… cargo run --release --example demo_account_writer -- \
//!     --catalog-dir _bmad-output/demo-catalog \
//!     --url http://127.0.0.1:54321 --anon-key "$(supabase status -o json | jq -r .ANON_KEY)" \
//!     --create-user --service-key "$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)"
//!
//! # then production, same binary
//! CURFEW_DEMO_PASSWORD=… cargo run --release --example demo_account_writer -- \
//!     --catalog-dir _bmad-output/demo-catalog --url https://…supabase.co --anon-key … --confirm-production
//! ```
//!
//! ## Safety posture
//!
//! - **Credentials never come from a flag or a literal** (§2.2). The password is
//!   read from `CURFEW_DEMO_PASSWORD`, so it cannot land in a shell history
//!   file the way `--password …` would, and cannot land in git at all.
//! - **`--dry-run` is the default.** Nothing is posted until `--write` is
//!   passed, and a non-localhost `--url` additionally demands
//!   `--confirm-production`. Two independent gates, because the failure mode is
//!   writing 2,869 plays into the wrong project.
//! - **Every write is RLS-scoped to `auth.uid()`.** `sync_set`,
//!   `sync_library_roster`, `sync_library_add_events` and `set_agent_status`
//!   are all `SECURITY DEFINER` functions that derive `dj_id` from the caller's
//!   own token, so this binary structurally cannot write another user's row.
//! - **The service-role key is used for exactly one thing** and only when
//!   `--create-user` is passed: creating the `auth.users` row on a local stack.
//!   It is never used for data.
//!
//! ## Two spec assumptions that no longer hold (both in our favour)
//!
//! §10.1 prescribes `sets → read back play ids → segments`, and §10.2 calls
//! `agent_status` "the one elevated write". Neither is true against the current
//! schema, and this writer does neither:
//!
//! 1. **Suggested segments are materialized server-side.** `sync_set` reads
//!    `derived.suggested_segments` and resolves its 1-based positions to
//!    `plays.id` *inside its own transaction*, after its own insert (D-19/D-20,
//!    `20260811120000_add_segments_write_path.sql`). Stage 2 already emits that
//!    key in exactly the shape the RPC validates (`"type": "dancefloor"`), so
//!    the segments arrive with the set and there is no second pass to order
//!    wrongly. What this writer *does* do afterwards is **confirm** them, which
//!    is a different operation (`segments.confirmed`, not `source`) and cannot
//!    vanish under a re-sync — `sync_set` deliberately captures and rebinds
//!    DJ-authored rows across the delete/reinsert.
//! 2. **`set_agent_status(text, text)` is granted to `authenticated`.** §10.2's
//!    reading — that `agent_status` has no write path for a normal user — is
//!    true of the *table* and false of the RPC. The whole pipeline therefore
//!    runs with **no elevated credential at all** against production.

use std::collections::BTreeMap;
use std::path::PathBuf;

use agent_lib::sync::set_id;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

const DJ_NAME: &str = "June";
const DJ_PHONE: &str = "+15555550142";
const AGENT_VERSION: &str = "0.1.0";
const SYNC_STATE: &str = "Idle";

/// Mirrors `sync.rs`'s own `ADD_EVENT_BATCH_SIZE` / `ROSTER_BATCH_SIZE`. Same
/// number for the same reason: one oversized JSON body is the difference
/// between a sync that works on a phone tether and one that times out.
const BATCH_SIZE: usize = 200;

/// How many sets keep their dancefloor segment *unconfirmed*.
///
/// The suggestion state is a real, designed product state
/// (`SegmentSelector.tsx` renders it with its own chip dot), so showing a
/// couple is more honest than a wall of green checks.
///
/// **These are MID-archive sets, never recent ones**, which is the opposite of
/// what this constant did when it was named `UNCONFIRMED_RECENT`: it took the
/// last `n` entries of a chronologically-ASCENDING array, so the newest set —
/// the dashboard hero, the first thing anyone sees — was always among them, and
/// the hero carried "suggested, not yet confirmed" in every screenshot. The old
/// doc comment even claimed the opposite ("Kept off the most recent set on
/// purpose: that one is the dashboard hero"), so the intent was never in doubt,
/// only the indexing. `unconfirmed_indices` now derives the picks from the
/// middle of the archive and asserts the hero is not among them.
const UNCONFIRMED_COUNT: usize = 2;

/// Which set indices keep an unconfirmed suggestion, given a chronologically
/// ascending `sets` array.
///
/// Picked as fractions of the archive rather than hardcoded indices so the
/// choice survives a regenerated catalog with a different set count, and stays
/// deterministic across runs (the writer is idempotent — a second run must not
/// move which floors read as unconfirmed).
fn unconfirmed_indices(len: usize) -> Vec<usize> {
    if len < 4 {
        return Vec::new();
    }
    // 40% and 60% in: unambiguously mid-archive, and far from both the hero at
    // the end and the "first ever set" at the start, which are the two the demo
    // narrative points at.
    let picks: Vec<usize> = (0..UNCONFIRMED_COUNT)
        .map(|k| len * (4 + 2 * k) / 10)
        .collect();

    // The guard the old constant's prose asked for but nothing enforced.
    assert!(
        picks.iter().all(|&i| i < len - 1 && i > 0),
        "unconfirmed picks {picks:?} must stay off the newest set (the dashboard \
         hero) and the oldest one; len = {len}"
    );
    picks
}

// =============================================================================
// Artifacts
// =============================================================================

#[derive(Debug, Deserialize)]
struct DemoSets {
    sets: Vec<DemoSet>,
}

#[derive(Debug, Deserialize)]
struct DemoSet {
    session_identity: String,
    kind: String,
    tier: u8,
    started_at: i64,
    ended_at: i64,
    started_at_et: String,
    plays: Vec<Value>,
    derived: Value,
}

#[derive(Debug, Deserialize)]
struct DemoLibrary {
    roster: Vec<Value>,
    add_events: Vec<Value>,
}

// =============================================================================
// main
// =============================================================================

struct Args {
    catalog_dir: PathBuf,
    url: String,
    anon_key: String,
    service_key: Option<String>,
    email: String,
    write: bool,
    confirm_production: bool,
    create_user: bool,
}

fn main() {
    let args = parse_args();
    let local = args.url.contains("127.0.0.1") || args.url.contains("localhost");

    let password = std::env::var("CURFEW_DEMO_PASSWORD").unwrap_or_else(|_| {
        panic!(
            "CURFEW_DEMO_PASSWORD is not set. The credential is read from the environment, never \
             from a flag (spec §2.2) — it must not reach a shell history file or git."
        )
    });

    eprintln!(
        "target : {}{}",
        args.url,
        if local { "  (local)" } else { "  ** REMOTE **" }
    );
    eprintln!("account: {}", args.email);
    eprintln!(
        "mode   : {}",
        if args.write {
            "WRITE"
        } else {
            "dry-run (pass --write to post)"
        }
    );

    if args.write && !local && !args.confirm_production {
        panic!(
            "refusing to write to a non-local project without --confirm-production.\n\
             This posts ~2,900 plays and ~4,200 roster rows as {}. Re-run with \
             --confirm-production if that is genuinely what you want.",
            args.email
        );
    }

    let sets: DemoSets = read_json(&args.catalog_dir.join("demo-sets.json"));
    let library: DemoLibrary = read_json(&args.catalog_dir.join("demo-library.json"));
    eprintln!(
        "payload: {} sets / {} plays / {} roster / {} add events",
        sets.sets.len(),
        sets.sets.iter().map(|s| s.plays.len()).sum::<usize>(),
        library.roster.len(),
        library.add_events.len()
    );

    let http = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("http client builds");

    if !args.write {
        dry_run_plan(&sets, &library);
        return;
    }

    // ---- 0. the auth.users row -------------------------------------------
    if args.create_user {
        let key = args.service_key.as_ref().expect(
            "--create-user needs --service-key. This is the ONLY use of an elevated credential in \
             this binary, and it is for the local rehearsal — in production the account is created \
             by hand (spec §13).",
        );
        create_user(&http, &args, key, &password, local);
    }

    // ---- 1. sign in -------------------------------------------------------
    let (token, dj_id) = sign_in(&http, &args, &password);
    eprintln!("signed in: dj_id {dj_id}");

    // ---- 2. account plumbing (§10.3) --------------------------------------
    // Without these `/phone-required` intercepts every route and the recording
    // is over before it starts.
    let res = http
        .patch(format!("{}/rest/v1/djs?id=eq.{dj_id}", args.url))
        .header("apikey", &args.anon_key)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&json!({ "dj_name": DJ_NAME, "phone": DJ_PHONE }))
        .send()
        .expect("djs update sends");
    expect_ok(res, "djs dj_name/phone");
    eprintln!("djs: dj_name={DJ_NAME} phone set");

    // ---- 3. sets, in chronological order ----------------------------------
    //
    // Chronological because `sync_set` is idempotent on
    // `(dj_id, session_identity)` and a re-run must land the same way twice;
    // it is also the order the calibration pool that produced these segments
    // was built in, so a reader comparing the two sees one story.
    let mut set_ids: Vec<(String, Uuid, usize)> = Vec::new();
    for (i, s) in sets.sets.iter().enumerate() {
        let body = json!({
            "session_identity": s.session_identity,
            "started_at": s.started_at,
            "ended_at": s.ended_at,
            "derived": s.derived,
            "plays": s.plays,
        });
        let res = http
            .post(format!("{}/rest/v1/rpc/sync_set", args.url))
            .header("apikey", &args.anon_key)
            .header("Authorization", format!("Bearer {token}"))
            .json(&body)
            .send()
            .expect("sync_set sends");
        let returned: Uuid = expect_json(res, &format!("sync_set {}", s.session_identity));

        // The agent asserts this on every sync (`SyncError::SetIdMismatch`) and
        // so does this: both sides derive `set_id` from the same
        // `uuid_v5(dj_id, session_identity)` formula (AD-4), so a mismatch
        // means one of them is not who it thinks it is.
        let expected = set_id(dj_id, &s.session_identity);
        assert_eq!(
            returned, expected,
            "server-computed set_id for {} did not match the local derivation",
            s.session_identity
        );
        set_ids.push((s.session_identity.clone(), returned, i));
        if (i + 1) % 10 == 0 || i + 1 == sets.sets.len() {
            eprintln!("sets: {}/{}", i + 1, sets.sets.len());
        }
    }

    // ---- 4. settle the suggested segments ---------------------------------
    //
    // NOT a re-write of the segment rows: `sync_set` already created them from
    // `derived.suggested_segments` (see the module docs). This flips
    // `confirmed` and touches nothing else, exactly like `segmentWrites.ts`'s
    // own confirm path — `source` stays `'suggested'` so the provenance of the
    // boundary is preserved.
    //
    // Both directions are written, not just the confirm. This step CONVERGES on
    // the state `unconfirmed_indices` declares rather than ratcheting toward
    // "everything confirmed": a re-run over an account written by the previous
    // version of this file would otherwise confirm the old hero (correct) and
    // then quietly leave the new mid-archive picks confirmed too (wrong), since
    // a skip is not a write. Idempotence has to mean "ends in the declared
    // state", not "never un-does anything".
    let unconfirmed = unconfirmed_indices(sets.sets.len());
    let mut confirmed = 0usize;
    let mut unset = 0usize;
    for (identity, sid, i) in &set_ids {
        let want = !unconfirmed.contains(i);
        // Filter on the CURRENT value being the opposite of the wanted one, so
        // a settled row is not rewritten and `rows.len()` counts real changes.
        let res = http
            .patch(format!(
                "{}/rest/v1/segments?set_id=eq.{sid}&source=eq.suggested&confirmed=is.{}",
                args.url, !want
            ))
            .header("apikey", &args.anon_key)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(&json!({ "confirmed": want }))
            .send()
            .expect("segment settle sends");
        let rows: Vec<Value> = expect_json(res, &format!("settle segments {identity}"));
        if want {
            confirmed += rows.len();
        } else {
            unset += rows.len();
        }
    }
    eprintln!(
        "segments: {confirmed} newly confirmed, {unset} returned to unconfirmed; \
         {} mid-archive sets left showing an unconfirmed suggestion (indices \
         {unconfirmed:?} of {}; the newest set is never among them — it is the \
         dashboard hero)",
        unconfirmed.len(),
        sets.sets.len()
    );

    // ---- 5. roster, then add events ---------------------------------------
    //
    // Roster first: an add event for a track the roster has never heard of is
    // a dangling identity on every library join.
    for (label, rpc, rows, key) in [
        ("roster", "sync_library_roster", &library.roster, "entries"),
        (
            "add events",
            "sync_library_add_events",
            &library.add_events,
            "events",
        ),
    ] {
        let mut done = 0usize;
        for batch in rows.chunks(BATCH_SIZE) {
            let res = http
                .post(format!("{}/rest/v1/rpc/{rpc}", args.url))
                .header("apikey", &args.anon_key)
                .header("Authorization", format!("Bearer {token}"))
                .json(&json!({ key: batch }))
                .send()
                .expect("library rpc sends");
            expect_ok(res, rpc);
            done += batch.len();
        }
        eprintln!("{label}: {done} rows");
    }

    // ---- 6. agent status (§10.2 — no elevated credential needed) -----------
    let res = http
        .post(format!("{}/rest/v1/rpc/set_agent_status", args.url))
        .header("apikey", &args.anon_key)
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "sync_state": SYNC_STATE, "agent_version": AGENT_VERSION }))
        .send()
        .expect("set_agent_status sends");
    expect_ok(res, "set_agent_status");
    eprintln!("agent_status: {SYNC_STATE} (agent {AGENT_VERSION})");

    eprintln!("\ndone. Now walk the six surfaces in spec §12.");
}

// =============================================================================
// Steps
// =============================================================================

fn create_user(
    http: &reqwest::blocking::Client,
    args: &Args,
    service_key: &str,
    password: &str,
    local: bool,
) {
    assert!(
        local,
        "--create-user is for the local rehearsal only. In production the account is created by \
         hand so that a leaked-password rejection is seen and escalated (spec §2.2/§13), not \
         silently worked around by a script."
    );
    let res = http
        .post(format!("{}/auth/v1/admin/users", args.url))
        .header("apikey", service_key)
        .header("Authorization", format!("Bearer {service_key}"))
        .json(&json!({
            "email": args.email,
            "password": password,
            "email_confirm": true,
        }))
        .send()
        .expect("admin create user sends");
    let status = res.status();
    let body = res.text().unwrap_or_default();
    if status.is_success() {
        eprintln!("created auth user {}", args.email);
    } else if body.contains("already been registered") || body.contains("already exists") {
        eprintln!("auth user {} already exists — reusing", args.email);
    } else {
        panic!("admin create user failed ({status}): {body}");
    }
}

fn sign_in(http: &reqwest::blocking::Client, args: &Args, password: &str) -> (String, Uuid) {
    let res = http
        .post(format!("{}/auth/v1/token?grant_type=password", args.url))
        .header("apikey", &args.anon_key)
        .json(&json!({ "email": args.email, "password": password }))
        .send()
        .expect("sign-in sends");
    let status = res.status();
    let body = res.text().unwrap_or_default();
    if !status.is_success() {
        // The one failure worth naming precisely, because the spec says to
        // escalate rather than substitute a different password (§2.2).
        if body.contains("weak_password") || body.contains("pwned") {
            panic!(
                "sign-in rejected the password as leaked/weak ({status}). This is spec §2.2's \
                 named risk: hosted leaked-password protection is enabled on this project. \
                 ESCALATE to Arjun — do not silently substitute another password.\n{body}"
            );
        }
        panic!("sign-in failed ({status}): {body}");
    }
    let v: Value = serde_json::from_str(&body).expect("sign-in returns JSON");
    let token = v["access_token"]
        .as_str()
        .expect("access_token present")
        .to_string();
    let dj_id: Uuid = v["user"]["id"]
        .as_str()
        .expect("user.id present")
        .parse()
        .expect("user.id is a uuid");
    (token, dj_id)
}

/// What a `--write` run would do, printed rather than done.
fn dry_run_plan(sets: &DemoSets, library: &DemoLibrary) {
    let segments: usize = sets
        .sets
        .iter()
        .map(|s| {
            s.derived["suggested_segments"]
                .as_array()
                .map(Vec::len)
                .unwrap_or(0)
        })
        .sum();
    let unconfirmed = unconfirmed_indices(sets.sets.len());
    let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
    for s in &sets.sets {
        *by_kind.entry(s.kind.as_str()).or_default() += 1;
    }

    println!("\nDRY RUN — nothing was posted. A --write run would:\n");
    println!("  1. PATCH  djs                     dj_name={DJ_NAME}, phone set");
    println!(
        "  2. POST   rpc/sync_set           x{} ({})",
        sets.sets.len(),
        by_kind
            .iter()
            .map(|(k, n)| format!("{n} {k}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!(
        "            -> {} plays, and {segments} dancefloor segments materialized server-side",
        sets.sets.iter().map(|s| s.plays.len()).sum::<usize>()
    );
    println!(
        "  3. PATCH  segments               confirm on {} sets; {} MID-archive sets \
         (indices {unconfirmed:?}) keep an unconfirmed suggestion — never the \
         newest, which is the dashboard hero",
        sets.sets.len() - unconfirmed.len(),
        unconfirmed.len()
    );
    println!(
        "  4. POST   rpc/sync_library_roster      x{} batches ({} entries)",
        library.roster.len().div_ceil(BATCH_SIZE),
        library.roster.len()
    );
    println!(
        "  5. POST   rpc/sync_library_add_events  x{} batches ({} events)",
        library.add_events.len().div_ceil(BATCH_SIZE),
        library.add_events.len()
    );
    println!("  6. POST   rpc/set_agent_status   {SYNC_STATE} / {AGENT_VERSION}");
    println!("\n  no elevated credential is used for any of the above (see the module docs).\n");

    println!("  Tier 1 sets, for the browser pass:");
    for s in sets.sets.iter().filter(|s| s.tier == 1) {
        println!(
            "    {:<14} {}  {:>3} plays  {}",
            s.session_identity,
            &s.started_at_et[..10],
            s.plays.len(),
            s.kind
        );
    }
    let last = sets.sets.last().expect("at least one set");
    println!(
        "\n  dashboard hero will be {} ({}), {} plays",
        last.session_identity,
        &last.started_at_et[..10],
        last.plays.len()
    );
    let _ = last.ended_at;
}

// =============================================================================
// HTTP helpers
// =============================================================================

fn expect_ok(res: reqwest::blocking::Response, what: &str) {
    let status = res.status();
    if !status.is_success() {
        panic!(
            "{what} failed ({status}): {}",
            res.text().unwrap_or_default()
        );
    }
}

fn expect_json<T: serde::de::DeserializeOwned>(res: reqwest::blocking::Response, what: &str) -> T {
    let status = res.status();
    let body = res.text().unwrap_or_default();
    if !status.is_success() {
        panic!("{what} failed ({status}): {body}");
    }
    serde_json::from_str(&body)
        .unwrap_or_else(|e| panic!("{what} returned unreadable JSON: {e}\n{body}"))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> T {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    serde_json::from_slice(&bytes).unwrap_or_else(|e| panic!("{} parses: {e}", path.display()))
}

fn parse_args() -> Args {
    let mut catalog_dir = PathBuf::from("_bmad-output/demo-catalog");
    let mut url = "http://127.0.0.1:54321".to_string();
    let mut anon_key = String::new();
    let mut service_key = None;
    let mut email = "admin@curfew.vip".to_string();
    let mut write = false;
    let mut confirm_production = false;
    let mut create_user = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--catalog-dir" => catalog_dir = PathBuf::from(args.next().expect("needs a value")),
            "--url" => url = args.next().expect("needs a value"),
            "--anon-key" => anon_key = args.next().expect("needs a value"),
            "--service-key" => service_key = Some(args.next().expect("needs a value")),
            "--email" => email = args.next().expect("needs a value"),
            "--write" => write = true,
            "--confirm-production" => confirm_production = true,
            "--create-user" => create_user = true,
            other => panic!("unknown argument {other:?}"),
        }
    }
    assert!(!anon_key.is_empty(), "--anon-key is required");
    Args {
        catalog_dir,
        url: url.trim_end_matches('/').to_string(),
        anon_key,
        service_key,
        email,
        write,
        confirm_production,
        create_user,
    }
}
