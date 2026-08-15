//! Demo-account **overlay scrubber** — a pattern-driven producer of the §4.2
//! category-4 title/artist corrections (filename junk), for the demo-account
//! pipeline (`_bmad-output/planning-artifacts/demo-account-spec.md`).
//!
//! ```sh
//! # look first — prints the full before/after and changes nothing
//! cargo run --release --example demo_overlay_scrub -- \
//!     --catalog-dir _bmad-output/demo-catalog
//!
//! # then merge the corrections into demo-overlay.json
//! cargo run --release --example demo_overlay_scrub -- \
//!     --catalog-dir _bmad-output/demo-catalog --write
//! ```
//!
//! ## Why this is a tool and not 300 hand-written overlay entries
//!
//! `/library-utilization`'s aging shelf ranks over the **whole roster**, not
//! over the tracks that were played, so ~322 never-played rows carrying
//! download-site filename junk (`- DJMaza.MS`, `(SongsMp3.Cool)`,
//! `[ www.DjsDrive.In ]`, `01.`, SHOUTING TITLES) can surface on a §12
//! screenshot surface. Stage 2's hand-curated overlay only ever covered the
//! Tier 1 tracklists, because those were the rows anyone had read. Curating the
//! rest by hand would be ~300 judgement calls, none of them interesting, all of
//! them unreviewable — so the junk is described as PATTERNS here, and the
//! patterns are the reviewable artifact.
//!
//! ## The rules, and why each one is drawn where it is
//!
//! Every rule below is deliberately biased toward doing nothing. A title left
//! slightly ugly costs one screenshot; a title mangled by an over-eager rule
//! (`24 (Remix)` → `(Remix)`) is worse than the junk it replaced, and nobody
//! would catch it in a 4,000-row file.
//!
//! 0. **Control characters** — a tag carrying a literal tab, newline or `\x1a`
//!    (`act ii: date @ 8\n- MarkCutz Remix`) renders as a broken line in every
//!    surface. Any whitespace run collapses to one space and controls are
//!    dropped. Free of identity risk by construction: the identity fold already
//!    does exactly this collapse (`capture::normalize_identity_text`), so the
//!    `track_id` cannot move. Applied only when a control character is actually
//!    present — a merely untrimmed tag is left alone rather than generating a
//!    correction that changes nothing anyone can see (HTML collapses it too).
//! 1. **Source-site stamps** — a parenthesised/bracketed group containing a
//!    domain, a bare `www.…`/`https://…` run, a trailing ` - Site.Com`, and
//!    `.mp3`. Removed wherever they appear.
//! 2. **An artist field that is ENTIRELY a site stamp** is reduced to its
//!    handle (`www.instagram.com/djtejasofficial` → `djtejasofficial`,
//!    `www.JP-Ent.com` → `JP-Ent`) rather than emptied. That credit is the only
//!    attribution the row has; reduction keeps it, invention is not on the
//!    table, and emptying it would delete the track outright (see rule 6).
//! 3. **Leading track numbers** — only a TWO-digit number, and only when
//!    followed by punctuation-then-a-letter (`19.Jugnu`, `01 - Kudiya`) or
//!    zero-padded-then-a-space (`08 Maiyya`). A bare `13 Fitoor` is stripped
//!    only when the row is already junky by another rule. This is what keeps
//!    `5 On It`, `2 Reasons`, `24 (Remix)`, `130 Coco` and `158 - EXTENDED MIX`
//!    (a BPM tag, not a track number) intact.
//! 4. **Underscore separators** become spaces.
//! 5. **SHOUTING titles** are re-cased — three words minimum, or two when the
//!    row is already junky by another rule. Artists are re-cased **only** when
//!    a leading track number was stripped from them, i.e. when the field is
//!    provably a filename fragment and not a credit: `MEDUZA`, `N.W.A.`,
//!    `AFTERJOY` and `DJ HARSH BHUTANI` are how those acts spell themselves.
//!    Re-casing alone never changes `track_id` — the identity fold lowercases
//!    (`capture::normalize_identity_text`) — so this rule is free of the
//!    identity risk the others carry.
//! 6. **A scrub never empties a field.** Title and artist together *are* the
//!    track's identity (§4.3): a rule that eats one deletes the track from the
//!    library, silently. If cleaning leaves nothing, the original stands.
//!
//! ## Composition with the hand-curated overlay
//!
//! Hand curation always wins. A hand entry's `title`/`artist` is taken as the
//! INPUT the patterns then read, so the two compose rather than fight, and no
//! scrub entry is ever written for a field a human already set. Entries this
//! tool authored are tagged with [`SCRUB_SOURCE`] and are the only ones it
//! rewrites on a re-run — every other key in `demo-overlay.json`, including
//! `no_identity` and any field it does not understand, round-trips verbatim.
//!
//! Because the patterns always read `demo-catalog.json` (immutable) plus the
//! hand entries, and never their own prior output, re-running is idempotent:
//! same inputs ⇒ byte-identical `demo-overlay.json`.
//!
//! ## What this tool does NOT do
//!
//! It does not touch `bpm`, `key_camelot` or `genre_raw` — those are §4.2
//! categories 1–3 and are judgement, not pattern. It does not resolve
//! near-miss duplicate clusters. And it does not check that its corrections
//! keep every identity distinct: `demo_set_generator` already asserts that two
//! corrections cannot collapse onto one `track_id`, and duplicating the guard
//! here would just give it a second place to drift from.

