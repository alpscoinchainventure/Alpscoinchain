import test from 'node:test';
import assert from 'node:assert/strict';
import { isVantagePayEmailVerified } from '../lib/vantagepay-api.js';

test('only an explicitly verified Neon Auth user passes email verification', () => {
  assert.equal(isVantagePayEmailVerified({ id: 'user-1', emailVerified: true }), true);
  assert.equal(isVantagePayEmailVerified({ id: 'user-1', emailVerified: false }), false);
  assert.equal(isVantagePayEmailVerified({ id: 'user-1' }), false);
  assert.equal(isVantagePayEmailVerified(null), false);
  assert.equal(isVantagePayEmailVerified(undefined), false);
});
