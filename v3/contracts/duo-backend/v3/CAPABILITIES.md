# Capacités et données indisponibles

Chaque notion que la source peut ne pas fournir est un `Capability<T>` :

| État | Signification | Affichage attendu |
|---|---|---|
| `available` | Valeur fournie par la source autorisée | La valeur |
| `partial` + `basis` + `missing` | Valeur calculée sur une base incomplète, explicitement qualifiée (REV-05) | La valeur avec la mention de ce qui manque (« hors dépenses prévues ») |
| `not_available` + raison | La source ne modélise pas, ou pas encore, la notion | « Non disponible », avec l'explication. **Jamais 0** |
| `not_declared` | Notion modélisée, mais non configurée par les membres | « À définir » |

| Raison | Origine |
|---|---|
| `funds_not_modeled` | Source 006 seule (sans fonds réels) |
| `funds_not_activated` | Fonds réels non activés pour ce duo |
| `planned_expenses_not_modeled` | R-B2 : prévu par enveloppe, lot distinct |
| `protection_not_modeled` | Source sans protection |
| `not_in_source` | La réponse ne contient pas la notion |
| `integrity_incident` | Le serveur signale un invariant rompu (`invariantHolds = false`, REV-03) : la répartition des fonds réels n'est pas affichée |

**Règles.**
- `realAvailable` vient **uniquement** des fonds réels.
- `primaryAmount()` n'utilise jamais `budgetBalance`, `remainingBudget` ni `target` en repli.
- `expectedContributionsState` vaut `agreed`, `provisional` (proposition non acceptée, CF-10) ou `not_configured`.
- Les contributions attendues sont un objectif, pas de l'argent.
- `ProtectionState` vaut `none`, `protected` ou `lift_pending` (R-B6 : la levée attend le second accord ; les fonds restent protégés). Depuis la 3.2 (REV-06), l'instantané SQL corrigé expose `lift_pending` et le mapper le transmet tel quel.
- `forecastTreasury` « contributions seules » (trésorerie + contributions attendues restantes, sans dépenses prévues) est `partial`, jamais `available` (REV-05).
- `integrity` vaut `ok` ou `incident` (REV-03). Un instantané en incident n'est jamais mis en cache.
- Cache (R2-02) : écriture uniquement par ticket de lecture de la session courante ; aucune écriture tardive après purge, déconnexion, changement de compte ou perte d'appartenance.
- `DuoSnapshot.forecast`, `upcomingContributions` et `plannedExpenses` sont des `Capability<Money>` (REV-07).
- Une réponse vide d'un espace non autorisé est **refusée** (`FORBIDDEN`). Elle n'est jamais présentée comme un espace vide valide.
- Un espace membre sans période ouverte lève `SPACE_NOT_INITIALIZED`. Une position absente pour un espace initialisé lève `CONTRACT_VIOLATION` : **aucun repli à zéro**.
- **Validation d'exécution** : chaque réponse SQL est validée (chaînes d'entiers, devise connue, UUID, dates ISO, énumérations fermées). Un nombre JSON est refusé (REV-01).
