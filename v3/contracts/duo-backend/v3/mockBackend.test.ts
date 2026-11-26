// Tests du contrat via l'adaptateur fictif : node --test mockBackend.test.ts (Node ≥ 22.18)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBackend, formatMoney } from './mockBackend.ts';
import { DuoError, errorFromPostgrest } from './duoBackend.contract.ts';

const camille = { userId: 'u-camille', email: 'camille@example.invalid', emailVerified: true, displayName: 'Camille' };
const alex = { userId: 'u-alex', email: 'alex@example.invalid', emailVerified: true, displayName: 'Alex' };
const third = { userId: 'u-third', email: 't@example.invalid', emailVerified: true, displayName: 'Tiers' };
const id = () => crypto.randomUUID();

async function duoAToB(opts = {}) {
  const be = createMockBackend(camille, opts);
  const { data: { duoId } } = await be.createDuo({ clientOperationId: id(), name: 'Les Explorateurs', currency: 'EUR', timezone: 'Europe/Paris' }) as any;
  const inv = await be.createInvitation({ clientOperationId: id(), duoId, channel: 'link' }) as any;
  const token = inv.data.shareUrl.split('/').pop();
  be._switchUser(alex); await be.acceptInvitation(token); be._switchUser(camille);
  return { be, duoId, token };
}

test('BAL1–BAL3 : cinq notions de solde, l’objectif n’entre jamais dans le prévisionnel', async () => {
  const { be, duoId } = await duoAToB();
  be._seed.target(duoId, '200000');
  let s = await be.getDuoSnapshot(duoId);
  assert.deepEqual([s.real.minor, s.forecast.state === 'available' && s.forecast.value.minor, s.budgetTarget.minor], ['0', '0', '200000']);   // BAL1
  await be.postContribution({ clientOperationId: id(), duoId, amountMinor: '100000', status: 'done', occurredOn: '2026-12-01' });
  be._switchUser(alex);
  await be.postContribution({ clientOperationId: id(), duoId, amountMinor: '100000', status: 'planned', occurredOn: '2026-12-05' });
  be._switchUser(camille);
  const loyer = be._seed.envelope(duoId, 'Maison', '90000');
  await be.postExpense({ clientOperationId: id(), duoId, visibility: 'shared', envelopeId: loyer, amountMinor: '90000', status: 'planned', occurredOn: '2026-12-03', label: 'Loyer' });
  s = await be.getDuoSnapshot(duoId);
  // v3.2 (REV-07) : le prévisionnel est une capacité ; l'adaptateur fictif la fournit (`available`), le serveur actuel non.
  assert.equal(s.forecast.state, 'available');
  assert.deepEqual([s.real.minor, s.forecast.state === 'available' && s.forecast.value.minor], ['100000', '110000']);   // BAL2 : 1 000 + 1 000 − 900
});

test('Idempotence : rejeu identique = même opération ; charge modifiée = IDEMPOTENCY_MISMATCH', async () => {
  const { be, duoId } = await duoAToB();
  const env = be._seed.envelope(duoId, 'Courses', '60000');
  const cmd = { clientOperationId: id(), duoId, visibility: 'shared' as const, envelopeId: env, amountMinor: '4820', status: 'done' as const, occurredOn: '2026-12-02', label: 'Marché' };
  const a: any = await be.postExpense(cmd); const b: any = await be.postExpense(cmd);
  assert.equal(a.data.operationId, b.data.operationId); assert.equal(b.replayed, true);
  await assert.rejects(be.postExpense({ ...cmd, amountMinor: '4821' }), (e: DuoError) => e.code === 'IDEMPOTENCY_MISMATCH');
  assert.equal((await be.listOperations(duoId, {})).items.length, 1);
});

test('Résultat inconnu : l’effet a eu lieu, le client vérifie le statut avant de réessayer', async () => {
  let first = true;
  const { be, duoId } = await duoAToB({ fault: (m: string) => (m === 'postContribution' && first ? (first = false, 'unknown_outcome') : 'none') });
  const cmd = { clientOperationId: id(), duoId, amountMinor: '5000', status: 'done' as const, occurredOn: '2026-12-02' };
  await assert.rejects(be.postContribution(cmd), (e: DuoError) => e.code === 'UNKNOWN_OUTCOME' && !e.retryable);
  const st = await be.getOperationStatus(duoId, cmd.clientOperationId);
  assert.equal(st.found, true);
  const again: any = await be.postContribution(cmd);                       // même clé : aucun doublon
  assert.equal(again.replayed, true);
  assert.equal((await be.getDuoSnapshot(duoId)).real.minor, '5000');
});

test('Dépenses privées : invisibles du partenaire, y compris dans les totaux (D-007)', async () => {
  const { be, duoId } = await duoAToB();
  await be.postExpense({ clientOperationId: id(), duoId, visibility: 'private', envelopeId: null, amountMinor: '2500', status: 'done', occurredOn: '2026-12-02', label: 'Cadeau' });
  const mine = await be.getDuoSnapshot(duoId);
  assert.equal(mine.myPrivate!.spentDone.minor, '2500'); assert.equal(mine.real.minor, '0');
  be._switchUser(alex);
  const his = await be.getDuoSnapshot(duoId);
  assert.equal(his.myPrivate!.spentDone.minor, '0'); assert.equal(his.real.minor, '0');
  assert.equal((await be.listOperations(duoId, {})).items.length, 0);
});

