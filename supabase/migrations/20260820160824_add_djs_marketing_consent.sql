-- Migration: add_djs_marketing_consent
-- Marketing email consent record (docs/legal-review-2026-08-18.md finding A)
--
-- The 2026-08-18 ruling was "keep the grant, build the consent before the
-- first send". These two columns ARE that record. Storing a boolean would not
-- have been: the question a consent record has to answer is not "did they say
-- yes" but "what were they shown when they said it", and a bare flag cannot
-- answer that after the wording has been edited once.
--
-- Hence the pair, and hence the text is stored VERBATIM rather than as a
-- version id pointing at a constant in the codebase. A record whose meaning
-- depends on checking out the right git revision is not evidence.
--
-- NULL consent_at is the permanently valid "never opted in" state — including
-- for every DJ created before this migration. There is no backfill and no
-- default: an absent record must never be readable as a yes.

alter table public.djs add column marketing_email_consent_at timestamptz;
alter table public.djs add column marketing_email_consent_text text;

-- Scoped column grant, never a blanket `grant update on public.djs` — AD-19
-- requires any update path on this table to exclude Epic 7's billing columns,
-- and the phone column (20260727192439) set the precedent this follows.
--
-- The existing "djs_update_own_phone" policy already authorizes the ROW for
-- this DJ (RLS policies are row-scoped, not column-scoped), so no new policy
-- is needed — the column GRANT is the whole of what scopes the write.
grant update (marketing_email_consent_at, marketing_email_consent_text) on public.djs to authenticated;

-- Both columns move together or not at all. A timestamp with no wording is an
-- unprovable consent; wording with no timestamp cannot be placed in time, and
-- CAN-SPAM/GDPR questions are always "as of when". The CHECK makes the
-- half-written state unrepresentable rather than merely discouraged.
alter table public.djs add constraint djs_marketing_consent_complete check (
  (marketing_email_consent_at is null and marketing_email_consent_text is null)
  or (marketing_email_consent_at is not null and marketing_email_consent_text is not null)
);
