// Correspondance entre les instantanés SQL des migrations candidates et le contrat de lecture v3. Spécification de l'adaptateur Supabase.
//  * fromSqlFundsSnapshot   : public.duo_v3_get_funds_snapshot (fonds réels, M2)   → realFundsSource 'funds_ledger' (ou 'budget_only' si non activé)
//  * fromSqlEnvelopeSnapshot: public.duo_v3_get_envelope_snapshot (006r1 seule)    → realFundsSource 'budget_only'
// v3.2 (26/11) — durcissement :
//  * VALIDATION D'EXÉCUTION de toute réponse (REV-01 et contrôles complémentaires) : montants et compteurs en chaînes d'entiers
//    (un nombre JSON est refusé : il a pu perdre sa précision avant même d'arriver ici), devise connue, identifiants UUID, dates ISO,
//    énumérations fermées. Toute non-conformité lève `CONTRACT_VIOLATION`, jamais une valeur par défaut.
//  * Réponse vide d'un espace non autorisé → `FORBIDDEN` ; espace membre sans période ouverte → `SPACE_NOT_INITIALIZED`. Aucun repli à zéro.
//  * Espace (commun / personnel) lu dans la réponse quand le serveur le fournit ; propriétaire = utilisateur de la SESSION (REV-04, G9).
//  * `invariantHolds = false` → instantané en incident d'intégrité : montants réels `not_available('integrity_incident')` (REV-03).
//  * `forecastState = 'contributions_only'` → `partial` (REV-05) ; `protectionState = 'lift_pending'` transmis tel quel (REV-06).
// Ce que la source ne fournit pas devient un état explicite : jamais un montant budgétaire présenté comme réel.
import { MINOR_DIGITS, publicError } from './duoBackend.contract.ts';
import type { CurrencyCode, Uuid } from './duoBackend.contract.ts';
import { available, notAvailable, partial, sumCapabilities, ENVELOPE_CONTRACT_VERSION } from './envelopeRead.contract.ts';
import type { Capability, EnvelopeFlag, EnvelopeListSnapshot, EnvelopeReadModel, EnvelopeScope, ProtectionState } from './envelopeRead.contract.ts';

type Period = { periodId: string; startsOn: string; endsBefore: string } | null;
export interface SqlFundsSnapshot {
  householdId: string; asOf: string; ledgerVersion: string; currency: CurrencyCode; fundsTracking: boolean; period: Period;
  scope?: EnvelopeScope;
  household: { realTreasury: string; unassignedRealFunds: string | null; assignedRealFunds: string; budgetReserve: string; invariantHolds: boolean;
    expectedContributions: string | null; expectedContributionsState: 'agreed' | 'provisional' | 'not_configured';
    expectedByMember?: Array<{ userId: string; expected: string; realized: string }>; realizedContributions: string;
    forecastTreasury: string | null; forecastState: 'not_available' | 'contributions_only' } | null;
  envelopes: Array<{ envelopeId: string; name: string; status: 'active' | 'archived'; protectionState: ProtectionState;
    target: string; budgetAllocation: string; carryOver: string; realizedExpenses: string; remainingBudget: string; budgetBalance: string;
    assignedRealFunds: string; realCarryOver: string; realAvailable: string; unfundedTarget: string; forecastBalance: null; flags: EnvelopeFlag[] }>;
}
export interface SqlEnvelopeSnapshot {
  householdId: string; scope: 'common'; asOf: string; ledgerVersion: string; currency: CurrencyCode; period: Period;
  position: { reserve_minor: string; cash_minor: string } | null;
  envelopes: Array<{ envelopeId: string; name: string; status: 'active' | 'archived'; target: string; allocated: string; carryOver: string;
    realizedExpenses: string; netInternalMovements: string; budgetBalance: string; remainingBudget: string; realAvailable: null; realAvailableState: string }>;
}
/** Contexte fourni par l'adaptateur à partir de la SESSION (jamais par l'écran). */
export interface ReadContext { viewerUserId: Uuid; scope: EnvelopeScope }

