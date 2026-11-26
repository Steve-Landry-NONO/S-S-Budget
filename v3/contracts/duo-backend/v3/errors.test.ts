// Contrat d'erreurs v3 : indices SQL explicites → codes métier ; jamais de déduction depuis un montant. node --test errors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorFromPostgrest } from './duoBackend.contract.ts';

test('Indices (hint) des migrations candidates → codes métier stables', () => {
  const cases: Array<[string, string, string]> = [
    ['23514', 'insufficient_real_funds', 'INSUFFICIENT_REAL_FUNDS'], ['23514', 'release_funds_first', 'RELEASE_FUNDS_FIRST'],
    ['23514', 'envelope_protected', 'ENVELOPE_PROTECTED'], ['42501', 'second_member_required', 'SECOND_MEMBER_REQUIRED'],
    ['55000', 'admin_catch_up_required', 'ADMIN_CATCH_UP_REQUIRED'], ['23503', 'choose_active_envelope', 'ENVELOPE_ARCHIVED'],
  ];
  for (const [code, hint, expected] of cases) assert.equal(errorFromPostgrest({ code, hint, message: 'm' }).code, expected, hint);
});
test('Détails (detail) du lot 3 et repli sur SQLSTATE', () => {
  assert.equal(errorFromPostgrest({ code: '55000', details: 'HOUSEHOLD_ARCHIVED' }).code, 'HOUSEHOLD_ARCHIVED');
  assert.equal(errorFromPostgrest({ code: '23514', details: 'PERSONAL_SPACE' }).code, 'PERSONAL_SPACE');
  assert.equal(errorFromPostgrest({ code: '23514', details: 'DUO_FULL' }).code, 'DUO_FULL');
  assert.equal(errorFromPostgrest({ code: '23505', message: 'Idempotency key reused for different expense' }).code, 'IDEMPOTENCY_MISMATCH');
  assert.equal(errorFromPostgrest({ code: '42501', message: 'Not authorized for this household' }).code, 'FORBIDDEN');
  const e = errorFromPostgrest({ code: 'XX000', message: 'boom' }); assert.equal(e.code, 'SERVER'); assert.equal(e.retryable, false);
});
