import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyVantagePaySignature, validateVantagePayEvent } from '../lib/vantagepay-webhook.js';

const secret = 'test-secret-that-is-long-enough-for-hmac-checks';
const now = 1_800_000_000;
const body = Buffer.from('{"event_id":"evt-1"}');
function signatureFor(timestamp, rawBody = body) {
  return 'sha256=' + createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex');
}

test('accepts a correctly signed recent raw request body', () => {
  const timestamp = String(now);
  assert.equal(verifyVantagePaySignature({
    rawBody: body, timestamp, signature: signatureFor(timestamp), secret, nowSeconds: now
  }), true);
});

test('rejects modified bodies, bad signatures, weak secrets and stale timestamps', () => {
  const timestamp = String(now);
  assert.equal(verifyVantagePaySignature({
    rawBody: Buffer.from('modified'), timestamp, signature: signatureFor(timestamp), secret, nowSeconds: now
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody: body, timestamp, signature: 'sha256=bad', secret, nowSeconds: now
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody: body, timestamp, signature: signatureFor(timestamp), secret: 'short', nowSeconds: now
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody: body, timestamp: String(now - 301), signature: signatureFor(String(now - 301)), secret, nowSeconds: now
  }), false);
});

test('accepts a supported withdrawal event with a positive decimal string', () => {
  const result = validateVantagePayEvent({
    event_id: 'evt-123', type: 'investment.withdrawal.settled',
    withdrawal_ref: 'wd-123', customer_ref: 'customer-123',
    asset: 'USDC', amount: '12.50', occurred_at: '2026-10-24T10:00:00Z'
  });
  assert.equal(result.valid, true);
  assert.equal(result.event.amount, '12.50');
  assert.equal(result.event.occurred_at, '2026-10-24T10:00:00.000Z');
});

test('rejects unsupported events, zero amounts, malformed assets and invalid dates', () => {
  const base = {
    event_id: 'evt-123', type: 'investment.withdrawal.settled',
    withdrawal_ref: 'wd-123', customer_ref: 'customer-123',
    asset: 'USDC', amount: '12.50', occurred_at: '2026-10-24T10:00:00Z'
  };
  assert.equal(validateVantagePayEvent({...base, type: 'account.created'}).valid, false);
  assert.equal(validateVantagePayEvent({...base, amount: '0'}).valid, false);
  assert.equal(validateVantagePayEvent({...base, asset: 'USDC!'}).valid, false);
  assert.equal(validateVantagePayEvent({...base, occurred_at: 'not-a-date'}).valid, false);
  assert.equal(validateVantagePayEvent(null).valid, false);
});
