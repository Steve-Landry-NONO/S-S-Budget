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

test('Qualification HTTP du 27/11 : réponses PostgREST réelles → codes métier (22P02, 23514 domaine, PGRST202, PGRST301, 42501 anon)', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ code: '22P02', details: null, hint: null, message: 'invalid input syntax for type numeric: "abc"' }, 'VALIDATION'],
    [{ code: '23514', details: null, hint: null, message: 'value for domain duo_v3_private.minor_units violates check constraint "minor_units_check"' }, 'VALIDATION'],
    [{ code: '22023', details: null, hint: null, message: 'Invalid contribution parameters' }, 'VALIDATION'],
    [{ code: '23505', details: null, hint: null, message: 'Idempotency key reused for different request' }, 'IDEMPOTENCY_MISMATCH'],
    [{ code: '42501', details: null, hint: null, message: 'Not authorized for this household' }, 'FORBIDDEN'],
    [{ code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }, 'SESSION_EXPIRED'],
    [{ code: 'PGRST202', details: 'Searched for the function public.duo_v3_post_contribution', hint: null, message: 'Could not find the function' }, 'SERVER'],
  ];
  for (const [body, expected] of cases) {
    const e = errorFromPostgrest(body as any);
    assert.equal(e.code, expected, String(body.code)); assert.doesNotMatch(e.message, /duo_v3_|constraint|numeric|JWT/);
  }
});
