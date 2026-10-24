-- Scheduled Reels for the Facebook Page and its Instagram account (owner request 2026-10-24).
-- The owner uploads a video to the private bucket agent-media (reels/<uuid>.mp4), writes the caption
-- and picks the time in /admin/reels; the agents' cron (every 15 minutes, {"agent":"publish"})
-- prepares each Reel up to an hour before its time (Instagram container, Facebook upload) and
-- publishes it at its time (lib/meta/reels-run.ts). Service role only, like agent_candidates.

create table if not exists public.meta_reels (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  video_path text not null check (video_path like 'reels/%' and video_path not like '%..%'),
  caption text not null check (char_length(caption) between 1 and 2200),
  scheduled_at timestamptz not null,
  facebook boolean not null default true,
  instagram boolean not null default true,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'done', 'partial', 'failed')),
  prepared_at timestamptz,
  fb_video_id text,
  fb_posted_at timestamptz,
  fb_error text,
  ig_container_id text,
  ig_media_id text,
  ig_posted_at timestamptz,
  ig_error text,
  check (facebook or instagram)
);

create index if not exists meta_reels_due on public.meta_reels (status, scheduled_at);

alter table public.meta_reels enable row level security;
revoke all on public.meta_reels from anon, authenticated;

-- Reels are bigger than the Telegram videos: the bucket takes up to 50 MB a file (the most the
-- Supabase free plan allows for one file).
update storage.buckets set file_size_limit = 52428800 where id = 'agent-media';
