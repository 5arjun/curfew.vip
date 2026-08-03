"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, format, getDate, getDay, getDaysInMonth, isToday, startOfMonth, subMonths } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DayMarks } from "@/lib/sets/rightColumn";
import { formatDuration } from "@/lib/sets/format";
import { dispatchSelectDay } from "@/app/components/dashboard/SetListPanel";

// Glass calendar (D5/D10) — the GlassCalendar ref with the locked adaptations:
// both view modes REAL with Monthly (compact 7-column grid) as default and the
// ref's horizontal strip kept as Weekly; the ref's today-dot affordance
// repurposed as the set-day blip (1–3 dots, glow past three); today = hairline
// ring; selected = filled gradient circle (re-tinted to Abyss); settings icon
// and footer buttons replaced by the month-summary line ("August · 3 nights ·
// 8h 40m"). Month name keeps the ref's fade/slide key-swap; chevrons as-is.
//
// Day-hover preview (new ref: project-showcase): a floating chip follows the
// cursor via rAF lerp (factor 0.15) — the sanctioned unregistered-vars/inline-
// style pattern from the @property bug — with scale+fade in/out and a content
// crossfade between days. Text only: "N sets" + one quiet start · duration
// line per set. Cursor-only by construction (mouse events don't fire on touch).
// Clicking a set-day scrolls + pulses that day's rows in the archive; a
// single-set day auto-expands it (D10, via dz:select-day).

interface Day {
  date: Date;
  key: string;
  isToday: boolean;
}

const LERP_FACTOR = 0.15;

export function GlassCalendar({ marks }: { marks: DayMarks }) {
  const [view, setView] = useState<"monthly" | "weekly">("monthly");
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const targetPos = useRef({ x: 0, y: 0 });
  const smoothPos = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);

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

  // The ref's rAF-lerp cursor follow, writing the chip's inline transform
  // directly (no per-frame React state, no registered @property vars).
  useEffect(() => {
    const animate = () => {
      smoothPos.current = {
        x: smoothPos.current.x + (targetPos.current.x - smoothPos.current.x) * LERP_FACTOR,
        y: smoothPos.current.y + (targetPos.current.y - smoothPos.current.y) * LERP_FACTOR,
      };
      const chip = chipRef.current;
      if (chip) {
        chip.style.transform = `translate3d(${smoothPos.current.x + 18}px, ${smoothPos.current.y - 72}px, 0)`;
      }
      raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    targetPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
              onClick={() => setView(v)}
            >
              {v === "weekly" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      {/* Month name (ref's fade/slide key swap) + chevrons. */}
      <div className="cal-month-row">
        <motion.p
          key={format(currentMonth, "yyyy-MMMM")}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="cal-month"
        >
          {format(currentMonth, "MMMM")}
        </motion.p>
        <div className="cal-nav">
          <button
            type="button"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

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
          {monthDays.map((day) => (
            <div key={day.key} className="cal-strip-day">
              <span className="cal-dow">{format(day.date, "E").charAt(0)}</span>
              {dayButton(day)}
            </div>
          ))}
        </div>
      )}

      <div className="cal-divider" />
      <p className="cal-summary">{monthSummary}</p>

      {/* Cursor-follow hover chip (project-showcase mechanics, text content). */}
      <div ref={chipRef} className="cal-chip" data-visible={!!hoveredMark || undefined} aria-hidden="true">
        <AnimatePresence mode="popLayout">
          {hoveredMark && (
            <motion.div
              key={hoveredKey}
              initial={{ opacity: 0, scale: 1.06, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="cal-chip-body"
            >
              <p className="cal-chip-count">
                {hoveredMark.count} {hoveredMark.count === 1 ? "set" : "sets"}
              </p>
              {hoveredMark.sets.map((s, i) => (
                <p key={i} className="cal-chip-line">
                  {s.start} · {s.duration}
                </p>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
