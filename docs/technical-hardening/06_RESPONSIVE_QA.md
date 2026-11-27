# 06 — Qualification responsive et QA Lab (LOT T06)

**Ce qui a été qualifié : une simulation Web de disposition** (export QA Lab, Chrome). Ce n'est **pas** une validation de Dynamic Type iOS ni du redimensionnement des polices Android : le mode « Disposition grande police » applique `previewFontScale=1.5` aux composants, sans changer la taille système des polices.

## 1. Méthode

- Harnais `scripts/qa/web-qa.cjs` (Playwright-core 1.56.1, hors dépendances du projet) sur les exports `dist` et `dist-preview`.
- Local : Google Chrome 126.0.6478.114. CI (run 45472502146, job « Browser QA ») : Chromium 141.0.7390.37 sur Ubuntu 24.04.
- Navigateur 1280×1000, `prefers-reduced-motion: reduce` pendant la matrice ; largeur simulée via les boutons du QA Lab.
- Par cellule : mesures en haut **et** en fin de défilement, capture d'écran.

Contrôles automatiques : soldes affichés ; débordement horizontal (tout élément hors du cadre ± 1 px, et `scrollWidth` du conteneur) ; texte coupé (feuilles dont le contenu dépasse avec `overflow` non visible ou ellipse) ; **espace vertical excédentaire** (boîte en colonne dont le vide sous le contenu dépasse de > 12 px le vide au-dessus) ; barre inférieure collée au bas du cadre et immobile au défilement ; onglets 2×2 à mi-largeur en grande police, 4 en ligne sinon ; logo `duo-mark-blue` rendu ; avis vide/négatif/hors ligne présents.

## 2. Investigation des espaces verticaux — cause trouvée

Avant correctif (`376c719` + T02) : **24 cellules sur 40 en échec**, toutes sur la même cause : cartes « Votre duo » de 532 à 663 px de haut pour ~135 px de contenu (**389 à 528 px de vide**).
Cause : `styles.metric` (`flexBasis:'46%'`, prévu pour les grilles en ligne) appliqué aux cartes membres placées directement dans la colonne racine ; react-native-web résout ce pourcentage contre la hauteur du conteneur. Yoga (natif) traite un pourcentage d'une hauteur parente indéfinie comme `auto`, ce qui explique que la recette iPhone ne l'ait pas montré.
Correctif `5746c73` : `style={[styles.metric,styles.full]}` (style existant). Après : **0/40**. Garde-fou statique ajouté (`preview.test.cjs`).
→ **Recheck natif rapide des cartes « Votre duo » demandé** avant clôture.

## 3. Matrice — résultat après correctif (40/40 conformes)

Colonnes : débordements horizontaux (haut + bas), textes coupés, boîtes à vide excédentaire, barre fixe, logo, largeurs d'onglets (px).

| Scénario | Largeur | Disposition | Réel | Prévisionnel | Débord. | Coupés | Vide exc. | Barre fixe | Logo | Onglets |
|---|---:|---|---:|---:|---:|---:|---:|---|---|---|
| normal | 360 | normale | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 88/88/88/88 |
| normal | 360 | grande | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 176/176/176/176 |
| normal | 390 | normale | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 96/96/96/96 |
| normal | 390 | grande | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 191/191/191/191 |
| normal | 430 | normale | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 106/106/106/106 |
| normal | 430 | grande | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 211/211/211/211 |
| normal | 760 | normale | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 188/188/188/188 |
| normal | 760 | grande | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | 376/376/376/376 |
| négatif | 360–760 | les deux (8 cellules) | -35,00 € | -35,00 € | 0 | 0 | 0 | oui | oui | idem |
| vide | 360–760 | les deux (8 cellules) | 0,00 € | 0,00 € | 0 | 0 | 0 | oui | oui | idem |
| futur | 360–760 | les deux (8 cellules) | 165,00 € | 125,00 € | 0 | 0 | 0 | oui | oui | idem |
| hors ligne | 360–760 | les deux (8 cellules) | 165,00 € | 165,00 € | 0 | 0 | 0 | oui | oui | idem |

Le détail des 40 lignes est dans l'artefact CI `web-qa-report-and-captures` (`web-qa-report.json`).
Avis attendus présents : « Aucune enveloppe configurée » (vide), « solde réel enregistré est négatif » (négatif), « Hors ligne » (hors ligne).
Grande police : onglets = 50 % de la largeur intérieure de la barre (marges de 4 px).

## 4. Autres contrôles

| Contrôle | Résultat |
|---|---|
| Glance dans le QA Lab à 360/390/430/760 | 0 débordement, 0 texte coupé, logo officiel, libellé « Montants fictifs » |
| Réduction des animations (Glance) | Témoin sans préférence : styles animés **changent** ; avec `reduce` : **aucun changement** |
| Animation du Dashboard | `disableMotion` dans le QA Lab ; en natif, fondu 160 ms seulement si la préférence le permet (lecture du code) |
| Logo officiel nuage + cœur | `assets/duo-mark-blue.png` rendu dans l'en-tête QA Lab et Glance (toutes cellules) |

## 5. Captures de référence (`captures/`)

`qa-lab-normal-{360,390,430,760}.png`, `qa-lab-{negative,empty,future,offline}-390.png`, `qa-lab-normal-360-large.png`, `qa-lab-normal-390-end.png` (cartes « Votre duo » après correctif), `qa-lab-glance-390.png`, `normal-build-noToken-390.png` (Glance pré-auth du build normal). Jeu complet (88 images) dans l'artefact CI.

## 6. Limites

- Pas de Safari/WebKit ni de Firefox dans la matrice automatisée ; Chrome uniquement.
- Le détecteur de « vide excédentaire » cible le motif trouvé (contenu aligné en haut dans une boîte trop haute) ; une revue visuelle humaine des captures reste utile.
- Dynamic Type iOS / police Android : **non qualifiables ici** — à couvrir en recette native.
