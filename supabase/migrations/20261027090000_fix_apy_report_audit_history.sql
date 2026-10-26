create or replace function public.apy_list_report_audit(p_report_id uuid)
returns table(
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
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.apy_is_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    au.id,
    au.report_id,
    au.actor_id,
    coalesce(p.full_name, 'Name not provided')::text,
    au.action::text,
    au.old_status::text,
    au.new_status::text,
    au.notes::text,
    au.created_at
  from public.apy_report_audit au
  left join public.profiles p on p.id = au.actor_id
  where au.report_id = p_report_id
  order by au.created_at desc;
end;
$function$;

revoke all on function public.apy_list_report_audit(uuid) from public, anon;
grant execute on function public.apy_list_report_audit(uuid) to authenticated;