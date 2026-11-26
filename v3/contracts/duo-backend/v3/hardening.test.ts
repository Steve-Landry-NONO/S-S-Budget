// Durcissement du contrat v3.2 (26/11/2026) : un test de REPRODUCTION (défaut de la version publiée b647f72 / df41563, ou geste
// fautif) et un test de CORRECTION par anomalie. node --test hardening.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMockBackend, formatMoney } from './mockBackend.ts';
import { DuoError, errorFromPostgrest, PUBLIC_MESSAGES } from './duoBackend.contract.ts';
import { EnvelopeCache, envelopeCacheKey, primaryAmount, sumCapabilities, available, partial, notAvailable } from './envelopeRead.contract.ts';
import type { Capability, EnvelopeListSnapshot } from './envelopeRead.contract.ts';
import { fromSqlEnvelopeSnapshot, fromSqlFundsSnapshot, validateSqlFundsSnapshot } from './envelopeMapper.ts';

const text = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const raw = (n: string) => JSON.parse(text(`./fixtures/sql_${n}.json`));
const legacy = (n: string) => text(`./fixtures/legacy-published-df41563/sql_${n}.json`);
const v = (c: Capability<string>) => { assert.equal(c.state, 'available', JSON.stringify(c)); return (c as { value: string }).value; };
const camille = { userId: 'u-camille', email: 'c@example.invalid', emailVerified: true, displayName: 'Camille' };
const alex = { userId: 'u-alex', email: 'a@example.invalid', emailVerified: true, displayName: 'Alex' };
const id = () => crypto.randomUUID();
const isCode = (code: string) => (e: unknown) => e instanceof DuoError && e.code === code;
const VIEW = (scope: 'common' | 'personal' = 'common') => ({ viewerUserId: 'u-viewer', scope });

async function pair() {
  const be = createMockBackend(camille);
  const { data: { duoId } } = await be.createDuo({ clientOperationId: id(), name: 'Duo', currency: 'EUR', timezone: 'Europe/Paris' }) as any;
  const inv: any = await be.createInvitation({ clientOperationId: id(), duoId, channel: 'link' });
  be._switchUser(alex); await be.acceptInvitation(inv.data.shareUrl.split('/').pop()); be._switchUser(camille);
  return { be, duoId };
}

// ---------------------------------------------------------------------------------------------------- REV-01
test('REV-01 reproduction : la réponse publiée transporte des NOMBRES JSON ; 2^53+1 n’y survit pas', () => {
  const t = legacy('partial_funding');
  assert.match(t, /"ledgerVersion": \d+/);                                         // nombre JSON dans la version publiée
  assert.equal(JSON.parse('{"x": 9007199254740993}').x, 9007199254740992);          // perte silencieuse en JavaScript
  assert.throws(() => fromSqlFundsSnapshot(JSON.parse(t), VIEW()), isCode('CONTRACT_VIOLATION'));   // refusée, jamais arrondie
  assert.throws(() => fromSqlEnvelopeSnapshot(JSON.parse(legacy('budget_only_006'))), isCode('CONTRACT_VIOLATION'));
});
test('REV-01 correction : chaînes d’entiers exactes au-delà de 2^53 (XAF), négatifs, compteur en chaîne', () => {
  const s = fromSqlFundsSnapshot(raw('xaf_large_amounts'), VIEW()); const e = s.envelopes[0];
  assert.equal(s.currency, 'XAF'); assert.equal(s.minorDigits, 0); assert.equal(typeof s.version, 'string');
  assert.equal(v(s.household.unassignedRealFunds), '9007199254740994');            // 2^53 + 2 : exact
  assert.equal(BigInt(s.household.realTreasury), BigInt(v(s.household.unassignedRealFunds)) + BigInt(v(s.household.assignedRealFunds)));
  assert.equal(v(e.realAvailable), (2n ** 53n + 1n - 150000n).toString());
  assert.equal(formatMoney({ minor: v(s.household.unassignedRealFunds), currency: 'XAF' }).replace(/\s/gu, ' '), '9 007 199 254 740 994 FCFA');
  const neg = structuredClone(raw('real_deficit')); assert.equal(v(fromSqlFundsSnapshot(neg, VIEW()).envelopes[0].realAvailable), '-3000');
  for (const bad of [1.5, '1.5', '01', '1e3', '', null, '-0x1']) {
    const r = structuredClone(raw('partial_funding')); r.envelopes[0].realAvailable = bad;
    assert.throws(() => validateSqlFundsSnapshot(r), isCode('CONTRACT_VIOLATION'), String(bad));
  }
});
test('Devises EUR / USD / XAF : échelle, formatage, aucune conversion implicite', () => {
  const usd = fromSqlFundsSnapshot(raw('usd_cents'), VIEW());
  assert.deepEqual([usd.currency, usd.minorDigits, v(usd.envelopes[0].realAvailable)], ['USD', 2, '17656']);
  assert.equal(formatMoney({ minor: '17656', currency: 'USD' }).replace(/\s/gu, ' '), '176,56 $');
  assert.equal(fromSqlFundsSnapshot(raw('partial_funding'), VIEW()).minorDigits, 2);
  const r = structuredClone(raw('usd_cents')); r.currency = 'CHF';
  assert.throws(() => validateSqlFundsSnapshot(r), isCode('CONTRACT_VIOLATION'));    // devise hors contrat refusée
});

