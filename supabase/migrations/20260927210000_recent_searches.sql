-- Public "חיפושים אחרונים" page (/searches) and the 14-day search cache.
--
-- 1. search_log gets category_id (first-level AliExpress category of the first result) and
--    listable: set when the search is logged (isListableSearch in lib/search/pipeline.ts), true
--    only for a query the visitor typed (source 'search', not a recent-search card or an example
--    link) with no chip removed and no sort override, at least one result, and a query that
--    passed isListableQuery (lib/recent/privacy.ts: no phone or ID numbers, emails, handles or
--    links). Existing rows are backfilled below.
-- 2. hidden_searches: normalized queries an admin took off the page (/admin/searches).
-- 3. Read functions for lib/recent/db.ts: one card per normalized query (its latest listable row,
--    unless hidden), newest first, with up to 3 result photos from products. Hebrew category
--    names live in TypeScript (lib/tips/category.ts categoryLabelHe), so the functions work with
--    ids only.
-- 4. Both cache levels are now fresh for 14 days (owner decision 2026-09-27, was 48h;
--    CACHE_TTL_DAYS in lib/search/cache-key.ts); a result set with no products stays fresh for
--    48h only (EMPTY_RESULTS_TTL_HOURS). Only the comments change here.
--
-- Apply this migration BEFORE deploying the code that ships with it: that code writes
-- search_log.category_id and .listable, and every search_log insert fails (searches still work,
-- their stats rows are lost) until the columns exist. The code deployed before it is unaffected:
-- listable defaults to false and category_id may be null, so searches logged between the
-- migration and the deploy are simply not listed.
--
-- RLS stays on with no policies and everything is revoked from anon/authenticated: only the
-- server's service role reads or writes any of it. The public page reads through the service role
-- (lib/recent/queries.ts), which checks every row again in code.

-- 1. Search log --------------------------------------------------------------------------------

alter table public.search_log
  add column if not exists category_id text,
  add column if not exists listable boolean not null default false;

comment on column public.search_log.category_id is
  'First-level AliExpress category id of the first result (products.data.category.firstId); null when unknown. Hebrew names: categoryLabelHe in lib/tips/category.ts.';
comment on column public.search_log.listable is
  'May appear on the public recent-searches page (/searches): a query the visitor typed (source = search, not from one of the site''s own links) with no chip removed and no sort override, results_count > 0 and a query that passed isListableQuery (lib/recent/privacy.ts). Written once with the row (isListableSearch in lib/search/pipeline.ts). An admin can still hide the query (hidden_searches).';
comment on column public.search_log.cache is
  'What the 14-day cache saved: none (fresh parse and results), parse (cached parse, fresh results), results (full cache hit).';

-- Rows logged by the deployment that predates phase2_stats, including a few written after that
-- migration ran, have no cache or results_count. Same reasoning as the phase2_stats backfill:
-- that code logged fresh searches only and kept every ranked product, of which 3 were shown.
update public.search_log
set
  cache = coalesce(cache, 'none'),
  results_count = coalesce(results_count, least(cardinality(result_ids), 3))
where cache is null or results_count is null;

-- A SQL copy of normalizeQuery (lib/search/cache-key.ts: NFKC, niqqud, case, ש״ח / שקל / nis → ₪,
-- punctuation, "100 ₪" → "₪100", spacing). The copy matched normalizeQuery on 18 sample queries
-- (2026-09-27). Used for the query_norm backfill below and by the /searches text filter, which
-- compares the Hebrew product label normalized the same way as the filter text.
create or replace function public.normalize_search_query(q text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(regexp_replace(
              normalize(q, NFKC),
              '[\x0591-\x05BD\x05BF\x05C1\x05C2\x05C4\x05C5\x05C7]', '', 'g'
            )),
            '(^|[[:space:],(])(ש["״”''׳]?ח|שקלים|שקל|nis|ils)(?=$|[[:space:].,!?:;)])', '\1₪', 'g'
          ),
          '[,.!?:;()\[\]{}"''״׳“”„‘’«»\-–—־/\\|]+', ' ', 'g'
        ),
        '([0-9]+(\.[0-9]+)?)[[:space:]]*₪', '₪\1', 'g'
      ),
      '₪[[:space:]]+([0-9])', '₪\1', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ));
$$;

revoke execute on function public.normalize_search_query(text) from public, anon, authenticated;
grant execute on function public.normalize_search_query(text) to service_role;

comment on function public.normalize_search_query(text) is
  'SQL copy of normalizeQuery (lib/search/cache-key.ts); keep the two in step. service_role only.';