use std::collections::BTreeMap;
use std::path::PathBuf;

use agent_lib::capture::track_id_from_title_artist;
use serde_json::{json, Map, Value};

/// Provenance stamp on every entry this tool authors. A re-run regenerates
/// exactly the entries carrying it and leaves every other entry untouched, so
/// hand curation can never be clobbered by a scrub pass.
const SCRUB_SOURCE: &str = "pattern-scrub v1 (spec §4.2 cat 4): download-site \
    stamps, leading track numbers, underscore separators, shouting titles";

/// Top-level domains seen in the source-site stamps on this drive, plus the
/// obvious neighbours. Deliberately a closed list: matching `\w+\.\w+` would
/// eat `N.W.A.`, `Vol.2` and every `Feat.` in the catalog.
const TLDS: &[&str] = &[
    "com", "net", "org", "life", "cool", "info", "fm", "ms", "co", "in", "me", "pk", "us", "biz",
    "xyz", "io",
];

/// Tokens that stay upper-case through a re-casing. Short, and only things that
/// are acronyms in every context they appear in here.
const KEEP_UPPER: &[&str] = &[
    "DJ", "VDJ", "MC", "UK", "US", "USA", "LP", "EP", "TV", "ID", "NRG", "BPM", "II", "III", "IV",
    "VIP", "RMX", "AM", "PM", "OK", "DNB", "EDM", "R&B", "JP", "TMK", "DDD", "X",
];

// =============================================================================
// Artifacts
// =============================================================================

#[derive(Debug, serde::Deserialize)]
struct CatalogRow {
    track_id: String,
    title: Option<String>,
    artist: Option<String>,
}

struct Args {
    catalog_dir: PathBuf,
    write: bool,
}

fn parse_args() -> Args {
    let mut catalog_dir: Option<PathBuf> = None;
    let mut write = false;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--catalog-dir" => {
                catalog_dir = Some(PathBuf::from(
                    it.next().expect("--catalog-dir takes a path"),
                ))
            }
            "--write" => write = true,
            other => panic!("unknown argument {other}"),
        }
    }
    Args {
        catalog_dir: catalog_dir.expect("--catalog-dir is required"),
        write,
    }
}

