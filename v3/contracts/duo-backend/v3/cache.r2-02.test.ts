// R2-02 (27/11/2026) : aucune écriture tardive dans EnvelopeCache après déconnexion, révocation de session, changement de
// compte, reconnexion du même compte ou perte d'appartenance. Chaque cas : la réponse réseau est obtenue AVANT l'évènement
// (lecture en vol) et présentée APRÈS. node --test cache.r2-02.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnvelopeCache } from './envelopeRead.contract.ts';
import type { EnvelopeListSnapshot } from './envelopeRead.contract.ts';
import { createMockBackend } from './mockBackend.ts';

const camille = { userId: 'u-camille', email: 'c@example.invalid', emailVerified: true, displayName: 'Camille' };
const alex = { userId: 'u-alex', email: 'a@example.invalid', emailVerified: true, displayName: 'Alex' };
const id = () => crypto.randomUUID();

async function setup() {
  const be = createMockBackend(camille);
  const { data: { duoId } } = await be.createDuo({ clientOperationId: id(), name: 'Duo', currency: 'EUR', timezone: 'Europe/Paris' }) as any;
  const inv: any = await be.createInvitation({ clientOperationId: id(), duoId, channel: 'link' });
  be._switchUser(alex); await be.acceptInvitation(inv.data.shareUrl.split('/').pop()); be._switchUser(camille);
  be._seed.sprint3(duoId, camille.userId);
  const cache = new EnvelopeCache(); cache.openSession(camille.userId); be.subscribe(duoId, e => cache.onSyncEvent(e));
  /** Lecture « en vol » : ticket pris, réponse reçue, mais pas encore écrite. */
  const inFlight = async () => ({ t: cache.beginRead(duoId, 'common')!, s: await be.getEnvelopeSnapshot(duoId, 'common') });
  return { be, duoId, cache, inFlight };
}
const asViewer = (s: EnvelopeListSnapshot, viewer: string) => ({ ...structuredClone(s), viewerUserId: viewer });

test('Reproduction (contrat publié 3.2) : put() sans ticket réécrit le cache après purge', async () => {
  // L'API publiée exposait put(snapshot) sans contrôle de session : une réponse tardive repeuplait le cache après signOut.
  // L'API 3.3 ne propose plus d'écriture sans ticket : vérification structurelle.
  assert.equal('put' in EnvelopeCache.prototype, false);
});

test('Réponse arrivée après DÉCONNEXION : refusée, cache vide', async () => {
  const { be, cache, inFlight } = await setup();
  const { t, s } = await inFlight();
  await be.signOut();                                                  // émet session.revoked → closeSession
  assert.equal(cache.commit(t, s), 'no_session'); assert.equal(cache.size, 0);
});

test('Réponse arrivée après RÉVOCATION de session puis reconnexion du MÊME compte : refusée (nouvelle session)', async () => {
  const { cache, inFlight, duoId } = await setup();
  const { t, s } = await inFlight();
  cache.onSyncEvent({ type: 'session.revoked' });
  cache.openSession(camille.userId);                                   // même compte, nouvelle session
  assert.equal(cache.commit(t, s), 'session_changed'); assert.equal(cache.size, 0);
  const fresh = await inFlight(); assert.equal(cache.commit(fresh.t, fresh.s), 'stored');     // une lecture de la NOUVELLE session est acceptée
  assert.ok(cache.get(duoId, 'common', fresh.s.periodId));
});

test('Reconnexion du même compte SANS révocation explicite (openSession) : la lecture de l’ancienne session est refusée', async () => {
  const { cache, inFlight } = await setup();
  const { t, s } = await inFlight();
  cache.openSession(camille.userId);
  assert.equal(cache.commit(t, s), 'session_changed');
});

