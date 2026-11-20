'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceService, validateTransfer } = require('./financeService');

const input = {
  householdId: '11111111-1111-4111-8111-111111111111',
  fromAccountId: '11111111-aaaa-4111-8111-111111111111',
  toAccountId: '11111111-bbbb-4111-8111-111111111111',
  amountMinor: '1250',
  currency: 'EUR',
  idempotencyKey: 'mobile-transfer-001',
};
test('validates and maps transfer without floating point', () => {
  assert.deepEqual(validateTransfer(input), {
    p_household: input.householdId,
    p_from_account: input.fromAccountId,
    p_to_account: input.toAccountId,
    p_amount_minor: '1250',
    p_currency: 'EUR',
    p_idempotency_key: input.idempotencyKey,
  });
});
test('rejects invalid and unsafe transfer requests', () => {
  for (const amountMinor of ['0', '-1', '1.25', '1e3', 1250, '999999999999999999999999999999999999999']) {
    assert.throws(() => validateTransfer({ ...input, amountMinor }));
  }
  assert.throws(() => validateTransfer({ ...input, toAccountId: input.fromAccountId }));
  assert.throws(() => validateTransfer({ ...input, currency: 'XYZ' }));
  assert.throws(() => validateTransfer({ ...input, householdId: 'invalid' }));
});
test('calls authenticated RPC with validated parameters', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: '33333333-3333-4333-8333-333333333333', error: null };
    },
    from: () => { throw Error('unexpected read'); },
  };
  const result = await createFinanceService(client).transfer(input);
  assert.equal(result, '33333333-3333-4333-8333-333333333333');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'duo_v3_post_transfer');
  assert.equal(calls[0].args.p_amount_minor, '1250');
});
test('propagates RPC errors without retrying a financial write', async () => {
  let calls = 0;
  const error = new Error('permission denied');
  const client = {
    rpc: async () => { calls++; return { data: null, error }; },
    from: () => {},
  };
  await assert.rejects(createFinanceService(client).transfer(input), error);
  assert.equal(calls, 1);
});