test('Deux membres au plus (D-001) ; lien à usage unique', async () => {
  const { be, duoId, token } = await duoAToB();
  await assert.rejects(be.createInvitation({ clientOperationId: id(), duoId, channel: 'link' }), (e: DuoError) => e.code === 'DUO_FULL');
  be._switchUser(third);
  await assert.rejects(be.acceptInvitation(token), (e: DuoError) => e.code === 'INVITATION_INVALID');
  await assert.rejects(be.getDuoSnapshot(duoId), (e: DuoError) => e.code === 'FORBIDDEN');
});

test('Transfert : jamais de source négative ; dépense : dépassement confirmé = avertissement (D-016)', async () => {
  const { be, duoId } = await duoAToB();
  const courses = be._seed.envelope(duoId, 'Courses', '8000'); const vacances = be._seed.envelope(duoId, 'Vacances', '0');
  await assert.rejects(be.transfer({ clientOperationId: id(), duoId, from: { kind: 'envelope', envelopeId: courses }, to: { kind: 'envelope', envelopeId: vacances }, amountMinor: '8001' }),
    (e: DuoError) => e.code === 'INSUFFICIENT_FUNDS');
  await assert.rejects(be.postExpense({ clientOperationId: id(), duoId, visibility: 'shared', envelopeId: courses, amountMinor: '11000', status: 'done', occurredOn: '2026-12-02', label: 'X' }),
    (e: DuoError) => e.code === 'VALIDATION');
  const r: any = await be.postExpense({ clientOperationId: id(), duoId, visibility: 'shared', envelopeId: courses, amountMinor: '11000', status: 'done', occurredOn: '2026-12-02', label: 'X', acknowledgeOverspend: true });
  assert.equal(r.warnings[0].code, 'ENVELOPE_OVERSPENT'); assert.equal(r.warnings[0].budgetBalance.minor, '-3000');
  be._seed.reserve(duoId, '15000');
  await be.transfer({ clientOperationId: id(), duoId, from: { kind: 'reserve' }, to: { kind: 'envelope', envelopeId: vacances }, amountMinor: '6000' });
  const s = await be.getDuoSnapshot(duoId);
  assert.equal(s.reserve.minor, '9000');                                                          // D-015 : 150 − 60
  assert.equal(s.envelopes.find(e => e.envelopeId === vacances)!.budgetBalance.minor, '6000');
});

test('Modification concurrente : VERSION_CONFLICT (Y1) ; annulation puis rétablissement une seule fois', async () => {
  const { be, duoId } = await duoAToB();
  const env = be._seed.envelope(duoId, 'Courses', '60000');
  const r: any = await be.postExpense({ clientOperationId: id(), duoId, visibility: 'shared', envelopeId: env, amountMinor: '1000', status: 'done', occurredOn: '2026-12-02', label: 'Pain' });
  be._switchUser(alex);
  await be.editOperation({ clientOperationId: id(), duoId, operationId: r.data.operationId, expectedVersion: 1, changes: { label: 'Boulangerie' } });
  be._switchUser(camille);
  await assert.rejects(be.cancelOperation({ clientOperationId: id(), duoId, operationId: r.data.operationId, expectedVersion: 1 }), (e: DuoError) => e.code === 'VERSION_CONFLICT');
  const c = { clientOperationId: id(), duoId, operationId: r.data.operationId, expectedVersion: 2 };
  await be.cancelOperation(c); const again: any = await be.cancelOperation(c);
  assert.equal(again.replayed, true);
  assert.equal((await be.getDuoSnapshot(duoId)).envelopes[0].budgetBalance.minor, '60000');
});

test('Départ : accès révoqué immédiatement', async () => {
  const { be, duoId } = await duoAToB();
  be._switchUser(alex); await be.leaveDuo(duoId);
  await assert.rejects(be.getDuoSnapshot(duoId), (e: DuoError) => e.code === 'FORBIDDEN');
});

test('Correspondance des erreurs PostgREST qualifiées sur la réplique', () => {
  assert.equal(errorFromPostgrest({ code: '42501', message: 'Not authorized for this household' }).code, 'FORBIDDEN');
  assert.equal(errorFromPostgrest({ code: '42501', message: 'Authentication required' }).code, 'UNAUTHENTICATED');
  assert.equal(errorFromPostgrest({ code: '23505', message: 'Idempotency key reused for different transfer' }).code, 'IDEMPOTENCY_MISMATCH');
  assert.equal(errorFromPostgrest({ code: '23514', message: 'Household is full' }).code, 'DUO_FULL');
  assert.equal(errorFromPostgrest({ code: 'P0002', message: 'Invitation invalid' }).code, 'INVITATION_INVALID');
  assert.equal(errorFromPostgrest({ code: '23514', message: 'x', details: 'INSUFFICIENT_FUNDS' }).code, 'INSUFFICIENT_FUNDS');
});

test('Affichage : jamais « −0,00 € », XAF sans décimales', () => {
  assert.equal(formatMoney({ minor: '0', currency: 'EUR' }), '0,00 €');
  assert.equal(formatMoney({ minor: '-3000', currency: 'EUR' }), '−30,00 €');
  assert.equal(formatMoney({ minor: '1250000', currency: 'XAF' }), '1 250 000 FCFA');
});
