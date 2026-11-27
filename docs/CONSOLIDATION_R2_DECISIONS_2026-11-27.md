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

## Réception Gemini — recette S1/S2, 27/11/2026
Gemini a livré une matrice de 10 domaines et quatre scénarios R1–R4, sans accès dépôt ni exécution native ou nouveaux tests. NO GO clôture définitive, GO poursuite qualification. Les résultats CI repris ne constituent pas une nouvelle campagne indépendante.
Revue ChatGPT directe du SHA #28 2f1d5f5414177e985438d48117a409b6460da0a1 : App.js 231–267, 299–338 : génération de session, purge et contrôle avant/après requête présents ; src/features/session/sessionBoundary.cjs : scope api/user/expires, pas de liaison à une identité de session unique, cache à renforcer. App.js 360–375 : fallback local sur erreur de mutation hors stale/auth ; défaut confirmé de distinction refus certain/résultat inconnu, pas de double débit reproduit. Priorité P0 : aucune mutation locale présentée comme confirmée après erreur ambiguë ; état inconnu explicite, réconciliation sans réémission automatique, tests de réponse perdue et refus HTTP. server/test/security.test.cjs 42 et 50 : TODO R-02 jetons stateless encore valides après changement PIN (12h par défaut), R-03 premier PIN ouvert avec secret partagé. Limites V2/SQLite, pas des TODO de purge. Pas de diffusion externe sans traitement ou restriction formelle ; ne pas assimiler à l'auth Supabase V3. Recette native R1–R4 à compléter : app switcher, démarrage froid, session, réponse tardive, réseau, accessibilité et navigation sur deux plateformes, données fictives. Échelles système proches de 100/135/200 selon OS ; noter valeurs réelles. Préparer correctifs sur #28 dans la session d'exécution, sans modifier backend R2 ni Figma baseline. Aucun nouveau test natif exécuté dans cette revue.

## Synchronisation des trois missions — 27/11/2026
État distant contrôlé : main c8224ec ; #23–26 restent R2 aux SHA du tableau ; #28 reste 2f1d5f5414177e985438d48117a409b6460da0a1 ; #30 documentation seule à 98f030a5d8ce4ea8c4fabb777b1cdc9e8293218d. 17 PR ouvertes, toutes brouillons.
Backend : Claude rapporte rejeu propre R2 PostgreSQL 17.12 sans écart, NUM-01 bloquant (minor_units accepte 100.0 sous R2, correction scale=0 sous R3), CAT-01, R2-02 et R2-03 corrigés en candidats locaux 018e724/6c91e8a/4f1ecbc/3c0e5d7 ; contrat 63/63 et suite adverse 34/34 rapportés, non confirmés par CI distante. R2 006r1 interdit DEV. R3 publication non autorisée, procédure atomique requise. PostgREST N01–N18 non exécuté ; sauvegarde exercée et contrôle DEV lecture seule nécessaires. Réserves R3-01 à 04 : push non atomique, harmoniser protocole HTTP avec absence d'écritures DEV, persistance superseded malgré exception SQL, isolation réelle du dry-run (dont hostaddr). Six arbitrages GA/GD/TECH encore en attente, ne pas les traiter comme validés. G-A non implémenté.
Mobile : session d'exécution rapporte blobs préparés non attachés à #28, 23 tests unitaires locaux et 12 assertions statiques ; pas de CI sur nouveau candidat. Récupérer manifeste path/blob SHA et parent exact auprès de la session, relire et publier en avance rapide uniquement sur #28 après vérification ; ne pas recréer des corrections à l'aveugle. Tester absence de fallback sur erreurs, conservation des formulaires en cas de refus/inconnu, verrou mutations concurrentes, réponse tardive, réconciliation sans réémission ; la réconciliation manuelle V2 ne prouve pas exactement-une-fois. R-02/R-03 restent ouverts, aucune diffusion externe. Recette native non exécutée.
Produit : #30 contient docs/product/SPRINT_3_EXECUTION_LAB_2026-11-27.md, six vues QA Figma rapportées (384:297/319/341/363/385 et 386:297), dix parcours audités statiquement. Pas de validation interactive/accessibilité. Réconcilier le VM proposé avec contrat R3 : capacités partial/not_declared/not_available et incident, contexte session/duo/période, protection lift_pending ; ne pas confondre objectif et fonds. Couverture progressive jusqu'à 90 configurations, E07–09 lecture/prototype non opérant jusqu'aux autorisations d'écriture. Préserver baseline. 
Ordre recommandé : sécuriser et publier les candidats exacts, CI et recette indépendante, qualification HTTP isolée et dossier 006r1, puis intégration/archivage et README. Aucun nouveau chantier majeur avant résolution des portes correspondantes. Score officiel 48,96 %, pas de recalcul sans preuves comparables. Aucun merge ni migration autorisé.

