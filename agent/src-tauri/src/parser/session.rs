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

use super::{ParseError, Play};
use std::collections::HashSet;

/// Length of a record's ASCII tag / a field's numeric ID (both 4 bytes).
const TAG_LEN: usize = 4;
/// Length of a full header: 4-byte tag/field-id + 4-byte big-endian length.
const HEADER_LEN: usize = 8;

/// Parses one `.session` file's bytes into an ordered, de-duplicated list of plays.
///
/// Pure (no IO) — the primary unit-testable entry point. File order is chronological
/// in every real session Story 1.2 inspected, so the returned order is the as-played
/// order. Records are de-duplicated by their field-1 row ID (first occurrence wins):
/// roughly half of real sessions carry byte-identical duplicate `oent` records
/// (findings doc §5/D1), which would otherwise double-count plays.
///
/// A file with zero recognizable `oent` records is valid empty data, not an error
/// (`Ok(vec![])`). A record whose declared length overruns its enclosing bound is a
/// hard [`ParseError::Truncated`] — never a silent clamp. The parse path contains no
/// panics: no input, however malformed, crashes it.
pub fn parse(data: &[u8]) -> Result<Vec<Play>, ParseError> {
    let mut plays: Vec<Play> = Vec::new();
    let mut seen_row_ids: HashSet<u32> = HashSet::new();
    let n = data.len();
    let mut offset = 0usize;

    while offset < n {
        // Read the record header: [4-byte tag][4-byte BE length]. A trailing
        // remainder too short to hold a full header is an incomplete fragment at
        // EOF — stop cleanly (this is not a declared-length overrun).
        let Some(tag) = data.get(offset..offset + TAG_LEN) else {
            break;
        };
        let Some(length) = read_u32_be(data, offset + TAG_LEN) else {
            break;
        };

        // The declared length is checked against the remaining file buffer. An
        // overrun fails loud rather than clamping the slice and reading partial data.
        let payload_start = offset + HEADER_LEN;
        let record_end = payload_start
            .checked_add(length as usize)
            .filter(|&end| end <= n)
            .ok_or(ParseError::Truncated { offset })?;

        if tag == b"oent" {
            let (row_id, play) = decode_oent(&data[payload_start..record_end], payload_start)?;
            match row_id {
                Some(id) => {
                    // `insert` returns true only the first time an ID is seen, so
                    // later duplicates are dropped while earlier order is preserved.
                    // A HashSet (not adjacent-only dedup) is required: duplicate
                    // `oent`s are not guaranteed to sit next to each other.
                    if seen_row_ids.insert(id) {
                        plays.push(play);
                    }
                }
                // A play with no parseable row ID is never deduped against anything.
                None => plays.push(play),
            }
        }
        // Any other top-level tag (e.g. the leading `vrsn` header) is skipped by
        // advancing past its declared length below — structurally, never by scanning.

        offset = record_end;
    }

    Ok(plays)
}

/// Decodes one `oent` record payload into its `(row_id, Play)`. `base` is the
/// absolute file offset of `payload[0]`, used only to report meaningful diagnostic
/// offsets in [`ParseError::Truncated`].
///
/// The `oent` payload carries exactly one `adat` sub-record. If it is too short to
/// hold that header, or the inner tag is not `adat`, there are no decodable fields:
/// an empty `Play` is returned (no panic, no error — this is not a length overrun).
/// The `adat` length, and every field length, are checked against their own
/// enclosing bound; an overrun is a hard [`ParseError::Truncated`].
fn decode_oent(payload: &[u8], base: usize) -> Result<(Option<u32>, Play), ParseError> {
    let mut play = Play::default();
    let mut row_id: Option<u32> = None;

    // Inner record header: expect [b"adat"][4-byte BE length].
    let Some(tag) = payload.get(0..TAG_LEN) else {
        return Ok((row_id, play));
    };
    if tag != b"adat" {
        return Ok((row_id, play));
    }
    let Some(adat_len) = read_u32_be(payload, TAG_LEN) else {
        return Ok((row_id, play));
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

    Ok((row_id, play))
}

/// Maps a decoded field onto the [`Play`] (or the internal dedup `row_id`). Only the
/// high-confidence fields from the findings doc's map are decoded; low-confidence
/// candidates (15/BPM, 29/53/times, 50/played-flag) are intentionally ignored so they
/// never leak into the play log as if trustworthy.
fn assign_field(play: &mut Play, row_id: &mut Option<u32>, field_id: u32, value: &[u8]) {
    match field_id {
        1 => *row_id = read_u32_be(value, 0), // row ID — dedup key only, never on Play
        2 => play.path = Some(decode_utf16be(value)),
        6 => play.title = Some(decode_utf16be(value)),
        7 => play.artist = Some(decode_utf16be(value)),
        8 => play.label = Some(decode_utf16be(value)),
        9 => play.genre = Some(decode_utf16be(value)),
        17 => play.grouping = Some(decode_utf16be(value)),
        23 => play.year = Some(decode_utf16be(value)),
        28 => play.start_time = read_u32_be(value, 0),
        31 => play.deck = read_u32_be(value, 0),
        45 => play.duration_sec = read_u32_be(value, 0),
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
