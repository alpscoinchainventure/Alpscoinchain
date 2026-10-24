# VantagePay pre-launch release gate

This checklist distinguishes the current interface preview from a production account and ledger service. Passing the preview UI review does **not** authorize real-money use.

## Current preview scope
- [x] Responsive interface with clearly fictional sample balances and transactions.
- [x] Downloadable CSV generated locally in the browser from the sample table.
- [x] Visible notice that no account, deposit, withdrawal, investment, or return is real.
- [x] Preview route is intended for product review, not client onboarding.
- [ ] Production client authentication or verified customer accounts.
- [ ] Authoritative server-side ledger or real account balances.
- [ ] Payment provider / bank / custody integration.
- [ ] Live deposits, withdrawals, or investment execution.

## Release gates before any real client funds or financial instructions
1. **Legal and business authorization**
   - Confirm the entity's authority to offer each proposed service in every target jurisdiction.
   - Obtain legal/compliance approval for product terms, disclosures, advertising, fees, risk statements, complaints, privacy, AML/KYC, sanctions, and record retention.
   - Do not market the preview as a bank, regulated pension, insured deposit, or guaranteed investment.
2. **Identity and access**
   - Use a supported authentication provider with secure server-side sessions, verified email, recovery controls, MFA for privileged roles, and rate limiting.
   - Enforce authorization on the server for every account and admin operation; never trust client-supplied user IDs, roles, balances, or statuses.
   - Keep secrets in managed environment variables; never commit credentials or request them in chat.
3. **Ledger correctness**
   - Apply and review the PostgreSQL schema in a non-production environment first.
   - Use integer minor units or a fixed-precision decimal strategy; never use floating-point arithmetic for money.
   - Require balanced double-entry postings, immutable posted entries, atomic database transactions, unique idempotency keys, and auditable reversals rather than silent edits.
   - Derive balances from authoritative ledger entries, not browser storage or user-submitted values.
4. **Provider integration**
   - Obtain official provider API/webhook documentation and sandbox credentials through the provider's secure dashboard.
   - Verify signed webhook requests against the exact raw request body; enforce timestamp tolerance, event IDs, idempotency, replay protection, and event ordering/reconciliation.
   - Keep payout requests in explicit states; mark a payout completed only after trusted provider confirmation and reconciliation.
   - Never treat screenshots, emails, or client-side callbacks as proof of payment.
5. **Admin and operations**
   - Require least-privilege roles, MFA, audit logs, reason codes, approval thresholds, and dual control for sensitive credits or payouts.
   - Establish reconciliation, exception handling, incident response, backups, restore tests, monitoring, and support escalation.
   - Publish clear withdrawal availability, processing times, fees, holds, limits, and complaint routes before accepting funds.
6. **Testing and launch**
   - Run unit/integration tests and dependency/security checks in CI.
   - Test duplicate, delayed, out-of-order, malformed, and forged webhooks; partial failures; concurrent withdrawals; insufficient funds; reversals; and database rollback.
   - Complete independent security review and a documented sandbox sign-off.
   - Start with a controlled pilot only after all required legal, provider, security, and operational approvals are recorded.

## Safe interim policy
Until the release gates are complete, keep VantagePay in demo/preview mode. Do not enable real deposits, withdrawals, investment execution, manual balance credits, or claims that client funds are held. Keep the public demo disclaimer visible and use fictional records only.
