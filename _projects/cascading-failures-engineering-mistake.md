---
title: the engineering mistake that causes cascading failures
slug: cascading-failures-engineering-mistake
date: March 2, 2026
description: how retries, timeouts, shared resources, and lack of backpressure combine to create catastrophic system-wide failures.
---

cascading failures follow a predictable pattern: one service degrades, its callers retry, the retries overload dependencies, those dependencies degrade, and the failure ripples outward. this is not bad luck — it's bad engineering. the key insight is that every mechanism you add to improve reliability (retries, caching, load balancing) becomes a multiplier of failure when the system is under stress.

## pattern 1: retry amplification

service A calls B. B is slow. A retries 3x. B now has 4x the load while already struggling. B gets slower. A's retries time out. A retries more. B dies.

meanwhile, service C calls A. A is busy retrying B, so A responds slowly to C. C times out. C retries. A is now drowning in retries from C while retrying B. everything dies.

this is the core dynamic: retries never help an overloaded system. they only add more load. think of it like a highway — if traffic is already jammed, sending more cars doesn't clear the jam, it makes it worse. the system needs less work, not more.

**the fix**: retry budgets. each incoming request gets N total retries for all downstream calls combined. once exhausted, fail fast. a common budget is 3 retries per request across the entire call chain. the cost of failing fast (one user gets an error) is far cheaper than the cost of retrying (every user gets an error).

## pattern 2: synchronized retry storms

all instances of service A retry at the same interval (1 second). the retries align like a metronome. service B sees waves of traffic: dead quiet, then a tsunami of retries, repeat.

this happens because most retry libraries use a fixed base interval — 100ms, 1s, 5s. when all pods restart together (deploy, crash loop, HPA scale-up), their retry timers synchronize. every second, the entire fleet fires retries at the exact same moment. the result is traffic spikes that no autoscaler can react to fast enough because autoscalers measure averages over minutes.

**the fix**: jitter. add random delay to every retry. full jitter (random between 0 and backoff) performs best under contention. the paper "aws exponential backoff and jitter" shows that full jitter reduces contention by orders of magnitude compared to equal jitter or decorrelated jitter. add jitter everywhere — not just retries, but also health check intervals, cache refresh TTLs, and cron job schedules.

## pattern 3: the timeout mismatch

```
A timeout: 5 seconds
B timeout: 30 seconds
A calls B, waits 5s, times out
B keeps processing for 25 more seconds
```

A has moved on. B is processing work nobody cares about. B's resources are wasted. at scale, this causes phantom load.

this is particularly dangerous with gRPC and HTTP/2 where a single connection multiplexes many streams. if A disconnects but B's server keeps processing, those goroutines and DB transactions stack up indefinitely. the gap between the caller's timeout and the server's understanding of that timeout is the core of the problem.

**the fix**: deadline propagation. when A sets a 5-second deadline, B should receive that deadline and propagate it to its dependencies. go's `context.Context` was designed exactly for this — `context.WithTimeout` on the client, `ctx` passed through to the handler, and every downstream call uses the same `ctx`. when the deadline fires, everything in the chain stops. but this requires discipline: every function in the call path must respect `ctx.Done()`.

## pattern 4: shared resource exhaustion

10 services share a connection pool to postgres. one service has a slow query. it holds all connections. the other 9 services get `connection pool exhausted`.

this kills you because it violates a core principle: the failure domain should be the same as the resource domain. when 10 services share one pool, a failure in any of them can starve all of them. the blast radius is 10x what it should be. in practice, this often happens when teams share a database instance to reduce costs — one shared RDS, one shared pgBouncer, one shared connection pool.

**the fix**: per-service connection limits + circuit breakers. no service gets more than N connections. if a service's queries are slow, the circuit breaker opens and it gets zero connections.

**reference**: [netflix hystrix - defending your app](https://github.com/Netflix/Hystrix/wiki)

**reference**: [resilience patterns from azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/category/resiliency) — catalog of resilience patterns including retry, circuit breaker, and bulkhead

## pattern 5: cache stampede

when a cache server restarts, all backends suddenly miss cache and hit the database. the DB can't handle the load. the cache restart causes a full outage.

the physics of this is brutal. a cache cluster handling 100K QPS with a 1% miss rate means 1K QPS hitting the database. when the cache restarts, the miss rate goes to 100% and 100K QPS hits the database instantly — a 100x increase. no database can absorb that. even if the cache comes back in 30 seconds, the database has already accumulated a 30-second backlog of queries and may never recover without intervention.

**the fix**: cache warming before adding instances, consistent hashing to reduce key movement, circuit breakers on database calls. for redis specifically: don't restart all nodes at once. use `CLUSTER REPLICATE` to add replicas, warm them, then promote. and always set a max TTL for cached items so cold start isn't infinite.

## pattern 6: the unhealthy health check

health endpoint returns 200 but the app can't serve traffic (DB is down, queue is full, CPU is pinned). the load balancer keeps sending traffic to a dead instance.

this is called the "walking dead" problem. the process is alive, the health endpoint responds, but the application is unable to do useful work. it's worse than the instance being completely dead — at least a dead instance gets no traffic. a walking-dead instance accepts traffic and fails every single request, amplifying the failure rate.

**the fix**: health checks that verify critical dependencies. if postgres is unreachable, return 503. if the request queue is 95% full, return 503. but be careful: if EVERY instance sees postgres as down and ALL return 503, you have a death spiral where the load balancer removes every instance. dependency health checks need a threshold — "postgres is unreachable from this instance" is different from "postgres is unreachable from all instances."

**reference**: [failure injection testing](https://principlesofchaos.org/) — chaos engineering principles for injecting failures to validate system resilience

## the defense in depth approach

| layer | mechanism |
|-------|-----------|
| network | connection limits, SYN cookies |
| application | circuit breakers, bulkheads |
| service | retry budgets, deadline propagation |
| infrastructure | rate limiting, load shedding |

no single mechanism prevents cascading failures. you need all of them. the principle is: **isolate failure, don't propagate it.** every boundary between two systems — process, machine, rack, region — is a place where you can stop failure from spreading. the more boundaries you instrument with isolation mechanisms, the smaller the blast radius of any single failure.

**reference**: [bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead) — partition resources so failure in one pool doesn't take down the whole system

**reference**: [google SRE - addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)

## further reading

- [google SRE book — addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)
- [azure resilience patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/category/resiliency)
- [netflix hystrix](https://github.com/Netflix/Hystrix/wiki)
- [principles of chaos engineering](https://principlesofchaos.org/)
