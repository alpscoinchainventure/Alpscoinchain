# VantagePay journal validation primitives

The code in `lib/vantagepay-ledger.js` is a small, dependency-free validation foundation for journal entries. It is deliberately **not connected to HTTP routes, a database, client accounts, or money movement**.

## Rules enforced by the helper
- Every journal has a reference, customer reference, and uppercase asset code.
- A journal contains 2–100 entries.
- Amounts are positive integer-unit strings, never JavaScript floating-point values. The helper does not convert user-entered major-unit amounts into minor units; a reviewed asset-scale registry and explicit conversion/rounding policy are required.
- Every entry in one journal uses the same asset.
- Database storage should use integer units (such as minor units), with a reviewed asset-scale registry; do not store ledger amounts as floating-point values or assume every asset has two decimal places.
- Debit and credit totals must match exactly using `BigInt`.
- Duplicate account/side rows are rejected so callers must aggregate them explicitly.
- The result is frozen to discourage accidental mutation in the caller.

## Important accounting note
This validator does not define the normal balance convention for every account type. The balance projection helper uses a simple debit-positive convention for the requested account; production account classes must define and review their normal balance rules before presenting customer balances.

## Not production-ready by itself
This module does not provide persistence, unique-reference enforcement, authentication, authorization, transaction isolation, concurrency control, audit logging, immutable database constraints, reversal workflows, provider reconciliation, or regulatory approval. Do not use it to accept deposits, authorize payouts, credit customer accounts, or represent that funds exist. Production posting must validate and insert the journal atomically in a trusted database transaction, enforce idempotency at the database level, and be independently reviewed and tested.


## Database alignment note

The starter PostgreSQL schema stores journal and payout amounts as `NUMERIC(36,0)` integer units and includes an asset-definition registry for the scale used to format those units. Asset definitions must be explicitly reviewed and enabled before use. The schema still requires production posting logic, balanced-journal enforcement, and transaction/locking controls; it is not a migration to run against a live money system without review.
