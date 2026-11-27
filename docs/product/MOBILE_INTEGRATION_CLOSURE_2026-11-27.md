# Mobile integration closure — PR #28 — 27 novembre 2026

Parent: 2f1d5f5414177e985438d48117a409b6460da0a1. Gouvernance PR #29 15f613e. Scope V2 SQLite / S1-S2 seulement, aucun cloud R2/R3.

## Manifeste de reprise (mode 100644)
- App.js: 8230e9e84f8684f94f3b23842756fdbd1fbcf080
- src/features/session/sessionBoundary.cjs: 5402649078893128c57a342d037466780562d4d2
- src/features/session/mutationBoundary.cjs: 13882c915df55457da543402db8ebf13be33d690
- scripts/session-boundary.test.cjs: 586a31f4591c61b023af630dfba11f6cdd20a493 (tests complétés et adaptés au cache v2)
Les trois blobs de production sont repris sans réécriture. La preuve de la campagne locale précédente n'est pas récupérable dans la session actuelle : le nouveau SHA doit être qualifié par CI. Les tests de formulaire simulent la décision de callback et vérifient le raccordement source ; ils ne sont pas une exécution React Native.

## Comportement
MOB-Q01 : marqueur durable écrit avant envoi ; succès uniquement avec snapshot de forme attendue, refus HTTP structurés V2 (400/401/403/404/409/413), toute autre erreur ou réponse invalide = inconnu. Pas de fallback financier ni retry automatique. Timeout 20 s n'implique pas refus. Formulaire conservé sur refus/inconnu pendant la session (hors navigation, fermeture ou déconnexion) ; effacement après succès ou acquittement explicite. Marqueur sans montant, libellé, payload ni token, lié à API/compte, survit à la purge de session. Réconciliation : GET /api/state, contrôler journal et opérations, demander au responsable serveur de confirmer fin et résultat si ambigu, puis acquitter manuellement. Aucun exactement-une-fois, lookup transactionnel, ni protection inter-appareils ; un autre compte, une autre URL alias ou effacement des données locales peut contourner le marqueur. Absence d'une opération dans un instantané ne prouve pas refus. Pas de nouvelle tentative tant que doute. Les routes admin export/backup et PIN ne relèvent pas du journal transactionnel financier ; ne pas assimiler à une garantie globale.

MOB-Q02 : génération locale, contrôle expiration avant/après requête, rejet réponses périmées, barrière de lectures pendant mutation. MOB-Q03 : cache version 2 lié API/compte/expiration/sessionId, rejet ancien cache, connexion à refaire après mise à niveau. Jeton stocké séparément en AsyncStorage, pas de garantie coffre sécurisé ni de confidentialité forensique. Masquage JS AppState best effort, pas preuve de protection app switcher native.

MOB-Q04 : TODO R-02 jetons stateless valides jusqu'à expiration après changement PIN et R-03 premier enrôlement accessible au détenteur du secret partagé restent inchangés. Pour V2, réseau privé de confiance uniquement, appareils contrôlés, données fictives, secret non partagé hors personnes habilitées, aucune diffusion externe ; raccourcir TTL en environnement de test si nécessaire, rotation secret en cas de compromission avec invalidation globale et procédure coordonnée. Cible R-02 version serveur de session / révocation ; R-03 enrôlement individuel à usage unique ; décisions et tests serveur dédiés avant diffusion. Ne pas confondre avec Supabase V3.

## Recette physique — à exécuter, aucun résultat revendiqué
Préparer build de la branche exacte sur iOS et Android (Expo SDK 58 compatible, pas de build payant sans autorisation). Serveur V2 jetable, deux comptes fictifs, secret de test unique, pas de DEV Supabase. Enregistrer SHA, appareil, OS, build, échelle réelle, résultat, capture expurgée et logs réseau sans credentials.
| ID | Étapes et résultat attendu |
|---|---|
| N01 | Démarrage froid sans session, cache v1, session expirée, session valide : pas de données avant autorisation ; ancienne session exige reconnexion. |
| N02 | Ouvrir écran financier et modale, passer arrière-plan et app switcher, reprendre : aucune donnée dans aperçu souhaitée ; échec si capture OS visible. |
| N03 | Déconnexion, reconnexion même compte, autre compte, expiration pendant GET et POST retardés : aucune réponse ancienne appliquée, marqueur conservé si écriture incertaine. |
| N04 | Refus 400/403, réponse 500, coupure après écriture serveur, réponse JSON invalide, timeout : solde confirmé conservé, brouillon conservé, blocage inconnu, une seule requête. |
| N05 | Double clic et mutations simultanées : une requête pendant opération ; relancer app avec marqueur, lecture explicite, journal, acquittement seulement après résultat établi ; aucun renvoi automatique. |
| N06 | Navigation quatre onglets, mois précédent/suivant, actions disponibles V2, retour et rotation ; aucune fonctionnalité V3 cloud présentée comme disponible. |
| N07 | Réseau dégradé et reprise, bascule Wi-Fi/mobile, mode avion ; afficher dernier état confirmé, pas de faux succès. |
| N08 | VoiceOver/TalkBack : parcours, ordre de focus, boutons, état inconnu, labels monétaires, lecture des alertes. |
| N09 | Texte 100/135/200 % ou équivalent OS, largeurs disponibles, montants longs, négatifs, nuls ; pas de troncature ni masquage, scrolling. |
| N10 | Régression V2 : dépenses, versements, opérations prévues, historique, permissions ; aucun double débit dans base jetable. |
Pour perte de réponse : proxy de test local qui transmet une seule requête au serveur et supprime la réponse après confirmation de commit ; contrôler directement base jetable/journal et compteur de requêtes. Aucun test de ce type exécuté physiquement à ce stade. CI web/prebuild ne valide pas appareils ni app switcher. NO GO fusion / diffusion avant recette et risques traités.
