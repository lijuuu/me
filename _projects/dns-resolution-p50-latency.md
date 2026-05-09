---
title: what DNS resolution is really doing to your p50 latency
slug: dns-resolution-p50-latency
date: May 9, 2026
description: the hidden cost of DNS in every request — resolver behavior, TTLs, search domains, and why a single slow DNS server can double your response time.
---

you measure your application at 8ms p50. but users see 80ms. the gap is DNS. here is every step between `curl api.example.com` and the first byte hitting your server, and where DNS hides its latency.

## the DNS resolution chain

```
curl api.example.com
  → getaddrinfo("api.example.com")
    → /etc/nsswitch.conf  (check hosts: files dns)
      → /etc/hosts  (miss)
      → /etc/resolv.conf  (nameserver 10.0.0.2)
        → UDP 10.0.0.2:53 → "api.example.com A?"
          → 10.0.0.2 forwards to upstream resolver
            → upstream caches (hit/miss)
              → authoritative nameserver
          ← "api.example.com A 10.1.2.3"
      ← cached by libc (TTL: 60s)
  → connect(10.1.2.3, 443)
```

every step adds latency. a single uncached DNS resolution can take 50-200ms. if your application resolves DNS on every request, that latency is added to every request.

## the search domain trap

most linux systems have a search domain in `/etc/resolv.conf`:

```
search us-east-1.compute.internal
nameserver 10.0.0.2
```

when you resolve `api`, the resolver tries:

```
api.us-east-1.compute.internal.  →  NXDOMAIN (50ms)
api.                              →  NXDOMAIN (50ms)
```

that's 100ms of wasted DNS queries before the real resolution starts. if you use short names (without dots), you're paying this tax.

the fix: always use FQDNs. `api.example.com` not `api`. the trailing dot tells the resolver this is final.

**reference**: [resolv.conf man page](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)

## DNS caching layers

your application's DNS resolution passes through multiple caches:

| cache | TTL | scope |
|-------|-----|-------|
| application (in-process) | configurable | per-process |
| libc (getaddrinfo) | DNS TTL | per-process |
| nscd/systemd-resolved | DNS TTL | per-host |
| upstream resolver | DNS TTL | shared |
| authoritative | DNS TTL | global |

each cache miss propagates to the next layer. a miss at the libc level is a query to the local resolver. a miss there is a query upstream. a miss all the way to authoritative is 5-10 round trips.

## the TTL problem

you set a DNS TTL of 60 seconds for fast failover. but 60 seconds means every 60 seconds, every process on every host resolves DNS fresh. at 10,000 hosts, that's 167 QPS to your DNS server — just from idle connections.

lower TTL = faster failover, higher DNS load. higher TTL = lower DNS load, slower failover. the right balance depends on your architecture:

- **load balancer with health checks**: TTL can be 300s+. the LB handles failover, not DNS.
- **client-side load balancing (service mesh)**: TTL 10-30s. the client needs fresh IPs quickly.
- **DNS round-robin (no LB)**: TTL 5-10s. DNS is your only failover mechanism.

## the blocking resolver

most applications use a blocking DNS resolver:

```go
// this blocks the goroutine until DNS resolves
resp, err := http.Get("https://api.example.com/data")
```

under the hood, `net.LookupHost` calls `getaddrinfo` which blocks. if the DNS server is slow, the request blocks. if DNS times out (default: 5 seconds), the request fails.

```go
// go 1.9+: use a custom resolver with timeout
resolver := &net.Resolver{
    PreferGo: true,
    Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
        d := net.Dialer{Timeout: 1 * time.Second}
        return d.DialContext(ctx, network, "10.0.0.2:53")
    },
}
```

**reference**: [go net.Resolver](https://pkg.go.dev/net#Resolver)

## the connection pool trap

most HTTP clients reuse connections. but DNS caching is separate from connection pooling:

```go
// connection 1: resolves api.example.com → 10.1.2.3, connects
// 60 seconds later, TTL expires
// connection 2: resolves api.example.com → 10.1.2.5 (same hostname, different IP)
```

if your service has 4 replicas with changing IPs, DNS round-robin distributes connections. but connection pooling may keep connections to old IPs alive. the pool is sticky to old IPs until connections are closed.

## the kubernetes DNS specific

kubernetes DNS (`kube-dns`/`coredns`) has its own issues:

```
# default dnsPolicy: ClusterFirst
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

`ndots:5` means any name with fewer than 5 dots is treated as a relative name and the search domains are appended. `my-service` becomes `my-service.default.svc.cluster.local`, `my-service.svc.cluster.local`, etc. each generates a DNS query.

fix for external-heavy workloads:

```yaml
dnsConfig:
  options:
    - name: ndots
      value: "1"
```

now only single-component names (no dots) trigger search domain queries. `api.example.com` goes straight to the resolver.

**reference**: [kubernetes DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)

## measuring DNS latency

```bash
# check resolution time
time dig api.example.com

# check which nameserver you're using
cat /etc/resolv.conf

# check search domains
hostname -d

# go: benchmark DNS in your app
import "net"
start := time.Now()
addrs, _ := net.LookupHost("api.example.com")
fmt.Printf("DNS: %v, addrs: %v\n", time.Since(start), addrs)
```

## the checklist

1. use FQDNs (trailing dot) to skip search domain resolution
2. set `ndots:1` for kubernetes pods that mostly call external services
3. use a DNS resolver with a 1-2 second timeout, not the default 5 seconds
4. cache DNS results in your application (respect TTL)
5. monitor DNS latency alongside request latency
6. set appropriate TTLs — 30s for dynamic services, 300s for stable ones

## further reading

- [linux resolv.conf](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)
- [go net.Resolver](https://pkg.go.dev/net#Resolver)
- [kubernetes DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
