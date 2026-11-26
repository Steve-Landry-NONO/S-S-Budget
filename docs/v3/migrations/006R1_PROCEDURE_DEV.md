# Procédure d'application sur DEV — 006 révisée

**Ne pas exécuter sans une autorisation explicite et distincte du propriétaire.** Cette procédure décrit le geste ; elle ne l'autorise pas.

## Préconditions (toutes obligatoires)

1. Revue indépendante de la PR approuvée. Le contenu du fichier n'a pas changé depuis la revue : son sha256 est noté dans l'autorisation.
2. **État DEV vérifié juste avant**, en lecture seule :
   - `supabase_migrations.schema_migrations` contient exactement les 5 versions de `CF12_INVENTAIRE.md`, avec les mêmes empreintes ;
   - le schéma contient 0 ligne métier ;
   - aucun objet 006 n'est présent.
3. Sauvegarde : point de restauration ou export du schéma et des données (DEV est vide, mais on exporte quand même le schéma).
4. Aucune autre migration en attente.

## Étapes

1. **Essai à blanc réellement annulable (REV-08).** Ne **jamais** exécuter le fichier tel quel dans `begin; … rollback;` : son propre `commit;` validerait la migration. C'est le défaut reproduit par REV08-01.
   - Utiliser `v3/database/tools/dry_run_migration.sh "<conninfo>" supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql`. Le script exige exactement un `begin;` et un `commit;` de premier niveau, extrait le corps, l'exécute dans une transaction terminée par `ROLLBACK`, puis compare le catalogue et l'historique des versions avant et après.
   - **Préférer une réplique jetable**, ou une copie de DEV restaurée. Sur DEV même, uniquement si l'autorisation l'inclut explicitement.
   - Relever la durée, les erreurs et les verrous.
2. **Comparaison** : rejouer `deep006r1.py` et `qualify_rollback.py` sur une copie de DEV, ou sur la réplique avec le catalogue DEV comme gabarit.
3. **Application** en une transaction, par la CLI (`supabase db push`, après `supabase migration list`) ou par l'outil d'application de migration. Un seul fichier : `20261126120000_duo_v3_financial_model_r1.sql`.
4. **Vérifications après application** :
   - relevé de catalogue identique à `results/catalogs/catalog_s1.txt` (hors objets de plateforme) ;
   - `get_advisors` sans nouvelle alerte de sécurité ;
   - suite lot 2 en mode « dev » (transaction annulée) à 72/72.
5. Journal signé : qui, quand, sha256, résultats.

## Critères d'arrêt

Arrêt immédiat, puis procédure de récupération, si l'un de ces cas se produit :
- une erreur à l'essai à blanc ;
- une version DEV inattendue ;
- un écart de catalogue ;
- une alerte de sécurité nouvelle ;
- une durée de verrou supérieure à 5 s.
