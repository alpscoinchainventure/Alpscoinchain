# VantagePay release readiness
Last checked: 2026-10-24
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
- User chose to explore Turso as the alternative database. No Turso account/database connection is available through the current connected tools, and no Turso database has been provisioned.
- Turso is libSQL/SQLite-based, while the current VantagePay data model and API use PostgreSQL/Supabase Auth patterns. Turso cannot be enabled by merely changing a connection string: the schema, database access layer, authentication/session design, and security checks need a deliberate migration and tests.
- Neon is a PostgreSQL-compatible alternative that may reduce database-schema rewrite work, but it is a different provider choice and must not be silently substituted for Turso.
- `vintagebanking.cyou` is purchased, but custom DNS records are not configured and the domain is not approved for launch.

## Required before calling the preview ready
1. Confirm/provision the chosen standalone backend on a no-cost plan; verify plan limits before creating resources.
2. Decide whether to continue with Turso (larger migration) or explicitly switch to a PostgreSQL-compatible provider such as Neon (closer schema fit).
3. Implement and review the chosen backend adapter and authentication/session architecture; never expose database credentials or privileged secrets to browser code.
4. Configure the exact VantagePay environment variables in the dedicated Vercel project only after the provider and architecture are ready. Do not place secrets in Git or logs.
5. Review and adapt the standalone SQL schema for the chosen provider. Apply schema only to the dedicated VantagePay database, never to either existing AlpsCoinChain/Century shared database.
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
**Not ready for live launch.** A Vercel deployment exists, but backend provisioning and selection, secure auth/database integration, environment configuration, direct API verification, end-to-end tests, and domain DNS remain gated. Next step: settle the Turso-versus-PostgreSQL-compatible backend decision, then implement and test that integration before another release attempt.
