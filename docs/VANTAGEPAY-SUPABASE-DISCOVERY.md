# VantagePay Supabase integration notes (initial discovery)

## Connected project
The connected Supabase workspace contains a project named **Alpscoinchain Investment Ventures** (`uevofmlzpwrdidjnwxfd`) in the `eu-west-1` region. This discovery does not itself mean it is safe to change its existing data: it already has customer, KYC, beneficiary, fund-request, ledger, and admin audit tables. Treat it as an existing application database, not a blank VantagePay database.

## Existing database surface observed
The existing project includes `profiles`, `beneficiaries`, `fund_requests`, `ledger_entries`, `test_deposits`, `test_withdrawals`, `test_transactions`, `kyc_submissions`, `kyc_audit_log`, and administrative audit tables. Several tables have RLS enabled. Do not create duplicate user/account tables or change existing policies without reviewing the current schema, policies, functions, triggers, and app use.

## Security findings from Supabase Security Advisor (2026-10-24)
- Leaked-password protection is disabled.
- One RLS-enabled table (`public.admin_action_audit`) has no RLS policies.
- The Advisor reported multiple `SECURITY DEFINER` functions executable by `anon` and/or `authenticated`, including administrative balance adjustment, client/beneficiary/KYC listing, KYC review, and fund-request review functions.
These findings require careful privilege review before enabling new public login/customer flows. Do not blindly revoke functions without checking dependencies and intended roles, because that could break existing admin/customer flows. In particular, admin functions must verify authorization internally and must not be executable by anonymous users.

## Current safe next steps
1. Configure and verify Supabase Auth settings: email/password, email confirmation, allowed redirect URLs, password strength, and leaked-password protection.
2. Review every RLS policy and `SECURITY DEFINER` function, starting with all admin RPCs and `admin_action_audit`. Make permission changes only after inspecting function bodies and current app dependencies.
3. Build VantagePay auth UI using the existing project URL and publishable key. The publishable key may be used by the frontend; NEVER put a service-role secret or database connection string in frontend code.
4. Keep login/signup changes on `vantagepay-integration-plan` and preview-only until end-to-end flows pass. No financial operation becomes real just because the user can authenticate.
5. Validate sign-up/email verification, login/logout, recovery, session persistence, profile ownership, customer-vs-admin authorization and transaction access with test accounts before release.

## Current state
This is a discovery report only. It does not claim that the VantagePay website is already wired to Supabase Auth, that email flows are configured, or that policy findings have been remediated.