// ---------------------------------------------------------------------------------------------------- REV-02
test('REV-02 reproduction / correction : la clé d’idempotence est portée par (duo, AUTEUR, clé), comme le serveur', async () => {
  const { be, duoId } = await pair();
  const key = id();
  const a: any = await be.postContribution({ clientOperationId: key, duoId, amountMinor: '1000', status: 'done', occurredOn: '2026-12-01' });
  be._switchUser(alex);
  // Version publiée : même clé + charge différente chez l'autre membre → IDEMPOTENCY_MISMATCH à tort ; même charge → « rejeu » de l'opération de Camille.
  const b: any = await be.postContribution({ clientOperationId: key, duoId, amountMinor: '2000', status: 'done', occurredOn: '2026-12-01' });
  assert.equal(b.replayed, false); assert.notEqual(b.data.operationId, a.data.operationId);
  assert.deepEqual(await be.getOperationStatus(duoId, key), { found: true, operationId: b.data.operationId, status: 'done', version: 1 });
  const again: any = await be.postContribution({ clientOperationId: key, duoId, amountMinor: '2000', status: 'done', occurredOn: '2026-12-01' });
  assert.equal(again.replayed, true); assert.equal(again.data.operationId, b.data.operationId);
  await assert.rejects(be.postContribution({ clientOperationId: key, duoId, amountMinor: '2001', status: 'done', occurredOn: '2026-12-01' }), isCode('IDEMPOTENCY_MISMATCH'));
  be._switchUser(camille);
  assert.equal((await be.getDuoSnapshot(duoId)).real.minor, '3000');               // deux opérations distinctes, aucune perdue
});

// ---------------------------------------------------------------------------------------------------- REV-03
test('REV-03 : invariant rompu → incident d’intégrité ; aucun fonds réel présenté comme juste ; jamais mis en cache', () => {
  const ok = fromSqlFundsSnapshot(raw('partial_funding'), VIEW()); assert.equal(ok.integrity, 'ok');
  const r = structuredClone(raw('partial_funding')); r.household.invariantHolds = false;           // falsification synthétique (le serveur la calcule)
  const s = fromSqlFundsSnapshot(r, VIEW());
  assert.equal(s.integrity, 'incident');
  for (const e of s.envelopes) {
    assert.deepEqual(e.realAvailable, { state: 'not_available', reason: 'integrity_incident' });
    assert.deepEqual(primaryAmount(e), { label: 'Disponible réel', amount: null, unavailable: 'integrity_incident' });
  }
  assert.deepEqual(s.household.unassignedRealFunds, { state: 'not_available', reason: 'integrity_incident' });
  const c = new EnvelopeCache(); c.put(s); assert.equal(c.size, 0);
});

