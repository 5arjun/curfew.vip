# THROWAWAY SPIKE — Story 1.2

Do not extend; Stories 1.3–1.7 build the production parser fresh.

This crate is not a Cargo workspace member and is not referenced by
`.github/workflows/ci.yml` (CI's `agent` job targets `agent/src-tauri/Cargo.toml`
explicitly). It exists only to validate the candidate `.session`/`master.sqlite`
parsing approaches against real Serato data before Story 1.3 commits a production
clean-room parser and Story 1.10 freezes the `shared/` contract.

Run with:

```
cargo run --manifest-path agent/spike-1-2-parser-validation/Cargo.toml
```

Findings are written to
`_bmad-output/implementation-artifacts/1-2-parser-validation-spike-findings.md`,
not to this crate.
