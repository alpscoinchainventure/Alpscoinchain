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
