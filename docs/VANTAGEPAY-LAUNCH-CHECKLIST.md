# VantagePay customer preview launch checklist

Status: customer-preview phase; keep all changes on `vantagepay-integration-plan`. Do not merge to the default branch without explicit authorization.

## Scope decisions
- KYC is intentionally deferred. Do not collect or request identity documents in this phase.
- No real deposits, withdrawals, transfers, investment execution, APY crediting, or live balances are enabled.
- Demo balances and preview transactions are fictional. The browser demo is not a ledger.
- Customer dashboard reads only the signed-in customer's profile and ledger rows; validate with two independent test accounts before inviting the public.
- Admin dashboard is the next development phase after customer-facing checks and domain setup.

## Customer-facing checks before attaching a custom domain
- [ ] Test sign-up, email confirmation, sign-in, sign-out, password reset and recovery using disposable test accounts.
- [ ] In Supabase Auth URL Configuration, set the Site URL to the selected canonical VantagePay domain after purchase.
- [ ] Add the exact VantagePay auth callback URL (for example, `https://YOUR-DOMAIN/vantagepay-auth.html`) to the allowed redirect URLs. Confirm signup and recovery emails return to VantagePay, not the AlpsCoinChain homepage.
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

## Before real-money capability
Separate VantagePay authentication/data into its own Supabase project (review any project cost first), implement server-side ledger posting with immutable balanced entries, audited admin controls, provider integration and reconciliation, idempotent payment processing, incident monitoring, backups, legal/compliance review, and an independent security review. Do not describe the preview as a bank or as holding customer funds.
