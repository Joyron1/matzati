-- SEO landing pages keep their results, and /searches lists the owner's own typed searches
-- (owner decisions 2026-09-29).
--
-- 1. seo_pages gets the page's stored results (lib/seo/snapshot.ts): results (the SearchResponse
--    the page shows), results_at (when those products were fetched from AliExpress: the page's
--    "נבדקו ב־" date and what the daily cron calls stale after about 7 days), refresh_attempted_at
--    (when the last refresh started: the claim that keeps two refreshes of one page apart and a
--    page from being tried twice a night) and refresh_error (why the last refresh stored nothing,
--    or 'degraded' for results stored without our explanations). A refresh replaces the results
--    only with a run at least as good (lib/seo/refresh.ts), and nothing deletes them: run_retention
--    keeps seo_pages.
-- 2. The updated_at trigger now moves only when the admin changes the page (slug, query, title_he,
--    intro_he, published), so refreshes leave the sitemap's lastmod and the admin's "נשמר" date
--    alone. A changed query clears results_at: the stored results were made for the old query, so
--    the page stops showing them (readSnapshot checks the query too) and the cron counts the page
--    as due; the old results stay until a refresh replaces them.
-- 3. anon still reads published rows only (RLS), now column by column: the page and its results,
--    never refresh_attempted_at or refresh_error. The code names its columns (lib/seo/db.ts); a
--    select of "*" by anon would now be refused.
-- 4. recent_search_cards (so /searches and the home strip) no longer leaves out rows made while
--    the admin was signed in (search_log.owner): the owner's typed searches are real searches.
--    listable still decides (a typed query, no chip removed, no sort override, results, the
--    privacy check), production only as before. Every stats function still leaves owner rows out.
-- 5. The owner's production searches logged before this change were never marked listable; those
--    that would have been are marked now, with the same strict SQL copy of isListableQuery
--    (lib/recent/privacy.ts) as 20260927210000_recent_searches.sql.
--
-- Apply BEFORE deploying the code that ships with it. That code also works before it (a page reads
-- "nothing stored" and runs its query live, as before; the admin list says the stored results
-- could not be loaded), but every refresh fails until the columns exist, and the owner's new
-- searches are marked listable while recent_search_cards still leaves them out.

-- 1. Stored results -----------------------------------------------------------------------------

alter table public.seo_pages
  add column if not exists results jsonb
    constraint seo_pages_results_shape
    check (
      results is null
      or (
        coalesce(jsonb_typeof(results -> 'results'), '') = 'array'
        and octet_length(results::text) <= 262144
      )
    ),
  add column if not exists results_at timestamptz,
  add column if not exists refresh_attempted_at timestamptz,
  add column if not exists refresh_error text
    constraint seo_pages_refresh_error_format check (refresh_error ~ '^[a-z_]{1,32}$');

comment on column public.seo_pages.results is
  'The SearchResponse the page shows (lib/seo/snapshot.ts), written by lib/seo/refresh.ts only when a run is at least as good as the one stored. Never deleted.';
comment on column public.seo_pages.results_at is
  'When the stored results were fetched from AliExpress; null before the first snapshot and after the query changes (trigger). The daily cron refreshes a page about 7 days after it.';
comment on column public.seo_pages.refresh_attempted_at is
  'When the last refresh of the page started (the claim: one refresh at a time per page, one cron try per night).';
comment on column public.seo_pages.refresh_error is
  'Why the last refresh stored nothing (a search failure code, empty, smaller, degraded), or degraded for results stored without our explanations; null after a clean refresh.';

-- 2. updated_at and results_at ------------------------------------------------------------------

create or replace function public.seo_pages_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only the admin's edits move updated_at (the sitemap's lastmod); a refresh does not.
  if (new.slug, new.query, new.title_he, new.intro_he, new.published)
     is distinct from (old.slug, old.query, old.title_he, old.intro_he, old.published) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  -- Results of another query are never current: the page stops showing them and is due at once.
  if new.query is distinct from old.query then
    new.results_at := null;
  end if;
  return new;
end;
$$;

-- 3. Column privileges ----------------------------------------------------------------------------

revoke select on public.seo_pages from anon, authenticated;
grant select (
  slug, query, title_he, intro_he, published, created_at, updated_at, results, results_at
) on public.seo_pages to anon, authenticated;

-- 4. Recent searches: the owner's typed searches too ---------------------------------------------

-- Same as 20260928140000_search_telemetry.sql without "and not l.owner". Same signature, so
-- `create or replace` keeps its grants (service_role only).
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
    and l.env = 'production'
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
  'Latest listable, not hidden production search_log row per query_norm (the owner''s typed searches included): the card set behind recent_searches and recent_search_categories. service_role only.';

comment on column public.search_log.owner is
  'Made while a signed-in admin browsed (getAdminUser in lib/admin/auth.ts): logged and never counted in the stats. A typed one is listed on /searches like any other (owner decision 2026-09-29).';

-- 5. The owner's earlier typed searches -----------------------------------------------------------

-- The rows isListableSearch (lib/search/pipeline.ts) would now mark: typed (origin 'typed': not an
-- example, a recent-search card, an ad, a chip removal or a sort change), no chip removed, no sort
-- override, answered with results; and a query that passes the SQL copy of isListableQuery from
-- 20260927210000_recent_searches.sql (stricter than the code, never looser).
update public.search_log l
set listable = true
from (
  select id, btrim(regexp_replace(normalize(query, NFKC), ' +', ' ', 'g')) as q
  from public.search_log
  where owner
    and not listable
    and env = 'production'
    and source = 'search'
    and origin = 'typed'
    and cardinality(without) = 0
    and sort_override is null
    and failure is null
    and results_count > 0
) n
where l.id = n.id
  and char_length(n.q) between 2 and 120
  and n.q !~ '[^\x20-\x7E\x0590-\x05FF\x200E-\x2027\x20AA]'
  and n.q !~ '[0-9]([^0-9A-Za-z\x05D0-\x05EA\x05EF-\x05F2]{0,3}[0-9]){6,}'
  and strpos(n.q, '@') = 0
  and n.q !~* '(https?://|www\.|[a-z0-9-]+\.[a-z]{2,24}(?![a-z0-9_]))';
