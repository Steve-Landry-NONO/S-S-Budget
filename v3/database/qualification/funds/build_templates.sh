#!/bin/sh
# s3 = s2 (voir ../lot3/build_templates.sh) + migration des fonds réels. Réplique jetable uniquement.
set -e; R=$(cd "$(dirname "$0")/../../../.." && pwd); A="psql -h /tmp -p 54317 -U supabase_admin -v ON_ERROR_STOP=1 -q"
$A -d postgres -c "drop database if exists s3 with (force)"; $A -d postgres -c "create database s3 template s2 owner postgres"
psql -h /tmp -p 54317 -U postgres -v ON_ERROR_STOP=1 -q -d s3 -f "$R/supabase/migrations/20261126140000_duo_v3_funds_ledger.sql"
echo "s3 construit"
