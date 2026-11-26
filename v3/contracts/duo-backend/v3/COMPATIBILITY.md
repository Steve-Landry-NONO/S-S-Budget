# Politique de compatibilité

- **Versionnement** : semver dans `ENVELOPE_CONTRACT_VERSION`. Le dossier `v3/` porte la version majeure.
- **Majeure** : retrait ou renommage d'un champ, ou changement de sens. Exemple : `actualBalance` → `realAvailable` en v3. Nouveau dossier, ancienne version maintenue jusqu'à la migration des écrans.
- **Mineure** : ajout d'un champ ou d'un état de `Capability`, ou nouveau code d'erreur. Les clients doivent traiter un état ou un code inconnu comme `not_available` ou `SERVER`.
- **Correctif** : correction de mapper sans changement de forme.
- Les **fixtures SQL** sont régénérées à chaque modification de migration. Toute différence de valeur fait échouer `sqlFixtures.test.ts`.
- La **3.1.0-candidate** ajoute à la 3.0.0 : `expectedContributionsState`, `expectedByMember`, `ProtectionState.lift_pending` et sept codes d'erreur à indice.
- **Clés de cache** préfixées `envelopes:v3:`, jamais partagées entre espaces ni entre utilisateurs.
