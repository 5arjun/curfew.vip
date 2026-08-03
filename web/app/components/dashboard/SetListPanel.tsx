"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetRowModel } from "@/lib/sets/listModel";
import { MetalButton } from "@/app/components/dashboard/MetalButton";
import { SpotlightSearch, type SpotlightSort } from "@/app/components/dashboard/SpotlightSearch";

// Set-list panel (D4/D9) — the progressive-blur music player's mechanics,
// re-tinted: 72px rows with the ref's hover inset-glow + hover-reveal icon;
// the list scrolls entirely WITHIN this panel (hidden scrollbar, D9 hard
// requirement — the page never moves); clicking a row expands it IN PLACE via
// the ref's song-modal choreography (the sheet starts at the row's on-screen
// position, grows 72px → ~400px on the 0.6s house easing while the list
// behind recedes — scale 0.9 + blur 16px + brightness 0.7); the date scales
// 2× from center-left, the + icon spins −495° on the overshoot bezier; the
// top slot swaps to back arrow + the "Enter Set" liquid-metal pill (D9).
//
// The calendar cross-link (D10) arrives as a `dz:select-day` CustomEvent:
// scroll + pulse that day's row(s); exactly one set → auto-expand it.

export const SELECT_DAY_EVENT = "dz:select-day";

interface SheetGeometry {
  top: number;
  shift: number;
  height: number;
}

/** The ref's 8-layer progressive backdrop blur (GradientBlur), verbatim ramp. */
function GradientBlur() {
  return (
    <div className="dz-gblur" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} />
      ))}
    </div>
  );
}

/** Top/bottom scroll-edge softening — the same progressive-blur language, linear. */
function EdgeFade({ side }: { side: "top" | "bottom" }) {
  return (
    <div className={`dz-efade dz-efade--${side}`} aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  );
}

