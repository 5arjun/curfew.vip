---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: ['_bmad-output/planning-artifacts/research/domain-serato-history-file-parsing-metadata-research-2026-07-07.md', '_bmad-output/planning-artifacts/research/market-dj-stats-reflection-platform-research-2026-07-07.md', '_bmad-output/planning-artifacts/research/dj-platform-wtp-boundary-survey-2026-07-07.md']
workflowType: 'research'
lastStep: 6
web_research_mode: 'hybrid (WebFetch + user-supplied URLs + labeled analyst estimates); WebSearch disabled environment-wide (IL2/GovCloud)'
research_type: 'technical'
research_topic: 'DJ Stats Platform - End-to-End System Architecture (Serato to App to Web)'
research_goals: 'Define how to build and wire the DJ stats/reflection platform end-to-end: the desktop capture agent the DJ downloads (what it is, how it reads Serato files, live vs post-set), whether/where user data is stored (local-first vs cloud, privacy/ownership), how data flows from Serato on the local machine to a web dashboard, the recommended technology stack (agent, backend, frontend, DB), integration and API patterns, and deployment/hosting topology. Builds on the confirmed parsing feasibility from the Serato domain research.'
user_name: 'Arjun'
date: '2026-07-17'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-17
**Author:** Arjun
**Research Type:** technical

---

## Research Overview

This report defines the **end-to-end system architecture** for the DJ Stats & Reflection Platform — the "how do we actually build and wire this" layer that sits on top of the confirmed parsing feasibility established in the Serato domain research (`domain-serato-history-file-parsing-metadata-research-2026-07-07.md`). That prior report proved the data is extractable with no paid AI (session file = play log; `database V2` = track attributes; key 98.8%, BPM 100%). This report answers the next question: **what does the DJ download, where does their data live, how does it get from Serato on their machine to a web dashboard, and what stack builds it.**

**Central design constraints (carried as facts from prior research):**
- Serato writes its data **only to the DJ's local machine** — therefore *something must run locally*. A local capture component is non-negotiable.
- The session→DB **join requires path normalization** (absolute-vs-relative) and an off-library-play fallback (Open Item O-3).
- The endgame is a **multi-DJ "scene" social network** (per market research) — architecture is weighted to grow into that without a rewrite.

**Decisions locked with the user at scope confirmation (2026-07-17):**
- **Data model:** research all three topologies (fully-local / hybrid local-first / cloud-sync) and recommend.
- **Build priority:** optimize for a stack that **scales into the social network** without a rewrite (while flagging MVP shortcuts at each fork).

**Methodology:** Hybrid, source-verified — identical to the domain research. **WebSearch is disabled environment-wide (IL2/GovCloud)**; all live findings come from **WebFetch of named URLs** (framework docs, GitHub repos, hosting docs), verified and dated. Any claim not live-sourced is labeled `[ANALYST ESTIMATE — needs verification]`. Multi-source corroboration is sought for every build-critical claim.

**Overview of findings (full detail in the synthesis section below):** The platform resolves to a **two-tier "smart edge, thin cloud"** system — a **Tauri 2 (Rust) desktop agent** the DJ downloads, which parses Serato locally and computes all stats on-device (free edge compute, the payoff of the no-paid-AI finding), syncing only **derived data** to a managed **Supabase (Postgres/Auth/Realtime)** backend behind a **Next.js 16** web app. Of three data-model topologies, **hybrid local-first (Topology B)** is recommended: raw files never leave the machine, per-DJ data is isolated at the database layer via Row-Level Security, and sharing is opt-in — the only option that scales into the social-network endgame without a rewrite. The parser is **two jobs** (clean-room `.session` play-log parser + reused `triseratops`/`id3` for track attributes), the dominant fixed cost is **code-signing** (not infrastructure), and the **auto-updater** is the deliberate hedge against Serato's unofficial-format risk. A riskiest-first roadmap ships a useful **local-only app first** (no cloud, no certificates), then layers sync and the scene network. The full executive summary, ADRs, roadmap, risk register, and source register are in the **synthesis section** at the end of this document.

---

## Technical Research Scope Confirmation

**Research Topic:** DJ Stats Platform — End-to-End System Architecture (Serato → App → Web)
**Research Goals:** Define how to build and wire the platform end-to-end: the downloadable desktop capture agent (what it is, how it reads Serato files, live vs post-set), whether/where user data is stored (local-first vs cloud, privacy/ownership), the Serato→website data flow, the recommended technology stack (agent, backend, frontend, DB), integration/API patterns, and deployment/hosting topology.

**Technical Research Scope:**

- **Architecture Analysis** — three topologies compared (fully-local / hybrid local-first / cloud-sync), recommendation weighted to scale into the multi-DJ scene network
- **Implementation Approaches** — capture-agent design (live file-watch vs post-set batch), the session→DB join & path-normalization, cross-OS packaging / code-signing / auto-update for a downloadable app
- **Technology Stack** — capture agent + backend API + database + web frontend, weighed for a solo/small-team build that scales
- **Integration Patterns** — local→cloud sync API, auth, what data crosses the wire, storage/privacy/ownership
- **Performance & Deployment** — hosting topology, cost at low scale, install/download UX

**Research Methodology:**

- Current public sources via WebFetch (WebSearch disabled — IL2/GovCloud); estimates labeled
- Multi-source validation for build-critical claims
- Confidence-level framework: claims tagged `[SOURCE: … fetched 2026-07-17]` or `[ANALYST ESTIMATE — needs verification]`
- Deliverable weighted toward the social-network endgame, with MVP shortcuts flagged

**Scope Confirmed:** 2026-07-17

---

## Technology Stack Analysis

*This platform has an unusual shape: it is **not** one app but a **two-tier system** — a local component that must run on the DJ's own machine (because Serato writes only there) and a cloud/web tier that hosts the dashboard and, eventually, the scene network. The stack is therefore evaluated per tier, and every choice is weighted toward the confirmed endgame: **scaling into a multi-DJ social network without a rewrite.** Where a cheaper MVP-only shortcut exists, it is flagged.*

### Layer 0 — The parser (already de-risked; drives the language decision)

The domain research verified working Serato parsers in four languages: **Rust** (`triseratops`), **Python** (`serato-tools`, `whats-now-playing`), **Go** (`unbox`), and **PHP** (`sslscrobbler`). This is a stack *input*, not an open question: whichever runtime the capture agent uses should have a reusable or clean-room-reimplementable parser in the same language, so parsing isn't a foreign-process call.

- **Rust** → pairs with **Tauri** agent; `triseratops` is native (MPL-2.0). [SOURCE: prior domain research + github.com/Holzhaus/triseratops]
- **Python** → pairs with a Python agent/daemon; two independent parsers exist (`serato-tools`, `whats-now-playing`, both MIT). [SOURCE: prior domain research]
- **JS/TS** → **no verified mature JS Serato parser surfaced**; an Electron agent would need to reimplement the chunked-binary format from the documented specs or shell out. `[ANALYST ESTIMATE — needs verification: no first-class JS/TS Serato session parser confirmed as of this research; treat JS parsing as build-it-yourself.]`

**Implication:** the capture-agent language is effectively a choice between **Rust (Tauri)** and **Python**, because those are where mature parsers already live. This is the single biggest lever on the whole stack.

### Programming Languages

| Tier | Recommended | Why | Alternatives considered |
|---|---|---|---|
| **Capture agent** (local) | **Rust** (via Tauri) or **Python** | Parser exists natively in both (Layer 0). Rust → tiny signed binary, native file-watch, one codebase for UI+logic. Python → fastest to prototype, but packaging a signed cross-OS desktop binary is heavier. | Go (`unbox` proves cross-platform read, but no desktop-UI story); PHP (`sslscrobbler` is server-era, poor desktop fit) |
| **Backend API** (cloud) | **TypeScript** (Node) *or* managed backend (Supabase) | Shares language/types with the web frontend; largest hiring pool; realtime + social libraries mature | Python (FastAPI) if agent is also Python — one language end-to-end; Go for raw throughput (premature at MVP) |
| **Web frontend** | **TypeScript + React** | Dashboard + social feed are React's core competency; Next.js gives SSR/SSG/auth out of the box | Vue/Svelte (viable, smaller ecosystem for social/charting) |

_Language evolution:_ Tauri 2.0 is current and stable; it uses **Rust** for backend logic with **any JS framework** for the UI, and can "integrate deep into the system with Swift and Kotlin." _Source: https://tauri.app/ (fetched 2026-07-17)._
_Performance characteristics:_ Tauri apps use the OS-native web renderer, so a bundle "can be as little as 600KB" vs. Electron shipping a full Chromium+Node runtime (typically 100+ MB). _Source: https://tauri.app/ (fetched 2026-07-17)._

### Development Frameworks and Libraries — the desktop-agent decision

The DJ downloads *something*. That something is a desktop-app framework. The two realistic choices:

