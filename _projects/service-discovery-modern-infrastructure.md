---
title: how service discovery really works inside modern infrastructure
slug: service-discovery-modern-infrastructure
date: March 8, 2026
description: DNS, Consul, etcd, envoy, and the tradeoffs between client-side and server-side service discovery patterns.
---

service discovery sounds simple: "find the IP of service B." but the implementation sprawls across DNS, health checking, load balancing, and failure detection. here is the full picture.

## the two patterns

### client-side discovery
```
service A -> service registry -> [10.0.1.5, 10.0.2.3, 10.0.3.1]
service A -> pick one (round robin) -> 10.0.1.5
```
client queries registry, gets list of instances, picks one. used by gRPC with DNS resolver, consul with client libraries.

pro: no extra hop. con: client needs registry-specific logic.

### server-side discovery
```
service A -> load balancer -> service registry -> 10.0.1.5
```
client sends to a load balancer. the LB queries registry, forwards to a backend. used by kubernetes services, AWS ALB.

pro: client is simple. con: extra hop, LB becomes bottleneck.

**reference**: [service discovery in microservices](https://microservices.io/patterns/service-discovery.html)

## DNS as service discovery

kubernetes creates a DNS record for each service:
```
my-service.namespace.svc.cluster.local -> 10.0.1.5
```

problems:
- DNS TTL caching: client caches old IP for up to 30s
- no health checking: DNS returns unhealthy IPs
- no load balancing weight: all IPs are equal

fix: use headless services + client-side selection with health awareness.

## consul/etcd: the consensus-based registry

```go
// register service
consul.Agent().ServiceRegister(&consul.AgentServiceRegistration{
    Name: "my-service",
    Port: 8080,
    Check: &consul.AgentServiceCheck{
        HTTP:     "http://localhost:8080/health",
        Interval: "10s",
    },
})

// discover services
services, _, _ := consul.Health().Service("my-service", "", true, nil)
```

health checks integrated. instances are removed when checks fail. this is the gold standard for client-side discovery.

**reference**: [consul architecture](https://www.consul.io/docs/architecture)

## kubernetes service discovery deep dive

```
kube-proxy watches API server for service/endpoint changes
kube-proxy updates iptables rules on each node
curl my-service:8080 -> iptables DNAT -> random pod IP
```

iptables-based (default `kube-proxy` mode):
- O(1) data path: kernel handles routing
- O(n) rule updates: every service change = full iptables sync
- no advanced load balancing (only random)

IPVS mode:
- O(1) rule updates: hash table, no full sync
- more load balancing algorithms (rr, lc, sh, dh)
- better at scale (>1000 services)

**reference**: [kube-proxy IPVS mode](https://kubernetes.io/blog/2018/07/09/ipvs-based-in-cluster-load-balancing-deep-dive/)

## envoy and the service mesh approach

```yaml
# envoy sidecar handles all discovery
static_resources:
  clusters:
  - name: my-service
    type: STRICT_DNS
    connect_timeout: 0.25s
    lb_policy: ROUND_ROBIN
    load_assignment:
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: my-service
                port_value: 8080
```

envoy (or linkerd, istio's proxy) handles discovery, load balancing, retries, circuit breaking, and metrics. the application doesn't know about service discovery at all.

## the consistency problem

service registries are eventually consistent. between "instance dies" and "registry removes it":
- consul: ~10-20 seconds (health check interval + gossip)
- kubernetes endpoints: ~1-5 seconds (api server + kube-proxy sync)
- DNS: up to TTL

your application must handle requests to dead backends:
- retry with backoff
- circuit break after N failures
- don't cache discovery results forever

**reference**: [the CAP theorem and service discovery](https://www.consul.io/docs/architecture/consensus)
