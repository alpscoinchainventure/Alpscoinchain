-- Keep a newly submitted KYC record and the profile status in sync.
-- This trigger never approves a submission; all new records remain pending_review.
create or replace function public.sync_profile_kyc_status_on_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.profiles
     set kyc_status = 'submitted'
   where id = new.user_id
     and coalesce(kyc_status, '') not in ('approved', 'rejected');

  return new;
end;
$function$;

revoke all on function public.sync_profile_kyc_status_on_submission() from public;

drop trigger if exists sync_profile_kyc_status_after_submission
  on public.kyc_submissions;

create trigger sync_profile_kyc_status_after_submission
after insert on public.kyc_submissions
for each row
execute function public.sync_profile_kyc_status_on_submission();

-- Reconcile existing pending submissions without changing their review decisions.
update public.profiles p
   set kyc_status = 'submitted'
  from public.kyc_submissions s
 where s.user_id = p.id
   and s.status = 'pending_review'
   and coalesce(p.kyc_status, '') not in ('approved', 'rejected');

notify pgrst, 'reload schema';
