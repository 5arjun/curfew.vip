# Adversarial Review — ARCHITECTURE-SPINE.md (Curfew)

**Lens:** Construct two units one level down that each obey every AD to the letter yet still build incompatibly. Every such pair is a hole the spine must close.

**Verdict: HOLES-FOUND.** Seven collisions where both units are AD-compliant yet diverge. The spine is strong on the *transport* seam (AD-2/AD-3/AD-4-idempotency-mechanics) and the *isolation* seam (AD-7/AD-8). The holes cluster where a single logical fact is split across the agent↔cloud boundary and no AD names the owner of the *re-derivation* or the *merge* — set-vs-session identity, the `sets` row's mixed columns, segment-scoped compute, taxonomy re-normalization, and account linking.

Findings are ordered by severity. Each names the two concrete units, the exact state, and the incompatible outcome.

---

## H1 — `set_id` is derived from *session* identity, but overlays are keyed to *set* identity; backfill re-derivation orphans them and resets visibility to public

**AD compliance:** AD-4 (deterministic `set_id` from "stable session identity"), AD-13 (backfill after a parser fix), AD-6 (overlays cloud-only), AD-9 (default public). All obeyed.

**Unit A — agent backfill playbook.** After a set-boundary-detection fix (Open Question #1 is explicitly *unvalidated* against real multi-track gigs), the agent re-parses a retained raw session (AD-13/AD-5) and re-syncs via idempotent `PUT /sets/:set_id`.

**Unit B — web set-detail overlays.** A DJ previously drew 3 segments (FR-14), added enrichment (FR-16), hid one unreleased edit (FR-22), and set the set to **private** (FR-23) — all cloud-only, keyed to the original `set_id`.

**The collision.** AD-4 conflates *Session* and *Set* identity, but the Glossary itself says set-detection may split one Session into multiple Sets (or merge). The moment a parser fix changes boundary detection, the re-parse mints a **different** `set_id` (one session → now two sets, or a shifted sub-index). AD-4's idempotency guarantee holds only while the *set decomposition* of a session is stable — which the spine's own Open Question #1 says it is not. Result: the backfill writes a *new* set row; the old `set_id` (carrying the private tier, the hidden track, the segments, the enrichment) is orphaned, and the new set syncs under AD-9's **public** default. A set the DJ marked private with a redacted track silently becomes a fully-visible public set. This is simultaneously an idempotency hole, an offline/backfill divergence, and a redaction leak.

**Suggested fix — new AD (or tighten AD-4):** Separate *session identity* from *set identity*. `set_id` must be stable across re-segmentation: derive a `session_id` deterministically from stable session identity, and treat set boundaries as *cloud-side, re-assignable* metadata over an immutable ordered play-stream — never a component of the sync primary key. Backfill updates plays under a fixed `session_id`; it must never orphan or re-default overlays. State explicitly that no agent write may change a set's visibility tier.

---

## H2 — Two owners of the `sets` row: the agent's idempotent PUT (content) and the web's overlay writes (visibility/enrichment) — but the PUT is never declared column-scoped

**AD compliance:** AD-4 (agent's only write is idempotent `PUT /sets/:set_id`), AD-6 (overlays authored on web, cloud-only), AD-8 (web mutations via Supabase/RLS), AD-5 ("one owner per data class"). All obeyed.

**Unit A — agent sync-queue.** Emits the full derived set document and PUTs it. A literal idempotent PUT is a *whole-resource replace*.

**Unit B — web account/privacy panel.** Writes `visibility` and enrichment onto the same set (AD-8). The ER seed says "enrichment, hide, and visibility are cloud-only overlays" but does not say whether `visibility` is a **column on `sets`** or a separate table — and the `derived` jsonb render-cache *is* a column on `sets`.

**The collision.** If visibility/enrichment live as columns on `sets` (the natural reading, since AD-6 lists them as overlays *on the set* and only `segments` is given its own table in the ER), then the agent (content owner) and the web (overlay owner) are **two writers to one row**. AD-5 resolves ownership only at the granularity of "data class," not column/table — so a compliant idempotent PUT that replaces the row clobbers the web-authored `visibility`/enrichment on every re-sync (and every AD-13 backfill triggers a re-sync). AD-6 asserts overlays are "never written back to the agent" but says nothing about the agent's forward write not *overwriting* them.

**Suggested fix — tighten AD-5/AD-6:** State that agent-owned content and web-owned overlays occupy **disjoint physical columns/tables**, and that the sync write is an **explicit column-scoped upsert of content columns only** (never a whole-row replace). Make it a contract test in `shared/`: the sync payload schema must not be able to express visibility/enrichment.

---

## H3 — Segment-scoped stats (FR-15) have no compliant place to be computed: the edge lacks the segments, the cloud is forbidden from computing DJ stats

**AD compliance:** AD-1 (all per-set/per-DJ stat computation happens on the agent; cloud "never recomputes a DJ's own stats"; the *only* exception is cross-DJ scene aggregates), AD-6 (segments authored on web, cloud-only, never written back to the agent). Both obeyed.

**Unit A — agent stat-engine.** Computes the `derived` render-cache at sync time. But segments do not exist at sync time — they are authored *later* on the web (AD-6) and are *never sent back to the agent* (AD-6). So the edge physically cannot compute per-segment stats.

**Unit B — web set-detail.** Renders FR-15: FR-6/FR-7 stats *sliced by segment* — most-played, genre breakdown, BPM distribution, Camelot compat, and energy arc restricted to a segment's `[t0,t1]`. This is re-aggregation of the DJ's own plays over a time window.

**The collision.** Segment-scoped stats are (a) *the DJ's own per-set stats*, which AD-1 hard-assigns to the edge and forbids the cloud from recomputing, yet (b) computable only *after* the segment is drawn in the cloud, over inputs (segment boundaries) the edge is forbidden to receive. The one cloud-compute carve-out in AD-1 is *cross-DJ* aggregates — segment slicing is per-DJ, so it does not qualify. FR-15 therefore has **no AD-compliant home**. Two teams building strictly to the spine will each assume the other computes it, and neither can.

**Suggested fix — tighten AD-1:** Broaden the cloud-compute exception from "cross-DJ aggregates only" to also include **cloud-side re-aggregation of already-derived, already-synced per-play rows over a user-authored slice** (segments, date ranges). Draw the bright line at *derivation from raw Serato data* (edge-only) vs *SQL aggregation over normalized plays* (cloud-allowed) — the current AD-1 wording forbids the latter.

---

## H4 — AD-12 promises taxonomy re-normalization "so trends can be recomputed consistently," but AD-1 forbids the cloud from normalizing — and no edge unit can normalize *another* DJ's plays for a cross-DJ leaderboard

**AD compliance:** AD-12 (store raw + normalized + `taxonomy_version` per play so trends recompute consistently after the table changes), AD-1 (normalization is an edge operation; cloud "never recomputes a DJ's own stats"; cross-DJ aggregates are plain SQL over *shared sets*). Both obeyed.

**Unit A — agent on DJ X**, running an older `agent_version` pinned to taxonomy **vN**, syncs plays with `normalized = f_vN(raw)`.

**Unit B — cloud leaderboard SQL (FR-24)**, aggregating genre diversity across DJs. The AD-13 auto-updater rolls out over time, so DJ Y is already on **v(N+1)** with `normalized = f_v(N+1)(raw)`. The fleet is *inherently heterogeneous*.

**The collision.** FR-24 does `GROUP BY normalized_genre` across DJs, but DJ X's and DJ Y's normalized values were produced by *different tables*, so identical raw strings land in different buckets — the leaderboard silently miscounts. AD-12's stated remedy is "recompute consistently after the table changes," but recompute means re-mapping `raw → normalized` under one table version. The edge can only re-normalize *its own* sets (backfill), never another DJ's — so it cannot make a *cross-DJ* query consistent. And AD-1 explicitly forbids the cloud from doing normalization. So the `taxonomy_version` column, stored precisely for cross-consistency, has **no owner able to use it** in the cross-DJ path. AD-12 and AD-1 are in direct contradiction the moment consistency must span DJs rather than span time for one DJ.

**Suggested fix — reconcile AD-1 and AD-12:** Carve an explicit exception: **re-mapping an already-stored `raw` genre string to `normalized` under a newer table is a pure lookup, not "parsing" or "stat recomputation," and MAY run in the cloud** (a SQL join against a versioned mapping table the cloud holds). Require every cross-DJ aggregate to pin a single `taxonomy_version` (re-map on read) rather than trusting the frozen per-play `normalized`. Otherwise move the mapping table server-side entirely and treat edge-normalization as a cache.

---

## H5 — `set_id` is not namespaced by `dj_id`; a shared USB library or B2B session gets claimed by the wrong DJ, or collides and becomes permanently unsyncable

**AD compliance:** AD-4 (`set_id` deterministic from session identity), AD-1/FR-1 (agent scans *connected removable/USB volumes* for a Serato directory), AD-7 (RLS: `auth.uid() = dj_id`). All obeyed.

**Unit A — DJ P's agent.** DJ P keeps their whole Serato library on a USB (a first-class case per FR-1). They play a set; the session file lives on the USB. Agent computes `set_id = h(session identity)` and syncs under `dj_P`.

**Unit B — DJ Q's agent.** DJ Q later plugs the *same USB* into their laptop (B2B night, borrowed stick, shared studio drive — all real DJ-culture cases). AD-1 says the agent scans removable volumes and resumes watching. DJ Q's agent parses P's session file, computes the *same deterministic* `set_id`, and attempts `PUT /sets/:set_id` under `dj_Q`.

**The collision.** Because `set_id` derives from session content only — not from `dj_id` — the two DJs' agents produce the *same* key. Two outcomes, both bad: (a) if `set_id` is the global primary key, DJ Q's PUT is either rejected by AD-7 RLS (the row belongs to `dj_P`) — so DJ Q's real set can *never* sync, silent data loss — or it upserts P's row; (b) if the row is namespaced only at read time, P's set now exists under two owners. The spine never establishes *which DJ a session belongs to*, nor that `set_id` is scoped per account.

**Suggested fix — tighten AD-4 + Conventions:** `set_id` must incorporate `dj_id` (e.g. `set_id = h(dj_id, session_identity)`), making the key namespace per-account and closing both the cross-DJ collision and the unsyncable-set trap. Add a Convention: a session's owner is the *authenticated agent that parsed it*, and re-parsing another account's session under a new owner is a *new* set, not an idempotent update of the original.

---

## H6 — Account-linking race (AD-10): separate provider identities produce two `dj_id`s; agent-synced sets get stranded from the web session, with no re-owner path

**AD compliance:** AD-10 (four sign-in paths "link to one `dj` account by verified email"; `djs` 1:1 with `auth.users`; agent token in Tauri secure storage), AD-7 (RLS `auth.uid() = dj_id`), AD-4 (deterministic `set_id`). All obeyed as *stated*.

**Unit A — agent.** Authenticated months ago via Google (`dj@x.com`), holds a refresh token in Tauri secure storage, has synced 40 sets under `dj_id_G`.

**Unit B — web.** The DJ, half-asleep post-gig (the PRD's own framing), signs in via passkey/email+password. GoTrue does **not** auto-merge provider identities by verified email out of the box — it commonly creates a *second* `auth.users` row → a second `djs` row → `dj_id_E`.

**The collision.** AD-10 *asserts* "link by verified email" as an invariant but does not mechanize *when* linking happens relative to sets already synced, nor what happens to the agent's cached token if a merge occurs. If two accounts exist, AD-7 RLS (`auth.uid() = dj_id`) now *hides the DJ's own 40 sets from themselves* on the web session (`dj_id_E` sees nothing; the sets are under `dj_id_G`). Worse, there is no compliant *merge path*: the agent's only write is a PUT under its own JWT (AD-4/AD-8), so it cannot re-own rows; RLS forbids any cross-`dj_id` write; and there is no admin re-owner op in the spine. A late link strands the entire history.

**Suggested fix — tighten AD-10:** Specify that identity linking is enforced **at the auth layer before any `djs` row is minted** (a `djs` row is created only after email-verification resolves to a single canonical identity), and define the *merge/re-owner* operation for the case where two identities already exist (a privileged, audited server function that re-assigns `dj_id` on `sets`/`plays` — the one sanctioned exception to "agent's only write" and to RLS). Name what happens to the agent's cached refresh token on merge (force re-auth / re-point to canonical `dj_id`).

---

## H7 — Phase 1 sets synced under AD-9's public default become retroactively feed-visible the instant Phase 2's read-policies ship

**AD compliance:** AD-9 (default on sync is **public**; "in Phase 1 every set is dashboard-only regardless of tier"), AD-15 (Phase 2 is *additive* — it adds RLS read-policies and Realtime subscriptions, never restructures). Both obeyed.

**Unit A — Phase 1 sync.** Every set for months syncs with the default visibility. AD-9 says the default is public and that Phase 1 enforcement is "dashboard-only regardless of tier" — i.e. the *stored* tier is public, merely unenforced because no read-policy consumes it yet.

**Unit B — Phase 2 feed.** AD-15 lands the additive public/friends read-policy over the *existing* `sets` table.

**The collision.** The additive read-policy immediately exposes the entire Phase 1 back-catalog — every set a DJ ever played — to the network on launch day. UJ-4's "review before your circle sees it" only protects *new* sets going forward; it gives no DJ a chance to redact history before the switch flips. A DJ who never conceived of their practice-and-gig history as public (Phase 1 sold it as a private mirror, Vision §1) is bulk-exposed. Both units are compliant; the seam between them is a privacy event.

**Suggested fix — tighten AD-15/AD-9:** State that Phase 1 sets persist with an **unlisted/private** effective tier and that Phase 2's read-policy exposes a set only after the DJ takes an explicit opt-in (or an explicit "publish my history" review flow) — i.e. the "public default" applies to sets synced *after* the feed exists, never retroactively. Make retroactive exposure a named, gated migration, not a side effect of adding a policy.

---

## Dimensions checked and found sound (no new hole)

- **Raw-data boundary (AD-2):** clean — raw files never cross the wire; capability-scoped FS access is unambiguous.
- **Contract fork (AD-3):** the single-monorepo + dual-side validation genuinely prevents agent/web shape drift *for the payload* (the residual issues H1/H2 are about *identity and column ownership*, not the wire schema).
- **RLS null-safety (AD-7):** the `auth.uid() IS NOT NULL AND …` framing correctly closes the anon-null-equals-null leak.
- **Modular-monolith / no bespoke server (AD-8/AD-14):** consistent; PostgREST + Realtime leaves no room for an RLS-bypassing write server — provided H6's merge op is defined as the single sanctioned exception rather than an ad-hoc backdoor.

---

## Summary of required spine changes

| # | Hole | AD to add / tighten |
|---|------|---------------------|
| H1 | set_id = session identity breaks under re-segmentation → orphaned overlays + visibility reset | New AD: separate `session_id` (key) from set boundaries (cloud-side, re-assignable); no agent write may alter a tier |
| H2 | Agent PUT and web overlays are two writers to the `sets` row | Tighten AD-5/AD-6: disjoint columns; sync is a content-only column-scoped upsert (contract-tested) |
| H3 | Segment-scoped stats (FR-15) computable nowhere: edge lacks segments, cloud forbidden | Tighten AD-1: allow cloud SQL re-aggregation over synced plays for user slices |
| H4 | AD-12 recompute promise vs AD-1 no-cloud-normalization; cross-DJ leaderboards mix taxonomy versions | Reconcile AD-1/AD-12: re-map raw→normalized is a cloud-legal lookup; aggregates pin one `taxonomy_version` |
| H5 | `set_id` not namespaced by `dj_id` → shared-USB/B2B session mis-claimed or unsyncable | Tighten AD-4: `set_id = h(dj_id, session_identity)`; define session ownership |
| H6 | Account-linking race → two `dj_id`s → stranded history, no merge path | Tighten AD-10: link before `djs` row minted; define audited re-owner op + agent token handling |
| H7 | Phase 1 public-default sets bulk-exposed when Phase 2 read-policies ship | Tighten AD-15/AD-9: Phase 1 sets effectively unlisted; retroactive exposure is a gated opt-in migration |
