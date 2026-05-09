---
title: the garbage collection pause that cost a million dollars
slug: gc-pause-cost-million-dollars
date: May 9, 2026
description: how a 200ms GC pause cascaded through a payment system, why stop-the-world collectors still exist, and the engineering behind low-latency GC.
---

at 14:32 on a wednesday, a payment processing system paused for 200ms. transactions backed up. timeouts fired. retries flooded the system. the 200ms pause cost $1.2M in failed transactions. the root cause: garbage collection. the 200ms pause cost $1.2M in failed transactions. the root cause: garbage collection.

## how a GC pause cascades

most garbage collectors stop the application to clean up memory. these are stop-the-world (STW) pauses. the application cannot process requests during a pause.

```
timeline:
14:32:00.000 — GC pause starts. all request processing stops
14:32:00.200 — GC pause ends. 200ms of queued work floods in
14:32:00.201 — 1500 queued requests begin processing simultaneously
14:32:00.250 — database connection pool exhausted (100 connections, 1500 requests)
14:32:00.300 — requests start timing out (300ms timeout)
14:32:00.350 — retry logic kicks in, doubles the request rate
14:32:00.500 — system enters death spiral
```

a 200ms pause is not the problem. the problem is everything that happens after the pause.

## the GC collectors

### Go: concurrent mark-sweep with STW

go's GC is concurrent — it runs alongside the application. but it still has brief STW phases:

- mark setup: <100 microseconds
- mark termination: <1ms typically, but can spike with large heaps
- sweep: concurrent (no STW)

the go GC triggers when the heap doubles in size (GOGC=100, the default). a 1GB heap triggers GC at 2GB. the mark phase runs while the application continues processing. only mark termination pauses.

```bash
# see GC stats
GODEBUG=gctrace=1 ./myapp
# gc 1 @0.012s 2%: 0.10+0.05+0.002 ms clock, 0.20+0.03/0.08/0.01+0.004 ms cpu
#         │         └─ STW mark termination (0.002ms)
#         └─ assist time (0.05ms)
```

**reference**: [go GC guide](https://go.dev/doc/gc-guide)

### Java: G1GC and ZGC

G1GC (default since Java 9): concurrent marking, incremental compaction. target pause time: 200ms by default. ZGC (since Java 15): concurrent everything, sub-1ms pauses, scales to 16TB heaps.

### .NET: server GC vs workstation GC

server GC: one GC thread per CPU core, higher throughput, longer pauses. workstation GC: concurrent, lower latency, lower throughput.

## what causes long GC pauses

### large heap size

a 32GB heap takes longer to scan than a 2GB heap. the mark phase must traverse every live object. if you have 100M live objects, even a concurrent collector takes measurable time.

### high allocation rate

go's GC triggers at 2× heap size. if you allocate 1GB/s and have a 1GB heap, GC runs every second. the GC CPU overhead becomes visible (5-25% CPU spent on GC).

```go
// this generates garbage at 1GB/s
func process(w http.ResponseWriter, r *http.Request) {
    data := make([]byte, 1_000_000)  // 1MB allocation
    // ... use data ...
}  // 1MB freed — GC must collect it
```

### finalizers and weak references

objects with finalizers (`runtime.SetFinalizer` in go, `finalize()` in java) require extra work during GC. the finalizer must run before the object can be freed. this adds unpredictable latency.

### fragmentation (non-compacting collectors)

go's GC does not compact the heap (as of 1.22). long-running processes can develop fragmentation: free memory is scattered between live objects. the allocator must search for contiguous space. large allocations may fail even when enough total memory is free.

## measuring GC impact

### go

```go
import "runtime"

var mem runtime.MemStats
runtime.ReadMemStats(&mem)
fmt.Printf("GC pauses: %d, total pause: %v\n",
    mem.NumGC, time.Duration(mem.PauseTotalNs))

// prometheus metrics
// go_gc_duration_seconds — GC pause histogram
// go_memstats_heap_alloc_bytes — current heap size
// go_memstats_gc_cpu_fraction — % CPU spent on GC
```

### java

```
-XX:+PrintGCDetails -XX:+PrintGCDateStamps
-Xlog:gc*:file=gc.log:time,level,tags

# or use jstat
jstat -gcutil <pid> 1000
```

## the GOGC knob

```bash
GOGC=50 ./myapp   # GC triggers when heap grows 50% (more frequent, smaller heaps)
GOGC=200 ./myapp  # GC triggers at 2x heap (less frequent, larger heaps, longer pauses)
GOGC=off ./myapp  # never GC (until OOM)
```

lower GOGC means more frequent GC, smaller pauses. higher GOGC means less frequent GC, longer pauses, more memory. the default (100) is a reasonable balance for server workloads.

for latency-sensitive services, try GOGC=50 or GOGC=25. the GC runs more often but each pause is shorter. the total GC time stays roughly the same, but the distribution is smoother.

```bash
# go 1.19+: set soft memory limit
GOMEMLIMIT=2GiB ./myapp
```

this tells go "keep the heap under 2GB." the GC runs more aggressively as the limit approaches. prevents OOM without a hard limit.

**reference**: [go GOMEMLIMIT](https://pkg.go.dev/runtime#hdr-Environment_Variables)

## the real fix: reduce allocations

the best GC pause is no GC pause. reduce allocations:

```go
// bad: allocates on every request
var buf bytes.Buffer
buf.WriteString("hello")
buf.WriteString(" world")
return buf.String()

// good: pre-allocate or use strings.Builder with pool
var buf strings.Builder
buf.Grow(100) // pre-allocate
buf.WriteString("hello")
buf.WriteString(" world")
return buf.String()
```

```go
// bad: slice growth causes allocations
var items []Item
for rows.Next() {
    var item Item
    rows.Scan(&item.ID, &item.Name)
    items = append(items, item) // may grow, causing copy + GC
}

// good: pre-allocate
items := make([]Item, 0, expectedRows)
```

object pooling:

```go
var bufPool = sync.Pool{
    New: func() interface{} { return new(bytes.Buffer) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    // use buf
}
```

## the architecture fix

for payment systems and other latency-critical applications:

1. **allocate in warm-up**: pre-allocate all buffers, connection pools, and caches at startup. the steady-state heap should be stable.
2. **off-peak GC**: if possible, force GC during low-traffic periods. `runtime.GC()` in go, `System.gc()` in java.
3. **circuit breakers**: if GC pauses cause timeouts, circuit breakers stop the retry storm. the system degrades gracefully instead of collapsing.
4. **separate heaps**: run latency-critical and batch workloads in separate processes. batch allocations don't affect latency GC.

## further reading

- [go GC guide](https://go.dev/doc/gc-guide)
- [go memory management](https://go.dev/doc/gc-guide)
- [java ZGC](https://wiki.openjdk.org/display/zgc)
