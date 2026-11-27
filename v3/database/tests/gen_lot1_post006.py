#!/usr/bin/env python3
"""Génère lot1_post006.sql : recette du lot 1 rejouée sur le modèle 006 (non-régression).

Différences voulues avec le lot 1 : fixtures avec périodes ouvertes, écritures privilégiées
imputées et équilibrées dans le livre budget, transferts RPC entre comptes du livre budget.
R21 vérifie la transition du contrat (trésorerie → enveloppe refusé).

Ancien en-tête :

Suite d'intégration du lot 1 (sécurité RLS, écritures authentifiées, grand livre,
idempotence, précision) pour le projet Supabase DEV eetnzdvjfzexgvqbtyrj.

Tout s'exécute dans UNE transaction terminée par ROLLBACK : aucune donnée n'est
conservée, aucun utilisateur Auth réel n'est créé. Les rôles `authenticated` et
`anon` sont simulés avec SET LOCAL ROLE et les claims JWT (request.jwt.claims),
comme le fait PostgREST. Ce n'est PAS un test HTTP de bout en bout : la
concurrence réelle et les vrais jetons restent couverts par
scripts/v3-finance-e2e-dev.cjs.
"""
import json, pathlib

HA = 'a0000000-0000-4000-8000-00000000000a'   # duo A : Camille + Alex
HB = 'b0000000-0000-4000-8000-00000000000b'   # duo B : Claire
CAM, ALEX, CLA = ('a1000000-0000-4000-8000-0000000000a1',
                  'a2000000-0000-4000-8000-0000000000a2',
                  'c1000000-0000-4000-8000-0000000000c1')
ACC = {  # id, ménage, libellé, type, devise
 'cashA': ('a0c00000-0000-4000-8000-000000000001', HA, 'A cash', 'cash', 'EUR'),
 'resA':  ('a0c00000-0000-4000-8000-000000000002', HA, 'A réserve', 'reserve', 'EUR'),
 'envA':  ('a0c00000-0000-4000-8000-000000000003', HA, 'A Loisirs', 'envelope', 'EUR'),
 'clrA':  ('a0c00000-0000-4000-8000-000000000004', HA, 'A compensation', 'clearing', 'EUR'),
 'usdA':  ('a0c00000-0000-4000-8000-000000000005', HA, 'A enveloppe USD', 'envelope', 'USD'),
 'usdA2': ('a0c00000-0000-4000-8000-000000000006', HA, 'A réserve USD', 'reserve', 'USD'),
 'cashB': ('b0c00000-0000-4000-8000-000000000001', HB, 'B enveloppe', 'envelope', 'EUR'),
 'resB':  ('b0c00000-0000-4000-8000-000000000002', HB, 'B réserve', 'reserve', 'EUR'),
}
A = {k: v[0] for k, v in ACC.items()}
TX = lambda n: f'e0000000-0000-4000-8000-{n:012d}'
PA, PB = 'f0000000-0000-4000-8000-0000000000aa', 'f0000000-0000-4000-8000-0000000000bb'

def q(s): return "'" + s.replace("'", "''") + "'"

def claims(sub=None, anonymous=False, role='authenticated'):
    c = {'role': role}
    if sub: c['sub'] = sub
    if anonymous: c['is_anonymous'] = True
    return json.dumps(c)

def ctx(role, sub=None, anonymous=False):
    return f"reset role; set constraints all deferred; select pg_temp.ctx({q(role)},{q(sub or '')},{'true' if anonymous else 'false'});"

T = []  # (id, matrice, titre, contexte, action, attendu, check)
def t(tid, mat, titre, context, action, expect='ok', check=None, info=False):
    T.append(dict(id=tid, mat=mat, titre=titre, ctx=context, action=action, expect=expect, check=check, info=info))

PG = ('postgres',)
def tx_sql(n, h, key, kind='transfer', cur='EUR', rev=None, by=CAM):
    r = f"'{rev}'" if rev else 'null'
    per = PA if h == HA else PB
    return (f"insert into public.duo_v3_transactions(id,household_id,currency,idempotency_key,kind,created_by,reverses_transaction_id,period_id) "
            f"values ('{TX(n)}','{h}','{cur}','{key}','{kind}','{by}',{r},'{per}');")
