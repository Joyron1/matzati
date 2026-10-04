-- Admins added in the Supabase dashboard (owner request 2026-10-04): a row here lets that address
-- into /admin, beside ADMIN_EMAILS in Vercel. The user still needs a confirmed Supabase Auth user
-- (Authentication -> Users -> Add user, "Auto Confirm User"). Read by the server with the service
-- role only (lib/admin/allowlist.ts); no grant to anon or authenticated.
create table if not exists public.admin_emails (
  email text primary key check (position('@' in email) > 1),
  note text,
  added_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;
