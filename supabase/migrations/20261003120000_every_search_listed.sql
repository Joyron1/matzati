-- Every search with results is listed on /searches, and crawlers get an origin of their own
-- (owner requests 2026-10-03).
--
-- 1. search_log.origin accepts 'bot': a crawler or script (isBotUserAgent in lib/guard/bots.ts) is
--    never given paid work; when /search or POST /api/search serves it a cached result set, its row
--    is logged with origin 'bot' (a crawler that got nothing writes no row). Until this migration
--    is applied those inserts fail the old check and the row is lost (the crawler is still served):
--    search_log simply stays without them.
-- 2. recent_search_cards (/searches and the home strip) reads env 'production' and 'legacy': the
--    'legacy' rows are the production searches logged before the env column existed
--    (20260928140000_search_telemetry.sql made every older row 'legacy'). A 'bot' row is never a
--    card, even with a wrong listable flag. Same signature, so `create or replace` keeps its grants
--    (service_role only); security invoker and the comment as before, the comment updated.
-- 3. The stats report functions that count searches leave out origin 'bot' (stats_daily,
--    stats_top_queries, stats_zero_result_queries, stats_by_origin). Copies of
--    20260928140000_search_telemetry.sql with that one condition added; same signatures, so their
--    grants stay. stats_failures needs none (a crawler's row never has a failure), and the click
--    reports read clicks, not search_log.
-- 4. listable for the rows logged before the rule changed: isListableSearch (lib/search/pipeline.ts)
--    now lists every visitor search (source 'search') that showed results, whatever started it:
--    typed, an example, a recent-search card, a removed chip, a sort change or an ad landing (and
--    the legacy rows, whose origin is null). Still never: "עוד N" pages (source 'more'), SEO
--    refresh runs ('preview'), failed searches, searches with no results, crawlers ('bot'), queries
--    that fail the privacy check, queries an admin hid (hidden_searches, read by the card set), and
--    the WhatsApp bot's searches (typed false with no arrival in the code; its privacy section
--    promises they are never listed). search_log has no typed column: the bot's rows are origin
--    'typed', and a site search with origin 'typed' that showed results and passes the check is
--    listable already (the owner's earlier ones since 20260929010000_seo_snapshots.sql), so the
--    backfill takes only the origins that were left out (example, recent, chip, sort, ad) and the
--    legacy rows (origin null; logged before the bot existed).
--    The query check is the stricter SQL copy of isListableQuery (lib/recent/privacy.ts) from
--    20260927210000_recent_searches.sql, exactly as there and in 20260929010000_seo_snapshots.sql.
--
-- Order with the code: either. The code that ships with it writes listable for every origin and
-- 'bot' rows; before this migration only the 'bot' rows are lost and the legacy rows stay off the
-- page. The code deployed before it is unaffected (no 'bot' rows; its listable flags stay as they
-- were, the backfill only adds).
--
-- RLS stays on with no policies; everything stays revoked from anon/authenticated.

-- 1. Origin 'bot' ---------------------------------------------------------------------------------

alter table public.search_log drop constraint if exists search_log_origin_check;
alter table public.search_log
  add constraint search_log_origin_check
    check (origin in ('typed', 'example', 'recent', 'chip', 'sort', 'more', 'preview', 'ad', 'bot'));

comment on column public.search_log.origin is
  'How the search was asked for (logOrigin in lib/search/pipeline.ts): typed; example or recent (our links, from=); chip (a chip removed) or sort (a sort change) on the results page; more ("עוד N אפשרויות"); preview (SEO landing pages); ad (utm_source / gclid on the URL); bot (a crawler served from the cache only, lib/guard/bots.ts: never listed, not in the stats). Null on legacy rows.';

comment on column public.search_log.listable is
  'May appear on the public recent-searches page (/searches): a search made on the site (source = search, any origin but bot; never the WhatsApp bot''s) with results_count > 0 and a query that passed isListableQuery (lib/recent/privacy.ts). Written once with the row (isListableSearch in lib/search/pipeline.ts; every origin since 2026-10-03). An admin can still hide the query (hidden_searches).';

-- 2. The card set: production and legacy rows ---------------------------------------------------

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
    and l.env in ('production', 'legacy')
    and l.failure is null
    and l.source = 'search'
    and l.origin is distinct from 'bot'
    and l.results_count > 0
    and l.query_norm <> ''
    and not exists (
      select 1 from public.hidden_searches h where h.query_norm = l.query_norm
    )
  order by l.query_norm, l.created_at desc, l.id desc;
$$;

comment on function public.recent_search_cards() is
  'Latest listable, not hidden production search_log row per query_norm (legacy rows count as production: they were logged before the env column; the owner''s searches included, crawlers'' never): the card set behind recent_searches and recent_search_categories. service_role only.';

-- 3. Stats without crawlers -----------------------------------------------------------------------

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
      and l.origin is distinct from 'bot'
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
      and l.origin is distinct from 'bot'
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
      and l.origin is distinct from 'bot'
      and l.results_count = 0
      and l.created_at >= public.stats_window_start(p_days)
    group by 1
  ) g
  order by g.last_seen desc
  limit least(greatest(p_limit, 1), 100);
$$;

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
    and l.origin <> 'bot'
  group by grouping sets ((l.origin), ())
  order by (l.origin is null), 2 desc, 1;
$$;

comment on function public.stats_by_origin(integer) is
  'Production requests per search_log.origin (and a total row, origin null), crawlers (bot) left out: responses, zero and partial results, failures, chips removed, clicked, median total_ms fresh and cached. service_role only.';

-- 4. Backfill: every earlier visitor search with results ---------------------------------------

update public.search_log l
set listable = true
from (
  select id, btrim(regexp_replace(normalize(query, NFKC), ' +', ' ', 'g')) as q
  from public.search_log
  where not listable
    and env in ('production', 'legacy')
    and source = 'search'
    and (origin is null or origin in ('example', 'recent', 'chip', 'sort', 'ad'))
    and failure is null
    and results_count > 0
) n
where l.id = n.id
  and char_length(n.q) between 2 and 120
  and n.q !~ '[^\x20-\x7E\x0590-\x05FF\x200E-\x2027\x20AA]'
  and n.q !~ '[0-9]([^0-9A-Za-z\x05D0-\x05EA\x05EF-\x05F2]{0,3}[0-9]){6,}'
  and strpos(n.q, '@') = 0
  and n.q !~* '(https?://|www\.|[a-z0-9-]+\.[a-z]{2,24}(?![a-z0-9_]))';
