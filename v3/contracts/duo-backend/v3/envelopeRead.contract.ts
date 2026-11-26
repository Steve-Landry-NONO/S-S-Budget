// Duo Budget V3 — contrat de LECTURE des enveloppes, VERSION 3 (26/11/2026), aligné sur le modèle hybride
// recommandé (lot B : livre des fonds réels affectés, POST006-03/04) et sur les quatre orientations UX validées
// du Sprint 3 (PR #17) : ENV-UX-01 cartes verticales, ENV-UX-02 espaces Commun et Personnel distincts,
// ENV-UX-03 disponible réel prioritaire, ENV-UX-04 enveloppes protégées en section dédiée.
// PROPOSITION. Lecture seule : aucune mutation n'est définie ici.
//
// Règles du contrat
//  * Montants : chaînes d'entiers signés en unités mineures (`MinorUnits`) ; `minorDigits` donne l'échelle.
//  * « Disponible réel » (`realAvailable`) provient EXCLUSIVEMENT des fonds réels affectés à l'enveloppe.
//    Un montant purement budgétaire (`budgetBalance`, `remainingBudget`, allocation) ne le remplace JAMAIS,
//    même à titre de repli : si la source ne modélise pas les fonds réels, l'état est `not_available`.
//  * Toute notion que la source ne fournit pas encore est un `Capability` explicite (`not_available`,
//    `not_declared`), jamais un zéro fictif ni un null ambigu.
//  * Un instantané = une réponse = un seul état serveur (`asOf`, `version`).
//  * Espace personnel : uniquement les enveloppes de l'utilisateur authentifié ; aucune donnée ni agrégat du
//    partenaire. Le serveur filtre ; clé de cache distincte par (duo, espace, utilisateur).
import type { CurrencyCode, IsoDate, IsoDateTime, MinorUnits, Uuid } from './duoBackend.contract.ts';

export const ENVELOPE_CONTRACT_VERSION = '3.2.0-candidate';
export type EnvelopeScope = 'common' | 'personal';
export type SyncStatus = 'fresh' | 'stale' | 'offline_cache';

/** Raison d'indisponibilité d'une notion. */
export type NotAvailableReason =
  | 'funds_not_modeled'          // source 006 seule : pas de fonds réels par enveloppe
  | 'funds_not_activated'        // modèle hybride présent, duo non encore activé
  | 'planned_expenses_not_modeled'
  | 'protection_not_modeled'
  | 'not_in_source'               // la réponse de la source ne contient pas cette notion
  | 'integrity_incident';         // REV-03 : invariant comptable rompu côté serveur ; aucun montant réel n'est affiché
/** Composantes manquantes d'une valeur partielle (REV-05). */
export type MissingComponent = 'planned_expenses' | 'planned_contributions';
/** Base de calcul d'une valeur partielle : 'contributions_only' = trésorerie + contributions attendues restantes, SANS dépenses prévues. */
export type PartialBasis = 'contributions_only';
/** Notion fournie, fournie PARTIELLEMENT (base explicite, composantes manquantes), non fournie (avec raison), ou non déclarée. */
export type Capability<T> =
  | { state: 'available'; value: T }
  | { state: 'partial'; value: T; basis: PartialBasis; missing: MissingComponent[] }
  | { state: 'not_available'; reason: NotAvailableReason }
  | { state: 'not_declared' };
export const available = <T>(value: T): Capability<T> => ({ state: 'available', value });
export const partial = <T>(value: T, basis: PartialBasis, missing: MissingComponent[]): Capability<T> => ({ state: 'partial', value, basis, missing });
export const notAvailable = <T>(reason: NotAvailableReason): Capability<T> => ({ state: 'not_available', reason });

/** 'lift_pending' : levée demandée, en attente du second accord (R-B6) ; les fonds restent protégés. */
export type ProtectionState = 'none' | 'protected' | 'lift_pending';
/** États cumulables, libellés indépendants de la couleur (ENV-19). */
export type EnvelopeFlag = 'unfunded_target' | 'real_deficit' | 'budget_overrun' | 'protected' | 'archived';

export interface EnvelopeReadModel {
  envelopeId: Uuid; name: string; iconKey: string; status: 'active' | 'archived';
  protection: Capability<ProtectionState>;
  // ---- livre budget (objectifs) : jamais présentés comme de l'argent disponible
  /** Budget cible du cycle. */
  target: MinorUnits;
  /** Allocation budgétaire passée pour le cycle. */
  budgetAllocation: MinorUnits;
  /** Report budgétaire entrant (D-013 / D-017 / D-018). */
  carryOver: MinorUnits;
  realizedExpenses: MinorUnits;
  /** BUDGET RESTANT = carryOver + target − realizedExpenses. N'est pas de l'argent disponible. */
  remainingBudget: MinorUnits;
  /** Solde du compte budgétaire de l'enveloppe. N'est pas de l'argent disponible. */
  budgetBalance: MinorUnits;
  // ---- livre funds (argent réel)
  /** Fonds réels affectés à l'enveloppe pendant le cycle (net des désaffectations et annulations). */
  assignedRealFunds: Capability<MinorUnits>;
  /** Fonds réels reportés des cycles précédents (positifs ou négatifs). */
  realCarryOver: Capability<MinorUnits>;
  /** DISPONIBLE RÉEL (prioritaire, ENV-UX-03) = fonds réels de l'enveloppe. Négatif = déficit réel. */
  realAvailable: Capability<MinorUnits>;
  /** Part de la cible non financée par des fonds réels = max(target − assignedRealFunds, 0). */
  unfundedTarget: Capability<MinorUnits>;
  // ---- prévisions
  plannedExpenses: Capability<MinorUnits>;
  plannedAssignments: Capability<MinorUnits>;
  /** PRÉVISIONNEL = realAvailable + plannedAssignments − plannedExpenses. */
  forecastBalance: Capability<MinorUnits>;
  /** Progression de consommation exacte ; null si carryOver + target ≤ 0 (ENV-07). */
  consumption: { numerator: MinorUnits; denominator: MinorUnits } | null;
  flags: EnvelopeFlag[];
}

