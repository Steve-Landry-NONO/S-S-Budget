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

import type { Capability, EnvelopeListSnapshot, EnvelopeScope, ProtectionState } from './envelopeRead.contract.ts';

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
  /** REV-07 : prévisions explicitement disponibles, partielles ou indisponibles. Le serveur (006r1 → fonds réels) ne modélise
   *  pas les opérations programmées (R-B2, lot G-E) : l'adaptateur Supabase renvoie `not_available('planned_expenses_not_modeled')`,
   *  jamais un zéro. Jamais l'objectif. */
  forecast: Capability<Money>;
  upcomingContributions: Capability<Money>;
  plannedExpenses: Capability<Money>;
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
/** 'transfer' = réallocation BUDGÉTAIRE (duo_v3_post_transfer) ; 'funds_move' = mouvement de FONDS RÉELS (duo_v3_move_funds). G6. */
export type OperationKind = 'expense' | 'contribution' | 'transfer' | 'funds_move' | 'carry' | 'allocation' | 'reversal';
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
export interface PostContributionCmd extends CommandBase {
  duoId: Uuid; amountMinor: MinorUnits; status: 'planned' | 'done'; occurredOn: IsoDate;
  /** G7 (duo_v3_post_contribution_assigned) : affectation immédiate de tout ou partie à des enveloppes ; le reste est non affecté. */
  assignments?: Array<{ envelopeId: Uuid; amountMinor: MinorUnits }>;
}
/** G6 — Réallocation BUDGÉTAIRE entre réserve budgétaire et enveloppes (duo_v3_post_transfer). Ne déplace AUCUN argent réel. */
export interface ReallocateBudgetCmd extends CommandBase {
  duoId: Uuid; from: { kind: 'reserve' } | { kind: 'envelope'; envelopeId: Uuid };
  to: { kind: 'reserve' } | { kind: 'envelope'; envelopeId: Uuid }; amountMinor: MinorUnits;
}
/** @deprecated Ambigu (G6) : utiliser `reallocateBudget` (budget) ou `moveRealFunds` (argent réel). */
export type TransferCmd = ReallocateBudgetCmd;
/** G6 — Mouvement de FONDS RÉELS (duo_v3_move_funds) : non affectés ↔ enveloppe, ou enveloppe → enveloppe. Ne change pas la trésorerie. */
export interface MoveRealFundsCmd extends CommandBase {
  duoId: Uuid; from: { kind: 'unassigned' } | { kind: 'envelope'; envelopeId: Uuid };
  to: { kind: 'unassigned' } | { kind: 'envelope'; envelopeId: Uuid }; amountMinor: MinorUnits;
}
/** G7 — Protection (R-B6) : protéger = immédiat ; lever = double accord (le demandeur ne s'approuve pas). */
export interface SetEnvelopeProtectionCmd { duoId: Uuid; envelopeId: Uuid; protected: boolean }
/** G7 — Plan de libération avant annulation d'une contribution affectée (R-B5, duo_v3_contribution_release_plan). */
export interface ContributionReleasePlan {
  operationId: Uuid; cancellable: boolean;
  items: Array<{ account: 'unassigned' | 'envelope'; envelopeId: Uuid | null; required: MinorUnits; available: MinorUnits; toRelease: MinorUnits; protected: boolean }>;
}
/** G9 — Espaces de l'utilisateur authentifié, résolus par le serveur (jamais saisis ni devinés par l'écran). */
export interface MySpaces { duoId: Uuid | null; personalSpaceId: Uuid | null }
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
  | 'ADMIN_CATCH_UP_REQUIRED' | 'HOUSEHOLD_ARCHIVED' | 'PERSONAL_SPACE'
  // v3.2 (26/11) : réponse serveur non conforme au contrat (validation d'exécution) ; espace sans période ouverte
  | 'CONTRACT_VIOLATION' | 'SPACE_NOT_INITIALIZED';

export class DuoError extends Error {
  readonly code: DuoErrorCode; readonly retryable: boolean; readonly sqlstate: string | null;
  constructor(code: DuoErrorCode, message: string, opts: { retryable?: boolean; sqlstate?: string | null } = {}) {
    super(message); this.name = 'DuoError'; this.code = code;
    this.retryable = opts.retryable ?? (code === 'NETWORK' || code === 'RATE_LIMITED');
    this.sqlstate = opts.sqlstate ?? null;
  }
}