def en_sql(n, h, cur, *pairs):
    pairs = [('envA' if a == 'cashA' else a, amt) for a, amt in pairs]
    vals = ','.join(f"('{TX(n)}','{h}','{A[a]}','{cur}',{amt})" for a, amt in pairs)
    return f"insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values {vals};"
IMM = "execute 'set constraints all immediate'; execute 'set constraints all deferred';"
def rpc(h, f, to, amt, key, cur='EUR'):
    f = 'resA' if f == 'cashA' else f
    to = 'resA' if to == 'cashA' else to
    return f"public.duo_v3_post_transfer('{h}','{A[f]}','{A[to]}',{amt},{q(cur)},{q(key)})"

# ---------------------------------------------------------------- intégrité (rôle privilégié)
t('L01', '—', 'Écriture équilibrée +100/−100 validée au COMMIT', PG,
  tx_sql(1, HA, 'L01') + en_sql(1, HA, 'EUR', ('cashA', -100), ('resA', 100)) + IMM)
t('L02', '—', 'Une seule ligne d’écriture refusée au COMMIT', PG,
  tx_sql(2, HA, 'L02') + en_sql(2, HA, 'EUR', ('cashA', -100)) + IMM, '23514')
t('L03', '—', 'Écriture déséquilibrée +100/−99 refusée', PG,
  tx_sql(3, HA, 'L03') + en_sql(3, HA, 'EUR', ('cashA', -100), ('resA', 99)) + IMM, '23514')
t('L04', '—', 'Transaction sans ligne refusée', PG, tx_sql(4, HA, 'L04') + IMM, '23514')
t('L05', 'SEC-01', 'Ligne du duo A pointant un compte du duo B refusée (FK composite)', PG,
  tx_sql(5, HA, 'L05') + en_sql(5, HA, 'EUR', ('cashA', -100), ('cashB', 100)) + IMM, '23503')
t('L06', 'FIA-05', 'Clé d’idempotence dupliquée dans un même duo refusée', PG,
  tx_sql(6, HA, 'L01') + en_sql(6, HA, 'EUR', ('cashA', -1), ('resA', 1)) + IMM, '23505')
t('L07a', 'SEC-08', 'UPDATE d’une transaction comptabilisée refusé', PG,
  f"update public.duo_v3_transactions set kind='income' where id='{TX(1)}';", '23514')
t('L07b', 'SEC-08', 'DELETE d’une ligne comptabilisée refusé', PG,
  f"delete from public.duo_v3_entries where transaction_id='{TX(1)}';", '23514')
t('L08', 'TRF-15', 'Contre-passation exacte acceptée', PG,
  tx_sql(8, HA, 'L08', 'reversal', rev=TX(1)) + en_sql(8, HA, 'EUR', ('cashA', 100), ('resA', -100)) + IMM)
t('L09', 'TRF-15', 'Deuxième contre-passation du même original refusée', PG,
  tx_sql(9, HA, 'L09', 'reversal', rev=TX(1)) + en_sql(9, HA, 'EUR', ('cashA', 100), ('resA', -100)) + IMM, '23505')
t('L10a', 'SEC-01', 'Contre-passation depuis un autre duo refusée', PG,
  tx_sql(10, HB, 'L10a', 'reversal', rev=TX(11), by=CLA) + en_sql(10, HB, 'EUR', ('cashB', 50), ('resB', -50)) + IMM, '23514')
t('L10b', '—', 'Contre-passation dans une autre devise refusée', PG,
  tx_sql(12, HA, 'L10b', 'reversal', 'USD', rev=TX(11)) + en_sql(12, HA, 'USD', ('usdA', 50), ('usdA2', -50)) + IMM, '23514')
t('L11', 'TRF-15', 'Contre-passation inexacte (répartition différente) refusée', PG,
  tx_sql(13, HA, 'L11', 'reversal', rev=TX(11)) + en_sql(13, HA, 'EUR', ('cashA', 50), ('envA', -50)) + IMM, '23514')
t('P01', 'TRF-12', 'Écriture privilégiée 100,6 centimes : refus attendu (pas d’arrondi silencieux)', PG,
  tx_sql(14, HA, 'P01') + en_sql(14, HA, 'EUR', ('cashA', '-100.6'), ('resA', '100.6')) + IMM, '22023', info=True)

