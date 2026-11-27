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

## Mobile — publication confirmée, blocage Expo, 27/11/2026
#28 7c8045ff0158afe8ed616bcb03bef2551c62585a, parent 2f1d5f5, arbre f5feb13b85932797edef5d2c9b25fe5dc5885f98, cinq blobs et modes conformes, auteur/committer propriétaire. CI 7 succès, 1 échec, 1 skipped ; frontend 61/61, Glance 13/13, Android Preview 32/32 ; Expo Doctor 19/20, expo 58.0.26 attendu ~58.1.0 et splash 58.0.14 attendu ~58.0.15 (job 140441415990, run 45980067185). Le registre npm est inaccessible depuis les deux environnements ChatGPT (EAI_AGAIN confirmé). Pas de lockfile fabriqué, pas de nouveau commit mobile ni de CI 9/9. Solution : régénérer package.json/lockfile dans un environnement autorisé avec npm, ou préparer un job GitHub Actions isolé en lecture seule produisant un artefact de correction, sans push automatique ni désactivation des contrôles ; vérifier quota avant option CI supplémentaire. Figma S3 reste indépendant et doit avancer sans attendre npm ou R3 pour la qualification graphique. Recette native non exécutée, R-02/R-03 ouverts, réconciliation manuelle V2 sans garantie exactement-une-fois. Claude poursuit la qualification R3 selon le propriétaire. Aucun merge, publication R3 ni migration DEV autorisés. Maturité officielle 48,96 %.

## Validation finale des spécifications G-A à G-E — 27/11/2026
Le propriétaire valide la conception des livrables 03_SPEC_GA_FINALE.md et 04_SPEC_GB_GE_FINALE.md de l'archive R3 closure SHA256 f1464b386c1644b140bbf1d4f10eb2f682fad0e4f7e5b8ef7abf836485070dd3. G-A : devise incluse dans l'empreinte d'ouverture (tout changement invalide), heure effective après verrou R-A3, rejeu idempotent de l'activation acceptée sans nouvelle écriture, expiration traitée avant nouvelle demande pending. Caducité durable avec réponse métier structurée, invalidation transactionnelle ; aucun effet des écritures purement budgétaires si les éléments consentis sont inchangés. G-B–G-E : garde-fous historiques applicables, limites d'invitation non contournables par appel RPC direct. Conception seulement ; aucune implémentation G-A autorisée.
Qualification Claude rapportée : HTTP PostgREST 12.2.3 local 75/75, contrat 64/64, dry-run adverse 45/45, publication atomique locale 11/11. ERR-01 corrigé ; ERR-02 (401 vs FORBIDDEN) à corriger avant intégration HTTP réelle. S11c expliqué expérimentalement, script DEV historique exact absent. Candidats exacts #23 16deec8435fa1334482c84d36d50773759f73e97, #24 6c91e8adabc7e6f5f530c3765957f2da1b0232f5, #25 4f1ecbcd913cad2fba654a7ac7689264976a3d2b, #26 64a0e0f4ff353c25b2f40ac6844eebb55094b313. Simulation seulement autorisée. Les descendants #24/#25 ne contiennent pas nécessairement la nouvelle tête #23 : contrôler ascendance et empreintes des migrations avant publication, prévoir consolidation sans rebase/force. Le script Claude retourne 0 même si dry-run échoue : exiger succès réel et refs distantes inchangées. Aucun push effectif, merge, migration DEV ni implémentation G-A. GO/NO GO DEV reste NO GO : relevés, version PostgREST DEV, sauvegarde/restauration, CI et autorisation distincte nécessaires.
Mobile #28 8ef2abdb0725c7d449bd68931138a04e98401a91 : correction Expo publiée, CI 9/9 vérifiée, recette physique restante. Maturité officielle 48,96 %.