/** Messages PUBLICS stables par code. Le message brut du serveur (noms de tables, contraintes, valeurs) n'est jamais exposé. */
export const PUBLIC_MESSAGES: Readonly<Record<DuoErrorCode, string>> = Object.freeze({
  UNAUTHENTICATED: 'Connexion requise.', SESSION_EXPIRED: 'Session expirée : reconnectez-vous.', FORBIDDEN: 'Accès non autorisé à cet espace.',
  NOT_FOUND: 'Élément introuvable.', VALIDATION: 'Saisie invalide.', IDEMPOTENCY_MISMATCH: 'Opération déjà envoyée avec un contenu différent.',
  VERSION_CONFLICT: 'Modifiée entre-temps : rechargez avant de réessayer.', DUO_FULL: 'Le duo compte déjà deux membres.',
  ALREADY_MEMBER: 'Vous êtes déjà membre de ce duo.', ALREADY_IN_ANOTHER_DUO: 'Vous êtes déjà membre d\'un autre duo.',
  INVITATION_INVALID: 'Invitation invalide ou expirée.', INSUFFICIENT_FUNDS: 'Montant supérieur au solde de la source.',
  ENVELOPE_ARCHIVED: 'Enveloppe archivée : choisissez une enveloppe active.', PERIOD_CLOSED: 'Période clôturée.',
  CURRENCY_MISMATCH: 'Devise incompatible avec cet espace.', REQUEST_ALREADY_PENDING: 'Une demande est déjà en attente.',
  RATE_LIMITED: 'Trop de demandes : réessayez dans un instant.', NETWORK: 'Réseau indisponible.', UNKNOWN_OUTCOME: 'Résultat inconnu : vérification en cours.',
  SERVER: 'Erreur serveur.', INSUFFICIENT_REAL_FUNDS: 'Fonds réels insuffisants.', RELEASE_FUNDS_FIRST: 'Libérez d\'abord les fonds affectés.',
  ENVELOPE_PROTECTED: 'Enveloppe protégée : accord des deux membres requis.', SECOND_MEMBER_REQUIRED: 'Votre partenaire doit accepter.',
  ADMIN_CATCH_UP_REQUIRED: 'Rattrapage administratif requis.', HOUSEHOLD_ARCHIVED: 'Duo archivé.', PERSONAL_SPACE: 'Un espace personnel ne se partage pas.',
  CONTRACT_VIOLATION: 'Réponse serveur inattendue.', SPACE_NOT_INITIALIZED: 'Espace non initialisé.',
});
export const publicError = (code: DuoErrorCode, sqlstate: string | null = null, retryable?: boolean) =>
  new DuoError(code, PUBLIC_MESSAGES[code], { sqlstate, retryable });

/** Correspondance SQLSTATE → code métier, telle que les RPC 001-005 et le prototype lot 3 la produisent.
 *  Les RPC définitives devraient lever `using detail = '<CODE>'` pour lever toute ambiguïté (23514, 23503). */
