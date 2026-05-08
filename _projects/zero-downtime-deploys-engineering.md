---
title: the hidden engineering behind zero downtime deploys
slug: zero-downtime-deploys-engineering
date: March 28, 2026
description: blue/green, rolling, canary deploys, traffic draining, DB migrations, and the 9 things that silently break zero-downtime.
---

"zero downtime deploy" is a phrase engineers throw around. but true zero-downtime requires solving problems across networking, databases, and application state. here is what actually breaks.

## 1. the load balancer lag

when a new instance comes up, it takes time for the load balancer to register it and for health checks to pass. AWS ALB takes 5-15 seconds. during a rolling deploy, old instances may be terminated before new ones are fully registered.

the fix: health check grace period + registration delay + slow draining of old instances.

## 2. database migrations are the real enemy

you can deploy code instantly. you can't migrate a 500 GB table instantly. the pattern:

1. **expand phase**: add new columns (nullable), add new tables. deploy code that writes to both old and new schema.
2. **migrate phase**: backfill data, add constraints.
3. **contract phase**: deploy code that reads only from new schema. drop old columns.

**reference**: [expand and contract pattern](https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern) — database refactoring without downtime

## 3. connection pool exhaustion

during a rolling restart, half your instances shut down simultaneously. connection pools on the other half see a spike. if the pool max is 100 and 3 of 6 instances restart, the remaining 3 now handle 200% load. pools saturate, requests queue, timeouts cascade.

the fix: over-provision pool capacity during deploys, use exponential backoff on connection wait, or just do blue/green.

## 4. in-flight request draining

a server getting SIGTERM must:
```
1. health check returns 503 (stop new traffic)
2. wait for in-flight requests to complete (with timeout)
3. close keep-alive connections
4. exit
```

if you skip step 1, new requests hit a dying server. if you skip step 2, users get 502. if you skip step 3, you get connection resets.

**reference**: [graceful shutdown in go](https://eli.thegreenplace.net/2020/graceful-shutdown-of-a-tcp-server-in-go/)

## 5. the cache stampede

new instances have cold caches. they hammer the DB. if 50% of your fleet restarts at once, DB load 2x spikes. solutions:
- pre-warm caches before registering instances
- use consistent hashing so fewer keys move
- ratchet: new instance copies cache from existing one

## 6. DNS and service discovery

kubernetes DNS has a 30-second TTL (CoreDNS default). after a pod IP changes, clients may cache the old IP for up to 30s. during a rolling deploy, this causes connection refused errors.

fix: connection retry with backoff at the application level. never assume DNS is instantly consistent.

**reference**: [k8s DNS tuning](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/)

## 7. session affinity breaks

if your app stores session state in memory (don't), a rolling deploy destroys all sessions. use external session stores (redis, DB), or better: make your app stateless and use signed JWTs.

## 8. the feature flag race

if you deploy code behind a feature flag, and the flag isn't on yet, new and old code may handle the same request differently. this causes subtle consistency bugs. always enable flags on old code first, deploy new code, then switch traffic.

## 9. cross-service API versioning

if service A deploys a new API version while service B still calls the old version, you need backward compatibility. the rule: **never remove a field, never change a type, never reorder required parameters**. add, don't change. deprecate, don't remove.

## the deployment matrix

| strategy | downtime | complexity | rollback | DB changes |
|----------|----------|------------|----------|------------|
| rolling | near-zero | low | redeploy old | careful |
| blue/green | zero | medium | swap back | careful |
| canary | zero | high | stop traffic | very careful |
| recreate | yes | none | redeploy | any |

**reference**: [kubernetes deployment strategies](https://github.com/ContainerSolutions/k8s-deployment-strategies)
