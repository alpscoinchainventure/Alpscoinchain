# VantagePay release readiness
Last checked: 2026-10-24
Working branch: `vantagepay-integration-plan`
Release policy: preview first; test the complete candidate; never merge to `main` or change production without explicit approval.

## Verified current state
- GitHub validation workflows passed on commit `dfe851dc339bb0d2d6b40a2d0bebb2550435e875` (latest recorded branch commit at the time of this check).
- Netlify PR preview reports success for that commit: https://deploy-preview-15--alpscoinchaininvestmentventures.netlify.app
- The preview is not yet considered an accepted end-to-end VantagePay deployment; routes, authentication, database access, and admin flows still need direct testing.
- The dedicated Vercel project `vantagepay` is linked to the repository but has no successful deployment and no environment variables configured.
- The Vercel deployment API returned the free-plan limit `api-deployments-free-per-day` and asked to retry in 24 hours. Do not upgrade or incur costs without the user's explicit approval.
- The Vercel integration currently needs the user to authorize team access before the project can be inspected/managed through the connected integration.
- Supabase currently has two existing active projects; do not apply the VantagePay standalone schema to either shared project and do not create a third project without cost approval.
- `vintagebanking.cyou` is purchased, but DNS has no custom records and is not attached to the VantagePay project.

## Required before calling the preview ready
1. Obtain user approval for Vercel team access and verify project scope.
2. Confirm no paid upgrade is required; wait for the free deployment quota reset.
3. Provision/configure a dedicated VantagePay backend only after cost/plan is confirmed. Required runtime settings include:
   - `VANTAGEPAY_SUPABASE_URL`
   - `VANTAGEPAY_SUPABASE_PUBLISHABLE_KEY`
   - `VANTAGEPAY_SUPABASE_SERVICE_ROLE_KEY` (server-side secret only)
   - Reward/APY webhook secrets and provider codes only when the actual provider contract and sandbox are ready.
4. Review the standalone SQL migration, apply it only to the dedicated VantagePay database, and verify RLS, grants, triggers, and RPCs. Provision named admin memberships securely; never let customers self-assign roles.
5. Configure auth Site URL and exact redirect allow-list for the preview host; test signup, confirmation, login, logout, password reset/recovery, and two-account isolation.
6. Confirm the correct runtime supports `server.js` and all VantagePay API routes. A static-file-only preview does not prove server routes work.
7. Test customer dashboard, activity, notifications, transaction-request validation, admin permissions/audit trail, mobile layout, and API failure states.
8. Configure email/SMS delivery only if the provider is chosen and credentials are available. In-app notifications alone are implemented in code.
9. Validate reward-provider signatures and duplicate suppression in a sandbox. Do not auto-credit unverified rewards or enable live money movement.
10. Only after the preview passes and the user approves: attach `vintagebanking.cyou`, set registrar DNS to the exact values Vercel provides, verify HTTPS/auth callbacks, then plan a separately approved production release.

## Release guardrails
- No real deposits, withdrawals, transfers, or live balances are enabled.
- No automatic APY/reward crediting is enabled.
- KYC is deferred; do not request identity documents in this phase.
- Keep VantagePay separate from the AlpsCoinChain website and database.
- Keep PR #15 as draft until the preview is tested and reviewed.
- Never print service-role keys, webhook secrets, SMTP credentials, or other environment-variable values in logs or docs.

## Current result
**Not ready for live launch.** Code and automated checks are present; backend provisioning, environment configuration, runtime deployment verification, end-to-end tests, and domain DNS remain gated. The intended next step is one consolidated preview deployment after these prerequisites are resolved, followed by one full test round before any production change.