-- phase2_stats backfilled query_norm with spacing and case only. Those rows (and rows with no
-- query_norm) are recomputed with normalize_search_query, so an old search and a new one for the
-- same text share one card and one hidden_searches key. A row whose query_norm already came from
-- normalizeQuery and equals the simple form has no punctuation, currency or niqqud, so it
-- recomputes to the same value.
update public.search_log
set query_norm = public.normalize_search_query(query)
where query_norm is null
  or query_norm = lower(btrim(regexp_replace(query, '\s+', ' ', 'g')));

-- Category of the first result, from the product saved by that search. Only numeric ids, the
-- same rule as the /searches?cat= parameter (lib/recent/params.ts).
update public.search_log l
set category_id = p.data -> 'category' ->> 'firstId'
from public.products p
where l.category_id is null
  and cardinality(l.result_ids) > 0
  and p.product_id = l.result_ids[1]
  and (p.data -> 'category' ->> 'firstId') ~ '^[0-9]{1,12}$';

-- listable for the rows logged before this migration (no row is listable before it).
-- The query: a stricter SQL copy of isListableQuery (lib/recent/privacy.ts), never looser, so
-- recent_search_categories never counts a card that lib/recent/db.ts would then drop. After NFKC
-- with runs of spaces collapsed and trimmed, it must be 2-120 characters of printable ASCII,
-- Hebrew, general punctuation and ₪ only (anything else, such as Arabic-Indic digits or a
-- zero-width space, is simply not listed; so within it the only digits are 0-9 and the only
-- letters A-Z, a-z and Hebrew), with no run of 7+ digits with up to 3 non-letters between them, no
-- '@', no http(s)://, www. or domain-shaped token. Checked against 49 sample queries (2026-09-27).
-- The search: the deployment that predates this migration logged every fresh run as source
-- 'search', including the home page example preview (the site's own example query, harmless;
-- an admin can hide it), chip removals and sort changes. Their rows cannot say which it was,
-- so a row is listed only when its filters equal a cached parse of the same query: no chip
-- removed and no sort override. Simulated read-only on production (2026-09-27): it lists 9 of the
-- 11 rows with results (6 normalized queries) and leaves out the 2 sort changes.
update public.search_log l
set listable = true
from (
  select id, btrim(regexp_replace(normalize(query, NFKC), ' +', ' ', 'g')) as q
  from public.search_log
  where not listable
    and source = 'search'
    and results_count > 0
) n
where l.id = n.id
  and char_length(n.q) between 2 and 120
  and n.q !~ '[^\x20-\x7E\x0590-\x05FF\x200E-\x2027\x20AA]'
  and n.q !~ '[0-9]([^0-9A-Za-z\x05D0-\x05EA\x05EF-\x05F2]{0,3}[0-9]){6,}'
  and strpos(n.q, '@') = 0
  and n.q !~* '(https?://|www\.|[a-z0-9-]+\.[a-z]{2,24}(?![a-z0-9_]))'
  and exists (
    select 1
    from public.parse_cache pc
    where pc.query_norm = l.query_norm
      and pc.parsed = l.parsed
  );

-- The listing reads the latest listable row per query_norm (DISTINCT ON query_norm, newest first).
create index if not exists search_log_listable_idx
  on public.search_log (query_norm, created_at desc)
  where listable;

-- 2. Hidden searches ---------------------------------------------------------------------------

create table if not exists public.hidden_searches (
  -- search_log.query_norm of the card; every search with this normalized text stays off the page.
  query_norm text primary key
    constraint hidden_searches_query_norm_length check (char_length(query_norm) between 1 and 400),
  hidden_at timestamptz not null default now()
);
alter table public.hidden_searches enable row level security;
revoke all on table public.hidden_searches from anon, authenticated;
grant select, insert, update, delete on table public.hidden_searches to service_role;

comment on table public.hidden_searches is
  'Normalized queries an admin removed from the public recent-searches page (/admin/searches). service_role only.';

-- 3. Reads (lib/recent/db.ts, with supabase.rpc) --------------------------------------------------

-- One row per normalized query: its latest listable search, unless an admin hid that query.
-- Checked again here (source, results_count) so a wrong listable flag alone never lists a row.
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
    and l.source = 'search'
    and l.results_count > 0
    and l.query_norm <> ''
    and not exists (
      select 1 from public.hidden_searches h where h.query_norm = l.query_norm
    )
  order by l.query_norm, l.created_at desc, l.id desc;
$$;

