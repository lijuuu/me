---
title: how backpressure prevents distributed systems from imploding
slug: backpressure-prevents-distributed-systems-imploding
date: February 8, 2026
description: backpressure mechanisms across the stack — TCP, HTTP, gRPC, reactive streams, and why every layer needs its own backpressure strategy.
---

backpressure is the distributed systems equivalent of a pressure relief valve. without it, a slow downstream service causes upstream services to queue, buffer, and eventually crash. here is how backpressure works at every layer.

## TCP-level backpressure

TCP has built-in backpressure via the receive window:

```
sender sends data -> receiver's buffer fills -> receiver advertises window=0
sender stops sending -> receiver processes data -> receiver advertises window=4096
sender resumes sending
```

this is automatic. your application doesn't need to implement it. but TCP backpressure only applies to a single connection. it doesn't propagate across services.

**reference**: [TCP flow control](https://en.wikipedia.org/wiki/Transmission_Control_Protocol#Flow_control)

## HTTP-level: 429 and 503

HTTP has explicit backpressure signals:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```
client should wait 30 seconds before retrying. this is server-to-client backpressure.

```http
HTTP/1.1 503 Service Unavailable
```
server is overloaded. client should back off. load balancer should remove this instance.

**reference**: [RFC 6585 - 429 status code](https://datatracker.ietf.org/doc/html/rfc6585)

## gRPC-level: flow control

gRPC uses HTTP/2 flow control:
```go
// server tells client its available window
// client respects window, won't exceed it
// window updates flow asynchronously
```

when the server processes responses faster than the client sends requests, the window opens. when the server is slow, the window stays closed. this prevents the client from overwhelming the server.

## application-level: semaphores and queues

```go
sem := make(chan struct{}, 1000)  // max 1000 concurrent requests
func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        defer func() { <-sem }()
        process(r)
    case <-time.After(100 * time.Millisecond):
        http.Error(w, "too many requests", 429)
    }
}
```

this is application-level backpressure. when the semaphore is full, the handler rejects new requests immediately instead of queueing them indefinitely.

## the unbounded queue trap

```go
// BAD: unbounded channel
jobs := make(chan Job)  // no buffer limit

// WORSE: unbounded slice
var jobs []Job
```

unbounded buffering hides backpressure. the queue grows until memory is exhausted. then the process OOMs. the fix: bounded queues that reject when full.

```go
// GOOD: bounded with reject
jobs := make(chan Job, 10000)
select {
case jobs <- job:
    // queued
default:
    // reject with 429
}
```

## thread pool backpressure

```go
// thread pool with bounded queue
pool := NewWorkerPool(100)         // 100 workers
pool.SetQueueSize(1000)            // max 1000 waiting tasks
// if queue is full, submit() blocks or throws
```

if the queue is full, the caller experiences backpressure: either blocks or gets an error. this prevents unbounded memory growth.

## reactive streams (rx, project reactor)

reactive streams formalize backpressure with a request protocol:

```
subscriber: request(10)  // subscriber can handle 10 items
publisher: onNext(item) x 10
subscriber: request(10)  // ready for more
```

the subscriber controls the flow. the publisher never sends more than requested. this propagates backpressure end-to-end.

**reference**: [reactive streams specification](https://www.reactive-streams.org/)

## the end-to-end principle

backpressure must propagate across service boundaries:

```
user -> API (429 if overloaded) -> worker (bounded queue) -> DB (connection pool)
```

each layer has its own backpressure mechanism. if any layer lacks it, the system buffers unboundedly and crashes.

## the design principle

> "don't accept work you can't process. tell your caller to slow down."

backpressure isn't a performance problem. it's a stability requirement. a system that accepts infinite work is a system that will eventually crash.

## further reading

- [TCP flow control](https://en.wikipedia.org/wiki/Transmission_Control_Protocol#Flow_control)
- [RFC 6585 — 429 Too Many Requests](https://datatracker.ietf.org/doc/html/rfc6585)
- [reactive streams specification](https://www.reactive-streams.org/)
