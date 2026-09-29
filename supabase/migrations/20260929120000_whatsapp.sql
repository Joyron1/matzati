-- WhatsApp bot state (docs/whatsapp-bot.md, lib/whatsapp/session.ts). Not applied yet: apply it
-- before switching the bot on (setting the WHATSAPP_* secrets). Nothing else reads these tables.
--
--   whatsapp_sessions  the user's last search, so "עוד", a new order or a removed filter can repeat
--                      it: user_hash = sha256("wa:" + the user's WhatsApp id + IP_HASH_SALT), never
--                      the phone number; state = { q, without, sort, filtersKey, page, ... } (q is
--                      the text the user typed). updated_at moves with every write.
--   whatsapp_seen      ids of messages already handled, so a POST that Meta redelivers (it retries
--                      when it does not get a fast 200) never answers twice.
--
-- Both are deleted 48 hours after their last write by public.run_whatsapp_retention(), a pg_cron
-- job every hour ('matzati-whatsapp-retention'). The bot itself treats a session older than 24
-- hours (WhatsApp's service window) as gone. /privacy states these periods
-- (RETENTION.whatsappHours in lib/config/legal.ts); change them together.
--
-- RLS on with no policies and nothing granted to anon or authenticated: the service role only.

create table if not exists public.whatsapp_sessions (
  user_hash text primary key
    constraint whatsapp_sessions_hash_format check (user_hash ~ '^[0-9a-f]{64}$'),
  state jsonb not null
    constraint whatsapp_sessions_state_size check (pg_column_size(state) < 8192),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_sessions_updated_at_idx
  on public.whatsapp_sessions (updated_at);

create table if not exists public.whatsapp_seen (
  message_id text primary key
    constraint whatsapp_seen_id_length check (char_length(message_id) between 1 and 200),
  seen_at timestamptz not null default now()
);

create index if not exists whatsapp_seen_seen_at_idx on public.whatsapp_seen (seen_at);

alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_seen enable row level security;

revoke all on table public.whatsapp_sessions from anon, authenticated;
revoke all on table public.whatsapp_seen from anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_sessions to service_role;
grant select, insert, update, delete on table public.whatsapp_seen to service_role;

create or replace function public.run_whatsapp_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sessions integer;
  v_seen integer;
begin
  delete from public.whatsapp_sessions where updated_at < now() - interval '48 hours';
  get diagnostics v_sessions = row_count;
  delete from public.whatsapp_seen where seen_at < now() - interval '48 hours';
  get diagnostics v_seen = row_count;
  return jsonb_build_object('whatsapp_sessions', v_sessions, 'whatsapp_seen', v_seen);
end;
$$;

revoke all on function public.run_whatsapp_retention() from public, anon, authenticated, service_role;

-- pg_cron is already enabled by the retention migration (20260928200000_retention.sql). Scheduling
-- a name that already exists updates that job, so applying this again keeps one job.
select cron.schedule(
  'matzati-whatsapp-retention',
  '15 * * * *',
  $job$select public.run_whatsapp_retention()$job$
);
