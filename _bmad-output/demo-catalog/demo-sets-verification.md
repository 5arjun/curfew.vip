# Demo-set verification

Generated from `demo-catalog.json` + `demo-overlay.json` by `agent/src-tauri/examples/demo_set_generator.rs` — seed `20260812`, anchor `2026-08-10` (shift 0 days), timezone `America/New_York`.

Every segment number below is what `stats::segments::detect` produced over these sets, calibrated per-session by `CalibrationPool::floors_before` — the real detector, not a reimplementation.

**65 checks, 0 failed.**

| check | target | actual | |
| --- | --- | --- | --- |
| Odometer — sets | ~78 | 76 | ok |
| Odometer — hours on decks | ~247h | 238h | ok |
| Odometer — tracks played | ~2,700 | 2869 | ok |
| Played before its add-date | 0 | 0 | ok |
| Segments — sets with one | ~55 | 54 | ok |
| Segments — sets with two+ | ~14 | 14 | ok |
| Segments — sets with none | ~9 | 8 | ok |
| Camelot — Tier 1 hand-designed | 58-65% | 60% | ok |
| Camelot — Indian wedding sets | ~35% | 35% | ok |
| Camelot — archive (Tier 3) | ~45% | 48% | ok |
| Camelot — account-wide | ~50% | 49% | ok |
| Plays with no genre | ~2% | 3 (0.1%) | ok |
| Plays normalizing to Other | ~5% | 4 (0.1%) | ok |
| Plays with a null title | ~8 | 8 | ok |
| Plays with no BPM | a handful | 9 | ok |
| Plays with no key | a handful | 13 | ok |
| Low-confidence sets | 5 | 5 | ok |
| Low-confidence sets after mid-June | 0 | 0 | ok |
| Low-confidence Tier 1 sets | 0 | 0 | ok |
| Sets under HERO_MIN_TRACKS | 2 (soundchecks) | 2 | ok |
| Tracks per set (min-max, median) | 18-80, median 34 | 3-66, median 36 | ok |
| Thursday residencies | ~28 | 28 | ok |
| Fri/Sat club nights | ~34 | 35 | ok |
| Private events | ~12 | 11 | ok |
| Indian wedding sets | 1-2 | 2 | ok |
| Soundchecks | 2 | 2 | ok |
| Longest break in the calendar | ~3 weeks | 25 days | ok |
| session_identity increasing + unique | yes | true | ok |
| Signature track — plays | ~34 | 34 | ok |
| Signature track — distinct months | 7 | 8 | ok |
| Signature track — time of night | consistent (±1h) | mean 00:41, max deviation 16 min | ok |
| Signature track — recurring neighbours | 3-4 | 4 | ok |
| §6 Jan-Mar — Pop | 30% | 27% | ok |
| §6 Jan-Mar — Hip-Hop | 25% | 25% | ok |
| §6 Jan-Mar — House | 15% | 19% | ok |
| §6 Jan-Mar — R&B | 12% | 6% | ok |
| §6 Jan-Mar — Latin | 8% | 5% | ok |
| §6 Apr-May — House | 28% | 35% | ok |
| §6 Apr-May — Pop | 22% | 20% | ok |
| §6 Apr-May — Hip-Hop | 22% | 20% | ok |
| §6 Apr-May — Afrobeats | 4% | 3% | ok |
| §6 Apr-May — Latin | 7% | 4% | ok |
| §6 Jun-Aug — House | 38% | 44% | ok |
| §6 Jun-Aug — Hip-Hop | 18% | 16% | ok |
| §6 Jun-Aug — Pop | 14% | 15% | ok |
| §6 Jun-Aug — Afrobeats | 5% | 2% | ok |
| §6 Jun-Aug — Latin | 6% | 4% | ok |
| §7.2 BPM arc — residency | open < peak, gentle build (§7.2 92→108→120) | open 96 · peak 126 · close 122 | ok |
| §7.2 BPM arc — club | open ~118, peak ~128, close ~122 (§7.2) | open 117 · peak 126 · close 123 | ok |
| §7.2 BPM arc — private | wide swings, 85→128→95 (§7.2) | open 91 · peak 125 · close 101 | ok |
| §7.2 BPM arc — wedding | bimodal, not a house arc (§7.4) | open 97 · peak 132 · close 129 | ok |
| §7.4 wedding BPM bimodality | two modes (spec says 140-160; library tops out ~142 — see note) | 91 under 132bpm · 41 at/over 132bpm | ok |
| §7.4 wedding play lengths | 60-120s crowd-pleaser cuts | 80/132 plays at or under 130s | ok |
| Rotation — distinct tracks played | 600-1,100 | 790 | ok |
| Rotation — one-and-done | a real tail | 270 | ok |
| Rotation — workhorses (8+ plays) | a real head | 91 | ok |
| Roster — entries | the whole library | 4188 | ok |
| Roster — baseline vs go-forward adds | most of a 7-month-old install is baseline | 3822 baseline · 366 added in-window | ok |
| Add events — one per non-baseline roster entry | exact | 366 | ok |
| Add events — never emitted for a baseline track | true | true | ok |
| Every identified play joins to a roster entry | 0 orphans | 0 | ok |
| Library conversion — 60-day window | a non-degenerate rate | 106/366 = 29% | ok |
| Library conversion — 30-day window | a non-degenerate rate | 99/366 = 27% | ok |
| Library conversion — 14-day window | a non-degenerate rate | 89/366 = 24% | ok |
| Near-miss duplicates in one set | 0 | 0 | ok |

