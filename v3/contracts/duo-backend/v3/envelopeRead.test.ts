// Tests du contrat de lecture v3 sur l'adaptateur fictif (PR #17, orientations ENV-UX-01 à 04) : node --test envelopeRead.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockBackend, formatMoney } from './mockBackend.ts';
import { checkEnvelopeIdentities, envelopeCacheKey, primaryAmount } from './envelopeRead.contract.ts';
import type { Capability } from './envelopeRead.contract.ts';
import { buildEnvelope, buildSnapshot } from './envelopeFixtures.ts';
import { DuoError } from './duoBackend.contract.ts';

const camille = { userId: 'u-camille', email: 'c@example.invalid', emailVerified: true, displayName: 'Camille' };
const alex = { userId: 'u-alex', email: 'a@example.invalid', emailVerified: true, displayName: 'Alex' };
const id = () => crypto.randomUUID();
const v = (c: Capability<string>) => { assert.equal(c.state, 'available'); return (c as { value: string }).value; };
const eur = (minor: string) => formatMoney({ minor, currency: 'EUR' });

async function duo() {
  const be = createMockBackend(camille);
  const { data: { duoId } } = await be.createDuo({ clientOperationId: id(), name: 'Duo', currency: 'EUR', timezone: 'Europe/Paris' }) as any;
  const inv: any = await be.createInvitation({ clientOperationId: id(), duoId, channel: 'link' });
  be._switchUser(alex); await be.acceptInvitation(inv.data.shareUrl.split('/').pop()); be._switchUser(camille);
  be._seed.sprint3(duoId, camille.userId);
  return { be, duoId };
}

test('PR #17 : chaque ligne et les totaux, au centime (versé = fonds réels affectés)', async () => {
  const { be, duoId } = await duo();
  const s = await be.getEnvelopeSnapshot(duoId, 'common');
  const row = (n: string) => s.envelopes.find(e => e.name === n)!;
  const expected: Record<string, [string, string]> = { Logement: ['25000', '25000'], Alimentation: ['11500', '15000'], Transport: ['7000', '8000'], Loisirs: ['5500', '2500'], Vacances: ['15000', '15000'] };
  for (const [n, [real, prev]] of Object.entries(expected)) {
    assert.equal(v(row(n).realAvailable), real, n); assert.equal(v(row(n).forecastBalance), prev, n);
    assert.deepEqual(checkEnvelopeIdentities(row(n)), [], n);
  }
  assert.deepEqual([s.totals.target, v(s.totals.assignedRealFunds), s.totals.realizedExpenses, v(s.totals.realAvailable), v(s.totals.forecastBalance)],
                   ['200000', '160000', '96000', '64000', '65500']);
  assert.equal(v(s.household.protectedRealAvailable), '15000'); assert.equal(v(s.household.outsideProtectedRealAvailable), '49000');
  assert.equal(s.realFundsSource, 'funds_ledger');
});

test('ENV-UX-03 : le montant mis en avant est toujours « Disponible réel », jamais un montant budgétaire', async () => {
  const { be, duoId } = await duo();
  const s = await be.getEnvelopeSnapshot(duoId, 'common');
  const alim = s.envelopes.find(e => e.name === 'Alimentation')!;
  const p = primaryAmount(alim);
  assert.deepEqual(p, { label: 'Disponible réel', amount: '11500', unavailable: null });
  assert.notEqual(p.amount, alim.remainingBudget);                       // 215 € de budget restant ≠ 115 € réels
  const noFunds = { ...alim, realAvailable: { state: 'not_available', reason: 'funds_not_modeled' } as const };
  assert.deepEqual(primaryAmount(noFunds), { label: 'Disponible réel', amount: null, unavailable: 'funds_not_modeled' });
});

test('ENV-UX-04 : enveloppes protégées en section dédiée, en fin de liste', async () => {
  const { be, duoId } = await duo();
  const s = await be.getEnvelopeSnapshot(duoId, 'common');
  assert.deepEqual(s.envelopes.map(e => e.protection.state === 'available' && e.protection.value), ['none', 'none', 'none', 'none', 'protected']);
  assert.ok(s.envelopes[4].flags.includes('protected'));
});

test('ENV-UX-02 : espace personnel isolé, sans réserve ni agrégat du partenaire ; cache distinct', async () => {
  const { be, duoId } = await duo();
  const mine = await be.getEnvelopeSnapshot(duoId, 'personal');
  assert.equal(mine.ownerUserId, camille.userId);
  assert.deepEqual(mine.envelopes.map(e => [e.name, e.target, v(e.assignedRealFunds), e.realizedExpenses, v(e.realAvailable)]), [['Lecture', '6000', '5000', '1500', '3500']]);
  assert.equal(v(mine.household.unassignedRealFunds), '0');
  be._switchUser(alex);
  const his = await be.getEnvelopeSnapshot(duoId, 'personal');
  assert.deepEqual(his.envelopes, []);
  assert.equal(v((await be.getEnvelopeSnapshot(duoId, 'common')).totals.realAvailable), '64000');
  assert.notEqual(envelopeCacheKey(mine, camille.userId), envelopeCacheKey(his, alex.userId));
});

