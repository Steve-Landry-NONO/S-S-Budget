// Duo Budget V3 — contrat d'intégration mobile ↔ backend cloud (PROPOSITION, 25/11/2026).
// Indépendant du transport : les écrans React Native ne parlent qu'à `DuoBackend`.
// Deux implémentations prévues : `createMockBackend` (recette UI, ce dossier) et un
// adaptateur Supabase (RPC + lectures RLS) à écrire quand les lots 2–4 seront appliqués sur DEV.
// Aucune URL de serveur ni secret n'est saisi par l'utilisateur : la configuration est
// embarquée au build (URL publique + clé publishable), la session vient de Supabase Auth.
//
// Règles transverses
//  * Montants : chaînes d'entiers en unités mineures (EUR 12,50 = "1250" ; XAF 1250 = "1250").
//    Jamais de nombre flottant. Le signe n'est porté que par les soldes, pas par les commandes.
//  * Chaque commande porte `clientOperationId` (UUID v4) créé AU MOMENT où l'utilisateur confirme,
//    persisté dans la file d'envoi, réutilisé tel quel à chaque nouvel essai. Il devient la clé
//    d'idempotence côté serveur.
//  * Aucun succès n'est affiché avant `status: 'confirmed'` (règle Motion V3.1 / page 13).
//  * Toute lecture de soldes passe par UN appel (`getDuoSnapshot`) : un seul instantané serveur
//    (qualification C04 : deux lectures successives peuvent se contredire).

import type { EnvelopeListSnapshot, EnvelopeScope } from './envelopeRead.contract.ts';

export type Uuid = string;
export type MinorUnits = string;            // /^-?(0|[1-9][0-9]*)$/
export type IsoDate = string;               // AAAA-MM-JJ, calendrier du duo
export type IsoDateTime = string;           // horodatage serveur, UTC
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'XAF' | 'XOF' | 'JPY';
export const MINOR_DIGITS: Readonly<Record<CurrencyCode, number>> =
  Object.freeze({ EUR: 2, USD: 2, GBP: 2, XAF: 0, XOF: 0, JPY: 0 });

export interface Money { minor: MinorUnits; currency: CurrencyCode }

// ---------------------------------------------------------------- identités et duo
export interface Me { userId: Uuid; email: string; emailVerified: boolean; displayName: string }

export type MemberStatus = 'active' | 'left';
export interface MemberView {
  userId: Uuid; displayName: string;        // « Ancien membre » après suppression de compte (D-006, à trancher)
  role: 'owner' | 'partner';                // marqueur administratif, aucun droit financier en plus (D-004)
  status: MemberStatus; isMe: boolean; joinedAt: IsoDateTime;
}

