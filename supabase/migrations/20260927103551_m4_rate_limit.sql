-- M4 guard counters (CLAUDE.md §6.1): per-IP search limits and the global daily LLM budget.
-- One row per (key, window). Keys written by lib/guard/rate-limit.ts:
--   'h:<ip hash>'  window_start = start of the UTC hour
--   'd:<ip hash>'  window_start = Asia/Jerusalem midnight
--   'llm:day'      window_start = Asia/Jerusalem midnight
-- ip_hash is sha256(ip + IP_HASH_SALT); the raw IP is never stored.

-- Atomic increment: concurrent requests for the same window never lose a count.
-- security invoker + service_role only: the server's service role bypasses RLS, anon cannot call it.
create or replace function public.bump_counter(p_key text, p_window_start timestamptz)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.rate_limits as r (ip_hash, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (ip_hash, window_start) do update set count = r.count + 1
  returning r.count;
$$;

revoke execute on function public.bump_counter(text, timestamptz) from public, anon, authenticated;
grant execute on function public.bump_counter(text, timestamptz) to service_role;

-- Old windows are useless after a day. The index keeps pruning cheap; call
-- prune_rate_limits(now() - interval '2 days') from a daily job (e.g. the phase 2 Vercel cron).
create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);

create or replace function public.prune_rate_limits(p_before timestamptz)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with deleted as (
    delete from public.rate_limits where window_start < p_before returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function public.prune_rate_limits(timestamptz) from public, anon, authenticated;
grant execute on function public.prune_rate_limits(timestamptz) to service_role;

-- RLS stays enabled on rate_limits (init migration) with no policies: only service_role reads it.
comment on function public.bump_counter(text, timestamptz) is
  'Adds 1 to the (key, window) counter and returns the new count. service_role only.';