test('ENV-UX-01 : une carte = une enveloppe ; copie profonde sans référence partagée', async () => {
  const { be, duoId } = await duo();
  const a = await be.getEnvelopeSnapshot(duoId, 'common'); (a.envelopes[0].realAvailable as any).value = '999';
  const b = await be.getEnvelopeSnapshot(duoId, 'common');
  assert.equal(v(b.envelopes[0].realAvailable), '25000');
  assert.equal(new Set(b.envelopes.map(e => e.envelopeId)).size, b.envelopes.length);
});

test('Objectif sans financement, objectif nul, déficit réel et dépassement distincts', () => {
  const only = buildEnvelope({ envelopeId: 'x', name: 'X', iconKey: 'x', target: 20000n, assignedRealFunds: 0n, realizedExpenses: 0n, plannedAssignments: 0n, plannedExpenses: 0n });
  assert.equal(v(only.realAvailable), '0'); assert.equal(v(only.unfundedTarget), '20000'); assert.ok(only.flags.includes('unfunded_target'));
  const zero = buildEnvelope({ envelopeId: 'z', name: 'Z', iconKey: 'z', target: 0n, assignedRealFunds: 0n, realizedExpenses: 0n, plannedAssignments: 0n, plannedExpenses: 0n });
  assert.equal(zero.consumption, null);
  const d = buildEnvelope({ envelopeId: 'd', name: 'D', iconKey: 'd', target: 10000n, carryOver: -3000n, realCarryOver: -3000n, assignedRealFunds: 10000n, realizedExpenses: 12000n, plannedAssignments: 0n, plannedExpenses: 0n });
  assert.equal(v(d.realAvailable), '-5000'); assert.ok(d.flags.includes('real_deficit') && d.flags.includes('budget_overrun'));
  assert.equal(eur(v(d.realAvailable)), '−50,00 €'); assert.deepEqual(checkEnvelopeIdentities(d), []);
  assert.deepEqual(checkEnvelopeIdentities({ ...d, realAvailable: { state: 'available', value: '0' } }).map(x => x.split(' ')[0]), ['realAvailable', 'forecastBalance']);
});

test('Prévu non modélisé : état explicite, jamais un zéro', () => {
  const e = buildEnvelope({ envelopeId: 'p', name: 'P', iconKey: 'p', target: 100n, assignedRealFunds: 100n, realizedExpenses: 0n, plannedAssignments: null, plannedExpenses: null });
  assert.deepEqual(e.forecastBalance, { state: 'not_available', reason: 'planned_expenses_not_modeled' });
  const s = buildSnapshot({ scope: 'common', duoId: 'd', ownerUserId: null, currency: 'EUR', unassigned: 0n, asOf: 't', version: '1',
    rows: [{ envelopeId: 'p', name: 'P', iconKey: 'p', target: 100n, assignedRealFunds: 100n, realizedExpenses: 0n, plannedAssignments: null, plannedExpenses: null }] });
  assert.equal(s.totals.forecastBalance.state, 'not_available');
});

test('XAF entier, EUR deux décimales, zéro sans signe', () => {
  const s = buildSnapshot({ scope: 'common', duoId: 'd', ownerUserId: null, currency: 'XAF', unassigned: 0n, asOf: 't', version: '1',
    rows: [{ envelopeId: 'l', name: 'Loyer', iconKey: 'home', target: 150000n, assignedRealFunds: 150000n, realizedExpenses: 150000n, plannedAssignments: 0n, plannedExpenses: 0n }] });
  assert.equal(s.minorDigits, 0); assert.equal(formatMoney({ minor: v(s.envelopes[0].realAvailable), currency: 'XAF' }), '0 FCFA');
  assert.equal(formatMoney({ minor: '150000', currency: 'XAF' }), '150 000 FCFA'); assert.equal(eur('-0'), '0,00 €');
});

test('Panne réseau = erreur distincte, jamais un zéro ; non-membre refusé', async () => {
  let fail = true;
  const be = createMockBackend(camille, { fault: (m: string) => (m === 'getEnvelopeSnapshot' && fail ? 'network' : 'none') });
  const { data: { duoId } } = await be.createDuo({ clientOperationId: id(), name: 'D', currency: 'EUR', timezone: 'Europe/Paris' }) as any;
  be._seed.sprint3(duoId);
  await assert.rejects(be.getEnvelopeSnapshot(duoId, 'common'), (e: DuoError) => e.code === 'NETWORK' && e.retryable);
  fail = false; assert.equal(v((await be.getEnvelopeSnapshot(duoId, 'common')).totals.realAvailable), '64000');
  be._switchUser({ userId: 'u-tiers', email: 't@example.invalid', emailVerified: true, displayName: 'Tiers' });
  for (const scope of ['common', 'personal'] as const) await assert.rejects(be.getEnvelopeSnapshot(duoId, scope), (e: DuoError) => e.code === 'FORBIDDEN');
});
