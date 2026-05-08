---
title: designing worker systems with postgres SKIP LOCKED
slug: postgres-skip-locked-worker-systems
date: April 5, 2026
description: using postgres as a job queue with SKIP LOCKED, and why it beats redis for many workloads.
---

for years, the default answer to "a job queue is needed" was redis. bull, sidekiq, rq — all redis-backed. but `SELECT ... FOR UPDATE SKIP LOCKED` changed the equation. postgres can be your queue, and for many workloads, it's the better choice.

## how SKIP LOCKED works

```sql
BEGIN;
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;
-- process job
UPDATE jobs SET status = 'done' WHERE id = $1;
COMMIT;
```

`SKIP LOCKED` means: return one unlocked row, skip any rows currently locked by other transactions. this turns postgres into a concurrent, non-blocking job queue.

## why this beats redis for many workloads

### transactional consistency
jobs and application data live in the same database. enqueue a job and update a record in one transaction — no dual-write problem:

```sql
BEGIN;
INSERT INTO jobs (payload) VALUES ('send-welcome-email');
UPDATE users SET onboarding_step = 2 WHERE id = $1;
COMMIT;
```

with redis + postgres, you either accept eventual consistency (job enqueued, DB write not yet done) or build a complex outbox pattern.

### durability
redis can lose data on crash if not configured for AOF + fsync every write. postgres writes to WAL first, always. your jobs survive crashes.

### observability
`SELECT count(*) FROM jobs WHERE status = 'pending'` gives you queue depth. redis requires scanning keys or maintaining separate counters.

**reference**: [postgres FOR UPDATE SKIP LOCKED docs](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

**reference**: [advisory locks in postgres](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) — application-level locks for coordinating workers without row-level contention

## the worker pattern

```go
for {
    tx, _ := db.Begin()
    row := tx.QueryRow(`
        SELECT id, payload FROM jobs
        WHERE status = 'pending' AND scheduled_at <= now()
        ORDER BY priority DESC, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    `)
    var job Job
    row.Scan(&job.ID, &job.Payload)
    process(job)
    tx.Exec("UPDATE jobs SET status='done' WHERE id=$1", job.ID)
    tx.Commit()
}
```

key design decisions:
- `scheduled_at` for delayed jobs
- `priority` for ordering
- `LIMIT 1` per worker (prevents one worker from grabbing everything)

## the downsides

- **polling overhead**: workers poll even when idle (mitigate with `pg_notify` / listen/notify)
- **vacuum pressure**: lots of UPDATEs create dead tuples (mitigate with aggressive autovacuum)
- **lock contention**: one table for all jobs means all workers hit the same index (mitigate with partitioning)
- **not suitable for high-frequency jobs** (>10k/sec): use dedicated queue (redis, nats, kafka)

**reference**: [pg_notify and LISTEN/NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) — replace polling with push notifications to wake workers when new jobs arrive

**reference**: [how we built a job queue with postgres](https://brandur.org/postgres-queues) — brandur's excellent deep dive

## when to use postgres vs redis vs kafka

| criterion | postgres | redis | kafka |
|-----------|----------|-------|-------|
| job durability | excellent | good (with AOF) | excellent |
| throughput | ~5k jobs/sec | ~50k jobs/sec | ~1m+ msg/sec |
| transactional | yes | no | no |
| operational complexity | none | low | high |
| delayed jobs | built-in | need sorted sets | need consumer lag |
| at-least-once | yes | yes | yes |
| exactly-once | with idempotency | with idempotency | with idempotency |

## the right mental model

use postgres as a queue when you value correctness and simplicity over raw throughput. use redis when throughput matters more than durability. use kafka when you need replay, fan-out, or event sourcing.

and always remember: there is no exactly-once delivery. there is idempotent processing.

**reference**: [job queue patterns](https://brandur.org/job-drain) — designing durable job queues with idempotency, retries, and graceful draining
