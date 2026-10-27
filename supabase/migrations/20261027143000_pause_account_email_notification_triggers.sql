-- Pause event triggers until the email webhook is deployed to production.
-- Keep the log table and dispatch function in place; core account actions are unaffected.
begin;
drop trigger if exists fund_requests_email_notification on public.fund_requests;
drop trigger if exists profiles_email_notification on public.profiles;
drop trigger if exists beneficiaries_email_notification on public.beneficiaries;
drop trigger if exists apy_report_email_notification on public.apy_performance_reports;
commit;
