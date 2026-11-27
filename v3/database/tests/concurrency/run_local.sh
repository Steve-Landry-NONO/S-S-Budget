#!/bin/sh
# Concurrence locale (base jetable avec commit, jamais DEV) : A clôture et garde le verrou 3 s,
# C relance la clôture, B poste une dépense tardive. Attendu : B et C attendent A ; une seule clôture.
P="psql -h /tmp -p 54317 -U postgres -d ${1:-duo_conc} -tA"; cd "$(dirname "$0")"
$P -q -f setup.sql >/dev/null
$P -f closeA.sql > /tmp/a.out 2>&1 & sleep 0.5; $P -f closeC.sql > /tmp/c.out 2>&1 & $P -f expB.sql > /tmp/b.out 2>&1; wait
cat /tmp/a.out /tmp/b.out /tmp/c.out | grep -E "^(A|B|C) "
