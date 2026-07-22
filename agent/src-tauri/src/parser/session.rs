//! Binary decode of the legacy Serato `.session` play-log format.
//!
//! Clean-room: the envelope and field-ID map below were confirmed by Story 1.2's
//! own spike (findings doc §3) against the real corpus — no code is ported from any
//! third-party `.session`/history parser (see the story's Clean-room discipline
//! note). `id3`/`triseratops` are intentionally NOT used here; this is a
//! from-scratch decode.
//!
//! Structure — two nested tag/length/payload layers:
//! - **Top level**: 4-byte ASCII tag + 4-byte big-endian `u32` length + payload.
//!   Each play is one `oent` record; a leading non-`oent` header (`vrsn`) precedes
//!   the first play. The walk advances by each record's own declared length, so any
//!   non-`oent` record is skipped structurally — never by scanning for a byte tag.
//! - Inside an `oent`: one `adat` record (same tag/length shape) holds the fields.
//! - Inside `adat`: fields are NOT ASCII-tagged — each is a 4-byte big-endian `u32`
//!   numeric field ID + 4-byte BE `u32` length + payload. Text payloads are
//!   UTF-16BE, NUL-terminated; numeric payloads are 4-byte big-endian.

use super::{ParseError, ParseOutcome, ParseStats, Play};
use std::collections::HashSet;

/// Length of a record's ASCII tag / a field's numeric ID (both 4 bytes).
const TAG_LEN: usize = 4;
/// Length of a full header: 4-byte tag/field-id + 4-byte big-endian length.
const HEADER_LEN: usize = 8;

/// Parses one `.session` file's bytes into an ordered, de-duplicated list of plays.
///
/// Pure (no IO) — the primary unit-testable entry point, and the strict one: **any**
/// structural failure voids the whole file. Callers that must survive a partially
/// written file (the watcher reading a session mid-gig) want [`parse_partial`]
/// instead, which returns the plays decoded before the failure alongside the error.
///
/// Records are de-duplicated by their field-1 row ID (first occurrence wins):
/// roughly half of real sessions carry byte-identical duplicate `oent` records
/// (findings doc §5/D1), which would otherwise double-count plays. The result is
/// then ordered by play start time — see [`parse_partial`] for why that, and not
/// raw file order, is the validated order.
///
/// A file with zero recognizable `oent` records is valid empty data, not an error
/// (`Ok(vec![])`). A record whose declared length overruns its enclosing bound is a
/// hard [`ParseError::Truncated`]; a walk that lands off a record boundary is a hard
/// [`ParseError::Desync`] — never a silent clamp, never a silently wrong answer. The
/// parse path contains no panics: no input, however malformed, crashes it.
pub fn parse(data: &[u8]) -> Result<Vec<Play>, ParseError> {
    let outcome = parse_partial(data);
    match outcome.error {
        Some(err) => Err(err),
        None => Ok(outcome.plays),
    }
}

