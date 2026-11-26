// Correspondance entre les instantanés SQL du prototype et le contrat de lecture v3. Spécification de l'adaptateur Supabase.
//  * fromSqlFundsSnapshot   : public.duo_v3_get_funds_snapshot (prototype 007, modèle hybride)  → realFundsSource 'funds_ledger'
//  * fromSqlEnvelopeSnapshot: public.duo_v3_get_envelope_snapshot (006 révisée seule)            → realFundsSource 'budget_only'
// Ce que la source ne fournit pas devient un état explicite : jamais un montant budgétaire présenté comme réel.
import { MINOR_DIGITS } from './duoBackend.contract.ts';
import type { CurrencyCode, Uuid } from './duoBackend.contract.ts';
import { available, notAvailable, sumCapabilities, ENVELOPE_CONTRACT_VERSION } from './envelopeRead.contract.ts';
import type { Capability, EnvelopeFlag, EnvelopeListSnapshot, EnvelopeReadModel, EnvelopeScope } from './envelopeRead.contract.ts';

type Period = { periodId: string; startsOn: string; endsBefore: string } | null;
export interface SqlFundsSnapshot {
  householdId: string; asOf: string; ledgerVersion: number; currency: CurrencyCode; fundsTracking: boolean; period: Period;
  household: { realTreasury: string; unassignedRealFunds: string | null; assignedRealFunds: string; budgetReserve: string; invariantHolds: boolean;
    expectedContributions: string | null; expectedContributionsState: 'agreed' | 'provisional' | 'not_configured';
    expectedByMember?: Array<{ userId: string; expected: string; realized: string }>; realizedContributions: string;
    forecastTreasury: string | null; forecastState: 'not_available' | 'contributions_only' } | null;
  envelopes: Array<{ envelopeId: string; name: string; status: 'active' | 'archived'; protectionState: 'none' | 'protected';
    target: string; budgetAllocation: string; carryOver: string; realizedExpenses: string; remainingBudget: string; budgetBalance: string;
    assignedRealFunds: string; realCarryOver: string; realAvailable: string; unfundedTarget: string; forecastBalance: null; flags: EnvelopeFlag[] }>;
}
export interface SqlEnvelopeSnapshot {
  householdId: string; scope: 'common'; asOf: string; ledgerVersion: number; currency: CurrencyCode; period: Period;
  position: { reserve_minor: number | string; cash_minor: number | string } | null;
  envelopes: Array<{ envelopeId: string; name: string; status: 'active' | 'archived'; target: string; allocated: string; carryOver: string;
    realizedExpenses: string; netInternalMovements: string; budgetBalance: string; remainingBudget: string; realAvailable: null; realAvailableState: string }>;
}

const consumption = (carry: string, target: string, spent: string) => {
  const den = BigInt(carry) + BigInt(target); return den > 0n ? { numerator: spent, denominator: den.toString() } : null;
};
const isProt = (e: EnvelopeReadModel) => e.protection.state === 'available' && e.protection.value !== 'none';
const sum = (xs: string[]) => xs.reduce((a, b) => a + BigInt(b), 0n).toString();
function totals(envs: EnvelopeReadModel[]) {
  return { target: sum(envs.map(e => e.target)), realizedExpenses: sum(envs.map(e => e.realizedExpenses)), remainingBudget: sum(envs.map(e => e.remainingBudget)),
           assignedRealFunds: sumCapabilities(envs.map(e => e.assignedRealFunds)), realAvailable: sumCapabilities(envs.map(e => e.realAvailable)),
           forecastBalance: sumCapabilities(envs.map(e => e.forecastBalance)) };
}
function period(p: Period) { if (!p) throw new Error('Instantané sans période ouverte : espace non initialisé ou non autorisé'); return p; }

