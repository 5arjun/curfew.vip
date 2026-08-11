# Story 5.2 — Segment-detection algorithm (design working doc)

> Living design doc. Captures decisions from the planning session (Arjun, 2026-08-10) as they lock. Feeds back into `epics.md` §Story 5.2 as the authoritative spec.
>
> **Source inputs already read:** `epics.md` Story 5.2 block + AR-13 + FR-28, the Story 3.6 ⚑ refinement (2026-08-02) that shipped v0 and explicitly named this story as its supersession, `web/lib/sets/dancefloor.ts` / `dancefloor.test.ts` (the v0 implementation this story replaces), `5-1-segments-overlay-schema.md` (the `segments` table this story's output eventually populates — its Dev Notes deliberately left the `source`/`status` column shape unresolved for "Story 5.2's actual algorithm design" to answer, which this doc does not yet close — see §5).

---

## 0. The dividing line (what 5.2 owns vs. not)

| In 5.2 | Out of 5.2 |
|---|---|
| The detection algorithm itself: window bucketing, three-signal computation, per-DJ-calibrated candidacy + confirmation gates, idle/gap marking, merge/bridge logic | Segment editor UI, draggable boundaries, keyboard interaction — Story 5.3 |
| **Passive** personalization — floors that shift automatically as a DJ's own session history accumulates, starting from session 1 | **Active** personalization — DJ boundary edits feeding back into calibration (explicitly deferred, see D-17 and §5) |
| Retiring v0 (`web/lib/sets/dancefloor.ts`) in favor of one shared algorithm — same numbers, new job (D-1) | Segment-scoped stat recomputation using the resulting segments — Story 5.4 |
| Porting the algorithm's home to the agent stat-engine (Rust), per AR-13/epics.md ("computed in the agent stat-engine") | Durable storage of a per-DJ calibration profile as its own persisted/versioned state — provisionally Story 5.3's territory, since that's where the write path already lives (D-16); 5.2 only needs to be able to *compute* against history |
| Producing `suggested`-shaped segment candidates, and resolving the `source`/`status` column shape 5.1 deferred here (D-18) | Whether a 5.3 drag-adjust is an UPDATE-in-place or delete-and-reinsert — a write-policy question, properly 5.3's (5.1's own Dev Notes already flagged this as open and not this story's to pre-empt) |

## 1. Locked decisions (Arjun, 2026-08-10)

- **D-1 — One algorithm, shared code, every DJ, from day one.** Nobody gets different detection logic. v0's global constants (`DENSITY_FLOOR`, `BPM_FLOOR`, etc.) become the **shared starting prior** every DJ's calibration blends from (D-9) — not a separate interim system running alongside this one. v0 is retired, not kept in parallel.
- **D-2 — Execution home: the agent stat-engine (Rust)**, not client-side TS — a real port per AR-13/epics.md, not a tweak of `dancefloor.ts`.
- **D-3 — Three per-window signals**, same ~10-min window bucketing v0 established (unchanged unless revisited — see §5): play density, median BPM, and (new) consecutive-pair BPM-delta smoothness.
- **D-4 — Candidacy gate = density + BPM only.** Same two-signal shape v0 already uses, except both floors are per-DJ calibrated (D-8/D-9) rather than global constants.
- **D-5 — Smoothness is a confirming gate, not a candidacy signal.** It's evaluated only against runs that already cleared D-4 — a run can be a density/BPM candidate and still fail confirmation on smoothness. It never contributes to *becoming* a candidate.
- **D-6 — Smoothness metric = window-level aggregate**, not a strict per-consecutive-pair rule (e.g. median absolute BPM-delta across the window's consecutive pairs). Deliberately outlier-tolerant: a single off-tempo track inside an otherwise-tight window must not fail that window's smoothness (see D-14 — the "special request" case).
- **D-7 — Smoothness floor is per-DJ calibrated too**, exactly like density/BPM. This is the mechanism that resolves club-DJ-vs-wedding-DJ variance (tight vs. request-driven-loose natural BPM-jump behavior) without ever encoding a DJ "type" anywhere in the algorithm — each DJ's own history sets their own bar.
- **D-8 — Floor calculation = percentile-based** over a DJ's own historical per-window stats (density, BPM, smoothness-delta), not mean/stddev z-scoring. Robust to one outlier session skewing the number, and easier to reason about/debug/retune later than a z-score.
- **D-9 — Cold start = blend from the shared global prior**, no hard cutoff and no "no detection until N sessions" empty state. A DJ's floors start at v0's retired constants and shift toward their own percentiles as session history accumulates. `N ≈ 5` sessions as the point personal data starts carrying real weight — a first-pass number, explicitly tunable, not a considered statistical choice (see §5).
- **D-10 — Idle/gap is a label, not a confirmation gate.** A near-zero-density window already fails D-4 on its own; idle is a descriptive marker layered on top (future UI use: "idle 11:45–12:05" instead of a bare "not dancefloor"), adding no new confirmation logic of its own.
- **D-11 — Idle DOES matter for merge/bridge tolerance, with its own (shorter) threshold.** A short idle stretch (DJ steps away briefly) still bridges, same shape as v0's single-window gap-merge. A long idle stretch (a dinner break) hard-breaks the run into separate candidates instead of bridging through it. Exact short/long thresholds not yet numbered — see §5.
- **D-12 — Runs extend naturally to end-of-data.** No inverse "dancefloor ended" signal is required to close a segment — a qualifying run simply stops where the data stops. This is why a set that ends mid-peak (the common case, per Arjun) is handled for free, with no special-case logic.
- **D-13 — Isolated BPM outliers (request drops) must not break a run.** A single off-tempo track dropped mid-floor ("special request, gentlemen") is noise the window-aggregate smoothness metric (D-6) already tolerates, plus the existing floors are window-median-based and therefore already robust to one odd track by construction.
- **D-14 — End-of-night announcement clusters are a real signal, not noise to smooth over.** Distinct from D-13: this is multiple irregular tracks in a row (talking eats window density, BPM destabilizes, a gap may open) clustered at the tail — e.g. "last call for dinner," "final song," "thank you for coming" (wedding-DJ-specific). Window-level evaluation should catch this cluster and end the run before it, not bridge through it. Accepted risk: a *short* cluster could still get absorbed by the regular (non-idle) single-window bridge tolerance from D-11 — acceptable for v1, correctable via 5.3's editor, not worth over-engineering now.
- **D-15 — Zero, one, or several segments per session** — never assume exactly one (AR-13/FR-28, literal AC-4).
- **D-16 — Per-DJ calibration profile storage is provisionally out of 5.2's scope.** 5.2 needs to be able to *compute* percentile floors against a DJ's history; whether that's a live rollup at run time or a materialized, persisted profile is a dev-time call, but the durable/versioned profile a future *active*-learning loop (D-17) would write into likely belongs with Story 5.3, since that's where the confirmed-segment write path already lives. Flagged forward, not decided here.
- **D-17 — Two-tier personalization, explicit scope split.** (1) **Passive**, automatic, from session 1: every synced session adds its raw window stats to the DJ's pool, and D-9's blend does the rest — zero DJ interaction required. This is what 5.2 delivers, in full. (2) **Active**, from 5.3 edits: a DJ dragging a boundary is a much stronger labeled signal than a raw stat point, and a good candidate to weight into calibration later — explicitly **deferred**, not in scope here, and not required for (1) to work.
- **D-18 — `segments.source`/`status` shape resolved: two orthogonal columns, not one collapsed enum.** `source text check (source in ('suggested','manual'))` + `confirmed boolean not null default false`, plus `check (source <> 'manual' or confirmed)` ruling out the one impossible cell (a manual row is confirmed by construction) — same CHECK-constraint move 5.1 already used for `type='custom' requires label`. The deciding factor over a collapsed `status enum {suggested, confirmed, manual}`: **provenance must survive confirmation** (D-17's future active-learning signal needs to know a confirmed segment originated as an algorithm suggestion, not just its current state), and a collapsed enum trying to hold both facts just reinvents two axes inside one column, worse-shaped. Algorithm writes land `('suggested', false)`; a DJ confirming/adjusting a suggestion flips it to `('suggested', true)`; a DJ's own "+" boundary lands straight at `('manual', true)`. Explicitly **not** resolved here (properly 5.3's, per 5.1's own Dev Notes): whether a drag-adjust is an UPDATE-in-place or a delete-and-reinsert.

## 2. Shape (per session, per DJ)

```
plays[] (this session)
     │
     ▼
bucket into ~10-min windows (D-3, unchanged from v0)
     │
     ▼
per window: density · median BPM · median |consecutive BPM Δ|
     │
     ▼
per-DJ floors (percentile over this DJ's own window-stat history, D-8)
  ── blended from the shared global prior while history is thin (D-9)
     │
     ▼
candidacy = density ≥ floor AND median BPM ≥ floor   (D-4)
     │                                  │
     │                         window also gets an idle label
     │                         if near-zero density (D-10)
     ▼
longest-run search over candidate windows
  ── short (non-idle) gaps bridge (v0 shape)     (D-11)
  ── short idle gaps bridge, long idle hard-breaks (D-11)
     │
     ▼
per candidate run: smoothness confirming gate (D-5, D-6, D-7)
  ── fails → candidate discarded, not a segment
  ── passes → confirmed dancefloor segment
     │
     ▼
zero, one, or several confirmed segments (D-15)
  ── each extends to the true edge of its run — no end-of-set special case (D-12)
```

## 3. Section detail

### 3a. Signals and floors (D-3, D-4, D-6, D-7, D-8)

- Window shape (bucket size, minimum plays for detection to attempt at all) inherited from v0 as a starting point — not revisited in this session, flagged open in §5.
- Density and median-BPM floors: unchanged in *shape* from v0 (a window "clears" on density + BPM), changed in *source* — per-DJ percentile instead of a hardcoded constant.
- Smoothness: window-level aggregate of consecutive-pair BPM deltas (exact statistic — median vs. a percentile-of-deltas — a dev-time implementation choice within D-6's intent), gated against its own per-DJ percentile floor (D-7), evaluated only on already-qualifying candidate runs (D-5).

### 3b. Calibration (D-8, D-9, D-16)

- Percentile-based, not z-score (D-8) — pick the actual percentile value at dev time (this session floated ~60th as an illustrative example only, never locked).
- Blend, not cliff (D-9): global prior (v0's retired constants) → personal percentiles, weighted increasingly toward personal as the DJ's own window-stat pool grows past `N ≈ 5` sessions. The blend function itself (linear ramp vs. a smoother shrinkage curve) is a dev-time choice; the *no-hard-cutoff* requirement is the locked part.
- Where the historical pool lives / how it's computed (live rollup vs. materialized) is open — tangled with D-16's storage-ownership question, see §5.

### 3c. Idle/gap (D-10, D-11)

- Idle is descriptive, not a confirmation gate — a window failing the density floor is already excluded from candidacy on its own merits.
- Two distinct bridge tolerances: the existing non-idle single-window bridge (v0 shape, now maybe per-DJ — open, see §5) for ordinary lulls, and a separate, shorter tolerance specifically for idle stretches, with long idle forcing a hard break. Concrete thresholds (what counts as "idle" at all — a zero-play window vs. an elapsed-time multiplier of this DJ's typical inter-track gap — and what counts as "long" vs. "short") are unresolved, see §5.

### 3d. Domain edge cases (D-13, D-14)

- Request drops: tolerated by construction (window-aggregate smoothness + already-median-based floors), no special-case code needed beyond D-6's metric choice.
- Announcement tails: expected to self-resolve via the same window evaluation (low density + unstable BPM + possible gap in those windows), with the acknowledged edge that a short cluster might get absorbed by ordinary bridge tolerance — accepted, not solved here.

### 3e. What this story does NOT decide (D-16, D-17)

- No calibration-profile schema, no persistence mechanism, no write path — a forward note into whatever story ends up owning it (likely 5.3).
- No edit-feedback loop (DJ corrections reshaping calibration) — a separate future conversation, explicitly not pulled into this story's scope.
- No write-policy decision for 5.3's drag-adjust (UPDATE-in-place vs. delete-and-reinsert) — see D-18; that's a 5.3 question, this story only fixes the column shape it writes into.

### 3f. `segments.source`/`confirmed` (D-18)

```sql
source     text not null check (source in ('suggested', 'manual')),
confirmed  boolean not null default false,
check (source <> 'manual' or confirmed)
```

- Additive migration onto 5.1's `segments` table when this story lands — same bolt-on pattern 5.1's Dev Notes already anticipated (`20260803190000_add_play_capture_fields.sql`-style).
- This story's own writes only ever produce `('suggested', false)` rows. The `true` transitions (confirming a suggestion, or a manual row landing pre-confirmed) are 5.3's write path, not this story's — 5.2 just needs the column to exist in the right shape for 5.3 to write into.

## 4. Data

- Reads a session's own `plays[]`-equivalent (agent-side; per 3.7's Dev Notes distinction, likely the comprehensive internal `EnrichedPlay` shape rather than the frozen wire `SyncPlay`, since this runs agent-side per D-2) for the window bucketing and signal computation.
- Reads across a DJ's *historical* sessions for the calibration pool (D-8/D-9) — scope of "how far back," and live-vs-materialized computation, both open (§5).
- Writes candidate/confirmed segments in whatever shape eventually lands on 5.1's `segments` table — this story is expected to be the one that finally resolves the `source`/`status` column shape 5.1 deliberately deferred, but that resolution isn't captured yet in this doc (§5).
- DST/timezone safety (AR-13 AC-5, mirrors 3.8's AC-5/D-15): epoch-ms UTC math for monotonic window bucketing and consecutive-pair deltas — same discipline already verified for the energy arc, needs the equivalent verification here since this is agent-side Rust, not the web's TS.

## 5. Open threads

- [x] Signal set and gate structure — candidacy (density+BPM) vs. confirmation (smoothness), both per-DJ. (D-3..D-7)
- [x] Calibration approach — percentile, blended from a shared prior, no cold-start cliff. (D-8, D-9)
- [x] Idle/gap — descriptive label, own bridge tolerance, doesn't gate confirmation. (D-10, D-11)
- [x] End-of-data / zero-many-segments behavior. (D-12, D-15)
- [x] Domain edge cases — request drops vs. announcement tails. (D-13, D-14)
- [x] Scope split — passive (this story) vs. active/edit-feedback (deferred). (D-17)
- [x] `segments.source`/`status` column shape — two columns (`source` + `confirmed`), not a collapsed enum, provenance-after-confirm was the deciding factor. (D-18)
- [ ] Window size — confirm ~10 min carries over unchanged, or revisit.
- [ ] Exact percentile value for the floors (illustrative ~60th floated, never locked).
- [ ] Exact idle definition — zero-play window vs. elapsed-time multiplier of this DJ's typical inter-track gap.
- [ ] Exact idle-vs-regular bridge tolerance numbers (how short is "short," how long forces a hard break).
- [ ] Whether the *regular* (non-idle) single-window bridge tolerance stays a v0-style constant or also becomes per-DJ calibrated — not discussed in this session.
- [ ] Live-recompute vs. materialized per-DJ historical stat pool — ties directly to D-16's storage-ownership question.
- [ ] `N ≈ 5` sessions — a proposed starting default, not a confirmed number.
- [x] Fold a ⚑ pointer into `epics.md` §Story 5.2 (done alongside this doc).
- [x] Write the dev-ready story file (`bmad-create-story`) when 5.2 goes to build. *(Done 2026-08-10 — `5-2-segment-detection-algorithm.md`; this doc renamed to `-design.md` so the story file could take the canonical story-key path. The story's D-19..D-26 close this section's remaining opens; tick the boxes above when the dev branch lands them.)*
- [x] Commit these docs on a `story/5-2-segment-detection-algorithm` branch. *(Done 2026-08-10, alongside the story file.)*