// ---------------------------------------------------------------------------------------------------- REV-04
test('REV-04 reproduction : la clé publiée de l’espace commun ignorait l’utilisateur et la période', () => {
  const publishedKey = (duoId: string, scope: string, viewer: string) => `envelopes:v3:${duoId}:${scope}:${scope === 'personal' ? viewer : 'common'}`;
  assert.equal(publishedKey('d', 'common', 'u-a'), publishedKey('d', 'common', 'u-b'));   // collision entre comptes sur un même appareil
});
test('REV-04 correction : clé (utilisateur, duo, espace, période) ; purge déconnexion / révocation / départ ; revalidation', async () => {
  const k = (viewer: string, periodId: string, scope: 'common' | 'personal' = 'common') => envelopeCacheKey({ duoId: 'd', scope, periodId }, viewer);
  assert.notEqual(k('u-a', 'p1'), k('u-b', 'p1')); assert.notEqual(k('u-a', 'p1'), k('u-a', 'p2')); assert.notEqual(k('u-a', 'p1'), k('u-a', 'p1', 'personal'));
  assert.throws(() => envelopeCacheKey({ duoId: 'd', scope: 'common', periodId: 'p' }, ''));
  const { be, duoId } = await pair(); be._seed.sprint3(duoId, camille.userId);
  const cache = new EnvelopeCache(); be.subscribe(duoId, e => cache.onSyncEvent(camille.userId, e));
  const s = await be.getEnvelopeSnapshot(duoId, 'common'); cache.put(s);
  assert.equal(cache.get(alex.userId, duoId, 'common', s.periodId), null);                        // autre compte : rien
  assert.equal(cache.get(camille.userId, duoId, 'common', s.periodId)!.syncStatus, 'offline_cache');
  await be.postContribution({ clientOperationId: id(), duoId, amountMinor: '100', status: 'done', occurredOn: '2026-12-01' });
  assert.equal(cache.get(camille.userId, duoId, 'common', s.periodId)!.syncStatus, 'stale');       // revalidation exigée
  await be.signOut(); assert.equal(cache.size, 0);                                                  // déconnexion : purge totale
  cache.put(s); cache.onSyncEvent(camille.userId, { type: 'member.changed', duoId, userId: camille.userId, status: 'left' }); assert.equal(cache.size, 0);
  cache.put(s); cache.onSyncEvent(camille.userId, { type: 'session.revoked' }); assert.equal(cache.size, 0);
});
test('REV-04 / G9 : l’espace annoncé par le serveur prime ; propriétaire = utilisateur de session ; incohérence refusée', () => {
  const s = fromSqlFundsSnapshot(raw('personal_envelope_owner'), { viewerUserId: 'u-session', scope: 'personal' });
  assert.deepEqual([s.scope, s.ownerUserId, s.viewerUserId], ['personal', 'u-session', 'u-session']);
  assert.throws(() => fromSqlFundsSnapshot(raw('personal_envelope_owner'), VIEW('common')), isCode('CONTRACT_VIOLATION'));
  assert.throws(() => fromSqlFundsSnapshot(raw('partial_funding'), VIEW('personal')), isCode('CONTRACT_VIOLATION'));
  assert.throws(() => fromSqlFundsSnapshot(raw('personal_envelope_other_user'), VIEW('personal')), isCode('FORBIDDEN'));
});

// ---------------------------------------------------------------------------------------------------- REV-05
test('REV-05 : « contributions seules » est une valeur PARTIELLE qualifiée, jamais un prévisionnel complet', () => {
  const s = fromSqlFundsSnapshot(raw('future_operations'), VIEW());
  assert.equal(s.household.forecastTreasury.state, 'partial');
  assert.deepEqual(fromSqlFundsSnapshot(raw('partial_funding'), VIEW()).household.forecastTreasury, { state: 'not_available', reason: 'planned_expenses_not_modeled' });
  assert.deepEqual(sumCapabilities([available('1'), partial('2', 'contributions_only', ['planned_expenses'])]), { state: 'partial', value: '3', basis: 'contributions_only', missing: ['planned_expenses'] });
  assert.equal(sumCapabilities([partial('2', 'contributions_only', ['planned_expenses']), notAvailable('not_in_source')]).state, 'not_available');
  const r = structuredClone(raw('future_operations')); r.household.forecastTreasury = null;
  assert.throws(() => validateSqlFundsSnapshot(r), isCode('CONTRACT_VIOLATION'));             // état et valeur incohérents
});

