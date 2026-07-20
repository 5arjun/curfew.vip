---
title: "Reconciliation: Market Research vs. PRD + Addendum"
input: market-dj-stats-reflection-platform-research-2026-07-07.md
target: prd.md + addendum.md (prd-name-pending-2026-07-19)
date: 2026-07-19
---

# Reconciliation: Market Research → PRD

**Method:** Read `prd.md`, `addendum.md`, and the full market research report
(`research/market-dj-stats-reflection-platform-research-2026-07-07.md`) end to end.
Cross-checked every competitive-positioning claim, differentiation angle,
target-segment insight, and market risk in the research against the PRD's
Vision, Target User, Non-Goals, Open Questions, and Monetization sections
(confirmed via targeted grep for key terms: freemium, one-time, unbox, voice
memo, duplicate, record pool, fast-follower, viral, invite, scene feed,
Strava). Findings below are things that seem genuinely missed, not things a
PM would reasonably leave for the brief/research layer (e.g., the full
6-competitor axis table, TAM/SAM/SOM dollar figures, and per-vendor pricing
comparisons are appropriately absent from the PRD and are NOT flagged here).

---

## Gap 1 — Monetization: freemium decision and its primary-data reversal are both missing

The research doesn't just leave pricing "undecided" — it makes and then
stress-tests an explicit decision:

- §2.3a: Arjun **decided freemium** (permanent free social tier + paid
  "depth" tier + 2-week premium trial), explicitly overriding the brief's
  locked trial-only model, with a drafted free/paid feature split table and
  a ~$8-12/mo anchor tied to Serato Pro/rekordbox Core/Strava pricing.