// ------------------------------------------------------------------------------------------------ validation d'exécution
const INT = /^-?(0|[1-9][0-9]*)$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = Object.keys(MINOR_DIGITS) as CurrencyCode[];
const FLAGS: EnvelopeFlag[] = ['unfunded_target', 'real_deficit', 'budget_overrun', 'protected', 'archived'];
const violation = (path: string, why: string): never => { const e = publicError('CONTRACT_VIOLATION'); (e as { detail?: string }).detail = `${path}: ${why}`; throw e; };
const obj = (v: unknown, p: string): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : violation(p, 'objet attendu'));
const arr = (v: unknown, p: string): unknown[] => (Array.isArray(v) ? v : violation(p, 'tableau attendu'));
const minor = (v: unknown, p: string): string => (typeof v === 'string' && INT.test(v) ? v : violation(p, typeof v === 'number' ? 'nombre JSON refusé (chaîne d\'entier exigée, REV-01)' : 'chaîne d\'entier attendue'));
const minorOrNull = (v: unknown, p: string): string | null => (v === null ? null : minor(v, p));
const str = (v: unknown, p: string): string => (typeof v === 'string' && v.length > 0 ? v : violation(p, 'texte non vide attendu'));
const uuid = (v: unknown, p: string): string => (typeof v === 'string' && UUID.test(v) ? v : violation(p, 'UUID attendu'));
const bool = (v: unknown, p: string): boolean => (typeof v === 'boolean' ? v : violation(p, 'booléen attendu'));
const oneOf = <T extends string>(v: unknown, xs: readonly T[], p: string): T => ((xs as readonly unknown[]).includes(v) ? v as T : violation(p, `valeur hors énumération (${String(v)})`));
const currency = (v: unknown, p: string): CurrencyCode => oneOf(v, CURRENCIES, p);
function periodOf(v: unknown, p: string): Period {
  if (v === null) return null;
  const o = obj(v, p);
  const s = typeof o.startsOn === 'string' && DATE.test(o.startsOn) ? o.startsOn : violation(`${p}.startsOn`, 'date ISO attendue');
  const e = typeof o.endsBefore === 'string' && DATE.test(o.endsBefore) ? o.endsBefore : violation(`${p}.endsBefore`, 'date ISO attendue');
  if (e <= s) violation(p, 'période vide ou inversée');
  return { periodId: uuid(o.periodId, `${p}.periodId`), startsOn: s, endsBefore: e };
}

