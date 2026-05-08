---
title: the engineering mistake that causes cascading failures
slug: cascading-failures-engineering-mistake
date: March 2, 2026
description: how retries, timeouts, shared resources, and lack of backpressure combine to create catastrophic system-wide failures.
---

cascading failures follow a predictable pattern: one service degrades, its callers retry, the retries overload dependencies, those dependencies degrade, and the failure ripples outward. this is not bad luck — it's bad engineering.

## pattern 1: retry amplification

service A calls B. B is slow. A retries 3x. B now has 4x the load while already struggling. B gets slower. A's retries time out. A retries more. B dies.

meanwhile, service C calls A. A is busy retrying B, so A responds slowly to C. C times out. C retries. A is now drowning in retries from C while retrying B. everything dies.

**the fix**: retry budgets. each incoming request gets N total retries for all downstream calls combined. once exhausted, fail fast.

## pattern 2: synchronized retry storms

all instances of service A retry at the same interval (1 second). the retries align like a metronome. service B sees waves of traffic: dead quiet, then a tsunami of retries, repeat.

**the fix**: jitter. add random delay to every retry. full jitter (random between 0 and backoff) performs best under contention.

## pattern 3: the timeout mismatch

```
A timeout: 5 seconds
B timeout: 30 seconds
A calls B, waits 5s, times out
B keeps processing for 25 more seconds
```

A has moved on. B is processing work nobody cares about. B's resources are wasted. at scale, this causes phantom load.

**the fix**: deadline propagation. when A sets a 5-second deadline, B should receive that deadline and propagate it to its dependencies.

## pattern 4: shared resource exhaustion

10 services share a connection pool to postgres. one service has a slow query. it holds all connections. the other 9 services get `connection pool exhausted`.

**the fix**: per-service connection limits + circuit breakers. no service gets more than N connections. if a service's queries are slow, the circuit breaker opens and it gets zero connections.

**reference**: [netflix hystrix - defending your app](https://github.com/Netflix/Hystrix/wiki)

**reference**: [resilience patterns from azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/category/resiliency) — catalog of resilience patterns including retry, circuit breaker, and bulkhead

## pattern 5: cache stampede

when a cache server restarts, all backends suddenly miss cache and hit the database. the DB can't handle the load. the cache restart causes a full outage.

**the fix**: cache warming before adding instances, consistent hashing to reduce key movement, circuit breakers on database calls.

## pattern 6: the unhealthy health check

health endpoint returns 200 but the app can't serve traffic (DB is down, queue is full, CPU is pinned). the load balancer keeps sending traffic to a dead instance.

**the fix**: health checks that verify critical dependencies. if postgres is unreachable, return 503. if the request queue is 95% full, return 503.

**reference**: [failure injection testing](https://principlesofchaos.org/) — chaos engineering principles for injecting failures to validate system resilience

## the defense in depth approach

| layer | mechanism |
|-------|-----------|
| network | connection limits, SYN cookies |
| application | circuit breakers, bulkheads |
| service | retry budgets, deadline propagation |
| infrastructure | rate limiting, load shedding |

no single mechanism prevents cascading failures. you need all of them. the principle is: **isolate failure, don't propagate it.**

**reference**: [bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead) — partition resources so failure in one pool doesn't take down the whole system

**reference**: [google SRE - addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)
