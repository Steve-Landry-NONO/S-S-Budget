# V3 real Auth + concurrency test — DEV setup

**Status:** prepared, NOT executed. Project: `eetnzdvjfzexgvqbtyrj` only.

1. In [Supabase DEV Auth Users](https://supabase.com/dashboard/project/eetnzdvjfzexgvqbtyrj/auth/users), create two distinct **test-only, confirmed email/password** accounts using the Auth admin interface (not direct SQL inserts into `auth.users`). Record their UUIDs privately. Do not use real user accounts.
2. Review `scripts/v3-finance-e2e-fixtures.template.sql`, replace the two placeholder UUIDs and run **only on DEV** via SQL Editor. Confirm the two households and four accounts were created.
3. Create GitHub Actions environment `duo-budget-v3-dev` in repo Settings → Environments; consider required reviewers. Configure environment **variables**:
   - `DUO_V3_SUPABASE_URL` = `https://eetnzdvjfzexgvqbtyrj.supabase.co`
   - `DUO_V3_TEST_HOUSEHOLD` = `11111111-1111-4111-8111-111111111111`
   - `DUO_V3_TEST_FROM_ACCOUNT` = `11111111-aaaa-4111-8111-111111111111`
   - `DUO_V3_TEST_TO_ACCOUNT` = `11111111-bbbb-4111-8111-111111111111`
4. Configure environment **secrets** `DUO_V3_PUBLISHABLE_KEY`, `DUO_V3_TEST_A_EMAIL`, `DUO_V3_TEST_A_PASSWORD`, `DUO_V3_TEST_B_EMAIL`, `DUO_V3_TEST_B_PASSWORD`. Only use a publishable/anon API key, **never** service_role.
5. Manually run workflow **V3 Finance Real Auth E2E (DEV only)** on branch `feat/v3-ledger-schema-dev`. The workflow intentionally has no push/PR trigger and will not run without the configuration.
6. Review output: two genuine password logins; eight concurrent HTTP RPC calls return the same transaction UUID; unauthorized user B and changed idempotency payload are rejected.
7. Note: the script **commits one 1-cent DEV transfer**. The immutable ledger intentionally prevents deleting the transfer; retain the isolated test household or use a reviewed DEV-only reset. Do not delete individual ledger rows.

Do not connect Expo screens until the workflow passes and the privileged RPC receives security review. Do not commit credentials or JWTs.
