-- VantagePay integration starter schema (PostgreSQL).
-- Review with a database/security engineer before production use.
-- Never treat a webhook alone as proof of funds: reconcile with the source ledger/provider.

CREATE TABLE IF NOT EXISTS vp_webhook_inbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system TEXT NOT NULL CHECK (source_system = 'alpscoinchain'),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'investment.withdrawal.settled',
    'investment.withdrawal.reversed'
  )),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'processed', 'rejected', 'failed')),
  processed_at TIMESTAMPTZ,
  processing_error_code TEXT,
  UNIQUE (source_system, event_id)
);

CREATE INDEX IF NOT EXISTS vp_webhook_inbox_pending_idx
  ON vp_webhook_inbox (received_at)
  WHERE processing_status IN ('pending', 'failed');

-- Asset scales define what one integer unit means for each asset. Populate and
-- review this registry before accepting any asset; do not infer scale from a code.
CREATE TABLE IF NOT EXISTS vp_asset_definitions (
  asset_code TEXT PRIMARY KEY CHECK (asset_code ~ '^[A-Z0-9]{2,12}
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_reference TEXT NOT NULL UNIQUE,
  customer_ref TEXT NOT NULL,
  asset_code TEXT NOT NULL REFERENCES vp_asset_definitions(asset_code),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'investment_withdrawal_settlement',
    'investment_withdrawal_reversal',
    'customer_payout_pending',
    'customer_payout_settled',
    'customer_payout_failed'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'reversed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vp_ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES vp_ledger_transactions(id),
  account_code TEXT NOT NULL,
  asset_code TEXT NOT NULL REFERENCES vp_asset_definitions(asset_code),
  entry_side TEXT NOT NULL CHECK (entry_side IN ('debit', 'credit')),
  amount_units NUMERIC(36, 0) NOT NULL CHECK (amount_units > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp_ledger_entries_transaction_idx
  ON vp_ledger_entries (transaction_id);

-- Payout requests reference a verified provider beneficiary token, not raw bank
-- credentials. Store only the minimum necessary beneficiary metadata.
CREATE TABLE IF NOT EXISTS vp_payout_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payout_reference TEXT NOT NULL UNIQUE,
  customer_ref TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_payout_id TEXT UNIQUE,
  beneficiary_token TEXT NOT NULL,
  asset_code TEXT NOT NULL REFERENCES vp_asset_definitions(asset_code),
  amount_units NUMERIC(36, 0) NOT NULL CHECK (amount_units > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'settled', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Amounts are stored in integer units (for example, minor units) to avoid
-- floating-point accounting. Convert display amounts only using the reviewed
-- minor_unit_scale for that asset. This schema does not seed or enable assets.
-- Production requirements not covered by DDL alone:
-- * Enforce balanced journal entries before posting (transaction/deferred trigger).
-- * Use database transactions and row locks for balance-affecting operations.
-- * Restrict UPDATE/DELETE on posted journal entries; use reversal entries instead.
-- * Authenticate every customer request and enforce customer ownership server-side.
-- * Verify webhook HMAC + timestamp on raw request bytes; insert inbox event using
--   ON CONFLICT DO NOTHING and process idempotently.
-- * Reconcile settlement against trusted source/provider APIs and bank statements.
-- * Add audit logging, retention, encryption, backup/restore, alerting, and monitoring.
),
  minor_unit_scale SMALLINT NOT NULL CHECK (minor_unit_scale BETWEEN 0 AND 18),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only journal header. Enforce balanced debit/credit totals inside the
-- same database transaction before marking a journal transaction posted.
CREATE TABLE IF NOT EXISTS vp_ledger_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_reference TEXT NOT NULL UNIQUE,
  customer_ref TEXT NOT NULL,
  asset_code TEXT NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{2,12}$'),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'investment_withdrawal_settlement',
    'investment_withdrawal_reversal',
    'customer_payout_pending',
    'customer_payout_settled',
    'customer_payout_failed'
  )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'reversed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vp_ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES vp_ledger_transactions(id),
  account_code TEXT NOT NULL,
  asset_code TEXT NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{2,12}$'),
  entry_side TEXT NOT NULL CHECK (entry_side IN ('debit', 'credit')),
  amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp_ledger_entries_transaction_idx
  ON vp_ledger_entries (transaction_id);

-- Payout requests reference a verified provider beneficiary token, not raw bank
-- credentials. Store only the minimum necessary beneficiary metadata.
CREATE TABLE IF NOT EXISTS vp_payout_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payout_reference TEXT NOT NULL UNIQUE,
  customer_ref TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_payout_id TEXT UNIQUE,
  beneficiary_token TEXT NOT NULL,
  asset_code TEXT NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{2,12}$'),
  amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'settled', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production requirements not covered by DDL alone:
-- * Enforce balanced journal entries before posting (transaction/deferred trigger).
-- * Use database transactions and row locks for balance-affecting operations.
-- * Restrict UPDATE/DELETE on posted journal entries; use reversal entries instead.
-- * Authenticate every customer request and enforce customer ownership server-side.
-- * Verify webhook HMAC + timestamp on raw request bytes; insert inbox event using
--   ON CONFLICT DO NOTHING and process idempotently.
-- * Reconcile settlement against trusted source/provider APIs and bank statements.
-- * Add audit logging, retention, encryption, backup/restore, alerting, and monitoring.