export interface HouseholdFundsView {
  /** Trésorerie réelle du duo (ou de l'espace personnel). */
  realTreasury: MinorUnits;
  /** Fonds réels non affectés (« réserve réelle »). */
  unassignedRealFunds: Capability<MinorUnits>;
  assignedRealFunds: Capability<MinorUnits>;
  /** Réserve BUDGÉTAIRE (D-014) : reliquats de budget, pas de l'argent mis de côté. */
  budgetReserve: MinorUnits;
  /** Contributions ATTENDUES selon la répartition hybride (R-B3) : objectif, jamais de l'argent ni une dette. */
  expectedContributions: Capability<MinorUnits>;
  /** 'agreed' : répartition acceptée par les deux ; 'provisional' : proposition non acceptée (CF-10) ; 'not_configured'. */
  expectedContributionsState: 'agreed' | 'provisional' | 'not_configured';
  expectedByMember: Array<{ userId: Uuid; expected: MinorUnits; realized: MinorUnits }>;
  realizedContributions: Capability<MinorUnits>;
  forecastTreasury: Capability<MinorUnits>;
  /** Disponible réel des enveloppes protégées / hors protection. */
  protectedRealAvailable: Capability<MinorUnits>;
  outsideProtectedRealAvailable: Capability<MinorUnits>;
}

export interface EnvelopeListSnapshot {
  contractVersion: typeof ENVELOPE_CONTRACT_VERSION;
  /** REV-03 : 'incident' si le serveur signale un invariant rompu (trésorerie ≠ fonds affectés + non affectés). La répartition
   *  des fonds réels (affectés, non affectés, disponibles, protégés) est alors `not_available('integrity_incident')` ; la trésorerie
   *  (compte de caisse) et les montants budgétaires restent lisibles ; l'écran affiche un incident, jamais des fonds supposés justes. */
  integrity: 'ok' | 'incident';
  /** Utilisateur authentifié pour lequel l'instantané a été lu (session), jamais fourni par l'écran. */
  viewerUserId: Uuid;
  scope: EnvelopeScope; duoId: Uuid;
  ownerUserId: Uuid | null;                     // personnel : utilisateur authentifié ; commun : null
  periodId: Uuid; periodStartsOn: IsoDate; periodEndsBefore: IsoDate;
  currency: CurrencyCode; minorDigits: number; asOf: IsoDateTime; version: string; syncStatus: SyncStatus;
  /** Source des montants réels : 'funds_ledger' (modèle hybride) ou 'budget_only' (006 seule). */
  realFundsSource: 'funds_ledger' | 'budget_only';
  envelopes: EnvelopeReadModel[];               // ordinaires puis protégées (ENV-UX-04)
  household: HouseholdFundsView;
  totals: { target: MinorUnits; realizedExpenses: MinorUnits; remainingBudget: MinorUnits;
            assignedRealFunds: Capability<MinorUnits>; realAvailable: Capability<MinorUnits>; forecastBalance: Capability<MinorUnits> };
}

/** Montant mis en avant sur une carte (ENV-UX-03) : toujours « Disponible réel » ; jamais un montant budgétaire en repli. */
export function primaryAmount(e: EnvelopeReadModel): { label: 'Disponible réel'; amount: MinorUnits | null; unavailable: NotAvailableReason | 'not_declared' | 'partial' | null } {
  const r = e.realAvailable;
  if (r.state === 'available') return { label: 'Disponible réel', amount: r.value, unavailable: null };
  return { label: 'Disponible réel', amount: null, unavailable: r.state === 'not_available' ? r.reason : r.state === 'partial' ? 'partial' : 'not_declared' };
}

/** REV-04 : clé de cache = (utilisateur authentifié, duo, espace, période). L'utilisateur figure TOUJOURS dans la clé, y compris
 *  pour l'espace commun : un changement de compte sur le même appareil ne relit jamais le cache d'un autre compte. */
export function envelopeCacheKey(s: Pick<EnvelopeListSnapshot, 'duoId' | 'scope' | 'periodId'>, viewerUserId: Uuid): string {
  if (!viewerUserId) throw new Error('envelopeCacheKey : utilisateur authentifié requis');
  return `envelopes:v3:${viewerUserId}:${s.duoId}:${s.scope}:${s.periodId}`;
}

