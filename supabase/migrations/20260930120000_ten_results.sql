-- Ten results on the first view (owner decision 2026-09-30, RESULTS_FIRST_VIEW in
-- lib/config/site.ts): places 1-5 with their "why we picked it" lines, places 6-10 as standard
-- cards whose Hebrew titles come from a new, cheaper LLM call (lib/llm/titles.ts), and "עוד 5
-- אפשרויות" from place 11.
--
-- 1. llm_usage.kind accepts 'titles' (the titles call). Until this is applied the check refuses a
--    'titles' row and with it the whole insert; SupabaseStore.logUsage then writes the batch's
--    other rows again without it, so parse and explain calls are still recorded (the titles calls
--    of that time are not).
-- 2. stats_click_positions (/admin/stats "על איזו תוצאה לוחצים") groups by the new first view:
--      featured    position 1, the featured card
--      first_page  positions 2-5, the rest of the explained page
--      first_view  positions 6-10, the standard cards of the first view
--      more_pages  position 11 and up, the pages of "עוד 5 אפשרויות"
--    Same signature, security and grants as 20260928230000_five_results.sql. Apply it with the
--    deploy of the code that reads these groups (lib/stats/report.ts CLICK_POSITION_GROUPS): until
--    then that section says it could not load once a click past position 5 exists, rather than
--    count places 6-10 as "עוד". lib/stats/format.test.ts checks that the bounds here match
--    RESULTS_PER_PAGE and RESULTS_FIRST_VIEW.
--
-- search_log.results_count now counts every card of the first view (up to 10) for a search, and a
-- page (up to 5) for "עוד N" (SearchLogEntry.resultsCount): no schema change, its check is >= 0.

-- 1. LLM call kinds ------------------------------------------------------------------------------

alter table public.llm_usage drop constraint if exists llm_usage_kind_check;
alter table public.llm_usage
  add constraint llm_usage_kind_check
    check (kind in ('parse', 'explain', 'explain_more', 'titles', 'tips'));

comment on column public.llm_usage.kind is
  'The LLM job (LLM_CALL_KINDS in lib/stats/usage.ts): parse, explain (first page), explain_more ("עוד N"), titles (Hebrew titles of places 6-10, lib/llm/titles.ts) or tips.';

-- 2. Click positions ----------------------------------------------------------------------------

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
      when k.position between 2 and 5 then 'first_page'
      when k.position between 6 and 10 then 'first_view'
      else 'more_pages'
    end as position_group
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
      and k.env = 'production' and not k.owner
      and k.search_uid is not null
      and k.position is not null
  ) g
  group by g.position_group
  order by min(
    case g.position_group
      when 'featured' then 1
      when 'first_page' then 2
      when 'first_view' then 3
      else 4
    end
  );
$$;

revoke execute on function public.stats_click_positions(integer) from public, anon, authenticated;
grant execute on function public.stats_click_positions(integer) to service_role;

comment on function public.stats_click_positions(integer) is
  'Production clicks on the result cards of logged searches per position group (featured: 1, first_page: 2-5, first_view: 6-10, more_pages: 11 and up). service_role only.';
