# Duo Budget V3 — Architecture cloud multi-duos (proposition)

**Statut : conception, non déployée.** Branche `design/cloud-multi-duo-architecture`. La V3.0.7 Figma reste gelée et le backend SQLite V2 inchangé.

## 1. État de départ vérifié

Le backend V2 est une API Express/SQLite (`server/src/index.js`, `server/src/db.js`, `server/schema.sql`). Le schéma comprend `members`, `categories`, `expenses`, `contributions`, `activity_logs`. Authentification PIN, rôles `admin/member`, journalisation, opérations `planned/done`. Les migrations attribuent historiquement `admin` à `steve` et le schéma insère deux membres et cinq enveloppes par défaut. Ces mécanismes ne conviennent pas à un service multi-clients.

## 2. Objectif et frontières

- Application iOS/Android Expo, authentification cloud, espaces `duos` isolés, deux membres maximum **pour le MVP — décision validée le 18/11/2026**.
- PostgreSQL comme source de vérité, Auth Supabase comme candidat d'identité, politiques RLS côté base, HTTPS et permissions côté API/RPC.
- Le poste Ubuntu et Codespaces servent au développement, jamais à l'hébergement permanent.
- Pas de synchronisation de données financières réelles, pas de secrets dans Git ni dans l'app.
- Les données fictives pré-authentification Duo Glance restent locales et clairement identifiées.

## 3. Modèle de données candidat