/** Valide une réponse brute de duo_v3_get_funds_snapshot (texte JSON déjà parsé SANS conversion numérique). */
export function validateSqlFundsSnapshot(raw: unknown): SqlFundsSnapshot {
  const r = obj(raw, '$');
  const out = {
    householdId: uuid(r.householdId, '$.householdId'), asOf: r.household === null && r.asOf === undefined ? '' : str(r.asOf, '$.asOf'), ledgerVersion: r.household === null && r.ledgerVersion === undefined ? '0' : minor(r.ledgerVersion, '$.ledgerVersion'),
    currency: r.household === null && r.currency === undefined ? 'EUR' as CurrencyCode : currency(r.currency, '$.currency'),
    fundsTracking: r.household === null && r.fundsTracking === undefined ? false : bool(r.fundsTracking, '$.fundsTracking'),
    period: periodOf(r.period ?? null, '$.period'),
    scope: r.scope === undefined ? undefined : oneOf(r.scope, ['common', 'personal'] as const, '$.scope'),
    household: null as SqlFundsSnapshot['household'],
    envelopes: arr(r.envelopes, '$.envelopes').map((x, i) => {
      const e = obj(x, `$.envelopes[${i}]`), p = `$.envelopes[${i}]`;
      return { envelopeId: uuid(e.envelopeId, `${p}.envelopeId`), name: str(e.name, `${p}.name`), status: oneOf(e.status, ['active', 'archived'] as const, `${p}.status`),
        protectionState: oneOf(e.protectionState, ['none', 'protected', 'lift_pending'] as const, `${p}.protectionState`),
        target: minor(e.target, `${p}.target`), budgetAllocation: minor(e.budgetAllocation, `${p}.budgetAllocation`), carryOver: minor(e.carryOver, `${p}.carryOver`),
        realizedExpenses: minor(e.realizedExpenses, `${p}.realizedExpenses`), remainingBudget: minor(e.remainingBudget, `${p}.remainingBudget`),
        budgetBalance: minor(e.budgetBalance, `${p}.budgetBalance`), assignedRealFunds: minor(e.assignedRealFunds, `${p}.assignedRealFunds`),
        realCarryOver: minor(e.realCarryOver, `${p}.realCarryOver`), realAvailable: minor(e.realAvailable, `${p}.realAvailable`),
        unfundedTarget: minor(e.unfundedTarget, `${p}.unfundedTarget`), forecastBalance: null,
        flags: arr(e.flags, `${p}.flags`).map((f, j) => oneOf(f, FLAGS, `${p}.flags[${j}]`)) };
    }),
  } satisfies SqlFundsSnapshot;
  if (r.household !== null) {
    const h = obj(r.household, '$.household');
    out.household = { realTreasury: minor(h.realTreasury, '$.household.realTreasury'), unassignedRealFunds: minorOrNull(h.unassignedRealFunds, '$.household.unassignedRealFunds'),
      assignedRealFunds: minor(h.assignedRealFunds, '$.household.assignedRealFunds'), budgetReserve: minor(h.budgetReserve, '$.household.budgetReserve'),
      invariantHolds: bool(h.invariantHolds, '$.household.invariantHolds'), expectedContributions: minorOrNull(h.expectedContributions, '$.household.expectedContributions'),
      expectedContributionsState: oneOf(h.expectedContributionsState, ['agreed', 'provisional', 'not_configured'] as const, '$.household.expectedContributionsState'),
      expectedByMember: arr(h.expectedByMember ?? [], '$.household.expectedByMember').map((x, i) => { const m = obj(x, `$.household.expectedByMember[${i}]`);
        return { userId: uuid(m.userId, `$.household.expectedByMember[${i}].userId`), expected: minor(m.expected, `$.household.expectedByMember[${i}].expected`), realized: minor(m.realized, `$.household.expectedByMember[${i}].realized`) }; }),
      realizedContributions: minor(h.realizedContributions, '$.household.realizedContributions'), forecastTreasury: minorOrNull(h.forecastTreasury, '$.household.forecastTreasury'),
      forecastState: oneOf(h.forecastState, ['not_available', 'contributions_only'] as const, '$.household.forecastState') };
    if ((out.household.forecastState === 'contributions_only') !== (out.household.forecastTreasury !== null)) violation('$.household.forecastTreasury', 'incohérent avec forecastState');
  }
  return out;
}

