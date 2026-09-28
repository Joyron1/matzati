-- Site settings the owner changes in /admin/settings (owner decision 2026-09-28). One row per
-- setting; the first is the shop cap of the search results:
--   shop_cap  {"mode": "none"}  no limit per shop (near-duplicate listings are still removed)
--             {"mode": "max2"}  at most 2 products of one shop on the first page of 5, and the
--                               same share (6) of the 15 kept (lib/ranking/config.ts SHOP_CAPS)
--
-- Read by the server with the service role (lib/settings/queries.ts: cached 5 minutes under the
-- tag "settings", and "none" whenever the row cannot be read), written only by the admin's server
-- action after requireAdmin() (lib/settings/admin.ts), which then expires that tag. Until this
-- migration is applied the search reads fail quietly and rank with "none", and saving in
-- /admin/settings says it could not save.
--
-- RLS on with no policies, and nothing granted to anon or authenticated: the service role only.

create table public.site_settings (
  key text primary key
    constraint site_settings_key_format check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- updated_at is kept by the database, not by callers (same as coupons and seo_pages).
create or replace function public.site_settings_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger site_settings_touch_updated_at
  before update on public.site_settings
  for each row execute function public.site_settings_touch_updated_at();

alter table public.site_settings enable row level security;

-- Explicit privileges instead of the project's default grants (which give anon and authenticated
-- every privilege, leaving RLS as the only guard).
revoke all on table public.site_settings from anon, authenticated;
-- Supabase's default privileges already cover service_role; explicit so this never depends on them.
grant select, insert, update on table public.site_settings to service_role;

revoke execute on function public.site_settings_touch_updated_at() from public, anon, authenticated;

insert into public.site_settings (key, value)
values ('shop_cap', '{"mode": "none"}'::jsonb)
on conflict (key) do nothing;

comment on table public.site_settings is
  'Owner settings from /admin/settings, one jsonb value per key (shop_cap: {"mode": "none" | "max2"}). service_role only.';
