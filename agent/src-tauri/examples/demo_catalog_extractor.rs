//! Demo-catalog extractor (demo-account-spec §4).
//!
//! Reads Arjun's real Serato library off the gig USB — `database V2` for track
//! metadata, `Subcrates/*.crate` for his own groupings — and emits the four
//! reviewable artifacts stage 1 of the demo-account pipeline owes:
//!
//! 1. `demo-catalog.json` — one row per deduped `track_id`.
//! 2. `unmapped-genres.md`/`.json` — raw genres normalizing to the default
//!    bucket, ranked by track count.
//! 3. `duplicates.md`/`.json` — near-miss identity clusters, plus tracks with
//!    no derivable identity at all.
//! 4. `add-dates.md` — `tadd`/`uadd` distribution vs. the file-mtime fallback
//!    (spec §11 risk 1).
//!
//! A cargo **example**, deliberately: it links `agent_lib` so every parse,
//! fold, and normalization is the exact production code path
//! (`LegacyLibrary::load`, `capture::track_id_from_title_artist`,
//! `genre::normalize`, `joiner::embedded_tags::fill_gaps`,
//! `stats::camelot::parse`), but examples are never part of the shipped Tauri
//! bundle. The only genuinely new parsing here is the `.crate` walk — and even
//! that is `triseratops::library::database::parse` doing the byte-level work
//! (`ptrk` already decodes as `Field::TrackPath`); this file only picks fields
//! out of the parsed stream, same as `legacy.rs` does for `database V2`.
//!
//! **Read-only on the drive.** Every touch of the USB is `fs::read`,
//! `fs::metadata`, or lofty's tag reader. Nothing under `/Volumes` is written.
//!
//! Run:
//! ```sh
//! cargo run --example demo_catalog_extractor -- \
//!     [--root "/Volumes/Samsung USB"] --out <output dir>
//! ```

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use agent_lib::capture::track_id_from_title_artist;
use agent_lib::genre;
use agent_lib::joiner::embedded_tags;
use agent_lib::joiner::legacy::LegacyLibrary;
use agent_lib::joiner::JoinedMetadata;
use agent_lib::stats::camelot;
use serde::Serialize;
use triseratops::library::database::{self, Field};

const DEFAULT_ROOT: &str = "/Volumes/Samsung USB";

