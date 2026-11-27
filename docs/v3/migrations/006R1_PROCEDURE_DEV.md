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

1. **Essai à blanc — sur base JETABLE créée par l'outil (REV-08, R2-03, R3-04).** L'essai à blanc est **interdit sur DEV et
   sur production** : un `ROLLBACK` n'annule ni les séquences, ni les appels externes, ni les écritures de fichiers serveur
   (cas D29 de la suite adverse). `v3/database/tools/dry_run_migration.py` n'accepte **aucune chaîne de connexion** : il crée
   lui-même une base jetable au nom aléatoire, par socket Unix local, depuis un gabarit, et la détruit ensuite. Rôle
   d'administration superutilisateur exigé (jamais le cas sur Supabase hébergé). Variables libpq neutralisées.
   - Reconstruire une réplique 001→005 depuis les fichiers du dépôt (gabarit `b005`) et vérifier qu'elle est **identique à DEV** :
     `dev_state_check.sql` donne `f421a30206151d95999d5c6eb54196cd` (100 objets), valeur relevée sur DEV le 21/11. Relever DEV en
     **lecture seule** le jour J et comparer.
   - `python3 v3/database/tools/dry_run_migration.py supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql --template b005 --socket-dir <répertoire du socket local> --port <port local>`
   - Ce que l'outil **garantit** : refus, avant exécution, de toute cible non locale ou implicite et de tout contrôle
     transactionnel, méta-commande ou interpolation psql, commande non transactionnelle ou appel non annulable visible ;
     exécution entre `BEGIN` et `ROLLBACK` générés, avec un garde « même transaction ». Ce qu'il **détecte seulement** :
     catalogue, types et domaines, versions et séquences comparés après coup.
   - Suite adverse : `v3/database/qualification/dryrun/test_dry_run_adversarial.py`. Qualification HTTP : `POSTGREST_NUMERIC_PROTOCOL.md`.
2. **Comparaison** : rejouer `deep006r1.py` et `qualify_rollback.py` sur la réplique jetable équivalente à DEV.
3. **Application** en une transaction, par la CLI (`supabase db push`, après `supabase migration list`) ou par l'outil d'application de migration. Un seul fichier : `20261126120000_duo_v3_financial_model_r1.sql`.
4. **Vérifications après application — en LECTURE SEULE sur DEV** (aucune suite de test, même annulée, n'est exécutée sur DEV) :
   - `dev_state_check.sql` : empreinte `74db7168d8099981c5255203d601521f`, 307 objets (valeur de la réplique s1 au fichier `7c7e54b7…`) ;
   - versions : les 5 précédentes + `20261126120000` ;
   - `get_advisors` sans nouvelle alerte de sécurité ;
   - les suites fonctionnelles (lot 2 : 72/72, `qualify006`, `deep006r1`) sont rejouées sur la réplique jetable, jamais sur DEV.
   Dossier complet : `006R1_GO_NOGO.md`.
5. Journal signé : qui, quand, sha256, résultats.

## Critères d'arrêt

Arrêt immédiat, puis procédure de récupération, si l'un de ces cas se produit :
- une erreur à l'essai à blanc, ou un code de sortie de l'outil différent de 0 ;
- une version DEV inattendue ;
- un écart de catalogue ;
- une alerte de sécurité nouvelle ;
- une durée de verrou supérieure à 5 s.
