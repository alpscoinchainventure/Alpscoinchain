-- Repair KYC review so an administrator's decision updates both the submission
-- and the profile flag used by fund-request authorization. Does not change deposits.
-- DROP is required because the existing function has a different return type.
drop function if exists public.admin_review_kyc(uuid, text, text);

create function public.admin_review_kyc(
  p_submission_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_submission public.kyc_submissions%rowtype;
  v_reason text;
begin
  if v_admin_id is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception 'Active administrator access is required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  v_reason := pg_catalog.btrim(coalesce(p_rejection_reason, ''));
  if p_decision = 'rejected' and pg_catalog.length(v_reason) < 3 then
    raise exception 'A rejection reason of at least 3 characters is required';
  end if;
  if p_decision = 'approved' then
    v_reason := null;
  end if;

  select *
    into v_submission
    from public.kyc_submissions
   where id = p_submission_id
   for update;

  if not found then
    raise exception 'KYC submission was not found';
  end if;

  if v_submission.status <> 'pending_review' then
    raise exception 'Only pending KYC submissions can be reviewed';
  end if;

  update public.kyc_submissions
     set status = p_decision,
         rejection_reason = v_reason,
         reviewed_by = v_admin_id,
         reviewed_at = pg_catalog.now()
   where id = p_submission_id;

  -- The fund-request guard checks profiles.kyc_status, so keep it synchronized.
  update public.profiles
     set kyc_status = case when p_decision = 'approved' then 'approved' else 'rejected' end
   where id = v_submission.user_id;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'submission_id', p_submission_id,
    'user_id', v_submission.user_id,
    'status', p_decision
  );
end;
$function$;

revoke all on function public.admin_review_kyc(uuid, text, text) from public;
grant execute on function public.admin_review_kyc(uuid, text, text) to authenticated;

-- Repair any already-reviewed submissions whose profile flag did not get updated
-- by the earlier browser-side review flow.
update public.profiles p
   set kyc_status = case
     when s.status = 'approved' then 'approved'
     when s.status = 'rejected' then 'rejected'
     else 'submitted'
   end
  from public.kyc_submissions s
 where s.user_id = p.id
   and (
     (s.status = 'approved' and coalesce(p.kyc_status, '') <> 'approved')
     or (s.status = 'rejected' and coalesce(p.kyc_status, '') <> 'rejected')
     or (s.status = 'pending_review' and coalesce(p.kyc_status, '') in ('', 'pending'))
   );

notify pgrst, 'reload schema';
