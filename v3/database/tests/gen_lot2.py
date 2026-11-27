#!/usr/bin/env python3
"""Génère lot2_financial_model.sql : recette de la migration 006 (modèle financier).

Une seule transaction terminée par ROLLBACK. Rôles réels (SET ROLE), JWT simulé.
Scénario daté sur la période en cours (now()) pour que les RPC, qui lisent l'heure serveur,
se comportent comme en production ; les clôtures utilisent p_now explicite.
Mode « dev » : la migration 006 est insérée dans la transaction (test sans application).
"""
import json, pathlib, sys

HA, HB, HC, HD, HE = (f'{c}0000000-0000-4000-8000-0000000000{c}{c}' for c in 'abcde')
CAM, ALEX, CLA = ('a1000000-0000-4000-8000-0000000000a1', 'a2000000-0000-4000-8000-0000000000a2',
                  'c1000000-0000-4000-8000-0000000000c1')
U = {'ha': HA, 'hb': HB, 'hc': HC, 'hd': HD, 'he': HE, 'cam': CAM, 'alex': ALEX, 'cla': CLA}

def q(s): return "'" + s.replace("'", "''") + "'"
def dq(s): return '$q$' + s + '$q$'

T = []
def t(tid, mat, dec, titre, role, sub, action, expect='ok', check='true', anon=False, info=False, msg=None):
    T.append(dict(id=tid, mat=mat, dec=dec, titre=titre, role=role, sub=sub, action=action,
                  expect=expect, check=check, anon=anon, info=info, msg=msg))
def run(x):
    sub = f"pg_temp.u('{x['sub']}')" if x['sub'] else 'null'
    return (f"select pg_temp.run({q(x['id'])},{q(x['role'])},{sub},{'true' if x['anon'] else 'false'},"
            f"{dq(x['action'])},{dq(x['check'])});")

ID = lambda k: f"pg_temp.id('{k}')"
BAL = lambda k: f"(select balance_minor from public.duo_v3_envelope_balances where envelope_id={ID(k)})"
POS = lambda col, h='ha': f"(select {col} from public.duo_v3_household_position where household_id=pg_temp.u('{h}') and currency='EUR')"
SYS = lambda k, h='ha': (f"(select coalesce(sum(e.amount_minor),0) from public.duo_v3_entries e join public.duo_v3_accounts a "
                         f"on a.id=e.account_id where a.household_id=pg_temp.u('{h}') and a.kind='{k}' and a.currency='EUR')")
NTX = "(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha'))"
def expense(env, amt, key, day='(now() at time zone \'Europe/Paris\')::date', h='ha'):
    return f"perform public.duo_v3_post_expense(pg_temp.u('{h}'),{ID(env)},{amt},{day},'{key}');"
def contrib(amt, key, h='ha', day="(now() at time zone 'Europe/Paris')::date"):
    return f"perform public.duo_v3_post_contribution(pg_temp.u('{h}'),{amt},{day},'{key}');"
def transfer(a, b, amt, key, h='ha'):
    return f"perform public.duo_v3_post_transfer(pg_temp.u('{h}'),{a},{b},{amt},'EUR','{key}');"
ACC = lambda env: f"(select account_id from public.duo_v3_envelopes where id={ID(env)})"
RES = "pg_temp.id('acc_reserve')"

STEPS = []   # (après le test id, SQL de mise en place privilégiée)
def step(sql): STEPS.append((len(T), sql))

# ---------------------------------------------------------------- A. Calendrier (D-011, D-012)
cyc = lambda d, day: f"(select row(starts_on, ends_on)::text from duo_v3_private.cycle_containing({d}::smallint, '{day}'))"
t('K01', 'CYC-01', 'D-011', 'Jour 1 : cycle = mois civil (31 déc. → 1er janv.)', 'postgres', None, 'perform 1;', 'ok',
  f"{cyc(1, '2026-12-31')} = '(2026-12-01,2027-01-01)'")
t('K02', 'CYC-01', 'D-011', 'Jour 5 : 5 nov. – 5 déc. (fin exclue)', 'postgres', None, 'perform 1;', 'ok',
  f"{cyc(5, '2026-11-20')} = '(2026-11-05,2026-12-05)' and {cyc(5, '2026-11-04')} = '(2026-10-05,2026-11-05)'")
t('K03', 'CYC-01', 'D-012', 'Jour 31 : 31 janv., 28 févr., 31 mars (2027)', 'postgres', None, 'perform 1;', 'ok',
  f"{cyc(31, '2027-02-15')} = '(2027-01-31,2027-02-28)' and {cyc(31, '2027-03-01')} = '(2027-02-28,2027-03-31)' "
  f"and {cyc(31, '2027-04-29')} = '(2027-03-31,2027-04-30)' and {cyc(31, '2027-04-30')} = '(2027-04-30,2027-05-31)'")
t('K04', 'CYC-01', 'D-012', 'Jour 29/30 : février non bissextile (28) et bissextile (29)', 'postgres', None, 'perform 1;', 'ok',
  f"{cyc(29, '2027-02-28')} = '(2027-02-28,2027-03-29)' and {cyc(29, '2028-02-29')} = '(2028-02-29,2028-03-29)' "
  f"and {cyc(30, '2027-02-28')} = '(2027-02-28,2027-03-30)'")
