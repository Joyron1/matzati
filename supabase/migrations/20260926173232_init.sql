-- Matzati data model (CLAUDE.md §8).
-- RLS is enabled on every table. The only public access is reading published deals;
-- everything else goes through server code with the service role key.

create table public.search_cache (
  query_hash text primary key,
  query text not null,
  parsed jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index search_cache_created_at_idx on public.search_cache (created_at);

-- No IPs and no user data here, by design.
create table public.search_log (
  id bigserial primary key,
  query text not null,
  parsed jsonb,
  result_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index search_log_created_at_idx on public.search_log (created_at);

create table public.products (
  product_id text primary key,
  data jsonb not null,
  title_he text,
  updated_at timestamptz not null default now()
);

create table public.price_history (
  id bigserial primary key,
  product_id text not null references public.products (product_id) on delete cascade,
  price_ils numeric(12, 2),
  price_usd numeric(12, 2),
  captured_at timestamptz not null default now()
);
create index price_history_product_idx on public.price_history (product_id, captured_at desc);

create table public.clicks (
  id bigserial primary key,
  product_id text not null,
  src text,
  created_at timestamptz not null default now()
);
create index clicks_product_idx on public.clicks (product_id, created_at desc);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('deal', 'holiday', 'dont_buy')),
  title text not null,
  body text not null default '',
  product_id text,
  coupon_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index deals_published_idx on public.deals (published, created_at desc);

create table public.category_tips (
  category_id text primary key,
  tips_he jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (ip_hash, window_start)
);

create table public.fx_rates (
  date date primary key,
  usd_ils numeric(10, 4) not null check (usd_ils > 0),
  source text not null default 'boi',
  fetched_at timestamptz not null default now()
);

alter table public.search_cache enable row level security;
alter table public.search_log enable row level security;
alter table public.products enable row level security;
alter table public.price_history enable row level security;
alter table public.clicks enable row level security;
alter table public.deals enable row level security;
alter table public.category_tips enable row level security;
alter table public.rate_limits enable row level security;
alter table public.fx_rates enable row level security;

create policy "Anyone can read published deals"
  on public.deals for select
  to anon, authenticated
  using (published = true);