export function SetListPanel({ rows }: { rows: SetRowModel[] }) {
  const [sheetRow, setSheetRow] = useState<SetRowModel | null>(null);
  const [sheetGeo, setSheetGeo] = useState<SheetGeometry | null>(null);
  const [active, setActive] = useState(false);
  const [pulseDay, setPulseDay] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SpotlightSort>({ key: "date", dir: "desc" });

  // Live filtering (D12): the archive IS the results surface. Every token must
  // hit the haystack (dates + every play's title/artist); sort per the chips.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tokens = q === "" ? [] : q.split(/\s+/);
    const filtered =
      tokens.length === 0 ? rows : rows.filter((r) => tokens.every((t) => r.haystack.includes(t)));
    const sorted = [...filtered].sort((a, b) =>
      sort.key === "date" ? a.startedAtMs - b.startedAtMs : a.lengthSec - b.lengthSec,
    );
    if (sort.dir === "desc") sorted.reverse();
    return sorted;
  }, [rows, query, sort]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((row: SetRowModel) => {
    const rowEl = rowRefs.current.get(row.id);
    const bodyEl = bodyRef.current;
    if (!rowEl || !bodyEl) return;
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    const bodyRect = bodyEl.getBoundingClientRect();
    const rowRect = rowEl.getBoundingClientRect();
    const top = rowRect.top - bodyRect.top;
    const height = Math.min(430, bodyRect.height - 12);
    setSheetGeo({ top, shift: 6 - top, height });
    setSheetRow(row);
    setActive(false);
    // Two frames so the sheet commits at the row's position before animating.
    requestAnimationFrame(() => requestAnimationFrame(() => setActive(true)));
  }, []);

  const close = useCallback(() => {
    setActive(false);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => setSheetRow(null), 600);
  }, []);

  // Escape closes the sheet (scoped to the document — the panel has no focus trap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Calendar → list (D10): scroll + pulse the day's rows; one set → expand it.
  useEffect(() => {
    const onSelectDay = (e: Event) => {
      const dayKey = (e as CustomEvent<{ dayKey: string }>).detail?.dayKey;
      if (!dayKey) return;
      const dayRows = rows.filter((r) => r.dayKey === dayKey);
      if (dayRows.length === 0) return;
      close();
      const firstEl = rowRefs.current.get(dayRows[0].id);
      firstEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPulseDay(dayKey);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulseDay(null), 2400);
      if (dayRows.length === 1) {
        setTimeout(() => open(dayRows[0]), 450);
      }
    };
    window.addEventListener(SELECT_DAY_EVENT, onSelectDay);
    return () => window.removeEventListener(SELECT_DAY_EVENT, onSelectDay);
  }, [rows, open, close]);

  useEffect(() => {
    return () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  return (
    <section className="dz-list dz-shell" data-modal={active || undefined} aria-label="Set archive">
      <span className="dz-dots" aria-hidden="true" />
      <div className="dz-list-top">
        {sheetRow ? (
          <div className="dz-list-actions" data-active={active || undefined}>
            <div className="dz-actions-lead">
              <button type="button" className="dz-back" onClick={close} aria-label="Back to the archive">
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
              <span className="dz-actions-title">
                <span className="dz-actions-date">{sheetRow.dateLabel}</span>
                <span className="dz-row-meta">
                  {sheetRow.floorCount} · {sheetRow.durationLabel}
                </span>
              </span>
            </div>
            <MetalButton mode="text" label="Enter Set" href={`/set/${sheetRow.id}`} />
          </div>
        ) : (
          <div className="dz-list-search">
            <SpotlightSearch query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />
          </div>
        )}
      </div>

      <div className="dz-list-body" ref={bodyRef}>
        <div className="dz-list-main">
          <div className="dz-list-scroll" ref={scrollRef}>
            {rows.length === 0 ? (
              <p className="dz-list-empty">
                Your archive opens with your first captured set — every night lands here, searchable.
              </p>
            ) : visibleRows.length === 0 ? (
              <p className="dz-list-empty">No sets match — try a date, a song, or an artist.</p>
            ) : (
              <ul className="dz-rows">
                {visibleRows.map((row) => (
                  <li
                    key={row.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.id, el);
                      else rowRefs.current.delete(row.id);
                    }}
                  >
                    <button
                      type="button"
                      className="dz-row"
                      data-pulse={(pulseDay !== null && row.dayKey === pulseDay) || undefined}
                      aria-expanded={sheetRow?.id === row.id && active}
                      onClick={() => open(row)}
                    >
                      <span className="dz-row-when">
                        {row.dateLabel}
                        <span className="dz-row-clock"> · {row.startClock}</span>
                      </span>
                      <span className="dz-row-end">
                        <Plus size={18} strokeWidth={2} className="dz-row-icon" aria-hidden="true" />
                        <span className="dz-row-meta">
                          {row.floorCount} · {row.durationLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <EdgeFade side="top" />
          <EdgeFade side="bottom" />
        </div>

        {sheetRow && sheetGeo && (
          <div
            className="dz-sheet"
            data-active={active || undefined}
            style={{
              top: `${sheetGeo.top}px`,
              height: active ? `${sheetGeo.height}px` : undefined,
              transform: `translateY(${active ? sheetGeo.shift : 0}px)`,
            }}
          >
            <div className="dz-sheet-info">
              <dl className="dz-sheet-stats">
                <div>
                  <dd>{sheetRow.avgBpm}</dd>
                  <dt>Avg BPM</dt>
                </div>
                <div>
                  <dd>{sheetRow.medianBpm}</dd>
                  <dt>Median BPM</dt>
                </div>
                <div>
                  <dd>{sheetRow.floorCount}</dd>
                  <dt>Dancefloor tracks</dt>
                </div>
                <div>
                  <dd className="dz-sheet-range">{sheetRow.timeRange}</dd>
                  <dt>On the decks</dt>
                </div>
              </dl>

              {sheetRow.tracklist.length > 0 && (
                <div className="dz-sheet-tracklist">
                  <p className="dz-sheet-tracklist-label">Tracklist</p>
                  <ol>
                    {sheetRow.tracklist.map((t, i) => (
                      <li key={i}>
                        <span className="dz-sheet-track">{t.title}</span>
                        <span className="dz-sheet-artist">{t.artist}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <GradientBlur />
          </div>
        )}
      </div>
    </section>
  );
}

// Re-exported so the calendar (D10) can dispatch without importing the panel.
export function dispatchSelectDay(dayKey: string) {
  window.dispatchEvent(new CustomEvent(SELECT_DAY_EVENT, { detail: { dayKey } }));
}
