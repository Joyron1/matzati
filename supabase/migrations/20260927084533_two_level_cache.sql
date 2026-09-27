-- Two-level search cache, entries valid for 48 hours (owner decision 2026-09-27).
-- parse_cache: normalized query text → parsed filters (skips the parse LLM call).
-- search_cache: canonical filters → ranked results + explanations (skips AliExpress + explain).

create table public.parse_cache (
  query_key text primary key,
  query_norm text not null,
  parsed jsonb not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);
create index parse_cache_created_at_idx on public.parse_cache (created_at);
alter table public.parse_cache enable row level security;

alter table public.search_cache rename column query_hash to filters_key;
alter table public.search_cache add column hits integer not null default 0;

comment on table public.parse_cache is 'Normalized query → parsed filters. Fresh for 48h.';
comment on table public.search_cache is
  'Canonical filters (incl. ranking version) → results and explanations. Fresh for 48h. query is the first request that produced the entry.';
