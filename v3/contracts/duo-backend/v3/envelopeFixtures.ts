// Constructeur d'instantanés pour l'adaptateur fictif (source autorisée simulée) et fixtures de recette
// Sprint 3 (PR #17). Version 3 : les « versés » de la PR #17 sont des FONDS RÉELS AFFECTÉS (modèle hybride).
import { MINOR_DIGITS } from './duoBackend.contract.ts';
import type { CurrencyCode, Uuid } from './duoBackend.contract.ts';
import { available, notAvailable, sumCapabilities, ENVELOPE_CONTRACT_VERSION } from './envelopeRead.contract.ts';
import type { Capability, EnvelopeFlag, EnvelopeListSnapshot, EnvelopeReadModel, EnvelopeScope, ProtectionState } from './envelopeRead.contract.ts';

export interface EnvelopeRow {
  envelopeId: Uuid; name: string; iconKey: string; protectionState?: ProtectionState; status?: 'active' | 'archived';
  target: bigint; carryOver?: bigint; realCarryOver?: bigint;
  /** Fonds réels affectés pendant le cycle (« versé » de la PR #17). */
  assignedRealFunds: bigint;
  realizedExpenses: bigint;
  /** null : la source ne modélise pas le prévu → état `not_available`. */
  plannedAssignments: bigint | null; plannedExpenses: bigint | null;
}

const s = (v: bigint) => v.toString();
const cap = (v: bigint | null, reason: 'planned_expenses_not_modeled'): Capability<string> => v === null ? notAvailable(reason) : available(s(v));

export function buildEnvelope(r: EnvelopeRow): EnvelopeReadModel {
  const carry = r.carryOver ?? 0n, realCarry = r.realCarryOver ?? 0n;
  const real = realCarry + r.assignedRealFunds - r.realizedExpenses;
  const remaining = carry + r.target - r.realizedExpenses;
  const forecast = r.plannedAssignments === null || r.plannedExpenses === null ? null : real + r.plannedAssignments - r.plannedExpenses;
  const den = carry + r.target;
  const flags: EnvelopeFlag[] = [];
  if (r.assignedRealFunds < r.target) flags.push('unfunded_target');
  if (real < 0n) flags.push('real_deficit');
  if (remaining < 0n) flags.push('budget_overrun');
  if (r.protectionState === 'protected' || r.protectionState === 'lift_pending') flags.push('protected');   // REV-06 : en attente de levée = toujours protégée
  if (r.status === 'archived') flags.push('archived');
  const unfunded = r.target - r.assignedRealFunds;
  return {
    envelopeId: r.envelopeId, name: r.name, iconKey: r.iconKey, status: r.status ?? 'active',
    protection: available(r.protectionState ?? 'none'),
    target: s(r.target), budgetAllocation: s(r.target), carryOver: s(carry), realizedExpenses: s(r.realizedExpenses),
    remainingBudget: s(remaining), budgetBalance: s(carry + r.target - r.realizedExpenses),
    assignedRealFunds: available(s(r.assignedRealFunds)), realCarryOver: available(s(realCarry)), realAvailable: available(s(real)),
    unfundedTarget: available(s(unfunded > 0n ? unfunded : 0n)),
    plannedExpenses: cap(r.plannedExpenses, 'planned_expenses_not_modeled'), plannedAssignments: cap(r.plannedAssignments, 'planned_expenses_not_modeled'),
    forecastBalance: forecast === null ? notAvailable('planned_expenses_not_modeled') : available(s(forecast)),
    consumption: den > 0n ? { numerator: s(r.realizedExpenses), denominator: s(den) } : null, flags,
  };
}

