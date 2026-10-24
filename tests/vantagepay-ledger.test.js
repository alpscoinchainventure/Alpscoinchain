import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalTransaction, calculateAccountBalanceUnits } from '../lib/vantagepay-ledger.js';

const validJournal = () => ({
  reference: 'VP-TEST-001',
  customerRef: 'customer-001',
  asset: 'USD',
  entries: [
    { accountCode: 'customer:001', side: 'debit', asset: 'USD', amountUnits: '12500' },
    { accountCode: 'clearing:usd', side: 'credit', asset: 'USD', amountUnits: '12500' }
  ]
});

test('accepts a balanced journal and returns immutable normalized entries', () => {
  const result = validateJournalTransaction(validJournal());
  assert.equal(result.valid, true);
  assert.equal(result.transaction.totalDebitUnits, '12500');
  assert.equal(result.transaction.totalCreditUnits, '12500');
  assert.equal(Object.isFrozen(result.transaction), true);
  assert.equal(Object.isFrozen(result.transaction.entries), true);
});

test('rejects unbalanced journals', () => {
  const input = validJournal();
  input.entries[1].amountUnits = '12499';
  assert.match(validateJournalTransaction(input).reason, /not balanced/i);
});

test('rejects floating-point amounts and zero units', () => {
  const decimal = validJournal();
  decimal.entries[0].amountUnits = 12.5;
  assert.match(validateJournalTransaction(decimal).reason, /positive integer string/i);
  const zero = validJournal();
  zero.entries[0].amountUnits = '0';
  assert.match(validateJournalTransaction(zero).reason, /positive integer string/i);
});

test('rejects cross-asset journals and duplicate account-side pairs', () => {
  const crossAsset = validJournal();
  crossAsset.entries[1].asset = 'EUR';
  assert.match(validateJournalTransaction(crossAsset).reason, /same asset/i);
  const duplicate = validJournal();
  duplicate.entries[1].accountCode = 'customer:001';
  duplicate.entries[1].side = 'debit';
  assert.match(validateJournalTransaction(duplicate).reason, /Duplicate account\/side/i);
});

test('rejects malformed top-level inputs and identifiers', () => {
  assert.equal(validateJournalTransaction(null).valid, false);
  const input = validJournal();
  input.reference = '../unsafe';
  assert.match(validateJournalTransaction(input).reason, /reference is invalid/i);
});

test('calculates balances with integer arithmetic only', () => {
  const entries = [
    { accountCode: 'cash', asset: 'USD', side: 'debit', amountUnits: '9007199254740993' },
    { accountCode: 'cash', asset: 'USD', side: 'credit', amountUnits: '3' },
    { accountCode: 'cash', asset: 'EUR', side: 'debit', amountUnits: '100' }
  ];
  assert.equal(calculateAccountBalanceUnits(entries, 'cash', 'USD'), '9007199254740990');
});
