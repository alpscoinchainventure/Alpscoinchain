# VantagePay Public Preview and Admin Dashboard Rollout

**Purpose:** Publish a public-facing preview for usability testing, then build the protected admin dashboard. This is a deployment plan, not confirmation that the application is deployed.

## Phase 1 — Public preview (demo only)

The first public URL must be a clearly labelled **VantagePay Demo / Preview**. Use synthetic accounts and fictional transactions only. It must not accept real deposits, imply real funds are held, promise investment returns, or enable withdrawals or money movement.

Before publishing:
- Deploy from a dedicated staging branch/project, not directly from production.
- Confirm the exact public hostname and project owner.
- Review every route, form, static asset, and API endpoint.
- Remove sample secrets and ensure environment variables are configured only in the hosting provider's secret settings.
- Disable or remove any endpoint that can email clients or perform trading actions in demo mode unless explicitly needed and rate-limited.
- Add a visible demo notice and privacy/contact information.
- Verify HTTPS, responsive layouts, error states, logs, and basic monitoring.
- Run the sandbox checklist in `VANTAGEPAY-SANDBOX-TEST-PLAN.md`.
- Keep all account balances and activity synthetic until the authoritative server-side ledger and security controls are implemented.

## Hosting requirements

This repository uses an Express server (`npm start` runs `node server.js`). A static-only host will not run the Express API. Choose a Node-compatible hosting target and configure:
- Build/install command: `npm install`
- Start command: `npm start`
- Node.js runtime compatible with the project dependencies
- A non-production preview environment and HTTPS hostname
- Environment variables only where required; never commit a `.env` file

A custom domain can be attached after the hosting project is connected and DNS ownership is verified. Do not claim a custom domain is live until DNS and HTTPS have been checked.

## Phase 2 — Demo testing

Test with fictional data:
1. Open the public preview on desktop and mobile.
2. Verify the client dashboard, navigation, empty states, and transaction-history layout.
3. Exercise form validation and error handling.
4. Verify that a client cannot access another client's data.
5. Confirm demo actions cannot trigger real provider calls or real financial actions.
6. Review server logs for errors and unexpected sensitive data.
7. Record issues before moving to the admin phase.

## Phase 3 — Protected admin dashboard

Build only after the preview is reviewed. The dashboard must be a protected server-backed application, not a hidden URL or front-end-only password.

Minimum controls:
- Strong authentication, MFA for privileged users, role-based access, and server-side authorization.
- Client/account lookup with minimal necessary personal data.
- Pending manual-credit queue with reason, supporting reference, initiator, independent approver, and audit trail.
- Automatic-return event inbox with signature verification, idempotency, validation results, and reconciliation status.
- Transaction search and filtering, reversal workflow, and export permissions.
- Withdrawal queue with explicit provider status; no manual claim of payment completion without verified provider evidence.
- Append-only audit log, monitoring, rate limits, and alerts.
- Separation between sandbox and production data, keys, and provider endpoints.

## Release gate for real financial activity

Do not enable real customer balances, investment-return posting, or money movement until all of the following are complete:
- Authoritative persistent database and double-entry ledger implemented and reviewed.
- Authentication, authorization, session security, and client-data isolation tested.
- Provider selected and its official documentation, sandbox, and event signatures verified.
- Idempotency, retries, reconciliation, reversal, backup, and incident-response tests pass.
- Applicable licensing, AML/KYC, sanctions, privacy, consumer disclosures, and jurisdictional requirements reviewed by qualified professionals.
- Production credentials stored securely and production deployment explicitly approved.

## Current status

The repository contains planning docs, webhook-validation helper/tests, a starter SQL schema, and CI tests. The helper is not yet wired into the Express runtime, the SQL schema is not applied, and no financial provider is connected. Public preview deployment still requires a connected hosting project and a reviewed staging configuration.
