'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scaleFor, parseAmount, formatAmount, closeEnvelope, nextBudgetAvailable, reallocateReserve, previewExpense } = require('./finance');

// Regression cases: parsing must never silently round, accept noncanonical input,
// or mix currency scales. These are pure arithmetic tests, not database security tests.
test('currency scale policy and exact round trips', () => {
  for (const [currency, scale] of Object.entries({ EUR: 2, USD: 2, GBP: 2, XAF: 0, XOF: 0, JPY: 0 })) {
    assert.equal(scaleFor(currency), scale);
    for (const minor of [0n, 1n, -1n, 123456789012345678901234567890n, -123456789012345678901234567890n]) {
      assert.equal(parseAmount(formatAmount(minor, currency), currency), minor);
    }
  }
});

test('amount input rejects rounding, notation and noncanonical representations', () => {
  for (const input of ['1.001', '1e3', '+1', '01', ' 1', '1 ', '1,20', 'NaN', 'Infinity', '', '.', '1.', '--1', '0x10']) {
    assert.throws(() => parseAmount(input, 'EUR'), input);
  }
  assert.throws(() => parseAmount(1.2, 'EUR'));
  assert.throws(() => formatAmount(100, 'EUR'));
  assert.equal(parseAmount('-0.00', 'EUR'), 0n);
  assert.equal(parseAmount('0.1', 'EUR'), 10n);
});

test('closure preserves sign and routes positive balances exactly once', () => {
  for (const balance of [-100000000000000000000n, -1n, 0n, 1n, 100000000000000000000n]) {
    for (const carryPositive of [true, false]) {
      const { nextPeriodCarry, toUnallocatedReserve } = closeEnvelope({ balance, carryPositive });
      assert.equal(nextPeriodCarry + toUnallocatedReserve, balance);
      if (balance < 0n) assert.equal(nextPeriodCarry, balance);
      if (balance > 0n && !carryPositive) assert.equal(nextPeriodCarry, 0n);
    }
  }
  assert.throws(() => closeEnvelope({ balance: 1, carryPositive: true }));
  assert.throws(() => closeEnvelope({ balance: 1n, carryPositive: 1 }));
});

test('reserve transfer is conservative and rejects invalid inputs', () => {
  const original = { reserve: 900719925474099300000n, envelope: -500n, amount: 200n };
  const updated = reallocateReserve(original);
  assert.equal(updated.reserve + updated.envelope, original.reserve + original.envelope);
  assert.deepEqual(original, { reserve: 900719925474099300000n, envelope: -500n, amount: 200n });
  for (const amount of [0n, -1n, 101n]) assert.throws(() => reallocateReserve({ reserve: 100n, envelope: 0n, amount }));
  assert.throws(() => reallocateReserve({ reserve: 100, envelope: 0n, amount: 1n }));
});

test('budget deficits and expense warning boundaries', () => {
  assert.equal(nextBudgetAvailable({ allocation: 0n, carry: -1n }), -1n);
  assert.throws(() => nextBudgetAvailable({ allocation: -1n, carry: 0n }));
  assert.deepEqual(previewExpense({ available: 100n, amount: 100n }), { remaining: 0n, overspend: false, warningAmount: 0n });
  assert.deepEqual(previewExpense({ available: -10n, amount: 1n }), { remaining: -11n, overspend: true, warningAmount: 11n });
  assert.throws(() => previewExpense({ available: 0n, amount: 0n }));
});
