-- Event-driven client email notifications. The HTTP delivery is asynchronous so email
-- provider latency/failure never blocks or rolls back a client/admin database action.
create extension if not exists pg_net;

begin;

create table if not exists public.account_email_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  event_title text not null,
  event_summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_email_notification_log_user_created_idx
  on public.account_email_notification_log(user_id, created_at desc);

alter table public.account_email_notification_log enable row level security;
revoke all on public.account_email_notification_log from public, anon, authenticated;

create or replace function public.dispatch_account_email_notification(
  p_user_id uuid,
  p_event_type text,
  p_title text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_secret text;
  v_notification_id uuid;
begin
  if p_user_id is null then return; end if;

  select u.email into v_email
  from auth.users u
  where u.id = p_user_id and coalesce(u.email_confirmed_at, u.created_at) is not null;

  if v_email is null or length(v_email) > 254 then return; end if;

  insert into public.account_email_notification_log(user_id, event_type, event_title, event_summary, metadata)
  values (p_user_id, left(p_event_type, 80), left(p_title, 160), left(p_summary, 1000), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_notification_id;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'alps_notification_webhook_secret'
  limit 1;

  if v_secret is null then
    raise warning 'Account notification webhook secret is not configured; notification % remains logged.', v_notification_id;
    return;
  end if;

  begin
    perform net.http_post(
      url := 'https://alpscoinchaininvestment.uk/api/notifications/event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alps-notification-secret', v_secret
      ),
      body := jsonb_build_object(
        'notification_id', v_notification_id,
        'user_id', p_user_id,
        'to', v_email,
        'event_type', p_event_type,
        'title', p_title,
        'summary', p_summary,
        'metadata', coalesce(p_metadata, '{}'::jsonb),
        'occurred_at', now()
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- Never fail the business transaction because an email dispatch could not be queued.
    raise warning 'Could not queue account email notification %.', v_notification_id;
  end;
exception when others then
  -- Notification logging itself is best-effort and must never block the primary action.
  raise warning 'Account email notification could not be recorded.';
end;
$function$;

revoke all on function public.dispatch_account_email_notification(uuid,text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.notify_fund_request_email_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind text := lower(coalesce(new.request_type, 'request'));
  v_status text := lower(coalesce(new.status, 'pending'));
  v_action text;
  v_title text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_action := case when v_kind like '%deposit%' then 'deposit_request_received' else 'withdrawal_request_received' end;
    v_title := case when v_kind like '%deposit%' then 'Deposit request received' else 'Withdrawal request received' end;
    v_summary := 'Your ' || v_kind || ' request has been received and is pending review.';
    perform public.dispatch_account_email_notification(
      new.user_id, v_action, v_title, v_summary,
      jsonb_build_object('request_id',new.id,'request_type',v_kind,'amount',new.amount,'asset',new.asset,'reference',new.reference,'status',v_status)
    );
  elsif old.status is distinct from new.status then
    v_action := 'fund_request_status';
    v_title := case
      when v_status = 'approved' then initcap(v_kind) || ' request approved'
      when v_status = 'rejected' then initcap(v_kind) || ' request rejected'
      when v_status = 'under_review' then initcap(v_kind) || ' request under review'
      when v_status = 'cancelled' then initcap(v_kind) || ' request cancelled'
      else initcap(v_kind) || ' request status updated'
    end;
    v_summary := 'Your ' || v_kind || ' request status is now ' || v_status || '.';
    perform public.dispatch_account_email_notification(
      new.user_id, v_action, v_title, v_summary,
      jsonb_build_object('request_id',new.id,'request_type',v_kind,'amount',new.amount,'asset',new.asset,'reference',new.reference,'status',v_status)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists fund_requests_email_notification on public.fund_requests;
create trigger fund_requests_email_notification
after insert or update of status on public.fund_requests
for each row execute function public.notify_fund_request_email_event();

create or replace function public.notify_profile_email_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.account_status is distinct from new.account_status then
    perform public.dispatch_account_email_notification(
      new.id, 'account_status_changed', 'Account status updated',
      'Your account status has changed to ' || coalesce(new.account_status::text, 'updated') || '.',
      jsonb_build_object('account_status',new.account_status)
    );
  elsif (to_jsonb(old) - 'updated_at' - 'last_sign_in_at' - 'last_seen_at' - 'account_status' - 'can_self_deactivate')
        is distinct from
        (to_jsonb(new) - 'updated_at' - 'last_sign_in_at' - 'last_seen_at' - 'account_status' - 'can_self_deactivate') then
    perform public.dispatch_account_email_notification(
      new.id, 'profile_updated', 'Profile details updated',
      'Your profile details were updated. If you did not make this change, contact support.',
      '{}'::jsonb
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_email_notification on public.profiles;
create trigger profiles_email_notification
after update on public.profiles
for each row execute function public.notify_profile_email_event();

create or replace function public.notify_beneficiary_email_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_action text;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_action := lower(tg_op);
  perform public.dispatch_account_email_notification(
    v_user_id, 'beneficiary_' || v_action, 'Withdrawal beneficiary details changed',
    'A withdrawal beneficiary record was ' || v_action || '. If you did not make this change, contact support.',
    jsonb_build_object('action',v_action)
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;

drop trigger if exists beneficiaries_email_notification on public.beneficiaries;
create trigger beneficiaries_email_notification
after insert or update or delete on public.beneficiaries
for each row execute function public.notify_beneficiary_email_event();

create or replace function public.notify_apy_report_email_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.dispatch_account_email_notification(
      new.beneficiary_user_id, 'apy_report_published', 'Your investment activity report is available',
      'A new activity report for your account has been published and is available in your dashboard.',
      jsonb_build_object(
        'report_id',new.id,
        'period_start',new.reporting_period_start,
        'period_end',new.reporting_period_end,
        'apy_rate',new.apy_rate,
        'return_amount',new.return_amount,
        'asset_code',new.asset_code
      )
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists apy_report_email_notification on public.apy_performance_reports;
create trigger apy_report_email_notification
after insert or update of status on public.apy_performance_reports
for each row execute function public.notify_apy_report_email_event();

commit;
