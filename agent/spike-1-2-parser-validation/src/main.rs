//! THROWAWAY SPIKE — Story 1.2. Do not extend; Stories 1.3-1.7 build the
//! production parser fresh. See README.md.
//!
//! Runs the candidate parsing approaches against real Serato data on this
//! machine and prints results for manual comparison against ground truth
//! (Task 4). Findings are written by hand to
//! `_bmad-output/implementation-artifacts/1-2-parser-validation-spike-findings.md`.

mod embedded_tags;
mod legacy_session;
mod library;
mod serato4;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME not set"))
}

fn print_header(title: &str) {
    println!("\n=== {title} ===");
}

fn run_legacy_session(path: &Path, label: &str) -> Vec<legacy_session::Play> {
    print_header(&format!("Legacy .session: {label} ({})", path.display()));
    let data = match fs::read(path) {
        Ok(d) => d,
        Err(e) => {
            println!("READ ERROR: {e}");
            return Vec::new();
        }
    };
    match legacy_session::parse(&data) {
        Ok(plays) => {
            println!("play count: {}", plays.len());
            let starts: Vec<u32> = plays.iter().filter_map(|p| p.start_time).collect();
            if let (Some(&first), Some(&last)) = (starts.iter().min(), starts.iter().max()) {
                let span_hours = (last - first) as f64 / 3600.0;
                println!("elapsed span: {span_hours:.2}h");
            }
            println!("sample track identities (first 5):");
            for (i, p) in plays.iter().enumerate().take(5) {
                println!(
                    "  [{i}] artist={:?} title={:?} path={:?}",
                    p.artist, p.title, p.path
                );
            }
            if plays.len() > 5 {
                println!("  ... ({} more)", plays.len() - 5);
            }
            plays
        }
        Err(e) => {
            println!("PARSE ERROR: {e}");
            Vec::new()
        }
    }
}

fn wedding_session(local_library: &triseratops::library::Library) {
    let path = home().join("Music/_Serato_/History/Sessions/2521.session");
    let plays = run_legacy_session(&path, "wedding fixture (corrected from 4905.session)");

    // Resolve each play against the local library; collect off-library paths for
    // the id3 direct-read check (Task 3's "off-library MP3" case).
    let mut off_library: Vec<String> = Vec::new();
    let mut in_library_count = 0usize;
    for p in &plays {
        let Some(path_str) = &p.path else { continue };
        if library::resolve(local_library, path_str).is_some() {
            in_library_count += 1;
        } else {
            off_library.push(path_str.clone());
        }
    }
    println!(
        "in-library: {in_library_count} / {} plays resolved against local database V2",
        plays.len()
    );
    off_library.sort();
    off_library.dedup();
    println!("off-library distinct paths: {}", off_library.len());

    print_header("id3 embedded-tag read on off-library MP3s from the wedding session");
    let mut checked = 0;
    for p in off_library.iter() {
        if !p.to_lowercase().ends_with(".mp3") {
            continue;
        }
        if !Path::new(p).exists() {
            continue;
        }
        match embedded_tags::read_tags(Path::new(p)) {
            embedded_tags::ReadOutcome::Tags(t) => {
                println!("  {p}\n    -> title={:?} artist={:?}", t.title, t.artist);
            }
            embedded_tags::ReadOutcome::NoTagsPresent => {
                println!("  {p}\n    -> no ID3 tag present");
            }
            embedded_tags::ReadOutcome::ReadError(e) => {
                println!("  {p}\n    -> READ ERROR: {e}");
            }
        }
        checked += 1;
        if checked >= 5 {
            break;
        }
    }
    if checked == 0 {
        println!(
            "  (none of the {} off-library paths still exist on disk — the wedding\n   session's source folder was deleted after the gig; see findings doc)",
            off_library.len()
        );
    }
}

