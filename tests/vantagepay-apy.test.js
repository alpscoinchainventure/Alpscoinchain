import test from 'node:test';
import assert from 'node:assert/strict';
import { validateApySourceEvent, decimalToMinorUnits } from '../lib/vantagepay-apy.js';

const good = {
  event_id: 'apy-event-001',
  type: 'investment.apy.verified',
  customer_ref: 'customer-001',
  currency: 'GBP',
  amount: '123.45',
  occurred_at: '2026-10-24T12:00:00.000Z',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  rate_basis_points: 425,
  source_record_hash: 'a'.repeat(64)
};

test('accepts a well-formed verified APY source event without claiming it is posted', () => {
  const result = validateApySourceEvent(good);
  assert.equal(result.valid, true);
  assert.equal(result.event.amount, '123.45');
  assert.equal(result.event.rate_basis_points, 425);
});

test('rejects unsupported, unverified, or malformed event types and references', () => {
  assert.equal(validateApySourceEvent({...good, type: 'investment.apy.projected'}).valid, false);
  assert.equal(validateApySourceEvent({...good, customer_ref: 'bad customer'}).valid, false);
  assert.equal(validateApySourceEvent({...good, source_record_hash: 'not-a-hash'}).valid, false);
  assert.equal(validateApySourceEvent({...good, currency: 'gbp'}).valid, false);
});

test('rejects zero, negative, floating-point and invalid decimal amounts', () => {
  for (const amount of ['0', '-1', '1e4', '1.234', '01.00', '']) {
    assert.equal(validateApySourceEvent({...good, amount}).valid, false, amount);
  }
});

test('rejects invalid periods and rates', () => {
  assert.equal(validateApySourceEvent({...good, period_start: '2026-11-01', period_end: '2026-10-01'}).valid, false);
  assert.equal(validateApySourceEvent({...good, rate_basis_points: -1}).valid, false);
  assert.equal(validateApySourceEvent({...good, occurred_at: 'not-a-date'}).valid, false);
});

test('converts decimal amounts to minor units exactly', () => {
  assert.equal(decimalToMinorUnits('123.45', 2), '12345');
  assert.equal(decimalToMinorUnits('1', 2), '100');
  assert.equal(decimalToMinorUnits('0.000001', 6), '1');
  assert.throws(() => decimalToMinorUnits('1.001', 2), RangeError);
  assert.throws(() => decimalToMinorUnits('0', 2), RangeError);
});
