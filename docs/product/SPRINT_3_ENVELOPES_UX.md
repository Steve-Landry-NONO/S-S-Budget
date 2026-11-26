# Sprint 3 — Premium Enveloppes · S3.1 / S3.2
25 novembre 2026 — spécification UX, non implémentée.
## Décisions UX validées par le propriétaire
ENV-UX-01 : cartes premium verticales.
ENV-UX-02 : espaces Commun et Personnel distincts.
ENV-UX-03 : disponible réel prioritaire.
ENV-UX-04 : enveloppes protégées dans une section dédiée en bas de liste.
Ces identifiants UX ne remplacent pas D-001 à D-029. Baseline Figma V3.0.7 gelée.
## Proposition de parcours
Liste : sélecteur Commun/Personnel, période explicite (bornes du cycle), synthèse réelle, objectif et prévisionnel secondaires, réserve commune distincte si applicable, cartes ordinaires, section protégée. Dans Personnel, aucune donnée du partenaire ni agrégat commun. Ne pas mélanger les deux espaces dans une recherche ou un cache.
Carte : icône métier, nom, disponible réel, objectif, progression de consommation, statut textuel, accès détail. Progression = dépense réalisée / budget disponible si dénominateur positif; afficher non applicable sinon. Distinguer objectif non financé, déficit réel, dépassement budgétaire et protection. États cumulables. Ne pas présenter fonds protégés comme librement utilisables.
Détail : disponible réel, budget objectif, report, budget restant, contributions et dépenses réalisées, mouvements internes distincts, prévisionnel, liste des opérations réalisées/à venir, retour. Actions de mutation hors périmètre S3.1/S3.2 ; pas de boutons inertes en production.
## Contrat de lecture candidat (à réconcilier avec Claude)
scope (common/personal), periodId, start/end, currency, minorUnits, asOf, syncStatus, envelopeId, name, iconKey, protectionState, target, carryOver, realizedContributions, realizedExpenses, netInternalMovements, remainingBudget, actualBalance, plannedContributions, plannedExpenses, forecastBalance, version. Montants exacts en unités mineures ou chaînes décimales selon contrat backend; aucun calcul financier flottant côté client cible. Les agrégats et droits viennent de la source autorisée, pas d'un filtrage de données privées reçues.
Référence V2: actual = report + versements réalisés - dépenses réalisées; forecast = actual + versements prévus - dépenses prévues; budget restant = report + objectif - dépenses réalisées. Pour V3, mouvements internes et règles de report exigent un contrat autoritaire distinct ; ne pas extrapoler la formule V2 aux transferts. D-014 réserve non affectée, D-015 réaffectation sans création de revenu, D-016 déficit avec avertissement non bloquant (hors restrictions de protection à réconcilier), D-017/018 déficit reporté. D-011/012 cycles personnalisés. D-007 confidentialité. D-005 devise. D-008/009/010 répartition à réconcilier avant mutations.
## Fixtures de recette (EUR, report nul, pas de transferts)
| Enveloppe | Objectif | Versé | Dépensé | Prévu entrant | Prévu sortant | Réel | Prévisionnel |
|---|---:|---:|---:|---:|---:|---:|---:|
| Logement |900|900|650|0|0|250|250|
| Alimentation |400|300|185|100|65|115|150|
| Transport |200|150|80|50|40|70|80|
| Loisirs |200|100|45|0|30|55|25|
| Vacances (protégée) |300|150|0|0|0|150|150|
| Total |2000|1600|960|150|135|640|655|
Dont protégé 150; hors section protégée 490 réel, 505 prévisionnel (ne pas appeler ce sous-total dépensable sans politique validée). Réserve fixture 0. Exemple personnel indépendant: Lecture objectif 60, versé 50, dépensé 15, réel 35. Aucune incidence sur le commun.
## États et critères
ENV-01 objectif seul sans report ni opérations => réel/prévisionnel 0. ENV-02 financement partiel. ENV-03 réalisé. ENV-04/05 prévu uniquement prévisionnel. ENV-06 reports positifs/négatifs selon cycle. ENV-07 objectif nul, pas de division. ENV-08 déficit non masqué. ENV-09 section protégée et montant distingués, aucune mutation supposée. ENV-10 isolation privée dans lectures/totaux/cache. ENV-11 cycles et changement de période. ENV-12 360/390/430 pt, texte 100/135/200 %, lecteur d'écran, réduction animations, montant long sans troncature. ENV-13 hors ligne, dernière synchro explicite, ne jamais afficher succès non confirmé. ENV-14 XAF entier; ENV-15 EUR/USD deux décimales; ENV-16 zéro sans signe négatif. ENV-17 réserve distincte et conservation globale sans double compte. ENV-18 erreur/retry, absence de données distincte du zéro, pas de mélange lors du changement d'espace. ENV-19 états cumulables, libellés indépendants de la couleur. ENV-20 accès direct détail et retour à la position de liste.
## Portée et gates
S3.1/S3.2 en lecture seule sur fixtures isolées : aucun serveur réel, aucune dépendance obligatoire au SQLite historique. Création, répartition, transferts, protections et écriture hors scope jusqu'à réconciliation des règles. Pas de promotion Figma, fusion, migration ou déploiement. Recette native à effectuer sur iOS/Android; aucun résultat de test revendiqué pour cette spécification. La carte et la liste doivent rester compatibles avec les tokens et la navigation déjà approuvés. Les choix de présentation au-delà des quatre décisions sont des propositions, à valider sur prototype.
