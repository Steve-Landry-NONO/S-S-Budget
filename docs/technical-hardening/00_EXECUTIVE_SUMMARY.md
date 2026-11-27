# 00 — Synthèse exécutive · Durcissement technique Duo Budget V3 (Sprints 1-2)

24 novembre 2026 · Branche `fix/v3-technical-hardening` (base `376c719`, PR #14) · PR brouillon **#15** → `feat/v3-sprint2-dashboard` · **Rien n'a été fusionné, déployé, ni modifié sur `main` ou Supabase.**

## Verdict

**Prêt pour consolidation sous conditions.** Un défaut d'intégrité financière P0 (préexistant V2) a été trouvé, prouvé et corrigé ; toutes les vulnérabilités critiques/élevées sont corrigées ; la réserve QA Lab « espaces verticaux » a sa cause identifiée et corrigée ; la CI dédiée est verte 6/6. Restent des **décisions propriétaire** (sécurité, affichage, Android) et une **précondition de déploiement** du serveur.

## Résultats clés

| Lot | Résultat | Statut |
|---|---|---|
| T02 frontend | minimatch 10.2.6 → 11.0.9 par override ciblé ; fingerprint Expo identique (différentiel) ; audit 3 modérées → **0** ; SDK **58.0.26** conservé | Implémenté · testé ✅ |
| T03 serveur | sqlite3 5.1.7 → 6.0.1 ; audit 7 (1 critique, 4 élevées) → **0** ; base compatible dans les deux sens ; lockfile désormais versionné | Implémenté · testé ✅ · **précondition glibc ≥ 2.38 ou compilation** |
| T03/T04 intégrité | **Perte d'écritures acquittées sous concurrence** (20 dépenses « 201 » → 8 persistées) ; corrigé par sérialisation des écritures | Implémenté · testé ✅ (échec avant, succès après) |
| T04 tests | 24 → **37** tests frontend ; **22** tests serveur (nouveaux) ; parité V2 différentielle sur 2 000 jeux, 3/3 mutants détectés ; 165 € prouvé de bout en bout via le vrai serveur | Testé ✅ |
| T04 défaut | **F-01** « -0,00 € » + alerte « solde négatif » sur résidu flottant | Testé avec échec (todo) · décision |
| T05 sécurité | Glance : aucune donnée réelle pré-auth (prouvé en navigateur) ; QA Lab : app authentifiée **absente du bundle**, 0 accès stockage/réseau ; gitleaks 0 fuite ; **R-01** jetons forgeables si `APP_SECRET` absent + R-02…R-07 | Testé ✅ · risques isolés pour décision |
| T06 responsive | Matrice **40/40** (5 scénarios × 360/390/430/760 × 2 dispositions) ; cause des espaces verticaux trouvée (cartes « Votre duo », 389-528 px de vide) et corrigée | Implémenté · testé (Web) ✅ · **recheck natif demandé** |
| T07 Android | PR #4 portée sur SDK 58 ; **bloquant trouvé** : l'APK release ne pouvait pas joindre le serveur HTTP ; corrigé (Preview seulement) + `allowBackup=false` + 3 permissions retirées | Implémenté · prebuild testé ✅ · **APK non produite** |
| T08 CI | Workflow 6 jobs (frontend, navigateur, serveur, Android prebuild, audit, secrets) ; run 45472502146 ✅ | Implémenté · testé ✅ |
| T09 dette | 2 P0 (1 corrigé), 7 P1, 8 P2, 5 P3 | Documenté |
| T10 fusion | Ordre : #15 → Sprint 2 ; #3 → main ; #14 re-ciblée → main ; #4 fermée (remplacée) | Recommandé |

## Décisions à prendre (détail dans 11)

1. **R-01** : imposer `APP_SECRET` au démarrage en production — et **vérifier dès maintenant le `.env` du serveur réel**.
2. **F-01** : arrondi au centime en présentation.
3. **D-04** : trafic HTTP clair pour la Preview Android, ou HTTPS via Tailscale.
4. **Déploiement sqlite3 6.0.1** sur le serveur réel selon la procédure (03 §8), ou maintien de 5.1.7 sur cet hôte.
5. R-02, R-03, R-06, R-07 avant bêta.

## Limites de l'environnement

Pas de SDK Android ni d'appareil (et disque local à 99 %) → aucune APK ; pas d'iPhone → aucune revalidation native ; exécution locale du binaire gitleaks refusée par la politique de l'agent → scan exécuté en CI ; navigateur : Chrome/Chromium uniquement.

## Mise à jour lot 2 (après revue indépendante)

Corrigés et testés (échec avant / succès après) : verrou d'écriture lié à la fin réelle du traitement (déconnexions pendant transaction et pendant l'attente) ; **R-01** démarrage refusé sans secret sûr, clé publique supprimée ; **R-04/R-05** (et un PIN qui fuyait dans les journaux via un JSON malformé) ; **F-01** « -0,00 € ». Livré : audit B-07 en lecture seule. Planifiés : R-02, R-03, R-06, R-07. Détail : `12_LOT2_REVIEW_FIXES.md` ; passation : `11` §0.
