# Remplacement du harnais E2E DEV (A-05 / G13)

**Statut : plan.** Rien n'est implémenté. L'ancien harnais (`scripts/v3-finance-e2e-dev.cjs`, workflow `v3-finance-auth-e2e-dev.yml`) est **neutralisé** : le workflow n'a plus ni environnement ni secret, et le script s'arrête dès son démarrage (code 3). Il est conservé pour l'historique.

## Pourquoi il est obsolète

- Il crée des duos **sans période** et des comptes `cash` et `envelope` par SQL direct.
- Il transfère ensuite de `cash` vers `envelope` par `duo_v3_post_transfer`.
- Sous la 006 révisée, ce transfert est refusé : 23503 (lot 2 C07) et 55000 (`ensure_current_period` sans période). Le test G13-01 le reproduit.

## Nouveau harnais (après G-A et G-B, et sur autorisation distincte)

1. **Comptes de test.** Deux comptes Supabase Auth dédiés, vérifiés par courriel, sans donnée réelle. Les secrets restent dans l'environnement protégé `duo-budget-v3-dev`, qui est recréé.
2. **Fixtures.** Uniquement par les RPC de gestion (G-A : création d'espace et activation des fonds ; G-B : enveloppes et allocations). Plus aucun SQL direct.
3. **Scénarios.**
   - Concurrence CF-06 : même clé, deux auteurs.
   - Rejeu exact.
   - Charge différente sous la même clé : 23505.
   - Départ et écriture simultanés (F7, R-A3).
   - Révocation de session.
   - Suppression de compte (`auth.admin.deleteUser`) avec réconciliation (R-C2).
   - Invariant des trois livres après chaque étape.
4. **Garde-fous.**
   - Projet attendu vérifié avant tout appel.
   - Nettoyage par archivage, jamais par suppression du grand livre.
   - `workflow_dispatch` seul.
   - Exécution humaine uniquement, après autorisation écrite.
5. **Sortie.** Journal TAP et JSON (SQLSTATE et identifiants), sans secret.
