-- AlpsCoinChain: wallet-address configuration and KYC review schema
-- Apply this migration in the Supabase SQL Editor for project uevofmlzpwrdidjnwxfd.

create table if not exists public.deposit_wallet_addresses (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null check (asset_code ~ '^[A-Z0-9._-]{2,20}$'),
  network text not null,
  wallet_address text not null,
  instructions text not null default '',
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_wallet_addresses_asset_network_key unique (asset_code, network)
);

alter table public.deposit_wallet_addresses enable row level security;
drop policy if exists "Active clients can read active deposit wallet addresses" on public.deposit_wallet_addresses;
create policy "Active clients can read active deposit wallet addresses"
  on public.deposit_wallet_addresses for select to authenticated
  using (is_active = true);
drop policy if exists "Admins manage deposit wallet addresses" on public.deposit_wallet_addresses;
create policy "Admins manage deposit wallet addresses"
  on public.deposit_wallet_addresses for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active'));

create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('international_id','drivers_license','passport','resident_permit','other')),
  storage_path text not null,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

alter table public.kyc_submissions enable row level security;
drop policy if exists "Users can read their own KYC submission" on public.kyc_submissions;
create policy "Users can read their own KYC submission"
  on public.kyc_submissions for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can create their own KYC submission" on public.kyc_submissions;
create policy "Users can create their own KYC submission"
  on public.kyc_submissions for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending_review' and reviewed_by is null and reviewed_at is null);
drop policy if exists "Admins can read KYC submissions" on public.kyc_submissions;
create policy "Admins can read KYC submissions"
  on public.kyc_submissions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active'));
drop policy if exists "Admins can review KYC submissions" on public.kyc_submissions;
create policy "Admins can review KYC submissions"
  on public.kyc_submissions for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active'));

-- Keep identity documents private. Object paths start with the owner's auth user ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists "Users upload KYC documents to their own folder" on storage.objects;
create policy "Users upload KYC documents to their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Owners and admins can read KYC documents" on storage.objects;
create policy "Owners and admins can read KYC documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin' and lower(coalesce(p.account_status,'')) = 'active')
    )
  );

-- Ensure authenticated browser clients have table privileges; RLS still controls each row.
grant select, insert, update, delete on public.deposit_wallet_addresses to authenticated;
grant select, insert, update on public.kyc_submissions to authenticated;

notify pgrst, 'reload schema';
