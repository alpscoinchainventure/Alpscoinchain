import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTransactionRequest } from '../lib/vantagepay-api.js';

const supported = ['GBP','USD','EUR','CAD','AUD','CHF','SGD','JPY','AED','NZD','ZAR','HKD','SEK','DKK','NOK'];

test('VantagePay accepts every configured international sandbox currency', () => {
  for (const currency_code of supported) {
    const result = validateTransactionRequest({
      request_type: 'deposit',
      amount_minor_units: '1250',
      currency_code
    }, 'vp-currency-test-001');
    assert.equal(result.valid, true, currency_code + ' should be accepted');
  }
});

test('VantagePay rejects NGN and unsupported currency codes', () => {
  for (const currency_code of ['NGN','XXX','gbp','']) {
    const result = validateTransactionRequest({
      request_type: 'deposit',
      amount_minor_units: '1250',
      currency_code
    }, 'vp-currency-test-002');
    assert.equal(result.valid, false, currency_code + ' should be rejected');
  }
});

test('VantagePay supports zero-decimal JPY minor-unit representation', () => {
  const result = validateTransactionRequest({
    request_type: 'deposit',
    amount_minor_units: '500',
    currency_code: 'JPY'
  }, 'vp-currency-test-003');
  assert.equal(result.valid, true);
  assert.equal(result.value.amount_minor_units, '500');
});

test('VantagePay rejects invalid amounts and missing idempotency keys', () => {
  for (const amount_minor_units of ['0','-1','1.2','',null]) {
    const result = validateTransactionRequest({
      request_type: 'deposit',
      amount_minor_units,
      currency_code: 'CAD'
    }, 'vp-invalid-amount-001');
    assert.equal(result.valid, false);
  }
  const missingKey = validateTransactionRequest({
    request_type: 'deposit',
    amount_minor_units: '100',
    currency_code: 'CAD'
  }, '');
  assert.equal(missingKey.valid, false);
});

test('VantagePay withdrawals require a UUID beneficiary', () => {
  for (const beneficiary_id of [undefined, '', 'not-a-uuid']) {
    const result = validateTransactionRequest({
      request_type: 'withdrawal',
      amount_minor_units: '100',
      currency_code: 'AUD',
      beneficiary_id
    }, 'vp-withdrawal-test-001');
    assert.equal(result.valid, false);
  }
  const valid = validateTransactionRequest({
    request_type: 'withdrawal',
    amount_minor_units: '100',
    currency_code: 'AUD',
    beneficiary_id: '123e4567-e89b-42d3-a456-426614174000'
  }, 'vp-withdrawal-test-002');
  assert.equal(valid.valid, true);
});

test('VantagePay rejects invalid request types and oversized notes', () => {
  const invalidType = validateTransactionRequest({
    request_type: 'transfer',
    amount_minor_units: '100',
    currency_code: 'USD'
  }, 'vp-invalid-type-001');
  assert.equal(invalidType.valid, false);
  const oversizedNote = validateTransactionRequest({
    request_type: 'deposit',
    amount_minor_units: '100',
    currency_code: 'USD',
    customer_note: 'x'.repeat(501)
  }, 'vp-invalid-note-001');
  assert.equal(oversizedNote.valid, false);
});
