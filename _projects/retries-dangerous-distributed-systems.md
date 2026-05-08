---
title: why retries are one of the most dangerous things in distributed systems
slug: retries-dangerous-distributed-systems
date: April 8, 2026
description: how naive retry logic causes thundering herds, duplicate writes, and cascading failures in production.
---

every engineer's first instinct when a request fails: retry it. this instinct is wrong. retries without backpressure are the most common cause of cascading failures in distributed systems.

## the thundering herd problem

service A calls service B. service B is slow. A retries 3 times. now B has 4x the load while already struggling. B gets slower. A's retries time out. A retries again. B dies.

this is the retry amplification death spiral. every retry multiplies the load on an already-struggling system. with 3 retries and 10 callers, one slow dependency sees 40x normal traffic.

**reference**: [the tail at scale](https://cacm.acm.org/research/the-tail-at-scale/) — google's jeff dean on why tail latency causes retry storms

## idempotency: the hardest word

the most dangerous retries are on writes. consider:
```
POST /api/charge { amount: 100, user: "alice" }
```

the server processes the charge but the response times out. client retries. now the user is charged twice. the fix is idempotency keys — but implementing them correctly across services is non-trivial:

- keys must survive service restarts (persist to DB)
- keys need TTL (or storage grows forever)
- keys must be unique per-operation (not per-request)
- edge: client sends same key for different payloads

**reference**: [stripe's idempotency design](https://stripe.com/docs/idempotency) — how stripe handles this at payment scale

## retry strategies ranked

### worst: fixed retry with no jitter
```go
for i := 0; i < 3; i++ {
    if err := call(); err == nil { break }
    time.Sleep(1 * time.Second)
}
```
all retries fire at exactly the same interval. all instances align. service gets slammed in waves.

### better: exponential backoff
backoff = min(cap, base * 2^attempt). spreads retries but still creates alignment.

### best: exponential backoff with jitter
```go
sleep := time.Duration(rand.Int63n(int64(backoff)))
```
randomization breaks alignment. the "full jitter" approach (random between 0 and backoff) performs best under contention.

**reference**: [exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — AWS architecture blog

## circuit breakers

retries aren't the only tool. circuit breakers prevent retrying known-dead services:

- **closed**: normal operation, requests flow
- **open**: requests fail fast, no retries needed
- **half-open**: occasional probe to test recovery

**reference**: [hystrix](https://github.com/Netflix/Hystrix/wiki) — netflix's circuit breaker library

## the retry budget

give each request a "retry budget." once exhausted, fail fast. this caps the amplification factor:

```
budget = 3  // total retries across all dependencies
for each dependency call:
    if call fails and budget > 0:
        budget--
        retry
```

## production rules

1. never retry non-idempotent writes without idempotency keys
2. always use exponential backoff + jitter
3. always set a max retry count
4. circuit break > retry when failure is systemic
5. monitor retry amplification ratio (retries/successful requests)
6. never retry on 4xx errors (except 429 with Retry-After)

**reference**: [google SRE book - overload and failure](https://sre.google/sre-book/handling-overload/)
