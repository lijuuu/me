---
title: why most rate limiters fail under burst traffic
slug: rate-limiters-fail-burst-traffic
date: March 5, 2026
description: token bucket vs sliding window vs leaky bucket, the burst problem, distributed rate limiting, and why algorithmic choice matters.
---

rate limiters seem trivial: "N requests per second." but burst traffic — that 10x spike when your marketing email lands — exposes fatal flaws in naive implementations.

## the fixed window disaster

```go
// naive: reset counter every second
func allow() bool {
    now := time.Now().Unix()
    if now != currentWindow {
        counter = 0
        currentWindow = now
    }
    if counter >= limit { return false }
    counter++
    return true
}
```

what happens: at second 0.9, a burst consumes all 100 tokens. at second 1.0, the window resets. a clever attacker sends 100 requests at 0.9 and 100 at 1.0 — 200 requests in 200ms, even with limit=100/sec.

**reference**: [rate limiting algorithms](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)

## the sliding window

```go
// track timestamps in a sorted set
func allow() bool {
    cutoff := time.Now().Add(-time.Second)
    // remove expired entries
    redis.ZRemRangeByScore("ratelimit:user:123", "0", cutoff)
    count := redis.ZCard("ratelimit:user:123")
    if count >= limit { return false }
    redis.ZAdd("ratelimit:user:123", redis.Z{Score: float64(time.Now().UnixNano()), Member: uuid.New()})
    return true
}
```

smoother than fixed window. can't exploit boundary. downside: redis sorted set operations are O(log N). at scale, this costs.

## the token bucket

```go
type TokenBucket struct {
    rate       float64  // tokens per second
    burst      int      // max token capacity
    tokens     float64
    lastRefill time.Time
    mu         sync.Mutex
}

func (tb *TokenBucket) Allow() bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    now := time.Now()
    elapsed := now.Sub(tb.lastRefill).Seconds()
    tb.tokens = math.Min(float64(tb.burst), tb.tokens + elapsed * tb.rate)
    tb.lastRefill = now
    if tb.tokens >= 1 {
        tb.tokens--
        return true
    }
    return false
}
```

token bucket allows bursts up to `burst` tokens, then enforces steady rate. best for: API gateways, where occasional bursts are okay but sustained high rate isn't.

**reference**: [token bucket algorithm](https://en.wikipedia.org/wiki/Token_bucket)

## the leaky bucket

similar to token bucket but with a queue. tokens arrive at a fixed rate, queue has a maximum size. if queue is full, request is rejected. best for: smoothing output to a downstream service.

## distributed rate limiting

when your API runs on 10 servers, each with local rate limiting, a user can send 10x the limit by spreading requests across servers. distributed rate limiting requires:

### centralized counter (redis)
```lua
-- redis Lua script for atomic check-and-increment
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
```
works for moderate scale. redis becomes bottleneck at high request rates.

### local + global coordination
each server tracks locally, syncs with a central store periodically. reduces redis load at the cost of some accuracy.

**reference**: [cloudflare rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) — production rate limiter design

## which algorithm when

| algorithm | burst handling | accuracy | distributed cost |
|-----------|---------------|----------|-----------------|
| fixed window | poor (boundary exploit) | loose | low |
| sliding window | good | good | high (redis sorted sets) |
| token bucket | excellent (configurable) | good | medium |
| leaky bucket | good (queued) | good | medium |
| GCRA | excellent | perfect | medium |

GCRA (generic cell rate algorithm) is the gold standard — it's a leaky bucket variant that's more memory-efficient. used by cloudflare and nginx.

**reference**: [GCRA explained](https://brandur.org/rate-limiting)

## further reading

- [rate limiting algorithms — cloudflare](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [token bucket algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [GCRA explained](https://brandur.org/rate-limiting)
