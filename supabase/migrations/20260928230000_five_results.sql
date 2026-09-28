-- Five results per page (owner decision 2026-09-28, RESULTS_PER_PAGE 5 in lib/config/site.ts):
-- the click positions of /admin/stats ("על איזו תוצאה לוחצים") are grouped by the new page:
--   featured    position 1, the featured card
--   first_page  positions 2-5, the rest of the first page (was 'top3', positions 2-3)
--   more        position 6 and up, the pages of "עוד 5 אפשרויות"
-- Same signature, security and grants as 20260928140000_search_telemetry.sql. Apply it with the
-- deploy of the code that reads 'first_page' (lib/stats/report.ts CLICK_POSITION_GROUPS): until
-- then that section says it could not load, rather than mislabel positions 4 and 5.
-- lib/stats/format.test.ts checks that the bounds here match RESULTS_PER_PAGE.

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
      else 'more'
    end as position_group
    from public.clicks k
    where k.created_at >= public.stats_window_start(p_days)
      and k.env = 'production' and not k.owner
      and k.search_uid is not null
      and k.position is not null
  ) g
  group by g.position_group
  order by min(case g.position_group when 'featured' then 1 when 'first_page' then 2 else 3 end);
$$;

revoke execute on function public.stats_click_positions(integer) from public, anon, authenticated;
grant execute on function public.stats_click_positions(integer) to service_role;

comment on function public.stats_click_positions(integer) is
  'Production clicks on the result cards of logged searches per position group (featured: 1, first_page: 2-5, more: 6 and up). service_role only.';