| | **Tauri 2.0** | **Electron 43** |
|---|---|---|
| UI languages | Any JS framework (frontend) + **Rust** (logic) | JavaScript / HTML / CSS |
| Runtime model | OS-native webview | Bundles **Chromium + Node.js** |
| Bundle size | ~600 KB possible | ~100+ MB typical |
| Platforms | Win / macOS / Linux (+ iOS/Android) | Win / macOS / Linux |
| Serato parser in-language | ✅ `triseratops` (Rust, native) | ❌ none verified — reimplement/shell out |
| Auto-update | ✅ built-in updater plugin (static-JSON or dynamic server), **signature mandatory** | Via `electron-updater` (mature, widely used) |
| File watching | ✅ Rust `notify` ecosystem | ✅ Node `fs.watch`/chokidar |

_Sources: https://tauri.app/ , https://www.electronjs.org/docs/latest , https://v2.tauri.app/plugin/updater/ (all fetched 2026-07-17)._

**Framework verdict (weighted to scale + a downloadable app):** **Tauri 2.0.** It aligns with the Rust parser, produces a small signed binary DJs will actually download, and has a first-party updater. Electron's advantage (pure-JS, huge ecosystem) is undercut here by the absence of a mature JS Serato parser — Tauri lets the *same Rust code* both parse and run the agent. `[ANALYST ESTIMATE — recommendation; Electron remains a valid fallback if the team is JS-only and prefers to reimplement the parser in TS.]`

_Web framework:_ **Next.js 16** (React) — "a React framework for building full-stack web applications," explicitly supporting SSR, SSG, ISR, streaming, and with first-party **authentication** and **data-dashboard** guides. _Source: https://nextjs.org/docs (fetched 2026-07-17)._ This covers the marketing site, the auth flow, the dashboard, and later the social feed in one deployable.

### Database and Storage Technologies

The endgame is a social graph (DJs, sets, tracks, follows, shared sets) — a **relational** shape. Weighting for scale-without-rewrite points to **Postgres** as the system of record.

| Option | What it gives | Fit for this build |
|---|---|---|
| **Supabase (managed Postgres)** | Postgres + **Auth (GoTrue, JWT + Row Level Security)** + auto **REST/GraphQL API (PostREST)** + **Realtime WebSockets** + S3-compatible **Storage**, all open-source & self-hostable | ⭐ **Strong default** — collapses DB + auth + API + realtime + file storage into one service; RLS enforces per-DJ data isolation at the database layer |
| Raw Postgres (RDS/Neon/Fly) | Full control, no vendor coupling | More glue code (auth, API, realtime built by hand) |
| SQLite (local, on the agent) | Zero-server local store on the DJ's machine | ⭐ **Correct for the local tier** — the agent caches parsed sets locally; matches Serato 4+ which itself moved to `master.sqlite` |
| MongoDB / NoSQL | Flexible documents | ✗ Poor fit — the social graph and per-play joins are inherently relational |

_Source (Supabase capabilities & architecture): https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._

**Storage verdict:** **SQLite on the agent** (local cache of parsed sets, works offline) **+ Postgres in the cloud** (system of record for synced/social data). Supabase is the recommended way to get Postgres+Auth+Realtime+Storage without hand-building each — and because it's open-source and self-hostable, choosing it now does **not** lock you in (matches the "no rewrite later" priority). Its **Row-Level Security** is the mechanism that keeps one DJ's data private by default even as the platform becomes multi-tenant.

### Development Tools and Platforms — packaging, signing, auto-update (the "downloadable app" reality)

This is the layer most first-time builders underestimate, so it is called out explicitly. A downloadable desktop agent must be **code-signed** or users hit OS security warnings.

- **Windows:** Signing is *not required to run*, but an **unsigned app triggers a SmartScreen "not trusted" warning when downloaded via a browser** and cannot be listed in the Microsoft Store. **EV certificates** grant "immediate reputation with SmartScreen and won't show any warnings"; **OV certificates** are "cheaper and available to individuals" but SmartScreen "will still show a warning… until the certificate builds enough reputation over time." Azure Trusted Signing is an option. _Source: https://v2.tauri.app/distribute/sign/windows/ (fetched 2026-07-17)._
- **macOS:** Apple Developer ID signing + notarization is required to avoid Gatekeeper blocking; Tauri's updater supports Universal (Intel+ARM) macOS binaries. _Source: https://v2.tauri.app/plugin/updater/ (fetched 2026-07-17)._ Specific Apple certificate cost/flow `[ANALYST ESTIMATE — Apple Developer Program is a paid annual membership; confirm current fee before budgeting.]`
- **Auto-update:** Tauri's updater plugin works via a **static JSON file (S3/GitHub)** or a **dynamic update server**, callable from JS or Rust; **update signatures cannot be disabled** (a separate signing key from the OS code-signing cert). On Windows the app "is automatically exited when the install step is executed." _Source: https://v2.tauri.app/plugin/updater/ (fetched 2026-07-17)._

**Practical takeaway:** budget for **two signing identities** (Apple Developer ID + a Windows OV/EV cert) and **one update-feed signing keypair**. The static-JSON updater hosted on GitHub Releases or S3 is the cheapest viable auto-update path for an early-stage app.

### Cloud Infrastructure and Deployment

Weighted for scale-without-rewrite, but honest about MVP cost:

| Component | Recommended | MVP cost posture |
|---|---|---|
| Web app (Next.js) | Vercel (first-party Next.js host) or any Node host / container | Free/low tier is generous at launch |
| Backend + DB + Auth + Realtime + Storage | **Supabase** (managed; self-hostable later) | Free tier covers early users; scales to paid |
| Update feed / installers | GitHub Releases or S3 static JSON | Effectively free |
| Capture agent | Runs on the **DJ's machine** — zero server cost | The agent is your cheapest "compute" |

_Container/serverless note:_ Supabase Edge Functions run on **Deno**; heavier custom compute can move to containers later without changing the DB. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._

**Deployment topology (recommended):** DJ's machine runs the **Tauri agent** (parses Serato, caches to local SQLite) → agent syncs parsed set data over HTTPS to **Supabase** (Postgres + Auth + Realtime) → **Next.js on Vercel** renders the dashboard and social feed from Supabase. This keeps raw Serato files local, sends only parsed/derived data to the cloud, and every tier has a free/cheap entry point that scales.

### Technology Adoption Trends

- **Tauri vs Electron:** the industry trend is toward Tauri for new, size- and security-sensitive desktop apps (native webview, tiny binaries, Rust safety), while Electron remains dominant for large JS-first teams and mature tooling. For *this* app the deciding factor is the native Rust Serato parser, not the trend. `[ANALYST ESTIMATE — directional; based on framework positioning, not a cited market-share figure.]`
- **Managed Postgres (Supabase/Neon) over hand-rolled backends:** collapsing auth + API + realtime + storage into one Postgres-centric service is the current default for solo/small teams shipping social apps — and open-source portability defuses the usual lock-in objection. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
- **Local-first + SQLite on the client:** aligns with where Serato itself went (`master.sqlite` in Serato 4+) and with the broader local-first movement; a local cache also makes the agent work offline between gigs. `[ANALYST ESTIMATE — trend-level observation.]`

### Recommended Stack Summary (v1, weighted to scale into the social network)

| Layer | Choice | One-line rationale |
|---|---|---|
| Capture agent | **Tauri 2.0 (Rust core + web UI)** | Small signed downloadable; native `triseratops` parser; built-in updater |
| Local store | **SQLite** (on agent) | Offline cache of parsed sets; mirrors Serato 4+ |
| Serato parsing | **`triseratops` (Rust)** / clean-room from specs | Verified in prior research; same language as agent |
| Cloud backend | **Supabase** (Postgres + Auth + Realtime + Storage) | One service = DB + auth + API + realtime + files; RLS for per-DJ privacy; self-hostable (no lock-in) |
| Web app | **Next.js 16 (React/TS)** on **Vercel** | SSR dashboard + social feed + auth in one deploy |
| Sync / signing | HTTPS sync; Apple Developer ID + Win OV/EV cert; static-JSON update feed | Cheapest credible downloadable-app distribution |

*Open items carried into Integration Patterns (Step 3): what exactly crosses the wire (raw vs derived data), the sync protocol & auth handshake, and how the three data-model topologies (local / hybrid / cloud) map onto this stack.*

## Integration Patterns Analysis

*The generic "integration patterns" lens (REST vs GraphQL, microservices, service mesh, ESB) is mostly overkill for this system — it is not a fleet of microservices, it is **one local agent talking to one cloud backend**. So this section is adapted to the integration questions that actually decide the build: **what data crosses the wire, how the agent authenticates, how per-DJ data stays isolated, and how the three data-model topologies map onto the sync boundary.** The over-engineered patterns are noted only where they become relevant at social-network scale.*

### The one integration that matters: agent → cloud sync boundary

