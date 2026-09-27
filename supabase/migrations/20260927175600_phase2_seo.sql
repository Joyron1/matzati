-- Phase 2: SEO landing pages for popular searches (/s/[slug], CLAUDE.md §11).
-- Each row is one query the admin chose. The page runs that query through the real pipeline
-- (served from the 48h search cache) and is regenerated in the background (ISR).
-- Public (anon) may read published rows only, like deals. Writes go through server actions with
-- the service role after requireAdmin().

create table public.seo_pages (
  -- Hebrew-friendly and readable in the URL: "אוזניות-לריצה-עמידות-למים".
  -- Same rule as lib/seo/slug.ts (isValidSlug): Hebrew letters, a-z, 0-9, single inner dashes.
  slug text primary key
    constraint seo_pages_slug_format
      check (char_length(slug) between 1 and 60 and slug ~ '^[א-תa-z0-9]+(-[א-תa-z0-9]+)*$'),
  -- The search that fills the page, exactly as a visitor would type it.
  query text not null
    constraint seo_pages_query_length check (char_length(query) between 1 and 200),
  title_he text not null
    constraint seo_pages_title_length check (char_length(title_he) between 1 and 200),
  intro_he text
    constraint seo_pages_intro_length check (intro_he is null or char_length(intro_he) <= 2000),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Home "חיפושים פופולריים" and the sitemap read published rows.
create index seo_pages_published_idx on public.seo_pages (published, created_at desc);

-- updated_at feeds the sitemap's lastmod, so it is kept by the database, not by callers.
create or replace function public.seo_pages_touch_updated_at()
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

create trigger seo_pages_touch_updated_at
  before update on public.seo_pages
  for each row execute function public.seo_pages_touch_updated_at();

alter table public.seo_pages enable row level security;

-- Explicit privileges instead of the project's default grants (which give anon and authenticated
-- every privilege, leaving RLS as the only guard): they may only select, and RLS then limits that
-- to published rows. Writes go through the service role.
revoke all on public.seo_pages from anon, authenticated;
grant select on public.seo_pages to anon, authenticated;

create policy "Anyone can read published seo pages"
  on public.seo_pages for select
  to anon, authenticated
  using (published = true);

comment on table public.seo_pages is
  'Indexable landing pages for popular searches (/s/<slug>). anon reads published rows only.';
