-- Golden fixture for Story 1.9's Serato 4+ `master.sqlite` harness.
--
-- Schema is the union of parser::serato4::read_session's and
-- joiner::serato4::join_session's SELECTs, matching the live-verified real
-- `master.sqlite` shape (Story 3.7 §3d: end_time, played, length_ms,
-- length_sec, portable_id confirmed against 23,259 real rows; key_value is
-- Serato's canonical key INTEGER, Story 3.6).
--
-- One session, four rows, covering in one fixture:
--   - a normal multi-row session (rows 1, 3, 4)
--   - the confirmed-real end_time = -1 "unset" sentinel, empty-string "absent"
--     convention, and key_value = -1 "no key" (row 2, also a played = 0
--     loaded-but-never-played preview)
--   - musical free-text `"key"` alongside key_value (rows 1, 3, 4) — the
--     Story 3.6 incident shape: key_value must win, the free text must not
--   - a multi-deck session exercising deck values "1"-"4" (real data confirms
--     this range occurs — see deferred-work.md)
--   - length_ms present (rows 1, 4) vs only length_sec (row 3) vs neither
--     (row 2); portable_id in both real conventions (boot-drive `Users/...`
--     and USB-volume-relative)

CREATE TABLE history_session (
    id         INTEGER PRIMARY KEY,
    name       TEXT,
    start_time INTEGER,
    end_time   INTEGER
);

CREATE TABLE history_entry (
    id          INTEGER PRIMARY KEY,
    session_id  INTEGER NOT NULL,
    name        TEXT,
    artist      TEXT,
    genre       TEXT,
    "key"       TEXT,
    key_value   INTEGER,
    start_time  INTEGER,
    end_time    INTEGER,
    deck        TEXT,
    bpm         REAL,
    played      INTEGER,
    length_ms   INTEGER,
    length_sec  INTEGER,
    portable_id TEXT
);

INSERT INTO history_session (id, name, start_time, end_time)
VALUES (42, 'Golden Session', 1000, 4500);

INSERT INTO history_entry
    (id, session_id, name, artist, genre, "key", key_value, start_time, end_time, deck, bpm,
     played, length_ms, length_sec, portable_id)
VALUES
    (1, 42, 'Track A', 'Artist A', 'House',  'G#m', 0,  1000, 1180, '1', 128.0, 1, 372000, 372, 'Users/arjun/Music/a.mp3'),
    (2, 42, 'Track B', 'Artist B', '',       '',    -1, 2000, -1,   '2', 126.5, 0, NULL,   NULL, ''),
    (3, 42, 'Track C', 'Artist C', 'Techno', 'Em',  3,  3000, 3300, '3', 140.0, 1, NULL,   301, 'A Indian/c.mp3'),
    (4, 42, 'Track D', 'Artist D', 'Disco',  'Am',  1,  4000, 4290, '4', 118.0, 1, 245000, 245, 'Users/arjun/Music/d.mp3');
