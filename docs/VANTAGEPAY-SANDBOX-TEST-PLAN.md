# VantagePay Sandbox Test Plan

## Current scope

This plan covers the provider-independent development foundation only. It does not enable live deposits, withdrawals, bank transfers, or custody of customer funds. The webhook helper and schema are not yet wired into the application's runtime.

## 1. Run the current automated checks

From the repository root, with a supported Node.js 20+ environment:

```sh
npm ci
npm test
```

Expected result: the Node test runner completes successfully. These tests validate the webhook signature/event helper; they do not prove that the full application or a financial provider integration is production-ready.

## 2. Review before connecting a provider

- [ ] Select a licensed payment/banking partner for the intended jurisdiction.
- [ ] Obtain official sandbox API documentation and test credentials through the provider's secure dashboard.
- [ ] Confirm the provider's webhook signature scheme, event IDs, timestamp rules, retry behavior, and idempotency requirements.
- [ ] Confirm supported currencies, account-name verification, transfer limits, fees, settlement timelines, reversals, and failure codes.
- [ ] Implement authenticated server-side user identity and authorization.
- [ ] Replace browser-only balances as a source of truth with a server-authoritative, append-only ledger.
- [ ] Apply migrations in a disposable test database and review constraints/indexes.
- [ ] Store secrets only in a managed secret store or protected environment configuration; never commit them.
- [ ] Add audit logs, rate limits, alerting, reconciliation, backups, and a documented incident-response process.
- [ ] Complete legal, compliance, privacy, and security review before any real-money pilot.

## 3. Required sandbox scenarios

1. Valid signed event is accepted once.
2. Duplicate event ID is idempotent and does not credit twice.
3. Invalid signature, altered body, stale timestamp, and malformed payload are rejected.
4. Unknown user/account, unsupported asset/currency, and invalid amount are rejected or quarantined without changing balances.
5. Provider timeout and retry do not create duplicate payouts.
6. A payout moves only through documented states; a client cannot mark a payout successful.
7. Failed, reversed, and returned transfers are represented accurately and reconciled.
8. Amounts use integer minor units or exact decimal arithmetic; floating-point arithmetic is not used for money.
9. Every balance-affecting operation has a traceable ledger reference and audit record.
10. Reconciliation identifies mismatches between internal records and provider settlement reports.

## 4. Release gates

Do not enable production money movement until the provider adapter, server-side ledger, identity/authorization controls, reconciliation, operational monitoring, and required approvals have been implemented and tested. Use sandbox-only accounts and synthetic data during development.
