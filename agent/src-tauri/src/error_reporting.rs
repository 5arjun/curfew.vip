//! Agent-side tagged error reporting (Story 3.4, Task 1, AD-13/AR-7 layer 2):
//! the second of format-drift's three defense layers — golden-file CI (layer
//! 1) only catches drift *before* release, this layer is what makes drift
//! that only appears on a real DJ's machine ever visible at all.
//!
//! [`ErrorReporter`] mirrors `auth::client::AuthClient`/`sync::SyncClient`'s
//! existing trait-injection pattern (this crate's established way to keep a
//! network-calling side effect unit-testable without a mocking framework).
//! [`SentryReporter`] is the only production implementation — no fake is
//! ever wired into a real call site, only into tests (`watcher::mod`'s
//! terminal-failure branches, Task 2).

/// Reports one error, tagged with the context it occurred in and the
/// running build's version (AD-3's "every payload carries `agent_version`",
/// applied here to the local error-reporting surface — see the story's own
/// Dev Notes for why the *cloud sync payload* gap is explicitly out of
/// scope).
pub trait ErrorReporter: Send + Sync {
    fn report(&self, context: &str, agent_version: &str, message: &str);
}

/// The real implementation: reports to Sentry via the `sentry` crate. A
/// stateless unit struct — reads [`crate::config::SENTRY_DSN`] internally on
/// every call rather than taking a constructor argument, so every call site
/// can construct it as a bare literal (`&SentryReporter`) with no DI wiring
/// beyond the function signature itself.
pub struct SentryReporter;

impl ErrorReporter for SentryReporter {
    fn report(&self, context: &str, agent_version: &str, message: &str) {
        // No DSN provisioned yet (Arjun's pending setup step, see
        // `config.rs`) — no-op rather than attempt a call `sentry::init`
        // was never given a real client for.
        if crate::config::SENTRY_DSN.is_empty() {
            return;
        }
        sentry::configure_scope(|scope| {
            scope.set_tag("agent_version", agent_version);
            scope.set_tag("context", context);
        });
        sentry::capture_message(message, sentry::Level::Error);
    }
}

/// Initializes the global Sentry client for this process, if a DSN has been
/// provisioned. Returns `None` (nothing to hold) when [`crate::config::SENTRY_DSN`]
/// is empty. The returned guard must be kept alive for the process's whole
/// lifetime — binding it to a local at the top of `lib.rs`'s `run()` is
/// sufficient, since `run()` blocks until the app exits.
pub fn init() -> Option<sentry::ClientInitGuard> {
    if crate::config::SENTRY_DSN.is_empty() {
        return None;
    }
    Some(sentry::init((
        crate::config::SENTRY_DSN,
        sentry::ClientOptions::new().release(crate::config::AGENT_VERSION),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Test double mirroring `auth::client::FakeAuthClient`'s existing
    /// pattern — records every call rather than making a real network
    /// request, so `watcher::mod`'s terminal-failure tests (Task 2) never
    /// depend on `config::SENTRY_DSN`'s build-time value.
    #[derive(Default)]
    pub struct RecordingReporter {
        pub calls: Mutex<Vec<(String, String, String)>>,
    }

    impl ErrorReporter for RecordingReporter {
        fn report(&self, context: &str, agent_version: &str, message: &str) {
            self.calls
                .lock()
                .expect("recording reporter mutex poisoned")
                .push((
                    context.to_string(),
                    agent_version.to_string(),
                    message.to_string(),
                ));
        }
    }

    #[test]
    fn recording_reporter_captures_context_version_and_message() {
        let reporter = RecordingReporter::default();
        reporter.report("serato4 capture", "0.1.0", "parse failed: bad magic bytes");

        let calls = reporter.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            (
                "serato4 capture".to_string(),
                "0.1.0".to_string(),
                "parse failed: bad magic bytes".to_string()
            )
        );
    }

    /// `SentryReporter::report` must never panic, regardless of whether this
    /// build carries a real DSN — `config::SENTRY_DSN` reflects whatever
    /// `.env.local`/CI secret was present at compile time, which can differ
    /// between CI and a developer's local machine (a developer may have a
    /// real DSN configured locally for manual verification). This never
    /// attempts a real network call in a test binary either way: no Sentry
    /// client is ever initialized during `cargo test` (`sentry::init()` is
    /// only called from `lib.rs`'s `run()`), so `capture_message` is a no-op
    /// against an unconfigured Hub even when the DSN itself is non-empty.
    #[test]
    fn sentry_reporter_report_never_panics() {
        SentryReporter.report("test context", "0.0.0", "test message");
    }

    /// Only asserts the empty-DSN branch when this build actually has an
    /// empty DSN (the CI/no-`.env.local` case). Deliberately does **not**
    /// call `init()` when a real DSN is present — that would spin up a real
    /// Sentry client/background transport thread as a side effect of
    /// running the test suite, which this crate's tests must never do.
    #[test]
    fn init_returns_none_when_dsn_is_empty() {
        if crate::config::SENTRY_DSN.is_empty() {
            assert!(init().is_none());
        }
    }
}
