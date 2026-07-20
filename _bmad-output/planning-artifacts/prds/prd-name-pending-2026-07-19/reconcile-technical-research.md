# Reconciliation: Technical Architecture Research vs. PRD + Addendum

**Input reconciled:** `_bmad-output/planning-artifacts/research/technical-dj-stats-platform-end-to-end-system-architecture-serato-app-web-research-2026-07-17.md`
**Against:** `prd.md` + `addendum.md` (both dated 2026-07-19, same folder)
**Scope of this pass:** remaining ADRs, risk-register items, and constraints from the research that are still unreflected anywhere in the PRD or addendum, filtered to what a PM/architect reading the PRD next would actually need — not exhaustive tech-stack minutiae already appropriately parked in `addendum.md`.

**Overall:** the addendum did heavy, accurate lifting from this research — ADR-1 through ADR-5, the sync payload shape, RLS isolation, path-join complexity, format-drift mitigation, and code-signing platform requirements are all faithfully carried over, and the PRD's Open Questions/Assumptions Index correctly surface the two big unresolved technical gates (O-3 date-added field, O-4 segmentation). The gaps below are what's left over after that reconciliation.

---

## Gap 1 — Code-signing is the research's "dominant fixed cost," but the PRD's Cost section doesn't mention it

**Research basis:** The synthesis is explicit and repeated: *"The dominant fixed costs are the two code-signing identities, not infrastructure. Infra is near-free until meaningful scale because the expensive compute lives on the edge."* The cost table lists the Apple Developer Program (paid annual membership) and a Windows OV/EV code-signing cert as the two real fixed-cost line items, both flagged `[ANALYST ESTIMATE — confirm current fee before budgeting]`. The research's own Next Steps lists "confirm current Apple + Windows signing costs" as an explicit action item.

**What's in the PRD/addendum now:** PRD §5.3 (Cost NFR) only says *"No paid AI/ML API required anywhere in the core product... keeping marginal per-DJ cost near zero."* That answers a different question (marginal/API cost) than the one the research flags as dominant (fixed/upfront cost). The addendum's "Platform / Code-Signing" section describes the *technical requirement* but never frames it as a cost line, and neither §11 Open Questions nor §12 Assumptions Index carries "confirm current signing fees before budgeting" forward.

**Why it matters to a PM:** solo-founder runway information, not architecture minutiae — before committing to build, Arjun should know the two certificates (not hosting, not Supabase, not AI) are the project's real fixed-cost gate, with figures still unconfirmed.

**Suggested fix:** Add a line to PRD §5.3 or §7 noting fixed launch costs (Apple Developer Program + Windows signing cert) as a pre-launch budget item; add "confirm current Apple/Windows signing costs" to §11 or §12.

---

## Gap 2 — The competitive/strategic risk ("unbox" commoditizes read-and-display; the moat is the network, not the parsing) isn't referenced anywhere

**Research basis:** The consolidated risk register carries a "Strategic" severity risk: *"`unbox` (364★) fast-follower commoditizes read+display"* — mitigated only by *"Moat is the scene network, not parsing (market research)."* The executive summary repeats this as load-bearing: *"The architecture is not itself the moat... read-and-display is commoditized... the differentiation the architecture enables is (a) cost structure... and (b) a rewrite-free path to the scene network, where the actual moat (network effects) lives."*

**What's in the PRD/addendum now:** No mention of `unbox`, of parsing/read-display being commoditized, or of network-effects-as-moat, anywhere in the PRD or addendum. Vision §1 *arrives at* a compatible posture — prioritizing DJ critical mass, social layered on a DJ-first core — but never states the competitive reasoning behind it, so a reader can't tell whether that prioritization was a deliberate response to this risk or an independent call.

**Why it matters to a PM/architect:** this is the one piece of competitive context that directly argues *why* V1 should not over-invest in parsing polish relative to social/network features, and *why* critical mass (SM-3, SM-4) is a primary rather than secondary success metric. Losing that reasoning risks a later planning pass re-litigating "make parsing bulletproof" vs. "get DJs following each other" without the context for why the research weighted toward the latter.

**Suggested fix:** A short line in Vision §1 or a new Open Question/Assumption noting the competitive framing (lightweight Serato-read tools already exist; the differentiator is the social layer, not parsing depth) would preserve this reasoning for downstream architecture/roadmap decisions.

---

## Gap 3 — The research's phased "riskiest-first, local-only-first" build roadmap isn't reflected in MVP Scope

**Research basis:** The Implementation/Roadmap sections lay out explicit sequencing: Phase 0 (parser core, offline, no infra/certs) → Phase 1 (signed local-only Tauri app, "shippable to early users," Topology A, validates UX before any cloud/cert spend) → Phase 2 (Supabase sync, Topology B) → Phase 3 (scene network/social). Stated rationale: *"This lets you validate the hardest technical risk (parsing/stats on real data) before spending on infrastructure or certificates."* This is a top-3 "Next Steps" recommendation in the conclusion.

**What's in the PRD/addendum now:** PRD §9 (MVP Scope) lists the full V1 feature set — parsing/sync, dashboard, style evolution, library utilization, segments, Layer 2 enrichment, social feed, privacy, comparisons — as one undifferentiated in-scope bucket, with no acknowledgment of the research's recommended internal build phasing, and no explicit decision to *reject* that phasing in favor of one release.

**Why it matters to a PM:** given Arjun is a solo builder (PRD §0) and given Gap 1 (certs are the dominant fixed cost), the research's specific recommendation — prove parsing on real data with zero infra/cert spend before building the cloud/social tier — is directly actionable sequencing advice, not an architecture nicety. Worth carrying into either the PRD's rollout thinking or the next epics/sprint-planning stage.

