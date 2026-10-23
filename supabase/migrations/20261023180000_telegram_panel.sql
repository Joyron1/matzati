-- The Telegram panel (owner request 2026-10-23): the owner's own video per product, the scheduled
-- Telegram post, the finder run's progress, and the private bucket the videos are uploaded to.
-- Service role only, like the rest of the agents' tables (lib/agents/).

-- 1. Candidates: the uploaded video and the Telegram slot -----------------------------------------

alter table public.agent_candidates
  -- Path in the private bucket agent-media of the motion video the owner made for the product.
  add column if not exists video_path text check (video_path is null or char_length(video_path) <= 300),
  -- When the approved post goes to Telegram (the next free slot, never Friday 17:00 to Saturday
  -- 19:30 Israel time); null when not scheduled. telegram_posted_at says when it went.
  add column if not exists telegram_due_at timestamptz;

create index if not exists agent_candidates_telegram_due
  on public.agent_candidates (telegram_due_at)
  where telegram_due_at is not null and telegram_posted_at is null;

-- 2. Runs: progress for the admin's bar --------------------------------------------------------

alter table public.agent_runs
  add column if not exists progress integer not null default 0 check (progress between 0 and 100),
  add column if not exists stage text check (stage is null or char_length(stage) <= 120);

-- 3. The bucket of the owner's videos ------------------------------------------------------------

-- Private: the admin uploads through a signed upload URL the server makes, and Telegram fetches a
-- video through a signed URL an hour long. 20 MB at most (Telegram's limit for a file sent by URL).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-media', 'agent-media', false, 20971520, array['video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 4. Schedule: publish what is due every 15 minutes --------------------------------------------

select cron.unschedule('matzati-agent-publish')
where exists (select 1 from cron.job where jobname = 'matzati-agent-publish');

select cron.schedule(
  'matzati-agent-publish',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://www.matzati-il.com/api/cron/agents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'matzati_cron_secret'),
        ''
      )
    ),
    body := '{"agent":"publish"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
