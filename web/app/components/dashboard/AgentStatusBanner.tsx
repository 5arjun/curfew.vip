"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { agentStatusLine } from "@/app/(authenticated)/dashboard/status-copy";
import { fetchAgentStatusAction } from "@/app/(authenticated)/dashboard/status-actions";
import { resolveAgentStatus, type AgentStatusSnapshot } from "@/lib/sets/agentStatus";

// Agent-status region (Story 3.9, AC-2 — AD-20). The dashboard's honest answer
// to "are my sets actually making it to the cloud?", in console voice: a quiet
// inline line in the register of the post-delete note, never a toast, never a
// modal, never a red alert.
//
// It renders NOTHING far more often than it renders something — silence is the
// designed default (Idle, DriveNotConnected, no agent, and any stale/unknown
// heartbeat all resolve to nothing). That is the point: this region only ever
// speaks up when there is something true and useful to say.

/** How often to re-read while the tab is actually being looked at. */
const POLL_INTERVAL_MS = 60_000;

export function AgentStatusBanner({ initial }: { initial: AgentStatusSnapshot }) {
  // Seeded from the server's snapshot — row AND the clock it was read at — so
  // the first client render resolves to provably the same markup the server
  // produced. After mount this component owns the value; the server prop is
  // not re-read, because polling below is the update path.
  const [snapshot, setSnapshot] = useState<AgentStatusSnapshot>(initial);
  const reducedMotion = useReducedMotion();

  const refresh = useCallback(() => {
    // Fire-and-forget, exactly like the agent's own beat: a failed read leaves
    // the last known snapshot in place until the next tick, and the staleness
    // timer below still retires it on schedule. A status region must never be
    // able to throw its way onto a page whose real content is the DJ's sets.
    fetchAgentStatusAction()
      .then(setSnapshot)
      .catch(() => {});
  }, []);

  // Poll only while the tab is visible, and re-read the moment it becomes
  // visible again — the overwhelmingly common case is a DJ coming back to an
  // already-open tab, where the displayed state is exactly as old as the tab
  // has been backgrounded.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (timer === undefined) timer = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const resolved = resolveAgentStatus(snapshot.row, snapshot.readAtMs);

  // Retire a currently-fresh heartbeat exactly when it ages out, so a region
  // that was legitimately reporting goes quiet on time instead of sitting there
  // asserting a state nobody has confirmed in ten minutes. One self-cancelling
  // timeout — deliberately not a second poll loop. Re-stamping `readAtMs` is
  // all it takes: the same pure resolver then decides the row is stale.
  const staleAtMs = resolved?.staleAtMs;
  useEffect(() => {
    if (staleAtMs === undefined) return;
    // `max(0, …)` rather than an early setState: a zero-delay timeout still
    // fires asynchronously, which covers the page-restored-from-bfcache case
    // without a synchronous state write during the effect.
    const timer = setTimeout(
      () => setSnapshot((current) => ({ ...current, readAtMs: Date.now() })),
      Math.max(0, staleAtMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [staleAtMs]);

  const line = resolved ? agentStatusLine(resolved.state) : null;

  return (
    <MotionConfig reducedMotion="user">
      {/* `mode="wait"` so the outgoing line clears before the incoming one
          arrives: in normal flow, cross-fading two lines simultaneously would
          push the viewport-locked layout (D9) for the length of the fade. The
          resulting cross-dissolve-through-nothing is the calm reading anyway. */}
      <AnimatePresence mode="wait" initial={false}>
        {line && (
          <motion.p
            key={line.text}
            className={`dz-agent-status dz-agent-status--${line.tone}`}
            // role="status" (implicit aria-live="polite") so a state flip is
            // announced without stealing focus or interrupting — this region
            // must never behave like an alert.
            role="status"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            // A settle, not an entrance. 2px of travel is below the threshold
            // where motion reads as a slide, and both legs stay under the
            // ~200ms budget: this is the first live-updating element on any
            // logged-in surface and it must not announce itself like a toast.
            // Named properties only — never `transition: all`.
            transition={{
              duration: reducedMotion ? 0 : 0.18,
              ease: [0.4, 0, 0.2, 1],
              opacity: { duration: reducedMotion ? 0 : 0.18 },
            }}
          >
            {line.text}
          </motion.p>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