- §5.5/§5.9: The **primary survey then contradicts that decision** — only
  2/10 said yes to a monthly subscription, 5 said maybe, 3 said no, and
  **7/10 preferred a one-time purchase** over monthly or annual billing.
  Van Westendorp pricing confirms ~$10/mo is an acceptable price *point*,
  but the *recurring* revenue model itself is flagged as the real risk
  ("price isn't the blocker; recurring-vs-one-time and demand intensity
  are" — §5.5).
- §4.3 #2 names a specific competitive anchoring risk: DJ.Studio's
  one-time-purchase pricing conditions part of this exact market to expect
  "pay once," which a subscription pitch must actively counter in
  messaging.

**In the PRD:** §7 Monetization says only "Subscription model assumed at
~$5-10/mo... explicitly not locked down... deferred until the product
exists," plus one line about "follow" being expected free. It carries none
of: the freemium-vs-paid-only tension, the 7/10-prefer-one-time finding, the
"living service, not a one-time artifact" messaging risk, or the
DJ.Studio anchoring risk. OQ-10 ("Monetization mechanics entirely
unresolved") is generic and doesn't surface that primary data actively
argues against the specific model (recurring subscription) the PRD's price
range implies. A PM could reasonably defer *locking* pricing, but the
specific, evidence-backed risk that the pricing *model* itself (not just the
number) is contested seems like it should at least be named in Open
Questions or the Assumptions Index, the way per-track-hide's weak WTP
signal was.

---

## Gap 2 — The social/viral growth thesis was flagged as the weakest-validated part of the concept, and this is only partially carried forward

Research §5.6/§5.9, in plain language: **"the social thesis is the
weakest-validated part of the concept in this sample."** Specific findings:
- Scene feed (energy-arc thumbnails) drew 3/10 "wouldn't use" votes — the
  second-most-rejected feature tested, ahead of most others besides
  per-track hide.
- The core DJ-to-DJ viral mechanic — "would you be more likely to try it if
  a DJ friend invited you" — scored a lukewarm **mean 3.0/5**, not the
  strong pull the entire growth loop (and the launch strategy of saturating
  one combined Philly/NYC/NJ scene) assumes.
- §5.7 explicitly recommends the PRD "lead with reflection depth and treat
  social as a secondary, mostly-free growth layer" and flags Axis C
  (privacy-first scene sharing) — a *locked differentiator* from the
  brainstorm — as "not validated by users."

**In the PRD:** The Vision (§1) does appear to have absorbed the top-line
pivot — "Curfew is DJ-first, not social-first... Social is a layer on top"
— which tracks the research's reflection-over-social recommendation well.
But the PRD's Open Questions (OQ-5) only carries forward the per-track-hide
and follow-expected-free findings from the WTP survey; it does not mention
the weak scene-feed engagement (3/10 wouldn't use) or the lukewarm
viral-invite score (3.0/5) — both of which bear directly on SM-3 ("scene
feed feels alive") and SM-4 ("DJ-to-DJ growth signal"), and on OQ-9's
already-open question about whether the combined-region launch network will
reach critical mass. The specific mechanism the launch strategy depends on
(a friend-invite loop) has primary data suggesting it's soft, and that
finding isn't named anywhere the PM would see it while reviewing growth
risk.

---

## Gap 3 — Competitive positioning against the free incumbent ("Serato history + a voice memo") is absent

Research §5.2 is a distinct and pointed finding: **all 10/10 survey
respondents already review their sets today**, and the named tools they use
are Serato's own built-in history function and simply recording the set and
listening back. The research frames this explicitly as the real
competitive bar: *"The competition for the reflection use-case is a free
built-in feature plus a voice-memo — a low-cost, already-adopted habit the
product must beat, not create."* Reflection appetite itself scored only
3.8/5 ("real but mild, not white-hot" — §5.2), reinforcing that the
incumbent habit is entrenched, not absent.

**In the PRD:** Nothing in Vision, Target User, or Non-Goals addresses why
Curfew's automated reflection is meaningfully better than the free
alternative DJs already use (manual Serato history review, voice-memo/
recording review). This is a differentiation angle specific to this
market (not a generic "the market has other options" risk) and reads as
missing from both the Vision's pitch and the Open Questions' risk list.

---

## Gap 4 — Latent fast-follower competitive risk (`unbox`) is not mentioned anywhere

Research §1.3, §1.6, and §4.3 #4 name a specific, concrete competitive risk:
`unbox` (364 GitHub stars, actively maintained into 2026) already does
cross-platform "display your played tracks" parsing across
Serato/rekordbox/Traktor/VirtualDJ. The research explicitly recommends
monitoring it as a fast-follower risk and states the strategic implication
plainly: *"speed-to-scene-network-effect is the moat, not the parsing tech
(which is commoditized)."* This is a named, sourced, specific risk — not a
generic "competitors might emerge" caveat.

**In the PRD:** No mention of `unbox`, competitive urgency, time-to-market
pressure, or the parsing-tech-is-commoditized framing anywhere in Vision,
Non-Goals, or Open Questions. Given the PRD's own Open Questions already
carry forward several lower-stakes technical caveats (e.g., reverse-geocode
provider TBD), a concrete named competitive risk seems like a reasonable
peer to include, at least as a one-line open question.

---

## Gap 5 — Unprompted "library intelligence" feature signals aren't captured even as a future consideration

Research §5.6 surfaces two unprompted feature requests from primary
respondents (both pros), independent of the surveyed feature list:
(1) crate integration / duplicate-track finder / library organization, and
(2) a record-pool-style mechanic for DJs in a scene sharing edits/tools.
The research connects request (1) directly to library utilization already
testing as a top-2 paid feature, and concludes in §5.7 that "library
intelligence" (utilization + cleanup) "may be a stronger commercial spine
than 'scene social.'"

**In the PRD:** Library Utilization (§4.4) covers conversion rate/aging
shelf/time-to-first-play, which is adjacent but distinct from a
duplicate-finder/crate-hygiene tool. Neither unprompted request appears
anywhere — not in Non-Goals (which would signal a considered-and-cut
decision) and not in Open Questions/future-scope notes (which is how the
PRD otherwise handles "discussed but deferred" items, e.g. the deeper
set-detection algorithm in §4.1's Notes). Given the PRD's own pattern of
using `[NOTE FOR PM]` markers for exactly this kind of "worth exploring
later, not committed" signal, these two feel like a plausible omission
rather than a deliberate cut.

---

## Not flagged (reasonable PM omissions)

- Full 6-competitor axis comparison table (Songstats, DJ.Studio, Serato
  Playlists, rekordbox, Mixcloud, 1001Tracklists) — belongs in
  brief/research, PRD's Vision captures the resulting positioning
  sufficiently.
- TAM/SAM/SOM dollar figures and the 5-15% working-DJ-fraction sizing
  assumption — business-case material, not PRD-level.
- Detailed competitor pricing tables (Serato $11.99-14.99/mo, rekordbox
  $12-36/mo, Songstats €9.99-83.33/mo) — the PRD's own $5-10/mo range is a
  reasonable compression of this for a capability-level document.
- Open-source parser ecosystem detail (`triseratops`, `sslscrobbler`, etc.)
  — this is already carried into the addendum's Local Agent section where
  it belongs (technical-how).
