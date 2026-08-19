"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useState } from "react";
import type { MostPlayedWindow } from "@/lib/sets/rightColumn";

// Most-played card (D10): ONE glass card — a small toggle in the corner drives
// BOTH rows (track + artist). Sparse windows show quiet em-dashes, no fake data
// (D13); copy stays history-as-asset, never nagging.
//
// The toggle counts SETS, not calendar days (2026-08-06 — see
// MOST_PLAYED_RECENT_SETS): a day-based window empties during any gap between
// bookings, which made the card crown a once-played track. Tabs are labelled
// from the counts the model actually read, and collapse to a single static
// label when both windows cover the same sets — two tabs reading "8 sets" and
// "8 sets" would be a choice that isn't one.
export function MostPlayedCard({
  recent,
  extended,
}: {
  recent: MostPlayedWindow;
  extended: MostPlayedWindow;
}) {
  const [win, setWin] = useState<"recent" | "extended">("recent");
  const sameSpan = recent.setCount === extended.setCount;
  const data = !sameSpan && win === "extended" ? extended : recent;
  const empty = !data.track && !data.artist;
  const label = (w: MostPlayedWindow) => `${w.setCount} ${w.setCount === 1 ? "set" : "sets"}`;

  return (
    <MotionConfig reducedMotion="user">
    <section className="dz-shell dz-card mp" aria-label="Most played">
      <span className="dz-dots" aria-hidden="true" />
      <div className="dz-card-head">
        <h2 className="dz-card-title">Most played</h2>
        {/* No sets at all is not a "span" worth stating — `sameSpan` is true
            at 0 === 0, which printed a literal "0 sets" next to the "nothing
            yet" copy. */}
        {sameSpan ? (
          recent.setCount > 0 && <p className="mp-span">{label(recent)}</p>
        ) : (
          <div className="mp-toggle" role="tablist" aria-label="Set window">
            {(["recent", "extended"] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="tab"
                aria-selected={win === w}
                data-active={win === w || undefined}
                onClick={() => setWin(w)}
              >
                {label(w === "recent" ? recent : extended)}
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={win}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mp-rows"
        >
          <div className="mp-row">
            <p className="mp-label">Track</p>
            {data.track ? (
              <p className="mp-value">
                {data.track.title}
                <span className="mp-sub"> {data.track.artist} · ×{data.track.plays}</span>
              </p>
            ) : (
              <p className="mp-value mp-value--empty">-</p>
            )}
          </div>
          <div className="mp-row">
            <p className="mp-label">Artist</p>
            {data.artist ? (
              <p className="mp-value">
                {data.artist.artist}
                <span className="mp-sub"> ×{data.artist.plays}</span>
              </p>
            ) : (
              <p className="mp-value mp-value--empty">-</p>
            )}
          </div>
          {empty && <p className="mp-quiet">Nothing on the decks yet. The archive holds the rest.</p>}
        </motion.div>
      </AnimatePresence>
    </section>
    </MotionConfig>
  );
}
