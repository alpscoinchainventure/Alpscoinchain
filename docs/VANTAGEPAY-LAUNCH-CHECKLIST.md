# VantagePay customer preview launch checklist

Status: standalone VantagePay customer-preview phase; keep all changes on `vantagepay-integration-plan`. Do not merge to the default branch without explicit authorization. VantagePay must not be branded as an AlpsCoinChain website. AlpsCoinChain Investment Ventures is a separate intended investment/APY counterparty, not the VantagePay product brand.

## Scope decisions
- KYC is intentionally deferred. Do not collect or request identity documents in this phase.
- No real deposits, withdrawals, transfers, investment execution, APY crediting, or live balances are enabled.
- VantagePay must have its own brand, domain, authentication configuration, backend/data project, and customer-facing navigation; do not present it as part of the AlpsCoinChain website.
- Any APY/return connection to AlpsCoinChain Investment Ventures must be a distinct, verified, authorized integration with defined source records, reconciliation, idempotency, audit history, and clear customer terms. Never display projected or unverified returns as credited funds.
- Demo balances and preview transactions are fictional. The browser demo is not a ledger.
- Customer dashboard reads only the signed-in customer's profile and ledger rows; validate with two independent test accounts before inviting the public.
- Admin dashboard is the next development phase after customer-facing checks and domain setup.

## Customer-facing checks before attaching a custom domain
- [ ] Test sign-up, email confirmation, sign-in, sign-out, password reset and recovery using disposable test accounts.
- [ ] In Supabase Auth URL Configuration, set the Site URL to the selected canonical VantagePay domain after purchase.
- [ ] Add the exact VantagePay auth callback URL (for example, `https://YOUR-DOMAIN/vantagepay-auth.html`) to the allowed redirect URLs. Confirm signup and recovery emails return to the standalone VantagePay domain, not any other product homepage.
- [ ] Check that the two customer accounts cannot read each other's profiles or activity.
- [ ] Check empty, unavailable, and non-empty account activity states; verify search and CSV export.
- [ ] Check preview plan selection, sample credit, withdrawal-draft validation, reset, activity search, and CSV statement export.
- [ ] Check mobile layout and direct navigation to `/vantagepay`, `/vantagepay/login`, and `/vantagepay/dashboard`.
- [ ] Confirm the browser console has no uncaught errors and the GitHub Actions validation workflow passes.
- [ ] Add the purchased domain to the Vercel project, verify DNS/HTTPS, and repeat auth callback tests on the canonical domain.

## Domain lookup (read-only; availability/prices can change)
- `vantagepay.app`: available at lookup; USD $14.99 for 1 year, renewal listed at USD $15/year.
- `vantagepay.co`: available at lookup; USD $29.99 for 1 year, renewal listed at USD $24.80/year.
- `vantagepay.com`: unavailable at lookup.
- `vantagepay.africa`: unavailable at lookup.
- `vantagepay.ng`: unavailable at lookup.

No domain has been purchased or reserved. Confirm the exact domain and budget before registering.

## New standalone financial-platform foundation (code committed; not yet deployed to a dedicated backend)
- `docs/vantagepay-standalone-schema.sql` defines isolated customer accounts, provider-token beneficiary records, deposit/withdrawal requests, immutable-ledger foundations, APY source-event records, and admin audit records. It is a design migration and has not been applied to any database.
- `lib/vantagepay-apy.js` validates APY source-event envelopes and converts decimal currency values to integer minor units without floating-point arithmetic. It does not authenticate a source, prove a return was earned, or post balances.
- `tests/vantagepay-apy.test.js` covers valid/invalid source events, date/rate checks, and exact minor-unit conversion. CI must confirm the full suite passes.

## Notifications, operations, and external investment returns
- [x] Customer dashboard includes an in-app notification panel and mark-as-read action for request/reward updates (code only; requires the standalone schema to be installed).
- [x] Transaction request creation and status changes create in-app notifications through database triggers.
- [x] Restricted operations console is available at `/vantagepay/admin`; every API call checks enabled admin membership and request status changes require an audit reason.
- [x] Admin status controls cannot mark requests settled or directly edit customer balances; confirmed balances must come from balanced, reconciled ledger entries.
- [x] Signed external reward webhook intake supports APY, bonuses, investment-plan returns, dividends, and other approved reward categories; duplicate source events are ignored and incoming records are not auto-credited.
- [ ] Configure and verify notification delivery provider for email/SMS; current customer notifications are in-app only.
- [ ] Provision named admin users through a trusted reviewed process in the dedicated VantagePay database; never let customers self-assign admin access.
- [ ] Establish a written integration contract and authenticated sandbox with AlpsCoinChain Investment Ventures, including customer-reference mapping, signed events, source reconciliation, reversals, and idempotency.
- [ ] Implement and independently test atomic admin ledger adjustments and verified reward posting before any balances are changed; require reason, audit trail, and appropriate approval controls.
- [ ] Do not apply this schema to the shared AlpsCoinChain database. Dedicated VantagePay backend and environment secrets are still required.

## Before real-money capability
Create a dedicated VantagePay authentication/data project (review any project cost first) and remove shared backend dependencies before launch. Keep VantagePay independently branded. Implement server-side ledger posting with immutable balanced entries, audited admin controls, and a separate verified integration with AlpsCoinChain Investment Ventures for any approved APY credits; add provider reconciliation, idempotent processing, monitoring, backups, legal/compliance review, and independent security review. Do not describe the preview as a bank or as holding customer funds.
