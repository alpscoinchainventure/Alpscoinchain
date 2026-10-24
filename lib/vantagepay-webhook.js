import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_SECONDS = 300;
const SUPPORTED_EVENTS = new Set([
  'investment.withdrawal.settled',
  'investment.withdrawal.reversed'
]);

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * Signature format: sha256=<hex HMAC of "<timestamp>.<raw request body>">.
 * The sender must sign the exact raw UTF-8 request body, not re-serialized JSON.
 */
export function verifyVantagePaySignature({
  rawBody,
  timestamp,
  signature,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxClockSkewSeconds = MAX_CLOCK_SKEW_SECONDS
}) {
  if (!Buffer.isBuffer(rawBody) || typeof timestamp !== 'string' ||
      typeof signature !== 'string' || typeof secret !== 'string' || secret.length < 32) {
    return false;
  }

  if (!/^\d{10}$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > maxClockSkewSeconds) {
    return false;
  }

  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) return false;

  const expected = createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(match[1], 'hex');

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Validate the minimum event envelope before it reaches a persistent inbox.
 * This does not prove settlement; that must be reconciled server-to-server.
 */
export function validateVantagePayEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, reason: 'Event must be a JSON object.' };
  }

  const requiredStrings = ['event_id', 'type', 'withdrawal_ref', 'customer_ref', 'asset', 'amount', 'occurred_at'];
  for (const key of requiredStrings) {
    if (typeof event[key] !== 'string' || event[key].trim() === '') {
      return { valid: false, reason: `Missing or invalid ${key}.` };
    }
  }

  if (event.event_id.length > 200 || event.withdrawal_ref.length > 200 ||
      event.customer_ref.length > 200) {
    return { valid: false, reason: 'Identifier is too long.' };
  }

  if (!SUPPORTED_EVENTS.has(event.type)) {
    return { valid: false, reason: 'Unsupported event type.' };
  }

  // Decimal string only: avoid binary floating-point for money/asset quantities.
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(event.amount) ||
      !/[1-9]/.test(event.amount)) {
    return { valid: false, reason: 'Amount must be a positive decimal string.' };
  }

  if (!/^[A-Z0-9]{2,12}$/.test(event.asset)) {
    return { valid: false, reason: 'Asset code is invalid.' };
  }

  if (Number.isNaN(Date.parse(event.occurred_at))) {
    return { valid: false, reason: 'occurred_at must be a valid date.' };
  }

  return { valid: true, event: {
    event_id: event.event_id,
    type: event.type,
    withdrawal_ref: event.withdrawal_ref,
    customer_ref: event.customer_ref,
    asset: event.asset,
    amount: event.amount,
    occurred_at: new Date(event.occurred_at).toISOString()
  } };
}
