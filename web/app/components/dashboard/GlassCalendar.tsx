"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  format,
  getDate,
  getDay,
  getDaysInMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useMemo, useRef, useState } from "react";
import type { DayMarks } from "@/lib/sets/rightColumn";
import { formatDuration } from "@/lib/sets/format";
import { dispatchSelectDay } from "@/app/components/dashboard/SetListPanel";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";

// Glass calendar (D5/D10) — the GlassCalendar ref with the locked adaptations:
// both view modes REAL with Monthly (compact 7-column grid) as default and the
// ref's horizontal strip kept as Weekly; the ref's today-dot affordance
// repurposed as the set-day blip (1–3 dots, glow past three); today = hairline
// ring; selected = filled gradient circle (re-tinted to Abyss); settings icon
// and footer buttons replaced by the month-summary line ("August · 3 nights ·
// 8h 40m"). Month name keeps the ref's fade/slide key-swap; chevrons as-is.
//
// Day-hover preview (new ref: project-showcase): the shared CursorChip
// primitive (ui/CursorChip.tsx — extracted from here, REFINEMENTS item 4)
// follows the cursor, clamped inside the card via boundsRef (item 13), with a
// content crossfade between days. Text only: "N sets" + one quiet start ·
// duration line per set. Cursor-only by construction (mouse events don't fire
// on touch). Clicking a set-day scrolls + pulses that day's rows in the
// archive; a single-set day auto-expands it (D10, via dz:select-day).

interface Day {
  date: Date;
  key: string;
  isToday: boolean;
}

