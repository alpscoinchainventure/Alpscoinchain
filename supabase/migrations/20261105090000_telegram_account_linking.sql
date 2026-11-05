begin;

create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_codes_user_created_idx
  on public.telegram_link_codes(user_id, created_at desc);

create table if not exists public.telegram_account_links (
  chat_id bigint primary key,
  telegram_user_id bigint not null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;
alter table public.telegram_account_links enable row level security;
revoke all on public.telegram_link_codes, public.telegram_account_links from public, anon, authenticated;
grant all on public.telegram_link_codes, public.telegram_account_links to service_role;

commit;
