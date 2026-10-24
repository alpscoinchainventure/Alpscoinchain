import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalTransaction, calculateAccountBalanceUnits } from '../lib/vantagepay-ledger.js';

const balanced = {
  reference: 'demo-journal-001',
  customerRef: 'demo-customer-001',
  asset: 'GBP',
  entries: [
    { accountCode: 'customer-liability-001', side: 'debit', asset: 'GBP', amountUnits: '12500' },
    { accountCode: 'settlement-clearing', side: 'credit', asset: 'GBP', amountUnits: '12500' }
  ]
};

test('accepts a balanced journal using integer units represented as strings', () => {
  const result = validateJournalTransaction(balanced);
  assert.equal(result.valid, true);
  assert.equal(result.transaction.totalDebitUnits, '12500');
  assert.equal(result.transaction.totalCreditUnits, '12500');
});

test('rejects unbalanced journals and floating-point amounts', () => {
  assert.equal(validateJournalTransaction({
    ...balanced,
    entries: [...balanced.entries.slice(0, 1), { ...balanced.entries[1], amountUnits: '12499' }]
  }).valid, false);
  assert.equal(validateJournalTransaction({
    ...balanced,
    entries: [...balanced.entries.slice(0, 1), { ...balanced.entries[1], amountUnits: 12500 }]
  }).valid, false);
  assert.equal(validateJournalTransaction({
    ...balanced,
    entries: [...balanced.entries.slice(0, 1), { ...balanced.entries[1], amountUnits: '1.25' }]
  }).valid, false);
});

test('rejects malformed entries, mismatched assets, and duplicate account-side rows', () => {
  assert.equal(validateJournalTransaction(null).valid, false);
  assert.equal(validateJournalTransaction({ ...balanced, entries: [{ ...balanced.entries[0] }] }).valid, false);
  assert.equal(validateJournalTransaction({
    ...balanced, entries: [...balanced.entries.slice(0, 1), { ...balanced.entries[1], asset: 'USD' }]
  }).valid, false);
  assert.equal(validateJournalTransaction({
    ...balanced, entries: [balanced.entries[0], { ...balanced.entries[0], amountUnits: '12500' }]
  }).valid, false);
});

test('rejects invalid identifiers and asset codes', () => {
  assert.equal(validateJournalTransaction({ ...balanced, reference: 'bad ref' }).valid, false);
  assert.equal(validateJournalTransaction({ ...balanced, asset: 'gbp!' }).valid, false);
});

test('projects an account balance from trusted posted entries without floating point', () => {
  const entries = [
    { accountCode: 'customer-1', asset: 'GBP', side: 'debit', amountUnits: '5000' },
    { accountCode: 'customer-1', asset: 'GBP', side: 'credit', amountUnits: '1200' },
    { accountCode: 'customer-2', asset: 'GBP', side: 'debit', amountUnits: '9999' }
  ];
  assert.equal(calculateAccountBalanceUnits(entries, 'customer-1', 'GBP'), '3800');
  assert.equal(calculateAccountBalanceUnits(entries, 'customer-2', 'GBP'), '9999');
  assert.equal(calculateAccountBalanceUnits(entries, 'customer-1', 'USD'), '0');
});

test('rejects malformed persisted entries during balance projection', () => {
  assert.throws(() => calculateAccountBalanceUnits([
    { accountCode: 'customer-1', asset: 'GBP', side: 'debit', amountUnits: '1.5' }
  ], 'customer-1', 'GBP'), TypeError);
});
