-- Admin account listing and deposit/withdrawal request review.
-- Review decisions never move money or create ledger credits.

create or replace function public.admin_list_profiles()
returns table (id uuid, role text, account_status text)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception 'Active administrator access required';
  end if;

  return query
    select p.id, p.role::text, p.account_status::text
    from public.profiles p
    order by lower(coalesce(p.role, '')), p.id;
end;
$function$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

drop policy if exists "Active admins can read fund requests" on public.fund_requests;
create policy "Active admins can read fund requests"
  on public.fund_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
        and lower(coalesce(p.account_status, '')) = 'active'
    )
  );

grant select on public.fund_requests to authenticated;

create or replace function public.admin_review_fund_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_request_type text;
  v_reference text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception 'Active administrator access required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  if p_decision = 'rejected'
     and length(trim(coalesce(p_review_note, ''))) < 3 then
    raise exception 'A rejection reason of at least 3 characters is required';
  end if;

  select fr.status, fr.request_type, fr.reference
    into v_status, v_request_type, v_reference
  from public.fund_requests fr
  where fr.id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if lower(coalesce(v_status, '')) <> 'pending' then
    return jsonb_build_object(
      'success', false,
      'message', 'Only pending requests can be reviewed',
      'status', v_status
    );
  end if;

  update public.fund_requests
     set status = p_decision,
         review_note = nullif(trim(coalesce(p_review_note, '')), '')
   where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'request_type', v_request_type,
    'reference', v_reference,
    'status', p_decision,
    'funds_moved', false
  );
end;
$function$;

revoke all on function public.admin_review_fund_request(uuid, text, text) from public;
grant execute on function public.admin_review_fund_request(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