## Arbitrages officiels R3 — validés par le propriétaire le 27/11/2026

Ces six décisions remplacent les mentions « en attente » antérieures. Elles complètent D-GA-1 à D-GD-1, sans autoriser une publication R3, une fusion dans main ou une migration Supabase DEV.

| ID | Décision validée |
|---|---|
| GA-ARB-1 | Préparation du budget autorisée ; activation initiale des fonds communs après arrivée du second partenaire. |
| GA-ARB-2 | 7 jours configurables, invalidation immédiate si les soldes ou la composition changent. |
| GA-ARB-3 | REQUEST_NO_LONGER_VALID, motif explicite et caducité enregistrée durablement. |
| GA-ARB-4 | Refus de l'activation initiale avec trésorerie négative ; déficits ultérieurs autorisés et correctement représentés. |
| GD-ARB-1 | 48 h ; 10 aperçus/h/compte, 20/h/jeton, 30/h/IP, 10 créations/jour/duo, 10 tentatives d'acceptation/h/compte. Seuils configurables. |
| TECH-ARB-1 | Qualification autorisée sur environnement isolé et bases jetables, sans contournement de permissions. |

Critères de mise en œuvre à vérifier : consentement lié à l'état financier et à la composition exacts ; vérification atomique sous verrou au dernier accord ; une demande caduque ne peut activer les fonds, et sa caducité doit persister sans rollback involontaire ; une nouvelle demande est requise. L'espace personnel reste distinct. Le départ ultérieur ne réécrit pas le grand livre. Les limites d'invitation doivent être appliquées côté serveur, sans oracle ni exposition de secrets. Les règles détaillées de concurrence et d'audit restent à qualifier.

### Porte suivante — préparation R3, sans publication
- R3-01 : vérification locale du bundle et préparation d'un push atomique aux SHA exacts ; pas de push avant autorisation distincte.
- R3-02 : aligner le protocole N01–N18 et le dossier GO/NO GO ; qualification HTTP exclusivement sur réplique isolée jetable, aucune écriture DEV.
- R3-03 : corriger la spécification de caducité durable (pas d'UPDATE suivi d'une exception non interceptée qui annule l'UPDATE) et définir des tests de concurrence.
- R3-04 : prouver l'isolation réelle du dry-run, notamment les URI hostaddr, paramètres multiples et options libpq ; ne pas se fier à un marqueur seul. Aucun essai à blanc DEV.
- Rejouer les tests des éventuels candidats modifiés ; conserver les exceptions historiques, documenter S11c non expliqué. NUM-01 : 006r1 R2 reste NO GO ; R3 à qualifier.
- Préparer la sauvegarde/restauration exercée et le contrôle de l'état DEV en lecture seule ; aucun accès en écriture DEV autorisé. Autorisation distincte par migration.
- Mobile #28 : session d'exécution responsable de la publication des correctifs et de leur CI ; éviter les modifications concurrentes. #30 à réconcilier avec le contrat R3 après publication. G-A non implémenté à ce stade.

Score officiel maintenu à 48,96 %. Aucun nouveau chantier majeur, merge, force-push, suppression de branche ou déploiement autorisé par ces arbitrages.