step(f"""select duo_v3_private.bootstrap_household(pg_temp.u('hd'), '2026-03-29 12:00+02');
select duo_v3_private.ensure_current_period(pg_temp.u('hd'), '2028-04-15 12:00+02');
select duo_v3_private.bootstrap_household(pg_temp.u('he'), '2027-01-10 12:00+01');
select duo_v3_private.ensure_current_period(pg_temp.u('he'), '2028-04-15 12:00+02');""")
t('K05', 'CYC-01', 'D-011', 'Changement d’heure (29 mars 2026, Paris) : bornes 23:00 UTC puis 22:00 UTC', 'postgres', None,
  'perform 1;', 'ok',
  "(select starts_at = '2026-03-28 23:00+00' and ends_at = '2026-04-28 22:00+00' from public.duo_v3_periods "
  "where household_id=pg_temp.u('hd') and starts_on='2026-03-29')")
t('K06', 'CYC-01', 'D-011/D-012', 'Jour 29 sur 25 périodes : contiguës, 28 févr. 2027 et 29 févr. 2028', 'postgres', None,
  'perform 1;', 'ok',
  "(select count(*) from public.duo_v3_periods p where p.household_id=pg_temp.u('hd') and p.starts_on <> '2026-03-29' "
  "and not exists (select 1 from public.duo_v3_periods q where q.household_id=p.household_id and q.ends_on=p.starts_on))=0 "
  "and exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('hd') and starts_on='2027-02-28') "
  "and exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('hd') and starts_on='2028-02-29') "
  "and (select count(*) from public.duo_v3_periods where household_id=pg_temp.u('hd') and state='open')=1")
t('K07', 'CYC-01', 'D-012', 'Jour 31 : retour au 31 après un mois court (28 févr. → 31 mars 2027)', 'postgres', None,
  'perform 1;', 'ok',
  "exists (select 1 from public.duo_v3_periods where household_id=pg_temp.u('he') and starts_on='2027-02-28' and ends_on='2027-03-31')")
t('K08', 'CYC-01', 'D-011', 'Période non contiguë refusée', 'postgres', None,
  "insert into public.duo_v3_periods(household_id,starts_on,ends_on,starts_at,ends_at) values "
  "(pg_temp.u('he'),'2030-01-01','2030-02-01','2030-01-01','2030-02-01');", '23514', msg='contiguous')
t('K09', 'CYC-01', 'D-011', 'Deuxième période ouverte refusée', 'postgres', None,
  "update public.duo_v3_periods set state='open', closed_at=null where household_id=pg_temp.u('he') "
  "and state='closed' and starts_on='2027-02-28';", '23514', msg='cannot be modified')
t('K10', 'CYC-01', 'D-011', 'Jour de début figé une fois des périodes créées', 'postgres', None,
  "update public.duo_v3_households set cycle_start_day=5 where id=pg_temp.u('he');", '23514', msg='frozen')

# ---------------------------------------------------------------- B. Mise en place du duo A (période en cours)
step("""select pg_temp.put('p1', duo_v3_private.bootstrap_household(pg_temp.u('ha'), now()));
select duo_v3_private.bootstrap_household(pg_temp.u('hb'), now());
select pg_temp.put('courses',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Courses',  true));
select pg_temp.put('vacances', duo_v3_private.create_envelope(pg_temp.u('ha'),'Vacances', true));
select pg_temp.put('loisirs',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Loisirs',  false));
select pg_temp.put('maison',   duo_v3_private.create_envelope(pg_temp.u('ha'),'Maison',   false));
select pg_temp.put('auto',     duo_v3_private.create_envelope(pg_temp.u('ha'),'Auto',     true));
select pg_temp.put('b_env',    duo_v3_private.create_envelope(pg_temp.u('hb'),'B Courses',true));
select duo_v3_private.set_allocation(pg_temp.id('courses'),  40000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('vacances'), 30000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('loisirs'),   8000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('loisirs'),  40000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('maison'),   10000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select duo_v3_private.set_allocation(pg_temp.id('auto'),     40000, (select starts_on from public.duo_v3_periods where id=pg_temp.id('p1')));
select pg_temp.put_num('cash0', 0);
select pg_temp.put('acc_reserve', duo_v3_private.account_of(pg_temp.u('ha'),'reserve'));
select pg_temp.put('acc_cash', duo_v3_private.account_of(pg_temp.u('ha'),'cash'));
select duo_v3_private.post_period_allocations(pg_temp.u('ha'), pg_temp.id('p1'));""")

# ---------------------------------------------------------------- C. Conservation trésorerie / budget
t('C01', 'TRF-13', 'Exigence 1', 'Allocations de 1 280 € : trésorerie inchangée (0), enveloppes +1 280 €, écart −1 280 € avec alerte',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{POS('cash_minor')}=0 and {POS('envelopes_minor')}=128000 and {POS('allocated_minor')}=128000 "
  f"and {POS('funding_gap_minor')}=-128000 and {POS('funding_alert')} and {BAL('vacances')}=30000")
t('C02', 'TRF-13', 'D-008', 'Versements réels Camille 700 € + Alex 580 € : trésorerie 1 280 €, budget inchangé, écart 0',
  'authenticated', 'cam', contrib(70000, 'c-cam-1'), 'ok', 'true')
t('C02b', 'TRF-13', 'D-008', '… versement d’Alex : écart nul, alerte levée', 'authenticated', 'alex', contrib(58000, 'c-alex-1'), 'ok',
  f"{POS('cash_minor')}=128000 and {POS('envelopes_minor')}=128000 and {POS('funding_gap_minor')}=0 and not {POS('funding_alert')}")
t('C03', 'ENV-05', 'D-016', 'Dépense de 110 € sur Loisirs (80 €) acceptée : solde −30 €, trésorerie −110 €',
  'authenticated', 'cam', expense('loisirs', 11000, 'e-lois-1'), 'ok',
  f"{BAL('loisirs')}=-3000 and {POS('cash_minor')}=117000")
