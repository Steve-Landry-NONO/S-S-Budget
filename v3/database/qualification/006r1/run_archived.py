#!/usr/bin/env python3
"""Rejoue une suite SQL archivée (générée par gen_lot2.py / gen_lot1_post006.py) sur une copie
jetable d'une base modèle, puis l'évalue contre ses specs JSON, avec les règles des rapports d'origine :
  lot 2 : obtenu ∈ expect (ou OK), controle vrai, et message attendu contenu dans le message (msg)
  lot 1 : obtenu ∈ expect (ou OK), controle vrai ; info=True → « Constat » si non réussi
Les fichiers SQL et specs ne sont PAS modifiés.
Usage : run_archived.py <template_db> <suite.sql> <specs.json> <label> [--keep]"""
import json, subprocess, sys, hashlib, datetime, pathlib
tpl, sqlf, specf, label = sys.argv[1:5]
keep = '--keep' in sys.argv
db = f"r_{label}"
psql = ["psql", "-h", "/tmp", "-p", "54317"]
def admin(cmd): subprocess.run(psql + ["-U", "supabase_admin", "-d", "postgres", "-q", "-c", cmd], check=True)
admin(f'drop database if exists "{db}" with (force)')
admin(f'create database "{db}" template "{tpl}" owner postgres')
t0 = datetime.datetime.now(datetime.timezone.utc)
p = subprocess.run(psql + ["-U", "postgres", "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-f", sqlf], capture_output=True, text=True)
raw = None
for line in p.stdout.splitlines()[::-1]:
    if '"resultats"' in line:
        raw = json.loads(line); break
specs = {s['id']: s for s in json.load(open(specf))}
out = dict(label=label, template=tpl, suite=sqlf, suite_sha256=hashlib.sha256(open(sqlf, 'rb').read()).hexdigest(),
           specs_sha256=hashlib.sha256(open(specf, 'rb').read()).hexdigest(), debut=t0.isoformat(timespec='seconds'),
           psql_code=p.returncode, stderr=p.stderr[-3000:])
if raw is None:
    out.update(bilan={'erreur_execution': 1}); print(json.dumps(out, ensure_ascii=False)[:2000])
else:
    res = raw.get('resultats')
    n = {'Réussi': 0, 'Échoué': 0, 'Constat': 0}; rows = []
    for r in res:
        s = specs[r['id']]; exp = s['expect']
        ok = (r['obtenu'] == 'OK' if exp == 'ok' else r['obtenu'] in exp.split('|')) and r['controle'] \
             and (not s.get('msg') or s['msg'] in r['message'])
        k = 'Réussi' if ok else ('Constat' if s.get('info') else 'Échoué'); n[k] += 1
        rows.append(dict(id=r['id'], titre=s.get('titre'), attendu=exp, msg_attendu=s.get('msg'), obtenu=r['obtenu'],
                         controle=r['controle'], message=r['message'], role=r.get('role'), ms=r.get('ms'), verdict=k))
    missing = sorted(set(specs) - {r['id'] for r in res})
    out.update(bilan=n, total=len(res), specs_total=len(specs), manquants=missing,
               serveur={k: raw[k] for k in raw if k not in ('resultats',)}, resultats=rows)
    print(label, n, 'total', len(res), '/', len(specs), 'manquants', missing)
    for x in rows:
        if x['verdict'] != 'Réussi': print('  ', x['verdict'], x['id'], x['titre'][:60], '|', x['attendu'], '→', x['obtenu'], x['controle'], x['message'][:120])
(pathlib.Path(__file__).resolve().parent / 'results').mkdir(exist_ok=True)
json.dump(out, open(pathlib.Path(__file__).resolve().parent / 'results' / f'{label}.json', 'w'), ensure_ascii=False, indent=1)
if not keep: admin(f'drop database if exists "{db}" with (force)')
