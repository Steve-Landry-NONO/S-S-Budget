# Politique de compatibilité

- **Versionnement** : semver dans `ENVELOPE_CONTRACT_VERSION`. Le dossier `v3/` porte la version majeure.
- **Majeure** : retrait ou renommage d'un champ, ou changement de sens. Exemple : `actualBalance` → `realAvailable` en v3. Nouveau dossier, ancienne version maintenue jusqu'à la migration des écrans.
- **Mineure** : ajout d'un champ ou d'un état de `Capability`, ou nouveau code d'erreur. Les clients doivent traiter un état ou un code inconnu comme `not_available` ou `SERVER`.
- **Correctif** : correction de mapper sans changement de forme.
- Les **fixtures SQL** sont régénérées à chaque modification de migration. Toute différence de valeur fait échouer `sqlFixtures.test.ts`.
- La **3.1.0-candidate** ajoute à la 3.0.0 : `expectedContributionsState`, `expectedByMember`, `ProtectionState.lift_pending` et sept codes d'erreur à indice.
- La **3.2.0-candidate** (26/11, durcissement REV-01 à REV-07, G6, G7, G9) :
  - **rupture** `DuoSnapshot.forecast`, `upcomingContributions`, `plannedExpenses` : `Money` → `Capability<Money>` (REV-07) ;
  - **rupture** le mapper refuse les nombres JSON (`CONTRACT_VIOLATION`) : il exige les migrations corrigées (REV-01) ; les réponses publiées sont conservées dans `fixtures/legacy-published-df41563/` ;
  - **rupture** `envelopeCacheKey` inclut toujours l'utilisateur et la période (REV-04) ; `EnvelopeCache` purge à la déconnexion, à la révocation et au départ ;
  - **ajout** `Capability.partial`, `NotAvailableReason.integrity_incident`, `EnvelopeListSnapshot.integrity` et `viewerUserId`, codes `CONTRACT_VIOLATION` et `SPACE_NOT_INITIALIZED` ;
  - **ajout** commandes `reallocateBudget`, `moveRealFunds`, `setEnvelopeProtection`, `getContributionReleasePlan`, `mySpaces`, `createPersonalSpace`, `signOut` ; `transfer` déprécié (alias de `reallocateBudget`) ;
  - `fromSqlFundsSnapshot(raw, { viewerUserId, scope })` : l'ancienne forme `(raw, scope, owner)` reste acceptée ; l'espace annoncé par le serveur prime.
- La **3.3.0-candidate** (27/11, R2-02) :
  - **rupture** `EnvelopeCache` est lié à une session (`openSession` / `closeSession`) ; `put(snapshot)` est **supprimé** ;
    toute écriture passe par `beginRead(duoId, scope)` (avant l'appel réseau) puis `commit(ticket, snapshot)` (au retour) ;
  - une réponse arrivée après déconnexion, révocation, changement de compte, **reconnexion du même compte** ou perte d'appartenance
    est refusée avec un motif (`CacheRejection`) ; une version plus ancienne n'écrase jamais une plus récente ;
  - `get(duoId, scope, periodId)` ne lit que pour la session courante ; `onSyncEvent(e)` n'a plus de paramètre utilisateur ;
  - perte d'appartenance : purge et refus des lectures jusqu'à `membershipConfirmed(duoId)` (nouvel épisode confirmé par le serveur).
- **Clés de cache** : `envelopes:v3:<utilisateur>:<duo>:<espace>:<période>`, jamais partagées entre espaces, utilisateurs ni périodes.