## Per-period genre mix (§6)

| period | plays | top parents |
| --- | ---: | --- |
| Jan-Mar | 1316 | Pop 27% · Hip-Hop 25% · House 19% · Electronica 13% · R&B 6% · Latin 5% |
| Apr-May | 472 | House 35% · Hip-Hop 20% · Pop 20% · Electronica 15% · Latin 4% · Afrobeats 3% |
| Jun-Aug | 1081 | House 44% · Hip-Hop 16% · Pop 15% · Electronica 13% · Latin 4% · Afrobeats 2% |

## Top subgenres, Jun–Aug (§6 wants Afro House + Tech House on top)

- Hip-Hop: 175
- House: 145
- Dance: 144
- Tech House: 125
- Afro House: 91
- Top 40: 87
- Future House: 52
- Pop: 50

## Signature track (§12 `/track/[track_id]`)

**Adam Port & Stryv ft Camila Cabello — Move (Clean Extended)** (`6207b52f9255b7e6`)

34 plays across 8 months. Recurring mix neighbours:

- MEDUZA — Another World (HUGEL Remix) (Clean Extended) — 13 times
- Kendrick Lamar & SZA — All The Stars (Stoon Afroedit) (Dirty Extended) — 8 times
- Bad Bunny — DtMF (J Rythm Afro House Edit) (Clean Short Edit) — 7 times
- HUGEL & Dawty ft Preston Harris — Loosen Up (Clean Short Edit) — 6 times
- The Weeknd — Sacrifice (John Summit Remix) (Clean Short Edit) — 2 times
- Zedd & Hayley Williams vs jeonghyeon — Stay The Night (Even Steve Always Edit) Clean CK Cut — 2 times

## Segment distribution, by the real detector (§8)

| segments found | sets |
| ---: | ---: |
| 0 | 8 |
| 1 | 54 |
| 2+ | 14 |

| kind | sets | 0 seg | 1 seg | 2+ seg | median plays | median length |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| residency | 28 | 2 | 24 | 2 | 33 | 3h08m |
| club | 35 | 3 | 21 | 11 | 44 | 3h14m |
| private | 9 | 1 | 7 | 1 | 36 | 3h30m |
| wedding | 2 | 0 | 2 | 0 | 66 | 3h19m |
| soundcheck | 2 | 2 | 0 | 0 | 3 | 14:13 |

The pacing was *designed* to produce a given count per set; the detector agreed on 62/76 of them. Disagreement is not corrected — the design intent is a knob on pace and tempo, and the detector is the authority on what those knobs produced.

## Library payloads (§10, `/library-utilization`)

