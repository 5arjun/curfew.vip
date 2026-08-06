-- Migration: add_djs_dj_name_column
-- Story 3.10 — Profile/Settings screen (AC-4, D-3)
--
-- The second DJ-writable column on public.djs, mirroring the phone migration
-- (20260727192439) exactly. AD-19's standing requirement: any update grant on
-- djs stays column-scoped — never a blanket `grant update on public.djs` —
-- so Epic 7's future billing columns are permanently unreachable from here.
--
-- ≤40 chars is D-3's rule, backed server-side by a column CHECK (additive —
-- the column is born with it, so no existing rows can violate it). Any
-- characters are allowed and there is no uniqueness check: there is no
-- social layer to collide in.

alter table public.djs add column dj_name text
  check (dj_name is null or char_length(dj_name) <= 40);

grant update (dj_name) on public.djs to authenticated;

-- No new RLS policy: policies scope ROWS, not columns, and the existing
-- `djs_update_own_phone` UPDATE policy (owner-only, null-safe) already
-- governs every UPDATE an authenticated DJ issues against their own row.
-- Which columns that UPDATE may touch is the GRANT's job — exactly the
-- separation the phone migration established.
