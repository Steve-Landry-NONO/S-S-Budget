#!/usr/bin/env python3
"""Sépare lot1_dev_integration.sql en passe A (non destructive) et passe B (TRUNCATE/DELETE),
chacune autonome et terminée par ROLLBACK."""
import re, pathlib
here = pathlib.Path(__file__).parent
sql = (here / 'lot1_dev_integration.sql').read_text().splitlines()
start = next(i for i, l in enumerate(sql) if l.startswith("select pg_temp.run('L01'"))
end = next(i for i, l in enumerate(sql) if l.startswith('reset role;') and i > start)
head, body, tail = sql[:start], sql[start:end], sql[end:]
B_IDS = {'L07b', 'S10', 'S12', 'S13', 'T01', 'T02', 'T03', 'M01', 'S11p', 'S11a', 'S11b', 'S11c'}
A, B = [], []
for l in body:
    m = re.match(r"select pg_temp.run\('([^']+)'", l)
    if m: (B if m.group(1) in B_IDS else A).append(l)
    elif not l.startswith('--'): B.append(l)
B = [l.replace("pg_temp.u('t1')", "pg_temp.u('t11')") if ("'L07b'" in l or "'S10'" in l) else l for l in B]
for P, lines in (('A', A), ('B', B)):
    hd = head
    if P == 'B':  # S11c exige un membre qui a déjà écrit : l'original t11 est attribué à Alex
        hd = [l.replace("'orig-11','transfer',pg_temp.u('cam')", "'orig-11','transfer',pg_temp.u('alex')") for l in head]
    h = '\n'.join(hd).replace('-- GÉNÉRÉ par gen_lot1.py — ne pas éditer à la main.', f'-- GÉNÉRÉ par split_lot1.py — passe {P}.')
    t = '\n'.join(tail).replace("select jsonb_build_object(", f"select jsonb_build_object('passe','{P}', ")
    (here / f'lot1_run_{P}.sql').write_text(h + '\n' + '\n'.join(lines) + '\n' + t + '\n')
    print(P, sum(1 for l in lines if l.startswith('select pg_temp.run')))
