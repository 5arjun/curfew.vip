-- Migration: add_sets_plays_dj_id_index
-- Deferred-work follow-up (Story 3.1 code review, 2026-07-30): every RLS
-- policy on `sets`/`plays` filters directly on `dj_id`, but neither table
-- had an index on it -- every RLS-scoped read sequentially scans as the
-- tables grow. `sessions.dj_id` is already covered by its own
-- `unique (dj_id, session_identity)` constraint index; `sets`/`plays` have
-- no equivalent leading-column index.
create index sets_dj_id_idx on public.sets (dj_id);
create index plays_dj_id_idx on public.plays (dj_id);
