-- Reversible account activation/deactivation and client self-deactivation permission.
-- Apply this migration before deploying the dashboard changes.
begin;

alter table public.profiles
  add column if not exists can_self_deactivate boolean not null default true;

drop function if exists public.admin_list_profiles_for_management();
create function public.admin_list_profiles_for_management()
returns table(id uuid, full_name text, role text, account_status text, email text, can_self_deactivate boolean)
language plpgsql security definer set search_path = ''
as $function$
declare v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p where p.id=v_admin_id
      and lower(coalesce(p.role,''))='admin' and lower(coalesce(p.account_status,''))='active'
  ) then raise exception 'Active administrator access required' using errcode='42501'; end if;
  return query
  select p.id,p.full_name::text,p.role::text,p.account_status::text,u.email::text,p.can_self_deactivate
  from public.profiles p left join auth.users u on u.id=p.id
  order by lower(coalesce(nullif(trim(p.full_name),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(trim(u.raw_user_meta_data->>'name'),''),u.email,'')),p.id;
end;
$function$;
revoke all on function public.admin_list_profiles_for_management() from public,anon;
grant execute on function public.admin_list_profiles_for_management() to authenticated;

create or replace function public.admin_set_client_account_status(p_client_id uuid,p_account_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_admin_id uuid:=auth.uid();
  v_old_status text;
  v_new_status text:=lower(trim(coalesce(p_account_status,'')));
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  if v_admin_id is null or not exists(select 1 from public.profiles p where p.id=v_admin_id and lower(coalesce(p.role,''))='admin' and lower(coalesce(p.account_status,''))='active') then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if p_client_id is null then raise exception 'Client account is required'; end if;
  if v_new_status not in ('active','suspended','pending') then raise exception 'Invalid account status'; end if;
  if v_reason is null or char_length(v_reason)<3 or char_length(v_reason)>1000 then raise exception 'A reason between 3 and 1000 characters is required'; end if;
  select p.account_status into v_old_status from public.profiles p where p.id=p_client_id and lower(coalesce(p.role,''))='client' for update;
  if not found then raise exception 'Client account not found'; end if;
  update public.profiles set account_status=v_new_status,updated_at=now() where id=p_client_id;
  insert into public.admin_action_audit(actor_id,action,entity_type,entity_id,old_status,new_status,reason)
  values(v_admin_id,'client_account_status_changed','client_profile',p_client_id,v_old_status,v_new_status,v_reason);
  return jsonb_build_object('success',true,'client_id',p_client_id,'account_status',v_new_status);
end;
$function$;

create or replace function public.admin_set_client_self_deactivation(p_client_id uuid,p_allowed boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_admin_id uuid:=auth.uid();
  v_old_allowed boolean;
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  if v_admin_id is null or not exists(select 1 from public.profiles p where p.id=v_admin_id and lower(coalesce(p.role,''))='admin' and lower(coalesce(p.account_status,''))='active') then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if p_client_id is null then raise exception 'Client account is required'; end if;
  if p_allowed is null then raise exception 'A permission value is required'; end if;
  if v_reason is null or char_length(v_reason)<3 or char_length(v_reason)>1000 then raise exception 'A reason between 3 and 1000 characters is required'; end if;
  select p.can_self_deactivate into v_old_allowed from public.profiles p where p.id=p_client_id and lower(coalesce(p.role,''))='client' for update;
  if not found then raise exception 'Client account not found'; end if;
  update public.profiles set can_self_deactivate=p_allowed,updated_at=now() where id=p_client_id;
  insert into public.admin_action_audit(actor_id,action,entity_type,entity_id,old_status,new_status,reason)
  values(v_admin_id,'client_self_deactivation_permission_changed','client_profile',p_client_id,v_old_allowed::text,p_allowed::text,v_reason);
  return jsonb_build_object('success',true,'client_id',p_client_id,'can_self_deactivate',p_allowed);
end;
$function$;

create or replace function public.client_deactivate_own_account()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_old_status text;
  v_allowed boolean;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.role,p.account_status,p.can_self_deactivate into v_role,v_old_status,v_allowed
  from public.profiles p where p.id=v_user_id for update;
  if not found or lower(coalesce(v_role,''))<>'client' then raise exception 'Client account not found or not eligible'; end if;
  if lower(coalesce(v_old_status,''))<>'active' then raise exception 'Only an active client can deactivate their account'; end if;
  if not coalesce(v_allowed,false) then raise exception 'Self-deactivation is disabled by an administrator'; end if;
  update public.profiles set account_status='suspended',updated_at=now() where id=v_user_id;
  insert into public.admin_action_audit(actor_id,action,entity_type,entity_id,old_status,new_status,reason)
  values(v_user_id,'client_self_deactivated','client_profile',v_user_id,v_old_status,'suspended','Client requested reversible account deactivation');
  return jsonb_build_object('success',true,'account_status','suspended');
end;
$function$;

revoke all on function public.admin_set_client_account_status(uuid,text,text) from public,anon;
revoke all on function public.admin_set_client_self_deactivation(uuid,boolean,text) from public,anon;
revoke all on function public.client_deactivate_own_account() from public,anon;
grant execute on function public.admin_set_client_account_status(uuid,text,text) to authenticated;
grant execute on function public.admin_set_client_self_deactivation(uuid,boolean,text) to authenticated;
grant execute on function public.client_deactivate_own_account() to authenticated;

create or replace function public.require_active_client_for_beneficiary_changes()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if exists(select 1 from public.profiles p where p.id=v_user_id and lower(coalesce(p.role,''))='admin' and lower(coalesce(p.account_status,''))='active') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if not exists(select 1 from public.profiles p where p.id=v_user_id and lower(coalesce(p.role,''))='client' and lower(coalesce(p.account_status,''))='active') then
    raise exception 'Active client account required for beneficiary changes' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
drop trigger if exists beneficiaries_require_active_client on public.beneficiaries;
create trigger beneficiaries_require_active_client before insert or update or delete on public.beneficiaries
for each row execute function public.require_active_client_for_beneficiary_changes();

drop policy if exists "Clients upload own avatar photos" on storage.objects;
create policy "Clients upload own avatar photos" on storage.objects for insert to authenticated
with check (
  bucket_id='client-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='client' and p.account_status='active')
);
drop policy if exists "Clients update own avatar photos" on storage.objects;
create policy "Clients update own avatar photos" on storage.objects for update to authenticated
using (
  bucket_id='client-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='client' and p.account_status='active')
)
with check (
  bucket_id='client-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='client' and p.account_status='active')
);

commit;
