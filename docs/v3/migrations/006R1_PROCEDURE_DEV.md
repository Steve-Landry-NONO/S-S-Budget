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

1. **Essai à blanc — sur base JETABLE uniquement (REV-08, R2-03).** L'essai à blanc est **interdit sur DEV et sur
   production** : un `ROLLBACK` n'annule ni les séquences, ni les appels externes, ni les écritures de fichiers serveur
   (cas D29 de la suite adverse). L'outil `v3/database/tools/dry_run_migration.py` refuse, **avant toute connexion**, tout hôte
   autre qu'un socket Unix ou la boucle locale, et toute base sans le marqueur `duo-v3-disposable`.
   - Reconstruire une réplique jetable 001→005 depuis les fichiers du dépôt et vérifier qu'elle est **identique à DEV** :
     `dev_state_check.sql` donne sur la réplique l'empreinte `f421a30206151d95999d5c6eb54196cd` (100 objets), celle relevée sur
     DEV le 21/11. Relever DEV en **lecture seule** le jour J et comparer.
   - `comment on database <réplique> is 'duo-v3-disposable';` puis
     `python3 v3/database/tools/dry_run_migration.py "host=/chemin/socket dbname=<réplique>" supabase/migrations/20261126120000_duo_v3_financial_model_r1.sql`.
   - Ce que l'outil **garantit** : refus avant exécution de tout contrôle transactionnel, méta-commande ou interpolation psql,
     commande non transactionnelle ou appel non annulable visible ; exécution entre `BEGIN` et `ROLLBACK` générés, avec un garde
     qui vérifie que l'on est toujours dans la même transaction. Ce qu'il **détecte seulement** (sans le garantir) : catalogue,
     versions et séquences comparés après coup.
   - Relever la durée, les erreurs et les verrous. Suite adverse : `v3/database/qualification/dryrun/test_dry_run_adversarial.py`.
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