/** Valide une réponse brute de duo_v3_get_envelope_snapshot (006r1). */
export function validateSqlEnvelopeSnapshot(raw: unknown): SqlEnvelopeSnapshot {
  const r = obj(raw, '$');
  const pos = r.position === null || r.position === undefined ? null : obj(r.position, '$.position');
  return {
    householdId: uuid(r.householdId, '$.householdId'), scope: oneOf(r.scope, ['common'] as const, '$.scope'), asOf: r.period === null && r.asOf === undefined ? '' : str(r.asOf, '$.asOf'),
    ledgerVersion: r.period === null && r.ledgerVersion === undefined ? '0' : minor(r.ledgerVersion, '$.ledgerVersion'),
    currency: r.period === null && r.currency === undefined ? 'EUR' : currency(r.currency, '$.currency'), period: periodOf(r.period ?? null, '$.period'),
    position: pos ? { reserve_minor: minor(pos.reserve_minor, '$.position.reserve_minor'), cash_minor: minor(pos.cash_minor, '$.position.cash_minor') } : null,
    envelopes: arr(r.envelopes, '$.envelopes').map((x, i) => {
      const e = obj(x, `$.envelopes[${i}]`), p = `$.envelopes[${i}]`;
      return { envelopeId: uuid(e.envelopeId, `${p}.envelopeId`), name: str(e.name, `${p}.name`), status: oneOf(e.status, ['active', 'archived'] as const, `${p}.status`),
        target: minor(e.target, `${p}.target`), allocated: minor(e.allocated, `${p}.allocated`), carryOver: minor(e.carryOver, `${p}.carryOver`),
        realizedExpenses: minor(e.realizedExpenses, `${p}.realizedExpenses`), netInternalMovements: minor(e.netInternalMovements, `${p}.netInternalMovements`),
        budgetBalance: minor(e.budgetBalance, `${p}.budgetBalance`), remainingBudget: minor(e.remainingBudget, `${p}.remainingBudget`),
        realAvailable: null, realAvailableState: str(e.realAvailableState, `${p}.realAvailableState`) };
    }),
  };
}

// ------------------------------------------------------------------------------------------------ correspondance
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
function context(raw: unknown, ctx: ReadContext | EnvelopeScope, legacyOwner?: Uuid | null): ReadContext {
  // Compatibilité 3.1 : (raw, scope, ownerUserId). L'appelant historique fournissait l'espace et le propriétaire ; en 3.2 seul
  // l'utilisateur de session est accepté, et l'espace annoncé par le serveur prime.
  if (typeof ctx === 'string') return { scope: ctx, viewerUserId: legacyOwner ?? 'unknown-viewer' };
  void raw; return ctx;
}

export function fromSqlFundsSnapshot(raw: unknown, ctxOrScope: ReadContext | EnvelopeScope, legacyOwner?: Uuid | null): EnvelopeListSnapshot {
  const ctx = context(raw, ctxOrScope, legacyOwner);
  const sql = validateSqlFundsSnapshot(raw);
  if (!sql.household) throw publicError('FORBIDDEN');                                   // réponse neutre d'un espace non autorisé
  if (!sql.period) throw publicError('SPACE_NOT_INITIALIZED');
  if (sql.scope !== undefined && sql.scope !== ctx.scope) violation('$.scope', `espace serveur « ${sql.scope} » ≠ espace demandé « ${ctx.scope} »`);
  const p = sql.period, H = sql.household, on = sql.fundsTracking, incident = on && !H.invariantHolds;
  const funds = (v: string): Capability<string> => incident ? notAvailable('integrity_incident') : on ? available(v) : notAvailable('funds_not_activated');
  const envelopes: EnvelopeReadModel[] = sql.envelopes.map(e => ({
    envelopeId: e.envelopeId, name: e.name, iconKey: 'default', status: e.status, protection: available(e.protectionState),
    target: e.target, budgetAllocation: e.budgetAllocation, carryOver: e.carryOver, realizedExpenses: e.realizedExpenses,
    remainingBudget: e.remainingBudget, budgetBalance: e.budgetBalance,
    assignedRealFunds: funds(e.assignedRealFunds), realCarryOver: funds(e.realCarryOver), realAvailable: funds(e.realAvailable), unfundedTarget: funds(e.unfundedTarget),
    plannedExpenses: notAvailable('planned_expenses_not_modeled'), plannedAssignments: notAvailable('planned_expenses_not_modeled'),
    forecastBalance: notAvailable('planned_expenses_not_modeled'),
    consumption: consumption(e.carryOver, e.target, e.realizedExpenses),
    flags: on && !incident ? e.flags : e.flags.filter(f => f !== 'unfunded_target' && f !== 'real_deficit'),
  }));
  const ordered = [...envelopes.filter(e => !isProt(e)), ...envelopes.filter(isProt)];
  return {
    contractVersion: ENVELOPE_CONTRACT_VERSION, integrity: incident ? 'incident' : 'ok', viewerUserId: ctx.viewerUserId,
    scope: ctx.scope, duoId: sql.householdId, ownerUserId: ctx.scope === 'personal' ? ctx.viewerUserId : null,
    periodId: p.periodId, periodStartsOn: p.startsOn, periodEndsBefore: p.endsBefore,
    currency: sql.currency, minorDigits: MINOR_DIGITS[sql.currency], asOf: sql.asOf, version: sql.ledgerVersion, syncStatus: 'fresh',
    realFundsSource: on ? 'funds_ledger' : 'budget_only', envelopes: ordered,
    household: {
      realTreasury: H.realTreasury,
      unassignedRealFunds: incident ? notAvailable('integrity_incident') : on && H.unassignedRealFunds !== null ? available(H.unassignedRealFunds) : notAvailable('funds_not_activated'),
      assignedRealFunds: funds(H.assignedRealFunds), budgetReserve: H.budgetReserve,
      expectedContributions: H.expectedContributionsState !== 'not_configured' && H.expectedContributions !== null ? available(H.expectedContributions) : { state: 'not_declared' },
      expectedContributionsState: H.expectedContributionsState, expectedByMember: H.expectedByMember ?? [],
      realizedContributions: available(H.realizedContributions),
      // REV-05 : la trésorerie prévisionnelle « contributions seules » est PARTIELLE (dépenses prévues non modélisées, R-B2).
      forecastTreasury: incident ? notAvailable('integrity_incident')
        : H.forecastState === 'contributions_only' && H.forecastTreasury !== null ? partial(H.forecastTreasury, 'contributions_only', ['planned_expenses'])
        : notAvailable('planned_expenses_not_modeled'),
      protectedRealAvailable: sumCapabilities(ordered.filter(isProt).map(e => e.realAvailable)),
      outsideProtectedRealAvailable: sumCapabilities(ordered.filter(e => !isProt(e)).map(e => e.realAvailable)),
    },
    totals: totals(ordered),
  };
}