// ---------------------------------------------------------------------------------------------------- REV-06
test('REV-06 reproduction : la lecture publiée ne connaissait que none / protected', () => {
  assert.match(legacy('protected_envelope'), /"protectionState": "protected"/);
  assert.doesNotMatch(text('./fixtures/legacy-published-df41563/sql_protected_envelope.json'), /lift_pending/);
});
test('REV-06 correction : lift_pending lu depuis le serveur, section protégée, totaux protégés', () => {
  const s = fromSqlFundsSnapshot(raw('protection_lift_pending'), VIEW()); const vac = s.envelopes.at(-1)!;
  assert.deepEqual([vac.name, vac.protection], ['Vacances', { state: 'available', value: 'lift_pending' }]);
  assert.ok(vac.flags.includes('protected'));
  assert.deepEqual([v(s.household.protectedRealAvailable), v(s.household.outsideProtectedRealAvailable)], ['15000', '10000']);
  const r = structuredClone(raw('protection_lift_pending')); r.envelopes[1].protectionState = 'unlocked';
  assert.throws(() => validateSqlFundsSnapshot(r), isCode('CONTRACT_VIOLATION'));
});
test('REV-06 / G7 : protéger immédiat ; lever = double accord ; le demandeur ne s’approuve pas ; fonds bloqués pendant l’attente', async () => {
  const { be, duoId } = await pair(); be._seed.sprint3(duoId);
  const cmd = { duoId, envelopeId: 'env-vacances' };
  const r1: any = await be.setEnvelopeProtection({ ...cmd, protected: false }); assert.equal(r1.data.protectionState, 'lift_pending');
  const r2: any = await be.setEnvelopeProtection({ ...cmd, protected: false }); assert.equal(r2.data.protectionState, 'lift_pending');   // pas d'auto-approbation
  await assert.rejects(be.moveRealFunds({ clientOperationId: id(), duoId, from: { kind: 'envelope', envelopeId: 'env-vacances' }, to: { kind: 'unassigned' }, amountMinor: '100' }), isCode('ENVELOPE_PROTECTED'));
  be._switchUser(alex);
  const r3: any = await be.setEnvelopeProtection({ ...cmd, protected: false }); assert.equal(r3.data.protectionState, 'none');
  const s = await be.getEnvelopeSnapshot(duoId, 'common');
  assert.deepEqual(s.envelopes.find(e => e.envelopeId === 'env-vacances')!.protection, { state: 'available', value: 'none' });
});

// ---------------------------------------------------------------------------------------------------- REV-07
test('REV-07 : prévisions du DuoSnapshot = capacités (jamais un Money obligatoire faute de modèle)', async () => {
  const { be, duoId } = await pair(); const s = await be.getDuoSnapshot(duoId);
  for (const k of ['forecast', 'upcomingContributions', 'plannedExpenses'] as const) assert.ok(['available', 'partial', 'not_available', 'not_declared'].includes(s[k].state), k);
  assert.equal(typeof s.real.minor, 'string');                                       // le réel reste un montant obligatoire
});

