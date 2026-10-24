import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyVantagePaySignature, validateVantagePayEvent } from '../lib/vantagepay-webhook.js';

const secret = 'test-only-secret-that-is-at-least-32-characters';
const nowSeconds = 1_800_000_000;
const timestamp = String(nowSeconds);
const rawBody = Buffer.from(JSON.stringify({
  event_id: 'evt_001',
  type: 'investment.withdrawal.settled',
  withdrawal_ref: 'wd_001',
  customer_ref: 'cust_001',
  asset: 'USDT',
  amount: '125.50',
  occurred_at: '2026-10-24T12:00:00.000Z'
}));

function signatureFor(body = rawBody, ts = timestamp) {
  return 'sha256=' + createHmac('sha256', secret)
    .update(ts, 'utf8').update('.', 'utf8').update(body).digest('hex');
}

test('accepts a valid fresh HMAC signature', () => {
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp, signature: signatureFor(), secret, nowSeconds
  }), true);
});

test('rejects altered body, stale timestamp, and weak secret', () => {
  assert.equal(verifyVantagePaySignature({
    rawBody: Buffer.from('tampered'), timestamp, signature: signatureFor(), secret, nowSeconds
  }), false);
  const stale = String(nowSeconds - 301);
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp: stale, signature: signatureFor(rawBody, stale), secret, nowSeconds
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp, signature: signatureFor(), secret: 'short', nowSeconds
  }), false);
});

test('accepts a well-formed settlement event with decimal-string amount', () => {
  const result = validateVantagePayEvent(JSON.parse(rawBody.toString('utf8')));
  assert.equal(result.valid, true);
  assert.equal(result.event.amount, '125.50');
});

test('rejects invalid amounts, event types, and missing IDs', () => {
  const event = JSON.parse(rawBody.toString('utf8'));
  assert.equal(validateVantagePayEvent({ ...event, amount: '1e6' }).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, amount: '-5' }).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, type: 'withdrawal.approved' }).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, event_id: '' }).valid, false);
});

test('rejects malformed signature headers, non-Buffer bodies, and out-of-window future timestamps', () => {
  assert.equal(verifyVantagePaySignature({
    rawBody: rawBody.toString('utf8'), timestamp, signature: signatureFor(), secret, nowSeconds
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp, signature: 'sha256=not-hex', secret, nowSeconds
  }), false);
  const future = String(nowSeconds + 301);
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp: future, signature: signatureFor(rawBody, future), secret, nowSeconds
  }), false);
  assert.equal(verifyVantagePaySignature({
    rawBody, timestamp: 'not-a-timestamp', signature: signatureFor(), secret, nowSeconds
  }), false);
});

test('rejects arrays, invalid dates, zero amounts, and malformed asset codes', () => {
  const event = JSON.parse(rawBody.toString('utf8'));
  assert.equal(validateVantagePayEvent([]).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, occurred_at: 'not-a-date' }).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, amount: '0' }).valid, false);
  assert.equal(validateVantagePayEvent({ ...event, asset: 'usdt!' }).valid, false);
});
