import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../db/migrations/20261028_vantagepay_admin_balance_adjustment_hardening.sql', import.meta.url),
  'utf8'
);

test('VantagePay balance adjustment migration fails closed for customer credits', () => {
  assert.match(migration, /IF p_side='credit' THEN[\s\S]*?credit_source_not_configured/);
});

test('VantagePay balance adjustment migration prevents negative customer ledger balances', () => {
  assert.match(migration, /SELECT coalesce\(sum\([\s\S]*?INTO v_customer_balance/);
  assert.match(migration, /v_customer_balance < p_amount_units[\s\S]*?insufficient_customer_balance/);
});

test('VantagePay balance adjustment retains admin authorization and audit trail', () => {
  assert.match(migration, /FROM public\.vp_admin_memberships m[\s\S]*?m\.enabled=true/);
  assert.match(migration, /INSERT INTO public\.vp_admin_audit_log/);
});

test('VantagePay balance adjustment retains idempotency and paired ledger balancing', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /external_reference_already_used_or_payload_mismatch/);
  assert.match(migration, /ledger_not_balanced/);
  assert.match(migration, /'admin_adjustment_control'/);
});

test('VantagePay adjustment is not represented as an external funds transfer', () => {
  assert.match(migration, /'funds_transfer_executed',false/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.vp_admin_post_balance_adjustment[\s\S]*?GRANT EXECUTE ON FUNCTION public\.vp_admin_post_balance_adjustment/);
});
test('VantagePay balance adjustment rejects a null side before any ledger operation', () => {
  assert.match(migration, /p_asset_code IS NULL OR p_side IS NULL OR p_side NOT IN \('credit','debit'\)/);
});

test('VantagePay duplicate retries only succeed when the prior transaction has exactly two balanced entries', () => {
  assert.match(migration, /SELECT count\(\*\),[\s\S]*?INTO v_existing_entry_count, v_existing_net/);
  assert.match(migration, /v_existing_entry_count=2[\s\S]*?v_existing_net=0/);
});