fn main() {
    let mut root = PathBuf::from(DEFAULT_ROOT);
    let mut out: Option<PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => root = PathBuf::from(args.next().expect("--root needs a value")),
            "--out" => out = Some(PathBuf::from(args.next().expect("--out needs a value"))),
            other => panic!("unknown argument {other:?} (expected --root / --out)"),
        }
    }
    let out = out.expect("--out <dir> is required");
    std::fs::create_dir_all(&out).expect("output dir creates");

    // ---- 1. Load the catalogue through the production loader ----------------
    let library = LegacyLibrary::load(&root).expect("database V2 loads");
    eprintln!("catalogue: {} tracks", library.len());

    // ---- 2. Parse every subcrate (the one new parser) -----------------------
    let crates = load_crates(&root);
    let mut path_to_crates: HashMap<PathBuf, Vec<String>> = HashMap::new();
    for (name, paths) in &crates {
        for p in paths {
            path_to_crates.entry(p.clone()).or_default().push(name.clone());
        }
    }
    eprintln!(
        "crates: {} files, {} track references, {} distinct paths",
        crates.len(),
        crates.values().map(Vec::len).sum::<usize>(),
        path_to_crates.len()
    );

    // ---- 3. Per-file rows: identity, tag fallback, normalization, mtime -----
    let mut files: Vec<FileRow> = Vec::new();
    let mut tag_filled = [0usize; 3]; // bpm, key, genre
    for (path, track) in library.tracks() {
        let absolute = root.join(path);

        // Embedded-tag fallback for gaps only — the same production fallback
        // the joiner runs, pointed at the USB copy of the file.
        let joined = JoinedMetadata {
            bpm: track.bpm,
            key: track.key.clone(),
            genre: track.genre.clone(),
            ..JoinedMetadata::default()
        };
        let filled = embedded_tags::fill_gaps(joined, absolute.to_str());
        if track.bpm.is_none() && filled.bpm.is_some() {
            tag_filled[0] += 1;
        }
        if track.key.is_none() && filled.key.is_some() {
            tag_filled[1] += 1;
        }
        if track.genre.is_none() && filled.genre.is_some() {
            tag_filled[2] += 1;
        }

        let mtime = std::fs::metadata(&absolute)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        files.push(FileRow {
            track_id: track_id_from_title_artist(track.title.as_deref(), track.artist.as_deref()),
            title: track.title.clone(),
            artist: track.artist.clone(),
            bpm: filled.bpm,
            key: filled.key,
            genre: filled.genre,
            date_added: track.date_added,
            file_mtime: mtime,
            path: path.to_path_buf(),
            crates: path_to_crates.get(path).cloned().unwrap_or_default(),
        });
    }
    eprintln!(
        "tag fallback filled: bpm {} / key {} / genre {}",
        tag_filled[0], tag_filled[1], tag_filled[2]
    );

    // ---- 4. Dedup to one catalog row per track_id ---------------------------
    // Path-sorted first: `LegacyLibrary` hands entries out in HashMap order, and
    // merge_copies' first-Some-wins would otherwise flip between runs for the
    // handful of copies that disagree on a field — re-extraction must be
    // idempotent (spec §4).
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut by_id: BTreeMap<String, Vec<&FileRow>> = BTreeMap::new();
    let mut no_identity: Vec<&FileRow> = Vec::new();
    for row in &files {
        match &row.track_id {
            Some(id) => by_id.entry(id.clone()).or_default().push(row),
            None => no_identity.push(row),
        }
    }

    let mut catalog: Vec<CatalogRow> = by_id
        .iter()
        .map(|(id, copies)| merge_copies(id, copies))
        .collect();
    catalog.sort_by(|a, b| {
        (a.artist.to_lowercase(), a.title.to_lowercase())
            .cmp(&(b.artist.to_lowercase(), b.title.to_lowercase()))
    });

    // ---- 5. Reports ----------------------------------------------------------
    write_json(&out.join("demo-catalog.json"), &catalog);
    write_unmapped_genres(&out, &catalog);
    write_duplicates(&out, &catalog, &no_identity);
    write_add_dates(&out, &files);
    let proposed = write_overlay_draft(&out, &no_identity);
    print_summary(&catalog, &files, &no_identity, proposed);
}

// ---------------------------------------------------------------------------
// Crate parsing — the ~30 new lines
// ---------------------------------------------------------------------------

/// Reads every `Subcrates/*.crate` into `(crate name, stored track paths)`.
///
/// The byte format is the same 4-byte-tag chunk stream as `database V2`, so
/// `triseratops::library::database::parse` decodes it as-is: each `otrk`
/// container holds a single `ptrk` (`Field::TrackPath`) with the drive-root-
/// relative path — the same convention `pfil` uses in the catalogue, which is
/// what makes the join back to `LegacyLibrary` a plain map lookup. Serato
/// encodes crate nesting in the filename with `%%` separators; kept, rendered
/// as `" > "`.
fn load_crates(root: &Path) -> BTreeMap<String, Vec<PathBuf>> {
    let dir = root.join("_Serato_").join("Subcrates");
    let mut crates = BTreeMap::new();
    let entries = std::fs::read_dir(&dir).expect("Subcrates dir reads");
    for entry in entries {
        let path = entry.expect("dir entry reads").path();
        if path.extension().and_then(|e| e.to_str()) != Some("crate") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("crate filename is unicode")
            .replace("%%", " > ");
        let bytes = std::fs::read(&path).expect("crate file reads");
        let fields = match database::parse(&bytes) {
            Ok(fields) => fields,
            Err(e) => {
                eprintln!("warning: crate {name:?} did not parse ({e}); skipped");
                continue;
            }
        };
        let mut tracks = Vec::new();
        for field in fields {
            let Field::Track(inner) = field else { continue };
            for inner_field in inner {
                if let Field::TrackPath(p) = inner_field {
                    if !p.as_os_str().is_empty() {
                        tracks.push(p);
                    }
                }
            }
        }
        crates.insert(name, tracks);
    }
    crates
}

