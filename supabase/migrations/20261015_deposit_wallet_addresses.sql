-- AlpsCoinChain deposit wallet configuration
-- Apply in the Supabase SQL Editor before using the wallet-address UI.
create table if not exists public.deposit_wallet_addresses (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null check (asset_code ~ '^[A-Z0-9._-]{2,20}$'),
  network text not null check (length(trim(network)) between 2 and 60),
  wallet_address text not null check (length(trim(wallet_address)) between 8 and 300),
  instructions text not null default '' check (length(instructions) <= 1000),
  is_active boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (asset_code, network)
);
alter table public.deposit_wallet_addresses enable row level security;
drop policy if exists "Clients can read active deposit wallet addresses" on public.deposit_wallet_addresses;
create policy "Clients can read active deposit wallet addresses"
  on public.deposit_wallet_addresses for select to authenticated
  using (is_active = true or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active'
  ));
drop policy if exists "Active admins manage deposit wallet addresses" on public.deposit_wallet_addresses;
create policy "Active admins manage deposit wallet addresses"
  on public.deposit_wallet_addresses for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active'
  ));
grant select, insert, update, delete on public.deposit_wallet_addresses to authenticated;
alter table public.fund_requests add column if not exists network text;
create index if not exists deposit_wallet_addresses_active_lookup
  on public.deposit_wallet_addresses (asset_code, network) where is_active = true;
