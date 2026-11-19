# V3 transactional ledger — implementation slice (review required)

Order in a **disposable, isolated Supabase development project**:

1. `v3/database/schema.review.sql`
2. `v3/database/ledger-rls.review.sql`
3. `v3/database/ledger-writer.review.sql`
4. `v3/database/ledger-rls.integration.sql` (transactional fixture; ends with ROLLBACK)

These are review scripts, **not versioned production migrations**. No database was changed by committing them.

## Guarantees coded

- Shared ledger postings are signed integer minor units and are grouped by a cash book or budget-allocation book.
- Each book balances to zero per entry at commit; entries require at least two postings.
- Ledger rows cannot be updated or deleted. Corrections require separate compensating entries (not yet implemented).
- Composite duo/account foreign keys block cross-duo posting references.
- Unique idempotency keys prevent duplicate writes; the writer currently **rejects** a replay, even if identical.
- A trusted-server-only function locks the duo, checks `auth.uid()` membership, validates account ownership and balanced postings, then inserts the entry and postings in one database transaction.
- Member-scoped, **read-only** RLS for shared duos, periods, envelopes and ledger rows; memberships are self-readable only.
- No direct write grants for mobile users. The private schema must not be exposed through Supabase Data API.

## Not yet safe for production

- **No real PostgreSQL execution of these scripts yet.** Integration SQL has been authored, not run.
- No private-expense ledger. The draft `operations` table remains inaccessible.
- No validated external API, JWT session revocation handling, invitations or 2-member transaction.
- No double-entry classification restrictions by business event; arbitrary balanced postings could be semantically wrong if the privileged writer is misused.
- No reversals, period-close workflows, audit notifications, account balance/available checks, or comprehensive concurrency tests.
- No migration generated with the Supabase CLI, and no security advisor run.
- Do not grant `EXECUTE` on the trusted writer to client roles. Use a reviewed server-side boundary.

## Security tests still required

1. Two authenticated users in duo A see shared ledger A; user C in duo B cannot.
2. Anonymous and nonmember reads return zero rows.
3. Cross-duo foreign key and membership bypass attempts fail.
4. Unbalanced, empty and duplicate entries fail at commit.
5. Writer refuses unauthorized user, inactive duo and foreign account.
6. Parallel duplicate idempotency keys yield one committed entry.
7. Private expenses invisible to partner, including aggregates, notifications and exports.
8. Real-cash and budget books remain distinct; budget allocations never create real cash.

The SQL fixture currently exercises **only a subset** of these cases. Do not treat it as a completed security certification.
