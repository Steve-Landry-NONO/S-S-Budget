#!/bin/sh
# REV-08 — Essai à blanc RÉELLEMENT annulable d'une migration « begin; … commit; ».
# Exécuter le fichier tel quel dans « begin; … rollback; » est FAUX : son propre « commit; » valide tout.
# Ce script extrait le corps entre l'unique « begin; » et l'unique « commit; » de premier niveau, l'exécute dans
# une transaction terminée par ROLLBACK, puis vérifie que le catalogue et l'historique des versions sont inchangés.
# Usage : dry_run_migration.sh <psql-conninfo> <migration.sql> [catalog_dump.sql]
# Exemple réplique : dry_run_migration.sh "host=/tmp port=54317 user=postgres dbname=s0" supabase/migrations/2026…_r1.sql
# Sur DEV : uniquement après autorisation écrite, avec le rôle d'application des migrations.
# Limite : un « END; » SQL de premier niveau (synonyme de COMMIT) ne se distingue pas des « end; » PL/pgSQL sans analyse
# syntaxique ; le contrôle final (catalogue et versions inchangés) détecte toute validation persistante.
set -eu
CONN=$1; MIG=$2; CAT=${3:-$(dirname "$0")/../qualification/006r1/sql/catalog_dump.sql}
nb=$(grep -ciE '^[[:space:]]*begin;[[:space:]]*$' "$MIG" || true); nc=$(grep -ciE '^[[:space:]]*commit;[[:space:]]*$' "$MIG" || true)
[ "$nb" = 1 ] && [ "$nc" = 1 ] || { echo "REFUS : $nb « begin; » / $nc « commit; » de premier niveau (exactement 1 et 1 attendus)"; exit 2; }
last=$(grep -vE '^[[:space:]]*(--.*)?$' "$MIG" | tail -1 | tr -d '[:space:]')
[ "$last" = "commit;" ] || { echo "REFUS : « commit; » n'est pas la dernière instruction"; exit 2; }
if grep -qiE '^[[:space:]]*(rollback|savepoint|release|abort)[[:space:]]*;' "$MIG" || grep -qE '^[[:space:]]*\\' "$MIG"; then
  echo "REFUS : contrôle transactionnel ou méta-commande psql supplémentaire dans le fichier"; exit 2; fi
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
{ echo "begin;"; awk 'f==0 && tolower($0) ~ /^[[:space:]]*begin;[[:space:]]*$/ {f=1; next}
                      f==1 && tolower($0) ~ /^[[:space:]]*commit;[[:space:]]*$/ {f=2; next}
                      f==1 {print}' "$MIG"; echo "rollback;"; } > "$TMP"
grep -ciE '^[[:space:]]*commit;' "$TMP" >/dev/null && { echo "REFUS : COMMIT résiduel"; exit 2; } || true
snap() { psql "$CONN" -X -qAt -v ON_ERROR_STOP=1 -f "$CAT" | sha256sum | cut -c1-16; }
vers() { psql "$CONN" -X -qAt -c "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations" 2>/dev/null || echo "absent"; }
B=$(snap); VB=$(vers)
psql "$CONN" -X -q -v ON_ERROR_STOP=1 -f "$TMP" >/dev/null
A=$(snap); VA=$(vers)
echo "catalogue avant=$B après=$A ; versions avant=[$VB] après=[$VA]"
[ "$A" = "$B" ] && [ "$VA" = "$VB" ] && echo "ESSAI À BLANC OK : aucune modification persistante" || { echo "ÉCHEC : modification persistante détectée"; exit 1; }
