'use strict';

// Pure, side-effect-free financial primitives for Duo Budget V3.
// Amounts are signed integer minor units (BigInt); never use floating-point money.
// This module does not authorize transactions, persist data, or replace database RLS.

const CURRENCY_SCALE = Object.freeze({ EUR: 2, USD: 2, XAF: 0, XOF: 0, JPY: 0, GBP: 2 });
function scaleFor(currency) {
  if (!Object.hasOwn(CURRENCY_SCALE, currency)) throw new RangeError('Unsupported currency');
  return CURRENCY_SCALE[currency];
}
function parseAmount(input, currency) {
  const scale = scaleFor(currency);
  if (typeof input !== 'string' || !/^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(input)) throw new TypeError('Invalid amount');
  const negative = input.startsWith('-');
  const [whole, fraction = ''] = (negative ? input.slice(1) : input).split('.');
  if (fraction.length > scale) throw new RangeError('Too many decimal places');
  const minor = BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction.padEnd(scale, '0')) || '0');
  return negative ? -minor : minor;
}
function formatAmount(minor, currency) {
  if (typeof minor !== 'bigint') throw new TypeError('Amount must be BigInt');
  const scale = scaleFor(currency), base = 10n ** BigInt(scale);
  const sign = minor < 0n ? '-' : '', abs = minor < 0n ? -minor : minor;
  return sign + (abs / base).toString() + (scale ? '.' + (abs % base).toString().padStart(scale, '0') : '');
}
// D-013/D-014/D-017/D-018: allocation is a budget target, not a cash deposit.
function closeEnvelope({ balance, carryPositive }) {
  if (typeof balance !== 'bigint' || typeof carryPositive !== 'boolean') throw new TypeError('Invalid closure inputs');
  if (balance < 0n) return { nextPeriodCarry: balance, toUnallocatedReserve: 0n };
  return carryPositive
    ? { nextPeriodCarry: balance, toUnallocatedReserve: 0n }
    : { nextPeriodCarry: 0n, toUnallocatedReserve: balance };
}
function nextBudgetAvailable({ allocation, carry }) {
  if (typeof allocation !== 'bigint' || typeof carry !== 'bigint' || allocation < 0n) throw new TypeError('Invalid budget inputs');
  return allocation + carry;
}
// D-015: arithmetic only; authentication, locking, and audit must be server-side.
function reallocateReserve({ reserve, envelope, amount }) {
  if ([reserve, envelope, amount].some(x => typeof x !== 'bigint') || amount <= 0n || reserve < amount) throw new RangeError('Invalid reserve transfer');
  return { reserve: reserve - amount, envelope: envelope + amount };
}
// D-016: overspend allowed; caller must show a warning before confirmation.
function previewExpense({ available, amount }) {
  if (typeof available !== 'bigint' || typeof amount !== 'bigint' || amount <= 0n) throw new RangeError('Invalid expense');
  return { remaining: available - amount, overspend: amount > available, warningAmount: amount > available ? amount - available : 0n };
}
module.exports = { scaleFor, parseAmount, formatAmount, closeEnvelope, nextBudgetAvailable, reallocateReserve, previewExpense };
