# Capacités et données indisponibles

Chaque notion que la source peut ne pas fournir est un `Capability<T>` :

| État | Signification | Affichage attendu |
|---|---|---|
| `available` | Valeur fournie par la source autorisée | La valeur |
| `not_available` + raison | La source ne modélise pas, ou pas encore, la notion | « Non disponible », avec l'explication. **Jamais 0** |
| `not_declared` | Notion modélisée, mais non configurée par les membres | « À définir » |

| Raison | Origine |
|---|---|
| `funds_not_modeled` | Source 006 seule (sans fonds réels) |
| `funds_not_activated` | Fonds réels non activés pour ce duo |
| `planned_expenses_not_modeled` | R-B2 : prévu par enveloppe, lot distinct |
| `protection_not_modeled` | Source sans protection |
| `not_in_source` | La réponse ne contient pas la notion |

**Règles.**
- `realAvailable` vient **uniquement** des fonds réels.
- `primaryAmount()` n'utilise jamais `budgetBalance`, `remainingBudget` ni `target` en repli.
- `expectedContributionsState` vaut `agreed`, `provisional` (proposition non acceptée, CF-10) ou `not_configured`.
- Les contributions attendues sont un objectif, pas de l'argent.
- `ProtectionState` vaut `none`, `protected` ou `lift_pending` (R-B6 : la levée attend le second accord ; les fonds restent protégés). L'instantané SQL actuel n'expose pas encore `lift_pending` : c'est une évolution prévue, et le mapper renvoie alors `protected`.
- Une réponse vide d'un espace non autorisé est **refusée** par l'adaptateur. Elle n'est jamais présentée comme un espace vide valide.
