---
title: what happens inside postgres during a deadlock
slug: postgres-deadlock-internals
date: February 22, 2026
description: deadlock detection, lock modes, the wait-for graph, advisory locks, and how postgres resolves conflicts between concurrent transactions.
---

your transactions hang, and 1 second later one gets `ERROR: deadlock detected`. but what actually happens inside postgres during that second? let's trace it.

## the lock hierarchy

postgres has 8 lock levels, from least to most restrictive:

```
AccessShareLock      -- SELECT
RowShareLock         -- SELECT FOR UPDATE/SHARE
RowExclusiveLock     -- INSERT/UPDATE/DELETE
ShareUpdateExclusiveLock -- VACUUM, CREATE INDEX CONCURRENTLY
ShareLock            -- CREATE INDEX (non-concurrent)
ShareRowExclusiveLock -- (rarely used manually)
ExclusiveLock        -- (rarely used manually)  
AccessExclusiveLock  -- ALTER TABLE, DROP TABLE
```

most deadlocks involve RowShareLock or RowExclusiveLock — two transactions each holding locks the other wants.

**reference**: [postgres explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)

## the deadlock detection algorithm

postgres runs deadlock detection every `deadlock_timeout` (default 1 second). the algorithm:

1. build a wait-for graph (transactions = nodes, lock waits = edges)
2. detect cycles in the graph
3. if a cycle exists: abort one transaction to break it

the aborted transaction is the one that's done the least work (fewest WAL bytes written).

```sql
-- transaction A
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- locks row 1
-- ... 
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- waits for row 2

-- transaction B (running concurrently)
BEGIN;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;   -- locks row 2
UPDATE accounts SET balance = balance + 50 WHERE id = 1;   -- waits for row 1
-- deadlock! wait-for graph: A -> B -> A
```

**reference**: [postgres deadlock detection code](https://github.com/postgres/postgres/blob/master/src/backend/storage/lmgr/deadlock.c)

## the wait-for graph

```
A waits on B (A wants row 2, B holds it)
B waits on A (B wants row 1, A holds it)
cycle detected -> abort A (fewer bytes written)
```

postgres aborts transaction A with:
```
ERROR: deadlock detected
DETAIL: Process 12345 waits for ShareLock on transaction 67890; blocked by process 67891.
HINT: See server log for query details.
```

## how to prevent deadlocks

### consistent lock ordering
if every transaction locks rows in the same order (e.g., always lock account with lower ID first), deadlocks are impossible.

```sql
-- always lock in ID order
UPDATE accounts SET ... WHERE id = LEAST($1, $2);
UPDATE accounts SET ... WHERE id = GREATEST($1, $2);
```

### shorter transactions
longer transactions = longer lock holding = more chance of deadlock. commit early, commit often.

### use advisory locks for application-level coordination
```sql
-- acquire an advisory lock before touching a resource
SELECT pg_advisory_xact_lock(42);  -- released at transaction end
```

### reduce lock scope
`SELECT FOR UPDATE` locks rows. `SELECT FOR NO KEY UPDATE` locks only the row, not referenced keys. `SELECT FOR SHARE` allows concurrent reads.

```sql
-- less restrictive: allows concurrent FOR SHARE
SELECT * FROM orders WHERE id = 1 FOR NO KEY UPDATE;

-- more restrictive: blocks FOR SHARE
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
```

## monitoring deadlocks

```sql
-- current locks
SELECT relation::regclass, mode, granted
FROM pg_locks WHERE NOT granted;

-- deadlock count since last stats reset
SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();

-- enable deadlock logging
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET deadlock_timeout = '1s';
```

**reference**: [postgres lock monitoring](https://wiki.postgresql.org/wiki/Lock_Monitoring)

## the deadlock_timeout tradeoff

| deadlock_timeout | pros | cons |
|-----------------|------|------|
| 100ms | fast deadlock resolution | high CPU for detection |
| 1s (default) | balanced | 1s lock wait before detection |
| 10s | low CPU | transactions stuck for 10s |

tune based on your transaction patterns. OLTP with many short transactions: shorter timeout. batch processing: longer is fine.

## further reading

- [postgres explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [postgres deadlock detection code](https://github.com/postgres/postgres/blob/master/src/backend/storage/lmgr/deadlock.c)
- [postgres lock monitoring](https://wiki.postgresql.org/wiki/Lock_Monitoring)