t('C04', 'TRF-13', 'Exigence 1', 'Dépenses Courses 50 €, Maison 20 €, Auto 900 € ; transfert Courses → Vacances 25 € sans effet trésorerie',
  'authenticated', 'alex',
  expense('courses', 5000, 'e-cou-1') + expense('maison', 2000, 'e-mai-1') + expense('auto', 90000, 'e-aut-1')
  + f"perform pg_temp.put_num('cash_before_trf', {POS('cash_minor')});"
  + transfer(ACC('courses'), ACC('vacances'), 2500, 'trf-cv-1'), 'ok',
  f"{POS('cash_minor')}=current_setting('lot2.cash_before_trf')::numeric and {BAL('courses')}=32500 and {BAL('vacances')}=32500")
t('C05', 'TRF-13', 'Invariants', 'Identités : trésorerie = versements − dépenses ; budget = allocations − dépenses ; écart = versements − allocations',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{POS('cash_minor')} = 128000 - {POS('spent_minor')} and {POS('envelopes_minor')}+{POS('reserve_minor')} = "
  f"{POS('allocated_minor')} - {POS('spent_minor')} and {POS('funding_gap_minor')} = 128000 - {POS('allocated_minor')} "
  f"and {POS('cash_minor')}=20000 and {POS('spent_minor')}=108000")
t('C06', 'TRF-13', 'Exigence 1', 'Écriture qui crée du budget à partir de la trésorerie (cash −100 / enveloppe +100) refusée', 'postgres', None,
  "insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id) values "
  "('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),'EUR','x-book','transfer',pg_temp.u('cam'),pg_temp.id('p1'));"
  "insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values "
  "('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),duo_v3_private.account_of(pg_temp.u('ha'),'cash'),'EUR',-100),"
  f"('e2000000-0000-4000-8000-000000000001',pg_temp.u('ha'),{ACC('vacances')},'EUR',100);"
  "execute 'set constraints all immediate';", '23514', msg='within each book')
t('C07', 'TRF-13', 'Contrat RPC', 'Transition du contrat : transfert trésorerie → enveloppe par la RPC refusé (23503)',
  'authenticated', 'cam', transfer("pg_temp.id('acc_cash')", ACC('vacances'), 100, 'trf-cash-1'), '23503', msg='not eligible')
t('C08', 'TRF-13', 'Invariants', 'Chaque transaction du duo est équilibrée dans chaque livre', 'postgres', None, 'perform 1;', 'ok',
  "not exists (select 1 from public.duo_v3_entries e join public.duo_v3_accounts a on a.id=e.account_id "
  "where e.household_id=pg_temp.u('ha') group by e.transaction_id, a.book having sum(e.amount_minor)<>0)")

# ---------------------------------------------------------------- D. Clôture et reports
step("""select pg_temp.put_num('cash_before_close', (select cash_minor from public.duo_v3_household_position where household_id=pg_temp.u('ha') and currency='EUR'));
select pg_temp.put('p2', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p1'),
  (select ends_at + interval '1 second' from public.duo_v3_periods where id=pg_temp.id('p1'))));
select pg_temp.put_num('ntx_after_close', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));""")
SNAP = lambda env, col, p='p1': f"(select {col} from public.duo_v3_period_envelope_closes where period_id={ID(p)} and envelope_id={ID(env)})"
t('R01', 'CYC-02', 'D-013', 'Report activé : Courses +325 € conservés, + allocation 400 € = 725 €', 'authenticated', 'cam', 'perform 1;', 'ok',
  f"{SNAP('courses','carried_minor')}=32500 and {SNAP('courses','to_reserve_minor')}=0 and {BAL('courses')}=72500")
t('R02', 'CYC-02', 'D-014', 'Report désactivé : reliquat Maison 80 € → réserve (une écriture), Maison repart de 0 + 100 €',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{SNAP('maison','to_reserve_minor')}=8000 and {SYS('reserve')}=8000 and {BAL('maison')}=10000 "
  f"and (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha') and kind='carry')=1")
t('R03', 'CYC-03', 'D-017', 'Déficit Loisirs −30 € reporté malgré le report désactivé ; nouvelle allocation 400 € → 370 €',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{SNAP('loisirs','closing_balance_minor')}=-3000 and {SNAP('loisirs','carried_minor')}=-3000 "
  f"and {SNAP('loisirs','to_reserve_minor')}=0 and {BAL('loisirs')}=37000")
t('R04', 'CYC-03', 'D-018', 'Déficit Auto −500 € + allocation 400 € = −100 € ; réserve non prélevée', 'authenticated', 'cam',
  'perform 1;', 'ok', f"{BAL('auto')}=-10000 and {SYS('reserve')}=8000")
t('R05', 'CYC-04', 'D-014/D-029', 'La clôture ne change pas la trésorerie', 'authenticated', 'cam', 'perform 1;', 'ok',
  f"{POS('cash_minor')}=current_setting('lot2.cash_before_close')::numeric")
t('R06', 'CYC-05', 'D-029', 'Clôture rejouée : même période suivante, aucune écriture nouvelle', 'postgres', None,
  "perform pg_temp.put('p2bis', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p1'), now() + interval '400 days'));", 'ok',
  f"pg_temp.id('p2bis') = pg_temp.id('p2') and {NTX} = current_setting('lot2.ntx_after_close')::bigint")
