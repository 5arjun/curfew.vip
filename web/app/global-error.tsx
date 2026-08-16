"use client";

// Root error boundary. This is the only boundary that catches a crash in
// app/layout.tsx itself, which is why it renders its own <html>/<body>: when it
// runs, the root layout did not, so nothing else is on the page.
//
// It exists mainly so Sentry sees those crashes. Next.js catches a root-layout
// throw and swaps in a built-in fallback without re-throwing, so before this
// file the single worst class of failure — the one where a DJ sees nothing at
// all — was also the one class Sentry could not observe.
//
// Colors come from tokens via globals.css, not literals: web/app is covered by
// no-hardcoded-colors.test.ts, and that guard reads plain CSS color names too.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { geistMono, hankenGrotesk, inter } from "./fonts";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${inter.variable} ${geistMono.variable}`}>
      <body
        style={{
          background: "var(--color-background)",
          color: "var(--color-on-background)",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <main style={{ display: "grid", gap: "1rem", maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Something went sideways.
          </h1>
          <p style={{ color: "var(--color-on-surface-variant)", margin: 0, lineHeight: 1.6 }}>
            The page failed to load. Your sets and history are untouched — this is a display
            problem, not a data one.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "var(--color-primary)",
                color: "var(--color-on-primary)",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.6rem 1.1rem",
                font: "inherit",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                color: "var(--color-on-surface-variant)",
                alignSelf: "center",
                padding: "0.6rem 0",
              }}
            >
              Go home
            </a>
          </div>
          {/* The digest is the only handle support has to tie a DJ's report to
              the captured event — Next.js strips the real message in production
              builds, so without this the user has nothing to quote. */}
          {error.digest && (
            <p
              style={{
                color: "var(--color-outline)",
                fontFamily: "var(--font-geist-mono-var)",
                fontSize: "0.75rem",
                margin: 0,
              }}
            >
              {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
