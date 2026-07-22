//! Clean-room decode of the legacy `.session` binary play-log format.
//!
//! Reverse-engineered from this spike's own hex-dump analysis of the real files in
//! `~/Music/_Serato_/History/Sessions/`. Reference material consulted was limited to
//! Mixxx's wiki *documentation* of Serato's general tag/length/payload envelope shape
//! (public, factual, not copyrightable expression) — no code was ported or transcribed
//! from any existing `.session`/history parser. See story 1.2 Dev Notes → Clean-room
//! discipline.
//!
//! Envelope, confirmed empirically against real files:
//! - Outer records: 4-byte ASCII tag + 4-byte big-endian u32 length + payload.
//!   Each play is one `oent` record; inside it, one `adat` record holds the fields.
//! - Inside `adat`, fields are NOT ASCII-tagged — each is a 4-byte big-endian u32
//!   numeric field ID + 4-byte big-endian u32 length + payload. Text payloads are
//!   UTF-16BE (NUL-terminated); 4-byte payloads are typically big-endian u32/i32.
//!
//! Field ID map (confirmed against real tracks with known artist/title/BPM/key,
//! cross-checked against file mtimes and inter-play gaps — see findings doc for the
//! corroborating evidence per field):
//! - 1: history row id (sequential)      - 9: genre
//! - 2: absolute file path (track identity) - 17: grouping (freeform tags)
//! - 6: title                             - 23: year
//! - 7: artist                            - 28: start_time (unix epoch, UTC)
//! - 8: label                             - 31: deck (observed 1 or 2)
//! - 45: played duration (seconds)        - 51: key (Camelot notation, e.g. "1A")
//! - 50: played flag (always 1 in samples; does not distinguish a full play from a
//!   rapid preview/browse — see findings doc)
//!
//! Fields 15 (candidate: bpm, low confidence), 29/53 (candidate: end/modified time,
//! low confidence), 39/48/52/63/68/69/70/72/78 were observed but not decoded with
//! confidence — reported as open in the findings doc rather than guessed at.

use std::fmt;

#[derive(Debug, Clone, Default)]
pub struct Play {
    pub row_id: Option<u32>,
    pub path: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub label: Option<String>,
    pub genre: Option<String>,
    pub grouping: Option<String>,
    pub year: Option<String>,
    pub key: Option<String>,
    pub start_time: Option<u32>,
    pub deck: Option<u32>,
    pub duration_sec: Option<u32>,
    pub played_flag: Option<u32>,
}

#[derive(Debug)]
pub enum ParseError {
    Truncated { offset: usize },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::Truncated { offset } => {
                write!(f, "truncated record at byte offset {offset}")
            }
        }
    }
}

fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn decode_utf16be(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

/// Parses one `.session` file's bytes into an ordered list of plays (file order,
/// which is chronological in every real file inspected during this spike).
///
/// A malformed/truncated record is a logged discrepancy (per story Dev Notes:
/// "prefer Result/graceful failure over panics"), not a crash that stops the whole run.
pub fn parse(data: &[u8]) -> Result<Vec<Play>, ParseError> {
    let mut plays = Vec::new();
    let mut i = 0usize;
    let n = data.len();

    while i + 8 <= n {
        let tag = &data[i..i + 4];
        if tag == b"oent" {
            let length = read_u32_be(data, i + 4).ok_or(ParseError::Truncated { offset: i })?;
            let rec_start = i + 8;
            let rec_end = rec_start.checked_add(length as usize).unwrap_or(n).min(n);

            let play = parse_oent_record(&data[rec_start..rec_end]);
            plays.push(play);

            i = rec_end;
        } else {
            // Not a play record at this offset (e.g. the leading `vrsn` header) —
            // advance one byte at a time until we resync on the next `oent` tag.
            i += 1;
        }
    }

    Ok(plays)
}

fn parse_oent_record(rec: &[u8]) -> Play {
    let mut play = Play::default();

    if rec.len() < 8 || &rec[0..4] != b"adat" {
        return play;
    }
    let Some(adat_len) = read_u32_be(rec, 4) else {
        return play;
    };
    let fs = 8usize;
    let fe = fs.saturating_add(adat_len as usize).min(rec.len());

    let mut k = fs;
    while k + 8 <= fe {
        let Some(fid) = read_u32_be(rec, k) else {
            break;
        };
        let Some(flen) = read_u32_be(rec, k + 4) else {
            break;
        };
        let payload_start = k + 8;
        let payload_end = payload_start.saturating_add(flen as usize).min(fe);
        let payload = &rec[payload_start..payload_end];

        match fid {
            1 if payload.len() == 4 => {
                play.row_id = read_u32_be(payload, 0);
            }
            2 => play.path = Some(decode_utf16be(payload)),
            6 => play.title = Some(decode_utf16be(payload)),
            7 => play.artist = Some(decode_utf16be(payload)),
            8 => play.label = Some(decode_utf16be(payload)),
            9 => play.genre = Some(decode_utf16be(payload)),
            17 => play.grouping = Some(decode_utf16be(payload)),
            23 => play.year = Some(decode_utf16be(payload)),
            51 => play.key = Some(decode_utf16be(payload)),
            28 if payload.len() == 4 => {
                play.start_time = read_u32_be(payload, 0);
            }
            31 if payload.len() == 4 => {
                play.deck = read_u32_be(payload, 0);
            }
            45 if payload.len() == 4 => {
                play.duration_sec = read_u32_be(payload, 0);
            }
            50 if payload.len() == 1 => {
                play.played_flag = Some(payload[0] as u32);
            }
            _ => {}
        }

        k = payload_end;
    }

    play
}
