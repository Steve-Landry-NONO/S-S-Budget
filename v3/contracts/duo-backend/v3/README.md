# Contrat DuoBackend — v3 (`3.3.0-candidate`)

**Statut : candidat de référence sur fixtures (R-D1).** Ce contrat n'est relié à aucun backend réel. Aucun écran React Native n'est modifié par ce dossier.

| Fichier | Rôle |
|---|---|
| `duoBackend.contract.ts` | Types, interface `DuoBackend`, erreurs (`DuoError`, `errorFromPostgrest`) |
| `envelopeRead.contract.ts` | Lecture des enveloppes v3 : `Capability<T>`, `realAvailable`, `primaryAmount` |
| `envelopeMapper.ts` | Correspondance avec les instantanés SQL des migrations candidates (`fromSqlFundsSnapshot`, `fromSqlEnvelopeSnapshot`) |
| `mockBackend.ts`, `envelopeFixtures.ts` | Adaptateur fictif, avec les fixtures de recette PR #17 |
| `fixtures/sql_*.json` | Réponses **réelles** des migrations candidates sur base jetable, générées par `gen_sql_fixtures.py` |
| `hardening.test.ts` | Reproduction et correction REV-01 à REV-07, G6, G7, G9, cache, erreurs, devises |
| `fixtures/legacy-published-df41563/` | Réponses des migrations **publiées** (nombres JSON) : preuves de reproduction REV-01 / REV-06 |
| `cache.r2-02.test.ts` | R2-02 : écritures tardives refusées (déconnexion, révocation, reconnexion, changement de compte, appartenance) |
| `*.test.ts` | 64 tests : `npm test` (ou `node --test mockBackend.test.ts envelopeRead.test.ts sqlFixtures.test.ts errors.test.ts hardening.test.ts cache.r2-02.test.ts`) |

Voir aussi `CAPABILITIES.md`, `ERRORS.md`, `IDEMPOTENCY.md` et `COMPATIBILITY.md`.

**Coordination Sprint 3 (ChatGPT).**
- Les écrans consomment `getEnvelopeSnapshot` et `primaryAmount`.
- Ils ne lisent jamais `budgetBalance` comme montant disponible.
- Les fixtures de la PR #17 sont rejouées par l'adaptateur fictif.
- Branchement réel : seulement après revue des mappers et fusion des migrations.
