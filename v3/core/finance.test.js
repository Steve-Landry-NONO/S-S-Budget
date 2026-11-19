'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, formatAmount, closeEnvelope, nextBudgetAvailable, reallocateReserve, previewExpense } = require('./finance');

test('currency precision EUR and XAF, no floating point', () => {
  assert.equal(parseAmount('80.50', 'EUR'), 8050n);
  assert.equal(parseAmount('80000', 'XAF'), 80000n);
  assert.equal(formatAmount(-3000n, 'EUR'), '-30.00');
  assert.throws(() => parseAmount('1.25', 'XAF'));
  assert.throws(() => parseAmount('1.234', 'EUR'));
  assert.throws(() => parseAmount('1e3', 'EUR'));
  assert.throws(() => parseAmount('1', 'XYZ'));
});
test('D-013/D-014 positive balance without carry becomes reserve', () => {
  assert.deepEqual(closeEnvelope({balance:8000n, carryPositive:false}), {nextPeriodCarry:0n,toUnallocatedReserve:8000n});
  assert.deepEqual(closeEnvelope({balance:8000n, carryPositive:true}), {nextPeriodCarry:8000n,toUnallocatedReserve:0n});
});
test('D-017 negative balance always carries even with positive carry disabled', () => {
  assert.deepEqual(closeEnvelope({balance:-3000n, carryPositive:false}), {nextPeriodCarry:-3000n,toUnallocatedReserve:0n});
  assert.equal(nextBudgetAvailable({allocation:40000n,carry:-3000n}),37000n);
});
test('D-018 deficit larger than allocation remains negative', () => {
  assert.equal(nextBudgetAvailable({allocation:40000n,carry:-50000n}),-10000n);
});
test('D-015 reserve transfers preserve totals and reject overdraft', () => {
  const before=15000n+20000n;
  const result=reallocateReserve({reserve:15000n,envelope:20000n,amount:6000n});
  assert.deepEqual(result,{reserve:9000n,envelope:26000n});
  assert.equal(result.reserve+result.envelope,before);
  assert.throws(()=>reallocateReserve({reserve:100n,envelope:0n,amount:101n}));
  assert.throws(()=>reallocateReserve({reserve:100n,envelope:0n,amount:0n}));
});
test('D-016 expense overspending is warned but calculable', () => {
  assert.deepEqual(previewExpense({available:8000n,amount:11000n}),{remaining:-3000n,overspend:true,warningAmount:3000n});
  assert.deepEqual(previewExpense({available:8000n,amount:5000n}),{remaining:3000n,overspend:false,warningAmount:0n});
});
