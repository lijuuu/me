---
title: understanding kubernetes reconciliation loops
slug: kubernetes-reconciliation-loops-design
date: February 12, 2026
description: the reconciliation pattern, level-triggered vs edge-triggered controllers, the operator pattern, and why this is the best design for distributed systems.
---

kubernetes controllers don't say "do X." they say "the desired state is X. make it so." this is the reconciliation pattern, and it's the single best idea in kubernetes for designing reliable distributed systems.

## edge-triggered vs level-triggered

### edge-triggered (traditional)
```
event: "user created"
handler: create_user()
```
if the handler crashes, the event is lost. the user is never created.

### level-triggered (kubernetes)
```
desired state: "user should exist"
actual state: "user does not exist"
action: create_user()
```

if the handler crashes, the next reconciliation cycle sees "user still doesn't exist" and tries again. the desired state is the source of truth, not the event.

**reference**: [kubernetes controller pattern](https://kubernetes.io/docs/concepts/architecture/controller/)

**reference**: [level-triggered vs edge-triggered controllers](https://kubernetes.io/docs/concepts/architecture/controller/#writing-controllers) — why level-triggered reconciliation means controllers never miss events

## the reconciliation loop

```go
for {
    desired := getDesiredState()
    actual := getActualState()
    diff := desired - actual
    
    for _, action := range diff {
        execute(action)
    }
    
    time.Sleep(reconciliationInterval)
}
```

this loop runs forever. every cycle, it compares desired to actual and takes action to close the gap. if an action fails, the next cycle retries.

## why this is brilliant for distributed systems

### self-healing
a node crashes. the replication controller sees "desired: 3 pods, actual: 2 pods." it schedules a new pod. no human intervention. no alert. no incident.

### idempotent by design
every reconciliation action is idempotent. `create_user()` fails if the user already exists. `delete_user()` succeeds if the user is already gone. it's safe to run the reconciliation loop at any frequency.

### no missed events
if your monitoring system misses a pod creation event, the reconciliation loop doesn't care. it checks current state, not event history.

## the operator pattern

operators extend kubernetes with custom reconciliation loops:

```
Custom Resource Definition (CRD) -> Operator (custom controller) -> Actual Resources
```

example: a postgres operator:
1. user creates a `PostgresCluster` CRD with 3 replicas
2. the operator reconciles: creates 3 statefulset pods, configures replication, sets up backups
3. if a pod dies, the operator recreates it
4. if the user changes replicas to 5, the operator adds 2 pods

**reference**: [kubernetes operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)

**reference**: [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime) — the canonical go library for building kubernetes controllers and operators

**reference**: [operator SDK](https://sdk.operatorframework.io/) — framework for building kubernetes operators with opinionated scaffolding and tooling

## applying reconciliation outside kubernetes

you can use the reconciliation pattern in any system:

### configuration management
```go
type ConfigController struct {
    desired map[string]Config
    actual  map[string]Config
}

func (c *ConfigController) Reconcile() {
    for key, desired := range c.desired {
        actual, exists := c.actual[key]
        if !exists || actual != desired {
            applyConfig(key, desired)
        }
    }
}
```

### infrastructure as code
terraform is a reconciliation engine. `terraform plan` = diff between desired and actual. `terraform apply` = reconciliation.

### database migrations
a migration tool that checks what migrations have been applied (actual) vs what migrations exist (desired) is a reconciliation loop.

## the downsides

### eventual consistency
reconciliation isn't immediate. there's a delay between "desired state changed" and "actual state matches." this is acceptable for most infrastructure but not for real-time systems.

### the reconciliation interval tradeoff
- too short: wasteful CPU, API rate limiting
- too long: slow to react to changes
- solution: watch for changes (kubernetes uses watch API), reconcile immediately on change, periodically as backup

### the runaway controller
an infinite loop of "create pod -> pod fails -> reconcile -> create pod -> pod fails..." without backoff. always add exponential backoff to reconciliation actions.

## the design principle

> "don't tell the system what to do. tell it what the desired state is. let it figure out how to get there."

this is the reconciliation pattern. it's not just for kubernetes.

## further reading

- [kubernetes controller pattern](https://kubernetes.io/docs/concepts/architecture/controller/)
- [level-triggered vs edge-triggered controllers](https://kubernetes.io/docs/concepts/architecture/controller/#writing-controllers)
- [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime)
