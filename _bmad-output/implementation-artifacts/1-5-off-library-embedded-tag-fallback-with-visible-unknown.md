---
baseline_commit: b88a0df28a77bb6ef71dcbb8a6f9e1c2158ad2d0
---

# Story 1.5: Off-library embedded-tag fallback with visible "Unknown"

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want tracks not in my Serato library to still get BPM/key/genre from their embedded file tags, and to show "Unknown" when truly absent,
So that off-library plays are never silently dropped or fabricated.

## Acceptance Criteria

1. **Given** an off-library track, **When** enriched, **Then** BPM comes from the Serato Autotags GEOB, key from ID3 `TKEY` (or Vorbis), genre from ID3 `TCON` (or Vorbis). *(FR-2)*
2. **Given** neither library nor embedded source has a value, **When** displayed, **Then** the field shows "Unknown" — never omitted, never guessed. *(FR-2)*
3. **Given** local audio DSP / key-finding, **Then** it is out of scope — no DSP is invoked. *(FR-2 scope)*

**Scope boundary carried forward from Story 1.4 AC-4** (not a new AC, but binding on this story): the fallback applies identically whether a track is fully off-library or in-library with one gapped field — `JoinedMetadata`'s per-field `Option` already makes both cases look the same (`None`), so this story does not (and must not) branch on `in_library`.

**Display boundary**: AC-2's "Unknown" is a *rendering* concern (Epic 3 / the stat engine, not yet built). This story's job ends at leaving a field `None` when no source has it — never render or return the literal string `"Unknown"` anywhere in this module.

