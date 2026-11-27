// Duo Budget V3 — adaptateur de données fictives pour le développement et la recette UI.
// Implémente `DuoBackend` en mémoire en reproduisant les règles qualifiées ou validées :
// idempotence par clientOperationId (empreinte de charge), confidentialité des dépenses privées
// (y compris dans les totaux), plafond de 2 membres, transfert sans découvert (arbitrage 21/11),
// dépense en dépassement autorisée avec avertissement (D-016), contrôle de version (D-019/D-020 dépôt),
// 5 notions de solde (page 13). Pannes simulables : réseau, résultat inconnu, latence.
// N'utiliser qu'en développement : rien n'est persistant, aucune sécurité réelle.
import { DuoError, MINOR_DIGITS } from './duoBackend.contract.ts';
import { buildSnapshot, SPRINT3_COMMON_ROWS, SPRINT3_PERSONAL_ROWS } from './envelopeFixtures.ts';
import type { EnvelopeRow } from './envelopeFixtures.ts';
import { available } from './envelopeRead.contract.ts';
import type { EnvelopeListSnapshot, EnvelopeScope, ProtectionState } from './envelopeRead.contract.ts';
import type {
  DuoBackend, Uuid, Money, CurrencyCode, CommandResult, DuoSnapshot, DuoSummary, MemberView, OperationView,
  PostExpenseCmd, PostContributionCmd, TransferCmd, EditOperationCmd, CancelOperationCmd, CreateDuoCmd,
  CreateInvitationCmd, ProposeSplitCmd, SyncEvent, Warning, InvitationView, Me,
  ReallocateBudgetCmd, MoveRealFundsCmd, SetEnvelopeProtectionCmd, CurrencyCode as Ccy,
} from './duoBackend.contract.ts';

export interface MockOptions {
  now?: () => Date;
  latencyMs?: number;
  /** Injection de pannes pour la recette des états K3, S3, S4, Y2. */
  fault?: (method: string, attempt: number) => 'none' | 'network' | 'unknown_outcome';
  uuid?: () => Uuid;
}

type Op = OperationView & { duoId: Uuid; fingerprint: string };
interface Duo {
  duoId: Uuid; name: string; currency: CurrencyCode; cycleStartDay: number; timezone: string;
  members: MemberView[]; envelopes: Map<Uuid, { name: string; icon: string; allocation: bigint; carryPositive: boolean; status: 'active' | 'archived' }>;
  budgetTarget: bigint; invitation: (InvitationView & { token: string }) | null;
}

const ZERO = 0n;
const big = (m: string) => BigInt(m);
const money = (v: bigint, c: CurrencyCode): Money => ({ minor: v.toString(), currency: c });

function requirePositiveMinor(v: string): bigint {
  if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v)) throw new DuoError('VALIDATION', 'amountMinor must be a positive integer string');
  return BigInt(v);
}

