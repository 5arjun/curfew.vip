# Pre-launch legal review

**Closes launch-checklist §1.7.** Conducted 2026-08-18 against the live repo at
`efdeed9`. Every finding below cites the file it came from; nothing is asserted
from memory of how the product is supposed to work.

## The ruling on how this was reviewed

**Self-review, not paid legal review.** Ruled 2026-08-18 by Arjun.

The checklist asked for the choice and would not make it. This is the choice:
a solo pre-revenue product with four signup routes, one $7.99 plan and no
enterprise counterparty does not clear the bar where outside counsel earns its
fee, and the drafting was already done. What a lawyer buys at this stage is
insurance against the specific traps below — and the traps below are now named,
which is most of what the money would have bought.

**Residual risk, stated plainly so nobody thinks it was reviewed away:** this
review was performed by an engineer reading statutes against source, not by a
lawyer. It is a compliance audit of the gap between what the documents claim
and what the software does. It is not an opinion on enforceability, and it does
not cover the two items ruled as accepted risk in §3 of the checklist.

Re-run it if any of these change: launch geography stops being US-only, the
first marketing message is sent, an entity is formed, or a second pricing tier
or a free plan appears.

---

## The reframe: CCPA is the wrong thing to have been worried about

PRD §11 item 4 and Architecture Spine Open Question #6 both carried this as a
"formal CCPA-compliance review." That framing was inherited from the July
technical research and it points at the wrong statute.

**CCPA/CPRA does not bind Curfew, and will not for a long time.** It applies to
a for-profit business that meets at least one of three thresholds: annual gross
revenue over $25M as adjusted; buying, selling or sharing the personal
information of 100,000+ California consumers or households a year; or deriving
50% or more of revenue from selling or sharing personal information. Curfew
meets none of the three and is not close to any of them. The deletion runbook
reached the same conclusion independently — `ACCOUNT-DELETION-EXPORT-RUNBOOK.md`
§4 records Arjun's 2026-07-20 ruling that "CCPA thresholds don't bind a
launch-size business." Those two rulings agree, which is worth noting because
they were made three weeks apart from different directions.

So the CCPA-level posture is **voluntary and prospective** — a good design
stance that costs nothing and means the product does not have to be rebuilt at
the threshold. It is not a legal obligation today, and treating it as the
launch blocker obscured the four regimes that *do* bind at any size:

| Regime | Threshold | Bites Curfew? |
| --- | --- | --- |
| **CalOPPA** | Any commercial site collecting PII from CA residents | **Yes** — two required disclosures were missing (F) |
| **TCPA** | Anyone sending marketing texts | **On first send** — the sharpest exposure on this page (B) |
| **CAN-SPAM** | Anyone sending commercial email | **On first send** (B) |
| **CA ARL / federal ROSCA** | Anyone selling an auto-renewing subscription | **Yes, today** — thin disclosure, good cancellation (E) |

Identifying that is this review's main contribution. The launch blocker was
never the statute the checklist named.

---

## Findings

Severity is about exposure to Curfew, not about how hard the fix is.

### A — [High] The marketing grant is written, unbuilt, and its escape hatches don't exist

`privacy/page.tsx:110-122` and `terms/page.tsx:80-86` grant Curfew the right to
email *and text* customers about "new features, offers," and name two ways out:
"reply STOP to a text" and "the unsubscribe link in an email."

None of it exists.

- **No SMS anywhere in the repo.** No Twilio or any other provider, no send
  path, no STOP handler. Grepped across `web/` and `agent/`.
- **No marketing email either.** `EMAIL-PROVISIONING.md` wires Resend for
  transactional auth mail only — confirmation links and password resets. There
  is no unsubscribe link in the codebase because there is nothing to
  unsubscribe from.
- **The consent was never asked for.** The phone-collection screen
  (`web/app/(onboarding)/phone-required/page.tsx:56`) says only: "If your
  archive ever needs attention, a person can reach you." That is the point of
  collection, and it does not mention marketing. The terms then claim that by
  giving the number you agreed to receive it.

Today this is zero exposure, because nothing sends. The moment the first
marketing message goes out, three requirements bite at once:

1. **TCPA prior express written consent** for marketing texts to a mobile
   number — a separate, conspicuous disclosure at the point of collection, not
   bundled into terms acceptance, and not a condition of purchase. Statutory
   damages are $500 per message, trebled to $1,500 for a willful violation, and
   the plaintiff's bar is organized around exactly this.
2. **A2P 10DLC brand and campaign registration** with the carriers. Not a legal
   requirement but a practical one: unregistered US business SMS is filtered
   before it arrives, so the first blast would be both unlawful and undelivered.