/** 006 révisée seule : aucun fonds réel par enveloppe ; le solde budgétaire n'est JAMAIS repris comme disponible réel. */
export function fromSqlEnvelopeSnapshot(raw: unknown, ctx: ReadContext = { viewerUserId: 'unknown-viewer', scope: 'common' }): EnvelopeListSnapshot {
  const sql = validateSqlEnvelopeSnapshot(raw);
  if (!sql.period && !sql.position) throw publicError('FORBIDDEN');
  if (!sql.period) throw publicError('SPACE_NOT_INITIALIZED');
  if (!sql.position) violation('$.position', 'position absente pour un espace initialisé (aucun repli à zéro)');
  const p = sql.period, pos = sql.position!, na = notAvailable<string>('funds_not_modeled');
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
    contractVersion: ENVELOPE_CONTRACT_VERSION, integrity: 'ok', viewerUserId: ctx.viewerUserId,
    scope: 'common', duoId: sql.householdId, ownerUserId: null,
    periodId: p.periodId, periodStartsOn: p.startsOn, periodEndsBefore: p.endsBefore,
    currency: sql.currency, minorDigits: MINOR_DIGITS[sql.currency], asOf: sql.asOf, version: sql.ledgerVersion, syncStatus: 'fresh',
    realFundsSource: 'budget_only', envelopes,
    household: {
      realTreasury: pos.cash_minor, unassignedRealFunds: na, assignedRealFunds: na,
      budgetReserve: pos.reserve_minor, expectedContributions: { state: 'not_declared' },
      expectedContributionsState: 'not_configured', expectedByMember: [],
      realizedContributions: notAvailable('not_in_source'), forecastTreasury: notAvailable('planned_expenses_not_modeled'), protectedRealAvailable: na, outsideProtectedRealAvailable: na,
    },
    totals: totals(envelopes),
  };
}
