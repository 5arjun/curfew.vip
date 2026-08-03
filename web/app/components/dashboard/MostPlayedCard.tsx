"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useState } from "react";
import type { MostPlayedWindow } from "@/lib/sets/rightColumn";

// Most-played card (D10): ONE glass card — a small Week | Month toggle in the
// corner drives BOTH rows (track + artist). Sparse windows show quiet
// em-dashes, no fake data (D13); copy stays history-as-asset, never nagging.
export function MostPlayedCard({
  week,
  month,
}: {
  week: MostPlayedWindow;
  month: MostPlayedWindow;
}) {
  const [win, setWin] = useState<"week" | "month">("week");
  const data = win === "week" ? week : month;
  const empty = !data.track && !data.artist;

  return (
    <MotionConfig reducedMotion="user">
    <section className="dz-shell dz-card mp" aria-label="Most played">
      <span className="dz-dots" aria-hidden="true" />
      <div className="dz-card-head">
        <h2 className="dz-card-title">Most played</h2>
        <div className="mp-toggle" role="tablist" aria-label="Time window">
          {(["week", "month"] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={win === w}
              data-active={win === w || undefined}
              onClick={() => setWin(w)}
            >
              {w === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
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
              <p className="mp-value mp-value--empty">—</p>
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
              <p className="mp-value mp-value--empty">—</p>
            )}
          </div>
          {empty && (
            <p className="mp-quiet">Nothing on the decks this {win} — the archive holds the rest.</p>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
    </MotionConfig>
  );
}
