-- The Meta area (owner request 2026-10-24): besides Reels, scheduled feed posts (1-10 images: one
-- image or a carousel/multi-photo post) and stories (one image or one video) on the Facebook Page
-- and its Instagram account. The table keeps its name (the code that reads it is deployed with this
-- migration, and the running code keeps working before it: every new column has a default).
-- A row's kind: 'reel' (video_path, as before), 'post' or 'story' (media: [{path, type}], paths
-- meta/<uuid>.jpg or meta/<uuid>.mp4 in the private bucket agent-media). Stories have no caption.

alter table public.meta_reels
  add column if not exists kind text not null default 'reel',
  add column if not exists media jsonb not null default '[]'::jsonb;

alter table public.meta_reels alter column video_path drop not null;

alter table public.meta_reels drop constraint if exists meta_reels_caption_check;
alter table public.meta_reels drop constraint if exists meta_reels_kind_check;
alter table public.meta_reels drop constraint if exists meta_reels_media_check;

alter table public.meta_reels
  add constraint meta_reels_kind_check check (kind in ('reel', 'post', 'story')),
  add constraint meta_reels_caption_check check (
    char_length(caption) <= 2200 and (kind = 'story' or char_length(caption) >= 1)
  ),
  add constraint meta_reels_media_check check (
    jsonb_typeof(media) = 'array'
    and case kind
      when 'reel' then video_path is not null
      when 'post' then jsonb_array_length(media) between 1 and 10
      else jsonb_array_length(media) = 1
    end
  );

-- Images join the videos in the bucket (Instagram takes JPEG only; the browser converts first).
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/quicktime', 'image/jpeg']
 where id = 'agent-media';
