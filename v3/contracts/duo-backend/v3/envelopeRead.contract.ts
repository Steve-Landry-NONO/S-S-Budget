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

export const ENVELOPE_CONTRACT_VERSION = '3.1.0-candidate';
export type EnvelopeScope = 'common' | 'personal';
export type SyncStatus = 'fresh' | 'stale' | 'offline_cache';

/** Raison d'indisponibilité d'une notion. */
export type NotAvailableReason =
  | 'funds_not_modeled'          // source 006 seule : pas de fonds réels par enveloppe
  | 'funds_not_activated'        // modèle hybride présent, duo non encore activé
  | 'planned_expenses_not_modeled'
  | 'protection_not_modeled'
  | 'not_in_source';              // la réponse de la source ne contient pas cette notion
/** Notion fournie, non fournie (avec raison), ou non déclarée par les membres. */
export type Capability<T> =
  | { state: 'available'; value: T }
  | { state: 'not_available'; reason: NotAvailableReason }
  | { state: 'not_declared' };
export const available = <T>(value: T): Capability<T> => ({ state: 'available', value });
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
export function primaryAmount(e: EnvelopeReadModel): { label: 'Disponible réel'; amount: MinorUnits | null; unavailable: NotAvailableReason | 'not_declared' | null } {
  const r = e.realAvailable;
  if (r.state === 'available') return { label: 'Disponible réel', amount: r.value, unavailable: null };
  return { label: 'Disponible réel', amount: null, unavailable: r.state === 'not_available' ? r.reason : 'not_declared' };
}

export function envelopeCacheKey(s: Pick<EnvelopeListSnapshot, 'duoId' | 'scope'>, viewerUserId: Uuid): string {
  return `envelopes:v3:${s.duoId}:${s.scope}:${s.scope === 'personal' ? viewerUserId : 'common'}`;
}

/** Somme de capacités : disponible seulement si toutes le sont. */
export function sumCapabilities(xs: Capability<MinorUnits>[]): Capability<MinorUnits> {
  let t = 0n;
  for (const x of xs) { if (x.state !== 'available') return x; t += BigInt(x.value); }
  return available(t.toString());
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
