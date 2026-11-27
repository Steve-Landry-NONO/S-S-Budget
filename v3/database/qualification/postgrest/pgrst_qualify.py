#!/usr/bin/env python3
"""Qualification HTTP PostgREST des paramètres numeric transmis en chaînes (R3-02, protocole N01–N18, 27/11/2026).

Isolation (TECH-ARB-1) :
  * le harnais CRÉE lui-même une base jetable au nom aléatoire sur une réplique PostgreSQL LOCALE (socket Unix), la construit à
    partir des fichiers de migration du dépôt, puis la DÉTRUIT ; aucune chaîne de connexion externe n'est acceptée ;
  * PostgREST écoute sur 127.0.0.1, port aléatoire, et ne joint que cette base par socket Unix ;
  * variables libpq de l'environnement neutralisées (PG*), aucun secret réel : secret JWT aléatoire du processus.

Usage : python3 pgrst_qualify.py --postgrest <binaire> --contract-dir <contrat v3> --label <label> [--migrations-dir <supabase/migrations>]
         [--socket-dir /tmp] [--port 54317]
Sortie : results/<label>.json (requêtes, statuts HTTP, corps bruts, verdicts) et résumé sur la sortie standard."""
import argparse, base64, hashlib, hmac, json, os, pathlib, secrets, socket, subprocess, sys, tempfile, time, urllib.request, urllib.error, uuid
import psycopg

H = pathlib.Path(__file__).resolve().parent; ROOT = H.parents[3]
ap = argparse.ArgumentParser()
ap.add_argument("--postgrest", required=True); ap.add_argument("--contract-dir", required=True); ap.add_argument("--label", required=True)
ap.add_argument("--migrations-dir", default=str(ROOT / "supabase/migrations")); ap.add_argument("--socket-dir", default="/tmp"); ap.add_argument("--port", default="54317")
ap.add_argument("--base-template", default="supa")
A = ap.parse_args()
assert A.socket_dir.startswith("/") and os.path.isdir(A.socket_dir), "socket Unix local exigé"
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
DB = f"pgrst_{secrets.token_hex(6)}"
BIG = 2 ** 53 + 1
RESULTS = []

def adm(sql, db="postgres"):
    with psycopg.connect(host=A.socket_dir, port=A.port, user="supabase_admin", dbname=db, autocommit=True) as c: c.execute(sql)
def psql_file(db, f):
    r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", A.socket_dir, "-p", A.port, "-U", "postgres", "-d", db, "-f", str(f)], capture_output=True, text=True, env=CLEAN_ENV)
    if r.returncode: raise SystemExit(f"migration {f.name} : {r.stderr[-400:]}")