export function GlassCalendar({ marks }: { marks: DayMarks }) {
  const [view, setView] = useState<"monthly" | "weekly">("monthly");
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  // Weekly view navigates a real 7-day window (Sun-start), not the whole month
  // (Arjun: the arrows advanced a month + it only ever showed days 1–7).
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const chipTargetRef = useCursorChipTarget();

  const monthDays = useMemo<Day[]>(() => {
    const start = startOfMonth(currentMonth);
    return Array.from({ length: getDaysInMonth(currentMonth) }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), i + 1);
      return { date, key: format(date, "yyyy-MM-dd"), isToday: isToday(date) };
    });
  }, [currentMonth]);

  const monthSummary = useMemo(() => {
    const prefix = format(currentMonth, "yyyy-MM");
    let nights = 0;
    let totalSec = 0;
    for (const [key, mark] of Object.entries(marks)) {
      if (!key.startsWith(prefix)) continue;
      nights += 1;
      totalSec += mark.totalSec;
    }
    const name = format(currentMonth, "MMMM");
    if (nights === 0) return `${name} · no sets yet`;
    return `${name} · ${nights} ${nights === 1 ? "night" : "nights"} · ${formatDuration(totalSec)}`;
  }, [marks, currentMonth]);

  const weekDays = useMemo<Day[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, key: format(date, "yyyy-MM-dd"), isToday: isToday(date) };
    });
  }, [weekStart]);

  const weekSummary = useMemo(() => {
    const keys = new Set(weekDays.map((d) => d.key));
    let nights = 0;
    let totalSec = 0;
    for (const [key, mark] of Object.entries(marks)) {
      if (!keys.has(key)) continue;
      nights += 1;
      totalSec += mark.totalSec;
    }
    const range = `${format(weekStart, "MMM d")} – ${format(addDays(weekStart, 6), "MMM d")}`;
    if (nights === 0) return `${range} · no sets`;
    return `${range} · ${nights} ${nights === 1 ? "night" : "nights"} · ${formatDuration(totalSec)}`;
  }, [marks, weekDays, weekStart]);

  const onMouseMove = (e: React.MouseEvent) => {
    chipTargetRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleDayClick = (day: Day) => {
    setSelectedKey(day.key);
    if (marks[day.key]) dispatchSelectDay(day.key);
  };

  const hoveredMark = hoveredKey ? (marks[hoveredKey] ?? null) : null;

  const dayButton = (day: Day) => {
    const mark = marks[day.key];
    const isSelected = day.key === selectedKey;
    return (
      <button
        type="button"
        onClick={() => handleDayClick(day)}
        onMouseEnter={() => setHoveredKey(day.key)}
        onMouseLeave={() => setHoveredKey((k) => (k === day.key ? null : k))}
        className="cal-day"
        data-selected={isSelected || undefined}
        data-today={(day.isToday && !isSelected) || undefined}
        data-marked={(mark && !isSelected) || undefined}
        aria-label={`${format(day.date, "MMMM d")}${mark ? ` — ${mark.count} ${mark.count === 1 ? "set" : "sets"}` : ""}`}
      >
        {getDate(day.date)}
        {mark && !isSelected && (
          <span className="cal-blips" data-glow={mark.count > 3 || undefined} aria-hidden="true">
            {Array.from({ length: Math.min(mark.count, 3) }, (_, i) => (
              <span key={i} className="cal-blip" />
            ))}
          </span>
        )}
      </button>
    );
  };

  return (
    <MotionConfig reducedMotion="user">
    <div
      ref={cardRef}
      className="dz-shell dz-card cal"
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHoveredKey(null)}
    >
      <span className="dz-dots" aria-hidden="true" />
      {/* Header: real Weekly | Monthly tabs (settings icon removed — D10). */}
      <div className="cal-head">
        <div className="cal-tabs" role="tablist" aria-label="Calendar view">
          {(["weekly", "monthly"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className="cal-tab"
              data-active={view === v || undefined}
              onClick={() => {
                if (v === view) return;
                // Keep the two views on the same date when swapping.
                if (v === "weekly") setWeekStart(startOfWeek(startOfMonth(currentMonth)));
                else setCurrentMonth(weekStart);
                setView(v);
              }}
            >
              {v === "weekly" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      {/* Month name (ref's fade/slide key swap) + chevrons. */}
      <div className="cal-month-row">
        <motion.p
          key={view === "weekly" ? format(weekStart, "yyyy-MM-dd") : format(currentMonth, "yyyy-MMMM")}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="cal-month"
        >
          {view === "weekly" ? format(weekStart, "MMMM") : format(currentMonth, "MMMM")}
        </motion.p>
        <div className="cal-nav">
          <button
            type="button"
            onClick={() =>
              view === "weekly"
                ? setWeekStart(addDays(weekStart, -7))
                : setCurrentMonth(subMonths(currentMonth, 1))
            }
            aria-label={view === "weekly" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              view === "weekly"
                ? setWeekStart(addDays(weekStart, 7))
                : setCurrentMonth(addMonths(currentMonth, 1))
            }
            aria-label={view === "weekly" ? "Next week" : "Next month"}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Item 16: the Weekly↔Monthly swap pops with the expanded-set-card's
          language (scale + progressive blur + fade, liquid ease, matching the
          sheet's 310ms) instead of a hard cut. mode="wait" so the old view
          clears first; initial={false} so it doesn't fire on page load.
          MotionConfig reducedMotion="user" (on the card) honours the pref. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          className="cal-view"
          initial={{ opacity: 0, scale: 0.97, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
          transition={{ duration: 0.16, ease: [0.17, 1, 0.33, 1] }}
        >
          {view === "monthly" ? (
            <div className="cal-grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={`${d}-${i}`} className="cal-dow">
                  {d}
                </span>
              ))}
              {Array.from({ length: getDay(startOfMonth(currentMonth)) }, (_, i) => (
                <span key={`pad-${i}`} />
              ))}
              {monthDays.map((day) => (
                <span key={day.key} className="cal-cell">
                  {dayButton(day)}
                </span>
              ))}
            </div>
          ) : (
            <div className="cal-strip">
              {weekDays.map((day) => (
                <div key={day.key} className="cal-strip-day">
                  <span className="cal-dow">{format(day.date, "E").charAt(0)}</span>
                  {dayButton(day)}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="cal-divider" />
      <p className="cal-summary">{view === "weekly" ? weekSummary : monthSummary}</p>

      {/* Cursor-follow hover chip (shared primitive; clamped to the card). */}
      <CursorChip
        target={chipTargetRef}
        visible={!!hoveredMark}
        contentKey={hoveredKey}
        boundsRef={cardRef}
      >
        {hoveredMark && (
          <>
            <p className="cursor-chip-title">
              {hoveredMark.count} {hoveredMark.count === 1 ? "set" : "sets"}
            </p>
            {hoveredMark.sets.map((s, i) => (
              <p key={i} className="cursor-chip-line">
                {s.start} · {s.duration}
              </p>
            ))}
          </>
        )}
      </CursorChip>
    </div>
    </MotionConfig>
  );
}
