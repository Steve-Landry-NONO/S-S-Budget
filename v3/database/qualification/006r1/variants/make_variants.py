"""Produit des VARIANTES documentées des suites archivées, sans toucher aux originaux (POST006-07).
Chaque variante = copie du générateur + substitutions explicites (assertées), + fichiers générés suffixés.
  V-F3   lot1_post006 : la devise étrangère n'est plus créable (F3) ; L10b vérifie ce refus en amont.
  V-CF05 lot2        : le duo hc a son propre propriétaire (un compte = un duo actif, CF-05)."""
import pathlib, subprocess, sys, json, hashlib
T = pathlib.Path('src/lot2/v3/database/tests')
def patch(src, dst, subs):
    s = (T / src).read_text(encoding='utf-8')
    for sub in subs:
        old, new, why = sub[:3]; n = sub[3] if len(sub) > 3 else 1
        assert s.count(old) == n, (src, old[:60], s.count(old)); s = s.replace(old, new)
    (T / dst).write_text(s, encoding='utf-8'); return [sub[2] for sub in subs]
log = {}
log['V-F3'] = patch('gen_lot1_post006.py', 'gen_lot1_post006_variante_F3.py', [
 (" 'usdA':  ('a0c00000-0000-4000-8000-000000000005', HA, 'A enveloppe USD', 'envelope', 'USD'),\n 'usdA2': ('a0c00000-0000-4000-8000-000000000006', HA, 'A réserve USD', 'reserve', 'USD'),\n", "",
  "fixture : les comptes USD du duo EUR ne sont plus créés (interdits par F3)"),
 ("t('L10b', '—', 'Contre-passation dans une autre devise refusée', PG,\n  tx_sql(12, HA, 'L10b', 'reversal', 'USD', rev=TX(11)) + en_sql(12, HA, 'USD', ('usdA', 50), ('usdA2', -50)) + IMM, '23514')",
  "t('L10b', '—', 'VARIANTE F3 — compte d’une autre devise refusé en amont (la contre-passation inter-devises devient impossible)', PG,\n  \"insert into public.duo_v3_accounts(id,household_id,label,kind,currency) values ('a0c00000-0000-4000-8000-000000000005','\" + HA + \"','A enveloppe USD','envelope','USD');\", '23503')",
  "L10b : attente 23514 (contre-passation USD) remplacée par 23503 (création du compte USD refusée)"),
 ("{cnt('duo_v3_accounts',HA)}=7", "{cnt('duo_v3_accounts',HA)}=5",
  "S01, S02, S11p : le duo A compte 5 comptes au lieu de 7 (les 2 comptes USD ne sont plus créés)", 3),
 ("with_name('lot1_post006_specs.json')", "with_name('lot1_post006_variante_F3_specs.json')", "sortie suffixée"),
 ("p = pathlib.Path(__file__).with_name('lot1_post006.sql')", "p = pathlib.Path(__file__).with_name('lot1_post006_variante_F3.sql')", "sortie suffixée"),
])
log['V-CF05'] = patch('gen_lot2.py', 'gen_lot2_variante_CF05.py', [
 ("U = {'ha': HA, 'hb': HB, 'hc': HC, 'hd': HD, 'he': HE, 'cam': CAM, 'alex': ALEX, 'cla': CLA}",
  "U = {'ha': HA, 'hb': HB, 'hc': HC, 'hd': HD, 'he': HE, 'cam': CAM, 'alex': ALEX, 'cla': CLA, 'dom': 'd1000000-0000-4000-8000-0000000000d1'}",
  "nouvel utilisateur fictif « dom »"),
 ("for k in ('cam', 'alex', 'cla')) + \";\"", "for k in ('cam', 'alex', 'cla', 'dom')) + \";\"", "dom ajouté à auth.users"),
 ("(pg_temp.u('hc'),pg_temp.u('cam'),'owner');\",", "(pg_temp.u('hc'),pg_temp.u('dom'),'owner');\",", "hc appartient à dom (CF-05)"),
 ("'authenticated', 'cam', contrib(1000, 'c-hc-1', 'hc'), 'ok',", "'authenticated', 'dom', contrib(1000, 'c-hc-1', 'hc'), 'ok',", "L07 exécuté par dom"),
 ("(here / f'lot2_financial_model_{mode}.sql')", "(here / f'lot2_financial_model_{mode}_variante_CF05.sql')", "sortie suffixée"),
 ("open(here / 'lot2_specs.json', 'w')", "open(here / 'lot2_variante_CF05_specs.json', 'w')", "sortie suffixée"),
])
json.dump(log, open('variants_log.json', 'w'), ensure_ascii=False, indent=1)
for g in ('gen_lot1_post006_variante_F3.py', 'gen_lot2_variante_CF05.py'):
    subprocess.run([sys.executable, '-I', g], cwd=T, check=True)
for f in sorted(T.glob('*')):
    if f.is_file() and 'variante' in f.name or f.name.startswith(('lot1_post006', 'lot2_')) and f.suffix in ('.sql', '.json'):
        print(hashlib.sha256(f.read_bytes()).hexdigest()[:16], f.name)
