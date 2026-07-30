//! Secure refresh-token persistence (Story 2.10, Task 4, AD-10). Only the
//! refresh token is ever persisted here — the access token (short-lived JWT)
//! lives in memory only ([`super::AuthState`]), never written to disk in any
//! form.
//!
//! Not namespaced per-`dj_id`: Story 2.8's Dev Notes already established the
//! governing local invariant that there is only ever one DJ per agent
//! install, so one keychain entry is sufficient. The real per-`dj_id`
//! correctness boundary is enforced server-side by Supabase RLS on every sync
//! call, not by anything this local store does.

use std::sync::Mutex;

/// Keychain/Credential-Manager/Secret-Service service name, matching
/// `tauri.conf.json`'s `identifier`.
const SERVICE_NAME: &str = "app.curfew.agent";
/// The single entry's "username" slot — there is only one DJ per agent
/// install, so this is a fixed label, not a per-DJ key.
const ACCOUNT_NAME: &str = "refresh_token";

#[derive(Debug)]
pub enum TokenStoreError {
    Keyring(keyring::Error),
}

impl std::fmt::Display for TokenStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenStoreError::Keyring(e) => write!(f, "secure token storage error: {e}"),
        }
    }
}

impl std::error::Error for TokenStoreError {}

/// Wraps whichever OS-native secure storage backs the refresh token —
/// mirrors `watcher::detect.rs`'s `DiskSource` trait-injection pattern so
/// tests never touch a real keychain/Secret Service (CI runners commonly lack
/// one).
pub trait TokenStore {
    fn save(&self, refresh_token: &str) -> Result<(), TokenStoreError>;
    fn load(&self) -> Result<Option<String>, TokenStoreError>;
    /// Not called by this story (no AC asks for "unlink"/sign-out) — the
    /// method exists so a future story can add that UI without touching this
    /// trait's shape.
    fn clear(&self) -> Result<(), TokenStoreError>;
}

/// The real, OS-backed token store (Task 4): `keyring::Entry` wrapping macOS
/// Keychain / Windows Credential Manager / Linux Secret Service.
pub struct KeyringTokenStore;

impl KeyringTokenStore {
    fn entry(&self) -> Result<keyring::Entry, TokenStoreError> {
        keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(TokenStoreError::Keyring)
    }
}

impl TokenStore for KeyringTokenStore {
    fn save(&self, refresh_token: &str) -> Result<(), TokenStoreError> {
        self.entry()?
            .set_password(refresh_token)
            .map_err(TokenStoreError::Keyring)
    }

    fn load(&self) -> Result<Option<String>, TokenStoreError> {
        match self.entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(TokenStoreError::Keyring(e)),
        }
    }

    fn clear(&self) -> Result<(), TokenStoreError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(TokenStoreError::Keyring(e)),
        }
    }
}

/// In-memory fake used by every test in this story — never exercises the
/// real OS keychain (CI runners commonly lack a keychain/Secret Service
/// daemon; this mirrors the "never touch a real external system in unit
/// tests" discipline already established for `DiskSource`/Serato-data tests
/// in this crate).
#[derive(Default)]
pub struct FakeTokenStore {
    slot: Mutex<Option<String>>,
}

impl TokenStore for FakeTokenStore {
    fn save(&self, refresh_token: &str) -> Result<(), TokenStoreError> {
        *self.slot.lock().expect("FakeTokenStore mutex poisoned") = Some(refresh_token.to_string());
        Ok(())
    }

    fn load(&self) -> Result<Option<String>, TokenStoreError> {
        Ok(self
            .slot
            .lock()
            .expect("FakeTokenStore mutex poisoned")
            .clone())
    }

    fn clear(&self) -> Result<(), TokenStoreError> {
        *self.slot.lock().expect("FakeTokenStore mutex poisoned") = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_on_a_never_saved_store_returns_ok_none_not_an_error() {
        let store = FakeTokenStore::default();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips() {
        let store = FakeTokenStore::default();
        store.save("rt-123").unwrap();
        assert_eq!(store.load().unwrap(), Some("rt-123".to_string()));
    }

    #[test]
    fn save_overwrites_a_previous_value() {
        let store = FakeTokenStore::default();
        store.save("rt-old").unwrap();
        store.save("rt-new").unwrap();
        assert_eq!(store.load().unwrap(), Some("rt-new".to_string()));
    }

    #[test]
    fn clear_empties_the_store() {
        let store = FakeTokenStore::default();
        store.save("rt-123").unwrap();
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn clear_on_an_already_empty_store_is_a_no_op_not_an_error() {
        let store = FakeTokenStore::default();
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }
}