test('CHANGEMENT DE COMPTE : la réponse destinée à l’ancien compte est refusée et rien de l’ancien compte n’est lisible', async () => {
  const { cache, inFlight, duoId } = await setup();
  const first = await inFlight(); assert.equal(cache.commit(first.t, first.s), 'stored');
  const late = await inFlight();
  cache.openSession(alex.userId);
  assert.equal(cache.size, 0);
  assert.equal(cache.get(duoId, 'common', first.s.periodId), null);
  assert.equal(cache.commit(late.t, late.s), 'session_changed');
  const forged = cache.beginRead(duoId, 'common')!;                   // ticket d'Alex, réponse de Camille
  assert.equal(cache.commit(forged, late.s), 'viewer_mismatch');
});

test('PERTE D’APPARTENANCE : purge, lecture en vol refusée, nouvelles lectures refusées jusqu’à confirmation serveur', async () => {
  const { cache, inFlight, duoId } = await setup();
  const ok = await inFlight(); assert.equal(cache.commit(ok.t, ok.s), 'stored');
  const late = await inFlight();
  cache.onSyncEvent({ type: 'member.changed', duoId, userId: camille.userId, status: 'left' });
  assert.equal(cache.size, 0);
  assert.equal(cache.commit(late.t, late.s), 'purged_since_read');
  assert.equal(cache.beginRead(duoId, 'common'), null);                // plus aucune lecture pour ce duo
  assert.equal(cache.get(duoId, 'common', ok.s.periodId), null);
  cache.membershipConfirmed(duoId);                                    // nouvel épisode (ex. : invitation de nouveau acceptée)
  assert.equal(cache.commit(late.t, late.s), 'purged_since_read');      // le ticket de l'épisode précédent reste périmé
  const again = await inFlight(); assert.equal(cache.commit(again.t, again.s), 'stored');
});

test('Départ du PARTENAIRE : pas de purge de mes données, seulement une revalidation', async () => {
  const { cache, inFlight, duoId } = await setup();
  const r = await inFlight(); assert.equal(cache.commit(r.t, r.s), 'stored');
  cache.onSyncEvent({ type: 'member.changed', duoId, userId: alex.userId, status: 'left' });
  assert.equal(cache.get(duoId, 'common', r.s.periodId)!.syncStatus, 'stale');
});

test('PURGE TOTALE en cours de session : lecture en vol refusée', async () => {
  const { cache, inFlight } = await setup();
  const { t, s } = await inFlight(); cache.purgeAll();
  assert.equal(cache.commit(t, s), 'purged_since_read');
});

test('Version plus ancienne arrivée en retard : jamais d’écrasement', async () => {
  const { be, cache, inFlight, duoId } = await setup();
  const old = await inFlight();
  await be.setEnvelopeProtection({ duoId, envelopeId: 'env-loisirs', protected: true });          // modifie l'instantané (version + 1)
  const recent = await inFlight(); assert.equal(cache.commit(recent.t, recent.s), 'stored');
  assert.ok(BigInt(recent.s.version) > BigInt(old.s.version));
  assert.equal(cache.commit(old.t, old.s), 'older_version');
  assert.equal(cache.get(duoId, 'common', recent.s.periodId)!.version, recent.s.version);
});

test('Cible incohérente (autre duo ou autre espace que le ticket) : refusée', async () => {
  const { cache, inFlight } = await setup();
  const { t, s } = await inFlight();
  assert.equal(cache.commit(t, { ...structuredClone(s), duoId: 'autre-duo' }), 'target_mismatch');
  assert.equal(cache.commit(t, { ...structuredClone(s), scope: 'personal' }), 'target_mismatch');
  assert.equal(cache.commit(t, asViewer(s, alex.userId)), 'viewer_mismatch');
});

test('Sans session : aucun ticket, aucune lecture', () => {
  const c = new EnvelopeCache();
  assert.equal(c.beginRead('d', 'common'), null); assert.equal(c.get('d', 'common', 'p'), null);
  assert.throws(() => c.openSession(''));
});