## Simulation atomique R3 acceptée — 27/11/2026
Preuve terminal propriétaire : archive SHA256 f1464b386c1644b140bbf1d4f10eb2f682fad0e4f7e5b8ef7abf836485070dd3 ; bundles c1735e7d52642671823883e58d552729b6d398fa04a2a9901f6f256775b49b74 et 6138985f2121ade67ece49e8433db6ba28171f77aacf978dcf88301893f98724 conformes. SIMULATE_R3_REVIEWED_V2.sh : exit 0, git push --atomic --dry-run accepté, cinq refs inchangées. Quatre avances rapides, auteurs conformes, trois empreintes SQL conformes dans M2, 006r1 identique #23/#24/#25, lot3 identique #24/#25. Réserve #24 ne contient pas la tête finale #23 ; #25 descend de #24. Réconcilier par fusion contrôlée avant intégration définitive, sans force ni rebase ; requalifier le résultat. Vérification GitHub indépendante après simulation : #23–26 toujours aux SHA R2, main c8224ec443159745280e1565076d6f30aa0458b3, #28 8ef2abdb0725c7d449bd68931138a04e98401a91. Publication effective des quatre SHA R3 exacts toujours soumise à autorisation écrite distincte. Aucune implémentation G-A, fusion ou migration DEV autorisée. Score officiel 48,96 %.

## Autorisation explicite de publication atomique R3 — 27/11/2026
Le propriétaire autorise exclusivement les quatre mises à jour : #23 16deec8435fa1334482c84d36d50773759f73e97 ; #24 6c91e8adabc7e6f5f530c3765957f2da1b0232f5 ; #25 4f1ecbcd913cad2fba654a7ac7689264976a3d2b ; #26 64a0e0f4ff353c25b2f40ac6844eebb55094b313. Publication en une transaction git push --atomic sans force, après nouvelle vérification des références et simulation réussie. Aucune fusion dans main, migration DEV, implémentation G-A ni déclenchement manuel de workflow DEV. Réserve d'ascendance à traiter avant fusion. Autorisation enregistrée ; publication effective non encore constatée.

## Publication atomique R3 réalisée et vérifiée — 27/11/2026
Terminal propriétaire : simulation finale réussie, git push --atomic origin des quatre refs exactes autorisées sans force, ls-remote conforme, worktree propre. Vérification indépendante GitHub : #23 16deec8435fa1334482c84d36d50773759f73e97, #24 6c91e8adabc7e6f5f530c3765957f2da1b0232f5, #25 4f1ecbcd913cad2fba654a7ac7689264976a3d2b, #26 64a0e0f4ff353c25b2f40ac6844eebb55094b313 ; toutes draft. main c8224ec443159745280e1565076d6f30aa0458b3 et mobile #28 8ef2abdb0725c7d449bd68931138a04e98401a91 inchangés. CI #23 service-unit-tests 4/4 (run 46007770260 job 140535183066), #26 contract-tests 64/64 (run 46007772443 job 140535191386), logs vérifiés ; #24/#25 aucun check enregistré, ne pas qualifier comme verts. Mobile 9/9 toujours confirmé. Les CI PR testent des arbres de fusion virtuels, pas un déploiement. Avertissement de dépréciation Node20 des actions v4 à traiter ultérieurement. Publication terminée ; réserve d'ascendance #23/#24 à traiter avant fusion avec requalification SQL/HTTP et CI. ERR-02 reste ouvert. Aucune fusion, migration DEV, implémentation G-A ni déclenchement manuel DEV autorisé. Maturité officielle 48,96 % en attente de consolidation.

## Inventaire d'assainissement GitHub — 27/11/2026
18 PR ouvertes, toutes draft : #3,4,6,7,8,9,11,12,14,15,22,23,24,25,26,28,29,30. Vérification compare API : #3/#14/#15 ancêtres de #28 (58/50/29 commits d'avance, 0 de retard). #4 diverge (71 avance/8 retard), ses sept fichiers sont présents dans #28, docs/ANDROID_PREVIEW_BUILD.md identique, six évolués ; couverture fonctionnelle à compléter avant fermeture. #12 ancêtre de #23 (28 avance, 0 retard), jamais fusionner seule. #6/#7/#8/#9/#11 divergent de #23 : archive après couverture A-02/A-03, conserver branches. SECURITY_GATE.md #8 récupéré à l'identique dans main docs/legacy/SECURITY_GATE_ORIGINAL.md ; vérifier récupération complète #6 et invariants #9. #7 et #11 : tests historiques exactitude, six devises EUR/USD/GBP/XAF/XOF/JPY, formats non canoniques, reports, transferts conservatifs, dépassements ; couverture R3 HTTP annoncée EUR/USD/XAF, ne pas supposer équivalence des autres devises ou formats. Vérifier les exigences par lot avant fermeture. #22 stratégie différée A-12 ; #29 documentation à intégrer séparément après autorisation ; #30 Figma S3 en attente de livraison. Ordre proposé : documentation #29 puis recette #28 et intégration/fermeture #3/#14/#15/#4 après couverture ; backend #23/#24/#25 après réconciliation qualifiée et autorisations, #12 fermeture après #23 ; #26 intégration contrat séparée sous gates ; prototypes archivés après matrice de couverture. Objectif intermédiaire 18→8 PR en fermant 10 anciennes (3,4,6,7,8,9,11,12,14,15) sous conditions, pas de suppression de branches. Aucune fermeture ni fusion exécutée ; pas de publication de nouveaux candidats ni accès DEV. Maturité inchangée.

