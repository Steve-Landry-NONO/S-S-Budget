#!/bin/sh
# s2 = s1 (voir ../006r1/build_templates.sh) + migration lot 3. auth.users.email_confirmed_at (présente dans Supabase Auth,
# absente de la réplique minimale) est ajoutée par supabase_admin. Réplique jetable uniquement.
set -e; R=$(cd "$(dirname "$0")/../../../.." && pwd); A="psql -h /tmp -p 54317 -U supabase_admin -v ON_ERROR_STOP=1 -q"
$A -d postgres -c "drop database if exists s2 with (force)"; $A -d postgres -c "create database s2 template s1 owner postgres"
$A -d s2 -c "alter table auth.users add column if not exists email_confirmed_at timestamptz"
psql -h /tmp -p 54317 -U postgres -v ON_ERROR_STOP=1 -q -d s2 -f "$R/supabase/migrations/20261126130000_duo_v3_membership_lifecycle.sql"
echo "s2 construit"
