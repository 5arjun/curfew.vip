# THROWAWAY SPIKE — Story 1.2

Do not extend. The production parser was written fresh in Stories 1.3+ and lives
in `agent/src-tauri/src/parser/`.

This crate validated the candidate `.session` / `master.sqlite` parsing
approaches against real Serato data before Story 1.3 committed to a clean-room
parser and Story 1.10 froze the `shared/` contract. It is not a Cargo workspace
member, is never compiled into `agent_lib`, and is not referenced by
`.github/workflows/ci.yml` (CI's `agent` job targets `agent/src-tauri/Cargo.toml`
explicitly).

## Why it is still here

It is the provenance for two decisions the production code still rests on, both
of which cite this crate directly:

- `parser/session.rs` cites `src/main.rs:370` — this crate's ground-truth
  harness sorted by start time before matching 151/151 and 253/253 positions
  against `master.sqlite`. Raw file order was never itself validated.
- `parser/serato4.rs` names `src/serato4.rs`'s `list_sessions`/`get_session` as
  what its `history_session` queries were ported from.

Delete this crate and those comments point at nothing.

## Running it

```
cargo run --manifest-path agent/spike-1-2-parser-validation/Cargo.toml
```

Findings are written to
`_bmad-output/implementation-artifacts/1-2-parser-validation-spike-findings.md`,
not to this crate. `target/` here is untracked build output (~200 MB) and is
safe to delete.
