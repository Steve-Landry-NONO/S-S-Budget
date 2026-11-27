# Sprint 3 Premium Enveloppes — revue d'exécution et contrat React Native

**Date :** 27 novembre 2026  
**Périmètre :** exploration Figma page 14, Sprint 3 en lecture seule sur fixtures ; aucune API réelle.  
**Base du document :** main `c8224ec443159745280e1565076d6f30aa0458b3`.  
**État :** proposition d'implémentation et observations statiques ; **aucune recette native exécutée**.

## Sources et garde-fous

- [Figma page 14](https://www.figma.com/design/ejg17Px9X7tsMsTAvVwwiT/?node-id=366-62), sans mutation de V3.0.7.
- [Spécification historique Sprint 3](SPRINT_3_ENVELOPES_UX.md).
- [Revue des risques REV-01 à REV-08](../INDEPENDENT_REVIEW_23_26_2026-11-26.md).
- [Consolidation](../CONSOLIDATED_AUDITS_2026-11-26.md) et [décisions](../CONSOLIDATION_DECISIONS_2026-11-26.md).
- PR #23–26 restent candidates ; PR #28 mobile est qualifiée séparément par Gemini ; #29 registre R2. Aucun résultat de Claude/Gemini présumé.

## Inventaire Figma observé

Dix frames au format initial **390 × 844** : E01 commun, E02 personnel, E03 détail Alimentation/réalisées, E04 détail Alimentation/à venir, E05 Vacances protégée, E06 réserve commune, E07 répartition, E08 personnalisation, E09 proposition d'accord, E10 états financiers. Composants identifiés : `P14 / Carte enveloppe · lecture` et six jauges (72 %, 46 %, 40 %, 23 %, 50 %, 25 %). La page est une exploration, pas un design validé pour production.

**Écart géométrique E01 :** contenu visible à hauteur 760 ; Transport se termine à 883, Loisirs à 1057, titre de section protégée à 1090, carte protégée à 1264 et réserve à 1317. Les frames sont clippées. Le parcours RN devra utiliser une liste réellement défilante avec navigation basse fixe et conservation du scroll au retour du détail. Ce constat est basé sur la géométrie des nœuds, non sur un test de prototype Figma ni un test appareil.

**Prévision :** la source Figma observée utilise déjà « Prévision · démo » pour E01–E04 ; E05/E06 affichent « Non disponible ». En cloud, la capacité R-B2 manque : n'afficher **aucune** prévision comme montant cloud confirmé. Une simulation de fixture doit être marquée « Simulation » et associée à sa source, distinctement du réel. Les contributions attendues ne sont pas des encaissements.

**Règles de confidentialité :** E02 ne reçoit que des données du compte personnel courant. Les protections communes sont visibles aux deux partenaires ; le personnel est privé. La protection de Vacances n'annule pas sa visibilité ni sa comptabilisation, mais restreint les actions selon les règles de droit.

## Variantes Figma créées le 27/11

| Nœud | Largeur | Texte | Nature |
|---|---:|---:|---|
| `384:297` | 360 | 100 % | Exemple QA de lecture |
| `384:319` | 390 | 100 % | Exemple QA de lecture |
| `384:341` | 430 | 100 % | Exemple QA de lecture |
| `384:363` | 390 | 135 % | Exemple QA de lecture |
| `384:385` | 390 | 200 % | Exemple QA de lecture |

Ces cinq vues **ne remplacent pas** les dix écrans et ne satisfont pas la matrice complète de 90 configurations. Contrôle géométrique initial : aucun texte au-delà de la largeur de sa frame pour ces exemples. Le 200 % nécessite une vue verticalement défilante ; aucun test lecteur d'écran/contraste/prototype natif n'a été exécuté.

### Couverture progressive exigée

- Phase A : E01–E10 à 390 / 100 %, exactitude sémantique et parcours ; **non validée**.
- Phase B : E01, E03, E05, E10 aux largeurs 360/390/430 à 100 % et à 135 % ; **exemples partiels seulement**.
- Phase C : E01–E10 × (360/390/430) × (100/135/200 %) = **90** configurations, avec preuve captures/tests ; **à faire**.
- En complément : XAF sans décimales, EUR/USD à deux décimales, montant long/négatif, VoiceOver/TalkBack, reduced motion, hors ligne, chargement, erreur, données nulles, retour à la position de liste.

## Contrat React Native proposé — S3 lecture seule

Architecture de présentation isolée des fournisseurs :

```ts
type Scope = 'common' | 'personal';
type Capability<T> =
  | { status: 'available'; value: T; asOf: string }
  | { status: 'simulation'; value: T; source: 'fixture' }
  | { status: 'unavailable'; reason: string };

type Money = { currency: 'EUR' | 'USD' | 'XAF'; minorUnits: string };
type ReadContext = {
  viewerId: string; scope: Scope; periodId: string;
  sessionVersion: string; cycleVersion: string;
};
type EnvelopeReadVM = {
  id: string; name: string; categoryIconKey: string;
  target: Money | null; realAvailable: Money | null;
  fundsAllocated: Money | null; realizedExpenses: Money | null;
  budgetRemaining: Money | null; unfundedTarget: Money | null;
  protectionState: 'unprotected' | 'protected' | 'lift_pending';
  forecast: Capability<Money>;
  sync: { state: 'fresh' | 'stale' | 'offline' | 'error'; asOf: string | null };
};
```

**Important :** ces types sont une *interface de présentation proposée* et ne modifient pas le contrat #26. Ils nécessitent réconciliation avec le contrat mobile R2 et le backend avant intégration. Le client ne calcule pas les soldes financiers en flottants JS. Les montants exacts sont des entiers mineurs transportés en chaînes ou des décimaux validés ; `null` signifie « inconnu », jamais zéro.

### Règles d'affichage

1. Afficher `realAvailable` prioritairement ; ne jamais lui substituer `budgetRemaining`, `target` ou `forecast`.
2. Garder `fundsAllocated`, `target`, `budgetRemaining`, `unfundedTarget` dans des libellés différents. Allocation de budget ≠ création de fonds.
3. Décliner `forecast` selon les trois états ; « simulation » n'est jamais présenté comme résultat backend.
4. Si `protectionState === 'lift_pending'`, la protection demeure active et les décisions d'accord sont visibles aux seuls ayants droit.
5. Pour `scope='personal'`, servir exclusivement les lectures autorisées au viewer. Segmenter la mémoire et le cache par compte/session, scope, duo, période et version, puis purger à la déconnexion ou révocation ; ne jamais filtrer a posteriori des données privées téléchargées en bloc.
6. L'état hors ligne doit afficher la date du dernier instantané confirmé ; un succès réseau inconnu ne devient pas un succès d'écriture.
7. Le ratio de jauge ne doit jamais diviser par zéro ; ne pas coder le statut exclusivement par couleur, et exposer une description accessible de la progression.
8. Le cas d'un duo avec un membre n'est **pas arbitré** : ne pas ajouter de flux de validation implicite.

## Décomposition d'implémentation S3

- `EnvelopeListScreen` : onglets Commun/Personnel, titre de période, résumé avec labels explicites, liste défilante, section protégée et réserve, conservation de position lors du retour.
- `EnvelopeDetailScreen` : titre, réel, objectifs, allocation, dépenses, report, opérations réalisées et à venir clairement distinctes, protections, statut de synchronisation.
- `EnvelopeFinancialState` : inconnu, hors ligne, négatif, budget dépassé, financement partiel, état en attente ; combinaisons possibles sans masquage mutuel.
- `EnvelopeReadCard` et `EnvelopeProgress` : composants de lecture réutilisables, tailles dynamiques, minimum cible tactile 44 × 44 pt quand interactifs, textes non tronqués et voix accessibles.
- `EnvelopeRepository` : fixtures isolées et déterministes, interface compatible futur provider autorisé. Aucune connexion R2/DEV avant gates backend.

Les écrans E07–E09 représentent des propositions de répartition ; S3 ne doit **pas** exposer des boutons actifs de modification/versement tant que l'écriture sécurisée, le double accord et les habilitations ne sont pas disponibles. En prototype, signaler visuellement l'état non opérant.

## Fixtures d'acceptation et invariants

- Commun : objectif total 2 000 €, versements réalisés 1 600 €, dépenses 960 €, réel 640 €, fonds protégés 150 €, réserve 0 € ; prévision simulée uniquement 655 €.
- Alimentation : objectif 400 €, fonds affectés 300 €, dépenses 185 €, réel 115 €, budget restant 215 € ; « à venir » 100 € entrant / 65 € sortant, prévision simulée 150 €.
- Personnel Lecture : objectif 60 €, versements 50 €, dépenses 15 €, réel 35 €, sans fuite vers le commun.
- Cas de revue différenciant : objectif 500 €, fonds affectés 300 €, dépenses 42,50 € ⇒ disponible réel 257,50 €, budget restant 457,50 €, objectif non financé 200 € (sans report ni mouvements internes).
- Tester aussi XAF 0/entiers, négatif -25, montant long, objet null, objectif nul, protection en attente, changement de viewer et période, fuite cache, écran 200 %, hors ligne et réouverture.

## Gates et responsabilités

| Porte | État au 27/11 | Responsable |
|---|---|---|
| Exploration Figma S3 et 5 exemples de variantes | **Créés, non validés visuellement/nativement** | ChatGPT |
| Correction E01 scroll et parcours interactif | **À réaliser** | ChatGPT / mobile S3 |
| Contrat lecture R2 et G-A / réserves | **Qualification en cours, ne pas présumer du résultat** | Claude |
| PR #28 et recette S1/S2 native | **Qualification indépendante en cours** | Gemini |
| CI et tests RN Sprint 3 | **Non exécutés dans cette mission** | Intégration mobile ultérieure |
| Migration Supabase DEV, production, workflow DEV, fusion main | **Non autorisés** | Arbitrage propriétaire |

**Maturité officielle conservée : 48,96 %.** Aucune hausse jusqu'à réévaluation formelle selon les critères d'acceptation. Le présent document n'est ni un GO cloud ni un GO fusion.