def build_db():
    adm(f'create database "{DB}" template "{A.base_template}" owner postgres')
    adm(f"comment on database \"{DB}\" is 'duo-v3-disposable'")
    migs = sorted(pathlib.Path(A.migrations_dir).glob("2026*.sql"))
    for f in migs:
        if "membership_lifecycle" in f.name: adm("alter table auth.users add column if not exists email_confirmed_at timestamptz", DB)   # comme build_templates.sh
        psql_file(DB, f)
    with psycopg.connect(host=A.socket_dir, port=A.port, user="supabase_admin", dbname=DB) as c:
        dom = c.execute("select pg_get_constraintdef(c.oid) from pg_constraint c join pg_type t on t.oid = c.contypid where t.typname = 'minor_units'").fetchone()[0]
    return [(f.name, hashlib.sha256(f.read_bytes()).hexdigest()) for f in migs], dom

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
SECRET = secrets.token_urlsafe(48)
def jwt(sub, role="authenticated", exp_delta=3600, secret=None):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); now = int(time.time())
    p = b64(json.dumps({"sub": sub, "role": role, "aud": "authenticated", "iat": now, "exp": now + exp_delta}).encode())
    sig = b64(hmac.new((secret or SECRET).encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def start_postgrest():
    port = free_port(); cfg = pathlib.Path(tempfile.mkdtemp(prefix="pgrst_")) / "postgrest.conf"
    cfg.write_text("\n".join([f'db-uri = "postgresql://authenticator@/{DB}?host={A.socket_dir}&port={A.port}"', 'db-schemas = "public"',
                              'db-anon-role = "anon"', f'jwt-secret = "{SECRET}"', 'jwt-aud = "authenticated"', 'server-host = "127.0.0.1"',
                              f"server-port = {port}", "db-pool = 4", 'log-level = "error"']))
    proc = subprocess.Popen([A.postgrest, str(cfg)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=CLEAN_ENV)
    for _ in range(100):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1); return proc, port, cfg
        except urllib.error.HTTPError: return proc, port, cfg
        except Exception: time.sleep(0.1)
    proc.kill(); raise SystemExit("PostgREST ne démarre pas : " + (proc.stdout.read() if proc.stdout else ""))

def http(port, method, path, body=None, token=None, headers=None):
    data = body.encode() if isinstance(body, str) else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json"); req.add_header("Accept", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(), dict(e.headers)

def numbers_in(text):
    found = []
    try: json.loads(text, parse_int=lambda s: found.append(s) or int(s), parse_float=lambda s: found.append(s) or float(s))
    except json.JSONDecodeError: return None
    return found

def fixture(currency, funds=True, members=2):
    """Comptes fictifs et duo créés en SQL (les RPC de gestion G-A n'existent pas encore)."""
    us = [str(uuid.uuid4()) for _ in range(members)]; h = str(uuid.uuid4())
    with psycopg.connect(host=A.socket_dir, port=A.port, user="postgres", dbname=DB, autocommit=True) as c:
        for u in us: c.execute("insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values (%s,'authenticated','authenticated',%s,now(),false)", (u, f"{u[:8]}@example.invalid"))
        c.execute("insert into public.duo_v3_households(id,currency) values (%s,%s)", (h, currency))
        for i, u in enumerate(us): c.execute("insert into public.duo_v3_members(household_id,user_id,role) values (%s,%s,%s)", (h, u, "owner" if i == 0 else "partner"))
        c.execute("select duo_v3_private.bootstrap_household(%s)", (h,))
        e = str(c.execute("select duo_v3_private.create_envelope(%s,'Courses',true)", (h,)).fetchone()[0])
        starts = c.execute("select starts_on from public.duo_v3_periods where household_id=%s and state='open'", (h,)).fetchone()[0]
        c.execute("select duo_v3_private.set_allocation(%s,%s,%s)", (e, 50000, starts))
        c.execute("select duo_v3_private.post_period_allocations(%s,(select id from public.duo_v3_periods where household_id=%s and state='open'))", (h, h))
        if funds: c.execute("select duo_v3_private.activate_funds(%s)", (h,))
    return us, h, e

def record(cid, title, expected, observed, ok, req=None, resp=None):
    s = "Réussi" if ok else "Échoué"
    RESULTS.append(dict(id=cid, cas=title, attendu=expected, observe=observed, statut=s, requete=req, reponse=resp))
    print(f"{cid:12} {s:7} {observed[:150]}", flush=True)

def contrib_body(h, raw_amount, key=None):
    return '{"p_household":"%s","p_amount_minor":%s,"p_occurred_on":"2026-11-27","p_idempotency_key":"%s"}' % (h, raw_amount, key or uuid.uuid4())

def run(port):
    pending_eval = []
    def snapshot(tok, h, kind="funds"):
        fn = "duo_v3_get_funds_snapshot" if kind == "funds" else "duo_v3_get_envelope_snapshot"
        return http(port, "POST", f"/rpc/{fn}", {"p_household": h}, tok)
    for cur in ("EUR", "USD", "XAF"):
        us, h, e = fixture(cur); tok = jwt(us[0])
        # N01 chaîne 2^53+1, N02 nombre JSON 2^53+1, N03 10^38−1 : écrits puis relus
        for cid, raw, label in ((f"N01-{cur}", f'"{BIG}"', "chaîne 2^53+1"), (f"N02-{cur}", str(BIG), "nombre JSON 2^53+1 (serveur)"), (f"N03-{cur}", '"' + "9" * 38 + '"', "chaîne 10^38−1")):
            us2, h2, e2 = fixture(cur); t2 = jwt(us2[0])
            st, body, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h2, raw), t2)
            st2, snap, _ = snapshot(t2, h2); j = json.loads(snap) if st2 == 200 else {}
            want = str(BIG) if "2^53" in label else "9" * 38
            got = (j.get("household") or {}).get("realTreasury")
            nums = numbers_in(snap)
            record(cid, f"{label} — écriture puis relecture HTTP", f"200 ; trésorerie '{want}' exacte ; 0 nombre JSON", f"post={st} snap={st2} trésorerie={got!r} nombres={nums}",
                   st == 200 and st2 == 200 and got == want and nums == [], dict(rpc="duo_v3_post_contribution", corps=contrib_body(h2, raw, "…")), dict(statut=st, corps=body[:300]))
            pending_eval.append(dict(id=f"{cid}-contrat", kind="funds_snapshot", text=snap))
        # N04–N11 : refus et normalisations
        for cid, raw, exp_status, label in ((f"N04-{cur}", '"1' + "0" * 38 + '"', 400, "10^38 (hors domaine)"), (f"N05-{cur}", '"100.0"', 400, "« 100.0 » (NUM-01)"),
                                           (f"N06-{cur}", '"1.5"', 400, "« 1.5 »"), (f"N07-{cur}", '"1e3"', 200, "« 1e3 » (normalisé par numeric)"),
                                           (f"N08a-{cur}", '"+7"', 200, "« +7 »"), (f"N08b-{cur}", '" 42 "', 200, "« 42 » avec espaces"),
                                           (f"N09a-{cur}", '"0"', 400, "zéro"), (f"N09b-{cur}", '"-5"', 400, "négatif"),
                                           (f"N10a-{cur}", '"abc"', 400, "« abc »"), (f"N10b-{cur}", '""', 400, "chaîne vide"), (f"N10c-{cur}", "null", 400, "null"),
                                           (f"N11a-{cur}", '"NaN"', 400, "« NaN »"), (f"N11b-{cur}", '"Infinity"', 400, "« Infinity »")):
            us2, h2, e2 = fixture(cur); t2 = jwt(us2[0])
            st, body, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h2, raw), t2)
            st2, snap, _ = snapshot(t2, h2)
            nums = numbers_in(snap)
            pending_eval.append(dict(id=f"{cid}-contrat", kind="funds_snapshot", text=snap))
            if st >= 400: pending_eval.append(dict(id=f"{cid}-erreur", kind="error", text=body))
            code = json.loads(body).get("code") if st >= 400 and body.startswith("{") else None
            treas = (json.loads(snap).get("household") or {}).get("realTreasury") if st2 == 200 else None
            record(cid, label, f"HTTP {exp_status} ; instantané lisible", f"post={st} code={code} trésorerie={treas!r} snap={st2} nombres={nums}",
                   st == exp_status and st2 == 200 and nums == [], dict(corps=contrib_body(h2, raw, "…")), dict(statut=st, corps=body[:300]))
        # N12 : XAF échelle 0 ; dépense, mouvement de fonds, affectation dans jsonb (répétitions du protocole)
        key = str(uuid.uuid4())
        st, b1, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, f'"{BIG}"', key), tok)
        st_e, b_e, _ = http(port, "POST", "/rpc/duo_v3_post_expense", '{"p_household":"%s","p_envelope":"%s","p_amount_minor":"%d","p_occurred_on":"2026-11-27","p_idempotency_key":"%s"}' % (h, e, BIG - 2, uuid.uuid4()), tok)
        st_e2, b_e2, _ = http(port, "POST", "/rpc/duo_v3_post_expense", '{"p_household":"%s","p_envelope":"%s","p_amount_minor":"100.0","p_occurred_on":"2026-11-27","p_idempotency_key":"%s"}' % (h, e, uuid.uuid4()), tok)
        st_m, b_m, _ = http(port, "POST", "/rpc/duo_v3_move_funds", '{"p_household":"%s","p_from_envelope":null,"p_to_envelope":"%s","p_amount_minor":"%d","p_idempotency_key":"%s"}' % (h, e, 3, uuid.uuid4()), tok)
        st_m2, b_m2, _ = http(port, "POST", "/rpc/duo_v3_move_funds", '{"p_household":"%s","p_from_envelope":null,"p_to_envelope":"%s","p_amount_minor":"1.0","p_idempotency_key":"%s"}' % (h, e, uuid.uuid4()), tok)
        st_a, b_a, _ = http(port, "POST", "/rpc/duo_v3_post_contribution_assigned", '{"p_household":"%s","p_amount_minor":"%d","p_occurred_on":"2026-11-27","p_idempotency_key":"%s","p_assignments":[{"envelopeId":"%s","amount":"%d"}]}' % (h, BIG, uuid.uuid4(), e, BIG), tok)
        st_a2, b_a2, _ = http(port, "POST", "/rpc/duo_v3_post_contribution_assigned", '{"p_household":"%s","p_amount_minor":"10","p_occurred_on":"2026-11-27","p_idempotency_key":"%s","p_assignments":[{"envelopeId":"%s","amount":"10.0"}]}' % (h, uuid.uuid4(), e), tok)
        sts, snap, _ = snapshot(tok, h); j = json.loads(snap); env = j["envelopes"][0]
        exp_treas = str(BIG + BIG - (BIG - 2))                     # 2 contributions de 2^53+1, une dépense de 2^53−1
        record(f"N12-{cur}", "Dépense, mouvement de fonds et affectation (jsonb) au-delà de 2^53 ; « 100.0 » et « 1.0 » refusés partout",
               f"200/200/200 ; 400 sur chaque échelle non nulle ; trésorerie '{exp_treas}' ; 0 nombre",
               f"contrib={st} dépense={st_e} dépense100.0={st_e2} mouvement={st_m} mouvement1.0={st_m2} affectée={st_a} affectée10.0={st_a2} trésorerie={j['household']['realTreasury']!r} enveloppe.realAvailable={env['realAvailable']!r} nombres={numbers_in(snap)}",
               st == 200 and st_e == 200 and st_m == 200 and st_a == 200 and st_e2 == 400 and st_m2 == 400 and st_a2 >= 400 and j["household"]["realTreasury"] == exp_treas and numbers_in(snap) == [])
        pending_eval.append(dict(id=f"N12-{cur}-contrat", kind="funds_snapshot", text=snap))
        if cur == "XAF":
            record("N12-XAF-echelle", "XAF : échelle 0 annoncée par l'instantané", "currency XAF", f"currency={j['currency']!r}", j["currency"] == "XAF")
        # N13 : lecture enveloppes (006r1)
        st13, snap13, _ = snapshot(tok, h, "envelope")
        record(f"N13-{cur}", "Instantané d'enveloppes 006r1 : aucun nombre JSON", "200 ; 0 nombre", f"snap={st13} nombres={numbers_in(snap13)}", st13 == 200 and numbers_in(snap13) == [])
        pending_eval.append(dict(id=f"N13-{cur}-contrat", kind="envelope_snapshot", text=snap13))
        # N14 / N15 : idempotence
        st14, b14, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, f'"{BIG}"', key), tok)
        record(f"N14-{cur}", "Rejeu de la même clé, même montant", "200, même identifiant", f"{st14} {b14[:60]} (initial {b1[:60]})", st14 == 200 and b14 == b1)
        st15, b15, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, f'"{BIG + 1}"', key), tok)
        pending_eval.append(dict(id=f"N15-{cur}-erreur", kind="error", text=b15))
        record(f"N15-{cur}", "Même clé, montant différent", "409 / 23505", f"{st15} {b15[:90]}", st15 == 409 and '"23505"' in b15)
    # ---------------------------------------------------------------- N16–N18 et droits
    us, h, e = fixture("EUR"); tok = jwt(us[0]); stranger = fixture("EUR", members=1)[0][0]
    st, b, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", '{"p_household":"%s","p_occurred_on":"2026-11-27","p_idempotency_key":"%s"}' % (h, uuid.uuid4()), tok)
    record("N16", "Paramètre p_amount_minor absent", "404 PGRST202", f"{st} {b[:100]}", st == 404 and "PGRST202" in b); pending_eval.append(dict(id="N16-erreur", kind="error", text=b))
    st, b, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, '"100"'), jwt(stranger))
    record("N17", "JWT d'un non-membre", "403 / 42501, corps sans donnée du duo", f"{st} {b[:120]}", st == 403 and '"42501"' in b and h not in b); pending_eval.append(dict(id="N17-erreur", kind="error", text=b))
    st, b, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, '"100"'))
    record("N18", "Sans JWT (anon)", "401", f"{st} {b[:120]}", st == 401); pending_eval.append(dict(id="N18-erreur", kind="error", text=b))
    st, b, _ = http(port, "POST", "/rpc/duo_v3_get_funds_snapshot", {"p_household": h}, jwt(stranger))
    jb = json.loads(b) if st == 200 else {}
    record("D-01", "Instantané demandé par un non-membre", "réponse neutre (household null) ou 403 ; aucune donnée", f"{st} {b[:140]}",
           (st == 200 and jb.get("household") is None and jb.get("envelopes") == []) or st == 403)
    st, b, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, '"100"'), jwt(us[0], exp_delta=-60))
    record("D-02", "JWT expiré", "401 PGRST301/PGRST303", f"{st} {b[:100]}", st == 401)
    st, b, _ = http(port, "POST", "/rpc/duo_v3_post_contribution", contrib_body(h, '"100"'), jwt(us[0], secret="mauvais-secret-" + secrets.token_hex(8)))
    record("D-03", "JWT à signature invalide", "401", f"{st} {b[:100]}", st == 401)
    st, b, _ = http(port, "POST", "/rpc/activate_funds", {"p_household": h}, tok, {"Content-Profile": "duo_v3_private"})
    record("D-04", "Fonction privée via le schéma duo_v3_private (non exposé)", "406 PGRST106 (schéma refusé)", f"{st} {b[:100]}", st == 406)
    st, b, _ = http(port, "POST", "/rpc/activate_funds", {"p_household": h}, tok)
    record("D-05", "Fonction privée appelée dans le schéma public", "404 PGRST202", f"{st} {b[:100]}", st == 404)
    st, b, _ = http(port, "POST", "/duo_v3_entries", {"transaction_id": str(uuid.uuid4()), "account_id": str(uuid.uuid4()), "amount_minor": "1"}, tok)
    record("D-06", "Écriture directe dans le grand livre (table)", "401/403/405 ; aucune écriture", f"{st} {b[:100]}", st in (401, 403, 405))
    st, b, _ = http(port, "DELETE", "/duo_v3_transactions?household_id=eq." + h, None, tok)
    record("D-07", "Suppression directe de transactions", "refus ou 0 ligne", f"{st} {b[:100]}", st in (401, 403, 405) or (st in (200, 204) and b in ("", "[]")))
    st, b, _ = http(port, "GET", "/duo_v3_transactions?select=id&household_id=eq." + h, None, jwt(stranger))
    record("D-08", "Lecture directe des transactions d'un autre duo", "200 [] (RLS) ou refus", f"{st} {b[:100]}", (st == 200 and b.strip() == "[]") or st in (401, 403))
    st, b, _ = http(port, "GET", "/duo_v3_transactions?select=id", None)
    record("D-09", "Lecture anonyme des transactions", "401 ou refus", f"{st} {b[:100]}", st in (401, 403) or (st == 200 and b.strip() == "[]"))
    # ---------------------------------------------------------------- évaluation par le contrat mobile (validateurs et erreurs)
    r = subprocess.run(["node", str(H / "eval_contract.ts"), A.contract_dir], input=json.dumps(pending_eval), capture_output=True, text=True)
    ev = json.loads(r.stdout) if r.returncode == 0 and r.stdout else []
    if not ev: record("CONTRAT", "Évaluation par le contrat", "exécution", r.stderr[-300:], False)
    snaps = [x for x in ev if x["id"].endswith("-contrat")]; errs = [x for x in ev if x["id"].endswith("-erreur")]
    bad = [x for x in snaps if not x.get("valid")]
    record("NUM-01-HTTP", "Aucun instantané rendu illisible pour le contrat après toutes les saisies (dont « 100.0 »)", "100 % des instantanés valides",
           f"{len(snaps) - len(bad)}/{len(snaps)} valides ; invalides={[ (x['id'], x.get('detail')) for x in bad][:4]}", not bad)
    leaks = [x for x in errs if x.get("fuite") or not x.get("public")]
    record("ERR-PUBLIC", "Erreurs HTTP traduites par errorFromPostgrest : message public, aucune fuite", "0 fuite",
           f"{len(errs)} erreurs ; codes={sorted(set(x.get('code') for x in errs))} ; fuites={len(leaks)}", not leaks and len(errs) > 0)
    return ev