3. **CAN-SPAM** — every commercial email needs a working opt-out honored within
   10 business days and a valid physical postal address. Curfew has neither.

**Disposition (ruled 2026-08-18, Arjun): keep the grant, build the consent
before the first send.** The documents stay as written — they describe the
intended product, and nothing sends today, so nothing is untrue in operation.
The gate is what makes this safe, so the gate is recorded in three places that
someone about to send would actually be looking at: launch-checklist §5 as a
standing rule, a header comment on both legal pages, and a comment on the
phone-collection screen itself, which is the file that has to change first.

**What "build the consent" concretely means, so the next session doesn't
re-derive it:** a separate opt-in control on `phone-required` (unchecked by
default, its own sentence naming marketing texts and message rates), a consent
column on `public.djs` recording the timestamp and the exact wording shown, an
unsubscribe link in every marketing email, a physical address in the footer of
the same, and 10DLC registration. Until all of that exists, the number is for
account and support contact only.

### B — [Medium] No governing law, venue, or dispute-resolution clause

`terms/page.tsx` has no choice-of-law section at all. For a US consumer
subscription this is the first thing outside counsel would flag: without it, a
dispute defaults to wherever the customer is, which for a product sold
nationally is any of fifty states with fifty different consumer-protection
regimes and small-claims rules.

The fix is short and the draft is ready in §"Ready to paste" below. It needs
one fact this repo does not contain — the state — so it is the single item
left open under 1.7 rather than closed with a guess. Commit timestamps are
`-0400`, so the answer is US Eastern, but a governing-law clause naming the
wrong state is worse than no clause at all.

**Recommendation: governing law and venue only. No arbitration clause.** A
class-action waiver with mandatory arbitration is enforceable in the US and it
is what a template would give you. It is also the wrong trade here: it adds
real customer distrust to a product whose entire pitch is that nothing is
buried in section nine, and it defends against a class action that a liability
cap of "what you paid in the last twelve months" — already in `terms` §"What
Curfew promises" — makes uneconomic to bring anyway.

### C — [Medium] Auto-renewal disclosure is thin on Curfew's own screen

California's ARL and federal ROSCA both require the auto-renewal terms to be
clear and conspicuous *in visual proximity to the purchase CTA*, with
affirmative consent, plus a post-purchase acknowledgment carrying the
cancellation policy, plus easy online cancellation.

`web/app/(onboarding)/subscribe/plan-actions.tsx:26-47` shows price and cadence.
The **annual** button reads "$83.88 once a year" with no renewal language at
all; only the monthly one says "Cancel whenever." Neither says the plan renews
automatically. The screen links to neither Terms nor Privacy, so nothing there
is being agreed to at the point of purchase.

What already works, and is the larger half of the requirement:

- **Stripe Checkout** states the recurring amount and interval on its hosted
  page before payment, and sends a receipt after. That covers the pre-purchase
  disclosure and the acknowledgment substantially.
- **Self-serve cancellation exists.** The Stripe billing portal is wired at
  `web/app/api/billing/portal/route.ts:90` and surfaced in Settings via
  `ManageBillingActions.tsx:39`. That satisfies click-to-cancel — *provided
  cancellation is enabled in the portal's Stripe dashboard configuration*,
  which is not verifiable from the repo. **One-minute check worth doing before
  launch.**

**Fixed** — one renewal line and the two links added under the plan buttons.

### D — [Low-Medium] CalOPPA's two named disclosures were missing

CalOPPA has no revenue threshold: it applies to any commercial website
collecting PII from California residents, which is Curfew from its first
signup. Two of its six required disclosures were absent:

- **§22575(b)(5) — Do Not Track.** A site must disclose how it responds to DNT
  signals. Zero occurrences of `DNT`, "Do Not Track" or Global Privacy Control
  anywhere in the repo.
- **§22575(b)(6) — third-party cross-site collection.** A site must disclose
  whether third parties may collect PII about a visitor's activity across sites
  over time.

Both are one sentence, and both are unusually easy to write here because the
truthful answer is a clean "no" in each case — there is no advertising
infrastructure to hedge about.

**Fixed** — both added to the Cookies section.

> **Interacts with checklist §2.1.** If Vercel Web Analytics and Speed Insights
> ship, revisit this section. Web Analytics is cookieless and does not
> fingerprint, so the DNT and cross-site sentences survive intact — but Vercel
> Analytics would need naming in the processor list, and the "two kinds of
> cookies" claim would need re-checking against what Speed Insights sets.

### E — [Low-Medium] The processor list was incomplete

`privacy/page.tsx:134-146` named Supabase, Vercel, Resend and Sentry, and
referred to "the payment processor" without naming it. Missing:

