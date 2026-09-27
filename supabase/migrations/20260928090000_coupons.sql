-- Owner coupons: codes the owner adds in /admin/coupons, shown on /coupons, on product pages and
-- on sale cards (/sales). Not AliExpress data: every coupon is shown as "לפי תנאי הקופון".
--
-- Apply this migration BEFORE deploying the code that reads it (lib/coupons/queries.ts). Until
-- the table exists, /coupons shows its error card and product pages show no coupons.
--
-- Public (anon) may read published rows only, like deals and seo_pages. Writes go through server
-- actions with the service role after requireAdmin().

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  -- What shoppers type at the AliExpress checkout. Same rule as lib/coupons/schema.ts.
  code text not null
    constraint coupons_code_format check (code ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- Hebrew heading, e.g. "₪5 הנחה בהזמנה מעל ₪40".
  title text not null
    constraint coupons_title_length check (char_length(title) between 3 and 120),
  terms text
    constraint coupons_terms_length check (terms is null or char_length(terms) <= 1000),
  min_spend_ils numeric
    constraint coupons_min_spend check (min_spend_ils is null or min_spend_ils >= 0),
  scope text not null
    constraint coupons_scope check (scope in ('sitewide', 'product')),
  -- AliExpress product id (products.product_id). No foreign key: like deals.product_id, the admin
  -- action imports the product before saving, and a coupon outlives a pruned products row.
  product_id text
    constraint coupons_product_id_format check (product_id is null or product_id ~ '^\d{1,20}$'),
  -- The big sale (a deals row of type 'holiday') this coupon belongs to, if any.
  sale_id uuid references public.deals (id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  featured boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A product coupon names its product; a sitewide coupon names none.
  constraint coupons_scope_product check ((scope = 'product') = (product_id is not null)),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

-- Public reads: published rows that have not ended (lib/coupons/db.ts).
create index coupons_published_idx on public.coupons (published, ends_at);
-- Product pages look coupons up by product.
create index coupons_product_idx on public.coupons (product_id) where product_id is not null;
-- Sale cards look coupons up by sale, and deleting a deal sets sale_id to null here.
create index coupons_sale_idx on public.coupons (sale_id) where sale_id is not null;

-- updated_at is kept by the database, not by callers (same as seo_pages).
create or replace function public.coupons_touch_updated_at()
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

create trigger coupons_touch_updated_at
  before update on public.coupons
  for each row execute function public.coupons_touch_updated_at();

alter table public.coupons enable row level security;

-- Explicit privileges instead of the project's default grants (which give anon and authenticated
-- every privilege, leaving RLS as the only guard): they may only select, and RLS then limits that
-- to published rows. Writes go through the service role.
revoke all on public.coupons from anon, authenticated;
grant select on public.coupons to anon, authenticated;
-- Supabase's default privileges already cover service_role; explicit so this never depends on them.
grant select, insert, update, delete on public.coupons to service_role;

create policy "Anyone can read published coupons"
  on public.coupons for select
  to anon, authenticated
  using (published = true);

comment on table public.coupons is
  'Owner coupons (/admin/coupons): shown on /coupons, product pages and sale cards. anon reads published rows only.';
comment on column public.coupons.code is
  'The code shoppers enter at the AliExpress checkout: letters, digits, "_" and "-", up to 40.';
comment on column public.coupons.min_spend_ils is
  'Minimum order in shekels as the coupon terms state it; null when there is none.';
comment on column public.coupons.scope is
  'sitewide = any order (shown on /coupons, and on product pages when featured); product = one product (product_id).';
comment on column public.coupons.sale_id is
  'The deals row of type holiday this coupon belongs to (shown on its /sales card); null when none.';
comment on column public.coupons.starts_at is
  'Null = valid from the moment it is published.';
comment on column public.coupons.ends_at is
  'Null = no end date; hidden from public pages once reached.';
comment on column public.coupons.featured is
  'Shown first on /coupons; a featured sitewide coupon also appears on product pages.';
