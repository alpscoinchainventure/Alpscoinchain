-- Notify a client whenever a new ledger entry is posted.
-- Run this only after /api/notifications/event is deployed to production.
begin;

create or replace function public.notify_ledger_entry_email_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_title text;
  v_summary text;
begin
  v_title := case
    when lower(coalesce(new.entry_type, '')) = 'credit' then 'Ledger credit posted'
    when lower(coalesce(new.entry_type, '')) = 'debit' then 'Ledger debit posted'
    else 'Ledger entry posted'
  end;

  v_summary := 'A ' || lower(coalesce(new.entry_type, 'ledger')) ||
    ' ledger entry of ' || new.amount::text || ' ' || upper(new.asset) ||
    ' has been posted to your account. Sign in to review the entry details.';

  perform public.dispatch_account_email_notification(
    new.user_id,
    'ledger_entry_posted',
    v_title,
    v_summary,
    jsonb_build_object(
      'ledger_entry_id', new.id,
      'entry_type', new.entry_type,
      'amount', new.amount,
      'asset', new.asset,
      'reference', new.reference,
      'description', new.description,
      'created_at', new.created_at
    )
  );
  return new;
end;
$function$;

revoke all on function public.notify_ledger_entry_email_event() from public, anon, authenticated;

drop trigger if exists ledger_entries_email_notification on public.ledger_entries;
create trigger ledger_entries_email_notification
after insert on public.ledger_entries
for each row execute function public.notify_ledger_entry_email_event();

-- Re-enable the existing event notifications now that the production webhook is available.
drop trigger if exists fund_requests_email_notification on public.fund_requests;
create trigger fund_requests_email_notification
after insert or update of status on public.fund_requests
for each row execute function public.notify_fund_request_email_event();

drop trigger if exists profiles_email_notification on public.profiles;
create trigger profiles_email_notification
after update on public.profiles
for each row execute function public.notify_profile_email_event();

drop trigger if exists beneficiaries_email_notification on public.beneficiaries;
create trigger beneficiaries_email_notification
after insert or update or delete on public.beneficiaries
for each row execute function public.notify_beneficiary_email_event();

drop trigger if exists apy_report_email_notification on public.apy_performance_reports;
create trigger apy_report_email_notification
after insert or update of status on public.apy_performance_reports
for each row execute function public.notify_apy_report_email_event();

commit;
