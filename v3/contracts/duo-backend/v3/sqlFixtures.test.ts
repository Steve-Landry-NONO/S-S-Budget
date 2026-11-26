// Fixtures du lot D : réponses JSON RÉELLES du prototype (gen_sql_fixtures.py), traduites par l'adaptateur et vérifiées
// contre les règles du modèle hybride. node --test sqlFixtures.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkEnvelopeIdentities, primaryAmount } from './envelopeRead.contract.ts';
import type { Capability, EnvelopeListSnapshot } from './envelopeRead.contract.ts';
import { fromSqlEnvelopeSnapshot, fromSqlFundsSnapshot } from './envelopeMapper.ts';

const raw = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/sql_${n}.json`, import.meta.url), 'utf8'));
const load = (n: string, scope: 'common' | 'personal' = 'common') => fromSqlFundsSnapshot(raw(n), scope, scope === 'personal' ? 'u-owner' : null);
const v = (c: Capability<string>) => { assert.equal(c.state, 'available', JSON.stringify(c)); return (c as { value: string }).value; };
const env = (s: EnvelopeListSnapshot, name: string) => s.envelopes.find(e => e.name === name)!;
const ok = (s: EnvelopeListSnapshot) => { for (const e of s.envelopes) assert.deepEqual(checkEnvelopeIdentities(e), [], e.name);
  assert.equal(raw.length >= 0, true); };
const E = (euros: number) => String(Math.round(euros * 100));

test('1 · Objectif sans financement : réel 0, cible entièrement non financée', () => {
  const s = load('target_no_funding'), e = env(s, 'Courses'); ok(s);
  assert.deepEqual([v(e.realAvailable), v(e.unfundedTarget), e.remainingBudget], ['0', E(500), E(500)]); assert.ok(e.flags.includes('unfunded_target'));
});
test('2 · Financement partiel (PR #19) : cible 525, financé 325, dépensé 275 → réel 50, reste 250, non financé 200', () => {
  const s = load('partial_funding'), e = env(s, 'Courses'); ok(s);
  assert.deepEqual([e.target, v(e.assignedRealFunds), e.realizedExpenses, v(e.realAvailable), e.remainingBudget, v(e.unfundedTarget)], [E(525), E(325), E(275), E(50), E(250), E(200)]);
  assert.equal(v(s.household.unassignedRealFunds), E(675)); assert.equal(s.household.realTreasury, E(725));
});
test('3 · Financement complet : aucun drapeau « non financé »', () => {
  const s = load('full_funding'), e = env(s, 'Loyer'); ok(s);
  assert.deepEqual([v(e.realAvailable), v(e.unfundedTarget)], [E(300), '0']); assert.ok(!e.flags.includes('unfunded_target'));
});
test('4 · Déficit réel : dépense au-delà des fonds, montant négatif affiché tel quel', () => {
  const e = env(load('real_deficit'), 'Sorties');
  assert.equal(v(e.realAvailable), E(-30)); assert.ok(e.flags.includes('real_deficit')); assert.ok(!e.flags.includes('budget_overrun'));
});
test('5 · Dépassement budgétaire sans déficit réel : les deux notions sont distinctes', () => {
  const e = env(load('budget_overrun'), 'Cadeaux');
  assert.deepEqual([e.remainingBudget, v(e.realAvailable)], [E(-50), E(50)]); assert.ok(e.flags.includes('budget_overrun') && !e.flags.includes('real_deficit'));
});
test('6 · Réserve réelle non affectée ≠ réserve budgétaire', () => {
  const s = load('unassigned_real_reserve');
  assert.deepEqual([v(s.household.unassignedRealFunds), s.household.budgetReserve, s.household.realTreasury], [E(700), '0', E(1000)]);
});
test('7 · Reports positif et négatif : les fonds réels traversent la clôture', () => {
  const s = load('carry_positive_negative'); ok(s);
  const r = env(s, 'Reportable'), d = env(s, 'Deficit');
  assert.deepEqual([v(r.realCarryOver), v(r.realAvailable), v(r.assignedRealFunds)], [E(80), E(80), '0']);
  assert.deepEqual([v(d.realCarryOver), v(d.realAvailable)], [E(-30), E(-30)]); assert.ok(d.flags.includes('real_deficit'));
  assert.equal(r.carryOver, E(100)); assert.equal(d.carryOver, E(10));                 // budget : 100 conservé ; 50 − 40 = 10
});
test('8 · Transfert interne : trésorerie et total réel inchangés', () => {
  const s = load('internal_transfer'); ok(s);
  assert.deepEqual([v(env(s, 'Courses').realAvailable), v(env(s, 'Loisirs').realAvailable), v(s.totals.realAvailable), s.household.realTreasury], [E(180), E(120), E(300), E(300)]);
});
test('9 · Enveloppe protégée : section dédiée, totaux protégé / hors protection', () => {
  const s = load('protected_envelope');
  assert.equal(s.envelopes.at(-1)!.name, 'Vacances'); assert.ok(s.envelopes.at(-1)!.flags.includes('protected'));
  assert.deepEqual([v(s.household.protectedRealAvailable), v(s.household.outsideProtectedRealAvailable)], [E(150), E(100)]);
});
test('10 · Enveloppe personnelle : lisible par son titulaire seul', () => {
  const s = load('personal_envelope_owner', 'personal'), e = env(s, 'Lecture');
  assert.equal(s.scope, 'personal'); assert.deepEqual([e.target, v(e.assignedRealFunds), e.realizedExpenses, v(e.realAvailable)], [E(60), E(50), E(15), E(35)]);
  const other = raw('personal_envelope_other_user');
  assert.deepEqual(other.envelopes, []); assert.equal(other.household, null); assert.equal(other.period, null);
  assert.throws(() => fromSqlFundsSnapshot(other, 'personal', 'u-autre'));      // jamais un faux espace vide « valide »
});
test('11 · Opérations futures : contributions attendues selon la répartition convenue (R-B3) ; dépenses prévues non modélisées = état explicite', () => {
  const s = load('future_operations'), e = env(s, 'Courses');
  assert.equal(s.household.expectedContributionsState, 'agreed');
  assert.deepEqual([v(s.household.expectedContributions), v(s.household.realizedContributions), v(s.household.forecastTreasury)], [E(400), E(300), E(500)]);
  assert.deepEqual(s.household.expectedByMember.map(m => [m.expected, m.realized]).sort(), [[E(200), '0'], [E(200), E(300)]].sort());
  assert.deepEqual(e.forecastBalance, { state: 'not_available', reason: 'planned_expenses_not_modeled' });
});
test('12 · Annulation puis restauration d’une dépense', () => {
  const [a, b, c] = ['cancellation_step0_expense', 'cancellation_step1_cancelled', 'cancellation_step2_restored'].map(n => env(load(n), 'Courses'));
  assert.deepEqual([a, b, c].map(e => [v(e.realAvailable), e.realizedExpenses]), [[E(70), E(30)], [E(100), '0'], [E(70), E(30)]]);
});
test('13 · 006 révisée seule : aucun montant budgétaire présenté comme disponible réel', () => {
  const s = fromSqlEnvelopeSnapshot(raw('budget_only_006')), e = s.envelopes[0];
  assert.equal(s.realFundsSource, 'budget_only');
  assert.deepEqual(e.realAvailable, { state: 'not_available', reason: 'funds_not_modeled' });
  assert.equal(e.budgetBalance, E(280)); assert.deepEqual(primaryAmount(e), { label: 'Disponible réel', amount: null, unavailable: 'funds_not_modeled' });
  assert.equal(s.household.realTreasury, E(180)); assert.equal(s.household.realizedContributions.state, 'not_available');
});
test('Invariant : trésorerie = non affecté + affecté sur chaque fixture du modèle hybride', () => {
  for (const n of ['partial_funding', 'full_funding', 'real_deficit', 'budget_overrun', 'unassigned_real_reserve', 'carry_positive_negative', 'internal_transfer', 'protected_envelope', 'future_operations', 'cancellation_step2_restored']) {
    const s = load(n); assert.equal(BigInt(s.household.realTreasury), BigInt(v(s.household.unassignedRealFunds)) + BigInt(v(s.household.assignedRealFunds)), n);
    assert.equal(raw(n).household.invariantHolds, true, n);
  }
});
