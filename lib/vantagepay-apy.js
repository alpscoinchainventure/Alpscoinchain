/**
 * VantagePay APY event validation primitives.
 *
 * These helpers validate an incoming proposed event; they do NOT authenticate
 * the source, prove returns were earned, or post a customer balance. A trusted
 * server must verify the provider signature, reconcile the source record, map
 * the customer reference, enforce idempotency, and post an atomic ledger journal.
 */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const SUPPORTED = new Set(['investment.apy.verified', 'investment.apy.reversed']);

export function validateApySourceEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, reason: 'APY event must be an object.' };
  }
  const required = ['event_id', 'type', 'customer_ref', 'currency', 'amount', 'occurred_at', 'period_start', 'period_end'];
  for (const key of required) {
    if (typeof input[key] !== 'string' || input[key].trim() === '') {
      return { valid: false, reason: `Missing or invalid ${key}.` };
    }
  }
  if (!IDENTIFIER.test(input.event_id) || !IDENTIFIER.test(input.customer_ref)) {
    return { valid: false, reason: 'Event and customer references must be valid identifiers.' };
  }
  if (!SUPPORTED.has(input.type)) {
    return { valid: false, reason: 'Unsupported APY event type.' };
  }
  if (!CURRENCY.test(input.currency)) {
    return { valid: false, reason: 'Currency must be a three-letter uppercase code.' };
  }
  if (!DECIMAL.test(input.amount) || !/[1-9]/.test(input.amount)) {
    return { valid: false, reason: 'APY amount must be a positive decimal string.' };
  }
  const occurred = Date.parse(input.occurred_at);
  const start = Date.parse(input.period_start);
  const end = Date.parse(input.period_end);
  if (![occurred, start, end].every(Number.isFinite)) {
    return { valid: false, reason: 'Event timestamp and APY period dates must be valid.' };
  }
  if (input.period_start.slice(0, 10) > input.period_end.slice(0, 10)) {
    return { valid: false, reason: 'APY period start cannot be after its end.' };
  }
  if (input.rate_basis_points !== undefined &&
      (!Number.isSafeInteger(input.rate_basis_points) || input.rate_basis_points < 0 || input.rate_basis_points > 100000)) {
    return { valid: false, reason: 'rate_basis_points must be an integer from 0 to 100000.' };
  }
  if (typeof input.source_record_hash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(input.source_record_hash)) {
    return { valid: false, reason: 'A SHA-256 source record hash is required.' };
  }
  return {
    valid: true,
    event: Object.freeze({
      event_id: input.event_id,
      type: input.type,
      customer_ref: input.customer_ref,
      currency: input.currency,
      amount: input.amount,
      occurred_at: new Date(occurred).toISOString(),
      period_start: input.period_start.slice(0, 10),
      period_end: input.period_end.slice(0, 10),
      ...(input.rate_basis_points === undefined ? {} : { rate_basis_points: input.rate_basis_points }),
      source_record_hash: input.source_record_hash.toLowerCase()
    })
  };
}

/** Convert decimal currency amount to integer minor units without floating point. */
export function decimalToMinorUnits(amount, scale) {
  if (typeof amount !== 'string' || !DECIMAL.test(amount)) {
    throw new TypeError('Amount must be a non-negative decimal string.');
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError('Scale must be an integer from 0 to 18.');
  }
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > scale) {
    throw new RangeError('Amount has more fractional digits than the currency scale permits.');
  }
  const units = BigInt(whole) * (10n ** BigInt(scale)) +
    BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  if (units <= 0n) throw new RangeError('Amount must be greater than zero.');
  return units.toString();
}