// ---------------------------------------------------------------------------
// Row types and merging
// ---------------------------------------------------------------------------

/// One `database V2` entry, post tag-fallback — the pre-dedup unit.
#[derive(Debug, Serialize)]
struct FileRow {
    track_id: Option<String>,
    title: Option<String>,
    artist: Option<String>,
    bpm: Option<f64>,
    key: Option<String>,
    genre: Option<String>,
    date_added: Option<i64>,
    file_mtime: Option<i64>,
    path: PathBuf,
    crates: Vec<String>,
}

/// One deduped catalog row — the `demo-catalog.json` unit (spec §4.2).
#[derive(Debug, Serialize)]
struct CatalogRow {
    track_id: String,
    title: String,
    artist: String,
    bpm: Option<f64>,
    /// Key exactly as stored (may be musical notation, may be junk).
    key_raw: Option<String>,
    /// The stored key in Camelot notation: native Camelot passes through
    /// `camelot::parse`, musical notation converts via `camelot::parse_musical`
    /// (the drive stores ~70% musical). `None` = no key, or junk.
    key_camelot: Option<String>,
    /// Which parser resolved `key_camelot`: "camelot" | "musical" |
    /// "unparsed" (key present, neither notation) | null (no key at all).
    key_notation: Option<&'static str>,
    genre_raw: Option<String>,
    genre_normalized: Option<String>,
    subgenre: Option<String>,
    taxonomy_version: u32,
    /// Serato's own add-date (epoch seconds) — earliest across copies.
    date_added: Option<i64>,
    date_added_iso: Option<String>,
    /// File mtime fallback (epoch seconds) — earliest across copies.
    file_mtime: Option<i64>,
    file_mtime_iso: Option<String>,
    crates: Vec<String>,
    source_folders: Vec<String>,
    paths: Vec<String>,
    /// Fields where two copies of the same identity disagreed, for review.
    conflicts: Vec<String>,
}

/// Collapses every file copy of one identity into a single catalog row.
///
/// Cross-copy field policy: first `Some` wins per field (copies are near-
/// always identical); any genuine disagreement is recorded in `conflicts`
/// rather than silently resolved. Dates take the earliest value — "when did
/// the library first see this song" is the semantics the conversion cohorts
/// consume.
fn merge_copies(id: &str, copies: &[&FileRow]) -> CatalogRow {
    let first = |f: fn(&FileRow) -> Option<String>| copies.iter().find_map(|r| f(r));
    let mut conflicts = Vec::new();
    for (field, values) in [
        ("bpm", copies.iter().map(|r| r.bpm.map(|b| format!("{b}"))).collect::<Vec<_>>()),
        ("key", copies.iter().map(|r| r.key.clone()).collect()),
        ("genre", copies.iter().map(|r| r.genre.clone()).collect()),
    ] {
        let mut present: Vec<&String> = values.iter().flatten().collect();
        present.dedup();
        present.sort();
        present.dedup();
        if present.len() > 1 {
            conflicts.push(format!("{field}: {present:?}"));
        }
    }

    let key_raw = first(|r| r.key.clone());
    let (key_camelot, key_notation) = match key_raw.as_deref() {
        None => (None, None),
        Some(raw) => match camelot::parse(raw).map(|k| (k, "camelot")).or_else(|| {
            camelot::parse_musical(raw).map(|k| (k, "musical"))
        }) {
            Some((k, notation)) => (
                Some(format!("{}{}", k.number, match k.letter {
                    camelot::Letter::A => 'A',
                    camelot::Letter::B => 'B',
                })),
                Some(notation),
            ),
            None => (None, Some("unparsed")),
        },
    };
    let genre_raw = first(|r| r.genre.clone());
    let normalized = genre::normalize(genre_raw.as_deref());

    let mut crates: Vec<String> = copies.iter().flat_map(|r| r.crates.clone()).collect();
    crates.sort();
    crates.dedup();
    let mut source_folders: Vec<String> = copies
        .iter()
        .filter_map(|r| r.path.components().next())
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    source_folders.sort();
    source_folders.dedup();
    let mut paths: Vec<String> = copies
        .iter()
        .map(|r| r.path.to_string_lossy().into_owned())
        .collect();
    paths.sort();

    let date_added = copies.iter().filter_map(|r| r.date_added).min();
    let file_mtime = copies.iter().filter_map(|r| r.file_mtime).min();

    CatalogRow {
        track_id: id.to_string(),
        // Identity exists ⇒ title and artist are both present on every copy.
        title: copies[0].title.clone().unwrap_or_default(),
        artist: copies[0].artist.clone().unwrap_or_default(),
        bpm: copies.iter().find_map(|r| r.bpm),
        key_camelot,
        key_notation,
        key_raw,
        genre_normalized: normalized.as_ref().map(|n| n.normalized.clone()),
        subgenre: normalized.as_ref().map(|n| n.subgenre.clone()),
        taxonomy_version: genre::TAXONOMY_VERSION,
        genre_raw,
        date_added_iso: date_added.map(iso_date),
        date_added,
        file_mtime_iso: file_mtime.map(iso_date),
        file_mtime,
        crates,
        source_folders,
        paths,
        conflicts,
    }
}

