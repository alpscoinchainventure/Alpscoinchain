# VantagePay Authentication and Security Audit (2026-10-24)

## Scope and status

This is a configuration/schema audit of the connected Supabase project named "Alpscoinchain Investment Ventures" (project ref `uevofmlzpwrdidjnwxfd`) and the VantagePay integration branch. It is not a penetration test, and it does not prove the deployed login UI is wired to this project.

## Existing foundation observed

- Supabase project is active and healthy.
- Public schema includes `profiles`, `fund_requests`, `ledger_entries`, `beneficiaries`, `kyc_submissions`, `test_deposits`, `test_withdrawals`, and `test_transactions`.
- Row Level Security is enabled on the tables inspected.
- Existing tables have customer/profile, KYC, fund request, and ledger-like structures. Some are explicitly named `test_*` and must not be treated as production financial records.
- Repository `package.json` currently does not include the Supabase JavaScript client; actual website auth integration must be checked/implemented separately.

## Security findings from Supabase Security Advisor

1. **High-priority authorization review:** multiple `SECURITY DEFINER` functions are executable by `anon` and/or `authenticated`, including admin-oriented functions for reviewing KYC/fund requests, listing customer data, and adjusting/posting ledger entries. The advisor warning alone does not prove exploitability because functions may perform internal authorization checks, but execution grants and function bodies must be reviewed before relying on them. In particular, anonymous execution of admin-named functions should not remain unless there is a documented, verified reason.
2. `public.admin_action_audit` has RLS enabled but no policies. This is safer than accidentally exposing rows, but intended privileged access should be explicitly designed and documented.
3. **Leaked-password protection is disabled** in Supabase Auth. Enable it in Auth password/security settings before onboarding real users.
4. Review RLS policies on every exposed table, especially ledger entries, profiles, KYC metadata, fund requests, beneficiaries, deposit wallet addresses, and all audit tables. Confirm customers can access only their own rows and cannot change privileged columns such as role, KYC status, approval status, reviewer fields, balances, or ledger entries.
5. Review Storage bucket policies for KYC documents. Keep identity documents private and use short-lived signed URLs only after server-side authorization.

## Safe implementation order

1. Inspect the definitions of every flagged `SECURITY DEFINER` function and its current grants. Do not blindly revoke all authenticated grants: some admin workflows may depend on functions, and the correct solution is explicit authorization inside each function plus minimum required grants.
2. Test access as anonymous, ordinary authenticated customer, and authorized admin using non-sensitive test accounts. Include negative tests for cross-customer reads/writes and attempts to self-promote to admin or self-approve KYC/withdrawals.
3. Enable leaked-password protection; review email confirmation, password reset, session lifetime, and rate limiting settings.
4. Integrate the website with Supabase Auth using only the publishable/anon key in the browser. Never expose service-role keys in client bundles or commit secrets.
5. Ensure profile creation is tied to `auth.users.id`; derive identity from the verified session, not a user-supplied ID.
6. Implement secure sign-up, sign-in, sign-out, email verification, password reset, session-aware route guards, profile editing, and helpful error states. Add two-factor authentication only after the core flow is tested.
7. Keep balances derived from server-controlled ledger records. Customers must never write ledger entries or set their own balance. Deposits and withdrawals remain request/status workflows until a provider integration, reconciliation, legal authorization, and production controls are verified.
8. Re-run Supabase Security Advisor and automated tests before exposing signup broadly.

## Release gate

Do not describe VantagePay as a live bank or enable real-money movement based on this audit. A successful page response is not proof that authentication works. Mark each feature complete only after integration tests verify both the expected success path and unauthorized/invalid cases.
