# S&S Budget — Application mobile de gestion de budget de couple

**S&S Budget** est une application mobile minimaliste et modulable pensée pour aider un couple à gérer ses dépenses communes par caisses budgétaires : week-ends, semaines d'école, vacances, cadeaux, épargne bloquée ou toute autre catégorie personnalisée.

Le projet est né d'un besoin concret : mutualiser certaines dépenses sans mélanger les budgets, garder une vision claire de ce que chaque personne a versé, suivre les dépenses par catégorie et éviter que l'argent prévu pour une caisse soit confondu avec une autre.

---

## Objectif du projet

L'application vise à répondre à une question simple :

> Où en est notre budget commun, catégorie par catégorie, personne par personne, mois par mois ?

Elle permet de suivre :

- les budgets prévus par caisse ;
- les versements de chaque membre ;
- les dépenses communes ;
- le solde global du compte ;
- le solde détaillé par catégorie ;
- l'état de contribution de chaque membre ;
- l'historique mensuel.

---

## Fonctionnalités principales

### Tableau de bord mensuel

- Vue générale du mois actif.
- Budget prévu total.
- Total dépensé.
- Total versé.
- Solde du compte.
- État par membre : prévu, déjà versé, reste à verser, dépenses payées personnellement.

### Gestion des dépenses

- Ajout d'une dépense avec libellé, montant, caisse, membre payeur et date.
- Historique des dépenses du mois.
- Suppression d'une dépense.
- Contrôle de cohérence entre la date saisie et le mois actif.

### Gestion des versements

- Ajout manuel d'un versement par membre et par caisse.
- Versement automatique basé sur les budgets configurés dans les caisses.
- Possibilité de verser plusieurs mois d'avance.
- Possibilité de ne pas alimenter une caisse temporairement.
- Absence de blocage sur les versements supérieurs au budget prévu afin de garder une logique flexible.

### Gestion des caisses

- Création, modification et suppression de caisses.
- Budget mensuel par membre.
- Description de chaque caisse.
- Verrouillage optionnel d'une caisse, utile pour une caisse d'épargne bloquée ou une réserve d'urgence.
- Vision détaillée du budget, des dépenses, du restant et du solde de caisse.

### Gestion des membres

- Membres modifiables.
- Possibilité d'adapter l'application à d'autres couples ou à d'autres usages de budget partagé.

### Historique et mois

- Navigation entre les mois.
- Bouton Nouveau mois.
- Mois de départ configurable.
- Données stockées localement sur le téléphone.

---

## Stack technique

- **Expo SDK 54**
- **React Native**
- **JavaScript**
- **AsyncStorage** pour le stockage local
- **Expo Go** pour les tests rapides sur téléphone

---

## Installation locale

```bash
npm install
npx expo start --tunnel -c
```

Ensuite, ouvrir l'application avec **Expo Go** en scannant le QR code affiché dans le terminal.

En réseau local stable, il est aussi possible d'utiliser :

```bash
npx expo start --lan -c
```

---

## Versions du projet

### v1.0 — Première version fonctionnelle

- Application Expo / React Native initiale.
- Tableau de bord.
- Caisses par défaut.
- Dépenses.
- Versements.
- Calculs de soldes.
- Suivi par personne.

### v1.1 — Application générique et modulable

- Mois de départ configurable.
- Gestion des membres.
- Bouton Nouveau mois.
- Versement automatique.
- Versement manuel conservé.
- Gestion plus complète des caisses.
- Option de verrouillage d'une caisse.

### v1.1.1 — Amélioration visuelle de la navigation

- Barre d'onglets plus lisible.
- Conteneur blanc, bordure et ombre.
- Onglets inactifs plus contrastés.
- Espacement amélioré.

### v1.1.2 — Correction des dates, versements et validation des caisses

- Dates alignées automatiquement avec le mois actif.
- Alerte si une dépense ou un versement est saisi hors du mois actif.
- Versement automatique basé sur les budgets des caisses.
- Champ Nombre de mois à verser.
- Bouton Valider dans la création/modification de caisse.
- Suppression du bouton sombre mal placé en bas des modales.

---

## Roadmap

- Synchronisation cloud entre les deux téléphones.
- Comptes utilisateurs Steve / Sorelle ou membres personnalisés.
- Export Excel.
- Export PDF.
- Notifications de seuil.
- Historique annuel.
- Sauvegarde cloud.
- Authentification.
- Mode multi-couples ou groupes.

---

## Licence

Ce projet est distribué sous licence **MIT**.
