"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { CalendarArrowDown, CalendarArrowUp, Hourglass, Search } from "lucide-react";
import { useRef, useState } from "react";

// Spotlight search (D6/D12) — the apple-spotlight ref at full fidelity, with
// the two agreed adaptations: dark liquid-glass reskin (animations untouched)
// and inline placement at the top of the set-list panel (so no fullscreen
// overlay and no page-load autofocus — focus follows the DJ's click). The
// ref's right-side app shortcuts become SORT FILTERS (final list, Q8): one
// date icon toggling newest/oldest and a set-length icon toggling longest/
// shortest. Results are NOT a dropdown: the archive list itself filters live
// (D12) — the parent owns query/sort state, this component is the instrument.
//
// Signature mechanics preserved exactly:
// • the gooey SVG blob filter (feGaussianBlur 10 + feColorMatrix 18/−9) over
//   the pill + chips, so they merge/separate like liquid droplets;
// • hover fans the chips out one by one (0.8s spring, bounce 0.2, 0.05s
//   stagger, sliding from behind the pill; retract + re-absorb on leave);
// • hovering a chip rolls its label into the placeholder (blur + y morph,
//   AnimatePresence popLayout with per-text layoutId).

export interface SpotlightSort {
  key: "date" | "length";
  dir: "asc" | "desc";
}

const SVGFilter = () => (
  <svg width="0" height="0" aria-hidden="true">
    <filter id="dz-blob">
      <feGaussianBlur stdDeviation="10" in="SourceGraphic" />
      <feColorMatrix
        values="
      1 0 0 0 0
      0 1 0 0 0
      0 0 1 0 0
      0 0 0 18 -9
    "
        result="blob"
      />
      <feBlend in="SourceGraphic" in2="blob" />
    </filter>
  </svg>
);

function SpotlightPlaceholder({ text }: { text: string }) {
  return (
    <motion.div layout className="spot-placeholder">
      <AnimatePresence mode="popLayout">
        <motion.p
          layoutId={`spot-ph-${text}`}
          key={`spot-ph-${text}`}
          initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(5px)" }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}

export function SpotlightSearch({
  query,
  onQueryChange,
  sort,
  onSortChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sort: SpotlightSort;
  onSortChange: (sort: SpotlightSort) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [hoveredChip, setHoveredChip] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = [
    {
      key: "date",
      label: sort.key === "date" && sort.dir === "asc" ? "Date · oldest first" : "Date · newest first",
      icon:
        sort.key === "date" && sort.dir === "asc" ? (
          <CalendarArrowUp aria-hidden="true" />
        ) : (
          <CalendarArrowDown aria-hidden="true" />
        ),
      onClick: () =>
        onSortChange({
          key: "date",
          dir: sort.key === "date" && sort.dir === "desc" ? "asc" : "desc",
        }),
    },
    {
      key: "length",
      label:
        sort.key === "length" && sort.dir === "asc" ? "Length · shortest first" : "Length · longest first",
      icon: <Hourglass aria-hidden="true" />,
      onClick: () =>
        onSortChange({
          key: "length",
          dir: sort.key === "length" && sort.dir === "desc" ? "asc" : "desc",
        }),
    },
  ];

  return (
    <MotionConfig reducedMotion="user">
    <div
      className="spot"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setHoveredChip(null);
      }}
    >
      <SVGFilter />
      <div className="spot-goo">
        <AnimatePresence mode="popLayout">
          <motion.div
            layoutId="spot-pill"
            key="spot-pill"
            transition={{ layout: { duration: 0.5, type: "spring", bounce: 0.2 } }}
            className="spot-pill"
            onClick={() => inputRef.current?.focus()}
          >
            <motion.div layoutId="spot-search-icon" className="spot-search-icon">
              <Search aria-hidden="true" />
            </motion.div>
            <div className="spot-field">
              {!(hoveredChip === null && query) && (
                <SpotlightPlaceholder
                  text={hoveredChip !== null ? chips[hoveredChip].label : "Search dates, songs, artists"}
                />
              )}
              <motion.input
                ref={inputRef}
                layout="position"
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                aria-label="Search sets by date, song, or artist"
              />
            </div>
          </motion.div>

          {hovered &&
            !query &&
            chips.map((chip, index) => (
              <motion.div
                key={`spot-chip-${chip.key}`}
                onMouseEnter={() => setHoveredChip(index)}
                onMouseLeave={() => setHoveredChip(null)}
                layout
                initial={{ scale: 0.7, x: -1 * (64 * (index + 1)) }}
                animate={{ scale: 1, x: 0 }}
                exit={{
                  scale: 0.7,
                  x: 1 * (16 * (chips.length - index - 1) + 64 * (chips.length - index - 1)),
                }}
                transition={{ duration: 0.8, type: "spring", bounce: 0.2, delay: index * 0.05 }}
                className="spot-chip"
              >
                <button
                  type="button"
                  onClick={chip.onClick}
                  aria-label={chip.label}
                  aria-pressed={sort.key === chip.key}
                >
                  {chip.icon}
                </button>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
