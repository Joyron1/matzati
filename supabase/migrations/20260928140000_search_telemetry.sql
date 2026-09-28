-- Search telemetry and dev/prod separation (docs/search-quality-plan.md items 0 and 10; owner
-- decision 2026-09-28: one database, rows tagged by environment, no second Supabase project).
--
-- 1. env on search_log, llm_usage and clicks: 'production' | 'preview' | 'development' from
--    VERCEL_ENV (deployEnv in lib/env.ts; absent = 'development'). Every row that exists before
--    this migration is 'legacy': the audit found only owner and dev tests there. The default stays
--    'legacy', so a row written by code that predates this migration (the deploy that is live while
--    it is applied, a script) is never counted as production.
-- 2. search_log: how the search was asked for (origin, without, sort_override), what it cost and
--    how long it took (timings, ali_calls), why products were rejected (rejected), a row for a
--    failed search (failure), a uid the result cards' /go links carry (search_uid) and whether the
--    request joined an identical search already running (shared). Still no IP and no user data.
--    owner marks a request made while a signed-in admin browsed (the owner's own checks and the
--    warm-up), and diag holds what a search that did its own work went through (why fetching
--    stopped, the keyword steps, the products the first-page safety net moved down, explain
--    fallbacks).
-- 3. clicks: the search_uid and card position of a click on a result card (logging only), and
--    owner as on search_log.
-- 4. The stats report functions and the recent-searches card set read env = 'production' only and
--    leave out the owner's rows, and the stats leave out failed and shared rows where they count
--    searches. Same signatures, so `create or replace` keeps their grants.
-- 5. New report functions for /admin/stats: searches by origin (results, failures, clicks, median
--    time), failures by code, and clicks by card position.
--
-- Cache isolation needs no SQL: outside production, lib/search/supabase-store.ts writes
-- parse_cache and search_cache under 'dev:' / 'preview:' keys; production keys stay the bare
-- hashes, so a deploy starts with a warm cache.
--
-- Apply this migration BEFORE deploying the code that ships with it: that code writes the new
-- columns, and every search_log, llm_usage and clicks insert fails (searches and click-outs still
-- work, their rows are lost) until they exist. The code deployed before it is unaffected: every
-- new column is nullable or has a default. Until the deploy, /admin/stats and /searches show
-- nothing new (their rows are 'legacy').
--
-- RLS stays on with no policies; everything stays revoked from anon/authenticated.

-- 1. Environment -----------------------------------------------------------------------------------

alter table public.search_log
  add column if not exists env text not null default 'legacy'
    constraint search_log_env_check
    check (env in ('production', 'preview', 'development', 'legacy'));
alter table public.llm_usage
  add column if not exists env text not null default 'legacy'
    constraint llm_usage_env_check
    check (env in ('production', 'preview', 'development', 'legacy'));
alter table public.clicks
  add column if not exists env text not null default 'legacy'
    constraint clicks_env_check
    check (env in ('production', 'preview', 'development', 'legacy'));

comment on column public.search_log.env is
  'Where the row was written: production, preview or development (VERCEL_ENV, deployEnv in lib/env.ts); legacy = before 2026-09-28 or code that predates the column. Stats and /searches read production only.';
comment on column public.llm_usage.env is
  'Where the call was made (see search_log.env). Stats read production only.';
comment on column public.clicks.env is
  'Where the click was logged (see search_log.env). Stats read production only.';

-- 2. Search log -----------------------------------------------------------------------------------

alter table public.search_log
  add column if not exists origin text
    constraint search_log_origin_check
    check (origin in ('typed', 'example', 'recent', 'chip', 'sort', 'more', 'preview', 'ad')),
  add column if not exists without text[] not null default '{}',
  add column if not exists sort_override text
    constraint search_log_sort_override_check
    check (sort_override in ('best_value', 'cheapest', 'most_popular')),
  add column if not exists timings jsonb,
  add column if not exists ali_calls integer
    constraint search_log_ali_calls_check check (ali_calls >= 0),
  add column if not exists rejected jsonb,
  add column if not exists failure text
    constraint search_log_failure_check check (failure ~ '^[a-z_]{1,32}$'),
  add column if not exists search_uid uuid,
  add column if not exists shared boolean not null default false,
  add column if not exists owner boolean not null default false,
  add column if not exists diag jsonb;

comment on column public.search_log.origin is
  'How the search was asked for (logOrigin in lib/search/pipeline.ts): typed; example or recent (our links, from=); chip (a chip removed) or sort (a sort change) on the results page; more ("עוד 3 אפשרויות"); preview (SEO landing pages); ad (utm_source / gclid on the URL). Null on legacy rows.';
