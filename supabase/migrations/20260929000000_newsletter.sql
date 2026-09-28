-- Newsletter sign-ups (owner request 2026-09-28): the footer's form for email updates on deals and
-- coupons (components/newsletter/, lib/newsletter/). One row per address.
--
--   email             trimmed and lowercased by the server (lib/newsletter/schema.ts), unique.
--   consent_text      the exact checkbox text the visitor consented to (NEWSLETTER_CONSENT_TEXT),
--   consent_version   its version (NEWSLETTER_CONSENT_VERSION) and when (consented_at): proof of
--   consented_at      the explicit consent the Communications Law (§30A) requires.
--   source            where the form was ("footer").
--   unsubscribed_at   null while subscribed; set once by the unsubscribe link. The row is kept
--                     after that, as the record of the consent and of the opt-out (/privacy says
--                     so); it is deleted on request. A later sign-up with the same address clears
--                     it and stores the new consent.
--   unsubscribe_token 32 random bytes, base64url (lib/newsletter/token.ts), unique: the secret in
--                     the unsubscribe link (/newsletter/unsubscribe?token=...). Kept for the row's
--                     life, so an old link still answers.
--
-- No IP address is stored here. The per-IP limit of sign-ups (5 per Israel day,
-- lib/newsletter/rate-limit.ts) counts a salted IP hash in public.rate_limits under the key
-- 'nl:<hash>' (with a 'dev:' or 'preview:' prefix outside production), which the retention job
-- deletes 48 hours after the day ends (20260928200000_retention.sql, a day-window key).
--
-- Written only through the two functions below, by the server with the service role: sign-ups
-- (the footer's server action) and unsubscribes (the unsubscribe page's server action). Read by
-- /admin/newsletter and its CSV export after requireAdmin(). RLS on with no policies, nothing
-- granted to anon or authenticated: the service role only.
--
-- Until this migration is applied, a sign-up answers "could not sign you up, try again" and the
-- admin page says it could not load. Apply it before deploying the footer form.

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null
    constraint newsletter_subscribers_email_normalized check (email = lower(btrim(email)))
    constraint newsletter_subscribers_email_format
      check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  consent_text text not null
    constraint newsletter_subscribers_consent_text_length
      check (char_length(consent_text) between 1 and 1000),
  consent_version text not null
    constraint newsletter_subscribers_consent_version_format
      check (consent_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  consented_at timestamptz not null default now(),
  source text not null
    constraint newsletter_subscribers_source_format check (source ~ '^[a-z][a-z0-9_-]{0,31}$'),
  unsubscribed_at timestamptz null,
  unsubscribe_token text not null
    constraint newsletter_subscribers_token_format check (unsubscribe_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  constraint newsletter_subscribers_email_key unique (email),
  constraint newsletter_subscribers_token_key unique (unsubscribe_token)
);

-- The admin list and the export: active rows by consent time.
create index newsletter_subscribers_active_idx
  on public.newsletter_subscribers (consented_at desc, id desc)
  where unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;

-- Explicit privileges instead of the project's default grants (which give anon and authenticated
-- every privilege, leaving RLS as the only guard).
revoke all on table public.newsletter_subscribers from anon, authenticated;
-- Supabase's default privileges already cover service_role; explicit so this never depends on
-- them. No delete: a row is deleted by hand (SQL editor) when its owner asks.
grant select, insert, update on table public.newsletter_subscribers to service_role;

-- Sign-up. Idempotent, and the caller cannot tell the cases apart: a new address is inserted; an
-- active one is left as it is (its first consent and its token stay); one that unsubscribed is
-- subscribed again with the new consent and source (its token stays, so old links keep working).
create or replace function public.newsletter_subscribe(
  p_email text,
  p_consent_text text,
  p_consent_version text,
  p_source text,
  p_token text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.newsletter_subscribers as s
    (email, consent_text, consent_version, consented_at, source, unsubscribe_token)
  values (p_email, p_consent_text, p_consent_version, now(), p_source, p_token)
  on conflict (email) do update
    set consent_text = excluded.consent_text,
        consent_version = excluded.consent_version,
        consented_at = excluded.consented_at,
        source = excluded.source,
        unsubscribed_at = null
    where s.unsubscribed_at is not null;
$$;

-- Unsubscribe by token: 'unsubscribed' (now), 'already' (earlier; the first time is kept) or
-- 'unknown' (no such token).
create or replace function public.newsletter_unsubscribe(p_token text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  update public.newsletter_subscribers
    set unsubscribed_at = now()
    where unsubscribe_token = p_token and unsubscribed_at is null;
  if found then
    return 'unsubscribed';
  end if;
  if exists (select 1 from public.newsletter_subscribers where unsubscribe_token = p_token) then
    return 'already';
  end if;
  return 'unknown';
end;
$$;

revoke execute on function public.newsletter_subscribe(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_subscribe(text, text, text, text, text)
  to service_role;
revoke execute on function public.newsletter_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.newsletter_unsubscribe(text) to service_role;

comment on table public.newsletter_subscribers is
  'Newsletter sign-ups (deals and coupons by email): address, consent text/version/time, source, opt-out time, unsubscribe token. No IP. service_role only.';
comment on function public.newsletter_subscribe(text, text, text, text, text) is
  'Idempotent sign-up: inserts, keeps an active row, or re-subscribes an unsubscribed one. service_role only.';
comment on function public.newsletter_unsubscribe(text) is
  'Marks the token''s row unsubscribed; returns unsubscribed | already | unknown. service_role only.';