// ---------------------------------------------------------------------------
// Near-miss identity clustering (spec §4.3)
// ---------------------------------------------------------------------------

/// The *loose* fold used only to surface review candidates — never to mint an
/// id. Beyond `track_id`'s production fold (trim → collapse whitespace →
/// lowercase) it also: ASCII-folds common Latin accents (the documented
/// NFC/NFKC gap), drops `(...)`/`[...]` groups (`(Dirty)`, `[Edit]`, remixer
/// parentheticals), cuts `feat.`/`ft`/`featuring`/`with` clauses, and strips
/// punctuation. Aggressive on purpose: a false positive costs Arjun a glance
/// at the report; a false negative silently splits a play count.
fn loose_fold(value: &str) -> String {
    let mut no_groups = String::new();
    let mut depth = 0usize;
    for c in value.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => no_groups.push(c),
            _ => {}
        }
    }
    let lower = no_groups.to_lowercase();

    // Cut a featuring clause and everything after it — "a feat. b" and plain
    // "a" must land on the same key whichever field carried the guests.
    let mut cut = lower.as_str();
    for marker in [" feat ", " feat. ", " featuring ", " ft ", " ft. ", " with ", " w/ ", " x "] {
        if let Some(i) = cut.find(marker) {
            cut = &cut[..i];
        }
    }

    let folded: String = cut.chars().map(ascii_fold).collect();
    folded
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Common-Latin accent fold — the pragmatic slice of NFKD for a DJ library
/// (é→e, ü→u, ñ→n, ø→o…). Anything unmapped passes through unchanged.
fn ascii_fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ý' | 'ÿ' => 'y',
        'ñ' => 'n',
        'ç' => 'c',
        'š' => 's',
        'ž' => 'z',
        '\u{0300}'..='\u{036f}' => '\0', // bare combining marks: drop below
        _ => c,
    }
}

#[derive(Debug, Serialize)]
struct DuplicateCluster {
    /// Why these ids clustered: the shared loose key.
    loose_key: String,
    members: Vec<DuplicateMember>,
}

#[derive(Debug, Serialize)]
struct DuplicateMember {
    track_id: String,
    title: String,
    artist: String,
    copies: usize,
    crates: Vec<String>,
}

