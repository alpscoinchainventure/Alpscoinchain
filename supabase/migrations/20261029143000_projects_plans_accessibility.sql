-- Projects and investment plans for AlpsCoinChain Investment Ventures.
create table if not exists public.investment_projects (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(trim(title)) between 3 and 140),
 project_type text not null default 'investment' check (project_type in ('investment','company')),
 description text not null check (char_length(trim(description)) between 10 and 4000),
 status text not null default 'draft' check (status in ('draft','published','inactive')),
 risk_disclosure text not null default 'Review all risks and terms before making an investment decision.',
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.investment_plans (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 3 and 120),
 description text not null check (char_length(trim(description)) between 10 and 3000),
 asset_code text not null check (asset_code ~ '^[A-Z0-9]{2,12}$'),
 minimum_amount numeric(30,10) not null check (minimum_amount >= 0),
 maximum_amount numeric(30,10) check (maximum_amount is null or maximum_amount >= minimum_amount),
 duration_days integer not null check (duration_days between 1 and 3650),
 return_terms text not null default 'Returns are variable and not guaranteed.',
 apy_rate numeric(9,4) check (apy_rate is null or apy_rate between 0 and 1000),
 status text not null default 'draft' check (status in ('draft','published','inactive')),
 risk_disclosure text not null default 'Digital asset investments involve risk, including loss of capital. Returns are not guaranteed.',
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.investment_catalog_audit (
 id bigint generated always as identity primary key, actor_id uuid not null references auth.users(id),
 item_type text not null check (item_type in ('project','plan')), item_id uuid not null,
 action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.investment_projects enable row level security;
alter table public.investment_plans enable row level security;
alter table public.investment_catalog_audit enable row level security;
revoke all on public.investment_projects, public.investment_plans, public.investment_catalog_audit from anon, authenticated;
grant select on public.investment_projects, public.investment_plans to authenticated;
drop policy if exists "published projects readable" on public.investment_projects;
create policy "published projects readable" on public.investment_projects for select to authenticated using (status='published' or public.apy_is_admin());
drop policy if exists "published plans readable" on public.investment_plans;
create policy "published plans readable" on public.investment_plans for select to authenticated using (status='published' or public.apy_is_admin());
create or replace function public.list_published_investment_catalog()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 return jsonb_build_object(
  'projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.investment_projects p where p.status='published' or public.apy_is_admin()),'[]'::jsonb),
  'plans',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.investment_plans i where i.status='published' or public.apy_is_admin()),'[]'::jsonb)
 );
end $$;
create or replace function public.admin_save_investment_project(p_id uuid,p_title text,p_project_type text,p_description text,p_status text,p_risk_disclosure text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_action text;
begin
 if v_user is null or not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_title,''))) not between 3 and 140 or length(trim(coalesce(p_description,''))) not between 10 and 4000 then raise exception 'Enter a title and description within permitted lengths'; end if;
 if p_project_type not in ('investment','company') or p_status not in ('draft','published','inactive') then raise exception 'Invalid project type or status'; end if;
 if p_id is null then
  insert into public.investment_projects(title,project_type,description,status,risk_disclosure,created_by,updated_by) values(trim(p_title),p_project_type,trim(p_description),p_status,left(trim(coalesce(p_risk_disclosure,'')),2000),v_user,v_user) returning id into v_id; v_action:='created';
 else
  update public.investment_projects set title=trim(p_title),project_type=p_project_type,description=trim(p_description),status=p_status,risk_disclosure=left(trim(coalesce(p_risk_disclosure,'')),2000),updated_by=v_user,updated_at=now() where id=p_id returning id into v_id;
  if v_id is null then raise exception 'Project not found'; end if; v_action:='updated';
 end if;
 insert into public.investment_catalog_audit(actor_id,item_type,item_id,action,details) values(v_user,'project',v_id,v_action,jsonb_build_object('title',trim(p_title),'status',p_status));
 return jsonb_build_object('success',true,'id',v_id);
end $$;
create or replace function public.admin_save_investment_plan(p_id uuid,p_name text,p_description text,p_asset_code text,p_minimum numeric,p_maximum numeric,p_duration_days integer,p_return_terms text,p_apy_rate numeric,p_status text,p_risk_disclosure text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_action text;
begin
 if v_user is null or not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
 if length(trim(coalesce(p_name,''))) not between 3 and 120 or length(trim(coalesce(p_description,''))) not between 10 and 3000 then raise exception 'Enter a plan name and description within permitted lengths'; end if;
 if coalesce(p_asset_code,'') !~ '^[A-Z0-9]{2,12}$' or p_minimum<0 or (p_maximum is not null and p_maximum<p_minimum) or p_duration_days not between 1 and 3650 or (p_apy_rate is not null and p_apy_rate not between 0 and 1000) or p_status not in ('draft','published','inactive') then raise exception 'Invalid plan terms'; end if;
 if p_id is null then
  insert into public.investment_plans(name,description,asset_code,minimum_amount,maximum_amount,duration_days,return_terms,apy_rate,status,risk_disclosure,created_by,updated_by) values(trim(p_name),trim(p_description),p_asset_code,p_minimum,p_maximum,p_duration_days,left(trim(coalesce(p_return_terms,'')),2000),p_apy_rate,p_status,left(trim(coalesce(p_risk_disclosure,'')),2000),v_user,v_user) returning id into v_id; v_action:='created';
 else
  update public.investment_plans set name=trim(p_name),description=trim(p_description),asset_code=p_asset_code,minimum_amount=p_minimum,maximum_amount=p_maximum,duration_days=p_duration_days,return_terms=left(trim(coalesce(p_return_terms,'')),2000),apy_rate=p_apy_rate,status=p_status,risk_disclosure=left(trim(coalesce(p_risk_disclosure,'')),2000),updated_by=v_user,updated_at=now() where id=p_id returning id into v_id;
  if v_id is null then raise exception 'Investment plan not found'; end if; v_action:='updated';
 end if;
 insert into public.investment_catalog_audit(actor_id,item_type,item_id,action,details) values(v_user,'plan',v_id,v_action,jsonb_build_object('name',trim(p_name),'status',p_status));
 return jsonb_build_object('success',true,'id',v_id);
end $$;
revoke all on function public.list_published_investment_catalog() from public,anon;
revoke all on function public.admin_save_investment_project(uuid,text,text,text,text,text) from public,anon;
revoke all on function public.admin_save_investment_plan(uuid,text,text,text,numeric,numeric,integer,text,numeric,text,text) from public,anon;
grant execute on function public.list_published_investment_catalog() to authenticated;
grant execute on function public.admin_save_investment_project(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.admin_save_investment_plan(uuid,text,text,text,numeric,numeric,integer,text,numeric,text,text) to authenticated;
