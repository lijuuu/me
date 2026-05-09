---
title: why your load balancer is the bottleneck and you haven't noticed yet
slug: load-balancer-is-the-bottleneck
date: May 9, 2026
description: how load balancers silently become the choke point — connection limits, health check storms, algorithm mistakes, and the metrics you should be watching.
---

your application servers are at 30% CPU. the database is idle. but p99 latency is climbing and connections are failing. the load balancer is the bottleneck. here is why nobody notices until it's too late.

## connection limits: the hidden ceiling

every load balancer has a maximum number of concurrent connections:

```
nginx:    worker_connections * worker_processes
haproxy:  maxconn (bounded by ulimit -n, typically 2000-4000 per process)
envoy:    per-listener connection limits
AWS NLB:  50,000 per NLB (soft), millions (hard)
AWS ALB:  scales automatically (but slowly)
```

nginx with `worker_connections 1024` and 4 workers = 4,096 concurrent connections. at 4,097, new connections queue or fail.

```nginx
events {
    worker_connections 4096;  # increase this
    multi_accept on;
}
```

check current usage:

```bash
# nginx stub_status
curl http://localhost:8080/nginx_status
# Active connections: 3842
# server accepts handled requests
# Reading: 12 Writing: 3800 Waiting: 30

# haproxy stats
echo "show info" | socat stdio /var/run/haproxy.sock | grep Maxconn
```

## the algorithm matters more than you think

| algorithm | when to use | when it fails |
|-----------|------------|---------------|
| round robin | homogeneous servers, equal requests | long-lived connections skew distribution |
| least connections | heterogeneous requests, varying duration | doesn't account for request cost |
| least time (haproxy) | latency-sensitive | requires consistent server performance |
| ip hash | session stickiness without cookies | a single IP can overload one server |
| random + least conn | large scale (>100 backends) | statistical imbalance at low scale |

the worst: round-robin with long-lived connections. client A connects, gets pinned to server 1. client B connects, gets server 2. no new connections for 5 minutes. server 1 handles 1000 requests, server 2 handles 1. the LB thinks load is balanced.

fix: least connections. the LB tracks active connections per backend and routes to the one with fewest.

## health checks: the hidden DDoS

a typical health check:

```nginx
upstream backend {
    server 10.0.1.5:8080;
    server 10.0.1.6:8080;
    keepalive 32;
}

# health check: every 5 seconds
# backend count: 100 servers
# 100 servers × 1 check / 5 seconds = 20 health checks/second
```

20 checks/second is fine. but at 500 backends with 2 second checks:

```
500 servers × 1 check / 2 seconds = 250 checks/second
```

each check is an HTTP request. at 250 req/s, the health check traffic alone can saturate a small backend. add TLS and authentication, and health checks are your #1 source of load.

fix: increase check interval. 10-30 seconds is fine for stable services. or use TCP checks instead of HTTP.

**reference**: [nginx health checks](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)

## the SYN flood at scale

when the LB restarts, ALL clients reconnect simultaneously:

```
10,000 clients × 1 TCP SYN each = 10,000 SYNs in <1 second
```

the linux kernel has a SYN backlog:

```bash
cat /proc/sys/net/core/somaxconn
# 4096  ← typical on modern kernels, was 128 on older

cat /proc/sys/net/ipv4/tcp_max_syn_backlog
# 4096  ← dynamic, scales with memory, default ~256-4096
```

SYNs that exceed the backlog are dropped. clients retry after 1 second. the retries add more SYNs. the load balancer never catches up.

fix:

```bash
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
```

and in nginx:

```nginx
listen 443 backlog=65535;
```

## buffer bloat

the LB buffers request bodies before forwarding. if a client uploads a 100MB file, the LB buffers 100MB. with 10 concurrent uploads, that's 1GB of memory.

```nginx
client_max_body_size 10m;           # reject large uploads
client_body_buffer_size 128k;       # buffer in memory, spill to disk
proxy_request_buffering off;        # stream request body to backend
```

**reference**: [nginx upstream module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)

## the keepalive lie

most LBs maintain keepalive connections to backends. but the default pool size is small:

```nginx
upstream backend {
    server 10.0.1.5:8080;
    keepalive 32;  # only 32 idle keepalive connections
}
```

if 200 concurrent requests arrive, 168 of them must establish new TCP connections to backends. each new connection adds 1 RTT (SYN-SYN-ACK) + TLS handshake.

fix:

```nginx
keepalive 256;
```

match the pool size to your peak concurrency.

## envoy-specific: circuit breakers

envoy has per-cluster circuit breakers. if you haven't configured them, the defaults apply:

```yaml
circuit_breakers:
  thresholds:
    max_connections: 1024        # default
    max_pending_requests: 1024
    max_requests: 1024
    max_retries: 3
```

at 1,025 concurrent connections, envoy returns 503. the application sees random failures. the root cause is invisible unless you monitor circuit breaker trips.

**reference**: [envoy circuit breakers](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)

## the metrics you should watch

| metric | tool | what it means |
|--------|------|---------------|
| active connections | nginx stub_status | approaching limit? |
| connection queue depth | haproxy stats | requests waiting? |
| backend connection errors | LB logs | backend unreachable? |
| 502/503 rate | LB access logs | upstream failures? |
| SYN drops | `netstat -s` | backlog too small? |
| health check failures | LB stats | backend flapping? |

```bash
# quick health snapshot
# nginx
curl -s http://localhost:8080/nginx_status

# haproxy
echo "show stat" | socat stdio /var/run/haproxy.sock | grep BACKEND

# envoy
curl -s http://localhost:9901/stats | grep 'upstream_cx_active\|circuit_breaker'
```

## the architecture fix

1. **horizontal LB scaling**: run multiple LB instances with DNS round-robin or ECMP in front. no single LB is the bottleneck.
2. **direct server return (DSR)**: the LB only handles inbound traffic. outbound bypasses the LB entirely. halves LB load.
3. **separation of concerns**: use a TCP/HTTP LB for routing, a separate API gateway for auth/rate-limiting/transformations.
4. **connection pooling everywhere**: LBs should pool to backends, backends should pool to databases, clients should pool to LBs. every new connection adds a handshake.

## further reading

- [nginx upstream module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [envoy architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
- [linux TCP tuning](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)