fn near_miss_clusters(catalog: &[CatalogRow]) -> Vec<DuplicateCluster> {
    let mut by_loose: BTreeMap<String, Vec<&CatalogRow>> = BTreeMap::new();
    for row in catalog {
        let key = format!("{}\u{1e}{}", loose_fold(&row.title), loose_fold(&row.artist));
        by_loose.entry(key).or_default().push(row);
    }

    // Second pass: same loose title, one artist string containing the other —
    // the remixer-in-title-vs-artist-field and collab-ordering splits.
    let mut by_title: BTreeMap<String, Vec<&CatalogRow>> = BTreeMap::new();
    for row in catalog {
        by_title.entry(loose_fold(&row.title)).or_default().push(row);
    }

    let mut clusters = Vec::new();
    let mut seen_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for (key, rows) in &by_loose {
        if rows.len() < 2 {
            continue;
        }
        clusters.push(cluster_from(key, rows));
        seen_ids.extend(rows.iter().map(|r| r.track_id.as_str()));
    }
    for (title_key, rows) in &by_title {
        if title_key.is_empty() || rows.len() < 2 {
            continue;
        }
        let mut candidates: Vec<&&CatalogRow> = rows
            .iter()
            .filter(|r| !seen_ids.contains(r.track_id.as_str()))
            .collect();
        candidates.dedup_by_key(|r| r.track_id.clone());
        if candidates.len() < 2 {
            continue;
        }
        let artists: Vec<String> = candidates.iter().map(|r| loose_fold(&r.artist)).collect();
        let related = candidates.len() == artists.len()
            && artists.iter().enumerate().any(|(i, a)| {
                artists
                    .iter()
                    .enumerate()
                    .any(|(j, b)| i != j && !a.is_empty() && !b.is_empty() && (a.contains(b.as_str()) || b.contains(a.as_str())))
            });
        if related {
            clusters.push(cluster_from(
                &format!("{title_key} (title match, related artists)"),
                &candidates.iter().map(|r| **r).collect::<Vec<_>>(),
            ));
        }
    }
    clusters
}

fn cluster_from(key: &str, rows: &[&CatalogRow]) -> DuplicateCluster {
    DuplicateCluster {
        loose_key: key.replace('\u{1e}', " — "),
        members: rows
            .iter()
            .map(|r| DuplicateMember {
                track_id: r.track_id.clone(),
                title: r.title.clone(),
                artist: r.artist.clone(),
                copies: r.paths.len(),
                crates: r.crates.clone(),
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

fn write_unmapped_genres(out: &Path, catalog: &[CatalogRow]) {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut missing = 0usize;
    for row in catalog {
        match (&row.genre_raw, row.genre_normalized.as_deref()) {
            (Some(raw), Some(bucket)) if bucket == genre::DEFAULT_BUCKET => {
                *counts.entry(raw.as_str()).or_default() += 1;
            }
            (None, _) => missing += 1,
            _ => {}
        }
    }
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));

    write_json(&out.join("unmapped-genres.json"), &ranked);
    let mut md = String::from("# Unmapped genres\n\nRaw genre strings normalizing to the default \
        bucket, ranked by deduped track count. Taxonomy patches (if any) go to `genre.rs` after \
        Arjun's ruling — never mass-filled.\n\n| raw genre | tracks |\n| --- | ---: |\n");
    for (raw, n) in &ranked {
        md.push_str(&format!("| `{raw}` | {n} |\n"));
    }
    md.push_str(&format!("\nTracks with no genre at all (catalogue + tag fallback both empty): **{missing}**\n"));
    std::fs::write(out.join("unmapped-genres.md"), md).expect("unmapped-genres.md writes");
}

fn write_duplicates(out: &Path, catalog: &[CatalogRow], no_identity: &[&FileRow]) {
    let clusters = near_miss_clusters(catalog);

    #[derive(Serialize)]
    struct NoIdentity<'a> {
        path: &'a Path,
        title: &'a Option<String>,
        artist: &'a Option<String>,
        crates: &'a [String],
    }
    let orphans: Vec<NoIdentity> = no_identity
        .iter()
        .map(|r| NoIdentity {
            path: &r.path,
            title: &r.title,
            artist: &r.artist,
            crates: &r.crates,
        })
        .collect();

    #[derive(Serialize)]
    struct Report<'a> {
        near_miss_clusters: &'a [DuplicateCluster],
        no_identity: &'a [NoIdentity<'a>],
    }
    write_json(
        &out.join("duplicates.json"),
        &Report {
            near_miss_clusters: &clusters,
            no_identity: &orphans,
        },
    );

    let mut md = String::from(
        "# Duplicate / identity report\n\nNear-miss clusters: distinct `track_id`s that are \
         probably the same song (parenthetical variants, feat./ft, remixer field drift, \
         accents). Overlay title/artist corrections merge them; they are review candidates, \
         not verdicts.\n\n",
    );
    for c in &clusters {
        md.push_str(&format!("## `{}`\n\n", c.loose_key));
        for m in &c.members {
            md.push_str(&format!(
                "- `{}` — **{}** — {} ({} cop{}, crates: {})\n",
                m.track_id,
                m.title,
                m.artist,
                m.copies,
                if m.copies == 1 { "y" } else { "ies" },
                if m.crates.is_empty() { "—".to_string() } else { m.crates.join(", ") },
            ));
        }
        md.push('\n');
    }
    md.push_str(&format!(
        "## No derivable identity ({} tracks)\n\nMissing title or artist ⇒ no `track_id`, no \
         roster entry, no track page. Overlay corrections for these are load-bearing (spec \
         §4.3).\n\n",
        orphans.len()
    ));
    for o in &orphans {
        md.push_str(&format!(
            "- `{}` (title: {:?}, artist: {:?})\n",
            o.path.display(),
            o.title,
            o.artist
        ));
    }
    std::fs::write(out.join("duplicates.md"), md).expect("duplicates.md writes");
}

