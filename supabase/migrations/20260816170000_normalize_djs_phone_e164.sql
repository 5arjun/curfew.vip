-- Migration: normalize_djs_phone_e164
--
-- Backfills `djs.phone` to E.164 and pins it there with a column CHECK.
--
-- Why now: the column was born format-free (20260727192439) because
-- `phone-validation.ts` deferred normalization to Story 2.4, which closed
-- `done` without doing it. Nothing failed, because nothing reads the format
-- yet -- `maskPhone` works from the digits and ignores the rest. The split
-- only became visible when prod's first real Google sign-up wrote
-- `2677772111` into the same column holding the seeded demo account's
-- `+15555550142`. Two formats, one column, and no code path that would ever
-- have complained. The first thing to dial or text a number would have.
--
-- The CHECK is the actual fix. Normalizing in the server action alone leaves
-- the invariant living in one call site; a second write path -- an import, an
-- admin tool, a future SMS opt-in -- reintroduces the split with nothing to
-- catch it. The constraint makes the column itself the enforcement point.
--
-- Ordering matters: backfill first, constrain second, in one transaction. A
-- constraint added ahead of the backfill would reject the very rows it
-- exists to correct.

-- Step 1: bare NANP numbers (with or without the leading country digit).
-- The `[2-9]` area-code test is a real NANP rule, not a heuristic -- area
-- and exchange codes never begin with 0 or 1 -- so it is what keeps a
-- non-US number typed bare from being silently stamped +1. Mirrors
-- normalizePhone()'s branch of the same name.
update public.djs
set phone = '+1' || right(regexp_replace(phone, '\D', '', 'g'), 10)
where phone is not null
  and phone not like '+%'
  and regexp_replace(phone, '\D', '', 'g') ~ '^1?[2-9]\d{9}$';

-- Step 2: values already international but carrying spaces or punctuation.
-- Separate from step 1 because it must not infer a country -- it only strips.
update public.djs
set phone = '+' || regexp_replace(phone, '\D', '', 'g')
where phone is not null
  and phone like '+%'
  and phone <> '+' || regexp_replace(phone, '\D', '', 'g');

-- Step 3: pin it. Deliberately a validated (not NOT VALID) constraint: if a
-- row survives both backfills unnormalized, it is a country-ambiguous number
-- that no rule here can resolve without guessing, and this migration should
-- fail loudly rather than admit a permanent exception to the invariant it is
-- establishing. Both rows in prod as of 2026-08-16 normalize cleanly.
--
-- Bounds match `isValidPhone`'s (7-15 digits) and E.164's own; the leading
-- digit is [1-9] because no country code starts with 0.
alter table public.djs
  add constraint djs_phone_e164
  check (phone is null or phone ~ '^\+[1-9]\d{6,14}$');

-- No grant or policy changes: `phone` is still the same column-scoped
-- `grant update (phone) ... to authenticated` from 20260727192439, governed
-- by `djs_update_own_phone`. A CHECK constrains values, not access.
