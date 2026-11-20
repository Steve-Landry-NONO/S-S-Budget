# Duo Budget V3 — Ledger DEV validation gates

Scope: migrations 001 and 002 in this PR. **Not yet deployed.** Never run these against production.

## Preconditions
- Use only Supabase project `eetnzdvjfzexgvqbtyrj` (Duo Budget V3 — DEV).
- Confirm no pre-existing `duo_v3_*` objects, snapshot database, and apply migrations in order.
- Prepare two disposable auth.users and separate households. Never use actual customer data.
- Migration execution requires project owner review; no direct client grants are included.

## Integration test matrix
| ID | Action | Expected |
| --- | --- | --- |
| L01 | Insert 2 entries +100/-100 in one SQL transaction | COMMIT succeeds |
| L02 | Insert 1 entry only | COMMIT rejected |
| L03 | Insert +100/-99 | COMMIT rejected |
| L04 | Insert transaction without entries | COMMIT rejected |
| L05 | Insert account from household B into posting of household A | FK rejected |
| L06 | Duplicate (household_id,idempotency_key) | UNIQUE rejected |
| L07 | UPDATE or DELETE transaction or entry | Rejected |
| L08 | Reverse transaction with equal-and-opposite entries by account | COMMIT succeeds |
| L09 | Reverse twice | UNIQUE rejected |
| L10 | Reverse transaction from another household or currency | Rejected |
| L11 | Reverse with unequal account allocations | COMMIT rejected |
| L12 | anon/authenticated direct SELECT/INSERT before policies | Denied |
| L13 | Concurrent requests using same idempotency key | Exactly one committed transaction |
| L14 | Two users in distinct households after policies | Cross-household access denied |

## Important limitations
- A successful SQL integrity test is not an RLS test.
- Authenticated RLS policies and controlled posting RPC are still missing; keep default deny.
- The schema does not yet define the cash vs. budget-envelope semantic posting rules.
- Database-wide privileged roles can bypass RLS; validate as `authenticated` and `anon`, not just `postgres`.
- Do not promote the draft PR or merge until L01–L14 are evidenced and reviewed.
