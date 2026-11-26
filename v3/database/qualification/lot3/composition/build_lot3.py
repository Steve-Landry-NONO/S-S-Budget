#!/usr/bin/env python3
"""Compose les migrations candidates finales du lot 3 (v2 inchangé + ajouts v3 + décisions R-C)."""
import pathlib, hashlib
H = pathlib.Path(__file__).resolve().parent; Q = H.parent
v2 = (H / "proto_lot3_v2_base.sql").read_text()
add = (H / "lot3_additions_final.sql").read_text()
body = v2[v2.index("begin;") + len("begin;"):v2.rindex("commit;")]
head = ("-- Duo Budget V3 — MIGRATION CANDIDATE lot 3 : cycle de vie des appartenances (26/11/2026)\n"
        "-- STATUT : CANDIDATE, NON APPLIQUÉE. Dépend de 20261126120000_duo_v3_financial_model_r1. Environnements jetables uniquement.\n"
        "-- Composition : prototype v2 du 25/11 (sha256 " + hashlib.sha256(v2.encode()).hexdigest() + ") + ajouts v3 + décisions R-A3, R-C1 à R-C5 (PR #20).\n")
out = head + "begin;\n" + body + "\n" + add + "\ncommit;\n"
(H / "20261126130000_duo_v3_membership_lifecycle.sql.composed").write_text(out); print(hashlib.sha256(out.encode()).hexdigest())