fn usb_hosted_and_wav_heavy_session(
    local_library: &triseratops::library::Library,
    usb_library: &triseratops::library::Library,
) {
    // 19544.session is both the real WAV-heaviest session AND references SSD paths
    // — it doubles as the USB-hosted-library join case (AC-1).
    let path = home().join("Music/_Serato_/History/Sessions/19544.session");
    let plays = run_legacy_session(&path, "USB-hosted + WAV-heavy (19544.session)");

    let mut wav_plays = 0;
    let mut local_hits = 0;
    let mut usb_hits = 0;
    let mut unresolved = 0;
    for p in &plays {
        let Some(path_str) = &p.path else { continue };
        if path_str.to_lowercase().ends_with(".wav") {
            wav_plays += 1;
        }
        if library::resolve(local_library, path_str).is_some() {
            local_hits += 1;
        } else if library::resolve(usb_library, path_str).is_some() {
            usb_hits += 1;
        } else {
            unresolved += 1;
        }
    }
    println!("wav plays in this session: {wav_plays}");
    println!(
        "resolved: {local_hits} against local library, {usb_hits} against USB library, {unresolved} unresolved"
    );

    // Unresolved plays here are genuinely off-crate (played straight from the USB
    // drive without being added to Serato's library index) but the files are still
    // real and on disk — a stronger off-library id3 case than the wedding session,
    // whose off-library files have since been deleted (see findings doc).
    print_header("id3 embedded-tag read on off-library MP3s from the USB-hosted session (files exist, not crate-indexed)");
    let mut checked = 0;
    for p in &plays {
        let Some(path_str) = &p.path else { continue };
        if !path_str.to_lowercase().ends_with(".mp3") {
            continue;
        }
        if library::resolve(local_library, path_str).is_some()
            || library::resolve(usb_library, path_str).is_some()
        {
            continue;
        }
        if !Path::new(path_str).exists() {
            continue;
        }
        match embedded_tags::read_tags(Path::new(path_str)) {
            embedded_tags::ReadOutcome::Tags(t) => {
                println!(
                    "  {path_str}\n    -> title={:?} artist={:?}",
                    t.title, t.artist
                );
            }
            embedded_tags::ReadOutcome::NoTagsPresent => {
                println!("  {path_str}\n    -> no ID3 tag present");
            }
            embedded_tags::ReadOutcome::ReadError(e) => {
                println!("  {path_str}\n    -> READ ERROR: {e}");
            }
        }
        checked += 1;
        if checked >= 5 {
            break;
        }
    }
    if checked == 0 {
        println!("  (no off-library, on-disk MP3 found to check)");
    }
}

fn wav_files_direct_read() {
    print_header(
        "id3 embedded-tag read: 11 real WAV files on ARJUN SSD (direct, not via a session)",
    );
    let ssd = PathBuf::from("/Volumes/ARJUN SSD");
    let wav_paths = [
        // Real on-disk filename contains a genuinely malformed byte sequence: "A"
        // + U+0303 COMBINING TILDE + U+0084 (a C1 control character) + "T" — likely
        // a botched charset conversion when this file was copied/renamed. Confirmed
        // via `os.listdir()` (not a copy/paste artifact of this source file).
        "Club/ABBA - GIMME GIMME GIMME (FA\u{303}\u{84}T TONY & MEDUN Remix).wav",
        "House/Panjabi MC - Mundian To Bach (Parah Dice Edit) [DropUnited Exclusive].wav",
        "xSamples/808mafia sirenfx .wav",
        "xSamples/gated downlifter fx.wav",
        "Dance edm/2024+/Fire Burning_Remix.wav",
        "A Indian/Bolly Tech/Muqabala Tribal House Remix ( Flipsyd ).wav",
        "A Indian/Bolly Tech/Premika House Remix ( Flipsyd ).wav",
        "A Indian/Mashups/UDTA PUNJAB -DJ SLASH MASHUP.wav",
        "A Indian/Vidhi/Shenai.wav",
        "A Indian/Vidhi/PITHI 2.wav",
        "A Indian/Bolly Tech/Indohouse/AAYI NAI - ZEAR - AFRO-TECH.wav",
    ];
    let mut tagged = 0;
    let mut untagged = 0;
    let mut errored = 0;
    for rel in wav_paths {
        let full = ssd.join(rel);
        match embedded_tags::read_tags(&full) {
            embedded_tags::ReadOutcome::Tags(t) => {
                tagged += 1;
                println!(
                    "  [tagged] {rel}\n    -> title={:?} artist={:?}",
                    t.title, t.artist
                );
            }
            embedded_tags::ReadOutcome::NoTagsPresent => {
                untagged += 1;
                println!("  [no tag] {rel}");
            }
            embedded_tags::ReadOutcome::ReadError(e) => {
                errored += 1;
                println!("  [error]  {rel} -> {e}");
            }
        }
    }
    println!(
        "\nsummary: {tagged} tagged, {untagged} untagged, {errored} errored (of {})",
        wav_paths.len()
    );
}

