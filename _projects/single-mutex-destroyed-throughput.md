---
title: how a single mutex can destroy throughput
slug: single-mutex-destroyed-throughput
date: March 18, 2026
description: identifying and fixing mutex contention that can take throughput from 50k to 500 req/s.

a service handling 50k requests/second can drop to 500. CPU pinned at 100%. p99 latency at 30 seconds. the culprit: one `sync.Mutex`.

## finding the mutex

go's built-in profiler found it in 2 minutes:

```bash
# add to your main.go
import _ "net/http/pprof"
go func() { http.ListenAndServe(":6060", nil) }()
```

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

output:
```
Showing nodes accounting for 28.45s, 94.32% of 30.16s total
      flat  flat%   sum%        cum   cum%
   28.45s 94.32% 94.32%    28.45s 94.32%  sync.(*Mutex).Lock
```

28 seconds spent waiting on a mutex lock. the mutex was in a metrics registry — every request incremented a counter.

**reference**: [go mutex profiling](https://pkg.go.dev/runtime/pprof)

## the offending code

```go
type Metrics struct {
    mu     sync.Mutex
    counts map[string]int64
}

func (m *Metrics) Inc(name string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.counts[name]++
}
```

50k requests per second, each calling `Inc()`. one mutex, 50k contentions. serial execution of 50k goroutines. throughput collapses to 1/lock_hold_time.

## the fix: sharded counters

```go
type Metrics struct {
    shards [64]metricShard
}

type metricShard struct {
    mu     sync.Mutex
    counts map[string]int64
}

func (m *Metrics) Inc(name string) {
    // hash name to shard
    h := fnv.New32a()
    h.Write([]byte(name))
    idx := h.Sum32() % 64
    m.shards[idx].mu.Lock()
    m.shards[idx].counts[name]++
    m.shards[idx].mu.Unlock()
}
```

with 64 shards, contention drops to 1/64. throughput recovers to near-original levels.

## the alternatives

### sync.Map
built for read-heavy workloads. not great for counters (write-heavy).

### atomic operations
```go
var counter int64
atomic.AddInt64(&counter, 1)  // lock-free for counters
```
best for simple counters. doesn't work for maps.

**reference**: [lock-free programming with atomic operations](https://pkg.go.dev/sync/atomic) — go's atomic package for low-contention counters and flags

### channel-based
```go
updates := make(chan metricUpdate, 1000)
// single goroutine processes updates
go func() {
    for u := range updates {
        counts[u.name] += u.delta
    }
}()
```
good for buffered writes. worst-case latency = channel processing time.

**reference**: [go concurrency patterns](https://go.dev/blog/pipelines) — channel-based pipeline patterns for fan-in, fan-out, and bounded parallelism

## how to prevent this

1. **mutex profiling in CI**: run load tests with `-mutexprofile` enabled
2. **benchmark contention**: `go test -bench=. -mutexprofile=mutex.out`
3. **code review rule**: any mutex in the hot path (every request) is a red flag
4. **metrics**: monitor lock wait time in production

**reference**: [diagnosing mutex contention in go](https://www.uber.com/blog/mutex-contention-profiling/)

## the lesson

mutexes are fine. a mutex in the request hot path is not. always shard, buffer, or eliminate contention from the critical path.