Everything hinges on a single question you raised — *"are we storing users' data, and how do we link from Serato to the website?"* The answer is a **sync boundary** the parsed data crosses. Where you draw that boundary **is** the choice between your three topologies:

| Topology | What lives locally | What crosses the wire to cloud | Social features? | Privacy/liability |
|---|---|---|---|---|
| **A. Fully local** | Everything (parse + stats + UI) | **Nothing** | ❌ None | Max privacy, zero data liability |
| **B. Hybrid local-first** ⭐ | Raw files, parse, local SQLite cache, stats compute | **Only derived/opt-in data** (set summaries, aggregates, or explicitly shared sets) | ✅ Opt-in | Strong — raw library never leaves machine |
| **C. Cloud-sync** | Raw files, parse only | **All parsed play data** (every track, timestamp, key, BPM) | ✅ Full | You store the DJ's full play history |

**Recommendation (weighted to the social endgame + your instinct that raw data shouldn't needlessly leave the machine): Topology B — Hybrid local-first with opt-in cloud sync.** Rationale below in §Interoperability. It scales into the network (C's capability) without taking on C's full data-liability from day one, and unlike A it still has a "website."

### What crosses the wire — the payload contract

The critical design decision: **raw Serato files never leave the machine.** The agent parses locally and syncs a **derived, normalized JSON document** per set. This is both a privacy win and a bandwidth/robustness win (the cloud never has to understand Serato's binary format — the format-maintenance risk stays entirely on the agent, which can auto-update).

Illustrative per-set sync payload (`[ANALYST ESTIMATE — proposed contract, not from a source]`):

```jsonc
{
  "set_id": "uuid",                    // agent-generated, idempotent
  "dj_id": "uuid",                     // from auth
  "played_at": "2025-08-14T23:53:17Z", // from session ch. field 28
  "source": "serato",
  "agent_version": "1.4.2",
  "tracks": [
    {
      "title": "…", "artist": "…",
      "bpm": 122.0, "key": "Ebm", "camelot": "2A",   // computed client-side
      "genre": "House",
      "start": 1755215597, "end": 1755215978,
      "play_seconds": 381, "played": true,
      "in_library": true                              // false = off-library play (O-3)
    }
  ],
  "derived": { "energy_arc": [...], "key_compat_score": 0.82, "library_utilization": 0.14 }
}
```

Key properties: **idempotent** (`set_id` lets the agent retry/re-sync safely), **derived-only** (Camelot/energy computed on the agent, so no server compute or paid AI — consistent with prior research), and **carries the O-3 `in_library` flag** so the cloud can honestly show "N tracks unanalyzed."

### API Design Patterns

_RESTful APIs:_ A thin **REST/HTTPS** interface is the right primitive for agent→cloud sync — stateless, idempotent `PUT /sets/{set_id}`, retriable, cache-friendly. With **Supabase this is auto-generated** by PostgREST directly from the Postgres schema, so there is little custom API code to write. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
_GraphQL APIs:_ Available via Supabase `pg_graphql` if the web dashboard later needs flexible nested queries (e.g. "DJ → sets → tracks → co-players"); not needed for the agent sync path. `[ANALYST ESTIMATE — defer until the social graph justifies it.]`
_RPC / gRPC:_ Not warranted — no low-latency service-to-service traffic at this scale. Revisit only if a heavy analytics service is split out later.
_Webhook patterns:_ Useful later for scene-social notifications (e.g. "a DJ you follow posted a set") — Supabase Realtime (below) covers most of this without hand-built webhooks.

### Communication Protocols

_HTTP/HTTPS:_ The agent→cloud sync and the browser→cloud dashboard both ride **HTTPS**. This is the whole transport story for v1. _Source: general; Supabase exposes all services behind an HTTPS Kong gateway — https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
_WebSocket / Realtime:_ **Supabase Realtime** is "a scalable WebSocket engine for managing user Presence, broadcasting messages, and streaming database changes." This is the mechanism for the live social feed and "now playing" presence **without building a socket server**. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
_Message queue protocols (AMQP/MQTT):_ Not needed at MVP. A queue only becomes relevant if per-set ingestion needs buffering under load — premature now.
_Binary protocols (Protobuf):_ The only binary format in the system is Serato's own on disk; over the wire, JSON is sufficient and human-debuggable at this volume.

### Data Formats and Standards

_JSON:_ The sync payload contract (above) and all dashboard APIs are **JSON** — sufficient at per-set volumes and trivially consumed by PostgREST/Next.js.
_The real "data format" work is upstream, not on the wire:_ it is the **session→DB join and path normalization (Open Item O-3)** and **genre normalization** (~20% sparse/dirty, `"Hip-Hop / R&B"` vs `"Hip Hop"`) — both identified in the domain research. These happen **on the agent, before sync**, so the cloud only ever receives clean, normalized records. This is a deliberate integration decision: push messiness to the edge, keep the cloud schema clean.
_CSV / flat files:_ Only relevant as a user-facing **export** ("download my stats") — a nice-to-have, not an integration path.

### System Interoperability Approaches

_Point-to-point (agent ↔ cloud):_ This **is** the architecture — a single point-to-point sync channel. No ESB, no service mesh; those solve problems this system doesn't have.
_API Gateway:_ You get one implicitly — **Supabase routes all services (DB API, Auth, Realtime, Storage) behind a Kong gateway**, so a single base URL + key fronts everything. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
_Service mesh / ESB:_ **Explicitly out of scope.** Flagged only so the record shows it was considered and rejected as premature for a two-tier system.

**Interoperability verdict — why Topology B (hybrid) is the recommended boundary:** it maximizes interoperability leverage (the cloud speaks clean JSON/Postgres, never Serato binary), isolates the fragile format-parsing on the auto-updatable edge agent, keeps raw data on the DJ's machine (privacy + low liability), and still exposes exactly the derived data the social network needs. Topology A can't do social; Topology C needlessly ingests raw play history and inherits its privacy burden on day one. B is the only option that scales into the network **without a rewrite** — the sync contract simply carries more (opt-in) fields over time.

### Microservices Integration Patterns

**Deliberately deferred.** At v1 this is a modular monolith (Next.js app + Supabase), not microservices. The patterns become relevant only at scale:
_API Gateway pattern:_ already provided by Supabase/Kong (above).
_Service discovery / circuit breaker / saga:_ **not needed** until/unless heavy analytics or third-party DJ-platform ingestion (Rekordbox, Engine DJ) is split into separate services. Noted as a **future seam**, not a v1 task. `[ANALYST ESTIMATE — scale-stage guidance.]`

### Event-Driven Integration

_Publish-subscribe:_ **Supabase Realtime** provides pub/sub over Postgres changes — the natural backbone for the scene feed ("new set posted," "now playing" presence) with no custom broker. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
_Event sourcing / CQRS:_ Overkill for v1. The per-set sync is already append-mostly (each set is an immutable-ish event), which gives you the *benefit* of event-thinking without the machinery. Revisit only if audit/replay requirements emerge.
_Message brokers (Kafka/RabbitMQ):_ Not warranted at this scale; Realtime + Postgres covers the eventing need.

### Integration Security Patterns

_OAuth 2.0 / JWT — the agent's auth handshake:_ **Supabase Auth issues short-lived JWT access tokens (5 min–1 hr) plus long-lived single-use refresh tokens.** A **desktop app authenticates the same way as any client** — it signs in once, receives the token pair, and **proactively refreshes ahead of expiry**; sessions are device-independent. Crucially, client libraries let you **override the token `storage`** (`getItem`/`setItem`/`removeItem`), which is exactly how the Tauri agent persists the refresh token securely on the local machine instead of in browser storage. _Source: https://supabase.com/docs/guides/auth/sessions (fetched 2026-07-17)._
_Per-DJ data isolation — Row-Level Security:_ This is the mechanism that makes "storing users' data" safe. **RLS policies act as an implicit `WHERE` clause on every query**; a policy like `using ( (select auth.uid()) = dj_id )` means each DJ's queries are silently filtered to **only their own rows**, enforced **at the database layer** regardless of any application-code bug. The docs recommend `auth.uid() IS NOT NULL AND auth.uid() = dj_id` to avoid the null-matches-nothing pitfall. _Source: https://supabase.com/docs/guides/database/postgres/row-level-security (fetched 2026-07-17)._ For the social features, additional policies grant read access to sets a DJ has **explicitly shared** — isolation by default, sharing by opt-in, matching Topology B.
_API key management:_ Supabase publishable (anon) key ships in the agent/frontend; **all real protection comes from RLS + JWT**, not from key secrecy — the anon key alone can read nothing without a valid authenticated policy match. _Source: https://supabase.com/docs/guides/database/postgres/row-level-security (fetched 2026-07-17)._
_Mutual TLS:_ Not needed — standard HTTPS + JWT is the appropriate auth for a consumer desktop app. mTLS is enterprise-grade overkill here.
_Data encryption:_ HTTPS in transit; Postgres-at-rest encryption is standard on managed Supabase. Because raw libraries never leave the machine (Topology B), the most sensitive data is never in the cloud to begin with — the strongest possible "encryption" being *non-transmission*.

### Integration Summary (how it all wires together)

```
[DJ's machine]                                  [Cloud]
 Serato files ──▶ Tauri agent                    Supabase
   (.session,      • parse (triseratops)          • Postgres (system of record)
    database V2)   • join + path-normalize (O-3)  • Auth (JWT + refresh)
                   • compute Camelot/energy        • RLS (per-DJ isolation)
                   • cache → local SQLite          • Realtime (scene feed)
                        │                          • Storage
                        │  HTTPS PUT /sets/{id}         ▲
                        │  (derived JSON, idempotent)   │ HTTPS + JWT
                        ▼  Bearer JWT                    │
                   ═══════════ sync boundary ═══════════
                                                    Next.js on Vercel
                                                     • dashboard (SSR)
                                                     • social feed (Realtime)
                                                     • auth UI
                                                          ▲
                                                          │ browser (any device)
                                                        [DJ / fans]
```

*Open items carried into Architectural Patterns (Step 4): component decomposition of the agent (watcher / parser / joiner / sync-queue), offline-sync & retry semantics, how set-segmentation (Open Item O-4) sits in the pipeline, and the concrete data schema for the social graph.*

## Architectural Patterns and Design

*This step goes inside the two tiers defined so far and specifies their internal structure: the agent's component pipeline, the sync/offline semantics, where set-segmentation lives, the cloud data schema for the social graph, and the deployment shape. Patterns are chosen for a solo/small-team build that grows into the network — not for theoretical purity.*

### System Architecture Patterns

**Overall pattern: local-first "smart edge, thin cloud."** The DJ's machine is not a dumb uploader — it is where parsing, joining, and stat computation happen (the "smart edge"), and the cloud is a comparatively thin store-and-serve tier plus social graph. This is the architectural expression of Topology B and of the prior research's finding that *no paid AI / server compute is needed* — all computation is free client-side compute on hardware you don't pay for.

**The capture agent — internal pipeline (pipes-and-filters pattern):**

```
watcher → parser → joiner → stat-engine → local store (SQLite) → sync-queue → cloud
   │         │         │          │              │                    │
 notify   triseratops  O-3      Camelot/       durable            idempotent
 (fs      chunked     path-     energy arc     cache,             retriable
 events)  binary      normalize (client-side)  offline-ok         PUT /sets
```

Each stage is an independent filter with a typed hand-off — testable in isolation and matching how the verified tools already decompose the problem (`sslscrobbler` = watcher+parser; the join is O-3; stats are the prior research's Camelot/energy). _Watcher mechanism verified: Tauri's `fs` plugin offers `watch`/`watchImmediate` (debounced or immediate, recursive optional) — https://v2.tauri.app/plugin/file-system/ (fetched 2026-07-17); under the hood the Rust **`notify`** crate uses native OS APIs — ReadDirectoryChangesW (Windows), FSEvents/kqueue (macOS), inotify (Linux) — https://github.com/notify-rs/notify (fetched 2026-07-17)._

**Live vs post-set — the agent supports both, same pipeline:**
- **Post-set (default, simplest, most robust):** DJ finishes a gig; agent detects the closed `.session` file, runs the full pipeline once. Mirrors `sslscrobbler`'s `--post-process` mode. This is the **v1 recommendation** — no real-time complexity, and it matches the "reflection after the gig" concept.
- **Live (nice-to-have):** `watchImmediate` on the History folder streams tracks as they're logged (like `sslscrobbler`'s live monitor), enabling a "now playing" presence feature later. `[ANALYST ESTIMATE — defer to post-MVP; adds real-time state and partial-set handling.]`

_Cloud pattern:_ **modular monolith** (Next.js app + Supabase), *not* microservices — chosen deliberately per Step 3. It scales vertically and via managed-Postgres read replicas far beyond MVP needs, and the future service seams (heavy analytics, multi-platform ingestion) are already identified.

### Design Principles and Best Practices

- **Local-first / offline-first.** The DJ's stats exist and are viewable even with no network (local SQLite is the source of truth for *their own* data; cloud is a sync target). This is a first-class principle, not a fallback — DJs are often on flaky venue Wi-Fi. `[ANALYST ESTIMATE — design principle; aligns with SQLite-on-agent choice in Step 2.]`
- **Push messiness to the edge (separation of concerns).** Format parsing, the O-3 join/path-normalization, and genre normalization all happen on the agent; the cloud schema only ever sees clean, normalized records. The fragile, format-coupled code is isolated in the one component that auto-updates.
- **Idempotency & at-least-once delivery.** Every set has an agent-generated `set_id`; sync is a retriable idempotent `PUT`. Network failure → retry from the durable queue → no duplicates. This is the core resilience principle for a flaky-network client.
- **Privacy by default (least data).** Raw libraries never sync; per-DJ isolation is enforced at the DB layer via RLS (Step 3); sharing is opt-in. The system stores the minimum derived data needed for features requested.
- **Clean/hexagonal boundaries at the sync line.** The agent depends on a `SyncClient` interface, not on Supabase directly — so the backend could be swapped (or self-hosted) without touching the pipeline. Matches the "no lock-in / no rewrite" priority.

### Scalability and Performance Patterns

- **Free compute at the edge:** parsing/stats scale linearly with users at **zero marginal server cost** because they run on DJs' machines. This is the platform's key scalability advantage and follows directly from prior research (no paid AI, computation is cheap key-lookups + arithmetic).
- **Read-heavy cloud, cache-friendly:** dashboards and social feeds are read-dominated. Next.js **SSR/ISR/streaming** (Step 2) + Supabase read replicas + CDN caching of static/derived views absorb growth. _Source: https://nextjs.org/docs (fetched 2026-07-17)._
- **Realtime fan-out handled by managed infra:** the scene feed's pub/sub load is carried by **Supabase Realtime** (a "scalable WebSocket engine"), not a socket server you operate. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._
- **Write path is naturally low-volume:** one sync per set per DJ — even thousands of DJs generate modest write traffic. No sharding/queue needed until far past MVP. `[ANALYST ESTIMATE — scale-stage guidance.]`

### Integration and Communication Patterns

*(Fully specified in Step 3 — summarized here as it pertains to structure.)* One point-to-point HTTPS sync channel (agent→cloud, JWT-authed, idempotent JSON), Supabase/Kong as the implicit API gateway, and Realtime WebSockets for the social layer. No broker, mesh, or gRPC at v1. _Source: https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._

### Security Architecture Patterns

- **JWT + refresh, on-device token storage:** agent authenticates like any Supabase client; refresh token persisted via Tauri's overridable secure storage (Step 3). _Source: https://supabase.com/docs/guides/auth/sessions (fetched 2026-07-17)._
- **Row-Level Security as the isolation boundary:** `auth.uid() = dj_id` policies filter every query at the DB layer; sharing via explicit opt-in read policies. _Source: https://supabase.com/docs/guides/database/postgres/row-level-security (fetched 2026-07-17)._
- **Scoped filesystem access on the agent:** Tauri's fs plugin **blocks dangerous commands/scopes by default** and confines the agent to the Serato/History path via capability scopes ("deny takes precedence," `../` traversal blocked, `$HOME`/`$APPDATA` path variables). The agent can read the DJ's Serato folder and *nothing else* it isn't granted. _Source: https://v2.tauri.app/plugin/file-system/ (fetched 2026-07-17)._
- **Non-transmission as the strongest control:** raw libraries never leave the machine, so the most sensitive data has no cloud attack surface (Topology B).

### Data Architecture Patterns

**Two stores, one owner-of-truth per data class:**
- **Local SQLite (on agent)** — source of truth for *this DJ's own* parsed sets; enables offline. Mirrors Serato 4+ (`master.sqlite`).
- **Cloud Postgres (Supabase)** — source of truth for *shared/social* data and cross-device access; system of record for the network.

**Proposed cloud schema (relational, social-ready)** `[ANALYST ESTIMATE — proposed, not from a source]`:

```
djs (id, handle, display_name, created_at)                    -- 1:1 with auth.users
sets (id, dj_id→djs, played_at, venue?, source, agent_version,
      is_shared bool default false, derived jsonb)            -- RLS: dj_id = auth.uid() OR is_shared
plays (id, set_id→sets, title, artist, bpm, key, camelot,
       genre, start_ts, end_ts, play_seconds, played,
       in_library)                                            -- inherits set visibility
follows (follower_id→djs, followee_id→djs)                    -- the social graph edge
track_identity (id, norm_artist, norm_title, ...)             -- optional: cross-DJ track dedup for scene stats
```

- `sets.derived jsonb` stores the precomputed energy arc / utilization so dashboards render without recomputation.
- `plays` carries the O-3 `in_library` flag so coverage gaps display honestly.
- `follows` is the minimal edge that turns per-DJ data into a **scene network**; scene-wide stats ("most-played track in your city this month") aggregate across `plays` of shared sets — the network-effect feature from market research, computed with plain SQL, still **no paid AI**.
- **Genre normalization** (the ~20% dirty/sparse issue) is applied on the agent before insert; an optional `track_identity` table enables cross-DJ dedup for scene aggregates.

**Set-segmentation (Open Item O-4) placement:** segmentation is a **joiner/stat-engine stage on the agent** — it groups the raw play log into discrete "sets" using inter-track gaps and deck alternation (timestamps confirmed available in prior research). Keeping it on the edge means the cloud receives already-segmented sets. *Still to be validated against a multi-track real-gig session (O-4 remains open from domain research).*

### Deployment and Operations Architecture

- **Agent distribution:** signed installers (Apple Developer ID + Windows OV/EV) via download; **auto-update through Tauri's static-JSON updater** on GitHub Releases/S3 — so the fragile format-parsing code can be patched fast if Serato changes its format (directly mitigating the domain research's maintenance-risk concern). _Source: https://v2.tauri.app/plugin/updater/ (fetched 2026-07-17)._
- **Cloud:** Next.js on Vercel (or any Node host/container); Supabase managed (self-hostable later). Both have free/low tiers at launch (Step 2).
- **Operations posture:** almost entirely managed services at MVP — no servers to patch, no queue to babysit. The one bespoke operational concern is **agent version fragmentation** (DJs on old versions after a Serato format change) — mitigated by the mandatory-signed auto-updater and by the `agent_version` field on every synced set (so the cloud can detect and prompt stale agents).

