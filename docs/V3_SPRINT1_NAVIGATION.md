# Sprint 1 — Navigation V3
Base : Expo SDK 58, PR #5. Quatre destinations fixes sous le contenu, deux actions depuis Accueil, six écrans V2 conservés. Aucun changement métier, PIN, serveur ou migration. Styles issus des tokens existants. Les libellés sont associés à des pictogrammes natifs monochromes sans dépendance additionnelle ; ils restent la source d'information accessible. Pictogrammes provisoires, recette visuelle Figma et appareils requise avant validation produit.
## Recette restante
- iOS et Android : 360/390/430 px, safe areas, clavier ouvert, défilement, grande police 130/200 %, VoiceOver/TalkBack.
- Les six parcours : synthèse, caisses, membres, journal, dépense, versement ; retour Accueil depuis les deux actions.
- PIN invalide/valide, expiration, changement de profil, aucune donnée avant connexion.
- Comparer soldes et opérations V2 sur données fictives identiques.
- Aucun résultat natif prétendu ; CI statique et web distinctes.

CI du socle initial f31f4b3 : run 45360468225 réussi (Node, npm ci, garde-fous, Babel, export Web). Cette preuve ne s'applique pas automatiquement au commit de finition.
