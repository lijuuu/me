---
title: goroutines are cheap until you create 2 million of them
slug: goroutines-cheap-until-2-million
date: April 10, 2026
description: the hidden costs of goroutine creation at scale, scheduler overhead, and when to switch to worker pools.
---

go's tagline is "do not communicate by sharing memory; instead, share memory by communicating." goroutines make this practical — they're cheap, lightweight, and you can spin up thousands without breaking a sweat. but "cheap" is not "free."

## the scheduler tax

each goroutine starts with a 2 kB stack (growing as needed). at 2 million goroutines, that's 4 GB of stack space alone — before any actual work. but the real killer isn't memory. it's the scheduler.

go's work-stealing scheduler uses logical processors (GOMAXPROCS). when you have millions of goroutines, the scheduler must:

- park and unpark goroutines on channels or syscalls
- steal work across P's when queues empty
- manage the global run queue when local queues overflow (256 goroutines each)

at ~100k goroutines, you'll notice scheduler latency. at ~1m, throughput degrades. at ~2m, the runtime spends more time scheduling than executing.

**reference**: [go scheduler: msps, ps, and gs](https://www.youtube.com/watch?v=YHRO5WQGh0k) — kavya joshi's classic talk

## memory fragmentation

each goroutine stack grows in pages. when a goroutine's stack shrinks, go returns pages to a pool but doesn't release them to the OS. with millions of goroutines cycling, you get:

- high RSS even when idle
- stack growth triggering copy operations that pause the goroutine
- GC scanning millions of goroutine stacks even if they're blocked

**reference**: [go memory management](https://go.dev/doc/gc-guide) — official GC guide

## when goroutines go wrong

```go
// this will eventually OOM your process
for i := 0; i < 2_000_000; i++ {
    go func() {
        <-ch  // blocks forever
    }()
}
```

the goroutine leaks pattern — creating goroutines that block indefinitely on channels, mutexes, or I/O. they pile up, never cleaned. your process memory climbs, GC pauses stretch, and eventually the OOM killer shows up.

## the fix: worker pools and semaphores

```go
sem := make(chan struct{}, runtime.GOMAXPROCS(0))
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

this limits concurrency to GOMAXPROCS. for CPU-bound work, this is optimal. for I/O-bound work, you can go higher but should still cap it.

**reference**: [how to handle a million websockets in go](https://www.freecodecamp.org/news/million-websockets-and-go/) — sergey kamardin

## alternatives worth knowing

- **errgroup** — cancellation-aware goroutine groups
- **ants** — goroutine pool library, reuses goroutines to avoid creation cost
- **conc** — sourcegraph's structured concurrency library
- **rxgo** — reactive extensions pattern for go

## the rule of thumb

| goroutine count | approach |
|---------------|----------|
| < 100 | just use goroutines |
| 100-10k | goroutines are fine, watch leaks |
| 10k-100k | add semaphores, watch memory |
| 100k-1m | worker pools, rate limit creation |
| > 1m | you probably need a different architecture |

goroutines are cheap. they are not free. at scale, everything costs something.
