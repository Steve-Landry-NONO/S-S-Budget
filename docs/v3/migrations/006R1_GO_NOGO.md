# Dossier GO / NO GO — migration 006r1 seule (DEV)

> **Décision courante : NO GO.** Deux raisons :
> - la version autorisable n'existe pas encore sur GitHub, car le candidat r3 n'est pas publié ;
> - la qualification PostgREST (protocole `04`) n'a pas été exécutée.
>
> Ce dossier décrit les conditions du GO ; il ne l'accorde pas. Le GO est une décision écrite du propriétaire, distincte, qui vise **une empreinte exacte**.
>
> Périmètre : **006r1 uniquement** (`20261126120000_duo_v3_financial_model_r1.sql`). Lot 3 et M2 sont hors périmètre et restent NO GO DEV.

## 1. Fichier visé

| Version | sha256 | Statut |
|---|---|---|
| r2, publiée dans #23 (`691db7f`) | `7c7e54b7b7168e446309b03429e92d582c8f32931bf2e87d13b432af8b16d6ac` | **Ne pas appliquer** : défaut NUM-01 (montant `100.0` accepté, instantané rendu illisible, grand livre immuable). |
| r3, candidat local (`cand/006r1-r3` `584e8b1`) | `836354d51c72168a91fb76311388ab12b81f8450cd317d102195e0c2a5b90b67` | Version proposée, après revue et publication coordonnée. |
| Rollback | `1ccb0d5065f50ae3ba8e145c10d44502ed298ee87c8e3983c6d409c5494569aa` | Inchangé. |
| 006 originale archivée | `cd16cf26…` | NO GO définitif. |

## 2. Préconditions (toutes requises ; chacune est cochée avec sa preuve)

| # | Précondition | Preuve attendue |
|---|---|---|
| G1 | Revue indépendante du diff r2 → r3 approuvée : NUM-01 (une ligne), outil d'essai à blanc, documents. | Commentaire de revue dans la PR. |
| G2 | r3 publiée sur #23 en avance rapide (sans force-push), CI verte. | SHA de tête de #23 = SHA autorisé. |
| G3 | sha256 du fichier dans le clone d'application = `836354d5…`. | Sortie `sha256sum`. |
| G4 | DEV relevé **en lecture seule** le jour J : 5 versions exactement (`20261120092413`, `…092416`, `…092419`, `20261120102820`, `20261121050030`) ; 0 ligne métier ; aucun objet 006 ; `dev_state_check.sql` → `f421a30206151d95999d5c6eb54196cd`, 100 objets. Cette valeur est **égale** à celle de la réplique b005 locale, vérifié le 27/11. | Sortie brute du relevé. |
| G5 | Essai à blanc sur **réplique jetable** b005, identique à DEV par G4. Code 0 de `dry_run_migration.py`. Jamais sur DEV (R2-03). | Rapport JSON de l'outil. |
| G6 | Suites rejouées depuis le SHA autorisé, sur réplique : lot 2 72/72 ; `qualify006` 94/4/1/2 (exceptions C01 et C07a documentées) ; `deep006r1` 38/38 ; rollback vrai ; `rev_corrections` 16/16 ; suite adverse 34/34. | Journal du rejeu (02). |
| G7 | Protocole PostgREST (04) exécuté sur réplique avec PostgREST de la version DEV, N01 à N18 conformes. **Non fait à ce jour.** | Journal HTTP brut. |
| G8 | Sauvegarde : point de restauration Supabase (heure notée) **et** export logique du schéma 001→005 (DEV est vide). Restauration exercée sur une copie (A-08). | Horodatage et empreinte de l'export. |
| G9 | Fenêtre : aucune autre migration, aucun déploiement, aucun workflow DEV, aucun client raccordé. Harnais E2E neutralisé (G13). | Liste de contrôle signée. |
| G10 | Autorisation écrite du propriétaire, avec l'empreinte `836354d5…`, la fenêtre et l'opérateur. | Message ou commentaire daté. |

## 3. Déroulé (le jour J)

1. Relevé G4, en lecture seule. **Arrêt** au moindre écart.
2. Sauvegarde G8 et heure notée.
3. `supabase migration list`, puis application du **seul** fichier autorisé, en une transaction, avec l'outil d'application de migration. Aucune exécution manuelle découpée.
4. Contrôles d'après, en **lecture seule** (§ 4).
5. Journal : qui, quand, sha256, durée, sorties brutes.

## 4. Contrôles d'après application (lecture seule sur DEV)

| Contrôle | Attendu |
|---|---|
| Versions | Les 5 précédentes, plus `20261126120000`. |
| `dev_state_check.sql` | `74db7168d8099981c5255203d601521f`, 307 objets (réplique s1, r2 et r3 ; ce relevé ne couvre pas les domaines). |
| Domaine | `select pg_get_constraintdef(c.oid) from pg_constraint c join pg_type t on t.oid = c.contypid where t.typname = 'minor_units'` doit renvoyer `CHECK (((VALUE = trunc(VALUE)) AND (scale(VALUE) = 0) AND (abs(VALUE) <= '99999999999999999999999999999999999999'::numeric)))`. |
| Sécurité | `get_advisors` : aucune nouvelle alerte de sécurité. |
| Privilèges | X18 rejoué en lecture : aucune fonction `duo_v3_private` exécutable par `anon` ou `authenticated`. |
| Fonctionnel | **Aucune suite, même annulée, sur DEV.** Les suites fonctionnelles sont rejouées sur la réplique (G6). |

## 5. Critères d'arrêt (pendant ou après)

- Toute différence au relevé G4.
- Une empreinte de fichier différente.
- Un échec d'application.
- Un verrou supérieur à 5 s.
- Une empreinte d'après différente de `74db7168…`.
- Un domaine différent.
- Une alerte de sécurité nouvelle.
- Toute action non prévue.

## 6. Récupération

| Situation | Conduite |
|---|---|
| Échec pendant l'application | La transaction unique est annulée (exercé : R1-a, R1-c). Relevé G4 pour confirmer l'état initial, puis analyse. Aucune relance sans nouvelle autorisation. |
| Appliquée mais contrôle d'après en échec, DEV toujours vide | Script `down` (`1ccb0d50…`). Il refuse d'agir s'il trouve des données 006. Exercé : rollback vrai. Puis relevé G4. |
| Appliquée et données créées entre-temps | Restauration du point G8 (PITR ou instantané), de préférence vers une nouvelle instance, puis relevé. Jamais de `down` forcé. |

## 7. Décision

| Élément | État au 27/11 |
|---|---|
| G1, G2, G3, G7, G8, G10 | **Non remplies.** |
| G4 | Valeur de référence établie (b005 = DEV du 21/11) ; à relever le jour J. |
| G5, G6 | Remplies **sur r3 local** (02). À rejouer depuis le SHA publié. |
| G9 | Harnais neutralisé dans le candidat ; à confirmer le jour J. |

**Verdict : NO GO.** Le passage à GO exige G1 à G10.