### Architectural Decision Records (key ADRs, condensed)

| # | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| ADR-1 | Local-first, hybrid sync (Topology B) | Scales to social w/o rewrite; raw data stays local | Full-cloud (C: liability); fully-local (A: no social) |
| ADR-2 | Tauri (Rust) agent | Native Serato parser, tiny signed binary, built-in updater | Electron (no JS parser, 100MB+) |
| ADR-3 | Supabase (Postgres) backend | DB+Auth+Realtime+Storage+RLS in one; self-hostable | Hand-rolled backend; NoSQL (wrong shape) |
| ADR-4 | Derived-only sync payload | Privacy; cloud never parses Serato binary | Sync raw files (liability + format coupling in cloud) |
| ADR-5 | Post-set batch parse for v1 | Simplicity/robustness; matches "reflection" concept | Live watch (defer; adds real-time complexity) |
| ADR-6 | Modular monolith cloud | Right-sized for scale; seams identified for later | Microservices (premature) |

*Open items carried into Implementation Research (Step 5): concrete build sequencing/MVP slice, the O-3 path-normalization implementation approach, O-4 segmentation heuristics needing a multi-track sample, and code-reuse-vs-clean-room decision for `triseratops` (O-2 license question from domain research).*

## Implementation Approaches and Technology Adoption

