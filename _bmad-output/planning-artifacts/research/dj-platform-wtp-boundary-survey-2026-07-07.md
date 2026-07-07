# DJ Platform — Willingness-to-Pay & Free/Paid Boundary Survey

**Purpose:** Validate the two decisions the market research left as "draft": (1) the **free/paid feature boundary** and (2) the **price point** — before any billing is built. Also captures the **SOM working-DJ fraction** (the ~5–15% assumption that everything sizing-related scales on).
**Run with:** the ~20 DJs in the candidate launch scene (the tight club rotation) + any adjacent scene DJs you can reach.
**Format:** ~7–10 min. Google Form / Typeform. Mix of segmentation, feature-value, and pricing questions.
**Author:** Arjun · **Date:** 2026-07-07
**Feeds:** freemium tier split (research §2.3a), SOM (research §3.3), PRD monetization section.

---

## Design notes (read before fielding)

- **Keep the concept description short and neutral.** Don't sell — you want honest signal, not politeness bias. One paragraph, then questions.
- **Don't ask "would you pay?" directly as the main signal.** Stated intent overstates real WTP. Use the **Van Westendorp Price Sensitivity Meter** (Q13–16) for the price *range*, and a **feature-tiering exercise** (Q9–11) for the boundary. Direct-intent Q12 is a cross-check, not the primary.
- **Segment first (Q1–6)** so you can slice every downstream answer by persona (working vs. hobbyist) — this is how you extract the SOM fraction.
- **Anonymous** except an optional email for the launch waitlist (doubles as a soft-commitment signal).
- **Target n:** even 15–25 responses from one scene is decision-useful here (you're validating within a known small population, not projecting to a national market).

---

## Section A — Who you are (segmentation → SOM fraction)

**Q1. How would you describe your DJing? (select one)**
- [ ] Hobby / bedroom — I mostly practice or mix at home, rarely or never gig
- [ ] Part-time / occasional gigs — I play out sometimes (a few times a year)
- [ ] Regular gigging — I play out at least monthly
- [ ] Full-time / professional — DJing is a primary income source

> *Analysis: "Regular" + "Full-time" ≈ the working-DJ core. Their share of respondents is your empirical read on the SOM 5–15% assumption.*

**Q2. In a typical month, how many sets do you play OUT (venues/events, not home)?**
- [ ] 0 · [ ] 1–2 · [ ] 3–5 · [ ] 6–10 · [ ] 10+

**Q3. What DJ software do you use most? (select one)**
- [ ] Serato · [ ] rekordbox · [ ] Traktor · [ ] VirtualDJ · [ ] Engine DJ · [ ] Other: ___

> *Analysis: confirms Serato-first launch fit within the scene. If the scene skews rekordbox, that's a strategic flag (v1 is Serato-only).*

**Q4. How do you mostly get your music? (select all that apply)**
- [ ] Buy from Beatport / Bandcamp / record pools / iTunes
- [ ] Streaming integrated into DJ software (Beatport LINK, TIDAL, etc.)
- [ ] Free / ripped / shared
- [ ] Promos / my own productions / edits

> *Analysis: "buys music" is a monetization hook + a filter for the paying segment. Cross-tab with Q1.*

**Q5. Do you have DJ friends in your scene whose sets you'd want to see?**
- [ ] Yes, an active group · [ ] A few · [ ] Not really

> *Analysis: "has a scene" is the second monetization hook and the precondition for the social loop.*

**Q6. Do you produce your own edits / mashups / tracks?**
- [ ] Yes, regularly · [ ] Occasionally · [ ] No

---

## Section B — The problem (do they feel the pain?)

**Q7. After a gig, do you ever look back at what you played?**
- [ ] Yes, I review most sets · [ ] Sometimes · [ ] Rarely · [ ] Never
- Follow-up (free text): *If yes — what do you look at, and using what tool today?*

**Q8. How much do you agree: "I'd like to understand my own DJing better — how I actually play, how it's changing over time." (1 = strongly disagree, 5 = strongly agree)**
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5

> *Analysis: baseline demand for reflection. Low scores here across the working segment would be a red flag for the whole concept, not just pricing.*

---

## Section C — The boundary (which features are worth paying for?)

*Intro line for respondents:* "Imagine an app that reads your Serato history after each gig and turns it into stats + a private feed of your scene. Below are features it could have."

**Q9. For EACH feature, tell us: is this something you'd expect free, or would pay to unlock? (grid: Expect free / Would pay / Wouldn't use)**