**Format boundary**: AC-1 names exactly two tag carriers — ID3 (`TKEY`/`TCON`/GEOB) and Vorbis comments. MP4/M4A atoms are **not named in this AC** even though the PRD's underlying domain research table lists MP4 as a third carrier family — that broader PRD/FR-2 prose is not this story's scope contract, the AC is. Do not add MP4/M4A support (the pinned `triseratops::tag::Autotags` does implement `MP4Tag`, which may look like an invitation — it isn't, for this story). If MP4 support is wanted later, that's a new story with its own AC, not silent scope creep on this one.

## Tasks / Subtasks

- [ ] **Task 1 — Add the new production dependency; re-verify all pinned versions** (AC: 1)
  - [ ] Add `lofty` to `agent/src-tauri/Cargo.toml`'s `[dependencies]` for Vorbis-comment reads (FLAC/OGG) — **re-verify the current non-yanked version on crates.io immediately before implementing** (confirmed at story-creation time, 2026-07-23: latest non-yanked is `0.24.0`, published 2026-04-12; `0.23.0`–`0.23.3` are all yanked — do not pin one of those). Disable default features: `lofty = { version = "0.24.0", default-features = false }` — the only default feature (`id3v2_compression_support`) pulls in `flate2` for ID3v2 compression support this story never uses (all ID3 reads go through the already-pinned `id3` crate, not lofty). Lofty is used **narrowly**, for FLAC/OGG Vorbis-comment field access only — it is not a replacement for `id3` (architecture (AD-11) already commits to `id3` for the ID3 path; don't relitigate that by routing MP3/WAV/AIFF through lofty too).
  - [ ] Re-verify `id3 = "1.17.0"` is still current and non-yanked (confirmed 2026-07-23: `1.17.0`, not yanked — unchanged since pinned in Story 1.3). Re-verify `triseratops` `main`'s HEAD is unchanged (confirmed 2026-07-23: still `8e92aae1794c4f02a2405eb88ea72f251b077f0c`, same commit Story 1.3/1.4 built against — no `Cargo.toml` edit needed for it).
  - [ ] `cargo build --manifest-path agent/src-tauri/Cargo.toml` succeeds with the new dependency; `Cargo.lock` regenerates for `lofty` + its transitive deps (`byteorder`, `data-encoding`, `ogg_pager`, `paste`, `lofty_attr`, `log` — all pure-Rust, no new system package needed, unlike `rusqlite`'s `bundled` C compile in Story 1.4).

- [ ] **Task 2 — Implement the embedded-tag fallback module's public surface** (AC: 1, 2, 3)
  - [ ] Create `agent/src-tauri/src/joiner/embedded_tags.rs`, registered via `pub mod embedded_tags;` in `agent/src-tauri/src/joiner/mod.rs` (sibling to `legacy`/`serato4`, same flat-file-per-concern convention — no subdirectory).
  - [ ] Public function: `pub fn fill_gaps(metadata: JoinedMetadata, path: Option<&str>) -> JoinedMetadata`. Takes the `JoinedMetadata` produced by Story 1.4's `legacy::join()`/`serato4::join_session()` (or `JoinedMetadata::default()` for a fully off-library play) plus the play's path (`play.path.as_deref()`), and returns a copy with any `None` field filled from embedded tags where possible. **Never touches `in_library`** — that flag describes library membership (Story 1.4's concern), not field completeness; this function only ever changes `bpm`/`key`/`genre`, and only when they arrive `None`.
  - [ ] **Skip all file I/O if nothing is missing**: if `metadata.bpm`, `.key`, and `.genre` are all already `Some`, return `metadata` unchanged immediately — don't open a file just to discard the result. Same if `path` is `None` (an off-library play with no path can't be read from either, exactly like Story 1.4's `legacy::join`'s `play.path.is_none()` short-circuit).
  - [ ] **Infallible by design — no `Result`, no new error enum.** Unlike `parser::ParseError`/`joiner::legacy::JoinError` (which surface a hard failure reading the DJ's *one* Serato library file, where a permission error is UI-actionable), this function reads an arbitrary, possibly-missing, possibly-corrupt file *per off-library track* — a missing file, an unsupported format, a malformed tag, or a permission error are all just "no data from this source," exactly the same "absent, never guessed" case AD-11 already defines for a gap in the library join. Silently returning the input unchanged (fields stay `None`) on any failure is correct, not a shortcut — do not wrap this in `Result` to "handle" errors that have no different valid response than degrading gracefully.
  - [ ] Reuse `super::sane_bpm` and `super::non_empty` from `joiner/mod.rs` for the same normalization Story 1.4 established (BPM must be finite and positive; text fields must be non-empty) — **do not reinvent these checks locally.** Both are already visible to this module: they're private (non-`pub`) but declared in the *parent* `joiner` module, and Rust's privacy model makes a private item visible to its defining module and all descendants — `joiner::legacy` and `joiner::serato4` already import them this same way (`use super::{non_empty, sane_bpm, JoinedMetadata};`); no visibility change to `joiner/mod.rs` is needed or wanted.
  - [ ] **Update the stale module doc comment.** `agent/src-tauri/src/joiner/mod.rs`'s module doc currently says (from Story 1.4): *"What this filter deliberately does not do: read embedded file tags (Story 1.5)..."* and *"Two library formats, two submodules, one output type."* Both lines are now wrong — this story is exactly what that line disclaimed. Update the doc comment to describe all three submodules (`legacy`, `serato4`, `embedded_tags`) and remove the now-false "does not read embedded tags" claim. This is a real file this story modifies, not just adds to.

- [ ] **Task 3 — ID3 path: MP3/WAV/AIFF via the `id3` crate** (AC: 1)
  - [ ] Read the tag with `id3::Tag::read_from_path(path)` — this single entry point auto-detects MP3/WAV/AIFF by header magic (the deprecated `read_from_wav_path` is not needed). Map every `id3::Error` to "no data" (see Task 2 — infallible, not `Result`): `ErrorKind::NoTag` (file has no ID3 tag), `ErrorKind::Io` (unreadable/missing file), and any other `ErrorKind` all resolve to "this source has nothing," not a crash and not a distinguished code path.
  - [ ] **Key** (`TKEY`): `id3` has no dedicated helper (unlike genre — see below). Use `tag.get("TKEY")`, then `frame.content().text()` (returns `Option<&str>`) to extract the raw string. Route through `non_empty`.
  - [ ] **Genre** (`TCON`): use `tag.genre()` (the crate's dedicated raw-TCON helper) — **not** `.genre_parsed()`. `.genre_parsed()` would translate a legacy numeric ID3v1 genre reference (e.g. `"(17)"`) to a name (`"Rock"`) — that is genre *interpretation*, which is explicitly Story 1.6's job (edge genre normalization, versioned), not this story's. Taking the raw value here keeps this story symmetric with Story 1.4's library-join genre, which is also stored raw. Route through `non_empty`.
  - [ ] **BPM** (Serato Autotags GEOB): iterate `tag.encapsulated_objects()` (an `Iterator<Item = &id3::frame::EncapsulatedObject>`, fields `mime_type`/`filename`/`description`/`data: Vec<u8>`), find the one whose `description` equals `triseratops::tag::Autotags::ID3_TAG` (a `&'static str` constant equal to `"Serato Autotags"` — use the constant, never hardcode the literal string, in case a future `triseratops` update changes it). Call `triseratops::tag::Autotags::parse_id3(&obj.data)` (needs `use triseratops::tag::format::id3::ID3Tag;` in scope for the trait method, exactly like the crate's own doc example) — on `Ok`, take `.bpm` through `sane_bpm`; on `Err` or no matching GEOB frame, leave `bpm: None`. **This is a raw binary read, not base64** — unlike the FLAC path (Task 4), `id3::ID3Tag::parse_id3` is a direct pass-through to `Autotags::parse` (confirmed by reading the vendored `triseratops` source at `~/.cargo/git/checkouts/triseratops-*/8e92aae/src/tag/format/id3.rs`); do not add a base64-decode step here — that would corrupt a well-formed GEOB frame.

- [ ] **Task 4 — Vorbis-comment path: FLAC and OGG Vorbis via `lofty`** (AC: 1)
  - [ ] Open the file with `lofty::probe::Probe::open(path)?.read()` (format auto-detected from content, not just extension) to get a `TaggedFile`, then obtain its Vorbis comments (check the exact accessor against `lofty` `0.24.0`'s docs at implementation time — e.g. via the primary/first tag converted to `lofty::ogg::VorbisComments`, or a FLAC/OGG-specific accessor if `0.24.0` exposes one directly; this story's research did not pin down the exact conversion call, only that `VorbisComments::get(&self, key: &str) -> Option<&str>` and `::get_all`/`::items()` exist for raw field access — confirm the from-`TaggedFile` path against current docs, don't guess a signature that doesn't compile).
  - [ ] **Key and genre**: read raw Vorbis-comment fields by key, exactly like the ID3 path reads raw frames — **do not** go through `lofty`'s cross-format `ItemKey`/generic `Tag` translation layer for these two fields; use `VorbisComments::get("GENRE")` / `VorbisComments::get("KEY")` directly, matching this story's "raw values only" convention (Task 3, Story 1.4). **[ASSUMPTION]** `"KEY"` is the field name assumed for musical key — Vorbis comments have no ratified standard field for it (unlike `GENRE`, which is a defined field in the Vorbis comment spec), and no real FLAC/OGG file has ever been inspected in this project (see Dev Notes → no real FLAC/OGG evidence). Flagged in Open Questions; do not spend implementation time trying alternate field names speculatively — ship the one confirmed-plausible default and let real-data testing (Story 1.9, or an ad hoc check against one of Arjun's own FLAC files if convenient) confirm or correct it.
  - [ ] **BPM (FLAC only)**: read the raw `"SERATO_AUTOGAIN"` Vorbis-comment field as bytes (`VorbisComments::get("SERATO_AUTOGAIN")`, then `.as_bytes()`), and call `triseratops::tag::Autotags::parse_flac(bytes)` (needs `use triseratops::tag::format::flac::FLACTag;` in scope). **This one *is* base64-enveloped** — unlike the ID3 GEOB path, `FLACTag::parse_flac` internally base64-decodes and strips an `application/octet-stream\0\0<name>\0` envelope before parsing (confirmed by reading `~/.cargo/git/checkouts/triseratops-*/8e92aae/src/tag/format/enveloped.rs`) — pass the raw comment-field string bytes straight through; do not pre-decode base64 yourself, `parse_flac` already does it.
  - [ ] **BPM (OGG Vorbis): explicitly out of scope, not attempted.** The pinned `triseratops` commit's `Autotags` implements `id3::ID3Tag`, `flac::FLACTag`, and `mp4::MP4Tag` — **but not `ogg::OggTag`** (confirmed by reading `~/.cargo/git/checkouts/triseratops-*/8e92aae/src/tag/autotags.rs`'s trait-impl list). There is no `parse_ogg` for `Autotags` in this dependency. Reverse-engineering Serato's OGG-Vorbis Autotags encoding from scratch (format undocumented anywhere this research found, and zero real OGG files have ever been seen in this project's corpus — Story 1.2's spike saw none) would be exactly the kind of unevidenced guess AD-11 forbids. Leave `bpm: None` unconditionally for `.ogg` files; genre/key still read normally via the shared Vorbis-comment path above (those aren't gated on `triseratops`). Logged in Open Questions, not silently dropped.
  - [ ] Map every `lofty` error (unsupported/unrecognized file, IO failure, malformed tag block) to "no data," identically to the ID3 path's error handling in Task 3 — same infallible contract.

- [ ] **Task 5 — Unit tests: synthetic fixtures only, split IO from pure logic** (AC: 1, 2, 3)
  - [ ] Do not commit real audio files or real tag data — same policy as every prior story (golden-file fixtures are Story 1.9's job). **Mirror `joiner::legacy`'s own split** (`load()` vs. `from_database_bytes()`): write the field-extraction logic as pure functions taking an already-parsed `id3::Tag` / `lofty::ogg::VorbisComments` value, and keep the "open this path" step as a thin, separately-obvious wrapper. This makes the extraction logic testable without ever touching a real filesystem path, and isolates the one part of this story with real IO-shaped risk (see Dev Notes → WAV embedded-tag readability).
  - [ ] **ID3 fixtures**: build synthetic tags **using the `id3` crate's own writer** (`id3::Tag::new()`, `.set_genre(...)`, `.add_frame(Frame::text("TKEY", "8A"))`, `.add_frame(Frame::with_content(...))` for the GEOB frame, then `.write_to_path(tmp_path, id3::Version::Id3v24)`), then read it back — a round-trip test, not hand-rolled bytes. This is the practical way to get a valid ID3 fixture (unlike `.session`'s custom binary format in Story 1.3, there's no reason to hand-roll ID3 framing when the same crate you're testing against can write it). Cover: (a) all three fields present and resolvable; (b) `TKEY`/`TCON` frames absent → `key`/`genre` stay `None`, no panic; (c) no GEOB frame at all → `bpm: None`; (d) a GEOB frame present but with a different `description` (not `"Serato Autotags"`) → ignored, `bpm: None`; (e) a `TCON` value that is a legacy numeric form (e.g. `"(17)"`) → stored as-is, unparsed/uninterpreted (proves the "raw, not `.genre_parsed()`" decision); (f) a file with **no ID3 tag at all** → all three fields `None`, no panic (`ErrorKind::NoTag` handled).
  - [ ] **Vorbis-comment fixtures**: construct a `lofty::ogg::VorbisComments` value directly in-test (no file IO needed for the pure-logic tests) and test the extraction function against it directly: (a) `GENRE`/`KEY`/`SERATO_AUTOGAIN` all present → all three resolved; (b) `SERATO_AUTOGAIN` absent → `bpm: None`; (c) empty-string `GENRE`/`KEY` → `None` via `non_empty`, not `Some("")`. Add one thin IO-path test (real temp file via `lofty`'s own writer, if `0.24.0` exposes one, else skip and note why) to prove the path-opening wrapper actually calls the pure function correctly — don't over-invest in this half, the pure-logic tests carry the real coverage.
  - [ ] **`fill_gaps` orchestration tests** (the function that ties Tasks 2-4 together): (a) all three fields already `Some` → returns input unchanged, and (assert via a call-counting or panic-if-called stub, or simply by pointing `path` at a file that does not exist) confirms no file was opened; (b) `path: None` → returns input unchanged; (c) a `.mp3` extension routes to the ID3 path, `.flac`/`.ogg` routes to the Vorbis path — probe-based dispatch (Task 4), not a naive extension-string match, so a misnamed/no-extension file still gets a real attempt via content sniffing where the underlying crate supports it; (d) partial gaps — e.g. `key: Some(_)` already resolved (say, from a Serato 4+ row per Story 1.4), `bpm`/`genre` both `None` — only the `None` fields get filled, the pre-existing `Some("...")` is never overwritten even if the embedded tag disagrees. **This last case is the one Story 1.4's AC-4 exists for and must have an explicit test** — a field that already has a value from the library must never be clobbered by this story's fallback.
  - [ ] Full crate gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path agent/src-tauri/Cargo.toml`.

- [ ] **Task 6 — Confirm the existing CI gate covers this without changes** (AC: all)
  - [ ] `lofty`'s dependency tree (with default features disabled per Task 1) is pure Rust — `byteorder`, `data-encoding`, `ogg_pager`, `paste`, `lofty_attr`, `log` — none need a system C toolchain the way `rusqlite`'s `bundled` feature did in Story 1.4, so `.github/workflows/ci.yml`'s existing Linux job should need no new system package. Verify the CI build actually succeeds; if it doesn't, that's new information about a transitive dependency, not a reason to add a workaround speculatively.
  - [ ] No `.github/workflows/ci.yml` changes should be needed otherwise — same reasoning as Stories 1.3/1.4 (this module lives inside the same already-gated `agent/src-tauri` crate).

## Dev Notes

### This story's real risk is WAV, not FLAC/OGG — read this before prioritizing

Two very different confidence levels sit inside this one story, and Task order should reflect that:

- **The ID3 path (Task 3) is the one with real-world evidence behind it.** Story 1.2's spike found off-library plays are **not** a rare case — 100% of two real sampled sessions were off-library — and the one concrete off-library file sampled was a real `.wav`. `id3::Tag::read_from_path` documents WAV support (RIFF-embedded ID3 chunk, auto-detected by header magic), but **whether this specific DJ's WAV files actually carry a readable ID3 tag with `TKEY`/`TCON`/a Serato Autotags GEOB frame was never confirmed** — the addendum (`prds/prd-name-pending-2026-07-19/addendum.md`) flags this explicitly: *"WAV is not listed as a confirmed-supported embedded-tag format... needs direct verification during parser implementation of whether WAV embedded tags (if any) are readable."* This is the one piece of this story worth spending real verification effort on, not a hypothetical.
- **The Vorbis-comment path (Task 4) has zero real-data evidence at all.** No FLAC or OGG file has been observed anywhere in this project's real corpus (Story 1.2's spike inventoried the actual library and sampled WAV, not FLAC/OGG). FR-2 and its AC still name Vorbis explicitly as a committed Phase-1 requirement (not speculative future-proofing — it's in the accepted PRD/epics text), so this story implements it against the documented Vorbis-comment spec and `triseratops`'s confirmed FLAC support, but every field-name/behavior choice in Task 4 is flagged `[ASSUMPTION]` for the same reason Story 1.4 flagged its unconfirmed volume-hosted-path and Unicode-normalization behaviors: implemented to spec, not yet checked against a real file. Acceptable to merge on synthetic tests alone (matches the "real-corpus validation gap, by design, until Story 1.9" precedent already established by Stories 1.3/1.4) — do not block on finding a real FLAC/OGG file.

### `triseratops` does double duty here — reuse it, don't reimplement GEOB/Vorbis-comment binary parsing

The pinned `triseratops` commit (`8e92aae1`, unchanged since Story 1.3) already ships a `tag::autotags::Autotags` struct purpose-built for exactly this story's BPM extraction — for **both** the ID3-GEOB encoding (Task 3) and the FLAC Vorbis-comment encoding (Task 4), via two different trait methods on the same `Autotags` type:

```rust
use triseratops::tag::{Autotags, format::id3::ID3Tag};   // MP3/WAV/AIFF (Task 3)
let content = Autotags::parse_id3(geob_frame_data)?;      // raw pass-through, no base64

use triseratops::tag::{Autotags, format::flac::FLACTag}; // FLAC (Task 4)
let content = Autotags::parse_flac(vorbis_comment_bytes)?; // base64+envelope-decodes internally
```

Both were confirmed by reading the vendored source directly (`~/.cargo/git/checkouts/triseratops-ee7e6e7c7e0bdffe/8e92aae/src/tag/{autotags,format/id3,format/enveloped}.rs`), not inferred from documentation alone — this is the same "read the actual pinned source before writing the code that depends on a specific behavior" discipline Story 1.4 used for the `Track`-drops-BPM finding. **Do not hand-roll GEOB or Vorbis-comment-envelope byte parsing** — that would duplicate a decode `triseratops` already ships and is exactly the "reinventing wheels" mistake this workflow exists to prevent. The `id3`/`lofty` crates' job in this story is narrower than it might first look: get the raw frame/field bytes off disk; `triseratops::tag::Autotags` does the Serato-specific decode.

### Why `lofty` and not `metaflac`

FR-2's AC names Vorbis comments for **both** FLAC and OGG (`key from ID3 TKEY (or Vorbis), genre from ID3 TCON (or Vorbis)`, epics.md Story 1.5 AC-1). `metaflac` (the other candidate researched, latest `0.2.8`, 2025-01-25) only covers FLAC — it has no OGG container support at all, which would leave half of the AC's named formats unimplemented. `lofty` (latest non-yanked `0.24.0`, confirmed 2026-04-12) covers both FLAC and OGG Vorbis under one crate with a unified raw-field accessor (`VorbisComments::get`), so it was chosen as the single new dependency for this concern — mirroring how Story 1.4 picked `rusqlite` specifically for `master.sqlite` rather than a heavier ORM. This is a new architectural fact this story establishes (AR-5/AD-11 name `id3` for embedded tags but are silent on a specific Vorbis crate) — worth a one-line mention in whichever future architecture-sync pass reconciles implementation decisions back into the spine (same "doc-sync debt" pattern already tracked for other stories), not a blocker for this one.

### Architecture citations

- **AD-11**: two-path parser/joiner; "off-library tracks fall back to embedded tags, then to a visible 'Unknown'" — this story is that fallback step. `id3` is the crate AD-11 already names; `lofty` is this story's own addition for the Vorbis half AD-11's prose implies but doesn't name a crate for.
- **AR-5**: FR-2's testable consequences — in-library resolves from the library (1.4, done); off-library falls back to embedded tags (this story); neither source present → "Unknown" (display concern, Epic 3/stat engine — not built by this story).
- **Consistency Conventions table** (ARCHITECTURE-SPINE.md): "Unknown data... carries the `in_library` flag — never omitted, never guessed." This story never sets or reads `in_library` — it only ever narrows `None` fields, which is what keeps that convention intact end to end.

### Previous story intelligence (1.4)

- `joiner::JoinedMetadata` (Story 1.4, frozen fields, do not change its shape) is both this story's input and output type. Every field independently `Option` is exactly what lets this story's fallback and Story 1.4's library join compose without either one needing to know about the other's internals.
- `joiner::mod.rs`'s `sane_bpm`/`non_empty` helpers are this story's to reuse, not reimplement (see Task 2). Their semantics (BPM must be finite+positive; empty string ≠ a real value) apply identically to embedded-tag data — Serato's own Autotags BPM field can be `0` for an unanalysed track exactly like the library-DB BPM field can.
- `joiner::legacy`'s `load()`/`from_database_bytes()` split (disk IO vs. pure decode, independently testable) is the pattern Task 5 asks this story to mirror for the same reason: the pure logic is cheap and valuable to test exhaustively; the file-open wrapper is thin and shouldn't need many cases.
- `parser::Play.path: Option<String>` (Story 1.3, frozen) is this story's input for "which file to read tags from" — this story does not modify `parser::` at all.
- Established idioms to keep following: no `.unwrap()`/`.expect()` anywhere on this path (Stories 1.1/1.3/1.4's bar); raw values only, no normalization/interpretation of genre or key (Story 1.4, this story, both explicitly deferred to Story 1.6 for genre — key has no normalization story at all, Camelot conversion if ever needed is stat-engine/Story 1.7 territory, not this one).

### Git intelligence

Recent shape (`c62b336`→`4211dcd`→`6b80710`→`3091a6b`→`5e78510`→`eac8e9d`→`4570227`→`f3c342d`→`b88a0df`): spec commit, implementation commit, code-review commit (sometimes a second review pass), each story a clean sequence. Expect the same three-commit shape here. Story 1.3b (most recent) additionally shows real-data findings feeding back into `deferred-work.md` even for a *different* story's code (`joiner::serato4::join_session`) — if this story's implementation surfaces a real WAV/FLAC file worth checking by hand, log the finding there too, following that same precedent, rather than only in this story's own Dev Agent Record (story files get archived; `deferred-work.md` is the durable home for cross-story-relevant findings, per Story 1.4's own RF-4 review correction).

### Project Structure Notes

- New: `agent/src-tauri/src/joiner/embedded_tags.rs`.
- Modified: `agent/src-tauri/src/joiner/mod.rs` (add `pub mod embedded_tags;`, fix the now-stale "does not read embedded tags" / "two submodules" doc-comment lines — see Task 2), `agent/src-tauri/Cargo.toml` (add `lofty`, default features disabled).
- Untouched: `agent/src-tauri/src/joiner/legacy.rs`, `agent/src-tauri/src/joiner/serato4.rs` (Story 1.4, frozen — this story only *consumes* `JoinedMetadata`, never edits how it's produced), `agent/src-tauri/src/parser/` (Story 1.3/1.3b, frozen), `shared/`, `web/`, `.github/workflows/ci.yml` (no changes expected, see Task 6).

### Testing standards

Same bar as Stories 1.3/1.4: synthetic in-test fixtures only (built via the `id3`/`lofty` crates' own writers where practical, never hand-rolled binary unless a crate genuinely offers no write path), no committed real audio/tag data, full crate gate (`fmt --check`, `clippy --all-targets -D warnings`, `build`, `test`) stays green. This story's FLAC/OGG coverage is against the documented Vorbis-comment spec and `triseratops`'s confirmed FLAC support, not an independently re-confirmed real file — same "acceptable to merge on synthetic tests, real-file confirmation open" standing precedent as Story 1.4's Serato 4+ schema.

### Latest tech / versions (re-verified 2026-07-23, the day this story was written — re-check immediately before implementing per this project's own established discipline)

- **`lofty`**: latest non-yanked is `0.24.0` (published 2026-04-12). **`0.23.0`, `0.23.1`, `0.23.2`, `0.23.3` are all yanked** — if a re-check at implementation time shows a newer version, prefer it, but do not silently accept a yanked one if dependency resolution ever surfaces one transitively.
- **`id3`**: `1.17.0`, not yanked — unchanged since Story 1.3/1.4.
- **`triseratops`**: `main`'s HEAD is still `8e92aae1794c4f02a2405eb88ea72f251b077f0c` — unchanged since Story 1.3. Re-verify once more immediately before implementation (`git ls-remote https://github.com/Holzhaus/triseratops.git main`), same discipline as every prior story.

### References

- [epics.md — Story 1.5 + Epic 1 design notes + FR-2](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-11, Consistency Conventions](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [prds/prd-name-pending-2026-07-19/addendum.md — WAV embedded-tag readability flagged unconfirmed](../planning-artifacts/prds/prd-name-pending-2026-07-19/addendum.md)
- [1-4-library-join-for-in-library-enrichment.md — previous story; `JoinedMetadata`/`sane_bpm`/`non_empty` are this story's direct inputs](./1-4-library-join-for-in-library-enrichment.md)
- [1-2-parser-validation-spike-findings.md — §5/D3: off-library is routine not rare; the one real off-library play was a `.wav`](./1-2-parser-validation-spike-findings.md)
- [agent/src-tauri/src/joiner/mod.rs — `JoinedMetadata`, `sane_bpm`, `non_empty`, and the stale doc comment this story must fix](../../agent/src-tauri/src/joiner/mod.rs)
- [agent/src-tauri/src/joiner/legacy.rs — `load()`/`from_database_bytes()` IO-vs-pure split to mirror](../../agent/src-tauri/src/joiner/legacy.rs)
- [triseratops vendored source (pinned commit `8e92aae1`) — `src/tag/autotags.rs` (`Autotags`, `NAME`/`ID3_TAG`/`FLAC_COMMENT` constants), `src/tag/format/id3.rs` (`parse_id3` = raw pass-through), `src/tag/format/enveloped.rs` (`parse_flac`'s base64+envelope decode)](https://github.com/Holzhaus/triseratops)
- [id3 crate docs (1.17.0) — `Tag::read_from_path`, `Tag::encapsulated_objects`, `Tag::genre`, `Content::text`](https://docs.rs/id3/1.17.0/id3/)
- [lofty crate docs (0.24.0) — `Probe::open`, `ogg::VorbisComments::get`/`get_all`/`items`](https://docs.rs/lofty/0.24.0/lofty/)

## Open Questions / Assumptions
*(None block starting the story — reasonable defaults chosen; flagged for Arjun's confirmation before/during implementation.)*

1. **[CARRIED FROM PRD ADDENDUM] WAV embedded-tag readability is unconfirmed against this DJ's real files.** The one real off-library play Story 1.2's spike sampled was a `.wav`, and whether it (or WAV files generally, for this DJ) carries a readable ID3 chunk with `TKEY`/`TCON`/a Serato Autotags GEOB frame was never checked — only that the track wasn't in the library DB. `id3::Tag::read_from_path` documents WAV support in general; this is about *this DJ's actual files*, not the crate's capability. Cheapest check: read the one known real off-library WAV file (`Club/ABBA - GIMME GIMME GIMME (...).wav` on the USB SSSD, per Story 1.2 findings §5/D2 — read-only, never committed as a fixture) by hand during implementation or Story 1.9's fixture work.
2. **[ASSUMPTION] Vorbis-comment field name for musical key is `"KEY"`.** No ratified Vorbis-comment standard exists for it (unlike `GENRE`). No real FLAC/OGG file has ever been inspected in this project. Confirm against a real file if one becomes conveniently available; not worth blocking on.
3. **[ASSUMPTION, scoped out deliberately] OGG Vorbis BPM is not resolved by this story.** The pinned `triseratops` commit's `Autotags` has no `OggTag` impl (confirmed by reading the vendored source) — no `parse_ogg` exists to call. Genre/key still resolve normally for `.ogg` files (those don't depend on `triseratops`); BPM stays `None` for that one format/field combination until either `triseratops` adds OGG Autotags support upstream or a future story reverse-engineers it against real evidence.
4. **[NOTE, not a task] `lofty`'s exact `TaggedFile` → `VorbisComments` accessor was not pinned down during story creation** (Task 4) — the crate's raw-field API (`VorbisComments::get`/`get_all`/`items`) was confirmed directly against `0.24.0`'s docs, but the specific call to obtain a `&VorbisComments` from a freshly-probed `TaggedFile` was not. Confirm against `docs.rs/lofty/0.24.0` at implementation time rather than guessing a method name that may not compile.
5. **[NOTE, not a task] Legacy numeric `TCON` values (e.g. `"(17)"`) are stored raw, uninterpreted.** This is a deliberate scope boundary (genre interpretation is Story 1.6's job), not an oversight — flagging so it isn't mistaken for a bug during review.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
