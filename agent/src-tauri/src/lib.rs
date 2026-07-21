//! Curfew local agent — Tauri 2 core.
//!
//! Architecture (ARCHITECTURE-SPINE / SOLUTION-DESIGN §2): this core is a
//! pipes-and-filters pipeline —
//!   watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue
//! each an independently testable filter with a typed hand-off. Those filters
//! land in Stories 1.3-1.7; this story only proves the shell compiles and that
//! the Rust side can consume the shared sync contract (AC-2).
//!
//! Dependency rule (AD-3): `agent` depends on `shared` (via the JSON-schema
//! artifact), never on `web`.

use std::path::PathBuf;

/// Location of the language-neutral sync-contract schema the agent consumes,
/// relative to this crate's manifest dir (`agent/src-tauri`). Rust cannot import
/// the TypeScript type in `@curfew/shared`, so the checked-in JSON-schema file is
/// the seam. DRAFT until Story 1.10 (AR-1).
pub const SYNC_PAYLOAD_SCHEMA_RELPATH: &str = "../../shared/schema/sync-payload.schema.json";

/// Absolute path to the shared sync-contract schema, resolved from this crate.
pub fn sync_payload_schema_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(SYNC_PAYLOAD_SCHEMA_RELPATH)
}

/// Load and parse the shared sync-contract schema. Proves Rust-side consumption
/// of the `@curfew/shared` contract (AC-2). Returns the parsed JSON document.
pub fn load_sync_payload_schema() -> serde_json::Value {
    let path = sync_payload_schema_path();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read shared schema at {}: {e}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("shared schema at {} is not valid JSON: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-2 (Rust side): the agent can load the shared JSON-schema and it carries
    /// the contract version + the AR-15 fixed enums, matching `@curfew/shared`.
    #[test]
    fn parses_shared_sync_contract_schema() {
        let schema = load_sync_payload_schema();

        assert_eq!(
            schema["properties"]["contract_version"]["const"], 1,
            "contract_version const must match CONTRACT_VERSION in @curfew/shared"
        );
        assert_eq!(
            schema["properties"]["source"]["enum"],
            serde_json::json!(["serato"]),
            "source enum drifted from @curfew/shared"
        );
        assert_eq!(
            schema["properties"]["set"]["properties"]["visibility"]["enum"],
            serde_json::json!(["public", "friends_only", "private"]),
            "visibility enum drifted from @curfew/shared"
        );
        assert_eq!(
            schema["$defs"]["segment"]["properties"]["type"]["enum"],
            serde_json::json!(["dancefloor", "dinner", "performance", "custom"]),
            "segment type enum drifted from @curfew/shared"
        );
    }
}
