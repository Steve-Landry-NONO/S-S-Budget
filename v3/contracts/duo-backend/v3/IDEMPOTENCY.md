# Règles d'idempotence (CF-06)

- Chaque commande porte une clé `clientOperationId` (UUID v4), générée **une seule fois** par intention de l'utilisateur et conservée jusqu'à la réponse.
- La portée de la clé est le couple (duo, auteur authentifié). L'auteur vient du jeton serveur, jamais du client.
- L'adaptateur fictif applique **la même portée** depuis la 3.2 (REV-02) : la même clé employée par l'autre membre est une opération distincte, et `getOperationStatus` ne voit que les clés de l'utilisateur courant.
- **Rejeu identique** : même clé et même charge canonique. Il renvoie le **même identifiant** de transaction, sans nouvelle écriture.
- **Même clé, charge différente** : erreur 23505 (`IDEMPOTENCY_MISMATCH`). C'est un défaut du client, à ne jamais rejouer.
- **Aucun rejeu ne contourne une révocation** : un membre parti reçoit 42501, même avec une clé déjà utilisée (L3-18b).
- Les écritures système (allocations, reports, balayages R-B1, soldes d'ouverture R-B4) ont leurs propres clés. Elles ne peuvent pas entrer en collision avec une clé membre (CLE-01…04).
- **Résultat inconnu** (`UNKNOWN_OUTCOME`, coupure après l'envoi) : rejouer la **même** clé, jamais en créer une nouvelle.
