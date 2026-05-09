---
title: the reason your gRPC service slows down under load
slug: grpc-service-slows-down-under-load
date: March 20, 2026
description: HTTP/2 head-of-line blocking, flow control, connection multiplexing issues, and gRPC performance tuning.
---

gRPC promises high performance with HTTP/2 multiplexing and protobuf serialization. but under load, many services degrade faster than expected. here are the real reasons.

## HTTP/2 head-of-line blocking (yes, it still exists)

HTTP/2 fixed HTTP/1.1 head-of-line blocking — multiple requests can share one TCP connection. but it introduced a new kind: TCP-level head-of-line blocking. if one TCP packet is lost, ALL streams on that connection stall until retransmission.

```go
// the fix: use multiple connections
conn1, _ := grpc.Dial(addr, grpc.WithDefaultServiceConfig(`
  {"loadBalancingConfig": [{"round_robin":{}}]}
`))
```

**reference**: [HTTP/2 and the HOL blocking myth](https://en.wikipedia.org/wiki/HTTP/2#Encryption)

## flow control starvation

HTTP/2 has two levels of flow control:
1. **connection-level**: shared across all streams
2. **stream-level**: per individual stream

the default connection flow control window is 65535 bytes. if one stream consumes all of it (large response), other streams on the same connection starve.

```go
// increase flow control window
grpc.WithInitialWindowSize(1 << 20)     // 1 MB stream window
grpc.WithInitialConnWindowSize(1 << 20) // 1 MB connection window
```

**reference**: [gRPC flow control](https://grpc.io/docs/guides/flow-control/)

## connection pooling gone wrong

many gRPC clients maintain a single long-lived connection. this works until:
- the server-side connection limit is hit
- the TCP connection becomes a bottleneck (single connection = single TCP stream)
- load balancers can't distribute individual RPCs

fix: use multiple connections with round_robin:

```go
conn, _ := grpc.Dial(
    "dns:///my-service:8080",
    grpc.WithDefaultServiceConfig(`{"loadBalancingPolicy":"round_robin"}`),
)
```

## the server-side goroutine explosion

each gRPC stream creates at least 2 goroutines (reader + writer). with 10k concurrent streams: 20k goroutines. at 100k streams: 200k goroutines. go scheduler chokes.

```go
// use keepalive to clean dead streams
grpc.KeepaliveParams(keepalive.ServerParameters{
    MaxConnectionIdle: 5 * time.Minute,
    Timeout:           20 * time.Second,
})
```

**reference**: [gRPC keepalive guide](https://grpc.io/docs/guides/keepalive/)

## protobuf: not always faster than JSON

protobuf is faster than JSON at:
- small messages (< 1KB)
- integer-heavy payloads

protobuf is comparable to JSON at:
- large messages (> 1MB) — gzip dominates
- string-heavy payloads — strings aren't compressed by protobuf

always benchmark with your actual payload shapes.

## the deadline domino effect

```go
ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
```

if service A calls service B with a 1-second deadline, and B calls C also with 1 second, C gets 1 second — not 1 second minus A and B's processing time. always propagate remaining deadline:

```go
if deadline, ok := ctx.Deadline(); ok {
    remaining := time.Until(deadline)
    if remaining < 500*time.Millisecond {
        // almost out of time, skip downstream call
    }
}
```

**reference**: [gRPC deadline propagation](https://grpc.io/blog/deadlines/)

## production checklist

- [ ] multiple TCP connections (round_robin) for production
- [ ] flow control windows tuned for your payload sizes
- [ ] keepalive configured on both client and server
- [ ] max concurrent streams configured (server side)
- [ ] deadline propagation across all services
- [ ] connection-level metrics (streams active, flow control window available)

## further reading

- [HTTP/2 and the HOL blocking myth](https://en.wikipedia.org/wiki/HTTP/2#Encryption)
- [gRPC flow control](https://grpc.io/docs/guides/flow-control/)
- [gRPC keepalive guide](https://grpc.io/docs/guides/keepalive/)
