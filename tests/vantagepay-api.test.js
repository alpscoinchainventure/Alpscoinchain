import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTransactionRequest } from '../lib/vantagepay-api.js';

const beneficiary = '123e4567-e89b-42d3-a456-426614174000';

test('validates deposit requests with idempotency key and integer minor units', () => {
  const result = validateTransactionRequest({
    request_type: 'deposit',
    amount_minor_units: '12500',
    currency_code: 'GBP',
    customer_note: 'Salary deposit'
  }, 'deposit-request-0001');
  assert.equal(result.valid, true);
  assert.equal(result.value.amount_minor_units, '12500');
  assert.equal(result.value.request_type, 'deposit');
});

test('withdrawal requests require a beneficiary UUID', () => {
  assert.equal(validateTransactionRequest({
    request_type: 'withdrawal', amount_minor_units: '100', currency_code: 'GBP'
  }, 'withdrawal-0001').valid, false);
  assert.equal(validateTransactionRequest({
    request_type: 'withdrawal', amount_minor_units: '100', currency_code: 'GBP', beneficiary_id: beneficiary
  }, 'withdrawal-0001').valid, true);
});

test('rejects unsafe amounts, currency codes, idempotency keys and notes', () => {
  const base = { request_type: 'deposit', amount_minor_units: '100', currency_code: 'GBP' };
  assert.equal(validateTransactionRequest({...base, amount_minor_units: '1.2'}, 'deposit-request-0001').valid, false);
  assert.equal(validateTransactionRequest({...base, amount_minor_units: '0'}, 'deposit-request-0001').valid, false);
  assert.equal(validateTransactionRequest({...base, currency_code: 'gbp'}, 'deposit-request-0001').valid, false);
  assert.equal(validateTransactionRequest(base, 'bad').valid, false);
  assert.equal(validateTransactionRequest({...base, customer_note: 'x'.repeat(501)}, 'deposit-request-0001').valid, false);
});
