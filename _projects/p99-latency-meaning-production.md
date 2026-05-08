---
title: what p99 latency actually means in production
slug: p99-latency-meaning-production
date: March 10, 2026
description: why averages lie, how percentiles work, the tail latency problem at scale, and how to design for p99 targets.
---

"average latency is 200ms" means nothing. the slowest 1% of users might be experiencing 10-second delays. here is why p99 matters more than avg.

## the math: why averages lie

```
latencies [ms]: 10, 12, 11, 10, 13, 11, 10, 12, 50000, 11
avg = 5090ms
p50 = 11ms
p99 = 50000ms
```

one outlier drags the average to uselessness. p99 tells you what 99% of users experience. p999 tells you what 99.9% experience. both matter.

## the tail latency amplification problem

at google scale, a request hits hundreds of servers. if each server has p99 = 10ms and p999 = 100ms, the probability that a request hits at least one slow server:

```
P(at least one slow) = 1 - (0.999)^100 = 9.5%
```

9.5% of requests experience tail latency because of ONE slow server in the chain. this is why google uses hedged requests (send to 2 servers, use first response).

**reference**: [the tail at scale](https://cacm.acm.org/research/the-tail-at-scale/) — jeff dean, google

## where tail latency comes from

### GC pauses
go GC stop-the-world pauses: ~100µs typical, up to 10ms worst case. java GC: up to seconds. causes latency spikes at p99.

### context switching
when goroutines outnumber CPUs, the scheduler context-switches. each switch costs ~1µs. at high concurrency, this compounds.

### lock contention
a mutex held for 1ms by one goroutine means all other goroutines wait 1ms. at high throughput, p99 = lock hold time.

### network variance
TCP retransmissions, DNS lookups, TLS handshakes. each adds variable latency.

### noisy neighbors
other processes on the same host steal CPU, cache, or bandwidth.

**reference**: [hdr histogram](https://github.com/HdrHistogram/HdrHistogram) — high dynamic range histogram for recording and analyzing latency distributions without quantization loss

## designing for p99 targets

### SLA vs SLO vs SLI
- **SLI**: actual measurement (e.g., p99 latency = 234ms)
- **SLO**: target (e.g., p99 latency < 300ms)
- **SLA**: promise with consequences (e.g., p99 > 300ms = credits)

**reference**: [google SRE book - service level objectives](https://sre.google/sre-book/service-level-objectives/)

**reference**: [SRE book - the tail at scale](https://cacm.acm.org/research/the-tail-at-scale/) — jeff dean on why tail latency dominates at scale and techniques to mitigate it

### the SLO budget
if your SLO is p99 < 300ms, and you measure p99 = 300ms exactly, you have zero room for error. set SLOs tighter than SLAs to have a budget.

### hedged requests
```go
func hedgedCall(ctx context.Context) (Result, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    ch := make(chan Result, 2)
    for i := 0; i < 2; i++ {
        go func() { ch <- call(ctx) }()
    }
    select {
    case r := <-ch: return r, nil
    case <-time.After(10 * time.Millisecond):
        // wait for second replica
        return <-ch, nil
    }
}
```

sends request to 2 replicas, returns the first response. reduces p99 at the cost of 2x fan-out.

### tamed requests
send to one replica. if it doesn't respond in N milliseconds, send to a second. reduces tail latency with less fan-out cost.

## percentiles in practice

| percentile | what it means | target |
|-----------|--------------|--------|
| p50 | typical experience | fast is nice |
| p95 | most users' worst case | < 500ms |
| p99 | 1 in 100 users | < 2s |
| p999 | 1 in 1000 users | < 10s |
| p9999 | edge cases | investigate |

monitor all of them. optimize from the tail up — fixing p99 usually fixes everything else.

**reference**: [the RED method](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/) — rate, errors, duration: the three golden signals for monitoring service health
