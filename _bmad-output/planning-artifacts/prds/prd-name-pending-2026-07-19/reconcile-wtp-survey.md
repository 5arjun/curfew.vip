# Reconciliation: WTP/Boundary Survey vs. PRD

**Purpose:** Compare the DJ WTP & Free/Paid Boundary survey against the drafted PRD (`prd.md`) and addendum (`addendum.md`), and surface any survey findings, rankings, or caveats not yet reflected in the PRD's Open Questions (§11), Monetization (§7), or feature Notes.

**Inputs read in full:**
- `prd.md`, `addendum.md`
- `research/dj-platform-wtp-boundary-survey-2026-07-07.md` (the survey **instrument** — questions, design notes, decision rules; per Author's own header it "feeds... PRD monetization section")
- `research/market-dj-stats-reflection-platform-research-2026-07-07.md` §5 (the survey **results**, n=10, collected 2026-07-07 to 2026-07-13)

## 0. A note on where the data actually lives

The file named as "the source input" (`dj-platform-wtp-boundary-survey-2026-07-07.md`) is the **survey instrument/design doc only** — it contains the questions, Van Westendorp setup, and "how to read results" decision rules, but **no response data**. The actual n=10 results (the numbers the PRD already partially cites — "6/10 wouldn't use," "follow unanimously expected free") live in `market-dj-stats-reflection-platform-research-2026-07-07.md`, §5 ("Primary Research — DJ WTP & Feature Survey (n=10) [PRIMARY DATA]", lines 324–430). This reconciliation treats §5 as the authoritative results source since that's what the PRD's existing citations are actually drawing from, and where the un-surfaced gaps live.

## 1. What the PRD already captures

- §4.8 Notes: per-track hide tested single least-wanted feature (6/10 wouldn't use); "follow" unanimously expected free. Kept in V1 scope regardless — carried to §11 Open Questions.
- §7 Monetization: "follow" expected free, worth weighing against gating social behind payment.
- §11 Open Question #5: per-track hide + follow tested weakest; re-test with larger sample recommended before further engineering investment.

These three citations are accurate to §5.3 of the source data. Below are the gaps.

## 2. Gaps — findings not reflected anywhere in the PRD

### Gap 1 (highest severity): Subscription model itself is contradicted, not just the price

Survey §5.5: only **2/10 gave a clear "yes"** to a monthly subscription (5 maybe, 3 no), and **7/10 preferred a one-time purchase** over monthly (2) or annual (1). Open-text reasons attack recurring value directly ("I already can see my own history… not worth paying for"; "needs to be something I absolutely need as a DJ") — this is a *model* objection, not a *price* objection.

PRD §7 Monetization states: *"Subscription model assumed at ~$5-10/mo, explicitly not locked down in this PRD."* This assumption is not just "unlocked" — it's a locked-in model choice (subscription) that the primary data actively pushes back on. The PRD's only WTP-survey citation in §7 is the "follow expected free" line; the much larger finding — that 7/10 respondents would rather pay once than subscribe at all — isn't mentioned. This is the survey's own "hard finding" (§5.5 heading) and its authors' top implication (§5.7 #3: "Recurring-revenue risk is now evidence-backed, not hypothetical... Consider testing a one-time or hybrid offer").

**Recommendation:** Add to §7 Monetization and §11 Open Questions — the subscription-vs-one-time model choice, not just the price point, is unresolved and survey-contradicted.

### Gap 2: Actual price data exists and isn't cited

Survey §5.5 Van Westendorp results: median "great deal" price **$10/mo**, ceiling ("too expensive") **$30/mo**, acceptable band roughly $10–25. This is real, computed data — not a caveat, a finding that *confirms* pricing is plausible even though the model is in question.

PRD §7 states pricing is "explicitly not locked down" and gives an assumed range of "~$5-10/mo" without citing this data point at all. The PRD's own assumed ceiling ($10) sits at the *low* end of the validated "great deal" price, not centered in the confirmed band. Worth citing the actual number so the assumption reads as informed-but-deferred rather than ungrounded.

### Gap 3: Scene feed itself (not just per-track hide) tested weak

Survey §5.3: "Scene feed (energy-arc thumbnails)" scored Free: 6, Pay: 1, **Won't-use: 3 of 10** — flagged in the source as "🔴 Weak; ⅓ won't use." This is FR-19/FR-20, core V1 scope, and the direct subject of **SM-3** ("Scene feed feels alive... Validates FR-19–FR-21") — a *primary* success metric.

The PRD's WTP-survey notes mention only per-track hide and follow as weak-testing features; the feed itself — arguably the more consequential one, since it's a primary success metric and the centerpiece of UJ-2 — isn't mentioned as having also tested weak. This complicates SM-3 more than the PRD's current framing suggests.

### Gap 4: DJ-to-DJ viral loop tested lukewarm

Survey §5.6: "If a DJ friend invited you, how likely to try it?" scored **mean 3.0/5** (range 1–5) — the source calls this "lukewarm, not the strong pull the DJ-to-DJ growth loop assumes." This bears directly on **SM-4** (DJ-to-DJ growth signal) and the Vision's "expands... as it grows" / peer-driven growth thesis. Not mentioned in the PRD anywhere (§10 Success Metrics or §11 Open Questions).

### Gap 5: Reflection appetite is "real but mild," and the incumbent is a low, already-adopted bar

Survey §5.2: the core reflection-thesis agreement statement scored **mean 3.8/5** — and critically, **10/10 respondents already review sets today**, using Serato's own built-in history function or simply recording and re-listening. Source's own framing: *"The competition for the reflection use-case is a free built-in feature plus a voice-memo — a low-cost, already-adopted habit the product must beat, not create."* §5.7 #4 calls this "the top unresolved risk."

PRD's **SM-2** ("Personal value stands alone — a DJ... finds it worth opening after every gig") is exactly the validation gate this finding bears on, but the PRD doesn't note the specific competitive bar (free Serato history + voice memo, already in use by the entire sample) that SM-2 has to clear. Worth a line in §11 Open Questions or as a note under SM-2.

### Gap 6: "Basic single-set stats" also topped the paywall-resentment list

Survey §5.4: "most annoyed to find behind a paywall" split evenly between **Basic single-set stats (3 votes)** and **Follow DJs (3 votes)** — both "must stay free or the product feels hostile" per the source. PRD §7 and §4.8 cite only "follow" as unanimously-expected-free; FR-6 (per-set summary) sharing that same paywall-resentment ranking isn't mentioned, even though monetization is still fully open (§7).

### Gap 7: Unprompted feature requests aren't logged anywhere

Survey §5.6 records two unprompted "what else should it do?" requests (both from pro respondents): (1) crate/library duplicate-finder and organization tooling, and (2) a scene "record pool" for DJs to submit/share edits and tips. Neither appears in the PRD's Open Questions, Non-Goals, or as a `[NOTE FOR PM]` anywhere — despite the duplicate-finder request aligning naturally with the already-prioritized Library Utilization feature (§4.4, FR-11–13) as a plausible future extension. Not a locked-scope issue, but a clean miss for the backlog/open-questions list.

### Gap 8: Sample skew detail — specifically under-samples the persona the PRD leans on for growth

Survey §5.1/§5.8: sample is 6/10 full-time pro, 100% Serato, and explicitly flagged as under-sampling "the hobbyist/bedroom funnel the growth model depends on." PRD's Target User §2.1 lists "Bedroom/hobbyist DJs" as a named primary persona with a dedicated journey (UJ-5), and the free-tier/growth-loop thesis depends on that segment converting socially. The PRD's existing caveats ("n=10, low confidence") are generic; they don't call out that the sample specifically under-represents the exact persona UJ-5 was written for, which is a sharper and more actionable caveat than "small sample."

### Gap 9: Survey's own top recommendation (reframe social as secondary) isn't cited as support, despite PRD's stance aligning with it

Survey §5.7 #1 explicitly recommends: *"Recommend the PRD lead with reflection depth and treat social as a secondary, mostly-free growth layer."* PRD Vision §1 independently lands in a compatible place ("Curfew is DJ-first, not social-first... Social is a layer on top"), but never cites this survey-backed recommendation as supporting evidence — and more importantly, §9.1 MVP Scope still lists Social Feed, Per-Track Hide & Privacy, and Community Comparisons as full, equally-weighted V1 features alongside the reflection features, not as an explicitly deprioritized/thinner "secondary layer." The PRD's philosophical framing and its actual scope commitment are in mild tension with each other on this point, and the survey's explicit recommendation — which would resolve that tension one way — isn't invoked.

## 3. Not gaps (checked, consistent)

- Taste leaderboards (FR-24/25) and full searchable history tested paid-leaning/split with no strong wouldn't-use majority — consistent with keeping them in scope; no PRD contradiction.
- Style evolution (FR-9) was the clear #1 hook (5/10 named it the one feature that would make them want the app; also top paid feature) — this is a *positive* finding the PRD could cite as support under §4.3, but its absence isn't a contradiction/complication of a locked FR, just a missed opportunity to strengthen rationale. Noted for completeness, not counted as a gap above.

## 4. Summary table

| # | Gap | Survey location | PRD section it should touch |
|---|---|---|---|
| 1 | Subscription model (not just price) contradicted — 7/10 prefer one-time, only 2/10 clear subscription-yes | §5.5 | §7 Monetization, §11 Open Questions |
| 2 | Van Westendorp price data ($10 sweet spot / $30 ceiling) exists, uncited | §5.5 | §7 Monetization |
| 3 | Scene feed itself tested weak (⅓ wouldn't use), not just per-track hide | §5.3 | §11 Open Questions, SM-3 |
| 4 | Viral invite loop tested lukewarm (3.0/5) | §5.6 | §11 Open Questions, SM-4 |
| 5 | Reflection appetite mild (3.8/5); incumbent is free Serato history + voice memo | §5.2 | §11 Open Questions, SM-2 |
| 6 | Basic single-set stats tied with follow as top paywall-resentment feature | §5.4 | §7 Monetization, §4.2 Notes |
| 7 | Two unprompted feature requests (crate duplicate-finder, scene record pool) unlogged | §5.6 | §11 Open Questions or backlog |
| 8 | Sample skew specifically under-represents the hobbyist/bedroom persona the growth thesis depends on | §5.1/§5.8 | §11 Open Questions caveat sharpening |
| 9 | Survey's explicit "reframe social as secondary" recommendation not cited despite PRD's compatible stance; MVP scope still weights social equally | §5.7 #1 | Vision §1, §9.1 MVP Scope |

## 5. Minor, non-survey observation (noted in passing, not counted as a gap)

PRD §4.8's Notes paragraph (the one that carries the WTP survey citation) says the finding is "carried to §8 Open Questions" — but Open Questions is actually §11 in the current document (§8 is Non-Goals). Pure internal cross-reference slip, unrelated to survey content; flagged here only because it sits inside the exact sentence this reconciliation is auditing.

## 6. Verification note

This reconciliation was independently re-verified against `market-dj-stats-reflection-platform-research-2026-07-07.md` §5.1–5.9 (lines 324–430) in full, and against the current `prd.md` (§4.8, §7, §11) as of this pass. All nine gaps and the two "not gaps" checks above were confirmed accurate to source; no revisions to the substantive findings were needed.
