-- Manual stories with a link sticker (owner request 2026-10-24): Meta's API cannot add a link
-- sticker to a story or leave a draft in the app, so a "manual" story is not published by the
-- cron. At its time the owner gets it in their private Telegram chat with the bot (the file and
-- the product's /go link for the sticker), posts it from the app, and marks it posted in
-- /admin/meta. Stories only. Every column has a default, so the running code keeps working.

alter table public.meta_reels
  add column if not exists manual boolean not null default false,
  -- The link for the sticker: our /go/<id>?src=story (affiliate, counted as a click).
  add column if not exists link_url text,
  add column if not exists link_title text,
  -- When the cron handed it to the owner (Telegram, or the panel alone when Telegram failed).
  add column if not exists notified_at timestamptz,
  add column if not exists notify_error text,
  -- When the owner marked it posted.
  add column if not exists manual_done_at timestamptz;

alter table public.meta_reels drop constraint if exists meta_reels_manual_check;
alter table public.meta_reels
  add constraint meta_reels_manual_check check (
    (not manual or kind = 'story')
    and (link_url is null or (link_url like 'https://%' and char_length(link_url) <= 500))
    and (link_title is null or char_length(link_title) <= 300)
    and (notify_error is null or char_length(notify_error) <= 300)
  );
