# VantagePay standalone backend setup

This is an implementation checklist for a separate VantagePay Supabase project. Do not apply the VantagePay schema to the AlpsCoinChain database. Do not put service-role secrets in HTML, Git, build output, or client-side environment variables.

## Required Vercel environment variables

Set these only on the dedicated VantagePay Vercel project after it exists:

- `VANTAGEPAY_SUPABASE_URL` — URL for the dedicated VantagePay Supabase project.
- `VANTAGEPAY_SUPABASE_PUBLISHABLE_KEY` — public/publishable key for that same project.
- `VANTAGEPAY_SUPABASE_SERVICE_ROLE_KEY` — secret service-role key; server-side only, encrypted in Vercel.
- `VANTAGEPAY_APY_PROVIDER_CODE` — exact source identifier agreed with the APY counterparty.
- `VANTAGEPAY_APY_WEBHOOK_SECRET` — high-entropy secret shared with the APY source; at least 32 characters.
- `VANTAGEPAY_BENEFICIARY_PROVIDER_ADAPTER_URL` and `VANTAGEPAY_BENEFICIARY_PROVIDER_ADAPTER_SECRET` — only after selecting and implementing a reviewed bank-beneficiary verification provider adapter.

Never commit actual values. Configure secrets directly in the Vercel project settings. The current Vercel project is still the existing AlpsCoinChain project; do not add VantagePay secrets to it as a substitute for project separation.

## Database setup

1. Create a dedicated VantagePay Supabase project only after checking the plan and cost.
2. Review `docs/vantagepay-standalone-schema.sql` with a database/security engineer.
3. Apply it only to that dedicated project, then inspect RLS, grants, trigger execution and database advisors.
4. Add the exact VantagePay auth callback URLs to Supabase Auth URL Configuration after a canonical domain is chosen.
5. Run signup, email confirmation, password recovery and two-customer isolation tests before enabling customer access.

## Implemented server API routes

- `GET /api/vantagepay/config` — returns only the standalone project URL and publishable key; returns 503 until configured.
- `GET /api/vantagepay/account` — returns the authenticated customer's own VantagePay account.
- `GET /api/vantagepay/beneficiaries` — returns the authenticated customer's masked beneficiary metadata.
- `POST /api/vantagepay/beneficiaries` — deliberately fails closed until a real, reviewed provider-hosted verification adapter is implemented. Do not accept raw bank credentials.
- `GET /api/vantagepay/transaction-requests` — returns the signed-in customer's own request history.
- `POST /api/vantagepay/transaction-requests` — records an idempotent deposit/withdrawal request for review. It does not move money or confirm settlement.
- `POST /api/vantagepay/webhooks/apy` — verifies an HMAC signature and timestamp, validates the APY event and customer mapping, then records the event as `received` for reconciliation. It does not credit a customer balance.

## APY integration safety

The intended source is AlpsCoinChain Investment Ventures as a separate counterparty, not the VantagePay brand. Agree a signed event contract and customer-reference mapping before connecting it. A webhook is not proof that a return was earned or that funds settled. The source event must be reconciled against authoritative provider records, duplicate events ignored, reversals handled, and every posting recorded in an immutable balanced journal with an audit trail. Only a trusted, authorized reconciliation worker may change an APY source event to verified/posted and create the corresponding ledger journal. No automatic APY credits are active yet.

## Still required before live banking or payment services

- Dedicated Vercel project and dedicated Supabase project, with no shared auth/data.
- Licensed/authorized banking or payment provider and reviewed sandbox credentials.
- Provider-hosted beneficiary verification and payout APIs.
- Deposit instructions/provider rails and reconciliation.
- Atomic ledger posting, immutable posted entries, idempotency, reversals and admin audit workflow.
- Admin dashboard with role checks enforced server-side.
- Security review, backups, monitoring, incident response, legal/compliance review and appropriate authorization for the jurisdictions served.

Until those prerequisites are completed, the site is a development preview and request tracker—not a bank account, deposit-taking service or live payment service.
