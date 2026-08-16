begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- `djs_phone_e164` (20260816170000) is the enforcement point for the E.164
-- invariant, not `normalizePhone()` in the web app. That is the whole reason
-- the constraint exists: the app-side normalizer only governs the one write
-- path that calls it, and a second writer -- an import, an admin tool, a
-- future SMS opt-in -- would otherwise reintroduce the mixed-format column
-- silently, exactly as the original one appeared. These cases pin the
-- column's own behavior so that guarantee cannot regress unnoticed.
--
-- The accepted/rejected shapes here mirror normalizePhone()'s output
-- contract one-for-one; the vitest suite asserts the other side of the same
-- boundary (`phone-validation.test.ts`, "only ever emits the shape the
-- column CHECK accepts").

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'phone-check@example.com');

-- Case 1: the trigger-created row starts with a null phone, which the
-- constraint must permit -- `phone` stays optional at the column level and
-- the /phone-required corridor is what makes it mandatory in product terms.
select is(
  (select phone from public.djs where id = '33333333-3333-3333-3333-333333333333'),
  null,
  'a new djs row carries a null phone, and the CHECK allows it'
);

-- Case 2: canonical E.164 is accepted, domestic and international alike.
select lives_ok(
  $$ update public.djs set phone = '+12677772111'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  'accepts a NANP number in E.164'
);

select lives_ok(
  $$ update public.djs set phone = '+442079460958'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  'accepts an international number in E.164'
);

-- Case 3: the exact value prod stored before the backfill. This is the
-- regression the constraint was added for -- if this ever stops throwing,
-- the mixed-format column is back.
select throws_ok(
  $$ update public.djs set phone = '2677772111'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  23514,
  null,
  'rejects the bare national number that prod actually stored'
);

-- Case 4: a normalized-looking value that still carries formatting. Catches
-- a writer that adds the `+` but skips the strip.
select throws_ok(
  $$ update public.djs set phone = '+1 (267) 777-2111'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  23514,
  null,
  'rejects E.164 with formatting left in'
);

-- Case 5: no country code begins with 0, so this is malformed rather than
-- merely unfamiliar -- the regex's `[1-9]` leading digit is doing this work.
select throws_ok(
  $$ update public.djs set phone = '+0207946095'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  23514,
  null,
  'rejects a country code starting with zero'
);

-- Case 6: the upper bound is E.164's own 15 digits. 16 must not fit.
select throws_ok(
  $$ update public.djs set phone = '+1234567890123456'
     where id = '33333333-3333-3333-3333-333333333333' $$,
  23514,
  null,
  'rejects more than E.164''s 15 digits'
);

select * from finish();

rollback;
