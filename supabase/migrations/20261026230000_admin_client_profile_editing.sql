-- Secure administrator editing of client profile details.
-- This deliberately excludes role, KYC decisions, auth email, and financial records.

create or replace function public.admin_list_profiles_for_management()
returns table(id uuid, full_name text, role text, account_status text, email text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;

  return query
  select p.id,
    coalesce(nullif(trim(p.full_name), ''),
             nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
             nullif(trim(u.raw_user_meta_data->>'name'), ''),
             u.email, 'Name not provided')::text,
    p.role::text, p.account_status::text, u.email::text
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by lower(coalesce(nullif(trim(p.full_name), ''),
             nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
             nullif(trim(u.raw_user_meta_data->>'name'), ''),
             u.email, '')), p.id;
end;
$function$;

create or replace function public.admin_update_client_profile(
  p_client_id uuid,
  p_full_name text,
  p_account_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_old_name text;
  v_old_status text;
  v_new_name text := nullif(trim(p_full_name), '');
  v_new_status text := lower(trim(p_account_status));
begin
  if v_admin_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception 'Active administrator access required' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Client account is required';
  end if;
  if v_new_name is null or char_length(v_new_name) < 2 or char_length(v_new_name) > 100 then
    raise exception 'Name must be between 2 and 100 characters';
  end if;
  if v_new_status not in ('active', 'suspended', 'pending') then
    raise exception 'Invalid account status';
  end if;

  select p.full_name, p.account_status into v_old_name, v_old_status
  from public.profiles p
  where p.id = p_client_id and lower(coalesce(p.role, '')) = 'client'
  for update;
  if not found then
    raise exception 'Client account not found';
  end if;

  update public.profiles
  set full_name = v_new_name,
      account_status = v_new_status,
      updated_at = now()
  where id = p_client_id;

  insert into public.admin_action_audit(actor_id, action, entity_type, entity_id, old_status, new_status, reason)
  values (
    v_admin_id,
    'client_profile_updated',
    'client_profile',
    p_client_id,
    coalesce(v_old_status, '') || ' | name=' || coalesce(v_old_name, ''),
    v_new_status || ' | name=' || v_new_name,
    'Administrator updated client display name and/or account status'
  );

  return jsonb_build_object('success', true, 'client_id', p_client_id,
    'full_name', v_new_name, 'account_status', v_new_status);
end;
$function$;

revoke all on function public.admin_list_profiles_for_management() from public, anon;
revoke all on function public.admin_update_client_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_list_profiles_for_management() to authenticated;
grant execute on function public.admin_update_client_profile(uuid, text, text) to authenticated;