comment on column public.search_log.without is
  'Chip ids the visitor removed (lib/search/chips.ts).';
comment on column public.search_log.sort_override is
  'Sort chosen with the refine buttons; null = the parsed sort_preference.';
comment on column public.search_log.timings is
  '{parse_ms, fetch_ms, explain_ms, total_ms} in whole ms (SearchTimings in lib/search/store.ts). A step that did not run is null; total_ms runs to the log write (to the failure for a failed search, to the answer for a shared one).';
comment on column public.search_log.ali_calls is
  'AliExpress calls this request made: product.query plus link.generate. 0 from the cache.';
comment on column public.search_log.rejected is
  'Products rejected per reason over every product checked (rejectionCounts in lib/ranking/rank.ts); null when nothing was fetched.';
comment on column public.search_log.failure is
  'Null when the search returned a response; otherwise the SearchFailure code it was answered with (lib/search/server.ts), and results_count is 0. Refused requests (rate limit) are not logged.';
comment on column public.search_log.search_uid is
  'Made by the app for this row (crypto.randomUUID) before it is written; the /go links of the results it showed carry it (clicks.search_uid).';
comment on column public.search_log.shared is
  'A request that joined an identical search already running on the same server: no work of its own. Not counted as a search in the stats.';
comment on column public.search_log.owner is
  'Made while a signed-in admin browsed (getAdminUser in lib/admin/auth.ts): logged, never counted in the stats and never listed on /searches.';
comment on column public.search_log.diag is
  '{fetch_stop, keywords_tried, demoted, explain_failed, explain_rejected} of a search that fetched or explained itself (SearchDiag in lib/search/store.ts); null for a full cache hit. For evals, never shown.';

create index if not exists search_log_search_uid_idx
  on public.search_log (search_uid)
  where search_uid is not null;

-- 3. Clicks ---------------------------------------------------------------------------------------

alter table public.clicks
  add column if not exists search_uid uuid,
  add column if not exists position smallint
    constraint clicks_position_check check (position between 1 and 100),
  add column if not exists owner boolean not null default false;

comment on column public.clicks.search_uid is
  'search_log.search_uid of the search whose result card was clicked (the /go s= parameter). Anyone can send one, so it is for the stats only; null when absent or malformed.';
comment on column public.clicks.position is
  '1-based rank of the clicked card (1 = the featured result, 4 and up = "עוד 3 אפשרויות"); null when absent or malformed.';
comment on column public.clicks.owner is
  'A click made while a signed-in admin browsed (see search_log.owner). Not counted in the stats.';

create index if not exists clicks_search_uid_idx
  on public.clicks (search_uid)
  where search_uid is not null;

-- 4. Production only ------------------------------------------------------------------------------

