-- Phase 2: usage and cost stats for /admin/stats.
--
-- 1. llm_usage: one row per LLM call (parse, explain, explain_more, tips) with the token usage the
--    provider reported and the cost from lib/llm/pricing.ts. No query text, no output, no visitor.
-- 2. search_log gets what the dashboard needs: which cache level served the search, how many
--    results it returned, the normalized query (lib/search/cache-key.ts normalizeQuery) and who
--    asked (source). Still no IP and no user data (CLAUDE.md §6.9).
-- 3. Read-only report functions, all in Asia/Jerusalem calendar days (the same days as the daily
--    LLM budget, lib/guard/rate-limit.ts).
--
-- RLS stays on with no policies and everything is revoked from anon/authenticated: only the
-- server's service role reads or writes any of it.

-- 1. LLM calls --------------------------------------------------------------------------------

create table public.llm_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('parse', 'explain', 'explain_more', 'tips')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  -- Null when the model has no known price: a cost is never guessed.
  cost_usd numeric(10, 6) check (cost_usd >= 0)
);
create index llm_usage_created_at_idx on public.llm_usage (created_at);
alter table public.llm_usage enable row level security;
revoke all on table public.llm_usage from anon, authenticated;
revoke all on sequence public.llm_usage_id_seq from anon, authenticated;
-- Supabase's default privileges already cover service_role; explicit so this never depends on them.
grant select, insert on table public.llm_usage to service_role;
grant usage on sequence public.llm_usage_id_seq to service_role;

comment on table public.llm_usage is
  'One row per LLM call: job, model, tokens and cost in USD (lib/llm/pricing.ts). service_role only.';

-- 2. Search log -------------------------------------------------------------------------------

alter table public.search_log
  add column cache text check (cache in ('none', 'parse', 'results')),
  add column results_count integer check (results_count >= 0),
  add column query_norm text,
  add column source text not null default 'search'
    check (source in ('search', 'preview', 'more'));

comment on column public.search_log.cache is
  'What the 48h cache saved: none (fresh parse and results), parse (cached parse, fresh results), results (full cache hit).';
comment on column public.search_log.results_count is
  'Results returned by this response (0-3). 0 = zero-result search.';
comment on column public.search_log.query_norm is
  'normalizeQuery(query) from lib/search/cache-key.ts: groups trivially different spellings.';
comment on column public.search_log.source is
  'search = a visitor''s search (also chip removals and sort changes); preview = examplePreview (the home page example and SEO landing pages); more = "עוד 3 אפשרויות" (query holds the result set''s Hebrew product label). Only search rows count as searches.';

-- Rows written before this migration were fresh searches only (cache hits were not logged) and
-- kept every ranked product, of which the first 3 were shown. Their normalization is simpler than
-- normalizeQuery (spacing and case only), which is close enough for a 14-day window.
update public.search_log
set
  cache = coalesce(cache, 'none'),
  results_count = coalesce(results_count, least(cardinality(result_ids), 3)),
  query_norm = coalesce(query_norm, lower(btrim(regexp_replace(query, '\s+', ' ', 'g'))))
where cache is null or results_count is null or query_norm is null;

-- The daily reports scan clicks by time (the existing index leads with product_id).
create index if not exists clicks_created_at_idx on public.clicks (created_at);

-- 3. Reports (Asia/Jerusalem days) -------------------------------------------------------------
-- Called by lib/stats/queries.ts with supabase.rpc(). p_days is clamped to 1..90 and p_limit to
-- 1..100. "Today" is the current Israel day; a window of p_days ends with today.

-- First instant (Israel midnight) of a window of p_days days that ends with today.
create or replace function public.stats_window_start(p_days integer)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select (
    ((now() at time zone 'Asia/Jerusalem')::date - (least(greatest(p_days, 1), 90) - 1))::timestamp
    at time zone 'Asia/Jerusalem'
  );
$$;

-- One row per Israel day, newest first, including days with no activity.
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
    group by 1
  ),
  c as (
    select (k.created_at at time zone 'Asia/Jerusalem')::date as day, count(*) as clicks
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
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

-- Most searched queries (visitor searches only), grouped by normalized text. sample_query is the
-- most recent spelling, for display and for "צרו עמוד SEO".
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
    where l.source = 'search' and l.created_at >= public.stats_window_start(p_days)
    group by 1
  ) g
  order by g.searches desc, g.last_seen desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Most recent queries that returned no results, one row per normalized query.
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
      and l.results_count = 0
      and l.created_at >= public.stats_window_start(p_days)
    group by 1
  ) g
  order by g.last_seen desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Most clicked products (/go click-outs from every source), with their stored titles.
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
    group by k.product_id
    order by 2 desc, 3 desc
    limit least(greatest(p_limit, 1), 100)
  )
  select t.product_id, t.clicks, t.last_click, p.title_he, p.data ->> 'title'
  from ranked t
  left join public.products p on p.product_id = t.product_id
  order by t.clicks desc, t.last_click desc;
$$;

-- LLM calls, tokens and cost per job over the window.
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
  group by x.kind
  order by 7 desc, 2 desc;
$$;

revoke execute on function public.stats_window_start(integer) from public, anon, authenticated;
revoke execute on function public.stats_daily(integer) from public, anon, authenticated;
revoke execute on function public.stats_top_queries(integer, integer) from public, anon, authenticated;
revoke execute on function public.stats_zero_result_queries(integer, integer) from public, anon, authenticated;
revoke execute on function public.stats_top_products(integer, integer) from public, anon, authenticated;
revoke execute on function public.stats_llm_by_kind(integer) from public, anon, authenticated;

grant execute on function public.stats_window_start(integer) to service_role;
grant execute on function public.stats_daily(integer) to service_role;
grant execute on function public.stats_top_queries(integer, integer) to service_role;
grant execute on function public.stats_zero_result_queries(integer, integer) to service_role;
grant execute on function public.stats_top_products(integer, integer) to service_role;
grant execute on function public.stats_llm_by_kind(integer) to service_role;