# ---------------------------------------------------------------- lecture (RLS, rôles réels)
cnt = lambda tbl, h: f"(select count(*) from public.{tbl} where household_id='{h}')"
t('S01', 'SEC-02', 'Camille lit son duo : 1 duo, 2 membres, 6 comptes, écritures visibles', ('authenticated', CAM),
  'perform 1;', 'ok',
  f"(select count(*) from public.duo_v3_households)=1 and {cnt('duo_v3_members',HA)}=2 and {cnt('duo_v3_accounts',HA)}=7 "
  f"and {cnt('duo_v3_transactions',HA)}>=1 and {cnt('duo_v3_entries',HA)}>=2")
t('S02', 'SEC-02', 'Alex (partenaire) lit le même registre partagé', ('authenticated', ALEX),
  'perform 1;', 'ok', f"{cnt('duo_v3_accounts',HA)}=7 and {cnt('duo_v3_entries',HA)}>=2")
t('S03', 'SEC-01', 'Claire (duo B) ne voit rien du duo A', ('authenticated', CLA), 'perform 1;', 'ok',
  f"(select count(*) from public.duo_v3_households)=1 and {cnt('duo_v3_members',HA)}=0 and {cnt('duo_v3_accounts',HA)}=0 "
  f"and {cnt('duo_v3_transactions',HA)}=0 and {cnt('duo_v3_entries',HA)}=0")
t('S04', 'SEC-01', 'Rôle anon : lecture du registre refusée', ('anon',),
  "if (select count(*) from public.duo_v3_entries) > 0 then raise exception 'fuite anon' using errcode='P0001'; end if;", '42501|OK')
t('S05', 'SEC-01', 'Jeton authenticated sans sujet : zéro ligne', ('authenticated', None), 'perform 1;', 'ok',
  "(select count(*) from public.duo_v3_entries)=0 and (select count(*) from public.duo_v3_households)=0")
# écritures directes
t('S06', 'SEC-04', 'INSERT direct d’une transaction par Camille refusé', ('authenticated', CAM),
  tx_sql(20, HA, 'direct'), '42501')
t('S07', 'SEC-04', 'INSERT direct de lignes par Camille refusé', ('authenticated', CAM),
  en_sql(1, HA, 'EUR', ('cashA', 1), ('resA', -1)), '42501')
t('S08', 'SEC-01', 'Claire s’ajoute elle-même au duo A : refusé', ('authenticated', CLA),
  f"insert into public.duo_v3_members(household_id,user_id,role) values ('{HA}','{CLA}','partner');", '42501')
t('S09', 'SEC-04', 'UPDATE direct d’un compte refusé', ('authenticated', CAM),
  f"update public.duo_v3_accounts set label='x' where id='{A['envA']}';", '42501')
t('S10', 'SEC-08', 'DELETE direct d’une ligne refusé', ('authenticated', CAM),
  f"delete from public.duo_v3_entries where transaction_id='{TX(1)}';", '42501')

t('S12', 'SEC-08', 'TRUNCATE du registre par un utilisateur connecté refusé', ('authenticated', CAM),
  'truncate public.duo_v3_entries;', '42501')
t('S13', 'SEC-08', 'TRUNCATE du registre par anon refusé', ('anon',), 'truncate public.duo_v3_entries;', '42501')

# ---------------------------------------------------------------- RPC d’écriture authentifiée
t('R01', 'TRF-13', 'Transfert 25,00 € cash → Loisirs : conservatif (somme du duo constante)', ('authenticated', CAM),
  f"perform set_config('lot1.r01', {rpc(HA,'cashA','envA',2500,'trf-25')}::text, true);", 'ok',
  f"(select sum(amount_minor) from public.duo_v3_entries where transaction_id=current_setting('lot1.r01')::uuid)=0 "
  f"and (select amount_minor from public.duo_v3_entries where transaction_id=current_setting('lot1.r01')::uuid and account_id='{A['envA']}')=2500 "
  f"and (select sum(amount_minor) from public.duo_v3_entries where household_id='{HA}')=0")
t('R02', 'FIA-05', 'Rejeu identique (même clé) : même identifiant, une seule transaction', ('authenticated', CAM),
  f"perform set_config('lot1.r02', {rpc(HA,'cashA','envA',2500,'trf-25')}::text, true);", 'ok',
  f"current_setting('lot1.r02')=current_setting('lot1.r01') and (select count(*) from public.duo_v3_transactions where household_id='{HA}' and idempotency_key='trf-25')=1")
