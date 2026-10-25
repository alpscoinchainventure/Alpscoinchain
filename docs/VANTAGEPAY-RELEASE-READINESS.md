# VantagePay release readiness
Last checked: 2026-10-25
Working branch: `vantagepay-integration-plan`
Release policy: preview first; test the complete candidate; never merge to `main` or change production without explicit approval.

## Verified current state
- GitHub working branch contains follow-on Neon migration, RLS, and test commits beyond the original deployment baseline `2ba1a5ccdcb5f31b0e19f659d37554a280526869`; PR #15 remains the review point for the latest branch head.
- Draft PR #15 remains unmerged: https://github.com/alpscoinchainventure/Alpscoinchain/pull/15
- The dedicated Vercel project `vantagepay` has a preview deployment marked READY for commit `17ea0fcca0311361f3508a3c43b8960b4a246e83`; the production deployment is older. READY confirms deployment status only, not end-to-end functionality.
- The deployed preview serves `/vantagepay`, `/vantagepay-auth.html`, and `/vantagepay-dashboard.html` with HTTP 200. `/api/vantagepay/config` returns HTTP 200 with the configured public Neon Auth/Data API endpoints. Authenticated user flows and JWT-based database operations remain unverified.
- Dedicated Vercel project now has the public `VANTAGEPAY_NEON_AUTH_URL` and `VANTAGEPAY_NEON_DATA_API_URL` variables set for production, preview, and development. No database connection string, server-side database credential, webhook secret, or admin secret has been configured.
- A prior Vercel deployment request hit the free-plan daily deployment quota. Do not upgrade or incur costs without explicit approval.
- The two existing Supabase free projects under Century International Carrier remain untouched. A third free project could not be created because the organization reached its two-active-project limit. Do not pause, delete, or upgrade either existing project without explicit approval.
- User explicitly approved switching from Turso to Neon PostgreSQL.
- A dedicated Neon development project `vantagepay-dev` was provisioned in `aws-eu-central-1`, project ID `rapid-sound-41514033`, default branch ID `br-gentle-term-bagpxjdi`, database `neondb`. The project reports 0 compute time, 0 active time, 0 storage/data transfer at creation; this is not a promise of permanent zero cost, so monitor the plan/usage before launch.
- Neon Managed Better Auth was enabled for the development branch. Email/password signup is enabled, but email verification is currently disabled by default; production-grade email verification/provider setup remains required.
- Neon Data API was provisioned at the branch, with public schema configuration and a row cap of 100. The current starter schema tables (`vp_webhook_inbox`, `vp_asset_definitions`, `vp_ledger_transactions`, `vp_ledger_entries`, `vp_payout_requests`) were applied and verified to exist. No assets were seeded/enabled and no money movement was enabled.
- Trusted auth origins were added for `https://vantagepay.vercel.app`, `https://vintagebanking.cyou`, and `https://www.vintagebanking.cyou`.
- The `vantagepay-auth.html`, `vantagepay-dashboard.html`, and `vantagepay-admin.html` files use the Neon Auth Supabase-compatible adapter / Neon JS Data API client. The unused Supabase CDN SDK has been removed from the auth page. `lib/vantagepay-api.js` verifies bearer sessions through Neon Auth and sends customer/admin data requests to the Neon Data API using the user's JWT (not a Supabase service-role key). The unit/regression suite now passes 55/55 in GitHub Actions at commit `0e13b11d89de3da0ee776f422bc721ffd87b1bef` (run: https://github.com/alpscoinchainventure/Alpscoinchain/actions/runs/40152256025). This does not replace end-to-end testing against Neon with real user sessions.
- Neon customer Data API security: a least-privilege RLS migration was applied to the dedicated development database and committed as `db/migrations/20261025_vantagepay_customer_rls.sql`. All `vp_%` tables have RLS enabled; anonymous/authenticated broad table grants were revoked; only authenticated own-row reads are granted for accounts, notifications, admin membership and beneficiaries; beneficiary SELECT is column-limited to non-sensitive fields (provider beneficiary token is not exposed); notifications can only update `read_at`; transaction requests can only be inserted with a narrow column grant and an own-user/pending-status policy; withdrawal requests must reference an owned, verified beneficiary. Admin audit, ledger, payout, external mapping/event and webhook tables remain inaccessible to customer roles. Database catalog checks verified the RLS flags, policy counts, `auth.user_id()` function, and customer grants. The migration is not yet end-to-end tested through the Data API.
- Admin request review: migration `db/migrations/20261025_vantagepay_admin_request_functions.sql` is committed, and `vp_admin_list_transaction_requests` plus `vp_admin_update_request_status` are installed on the dedicated Neon development database. Catalog verification confirms both are SECURITY DEFINER functions, executable by `authenticated` and not by `anonymous`. They re-check the actor's JWT identity and enabled admin membership in SQL; status changes write an audit row and customer notification, and explicitly do not settle or move funds. The admin queue API now calls the SQL RPC instead of attempting a cross-customer table read under RLS. Live JWT-based RPC behavior is not yet end-to-end tested. The balance-adjustment RPC is deliberately not implemented because the existing ledger tables do not yet define a reviewed currency/account-balance model; that endpoint must remain unavailable rather than imply a successful balance change.
- `vintagebanking.cyou` is purchased, but custom DNS records are not configured and the domain is not approved for launch.