export interface DuoSummary {
  duoId: Uuid; name: string; currency: CurrencyCode; currencyLocked: boolean;   // figée à la 1re opération (D-005)
  cycleStartDay: number; timezone: string;  // D-011/D-012
  status: 'active' | 'archived';
  seats: { active: number; max: 2 };        // D-001
  members: MemberView[];
  pendingInvitation: InvitationView | null; // une seule à la fois (prototype lot 3)
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export interface InvitationView {
  invitationId: Uuid; channel: 'link' | 'email'; status: InvitationStatus;
  createdBy: Uuid; createdAt: IsoDateTime; expiresAt: IsoDateTime;
}
/** Vue d'Alex avant acceptation : aucun montant, aucune donnée financière (page 13, D2). */
export interface InvitationPreview { duoName: string; inviterDisplayName: string; expiresAt: IsoDateTime; alreadyMemberOfAnotherDuo: boolean }

// ---------------------------------------------------------------- soldes : 5 notions (page 13, BAL1–BAL3)
export interface EnvelopeBalance {
  envelopeId: Uuid; name: string; icon: string; status: 'active' | 'archived' | 'archive_scheduled';
  carryPositive: boolean;
  allocation: Money;                        // allocation de la période (budget, pas de l'argent)
  /** Solde BUDGÉTAIRE (allocation − dépenses ± transferts budgétaires). N'est PAS un disponible réel (lot D, 26/11) :
   *  le disponible réel est `EnvelopeReadModel.realAvailable` de `getEnvelopeSnapshot`. Peut être négatif (D-016 à D-018). */
  budgetBalance: Money;
  spentDone: Money; spentPlanned: Money;
}
export interface DuoSnapshot {
  asOf: IsoDateTime; periodId: Uuid; periodStartsOn: IsoDate; periodEndsBefore: IsoDate;
  real: Money;                    // versements réalisés − dépenses réalisées (seul argent disponible)
  forecast: Money;                // réel + versements à venir − dépenses programmées ; jamais l'objectif
  upcomingContributions: Money;   // planned
  plannedExpenses: Money;         // planned
  contributionsDone: Money;       // sur la période
  budgetTarget: Money;            // objectif de versements par cycle : ni dette ni argent
  reserve: Money;                 // réserve BUDGÉTAIRE commune (D-014) ; ≠ fonds réels non affectés (HouseholdFundsView.unassignedRealFunds)
  fundingGap: Money;              // allocations − versements, « funding_alert » du lot 2
  /** @deprecated Lecture budgétaire seule : utiliser `getEnvelopeSnapshot` (contrat v3) pour tout affichage d'enveloppe. */
  envelopes: EnvelopeBalance[];
  /** @deprecated Totaux seulement, insuffisant pour le Sprint 3 : utiliser `getEnvelopeSnapshot(duoId, 'personal')`. */
  myPrivate: { spentDone: Money; spentPlanned: Money } | null;   // visible du seul propriétaire (D-007)
}

// ---------------------------------------------------------------- opérations et journal
export type OperationKind = 'expense' | 'contribution' | 'transfer' | 'carry' | 'allocation' | 'reversal';
export type OperationStatus = 'planned' | 'done' | 'cancelled';
export interface OperationView {
  operationId: Uuid; clientOperationId: Uuid | null; kind: OperationKind; status: OperationStatus;
  visibility: 'shared' | 'private'; amount: Money;
  envelopeId: Uuid | null; fromEnvelopeId?: Uuid | null; toEnvelopeId?: Uuid | null;
  authorUserId: Uuid;            // pastille = auteur de saisie (STI-08)
  payerUserId: Uuid | null;      // informatif, aucune dette automatique (roadmap 24/11)
  label: string;
  occurredOn: IsoDate;           // date réelle déclarée        } trois dates (D-029, page 07)
  receivedAt: IsoDateTime;       // réception serveur           }
  periodId: Uuid;                // cycle d'imputation          }
  lateImputation: boolean;       // reçue après clôture, imputée au cycle ouvert
  version: number;               // contrôle de concurrence pour modifier/annuler (D-019/D-020 dépôt)
}
export interface Page<T> { items: T[]; nextCursor: string | null }

// ---------------------------------------------------------------- commandes
interface CommandBase { clientOperationId: Uuid }
export interface CreateDuoCmd extends CommandBase { name: string; currency: CurrencyCode; cycleStartDay?: number; timezone: string }
export interface CreateInvitationCmd extends CommandBase { duoId: Uuid; channel: 'link' | 'email'; targetEmail?: string }
export interface PostExpenseCmd extends CommandBase {
  duoId: Uuid; visibility: 'shared' | 'private'; envelopeId: Uuid | null; amountMinor: MinorUnits;
  status: 'planned' | 'done'; occurredOn: IsoDate; label: string; payerUserId?: Uuid;
  acknowledgeOverspend?: boolean;          // D-016 : avertissement non bloquant, confirmé par l'utilisateur
}
export interface PostContributionCmd extends CommandBase { duoId: Uuid; amountMinor: MinorUnits; status: 'planned' | 'done'; occurredOn: IsoDate }
export interface TransferCmd extends CommandBase {
  duoId: Uuid; from: { kind: 'reserve' } | { kind: 'envelope'; envelopeId: Uuid };
  to: { kind: 'reserve' } | { kind: 'envelope'; envelopeId: Uuid }; amountMinor: MinorUnits;
}
export interface EditOperationCmd extends CommandBase { duoId: Uuid; operationId: Uuid; expectedVersion: number; changes: Partial<Pick<PostExpenseCmd, 'amountMinor' | 'envelopeId' | 'status' | 'occurredOn' | 'label'>> }
export interface CancelOperationCmd extends CommandBase { duoId: Uuid; operationId: Uuid; expectedVersion: number }
export interface ProposeSplitCmd extends CommandBase { duoId: Uuid; shares: Array<{ userId: Uuid; basisPoints: number }> } // 10000 = 100 %

export type Warning =
  | { code: 'ENVELOPE_OVERSPENT'; envelopeId: Uuid; budgetBalance: Money }   // dépassement du budget (pas un solde réel)
  | { code: 'FUNDING_GAP'; gap: Money }
  | { code: 'LATE_IMPUTATION'; periodId: Uuid }
  | { code: 'TRANSFER_REQUIRES_AGREEMENT'; requestId: Uuid };     // D-019 page 07 / D-026–D-027

export type CommandResult<T = { operationId: Uuid }> =
  | { status: 'confirmed'; serverTime: IsoDateTime; replayed: boolean; data: T; warnings: Warning[] }
  | { status: 'pending_agreement'; serverTime: IsoDateTime; requestId: Uuid };

// ---------------------------------------------------------------- erreurs
export type DuoErrorCode =
  | 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'
  | 'IDEMPOTENCY_MISMATCH' | 'VERSION_CONFLICT' | 'DUO_FULL' | 'ALREADY_MEMBER' | 'ALREADY_IN_ANOTHER_DUO'
  | 'INVITATION_INVALID' | 'INSUFFICIENT_FUNDS' | 'ENVELOPE_ARCHIVED' | 'PERIOD_CLOSED' | 'CURRENCY_MISMATCH'
  | 'REQUEST_ALREADY_PENDING' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN_OUTCOME' | 'SERVER'
  // v3 (26/11) : refus métier signalés par un indice SQL explicite (hint), jamais déduits du message
  | 'INSUFFICIENT_REAL_FUNDS' | 'RELEASE_FUNDS_FIRST' | 'ENVELOPE_PROTECTED' | 'SECOND_MEMBER_REQUIRED'
  | 'ADMIN_CATCH_UP_REQUIRED' | 'HOUSEHOLD_ARCHIVED' | 'PERSONAL_SPACE';

export class DuoError extends Error {
  readonly code: DuoErrorCode; readonly retryable: boolean; readonly sqlstate: string | null;
  constructor(code: DuoErrorCode, message: string, opts: { retryable?: boolean; sqlstate?: string | null } = {}) {
    super(message); this.name = 'DuoError'; this.code = code;
    this.retryable = opts.retryable ?? (code === 'NETWORK' || code === 'RATE_LIMITED');
    this.sqlstate = opts.sqlstate ?? null;
  }
}

/** Correspondance SQLSTATE → code métier, telle que les RPC 001-005 et le prototype lot 3 la produisent.
 *  Les RPC définitives devraient lever `using detail = '<CODE>'` pour lever toute ambiguïté (23514, 23503). */
const HINTS: Record<string, DuoErrorCode> = {
  insufficient_real_funds: 'INSUFFICIENT_REAL_FUNDS', release_funds_first: 'RELEASE_FUNDS_FIRST', envelope_protected: 'ENVELOPE_PROTECTED',
  second_member_required: 'SECOND_MEMBER_REQUIRED', admin_catch_up_required: 'ADMIN_CATCH_UP_REQUIRED', choose_active_envelope: 'ENVELOPE_ARCHIVED',
};
export function errorFromPostgrest(e: { code?: string; message?: string; details?: string | null; hint?: string | null }): DuoError {
  const msg = e.message ?? 'Erreur serveur';
  const hinted = HINTS[(e.hint ?? '').trim()];
  if (hinted) return new DuoError(hinted, msg, { sqlstate: e.code ?? null });
  const rawDetail = (e.details ?? '').trim();
  if (rawDetail === 'PERSONAL_SPACE' || rawDetail === 'HOUSEHOLD_ARCHIVED') return new DuoError(rawDetail, msg, { sqlstate: e.code ?? null });
  const detail = rawDetail as DuoErrorCode;
  const known: DuoErrorCode[] = ['DUO_FULL', 'INSUFFICIENT_FUNDS', 'ENVELOPE_ARCHIVED', 'PERIOD_CLOSED', 'VERSION_CONFLICT', 'REQUEST_ALREADY_PENDING', 'ALREADY_IN_ANOTHER_DUO'];
  if (known.includes(detail)) return new DuoError(detail, msg, { sqlstate: e.code ?? null });
  switch (e.code) {
    case '42501': return new DuoError(/authentication required/i.test(msg) ? 'UNAUTHENTICATED' : 'FORBIDDEN', msg, { sqlstate: e.code });
    case 'PGRST301': case 'PGRST303': return new DuoError('SESSION_EXPIRED', msg, { sqlstate: e.code });
    case '22023': return new DuoError('VALIDATION', msg, { sqlstate: e.code });
    case '23505': return new DuoError(/already a member/i.test(msg) ? 'ALREADY_MEMBER' : 'IDEMPOTENCY_MISMATCH', msg, { sqlstate: e.code });
    case '23503': return new DuoError('NOT_FOUND', msg, { sqlstate: e.code });
    case '23514': return new DuoError(/full/i.test(msg) ? 'DUO_FULL' : 'VALIDATION', msg, { sqlstate: e.code });
    case 'P0002': return new DuoError('INVITATION_INVALID', msg, { sqlstate: e.code });
    default: return new DuoError('SERVER', msg, { sqlstate: e.code ?? null });
  }
}

// ---------------------------------------------------------------- événements de synchronisation
// Les événements ne transportent que des identifiants : le client relit l'instantané.
// Aucun montant, aucun libellé (notifications discrètes, D-007, page 13 H1).
export type SyncEvent =
  | { type: 'snapshot.stale'; duoId: Uuid; reason: 'operation' | 'period_closed' | 'allocation' | 'member' }
  | { type: 'operation.changed'; duoId: Uuid; operationId: Uuid; version: number }
  | { type: 'member.changed'; duoId: Uuid; userId: Uuid; status: MemberStatus }
  | { type: 'invitation.changed'; duoId: Uuid; invitationId: Uuid; status: InvitationStatus }
  | { type: 'proposal.changed'; duoId: Uuid; proposalId: Uuid; status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'to_review' }
  | { type: 'session.revoked' };

// ---------------------------------------------------------------- états d'écran
export type Remote<T> =
  | { state: 'idle' } | { state: 'loading' }
  | { state: 'ready'; data: T; asOf: IsoDateTime }
  | { state: 'refreshing'; data: T; asOf: IsoDateTime }       // données affichées, rafraîchissement en cours (S2)
  | { state: 'offline'; data: T | null; asOf: IsoDateTime | null } // S3 : lecture du cache, saisie en file
  | { state: 'error'; error: DuoError; data: T | null };

/** Cycle de vie d'une commande côté client (K1–K6, S3, Y1). */
export type CommandState =
  | { state: 'draft' }
  | { state: 'queued_offline'; clientOperationId: Uuid; queuedAt: IsoDateTime }   // « Non envoyée »
  | { state: 'sending'; clientOperationId: Uuid; attempt: number }
  | { state: 'confirmed'; result: CommandResult<unknown> }
  | { state: 'rejected'; error: DuoError }                                         // pas de nouvel essai automatique
  | { state: 'unknown_outcome'; clientOperationId: Uuid };                          // vérifier le statut avant tout nouvel essai

export type OperationStatusLookup = { found: false } | { found: true; operationId: Uuid; status: OperationStatus; version: number };

// ---------------------------------------------------------------- façade
export interface DuoBackend {
  // session (Supabase Auth côté adaptateur réel)
  me(): Promise<Me>;
  listSessions(): Promise<Array<{ sessionId: Uuid; deviceLabel: string; lastActiveAt: IsoDateTime; current: boolean }>>;
  revokeSession(sessionId: Uuid): Promise<void>;        // réauthentification récente exigée (R4)
  requestAccountDeletion(): Promise<{ exportUrl: string | null; effectiveAt: IsoDateTime }>; // R5, D-006 à trancher

