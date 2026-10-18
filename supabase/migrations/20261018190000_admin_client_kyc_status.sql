-- Allow active administrators to update a client's profile KYC status,
-- with an auditable reason and an explicit attestation for manual approvals.
begin;

create table if not exists public.admin_kyc_status_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  submission_id uuid null references public.kyc_submissions(id) on delete set null,
  previous_status text,
  new_status text not null check (new_status in ('pending', 'approved', 'rejected')),
  reason text not null check (char_length(reason) between 3 and 1000),
  documents_verified_externally boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.admin_kyc_status_audit enable row level security;

drop policy if exists "Active admins read manual KYC status audit"
  on public.admin_kyc_status_audit;
create policy "Active admins read manual KYC status audit"
  on public.admin_kyc_status_audit
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
        and lower(coalesce(p.account_status, '')) = 'active'
    )
  );

create or replace function public.admin_list_client_kyc_status()
returns table (
  id uuid,
  full_name text,
  role text,
  account_status text,
  kyc_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501',
      message = 'An active administrator account is required.';
  end if;

  return query
  select p.id, p.full_name, p.role, p.account_status, p.kyc_status
  from public.profiles p
  where lower(coalesce(p.role, '')) = 'client'
  order by p.full_name nulls last, p.id;
end;
$function$;

create or replace function public.admin_update_client_kyc_status(
  p_client_id uuid,
  p_status text,
  p_reason text,
  p_documents_verified_externally boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_previous_status text;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_submission public.kyc_submissions%rowtype;
  v_has_pending_submission boolean := false;
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501',
      message = 'An active administrator account is required.';
  end if;

  if p_status is null or p_status not in ('pending', 'approved', 'rejected') then
    raise exception using errcode = '22023',
      message = 'KYC status must be pending, approved, or rejected.';
  end if;

  if v_reason is null or pg_catalog.char_length(v_reason) < 3
     or pg_catalog.char_length(v_reason) > 1000 then
    raise exception using errcode = '22023',
      message = 'A reason between 3 and 1000 characters is required for the audit trail.';
  end if;

  if p_status = 'approved' and coalesce(p_documents_verified_externally, false) is not true then
    raise exception using errcode = '22023',
      message = 'Approval requires explicit confirmation that the identity documents were verified.';
  end if;

  select p.kyc_status
    into v_previous_status
    from public.profiles p
   where p.id = p_client_id
     and lower(coalesce(p.role, '')) = 'client'
   for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Client profile was not found.';
  end if;

  -- If the client has an application waiting for review, keep its decision and
  -- the profile's status synchronized. Existing final decisions remain history.
  if p_status in ('approved', 'rejected') then
    select s.*
      into v_submission
      from public.kyc_submissions s
     where s.user_id = p_client_id
       and s.status = 'pending_review'
     order by s.submitted_at desc
     limit 1
     for update;

    v_has_pending_submission := found;

    if v_has_pending_submission then
      update public.kyc_submissions
         set status = p_status,
             rejection_reason = case when p_status = 'rejected' then v_reason else null end,
             review_note = case when p_status = 'rejected' then v_reason else null end,
             reviewed_by = v_admin_id,
             reviewed_at = pg_catalog.now(),
             updated_at = pg_catalog.now()
       where id = v_submission.id;

      insert into public.kyc_audit_log (
        submission_id, client_id, admin_id, action, reason, created_at
      ) values (
        v_submission.id, p_client_id, v_admin_id, p_status,
        case when p_status = 'rejected' then v_reason else v_reason end,
        pg_catalog.now()
      );
    end if;
  end if;

  update public.profiles
     set kyc_status = p_status,
         updated_at = pg_catalog.now()
   where id = p_client_id;

  insert into public.admin_kyc_status_audit (
    client_id, admin_id, submission_id, previous_status, new_status,
    reason, documents_verified_externally, created_at
  ) values (
    p_client_id, v_admin_id,
    case when v_has_pending_submission then v_submission.id else null end,
    v_previous_status, p_status, v_reason,
    coalesce(p_documents_verified_externally, false), pg_catalog.now()
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'client_id', p_client_id,
    'previous_status', v_previous_status,
    'status', p_status,
    'submission_updated', v_has_pending_submission
  );
end;
$function$;

revoke all on function public.admin_list_client_kyc_status() from public;
revoke all on function public.admin_update_client_kyc_status(uuid, text, text, boolean) from public;
grant execute on function public.admin_list_client_kyc_status() to authenticated;
grant execute on function public.admin_update_client_kyc_status(uuid, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
