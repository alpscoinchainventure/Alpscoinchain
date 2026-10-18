-- Repair the KYC review RPC exposed through Supabase PostgREST.
-- Recreating the exact named signature also refreshes argument metadata for RPC calls.
begin;

create or replace function public.admin_review_kyc(
  p_submission_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_admin_role text;
  v_admin_status text;
  v_submission public.kyc_submissions%rowtype;
  v_reason text;
begin
  if v_admin_id is null then
    raise exception using errcode = '42501',
      message = 'Administrator authentication is required.';
  end if;

  select p.role, p.account_status
    into v_admin_role, v_admin_status
    from public.profiles as p
   where p.id = v_admin_id;

  if v_admin_role is distinct from 'admin'
     or v_admin_status is distinct from 'active' then
    raise exception using errcode = '42501',
      message = 'An active administrator account is required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023',
      message = 'Decision must be approved or rejected.';
  end if;

  v_reason := pg_catalog.nullif(pg_catalog.btrim(p_rejection_reason), '');

  if p_decision = 'rejected'
     and (v_reason is null
       or pg_catalog.char_length(v_reason) < 3
       or pg_catalog.char_length(v_reason) > 1000) then
    raise exception using errcode = '22023',
      message = 'A rejection reason between 3 and 1000 characters is required.';
  end if;

  select s.*
    into v_submission
    from public.kyc_submissions as s
   where s.id = p_submission_id
   for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'KYC submission was not found.';
  end if;

  if v_submission.status is distinct from 'pending_review' then
    raise exception using errcode = '55000',
      message = 'Only pending KYC submissions can be reviewed.';
  end if;

  update public.kyc_submissions
     set status = p_decision,
         rejection_reason = case when p_decision = 'rejected' then v_reason else null end,
         review_note = case when p_decision = 'rejected' then v_reason else null end,
         reviewed_at = pg_catalog.now(),
         reviewed_by = v_admin_id,
         updated_at = pg_catalog.now()
   where id = p_submission_id;

  update public.profiles
     set kyc_status = p_decision,
         updated_at = pg_catalog.now()
   where id = v_submission.user_id;

  insert into public.kyc_audit_log (
    submission_id,
    client_id,
    admin_id,
    action,
    reason,
    created_at
  ) values (
    p_submission_id,
    v_submission.user_id,
    v_admin_id,
    p_decision,
    case when p_decision = 'rejected' then v_reason else null end,
    pg_catalog.now()
  );
end;
$function$;

revoke all on function public.admin_review_kyc(uuid, text, text) from public;
grant execute on function public.admin_review_kyc(uuid, text, text) to authenticated, service_role;

-- Force PostgREST to refresh the RPC function signature and named arguments.
notify pgrst, 'reload schema';

commit;
