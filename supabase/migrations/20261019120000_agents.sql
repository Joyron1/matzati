-- Agents (owner request 2026-10-19): the product finder looks for products AliExpress pays 20% or
-- more on that also pass our filters, writes a Hebrew post for each and leaves them waiting for the
-- owner's approval in /admin/agents; an approved one is shown on /recommended and the home page and
-- may be posted to the Telegram channel. Read and written by the server with the service role only
-- (lib/agents/); no grant to anon or authenticated.

-- 1. Candidates ---------------------------------------------------------------------------------

create table if not exists public.agent_candidates (
  id uuid primary key default gen_random_uuid(),
  -- One row per product, ever: a product rejected or published is never proposed again.
  product_id text not null unique,
  agent text not null default 'finder' check (agent in ('finder')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- The rate the candidate was found with: the hot rate when AliExpress offers one, else the
  -- standard rate (percent).
  commission_pct numeric not null check (commission_pct >= 0),
  -- The product as found (AliProduct), so the queue shows what the agent saw.
  product jsonb not null,
  -- The agent's Hebrew post (the owner may edit it before approving) and its one-line reason.
  post_he text not null check (char_length(post_he) between 1 and 1000),
  why_he text check (why_he is null or char_length(why_he) <= 300),
  run_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  telegram_posted_at timestamptz,
  telegram_message_id text,
  telegram_error text check (telegram_error is null or char_length(telegram_error) <= 300)
);

create index if not exists agent_candidates_status_created
  on public.agent_candidates (status, created_at desc);

alter table public.agent_candidates enable row level security;
revoke all on public.agent_candidates from anon, authenticated;

-- 2. Runs ---------------------------------------------------------------------------------------

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('finder')),
  trigger text not null check (trigger in ('cron', 'admin')),
  status text not null default 'running'
    check (status in ('running', 'ok', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Products checked, candidates added, AliExpress calls made, LLM cost (USD).
  scanned integer not null default 0 check (scanned >= 0),
  added integer not null default 0 check (added >= 0),
  ali_calls integer not null default 0 check (ali_calls >= 0),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  note text check (note is null or char_length(note) <= 500)
);

create index if not exists agent_runs_agent_started on public.agent_runs (agent, started_at desc);

alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from anon, authenticated;

-- 3. LLM call kinds -----------------------------------------------------------------------------

alter table public.llm_usage drop constraint if exists llm_usage_kind_check;
alter table public.llm_usage
  add constraint llm_usage_kind_check
    check (kind in ('parse', 'explain', 'explain_more', 'titles', 'tips', 'agent_finder'));

comment on column public.llm_usage.kind is
  'The LLM job (LLM_CALL_KINDS in lib/stats/usage.ts): parse, explain (first page), explain_more ("עוד N"), titles (Hebrew titles of places 6-10, lib/llm/titles.ts), tips or agent_finder (the product finder''s posts, lib/agents/finder).';

-- 4. Schedule -----------------------------------------------------------------------------------

-- Twice a day (05:00 and 15:00 UTC: 08:00 and 18:00 in Israel in summer, an hour earlier in
-- winter), pg_cron asks the site to run the finder. Vercel Hobby's two cron jobs are taken by the
-- SEO refresh. The request carries CRON_SECRET from the Vault secret "matzati_cron_secret", which
-- the owner adds in the Supabase dashboard (Project Settings -> Vault) with the same value as
-- Vercel's CRON_SECRET; without it the site answers 401 and nothing runs. The site also checks the
-- admin's "finder on" switch and daily budget before any work.
create extension if not exists pg_net;

select cron.unschedule('matzati-agent-finder')
where exists (select 1 from cron.job where jobname = 'matzati-agent-finder');

select cron.schedule(
  'matzati-agent-finder',
  '0 5,15 * * *',
  $$
  select net.http_post(
    url := 'https://www.matzati-il.com/api/cron/agents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'matzati_cron_secret'),
        ''
      )
    ),
    body := '{"agent":"finder"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
