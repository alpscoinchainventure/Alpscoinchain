-- Allow administrators to record a client APY report and its activity entry.
-- New records remain in the review queue until an administrator approves and publishes them.

create or replace function public.apy_admin_record_client_activity(
  p_beneficiary_user_id uuid,
  p_reporting_period_start date,
  p_reporting_period_end date,
  p_apy_rate numeric,
  p_return_amount numeric,
  p_asset_code text,
  p_summary text,
  p_activity_type text,
  p_outcome text,
  p_activity_details text,
  p_evidence_reference text default null,
  p_activity_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_asset text;
  v_summary text;
  v_details text;
  v_evidence text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
  if p_beneficiary_user_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_beneficiary_user_id and lower(p.role) = 'client'
  ) then raise exception 'Choose a valid client account'; end if;
  if p_reporting_period_start is null or p_reporting_period_end is null or p_reporting_period_end < p_reporting_period_start then
    raise exception 'Choose a valid reporting period';
  end if;
  if p_apy_rate is not null and (p_apy_rate < 0 or p_apy_rate > 1000000) then
    raise exception 'Enter a valid non-negative APY rate';
  end if;
  if p_return_amount is not null and (p_return_amount < 0 or p_return_amount > 9999999999999999) then
    raise exception 'Enter a valid non-negative return amount';
  end if;
  v_asset := nullif(upper(trim(coalesce(p_asset_code, ''))), '');
  if v_asset is not null and v_asset !~ '^[A-Z0-9._-]{2,20}$' then
    raise exception 'Enter a valid asset code';
  end if;
  v_summary := trim(coalesce(p_summary, ''));
  if length(v_summary) < 1 or length(v_summary) > 4000 then
    raise exception 'Report summary must contain 1–4000 characters';
  end if;
  if p_activity_type not in ('progress_review','progression_attempt','performance_note','follow_up') then
    raise exception 'Invalid activity type';
  end if;
  if p_outcome not in ('completed','pending','unsuccessful','needs_review') then
    raise exception 'Invalid activity outcome';
  end if;
  v_details := trim(coalesce(p_activity_details, ''));
  if length(v_details) < 1 or length(v_details) > 3000 then
    raise exception 'Activity details must contain 1–3000 characters';
  end if;
  v_evidence := nullif(trim(coalesce(p_evidence_reference, '')), '');
  if v_evidence is not null and length(v_evidence) > 500 then
    raise exception 'Evidence reference must be 500 characters or fewer';
  end if;

  insert into public.apy_performance_reports (
    beneficiary_user_id, agent_user_id, reporting_period_start, reporting_period_end,
    apy_rate, return_amount, asset_code, summary, status
  ) values (
    p_beneficiary_user_id, auth.uid(), p_reporting_period_start, p_reporting_period_end,
    p_apy_rate, p_return_amount, v_asset, v_summary, 'submitted'
  ) returning id into v_report_id;

  insert into public.apy_beneficiary_activities (
    report_id, beneficiary_user_id, agent_user_id, activity_type, outcome,
    details, evidence_reference, occurred_at
  ) values (
    v_report_id, p_beneficiary_user_id, auth.uid(), p_activity_type, p_outcome,
    v_details, v_evidence, coalesce(p_activity_occurred_at, now())
  );

  insert into public.apy_report_audit(report_id, actor_id, action, new_status, notes)
  values (
    v_report_id, auth.uid(), 'admin_recorded', 'submitted',
    'APY activity recorded by administrator; awaiting review and publication.'
  );

  return jsonb_build_object('success', true, 'report_id', v_report_id, 'status', 'submitted');
end;
$$;

revoke all on function public.apy_admin_record_client_activity(uuid,date,date,numeric,numeric,text,text,text,text,text,text,timestamptz) from public, anon;
grant execute on function public.apy_admin_record_client_activity(uuid,date,date,numeric,numeric,text,text,text,text,text,text,timestamptz) to authenticated;
