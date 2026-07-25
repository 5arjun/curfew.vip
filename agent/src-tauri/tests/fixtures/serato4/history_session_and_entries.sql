-- Golden fixture for Story 1.9's Serato 4+ `master.sqlite` harness.
--
-- Schema is the union of parser::serato4::read_session's and
-- joiner::serato4::join_session's SELECTs (id, session_id, name, artist, genre, "key",
-- start_time, deck, bpm), plus history_session and end_time for production-shape
-- realism (neither function reads end_time or history_session directly today).
--
-- One session, four rows, covering in one fixture:
--   - a normal multi-row session (rows 1, 3, 4)
--   - the confirmed-real end_time = -1 "unset" sentinel and empty-string "absent"
--     convention (row 2: end_time = -1, genre/key = '')
--   - a multi-deck session exercising deck values "1"-"4" (real data confirms this
--     range occurs — see deferred-work.md)

CREATE TABLE history_session (
    id   INTEGER PRIMARY KEY,
    name TEXT
);

CREATE TABLE history_entry (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL,
    name       TEXT,
    artist     TEXT,
    genre      TEXT,
    "key"      TEXT,
    start_time INTEGER,
    end_time   INTEGER,
    deck       TEXT,
    bpm        REAL
);

INSERT INTO history_session (id, name) VALUES (42, 'Golden Session');

INSERT INTO history_entry
    (id, session_id, name, artist, genre, "key", start_time, end_time, deck, bpm)
VALUES
    (1, 42, 'Track A', 'Artist A', 'House',  '1A', 1000, 1180, '1', 128.0),
    (2, 42, 'Track B', 'Artist B', '',       '',   2000, -1,   '2', 126.5),
    (3, 42, 'Track C', 'Artist C', 'Techno', '4A', 3000, 3300, '3', 140.0),
    (4, 42, 'Track D', 'Artist D', 'Disco',  '2A', 4000, 4200, '4', 118.0);