t('R03', 'FIA-06', 'Même clé, 30,00 € au lieu de 25,00 € : rejet 23505, rien écrit', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','envA',3000,'trf-25')};", '23505',
  f"(select count(*) from public.duo_v3_entries where household_id='{HA}' and abs(amount_minor)=3000)=0")
t('R04', 'FIA-07', 'Double appui (deux appels successifs, même clé) : une seule opération', ('authenticated', CAM),
  f"perform {rpc(HA,'resA','envA',700,'tap-1')}; perform {rpc(HA,'resA','envA',700,'tap-1')};", 'ok',
  f"(select count(*) from public.duo_v3_transactions where household_id='{HA}' and idempotency_key='tap-1')=1")
t('R05', 'SEC-01', 'Claire écrit dans le duo A par la RPC : refusé', ('authenticated', CLA),
  f"perform {rpc(HA,'cashA','envA',100,'cla-1')};", '42501')
t('R06', 'SEC-01', 'Camille vise un compte du duo B : refusé', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','cashB',100,'xb-1')};", '23503')
for i, (amt, lab) in enumerate([('0', 'zéro'), ('-100', 'négatif'), ('1.5', 'fraction de centime (0,015 €)'),
                                 ('null', 'nul'), ('1e38', '10^38 (hors bornes)')]):
    t(f'R07{"abcde"[i]}', 'TRF-12', f'Montant {lab} refusé (22023)', ('authenticated', CAM),
      f"perform {rpc(HA,'cashA','envA',amt,'amt-'+str(i))};", '22023')
t('R08', 'TRF-12', 'Compte source = destination refusé', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','cashA',100,'same-1')};", '22023')
t('R09', '—', 'Compte de compensation exclu des transferts', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','clrA',100,'clr-1')};", '23503')
t('R10', '—', 'Devise incohérente avec les comptes refusée', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','envA',100,'cur-1','USD')};", '23503')
t('R11', 'SEC-01', 'Session anonyme Supabase (is_anonymous) refusée', ('authenticated', CAM, True),
  f"perform {rpc(HA,'cashA','envA',100,'anon-1')};", '42501')
t('R12', 'SEC-01', 'Jeton sans sujet refusé', ('authenticated', None),
  f"perform {rpc(HA,'cashA','envA',100,'nosub-1')};", '42501')
t('R13', 'SEC-01', 'Rôle anon : exécution de la RPC refusée', ('anon',),
  f"perform {rpc(HA,'cashA','envA',100,'anonrole-1')};", '42501')
t('R14', 'SEC-02', 'Alex (partenaire) écrit dans le duo A', ('authenticated', ALEX),
  f"perform {rpc(HA,'resA','envA',100,'alex-1')};", 'ok',
  f"(select count(*) from public.duo_v3_transactions where household_id='{HA}' and idempotency_key='alex-1' and created_by='{ALEX}')=1")
t('R15', 'SEC-01', '… et Claire ne voit pas cette écriture', ('authenticated', CLA), 'perform 1;', 'ok',
  "(select count(*) from public.duo_v3_transactions where idempotency_key='alex-1')=0")
t('R16', 'TRF-12', 'Grand montant 10^20 − 1 centimes conservé exactement', ('authenticated', CAM),
  f"perform set_config('lot1.r16', {rpc(HA,'resA','envA','99999999999999999999','big-1')}::text, true);", 'ok',
  "(select amount_minor::text from public.duo_v3_entries where transaction_id=current_setting('lot1.r16')::uuid and amount_minor>0)='99999999999999999999' "
  "and (select sum(amount_minor) from public.duo_v3_entries where transaction_id=current_setting('lot1.r16')::uuid)=0")
t('R17a', 'FIA-05', 'Clé d’idempotence vide refusée', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','envA',100,'')};", '22023')
t('R17b', 'FIA-05', 'Clé d’idempotence de 129 caractères refusée', ('authenticated', CAM),
  f"perform {rpc(HA,'cashA','envA',100,'k'*129)};", '22023')
t('R18', 'SEC-01', 'Même clé dans un autre duo : transaction distincte, aucune fuite', ('authenticated', CLA),
  f"perform set_config('lot1.r18', {rpc(HB,'cashB','resB',100,'trf-25')}::text, true);", 'ok',
  "current_setting('lot1.r18')<>current_setting('lot1.r01')")
t('R21', 'TRF-13', 'Transition du contrat 006 : transfert trésorerie → enveloppe refusé (23503)', ('authenticated', CAM),
  f"perform public.duo_v3_post_transfer('{HA}','{A['cashA']}','{A['envA']}',100,'EUR','cash-env-1');", '23503')
t('R19', 'SEC-01', 'Oracle d’appartenance fermé : is_member(duo A, Camille) refusé à Claire', ('authenticated', CLA),
  f"if duo_v3_private.is_member('{HA}','{CAM}') then raise exception 'is_member révèle l''appartenance à un autre duo' using errcode='P0001'; end if;",
  '42501')
t('R20', 'SEC-01', 'is_current_member : vrai pour Camille sur son duo, faux pour Claire', ('authenticated', CAM),
  f"if not duo_v3_private.is_current_member('{HA}') then raise exception 'faux négatif' using errcode='P0001'; end if;", 'ok')
# contrôles de déploiement de la migration 005
t('T01', 'SEC-08', 'TRUNCATE par postgres refusé (trigger, contrôles différés vidés)', PG,
  "execute 'set constraints all immediate'; truncate public.duo_v3_entries;", '23514')
t('T02', 'SEC-08', 'TRUNCATE … CASCADE par service_role refusé', ('service_role',),
  "execute 'set constraints all immediate'; truncate public.duo_v3_transactions cascade;", '23514')
t('T03', 'SEC-08', 'Mode réplication (postgres) : refus attendu, contournement constaté puis annulé', PG,
  "execute 'set constraints all immediate'; set local session_replication_role = replica; truncate public.duo_v3_entries; "
  "raise exception 'contournement possible' using errcode='P0002';", '23514', info=True)
t('D01', 'SEC-08', 'Nouvelle table et nouvelle fonction : aucun droit implicite pour anon/authenticated', PG,
  "create table public.zz_lot1_probe(x int); create function public.zz_lot1_fn() returns int language sql as 'select 1';", 'ok',
  "not has_table_privilege('anon','public.zz_lot1_probe','SELECT') and not has_table_privilege('authenticated','public.zz_lot1_probe','SELECT') "
  "and not has_function_privilege('anon','public.zz_lot1_fn()','EXECUTE') and not has_function_privilege('authenticated','public.zz_lot1_fn()','EXECUTE')")
t('D02', 'SEC-08', 'Privilèges effectifs : anon aucun, authenticated SELECT seul sur les 5 tables', PG, 'perform 1;', 'ok',
  "not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p "
  "where c.relname like 'duo_v3_%' and c.relkind='r' and (has_table_privilege('anon',c.oid,p) or (p<>'SELECT' and has_table_privilege('authenticated',c.oid,p))))")

# ---------------------------------------------------------------- ancien membre (SEC-06), dans un point de sauvegarde
DAN = 'd1000000-0000-4000-8000-0000000000d1'
SEC06 = [
 ('M01', 'SEC-06', 'Troisième membre ajouté directement en base (rôle privilégié) : refus attendu', ('postgres',),
  f"insert into public.duo_v3_members(household_id,user_id,role) values ('{HA}','{DAN}','partner');", '23514|P0001', None),
 ('S11p', 'SEC-06', 'Contrôle préalable : Dan, encore membre, lit le duo A', ('authenticated', DAN), 'perform 1;', 'ok',
  f"{cnt('duo_v3_accounts',HA)}=7"),
 ('S11a', 'SEC-06', 'Membre retiré : il ne lit plus rien du duo A', ('authenticated', DAN), 'perform 1;', 'ok',
  f"{cnt('duo_v3_accounts',HA)}=0 and {cnt('duo_v3_entries',HA)}=0"),
 ('S11b', 'SEC-06', 'Membre retiré : écriture par la RPC refusée', ('authenticated', DAN),
  f"perform {rpc(HA,'resA','envA',100,'ex-1')};", '42501', None),
 ('S11c', 'SEC-06', 'Retrait d’un membre qui a déjà écrit (Alex) : possible sans casser l’historique', ('postgres',),
  f"delete from public.duo_v3_members where household_id='{HA}' and user_id='{ALEX}';", 'ok', None),
]

def dq(s):
    return '$q$' + s + '$q$'

def block(x):
    c = x['ctx']; role = c[0]; sub = c[1] if len(c) > 1 and c[1] else ''
    anon = 'true' if len(c) > 2 and c[2] else 'false'
    return f"select pg_temp.run({q(x['id'])},{q(role)},{q(sub) if sub else 'null'},{anon},{dq(x['action'])},{dq(x['check'] or 'true')});"

def ctx_of(c):
    if c[0] == 'postgres': return ctx('postgres')
    return ctx(c[0], c[1] if len(c) > 1 else None, c[2] if len(c) > 2 else False)

out = ["-- GÉNÉRÉ par gen_lot1.py — ne pas éditer à la main.",
       "-- Supabase DEV eetnzdvjfzexgvqbtyrj UNIQUEMENT. Une transaction, terminée par ROLLBACK.",
       "begin;",
       "set local lot1.res = '[]';",
       "create function pg_temp.rec(p_id text, p_s text, p_m text, p_c boolean, p_t timestamptz) returns void language sql as $f$ "
       "select set_config('lot1.res', (current_setting('lot1.res')::jsonb || jsonb_build_array(jsonb_build_object('id',p_id,'role',current_user,"
       "'sub',current_setting('request.jwt.claim.sub',true),'obtenu',p_s,'message',left(p_m,240),'controle',p_c,"
       "'ms',round(extract(epoch from clock_timestamp()-p_t)*1000,2))))::text, true) $f$;",
       "create function pg_temp.ctx(p_role text, p_sub uuid, p_anon boolean) returns void language sql as $f$ "
       "select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('role',p_role,'sub',p_sub,'is_anonymous',case when p_anon then true end))::text, true), "
       "set_config('request.jwt.claim.sub', coalesce(p_sub::text,''), true), case when p_role<>'postgres' then set_config('role', p_role, true) end $f$;",
       "create function pg_temp.run(p_id text, p_role text, p_sub uuid, p_anon boolean, p_action text, p_check text) returns void language plpgsql as $f$ "
       "declare t timestamptz := clock_timestamp(); s text := 'OK'; m text := ''; c boolean; begin "
       "perform set_config('role', 'none', true); execute 'set constraints all deferred'; perform pg_temp.ctx(p_role, p_sub, p_anon); "
       "begin execute 'do $y$ begin ' || p_action || ' end $y$'; exception when others then s := sqlstate; m := sqlerrm; end; "
       "begin execute 'select (' || p_check || ')' into c; exception when others then c := false; m := m || ' | contrôle : ' || sqlerrm; end; "
       "perform pg_temp.rec(p_id, s, m, c, t); perform set_config('role', 'none', true); end $f$;",

       "-- Garde-fou : refuser toute base qui n’a pas le schéma attendu.",
       "do $g$ begin if to_regprocedure('public.duo_v3_post_transfer(uuid,uuid,uuid,numeric,text,text)') is null then raise exception 'Schéma V3 absent'; end if; end $g$;",
       "-- Jeu de données fictif (annulé en fin de script)",
       "insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values " +
       ','.join(f"('{u}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{n}@example.invalid','',now(),now())"
                for u, n in [(CAM, 'lot1-camille'), (ALEX, 'lot1-alex'), (CLA, 'lot1-claire')]) + ';',
       f"insert into public.duo_v3_households(id) values ('{HA}'),('{HB}');",
       f"insert into public.duo_v3_members(household_id,user_id,role) values ('{HA}','{CAM}','owner'),('{HA}','{ALEX}','partner'),('{HB}','{CLA}','owner');",
       "insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values " +
       ','.join(f"('{v[0]}','{v[1]}',{q(v[2])},'{v[3]}','{v[4]}')" for v in ACC.values()) + ';',
       "insert into public.duo_v3_periods(id,household_id,starts_on,ends_on,starts_at,ends_at) values "
       f"('{PA}','{HA}',date_trunc('month',now())::date,(date_trunc('month',now())+interval '1 month')::date,date_trunc('month',now()),date_trunc('month',now())+interval '1 month'),"
       f"('{PB}','{HB}',date_trunc('month',now())::date,(date_trunc('month',now())+interval '1 month')::date,date_trunc('month',now()),date_trunc('month',now())+interval '1 month');",
       "-- Réserve alimentée par une allocation privilégiée (budget seulement) pour les transferts R01–R04 et R16 (10^20 − 1)",
       "insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values ('a0c00000-0000-4000-8000-000000000008','" + HA + "','A allocations','budget_source','EUR');",
       tx_sql(15, HA, 'fund-15', 'allocation') + "insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values "
       f"('{TX(15)}','{HA}','a0c00000-0000-4000-8000-000000000008','EUR',-100000000000000999999),('{TX(15)}','{HA}','{A['resA']}','EUR',100000000000000999999);",
       "-- Arbitrage 21/11 : un transfert ne rend jamais une enveloppe négative ; l'enveloppe du duo B est alimentée pour R18",
       "insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values ('b0c00000-0000-4000-8000-000000000008','" + HB + "','B allocations','budget_source','EUR');",
       tx_sql(16, HB, 'fund-16', 'allocation', by=CLA) + "insert into public.duo_v3_entries(transaction_id,household_id,account_id,currency,amount_minor) values "
       f"('{TX(16)}','{HB}','b0c00000-0000-4000-8000-000000000008','EUR',-100000),('{TX(16)}','{HB}','{A['cashB']}','EUR',100000);",
       "-- Original utilisé par L10/L11 (duo A, EUR)",
       tx_sql(11, HA, 'orig-11') + en_sql(11, HA, 'EUR', ('cashA', -50), ('resA', 50)),
       "set constraints all immediate; set constraints all deferred;"]
for x in T:
    out.append(block(x))
out += ['-- SEC-06 : un 4e utilisateur (Dan) rejoint puis quitte le duo A',
        "insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values "
        f"('{DAN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lot1-dan@example.invalid','',now(),now());"]
for i, s6 in enumerate(SEC06):
    d = dict(id=s6[0], mat=s6[1], titre=s6[2], ctx=s6[3], action=s6[4], expect=s6[5], check=s6[6], info=s6[0] in ('M01', 'S11c'))
    if s6[0] == 'S11a':
        out += [f"delete from public.duo_v3_members where household_id='{HA}' and user_id='{DAN}';"]
    out.append(block(d))
out += ["reset role;",
        "select jsonb_build_object('horodatage_serveur', now(), 'pg', current_setting('server_version'), 'base', current_database(),",
        "  'resultats', current_setting('lot1.res')::jsonb) as lot1;",
        "rollback;"]
json.dump([{k: v for k, v in x.items() if k in ('id','mat','titre','expect','info')} for x in T] +
          [dict(id=a[0], mat=a[1], titre=a[2], expect=a[5], info=a[0] in ('M01','S11c')) for a in SEC06],
          open(pathlib.Path(__file__).with_name('lot1_post006_specs.json'), 'w'), ensure_ascii=False, indent=1)
NAMES = {'ha': HA, 'hb': HB, 'cam': CAM, 'alex': ALEX, 'cla': CLA, 'dan': 'd1000000-0000-4000-8000-0000000000d1', 'pa': PA, 'pb': PB, 'cashA9': 'a0c00000-0000-4000-8000-000000000009', 'srcA': 'a0c00000-0000-4000-8000-000000000008'}
NAMES.update({k: v for k, v in A.items()})
NAMES.update({f't{n}': TX(n) for n in range(1, 21)})
sql = '\n'.join(out) + '\n'
for k, v in sorted(NAMES.items(), key=lambda kv: -len(kv[0])):
    sql = sql.replace("'" + v + "'", "pg_temp.u('" + k + "')")
udef = ("create function pg_temp.u(p text) returns uuid language sql immutable as $f$ select v::uuid from (values " +
        ','.join(f"('{k}','{v}')" for k, v in NAMES.items()) + ") m(k,v) where k=p $f$;")
udef += ("\n-- Depuis la migration 005, aucune fonction n'est exécutable sans GRANT explicite (y compris dans pg_temp)."
         "\ngrant execute on function pg_temp.rec(text,text,text,boolean,timestamptz), pg_temp.ctx(text,uuid,boolean), pg_temp.u(text) to public;")
sql = sql.replace("-- Garde-fou :", udef + "\n-- Garde-fou :", 1)
p = pathlib.Path(__file__).with_name('lot1_post006.sql')
p.write_text(sql)
print(p, len(T) + len(SEC06), "tests")
