# VantagePay integration — discovery and implementation plan

## Status

Planning scaffold only. This branch does **not** connect to a live financial institution, move funds, or change the production site. No real-money operations should be enabled until the prerequisites below are completed and tested.

## What the current AlpsCoinChain repository does

Review of `index.html`, `script.js`, `server.js`, `package.json`, and `.env.example` found:

- The displayed USDT, ETH, and BTC balances are demo defaults stored in the browser's `localStorage`.
- Deposit/withdrawal requests are also stored in browser `localStorage`; approving a withdrawal only subtracts from that browser's demo balance.
- `POST /api/trade` validates a few fields and sends an email notification. It does not execute or settle a trade.
- The current server has contact/trade email routes, but no authenticated customer API, authoritative investment ledger, withdrawal event feed, payment-provider integration, or reconciliation process.
- Therefore, there is no reliable server-side source of real withdrawal events to connect to VantagePay yet.

## Target flow

1. AlpsCoinChain's trusted backend records a withdrawal as an authoritative, uniquely identified event.
2. A server-to-server signed webhook or authenticated API sends the event to VantagePay.
3. VantagePay verifies the signature, timestamp, event ID, amount, currency/asset, customer mapping, and withdrawal state; duplicate events are idempotently ignored.
4. VantagePay records the event as **pending** and reconciles it against AlpsCoinChain and the regulated payment/banking provider.
5. Only after verified settlement should the customer see cleared funds and request a payout to a verified external bank account.
6. Provider callbacks update payout status. Every state change is auditable and reconcilable.

A displayed balance or email notification must never be treated as proof that funds exist or have settled.

## Required before implementation can process real money

- Confirm the legal entity operating each platform, customer ownership/consent, permitted jurisdictions, and applicable financial-services approvals.
- Choose a licensed bank/payment institution and obtain its official API documentation, sandbox access, and a supported settlement/payout product.
- Define authoritative backend endpoints/events for investment withdrawal creation, approval, cancellation, settlement, and reversal.
- Define a stable customer identifier shared by the two systems without copying unnecessary personal data.
- Build server-side authentication/authorization, a durable database ledger, idempotency, signed webhook verification, replay protection, rate limiting, audit logs, reconciliation, alerts, and operational recovery.
- Define transparent fees, payout timing, complaint/refund handling, and a policy for pending/reversed transfers. Do not introduce undisclosed barriers to customers accessing legitimate funds.
- Test in sandbox, obtain independent security review, and complete operational/legal approval before enabling production payouts.

## Configuration policy

- Never commit API keys, webhook secrets, bank credentials, customer data, seed phrases, or private keys.
- Store provider secrets only in the deployment platform's secret manager/environment configuration.
- Use separate sandbox and production credentials. Production payouts must remain disabled until explicitly approved and verified.

## Next implementation inputs

Provide the official server-side API/webhook specification for AlpsCoinChain and the chosen regulated payment provider's documentation. Share documentation links or sanitized examples only—**do not paste secrets or live customer data**. If no AlpsCoinChain API exists yet, implement one server-side first; browser `localStorage` cannot serve as a financial ledger.