export function buildSnapshot(args: {
  scope: EnvelopeScope; duoId: Uuid; ownerUserId: Uuid | null; viewerUserId?: Uuid; currency: CurrencyCode; rows: EnvelopeRow[];
  unassigned: bigint | null; budgetReserve?: bigint; asOf: string; version: string;
  periodId?: Uuid; periodStartsOn?: string; periodEndsBefore?: string;
}): EnvelopeListSnapshot {
  const envs = args.rows.map(buildEnvelope);
  const isProt = (e: EnvelopeReadModel) => e.protection.state === 'available' && e.protection.value !== 'none';
  const ordered = [...envs.filter(e => !isProt(e)), ...envs.filter(isProt)];
  const sum = (xs: string[]) => xs.reduce((a, b) => a + BigInt(b), 0n).toString();
  const assigned = sumCapabilities(envs.map(e => e.assignedRealFunds));
  const realAll = sumCapabilities(envs.map(e => e.realAvailable));
  const unassigned = args.scope === 'common' ? args.unassigned ?? 0n : 0n;
  const treasury = (realAll.state === 'available' ? BigInt(realAll.value) : 0n) + unassigned;
  return {
    contractVersion: ENVELOPE_CONTRACT_VERSION, integrity: 'ok', viewerUserId: args.viewerUserId ?? args.ownerUserId ?? 'fixture-viewer',
    scope: args.scope, duoId: args.duoId, ownerUserId: args.scope === 'personal' ? args.ownerUserId : null,
    periodId: args.periodId ?? 'fixture-period-2026-12', periodStartsOn: args.periodStartsOn ?? '2026-12-01', periodEndsBefore: args.periodEndsBefore ?? '2027-01-01',
    currency: args.currency, minorDigits: MINOR_DIGITS[args.currency], asOf: args.asOf, version: args.version, syncStatus: 'fresh',
    realFundsSource: 'funds_ledger', envelopes: ordered,
    household: {
      realTreasury: treasury.toString(), unassignedRealFunds: available(unassigned.toString()), assignedRealFunds: assigned,
      budgetReserve: (args.budgetReserve ?? 0n).toString(), expectedContributions: { state: 'not_declared' },
      expectedContributionsState: 'not_configured', expectedByMember: [],
      realizedContributions: available((BigInt(assigned.state === 'available' ? assigned.value : '0') + unassigned).toString()),
      forecastTreasury: notAvailable('planned_expenses_not_modeled'),
      protectedRealAvailable: sumCapabilities(envs.filter(isProt).map(e => e.realAvailable)),
      outsideProtectedRealAvailable: sumCapabilities(envs.filter(e => !isProt(e)).map(e => e.realAvailable)),
    },
    totals: { target: sum(envs.map(e => e.target)), realizedExpenses: sum(envs.map(e => e.realizedExpenses)), remainingBudget: sum(envs.map(e => e.remainingBudget)),
              assignedRealFunds: assigned, realAvailable: realAll, forecastBalance: sumCapabilities(envs.map(e => e.forecastBalance)) },
  };
}

const eur = (euros: number) => BigInt(euros) * 100n;
/** Tableau « Fixtures de recette » de la PR #17, ligne pour ligne (versé = fonds réels affectés). */
export const SPRINT3_COMMON_ROWS: EnvelopeRow[] = [
  { envelopeId: 'env-logement', name: 'Logement', iconKey: 'home', target: eur(900), assignedRealFunds: eur(900), realizedExpenses: eur(650), plannedAssignments: eur(0), plannedExpenses: eur(0) },
  { envelopeId: 'env-alimentation', name: 'Alimentation', iconKey: 'basket', target: eur(400), assignedRealFunds: eur(300), realizedExpenses: eur(185), plannedAssignments: eur(100), plannedExpenses: eur(65) },
  { envelopeId: 'env-transport', name: 'Transport', iconKey: 'bus', target: eur(200), assignedRealFunds: eur(150), realizedExpenses: eur(80), plannedAssignments: eur(50), plannedExpenses: eur(40) },
  { envelopeId: 'env-loisirs', name: 'Loisirs', iconKey: 'ticket', target: eur(200), assignedRealFunds: eur(100), realizedExpenses: eur(45), plannedAssignments: eur(0), plannedExpenses: eur(30) },
  { envelopeId: 'env-vacances', name: 'Vacances', iconKey: 'sun', protectionState: 'protected', target: eur(300), assignedRealFunds: eur(150), realizedExpenses: eur(0), plannedAssignments: eur(0), plannedExpenses: eur(0) },
];
/** Exemple personnel indépendant de la PR #17 : Lecture (objectif 60, affecté 50, dépensé 15, réel 35). */
export const SPRINT3_PERSONAL_ROWS: EnvelopeRow[] = [
  { envelopeId: 'penv-lecture', name: 'Lecture', iconKey: 'book', target: eur(60), assignedRealFunds: eur(50), realizedExpenses: eur(15), plannedAssignments: eur(0), plannedExpenses: eur(0) },
];
