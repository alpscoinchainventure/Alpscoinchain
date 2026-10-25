# VantagePay release readiness
Last checked: 2026-10-25
Working branch: `vantagepay-integration-plan`
Release policy: preview first; test the complete candidate; never merge to `main` or change production without explicit approval.

## Verified current state
- GitHub working branch latest known commit: `2ba1a5ccdcb5f31b0e19f659d37554a280526869`.
- Draft PR #15 remains unmerged: https://github.com/alpscoinchainventure/Alpscoinchain/pull/15
- The dedicated Vercel project `vantagepay` has a deployment marked READY for commit `2ba1a5ccdcb5f31b0e19f659d37554a280526869`. This confirms deployment status only, not end-to-end functionality.
- Preview URL aliases include `https://vantagepay.vercel.app` and `https://vantagepay-alpscoinchaininvestmentventures.vercel.app`. Direct runtime/API verification is still outstanding.
- Vercel project environment variables were empty at last inspection. Required VantagePay secrets/configuration are not set.
- A prior Vercel deployment request hit the free-plan daily deployment quota. Do not upgrade or incur costs without explicit approval.
- The two existing Supabase free projects under Century International Carrier remain untouched. A third free project could not be created because the organization reached its two-active-project limit. Do not pause, delete, or upgrade either existing project without explicit approval.
- User explicitly approved switching from Turso to Neon PostgreSQL.
- A dedicated Neon development project `vantagepay-dev` was provisioned in `aws-eu-central-1`, project ID `rapid-sound-41514033`, default branch ID `br-gentle-term-bagpxjdi`, database `neondb`. The project reports 0 compute time, 0 active time, 0 storage/data transfer at creation; this is not a promise of permanent zero cost, so monitor the plan/usage before launch.
- Neon Managed Better Auth was enabled for the development branch. Email/password signup is enabled, but email verification is currently disabled by default; production-grade email verification/provider setup remains required.
- Neon Data API was provisioned at the branch, with public schema configuration and a row cap of 100. The current starter schema tables (`vp_webhook_inbox`, `vp_asset_definitions`, `vp_ledger_transactions`, `vp_ledger_entries`, `vp_payout_requests`) were applied and verified to exist. No assets were seeded/enabled and no money movement was enabled.
- Trusted auth origins were added for `https://vantagepay.vercel.app`, `https://vintagebanking.cyou`, and `https://www.vintagebanking.cyou`.
- Important: this provisions infrastructure and starter tables only. The current application API still expects Supabase Auth and Supabase REST/service-role behavior, and the browser auth page still loads Supabase JS. The Neon adapter migration is not yet complete, so do not treat registration, dashboard, or transaction APIs as functional yet.
- `vintagebanking.cyou` is purchased, but custom DNS records are not configured and the domain is not approved for launch.


## Direct runtime checks (2026-10-24)
- A live fetch of `https://vantagepay.vercel.app/vantagepay-home.html` returned HTTP 200 and the VantagePay standalone landing page.
- A live fetch of `https://vantagepay.vercel.app/api/vantagepay/config` returned HTTP 503 with code `VANTAGEPAY_BACKEND_NOT_CONFIGURED`. This confirms the application backend is not configured; authentication-dependent flows cannot pass yet.
- The project root URL `https://vantagepay.vercel.app/` currently returns the repository's AlpsCoinChain homepage. Do **not** point `vintagebanking.cyou` at this project/root until the root route is corrected or explicitly routed to VantagePay. Otherwise the custom domain could show the wrong product.
- Vercel team-scope access requires one-time user approval. Approval link (expires in 10 minutes from issuance): https://vercel.com/sso/session-requests/xztHuyKCVemNAu_8p3Bu_owchuI-I7Bi
- No DNS records were changed, and no custom domain was attached. This is intentional until the Neon application adapter is implemented and tested.

## Required before calling the preview ready
1. Complete the application migration from Supabase Auth/REST to Neon Managed Auth + the Neon Data API or a server-side PostgreSQL adapter. Never expose database credentials or privileged secrets to browser code.
2. Configure exact VantagePay environment variables in the dedicated Vercel project only after the code adapter is ready. Do not place secrets in Git or logs.
3. Review the starter schema and add the missing customer/profile, transaction-request, admin-membership, audit, and notification tables/functions before attempting those application flows.
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
**Not ready for live launch.** A Vercel deployment exists, but backend provisioning and selection, secure auth/database integration, environment configuration, direct API verification, end-to-end tests, and domain DNS remain gated. Next step: finish the Neon application/auth/data-access adapter, then deploy a preview and run end-to-end tests before connecting the custom domain.
