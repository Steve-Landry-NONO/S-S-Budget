# Duo Budget V3 — Expo finance service (not wired to UI)

File: `v3/services/financeService.js`.

Inject an already authenticated Supabase client created by the application's auth layer. No service-role key, secret, or project URL is stored in this module.

```js
const { createFinanceService } = require('./v3/services/financeService');
const finance = createFinanceService(authenticatedSupabaseClient);
const transactionId = await finance.transfer({
  householdId, fromAccountId, toAccountId,
  amountMinor: '1250', currency: 'EUR',
  idempotencyKey: stableOperationUuid,
});
```

- `amountMinor` is a decimal **string of integer minor units** (EUR 12.50 = `'1250'`; XAF 1250 = `'1250'`).
- Persist one stable idempotency key for each user-confirmed operation. Do not regenerate it on network retry.
- Never blindly retry a failed write; fetch operation status using its stable key after a network ambiguity.
- Server membership checks, RLS and balancing remain authoritative; client validation is convenience only.
- `listTransactions` and `listEntries` use RLS-scoped reads.
- This service is not imported by any app screen. Do not connect it to the UI until real Supabase Auth sessions, concurrency and security review pass.
- Database tests executed in DEV: valid original, cross-household reversal rejected, non-exact reversal rejected. The test fixture used transaction rollback.
- **Unverified**: real two-session concurrent idempotency race, end-to-end signed Supabase JWT, mobile network resilience, performance under load.
- Supabase security advisor warns about the intentionally exposed `SECURITY DEFINER` transfer RPC; audit required before beta.