fn main() {
    let args = parse_args();
    let catalog_path = args.catalog_dir.join("demo-catalog.json");
    let overlay_path = args.catalog_dir.join("demo-overlay.json");

    let catalog: Vec<CatalogRow> = serde_json::from_str(
        &std::fs::read_to_string(&catalog_path)
            .unwrap_or_else(|e| panic!("reading {}: {e}", catalog_path.display())),
    )
    .expect("demo-catalog.json parses");

    let mut overlay: Map<String, Value> = serde_json::from_str(
        &std::fs::read_to_string(&overlay_path)
            .unwrap_or_else(|e| panic!("reading {}: {e}", overlay_path.display())),
    )
    .expect("demo-overlay.json parses as an object");

    let existing: Map<String, Value> = overlay
        .get("tracks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    // Entries a human wrote — everything not carrying our own stamp.
    let hand: BTreeMap<String, Map<String, Value>> = existing
        .iter()
        .filter(|(_, v)| v.get("source").and_then(Value::as_str) != Some(SCRUB_SOURCE))
        .filter_map(|(k, v)| v.as_object().map(|o| (k.clone(), o.clone())))
        .collect();

    let mut scrubbed: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
    let mut changes: Vec<Change> = Vec::new();
    let mut identity_would_move = 0usize;

    for row in &catalog {
        let hand_entry = hand.get(&row.track_id);
        let hand_str = |field: &str| -> Option<String> {
            hand_entry
                .and_then(|h| h.get(field))
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        // The patterns read the ALREADY-corrected value, so a hand fix and a
        // pattern fix compose instead of fighting over the same field.
        let base_title = hand_str("title").or_else(|| row.title.clone());
        let base_artist = hand_str("artist").or_else(|| row.artist.clone());
        if base_title.is_none() && base_artist.is_none() {
            continue;
        }
        let before = (
            base_title.clone().unwrap_or_default(),
            base_artist.clone().unwrap_or_default(),
        );
        let (after_title, after_artist, rules) = scrub(&before.0, &before.1);
        if rules.is_empty() {
            continue;
        }

        let mut entry = Map::new();
        if hand_str("title").is_none() && after_title != before.0 {
            entry.insert("title".into(), Value::String(after_title.clone()));
        }
        if hand_str("artist").is_none() && after_artist != before.1 {
            entry.insert("artist".into(), Value::String(after_artist.clone()));
        }
        if entry.is_empty() {
            continue;
        }
        entry.insert("source".into(), Value::String(SCRUB_SOURCE.into()));

        let before_id = track_id_from_title_artist(Some(&before.0), Some(&before.1));
        let after_id = track_id_from_title_artist(Some(&after_title), Some(&after_artist));
        if before_id != after_id {
            identity_would_move += 1;
        }

        changes.push(Change {
            track_id: row.track_id.clone(),
            before,
            after: (after_title, after_artist),
            rules,
            identity_moves: before_id != after_id,
        });
        scrubbed.insert(row.track_id.clone(), entry);
    }

    // ---- report -----------------------------------------------------------
    for c in &changes {
        println!(
            "{}{}\n  title  {:?}\n      -> {:?}\n  artist {:?}\n      -> {:?}\n  rules  {}",
            c.track_id,
            if c.identity_moves {
                "  (identity re-minted)"
            } else {
                ""
            },
            c.before.0,
            c.after.0,
            c.before.1,
            c.after.1,
            c.rules.join(", ")
        );
    }
    eprintln!(
        "\n{} catalog rows / {} hand-curated overlay entries kept verbatim\n\
         {} pattern corrections, {identity_would_move} of which re-mint `track_id` (§4.3)",
        catalog.len(),
        hand.len(),
        scrubbed.len()
    );

    if !args.write {
        eprintln!("\nDRY RUN — demo-overlay.json untouched. Pass --write to merge.");
        return;
    }

    let mut tracks = Map::new();
    for (k, v) in hand {
        tracks.insert(k, Value::Object(v));
    }
    for (k, v) in scrubbed {
        tracks.insert(k, Value::Object(v));
    }
    // serde_json's Map preserves insertion order unless the `preserve_order`
    // feature is off, in which case it is a BTreeMap and already sorted. Sort
    // explicitly so the written file is byte-identical either way.
    let sorted: BTreeMap<String, Value> = tracks.into_iter().collect();
    overlay.insert("tracks".into(), json!(sorted));

    let mut out =
        serde_json::to_string_pretty(&Value::Object(overlay)).expect("overlay serializes");
    out.push('\n');
    std::fs::write(&overlay_path, out)
        .unwrap_or_else(|e| panic!("writing {}: {e}", overlay_path.display()));
    eprintln!("\nwrote {}", overlay_path.display());
}

struct Change {
    track_id: String,
    before: (String, String),
    after: (String, String),
    rules: Vec<String>,
    identity_moves: bool,
}

// =============================================================================
// The patterns
// =============================================================================

/// Is `s`, in full, a domain-ish token (`SongsMp3.Cool`, `www.JP-Ent.com`,
/// `instagram.com/djtejasofficial`)? Used both to spot a stamp inside a
/// bracketed group and to strip a bare one.
fn domain_end(s: &str) -> Option<usize> {
    // Longest run of `label(.label)+` where the final label is a known TLD,
    // optionally followed by a `/path`.
    let bytes = s.as_bytes();
    let mut last_dot: Option<usize> = None;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '.' {
            last_dot = Some(i);
        } else if !(c.is_ascii_alphanumeric() || c == '-') {
            break;
        }
        i += 1;
    }
    let dot = last_dot?;
    let tld = &s[dot + 1..i];
    if !TLDS.iter().any(|t| t.eq_ignore_ascii_case(tld)) {
        return None;
    }
    // Swallow a trailing `/path` so `instagram.com/djtejasofficial` goes whole.
    if i < bytes.len() && bytes[i] == b'/' {
        while i < bytes.len()
            && !(bytes[i] as char).is_whitespace()
            && bytes[i] != b']'
            && bytes[i] != b')'
        {
            i += 1;
        }
    }
    Some(i)
}

/// Position of the first domain token in `s`, if any.
fn find_domain(s: &str) -> Option<(usize, usize)> {
    let mut start = 0;
    while start < s.len() {
        if !s.is_char_boundary(start) {
            start += 1;
            continue;
        }
        let rest = &s[start..];
        // Only start at a token boundary.
        let at_boundary = start == 0
            || !s[..start]
                .chars()
                .next_back()
                .map(|c| c.is_alphanumeric() || c == '-' || c == '.')
                .unwrap_or(false);
        if at_boundary {
            let rest = rest
                .strip_prefix("https://")
                .or_else(|| rest.strip_prefix("http://"))
                .unwrap_or(rest);
            let offset = s.len() - start - rest.len();
            if let Some(end) = domain_end(rest) {
                return Some((start, start + offset + end));
            }
        }
        start += 1;
    }
    None
}

/// Drop every bracketed/parenthesised group whose contents carry a domain.
fn strip_site_groups(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let open = chars[i];
        if open == '(' || open == '[' {
            let close = if open == '(' { ')' } else { ']' };
            if let Some(j) = (i + 1..chars.len()).find(|&j| chars[j] == close) {
                let inner: String = chars[i + 1..j].iter().collect();
                if find_domain(&inner).is_some() {
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(open);
        i += 1;
    }
    out
}

fn strip_domains(s: &str) -> String {
    let mut out = s.to_string();
    while let Some((a, b)) = find_domain(&out) {
        out.replace_range(a..b, " ");
    }
    out
}

fn strip_mp3(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = s.to_string();
    let mut from = 0;
    while let Some(idx) = lower[from..].find(".mp3") {
        let at = from + idx;
        let end = at + 4;
        let next_ok = out[end..]
            .chars()
            .next()
            .map(|c| !c.is_alphanumeric())
            .unwrap_or(true);
        if next_ok {
            out.replace_range(at..end, "");
            return strip_mp3(&out);
        }
        from = end;
    }
    out
}

/// Whitespace/punctuation repair after a removal: empty `()`, doubled spaces,
/// a separator left dangling at either end.
fn tidy(s: &str) -> String {
    let mut out = s.to_string();
    for pair in ["()", "[]", "( )", "[ ]"] {
        while out.contains(pair) {
            out = out.replace(pair, "");
        }
    }
    // ` )` → `)`, `( ` → `(`
    out = out.replace("( ", "(").replace("[ ", "[");
    out = out.replace(" )", ")").replace(" ]", "]");
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    while out.contains("- -") {
        out = out.replace("- -", "-");
    }
    out = out.replace(" ,", ",");
    let trimmed = out
        .trim()
        .trim_start_matches(['-', '–', '—', '|', ','])
        .trim_end_matches(['-', '–', '—', '|', ','])
        .trim()
        .to_string();
    let mut out = trimmed;
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out
}

fn strip_sites(s: &str) -> (String, bool) {
    let cleaned = tidy(&strip_mp3(&strip_domains(&strip_site_groups(s))));
    let before = tidy(s);
    let hit = cleaned != before;
    (cleaned, hit)
}

/// Rule 2: an artist that is nothing BUT a site stamp, reduced to its handle.
fn site_handle(s: &str) -> Option<String> {
    let trimmed = s
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != ':');
    let (a, b) = find_domain(trimmed)?;
    // Nothing but the stamp: no other alphanumeric content around it.
    if trimmed[..a].chars().any(char::is_alphanumeric)
        || trimmed[b..].chars().any(char::is_alphanumeric)
    {
        return None;
    }
    let token = &trimmed[a..b];
    if let Some((_, path)) = token.split_once('/') {
        if let Some(last) = path.rsplit('/').find(|p| !p.is_empty()) {
            if last.chars().count() >= 3 && last.chars().any(char::is_alphabetic) {
                return Some(last.to_string());
            }
        }
    }
    let host = token.split('/').next().unwrap_or(token);
    let host = host.strip_prefix("www.").unwrap_or(host);
    host.split('.').next().map(str::to_string)
}

/// Rule 3. `guarded` widens it to bare `NN ` forms, and is set only when the
/// row already showed junk by another rule.
fn strip_lead_num(s: &str, guarded: bool) -> (String, bool) {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 3 || !chars[0].is_ascii_digit() || !chars[1].is_ascii_digit() {
        return (s.to_string(), false);
    }
    // Three digits is a BPM tag or a real title (`130 Coco`, `158 - MIX`).
    if chars.get(2).is_some_and(char::is_ascii_digit) {
        return (s.to_string(), false);
    }
    let mut i = 2;
    while chars.get(i).is_some_and(|c| c.is_whitespace()) {
        i += 1;
    }
    let punct = chars
        .get(i)
        .is_some_and(|c| matches!(c, '.' | '-' | ')' | '_'));
    if punct {
        i += 1;
        while chars.get(i).is_some_and(|c| c.is_whitespace()) {
            i += 1;
        }
    }
    let followed_by_letter = chars.get(i).is_some_and(|c| c.is_alphabetic());
    if !followed_by_letter {
        return (s.to_string(), false);
    }
    let zero_padded_space = chars[0] == '0' && i > 2 && !punct;
    if punct || zero_padded_space || (guarded && i > 2) {
        let rest: String = chars[i..].iter().collect();
        return (tidy(&rest), true);
    }
    (s.to_string(), false)
}

/// Rule 0. Any character below U+0020 (tab, newline, `\x1a` SUB) — real tag
/// damage that renders as a broken line, not as text.
fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

/// Drop control characters and collapse every whitespace run to one space —
/// the same fold `capture::normalize_identity_text` applies before hashing,
/// which is why this rule can never move a `track_id`.
fn strip_controls(s: &str) -> String {
    let replaced: String = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    replaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_underscores(s: &str) -> (String, bool) {
    if !s.contains('_') {
        return (s.to_string(), false);
    }
    (tidy(&s.replace('_', " ")), true)
}

/// Rule 5. `None` when the string is not SHOUTING, or is shorter than
/// `min_words`.
fn recase(s: &str, min_words: usize) -> Option<String> {
    if s.chars().any(char::is_lowercase) || !s.chars().any(char::is_alphabetic) {
        return None;
    }
    let words: Vec<&str> = s.split_whitespace().collect();
    if words.len() < min_words {
        return None;
    }
    let cased: Vec<String> = words
        .iter()
        .map(|w| {
            let core: &str = w.trim_matches(|c: char| !c.is_alphanumeric() && c != '&');
            if core.is_empty()
                || KEEP_UPPER.iter().any(|k| k.eq_ignore_ascii_case(core) && *k == core)
                // `N.W.A.` and friends: alternating letter/dot stays as typed.
                || (core.contains('.') && core.chars().filter(char::is_ascii_alphabetic).count() <= 4)
            {
                return (*w).to_string();
            }
            let mut fixed = String::new();
            let mut seen_alpha = false;
            for c in w.chars() {
                if c.is_alphabetic() {
                    if seen_alpha {
                        fixed.extend(c.to_lowercase());
                    } else {
                        fixed.extend(c.to_uppercase());
                        seen_alpha = true;
                    }
                } else {
                    fixed.push(c);
                    if !c.is_alphanumeric() && c != '\'' {
                        seen_alpha = false;
                    }
                }
            }
            fixed
        })
        .collect();
    Some(tidy(&cased.join(" ")))
}

/// The whole pipeline for one row. Returns the corrected pair and the rules
/// that fired (empty ⇒ nothing to correct).
fn scrub(orig_title: &str, orig_artist: &str) -> (String, String, Vec<String>) {
    let mut rules: Vec<String> = Vec::new();

    // Rule 0 runs first so every later rule sees a single-line string.
    if has_control(orig_title) || has_control(orig_artist) {
        rules.push("control-chars".into());
    }
    let title = &strip_controls(orig_title);
    let artist = &strip_controls(orig_artist);

    let (t_site, hit) = strip_sites(title);
    if hit {
        rules.push("site".into());
    }

    let a_site = match site_handle(artist) {
        Some(handle) if &handle != artist => {
            rules.push("site-handle".into());
            handle
        }
        Some(handle) => handle,
        None => {
            let (a, hit) = strip_sites(artist);
            if hit {
                rules.push("site-artist".into());
            }
            a
        }
    };

    let junky = !rules.is_empty() || title.contains('_') || artist.contains('_');

    let (t_num, hit) = strip_lead_num(&t_site, junky);
    if hit {
        rules.push("leadnum".into());
    }

    // An artist that OPENS with a track number is a filename fragment, not a
    // credit — and only that proof licenses re-casing it.
    let (mut a_num, hit) = strip_lead_num(&a_site, junky);
    if hit {
        rules.push("leadnum-artist".into());
        if let Some(cased) = recase(&a_num, 2) {
            a_num = cased;
        }
    }

    let (t_us, hit) = strip_underscores(&t_num);
    if hit {
        rules.push("underscore".into());
    }
    let (a_us, hit) = strip_underscores(&a_num);
    if hit {
        rules.push("underscore-artist".into());
    }

    let t_final = match recase(&t_us, if rules.is_empty() { 3 } else { 2 }) {
        Some(cased) => {
            rules.push("allcaps".into());
            cased
        }
        None => t_us,
    };

    // Rule 6 — never empty a field. Falls back to the ORIGINAL, controls and
    // all: an unreadable value still beats deleting the track (§4.3).
    let t_out = if t_final.trim().is_empty() {
        orig_title.to_string()
    } else {
        t_final
    };
    let a_out = if a_us.trim().is_empty() {
        orig_artist.to_string()
    } else {
        a_us
    };

    // Compared against the originals, so a control-character-only cleanup still
    // counts as a correction.
    if t_out == orig_title && a_out == orig_artist {
        rules.clear();
    }
    (t_out, a_out, rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(t: &str, a: &str) -> (String, String) {
        let (t, a, _) = scrub(t, a);
        (t, a)
    }

    #[test]
    fn strips_download_site_stamps() {
        assert_eq!(s("Rangtaari - DJMaza.MS", "Dev Negi").0, "Rangtaari");
        assert_eq!(s("Ghungroo (SongsMp3.Cool)", "Arijit Singh").0, "Ghungroo");
        assert_eq!(
            s(
                "Blue Eyes Remix - Dj Sukhi[ www.DjsDrive.In ]",
                "[ www.DjsDrive.In ]"
            ),
            ("Blue Eyes Remix - Dj Sukhi".into(), "DjsDrive".into())
        );
        // The edit marker after the stamp is not part of the stamp.
        assert_eq!(
            s("Badtameez Dil - DJMaza.Com INTRO 2", "Benny Dayal").0,
            "Badtameez Dil - INTRO 2"
        );
    }

    #[test]
    fn reduces_a_site_only_artist_to_its_handle_instead_of_emptying_it() {
        // Emptying would strip the row of its identity entirely (§4.3).
        assert_eq!(
            s("Fitoor", "www.instagram.com/djtejasofficial").1,
            "djtejasofficial"
        );
        assert_eq!(s("Tote Tote", "www.JP-Ent.com").1, "JP-Ent");
        assert_eq!(s("Jalebi Baby Remix", "DJsLover.com").1, "DJsLover");
        // A path segment that carries no letters falls back to the host label.
        assert_eq!(
            s("Yaara Dhol Bajake", "www.hindu-place.com/07").1,
            "hindu-place"
        );
    }

    #[test]
    fn leaves_a_real_title_that_merely_starts_with_a_number_alone() {
        // Every one of these is the actual title. This is the rule's whole point.
        for (t, a) in [
            ("5 On It (HH Clean Short)", "Steff Da Campo & Chico Rose"),
            ("24 (Remix) (HH Dirty Intro)", "Money Man ft Lil Baby"),
            ("2 Reasons (Clean)", "Trey Songz ft T.I."),
            ("130 Coco - Patty Mashup", "PATTY"),
            (
                "158 - EXTENDED MIX - Aata Majhi Satakli",
                "@dj.prince.jaipur",
            ),
        ] {
            assert_eq!(s(t, a).0, t, "{t:?} must survive untouched");
        }
    }

    #[test]
    fn strips_a_leading_track_number_only_in_its_unambiguous_forms() {
        assert_eq!(s("19.Jugnu - Badshah", "DJ ABHIJIT").0, "Jugnu - Badshah");
        assert_eq!(
            s("01 - Kudiya Shehar Di", "Daler Mehndi").0,
            "Kudiya Shehar Di"
        );
        assert_eq!(s("08 Maiyya Mainu", "Dj Tejas").0, "Maiyya Mainu"); // zero-padded
                                                                        // Not zero-padded, no punctuation, and nothing else junky about the row.
        assert_eq!(s("13 Fitoor", "Dj Tejas").0, "13 Fitoor");
        // …but the same title IS stripped once the row proves junky.
        assert_eq!(
            s("13 Fitoor _ Shamshera", "www.instagram.com/djtejasofficial").0,
            "Fitoor Shamshera"
        );
    }

    #[test]
    fn recases_shouting_titles_but_never_an_artists_own_styling() {
        assert_eq!(
            s("MORNI BANKE (THIRD DIMENSION REMIX)", "DJ HARSH BHUTANI"),
            (
                "Morni Banke (Third Dimension Remix)".into(),
                "DJ HARSH BHUTANI".into()
            )
        );
        assert_eq!(s("Another World (Clean Extended)", "MEDUZA").1, "MEDUZA");
        assert_eq!(s("Straight Outta Compton (Dirty)", "N.W.A.").1, "N.W.A.");
        assert_eq!(s("MAGIC [AFTERJOY EDIT]", "AFTERJOY").1, "AFTERJOY");
        // An artist that is a filename fragment — proven by its track number.
        assert_eq!(
            s("O MEHNDI RANG LAYEE", "04 CHAL MERE BHAI").1,
            "Chal Mere Bhai"
        );
    }

    #[test]
    fn recasing_alone_never_moves_the_identity() {
        // `normalize_identity_text` lowercases, so case is not part of the hash.
        // This is what makes rule 5 free of §4.3's identity risk.
        let (t, a, rules) = scrub("MORNI BANKE (THIRD DIMENSION REMIX)", "DJ HARSH BHUTANI");
        assert_eq!(rules, vec!["allcaps".to_string()]);
        assert_eq!(
            track_id_from_title_artist(Some(&t), Some(&a)),
            track_id_from_title_artist(
                Some("MORNI BANKE (THIRD DIMENSION REMIX)"),
                Some("DJ HARSH BHUTANI")
            )
        );
    }

    #[test]
    fn repairs_control_characters_without_moving_the_identity() {
        let (t, a, rules) = scrub(
            "act ii: date @ 8\n- MarkCutz Remix (Dirty)",
            "4Batz & Drake\n\n",
        );
        assert_eq!(t, "act ii: date @ 8 - MarkCutz Remix (Dirty)");
        assert_eq!(a, "4Batz & Drake");
        assert!(rules.contains(&"control-chars".to_string()));
        // The identity fold collapses whitespace itself, so this is a no-op there.
        assert_eq!(
            track_id_from_title_artist(Some(&t), Some(&a)),
            track_id_from_title_artist(
                Some("act ii: date @ 8\n- MarkCutz Remix (Dirty)"),
                Some("4Batz & Drake\n\n")
            )
        );
    }

    #[test]
    fn leaves_a_merely_untrimmed_tag_alone() {
        // Trailing space is invisible in every surface (HTML collapses it) and
        // invisible to the identity fold — a correction here would be noise.
        assert!(scrub("Champion (Dirty)", "NAV ft Travis Scott ")
            .2
            .is_empty());
    }

    #[test]
    fn never_empties_a_field() {
        // The artist is nothing but a stamp with no usable handle; the original
        // stands rather than the track losing its identity.
        let (t, a, _) = scrub("Some Title", "   ");
        assert_eq!((t.as_str(), a.as_str()), ("Some Title", "   "));
        let (_, a, _) = scrub("Khaike Pan", "DjFactory.In");
        assert!(!a.trim().is_empty(), "artist was emptied: {a:?}");
    }

    #[test]
    fn is_idempotent_over_its_own_output() {
        // The tool always reads demo-catalog.json, never its own output — but a
        // rule that is not a fixed point would still be a smell, and would make
        // a hand-edited overlay entry drift on the next run.
        for (t, a) in [
            (
                "19.Jugnu - Badshah - (Dj Abhijit 2021 Remix)",
                "DJ ABHIJIT www.downloads4djs.co.in",
            ),
            ("Marathi Dance_Zingaat - MahaMP3.Com", "Ajay Gogavale"),
            (
                "MORNI BANKE (THIRD DIMENSION REMIX)",
                "https://www.facebook.com/whatis3d/",
            ),
        ] {
            let (t1, a1, _) = scrub(t, a);
            let (t2, a2, _) = scrub(&t1, &a1);
            assert_eq!((&t1, &a1), (&t2, &a2), "not a fixed point: {t:?}");
        }
    }
}