## Arbitrages de consolidation finale — D1–D7 validés par le propriétaire le 27/11/2026
Cette section prévaut sur les états historiques contradictoires ci-dessus. Les identifiants D1–D7 sont locaux à cet arbitrage, distincts des décisions métier D-001 etc.
| ID | Décision |
|---|---|
| D1 | Maturité officielle 53,81 % (ancienne 48,96 %, +4,85 points). |
| D2 | G8-R4 bloquant pour toute migration contenant des duos existants ; aucune exception implicite. |
| D3 | Recette mobile interne uniquement, serveur V2 isolé, données fictives, SQLite jetable. |
| D4 | R-02 et R-03 bloquants avant diffusion externe. |
| D5 | Poursuivre conception S3 sans modifier #28. |
| D6 | Terminer matrice de couverture historique et assainissement documentaire ; fermeture seulement après preuves et portes. |
| D7 | NO GO Supabase DEV jusqu'à satisfaction de toutes les portes et autorisation écrite. |

### Maturité — méthode inchangée
| Sprint | Poids | Ancien score | Nouveau score | Contribution |
|---|---:|---:|---:|---:|
| S0 | 8 | 100 | 100 | 8,00 |
| S1 | 10 | 95 | 95 | 9,50 |
| S2 | 12 | 90 | 95 | 11,40 |
| S3 | 15 | 35 | 40 | 6,00 |
| S4 | 15 | 30 | 45 | 6,75 |
| S5 | 15 | 35 | 40 | 6,00 |
| S6 | 8 | 45 | 45 | 3,60 |
| S7 | 10 | 15 | 20 | 2,00 |
| S8+ | 7 | 8 | 8 | 0,56 |
| Total | 100 | | | 53,81 |
Estimation de maturité, non disponibilité ni clôture de sprint. Score validé par le propriétaire ; main conserve son snapshot historique jusqu'à intégration documentaire.

### État consolidé
R3 : #23 16deec8435fa1334482c84d36d50773759f73e97, #24 06355edd3a7a1b3f2e514f01f00e504aceaf425b, #25 f086090bfa801765ce9cfff880d7a2b496b532a9, #26 64a0e0f4ff353c25b2f40ac6844eebb55094b313. Ascendance vérifiée +10/0 puis +14/0. CI 46007770260, 46019415562, 46019419497, 46007772443 vertes. RC-01 clos. G2/G5/G6 remplies ; G7 partielle (PostgREST DEV), G8 partielle (22/22 x3 local rapporté, export DEV réel et restauration locale selon méthode officielle non exécutés), G1/G10 ouvertes, G3/G4/G9 jour J. ERR-02/CAT-01 maintenues. Aucun accès DEV ni migration autorisés par ces décisions.
Mobile #28 8ef2abdb0725c7d449bd68931138a04e98401a91 : 9/9 jobs, 61/61 frontend, 13 Glance, 32 Android, 20/20 Doctor, 40 cellules web sans échec, SQLite 30 pass + 2 TODO R-02/R-03. Gemini : restitution documentaire, pas de tests ni lecture directe. Recette native non démontrée ; GO interne conditionnel, NO GO fusion/diffusion. Guide recette : clone isolé, ne pas utiliser reset --hard ; npm test absent du package.json, reprendre les commandes CI exactes. Fusionner matrices N01–N10 et REC-01–12. S3 conception seulement, #28 gelée. Voir commentaires #29 7221447200 et 7222311390.
