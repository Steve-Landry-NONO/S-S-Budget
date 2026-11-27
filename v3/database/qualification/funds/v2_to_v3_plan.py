#!/usr/bin/env python3
"""Plan de migration V2 (SQLite) → V3 hybride (prototype 007). Fonction pure : lit une base V2, produit un plan.

Règles (cf. 05_architecture_financiere_hybride.md § Migration) :
  * montants REAL en euros → unités mineures entières ; conversion exacte par Decimal(str(x)) ; toute valeur
    qui n'est pas un multiple exact du centime (après représentation décimale la plus courte) est REJETÉE,
    jamais arrondie en silence ;
  * catégorie active → enveloppe commune ; cible = monthly_per_person × nombre de membres ;
  * locked = 1 → enveloppe protégée ; active = 0 → enveloppe archivée seulement si son solde réel est nul,
    sinon rejet à arbitrer ;
  * contribution V2 (rattachée à une catégorie) → contribution réalisée AFFECTÉE à l'enveloppe correspondante
    (la V2 finançait déjà par catégorie : l'affectation explicite en est la traduction fidèle) ;
  * dépense V2 → dépense réalisée sur l'enveloppe ; payeur conservé comme auteur ;
  * statut ≠ 'done' → non migré (opérations prévues non modélisées), listé ;
  * activity_logs → non rejoués ; exportés tels quels en archive lecture seule.
  * R-B4 (26/11) : migration par SOLDES D'OUVERTURE par enveloppe ; le détail V2 est archivé (empreinte) ;
    rapprochement Σ ouvertures = Σ contributions − Σ dépenses ; empreinte de sauvegarde de la base source.
Usage : python3 v2_to_v3_plan.py <base_v2.sqlite>  -> JSON sur la sortie standard
"""
import sqlite3, sys, json, hashlib
from decimal import Decimal

def to_minor(x):
    d = Decimal(repr(float(x))) * 100
    if d != d.to_integral_value():
        return None
    return int(d)

def plan(path):
    db = sqlite3.connect(path); db.row_factory = sqlite3.Row
    members = [dict(r) for r in db.execute("select id, name, role from members order by id")]
    n = len(members); rejected, skipped = [], []
    envelopes, contributions, expenses = [], [], []
    for c in db.execute("select * from categories order by id"):
        t = to_minor(c["monthly_per_person"])
        if t is None:
            rejected.append(dict(table="categories", id=c["id"], reason="montant non exprimable en centimes", value=c["monthly_per_person"])); continue
        envelopes.append(dict(v2_id=c["id"], name=c["name"], target_minor=t * n, protected=bool(c["locked"]), active=bool(c["active"])))
    env_ids = {e["v2_id"] for e in envelopes}
    for tbl, out, who in (("contributions", contributions, "member_id"), ("expenses", expenses, "paid_by_member_id")):
        for r in db.execute(f"select * from {tbl} order by date, id"):
            if r["status"] != "done":
                skipped.append(dict(table=tbl, id=r["id"], reason=f"statut {r['status']} : opération prévue non modélisée")); continue
            if r["category_id"] not in env_ids:
                rejected.append(dict(table=tbl, id=r["id"], reason="catégorie rejetée ou inconnue")); continue
            m = to_minor(r["amount"])
            if m is None or m <= 0:
                rejected.append(dict(table=tbl, id=r["id"], reason="montant non exprimable en centimes ou non positif", value=r["amount"])); continue
            out.append(dict(v2_id=r["id"], envelope=r["category_id"], member=r[who], amount_minor=m, date=r["date"]))
    real = {e["v2_id"]: 0 for e in envelopes}
    for c in contributions: real[c["envelope"]] += c["amount_minor"]
    for x in expenses: real[x["envelope"]] -= x["amount_minor"]
    for e in envelopes:
        if not e["active"] and real[e["v2_id"]] != 0:
            rejected.append(dict(table="categories", id=e["v2_id"], reason="catégorie inactive avec solde réel non nul : arbitrage requis"))
    logs = db.execute("select count(*) from activity_logs").fetchone()[0]
    # R-B4 : soldes d'ouverture par enveloppe, archive du détail, rapprochement, sauvegarde
    openings = [dict(envelope=e["v2_id"], amount_minor=real[e["v2_id"]]) for e in envelopes if e["active"] and real[e["v2_id"]] != 0]
    detail = dict(contributions=contributions, expenses=expenses, rejected=rejected, skipped=skipped)
    archive = json.dumps(detail, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    reconciliation = dict(v2_net_minor=sum(c["amount_minor"] for c in contributions) - sum(x["amount_minor"] for x in expenses),
                          openings_total_minor=sum(o["amount_minor"] for o in openings))
    reconciliation["balanced"] = reconciliation["v2_net_minor"] == reconciliation["openings_total_minor"]
    backup_sha256 = hashlib.sha256(open(path, "rb").read()).hexdigest()
    return dict(openings=openings, reconciliation=reconciliation, archive_sha256=hashlib.sha256(archive.encode()).hexdigest(),
                archive_json=archive, backup_sha256=backup_sha256,members=members, envelopes=envelopes, contributions=contributions, expenses=expenses,
                expected_real_available=real, rejected=rejected, skipped=skipped, activity_logs_archived=logs)

if __name__ == "__main__":
    print(json.dumps(plan(sys.argv[1]), indent=1, ensure_ascii=False))
