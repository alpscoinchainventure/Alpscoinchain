# VantagePay ↔ AlpsCoinChain APY integration contract

Status: implementation contract only. This document does not enable payments or credit balances.

## Required flow

1. AlpsCoinChain emits an authoritative event only after the APY funding/approval is final in its own ledger.
2. The sender signs the exact raw HTTP request body with HMAC-SHA256 using a dedicated shared secret and sends:
   - `X-VantagePay-Timestamp`: Unix timestamp in seconds
   - `X-VantagePay-Signature`: hex HMAC-SHA256 of `<timestamp>.<raw-body>`
3. VantagePay validates signature and timestamp, validates the event, maps the external customer reference to exactly one enabled VantagePay account, and records the event idempotently.
4. A separate trusted posting workflow reconciles the source transaction and posts a balanced ledger journal. Receipt alone must never credit a balance.
5. On successful posting, VantagePay updates the derived balance and creates an account-history entry and in-app notification in the same database transaction.

## Event shape

```json
{
  "event_id": "unique-source-event-id",
  "customer_ref": "stable-alpscoinchain-client-reference",
  "reward_type": "apy",
  "currency": "NGN",
  "amount": "25000.00",
  "occurred_at": "2026-10-26T12:00:00.000Z",
  "period_start": "2026-10-01",
  "period_end": "2026-10-26",
  "plan_reference": "optional-plan-reference",
  "source_record_hash": "64-character-lowercase-sha256-hex"
}
```

Amounts are decimal strings, not floating-point values. Currency must be an explicitly supported ISO 4217 code. Event IDs must be unique and stable across retries.

## Posting invariants

- Do not credit on HTTP receipt, email, an unverified browser action, or a client-submitted request.
- Enforce uniqueness for both provider + source event ID and the resulting ledger transaction idempotency key.
- Verify that source currency, amount, customer mapping, status and source record hash match the authoritative AlpsCoinChain record.
- Post balanced debit/credit entries atomically; derive balances from posted ledger entries only.
- Record actor/source, source reference, timestamps and reconciliation outcome for audit.
- A reversal is a separate linked ledger transaction; never delete or silently rewrite a posted entry.
- If verification, mapping, currency, reconciliation or posting fails, keep the event unposted and do not change the customer's balance.
- Use a dedicated service credential and signing secret for the integration. Never put either in browser code or commit them to the repository.

## Current VantagePay behavior and remaining work

The existing `POST /api/vantagepay/webhooks/rewards` route accepts signed reward events into a review/reconciliation table and intentionally does not credit balances. The current schema has APY/source-event structures, but the complete reviewed balanced-ledger posting workflow is not installed by this contract.

Before enabling real APY credits, implement and test the atomic posting procedure, verified customer mapping administration, event reconciliation, ledger balance query, transaction-history display, replay/reversal tests, and audit trail. Then configure the actual AlpsCoinChain sender to this contract and test with a non-production event first.

## Acceptance tests

1. Valid, signed event + enabled customer mapping is stored as `received`, with no balance change.
2. Same event resent is treated as a duplicate, with no second record or credit.
3. Invalid signature, stale timestamp, unknown mapping, unsupported currency, invalid amount, or mismatched source reconciliation is rejected/unposted.
4. Only a verified event can be posted by the trusted posting workflow.
5. Posting is atomic, balanced, idempotent, and creates exactly one visible account-history item and notification.
6. Reversal creates a linked reversal entry and does not erase history.
7. One customer's event cannot affect another customer's account.
