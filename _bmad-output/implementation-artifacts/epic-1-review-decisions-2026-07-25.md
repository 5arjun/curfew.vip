# Epic 1 Review — Decisions & Carried-Forward Findings (2026-07-25)

Source: pre-retrospective review of Epic 1 ("Foundation & Proven Parsing"), run adversarially with Arjun. This is the durable record of decisions made in that session so they propagate into the PRD / epics / story specs during the Epic 1 retrospective (and Epic 2 story creation) rather than evaporating. Nothing here rewrites a PRD FR yet — the retrospective / `bmad-correct-course` pass owns careful propagation. This file is the source of truth for *what* was decided and *why*.

## Verification status (as of 2026-07-25)

Gate re-run locally on macOS (rustup toolchain at `~/.rustup/toolchains/stable-aarch64-apple-darwin`, not on default PATH):

- `cargo fmt --check` clean · `cargo clippy --all-targets -D warnings` clean · `cargo test` **136 passed / 0 failed**
- `pnpm -r lint / typecheck / build / test` clean · **13 shared TS tests** pass
- Frozen schema `sync-payload.schema.json` is **byte-identical** to `sync-payload.schema.frozen-baseline.json` (clean freeze; additive-only guard armed)
- No `DRAFT`/`TODO`/`FIXME`/`unimplemented!` in shipped `agent/src-tauri/src` or `shared/src`
- Working tree clean

All 11 Epic 1 stories (1.1–1.10 + 1.3b) are `done`. Epic 1 is complete and green. Caveat for the retro: several dev-log "gate green" claims were written from a Windows box with **no Rust toolchain** (esp. 1.6), deferring the real gate to CI/macOS. Reproduced green today, but "gate green" in a dev log has not consistently meant "run on this machine." **Retro action:** make the gate a hard local precondition, or treat CI as the sole source of truth.

---

## DECISION A — Launch ingestion is go-forward only (no historical backfill)

**Decision (Arjun, 2026-07-25):** At launch, the agent captures and analyzes **only sessions completed *after* the DJ subscribes.** We do **not** bulk-import the pre-existing `History/Sessions/` folder or the `master.sqlite` play history. There is no one-time historical backfill of past sets. Day 1 of a subscription, session data is an empty page that fills as the DJ plays.

**Scope of the constraint — two data sources, two rules:**
- **Session history / play log** → *go-forward only.* The thing Decision A governs.
- **Library metadata DB** (`database V2` / `master.sqlite` catalogue) → **still read live** for metadata enrichment (BPM/key/genre) of go-forward plays, and it still carries library **add-dates** (`tadd`/`uadd`). We are blind to *"was this track ever played"* pre-subscription — not blind to *"when did it enter the library."*

**Dev-time note:** coding against Arjun's full real library/history (~489 sessions, 930-track catalogue) is a **dev fixture**, not launch behavior — it stands in for "a DJ six months in" so we can see a populated ("cooked") dashboard without waiting months. Never confuse the fixture for the launch experience.

**Rationale / why this is logically *good*, not just a limitation:**
- Consistent with the privacy pitch (raw stays on-machine; only what you let cross, crosses). Reaching back into years of history to seed a baseline is off-brand and off-constraint.
- **It is the strongest retention asset, and it fell out of the constraint for free:** because we *never* backfill, **canceling puts a permanent, unfillable gap in the DJ's own evolution timeline.** They don't lose their past when they leave — they scar their future, and we cannot patch it even if they ask. Continuity itself becomes the product; Style Evolution (FR-9) only means something across an unbroken subscription. That is a far stronger reason to keep paying than any single feature.
- **Honest caveat (do not bank the dividend yet):** the moat is only real if per-set reflection is already habit-forming — i.e. SM-2 ("personal value stands alone"), which is *unproven*. If the dashboard is vanity, nobody fears the gap. Build the frame that will collect the dividend; don't assume it's collected.