**Suggested fix:** Fold a note into §9 framing internal build phasing as a downstream (epics/sprint-planning) decision, or add an Open Question naming the research's local-first-before-cloud build sequence as an option to evaluate at that stage.

---

## Gap 4 — `triseratops` risk-register item only partially carried forward (pinning *and* licensing caveat both dropped)

**Research basis:** Two distinct cautions attach to the `triseratops` crate, both from the research's own resolution of Open Item O-2:
- Risk register: *"`triseratops` breaking API changes | Low-Med | Pin version; gate upgrades behind golden-file tests"* — the crate is under "heavy development, breaking API changes" per its own README.
- The O-2 license resolution itself is explicitly hedged, not a clean settlement: *"`[ANALYST ESTIMATE — MPL-2.0 compatibility reasoning; confirm with counsel before shipping commercially, and pin the triseratops version given its "breaking API changes" warning.]`"* — and this is repeated as one of only two "open cost/legal items" in the Next Steps (paired with Gap 1's signing costs).

**What's in the PRD/addendum now:** The addendum's "Local Agent" section states `triseratops (Rust, MPL-2.0)` as settled fact, with neither the "pin version, gate upgrades" mitigation nor the "confirm with counsel before shipping commercially" caveat carried forward. Nothing tracks either item in PRD Open Questions or Assumptions Index.

**Why it matters:** lower stakes than Gaps 1–3, but this is a named risk-register item with two concrete, cheap mitigations (pin+gate; counsel confirmation) that the research itself declined to fully close — currently the addendum presents the license question as more resolved than the source research intended.

**Suggested fix:** Add "pin `triseratops` version; gate upgrades behind golden-file tests" and "MPL-2.0 use not yet confirmed with counsel" as bullets under the addendum's relevant sections (Local Agent / Format-Drift Mitigation). PRD-level change not needed unless Arjun wants legal review tracked in §11.

---

## Gap 5 — Cross-DJ track-identity/dedup scope is ambiguous for network-wide comparisons

**Research basis:** The research's proposed cloud schema includes an optional `track_identity` table specifically to enable **track-level, cross-DJ scene aggregates** — its own example is *"most-played track in your city this month"* — noting this requires normalizing/deduplicating tracks across independently-tagged libraries, a distinct and nontrivial engineering problem from DJ-level aggregates (BPM range, genre diversity) that don't require matching one DJ's track to another's.

**What's in the PRD/addendum now:** FR-24 (network-wide leaderboards) gives "widest BPM range this month, genre diversity" as examples — both DJ-level aggregates, no track identity needed. Nothing in the PRD, addendum, Open Questions, or Non-Goals states whether track-level cross-DJ stats (e.g., "most-played track in the network this month") are in or out of scope for FR-24/FR-25.

**Why it matters to a PM/architect:** if a track-level network stat is ever assumed in-scope under FR-24 without this being flagged, it silently pulls in fuzzy artist/title matching across catalogs — a materially harder engineering problem than the aggregate-only stats currently exemplified in the FR.

**Suggested fix:** Either explicitly exclude track-level cross-DJ stats from V1 (add to §8 Non-Goals) or note the `track_identity`/dedup dependency in FR-24's consequences if such a stat is ever intended.

---

## Considered, not flagged as a full gap

- **Production/field-level format-drift detection.** The research's mitigation for its highest-severity risk (Serato format change) includes not just golden-file CI (pre-release, carried into PRD §5.4/FR-1 NFR) but also runtime observability — *"app-level error reporting in the agent (e.g. Sentry) is the key signal... `agent_version` on every synced set lets you correlate failures to versions"* — plus an incident playbook (detect via parse-error spike, patch, backfill from local SQLite). None of this runtime-detection half is carried forward, and the addendum's sync-payload field list also omits the `agent_version` field the research's example payload includes for exactly this purpose. This sits close to the addendum-minutiae line, but is flagged here as worth a one-line addition to addendum's "Format-Drift Mitigation" given it completes the mitigation story for the research's one High-severity risk.

---

## Explicitly checked and found NOT to be gaps (already reconciled)

- ADR-1–ADR-5 (Topology B, Tauri/Rust agent, Supabase backend, derived-only payload, post-set batch v1) — all carried into addendum.
- O-3 (path-join/off-library fallback) — carried into addendum "Path-Join Complexity" and PRD FR-2.
- O-4 (segmentation unproven on multi-track data) — carried into PRD FR-1/FR-27/FR-28 notes, §10 SM-1, §11 Open Question #1.
- RLS/per-DJ isolation — carried into addendum + PRD §5.2.
- Code-signing *technical* requirements (Developer ID/notarization, Windows SmartScreen/EV-OV) — carried into addendum "Platform / Code-Signing" (cost framing is the gap, not the technical requirement — see Gap 1).
- Formal privacy/compliance review recommendation — carried into PRD §5.2 NOTE FOR PM and §11 Open Question #4.
- Reverse-geocoding provider selection deferred to architecture — carried into addendum + PRD §9.2/§11 Open Question #6.
- "Date added to library" field unconfirmed — carried into addendum + PRD FR-11–13 notes, §11 Open Question #3, §12 Assumptions Index.
- "Now playing" live-presence feature — research tags its own live-watch idea `[defer to post-MVP]`, a speculative nice-to-have rather than a firm deferred decision on par with the PRD's other tracked deferrals; not flagged.
- "CSV export" — research itself calls this a low-priority nice-to-have, not an integration path; consistent with no FR existing for it.
- ADR-6 (modular monolith, not microservices) and other pure implementation-pattern choices (no message queues, no gRPC, no mTLS, CI/CD via `tauri-action`, monorepo layout, hexagonal `SyncClient` abstraction, RLS policy-test practice, team-skills notes) — correctly left as addendum-level/architecture-stage minutiae; not flagged.