/** Cache client des instantanés (REV-04). Isolation par clé ; purge à la déconnexion et à la révocation ; un évènement
 *  « snapshot.stale » marque les entrées du duo comme à revalider (affichées `stale`, jamais `fresh`). */
export class EnvelopeCache {
  private readonly entries = new Map<string, { snapshot: EnvelopeListSnapshot; stale: boolean }>();
  put(s: EnvelopeListSnapshot): void {
    if (s.integrity !== 'ok') return;                               // un instantané en incident n'est jamais mis en cache
    this.entries.set(envelopeCacheKey(s, s.viewerUserId), { snapshot: structuredClone(s), stale: false });
  }
  get(viewerUserId: Uuid, duoId: Uuid, scope: EnvelopeScope, periodId: Uuid): EnvelopeListSnapshot | null {
    const e = this.entries.get(envelopeCacheKey({ duoId, scope, periodId }, viewerUserId)); if (!e) return null;
    const copy = structuredClone(e.snapshot); copy.syncStatus = e.stale ? 'stale' : 'offline_cache'; return copy;
  }
  /** Revalidation : toutes les entrées du duo (tous espaces, toutes périodes) deviennent `stale`. */
  invalidateDuo(duoId: Uuid): void { for (const [, e] of this.entries) if (e.snapshot.duoId === duoId) e.stale = true; }
  /** Départ ou révocation d'appartenance : suppression des entrées de CET utilisateur pour ce duo. */
  purgeMembership(viewerUserId: Uuid, duoId: Uuid): void {
    for (const [k, e] of this.entries) if (e.snapshot.viewerUserId === viewerUserId && e.snapshot.duoId === duoId) this.entries.delete(k);
  }
  /** Déconnexion, suppression de compte, session révoquée : purge totale. */
  purgeAll(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
  /** Branchement sur `DuoBackend.subscribe` (événements sans montant). */
  onSyncEvent(viewerUserId: Uuid, e: { type: string; duoId?: Uuid; userId?: Uuid; status?: string }): void {
    if (e.type === 'session.revoked') return this.purgeAll();
    if (e.type === 'member.changed' && e.status === 'left' && e.userId === viewerUserId && e.duoId) return this.purgeMembership(viewerUserId, e.duoId);
    if ((e.type === 'snapshot.stale' || e.type === 'operation.changed' || e.type === 'member.changed') && e.duoId) this.invalidateDuo(e.duoId);
  }
}

/** Somme de capacités : disponible si toutes le sont ; partielle si au moins une est partielle (et aucune absente) ; sinon la première absence. */
export function sumCapabilities(xs: Capability<MinorUnits>[]): Capability<MinorUnits> {
  let t = 0n; let part: Extract<Capability<MinorUnits>, { state: 'partial' }> | null = null;
  for (const x of xs) {
    if (x.state === 'not_available' || x.state === 'not_declared') return x;
    if (x.state === 'partial') part = part ?? x;
    t += BigInt(x.value);
  }
  return part ? partial(t.toString(), part.basis, part.missing) : available(t.toString());
}

/** Identités de définition (tests et recette uniquement ; l'application affiche les valeurs reçues). */
export function checkEnvelopeIdentities(e: EnvelopeReadModel): string[] {
  const b = BigInt, errs: string[] = [];
  const remaining = b(e.carryOver) + b(e.target) - b(e.realizedExpenses);
  if (remaining !== b(e.remainingBudget)) errs.push(`remainingBudget ${e.remainingBudget} ≠ ${remaining}`);
  if (e.realAvailable.state === 'available' && e.realCarryOver.state === 'available' && e.assignedRealFunds.state === 'available') {
    const real = b(e.realCarryOver.value) + b(e.assignedRealFunds.value) - b(e.realizedExpenses);
    if (real !== b(e.realAvailable.value)) errs.push(`realAvailable ${e.realAvailable.value} ≠ ${real}`);
  }
  if (e.unfundedTarget.state === 'available' && e.assignedRealFunds.state === 'available') {
    const u = b(e.target) - b(e.assignedRealFunds.value);
    if ((u > 0n ? u : 0n) !== b(e.unfundedTarget.value)) errs.push('unfundedTarget incohérent');
  }
  if (e.forecastBalance.state === 'available') {
    if (e.realAvailable.state !== 'available' || e.plannedAssignments.state !== 'available' || e.plannedExpenses.state !== 'available') errs.push('prévisionnel sans ses composantes');
    else if (b(e.realAvailable.value) + b(e.plannedAssignments.value) - b(e.plannedExpenses.value) !== b(e.forecastBalance.value)) errs.push('forecastBalance incohérent');
  }
  const den = b(e.carryOver) + b(e.target);
  if (den > 0n ? e.consumption === null || b(e.consumption.denominator) !== den || b(e.consumption.numerator) !== b(e.realizedExpenses) : e.consumption !== null)
    errs.push('consumption incohérente');
  return errs;
}
