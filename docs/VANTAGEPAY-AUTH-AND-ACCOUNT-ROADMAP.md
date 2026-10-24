# VantagePay authentication and account features

## Current deployment status
The latest known VantagePay branch deployment is READY and its Vercel status check is successful. The preview is a browser-side demonstration, not a live financial account system.

## Authentication must be real, not simulated
Do not treat browser localStorage, a hidden page, or a client-side flag as authentication. Do not store passwords, password hashes, session tokens, or account balances in localStorage. No login/signup flow should claim success until a trusted server-side identity provider validates it.

## Recommended implementation
Use a managed identity provider and durable Postgres database rather than inventing password/session infrastructure inside the demo.

1. **Identity provider:** choose Supabase Auth or Clerk. Configure email/password sign-up and sign-in, verified email, password reset, session refresh/revocation, and optional MFA. The choice must be made before wiring production UI.
2. **Database:** use managed PostgreSQL. Keep user profile metadata separate from the authoritative account ledger. Apply least-privilege row-level access controls.
3. **Server-side authorization:** verify each session on the server for every protected endpoint. Enforce ownership checks; never trust a submitted customer ID or role.
4. **Account features:** profile, account overview, activity/statement, notification preferences, security settings, session logout, password reset, and support/contact flow.
5. **Ledger and money movement:** keep balances and journal entries server-side, use integer minor units, enforce balanced entries and idempotency, and record immutable audit events. No payout/deposit/trade is real until a licensed provider's sandbox integration and reconciliation are implemented and reviewed.
6. **Operational controls:** rate-limit login and recovery endpoints, use CSRF protection where applicable, secure HttpOnly/Secure/SameSite cookies, security headers, generic login errors, abuse monitoring, and secrets stored only in Vercel environment settings.
7. **Verification:** automated tests for signup, duplicate email, invalid credentials, email verification, recovery, session expiry/revocation, authorization boundaries, CSRF/rate limits, and ledger invariants; then deploy a preview and manually verify the flows.

## Configuration required before implementation can be live
- Select the identity provider (Supabase Auth or Clerk).
- Create its project and configure the Vercel **Preview** environment with the required public project URL/key and server-side secrets, following that provider's official setup instructions.
- Provision a managed PostgreSQL database and set its server-only connection string in Vercel. Never commit credentials.
- Confirm the legal operator, privacy notice, retention policy, and support contact before collecting real customer information.

## Release gates
- Until the provider/database are configured and end-to-end tests pass, the UI must say **preview/demo** and must not accept real customer credentials or identity documents.
- Keep real deposits, withdrawals, transfers, trading, and customer funds disabled.
- Do not merge the draft VantagePay PR or change production behavior without explicit approval.

## Feature acceptance checklist
- [ ] Sign up, email verification, sign in, sign out, password reset
- [ ] Optional MFA and session/device management
- [ ] Server-enforced protected routes and customer ownership
- [ ] Profile and preferences
- [ ] Durable transaction history and CSV statements from server records
- [ ] Server-side journal ledger, idempotency, audit trail, reconciliation
- [ ] Provider sandbox for deposits/payouts and verified settlement events
- [ ] Security, privacy, accessibility, mobile, and end-to-end testing
