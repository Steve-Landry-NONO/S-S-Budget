# Duo Budget V3 — Première tranche d'implémentation

Branche isolée `feat/v3-financial-core-foundation` créée depuis `design/cloud-multi-duo-architecture`. Ne pas fusionner dans `main` sans revue. Figma V3.0.7 n'est pas modifié.

## Réalisé

- Module JavaScript pur `core/finance.js` : montants exacts en unités mineures `BigInt`, précision par devise (EUR/USD/GBP à 2 décimales, XAF/XOF/JPY à 0), report des reliquats et déficits, calcul du disponible budgétaire, réaffectation de réserve et aperçu d'un dépassement.
- Tests unitaires sans dépendances : `node --test v3/core/finance.test.js`.
- Séparation explicite entre allocation budgétaire et argent réellement versé.

## Limites et travaux bloquants

Cette tranche est **une bibliothèque de calcul isolée**, non reliée à l'application Expo ou à la V2. Elle n'effectue aucune écriture financière et n'expose aucune API.

Avant un MVP cloud utilisable : définir le grand livre et les opérations de rectification rétroactive; migrations PostgreSQL et RLS vérifiées; authentification Supabase; invitation à deux places atomique; fonctions transactionnelles serveur (contrôle de concurrence, idempotence, audit immuable, notifications); tests inter-duos; raccordement des écrans mobiles et recette iOS/Android. Le brouillon SQL existant **ne doit pas être appliqué en production**.

La liste de devises est volontairement limitée au sous-ensemble pris en charge par ce module : compléter et tester la politique ISO 4217 avant ouverture à d'autres devises.
