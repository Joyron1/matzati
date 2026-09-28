-- Data retention (owner request 2026-09-28): the privacy policy (/privacy) states how long each kind
-- of data is kept, and this daily job is what makes it true. public.run_retention() deletes:
--
--   rate_limits    counters whose window ended more than 48 hours ago. Keys (lib/guard/rate-limit.ts,
--                  lib/admin/login-rate.ts): hour windows 'h:<ip hash>' (also with a 'dev:' or
--                  'preview:' prefix) and 'al:<ip hash>' end an hour after their start; every other
--                  key (day windows 'd:<ip hash>' and 'llm:day', and any key added later) is an
--                  Israel calendar day (israelDayWindow: 23 to 25 hours long) that ends at the next
--                  midnight in Asia/Jerusalem.
--   search_log     rows older than 12 months (created_at).
--   clicks         rows older than 12 months (created_at).
--   hidden_searches rows hidden more than 12 months ago (hidden_at) once no search_log row has
--                  their query_norm any more: the text an admin hid from /searches is kept while a
--                  search with it could still be listed, and never forever.
--   llm_usage      rows older than 24 months (created_at).
--   parse_cache    rows older than 30 days (created_at). A row is used for 14 days at most
--   search_cache   (CACHE_TTL_DAYS, 48 hours when empty or degraded, lib/search/cache-key.ts), and a
--                  new search of a stale key rewrites it with a new created_at.
--   price_history  rows older than 24 months (captured_at).
--
-- Kept as they are: products, deals, coupons, seo_pages, category_tips, fx_rates (catalog data,
-- the owner's content or reference data). A search_log row older than 12 months also leaves
-- /searches, which lists search_log rows.
--
-- The periods are stated on /privacy (RETENTION in lib/config/legal.ts; lib/config/legal.test.ts
-- reads this file and checks that they match): change both together.
--
-- Schedule: pg_cron (Supabase Cron) runs it every day at 00:30 UTC (cron.timezone is GMT on
-- Supabase): 03:30 in Israel in summer (IDT), 02:30 in winter (IST). A row is deleted by the first
-- run after it passes its limit, so it can outlive the limit by up to a day. Runs are recorded in
-- cron.job_run_details (job 'matzati-retention').
--
-- Batches: each table is deleted from in batches of p_batch rows, oldest first, at most
-- p_max_batches batches per table per run; a larger backlog is finished by the next runs, and the
-- result says which tables hit that cap. All batches of a run share the job's one transaction; the
-- rows it deletes are old rows the app never writes again (a stale cache key that a search is
-- rewriting right now is skipped, not waited for: for update skip locked), and a delete's table
-- lock does not block reads or inserts.
--
-- Nothing in the app calls this function and no code depends on this migration: apply it any time.
-- It enables the pg_cron extension (available on this project: 1.6.4) and fails if it cannot, so
-- the job never silently goes missing. Without pg_cron, the alternative is a Vercel cron route
-- protected by CRON_SECRET that calls this function with the service role key, which then needs
-- `grant execute on function public.run_retention(integer, integer) to service_role` (not
-- implemented).
--
-- Run it by hand (SQL editor, as postgres): select public.run_retention();

-- price_history had no index that starts with captured_at (only (product_id, captured_at desc)).
create index if not exists price_history_captured_at_idx on public.price_history (captured_at);

create or replace function public.run_retention(
  p_batch integer default 2000,
  p_max_batches integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_batch constant integer := least(greatest(coalesce(p_batch, 2000), 1), 10000);
  v_max_batches constant integer := least(greatest(coalesce(p_max_batches, 50), 1), 1000);
  -- A rate_limits window is deleted once it ended this long ago.
  v_window_ended_before constant timestamptz := v_now - interval '48 hours';
  v_log_before constant timestamptz := v_now - interval '12 months';
  v_hidden_before constant timestamptz := v_now - interval '12 months';
  v_usage_before constant timestamptz := v_now - interval '24 months';
  v_cache_before constant timestamptz := v_now - interval '30 days';
  v_price_before constant timestamptz := v_now - interval '24 months';
  v_rows integer;
  v_total integer;
  v_batches integer;
  v_deleted jsonb := '{}'::jsonb;
  v_capped text[] := '{}';
begin
  -- rate_limits ---------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.rate_limits r
    where (r.ip_hash, r.window_start) in (
      select x.ip_hash, x.window_start
      from public.rate_limits x
      -- Every window is at least an hour long: a cheap bound before the exact end below.
      where x.window_start < v_window_ended_before - interval '1 hour'
        and (
          case
            when x.ip_hash ~ '^((dev|preview):)?(h|al):' then x.window_start + interval '1 hour'
            -- The next midnight in Israel (23 or 25 hours later on the days the clocks change).
            else ((x.window_start at time zone 'Asia/Jerusalem') + interval '1 day')
              at time zone 'Asia/Jerusalem'
          end
        ) < v_window_ended_before
      order by x.window_start
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('rate_limits', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'rate_limits'::text; end if;

  -- search_log ----------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.search_log t
    where t.id in (
      select x.id
      from public.search_log x
      where x.created_at < v_log_before
      order by x.created_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('search_log', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'search_log'::text; end if;

  -- clicks --------------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.clicks t
    where t.id in (
      select x.id
      from public.clicks x
      where x.created_at < v_log_before
      order by x.created_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('clicks', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'clicks'::text; end if;

  -- hidden_searches (after search_log, so a query whose last search went above goes today) ------
  -- A small table (queries an admin hid); one statement, a single anti-join over search_log.
  delete from public.hidden_searches h
  where h.hidden_at < v_hidden_before
    and not exists (
      select 1 from public.search_log l where l.query_norm = h.query_norm
    );
  get diagnostics v_rows = row_count;
  v_deleted := v_deleted || jsonb_build_object('hidden_searches', v_rows);

  -- llm_usage -----------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.llm_usage t
    where t.id in (
      select x.id
      from public.llm_usage x
      where x.created_at < v_usage_before
      order by x.created_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('llm_usage', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'llm_usage'::text; end if;

  -- parse_cache ---------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.parse_cache t
    where t.query_key in (
      select x.query_key
      from public.parse_cache x
      where x.created_at < v_cache_before
      order by x.created_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('parse_cache', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'parse_cache'::text; end if;

  -- search_cache --------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.search_cache t
    where t.filters_key in (
      select x.filters_key
      from public.search_cache x
      where x.created_at < v_cache_before
      order by x.created_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('search_cache', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'search_cache'::text; end if;

  -- price_history -------------------------------------------------------------------------------
  v_total := 0;
  v_batches := 0;
  loop
    delete from public.price_history t
    where t.id in (
      select x.id
      from public.price_history x
      where x.captured_at < v_price_before
      order by x.captured_at
      limit v_batch
      for update skip locked
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    v_batches := v_batches + 1;
    exit when v_rows < v_batch or v_batches >= v_max_batches;
  end loop;
  v_deleted := v_deleted || jsonb_build_object('price_history', v_total);
  if v_rows = v_batch then v_capped := v_capped || 'price_history'::text; end if;

  return jsonb_build_object('ran_at', v_now, 'deleted', v_deleted, 'capped', to_jsonb(v_capped));
end;
$$;

-- Owned by postgres (the role the cron job runs as), callable by nobody else: Supabase's default
-- privileges grant execute on new public functions to anon, authenticated and service_role, which
-- would expose it over the REST API (rpc/run_retention).
alter function public.run_retention(integer, integer) owner to postgres;
revoke execute on function public.run_retention(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_retention(integer, integer) to postgres;

comment on function public.run_retention(integer, integer) is
  'Daily data retention (pg_cron job matzati-retention, 00:30 UTC): rate_limits windows ended over 48h ago, search_log and clicks over 12 months, hidden_searches hidden over 12 months ago with no search_log row left, llm_usage and price_history over 24 months, parse_cache and search_cache over 30 days. Batched; returns the rows deleted per table and the tables that hit the per-run cap. postgres only.';

-- Supabase Cron (https://supabase.com/docs/guides/cron/install).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- The job runs as the role that applies this migration (postgres). Scheduling a name that already
-- exists updates that job, so applying this again keeps one job.
select cron.schedule(
  'matzati-retention',
  '30 0 * * *',
  $job$select public.run_retention()$job$
);