-- Cards for /searches and the home strip, newest first, at most p_limit (clamped to 1..300; the
-- page asks for one more than it shows to learn whether there are more).
-- Category filter: p_category_ids null and p_include_unknown false = every card. Otherwise a card
-- matches when its category_id is in p_category_ids, or when p_include_unknown and it has none.
-- The "אחר" bucket (OTHER_CATEGORY in lib/recent/types.ts) is the ids without a Hebrew name plus
-- the unknown ones; TypeScript knows the names, so it sends those ids.
-- Text filter: p_text is normalizeQuery(text) from TypeScript, found anywhere in the normalized
-- query or in the Hebrew product label (parsed.product_he) normalized the same way
-- (normalize_search_query, so "usb-c" finds "כבל USB-C"). strpos, so % and _ are plain text.
-- images: up to 3 {src, alt} of the results the search showed, in result order, from products
-- (a product never saved has no photo here). alt is the Hebrew title, else the AliExpress one.
create or replace function public.recent_searches(
  p_limit integer default 25,
  p_category_ids text[] default null,
  p_include_unknown boolean default false,
  p_text text default null
)
returns table (
  query_norm text,
  query text,
  parsed jsonb,
  category_id text,
  results_count integer,
  searched_at timestamptz,
  images jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select c.*
    from public.recent_search_cards() c
    where (
        (p_category_ids is null and not coalesce(p_include_unknown, false))
        or c.category_id = any (p_category_ids)
        or (coalesce(p_include_unknown, false) and c.category_id is null)
      )
      and (
        nullif(p_text, '') is null
        or strpos(c.query_norm, p_text) > 0
        or strpos(public.normalize_search_query(coalesce(c.parsed ->> 'product_he', '')), p_text) > 0
      )
    order by c.searched_at desc, c.query_norm
    limit least(greatest(coalesce(p_limit, 25), 1), 300)
  )
  select
    f.query_norm,
    f.query,
    f.parsed,
    f.category_id,
    f.results_count,
    f.searched_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'src', p.data ->> 'mainImageUrl',
            'alt', coalesce(nullif(btrim(p.title_he), ''), p.data ->> 'title')
          )
          order by r.ord
        )
        from unnest(f.result_ids[1:least(f.results_count, 3)]) with ordinality as r (product_id, ord)
        join public.products p on p.product_id = r.product_id
        where p.data ->> 'mainImageUrl' is not null
      ),
      '[]'::jsonb
    )
  from filtered f
  order by f.searched_at desc, f.query_norm;
$$;

-- Cards per category_id (null = unknown) over every listed card, most first. TypeScript turns the
-- ids into Hebrew names and folds the unnamed and unknown ones into "אחר".
create or replace function public.recent_search_categories()
returns table (
  category_id text,
  cards integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.category_id, count(*)::integer
  from public.recent_search_cards() c
  group by c.category_id
  order by 2 desc, c.category_id nulls last;
$$;

-- /admin/searches: hidden queries, most recently hidden first, with the latest spelling typed
-- (null when no listable search has that normalized text any more). p_limit clamped to 1..500.
create or replace function public.recent_searches_hidden(p_limit integer default 100)
returns table (
  query_norm text,
  hidden_at timestamptz,
  query text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    h.query_norm,
    h.hidden_at,
    (
      select l.query
      from public.search_log l
      where l.listable and l.query_norm = h.query_norm
      order by l.created_at desc
      limit 1
    )
  from public.hidden_searches h
  order by h.hidden_at desc, h.query_norm
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke execute on function public.recent_search_cards() from public, anon, authenticated;
revoke execute on function public.recent_searches(integer, text[], boolean, text) from public, anon, authenticated;
revoke execute on function public.recent_search_categories() from public, anon, authenticated;
revoke execute on function public.recent_searches_hidden(integer) from public, anon, authenticated;

grant execute on function public.recent_search_cards() to service_role;
grant execute on function public.recent_searches(integer, text[], boolean, text) to service_role;
grant execute on function public.recent_search_categories() to service_role;
grant execute on function public.recent_searches_hidden(integer) to service_role;

comment on function public.recent_search_cards() is
  'Latest listable, not hidden search_log row per query_norm: the card set behind recent_searches and recent_search_categories. service_role only.';
comment on function public.recent_searches(integer, text[], boolean, text) is
  'Public recent-searches cards (latest listable, not hidden row per query_norm), newest first, with up to 3 result photos. service_role only.';
comment on function public.recent_search_categories() is
  'Listed recent-search cards per first-level category id (null = unknown). service_role only.';
comment on function public.recent_searches_hidden(integer) is
  'Queries hidden from the recent-searches page, for /admin/searches. service_role only.';

-- 4. Cache freshness ---------------------------------------------------------------------------

comment on table public.parse_cache is
  'Normalized query → parsed filters. Fresh for 14 days (owner decision 2026-09-27, was 48h).';
comment on table public.search_cache is
  'Canonical filters (incl. ranking version) → results and explanations. Fresh for 14 days (owner decision 2026-09-27, was 48h); an entry with no products for 48h only. query is the first request that produced the entry.';