fn write_add_dates(out: &Path, files: &[FileRow]) {
    let month_hist = |dates: &mut dyn Iterator<Item = i64>| {
        let mut hist: BTreeMap<String, usize> = BTreeMap::new();
        for d in dates {
            *hist.entry(iso_date(d)[..7].to_string()).or_default() += 1;
        }
        hist
    };
    let added = month_hist(&mut files.iter().filter_map(|r| r.date_added));
    let mtimes = month_hist(&mut files.iter().filter_map(|r| r.file_mtime));

    let mut day_counts: HashMap<String, usize> = HashMap::new();
    for d in files.iter().filter_map(|r| r.date_added) {
        *day_counts.entry(iso_date(d)).or_default() += 1;
    }
    let mut top_days: Vec<(String, usize)> = day_counts.into_iter().collect();
    top_days.sort_by(|a, b| b.1.cmp(&a.1));
    top_days.truncate(10);

    let total = files.len();
    let mut md = String::from("# Add-date histogram\n\nPer-file (pre-dedup) so copy volume is \
        visible. `tadd`/`uadd` is Serato's own add-date; file mtime is the spec §11 risk-1 \
        fallback.\n\n## Serato tadd/uadd by month\n\n| month | tracks |\n| --- | ---: |\n");
    for (m, n) in &added {
        md.push_str(&format!("| {m} | {n} |\n"));
    }
    md.push_str("\n## Top single days (tadd/uadd)\n\n| day | tracks |\n| --- | ---: |\n");
    for (d, n) in &top_days {
        md.push_str(&format!(
            "| {d} | {n} ({:.1}%) |\n",
            *n as f64 * 100.0 / total as f64
        ));
    }
    md.push_str("\n## File mtime by month (fallback candidate)\n\n| month | tracks |\n| --- | ---: |\n");
    for (m, n) in &mtimes {
        md.push_str(&format!("| {m} | {n} |\n"));
    }
    std::fs::write(out.join("add-dates.md"), md).expect("add-dates.md writes");
}

