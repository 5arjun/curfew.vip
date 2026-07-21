-- Migration: init
-- Story 1.1 — seeds the additive-only migration structure (AC-4).
--
-- This is an intentional no-op: it establishes the migrations tree and proves a
-- clean apply in CI. Real schema (sessions/sets/plays, visibility overlay, etc.)
-- arrives in Epic 3 (Story 3.1).
--
-- ADDITIVE-ONLY RULE (AD-15 / AR-12) — the enforcement arm of the sync contract:
--   • New migrations MUST only ADD (new tables, columns, indexes, policies).
--   • NEVER drop or rename a live column, and NEVER break the sync contract.
--   • Every schema change ships as a Supabase-CLI migration file committed here.
-- See supabase/README.md before writing any migration.

-- (no-op)
SELECT 1;