export function createMockBackend(currentUser: Me, opts: MockOptions = {}): DuoBackend & {
  _seed: MockSeed; _switchUser(u: Me): void;
} {
  const now = opts.now ?? (() => new Date());
  const uuid = opts.uuid ?? (() => crypto.randomUUID());
  let me = currentUser;
  const duos = new Map<Uuid, Duo>();
  const ops: Op[] = [];
  const attempts = new Map<string, number>();
  const listeners = new Map<Uuid, Set<(e: SyncEvent) => void>>();
  // Sprint 3 : lignes d'enveloppes par espace ; le personnel est indexé par (duo, propriétaire).
  const commonRows = new Map<Uuid, EnvelopeRow[]>();
  const personalRows = new Map<string, EnvelopeRow[]>();
  let envelopeVersion = 0;
  const unassigned = new Map<Uuid, bigint>();                 // fonds réels non affectés de l'espace commun (fictif)
  const unassignedOf = (duoId: Uuid) => unassigned.get(duoId) ?? 0n;
  const liftRequests = new Map<Uuid, Uuid>();                 // enveloppe → demandeur de la levée (R-B6)
  const personalSpaces = new Map<Uuid, Uuid>();               // utilisateur → espace personnel (G9)
  const emit = (duoId: Uuid, e: SyncEvent) => listeners.get(duoId)?.forEach(fn => fn(e));

  async function gate(method: string, key: string) {
    if (opts.latencyMs) await new Promise(r => setTimeout(r, opts.latencyMs));
    const n = (attempts.get(method + key) ?? 0) + 1; attempts.set(method + key, n);
    const f = opts.fault?.(method, n) ?? 'none';
    if (f === 'network') throw new DuoError('NETWORK', 'Réseau indisponible');
    return f;
  }
  function duoOf(id: Uuid): Duo {
    const d = duos.get(id);
    if (!d || !d.members.some(m => m.userId === me.userId && m.status === 'active')) throw new DuoError('FORBIDDEN', 'Not authorized for this household');
    return d;
  }
  const visible = (o: Op) => o.visibility === 'shared' || o.authorUserId === me.userId;
  const stamp = () => now().toISOString();

  function envelopeBudgetBalance(d: Duo, envelopeId: Uuid): bigint {
    const e = d.envelopes.get(envelopeId)!; let v = e.allocation;
    for (const o of ops) {
      if (o.duoId !== d.duoId || o.status !== 'done' || o.visibility !== 'shared') continue;
      if (o.kind === 'expense' && o.envelopeId === envelopeId) v -= big(o.amount.minor);
      if (o.kind === 'transfer') {
        if (o.fromEnvelopeId === envelopeId) v -= big(o.amount.minor);
        if (o.toEnvelopeId === envelopeId) v += big(o.amount.minor);
      }
    }
    return v;
  }
  function reserveOf(d: Duo): bigint {
    let v = ZERO;
    for (const o of ops) if (o.duoId === d.duoId && (o.kind === 'transfer' || o.kind === 'carry') && o.status === 'done') {
      if (o.fromEnvelopeId === null) v -= big(o.amount.minor);
      if (o.toEnvelopeId === null) v += big(o.amount.minor);
    }
    return v;
  }

  /** Idempotence (REV-02, aligné sur le serveur : portée = duo × AUTEUR AUTHENTIFIÉ × clé) : même clé + même charge → même
   *  résultat ; charge différente → IDEMPOTENCY_MISMATCH. La même clé utilisée par l'AUTRE membre est une opération distincte. */
  function replay(duoId: Uuid, clientOperationId: Uuid, fingerprint: string): Op | null {
    const prev = ops.find(o => o.duoId === duoId && o.authorUserId === me.userId && o.clientOperationId === clientOperationId);
    if (!prev) return null;
    if (prev.fingerprint !== fingerprint) throw new DuoError('IDEMPOTENCY_MISMATCH', 'Idempotency key reused for different operation', { sqlstate: '23505' });
    return prev;
  }
  async function commit<T>(method: string, key: string, apply: () => { data: T; warnings: Warning[]; replayed: boolean }): Promise<CommandResult<T>> {
    const f = await gate(method, key);
    const r = apply();                                   // l'effet a lieu…
    if (f === 'unknown_outcome') throw new DuoError('UNKNOWN_OUTCOME', 'Réponse perdue après envoi', { retryable: false }); // …mais la réponse est perdue
    return { status: 'confirmed', serverTime: stamp(), replayed: r.replayed, data: r.data, warnings: r.warnings };
  }

  function addOp(d: Duo, partial: Omit<Op, 'operationId' | 'receivedAt' | 'periodId' | 'lateImputation' | 'version' | 'duoId'>): Op {
    const o: Op = { ...partial, duoId: d.duoId, operationId: uuid(), receivedAt: stamp(), periodId: 'mock-period', lateImputation: false, version: 1 };
    ops.push(o);
    emit(d.duoId, { type: 'snapshot.stale', duoId: d.duoId, reason: 'operation' });
    return o;
  }

  const api: DuoBackend & { _seed: MockSeed; _switchUser(u: Me): void } = {
    _switchUser(u: Me) { me = u; },
    _seed: undefined as unknown as MockSeed,
    async me() { return me; },
    async signOut() { for (const [, set] of listeners) set.forEach(fn => fn({ type: 'session.revoked' })); },
    async mySpaces() {
      const duo = [...duos.values()].find(d => d.members.some(m => m.userId === me.userId && m.status === 'active'));
      return { duoId: duo?.duoId ?? null, personalSpaceId: personalSpaces.get(me.userId) ?? null };
    },
    async createPersonalSpace(cmd: { clientOperationId: Uuid; currency: Ccy }) {
      return commit('createPersonalSpace', cmd.clientOperationId, () => {
        const existing = personalSpaces.get(me.userId);
        if (existing) return { data: { personalSpaceId: existing }, warnings: [], replayed: true };
        const id = uuid(); personalSpaces.set(me.userId, id); return { data: { personalSpaceId: id }, warnings: [], replayed: false };
      });
    },
    async listSessions() { return [{ sessionId: 'mock-session', deviceLabel: 'iPhone (démo)', lastActiveAt: stamp(), current: true }]; },
    async revokeSession() { /* sans effet en démo */ },
    async requestAccountDeletion() { return { exportUrl: null, effectiveAt: stamp() }; },

    async myDuos() {
      return [...duos.values()].filter(d => d.members.some(m => m.userId === me.userId && m.status === 'active')).map(d => summary(d));
    },
    async createDuo(cmd: CreateDuoCmd) {
      return commit('createDuo', cmd.clientOperationId, () => {
        if ([...duos.values()].some(d => d.members.some(m => m.userId === me.userId && m.status === 'active')))
          throw new DuoError('ALREADY_IN_ANOTHER_DUO', 'Un compte = un duo actif (règle proposée page 13 P7)');
        const duoId = uuid();
        duos.set(duoId, { duoId, name: cmd.name, currency: cmd.currency, cycleStartDay: cmd.cycleStartDay ?? 1, timezone: cmd.timezone,
          members: [{ userId: me.userId, displayName: me.displayName, role: 'owner', status: 'active', isMe: true, joinedAt: stamp() }],
          envelopes: new Map(), budgetTarget: ZERO, invitation: null });
        return { data: { duoId }, warnings: [], replayed: false };
      });
    },
    async createInvitation(cmd: CreateInvitationCmd) {
      return commit('createInvitation', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId);
        if (d.members.filter(m => m.status === 'active').length >= 2) throw new DuoError('DUO_FULL', 'Household is full', { sqlstate: '23514' });
        const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
        const expiresAt = new Date(now().getTime() + 48 * 3600e3).toISOString();
        d.invitation = { invitationId: uuid(), channel: cmd.channel, status: 'pending', createdBy: me.userId, createdAt: stamp(), expiresAt, token };
        return { data: { invitationId: d.invitation.invitationId, shareUrl: `duobudget://invite/${token}`, expiresAt }, warnings: [], replayed: false };
      });
    },
    async previewInvitation(token: string) {
      const d = [...duos.values()].find(x => x.invitation?.token === token && x.invitation.status === 'pending');
      if (!d || new Date(d.invitation!.expiresAt) <= now()) throw new DuoError('INVITATION_INVALID', 'Invitation invalid'); // S5 : même message
      const inviter = d.members.find(m => m.userId === d.invitation!.createdBy)!;
      return { duoName: d.name, inviterDisplayName: inviter.displayName, expiresAt: d.invitation!.expiresAt,
        alreadyMemberOfAnotherDuo: [...duos.values()].some(x => x.members.some(m => m.userId === me.userId && m.status === 'active')) };
    },
    async acceptInvitation(token: string) {
      return commit('acceptInvitation', token, () => {
        const d = [...duos.values()].find(x => x.invitation?.token === token);
        const inv = d?.invitation;
        if (!d || !inv || inv.status !== 'pending' || new Date(inv.expiresAt) <= now()) throw new DuoError('INVITATION_INVALID', 'Invitation invalid', { sqlstate: 'P0002' });
        if (d.members.some(m => m.userId === me.userId && m.status === 'active')) throw new DuoError('ALREADY_MEMBER', 'Already a member', { sqlstate: '23505' });
        if (d.members.filter(m => m.status === 'active').length >= 2) throw new DuoError('DUO_FULL', 'Household is full', { sqlstate: '23514' });
        d.members = d.members.filter(m => m.userId !== me.userId);
        d.members.push({ userId: me.userId, displayName: me.displayName, role: 'partner', status: 'active', isMe: false, joinedAt: stamp() });
        inv.status = 'accepted';
        emit(d.duoId, { type: 'member.changed', duoId: d.duoId, userId: me.userId, status: 'active' });
        return { data: { duoId: d.duoId }, warnings: [], replayed: false };
      });
    },
    async declineInvitation(token: string) {
      const d = [...duos.values()].find(x => x.invitation?.token === token && x.invitation.status === 'pending');
      if (d) d.invitation!.status = 'declined';               // réponse identique dans tous les cas (pas d'oracle)
    },
    async revokeInvitation(duoId: Uuid) { const d = duoOf(duoId); if (d.invitation?.status === 'pending') d.invitation.status = 'revoked'; },
    async leaveDuo(duoId: Uuid) {
      const d = duoOf(duoId); const m = d.members.find(x => x.userId === me.userId)!; m.status = 'left';
      if (d.invitation?.status === 'pending') d.invitation.status = 'revoked';
      emit(duoId, { type: 'member.changed', duoId, userId: me.userId, status: 'left' });
    },

    async getDuoSnapshot(duoId: Uuid): Promise<DuoSnapshot> {
      await gate('getDuoSnapshot', duoId);
      const d = duoOf(duoId); const c = d.currency;
      const shared = ops.filter(o => o.duoId === duoId && o.visibility === 'shared' && o.status !== 'cancelled');
      const sum = (f: (o: Op) => boolean) => shared.filter(f).reduce((a, o) => a + big(o.amount.minor), ZERO);
      const contribDone = sum(o => o.kind === 'contribution' && o.status === 'done');
      const contribPlanned = sum(o => o.kind === 'contribution' && o.status === 'planned');
      const expDone = sum(o => o.kind === 'expense' && o.status === 'done');
      const expPlanned = sum(o => o.kind === 'expense' && o.status === 'planned');
      const real = contribDone - expDone;
      const allocTotal = [...d.envelopes.values()].filter(e => e.status === 'active').reduce((a, e) => a + e.allocation, ZERO);
      const mine = ops.filter(o => o.duoId === duoId && o.visibility === 'private' && o.authorUserId === me.userId && o.status !== 'cancelled');
      const privDone = mine.filter(o => o.status === 'done').reduce((a, o) => a + big(o.amount.minor), ZERO);
      const privPlanned = mine.filter(o => o.status === 'planned').reduce((a, o) => a + big(o.amount.minor), ZERO);
      return {
        asOf: stamp(), periodId: 'mock-period', periodStartsOn: '2026-12-01', periodEndsBefore: '2027-01-01',
        // Données fictives : l'adaptateur fictif modélise le prévu ; l'adaptateur Supabase renverra `not_available` (REV-07).
        real: money(real, c), forecast: available(money(real + contribPlanned - expPlanned, c)),
        upcomingContributions: available(money(contribPlanned, c)), plannedExpenses: available(money(expPlanned, c)),
        contributionsDone: money(contribDone, c), budgetTarget: money(d.budgetTarget, c), reserve: money(reserveOf(d), c),
        fundingGap: money(allocTotal > contribDone ? allocTotal - contribDone : ZERO, c),
        envelopes: [...d.envelopes.entries()].map(([envelopeId, e]) => ({
          envelopeId, name: e.name, icon: e.icon, status: e.status, carryPositive: e.carryPositive,
          allocation: money(e.allocation, c), budgetBalance: money(envelopeBudgetBalance(d, envelopeId), c),
          spentDone: money(sum(o => o.kind === 'expense' && o.status === 'done' && o.envelopeId === envelopeId), c),
          spentPlanned: money(sum(o => o.kind === 'expense' && o.status === 'planned' && o.envelopeId === envelopeId), c),
        })),
        myPrivate: { spentDone: money(privDone, c), spentPlanned: money(privPlanned, c) },
      };
    },
    async getEnvelopeSnapshot(duoId: Uuid, scope: EnvelopeScope): Promise<EnvelopeListSnapshot> {
      await gate('getEnvelopeSnapshot', duoId + scope);
      const d = duoOf(duoId);
      const rows = scope === 'common' ? (commonRows.get(duoId) ?? []) : (personalRows.get(`${duoId}:${me.userId}`) ?? []);
      // Copie profonde : aucune référence partagée entre espaces ou utilisateurs (ENV-10).
      return structuredClone(buildSnapshot({ scope, duoId, ownerUserId: scope === 'personal' ? me.userId : null, viewerUserId: me.userId, currency: d.currency,
        rows, unassigned: scope === 'common' ? unassignedOf(duoId) : null, budgetReserve: scope === 'common' ? reserveOf(d) : 0n, asOf: stamp(), version: String(envelopeVersion) }));
    },
    async listOperations(duoId, q) {
      duoOf(duoId);
      const items = ops.filter(o => o.duoId === duoId && visible(o) && (q.includeCancelled || o.status !== 'cancelled')
        && (!q.envelopeId || o.envelopeId === q.envelopeId)).slice().reverse().slice(0, q.limit ?? 50)
        .map(({ fingerprint, duoId: _d, ...v }) => v);
      return { items, nextCursor: null };
    },
    async getOperationStatus(duoId, clientOperationId) {
      duoOf(duoId);
      const o = ops.find(x => x.duoId === duoId && x.authorUserId === me.userId && x.clientOperationId === clientOperationId);
      return o ? { found: true, operationId: o.operationId, status: o.status, version: o.version } : { found: false };
    },

    async postExpense(cmd: PostExpenseCmd) {
      return commit('postExpense', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId); const amount = requirePositiveMinor(cmd.amountMinor);
        const fp = JSON.stringify(['expense', cmd.visibility, cmd.envelopeId, cmd.amountMinor, cmd.status, cmd.occurredOn]);
        const prev = replay(d.duoId, cmd.clientOperationId, fp);
        if (prev) return { data: { operationId: prev.operationId }, warnings: [], replayed: true };
        if (cmd.visibility === 'shared') {
          const e = cmd.envelopeId ? d.envelopes.get(cmd.envelopeId) : undefined;
          if (!e) throw new DuoError('NOT_FOUND', 'Envelope not found', { sqlstate: '23503' });
          if (e.status === 'archived') throw new DuoError('ENVELOPE_ARCHIVED', 'Enveloppe archivée : choisir une enveloppe active');
        }
        const warnings: Warning[] = [];
        if (cmd.visibility === 'shared' && cmd.status === 'done') {
          const after = envelopeBudgetBalance(d, cmd.envelopeId!) - amount;
          if (after < ZERO) {
            if (!cmd.acknowledgeOverspend) throw new DuoError('VALIDATION', 'Dépassement : confirmation explicite requise (D-016)');
            warnings.push({ code: 'ENVELOPE_OVERSPENT', envelopeId: cmd.envelopeId!, budgetBalance: money(after, d.currency) });
          }
        }
        const o = addOp(d, { clientOperationId: cmd.clientOperationId, kind: 'expense', status: cmd.status, visibility: cmd.visibility,
          amount: money(amount, d.currency), envelopeId: cmd.visibility === 'shared' ? cmd.envelopeId : null,
          authorUserId: me.userId, payerUserId: cmd.payerUserId ?? null, label: cmd.label, occurredOn: cmd.occurredOn, fingerprint: fp });
        return { data: { operationId: o.operationId }, warnings, replayed: false };
      });
    },
    async postContribution(cmd: PostContributionCmd) {
      return commit('postContribution', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId); const amount = requirePositiveMinor(cmd.amountMinor);
        const fp = JSON.stringify(['contribution', cmd.amountMinor, cmd.status, cmd.occurredOn]);
        const prev = replay(d.duoId, cmd.clientOperationId, fp);
        if (prev) return { data: { operationId: prev.operationId }, warnings: [], replayed: true };
        const o = addOp(d, { clientOperationId: cmd.clientOperationId, kind: 'contribution', status: cmd.status, visibility: 'shared',
          amount: money(amount, d.currency), envelopeId: null, authorUserId: me.userId, payerUserId: me.userId, label: 'Versement',
          occurredOn: cmd.occurredOn, fingerprint: fp });
        return { data: { operationId: o.operationId }, warnings: [], replayed: false };
      });
    },
    async transfer(cmd: TransferCmd) { return api.reallocateBudget(cmd); },
    async reallocateBudget(cmd: ReallocateBudgetCmd) {
      return commit('reallocateBudget', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId); const amount = requirePositiveMinor(cmd.amountMinor);
        const fromId = cmd.from.kind === 'envelope' ? cmd.from.envelopeId : null;
        const toId = cmd.to.kind === 'envelope' ? cmd.to.envelopeId : null;
        const fp = JSON.stringify(['transfer', fromId, toId, cmd.amountMinor]);
        const prev = replay(d.duoId, cmd.clientOperationId, fp);
        if (prev) return { data: { operationId: prev.operationId }, warnings: [], replayed: true };
        if (fromId === toId) throw new DuoError('VALIDATION', 'Source and destination must differ', { sqlstate: '22023' });
        for (const id of [fromId, toId]) if (id) {
          const e = d.envelopes.get(id); if (!e) throw new DuoError('NOT_FOUND', 'Envelope not found', { sqlstate: '23503' });
          if (e.status === 'archived') throw new DuoError('ENVELOPE_ARCHIVED', 'Enveloppe archivée');
        }
        const source = fromId ? envelopeBudgetBalance(d, fromId) : reserveOf(d);
        if (source < amount) throw new DuoError('INSUFFICIENT_FUNDS', 'Un transfert ne rend jamais une source négative (arbitrage 21/11)', { sqlstate: '23514' });
        const o = addOp(d, { clientOperationId: cmd.clientOperationId, kind: 'transfer', status: 'done', visibility: 'shared',
          amount: money(amount, d.currency), envelopeId: toId, fromEnvelopeId: fromId, toEnvelopeId: toId,
          authorUserId: me.userId, payerUserId: null, label: 'Transfert', occurredOn: stamp().slice(0, 10), fingerprint: fp });
        return { data: { operationId: o.operationId }, warnings: [], replayed: false };
      });
    },
    async moveRealFunds(cmd: MoveRealFundsCmd) {
      return commit('moveRealFunds', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId); const amount = requirePositiveMinor(cmd.amountMinor);
        const fromId = cmd.from.kind === 'envelope' ? cmd.from.envelopeId : null, toId = cmd.to.kind === 'envelope' ? cmd.to.envelopeId : null;
        const fp = JSON.stringify(['funds_move', fromId, toId, cmd.amountMinor]);
        const prev = replay(d.duoId, cmd.clientOperationId, fp);
        if (prev) return { data: { operationId: prev.operationId }, warnings: [], replayed: true };
        if (fromId === toId) throw new DuoError('VALIDATION', 'Source et destination identiques', { sqlstate: '22023' });
        const rows = commonRows.get(d.duoId) ?? [];
        const row = (id: Uuid) => { const r = rows.find(x => x.envelopeId === id); if (!r) throw new DuoError('NOT_FOUND', 'Enveloppe introuvable', { sqlstate: '23503' }); return r; };
        const src = fromId ? row(fromId) : null, dst = toId ? row(toId) : null;
        if (src && (src.protectionState ?? 'none') !== 'none') throw new DuoError('ENVELOPE_PROTECTED', 'Enveloppe protégée (R-B6)', { sqlstate: '23514' });
        const srcReal = src ? (src.realCarryOver ?? 0n) + src.assignedRealFunds - src.realizedExpenses : unassignedOf(d.duoId);
        if (srcReal < amount) throw new DuoError('INSUFFICIENT_REAL_FUNDS', 'Fonds réels insuffisants', { sqlstate: '23514' });
        if (src) src.assignedRealFunds -= amount; else unassigned.set(d.duoId, unassignedOf(d.duoId) - amount);
        if (dst) dst.assignedRealFunds += amount; else unassigned.set(d.duoId, unassignedOf(d.duoId) + amount);
        envelopeVersion += 1;
        const o = addOp(d, { clientOperationId: cmd.clientOperationId, kind: 'funds_move', status: 'done', visibility: 'shared',
          amount: money(amount, d.currency), envelopeId: toId, fromEnvelopeId: fromId, toEnvelopeId: toId,
          authorUserId: me.userId, payerUserId: null, label: 'Mouvement de fonds réels', occurredOn: stamp().slice(0, 10), fingerprint: fp });
        return { data: { operationId: o.operationId }, warnings: [], replayed: false };
      });
    },
    async setEnvelopeProtection(cmd: SetEnvelopeProtectionCmd) {
      return commit('setEnvelopeProtection', cmd.envelopeId + String(cmd.protected), () => {
        const d = duoOf(cmd.duoId); const r = (commonRows.get(d.duoId) ?? []).find(x => x.envelopeId === cmd.envelopeId);
        if (!r) throw new DuoError('NOT_FOUND', 'Enveloppe introuvable', { sqlstate: '23503' });
        const cur: ProtectionState = r.protectionState ?? 'none'; let next: ProtectionState = cur;
        if (cmd.protected) { next = 'protected'; liftRequests.delete(r.envelopeId); }                       // protéger : immédiat
        else if (cur === 'protected') { next = 'lift_pending'; liftRequests.set(r.envelopeId, me.userId); }  // demande de levée
        else if (cur === 'lift_pending') {
          if (liftRequests.get(r.envelopeId) !== me.userId) { next = 'none'; liftRequests.delete(r.envelopeId); } // second accord
        }
        r.protectionState = next; envelopeVersion += 1;
        emit(d.duoId, { type: 'snapshot.stale', duoId: d.duoId, reason: 'allocation' });
        return { data: { protectionState: next }, warnings: [], replayed: false };
      });
    },
    async getContributionReleasePlan(duoId: Uuid, operationId: Uuid) {
      duoOf(duoId);
      if (!ops.some(o => o.duoId === duoId && o.operationId === operationId && o.kind === 'contribution')) throw new DuoError('NOT_FOUND', 'Opération introuvable');
      return { operationId, cancellable: true, items: [] };
    },
    async editOperation(cmd: EditOperationCmd) {
      return commit('editOperation', cmd.clientOperationId, () => {
        const d = duoOf(cmd.duoId); const o = ops.find(x => x.operationId === cmd.operationId && x.duoId === d.duoId && visible(x));
        if (!o) throw new DuoError('NOT_FOUND', 'Operation not found');
        if (o.version !== cmd.expectedVersion) throw new DuoError('VERSION_CONFLICT', 'Modifiée entre-temps par votre partenaire (Y1)');
        if (cmd.changes.amountMinor) o.amount = money(requirePositiveMinor(cmd.changes.amountMinor), d.currency);
        if (cmd.changes.label) o.label = cmd.changes.label;
        if (cmd.changes.status) o.status = cmd.changes.status;
        o.version += 1; emit(d.duoId, { type: 'operation.changed', duoId: d.duoId, operationId: o.operationId, version: o.version });
        return { data: { operationId: o.operationId, version: o.version }, warnings: [], replayed: false };
      });
    },
    async cancelOperation(cmd: CancelOperationCmd) { return setCancelled(cmd, true); },
    async restoreOperation(cmd: CancelOperationCmd) { return setCancelled(cmd, false); },
    async proposeSplit(cmd: ProposeSplitCmd) {
      return commit('proposeSplit', cmd.clientOperationId, () => {
        duoOf(cmd.duoId);
        if (cmd.shares.reduce((a, s) => a + s.basisPoints, 0) !== 10000) throw new DuoError('VALIDATION', 'La somme des parts doit faire 100 %');
        return { data: { proposalId: uuid() }, warnings: [], replayed: false };
      });
    },
    subscribe(duoId, onEvent) {
      if (!listeners.has(duoId)) listeners.set(duoId, new Set());
      listeners.get(duoId)!.add(onEvent); return () => listeners.get(duoId)!.delete(onEvent);
    },
  };

  async function setCancelled(cmd: CancelOperationCmd, cancel: boolean) {
    return commit(cancel ? 'cancel' : 'restore', cmd.clientOperationId, () => {
      const d = duoOf(cmd.duoId); const o = ops.find(x => x.operationId === cmd.operationId && x.duoId === d.duoId && visible(x));
      if (!o) throw new DuoError('NOT_FOUND', 'Operation not found');
      if (o.version !== cmd.expectedVersion) {
        // rejeu idempotent : l'état demandé est déjà atteint par cette même commande
        if ((o.status === 'cancelled') === cancel && o.version === cmd.expectedVersion + 1) return { data: { operationId: o.operationId, version: o.version }, warnings: [], replayed: true };
        throw new DuoError('VERSION_CONFLICT', 'Modifiée entre-temps');
      }
      o.status = cancel ? 'cancelled' : 'done'; o.version += 1;
      emit(d.duoId, { type: 'operation.changed', duoId: d.duoId, operationId: o.operationId, version: o.version });
      return { data: { operationId: o.operationId, version: o.version }, warnings: [], replayed: false };
    });
  }

  function summary(d: Duo): DuoSummary {
    const inv = d.invitation && d.invitation.status === 'pending' ? (({ token, ...v }) => v)(d.invitation) : null;
    return { duoId: d.duoId, name: d.name, currency: d.currency, currencyLocked: ops.some(o => o.duoId === d.duoId),
      cycleStartDay: d.cycleStartDay, timezone: d.timezone, status: 'active',
      seats: { active: d.members.filter(m => m.status === 'active').length, max: 2 },
      members: d.members.map(m => ({ ...m, isMe: m.userId === me.userId })), pendingInvitation: inv };
  }

  api._seed = {
    envelope(duoId, name, allocationMinor, icon = 'tag', carryPositive = true) {
      const id = uuid(); duos.get(duoId)!.envelopes.set(id, { name, icon, allocation: BigInt(allocationMinor), carryPositive, status: 'active' }); return id;
    },
    target(duoId, minor) { duos.get(duoId)!.budgetTarget = BigInt(minor); },
    archive(duoId, envelopeId) { duos.get(duoId)!.envelopes.get(envelopeId)!.status = 'archived'; },
    sprint3(duoId, personalOwner) {
      commonRows.set(duoId, SPRINT3_COMMON_ROWS.map(r => ({ ...r })));
      if (personalOwner) personalRows.set(`${duoId}:${personalOwner}`, SPRINT3_PERSONAL_ROWS.map(r => ({ ...r })));
      envelopeVersion += 1;
    },
    envelopeRows(duoId, scope, owner, rows) {
      if (scope === 'common') commonRows.set(duoId, rows); else personalRows.set(`${duoId}:${owner}`, rows);
      envelopeVersion += 1;
    },
    unassignedFunds(duoId, minor) { unassigned.set(duoId, BigInt(minor)); envelopeVersion += 1; },
    reserve(duoId, minor) {
      const d = duos.get(duoId)!;
      addOp(d, { clientOperationId: null, kind: 'carry', status: 'done', visibility: 'shared', amount: money(BigInt(minor), d.currency),
        envelopeId: null, fromEnvelopeId: undefined, toEnvelopeId: null, authorUserId: 'system', payerUserId: null,
        label: 'Report vers la réserve (D-014)', occurredOn: stamp().slice(0, 10), fingerprint: 'seed' });
    },
  };
  return api;
}