/// Proposed overlay corrections for identity-less rows whose title carries the
/// artist YouTube-rip style ("Kendrick Lamar - tv off …"): split on the first
/// " - ". **Proposals, not verdicts** — a title like "Straight Up - No Chaser"
/// would split wrong, which is why these land in a reviewable draft keyed by
/// source path (these rows have no `track_id` to key by — that is the problem)
/// and are never applied to the catalog. Curated entries move to the real
/// `demo-overlay.json` by hand; this file is regenerated on every run.
fn write_overlay_draft(out: &Path, no_identity: &[&FileRow]) -> usize {
    #[derive(Serialize)]
    struct Proposal<'a> {
        path: &'a Path,
        current_title: &'a str,
        proposed_artist: &'a str,
        proposed_title: &'a str,
        /// The identity the correction would mint — precomputed with the real
        /// production hash so review can spot merges with existing rows.
        proposed_track_id: String,
        crates: &'a [String],
    }
    #[derive(Serialize)]
    struct Draft<'a> {
        note: &'static str,
        proposals: Vec<Proposal<'a>>,
        unresolved_paths: Vec<&'a Path>,
    }

    let mut proposals = Vec::new();
    let mut unresolved = Vec::new();
    for row in no_identity {
        let split = row
            .title
            .as_deref()
            .filter(|_| row.artist.is_none())
            .and_then(|t| t.split_once(" - "))
            .map(|(a, t)| (a.trim(), t.trim()))
            .filter(|(a, t)| !a.is_empty() && !t.is_empty());
        match split {
            Some((artist, title)) => proposals.push(Proposal {
                path: &row.path,
                current_title: row.title.as_deref().unwrap_or_default(),
                proposed_artist: artist,
                proposed_title: title,
                proposed_track_id: track_id_from_title_artist(Some(title), Some(artist))
                    .expect("both halves non-empty"),
                crates: &row.crates,
            }),
            None => unresolved.push(row.path.as_path()),
        }
    }
    let count = proposals.len();
    write_json(
        &out.join("demo-overlay-draft.json"),
        &Draft {
            note: "PROPOSALS ONLY — artist split from 'Artist - Title' titles on \
                   identity-less rows. Review, curate into demo-overlay.json; this \
                   file is overwritten on every extractor run.",
            proposals,
            unresolved_paths: unresolved,
        },
    );
    count
}

fn print_summary(catalog: &[CatalogRow], files: &[FileRow], no_identity: &[&FileRow], proposed: usize) {
    let n = catalog.len();
    let pct = |k: usize| format!("{k} ({:.1}%)", k as f64 * 100.0 / n as f64);
    println!("── extraction summary ──────────────────────────");
    println!("catalogue entries (files):     {}", files.len());
    println!("deduped tracks (catalog rows): {n}");
    println!("no derivable identity:         {}", no_identity.len());
    println!("  … with a proposed A-T split: {proposed}");
    println!("bpm coverage:                  {}", pct(catalog.iter().filter(|r| r.bpm.is_some()).count()));
    println!("key present (raw):             {}", pct(catalog.iter().filter(|r| r.key_raw.is_some()).count()));
    println!("key resolves to Camelot:       {}", pct(catalog.iter().filter(|r| r.key_camelot.is_some()).count()));
    println!("  … native Camelot notation:   {}", pct(catalog.iter().filter(|r| r.key_notation == Some("camelot")).count()));
    println!("  … converted from musical:    {}", pct(catalog.iter().filter(|r| r.key_notation == Some("musical")).count()));
    println!("  … unparsed junk:             {}", pct(catalog.iter().filter(|r| r.key_notation == Some("unparsed")).count()));
    println!("genre present (raw):           {}", pct(catalog.iter().filter(|r| r.genre_raw.is_some()).count()));
    println!(
        "genre in a real bucket:        {}",
        pct(catalog
            .iter()
            .filter(|r| r.genre_normalized.as_deref().is_some_and(|g| g != genre::DEFAULT_BUCKET))
            .count())
    );
    println!("date-added present:            {}", pct(catalog.iter().filter(|r| r.date_added.is_some()).count()));
    println!("file mtime present:            {}", pct(catalog.iter().filter(|r| r.file_mtime.is_some()).count()));
    println!("in ≥1 crate:                   {}", pct(catalog.iter().filter(|r| !r.crates.is_empty()).count()));
    println!("copy-conflicted fields:        {}", catalog.iter().filter(|r| !r.conflicts.is_empty()).count());
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

fn write_json<T: Serialize>(path: &Path, value: &T) {
    let json = serde_json::to_string_pretty(value).expect("serializes");
    std::fs::write(path, json).unwrap_or_else(|e| panic!("{} writes: {e}", path.display()));
}

/// Epoch seconds → `YYYY-MM-DD` (UTC), via the standard civil-from-days
/// algorithm — the crate deliberately has no chrono dependency to inherit.
fn iso_date(epoch: i64) -> String {
    let days = epoch.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}
