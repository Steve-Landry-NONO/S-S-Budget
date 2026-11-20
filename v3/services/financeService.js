'use strict';

// Duo Budget V3 — transport-neutral finance service.
// Inject an authenticated Supabase client. Never embed a service-role key here.
// All amounts are decimal strings representing integer minor units, not JS floats.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'XAF', 'XOF', 'JPY']);
const MAX_AMOUNT = BigInt('99999999999999999999999999999999999999');

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError(field + ' must be UUID');
  return value;
}
function minorUnits(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError('amountMinor must be a positive integer string');
  }
  const amount = BigInt(value);
  if (amount > MAX_AMOUNT) throw new RangeError('amountMinor exceeds database precision');
  return value;
}
function validateTransfer(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Transfer input required');
  const householdId = requireUuid(input.householdId, 'householdId');
  const fromAccountId = requireUuid(input.fromAccountId, 'fromAccountId');
  const toAccountId = requireUuid(input.toAccountId, 'toAccountId');
  if (fromAccountId === toAccountId) throw new RangeError('Source and destination must differ');
  if (!CURRENCIES.has(input.currency)) throw new RangeError('Unsupported currency');
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) {
    throw new TypeError('idempotencyKey must contain 1–128 characters');
  }
  return {
    p_household: householdId,
    p_from_account: fromAccountId,
    p_to_account: toAccountId,
    p_amount_minor: minorUnits(input.amountMinor),
    p_currency: input.currency,
    p_idempotency_key: input.idempotencyKey,
  };
}
function createFinanceService(supabase) {
  if (!supabase || typeof supabase.rpc !== 'function' || typeof supabase.from !== 'function') {
    throw new TypeError('Authenticated Supabase client required');
  }
  return Object.freeze({
    async transfer(input) {
      const params = validateTransfer(input);
      const { data, error } = await supabase.rpc('duo_v3_post_transfer', params);
      if (error) throw error;
      return requireUuid(data, 'transactionId');
    },
    async listTransactions(householdId, limit = 50) {
      requireUuid(householdId, 'householdId');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit must be 1–100');
      const { data, error } = await supabase.from('duo_v3_transactions')
        .select('id,household_id,currency,kind,created_at,reverses_transaction_id')
        .eq('household_id', householdId).order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data;
    },
    async listEntries(transactionId) {
      requireUuid(transactionId, 'transactionId');
      const { data, error } = await supabase.from('duo_v3_entries')
        .select('id,transaction_id,account_id,currency,amount_minor,created_at')
        .eq('transaction_id', transactionId);
      if (error) throw error;
      return data;
    },
  });
}
module.exports = { createFinanceService, validateTransfer };