/// Parses as much of a `.session` file as is structurally intact, returning the plays
/// decoded before any failure, per-parse [`ParseStats`], and the failure itself (if
/// any) rather than discarding everything.
///
/// **Why this exists (Story 1.3 review, RF-5):** Serato appends to a `.session` file
/// *during* the gig, so a half-written trailing record is the file's normal state
/// mid-set, not corruption. An all-or-nothing parse would throw away the 150 valid
/// plays that precede it on every read. Callers decide what a partial result means:
/// a failure at the very end of the buffer is a tail that the next write completes;
/// a failure with a large intact remainder behind it is real corruption. The offset
/// carried by the error is what distinguishes them.
///
/// **Ordering.** Plays are returned in start-time order (field 28), stably — plays
/// with equal or missing start times keep their relative file order, and a play with
/// no start time inherits the last known one so it stays in its file neighbourhood.
/// This is the order Story 1.2 actually validated: its ground-truth harness sorted by
/// start time before matching 151/151 and 253/253 positions against `master.sqlite`
/// (`spike-1-2-parser-validation/src/main.rs:370`). Raw file order was never itself
/// validated against ground truth, and need not equal play order — a record written
/// when a track *ends* would sort differently from one written when it starts, which
/// is exactly what happens across an overlapping mix.
pub fn parse_partial(data: &[u8]) -> ParseOutcome {
    let mut plays: Vec<Play> = Vec::new();
    let mut seen_row_ids: HashSet<u32> = HashSet::new();
    let mut stats = ParseStats::default();
    let mut error: Option<ParseError> = None;
    let n = data.len();
    let mut offset = 0usize;

    while offset < n {
        // Read the record header: [4-byte tag][4-byte BE length]. A well-formed file
        // ends exactly on a record boundary, so a remainder too short to hold a full
        // header means the walk is no longer aligned to one (RF-2) — the failure mode
        // a purely structural walk would otherwise report as a silent `Ok`.
        let Some(tag) = data.get(offset..offset + TAG_LEN) else {
            error = Some(ParseError::Desync { offset });
            break;
        };
        // A record tag is 4 printable ASCII bytes (`vrsn`, `oent`, ...). Anything else
        // means the previous record's declared length did not actually end where this
        // one begins — stop loud instead of walking on through garbage tag space and
        // returning a plausible-looking but wrong play list.
        if !is_plausible_tag(tag) {
            error = Some(ParseError::Desync { offset });
            break;
        }
        let Some(length) = read_u32_be(data, offset + TAG_LEN) else {
            error = Some(ParseError::Desync { offset });
            break;
        };
        stats.top_level_records += 1;

        // The declared length is checked against the remaining file buffer. An
        // overrun fails loud rather than clamping the slice and reading partial data.
        let payload_start = offset + HEADER_LEN;
        let record_end = match payload_start
            .checked_add(length as usize)
            .filter(|&end| end <= n)
        {
            Some(end) => end,
            None => {
                error = Some(ParseError::Truncated { offset });
                break;
            }
        };

        if tag == b"oent" {
            stats.oent_records_seen += 1;
            match decode_oent(&data[payload_start..record_end], payload_start) {
                Err(err) => {
                    error = Some(err);
                    break;
                }
                // An `oent` with no decodable `adat` is not a play — skip it rather
                // than emit a phantom all-`None` play that references no track (RF-3).
                Ok(None) => stats.records_skipped += 1,
                Ok(Some((row_id, play))) => match row_id {
                    Some(id) => {
                        // `insert` returns true only the first time an ID is seen, so
                        // later duplicates are dropped while earlier order is preserved.
                        // A HashSet (not adjacent-only dedup) is required: duplicate
                        // `oent`s are not guaranteed to sit next to each other.
                        if seen_row_ids.insert(id) {
                            plays.push(play);
                        } else {
                            stats.duplicates_dropped += 1;
                        }
                    }
                    // A play with no parseable row ID is never deduped against anything.
                    None => {
                        stats.plays_without_row_id += 1;
                        plays.push(play);
                    }
                },
            }
        }
        // Any other top-level tag (e.g. the leading `vrsn` header) is skipped by
        // advancing past its declared length below — structurally, never by scanning.

        offset = record_end;
    }

    sort_by_start_time(&mut plays);
    stats.plays_emitted = plays.len();

    ParseOutcome {
        plays,
        stats,
        error,
    }
}

/// Orders plays by start time (field 28), stably. A play with no start time inherits
/// the last known one, so it keeps its file neighbourhood instead of being flung to
/// the front; `sort_by_key` is stable, so equal times keep file order. Deterministic
/// for identical input (AC-4). See [`parse_partial`] for why start time, not file
/// order, is the validated ordering.
fn sort_by_start_time(plays: &mut Vec<Play>) {
    let mut carry = 0u32;
    let mut keyed: Vec<(u32, Play)> = std::mem::take(plays)
        .into_iter()
        .map(|play| {
            let key = play.start_time.unwrap_or(carry);
            carry = key;
            (key, play)
        })
        .collect();
    keyed.sort_by_key(|(key, _)| *key);
    *plays = keyed.into_iter().map(|(_, play)| play).collect();
}

/// Whether `tag` looks like a record tag: exactly 4 printable ASCII bytes. Used to
/// catch a walk that has fallen off a record boundary (RF-2).
fn is_plausible_tag(tag: &[u8]) -> bool {
    tag.len() == TAG_LEN && tag.iter().all(|b| (0x20..=0x7e).contains(b))
}

