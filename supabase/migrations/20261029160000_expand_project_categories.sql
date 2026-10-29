-- Expand project categories for verified forex, cryptocurrency, payments, and blockchain industry listings.
alter table public.investment_projects drop constraint if exists investment_projects_project_type_check;
alter table public.investment_projects add constraint investment_projects_project_type_check
  check (project_type in ('investment','company','forex','cryptocurrency','payments','blockchain','industry'));

create or replace function public.admin_save_investment_project(
  p_id uuid, p_title text, p_project_type text, p_description text, p_status text, p_risk_disclosure text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_action text;
begin
  if v_user is null or not public.apy_is_admin() then
    raise exception 'Administrator access required';
  end if;
  if length(trim(coalesce(p_title,''))) not between 3 and 140
     or length(trim(coalesce(p_description,''))) not between 10 and 4000 then
    raise exception 'Enter a title and description within permitted lengths';
  end if;
  if p_project_type not in ('investment','company','forex','cryptocurrency','payments','blockchain','industry')
     or p_status not in ('draft','published','inactive') then
    raise exception 'Invalid project type or status';
  end if;
  if p_id is null then
    insert into public.investment_projects(title,project_type,description,status,risk_disclosure,created_by,updated_by)
    values(trim(p_title),p_project_type,trim(p_description),p_status,left(trim(coalesce(p_risk_disclosure,'')),2000),v_user,v_user)
    returning id into v_id;
    v_action := 'created';
  else
    update public.investment_projects
      set title=trim(p_title), project_type=p_project_type, description=trim(p_description),
          status=p_status, risk_disclosure=left(trim(coalesce(p_risk_disclosure,'')),2000),
          updated_by=v_user, updated_at=now()
      where id=p_id returning id into v_id;
    if v_id is null then raise exception 'Project not found'; end if;
    v_action := 'updated';
  end if;
  insert into public.investment_catalog_audit(actor_id,item_type,item_id,action,details)
  values(v_user,'project',v_id,v_action,jsonb_build_object('title',trim(p_title),'status',p_status,'project_type',p_project_type));
  return jsonb_build_object('success',true,'id',v_id);
end $$;

revoke all on function public.admin_save_investment_project(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.admin_save_investment_project(uuid,text,text,text,text,text) to authenticated;