t('R07', 'CYC-02', 'D-013', 'Instantané de clôture : règle appliquée et provenance pour les 5 enveloppes', 'authenticated', 'cam',
  'perform 1;', 'ok',
  f"(select count(*) from public.duo_v3_period_envelope_closes where period_id={ID('p1')})=5 "
  f"and {SNAP('maison','carry_positive')}=false and {SNAP('courses','carry_positive')}=true "
  f"and (select to_reserve_total_minor from public.duo_v3_period_closes where period_id={ID('p1')})=8000")
t('R08', 'TRF-13', 'D-015', 'Réserve 80 € → Vacances 60 € : réserve 20 €, Vacances +60 €, trésorerie inchangée', 'authenticated', 'alex',
  transfer(RES, ACC('vacances'), 6000, 'r-vac-1'), 'ok',
  f"{SYS('reserve')}=2000 and {BAL('vacances')}=68500 and {POS('cash_minor')}=current_setting('lot2.cash_before_close')::numeric")
t('R09', 'TRF-13', 'D-015', 'Réserve insuffisante (20 € pour 50 €) : refus 23514', 'authenticated', 'cam',
  transfer(RES, ACC('vacances'), 5000, 'r-vac-2'), '23514', f"{SYS('reserve')}=2000", msg='unallocated reserve')
