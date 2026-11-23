# Lot 2 — recette de la migration 006 (réplique locale PG 17.12, 001→006)

**Bilan : 72 réussis, 0 échoués, 0 constats** sur 72 vérifications.

| ID | Matrice | Décision | Vérification | Rôle | Attendu | Obtenu | ms | Verdict |
|---|---|---|---|---|---|---|---|---|
| K01 | CYC-01 | D-011 | Jour 1 : cycle = mois civil (31 déc. → 1er janv.) | postgres | ok | OK | 1.31 | ✅ Réussi |
| K02 | CYC-01 | D-011 | Jour 5 : 5 nov. – 5 déc. (fin exclue) | postgres | ok | OK | 0.51 | ✅ Réussi |
| K03 | CYC-01 | D-012 | Jour 31 : 31 janv., 28 févr., 31 mars (2027) | postgres | ok | OK | 0.49 | ✅ Réussi |
| K04 | CYC-01 | D-012 | Jour 29/30 : février non bissextile (28) et bissextile (29) | postgres | ok | OK | 0.36 | ✅ Réussi |
| K05 | CYC-01 | D-011 | Changement d’heure (29 mars 2026, Paris) : bornes 23:00 UTC puis 22:00 UTC | postgres | ok | OK | 0.45 | ✅ Réussi |
| K06 | CYC-01 | D-011/D-012 | Jour 29 sur 25 périodes : contiguës, 28 févr. 2027 et 29 févr. 2028 | postgres | ok | OK | 0.83 | ✅ Réussi |
| K07 | CYC-01 | D-012 | Jour 31 : retour au 31 après un mois court (28 févr. → 31 mars 2027) | postgres | ok | OK | 0.31 | ✅ Réussi |
| K08 | CYC-01 | D-011 | Période non contiguë refusée | postgres | 23514 | 23514 | 0.47 | ✅ Réussi |
| K09 | CYC-01 | D-011 | Deuxième période ouverte refusée | postgres | 23514 | 23514 | 0.37 | ✅ Réussi |
| K10 | CYC-01 | D-011 | Jour de début figé une fois des périodes créées | postgres | 23514 | 23514 | 0.47 | ✅ Réussi |
| C01 | TRF-13 | Exigence 1 | Allocations de 1 280 € : trésorerie inchangée (0), enveloppes +1 280 €, écart −1 280 € avec alerte | authenticated | ok | OK | 8.68 | ✅ Réussi |
| C02 | TRF-13 | D-008 | Versements réels Camille 700 € + Alex 580 € : trésorerie 1 280 €, budget inchangé, écart 0 | authenticated | ok | OK | 5.02 | ✅ Réussi |
| C02b | TRF-13 | D-008 | … versement d’Alex : écart nul, alerte levée | authenticated | ok | OK | 5.48 | ✅ Réussi |
| C03 | ENV-05 | D-016 | Dépense de 110 € sur Loisirs (80 €) acceptée : solde −30 €, trésorerie −110 € | authenticated | ok | OK | 6.05 | ✅ Réussi |
| C04 | TRF-13 | Exigence 1 | Dépenses Courses 50 €, Maison 20 €, Auto 900 € ; transfert Courses → Vacances 25 € sans effet trésorerie | authenticated | ok | OK | 19.01 | ✅ Réussi |
| C05 | TRF-13 | Invariants | Identités : trésorerie = versements − dépenses ; budget = allocations − dépenses ; écart = versements − allocations | authenticated | ok | OK | 8.98 | ✅ Réussi |
| C06 | TRF-13 | Exigence 1 | Écriture qui crée du budget à partir de la trésorerie (cash −100 / enveloppe +100) refusée | postgres | 23514 | 23514 | 1.51 | ✅ Réussi |
| C07 | TRF-13 | Contrat RPC | Transition du contrat : transfert trésorerie → enveloppe par la RPC refusé (23503) | authenticated | 23503 | 23503 | 1.09 | ✅ Réussi |
| C08 | TRF-13 | Invariants | Chaque transaction du duo est équilibrée dans chaque livre | postgres | ok | OK | 0.5 | ✅ Réussi |
| R01 | CYC-02 | D-013 | Report activé : Courses +325 € conservés, + allocation 400 € = 725 € | authenticated | ok | OK | 2.52 | ✅ Réussi |
| R02 | CYC-02 | D-014 | Report désactivé : reliquat Maison 80 € → réserve (une écriture), Maison repart de 0 + 100 € | authenticated | ok | OK | 1.47 | ✅ Réussi |
| R03 | CYC-03 | D-017 | Déficit Loisirs −30 € reporté malgré le report désactivé ; nouvelle allocation 400 € → 370 € | authenticated | ok | OK | 1.29 | ✅ Réussi |
| R04 | CYC-03 | D-018 | Déficit Auto −500 € + allocation 400 € = −100 € ; réserve non prélevée | authenticated | ok | OK | 1.07 | ✅ Réussi |
| R05 | CYC-04 | D-014/D-029 | La clôture ne change pas la trésorerie | authenticated | ok | OK | 1.26 | ✅ Réussi |
| R06 | CYC-05 | D-029 | Clôture rejouée : même période suivante, aucune écriture nouvelle | postgres | ok | OK | 0.77 | ✅ Réussi |
| R07 | CYC-02 | D-013 | Instantané de clôture : règle appliquée et provenance pour les 5 enveloppes | authenticated | ok | OK | 1.1 | ✅ Réussi |
| R08 | TRF-13 | D-015 | Réserve 80 € → Vacances 60 € : réserve 20 €, Vacances +60 €, trésorerie inchangée | authenticated | ok | OK | 5.84 | ✅ Réussi |
| R09 | TRF-13 | D-015 | Réserve insuffisante (20 € pour 50 €) : refus 23514 | authenticated | 23514 | 23514 | 1.63 | ✅ Réussi |
| R10 | CYC-02 | Invariants | Après clôture, écart = versements − allocations des deux périodes (1 280 € − 2 880 €) | authenticated | ok | OK | 2.8 | ✅ Réussi |
| L01 | CYC-07 | D-029 | Dépense datée dans la période close : imputée à la période ouverte, date réelle conservée | authenticated | ok | OK | 4.53 | ✅ Réussi |
| L02 | CYC-07 | D-029 | La période close n’est pas rouverte : instantané de clôture inchangé | authenticated | ok | OK | 0.67 | ✅ Réussi |
| L03 | CYC-04 | D-029 | Écriture directe dans une période close refusée | postgres | 23514 | 23514 | 1.53 | ✅ Réussi |
| L04 | CYC-04 | D-029 | Modification d’une période close refusée | postgres | 23514 | 23514 | 0.42 | ✅ Réussi |
| L05 | CYC-04 | D-029 | Suppression d’une période refusée | postgres | 23514 | 23514 | 0.37 | ✅ Réussi |
| L06 | ENV-05 | D-016 | Dépense datée dans le futur refusée | authenticated | 22023 | 22023 | 0.59 | ✅ Réussi |
| L07 | CYC-01 | D-029 | Clôture paresseuse : un versement après 2+ périodes échues les clôture puis s’impute à la période courante | authenticated | ok | OK | 4.68 | ✅ Réussi |
| R11 | CYC-03 | D-018 | Deux clôtures : Auto −100 € + 400 € = 300 € ; Loisirs 370 € (report désactivé) → réserve | authenticated | ok | OK | 3.32 | ✅ Réussi |
| X01 | SEC-04 | 005 | INSERT direct d’une période par un client refusé | authenticated | 42501 | 42501 | 0.32 | ✅ Réussi |
| X02 | SEC-04 | 005 | INSERT direct d’une enveloppe ou d’une allocation par un client refusé | authenticated | 42501 | 42501 | 0.37 | ✅ Réussi |
| X03 | SEC-01 | RLS | Claire (duo B) ne voit ni périodes, ni enveloppes, ni soldes, ni position du duo A | authenticated | ok | OK | 1.8 | ✅ Réussi |
| X04 | SEC-01 | RLS | anon : lecture des périodes et de la position refusée | anon | 42501 | 42501 | 0.43 | ✅ Réussi |
| X05 | SEC-04 | 005 | Un client ne peut pas clôturer une période | authenticated | 42501 | 42501 | 0.3 | ✅ Réussi |
| X06 | SEC-04 | 005 | Un client ne peut pas créer d’enveloppe ni fixer une allocation par fonction serveur | authenticated | 42501 | 42501 | 0.23 | ✅ Réussi |
| X07 | SEC-01 | 005 | anon : RPC de dépense refusée | anon | 42501 | 42501 | 0.31 | ✅ Réussi |
| X08 | SEC-01 | RLS | Claire dépense sur le duo A : refusé | authenticated | 42501 | 42501 | 0.44 | ✅ Réussi |
| X09 | SEC-01 | RLS | Camille dépense sur une enveloppe du duo B : refusé | authenticated | 23503 | 23503 | 0.49 | ✅ Réussi |
| X10 | FIA-05 | Idempotence | Dépense rejouée (même clé) : même identifiant, une seule écriture | authenticated | ok | OK | 6.16 | ✅ Réussi |
| X11 | FIA-06 | Idempotence | Même clé, autre montant : 23505 | authenticated | 23505 | 23505 | 0.64 | ✅ Réussi |
| X12 | SEC-01 | RLS | Session anonyme Supabase : dépense refusée | authenticated | 42501 | 42501 | 0.45 | ✅ Réussi |
| S01 | TRF-15 | Arbitrage 21/11 | Transfert Courses → Cadeaux 50 € : accepté (source suffisante) | authenticated | ok | OK | 4.18 | ✅ Réussi |
| S02 | TRF-15 | Arbitrage 21/11 | Transfert Cadeaux → Courses 60 € sur 50 € : refusé, aucun solde modifié | authenticated | 23514 | 23514 | 2.25 | ✅ Réussi |
| S03 | TRF-15 | Arbitrage 21/11 | Transfert du solde exact (50 €) : accepté, source à 0 | authenticated | ok | OK | 3.41 | ✅ Réussi |
| S04 | ENV-05 | D-016 | Dépense de 30 € sur Cadeaux à 0 € : acceptée, solde −30 € | authenticated | ok | OK | 4.58 | ✅ Réussi |
| S05 | TRF-15 | Arbitrage 21/11 | Transfert depuis une enveloppe déjà négative : refusé | authenticated | 23514 | 23514 | 1.41 | ✅ Réussi |
| S06 | TRF-13 | D-015/D-018 | Réaffectation explicite Réserve → Cadeaux 20 € : déficit réduit à −10 €, réserve −20 € | authenticated | ok | OK | 3.73 | ✅ Réussi |
| A01 | ENV-08 | D-023 | Archivage de Vacances (solde non nul) refusé, enveloppe active, aucune écriture | postgres | 23514 | 23514 | 0.93 | ✅ Réussi |
| A02 | ENV-08 | D-023 | Archivage direct privilégié d’une enveloppe à −10 € refusé (garde en base) | postgres | 23514 | 23514 | 0.56 | ✅ Réussi |
| A03 | ENV-08 | D-023 | Archivage d’une enveloppe à solde exactement nul : accepté, sans écriture | postgres | ok | OK | 0.86 | ✅ Réussi |
| A04 | ENV-08 | D-023 | Archivage rejoué : idempotent | postgres | ok | OK | 0.45 | ✅ Réussi |
| A05 | ENV-08 | D-023 | Nouvelle allocation sur une enveloppe archivée refusée | postgres | 23514 | 23514 | 0.32 | ✅ Réussi |
| X13 | TRF-14 | D-023 | Dépense hors ligne sur une enveloppe archivée : refus explicite (pas de reclassement) | authenticated | 23503 | 23503 | 1.18 | ✅ Réussi |
| X14 | TRF-14 | D-023 | Transfert vers l’enveloppe archivée refusé | authenticated | 23503 | 23503 | 0.93 | ✅ Réussi |
| G01 | CYC-05 | D-029 | Clôture interrompue après reports et allocations : tout est annulé (période ouverte, 0 écriture) | postgres | P0001 | P0001 | 3.62 | ✅ Réussi |
| G02 | CYC-05 | D-029 | Clôture relancée : une période suivante, une allocation par enveloppe active, aucune pour l’archivée | postgres | ok | OK | 6.3 | ✅ Réussi |
| G03 | CYC-05 | D-029 | Clôture rejouée deux fois et rattrapage paresseux : même période, aucun report ni allocation en double | postgres | ok | OK | 1.19 | ✅ Réussi |
| G04 | CYC-05 | D-029 | Écriture système rejouée (même clé de report) : même transaction, rien de nouveau | postgres | ok | OK | 0.89 | ✅ Réussi |
| G05 | CYC-05 | D-029 | Deuxième allocation de la même enveloppe pour la même période refusée en base | postgres | 23505 | 23505 | 0.5 | ✅ Réussi |
| A06 | ENV-08 | D-023/D-028 | Archivage devenu incompatible (0 € à la demande, 100 € alloués à l’exécution) : refusé, sans effet partiel | postgres | 23514 | 23514 | 0.98 | ✅ Réussi |
| X15 | SEC-08 | 005 | TRUNCATE des périodes refusé même pour postgres | postgres | 23514 | 23514 | 0.6 | ✅ Réussi |
| X16 | SEC-08 | 005 | Allocation passée et instantané de clôture immuables | postgres | 23514 | 23514 | 0.52 | ✅ Réussi |
| X17 | SEC-08 | 005 | Privilèges : anon aucun droit, authenticated SELECT seul, sur toutes les tables et vues V3 | postgres | ok | OK | 1.29 | ✅ Réussi |
| X18 | SEC-04 | 005 | Fonctions : RPC exécutables par authenticated seulement ; fonctions serveur par personne | postgres | ok | OK | 9.46 | ✅ Réussi |
