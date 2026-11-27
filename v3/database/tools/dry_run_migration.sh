#!/bin/sh
# REV-08 / R2-03 / R3-04 — Essai à blanc d'une migration : l'outil crée et détruit lui-même une base JETABLE locale.
# Aucune chaîne de connexion n'est acceptée ; ne JAMAIS chercher à l'utiliser contre DEV ou production.
# Exemple : dry_run_migration.sh supabase/migrations/…_r1.sql --template b005 --socket-dir /tmp --port 54317
exec python3 "$(dirname "$0")/dry_run_migration.py" "$@"
