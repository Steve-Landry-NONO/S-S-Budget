# Revue indépendante statique — PR #23 / #26
26 novembre 2026. SHA #23 90e22746590deb4d68194a2b93af4773e96cc5c9 ; #26 b647f720e2675a8115e6d7440ee028024c011e3e ; comparaison #25 df41563ed9691cd925f0a377bb48acb88073f82f. Revue ciblée, non exhaustive ; aucune exécution SQL ni migration.
## Acquis
006r1 : F1 garde période à insertion et validation différée, F2 séparation index auteur/système et hash, F3 FK devise, F4 domaine entier, F5 posting_xid, F6 snapshot SQL stable unique, F7 recontrôle appartenance sous verrou ; R-A2 admin catch-up et R-A3 posted_at/ledger_seq présents. Vérification statique, non preuve de sécurité exhaustive. Contrat primaryAmount ne substitue pas budgetBalance à realAvailable. CI #26 rapportée success au SHA exact ; résultats SQL Claude rapportés.
## Constats et tests demandés
| ID | Priorité proposée | Source exacte | Risque / correction candidate / preuve attendue |
|---|---|---|---|
| REV-01 | P0 | 006r1 SQL 1292-1293 ; envelopeMapper.ts fromSqlEnvelopeSnapshot | position JSON numérique : convertir les montants SQL en texte avant transport ; test JSON.parse avec 9007199254740993, EUR/XAF, négatifs ; vérifier ledgerVersion aussi. |
| REV-02 | P0 | mockBackend.ts 95-96, 223-225 | replay et lookup par duo/clé, pas auteur ; aligner CF-06, test deux auteurs même clé, replay propre et refus charge différente. |
| REV-03 | P0 | envelopeMapper.ts fromSqlFundsSnapshot ; M2 SQL 770 | invariantHolds ignoré ; ne pas présenter instantané incohérent comme confirmé. Définir état erreur/incident et test false, en distinguant fonds non activés. |
| REV-04 | P0 | envelopeRead.contract.ts envelopeCacheKey | clé commune sans viewer, aucune période. Isoler compte/session et cycle, purge révocation/logout, refus d'affichage avant revalidation ; tester départ/retour, changement compte et période. |
| REV-05 | P1 | envelopeMapper.ts forecastTreasury ; M2 SQL 777-779 | contributions_only perd son qualificatif. Exposer capacité partielle explicite ou masquer prévision complète, jamais présenter contributions attendues comme argent. |
| REV-06 | P1 | envelopeRead.contract.ts ProtectionState ; M2 SQL 781 | lift_pending non exposé ; garder protection active, signaler capacité absente, ajouter fixture SQL quand supportée. |
| REV-07 | P1 | duoBackend.contract.ts DuoSnapshot | forecast/upcomingContributions/plannedExpenses obligatoires Money alors que R-B2 non modélisé. Distinguer mock et cloud, Capability ou contrat versionné ; test source 006/M2. |
| REV-08 | P1 (bloquant DEV) | docs/v3/migrations/006R1_PROCEDURE_DEV.md étape 1 ; migration begin/commit | essai à blanc ambigu : ne jamais exécuter le COMMIT du fichier dans une transaction prétendument annulée. Préférer réplique jetable ; si essai DEV autorisé, documenter extraction contrôlée du corps et vérifier absence d'objets après rollback. |
## Autres contrôles restant
- Runtime validation des réponses SQL, currency et montants ; scope/owner fourni par appelant au mapper, autorisation côté serveur et cache côté client ; périodes nulles et position absente (fallback zéro actuel) ; agrégats vides avec capacités indisponibles ; statut archived et filtrage ; errorFromPostgrest ne pas exposer message brut.
- R-A3 frontières et ordre sous verrou, F2 canonicalisation de date et clés système, rollback sur réplique et inventaire DEV exact ; ne pas confondre les tests historiques en échec attendu avec succès.
- R-B2 prévu lot distinct ; aucune écriture RN branchée sur mock comme si serveur réel. Les données de démonstration peuvent représenter le futur avec libellé explicite.
## Mobile S1/S2
#3 change README et roadmap ; le plan historique du 24/11 ciblait 8e7f6f6 et précède la consolidation #21. Ne pas suivre l'ordre ancien à l'aveugle. Préparer une seule branche d'intégration depuis main, importer la pile #15 complète après résolution explicite des deux documents (préserver main), vérifier diff, CI et recette native. Ne pas publier de branche intermédiaire non durcie. #4 conflit historique avec pile durcie : comparer avant fermeture. CI #15 au SHA cb31618 : checks consultés success (12 entrées, deux séries), aucun build natif prouvé par ces checks.
## Verdict
#23 NO GO DEV jusqu'à correction/revue et autorisation distincte. #26 GO préparation UI sur fixtures isolées avec limites ci-dessus, NO GO raccordement cloud/fusion. #25 revue complémentaire. Aucun changement de code backend, migration, fusion ou déclenchement workflow DEV. Les priorités sont propositions de revue, à confronter à l'audit Claude.
