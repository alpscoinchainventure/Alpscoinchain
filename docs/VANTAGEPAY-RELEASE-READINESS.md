# VantagePay release readiness
Last checked: 2026-10-25
Working branch: `vantagepay-integration-plan`
Release policy: preview first; test the complete candidate; never merge to `main` or change production without explicit approval.

## Verified current state
- GitHub working branch latest known commit: `2ba1a5ccdcb5f31b0e19f659d37554a280526869`.
- Draft PR #15 remains unmerged: https://github.com/alpscoinchainventure/Alpscoinchain/pull/15
- The dedicated Vercel project `vantagepay` has a deployment marked READY for commit `2ba1a5ccdcb5f31b0e19f659d37554a280526869`. This confirms deployment status only, not end-to-end functionality.
- Preview URL aliases include `https://vantagepay.vercel.app` and `https://vantagepay-alpscoinchaininvestmentventures.vercel.app`. Direct runtime/API verification is still outstanding.
- Dedicated Vercel project now has the public `VANTAGEPAY_NEON_AUTH_URL` and `VANTAGEPAY_NEON_DATA_API_URL` variables set for production, preview, and development. No database connection string, server-side database credential, webhook secret, or admin secret has been configured.
- A prior Vercel deployment request hit the free-plan daily deployment quota. Do not upgrade or incur costs without explicit approval.
- The two existing Supabase free projects under Century International Carrier remain untouched. A third free project could not be created because the organization reached its two-active-project limit. Do not pause, delete, or upgrade either existing project without explicit approval.
- User explicitly approved switching from Turso to Neon PostgreSQL.
- A dedicated Neon development project `vantagepay-dev` was provisioned in `aws-eu-central-1`, project ID `rapid-sound-41514033`, default branch ID `br-gentle-term-bagpxjdi`, database `neondb`. The project reports 0 compute time, 0 active time, 0 storage/data transfer at creation; this is not a promise of permanent zero cost, so monitor the plan/usage before launch.
- Neon Managed Better Auth was enabled for the development branch. Email/password signup is enabled, but email verification is currently disabled by default; production-grade email verification/provider setup remains required.
- Neon Data API was provisioned at the branch, with public schema configuration and a row cap of 100. The current starter schema tables (`vp_webhook_inbox`, `vp_asset_definitions`, `vp_ledger_transactions`, `vp_ledger_entries`, `vp_payout_requests`) were applied and verified to exist. No assets were seeded/enabled and no money movement was enabled.
- Trusted auth origins were added for `https://vantagepay.vercel.app`, `https://vintagebanking.cyou`, and `https://www.vintagebanking.cyou`.
- The `vantagepay-auth.html`, `vantagepay-dashboard.html`, and `vantagepay-admin.html` files have been migrated in the working branch to the Neon Auth Supabase-compatible adapter / Neon JS Data API client. `lib/vantagepay-api.js` verifies bearer sessions through Neon Auth and now sends customer/admin data requests to the Neon Data API using the user's JWT (not a Supabase service-role key). These code changes are not yet deployed or end-to-end verified. Added `tests/vantagepay-neon-api.test.js` to cover config output, user-JWT Data API routing, and rejection of missing sessions; the tests have not yet run in CI.
- Neon customer Data API security: a least-privilege RLS migration was applied to the dedicated development database and committed as `db/migrations/20261025_vantagepay_customer_rls.sql`. All `vp_%` tables have RLS enabled; anonymous/authenticated broad table grants were revoked; only authenticated own-row reads are granted for accounts, notifications, admin membership and beneficiaries; beneficiary SELECT is column-limited to non-sensitive fields (provider beneficiary token is not exposed); notifications can only update `read_at`; transaction requests can only be inserted with a narrow column grant and an own-user/pending-status policy. Admin audit, ledger, payout, external mapping/event and webhook tables remain inaccessible to customer roles. Database catalog checks verified the RLS flags, policy counts, `auth.user_id()` function, and customer grants. The migration is not yet end-to-end tested through the Data API.
- `vintagebanking.cyou` is purchased, but custom DNS records are not configured and the domain is not approved for launch.


## Direct runtime checks (2026-10-24)
- A live fetch of `https://vantagepay.vercel.app/vantagepay-home.html` returned HTTP 200 and the VantagePay standalone landing page.
- A live fetch of `https://vantagepay.vercel.app/api/vantagepay/config` returned HTTP 503 with code `VANTAGEPAY_BACKEND_NOT_CONFIGURED`. This confirms the application backend is not configured; authentication-dependent flows cannot pass yet.
- The project root URL `https://vantagepay.vercel.app/` currently returns the repository's AlpsCoinChain homepage. Do **not** point `vintagebanking.cyou` at this project/root until the root route is corrected or explicitly routed to VantagePay. Otherwise the custom domain could show the wrong product.
- Vercel team-scope access requires one-time user approval. Approval link (expires in 10 minutes from issuance): https://vercel.com/sso/session-requests/xztHuyKCVemNAu_8p3Bu_owchuI-I7Bi
- No DNS records were changed, and no custom domain was attached. This is intentional until the Neon application adapter is implemented and tested.

## Required before calling the preview ready
1. Finish privileged server-side operations by implementing a dedicated Neon PostgreSQL adapter for webhook storage and reviewed admin RPC equivalents. These are intentionally disabled/fail-closed; do not re-enable Supabase keys or set `VANTAGEPAY_NEON_PRIVILEGED_ADAPTER_READY` as a workaround.
2. Test the new customer RLS policies through the Neon Data API with separate customer JWTs, including attempts to read or mutate another user's records and attempts to modify transaction status/settlement fields.
3. Reconcile the starter ledger schema with the app's expected fields and add/test the missing database functions, transaction-request workflow, notifications, and audited admin operations.
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

## Current result
**Not ready for live launch.** Neon Auth/Data API frontend wiring and a restrictive RLS/grant baseline are committed/applied to the dedicated development branch. Customer API calls now use the user's Neon JWT, but runtime calls have not been tested and privileged webhook storage/admin RPCs remain intentionally disabled or incomplete. Ledger/RPC compatibility, full test coverage, and end-to-end checks remain outstanding. Vercel's free-plan build-rate limit is still blocking a fresh deployment. Keep the custom domain disconnected and all money movement disabled.