*This step turns the architecture into a build plan: what to build first, how to handle the two open engineering risks (O-3 join, O-4 segmentation), the parser reuse-vs-reimplement decision, CI/CD, cost, and risk mitigation. It resolves Open Item O-2 (the `triseratops` license) and surfaces one new build-critical finding about parser coverage.*

### Build-critical finding — the parser is *two* jobs, and no single Rust crate does both

Verifying `triseratops` (Open Item O-2) surfaced a coverage gap that reshapes the agent's parser stage:

- **`triseratops` (Rust, MPL-2.0, actively developed but "heavy development, breaking API changes")** parses the **embedded GEOB tags and the database** — cue points, beatgrids, autotags, DB records. It does **not** parse the audio media tags themselves (you'd add the `id3` crate for `TKEY`/`TCON`), and per its README it is **scoped to tags/database, not the `.session` history log.** _Source: https://github.com/Holzhaus/triseratops (fetched 2026-07-17)._
- The **`.session` history log** — the play log with timestamps, played-flag, and duration (the *core* of your concept) — is what **`sslscrobbler` (PHP)** parses, and its format is fully documented. _Source: prior domain research + github.com/ben-xo/sslscrobbler._

**Implication for the build:** the agent needs **two parser paths**:
1. **Session/history parser** — reimplement `sslscrobbler`'s documented chunked-binary format **clean-room in Rust** (the format is small and fully specced; the prior research already round-tripped it against your real `22474.session`). This is the play log.
2. **DB/tag parser** — **reuse `triseratops`** (MPL-2.0 permits use; it's file-level copyleft, fine for linking) **+ the `id3` crate** for `TKEY`/`TCON`. This is the track-attribute join source.

**O-2 resolved:** `triseratops` is **MPL-2.0** — usable in a commercial closed-source product (MPL is file-level copyleft: modifications to MPL files must be shared, but your own files can stay closed). The session parser has no license entanglement because you reimplement from the *format spec*, not from `sslscrobbler`'s GPL/MIT code. `[ANALYST ESTIMATE — MPL-2.0 compatibility reasoning; confirm with counsel before shipping commercially, and pin the triseratops version given its "breaking API changes" warning.]`

### Technology Adoption Strategies

- **Adopt incrementally, edge-first.** Build and validate the **agent pipeline against real exports** (you already have `22474.session` + `database V2`) *before* touching the cloud. The riskiest code (format parsing, O-3 join) is edge-local and testable offline with zero infrastructure.
- **Buy the boring parts, build the differentiator.** Adopt managed services (Supabase, Vercel, Tauri updater, `tauri-action` CI) for everything that isn't your moat. The moat is the parsing/stats edge + the scene network — not auth, hosting, or CI. This is the classic "focus engineering on the differentiator" adoption pattern.
- **Pin volatile dependencies.** `triseratops` explicitly warns of breaking API changes; pin an exact version and gate upgrades behind the agent's own test suite against sample exports. `[SOURCE: github.com/Holzhaus/triseratops, fetched 2026-07-17.]`

### Development Workflows and Tooling

- **CI/CD — cross-platform builds are a solved problem:** **`tauri-action` (MIT)** builds native binaries for **macOS (Arm+Intel), Windows, and Linux** from a GitHub Actions matrix, creates the GitHub Release, uploads bundles, and **auto-generates and uploads the updater JSON + `.sig` signatures** (`uploadUpdaterJson` defaults true). This means one CI workflow produces the signed, auto-updatable downloads for all OSes. _Source: https://github.com/tauri-apps/tauri-action (fetched 2026-07-17)._
- **Secrets in CI:** code-signing certs (Apple Developer ID, Windows OV/EV) and the updater private key live as encrypted GitHub Actions secrets; the workflow signs during build. (Signing keys per Step 2 / updater signature per Tauri docs.)
- **Monorepo layout (recommended):** `agent/` (Tauri+Rust), `web/` (Next.js), `shared/` (the sync payload TypeScript/JSON-schema types shared by agent-UI and web). One repo keeps the sync contract in sync across tiers.

### Testing and Quality Assurance

- **Golden-file tests for parsers** — the highest-value tests. Check the real `22474.session` and `database V2` into the test fixtures (they already exist) and assert the parser reproduces the verified field values (e.g. field 45 == 381s, key `Ebm`, 4,974 tracks). Any Serato-format drift or dependency bump that breaks parsing fails CI immediately. This directly operationalizes the domain research's verification.
- **O-3 join tests** — fixtures with absolute session paths + relative DB paths + an off-library play, asserting correct normalization and graceful "Unknown" for the off-library case.
- **Contract tests on the sync payload** — shared JSON schema validated on both agent (before send) and cloud (on receive).
- **RLS policy tests** — assert DJ A cannot read DJ B's un-shared sets (a security test, not just functional). Supabase RLS from Step 3.
- **E2E smoke** — one flow: drop a sample session → agent parses → syncs → dashboard renders. Playwright against Next.js.

### Deployment and Operations Practices

- **Agent:** signed installers via `tauri-action` → GitHub Releases; auto-update via static-JSON feed (Step 2/4). Roll out format-change patches fast — the mitigation for Serato's unofficial-format risk.
- **Cloud:** Supabase (managed Postgres/Auth/Realtime) + Next.js on Vercel; both free-tier at launch (Step 2).
- **Observability:** app-level error reporting in the agent (e.g. Sentry) is the key signal — you need to know *when a DJ's parse fails*, because that's the leading indicator of a Serato format change. `agent_version` on every synced set lets you correlate failures to versions. `[ANALYST ESTIMATE — recommended practice.]`
- **Incident playbook that matters here:** "Serato shipped an update and parsing broke." Detection = spike in agent parse-errors / drop in syncs; response = patch parser, ship via auto-updater, backfill affected DJs from their local SQLite cache (which retained the raw data). The local-first design makes this recoverable.

### Team Organization and Skills

- **Feasible solo / very small team.** The stack deliberately minimizes distinct skill domains: **Rust** (agent core + parsers), **TypeScript/React** (agent UI + web + Next.js), **SQL/Postgres** (schema + RLS). One full-stack developer comfortable with Rust + TS can build the whole thing; the managed services remove ops/devops as a required skill. `[ANALYST ESTIMATE.]`
- **Highest-leverage skill to have/acquire:** Rust binary parsing (for the clean-room session parser). Everything else is conventional web development.
- **Where to get help first:** the clean-room session parser and the O-3 join are the two spots where a targeted contractor or focused effort pays off; the rest is standard.

### Cost Optimization and Resource Management

| Cost item | MVP posture | Notes |
|---|---|---|
| Server/compute | **~$0** | Parsing/stats run on DJs' machines (free edge compute) |
| Supabase | Free tier → paid as users grow | DB+Auth+Realtime+Storage bundled |
| Vercel (Next.js) | Free/low tier | Generous at launch |
| Update feed / installers | ~$0 | GitHub Releases / S3 static JSON |
| **Apple Developer Program** | Paid annual membership | Required for macOS signing/notarization `[ANALYST ESTIMATE — confirm current fee]` |
| **Windows code-signing cert** | OV (cheaper, individual) or EV (pricier, instant SmartScreen trust) | Recurring cert cost `[ANALYST ESTIMATE — confirm current pricing]` |
| Paid AI APIs | **$0** | Confirmed unnecessary by domain research — Camelot/energy are lookups + arithmetic |

**The dominant *fixed* costs are the two code-signing identities, not infrastructure.** Infra is near-free until meaningful scale because the expensive compute lives on the edge. This is the cost expression of the "smart edge, thin cloud" architecture.

### Risk Assessment and Mitigation

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Serato changes its (unofficial) format → parsing breaks | High | Golden-file CI tests detect drift; auto-updater ships fix fast; local SQLite retains raw data for backfill | Architected for (ADR-5, auto-update) |
| O-3: session↔DB path mismatch / off-library plays | Medium | On-agent path normalization + embedded-tag fallback + graceful "Unknown" (domain research §3.4) | Known, designed; needs implementation |
| O-4: set-segmentation unproven on multi-track sets | Medium | On-agent segmentation stage; **needs a real multi-track gig session to tune heuristics** | **Open — sample needed** |
| `triseratops` breaking API changes | Low-Med | Pin version; gate upgrades behind golden-file tests | Resolved approach (O-2) |
| Code-signing friction (SmartScreen/Gatekeeper) | Medium | Budget for Apple + Windows certs; EV for instant Windows trust; notarize macOS | Known cost, planned |
| `unbox` (364★) fast-follower commoditizes read+display | Strategic | Moat is the scene network, not parsing (market research) | Strategic, not technical |

### The MVP slice (what to build first)

A concrete, riskiest-first sequence:

1. **Rust parsing core (offline, no UI):** clean-room session parser + `triseratops`/`id3` DB-tag reader; prove against `22474.session` + `database V2` with golden-file tests. *De-risks the whole product.*
2. **O-3 join + stat engine:** path normalization, off-library fallback, Camelot + energy arc + library-utilization compute — all local, all tested against real data.
3. **Tauri shell + local dashboard (SQLite):** the DJ can already see their set stats **fully locally** — this is a shippable Topology-A app and a usable product on its own.
4. **Supabase + auth + sync:** add the cloud store, JWT auth, idempotent sync of derived data, RLS isolation. Now it's Topology B.
5. **Next.js web dashboard:** cross-device viewing of synced stats.
6. **Social graph (`follows`, shared sets, scene aggregates) + Realtime feed:** the network-effect layer — the actual moat.

Steps 1–3 need **no cloud and no signing certs** and yield a working local app; 4–6 layer on the network. This lets you validate the hardest technical risk (parsing/stats on real data) before spending on infrastructure or certificates.

## Technical Research Recommendations

### Implementation Roadmap

- **Phase 0 — Parser core & stats (local, offline):** MVP steps 1–2. Deliverable: a Rust library that turns a real Serato export into computed set stats, verified by golden-file tests. *Gate: matches the domain-research verified values.*
- **Phase 1 — Local desktop app (Topology A):** MVP step 3. Deliverable: a signed, downloadable Tauri app showing a DJ their own set stats locally. *Shippable to early users; validates the UX and the "download something" experience.*
- **Phase 2 — Cloud sync & auth (Topology B):** MVP steps 4–5. Deliverable: cross-device web dashboard, per-DJ isolation, idempotent sync. *Gate: RLS isolation tests pass.*
- **Phase 3 — Scene network:** MVP step 6. Deliverable: follows, shared sets, scene-wide aggregates, Realtime feed. *The network-effect moat.*

### Technology Stack Recommendations

*(Consolidated from Step 2, unchanged.)* Tauri 2 (Rust) agent · clean-room session parser + `triseratops`+`id3` · local SQLite · Supabase (Postgres/Auth/Realtime/Storage) · Next.js 16 on Vercel · `tauri-action` CI · static-JSON auto-updater. Weighted to scale into the social network without a rewrite.

### Skill Development Requirements

- **Rust** — agent core + binary parsing (highest-leverage; the one specialized skill).
- **TypeScript/React + Next.js** — agent UI + web app (conventional).
- **Postgres/SQL + Supabase RLS** — schema + security policies.
- **Release engineering** — code signing (Apple + Windows) + GitHub Actions; mostly one-time setup via `tauri-action`.

### Success Metrics and KPIs

- **Parse success rate** (per agent version) — the health metric for format-drift; target >99% of in-library plays resolved. `[ANALYST ESTIMATE — target.]`
- **Metadata coverage per set** — % of plays with key/BPM (domain research baseline: key 98.8%, BPM 100% in-library); surfaces off-library gaps honestly.
- **Sync reliability** — % of parsed sets successfully synced (idempotent retries should push this near 100%).
- **Time-to-patch after a Serato format change** — the operational KPI that the auto-updater exists to minimize.
- **Activation:** % of downloaders who parse ≥1 real set; **Network:** follows per active DJ (the moat's leading indicator).

---

# Smart Edge, Thin Cloud: The End-to-End Architecture of a Serato-Powered DJ Stats & Reflection Platform

## Executive Summary

The build-feasibility question for this platform was answered by prior domain research: Serato's data *can* be read, with no paid AI, at 98.8% key and 100% BPM coverage. This report answers the question that follows — **how to turn that into a product a DJ downloads and uses.** The finding is that the platform is not one app but a **two-tier system**: a local capture agent that must run on the DJ's own machine (because Serato writes only there), and a cloud/web tier that hosts the dashboard and, ultimately, a multi-DJ "scene" social network. The architecture that best serves the confirmed endgame — scaling into that network without a rewrite — is **"smart edge, thin cloud"**: the DJ's machine does all parsing, joining, and stat computation, while the cloud is a comparatively thin store-and-serve tier. This is not merely elegant; it is the direct architectural consequence of the no-paid-AI finding — *all expensive computation runs for free on hardware the business does not own or pay for.*

Concretely, the recommended stack is a **Tauri 2 (Rust) desktop agent** — chosen over Electron because a mature Serato parser (`triseratops`) exists natively in Rust and Tauri ships a ~600 KB signed binary with a built-in auto-updater — feeding a **Supabase (Postgres + Auth + Realtime + Storage)** backend and a **Next.js 16** web app. The agent parses locally, caches to **SQLite**, and syncs only a **derived, normalized JSON document** per set; **raw Serato files never leave the machine.** This resolves the user's original questions directly: *yes* user data is stored, but only derived data, isolated per-DJ at the database layer via **Row-Level Security**, and shared only by opt-in. Of the three data-model topologies evaluated (fully-local / hybrid local-first / cloud-sync), **hybrid local-first (Topology B)** is recommended as the only one that reaches the social network without a rewrite while keeping raw data — and its privacy liability — off the server.

Two engineering realities dominate the plan. First, the **parser is two jobs**: `triseratops` (MPL-2.0) covers the database and embedded tags, but the `.session` play log — the concept's core — must be **clean-room reimplemented in Rust** from the documented format (already round-tripped against the user's real export). Second, the dominant *fixed* cost is not infrastructure — which is near-free until real scale — but the **two code-signing certificates** (Apple Developer ID + Windows) required so users can download and run the app without OS security warnings. Everything else (cross-platform builds, signing, auto-update-feed generation) is handled by the `tauri-action` CI pipeline. The recommended path ships a **useful local-only app first** (no cloud, no certs needed to validate the hardest risk), then layers on sync and the social graph.

**Key Technical Findings:**

- **The system is inherently two-tier; a local agent is non-negotiable** because Serato writes only to the local machine. This reframes "an app" as "a smart edge agent + a thin cloud."
- **"Smart edge, thin cloud" makes compute free and scalable** — parsing/stats run on DJs' machines at zero marginal server cost, the architectural payoff of the no-paid-AI finding.
- **Tauri (Rust) beats Electron for *this* app** specifically because the mature Serato parser is Rust-native and there is no verified first-class JS/TS session parser.
- **The parser is two distinct jobs** — reuse `triseratops`+`id3` for DB/tags; clean-room the `.session` play-log parser in Rust (Open Item O-2 resolved: MPL-2.0 is commercially usable).
- **Storing user data is safe and minimal** via derived-only sync + Postgres Row-Level Security (per-DJ isolation at the DB layer) + opt-in sharing — Topology B.
- **The dominant fixed cost is code-signing, not infrastructure**; infra is near-free until scale because compute lives on the edge.
- **The auto-updater is the mitigation for Serato's unofficial-format risk** — golden-file CI tests detect format drift, and fixes ship fast without a reinstall; local SQLite retains raw data for backfill.

**Technical Recommendations:**

1. **Adopt Topology B (hybrid local-first).** Parse and compute locally; sync only derived data; enforce per-DJ isolation with RLS and share by opt-in.
2. **Build the Tauri (Rust) agent with a two-path parser** — clean-room `.session` parser + `triseratops`/`id3` for DB/tags; pin `triseratops` given its breaking-API warning.
3. **Sequence riskiest-first and ship a local-only app before the cloud** — prove parsing/stats against the real export with golden-file tests (no infra, no certs), then add Supabase sync, then the scene network.
4. **Standardize on managed services + `tauri-action` CI** — Supabase, Vercel, and the static-JSON auto-updater; budget upfront for Apple + Windows signing certificates.
5. **Obtain a multi-track real-gig `.session` (Open Item O-4)** to tune set-segmentation heuristics — the one remaining unproven build assumption.

## Table of Contents

1. Technical Research Introduction and Methodology
2. Technical Landscape and Architecture Analysis *(see §Architectural Patterns above)*
3. Implementation Approaches and Best Practices *(see §Implementation Approaches above)*
4. Technology Stack Evolution and Current Trends *(see §Technology Stack Analysis above)*
5. Integration and Interoperability Patterns *(see §Integration Patterns above)*
6. Performance and Scalability Analysis
7. Security and Compliance Considerations
8. Strategic Technical Recommendations
9. Implementation Roadmap and Risk Assessment
10. Future Technical Outlook and Innovation Opportunities
11. Technical Research Methodology and Source Verification
12. Technical Appendices and Reference Materials

> **Reading note:** Sections 2–5 are developed in full in the step-by-step analysis above (Technology Stack, Integration Patterns, Architectural Patterns, Implementation Approaches). This synthesis consolidates the introduction, cross-cutting analysis, strategy, roadmap, risk, outlook, and the complete source register.

## 1. Technical Research Introduction and Methodology

### Technical Research Significance

A DJ finishes a two-hour set. Everything about what just happened — which tracks landed, how the energy built, which key transitions worked, how much of their library they actually reached for — is sitting in a handful of binary files on their laptop, and today it evaporates. The significance of this research is that **the gap between that latent data and a meaningful reflection product is now purely an engineering-architecture problem, not a feasibility one.** Prior domain research proved the data is extractable without paid AI; prior market research established the opportunity and the moat (a scene network, not the parsing tech, since `unbox` at 364★ already commoditizes read-and-display). What remained unanswered — and what this report resolves — is the "how do we actually wire this together, and does the user have to download something" question that stands between concept and shippable product.

_Technical Importance:_ The architecture determines whether the platform can grow from a single-DJ tool into the network that constitutes its moat **without a rewrite** — the explicit optimization target set at scope confirmation.
_Business Impact:_ The chosen topology keeps fixed costs to two signing certificates and near-zero infra (compute on the edge), lets a solo/small team build it, and minimizes data-liability by keeping raw libraries off the server — directly shaping runway and risk.

### Technical Research Methodology

- **Technical Scope:** five lenses — technology stack, integration patterns, architectural patterns, implementation approach, and synthesis — adapted from generic categories to the specific shape of a local-agent-plus-cloud system.
- **Data Sources:** current primary sources fetched via **WebFetch** — official framework docs (Tauri 2, Next.js 16), the Supabase architecture/auth/RLS guides, and GitHub repositories (`triseratops`, `tauri-action`, `notify`, `sslscrobbler`) — each dated 2026-07-17. **WebSearch was disabled environment-wide (IL2/GovCloud)**, matching the prior research's constraint.
- **Analysis Framework:** every build-critical claim tagged `[SOURCE: … fetched 2026-07-17]`; anything not live-sourced tagged `[ANALYST ESTIMATE — needs verification]`; multi-source corroboration where possible; decisions captured as ADRs.
- **Time Period:** current-state as of July 2026, with a 1–5 year forward outlook in §10.
- **Technical Depth:** architecture-and-implementation grade — component pipelines, a proposed schema, a sync-payload contract, CI/signing specifics, and a riskiest-first build sequence.

### Technical Research Goals and Objectives

**Original Technical Goals:** Define how to build and wire the platform end-to-end — the downloadable capture agent, whether/where user data is stored, the Serato→website data flow, the recommended stack, integration/API patterns, and deployment topology.

**Achieved Technical Objectives:**

- **"What does the DJ download?"** → A signed **Tauri desktop agent** (~600 KB class), auto-updating, that reads the Serato folder in a filesystem-scoped sandbox. *(§Technology Stack, §Architectural Patterns; Tauri fs/updater sources.)*
- **"Are we storing users' data / where does it live?"** → **Topology B:** raw files stay local (SQLite), only derived data syncs to **Supabase Postgres**, isolated per-DJ by **RLS**, shared by opt-in. *(§Integration Patterns; Supabase RLS/auth sources.)*
- **"How do we link Serato → website?"** → A single **idempotent HTTPS sync** of a derived JSON payload, JWT-authed; the cloud never parses Serato's binary format. *(§Integration Patterns.)*
- **"How is it wired / deployed?"** → Agent (edge) → Supabase (managed cloud) → Next.js on Vercel, built and signed by `tauri-action` CI. *(§Architectural Patterns, §Implementation Approaches.)*
- **Insight discovered during research:** the parser is **two jobs**, resolving Open Item O-2 and reshaping the agent's parser stage.

## 6. Performance and Scalability Analysis

*(Consolidated from the Scalability sections above.)*

_Performance characteristics:_ The workload is favorable — per-set parsing of small files (the sample `.session` was 414 bytes; a 4,974-track DB is ~3 MB) and arithmetic-grade stat computation (Camelot lookups, BPM×timestamp). No heavy compute, no ML inference, no paid inference. The one non-trivial local operation is the O-3 join/path-normalization across the library.
_Scalability pattern:_ **Free compute at the edge** — parsing/stats scale linearly with users at zero marginal server cost. The cloud is **read-heavy and cache-friendly** (dashboards/feeds), absorbed by Next.js SSR/ISR/streaming + Supabase read replicas + CDN. The **write path is naturally low-volume** (one sync per set per DJ). Realtime fan-out for the scene feed is carried by managed Supabase Realtime, not a self-operated socket server.
_Measurement:_ parse success rate and metadata coverage per agent version are the leading health indicators (see §Success Metrics). _Sources: https://nextjs.org/docs , https://supabase.com/docs/guides/getting-started/architecture (fetched 2026-07-17)._

## 7. Security and Compliance Considerations

*(Consolidated from the Security Architecture sections above.)*

_Security frameworks & practices:_ JWT access tokens (short-lived) + single-use refresh tokens, with on-device secure token storage via Tauri's overridable storage; **Row-Level Security** as the per-DJ isolation boundary enforced at the database layer; **filesystem-scoped agent** (Tauri fs plugin blocks dangerous scopes by default, confines access to the Serato path, blocks `../` traversal). _Sources: https://supabase.com/docs/guides/auth/sessions , https://supabase.com/docs/guides/database/postgres/row-level-security , https://v2.tauri.app/plugin/file-system/ (fetched 2026-07-17)._
_Threat posture:_ The strongest control is **non-transmission** — raw libraries never leave the machine, so the most sensitive data has no cloud attack surface.
_Compliance considerations:_ Because only derived, user-owned play data is stored and isolated per-DJ with opt-in sharing, the privacy/regulatory surface is minimized by design. `[ANALYST ESTIMATE — a formal privacy review (e.g. GDPR/CCPA data-subject rights, since play history is personal data) is advised before public launch; not assessed in depth here.]`

## 8. Strategic Technical Recommendations

### Technical Strategy and Decision Framework

The strategy is captured in six ADRs (see §Architectural Patterns): local-first hybrid (Topology B), Tauri/Rust agent, Supabase backend, derived-only sync, post-set batch parsing for v1, and a modular-monolith cloud. The unifying principle: **isolate all fragility on the auto-updatable edge, keep the cloud clean and managed, and store the minimum.** Technology selection is consolidated in §Technology Stack.

### Competitive Technical Advantage

_Technology differentiation:_ The architecture is not itself the moat — and this report is explicit that it should not be treated as one, since read-and-display is commoditized (`unbox`). The differentiation the architecture *enables* is (a) **cost structure** — free edge compute + near-free managed infra means the platform can offer generous free usage that competitors paying for server-side processing cannot, and (b) **a rewrite-free path to the scene network**, where the actual moat (network effects) lives. _Source (competitive context): prior market research._
_Innovation opportunities:_ multi-platform ingestion (Rekordbox, Engine DJ) as future service seams; scene-wide aggregate stats computed in plain SQL over shared sets.

## 9. Implementation Roadmap and Risk Assessment

*(Full detail in §Implementation Approaches; consolidated here.)*

**Phased roadmap:**
- **Phase 0 — Parser core & stats (local, offline):** Rust library turning a real export into computed stats; golden-file tests against the verified values. *No infra, no certs.*
- **Phase 1 — Local desktop app (Topology A):** signed, downloadable Tauri app showing a DJ their own stats locally — shippable on its own.
- **Phase 2 — Cloud sync & auth (Topology B):** Supabase + JWT + idempotent derived-data sync + RLS; Next.js cross-device dashboard.
- **Phase 3 — Scene network:** follows, shared sets, scene aggregates, Realtime feed — the moat.

**Consolidated risk register:**

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Serato format change breaks parsing | High | Golden-file CI drift detection; auto-updater fast-patch; SQLite backfill | Architected for |
| O-3 join / off-library plays | Medium | On-agent path normalization + embedded-tag fallback + graceful "Unknown" | Designed; needs implementation |
| O-4 set-segmentation unproven | Medium | On-agent segmentation stage; **needs multi-track gig sample** | **Open — sample needed** |
| `triseratops` breaking API changes | Low-Med | Pin version; golden-file gate | Resolved approach |
| Code-signing friction | Medium | Budget Apple + Windows certs; EV for instant Windows trust; notarize macOS | Known cost, planned |
| Fast-follower commoditization | Strategic | Moat = scene network, not parsing | Strategic |

## 10. Future Technical Outlook and Innovation Opportunities

_Near-term (1–2 yr):_ Tauri 2 maturation and the continued shift toward managed-Postgres backends favor this stack; the main watch-item is Serato's format evolution (the auto-updater is the hedge). `[ANALYST ESTIMATE — directional.]`
_Medium-term (3–5 yr):_ multi-platform ingestion (Rekordbox/Engine DJ) becomes the natural expansion, cleanly accommodated by splitting ingestion into a service behind the already-identified seams; the modular monolith can decompose only where load demands.
_Long-term:_ the scene network's aggregate data (played tracks, transitions, energy patterns across a city/genre) becomes a differentiated dataset — the innovation frontier — computable without paid AI.
_Research opportunities:_ optional local DSP (aubio/librosa/keyfinder-class) as a no-API fallback for off-library plays (domain research mitigation (b), deferred).

## 11. Technical Research Methodology and Source Verification

### Comprehensive Technical Source Documentation

**Primary technical sources (WebFetch, all fetched 2026-07-17):**

| # | Source | Used for |
|---|---|---|
| 1 | https://tauri.app/ | Tauri 2 overview, languages, size, cross-platform |
| 2 | https://www.electronjs.org/docs/latest | Electron 43 baseline for comparison |
| 3 | https://v2.tauri.app/plugin/updater/ | Auto-update model, mandatory signatures, platform notes |
| 4 | https://v2.tauri.app/distribute/sign/windows/ | Windows code-signing, SmartScreen, EV vs OV |
| 5 | https://v2.tauri.app/plugin/file-system/ | fs plugin watch/watchImmediate, scoped access |
| 6 | https://nextjs.org/docs | Next.js 16 rendering models, auth/dashboard suitability |
| 7 | https://supabase.com/docs/guides/getting-started/architecture | Supabase components (Postgres/Auth/PostgREST/Realtime/Storage/Kong) |
| 8 | https://supabase.com/docs/guides/auth/sessions | JWT + refresh token model; desktop/non-browser clients |
| 9 | https://supabase.com/docs/guides/database/postgres/row-level-security | RLS mechanism (`auth.uid()`), per-user isolation |
| 10 | https://github.com/Holzhaus/triseratops | Parser scope (tags/DB, not session), MPL-2.0, API-stability warning |
| 11 | https://github.com/tauri-apps/tauri-action | Cross-platform CI build/release + updater JSON generation |
| 12 | https://github.com/notify-rs/notify | Cross-platform file watching (native OS APIs) |

**Secondary/inherited sources (from prior research, carried as facts):** the domain research (`domain-serato-history-file-parsing-metadata-research-2026-07-07.md`) and its sources (`sslscrobbler`, `serato-tools`, Holzhaus `serato-tags`, `unbox`), plus the real sample export (`22474.session` + `database V2`, 2026-07-17); the market research and WTP survey.

### Technical Research Quality Assurance

- **Source verification:** all 12 primary claims live-fetched and dated; framework versions confirmed current (Tauri 2.0, Electron 43, Next.js 16).
- **Confidence levels:** recommendations and un-fetchable specifics (cert pricing, trend claims, proposed schema/payload) explicitly tagged `[ANALYST ESTIMATE]`.
- **Technical limitations:** WebSearch disabled (IL2/GovCloud) — no broad discovery, only named-URL fetches; exact certificate costs, a formal privacy/compliance review, and O-4 segmentation against a multi-track set remain outside verified scope.
- **Methodology transparency:** every step gated on explicit user confirmation; ADRs record rejected alternatives.

## 12. Technical Appendices and Reference Materials

### Detailed Technical Data Tables

- **Framework comparison (Tauri vs Electron):** §Technology Stack → "Development Frameworks and Libraries."
- **Storage options matrix:** §Technology Stack → "Database and Storage Technologies."
- **Topology comparison (A/B/C):** §Integration Patterns → "The sync boundary."
- **Proposed cloud schema & sync payload:** §Architectural Patterns → "Data Architecture" / §Integration → "payload contract."
- **ADR table & consolidated risk register:** §Architectural Patterns / §9.

### Technical Resources and References

- **Open-source projects:** `triseratops` (MPL-2.0), `notify` (CC0/MIT-Apache), `tauri-action` (MIT), `sslscrobbler` (session-format reference), `serato-tools`/`serato-tags` (format specs).
- **Standards/specs:** Serato chunked-binary session format (community-documented); ID3v2.4 (`TKEY`/`TCON`); Camelot wheel notation.
- **Platform docs:** Tauri 2, Next.js 16, Supabase — as listed in §11.

---

## Technical Research Conclusion

### Summary of Key Technical Findings

The platform is a **two-tier "smart edge, thin cloud" system**: a Tauri/Rust agent that parses Serato locally and computes all stats for free on the DJ's machine, syncing only derived data to a managed Supabase backend fronting a Next.js web app. This topology (hybrid local-first, Topology B) is the only one of three evaluated that reaches the social-network endgame without a rewrite while keeping raw data — and its liability — off the server. The parser is two jobs (clean-room `.session` + reused `triseratops`/`id3`); the dominant fixed cost is code-signing, not infrastructure; and the auto-updater is the deliberate hedge against Serato's unofficial-format risk.

### Strategic Technical Impact Assessment

The architecture is explicitly **not** the moat, and treating it that way would be the strategic error — read-and-display is commoditized. What it delivers is (1) a **cost structure** (free edge compute + near-free managed infra) that underwrites a generous free tier competitors can't match, (2) a **buildable-by-a-small-team** footprint, and (3) a **rewrite-free runway** to the scene network where the network-effect moat actually lives. It converts the prior research's feasibility verdict into an executable, low-fixed-cost plan.

### Next Steps Technical Recommendations

1. **Build Phase 0 now** — the Rust parser core + stat engine against the real export, with golden-file tests. It needs no infrastructure and de-risks the entire product.
2. **Obtain a multi-track real-gig `.session`** to close Open Item O-4 (set-segmentation) — the single most valuable missing artifact.
3. **Ship the Phase 1 local-only app** to early DJs to validate the download/UX before spending on certificates and cloud.
4. **Then layer Phases 2–3** (Supabase sync → scene network), and commission a **privacy/compliance review** before public launch.
5. **Confirm the two open cost/legal items:** current Apple + Windows signing costs, and `triseratops` MPL-2.0 use with counsel.

---

**Technical Research Completion Date:** 2026-07-17
**Research Period:** Current comprehensive technical analysis (July 2026)
**Source Verification:** All primary technical facts cited with current sources (WebFetch, dated 2026-07-17); WebSearch disabled (IL2/GovCloud); estimates labeled
**Technical Confidence Level:** High for verified stack/integration facts; recommendations and un-fetchable specifics explicitly labeled as analyst estimates

_This comprehensive technical research document serves as an authoritative architecture reference for the DJ Stats & Reflection Platform and provides strategic technical guidance for informed decision-making and implementation, building directly on the confirmed parsing feasibility established in the prior domain research._
