# Contrat d'erreurs

`errorFromPostgrest` applique les règles dans l'ordre suivant :

1. l'indice SQL (`hint`) explicite ;
2. le détail (`detail`) ;
3. le SQLSTATE.

Le code n'est jamais déduit d'un montant ni d'un message traduit.
Depuis la 3.2, le **message exposé** est toujours le message public stable du code (`PUBLIC_MESSAGES`) : le message brut du serveur
(tables, contraintes, montants) n'est jamais recopié.

| Indice / détail | SQLSTATE | Code | Action côté interface |
|---|---|---|---|
| `insufficient_real_funds` | 23514 | `INSUFFICIENT_REAL_FUNDS` | Proposer une affectation ou un montant inférieur |
| `release_funds_first` | 23514 | `RELEASE_FUNDS_FIRST` | Ouvrir le parcours `contribution_release_plan` (R-B5) |
| `envelope_protected` | 23514 | `ENVELOPE_PROTECTED` | Expliquer le double accord (R-B6) |
| `second_member_required` | 42501 | `SECOND_MEMBER_REQUIRED` | « Votre partenaire doit accepter » |
| `admin_catch_up_required` | 55000 | `ADMIN_CATCH_UP_REQUIRED` | Message de support (R-A2) ; pas de nouvel essai automatique |
| `choose_active_envelope` | 23503 | `ENVELOPE_ARCHIVED` | Choisir une enveloppe active |
| `HOUSEHOLD_ARCHIVED` | 55000 | `HOUSEHOLD_ARCHIVED` | Duo archivé, lecture impossible (R-C3) |
| `PERSONAL_SPACE` | 23514 | `PERSONAL_SPACE` | Un espace personnel ne se partage pas |
| `DUO_FULL`, `ALREADY_IN_ANOTHER_DUO` | 23514 / 23505 | idem | Message lot 3 |
| — | 42501 | `FORBIDDEN` / `UNAUTHENTICATED` | Retour à l'accueil |
| — | 23505 | `IDEMPOTENCY_MISMATCH` | Bug client : même clé, charge différente |
| — | 22023 | `VALIDATION` | Afficher l'erreur de saisie |
| — | 22P02 | `VALIDATION` | Texte non convertible en nombre (qualification HTTP du 27/11) ; le contrat n'émet que des chaînes canoniques |

| — (adaptateur) | — | `CONTRACT_VIOLATION` | Réponse non conforme : incident, aucun affichage de montant |
| — (adaptateur) | — | `SPACE_NOT_INITIALIZED` | Parcours d'activation de l'espace (lot G-A) |

Seules les erreurs `NETWORK` et `RATE_LIMITED` sont rejouables automatiquement.
