# PR — Lot 3 : cycle de vie des appartenances (R-A3, R-C1 à R-C5)

**Statut.**
- Migration candidate, PR en brouillon, dépendante de la 006 révisée.
- Fichier : `supabase/migrations/20261126130000_duo_v3_membership_lifecycle.sql`. Il est composé du prototype v2 du 25/11 (sha256 en tête du fichier), des ajouts v3 et des décisions du 26/11.
- Il n'existe **pas de script de rollback** : la récupération passe par une sauvegarde ou une migration corrective vers l'avant (voir « Risques »).

## Contenu

| Sujet | Mécanisme | Tests |
|---|---|---|
| Frontières temporelles (R-A3) | Toutes sous verrou. `left_at` et `joined_at` sont pris avec `clock_timestamp()` après le verrou du duo. La RLS du journal compare `posted_at`. | RD-01, C3-19 |
| Départ et retour (CF-07) | Retour par invitation. Le détail de l'absence est masqué. Les soldes communs sont égaux (POST006-02). | L3-18…21, C3-01…04 |
| Avis aux deux partenaires (R-C1) | `duo_v3_list_membership_notices` renvoie le code `RETURN_VISIBILITY_NOTICE`, avec les faits « soldes visibles » et « opérations non visibles ». | RD-02 |
| Continuité administrative (POST006-06) | Transfert de la propriété au départ du propriétaire. | C3-06, C3-07, C3-20 |
| Archivage (R-C3) | Pas de réouverture. Aucun accès applicatif. Export réservé aux rôles serveur. | C3-08…10, RD-05 |
| Suppression Auth (CF-09, R-C2) | Déclencheur `AFTER DELETE ON auth.users`. `is_member` et `is_current_member` exigent un compte existant. Réconciliation horaire **en option** : `supabase/scheduled/reconcile_orphans_hourly.sql`, hors migrations. | C3-11…13, C3-21, RD-03, RD-04 |
| Orphelins | `reconcile_orphan_memberships()`, idempotente. | C3-12 |
| Autorisations sous verrou | F7 et `depart()` sous le même verrou que les écritures. | C3-19…22 |
| Confidentialité personnelle | Espace `personal` : 1 siège, non partageable. Aucune incidence sur le commun. | C3-14…18 |
| Aucune mutation inter-périmètres (R-C4) | Les clés étrangères de comptes refusent tout croisement. | RD-06 |
| `can_read_at` (R-C5) | Audit : SECURITY DEFINER, STABLE, `search_path` vide, anon exclu, aucun oracle pour un non-membre. **X18 historique conservé**, et nouveau test X18b. | RD-07…09, X18b |

## Résultats (3 exécutions, gabarits s2 = 006r1 + lot 3, s3 = s2 + fonds réels)

| Suite | s2 | s3 |
|---|---|---|
| Décisions R-A3 / R-C (`qualify_lot3_decisions.py`) | 10/10 ×3 | 10/10 ×3 |
| Ajouts v3 (`qualify_lot3_v3.py`) | 20/20 ×3 | 22/22 ×3 (2 tests portent sur les fonds réels) |
| Suite v2 historique, inchangée | 26 réussis · L3-21 « Décision requise » · L3-24 « Constat » | idem |
| Lot 2, variante CF-05 | 71/72 : **X18 en échec, attendu** | 71/72 (idem) |
| Lot 2, fixture d'origine | Installation refusée : la fixture met cam dans 2 duos, ce que CF-05 interdit | — |

**Statuts historiques conservés, avec leur lecture.**
- **L3-21** constate maintenant A = B (470,00 €), conformément à POST006-02.
- **L3-24** attendait un refus de la suppression Auth directe. R-C2 et CF-09 retiennent au contraire une suppression acceptée et réconciliée immédiatement (C3-11).
- **X18** attend aucune fonction privée exécutable hors `is_member` et `is_current_member`. Le lot 3 ajoute volontairement `can_read_at`, nécessaire à la RLS, et l'audite (RD-07…09). X18b vérifie la nouvelle liste fermée.

## Risques

- Pas de rollback scripté.
- La qualification de la vraie Auth Supabase (HTTP, sessions réelles, `auth.admin.deleteUser`) n'a pas été faite : c'est le niveau C, à qualifier séparément, sans compte réel.
- `pg_cron` n'est pas activé par cette PR.