/// Decodes one `oent` record payload into its `(row_id, Play)`. `base` is the
/// absolute file offset of `payload[0]`, used only to report meaningful diagnostic
/// offsets in [`ParseError::Truncated`].
///
/// The `oent` payload carries exactly one `adat` sub-record. If it is too short to
/// hold that header, or the inner tag is not `adat`, there are no decodable fields
/// and `Ok(None)` says so — the caller skips the record and counts it, rather than
/// emitting a phantom all-`None` play that references no track (RF-3). That is not
/// an error and never panics; it is simply not a play.
///
/// The `adat` length, and every field length, are checked against their own enclosing
/// bound; an overrun is a hard [`ParseError::Truncated`].
#[allow(clippy::type_complexity)]
fn decode_oent(payload: &[u8], base: usize) -> Result<Option<(Option<u32>, Play)>, ParseError> {
    let mut play = Play::default();
    let mut row_id: Option<u32> = None;

    // Inner record header: expect [b"adat"][4-byte BE length].
    let Some(tag) = payload.get(0..TAG_LEN) else {
        return Ok(None);
    };
    if tag != b"adat" {
        return Ok(None);
    }
    let Some(adat_len) = read_u32_be(payload, TAG_LEN) else {
        return Ok(None);
    };

    // The adat length is checked against its enclosing `oent` payload bounds (NOT
    // the whole file). Overrun => fail loud.
    let fields_start = HEADER_LEN;
    let fields_end = fields_start
        .checked_add(adat_len as usize)
        .filter(|&end| end <= payload.len())
        .ok_or(ParseError::Truncated { offset: base })?;
    let fields = &payload[fields_start..fields_end];

    // Walk the numeric-ID-tagged fields inside `adat`.
    let mut k = 0usize;
    while k < fields.len() {
        let Some(field_id) = read_u32_be(fields, k) else {
            break; // trailing fragment too short for a field header — stop cleanly
        };
        let Some(field_len) = read_u32_be(fields, k + TAG_LEN) else {
            break;
        };

        let value_start = k + HEADER_LEN;
        // The field length is checked against the enclosing `adat` payload bounds.
        let value_end = value_start
            .checked_add(field_len as usize)
            .filter(|&end| end <= fields.len())
            .ok_or(ParseError::Truncated {
                offset: base + fields_start + k,
            })?;

        assign_field(
            &mut play,
            &mut row_id,
            field_id,
            &fields[value_start..value_end],
        );

        k = value_end;
    }

    Ok(Some((row_id, play)))
}

/// Maps a decoded field onto the [`Play`] (or the internal dedup `row_id`). Only the
/// high-confidence fields from the findings doc's map are decoded; low-confidence
/// candidates (15/BPM, 29/53/times, 50/played-flag) are intentionally ignored so they
/// never leak into the play log as if trustworthy.
///
/// Numeric fields are decoded **only** from a payload of exactly 4 bytes (RF-1).
/// Reading the first 4 bytes of a longer payload would silently invent a value: for
/// `start_time`/`deck`/`duration_sec` that is wrong data, and for the row ID it
/// corrupts the dedup set — dropping a real play or admitting a duplicate. A
/// wrong-width numeric field is left absent, which every consumer already handles.
fn assign_field(play: &mut Play, row_id: &mut Option<u32>, field_id: u32, value: &[u8]) {
    match field_id {
        // Row ID — dedup key only, never exposed on `Play`.
        1 if value.len() == 4 => *row_id = read_u32_be(value, 0),
        2 => play.path = Some(decode_utf16be(value)),
        6 => play.title = Some(decode_utf16be(value)),
        7 => play.artist = Some(decode_utf16be(value)),
        8 => play.label = Some(decode_utf16be(value)),
        9 => play.genre = Some(decode_utf16be(value)),
        17 => play.grouping = Some(decode_utf16be(value)),
        23 => play.year = Some(decode_utf16be(value)),
        28 if value.len() == 4 => play.start_time = read_u32_be(value, 0),
        31 if value.len() == 4 => play.deck = read_u32_be(value, 0),
        45 if value.len() == 4 => play.duration_sec = read_u32_be(value, 0),
        51 => play.key = Some(decode_utf16be(value)),
        _ => {}
    }
}

/// Reads a big-endian `u32` at `offset`, or `None` if fewer than 4 bytes remain.
/// Bounds-checked via `get` — never indexes out of range.
fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    let bytes: [u8; 4] = data.get(offset..end)?.try_into().ok()?;
    Some(u32::from_be_bytes(bytes))
}

/// Decodes a UTF-16BE, NUL-terminated text payload. Lossy on invalid code units and
/// never panics; an odd trailing byte is ignored.
fn decode_utf16be(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    String::from_utf16_lossy(&units)
}