// ---------------------------------------------------------------------------------------------------- G6 / G7 / G9
test('G6 : réallocation budgétaire et mouvement de fonds réels sont deux commandes distinctes', async () => {
  const { be, duoId } = await pair(); be._seed.sprint3(duoId); be._seed.unassignedFunds(duoId, '5000');
  const before = await be.getEnvelopeSnapshot(duoId, 'common');
  await be.moveRealFunds({ clientOperationId: id(), duoId, from: { kind: 'unassigned' }, to: { kind: 'envelope', envelopeId: 'env-loisirs' }, amountMinor: '2000' });
  const after = await be.getEnvelopeSnapshot(duoId, 'common'); const loisirs = (s: EnvelopeListSnapshot) => s.envelopes.find(e => e.envelopeId === 'env-loisirs')!;
  assert.deepEqual([v(loisirs(before).realAvailable), v(loisirs(after).realAvailable)], ['5500', '7500']);
  assert.equal(after.household.realTreasury, before.household.realTreasury);         // trésorerie inchangée
  assert.equal(loisirs(after).target, loisirs(before).target);                       // budget inchangé
  await assert.rejects(be.moveRealFunds({ clientOperationId: id(), duoId, from: { kind: 'unassigned' }, to: { kind: 'envelope', envelopeId: 'env-loisirs' }, amountMinor: '3001' }), isCode('INSUFFICIENT_REAL_FUNDS'));
  const env = be._seed.envelope(duoId, 'Budget A', '1000'), env2 = be._seed.envelope(duoId, 'Budget B', '0');
  await be.reallocateBudget({ clientOperationId: id(), duoId, from: { kind: 'envelope', envelopeId: env }, to: { kind: 'envelope', envelopeId: env2 }, amountMinor: '400' });
  const ds = await be.getDuoSnapshot(duoId);
  assert.deepEqual([ds.envelopes.find(e => e.envelopeId === env)!.budgetBalance.minor, ds.real.minor], ['600', '0']);   // aucun argent réel déplacé
  const r: any = await be.transfer({ clientOperationId: id(), duoId, from: { kind: 'envelope', envelopeId: env }, to: { kind: 'envelope', envelopeId: env2 }, amountMinor: '1' });
  assert.equal(r.status, 'confirmed');                                               // alias déprécié = réallocation budgétaire
});
test('G9 : espace personnel résolu par la session, création idempotente', async () => {
  const { be } = await pair();
  assert.deepEqual((await be.mySpaces()).personalSpaceId, null);
  const a: any = await be.createPersonalSpace({ clientOperationId: id(), currency: 'EUR' });
  const b: any = await be.createPersonalSpace({ clientOperationId: id(), currency: 'EUR' });
  assert.equal(a.data.personalSpaceId, b.data.personalSpaceId); assert.equal(b.replayed, true);
  be._switchUser(alex); assert.equal((await be.mySpaces()).personalSpaceId, null);   // jamais l'espace du partenaire
});

// ---------------------------------------------------------------------------------------------------- erreurs et lectures vides
test('Erreurs : message public stable, jamais le message brut du serveur', () => {
  const rawMsg = 'update or delete on table "duo_v3_members" violates foreign key constraint "duo_v3_transactions_household_id_created_by_fkey"';
  const e = errorFromPostgrest({ code: '23503', message: rawMsg });
  assert.equal(e.code, 'NOT_FOUND'); assert.equal(e.message, PUBLIC_MESSAGES.NOT_FOUND); assert.doesNotMatch(e.message + JSON.stringify(e), /duo_v3_/);
  const h = errorFromPostgrest({ code: '23514', hint: 'insufficient_real_funds', message: 'Insufficient real funds: 9007199254740993 > 12' });
  assert.equal(h.message, PUBLIC_MESSAGES.INSUFFICIENT_REAL_FUNDS); assert.doesNotMatch(h.message, /\d/);
});
test('Lectures : non autorisé ≠ non initialisé ≠ position absente ; aucun repli à zéro', () => {
  const base = raw('budget_only_006');
  assert.throws(() => fromSqlEnvelopeSnapshot({ householdId: base.householdId, scope: 'common', period: null, position: null, household: null, envelopes: [] }), isCode('FORBIDDEN'));
  assert.throws(() => fromSqlEnvelopeSnapshot({ ...base, period: null }), isCode('SPACE_NOT_INITIALIZED'));
  assert.throws(() => fromSqlEnvelopeSnapshot({ ...base, position: null }), isCode('CONTRACT_VIOLATION'));
  const f = structuredClone(raw('partial_funding')); f.period = null;
  assert.throws(() => fromSqlFundsSnapshot(f, VIEW()), isCode('SPACE_NOT_INITIALIZED'));
  const g = structuredClone(raw('partial_funding')); g.period.endsBefore = g.period.startsOn;
  assert.throws(() => fromSqlFundsSnapshot(g, VIEW()), isCode('CONTRACT_VIOLATION'));
  const ok = fromSqlEnvelopeSnapshot(base); assert.equal(ok.household.realTreasury, base.position.cash_minor);
});
