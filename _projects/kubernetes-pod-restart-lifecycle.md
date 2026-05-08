---
title: what actually happens when kubernetes restarts your pod
slug: kubernetes-pod-restart-lifecycle
date: April 2, 2026
description: a step-by-step trace of the kubernetes pod termination lifecycle, preStop hooks, grace periods, and SIGTERM vs SIGKILL.
---

a pod restart seems simple: the old pod dies, a new one starts. but between "pod is running" and "pod is gone" there's a carefully orchestrated 60-second dance that most engineers don't fully understand. and misunderstanding it causes 4xx spikes during deploys.

## the full lifecycle trace

```
1. API server marks pod for deletion (deletionTimestamp set)
2. Pod enters "Terminating" state
3. Endpoints controller removes pod IP from service endpoints (ASYNC!)
4. kubelet on the node receives the deletion event
5. preStop hook executes (if defined) — runs to completion or times out
6. kubelet sends SIGTERM to PID 1 in each container
7. Container runs for terminationGracePeriodSeconds (default 30s)
8. If still running after grace period, kubelet sends SIGKILL
9. Pod removed from API server
```

**reference**: [container lifecycle hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/) — postStart and preStop hooks for graceful container initialization and shutdown

## step 3 is where things go wrong

the endpoints controller removes the pod from services **asynchronously**. there's a gap between "pod is terminating" and "traffic stops arriving." during this window, new requests still hit a dying pod.

the fix: your app must handle SIGTERM gracefully while still receiving traffic:

```go
srv := &http.Server{Addr: ":8080"}
go func() {
    <-signalChan  // SIGTERM received
    srv.Shutdown(context.WithTimeout(context.Background(), 25*time.Second))
}()
srv.ListenAndServe()
```

**reference**: [kubernetes pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

## the preStop hook trap

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "30"]
```

this runs BEFORE SIGTERM. your grace period must be longer than preStop + shutdown time. if preStop takes 30s and your app needs 25s to drain, set `terminationGracePeriodSeconds: 60`.

common preStop patterns:
- `sleep 5` — wait for endpoint removal to propagate
- call a `/drain` endpoint — finish in-flight requests
- disconnect from DB pools gracefully

## the SIGTERM gotchas

### PID 1 problem
in docker, PID 1 doesn't receive SIGTERM by default unless the process explicitly handles it. use `STOPSIGNAL` or a proper init (tini, dumb-init).

### shell wrapping
```dockerfile
CMD myapp  # app is PID 1, gets SIGTERM directly
```
```dockerfile
CMD ./start.sh  # shell is PID 1, SIGTERM goes to shell, not app
```
use `exec ./myapp` in scripts or `CMD ["myapp"]` in dockerfile.

**reference**: [why your go app doesn't handle SIGTERM](https://medium.com/@gchudnov/trapping-signals-in-docker-containers-7a57fdda7d86)

## the readiness probe race

during a rollout, a new pod becomes "ready" (readiness probe passes) while old pods are still serving. then old pods get SIGTERM. during this overlap, traffic splits between old and new. this is fine unless:

- your app has in-memory state that needs transfer
- your DB schema changed (old pods break on new queries)
- your API contract changed

solutions: blue/green deploys, canary deploys, versioned APIs.

**reference**: [pod disruption budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) — protect application availability during voluntary disruptions like node drains and cluster upgrades

## connections: the hidden leak

a SIGTERM'd app that's still draining connections needs to:
1. stop accepting new connections (close listener)
2. let existing connections finish (up to shutdown timeout)
3. close idle connections explicitly

keepalive connections that are idle won't detect the shutdown. always set timeouts:

```go
srv := &http.Server{
    ReadTimeout:  5 * time.Second,
    WriteTimeout: 10 * time.Second,
    IdleTimeout:  120 * time.Second,
}
```

**reference**: [graceful shutdown in go](https://pkg.go.dev/net/http#Server.Shutdown) — draining connections and stopping server with context cancellation

## production checklist

- [ ] app handles SIGTERM gracefully (drains connections, stops accepting new)
- [ ] terminationGracePeriodSeconds > preStop time + shutdown time
- [ ] health check endpoints excluded from request logs
- [ ] readiness probe fails during shutdown (so no new traffic)
- [ ] preStop hook calls drain endpoint with enough buffer
- [ ] keepalive timeouts set appropriately
