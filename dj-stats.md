#  DJ Stats & Reflection Platform

*Working title: TBD ("Strava for DJs")*

## 1. Overview

A desktop application that reads a DJ's local Serato or Rekordbox library and session history, turning it into a personal analytics dashboard and an optional social platform. The goal is to help DJs reflect on their own playing habits and, if they choose, share curated stats and tracklists with other DJs.

## 2. Problem

DJs generate a huge amount of data every time they play — track order, BPM, genre, key, timestamps — but it's locked away in proprietary software and never used for anything beyond the set itself. There's no easy way to:

- See how your playing style and library use has evolved over time
- Know whether the music you're buying is actually making it into your sets
- Compare or share stats with other DJs without manually building/publishing a tracklist

Existing tools solve pieces of this (Serato Playlists for sharing, Songstats for track-level industry analytics, DJ.Studio for prep-time library stats) but nothing combines automatic history parsing, personal reflection analytics, and social sharing in one place.

## 3. Target Users

- Bedroom/hobbyist DJs who want to understand their own habits and progress
- Working/gigging DJs who want a lightweight way to log and reflect on sets (venue, crowd, etc.)
- DJs active in online/social DJ communities who want a lower-friction way to share sets than manual tracklist posting

## 4. Core Features

### 4.1 Personal Dashboard (reflection tool)
- **Most played tracks/artists** — all-time, monthly, per-set
- **Genre breakdown** — distribution and trend over time
- **BPM analytics** — distribution overall, and BPM-over-time curve within a single set (energy arc)
- **Key/harmonic mixing stats** — how often sets stay in-key
- **Set metadata** — length, track count, average track playtime
- **Repetition tracking** — how often a track gets replayed across a time window (burnout flagging)
- **Style evolution over time** — how genre/BPM/key tendencies shift month to month or year to year

### 4.2 Library Utilization ("added vs. played")
- Diff tracks added to the library in a given period against what was actually played
- **Conversion rate** — % of newly added tracks played at least once, tracked as a trend/streak
- **Aging shelf** — unplayed tracks sitting in the library for 3+ months, filterable by genre
- **Time-to-first-play** — average gap between adding a track and playing it out
- **Digging vs. playing balance** — compare genre mix of purchases vs. genre mix of actual sets
- **Rediscovery prompts** — surface older unplayed tracks that match the vibe of recent sets (no external API needed, purely derived from the user's own data)

### 4.3 Set Tagging (manual, after the fact)
- Venue name, date, crowd size, event type (club/festival/radio/private)
- Free-text notes/reflection per set
- Tags feed back into the dashboard (e.g., "how does BPM differ between club sets and radio sets?")

### 4.4 Social Layer
- Follow other DJs and view their public stats/profile
- **Granular privacy controls**, not a single global switch:
  - Per-set visibility (public / private / stats-only)
  - Per-track override within a public set (mark individual tracks as "ID" to hide, matching real tracklist culture)
  - Optional delayed reveal (e.g., full tracklist auto-publishes 48 hours after the set)
- Comparison/leaderboard style features built on aggregate stats rather than raw tracklists (e.g., widest BPM range this month, genre diversity) to give a social/competitive hook without forcing full tracklist transparency

## 5. Why Privacy Controls Matter (Design Constraint)

DJ culture has a long-running tension around "track ID" secrecy — many DJs treat their track selections as a competitive edge and are protective of revealing exact tracklists, while others champion full transparency for artist support and community discovery. Given this, **the product should default to privacy-friendly options** and treat full tracklist publishing as an opt-in, not a default, so it works for both camps rather than alienating one.

## 6. Known Limitations & Risks

**Technical**
- Rekordbox's database is encrypted (SQLCipher); the decryption key has been reverse-engineered by the community but can change with software updates, creating ongoing maintenance risk
- Serato's history/session files use an undocumented binary format; parsers exist via community reverse-engineering but aren't officially supported
- Data quality depends on the DJ's own tagging discipline (genre/BPM/key accuracy)
- "Played" detection logic varies by software and DJ behavior (e.g., Serato requires a crossfade + fader action to count a track as played)
- This is inherently local-first; syncing across multiple computers per DJ adds complexity

**Cultural/Product**
- Full tracklist transparency by default risks alienating DJs who treat track selection as competitive advantage
- Social comparison features need to feel fun/collaborative, not like public shaming over "burnout" tracks or unplayed libraries

## 7. Open Questions
- Which platform(s) to support first — Serato, Rekordbox, or both from day one?
- How much of the social layer ships in v1 vs. added after the personal dashboard proves valuable on its own?
- Mobile companion app, or web-only for the social/dashboard layer?
- Monetization model (free personal tool + paid social/pro tier? one-time purchase? subscription?)

## 8. Next Step
Define MVP scope: which platform to parse first, which dashboard metrics ship in v1, and minimum viable version of the privacy-first social layer.
