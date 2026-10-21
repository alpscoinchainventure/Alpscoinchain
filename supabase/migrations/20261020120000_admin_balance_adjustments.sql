-- Auditable administrator balance adjustments that do not depend on a client fund request.
-- All balance changes still go through the existing ledger posting function.
begin;

create table if not exists public.admin_balance_adjustment_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  ledger_entry_id uuid not null unique references public.ledger_entries(id) on delete restrict,
  entry_type text not null check (entry_type in ('credit', 'debit')),
  amount numeric not null check (amount > 0),
  asset text not null,
  reference text not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  balance_before numeric not null,
  balance_after numeric not null,
  created_at timestamptz not null default now()
);

alter table public.admin_balance_adjustment_audit enable row level security;
revoke all on public.admin_balance_adjustment_audit from public, anon;
grant select on public.admin_balance_adjustment_audit to authenticated;

drop policy if exists "Active admins read balance adjustment audit"
  on public.admin_balance_adjustment_audit;
create policy "Active admins read balance adjustment audit"
  on public.admin_balance_adjustment_audit
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'admin'
        and lower(coalesce(p.account_status, '')) = 'active'
    )
  );

create or replace function public.admin_preview_client_balance(
  p_client_id uuid,
  p_asset text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_asset text := upper(pg_catalog.btrim(coalesce(p_asset, '')));
  v_balance numeric;
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active administrator access required';
  end if;

  if v_asset not in ('BTC','ETH','USDT','USDC','BNB','SOL','LTC','XRP') then
    raise exception using errcode = '22023', message = 'Unsupported asset';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_client_id and lower(coalesce(p.role, '')) = 'client'
  ) then
    raise exception using errcode = 'P0002', message = 'Client profile not found';
  end if;

  select coalesce(sum(case
    when lower(le.entry_type) = 'credit' then le.amount
    when lower(le.entry_type) = 'debit' then -le.amount
    else 0
  end), 0)
  into v_balance
  from public.ledger_entries le
  where le.user_id = p_client_id and upper(le.asset) = v_asset;

  return jsonb_build_object(
    'success', true,
    'client_id', p_client_id,
    'asset', v_asset,
    'balance', v_balance
  );
end;
$function$;

create or replace function public.admin_adjust_client_balance(
  p_client_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_asset text,
  p_reference text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_type text := lower(pg_catalog.btrim(coalesce(p_entry_type, '')));
  v_asset text := upper(pg_catalog.btrim(coalesce(p_asset, '')));
  v_reference text := pg_catalog.btrim(coalesce(p_reference, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_before numeric;
  v_after numeric;
  v_result jsonb;
  v_entry_id uuid;
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active administrator access required';
  end if;

  if v_type not in ('credit', 'debit') then
    raise exception using errcode = '22023', message = 'Adjustment must be credit or debit';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception using errcode = '22023', message = 'Amount must be a finite positive number';
  end if;
  if v_asset not in ('BTC','ETH','USDT','USDC','BNB','SOL','LTC','XRP') then
    raise exception using errcode = '22023', message = 'Unsupported asset';
  end if;
  if pg_catalog.char_length(v_reference) < 3 or pg_catalog.char_length(v_reference) > 200 then
    raise exception using errcode = '22023', message = 'Enter a unique supporting reference between 3 and 200 characters';
  end if;
  if pg_catalog.char_length(v_reason) < 3 or pg_catalog.char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Enter a reason between 3 and 1000 characters';
  end if;

  -- Serialize adjustments for this client so concurrent admin actions do not
  -- calculate the before/after balance against the same stale ledger state.
  perform 1 from public.profiles p
  where p.id = p_client_id and lower(coalesce(p.role, '')) = 'client'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Client profile not found';
  end if;

  if exists (
    select 1 from public.ledger_entries le
    where le.reference = v_reference
  ) then
    raise exception using errcode = '23505', message = 'That ledger reference has already been used';
  end if;

  select coalesce(sum(case
    when lower(le.entry_type) = 'credit' then le.amount
    when lower(le.entry_type) = 'debit' then -le.amount
    else 0
  end), 0)
  into v_before
  from public.ledger_entries le
  where le.user_id = p_client_id and upper(le.asset) = v_asset;

  v_result := public.admin_post_ledger_entry(
    p_client_id,
    v_type,
    p_amount,
    v_asset,
    v_reference,
    'Administrator balance adjustment. Reason: ' || v_reason
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    raise exception 'Ledger posting did not confirm success; adjustment cancelled';
  end if;

  v_entry_id := (v_result ->> 'entry_id')::uuid;

  select coalesce(sum(case
    when lower(le.entry_type) = 'credit' then le.amount
    when lower(le.entry_type) = 'debit' then -le.amount
    else 0
  end), 0)
  into v_after
  from public.ledger_entries le
  where le.user_id = p_client_id and upper(le.asset) = v_asset;

  insert into public.admin_balance_adjustment_audit (
    client_id, admin_id, ledger_entry_id, entry_type, amount, asset,
    reference, reason, balance_before, balance_after, created_at
  ) values (
    p_client_id, v_admin_id, v_entry_id, v_type, p_amount, v_asset,
    v_reference, v_reason, v_before, v_after, now()
  );

  return jsonb_build_object(
    'success', true,
    'client_id', p_client_id,
    'entry_id', v_entry_id,
    'entry_type', v_type,
    'amount', p_amount,
    'asset', v_asset,
    'reference', v_reference,
    'balance_before', v_before,
    'balance_after', v_after,
    'payout_sent', false
  );
end;
$function$;

create or replace function public.admin_list_balance_adjustments()
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  admin_id uuid,
  ledger_entry_id uuid,
  entry_type text,
  amount numeric,
  asset text,
  reference text,
  reason text,
  balance_before numeric,
  balance_after numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.account_status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active administrator access required';
  end if;

  return query
  select a.id, a.client_id, coalesce(p.full_name, a.client_id::text),
         a.admin_id, a.ledger_entry_id, a.entry_type, a.amount, a.asset,
         a.reference, a.reason, a.balance_before, a.balance_after, a.created_at
  from public.admin_balance_adjustment_audit a
  join public.profiles p on p.id = a.client_id
  order by a.created_at desc
  limit 100;
end;
$function$;

revoke all on function public.admin_preview_client_balance(uuid, text) from public, anon;
revoke all on function public.admin_adjust_client_balance(uuid, text, numeric, text, text, text) from public, anon;
revoke all on function public.admin_list_balance_adjustments() from public, anon;
grant execute on function public.admin_preview_client_balance(uuid, text) to authenticated;
grant execute on function public.admin_adjust_client_balance(uuid, text, numeric, text, text, text) to authenticated;
grant execute on function public.admin_list_balance_adjustments() to authenticated;

notify pgrst, 'reload schema';
commit;