const HINTS: Record<string, DuoErrorCode> = {
  insufficient_real_funds: 'INSUFFICIENT_REAL_FUNDS', release_funds_first: 'RELEASE_FUNDS_FIRST', envelope_protected: 'ENVELOPE_PROTECTED',
  second_member_required: 'SECOND_MEMBER_REQUIRED', admin_catch_up_required: 'ADMIN_CATCH_UP_REQUIRED', choose_active_envelope: 'ENVELOPE_ARCHIVED',
};
export function errorFromPostgrest(e: { code?: string; message?: string; details?: string | null; hint?: string | null }): DuoError {
  // Le message brut ne sert qu'à départager quelques SQLSTATE ambigus ; il n'est JAMAIS recopié dans l'erreur exposée.
  const raw = e.message ?? '', code = e.code ?? null;
  const hinted = HINTS[(e.hint ?? '').trim()];
  if (hinted) return publicError(hinted, code);
  const rawDetail = (e.details ?? '').trim();
  if (rawDetail === 'PERSONAL_SPACE' || rawDetail === 'HOUSEHOLD_ARCHIVED') return publicError(rawDetail, code);
  const known: DuoErrorCode[] = ['DUO_FULL', 'INSUFFICIENT_FUNDS', 'ENVELOPE_ARCHIVED', 'PERIOD_CLOSED', 'VERSION_CONFLICT', 'REQUEST_ALREADY_PENDING', 'ALREADY_IN_ANOTHER_DUO'];
  if ((known as string[]).includes(rawDetail)) return publicError(rawDetail as DuoErrorCode, code);
  switch (e.code) {
    case '42501': return publicError(/authentication required/i.test(raw) ? 'UNAUTHENTICATED' : 'FORBIDDEN', code);
    case 'PGRST301': case 'PGRST303': return publicError('SESSION_EXPIRED', code);
    case '22023': return publicError('VALIDATION', code);
    case '23505': return publicError(/already a member/i.test(raw) ? 'ALREADY_MEMBER' : 'IDEMPOTENCY_MISMATCH', code);
    case '23503': return publicError('NOT_FOUND', code);
    case '23514': return publicError(/full/i.test(raw) ? 'DUO_FULL' : 'VALIDATION', code);
    case 'P0002': return publicError('INVITATION_INVALID', code);
    default: return publicError('SERVER', code);
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
  /** Déconnexion : l'adaptateur émet `session.revoked` ; le client purge TOUT cache local (REV-04). */
  signOut(): Promise<void>;
  /** G9 : espaces de l'utilisateur authentifié (duo actif, espace personnel), résolus côté serveur. */
  mySpaces(): Promise<MySpaces>;
  /** G9 (duo_v3_create_personal_space) : idempotent ; renvoie l'espace existant le cas échéant. */
  createPersonalSpace(cmd: { clientOperationId: Uuid; currency: CurrencyCode }): Promise<CommandResult<{ personalSpaceId: Uuid }>>;
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
  /** Sprint 3 : instantané des enveloppes d'un espace (commun ou personnel), en une seule lecture serveur.
   *  'personal' : l'adaptateur lit l'espace personnel DE LA SESSION (`mySpaces().personalSpaceId`), jamais un identifiant fourni par l'écran. */
  getEnvelopeSnapshot(duoId: Uuid, scope: EnvelopeScope): Promise<EnvelopeListSnapshot>;
  listOperations(duoId: Uuid, q: { cursor?: string; limit?: number; envelopeId?: Uuid; includeCancelled?: boolean }): Promise<Page<OperationView>>;
  getOperationStatus(duoId: Uuid, clientOperationId: Uuid): Promise<OperationStatusLookup>;

  // commandes financières
  postExpense(cmd: PostExpenseCmd): Promise<CommandResult>;
  postContribution(cmd: PostContributionCmd): Promise<CommandResult>;
  /** G6 : réallocation BUDGÉTAIRE (aucun argent réel ne bouge). */
  reallocateBudget(cmd: ReallocateBudgetCmd): Promise<CommandResult>;
  /** @deprecated G6 : alias de `reallocateBudget`, conservé pour les écrans existants. */
  transfer(cmd: TransferCmd): Promise<CommandResult>;
  /** G6/G7 : mouvement de FONDS RÉELS (protection et fonds insuffisants refusés côté serveur). */
  moveRealFunds(cmd: MoveRealFundsCmd): Promise<CommandResult>;
  /** G7 : renvoie l'état de protection RÉSULTANT ('lift_pending' tant que le second membre n'a pas accepté). */
  setEnvelopeProtection(cmd: SetEnvelopeProtectionCmd): Promise<CommandResult<{ protectionState: ProtectionState }>>;
  getContributionReleasePlan(duoId: Uuid, operationId: Uuid): Promise<ContributionReleasePlan>;
  editOperation(cmd: EditOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  cancelOperation(cmd: CancelOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  restoreOperation(cmd: CancelOperationCmd): Promise<CommandResult<{ operationId: Uuid; version: number }>>;
  proposeSplit(cmd: ProposeSplitCmd): Promise<CommandResult<{ proposalId: Uuid }>>;

  // synchronisation
  subscribe(duoId: Uuid, onEvent: (e: SyncEvent) => void): () => void;
}