**Downstream impacts (propagate in retro / Epic 2 & 3 & 4 story work):**
1. **The empty/sparse dashboard IS the launch experience.** Every current artifact depicts a rich, populated dashboard — that is a *lie about launch*. Epic 3 UX must be **designed sparse-first**; the copy/frame must *mature as the data accrues* (week-one voice ≠ month-six voice). Do not ship the month-six dashboard to a day-one user.
2. De-risks several Epic 1 deferred items: the AR-2 "don't duplicate on backfill" anxiety softens (no backfill at launch; idempotency still matters for go-forward re-parse), and the volume-hosted historical-path / 865-play historical-confidence edges matter *less* at launch (properties of old data we're not ingesting).

**PROPAGATION TARGETS:** PRD §1/§3 (launch ingestion behavior + Glossary "played"); Architecture Spine (AR-2 backfill framing — note backfill is a re-parse/format-drift mechanism, *not* a historical import); epics.md Overview + Epic 3 UX stories (sparse-first) + Epic 4 (see Decision B).

---

## DECISION B — Epic 4 "played" = played-on-Curfew; reframe the copy (never a receipt)

**Decision (Arjun, 2026-07-25):** In Epic 4, **"played" means "played in a session Curfew captured"** (go-forward), *not* lifetime play history. All temporal framing is **accumulated-history-as-asset, never elapsed-time-as-cost.**

**The copy rule (binding on all Epic 4 + dashboard surfaces):**
- **Never** surface elapsed subscription time as cost — no *"since you joined,"* no *"in your 7 months,"* nothing that lets the DJ tally cumulative spend. That is a self-installed churn button.
- **Do** frame the go-forward record as **theirs** — *"your history / your evolution / your Curfew record."* Same query, opposite feeling (Spotify-Wrapped framing: "here's your year," never "you paid us 12 times").
- The frame must **earn out over time** — week one *"your first sets are landing,"* month six *"here's your evolution."* Dressing an empty chart as a rich record is its own dishonesty.

**Per-story impact (Epic 4) — cold-start honesty triage:**
- **4.2 Library-to-setlist correlation (FR-10):** mostly survives — it's about *recently-added* tracks appearing in *captured* sets. Add-date from the library DB is fine. Frame relative to Curfew history.
- **4.3 Conversion rate (FR-11):** survives with reframe — *"% of recently-added library tracks you've played **on Curfew** in the rolling 90-day window."* Will read artificially low at launch and climb; the 90-day window naturally limits the damage. Say the frame out loud (already an AC).
- **4.4 Aging shelf (FR-12):** **cold-start-broken as written.** "unplayed 3+ months (from add date or **last play**)" — "last play" is go-forward-only, so at launch a heavily-played veteran's catalogue is *falsely* all-aging. **Re-spec:** either gate until enough go-forward history accrues, or reframe to *"tracks you haven't played **on Curfew** since joining"* and make the empty/warm-up state the default first-run view. Must not present go-forward silence as a lifetime "unplayed" fact.
- **4.5 Time-to-first-play (FR-13):** **may not survive at launch.** "(first-play − add)" needs lifetime first-play, which is unknowable go-forward; for an old track, "first play on Curfew" is a garbage number. **Re-spec:** restrict to tracks *added after subscribing* (honest debut measurement) and/or defer the aggregate until warm-up. Flag explicitly as "wait for warm-up or re-spec."

**Governing principle:** a feature works honestly at launch **iff** it needs only *(add-date + go-forward plays)*. A feature that needs *a play we never saw* does not — reframe it or gate it. That is the line Epic 4 stories must be re-sorted against.

**PROPAGATION TARGETS:** PRD FR-10/11/12/13 + Glossary ("played"); epics.md Epic 4 Stories 4.2–4.5 ACs; UX EXPERIENCE.md (Epic 4 states + copy); a project-wide copy rule ("history-as-asset, never receipt").

---

## Epic 1 carried-forward findings — triaged with firing triggers

Filed with *triggers*, not "someday." A precondition with a trigger is not deferral; a precondition without one is.

| # | Finding | Decision | Trigger (fires when…) |
|---|---|---|---|
| 1 | `enrich_session` pairing rests on an untested cross-module `ORDER BY` invariant; `EnrichedPlay` lacks `in_library` that `SyncPlay` requires | **Correlation-keyed pairing** (Serato-4+: `history_entry.id`; legacy: file-order index). **Assert-and-degrade, not assert-and-die:** on desync, log loud + tag `agent_version` + fall back to positional zip, raw retained in local SQLite (AD-13 net makes both loud *and* not-broken). Payload glue reads `EnrichedPlay` + its paired `JoinedMetadata.in_library` by pair. | Story 2.8 wires the real `parser→joiner→stats→payload` pipeline |
| 2 | `sync_payload_schema_path()` uses `env!("CARGO_MANIFEST_DIR")` — a build-machine path absent on a bundled agent | **Reclassified from nit to functional blocker** — sync is broken on every installed copy the instant we bundle. Embed the schema as a compile-time resource. | Definition-of-done on the first build/bundle story (Epic 2, AR-14) |
| 3 | `csp: null` in `tauri.conf.json` baseline | Set a **restrictive CSP in the agent-shell baseline story, before capture loads any file content.** Hardening (do it early because a null CSP never gets tightened later), not a launch-blocker. | Story 2.5 agent shell / before 2.8 capture loads local files |
| 4 | Confidence thresholds eyeballed vs one DJ's 489 sessions (35.6% score LOW); 865-play/27.5-min rapid-preview edge scores same as a normal dense set (no density ceiling) | **Freeze as-is, do-not-touch.** Tuning on one DJ is theater; per-DJ calibration (AD-17) has no fleet yet. Contract stores raw `value` + reversible at read time, so the number is cosmetic and the *shape* is right. 865-play blind spot gets **one sentence** in Story 4.1 as a known limitation. | Real recalibration waits for Epic 4 + fleet data |
| 5 | Serato-4+ `in_library` hardcoded `true` (spine deviation vs "never guessed") | Stays `true` **today** (real signal `asset_id > 0` resolves only ~4.6% off one profile — not trustworthy enough to ship). Promote from buried ledger line to an **explicit owned open question**; needs a **2nd real profile** before trusting. | **Before Epic 3 renders the in-library/off-library badge** (a visible lie, not an invisible one) |

**Genuinely fine to defer (real triggers already exist, no decision forced today):** NFR-1 perf targets still `[ASSUMPTION]` (confirm at Story 2.8's first end-to-end pipeline benchmark); genre taxonomy content gaps + fold brittleness (degrade only to "Other," bump `TAXONOMY_VERSION` on a real genre histogram); `sane_bpm` upper bound (product call once consumed); no real ajv round-trip on `SyncPayload` (close in Epic 3 when cloud validates on receive); `TrackIdentity` `(title,artist)` collision for pathless Serato-4+ plays.

**Additive-only heads-up for Epic 4:** raw file `path` was (correctly) excluded from the frozen wire for privacy; FR-10 library-to-setlist correlation will need a purpose-built opaque per-track identity field — additive, no re-freeze, but flag in the Epic 4 story that first needs it.