## Direct runtime checks (2026-10-24)
- A live fetch of `https://vantagepay.vercel.app/vantagepay-home.html` returned HTTP 200 and the VantagePay standalone landing page.
- A live fetch of `https://vantagepay.vercel.app/api/vantagepay/config` returned HTTP 503 with code `VANTAGEPAY_BACKEND_NOT_CONFIGURED`. This confirms the application backend is not configured; authentication-dependent flows cannot pass yet.
- The project root URL of the older deployed preview currently returns the repository's AlpsCoinChain homepage. A host-routing correction is committed on the working branch in `server.js`, but it has not been deployed because Vercel returned HTTP 402 for the free-plan daily deployment limit (retry after 24 hours). Do **not** point `vintagebanking.cyou` at the root until that fix is deployed and verified.
- Vercel team-scope access requires one-time user approval. Approval link (expires in 10 minutes from issuance): https://vercel.com/sso/session-requests/xztHuyKCVemNAu_8p3Bu_owchuI-I7Bi
- No DNS records were changed, and no custom domain was attached. This is intentional until the Neon application adapter is implemented and tested.

## Required before calling the preview ready
1. Implement and security-review a least-privilege server-side Neon adapter for webhook intake and other privileged operations. Webhooks remain hard-disabled; do not re-enable them through an environment flag or bypass.
2. Test customer RLS policies through the Neon Data API with separate customer JWTs, including attempts to read or mutate another user's records and attempts to modify transaction status/settlement fields.
3. Reconcile the starter ledger schema with a reviewed currency/account-balance model before implementing any balance-adjustment RPC. Do not create a fake or one-sided ledger entry to simulate a balance change.
6. Test signup, confirmation, login, logout, password reset/recovery, and two-account isolation.
7. Test customer dashboard, activity, notifications, transaction-request validation, admin permissions/audit trail, mobile layout, and API failure states.
8. Validate reward-provider signatures and duplicate suppression in a sandbox only after a real provider contract and sandbox credentials exist. Do not auto-credit unverified rewards or enable live money movement.
9. Run the full test suite and end-to-end checks against the deployed preview; deployment status alone is not sufficient.
10. Only after preview acceptance and explicit user approval: attach `vintagebanking.cyou`, set registrar DNS to the exact values supplied by Vercel, verify HTTPS/auth callbacks, and plan a separately approved production release.

## Release guardrails
- No real deposits, withdrawals, transfers, or live balances are enabled.
- No automatic APY/reward crediting is enabled.
- KYC is deferred; do not request identity documents in this phase.
- Keep VantagePay separate from the AlpsCoinChain website and database.
- Keep PR #15 as draft until the preview is tested and reviewed.
- Never print service-role keys, database URLs, webhook secrets, SMTP credentials, or other environment-variable values in logs or docs.
- Do not incur paid upgrades or change/delete existing resources without explicit approval.

## Latest work (2026-10-25)
- Installed the admin queue and metadata-only request-status SQL functions on the dedicated Neon development database. Catalog checks confirmed SECURITY DEFINER and authenticated-only execution; anonymous execution is denied.
- Routed the admin queue API through the SQL function and made the balance-adjustment endpoint explicitly fail closed until the ledger accounting model is reviewed.
- Added regression tests for admin queue RPC routing, audited status RPC routing, and the disabled balance-adjustment endpoint. GitHub Actions now passes 55/55 tests at commit `0e13b11d89de3da0ee776f422bc721ffd87b1bef`; see https://github.com/alpscoinchainventure/Alpscoinchain/actions/runs/40152256025.
- Verified that the existing deployed preview serves the VantagePay page at `/vantagepay` and returns HTTP 200 from `/api/vantagepay/config`. The root of that deployment still serves AlpsCoinChain. The branch includes a host-routing fix and a safer disabled-balance admin UI, but Vercel blocked a fresh deployment with the daily free-plan limit. Authenticated end-to-end verification is still outstanding.

## Latest work (2026-10-24)
- Added regression tests for expired Neon sessions, privileged APY webhook fail-closed behavior, and unauthenticated admin access. Commit: `5fc6b1aa487653d72f4d4bf372532efb6316deb0`.
- The original tests were later executed in GitHub Actions; see the 2026-10-25 result above. The current passing result is for the branch head at the recorded commit, not a fresh deployment.

## Current result
**Not ready for live launch.** The unit/regression suite passes 55/55 on the latest recorded passing commit, but the newest source has not been deployed due to Vercel's free-plan daily deployment limit. Neon Auth/Data API frontend wiring and restrictive RLS/grants are in place on the dedicated development branch. Admin status RPCs are installed, but JWT-based runtime behavior and customer-isolation checks are not yet tested end to end. The balance-adjustment RPC has been removed from the starter schema until the ledger accounting model is reviewed; the API and admin UI fail closed. Privileged webhook routes remain disabled. Keep the custom domain disconnected and all money movement disabled.
