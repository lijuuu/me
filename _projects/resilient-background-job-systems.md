---
title: the engineering behind resilient background job systems
slug: resilient-background-job-systems
date: February 10, 2026
description: job durability, retry strategies, dead letter queues, idempotency, monitoring, and what production job systems actually need.
---

background jobs handle everything from sending emails to processing video uploads. when they fail silently — as they often do — the business impact is severe. here is what a production-grade job system needs.

## the job lifecycle

```
enqueue -> scheduled -> running -> complete
                     \-> retrying -> dead (DLQ)
                     \-> cancelled
```

every state transition must be durable. if your job queue stores jobs only in memory and the process crashes, jobs are lost.

## durability: in-memory vs persistent

### in-memory (redis default)
jobs live in redis memory. redis restarts -> jobs gone. acceptable for: cache warming, analytics. unacceptable for: payment processing, email delivery.

### persistent (postgres, rabbitmq with durable queues)
jobs survive restarts. the cost is throughput — persistent writes are slower than in-memory operations.

the minimum viable job record:
```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, done, failed
    priority INT DEFAULT 0,
    scheduled_at TIMESTAMPTZ DEFAULT now(),
    max_retries INT DEFAULT 3,
    retry_count INT DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

## the retry strategy

```
attempt 1: immediate
attempt 2: 1s delay
attempt 3: 4s delay
attempt 4: 16s delay
attempt 5: 1m delay
attempt 6+: dead letter queue
```

each job has a `max_retries`. when exceeded, job goes to the dead letter queue (DLQ). the DLQ is not a graveyard — it's an inbox for human investigation.

**reference**: [designing job queues](https://brandur.org/job-drain)

## idempotency: the most important property

network blips, worker crashes, and retries mean jobs execute multiple times. every job handler must be idempotent:

```go
func SendWelcomeEmail(ctx context.Context, job Job) error {
    // check if already sent
    sent, _ := db.GetEmailStatus(job.Payload.UserID, "welcome")
    if sent { return nil }
    
    // send
    err := email.Send(job.Payload.Email, template)
    if err != nil { return err }
    
    // mark as sent
    return db.MarkEmailSent(job.Payload.UserID, "welcome")
}

**reference**: [the outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) — ensure atomicity between database writes and job enqueueing without dual-write problems

## the at-least-once guarantee

most job systems guarantee at-least-once delivery. after a worker picks up a job, it must:
1. start processing
2. if successful: mark job as done
3. if failed: increment retry count, schedule retry
4. if the worker crashes before marking done: job is retried by another worker

the time between "pick up job" and "mark done" is the vulnerability window. keep it as small as possible.

## monitoring what matters

- **queue depth**: rising queue = workers can't keep up
- **job latency**: time from enqueue to completion (p50, p95, p99)
- **retry rate**: high retry rate = downstream failures
- **DLQ size**: should be 0 in healthy system
- **stale jobs**: jobs stuck in `running` for too long (worker crashed)
- **throughput**: jobs processed per minute

**reference**: [distributed job scheduling patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/index-patterns#messaging) — patterns for scheduling, routing, and coordinating background work at scale

## the scheduler problem

naive approach: every worker polls the queue every N seconds. at scale, this wastes resources. better:

```sql
-- postgres: LISTEN/NOTIFY
LISTEN job_inserted;

-- when a job is inserted:
NOTIFY job_inserted;
```

workers receive notifications and wake up immediately. zero polling overhead.

**reference**: [listen/notify in postgres](https://www.postgresql.org/docs/current/sql-notify.html)

**reference**: [temporal workflow engine](https://docs.temporal.io/) — durable execution for long-running background jobs with built-in retries, timers, and state tracking

## prioritization and fairness

without priorities, a flood of low-priority jobs blocks critical ones. implement:

- **priority queues**: separate queues for critical/normal/low
- **fair scheduling**: don't starve low-priority jobs entirely
- **rate limiting**: no single job type can consume >50% of workers

## the architecture that works

```
[API] -> [Job Table (Postgres)] -> [Worker Pool] -> [External Service]
                                        |
                                   [Dead Letter Queue]
                                        |
                                   [Alerting + Human Review]
```

postgres for durability, worker pool for throughput, DLQ for failures. simple, reliable, observable.