def main():
    proc = None
    try:
        migs, dom = build_db()
        proc, port, cfg = start_postgrest()
        st, body, hdr = http(port, "GET", "/")
        server = hdr.get("Server", "?")
        ev = run(port)
        return migs, dom, server, port, ev
    finally:
        if proc: proc.terminate(); proc.wait(timeout=10)
        adm(f'drop database if exists "{DB}" with (force)')

if __name__ == "__main__":
    t0 = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    migs, dom, server, port, ev = main()
    s = {}
    for r in RESULTS: s[r["statut"]] = s.get(r["statut"], 0) + 1
    with psycopg.connect(host=A.socket_dir, port=A.port, user="supabase_admin", dbname="postgres") as c: pgver = c.execute("select version()").fetchone()[0]
    gone = True
    with psycopg.connect(host=A.socket_dir, port=A.port, user="supabase_admin", dbname="postgres") as c: gone = c.execute("select count(*) from pg_database where datname = %s", (DB,)).fetchone()[0] == 0
    out = dict(label=A.label, debut=t0, base_jetable=DB, base_detruite=gone, postgrest=server, postgresql=pgver,
               postgrest_sha256=hashlib.sha256(pathlib.Path(A.postgrest).read_bytes()).hexdigest(), migrations=migs, domaine_minor_units=dom,
               bilan=s, resultats=RESULTS, evaluation_contrat=ev)
    (H / "results").mkdir(exist_ok=True); (H / "results" / f"{A.label}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(json.dumps(dict(bilan=s, postgrest=server, base_detruite=gone, domaine=dom), ensure_ascii=False))