t('R10', 'CYC-02', 'Invariants', 'Après clôture, écart = versements − allocations des deux périodes (1 280 € − 2 880 €)',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{POS('allocated_minor')}=288000 and {POS('funding_gap_minor')}=128000-288000")

# ---------------------------------------------------------------- E. Opérations tardives et périodes closes (D-029)
t('L01', 'CYC-07', 'D-029', 'Dépense datée dans la période close : imputée à la période ouverte, date réelle conservée',
  'authenticated', 'cam', expense('courses', 1240, 'e-late-1'), 'ok',
  "(select period_id = pg_temp.id('p2') and late_imputation and occurred_on = (now() at time zone 'Europe/Paris')::date "
  "and created_at = now() from public.duo_v3_transactions where household_id=pg_temp.u('ha') and idempotency_key='e-late-1')")
t('L02', 'CYC-07', 'D-029', 'La période close n’est pas rouverte : instantané de clôture inchangé', 'authenticated', 'cam',
  'perform 1;', 'ok',
  f"{SNAP('courses','closing_balance_minor')}=32500 and (select state from public.duo_v3_periods where id={ID('p1')})='closed'")
t('L03', 'CYC-04', 'D-029', 'Écriture directe dans une période close refusée', 'postgres', None,
  "insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,period_id) values "
  "('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),'EUR','late-direct','transfer',pg_temp.u('cam'),pg_temp.id('p1'));"
  "insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values "
  f"('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),{ACC('courses')},'EUR',-100),"
  f"('e2000000-0000-4000-8000-000000000002',pg_temp.u('ha'),{ACC('vacances')},'EUR',100);"
  "execute 'set constraints all immediate';", '23514', msg='period is closed')
t('L04', 'CYC-04', 'D-029', 'Modification d’une période close refusée', 'postgres', None,
  f"update public.duo_v3_periods set ends_on = ends_on + 1 where id={ID('p1')};", '23514', msg='cannot be modified')
t('L05', 'CYC-04', 'D-029', 'Suppression d’une période refusée', 'postgres', None,
  f"delete from public.duo_v3_periods where id={ID('p2')};", '23514', msg='immutable (duo_v3_periods)')
t('L06', 'ENV-05', 'D-016', 'Dépense datée dans le futur refusée', 'authenticated', 'cam',
  expense('courses', 100, 'e-fut-1', "(now() at time zone 'Europe/Paris')::date + 1"), '22023', msg='future')
step("""select duo_v3_private.bootstrap_household(pg_temp.u('hc'), now() - interval '75 days');""")
t('L07', 'CYC-01', 'D-029', 'Clôture paresseuse : un versement après 2+ périodes échues les clôture puis s’impute à la période courante',
  'authenticated', 'cam', contrib(1000, 'c-hc-1', 'hc'), 'ok',
  "(select count(*) from public.duo_v3_period_closes where household_id=pg_temp.u('hc'))>=2 "
  "and (select p.starts_at <= now() and now() < p.ends_at and t.late_imputation = false "
  "from public.duo_v3_transactions t join public.duo_v3_periods p on p.id=t.period_id "
  "where t.household_id=pg_temp.u('hc') and t.idempotency_key='c-hc-1')")
step("""select pg_temp.put('p3', duo_v3_private.close_period(pg_temp.u('ha'), pg_temp.id('p2'),
  (select ends_at + interval '1 second' from public.duo_v3_periods where id=pg_temp.id('p2'))));""")
t('R11', 'CYC-03', 'D-018', 'Deux clôtures : Auto −100 € + 400 € = 300 € ; Loisirs 370 € (report désactivé) → réserve',
  'authenticated', 'cam', 'perform 1;', 'ok',
  f"{BAL('auto')}=30000 and {SNAP('loisirs','to_reserve_minor','p2')}=37000 and {BAL('loisirs')}=40000 "
  f"and (select count(*) from public.duo_v3_period_envelope_closes where envelope_id={ID('auto')})=2")

# ---------------------------------------------------------------- F. Sécurité (lot 1 étendu aux nouvelles tables)
t('X01', 'SEC-04', '005', 'INSERT direct d’une période par un client refusé', 'authenticated', 'cam',
  "insert into public.duo_v3_periods(household_id,starts_on,ends_on,starts_at,ends_at) values "
  "(pg_temp.u('ha'),'2031-01-01','2031-02-01','2031-01-01','2031-02-01');", '42501')
t('X02', 'SEC-04', '005', 'INSERT direct d’une enveloppe ou d’une allocation par un client refusé', 'authenticated', 'cam',
  f"insert into public.duo_v3_allocation_versions(household_id,envelope_id,amount_minor,effective_from) values (pg_temp.u('ha'),{ID('courses')},1,'2031-01-01');",
  '42501')
t('X03', 'SEC-01', 'RLS', 'Claire (duo B) ne voit ni périodes, ni enveloppes, ni soldes, ni position du duo A', 'authenticated', 'cla',
  'perform 1;', 'ok',
  "(select count(*) from public.duo_v3_periods where household_id=pg_temp.u('ha'))=0 "
  "and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('ha'))=0 "
  "and (select count(*) from public.duo_v3_envelope_balances where household_id=pg_temp.u('ha'))=0 "
  "and (select count(*) from public.duo_v3_household_position where household_id=pg_temp.u('ha'))=0 "
  "and (select count(*) from public.duo_v3_period_envelope_closes where household_id=pg_temp.u('ha'))=0 "
  "and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('hb'))=1")
t('X04', 'SEC-01', 'RLS', 'anon : lecture des périodes et de la position refusée', 'anon', None,
  'perform count(*) from public.duo_v3_household_position;', '42501')
t('X05', 'SEC-04', '005', 'Un client ne peut pas clôturer une période', 'authenticated', 'cam',
  f"perform duo_v3_private.close_period(pg_temp.u('ha'), {ID('p3')}, now() + interval '400 days');", '42501')
t('X06', 'SEC-04', '005', 'Un client ne peut pas créer d’enveloppe ni fixer une allocation par fonction serveur', 'authenticated', 'cam',
  f"perform duo_v3_private.set_allocation({ID('courses')}, 1, '2031-01-01');", '42501')
t('X07', 'SEC-01', '005', 'anon : RPC de dépense refusée', 'anon', None, expense('courses', 100, 'e-anon-1'), '42501')
t('X08', 'SEC-01', 'RLS', 'Claire dépense sur le duo A : refusé', 'authenticated', 'cla', expense('courses', 100, 'e-cla-1'), '42501', msg='Not authorized')
t('X09', 'SEC-01', 'RLS', 'Camille dépense sur une enveloppe du duo B : refusé', 'authenticated', 'cam',
  f"perform public.duo_v3_post_expense(pg_temp.u('ha'),{ID('b_env')},100,(now() at time zone 'Europe/Paris')::date,'e-xb-1');", '23503', msg='not eligible')
t('X10', 'FIA-05', 'Idempotence', 'Dépense rejouée (même clé) : même identifiant, une seule écriture', 'authenticated', 'cam',
  expense('courses', 777, 'e-rep-1') + expense('courses', 777, 'e-rep-1'), 'ok',
  "(select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha') and idempotency_key='e-rep-1')=1 "
  "and (select count(*) from public.duo_v3_entries e join public.duo_v3_transactions t on t.id=e.transaction_id "
  "where t.household_id=pg_temp.u('ha') and t.idempotency_key='e-rep-1')=4")
t('X11', 'FIA-06', 'Idempotence', 'Même clé, autre montant : 23505', 'authenticated', 'cam', expense('courses', 778, 'e-rep-1'), '23505', msg='Idempotency key reused')
t('X12', 'SEC-01', 'RLS', 'Session anonyme Supabase : dépense refusée', 'authenticated', 'cam', expense('courses', 100, 'e-anonsess-1'),
  '42501', anon=True, msg='Not authorized')
step("""select pg_temp.put('cadeaux',  duo_v3_private.create_envelope(pg_temp.u('ha'),'Cadeaux',  true));
select pg_temp.put('ancienne', duo_v3_private.create_envelope(pg_temp.u('ha'),'Ancienne', true));
select pg_temp.put('temp',     duo_v3_private.create_envelope(pg_temp.u('ha'),'Temporaire', true));
select duo_v3_private.set_allocation(pg_temp.id('temp'),     10000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p3')));
select duo_v3_private.set_allocation(pg_temp.id('ancienne'),  5000, (select ends_on from public.duo_v3_periods where id=pg_temp.id('p3')));""")
# ---------------------------------------------------------------- G. Arbitrage : solde source insuffisant
t('S01', 'TRF-15', 'Arbitrage 21/11', 'Transfert Courses → Cadeaux 50 € : accepté (source suffisante)', 'authenticated', 'alex',
  transfer(ACC('courses'), ACC('cadeaux'), 5000, 's-1'), 'ok', f"{BAL('cadeaux')}=5000")
step(f"select pg_temp.put_num('cou_s2', {BAL('courses')});")
t('S02', 'TRF-15', 'Arbitrage 21/11', 'Transfert Cadeaux → Courses 60 € sur 50 € : refusé, aucun solde modifié', 'authenticated', 'alex',
  transfer(ACC('cadeaux'), ACC('courses'), 6000, 's-2'), '23514',
  f"{BAL('cadeaux')}=5000 and {BAL('courses')}=current_setting('lot2.cou_s2')::numeric", msg='cannot create a deficit')
t('S03', 'TRF-15', 'Arbitrage 21/11', 'Transfert du solde exact (50 €) : accepté, source à 0', 'authenticated', 'alex',
  transfer(ACC('cadeaux'), ACC('courses'), 5000, 's-3'), 'ok', f"{BAL('cadeaux')}=0")
t('S04', 'ENV-05', 'D-016', 'Dépense de 30 € sur Cadeaux à 0 € : acceptée, solde −30 €', 'authenticated', 'cam',
  expense('cadeaux', 3000, 's-4'), 'ok', f"{BAL('cadeaux')}=-3000")
t('S05', 'TRF-15', 'Arbitrage 21/11', 'Transfert depuis une enveloppe déjà négative : refusé', 'authenticated', 'cam',
  transfer(ACC('cadeaux'), ACC('courses'), 100, 's-5'), '23514', f"{BAL('cadeaux')}=-3000", msg='cannot create a deficit')
step(f"select pg_temp.put_num('res_s6', {SYS('reserve')});")
t('S06', 'TRF-13', 'D-015/D-018', 'Réaffectation explicite Réserve → Cadeaux 20 € : déficit réduit à −10 €, réserve −20 €', 'authenticated', 'cam',
  transfer(RES, ACC('cadeaux'), 2000, 's-6'), 'ok', f"{BAL('cadeaux')}=-1000 and {SYS('reserve')}=current_setting('lot2.res_s6')::numeric-2000")
# ---------------------------------------------------------------- H. Arbitrage : archivage à solde exactement nul
step("select pg_temp.put_num('ntx_a0', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));")
t('A01', 'ENV-08', 'D-023', 'Archivage de Vacances (solde non nul) refusé, enveloppe active, aucune écriture', 'postgres', None,
  f"perform duo_v3_private.archive_envelope({ID('vacances')});", '23514',
  f"(select status from public.duo_v3_envelopes where id={ID('vacances')})='active' and {NTX}=current_setting('lot2.ntx_a0')::bigint",
  msg='exactly zero')
t('A02', 'ENV-08', 'D-023', 'Archivage direct privilégié d’une enveloppe à −10 € refusé (garde en base)', 'postgres', None,
  f"update public.duo_v3_envelopes set status='archived', archived_at=now() where id={ID('cadeaux')};", '23514',
  f"(select status from public.duo_v3_envelopes where id={ID('cadeaux')})='active'", msg='exactly zero')
t('A03', 'ENV-08', 'D-023', 'Archivage d’une enveloppe à solde exactement nul : accepté, sans écriture', 'postgres', None,
  f"perform duo_v3_private.archive_envelope({ID('ancienne')});", 'ok',
  f"(select status='archived' and archived_at is not null from public.duo_v3_envelopes where id={ID('ancienne')}) and {NTX}=current_setting('lot2.ntx_a0')::bigint")
t('A04', 'ENV-08', 'D-023', 'Archivage rejoué : idempotent', 'postgres', None,
  f"perform duo_v3_private.archive_envelope({ID('ancienne')});", 'ok', 'true')
t('A05', 'ENV-08', 'D-023', 'Nouvelle allocation sur une enveloppe archivée refusée', 'postgres', None,
  f"perform duo_v3_private.set_allocation({ID('ancienne')}, 1000, '2031-01-01');", '23514', msg='cannot receive an allocation')
t('X13', 'TRF-14', 'D-023', 'Dépense hors ligne sur une enveloppe archivée : refus explicite (pas de reclassement)', 'authenticated', 'cam',
  expense('ancienne', 100, 'e-arch-1', "(now() at time zone 'Europe/Paris')::date - 40"), '23503',
  f"{NTX}=current_setting('lot2.ntx_a0')::bigint", msg='choose an active envelope')
t('X14', 'TRF-14', 'D-023', 'Transfert vers l’enveloppe archivée refusé', 'authenticated', 'cam',
  transfer(ACC('courses'), ACC('ancienne'), 100, 'trf-arch-1'), '23503', msg='not eligible')
# ---------------------------------------------------------------- I. Clôture interrompue, relancée, rejouée
step("""select pg_temp.put_num('ntx_g0', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));
select pg_temp.put_num('temp_before', (select balance_minor from public.duo_v3_envelope_balances where envelope_id=pg_temp.id('temp')));
select pg_temp.put_num('p3_end', extract(epoch from (select ends_at from public.duo_v3_periods where id=pg_temp.id('p3'))));""")
P3NOW = "to_timestamp(current_setting('lot2.p3_end')::numeric) + interval '1 second'"
NOP3 = ("(select state from public.duo_v3_periods where id=pg_temp.id('p3'))='open' "
        "and not exists (select 1 from public.duo_v3_period_closes where period_id=pg_temp.id('p3')) "
        "and (select count(*) from public.duo_v3_periods where household_id=pg_temp.u('ha'))=3")
t('G01', 'CYC-05', 'D-029', 'Clôture interrompue après reports et allocations : tout est annulé (période ouverte, 0 écriture)', 'postgres', None,
  f"perform duo_v3_private.close_period(pg_temp.u('ha'), {ID('p3')}, {P3NOW}); raise exception 'interruption simulée';", 'P0001',
  NOP3 + f" and {NTX}=current_setting('lot2.ntx_g0')::bigint")
t('G02', 'CYC-05', 'D-029', 'Clôture relancée : une période suivante, une allocation par enveloppe active, aucune pour l’archivée', 'postgres', None,
  f"perform pg_temp.put('p4', duo_v3_private.close_period(pg_temp.u('ha'), {ID('p3')}, {P3NOW}));", 'ok',
  "(select count(*) from public.duo_v3_period_closes where period_id=pg_temp.id('p3'))=1 "
  "and (select count(*) from public.duo_v3_period_allocations where period_id=pg_temp.id('p4'))=7 "
  "and (select count(*) from public.duo_v3_envelopes where household_id=pg_temp.u('ha') and status='active')=7 "
  "and (select count(*) from public.duo_v3_transactions where period_id=pg_temp.id('p4') and kind='allocation')=6 "
  "and (select amount_minor=0 and transaction_id is null from public.duo_v3_period_allocations where period_id=pg_temp.id('p4') and envelope_id=pg_temp.id('cadeaux')) "
  "and not exists (select 1 from public.duo_v3_period_allocations where envelope_id=pg_temp.id('ancienne')) "
  "and not exists (select 1 from public.duo_v3_period_envelope_closes where envelope_id=pg_temp.id('ancienne')) "
  f"and {BAL('temp')}=10000")
step("select pg_temp.put_num('ntx_g2', (select count(*) from public.duo_v3_transactions where household_id=pg_temp.u('ha')));")
t('G03', 'CYC-05', 'D-029', 'Clôture rejouée deux fois et rattrapage paresseux : même période, aucun report ni allocation en double', 'postgres', None,
  f"perform pg_temp.put('p4b', duo_v3_private.close_period(pg_temp.u('ha'), {ID('p3')}, {P3NOW}));"
  f"perform duo_v3_private.close_period(pg_temp.u('ha'), {ID('p3')}, {P3NOW} + interval '1 hour');"
  f"perform duo_v3_private.ensure_current_period(pg_temp.u('ha'), {P3NOW});", 'ok',
  f"pg_temp.id('p4b')=pg_temp.id('p4') and {NTX}=current_setting('lot2.ntx_g2')::bigint "
  "and (select count(*) from (select idempotency_key from public.duo_v3_transactions where household_id=pg_temp.u('ha') "
  "     and kind in ('carry','allocation') group by 1 having count(*)>1) d)=0")
t('G04', 'CYC-05', 'D-029', 'Écriture système rejouée (même clé de report) : même transaction, rien de nouveau', 'postgres', None,
  "perform duo_v3_private.post_system(pg_temp.u('ha'), pg_temp.id('p4'), 'carry', "
  "(select idempotency_key from public.duo_v3_transactions where household_id=pg_temp.u('ha') and kind='carry' order by created_at limit 1), "
  f"{RES}, {RES}, 1, current_date);", 'ok', f"{NTX}=current_setting('lot2.ntx_g2')::bigint")
t('G05', 'CYC-05', 'D-029', 'Deuxième allocation de la même enveloppe pour la même période refusée en base', 'postgres', None,
  "insert into public.duo_v3_period_allocations(period_id,household_id,envelope_id,amount_minor,transaction_id) "
  "select period_id,household_id,envelope_id,amount_minor,transaction_id from public.duo_v3_period_allocations "
  "where period_id=pg_temp.id('p4') and envelope_id=pg_temp.id('temp');", '23505', msg='duo_v3_period_allocations_pkey')
t('A06', 'ENV-08', 'D-023/D-028', 'Archivage devenu incompatible (0 € à la demande, 100 € alloués à l’exécution) : refusé, sans effet partiel', 'postgres', None,
  f"perform duo_v3_private.archive_envelope({ID('temp')});", '23514',
  f"current_setting('lot2.temp_before')::numeric=0 and (select status from public.duo_v3_envelopes where id={ID('temp')})='active' "
  f"and {BAL('temp')}=10000 and {NTX}=current_setting('lot2.ntx_g2')::bigint", msg='exactly zero')
t('X15', 'SEC-08', '005', 'TRUNCATE des périodes refusé même pour postgres', 'postgres', None,
  "execute 'truncate public.duo_v3_periods cascade';", '23514', msg='immutable (duo_v3_periods)')
t('X16', 'SEC-08', '005', 'Allocation passée et instantané de clôture immuables', 'postgres', None,
  f"update public.duo_v3_period_envelope_closes set to_reserve_minor=0 where period_id={ID('p1')};", '23514', msg='immutable (duo_v3_period_envelope_closes)')
t('X17', 'SEC-08', '005', 'Privilèges : anon aucun droit, authenticated SELECT seul, sur toutes les tables et vues V3', 'postgres', None,
  'perform 1;', 'ok',
  "not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
  "cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p "
  "where c.relname like 'duo_v3_%' and c.relkind in ('r','v') and (has_table_privilege('anon',c.oid,p) "
  "or (p<>'SELECT' and has_table_privilege('authenticated',c.oid,p))))")
t('X18', 'SEC-04', '005', 'Fonctions : RPC exécutables par authenticated seulement ; fonctions serveur par personne', 'postgres', None,
  'perform 1;', 'ok',
  "(select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) "
  " from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in "
  " ('duo_v3_post_transfer','duo_v3_post_expense','duo_v3_post_contribution')) "
  "and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='duo_v3_private' "
  " and p.proname not in ('is_member','is_current_member') and (has_function_privilege('authenticated',p.oid,'EXECUTE') "
  " or has_function_privilege('anon',p.oid,'EXECUTE')))")

# ---------------------------------------------------------------- génération
FP = "select jsonb_build_object('empreinte', empreinte, 'objets', objets) from (select md5(string_agg(x, E'\\n' order by x)) as empreinte, count(*) as objets from (\n  select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'')||' '||coalesce(generation_expression,'') x\n    from information_schema.columns where table_schema in ('public','duo_v3_private') and table_name like 'duo_v3%'\n  union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text like '%duo_v3%'\n  union all select 'idx '||indexdef from pg_indexes where tablename like 'duo_v3%'\n  union all select 'trg '||tgrelid::regclass||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%duo_v3%'\n  union all select 'pol '||tablename||' '||policyname||' '||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where tablename like 'duo_v3%'\n  union all select 'fun '||n.nspname||'.'||p.proname||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','duo_v3_private') and (p.proname like 'duo_v3%' or n.nspname='duo_v3_private')\n  union all select 'acl '||c.relname||' '||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'duo_v3%'\n  union all select 'com '||c.relname||'.'||a.attname||' '||col_description(c.oid,a.attnum) from pg_class c join pg_attribute a on a.attrelid=c.oid where c.relname like 'duo_v3%' and col_description(c.oid,a.attnum) is not null\n) s) z"
HEAD = [
 "begin;",
 "set local lot2.res = '[]';",
 "create temp table ids(k text primary key, v uuid, n numeric) on commit drop;",
 "grant select on ids to public;",
 "create function pg_temp.u(p text) returns uuid language sql immutable as $f$ select v::uuid from (values " +
   ','.join(f"('{k}','{v}')" for k, v in U.items()) + ") m(k,v) where k=p $f$;",
 "create function pg_temp.id(p text) returns uuid language sql stable as $f$ select v from ids where k=p $f$;",
 "create function pg_temp.put(p text, v uuid) returns uuid language sql as $f$ insert into ids(k,v) values (p,v) on conflict (k) do update set v=excluded.v returning v $f$;",
 "create function pg_temp.put_num(p text, v numeric) returns numeric language sql as $f$ select set_config('lot2.'||p, v::text, true)::numeric $f$;",
 "create function pg_temp.rec(p_id text, p_s text, p_m text, p_c boolean, p_t timestamptz) returns void language sql as $f$ "
 "select set_config('lot2.res', (current_setting('lot2.res')::jsonb || jsonb_build_array(jsonb_build_object('id',p_id,'role',current_user,"
 "'sub',current_setting('request.jwt.claim.sub',true),'obtenu',p_s,'message',left(p_m,240),'controle',p_c,"
 "'ms',round(extract(epoch from clock_timestamp()-p_t)*1000,2))))::text, true) $f$;",
 "create function pg_temp.ctx(p_role text, p_sub uuid, p_anon boolean) returns void language sql as $f$ "
 "select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role',p_role,'sub',p_sub,'is_anonymous',case when p_anon then true end))::text, true), "
 "set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true), case when p_role<>'postgres' then set_config('role', p_role, true) end $f$;",
 "create function pg_temp.run(p_id text, p_role text, p_sub uuid, p_anon boolean, p_action text, p_check text) returns void language plpgsql as $f$ "
 "declare t timestamptz := clock_timestamp(); s text := 'OK'; m text := ''; c boolean; begin "
 "perform set_config('role', 'none', true); execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform pg_temp.ctx(p_role, p_sub, p_anon); "
 "begin execute 'do $y$ begin ' || p_action || ' end $y$'; execute 'set constraints all immediate'; exception when others then s := sqlstate; m := sqlerrm; end; "
 "begin execute 'select (' || p_check || ')' into c; exception when others then c := false; m := m || ' | contrôle : ' || sqlerrm; end; "
 "perform pg_temp.rec(p_id, s, m, c, t); perform set_config('role', 'none', true); execute 'set constraints all deferred'; end $f$;",
 "grant execute on function pg_temp.u(text), pg_temp.id(text), pg_temp.put(text,uuid), pg_temp.put_num(text,numeric), "
 "pg_temp.rec(text,text,text,boolean,timestamptz), pg_temp.ctx(text,uuid,boolean) to public;",
 "-- Jeu de données fictif",
 "insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values " +
   ','.join(f"(pg_temp.u('{k}'),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot2-{k}@example.invalid','',now(),now())"
            for k in ('cam', 'alex', 'cla')) + ";",
 "insert into public.duo_v3_households(id, cycle_start_day, time_zone) values "
 "(pg_temp.u('ha'),1,'Europe/Paris'),(pg_temp.u('hb'),1,'Europe/Paris'),(pg_temp.u('hc'),1,'Europe/Paris'),"
 "(pg_temp.u('hd'),29,'Europe/Paris'),(pg_temp.u('he'),31,'Europe/Paris');",
 "insert into public.duo_v3_members(household_id,user_id,role) values (pg_temp.u('ha'),pg_temp.u('cam'),'owner'),"
 "(pg_temp.u('ha'),pg_temp.u('alex'),'partner'),(pg_temp.u('hb'),pg_temp.u('cla'),'owner'),(pg_temp.u('hc'),pg_temp.u('cam'),'owner');",
]
TAIL = ["reset role;",
        "select jsonb_build_object('lot','2','horodatage_serveur', now(), 'pg', current_setting('server_version'),",
        "  'schema_006', (" + FP + "),",
        "  'resultats', current_setting('lot2.res')::jsonb) as lot2;",
        "rollback;"]

def build(mode):
    out = [f"-- GÉNÉRÉ par gen_lot2.py (mode {mode}) — ne pas éditer à la main. Une transaction, terminée par ROLLBACK."]
    head = list(HEAD)
    if mode == 'dev':
        mig = pathlib.Path(__file__).parents[3].joinpath('supabase/migrations/20261121_006_duo_v3_financial_model.sql').read_text()
        body = mig[mig.index('\nbegin;') + 7:mig.rindex('commit;')]
        head.insert(1, "-- Migration 006 exécutée DANS la transaction (non appliquée)\n" + body.strip())
    out += head
    si = 0
    for i, x in enumerate(T):
        while si < len(STEPS) and STEPS[si][0] == i:
            out.append('reset role;'); out.append(STEPS[si][1]); si += 1
        out.append(run(x))
    out += TAIL
    return '\n'.join(out) + '\n'

here = pathlib.Path(__file__).parent
for mode in ('local', 'dev'):
    (here / f'lot2_financial_model_{mode}.sql').write_text(build(mode))
json.dump([{k: x[k] for k in ('id', 'mat', 'dec', 'titre', 'expect', 'info', 'msg', 'role', 'sub')} for x in T],
          open(here / 'lot2_specs.json', 'w'), ensure_ascii=False, indent=1)
print(len(T), 'tests')