- **Stripe** — holds email, name, billing address and card metadata. The page
  already tells customers their card details go there, so naming it costs
  nothing and gains specificity.
- **Cloudflare** — DNS is Cloudflare-proxied, so it terminates TLS and sees
  every request to `curfew.vip`. Its injected `robots.txt` (checklist §1.6) is
  the visible proof of how much of the path it owns.
- **Google and Apple** — mentioned under "Where it comes from" as sources of
  data, not as parties in the flow.

Disclosure by *category* is what CCPA-style rules require, so an incomplete
named list is not a violation. It is a credibility problem, which for this page
is worse: the rhetorical stance is "a short list, each named," and a named list
that omits three names undercuts the sentence doing the persuading.

**Fixed** — all named.

### F — [Low] The rights section promised GDPR compliance

`privacy/page.tsx:179-183` read: "laws like the GDPR or the CCPA give you
specific rights... The same address honors all of them."

That volunteers GDPR compliance — DSAR response deadlines, a lawful-basis
analysis, an Article 27 EU representative — for a product that specifically
ruled to defer exactly that until international expansion is real. It promises
more than the posture ruled in PRD §11 and Spine OQ #6.

**Fixed** — rewritten to keep the promise that matters (rights are honored for
anyone who asks, whoever they are) without naming a regime Curfew has not
undertaken.

### G — [Low] Export and deletion requests were pointed at two different inboxes

Customer-facing: `privacy/page.tsx:170` and `terms/page.tsx:105` both send
people to **support@curfew.vip**.

Operator-facing: `ACCOUNT-DELETION-EXPORT-RUNBOOK.md` §1 and §3 step 4 say
requests arrive at and exports go out from **admin@curfew.vip**, on the stated
premise that "there is no support inbox, form, or in-app link yet." That
premise expired — launch-checklist §0 records `support@` as provisioned.

If those are different mailboxes, a deletion request lands where nobody is
watching, and the page promising a person handles it is wrong.

**Fixed** — runbook updated to `support@curfew.vip`.

### H — [Info] Age floor of 16 is stricter than US law requires

`terms/page.tsx:87` sets 16. COPPA's line is 13. The 16 appears to be a
GDPR-era number that arrived with the original drafting.

**No change.** Stricter is safe, and lowering it buys nothing. Recorded only so
it is not rediscovered as a defect.

### I — [Info] The load-bearing factual claims were verified true, not assumed

The privacy policy's persuasive weight rests on a handful of claims about what
the software does. This review checked each against source rather than against
the page's own header comment:

| Claim | Verified against |
| --- | --- |
| Crash reports carry no personal data | `web/lib/sentry-shared.ts:33` — `sendDefaultPii: false` |
| Music files never leave the laptop | No audio or file-upload path exists in the sync contract |
| Sets are private to the account | RLS isolation, AD-7/AD-8 |
| The named non-session cookie is real | `web/lib/supabase/phone-gate.ts:11` — `curfew_phone_on_file` |

This is the part of the policy most likely to become false by accident, because
each claim is one careless commit away. `sentry-shared.ts` is the fragile one —
flipping `sendDefaultPii` to `true` would silently falsify a published privacy
policy, and the file's existing comment already says it and the policy move
together.

---

## Ready to paste — the governing law clause

Blocked on one fact. Fill the state, drop it into `terms/page.tsx` as a section
between `as-is` and `changes`, and 1.7 is fully closed.

```tsx
{
  id: "governing-law",
  title: "Which law applies",
  body: (
    <>
      <LegalP>
        These terms are governed by the laws of the State of ______, without
        regard to its conflict-of-laws rules. Any dispute that can&rsquo;t be
        settled by writing to us belongs in the state or federal courts sitting
        in ______, and we each agree to appear there. Nothing here takes away a
        right your home state gives you that it says can&rsquo;t be given up.
      </LegalP>
    </>
  ),
},
```

The last sentence is not filler — several states void a choice-of-law clause
that strips their own consumer protections, and conceding it up front is what
keeps the rest of the clause standing.

---

## What was deliberately not fixed

- **No legal entity.** Ruled accepted risk 2026-08-18 (Arjun): sole proprietor,
  launch anyway. Recorded in launch-checklist §3. The practical consequence is
  that `terms` §"What Curfew promises" caps liability for a party that has no
  corporate shield behind the cap — the cap is a contract term and still binds
  the customer, but there is no entity between a judgment and personal assets.
  Forming an LLC is the fix and it is a business decision, not a checklist item.
- **No postal address published.** Follows from the above, and is only actually
  required once commercial email sends (finding A). Gated with the rest of A.
- **The marketing grant stays broader than what is built.** Ruled above.
  Gated, not fixed.
