-- The weekly category poll in the Telegram channel (owner request 2026-10-25: "which category do
-- you want to see products from", so the owner knows what to post). The bot sends an anonymous
-- poll; Telegram then sends the bot every change of its counts (the webhook's "poll" updates),
-- stored here. Service role only. Holds no personal data: anonymous polls carry counts only.

create table if not exists public.telegram_polls (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null unique,
  chat_id text not null,
  message_id bigint,
  question text not null,
  -- [{text, voters}] in the poll's order.
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  total_voters integer not null default 0,
  is_closed boolean not null default false,
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_polls_sent on public.telegram_polls (sent_at desc);

alter table public.telegram_polls enable row level security;
revoke all on public.telegram_polls from anon, authenticated;