export interface MockSeed {
  envelope(duoId: Uuid, name: string, allocationMinor: string, icon?: string, carryPositive?: boolean): Uuid;
  target(duoId: Uuid, minor: string): void;
  archive(duoId: Uuid, envelopeId: Uuid): void;
  reserve(duoId: Uuid, minor: string): void;
  /** Fonds réels non affectés de l'espace commun (fictif). */
  unassignedFunds(duoId: Uuid, minor: string): void;
  /** Charge les fixtures de la PR #17 ; `personalOwner` reçoit l'exemple personnel « Lecture ». */
  sprint3(duoId: Uuid, personalOwner?: Uuid): void;
  envelopeRows(duoId: Uuid, scope: EnvelopeScope, owner: Uuid | null, rows: EnvelopeRow[]): void;
}

/** Formatage d'affichage (jamais de « -0,00 € », cf. F-01 de la PR #15). */
export function formatMoney(m: Money, locale = 'fr-FR'): string {
  const digits = MINOR_DIGITS[m.currency]; let v = BigInt(m.minor); const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(digits); const whole = (v / base).toString(); const frac = digits ? (v % base).toString().padStart(digits, '0') : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sym = { EUR: '€', USD: '$', GBP: '£', XAF: 'FCFA', XOF: 'FCFA', JPY: '¥' }[m.currency];
  const isZero = v === 0n;
  return `${neg && !isZero ? '−' : ''}${grouped}${digits ? ',' + frac : ''} ${sym}`.replace(/^/, locale ? '' : '');
}
