#!/bin/sh
# Gabarits de qualification depuis CE dépôt (réplique PostgreSQL 17 jetable, rôles Supabase ; jamais DEV ni production).
# b005 = migrations 001→005 ; b006 = b005 + 006 originale ARCHIVÉE (référence NO GO) ; s1 = b005 + 006 révisée.
# Prérequis : base « supa » = réplique Supabase vierge (schémas auth/storage, rôles anon/authenticated/service_role).
set -e; R=$(cd "$(dirname "$0")/../../../.." && pwd); A="psql -h /tmp -p 54317 -U supabase_admin -v ON_ERROR_STOP=1 -q"; U="psql -h /tmp -p 54317 -U postgres -v ON_ERROR_STOP=1 -q"
for t in s1 b006 b005; do $A -d postgres -c "drop database if exists $t with (force)"; done
$A -d postgres -c "create database b005 template supa owner postgres"
for f in "$R"/supabase/migrations/2026112009*.sql "$R"/supabase/migrations/20261120102820_*.sql "$R"/supabase/migrations/20261121050030_*.sql; do $U -d b005 -f "$f"; done
$A -d postgres -c "create database b006 template b005 owner postgres"; $U -d b006 -f "$R/supabase/archive/006-original/20261121_006_duo_v3_financial_model.sql"
$A -d postgres -c "create database s1 template b005 owner postgres"; $U -d s1 -f "$R/supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql"
echo "b005, b006, s1 construits"