  // duo et invitations
  myDuos(): Promise<DuoSummary[]>;
  createDuo(cmd: CreateDuoCmd): Promise<CommandResult<{ duoId: Uuid }>>;
  createInvitation(cmd: CreateInvitationCmd): Promise<CommandResult<{ invitationId: Uuid; shareUrl: string; expiresAt: IsoDateTime }>>;
  previewInvitation(token: string): Promise<InvitationPreview>;
  acceptInvitation(token: string): Promise<CommandResult<{ duoId: Uuid }>>;
  declineInvitation(token: string, message?: string): Promise<void>;
  revokeInvitation(duoId: Uuid, invitationId: Uuid): Promise<void>;
  leaveDuo(duoId: Uuid): Promise<void>;

  // lectures
  getDuoSnapshot(duoId: Uuid): Promise<DuoSnapshot>;
  /** Sprint 3 : instantané des enveloppes d'un espace (commun ou personnel), en une seule lecture serveur. */
  getEnvelopeSnapshot(duoId: Uuid, scope: EnvelopeScope): Promise<EnvelopeListSnapshot>;
  listOperations(duoId: Uuid, q: { cursor?: string; limit?: number; envelopeId?: Uuid; includeCancelled?: boolean }): Promise<Page<OperationView>>;
  getOperationStatus(duoId: Uuid, clientOperationId: Uuid): Promise<OperationStatusLookup>;

  // commandes financières
  postExpense(cmd: PostExpenseCmd): Promise<CommandResult>;
  postContribution(cmd: PostContributionCmd): Promise<CommandResult>;
  transfer(cmd: TransferCmd): Promise<CommandResult>;
  editOperation(cmd: EditOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  cancelOperation(cmd: CancelOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  restoreOperation(cmd: CancelOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  proposeSplit(cmd: ProposeSplitCmd): Promise<CommandResult<{ proposalId: Uuid }>>;

  // synchronisation
  subscribe(duoId: Uuid, onEvent: (e: SyncEvent) => void): () => void;
}