| Feature | Expect free | Would pay | Wouldn't use |
|---|---|---|---|
| See your scene's feed (what friends played, as energy-arc thumbnails) | ☐ | ☐ | ☐ |
| Follow other DJs / profiles | ☐ | ☐ | ☐ |
| Hide individual tracks in your shared setlist | ☐ | ☐ | ☐ |
| Basic stats for a single set (BPM range, genres, key mix) | ☐ | ☐ | ☐ |
| **"Compared to what?" — every stat vs. your own baseline** | ☐ | ☐ | ☐ |
| **Library utilization — "am I playing what I bought?"** (aging shelf, time-to-first-play) | ☐ | ☐ | ☐ |
| **Style evolution over time** (how your sound is changing) | ☐ | ☐ | ☐ |
| Taste leaderboards vs. your scene | ☐ | ☐ | ☐ |
| Full searchable history of every set | ☐ | ☐ | ☐ |

> *Analysis: this IS the boundary test. Features the working segment marks "expect free" belong in the free tier (or virality suffers); features they'll "pay" for are premium candidates. Compare against the draft split in research §2.3a — confirm or adjust.*

**Q10. Of everything above, which ONE feature would most make you want the app? (single choice from Q9 list)**

> *Analysis: identifies the true paid hook / lead feature for messaging.*

**Q11. Which ONE feature would you be most annoyed to find behind a paywall? (single choice)**

> *Analysis: the paywall-anger question. Whatever wins here must stay free — it's load-bearing for adoption/virality.*

---

## Section D — Price (Van Westendorp PSM + cross-checks)

*Intro:* "Assume the app works great and reads your Serato history automatically."

**Q12. Would you pay a monthly subscription for the premium features you marked above?**
- [ ] Yes · [ ] Maybe · [ ] No — Follow-up if No/Maybe (free text): *what would change your mind?*

**Q13. At what monthly price would this be SO CHEAP you'd question its quality?** $____
**Q14. At what monthly price would it be a GREAT DEAL — clearly worth it?** $____
**Q15. At what monthly price would it start to feel EXPENSIVE, but you'd still consider it?** $____
**Q16. At what monthly price would it be TOO EXPENSIVE — you wouldn't buy?** $____

> *Analysis (Van Westendorp): plot the four curves; the "great deal"↔"expensive" band brackets the acceptable price. Expect it to land near the $8–12 anchor (Serato Pro $11.99 / rekordbox Core $12 / Songstats €9.99). If the working segment's band sits below $8, revisit the model.*

**Q17. Would you prefer to pay: (one)**
- [ ] Monthly · [ ] Annual (cheaper per month) · [ ] One-time purchase · [ ] Wouldn't pay

> *Analysis: tests the DJ.Studio "pay once" anchor risk. Heavy one-time preference = messaging must work harder to justify the subscription-as-living-service framing.*

---

## Section E — The growth loop & close

**Q18. If a DJ friend invited you so you could see each other's sets, how likely are you to try it? (1–5)**
- [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5

> *Analysis: directly tests the DJ-to-DJ recruitment mechanic that the free tier is designed to protect.*

**Q19. Anything you'd want this app to do that we haven't mentioned? (free text)**

**Q20. (Optional) Email — join the launch waitlist:** ____________

> *Analysis: a real email is a soft-commitment signal stronger than any stated-intent answer. Waitlist size in-scene is itself a go/no-go input.*

---

## How to read the results (decision rules)

| Question set | Decides | Rule of thumb |
|---|---|---|
| Q1, Q2, Q4, Q5 cross-tab | **SOM fraction** | % who are (regular/full-time) AND buy music AND have a scene → replaces the 5–15% estimate |
| Q9 grid (working segment only) | **Free/paid boundary** | "expect free" majority → free tier; "would pay" majority → premium. Reconcile with §2.3a draft |
| Q11 | **Paywall floor** | The most paywall-angering feature must stay free |
| Q13–16 (working segment) | **Price point** | Van Westendorp acceptable band; target the "great deal"↔"expensive" overlap |
| Q12 + Q20 | **Demand reality-check** | Stated "yes" AND email left = strongest signal; big gap between them = discount stated intent |
| Q17 | **Model risk** | Strong one-time preference = subscription-framing risk to address |
| Q18 | **Loop validation** | Low scores here undermine the free-tier-for-virality logic |

**Go/no-go framing:** if the *working segment* (Q1) shows (a) high reflection demand (Q8 ≥4), (b) willingness to pay in the $8–12 band (Q13–16), and (c) a clear premium hook (Q10), the freemium model + boundary are validated → proceed to PRD. Weakness in any of the three tells you exactly what to fix before building.
