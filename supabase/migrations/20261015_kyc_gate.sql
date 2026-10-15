-- AlpsCoinChain KYC gate migration
-- Run once in Supabase SQL Editor for project uevofmlzpwrdidjnwxfd.
-- This migration stores identity files in a PRIVATE bucket and blocks
-- fund_requests inserts until profiles.kyc_status = 'approved'.
begin;

alter table public.profiles
  add column if not exists kyc_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_kyc_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_kyc_status_check
      check (kyc_status in ('pending','submitted','approved','rejected'));
  end if;
end $$;

create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  legal_name text not null,
  date_of_birth date not null,
  country text not null,
  document_type text not null check (document_type in ('passport','national_id','drivers_license')),
  document_storage_path text not null,
  status text not null default 'pending' check (status in ('pending','submitted','approved','rejected')),
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kyc_legal_name_length check (char_length(trim(legal_name)) between 2 and 160),
  constraint kyc_country_length check (char_length(trim(country)) between 2 and 100),
  constraint kyc_document_path_user_scope check (document_storage_path like user_id::text || '/%')
);

alter table public.kyc_submissions enable row level security;

drop policy if exists "kyc_select_own_or_admin" on public.kyc_submissions;
create policy "kyc_select_own_or_admin"
on public.kyc_submissions for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active'
  )
);

drop policy if exists "kyc_insert_own_pending" on public.kyc_submissions;
create policy "kyc_insert_own_pending"
on public.kyc_submissions for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
);

-- Clients can edit only the identity fields, never status/reviewer fields.
revoke update on public.kyc_submissions from authenticated;
grant update (legal_name, date_of_birth, country, document_type, document_storage_path, updated_at)
on public.kyc_submissions to authenticated;

drop policy if exists "kyc_update_own_unreviewed" on public.kyc_submissions;
create policy "kyc_update_own_unreviewed"
on public.kyc_submissions for update to authenticated
using (user_id = auth.uid() and status in ('pending','rejected'))
with check (user_id = auth.uid() and status in ('pending','rejected') and reviewed_at is null and reviewed_by is null);

grant select, insert on public.kyc_submissions to authenticated;

-- Private document bucket: no public URL. Files are scoped by the first path segment (user UUID).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-private', 'kyc-private', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists "kyc_files_insert_own_folder" on storage.objects;
create policy "kyc_files_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kyc-private'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "kyc_files_read_own_or_admin" on storage.objects;
create policy "kyc_files_read_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'kyc-private'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active'
    )
  )
);

drop policy if exists "kyc_files_update_own_folder" on storage.objects;
create policy "kyc_files_update_own_folder"
on storage.objects for update to authenticated
using (bucket_id = 'kyc-private' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'kyc-private' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.sync_profile_kyc_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set kyc_status = new.status
  where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists kyc_sync_profile_status on public.kyc_submissions;
create trigger kyc_sync_profile_status
after insert or update of status on public.kyc_submissions
for each row execute function public.sync_profile_kyc_status();

create or replace function public.admin_review_kyc(
  p_user_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and account_status = 'active'
  ) then
    raise exception 'Active administrator access required';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  if p_decision = 'rejected' and nullif(trim(p_review_note), '') is null then
    raise exception 'A reason is required when rejecting KYC';
  end if;

  update public.kyc_submissions
  set status = p_decision,
      review_note = nullif(trim(p_review_note), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  where user_id = p_user_id;

  if not found then
    raise exception 'KYC submission not found';
  end if;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'status', p_decision);
end;
$$;

revoke all on function public.admin_review_kyc(uuid,text,text) from public;
grant execute on function public.admin_review_kyc(uuid,text,text) to authenticated;

-- Critical server-side gate: a client cannot create a deposit/withdrawal request
-- until their profile's KYC status is approved, even if the UI is bypassed.
create or replace function public.require_approved_kyc_for_fund_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id
      and p.kyc_status = 'approved'
      and p.account_status = 'active'
      and p.role = 'client'
  ) then
    raise exception 'KYC approval is required before submitting fund requests';
  end if;
  return new;
end;
$$;

drop trigger if exists fund_request_requires_approved_kyc on public.fund_requests;
create trigger fund_request_requires_approved_kyc
before insert on public.fund_requests
for each row execute function public.require_approved_kyc_for_fund_request();

commit;