fn serato4_path() {
    print_header("Serato 4+ path: master.sqlite via rusqlite (plain SQL, no binary decoding)");
    let db_path = home().join("Library/Application Support/Serato/Library/master.sqlite");
    let conn = match serato4::open_read_only(db_path.to_str().unwrap()) {
        Ok(c) => c,
        Err(e) => {
            println!("OPEN ERROR: {e}");
            return;
        }
    };

    let sessions = match serato4::list_sessions(&conn, 3) {
        Ok(s) => s,
        Err(e) => {
            println!("QUERY ERROR: {e}");
            return;
        }
    };
    println!("most recent {} sessions:", sessions.len());
    for s in &sessions {
        println!(
            "  session {} name={:?} start_time(epoch)={}",
            s.id, s.name, s.start_time
        );
        match serato4::plays_for_session(&conn, s.id) {
            Ok(plays) => {
                println!("    play count: {}", plays.len());
                for p in plays.iter().take(3) {
                    println!(
                        "    [sample] artist={:?} name={:?} genre={:?} bpm={:?} key={:?} deck={:?}",
                        p.artist, p.name, p.genre, p.bpm, p.key, p.deck
                    );
                }
            }
            Err(e) => println!("    QUERY ERROR: {e}"),
        }
    }
}

/// Cross-validates the clean-room legacy parser against `master.sqlite`'s
/// independently-migrated history for specific known sessions (findings doc §4/§5),
/// in code, rather than via ad hoc queries run outside the committed spike.
fn ground_truth_cross_validation() {
    print_header(
        "Ground-truth cross-validation: legacy .session vs. master.sqlite (by session ID)",
    );

    let db_path = home().join("Library/Application Support/Serato/Library/master.sqlite");
    let conn = match serato4::open_read_only(db_path.to_str().unwrap()) {
        Ok(c) => c,
        Err(e) => {
            println!("OPEN ERROR: {e}");
            return;
        }
    };

    // (legacy .session file, master.sqlite history_session.id) pairs per findings doc §4.
    let cases = [
        ("2521.session", 72i64),
        ("11627.session", 239i64),
        ("19544.session", 400i64),
    ];

    for (file, session_id) in cases {
        let path = home().join("Music/_Serato_/History/Sessions").join(file);
        let data = match fs::read(&path) {
            Ok(d) => d,
            Err(e) => {
                println!("{file} vs. session {session_id}: READ ERROR: {e}");
                continue;
            }
        };
        let plays = match legacy_session::parse(&data) {
            Ok(p) => p,
            Err(e) => {
                println!("{file} vs. session {session_id}: PARSE ERROR: {e}");
                continue;
            }
        };
        let raw_count = plays.len();
        let distinct_row_ids: HashSet<u32> = plays.iter().filter_map(|p| p.row_id).collect();
        let missing_row_id = plays.iter().filter(|p| p.row_id.is_none()).count();

        let session = match serato4::get_session(&conn, session_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                println!("{file} vs. session {session_id}: NOT FOUND in master.sqlite");
                continue;
            }
            Err(e) => {
                println!("{file} vs. session {session_id}: QUERY ERROR: {e}");
                continue;
            }
        };
        let master_plays = match serato4::plays_for_session(&conn, session_id) {
            Ok(p) => p,
            Err(e) => {
                println!("{file} vs. session {session_id}: QUERY ERROR: {e}");
                continue;
            }
        };

        println!("\n{file} (raw={raw_count}, distinct row_id={}, missing row_id={missing_row_id}) vs. master.sqlite session {session_id} \"{:?}\" (start_time={})",
            distinct_row_ids.len(), session.name, session.start_time);
        println!(
            "  play count: raw={raw_count} deduped={} master={}  {}",
            distinct_row_ids.len(),
            master_plays.len(),
            if distinct_row_ids.len() == master_plays.len() {
                "MATCH"
            } else {
                "MISMATCH"
            }
        );

        // Track order/name comparison: dedup legacy plays by first-seen row_id,
        // sort by start_time, compare (artist, title) sequence against master.sqlite's
        // own start_time-ordered sequence.
        let mut seen = HashSet::new();
        let mut deduped: Vec<&legacy_session::Play> = plays
            .iter()
            .filter(|p| match p.row_id {
                Some(id) => seen.insert(id),
                None => true,
            })
            .collect();
        deduped.sort_by_key(|p| p.start_time.unwrap_or(0));

        // Normalize None vs. Some("") as equivalent ("no artist") before comparing —
        // the two data sources represent absence differently, which is not a real
        // track-identity mismatch.
        fn norm(s: Option<&str>) -> &str {
            s.unwrap_or("")
        }
        let mismatches = deduped
            .iter()
            .zip(master_plays.iter())
            .enumerate()
            .filter(|(_, (l, m))| {
                norm(l.artist.as_deref()) != norm(m.artist.as_deref())
                    || norm(l.title.as_deref()) != norm(m.name.as_deref())
            })
            .count();
        if deduped.len() != master_plays.len() {
            println!(
                "  track order/names: length mismatch (deduped={}, master={}), cannot compare positionally",
                deduped.len(),
                master_plays.len()
            );
        } else if mismatches == 0 {
            println!(
                "  track order/names: MATCH (all {} positions)",
                deduped.len()
            );
        } else {
            println!(
                "  track order/names: {mismatches} of {} positions differ (by artist+title text equality)",
                deduped.len()
            );
            let mut shown = 0;
            for (i, (l, m)) in deduped.iter().zip(master_plays.iter()).enumerate() {
                if l.artist.as_deref() == m.artist.as_deref()
                    && l.title.as_deref() == m.name.as_deref()
                {
                    continue;
                }
                println!(
                    "    [{i}] legacy artist={:?} title={:?}  |  master artist={:?} name={:?}",
                    l.artist, l.title, m.artist, m.name
                );
                shown += 1;
                if shown >= 5 {
                    println!("    ... ({} more)", mismatches - shown);
                    break;
                }
            }
        }
    }
}

fn main() {
    println!("Story 1.2 THROWAWAY SPIKE — parser validation against real sessions");

    let local_library = match library::load(home().join("Music")) {
        Ok(l) => {
            println!("loaded local library ({} tracks)", l.tracks().count());
            l
        }
        Err(e) => {
            eprintln!("FATAL: failed to load local library: {e}");
            return;
        }
    };

    let usb_library = match library::load("/Volumes/ARJUN SSD") {
        Ok(l) => {
            println!("loaded USB library ({} tracks)", l.tracks().count());
            Some(l)
        }
        Err(e) => {
            eprintln!("USB library unavailable, skipping USB-dependent checks: {e}");
            None
        }
    };

    wedding_session(&local_library);
    if let Some(usb_library) = &usb_library {
        usb_hosted_and_wav_heavy_session(&local_library, usb_library);
    }
    wav_files_direct_read();
    serato4_path();
    ground_truth_cross_validation();

    println!("\n=== done ===");
}
