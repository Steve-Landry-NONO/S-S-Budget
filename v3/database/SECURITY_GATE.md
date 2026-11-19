# V3 — Gate de sécurité avant première migration

Statut : **non exécuté**. Le fichier `schema.review.sql` est un modèle de revue, pas une migration de production. Aucune politique RLS permissive n'est livrée.

## Ordre d'exécution

1. Vérifier la CI de la PR #7 (tests `node --test v3/core/finance.test.js`). Corriger tout échec.
2. Revoir les invariants : devise unique, calendrier mensuel, deux membres maximum, dépenses communes/privées, période clôturée, contributions prévues vs réelles, écritures financières équilibrées.
3. Concevoir des écritures comptables équilibrées pour les dépenses, contributions, reports et transferts de réserve. Ne jamais déduire le solde réel des seuls objectifs.
4. Concevoir le mécanisme d'invitation et d'acceptation transactionnelle avec verrouillage de `duos`, interdiction d'insertion directe des memberships.
5. Concevoir l'API serveur autorisée, les permissions minimales et RLS sans récursion. Tester avec deux duos distincts et trois utilisateurs.
6. Tester les corrections et annulations réversibles, les événements concurrents, les clés d'idempotence, les dépenses privées et les corrections de périodes clôturées.
7. Générer ensuite seulement une migration versionnée avec le CLI Supabase, dans un projet **de développement isolé**, après revue.

## Tests de sécurité obligatoires

| Test | Attendu |
|---|---|
| A lit les opérations de son duo | Seulement les données autorisées |
| A lit les opérations du duo B | Zéro donnée |
| A lit une dépense privée de son partenaire | Refus |
| A référence une enveloppe du duo B | Refus |
| Troisième membre, y compris invitations concurrentes | Refus |
| Non-membre modifie un rôle ou annule une dépense | Refus |
| Deux requêtes avec même clé d'idempotence | Un seul effet |
| Transfert de réserve concurrent | Pas de double débit |
| Correction d'une dépense commune | Historique complet et une seule correction comptable |
| Annulation puis restauration | Effet comptable exactement une fois |
| Dépense future | Aucun débit du réel |
| Déficit reporté | Pas de nouvelle dépense |
| Clôture rejouée | Pas de double report |
| Accès anon ou sans session | Refus |

## Décisions techniques ouvertes

- Modèle de grand livre (écritures équilibrées) et méthode de rectification des périodes clôturées.
- Distinction entre dépenses personnelles, contributions et soldes communs.
- Représentation des allocations budgétaires sans création fictive d'argent.
- Fonctionnement et durée de vie des invitations.
- Politique de rétention des audits et notifications.

**Ne pas déployer ni exposer `duo_v3_private` avant tests d'intégration et audit RLS.**
