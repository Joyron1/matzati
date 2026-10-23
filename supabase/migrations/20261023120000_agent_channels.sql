-- Facebook and Instagram for approved products (owner request 2026-10-23, manual approval): what
-- each channel answered, beside the Telegram columns of 20261019120000_agents.sql. Written by the
-- server with the service role only (lib/agents/store.ts).
alter table public.agent_candidates
  add column if not exists facebook_post_id text,
  add column if not exists facebook_posted_at timestamptz,
  add column if not exists facebook_error text
    check (facebook_error is null or char_length(facebook_error) <= 300),
  add column if not exists instagram_media_id text,
  add column if not exists instagram_posted_at timestamptz,
  add column if not exists instagram_error text
    check (instagram_error is null or char_length(instagram_error) <= 300);