`auth.users` (géré par le fournisseur d'identité) -> `duos` + `duo_memberships` (clé composite `duo_id,user_id`, rôle `owner/member`). Les tables `envelopes`, `expenses`, `contributions`, `activity_logs` portent `duo_id`. Les références à une enveloppe sont composites `(duo_id,envelope_id)` pour empêcher toute association inter-duos. Les membres acteurs sont référencés par `user_id`, et les actions sensibles doivent vérifier leur appartenance au duo.

Le fichier `docs/architecture/cloud-multi-duo-schema.draft.sql` est un **schéma de discussion non exécutable en production** : aucune politique d'écriture ni aucun droit d'accès client n'est accordé.

## 4. Règles financières à préserver

- Montants stockés en `numeric(18,2)` pour le modèle initial (précision de stockage à valider selon les devises autorisées). Une seule devise ISO 4217 est autorisée par duo pour le MVP, avec validation du nombre de décimales par devise et sans conversion automatique (décision D-005).
- Solde réel calculé exclusivement à partir des opérations `done`; les `planned` ne modifient que le prévisionnel.
- Objectifs budgétaires et contributions attendues ne sont jamais assimilés à de l'argent disponible.
- Reports mensuels, verrouillage des enveloppes, dates de réalisation, transferts et corrections doivent être spécifiés et testés contre la V2 avant migration.
- Les écritures liées doivent être atomiques, idempotentes si rejouées, et historisées.

## 5. Sécurité à vérifier avant tout déploiement

- RLS activée sur toutes les tables applicatives exposées. Aucune règle « tout utilisateur authentifié peut tout lire ».
- Ne jamais utiliser `user_metadata` pour autoriser une opération; jamais de clé `service_role` dans Expo.
- L'invitation d'un membre, le transfert de propriété, la suppression d'un duo, l'export et la restauration exigent des workflows contrôlés côté serveur avec vérification de l'identité, de l'appartenance et du rôle.
- La politique de lecture seule proposée doit être auditée contre les risques de récursion RLS, d'accès croisé et d'exposition de données personnelles avant activation.
- Refuser par défaut les accès anonymes et les écritures directes tant que les règles métier ne sont pas codées et testées.
- Ne pas répliquer les seeds `steve`/`sorelle` ni le rôle admin codé en dur.

## 6. Recette de sécurité et métier (à automatiser)

| Scénario | Résultat attendu |
| --- | --- |
| Utilisateur A du duo 1 lit ses enveloppes | Autorisé |
| Utilisateur A du duo 1 lit les dépenses du duo 2 | Refusé, aucune ligne |
| Utilisateur A crée une dépense avec `duo_id` d'autrui | Refusé |
| Utilisateur A référence une enveloppe du duo 2 | Refusé par clé composite et autorisation |
| Utilisateur anonyme interroge les tables | Refusé |
| Membre sans droit modifie rôles ou invitations | Refusé |
| Dépense future saisie | N'affecte pas le solde réel |
| Modification `planned` vers `done` | Actualise réel et prévisionnel sans double comptage |
| Deux dépenses simultanées | Pas de perte d'écriture ni d'incohérence |
| Deux requêtes identiques rejouées | Pas de double opération lorsque clé d'idempotence fournie |
| Suppression d'un compte / duo | Politique de conservation, suppression et audit validée |

## 7. Plan de livraison proposé

1. Valider les décisions produit restantes : devise, rôles, suppression, partage des opérations, et paramètres de sécurité. La limite de deux membres, les invitations par lien/email et l'authentification email/mot de passe avec déverrouillage PIN/biométrie sont validées.
2. Auditer les fonctions V2 dans `server/src/index.js` (calculs, autorisations, exports, sauvegardes) et créer des tests de référence.
3. Mettre en place un environnement PostgreSQL **de développement** séparé, avec migrations versionnées.
4. Écrire et tester les politiques RLS et fonctions transactionnelles; vérifier la séparation de deux duos fictifs.
5. Intégrer Auth et les écrans V3 dans une PR distincte, puis recette iPhone/Android.
6. Effectuer audit sécurité, sauvegardes, restauration et conformité avant bêta.

**Non fait :** projet Supabase, base cloud, authentification V3, RLS exécutée, migrations et tests d'intégration.

## 8. Décision produit D-001 — Deux membres maximum (validée le 18/11/2026)

- Un espace budgétaire `duo` peut accueillir **au maximum deux comptes utilisateurs distincts**; un même utilisateur ne peut pas occuper deux sièges du même duo.
- Les deux membres ont une identité Auth indépendante. Les dépenses et contributions sont rattachées au duo, pas à un ordinateur ni à une installation locale.
- Le premier membre est provisoirement désigné `owner`; les pouvoirs exacts de ce rôle, les invitations, les départs et la reprise de propriété restent à valider.
- Le quota doit être imposé **dans une transaction côté base/serveur**, y compris lors d'acceptations simultanées d'invitations. Un contrôle côté mobile ou un simple `COUNT(*)` sans verrouillage n'est pas suffisant.
- Toute invitation doit être associée à un duo, avoir une expiration et un statut; l'acceptation doit être authentifiée et atomique. Le modèle d'invitations reste à concevoir.
- Les comptes ne doivent pas pouvoir se donner eux-mêmes un rôle `owner` ni changer leur `duo_id` via une écriture directe.
- La limite de deux personnes est une règle produit du MVP; une éventuelle évolution future nécessitera une nouvelle décision explicite.

**Tests d'acceptation ajoutés :** création du premier membre autorisée; deuxième membre autorisé; troisième refusé; deux acceptations concurrentes pour le dernier siège ne peuvent pas produire trois membres; invitation expirée refusée; même utilisateur ne peut pas rejoindre deux fois le même duo; accès aux données révoqué après départ.

**État technique :** cette décision est documentée, mais la contrainte transactionnelle et les invitations ne sont pas encore implémentées dans le brouillon SQL.


## 9. Décision produit D-002 — Deux méthodes d'invitation (validée le 18/11/2026)

- **Lien sécurisé** : un membre autorisé génère un lien à transmettre via WhatsApp, SMS ou un autre canal. Le destinataire doit s'authentifier avant d'accepter.
- **Email** : un membre autorisé renseigne l'adresse du partenaire; le système envoie une invitation nominative à cette adresse. À l'acceptation, l'identité email vérifiée doit correspondre au destinataire ciblé.
- Les deux parcours convergent vers **un mécanisme commun d'invitation** : jeton aléatoire non prédictible, seul son condensat conservé côté serveur, durée de validité limitée, révocation, consommation unique et validation transactionnelle de la capacité du duo (maximum deux comptes).
- Les invitations par lien sont des jetons porteurs : leur détenteur peut demander à rejoindre le duo, mais n'obtient jamais l'accès financier sans authentification, vérification du quota et acceptation explicite. Ne pas inscrire de données financières dans le lien.
- Les invitations expirées, révoquées ou déjà utilisées sont refusées. Prévoir limitation de débit, absence de divulgation d'existence de comptes, journalisation sans jeton brut, et protection contre la réutilisation concurrente.
- **Décisions d'implémentation restantes :** durée d'expiration (proposition 48 h), nombre d'invitations actives, éventuel contrôle d'adresse email pour les liens génériques, fournisseur d'email, deep links iOS/Android et règles d'annulation.

**Scénarios d'acceptation :** acceptation par lien et par email; création de compte avant acceptation; email ciblé différent refusé; lien expiré ou révoqué refusé; deuxième consommation refusée; acceptations concurrentes pour la dernière place : une seule réussit; un troisième membre n'accède jamais au duo.

**État technique :** décision documentée seulement. Aucune table d'invitations, API d'envoi, service d'email ou mécanisme de jeton n'a encore été créé.


## 10. Décision produit D-003 — Authentification et déverrouillage (validée le 18/11/2026)

- **Connexion initiale** : compte individuel par email vérifié et mot de passe via un fournisseur d'identité cloud (Supabase Auth candidat, non encore configuré). Chaque partenaire utilise son propre compte, jamais des identifiants partagés.
- **Déverrouillage quotidien** : PIN local propre à l'appareil **ou** biométrie du système (Face ID / Touch ID / équivalent Android), au choix de l'utilisateur. Le PIN de déverrouillage local n'est pas le PIN serveur historique de la V2.
- **Séparation des responsabilités** : le déverrouillage local protège l'accès à l'interface et aux secrets de session stockés dans le stockage sécurisé du téléphone; il ne remplace jamais l'authentification ni l'autorisation backend. Après expiration ou révocation de session, demander une reconnexion complète.
- **Sécurité attendue** : mots de passe jamais stockés par l'app; jetons et éléments sensibles dans un stockage sécurisé adapté à iOS/Android; aucune clé de service privilégiée dans Expo; limitation des tentatives PIN, délais croissants et réauthentification pour opérations sensibles. Ne pas promettre une protection absolue contre un appareil compromis.
- **Récupération** : réinitialisation du mot de passe par email, invalidation des sessions selon les capacités du fournisseur, et procédure de réinitialisation du PIN local après réauthentification; pas de contournement par un PIN codé en dur.
- **Décisions techniques à valider** : durée de verrouillage automatique, politique biométrie/PIN de secours, changement de téléphone, durée de session, récupération hors ligne, vérification d'email avant accès aux duos, et comportement en cas de biométrie modifiée.

**Scénarios de recette** : email non vérifié; mauvais mot de passe; mot de passe réinitialisé; session expirée; PIN erroné répété; biométrie indisponible; téléphone perdu; changement d'appareil; membre révoqué du duo; fermeture et réouverture de l'app; absence de réseau.

**État technique :** décision produit documentée, aucune intégration Auth V3, biométrie ou PIN local V3 encore implémentée.


## 11. Décision produit D-004 — Égalité financière et administration encadrée (validée le 18/11/2026)

**Principe validé :** les deux partenaires disposent des mêmes permissions sur les fonctionnalités financières ordinaires (lecture des soldes et opérations, création et gestion des enveloppes, dépenses, versements et consultation du journal). Aucun membre ne peut modifier seul les règles d'accès pour s'octroyer des pouvoirs financiers supérieurs.

**Actions sensibles à encadrer :** suppression du duo, retrait forcé d'un partenaire, transfert de propriété, modifications des permissions et restauration globale de données. Ces actions nécessitent une procédure spécifique avec authentification récente, journalisation et protections contre les abus; le consentement mutuel, les délais et les recours restent à définir.

**Conséquence sur le schéma :** la colonne `role = owner/member` du brouillon SQL est un marqueur de responsabilité administrative provisoire, **pas** une hiérarchie de droits financiers. Les politiques RLS de lecture/écriture financière doivent vérifier l'appartenance au duo et les règles métier, sans privilège financier automatique pour `owner`. Aucun rôle `admin` codé en dur issu de la V2 ne doit être repris.

**Tests à prévoir :** chaque partenaire peut créer une opération financière valide; un partenaire ne peut pas accéder à un autre duo; un membre ne peut pas s'attribuer des droits supplémentaires; une opération sensible sans autorisation renforcée est refusée; un départ ou une révocation invalide les accès financiers concernés.

**Non tranché :** suppression consensuelle ou délai d'opposition, règles de départ volontaire, traitement des données après séparation, transfert de propriété, export des données personnelles, possibilité de modification d'une opération créée par l'autre membre.

**État technique :** décision documentée uniquement, aucune politique RLS ni workflow d'administration sensible implémenté.


## 12. Décision produit D-005 — Une devise de référence par duo (validée le 18/11/2026)

- À la création, chaque duo choisit **une devise ISO 4217** parmi les devises autorisées (notamment EUR, XAF et USD).
- Toutes les enveloppes, dépenses, contributions, soldes, objectifs, reports et exports d'un duo sont exprimés dans **cette seule devise**. Aucune conversion de change automatique ni opération multidevise dans le MVP.
- Les devises n'ont pas toutes la même précision : EUR et USD ont deux décimales, XAF n'a pas de décimales. Valider la précision par devise à l'entrée, au calcul et à l'affichage; éviter les calculs monétaires en flottants JavaScript.
- Modèle candidat : `duos.currency_code char(3) not null` avec contrainte de valeurs autorisées, et table de métadonnées des devises (`code`, `minor_units`) ou référentiel équivalent. Le brouillon SQL doit encore être adapté.
- Les montants ne sont jamais convertis silencieusement lors d'un changement de devise. Pour un duo avec historique, le changement doit être bloqué jusqu'à la définition d'un workflow explicite (conversion documentée, nouvel espace ou autre politique).
- La devise ne doit pas être modifiable directement par un client en contournant les contrôles métier.

**Scénarios d'acceptation :** duo EUR avec deux décimales; duo XAF avec montants entiers; duo USD indépendant; saisie XAF fractionnaire rejetée; opération d'une devise différente rejetée; changement de devise avec historique refusé; soldes et exports cohérents dans la devise du duo; aucun mélange de devises entre duos.

**État technique :** décision documentée, sans modification du SQL, des calculs ou de l'interface. Choix exact des devises disponibles, formatage localisé et politique de changement de devise à finaliser.


## 13. Décision produit D-006 — Archivage ou suppression encadrée (validée le 18/11/2026)

**Choix produit :** à la fin d'un duo, les membres peuvent choisir entre **archiver l'espace** et **engager une suppression encadrée**. Ce sont deux workflows distincts, pas une suppression immédiate par simple bouton.

### Archivage

- Passage du duo dans un état clôturé/archivé, avec interdiction de nouvelles opérations financières et de modifications de l'historique.
- Consultation et export de l'historique commun selon des permissions explicites, sans accès à d'autres duos; modalités et durée d'accès à valider.
- Prévoir journal d'audit de l'archivage et traitement des invitations en attente (révocation).
- La possibilité de réactivation, les droits après départ d'un partenaire et la durée de conservation restent à arbitrer.

### Suppression encadrée

- Demande authentifiée et traçable; confirmation renforcée et information des partenaires selon les règles à définir. Prévoir export préalable et, si approprié, délai de rétractation.
- Une demande unilatérale ne déclenche **pas** immédiatement la destruction irréversible des données communes. En cas de désaccord, d'absence de réponse ou de risque d'abus, prévoir un mécanisme de résolution distinct.
- Distinguer suppression de l'espace partagé, départ volontaire d'un membre et exercice des droits individuels sur les données personnelles. Les règles de conservation et d'effacement doivent respecter les obligations légales applicables, à vérifier avant lancement.
- Après effacement définitif, empêcher toute restauration non autorisée; définir la politique de sauvegardes et leur expiration.

### Conséquences techniques proposées (non implémentées)

- États métier candidats : `active`, `archived`, `deletion_pending`, `deleted` (ce dernier pouvant correspondre à l'absence physique des données).
- Contrôler les transitions côté serveur/base et verrouiller les écritures financières dès archivage ou demande de suppression selon la politique retenue.
- Journaliser les demandes, confirmations, annulations et opérations d'export sans inclure de secrets ni de données excessives.
- Ne pas confondre suppression du duo et suppression du compte Auth : un compte peut exister indépendamment d'un espace partagé.

**Tests à prévoir :** opérations refusées après archivage; export autorisé uniquement aux ayants droit; troisième membre toujours interdit; suppression directe par un seul membre refusée; demande de suppression concurrente et révocation d'invitations; respect des délais et des droits individuels; impossibilité de consulter les données définitivement supprimées.

**État technique :** décision produit documentée; aucun workflow d'archivage, d'export ou de suppression implémenté. Délais, confirmations exactes et conservation restent à décider.


## 14. Décision produit D-007 — Dépenses communes et personnelles privées (validée le 18/11/2026)

**Règle produit :** l'application distingue le budget commun, visible et gérable par les deux membres du duo, et le budget personnel privé de chaque utilisateur, accessible uniquement à son propriétaire. Le caractère privé est une contrainte de sécurité côté base/API, jamais un simple filtre d'interface.

- **Commun :** enveloppes, dépenses, contributions et soldes partagés; visibilité pour les deux membres autorisés du duo.
- **Personnel :** dépenses et enveloppes privées, avec propriétaire explicite (`owner_user_id`) et contrôles d'accès garantissant qu'aucun autre membre, même le créateur du duo, ne peut les lire ou modifier.
- **Calculs :** une opération privée ne modifie jamais les soldes, objectifs, reports ou prévisions du budget commun. Les agrégats communs ne doivent pas révéler indirectement les dépenses privées.
- **Surfaces de fuite à auditer :** historique et journal d'activité, notifications push/email, exports, recherche, statistiques, sauvegardes accessibles au client, erreurs API, temps réel et données en cache sur un appareil partagé.
- **Architecture à arbitrer avant SQL :** préférer une séparation explicite entre ressources du duo et ressources personnelles de l'utilisateur (tables ou schémas distincts), plutôt qu'un simple booléen `is_private` sur les tables partagées. Les ressources personnelles doivent avoir une identité de propriétaire et une politique de conservation indépendantes du cycle de vie du duo.
- **Transitions :** tout déplacement d'une dépense personnelle vers le commun ou inversement exige une action explicite et une vérification d'autorisation; ne jamais exposer rétroactivement des détails privés sans confirmation.
- **Portée à préciser :** comptes/solde personnel, contributions depuis un budget personnel vers le duo, devise du budget personnel, export personnel, confidentialité des catégories et cas de changement de partenaire.

**Tests à prévoir :** membre A lit ses dépenses privées; membre B reçoit zéro ligne et aucun total privé de A; B ne peut pas modifier les dépenses privées de A; A et B lisent les dépenses communes; les agrégats communs ne varient pas après dépense privée; les journaux, exports et notifications communs ne révèlent pas les détails privés; quitter ou supprimer le duo ne supprime pas automatiquement les données personnelles sans politique explicite.

**État technique :** décision documentée uniquement. Le brouillon SQL actuel ne distingue pas encore correctement données personnelles et données communes; les tables, politiques RLS et calculs doivent être revus avant toute exécution.


## 15. Décision produit D-008 — Contributions flexibles par enveloppe (validée le 18/11/2026)

**Règle produit :** chaque enveloppe commune utilise par défaut une répartition de contribution **50/50** entre les deux membres. Les partenaires peuvent choisir une répartition personnalisée **par enveloppe**, exprimée en pourcentages ou en montants attendus. La somme des parts attendues doit correspondre à l'objectif total de l'enveloppe.

- Les parts attendues ne sont **pas** des versements réels : conserver séparément l'objectif, la contribution attendue de chaque partenaire et les versements réellement effectués.
- Exemple : objectif de 400 EUR, répartition 60/40 => attentes 240 EUR et 160 EUR; un versement réel de 100 EUR ne satisfait que partiellement l'attente de 240 EUR.
- Les calculs doivent respecter la devise du duo et ses unités mineures (XAF : pas de centimes), avec règles déterministes d'arrondi et attribution du reliquat; ne pas calculer les montants monétaires en flottants JavaScript.
- Les modifications de répartition doivent être historisées et ne doivent pas réécrire rétroactivement les versements ou dépenses déjà réalisés.
- Les deux membres ayant des droits financiers égaux peuvent proposer ou modifier une répartition dans les limites des règles métier; toute modification doit recevoir l'accord explicite des deux partenaires (D-009).
- **Schéma à concevoir :** représentation versionnée des allocations par enveloppe et par membre, avec contraintes de somme, bornes, références au duo et prévention des modifications concurrentes; ne pas déduire les contributions attendues des seules contributions réalisées.
- **Points encore ouverts :** période de calcul (mensuelle ou autre), montants fixes vs pourcentages en cas de changement d'objectif, durée de validité d'une proposition, gestion des arrondis, contribution d'un seul membre avant acceptation de l'invitation, éventuelles avances et remboursements.

**Tests à prévoir :** 50/50 par défaut; 60/40 pour une enveloppe sans affecter les autres; 100/0 autorisé ou non selon décision ultérieure; sommes de parts égales à l'objectif; montants XAF entiers; versement partiel sans altérer l'objectif; changement de répartition sans réécriture de l'historique; conflits de mises à jour simultanées.

**État technique :** décision documentée uniquement. Le schéma SQL actuel ne contient pas encore les allocations versionnées par enveloppe et membre, ni les contrôles transactionnels correspondants.


## 16. Décision produit D-009 — Accord des deux partenaires sur les répartitions (validée le 19/11/2026)

- Toute modification de répartition des contributions d'une enveloppe commune (pourcentages **ou** montants attendus) nécessite l'approbation explicite des **deux membres**.
- Un membre soumet une proposition; le proposant exprime son accord en la soumettant, puis le second membre doit accepter. Tant que cette acceptation manque, la répartition active reste inchangée.
- Une proposition refusée, annulée ou expirée n'a aucun effet financier. Le proposant ne peut pas approuver à la place du second membre.
- À l'acceptation, vérifier de nouveau en transaction les deux appartenances, le statut actif du duo, la version de la répartition de départ et la validité de la proposition. Empêcher la double application et les conflits entre propositions concurrentes.
- Appliquer la nouvelle répartition à compter d'une date d'effet explicitement enregistrée; ne jamais réécrire les versements ou dépenses passés. Historiser proposition, décisions, auteur, dates et versions sans exposer les dépenses personnelles privées.
- Les modalités exactes de notification, expiration et retrait d'une proposition restent à spécifier. La date d'effet est fixée au début de la prochaine période budgétaire (D-010).

**Tests d'acceptation :** proposition 50/50 vers 60/40 sans effet avant accord; accord du second membre applique une seule fois; refus et annulation sans effet; même membre ne peut pas approuver deux fois; proposition devenue obsolète refusée; approbations concurrentes sans double écriture; duo archivé interdit toute nouvelle modification; montants conformes à la devise du duo.

**État technique :** décision documentée seulement; aucune table de propositions, fonction transactionnelle ou notification implémentée.


## 17. Décision produit D-010 — Application à la prochaine période budgétaire (validée le 19/11/2026)

- Une proposition de modification de répartition ne devient applicable **qu'après l'accord explicite des deux partenaires** (D-009).
- Une fois approuvée, elle est **programmée pour le début de la prochaine période budgétaire**, et non appliquée aux contributions attendues de la période en cours.
- La répartition active de la période en cours reste inchangée; les versements et dépenses historiques ne sont jamais réécrits.
- Exemple illustratif : enveloppe mensuelle de 400 EUR, 50/50 en novembre (200 EUR chacun), proposition 60/40 approuvée le 19 novembre => 240/160 EUR à partir du 1er décembre **si** les périodes commencent le premier jour du mois.
- Les périodes budgétaires doivent être explicitement modélisées : fuseau horaire de référence, date de début et de fin, moment de bascule et règles de calcul en cas de changements d'objectif. La période mensuelle avec jour de début personnalisable par duo est validée (D-011); préciser les règles des jours 29 à 31 et le fuseau horaire.
- Prévoir une activation idempotente et atomique des répartitions approuvées à la transition de période, y compris après interruption ou reprise du service.
- Si plusieurs modifications sont proposées pour la même enveloppe et la même période future, définir une règle de conflit explicite (proposition remplacée, refusée ou versionnée) avant implémentation.

**Tests d'acceptation :** accord au milieu de période sans effet immédiat; nouvelle répartition à la période suivante; rejet sans effet; activation unique après redémarrage; historique inchangé; conflit de propositions géré; aucune activation pour duo archivé.

**État technique :** décision documentée uniquement; aucune gestion de périodes ni activation planifiée des répartitions implémentée.


## 18. Décision produit D-011 — Périodes mensuelles avec jour de début personnalisable (validée le 19/11/2026)

- Chaque duo définit **un jour de début de période budgétaire mensuelle**. Toutes les enveloppes communes du duo suivent ce même calendrier.
- Exemple : jour de début 5 => période du 5 novembre 2026 au 4 décembre 2026 inclus, puis du 5 décembre 2026 au 4 janvier 2027 inclus.
- Les périodes sont contiguës, sans chevauchement ni jour non couvert. Une date/heure d'opération doit être rattachée à une seule période selon le fuseau horaire de référence du duo.
- Les nouvelles répartitions approuvées (D-009) prennent effet au début de la **prochaine période du duo** (D-010), qui peut différer du premier jour du mois civil.
- Les jours 1 à 31 sont autorisés. Pour les jours 29, 30 et 31 absents d'un mois, la frontière du cycle est ramenée au dernier jour de ce mois (D-012). Le jour nominal choisi est conservé dans les paramètres du duo.
- Un changement du jour de début après création d'historique doit passer par un workflow explicite; ne pas reclasser rétroactivement les écritures et périodes clôturées.
- Prévoir un stockage des bornes temporelles non ambigu (début inclus, fin exclue), une référence au fuseau horaire du duo et des tests de changement d'heure.

**Tests d'acceptation :** jour 1 => mois calendaire; jour 5 => 5 novembre–4 décembre; périodes sans trou ni chevauchement; nouvelle répartition activée à la prochaine frontière; transitions décembre–janvier; février et année bissextile; changement de fuseau et d'heure; modification du jour de début sans altération de l'historique.

**État technique :** décision documentée uniquement; calcul des périodes, migrations et tests non implémentés.


## 19. Décision produit D-012 — Dernier jour disponible dans les mois courts (validée le 19/11/2026)

- Le duo choisit un jour nominal de début de cycle compris entre **1 et 31**.
- Pour chaque mois, le début effectif de période est le jour **min(jour nominal, dernier jour du mois)**. Le jour nominal n'est jamais remplacé définitivement par le jour ajusté.
- Exemple avec un jour nominal de 31 en 2027 : 31 janvier, 28 février, 31 mars, 30 avril, 31 mai. En année bissextile, février utilise le 29.
- Les périodes sont définies par deux frontières successives : début inclus, fin exclue, dans le fuseau horaire du duo. Cette règle garantit continuité et absence de chevauchement.
- Les répartitions approuvées s'activent à la prochaine frontière effective du cycle, y compris lorsque cette frontière est avancée au dernier jour du mois court.
- Implémenter le calcul sur des dates calendaires et le fuseau de référence, sans approximation de durée fixe en jours ou secondes.

**Tests d'acceptation :** jour 29 en février non bissextile et bissextile; jour 30 en février; jour 31 en février, avril et mai; retour au jour nominal lorsque disponible; enchaînement sans trou ni chevauchement; activation de la nouvelle répartition à la bonne frontière; changement d'année et de fuseau horaire.

**État technique :** décision documentée uniquement; calcul de cycles, tests automatisés et migration SQL non implémentés.


## 20. Décision produit D-013 — Report configurable par enveloppe (validée le 19/11/2026)

- Chaque enveloppe commune dispose d'une **règle de report configurable**, applicable lors de la transition entre deux périodes budgétaires du duo (D-011 et D-012).
- **Report activé :** le solde disponible de fin de période est réaffecté à la même enveloppe pour la période suivante, sans être compté comme une nouvelle contribution réelle.
- **Report désactivé :** le reliquat n'est pas réaffecté automatiquement à cette enveloppe. Les fonds demeurent dans le solde commun global et doivent être représentés explicitement comme non affectés ou via une autre destination validée ultérieurement. Ne jamais créer une dépense fictive ou effacer un montant pour simuler une remise à zéro.
- Séparer les notions d'objectif budgétaire, contribution réelle, dépense réalisée, solde disponible et report; ne jamais compter deux fois un report dans le total des fonds.
- Historiser la règle applicable à chaque période et les écritures de report; préserver les périodes clôturées lors de changements ultérieurs de configuration.
- Les transitions doivent être atomiques et idempotentes, y compris après une interruption, et respecter les unités mineures de la devise du duo (D-005).
- **Points à définir avant implémentation :** définition exacte du solde reportable en présence de dépenses planifiées, déficit d'enveloppe, avances, opérations antidatées, fonds non affectés et changement de règle pendant une période.

**Tests d'acceptation :** report activé avec reliquat positif; report désactivé sans perte de fonds; total commun inchangé par un simple mouvement d'affectation; absence de double comptage après reprise; dépenses planifiées sans sortie réelle; changement de règle sans modification rétroactive; transition aux frontières des cycles personnalisés.

**État technique :** décision documentée uniquement; aucune migration, fonction de report ni test automatisé implémenté.
