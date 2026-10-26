-- APY agent activities and report publication workflow.
-- All report access and mutations are mediated by SECURITY DEFINER RPCs.

create table if not exists public.apy_agent_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_user_id uuid not null references public.profiles(id) on delete cascade,
  beneficiary_user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apy_agent_assignments_not_self check (agent_user_id <> beneficiary_user_id),
  constraint apy_agent_assignments_pair_unique unique (agent_user_id, beneficiary_user_id)
);

create table if not exists public.apy_performance_reports (
  id uuid primary key default gen_random_uuid(),
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  agent_user_id uuid not null references public.profiles(id) on delete restrict,
  reporting_period_start date not null,
  reporting_period_end date not null,
  apy_rate numeric(12,6),
  return_amount numeric(20,8),
  asset_code text,
  summary text not null,
  status text not null default 'submitted'
    check (status in ('submitted','approved','published','changes_requested','rejected')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  constraint apy_report_period_valid check (reporting_period_end >= reporting_period_start),
  constraint apy_report_rate_nonnegative check (apy_rate is null or apy_rate >= 0),
  constraint apy_report_return_nonnegative check (return_amount is null or return_amount >= 0),
  constraint apy_report_asset_code_valid check (asset_code is null or asset_code ~ '^[A-Z0-9._-]{2,20}$'),
  constraint apy_report_summary_length check (length(trim(summary)) between 1 and 4000),
  constraint apy_report_admin_notes_length check (admin_notes is null or length(admin_notes) <= 4000)
);

create table if not exists public.apy_beneficiary_activities (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.apy_performance_reports(id) on delete set null,
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  agent_user_id uuid not null references public.profiles(id) on delete restrict,
  activity_type text not null check (activity_type in ('progress_review','progression_attempt','performance_note','follow_up')),
  outcome text not null check (outcome in ('completed','pending','unsuccessful','needs_review')),
  details text not null,
  evidence_reference text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint apy_activity_details_length check (length(trim(details)) between 1 and 3000),
  constraint apy_activity_evidence_length check (evidence_reference is null or length(evidence_reference) <= 500)
);

create table if not exists public.apy_report_audit (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.apy_performance_reports(id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  old_status text,
  new_status text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists apy_assignments_agent_active_idx on public.apy_agent_assignments(agent_user_id, active);
create index if not exists apy_assignments_beneficiary_idx on public.apy_agent_assignments(beneficiary_user_id, active);
create index if not exists apy_reports_beneficiary_status_idx on public.apy_performance_reports(beneficiary_user_id, status, created_at desc);
create index if not exists apy_reports_agent_idx on public.apy_performance_reports(agent_user_id, created_at desc);
create index if not exists apy_activities_beneficiary_idx on public.apy_beneficiary_activities(beneficiary_user_id, occurred_at desc);

alter table public.apy_agent_assignments enable row level security;
alter table public.apy_performance_reports enable row level security;
alter table public.apy_beneficiary_activities enable row level security;
alter table public.apy_report_audit enable row level security;

revoke all on public.apy_agent_assignments, public.apy_performance_reports, public.apy_beneficiary_activities, public.apy_report_audit from anon, authenticated;

create or replace function public.apy_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and lower(p.role) = 'admin' and lower(p.account_status) = 'active'
  );
$$;

create or replace function public.apy_list_agent_assignments()
returns table (
  assignment_id uuid,
  agent_user_id uuid,
  agent_name text,
  beneficiary_user_id uuid,
  beneficiary_name text,
  active boolean,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.apy_is_admin() and not exists (
    select 1 from public.apy_agent_assignments a
    where a.agent_user_id = auth.uid() and a.active
  ) then
    raise exception 'You are not authorized to view agent assignments';
  end if;
  return query
  select a.id, a.agent_user_id, coalesce(ag.full_name, 'Name not provided'),
         a.beneficiary_user_id, coalesce(bf.full_name, 'Name not provided'),
         a.active, a.created_at
  from public.apy_agent_assignments a
  join public.profiles ag on ag.id = a.agent_user_id
  join public.profiles bf on bf.id = a.beneficiary_user_id
  where public.apy_is_admin() or a.agent_user_id = auth.uid()
  order by a.created_at desc;
end;
$$;

create or replace function public.apy_admin_save_assignment(
  p_agent_user_id uuid,
  p_beneficiary_user_id uuid,
  p_active boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
  if p_agent_user_id is null or p_beneficiary_user_id is null or p_agent_user_id = p_beneficiary_user_id then
    raise exception 'Choose two different valid accounts';
  end if;
  if not exists(select 1 from public.profiles where id = p_agent_user_id and lower(account_status) = 'active') then
    raise exception 'The selected agent account is not active';
  end if;
  if not exists(select 1 from public.profiles where id = p_beneficiary_user_id and lower(account_status) = 'active') then
    raise exception 'The selected beneficiary account is not active';
  end if;
  insert into public.apy_agent_assignments(agent_user_id, beneficiary_user_id, active, assigned_by)
  values(p_agent_user_id, p_beneficiary_user_id, coalesce(p_active,true), auth.uid())
  on conflict(agent_user_id, beneficiary_user_id)
  do update set active = excluded.active, assigned_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return jsonb_build_object('success', true, 'assignment_id', v_id);
end;
$$;

create or replace function public.apy_list_dashboard_reports()
returns table (
  report_id uuid,
  beneficiary_user_id uuid,
  beneficiary_name text,
  agent_user_id uuid,
  agent_name text,
  reporting_period_start date,
  reporting_period_end date,
  apy_rate numeric,
  return_amount numeric,
  asset_code text,
  summary text,
  status text,
  admin_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz,
  reviewed_by uuid
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
  select r.id, r.beneficiary_user_id, coalesce(bf.full_name, 'Name not provided'),
         r.agent_user_id, coalesce(ag.full_name, 'Name not provided'),
         r.reporting_period_start, r.reporting_period_end, r.apy_rate,
         r.return_amount, r.asset_code, r.summary, r.status, r.admin_notes,
         r.created_at, r.updated_at, r.published_at, r.reviewed_by
  from public.apy_performance_reports r
  join public.profiles bf on bf.id = r.beneficiary_user_id
  join public.profiles ag on ag.id = r.agent_user_id
  where public.apy_is_admin()
     or (r.beneficiary_user_id = auth.uid() and r.status = 'published')
     or (r.agent_user_id = auth.uid() and exists (
       select 1 from public.apy_agent_assignments a
       where a.agent_user_id = auth.uid() and a.beneficiary_user_id = r.beneficiary_user_id and a.active
     ))
  order by coalesce(r.published_at, r.updated_at) desc;
end;
$$;

create or replace function public.apy_agent_submit_report(
  p_beneficiary_user_id uuid,
  p_reporting_period_start date,
  p_reporting_period_end date,
  p_apy_rate numeric,
  p_return_amount numeric,
  p_asset_code text,
  p_summary text,
  p_activity_type text default 'progress_review',
  p_outcome text default 'needs_review',
  p_activity_details text default null,
  p_evidence_reference text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_report_id uuid; v_asset text; v_summary text; v_details text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.apy_agent_assignments a
    where a.agent_user_id = auth.uid() and a.beneficiary_user_id = p_beneficiary_user_id and a.active
  ) then raise exception 'You are not assigned to manage this beneficiary'; end if;
  if p_reporting_period_start is null or p_reporting_period_end is null or p_reporting_period_end < p_reporting_period_start then
    raise exception 'Choose a valid reporting period';
  end if;
  if p_apy_rate is not null and (p_apy_rate < 0 or p_apy_rate > 1000000) then raise exception 'Enter a valid APY rate'; end if;
  if p_return_amount is not null and (p_return_amount < 0 or p_return_amount > 9999999999999999) then raise exception 'Enter a valid return amount'; end if;
  v_asset := nullif(upper(trim(coalesce(p_asset_code,''))), '');
  if v_asset is not null and v_asset !~ '^[A-Z0-9._-]{2,20}$' then raise exception 'Enter a valid asset code'; end if;
  v_summary := trim(coalesce(p_summary,''));
  if length(v_summary) < 1 or length(v_summary) > 4000 then raise exception 'Summary must contain 1–4000 characters'; end if;
  if p_activity_type not in ('progress_review','progression_attempt','performance_note','follow_up') then raise exception 'Invalid activity type'; end if;
  if p_outcome not in ('completed','pending','unsuccessful','needs_review') then raise exception 'Invalid activity outcome'; end if;
  v_details := trim(coalesce(p_activity_details, v_summary));
  if length(v_details) < 1 or length(v_details) > 3000 then raise exception 'Activity details must contain 1–3000 characters'; end if;

  insert into public.apy_performance_reports(
    beneficiary_user_id, agent_user_id, reporting_period_start, reporting_period_end,
    apy_rate, return_amount, asset_code, summary, status
  ) values (
    p_beneficiary_user_id, auth.uid(), p_reporting_period_start, p_reporting_period_end,
    p_apy_rate, p_return_amount, v_asset, v_summary, 'submitted'
  ) returning id into v_report_id;

  insert into public.apy_beneficiary_activities(
    report_id, beneficiary_user_id, agent_user_id, activity_type, outcome,
    details, evidence_reference
  ) values (
    v_report_id, p_beneficiary_user_id, auth.uid(), p_activity_type, p_outcome,
    v_details, nullif(trim(coalesce(p_evidence_reference,'')), '')
  );

  insert into public.apy_report_audit(report_id, actor_id, action, new_status, notes)
  values(v_report_id, auth.uid(), 'submitted', 'submitted', 'Agent submitted report');

  return jsonb_build_object('success', true, 'report_id', v_report_id, 'status', 'submitted');
end;
$$;

create or replace function public.apy_list_activities(p_report_id uuid default null)
returns table (
  activity_id uuid,
  report_id uuid,
  beneficiary_user_id uuid,
  beneficiary_name text,
  agent_user_id uuid,
  agent_name text,
  activity_type text,
  outcome text,
  details text,
  evidence_reference text,
  occurred_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
  select a.id, a.report_id, a.beneficiary_user_id, coalesce(bf.full_name, 'Name not provided'),
         a.agent_user_id, coalesce(ag.full_name, 'Name not provided'),
         a.activity_type, a.outcome, a.details, a.evidence_reference, a.occurred_at, a.created_at
  from public.apy_beneficiary_activities a
  join public.profiles bf on bf.id = a.beneficiary_user_id
  join public.profiles ag on ag.id = a.agent_user_id
  where (p_report_id is null or a.report_id = p_report_id)
    and (
      public.apy_is_admin()
      or (a.beneficiary_user_id = auth.uid() and exists (
        select 1 from public.apy_performance_reports r where r.id = a.report_id and r.status = 'published'
      ))
      or (a.agent_user_id = auth.uid() and exists (
        select 1 from public.apy_agent_assignments x
        where x.agent_user_id = auth.uid() and x.beneficiary_user_id = a.beneficiary_user_id and x.active
      ))
    )
  order by a.occurred_at desc;
end;
$$;

create or replace function public.apy_admin_review_report(
  p_report_id uuid,
  p_action text,
  p_admin_notes text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_old_status text; v_new_status text; v_notes text;
begin
  if not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
  select status into v_old_status from public.apy_performance_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  v_notes := nullif(trim(coalesce(p_admin_notes,'')), '');
  if v_notes is not null and length(v_notes) > 4000 then raise exception 'Administrator notes must be 4000 characters or fewer'; end if;
  case p_action
    when 'approve' then
      if v_old_status not in ('submitted','changes_requested') then raise exception 'Only submitted or returned reports can be approved'; end if;
      v_new_status := 'approved';
    when 'publish' then
      if v_old_status <> 'approved' then raise exception 'Approve the report before publishing it'; end if;
      v_new_status := 'published';
    when 'request_changes' then
      if v_old_status not in ('submitted','approved') then raise exception 'This report cannot be returned for changes'; end if;
      v_new_status := 'changes_requested';
    when 'reject' then
      if v_old_status not in ('submitted','changes_requested') then raise exception 'This report cannot be rejected from its current status'; end if;
      v_new_status := 'rejected';
    else raise exception 'Invalid review action';
  end case;

  update public.apy_performance_reports
  set status = v_new_status, admin_notes = v_notes, reviewed_by = auth.uid(),
      published_at = case when v_new_status = 'published' then now() else published_at end,
      updated_at = now()
  where id = p_report_id;

  insert into public.apy_report_audit(report_id, actor_id, action, old_status, new_status, notes)
  values(p_report_id, auth.uid(), p_action, v_old_status, v_new_status, v_notes);

  return jsonb_build_object('success', true, 'report_id', p_report_id, 'old_status', v_old_status, 'status', v_new_status);
end;
$$;

create or replace function public.apy_list_report_audit(p_report_id uuid)
returns table (
  audit_id uuid,
  report_id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  old_status text,
  new_status text,
  notes text,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
  return query
  select au.id, au.report_id, au.actor_id, coalesce(p.full_name, 'Name not provided'),
         au.action, au.old_status, au.new_status, au.notes, au.created_at
  from public.apy_report_audit au
  where au.report_id = p_report_id
  order by au.created_at desc;
end;
$$;

revoke all on function public.apy_is_admin() from public, anon;
revoke all on function public.apy_list_agent_assignments() from public, anon;
revoke all on function public.apy_admin_save_assignment(uuid,uuid,boolean) from public, anon;
revoke all on function public.apy_list_dashboard_reports() from public, anon;
revoke all on function public.apy_agent_submit_report(uuid,date,date,numeric,numeric,text,text,text,text,text,text) from public, anon;
revoke all on function public.apy_list_activities(uuid) from public, anon;
revoke all on function public.apy_admin_review_report(uuid,text,text) from public, anon;
revoke all on function public.apy_list_report_audit(uuid) from public, anon;

grant execute on function public.apy_list_agent_assignments() to authenticated;
grant execute on function public.apy_admin_save_assignment(uuid,uuid,boolean) to authenticated;
grant execute on function public.apy_list_dashboard_reports() to authenticated;
grant execute on function public.apy_agent_submit_report(uuid,date,date,numeric,numeric,text,text,text,text,text,text) to authenticated;
grant execute on function public.apy_list_activities(uuid) to authenticated;
grant execute on function public.apy_admin_review_report(uuid,text,text) to authenticated;
grant execute on function public.apy_list_report_audit(uuid) to authenticated;
