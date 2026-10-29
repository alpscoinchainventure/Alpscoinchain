-- Admin-only editing for recorded APY / investment-profit report figures.
-- This updates report records and audit history only; it never posts ledger entries.

create or replace function public.apy_admin_update_investment_profit(
  p_report_id uuid,
  p_apy_rate numeric,
  p_return_amount numeric,
  p_asset_code text,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.apy_performance_reports%rowtype;
  v_asset text;
  v_summary text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.apy_is_admin() then raise exception 'Administrator access required'; end if;
  if p_report_id is null then raise exception 'Choose a valid report'; end if;
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

  select * into v_report
  from public.apy_performance_reports
  where id = p_report_id
  for update;
  if not found then raise exception 'Investment profit report not found'; end if;

  update public.apy_performance_reports
  set apy_rate = p_apy_rate,
      return_amount = p_return_amount,
      asset_code = v_asset,
      summary = v_summary,
      updated_at = now(),
      reviewed_by = auth.uid()
  where id = p_report_id;

  insert into public.apy_report_audit(report_id, actor_id, action, old_status, new_status, notes)
  values (
    p_report_id, auth.uid(), 'investment_profit_updated', v_report.status, v_report.status,
    'Recorded APY/return figures updated. Previous return=' ||
      coalesce(v_report.return_amount::text, 'not recorded') || ' ' ||
      coalesce(v_report.asset_code, '') || '; new return=' ||
      coalesce(p_return_amount::text, 'not recorded') || ' ' || coalesce(v_asset, '') ||
      '; previous APY=' || coalesce(v_report.apy_rate::text, 'not recorded') ||
      '; new APY=' || coalesce(p_apy_rate::text, 'not recorded')
  );
  return jsonb_build_object('success', true, 'report_id', p_report_id, 'status', v_report.status);
end;
$$;

revoke all on function public.apy_admin_update_investment_profit(uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.apy_admin_update_investment_profit(uuid,numeric,numeric,text,text) to authenticated;
