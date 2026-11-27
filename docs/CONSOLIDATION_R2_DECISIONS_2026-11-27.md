# Décisions de gestion et porte R2 — 27 novembre 2026

Validées explicitement par le propriétaire le 27/11/2026. Aucune autorisation de migration DEV ou production.

| ID | Décision validée |
|---|---|
| D-GA-1 | Double accord dans un duo à deux, lié aux mêmes soldes d'ouverture. Accord individuel en espace personnel. |
| D-GB-1 | Autoriser l'ajustement versionné de l'objectif même après une dépense, sans modifier l'historique ni créer des fonds. |
| D-GC-1 | Imputation dans la période ouverte et conservation des trois dates : date originale, date de correction et période d'imputation. |
| D-GD-1 | 48 h, 10 aperçus par heure et par compte, protections complémentaires et seuils configurables. |

D-GB-1 remplace la proposition Claude « avant première dépense ». Objectif budgétaire et fonds réellement affectés distincts ; règles d'accord existantes maintenues. D-GA-1 : toute modification des soldes proposés invalide les accords précédents. Cas duo à un seul membre à spécifier avant implémentation, pas d'activation implicite. D-GD-1 : limites par origine/jeton et réponses non révélatrices.

## R2 — preuves et portes
Archive reçue SHA256 0c84ce93721de3b45f5e46b9ee8f4d9772790ba6564c2ffe1b9d3a277b18ef85 ; bundle SHA256 17035f717ebae8a48fe2127d419040b71bec32f4851f857e78d73fe4fa69786c.
| PR | SHA publié vérifié le 27/11 | Candidat local non publié |
|---|---|---|
| #23 | 90e22746590deb4d68194a2b93af4773e96cc5c9 | 691db7f0738ea261c1b802f7446b986a334f6a83 |
| #24 | 7dcbaa21048a76648f092838c2781fbaaae67d48 | 647f35db454fa6f0e8491fe95b780b10498ada9d |
| #25 | df41563ed9691cd925f0a377bb48acb88073f82f | c507e848f9a2d356e7ddfa372b65e675e458f273 |
| #26 | b647f720e2675a8115e6d7440ee028024c011e3e | 9f221bba91d57dc4a69df3b237065cf8cf0405d2 |

Claude rapporte 52/52 contrat, 72/72 et 38/38 006r1, 10/10 20/20 22/22 lot3, 30/30 M2, recovery 5/5, rollback 006r1 OK. Exceptions historiques maintenues. Rejeu non indépendant, logs backend aux SHA intermédiaires avec worktrees non propres : comparer les arbres finaux, rejouer sur worktrees propres exacts avant autorisation DEV. R2-01 : publication atomique, jamais quatre push successifs ; R2-02 : invalidation des écritures tardives après révocation à traiter avant connexion ; R2-03 : dry-run exclusivement réplique jetable, ne pas utiliser sur DEV. PostgREST numeric en chaînes non qualifié. Aucun push R2, aucun workflow DEV, aucune migration, aucune fusion backend à cette étape.

Empreintes SQL candidates : 006r1 7c7e54b7b7168e446309b03429e92d582c8f32931bf2e87d13b432af8b16d6ac ; lot3 ee1a5ff1370bbf2ba97633005d57c556c77e20992f41441ece4e930d1be9a80d ; M2 b9afe00cb9080319739954152687ada15f7c3b5ea1002ca903185af96a92ac87.

Préserver parseAmount et cas limites #7/#11 au S4, ticket à traiter avant clôture historique. #28 CI 9/9 sur 2f1d5f5414177e985438d48117a409b6460da0a1 ; recette native ouverte. Maturité officielle 48,96 %. README final après consolidation effective, pas de révision artificielle du score.

## Publication atomique vérifiée — 27/11/2026

Autorisation utilisateur explicite : quatre refs exactes en avance rapide atomique ; aucune fusion, aucun force-push, aucune migration DEV. Précheck local réussi (bundle, SHA, six contrôles d'empreintes SQL, diffs des commits intermédiaires vers finaux limités aux résultats de qualification). Simulation puis push atomique exécutés par le propriétaire, code 0. Les quatre SHA R2 du tableau sont désormais les SHA distants vérifiés via GitHub. main reste c8224ec443159745280e1565076d6f30aa0458b3. Les 20 commits R2 distincts ont auteur et committer Steve-Landry-NONO, compte GitHub associé identique, aucun trailer Co-authored-by ni mention Claude/Anthropic dans les messages.

CI exacte : #23 service-unit-tests 4/4 (job 140403052690), #26 contract-tests 52/52 (job 140403058113), aucun échec/TODO ; #24/#25 aucun check enregistré à cette lecture, pas une validation. #28 reste 9/9. Aucun workflow DEV déclenché par le script. Les workflows R2 de tests unitaires/fixtures examinés ne déploient pas ; ancien E2E neutralisé sur les branches candidates seulement. NO GO DEV maintenu : rejeu SQL propre exact, contrôle de l'état DEV, récupération, autorisation distincte 006r1, qualification PostgREST et réserves R2-02/R2-03. Les mentions « non publié » du tableau précédent sont historiques, remplacées par cette confirmation. Aucun merge/fermeture de PR.

## Porte de qualification finale après publication
Relecture directe de #26 9f221bb, envelopeRead.contract.ts : EnvelopeCache.put(s) ne vérifie que integrity, purgeAll/purgeMembership n'invalident pas les réponses en vol. R2-02 confirmé : exiger un contexte de requête lié à une génération de session et d'appartenance ; invalider avant purge ; refuser anciennes réponses même après reconnexion du même compte. Tests de concurrence et refus d'écriture après révocation, changement de compte, départ. R2-03 confirmé dans #23 691db7f dry_run_migration.sh : contrôle regex et catalogue après exécution, pas de garantie contre END ou contrôles transactionnels non reconnus ; imposer usage sur base jetable, qualification adversariale, pas de dry-run DEV.

G-A : spécification issue du livrable 05 à actualiser avec les quatre décisions validées. Création concurrente unique, my_spaces limité aux appartenances actives, changement de devise avant première opération, jour du cycle au prochain cycle, activation irréversible liée à l'empreinte canonique des soldes, double consentement pour deux membres actifs et accord du propriétaire personnel. Le cas duo à un membre n'est pas assimilé à un espace personnel et reste à arbitrer. Rejeu sous verrou, appartenance et version revérifiées, aucune double ouverture. G-B : objectif courant modifiable de façon versionnée selon règles d'accord, pas de création de fonds. G-C : correction par contre-passation et nouvelle écriture dans période ouverte, trois dates. G-D : limites configurables et absence d'oracle. G-E prévisions distinctes. Pas d'implémentation G-A avant validation de sa spécification détaillée. Rejeu SQL propre sur les trois SHA exacts publiés et préparation fenêtre 006r1 seulement ; aucune migration autorisée.

Mobile #28 : qualification indépendante à organiser sur 2f1d5f5 ; distinguer CI web, prébuild Android et exécution sur appareils. Figma page 14 : variantes accessibles, illustrations et recette de navigation encore ouvertes. Aucune nouvelle fusion ni migration.