export function fromSqlFundsSnapshot(sql: SqlFundsSnapshot, scope: EnvelopeScope, ownerUserId: Uuid | null): EnvelopeListSnapshot {
  if (!sql.household) throw new Error('Instantané vide : espace non autorisé');
  const p = period(sql.period), H = sql.household, on = sql.fundsTracking;
  const funds = (v: string): Capability<string> => on ? available(v) : notAvailable('funds_not_activated');
  const envelopes: EnvelopeReadModel[] = sql.envelopes.map(e => ({
    envelopeId: e.envelopeId, name: e.name, iconKey: 'default', status: e.status, protection: available(e.protectionState),
    target: e.target, budgetAllocation: e.budgetAllocation, carryOver: e.carryOver, realizedExpenses: e.realizedExpenses,
    remainingBudget: e.remainingBudget, budgetBalance: e.budgetBalance,
    assignedRealFunds: funds(e.assignedRealFunds), realCarryOver: funds(e.realCarryOver), realAvailable: funds(e.realAvailable), unfundedTarget: funds(e.unfundedTarget),
    plannedExpenses: notAvailable('planned_expenses_not_modeled'), plannedAssignments: notAvailable('planned_expenses_not_modeled'),
    forecastBalance: notAvailable('planned_expenses_not_modeled'),
    consumption: consumption(e.carryOver, e.target, e.realizedExpenses),
    flags: on ? e.flags : e.flags.filter(f => f !== 'unfunded_target' && f !== 'real_deficit'),
  }));
  const ordered = [...envelopes.filter(e => !isProt(e)), ...envelopes.filter(isProt)];
  return {
    contractVersion: ENVELOPE_CONTRACT_VERSION, scope, duoId: sql.householdId, ownerUserId: scope === 'personal' ? ownerUserId : null,
    periodId: p.periodId, periodStartsOn: p.startsOn, periodEndsBefore: p.endsBefore,
    currency: sql.currency, minorDigits: MINOR_DIGITS[sql.currency], asOf: sql.asOf, version: String(sql.ledgerVersion), syncStatus: 'fresh',
    realFundsSource: on ? 'funds_ledger' : 'budget_only', envelopes: ordered,
    household: {
      realTreasury: H.realTreasury,
      unassignedRealFunds: on && H.unassignedRealFunds !== null ? available(H.unassignedRealFunds) : notAvailable('funds_not_activated'),
      assignedRealFunds: funds(H.assignedRealFunds), budgetReserve: H.budgetReserve,
      expectedContributions: H.expectedContributionsState !== 'not_configured' && H.expectedContributions !== null ? available(H.expectedContributions) : { state: 'not_declared' },
      expectedContributionsState: H.expectedContributionsState, expectedByMember: H.expectedByMember ?? [],
      realizedContributions: available(H.realizedContributions),
      forecastTreasury: H.forecastTreasury !== null ? available(H.forecastTreasury) : notAvailable('planned_expenses_not_modeled'),
      protectedRealAvailable: sumCapabilities(ordered.filter(isProt).map(e => e.realAvailable)),
      outsideProtectedRealAvailable: sumCapabilities(ordered.filter(e => !isProt(e)).map(e => e.realAvailable)),
    },
    totals: totals(ordered),
  };
}

/** 006 révisée seule : aucun fonds réel par enveloppe ; le solde budgétaire n'est JAMAIS repris comme disponible réel. */
export function fromSqlEnvelopeSnapshot(sql: SqlEnvelopeSnapshot): EnvelopeListSnapshot {
  const p = period(sql.period), na = notAvailable<string>('funds_not_modeled');
  const envelopes: EnvelopeReadModel[] = sql.envelopes.map(e => {
    const flags: EnvelopeFlag[] = [];
    if (BigInt(e.remainingBudget) < 0n) flags.push('budget_overrun');
    if (e.status === 'archived') flags.push('archived');
    return {
      envelopeId: e.envelopeId, name: e.name, iconKey: 'default', status: e.status, protection: notAvailable('protection_not_modeled'),
      target: e.target, budgetAllocation: e.allocated, carryOver: e.carryOver, realizedExpenses: e.realizedExpenses,
      remainingBudget: e.remainingBudget, budgetBalance: e.budgetBalance,
      assignedRealFunds: na, realCarryOver: na, realAvailable: na, unfundedTarget: na,
      plannedExpenses: notAvailable('planned_expenses_not_modeled'), plannedAssignments: notAvailable('planned_expenses_not_modeled'),
      forecastBalance: notAvailable('planned_expenses_not_modeled'), consumption: consumption(e.carryOver, e.target, e.realizedExpenses), flags,
    };
  });
  return {
    contractVersion: ENVELOPE_CONTRACT_VERSION, scope: 'common', duoId: sql.householdId, ownerUserId: null,
    periodId: p.periodId, periodStartsOn: p.startsOn, periodEndsBefore: p.endsBefore,
    currency: sql.currency, minorDigits: MINOR_DIGITS[sql.currency], asOf: sql.asOf, version: String(sql.ledgerVersion), syncStatus: 'fresh',
    realFundsSource: 'budget_only', envelopes,
    household: {
      realTreasury: sql.position ? String(sql.position.cash_minor) : '0', unassignedRealFunds: na, assignedRealFunds: na,
      budgetReserve: sql.position ? String(sql.position.reserve_minor) : '0', expectedContributions: { state: 'not_declared' },
      expectedContributionsState: 'not_configured', expectedByMember: [],
      realizedContributions: notAvailable('not_in_source'), forecastTreasury: notAvailable('planned_expenses_not_modeled'), protectedRealAvailable: na, outsideProtectedRealAvailable: na,
    },
    totals: totals(envelopes),
  };
}
