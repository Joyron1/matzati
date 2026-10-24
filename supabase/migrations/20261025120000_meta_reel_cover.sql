-- A Reel's cover image (owner request 2026-10-24): a JPEG the owner uploads with the Reel
-- (meta/<uuid>.jpg in the private bucket agent-media). Instagram takes it as cover_url on the
-- Reel's container; Facebook as the video's preferred thumbnail (/{video-id}/thumbnails). Reels
-- only. A null column, so the running code keeps working.

alter table public.meta_reels add column if not exists cover_path text;

alter table public.meta_reels drop constraint if exists meta_reels_cover_check;
alter table public.meta_reels
  add constraint meta_reels_cover_check check (
    cover_path is null
    or (kind = 'reel' and cover_path ~ '^meta/[0-9a-f-]{36}\.jpg$')
  );