-- The /searches card set (20260927210000_recent_searches.sql), now for production rows only.
create or replace function public.recent_search_cards()
returns table (
  query_norm text,
  query text,
  parsed jsonb,
  category_id text,
  result_ids text[],
  results_count integer,
  searched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (l.query_norm)
    l.query_norm,
    l.query,
    l.parsed,
    l.category_id,
    l.result_ids,
    l.results_count,
    l.created_at
  from public.search_log l
  where l.listable
    and l.env = 'production' and not l.owner
    and l.failure is null
    and l.source = 'search'
    and l.results_count > 0
    and l.query_norm <> ''
    and not exists (
      select 1 from public.hidden_searches h where h.query_norm = l.query_norm
    )
  order by l.query_norm, l.created_at desc, l.id desc;
$$;

comment on function public.recent_search_cards() is
  'Latest listable, not hidden production search_log row per query_norm: the card set behind recent_searches and recent_search_categories. service_role only.';

-- The report functions of 20260927175632_phase2_stats.sql, production only. A search is a row
-- that returned a response (failure is null) and did its own work (not shared).
create or replace function public.stats_daily(p_days integer default 14)
returns table (
  day date,
  searches integer,
  searches_fresh integer,
  searches_cached integer,
  searches_zero integer,
  previews integer,
  more_loads integer,
  clicks integer,
  llm_calls integer,
  llm_cost_usd numeric,
  llm_unpriced_calls integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select ((now() at time zone 'Asia/Jerusalem')::date - g.i) as day
    from generate_series(0, least(greatest(p_days, 1), 90) - 1) as g(i)
  ),
  s as (
    select
      (l.created_at at time zone 'Asia/Jerusalem')::date as day,
      count(*) filter (where l.source = 'search') as searches,
      count(*) filter (where l.source = 'search' and l.cache is distinct from 'results') as fresh,
      count(*) filter (where l.source = 'search' and l.cache = 'results') as cached,
      count(*) filter (where l.source = 'search' and l.results_count = 0) as zero,
      count(*) filter (where l.source = 'preview') as previews,
      count(*) filter (where l.source = 'more') as more_loads
    from public.search_log l
    where l.created_at >= public.stats_window_start(p_days)
      and l.env = 'production' and not l.owner
      and l.failure is null
      and not l.shared
    group by 1
  ),
  c as (
    select (k.created_at at time zone 'Asia/Jerusalem')::date as day, count(*) as clicks
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
      and k.env = 'production' and not k.owner
    group by 1
  ),
  u as (
    select
      (x.created_at at time zone 'Asia/Jerusalem')::date as day,
      count(*) as calls,
      coalesce(sum(x.cost_usd), 0) as cost_usd,
      count(*) filter (where x.cost_usd is null) as unpriced
    from public.llm_usage x
    where x.created_at >= public.stats_window_start(p_days)
      and x.env = 'production'
    group by 1
  )
  select
    d.day,
    coalesce(s.searches, 0)::integer,
    coalesce(s.fresh, 0)::integer,
    coalesce(s.cached, 0)::integer,
    coalesce(s.zero, 0)::integer,
    coalesce(s.previews, 0)::integer,
    coalesce(s.more_loads, 0)::integer,
    coalesce(c.clicks, 0)::integer,
    coalesce(u.calls, 0)::integer,
    coalesce(u.cost_usd, 0)::numeric,
    coalesce(u.unpriced, 0)::integer
  from days d
  left join s on s.day = d.day
  left join c on c.day = d.day
  left join u on u.day = d.day
  order by d.day desc;
$$;

create or replace function public.stats_top_queries(
  p_days integer default 14,
  p_limit integer default 20
)
returns table (
  query_norm text,
  sample_query text,
  searches integer,
  zero_results integer,
  last_seen timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.query_norm, g.sample_query, g.searches, g.zero_results, g.last_seen
  from (
    select
      coalesce(l.query_norm, lower(btrim(l.query))) as query_norm,
      (array_agg(l.query order by l.created_at desc))[1] as sample_query,
      count(*)::integer as searches,
      (count(*) filter (where l.results_count = 0))::integer as zero_results,
      max(l.created_at) as last_seen
    from public.search_log l
    where l.source = 'search'
      and l.env = 'production' and not l.owner
      and l.failure is null
      and not l.shared
      and l.created_at >= public.stats_window_start(p_days)
    group by 1
  ) g
  order by g.searches desc, g.last_seen desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.stats_zero_result_queries(
  p_days integer default 14,
  p_limit integer default 20
)
returns table (
  query_norm text,
  sample_query text,
  searches integer,
  last_seen timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.query_norm, g.sample_query, g.searches, g.last_seen
  from (
    select
      coalesce(l.query_norm, lower(btrim(l.query))) as query_norm,
      (array_agg(l.query order by l.created_at desc))[1] as sample_query,
      count(*)::integer as searches,
      max(l.created_at) as last_seen
    from public.search_log l
    where l.source = 'search'
      and l.env = 'production' and not l.owner
      and l.failure is null
      and not l.shared
      and l.results_count = 0
      and l.created_at >= public.stats_window_start(p_days)
    group by 1
  ) g
  order by g.last_seen desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.stats_top_products(
  p_days integer default 14,
  p_limit integer default 10
)
returns table (
  product_id text,
  clicks integer,
  last_click timestamptz,
  title_he text,
  title_en text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select k.product_id, count(*)::integer as clicks, max(k.created_at) as last_click
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
      and k.env = 'production' and not k.owner
    group by k.product_id
    order by 2 desc, 3 desc
    limit least(greatest(p_limit, 1), 100)
  )
  select t.product_id, t.clicks, t.last_click, p.title_he, p.data ->> 'title'
  from ranked t
  left join public.products p on p.product_id = t.product_id
  order by t.clicks desc, t.last_click desc;
$$;

create or replace function public.stats_llm_by_kind(p_days integer default 14)
returns table (
  kind text,
  calls integer,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  cost_usd numeric,
  unpriced_calls integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    x.kind,
    count(*)::integer,
    coalesce(sum(x.input_tokens), 0)::bigint,
    coalesce(sum(x.output_tokens), 0)::bigint,
    coalesce(sum(x.cache_read_tokens), 0)::bigint,
    coalesce(sum(x.cache_write_tokens), 0)::bigint,
    coalesce(sum(x.cost_usd), 0)::numeric,
    (count(*) filter (where x.cost_usd is null))::integer
  from public.llm_usage x
  where x.created_at >= public.stats_window_start(p_days)
    and x.env = 'production'
  group by x.kind
  order by 7 desc, 2 desc;
$$;

-- 5. New reports (lib/stats/queries.ts) ------------------------------------------------------------

-- search_log.timings.total_ms as a number, or null when it is missing or not a number.
create or replace function public.search_log_total_ms(timings jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(timings -> 'total_ms') = 'number' then (timings ->> 'total_ms')::numeric
  end;
$$;

-- Production requests per origin over the window, and one total row (origin null), most first.
-- searches: rows that returned a response; zero_results / partial_results: of those, with 0 and
-- with 1-2 results; failures: rows that ended in an error; chips_removed: responses with a chip
-- removed; clicked: responses with at least one production click on their result cards;
-- median_ms_fresh / median_ms_cached: median total_ms of search responses (not "עוד 3 אפשרויות"
-- pages, which are always cache 'results' yet may wait for an explain call) that fetched results
-- (cache none or parse) and of full cache hits, null when there are none; the 'more' row has
-- none. Shared rows are left out.
create or replace function public.stats_by_origin(p_days integer default 14)
returns table (
  origin text,
  searches integer,
  zero_results integer,
  partial_results integer,
  failures integer,
  chips_removed integer,
  clicked integer,
  median_ms_fresh integer,
  median_ms_cached integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.origin,
    (count(*) filter (where l.failure is null))::integer,
    (count(*) filter (where l.failure is null and l.results_count = 0))::integer,
    (count(*) filter (where l.failure is null and l.results_count between 1 and 2))::integer,
    (count(*) filter (where l.failure is not null))::integer,
    (count(*) filter (where l.failure is null and cardinality(l.without) > 0))::integer,
    (count(*) filter (
      where l.failure is null
        and exists (
          select 1 from public.clicks k
          where k.search_uid = l.search_uid and k.env = 'production' and not k.owner
        )
    ))::integer,
    round(percentile_cont(0.5) within group (order by public.search_log_total_ms(l.timings))
      filter (where l.failure is null and l.source <> 'more'
        and l.cache is distinct from 'results'))::integer,
    round(percentile_cont(0.5) within group (order by public.search_log_total_ms(l.timings))
      filter (where l.failure is null and l.source <> 'more' and l.cache = 'results'))::integer
  from public.search_log l
  where l.created_at >= public.stats_window_start(p_days)
    and l.env = 'production' and not l.owner
    and not l.shared
    and l.origin is not null
  group by grouping sets ((l.origin), ())
  order by (l.origin is null), 2 desc, 1;
$$;

-- Production failures per code over the window, most first.
create or replace function public.stats_failures(p_days integer default 14)
returns table (
  failure text,
  failures integer,
  searches integer,
  last_seen timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.failure,
    count(*)::integer,
    (count(*) filter (where l.source = 'search'))::integer,
    max(l.created_at)
  from public.search_log l
  where l.created_at >= public.stats_window_start(p_days)
    and l.env = 'production' and not l.owner
    and l.failure is not null
  group by l.failure
  order by 2 desc, 4 desc;
$$;

-- Production clicks on the result cards of logged searches (/search and "עוד 3 אפשרויות": a
-- search_uid and a position) over the window, by position: 1 (the featured result), 2-3, and 4
-- and up. Clicks from other pages, SEO landing pages included, are not counted here.
create or replace function public.stats_click_positions(p_days integer default 14)
returns table (
  position_group text,
  clicks integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.position_group, count(*)::integer
  from (
    select case
      when k.position = 1 then 'featured'
      when k.position between 2 and 3 then 'top3'
      else 'more'
    end as position_group
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
      and k.env = 'production' and not k.owner
      and k.search_uid is not null
      and k.position is not null
  ) g
  group by g.position_group
  order by min(case g.position_group when 'featured' then 1 when 'top3' then 2 else 3 end);
$$;

revoke execute on function public.search_log_total_ms(jsonb) from public, anon, authenticated;
revoke execute on function public.stats_by_origin(integer) from public, anon, authenticated;
revoke execute on function public.stats_failures(integer) from public, anon, authenticated;
revoke execute on function public.stats_click_positions(integer) from public, anon, authenticated;

grant execute on function public.search_log_total_ms(jsonb) to service_role;
grant execute on function public.stats_by_origin(integer) to service_role;
grant execute on function public.stats_failures(integer) to service_role;
grant execute on function public.stats_click_positions(integer) to service_role;

comment on function public.stats_by_origin(integer) is
  'Production requests per search_log.origin (and a total row, origin null): responses, zero and partial results, failures, chips removed, clicked, median total_ms fresh and cached. service_role only.';
comment on function public.stats_failures(integer) is
  'Production failed requests per search_log.failure code. service_role only.';
comment on function public.stats_click_positions(integer) is
  'Production clicks on the result cards of logged searches per position group (featured, top3, more). service_role only.';
