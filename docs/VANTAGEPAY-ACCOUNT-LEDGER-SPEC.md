# VantagePay Account and Ledger Specification

**Status:** Design specification for review; not a live banking or money-movement implementation.

## 1. Operating model: both manual and automatic credits

VantagePay is intended to be an international, private-banking-style account and transaction-history experience for AlpsCoinChain clients. It should support two controlled ways to record eligible credits:

1. **Admin-managed credit:** an authorized administrator initiates a credit with a reason and supporting reference. A second authorized reviewer should approve it before posting where operationally feasible. The initiating administrator must not approve their own entry.
2. **Verified automatic credit:** an authenticated, signed event from an approved AlpsCoinChain investment system requests a credit. The receiving service verifies the signature, timestamp, schema, source authorization, and idempotency key before posting. An unverified event must never change a balance.

Both flows must use the same ledger posting service. The admin interface must not directly edit a displayed balance.

## 2. Ledger invariants

- The server-side ledger is authoritative. Browser local storage is never authoritative for money or investment balances.
- Use a double-entry ledger: each posted journal balances to zero within a single currency.
- Store amounts as integer minor units (for example, cents) or an exact decimal type. Never use binary floating-point for financial calculations.
- A journal and all its entries must commit atomically in one database transaction.
- Each account is denominated in one currency. A USD account and an EUR account are distinct; never silently mix currencies.
- A displayed available balance is calculated from posted entries and applicable holds, not accepted from the client.
- Posted entries are immutable. Correct mistakes with a linked compensating/reversal journal; never silently edit or delete posted financial history.
- Pending, rejected, failed, reversed, and posted states must be distinct and visible where appropriate.
- Idempotency keys must prevent retries or duplicate webhook deliveries from creating duplicate credits.
- Every privileged action must produce an append-only audit record.

## 3. Suggested account and transaction fields

### Account
- Stable internal account ID and stable client ID
- Account currency (ISO 4217 where fiat is supported)
- Status: pending, active, restricted, or closed
- Created/updated timestamps
- Any provider account reference stored separately and securely

### Journal / transaction
- Stable transaction and journal IDs
- Account/client reference
- Type: investment return, admin credit, deposit, withdrawal, fee, reversal, adjustment, or transfer
- Amount in exact minor units and currency
- Status and human-readable description
- Source: admin action or named, approved event source
- External reference and idempotency key
- Created, approved, posted, and reversed timestamps as applicable
- Initiator and approver identities for privileged manual operations
- Reversal link where applicable

Do not expose internal security metadata, sensitive provider data, or other clients' records in client history.

## 4. Admin-managed credits

1. Authenticate the administrator with strong authentication and role-based access control.
2. Select a client account, currency, amount, reason, and supporting reference.
3. Validate account status, currency, permitted amount, and any limits.
4. Create a pending credit request and an audit event.
5. Require independent approval according to the configured control policy.
6. Post balanced ledger entries atomically and mark the transaction posted.
7. Notify the client and show the transaction in history only with a truthful status.
8. If correcting a posted credit, create a separately authorized compensating entry.

Never accept a client ID, role, approval flag, balance, or amount as trusted merely because it came from a browser request. Enforce all authorization and validation on the server.

## 5. Verified automatic credits

1. Accept events only from explicitly configured source systems over TLS.
2. Verify the HMAC/signature against the exact raw request body, validate timestamp freshness, and compare signatures in constant time.
3. Validate schema, event type, source identity, account mapping, currency, amount, and event status.
4. Persist the event in a durable inbox with a unique provider/event ID or idempotency key.
5. Reject or quarantine duplicates, stale events, invalid signatures, unknown accounts, unsupported currencies, and inconsistent amounts.
6. Apply the ledger posting and mark the inbox event processed in one transaction, or use a recoverable transactional-outbox/inbox design that guarantees eventual consistency.
7. Record processing results and alert operators to repeated failures or reconciliation differences.
8. Reconcile the credited amount to an authoritative investment-return record. A signed message alone does not prove that the investment return is valid or payable.

An event should describe a finalized, approved return—not merely a projected APY, estimate, or front-end calculation. APY displays and actual posted earnings must be clearly distinguished.

## 6. Client experience

Clients should be able to:
- See their accounts, currency, current ledger-derived balance, and relevant pending holds.
- Review paginated transaction history with date, type, amount, currency, status, and reference.
- Distinguish projected returns from finalized and posted credits.
- View clear withdrawal eligibility, fees, limits, and expected processing states before submitting a request.
- Receive notices for posted credits, reversals, restrictions, and payout status changes.
- Access their own data only, enforced server-side on every request.

Do not describe an internal ledger credit as a bank deposit, insured deposit, or settled payment unless that is factually true for the licensed provider and product.

## 7. Withdrawals and external provider integration

A withdrawal request is not a completed payout. Use explicit states such as requested, under_review, approved, submitted, processing, paid, failed, cancelled, and reversed. Only the provider's verified status and reconciliation should determine a completed payout.

Before enabling external money movement, select a licensed provider that supports the intended business model, jurisdictions, customer residency, currencies, and settlement corridors. Obtain and review official API documentation, sandbox access, webhooks, reconciliation files, fees, limits, and failure semantics. Keep provider credentials in a managed server-side secret store; never commit secrets or expose them to browsers.

## 8. Security, privacy, and operational controls

- Use authenticated sessions, least-privilege roles, MFA for administrators, CSRF protection where applicable, rate limiting, and secure session management.
- Enforce tenant/client ownership in every server-side query.
- Encrypt traffic and sensitive data in transit and at rest; minimize stored personal and banking data.
- Keep secrets out of source control, logs, error messages, and client responses.
- Use append-only audit records for credits, approvals, role changes, account restrictions, payout decisions, and reversals.
- Add monitoring, alerting, backups, tested recovery, and daily reconciliation procedures.
- Define retention, privacy, complaints, dispute, sanctions screening, AML/KYC, consumer disclosure, and regulatory obligations with qualified professionals for every operating jurisdiction.

## 9. Minimum acceptance tests

1. An unauthorized user cannot create or approve a credit.
2. An administrator cannot approve their own manual credit where dual control is required.
3. A credit request with a missing reason, invalid currency, non-positive amount, or inactive account is rejected.
4. Replaying the same event does not change the balance a second time.
5. Invalid signatures, stale timestamps, malformed payloads, and unknown sources cannot post entries.
6. A database failure leaves no partial journal or mismatched balance.
7. Journal entries balance to zero for each currency.
8. A reversal preserves the original transaction and links the compensating journal.
9. One client cannot read or mutate another client's accounts or transactions.
10. A withdrawal is never shown as paid solely because it was requested or submitted.
11. Projected APY is not posted as earnings without a finalized, authoritative return event.
12. Reconciliation detects missing, duplicated, delayed, or amount-mismatched provider events.

## 10. Implementation boundary

The repository currently contains integration planning materials and helper/test foundations. This document does not mean a production ledger, authentication/authorization layer, provider connection, compliance program, or real payout rail has been deployed. Those components must be implemented, tested, reviewed, and configured before any real funds or customer balances are affected.
