-- Read-only administrator overview for client beneficiaries.
-- This RPC never inserts, updates, or deletes beneficiary, request, or ledger rows.
begin;

create or replace function public.admin_list_beneficiaries()
returns table (
  id uuid,
  user_id uuid,
  client_name text,
  account_status text,
  beneficiary_name text,
  asset text,
  destination text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501',
      message = 'An active administrator account is required.';
  end if;

  return query
  select
    b.id,
    b.user_id,
    coalesce(p.full_name, '—')::text,
    coalesce(p.account_status, 'unknown')::text,
    b.beneficiary_name::text,
    b.asset::text,
    b.destination::text,
    b.created_at,
    b.updated_at
  from public.beneficiaries b
  left join public.profiles p on p.id = b.user_id
  order by b.created_at desc nulls last, b.id
  limit 500;
end;
$function$;

revoke all on function public.admin_list_beneficiaries() from public;
revoke all on function public.admin_list_beneficiaries() from anon;
grant execute on function public.admin_list_beneficiaries() to authenticated;

commit;
