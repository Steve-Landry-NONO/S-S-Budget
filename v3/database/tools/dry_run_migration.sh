#!/bin/sh
# REV-08 / R2-03 — Essai à blanc d'une migration : BASES JETABLES LOCALES UNIQUEMENT.
# Remplacé par dry_run_migration.py (analyse lexicale complète, garde de transaction, refus des environnements persistants).
# Ne JAMAIS l'utiliser sur DEV ou production : l'outil refuse tout hôte distant et toute base sans le marqueur
# « duo-v3-disposable » (COMMENT ON DATABASE). Voir l'en-tête de dry_run_migration.py.
exec python3 "$(dirname "$0")/dry_run_migration.py" "$@"