`demo-library.json` — **4188 roster entries** (3822 baseline, 366 go-forward adds). Baseline rows carry no add event, matching `capture::LibraryScanOutcome`.

Conversion, measured off the add events the way `libraryConversion.ts` will:

| window | cohort | converted | rate |
| --- | ---: | ---: | ---: |
| 60 days | 366 | 106 | 29% |
| 30 days | 366 | 99 | 27% |
| 14 days | 366 | 89 | 24% |

Month-added cohorts at the 60-day default:

| cohort | added | converted | rate |
| --- | ---: | ---: | ---: |
| 2026-02 | 120 | 38 | 32% |
| 2026-03 | 41 | 12 | 29% |
| 2026-04 | 12 | 4 | 33% |
| 2026-05 | 15 | 4 | 27% |
| 2026-06 | 176 | 48 | 27% |
| 2026-07 | 2 | 0 | 0% |

> Thin months are real, not a generator artifact: the add-dates are file mtimes off Arjun's own drive, and some months genuinely saw almost no new music. A cohort of four tracks will render as a spiky point on the trend line.


## Deviations from the spec, and why

**§7.4 — the 140–160 dhol mode does not exist in this library.** Across every Indian/Bolly crate row with a usable BPM *and* key, two tracks sit above 148 and ~25 above 135 — not enough distinct records to fill a dancefloor block without repeating inside a single set. The wedding sets are built with a 132–142 fast mode against a 122–130 Bollywood floor and an 88–104 cocktail hour, which is still plainly bimodal and still nothing like a house set's arc. Closing the gap properly needs library material, not a generator change.

**§7.3 — archive camelot ramps rather than sitting flat at ~45%.** The spec's three tier numbers (58–65% / ~45% / ~35%) and its account-wide ~50% cannot all hold at once given how the play counts fall: a flat 45% archive lands the account at ~47.6%. The account-wide number is the one §7.3 calls the honest picture, so the non-Tier-1 target ramps from 45% in January to ~53.5% in August. That also reads better than a constant — a DJ who got better at harmonic mixing over seven months is a story `/style-evolution` can show.

**§7.2 — the club's hip-hop dip is one record, not a stretch.** Detection gates a window on its median BPM, so three consecutive ~100bpm plays drag two windows under the floor and split the night in two; a three-track dip put 21 of 35 club nights on two segments. One throwback bomb inside a 126bpm window leaves the median where it was, and is how the move actually works on a floor.

**§5 — residency nights run ~30 tracks over ~3h, so `played_ms` is capped.** Spacing and on-air duration are separate numbers here: pacing sets the start-to-start gap (which is what the detector and `confidence.rs` read), while the claimed on-air time is capped near a real extended-mix length. Without that split a sparse warm-up phase reported eleven-minute records.


## Overlay application (§4.2/§4.3)

- `tracks` corrections applied: **277**
- `no_identity` path-keyed corrections: **150** — of which **0** minted an identity that merges into an existing catalog row (and so inherits its bpm/key/genre/add-date), and **150** minted a *new* identity the stage-1 artifacts carry no metadata for.

> **RULED 2026-08-13 (Arjun): dropped.** A row that had no identity also had no `track_id`, and stage 1 keyed all per-track metadata by `track_id` — so those rows exist in `duplicates.json` as `{path, title, artist, crates}` and nothing else. Minting an identity gives them a name; it does not give them a tempo, a key, a genre, or an add-date, and there is nothing to sequence a play *by*. The options were a re-extraction pass emitting metadata for identity-less paths, or hand-authored overlay fields. Neither was taken: the wedding sets §7.4 needed them for are already carried by the 120 `tracks` corrections, so the rescue bought nothing it did not already have.
>
> The corrections themselves are **kept in `demo-overlay.json`, not deleted** — they are hand-curated and correct, they cost nothing to carry, and they become usable the moment anyone does run that extractor pass. They are simply never a candidate for a play, and the whole identity-less population (these 150, the 12 ceremony tracks, the ~311 non-Indian artist-less rows) is now invisible by choice rather than by omission.
