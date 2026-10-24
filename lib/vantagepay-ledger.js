/**
 * VantagePay journal validation primitives.
 *
 * This module validates proposed journal transactions only. It does not persist
 * entries, authenticate callers, lock balances, or authorize money movement.
 * Production posting must happen atomically in a trusted database transaction.
 */
const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const INTEGER_UNITS_PATTERN = /^[1-9]\d{0,35}$/;
const SIDES = new Set(['debit', 'credit']);

export function validateJournalTransaction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, reason: 'Journal transaction must be an object.' };
  }

  const { reference, customerRef, asset, entries } = input;
  if (typeof reference !== 'string' || !IDENTIFIER_PATTERN.test(reference)) {
    return { valid: false, reason: 'reference is invalid.' };
  }
  if (typeof customerRef !== 'string' || !IDENTIFIER_PATTERN.test(customerRef)) {
    return { valid: false, reason: 'customerRef is invalid.' };
  }
  if (typeof asset !== 'string' || !ASSET_PATTERN.test(asset)) {
    return { valid: false, reason: 'asset must be an uppercase asset code.' };
  }
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 100) {
    return { valid: false, reason: 'A journal must contain between 2 and 100 entries.' };
  }

  let debits = 0n;
  let credits = 0n;
  const normalized = [];
  const accountSides = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { valid: false, reason: 'Each entry must be an object.' };
    }
    if (typeof entry.accountCode !== 'string' || !IDENTIFIER_PATTERN.test(entry.accountCode)) {
      return { valid: false, reason: 'accountCode is invalid.' };
    }
    if (!SIDES.has(entry.side)) {
      return { valid: false, reason: 'Entry side must be debit or credit.' };
    }
    if (entry.asset !== asset) {
      return { valid: false, reason: 'All entries in a journal must use the same asset.' };
    }
    if (typeof entry.amountUnits !== 'string' || !INTEGER_UNITS_PATTERN.test(entry.amountUnits)) {
      return { valid: false, reason: 'amountUnits must be a positive integer string; do not use floating point.' };
    }

    const accountSide = entry.accountCode + '\u0000' + entry.side;
    if (accountSides.has(accountSide)) {
      return { valid: false, reason: 'Duplicate account/side entry; combine amounts for that account and side.' };
    }
    accountSides.add(accountSide);

    const units = BigInt(entry.amountUnits);
    if (entry.side === 'debit') debits += units;
    else credits += units;
    normalized.push(Object.freeze({
      accountCode: entry.accountCode,
      side: entry.side,
      asset,
      amountUnits: entry.amountUnits
    }));
  }

  if (debits !== credits) {
    return { valid: false, reason: 'Journal is not balanced: debit and credit totals must match.' };
  }

  const transaction = Object.freeze({
    reference,
    customerRef,
    asset,
    totalDebitUnits: debits.toString(),
    totalCreditUnits: credits.toString(),
    entries: Object.freeze(normalized)
  });
  return { valid: true, transaction };
}

/**
 * Utility for safe balance projection from already-posted journal entries.
 * The caller must ensure entries came from trusted, immutable persisted rows.
 */
export function calculateAccountBalanceUnits(entries, accountCode, asset) {
  if (!Array.isArray(entries) || typeof accountCode !== 'string' ||
      typeof asset !== 'string' || !ASSET_PATTERN.test(asset)) {
    throw new TypeError('Valid entries, accountCode, and asset are required.');
  }

  let balance = 0n;
  for (const entry of entries) {
    if (!entry || entry.accountCode !== accountCode || entry.asset !== asset) continue;
    if (!SIDES.has(entry.side) || typeof entry.amountUnits !== 'string' ||
        !INTEGER_UNITS_PATTERN.test(entry.amountUnits)) {
      throw new TypeError('Encountered an invalid posted ledger entry.');
    }
    const units = BigInt(entry.amountUnits);
    balance += entry.side === 'debit' ? units : -units;
  }
  return balance.toString();
}
