# VantagePay server-to-server API contract (proposal)

**Status: proposed interface, not deployed or implemented.** Names and semantics must be agreed by both system owners before coding against them. Never use browser localStorage or a client-supplied balance as a source of funds.

## 1. AlpsCoinChain → VantagePay: settled withdrawal event

Suggested receiver: `POST /api/integrations/alpscoinchain/events`

Required transport controls:
- HTTPS only.
- Preserve the exact raw request bytes for signature verification.
- Sign `<unix_timestamp>.<raw_body>` with HMAC-SHA256 using a secret shared through a secret manager; send `X-AC-Timestamp` and `X-AC-Signature: sha256=<hex>`.
- Reject stale timestamps (default maximum skew 300 seconds), invalid signatures, oversized bodies, and unknown event types.
- Persist the event ID with a unique constraint before acknowledging it. Duplicate event IDs must not create duplicate ledger entries.
- Return a generic 2xx only after durable inbox persistence; process asynchronously and expose no sensitive account details in errors.

Example event (synthetic data only):

```json
{
  "event_id": "evt_sandbox_0001",
  "type": "investment.withdrawal.settled",
  "withdrawal_ref": "wd_sandbox_0001",
  "customer_ref": "cust_sandbox_0001",
  "asset": "NGN",
  "amount": "25000.00",
  "occurred_at": "2026-10-24T12:00:00.000Z"
}
```

Amounts are decimal strings, never floating-point numbers. The sender must emit this event only after its authoritative ledger confirms settlement. The receiver must independently reconcile the event with a trusted AlpsCoinChain API/ledger before crediting a customer-facing available balance.

Supported event types in the current validation helper:
- `investment.withdrawal.settled`
- `investment.withdrawal.reversed`

A reversal must reference the original withdrawal and create compensating ledger entries; never delete or rewrite posted financial history. Production contract should include an explicit original-event reference before reversal handling is implemented.

## 2. VantagePay → payment provider: customer payout

Do not implement until a licensed provider, product, sandbox, and API version have been selected.

Suggested internal flow:
1. Authenticated customer submits a payout request with an idempotency key and a verified beneficiary token.
2. Server checks account ownership, available settled balance, asset/currency support, limits, compliance flags, fees, and step-up authentication requirements.
3. In one database transaction, reserve the funds and create the payout request; reject reused idempotency keys with different request content.
4. Submit to the provider using a stable merchant reference; do not blindly retry an ambiguous timeout without querying the provider first.
5. Update status only from authenticated provider callbacks or server-to-server reconciliation.
6. Release a reservation on a confirmed failure; post settlement only on confirmed success. Keep immutable audit history.

Suggested state machine:
- `pending_review → reserved → submitted → settled`
- `pending_review → rejected`
- `reserved/submitted → failed` only after failure is confirmed; release reservation exactly once
- `settled → reversed` only through a documented compensating entry, never by deleting history

## 3. Minimum acceptance tests before sandbox sign-off

- Valid signature succeeds; altered body, bad signature, short secret, malformed/stale/future timestamp fail.
- Duplicate event IDs cannot create duplicate credits, including concurrent delivery.
- Wrong customer mapping, unsupported asset/currency, amount mismatch, reversal without original event, and unknown event types are quarantined without credit.
- Ledger posting is atomic and balanced; insufficient available balance cannot be paid out.
- Replayed payout idempotency keys cannot cause a second transfer.
- Provider timeout/unknown outcome is reconciled before retry.
- Customer A cannot read or spend customer B's balance or beneficiary.
- Audit records cover each state transition and operator action without storing secrets.
- Backup/restore, alerting, incident response, and reconciliation have been exercised.

## 4. Decisions needed before provider adapter work

Record the official provider name, product/API version, supported currencies and settlement rails, sandbox docs, webhook signature scheme, payout idempotency semantics, and settlement/reversal lifecycle. Share public documentation links or sanitized examples only; never add live keys or customer data to Git.
