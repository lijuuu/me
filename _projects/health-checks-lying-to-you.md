---
title: why your health checks are probably lying to you
slug: health-checks-lying-to-you
date: February 15, 2026
description: the difference between liveness and readiness probes, why 200 OK isn't enough, and how to build health checks that actually detect failure.
---

a health endpoint returns 200. the load balancer is happy. monitoring is green. but users are seeing 500s. the health checks are lying.

## liveness vs readiness vs startup

kubernetes got this right:

### liveness: "should this container be restarted?"
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
```
if this fails, kubernetes kills and restarts the container. should be lightweight. should not check dependencies.

### readiness: "can this container serve traffic?"
```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
```
if this fails, kubernetes removes the pod from the service endpoint. should check critical dependencies (DB, cache, queue).

### startup: "has this container finished initializing?"
```yaml
startupProbe:
  httpGet:
    path: /startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```
for slow-starting apps. liveness and readiness don't start until this passes.

**reference**: [k8s pod lifecycle probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

**reference**: [kubernetes probe design patterns](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes) — how to choose between liveness, readiness, and startup probes

## the 200 OK trap

```go
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(200)
    w.Write([]byte("ok"))
})
```

this endpoint lies. your app is running, but:
- the database connection pool is exhausted
- the redis cluster is partitioned
- the queue is full and you're dropping messages
- the disk is full and you can't write logs

200 OK doesn't mean "healthy." it means "the process hasn't crashed."

**reference**: [health check patterns for distributed systems](https://microservices.io/patterns/observability/health-check-api.html) — microservices.io guide on health check API design and dependency verification

## what a real health check looks like

```go
func healthCheck(w http.ResponseWriter, r *http.Request) {
    results := HealthResults{}
    
    // check database
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()
    if err := db.PingContext(ctx); err != nil {
        results.Add("database", StatusDown, err.Error())
    }
    
    // check redis
    if err := redis.Ping(); err != nil {
        results.Add("redis", StatusDegraded, err.Error())
    }
    
    // check queue depth
    depth := queue.Len()
    if depth > 10000 {
        results.Add("queue", StatusDegraded, fmt.Sprintf("depth: %d", depth))
    }
    
    // determine overall status
    if results.HasDown() {
        w.WriteHeader(503)
    } else if results.HasDegraded() {
        w.WriteHeader(200)  // still serving, but warn
    } else {
        w.WriteHeader(200)
    }
    json.NewEncoder(w).Encode(results)
}
```

## the dependency check problem

a health check checks postgres. postgres is down. all instances return 503. the load balancer removes all instances. now the health checks can't even run — there are no instances left. this is a health check death spiral.

the fix: never fail liveness on external dependencies. fail readiness on critical dependencies, but keep liveness always succeeding. and have a fallback plan for when all instances are removed.

**reference**: [designing better readiness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes) — kubernetes guide on readiness probe design and dependency checks

## the chattiness problem

health checks every 5 seconds from 100 instances = 20 QPS. with dependency checks (DB ping, redis ping, queue check), each health check makes 3 network calls = 60 QPS just for health.

fixes:
- health checks should be fast (<100ms)
- cache dependency check results for a few seconds
- don't check things that don't affect serving (logging, metrics)

## the silent failure mode

your app can't serve traffic but doesn't know it:
- deadlocked: health endpoint works but all other endpoints hang
- connection pool exhausted: health check uses a dedicated connection
- out of file descriptors: health check listener was opened before the leak

check what matters:
```go
// track request success rate
if errorRate > 0.5 {
    w.WriteHeader(503)  // 50%+ error rate = unhealthy
}

// track goroutine count
if runtime.NumGoroutine() > 10000 {
    w.WriteHeader(503)  // leaking goroutines
}

## further reading

- [kubernetes pod lifecycle probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [health check patterns for distributed systems](https://microservices.io/patterns/observability/health-check-api.html)
- [designing better readiness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes)
```
