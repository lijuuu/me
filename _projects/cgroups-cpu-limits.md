---
title: what cgroups are actually doing to your CPU limits
slug: cgroups-cpu-limits
date: May 9, 2026
description: how linux cgroups throttle your containers, why CPU limits don't mean what you think they mean, and how the CFS scheduler turns limits into latency.
---

you set `resources.limits.cpu: "1"` in your pod spec. your container gets 100ms of CPU every 100ms period. but your p99 latency just doubled. here is what the kernel is actually doing.

## cgroups v2: the basics

every container runs inside a cgroup. the cgroup controls what resources the container can use. for CPU, there are two mechanisms:

### cpu.weight (shares)

a relative priority. if two containers want CPU and one has `cpu.weight = 100` and the other has `cpu.weight = 200`, the second one gets 2/3 of available CPU. this only matters during contention. if the CPU is idle, both can use 100%.

### cpu.max (limit)

an absolute cap. `cpu.max = "100000 100000"` means "100ms of CPU time every 100ms period." that's 1 full CPU core. `cpu.max = "50000 100000"` means "50ms every 100ms" — half a core.

kubernetes translates `resources.limits.cpu` into `cpu.max`:

```
limits.cpu: 500m  →  cpu.max = "50000 100000"  →  0.5 cores
limits.cpu: 2     →  cpu.max = "200000 100000"  →  2 cores
```

**reference**: [cgroups v2 documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

## the throttling trap

the CFS (completely fair scheduler) enforces limits using a token bucket:

1. every 100ms period, the container gets `quota` microseconds of CPU
2. if the container uses all its quota, it's throttled until the next period
3. during throttling, the container gets ZERO CPU

a container with `cpu.max = "50000 100000"` (0.5 cores):

```
time 0ms:     container starts processing request
time 50ms:    quota exhausted. container THROTTLED
time 50-100ms: container frozen. request sits idle
time 100ms:   new period. container gets 50ms. processes for 12ms
time 112ms:   request completes. total wall time: 112ms
```

the request needed 62ms of CPU time. but because of throttling, wall time was 112ms. that's the difference between CPU time and wall time — and the source of your latency spikes.

**reference**: [CFS bandwidth control](https://www.kernel.org/doc/html/latest/scheduler/sched-bwc.html)

## the burstable problem

the CFS period is 100ms by default. that means your container can burst for 50ms, then it's dead for 50ms. this is terrible for latency:

```
request 1: arrives at 0ms, gets CPU 0-50ms (completes)
request 2: arrives at 1ms, gets CPU 0-50ms (completes)
request 3: arrives at 51ms, CPU quota exhausted. waits 49ms
```

the fix: don't use CPU limits at all unless you have a specific noisy-neighbor problem. use CPU requests for scheduling and let the CFS handle fairness.

## CPU requests vs limits: the real difference

| | request | limit |
|---|---|---|
| schedules placement | yes | no |
| caps usage | no | yes |
| causes throttling | no | yes (badly) |
| affects latency | no | yes |
| protects noisy neighbors | no | yes |

monitor throttling:

```promql
# prometheus: check for CPU throttling
rate(container_cpu_cfs_throttled_seconds_total[5m]) > 0
```

**reference**: [kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

## memory limits: completely different

CPU limits throttle. memory limits kill. when a container exceeds its memory limit, the OOM killer terminates the process. no warning, no slowdown — just death.

```bash
# check cgroup memory limit
cat /sys/fs/cgroup/kubepods/pod<uid>/memory.max
# 268435456 (256 MiB)

# check current usage
cat /sys/fs/cgroup/kubepods/pod<uid>/memory.current
# 262144000 (near limit!)
```

memory limits should always be set. CPU limits should be used carefully. running out of memory crashes the container. running out of CPU just makes it slow — but the throttling can make it so slow it's functionally dead.

## the cgroup filesystem

inspect cgroups directly:

```bash
# find the cgroup path
cat /proc/self/cgroup

# check CPU limit
cat /sys/fs/cgroup/system.slice/docker-abc123.scope/cpu.max
# 50000 100000

# check throttling stats
cat /sys/fs/cgroup/system.slice/docker-abc123.scope/cpu.stat
# nr_throttled 1542           ← the bad one
# throttled_usec 78901234      ← total time frozen
```

## what this means for your pods

```
limits.cpu: 1     → 100ms/100ms period → no throttling (full core)
limits.cpu: 500m  → 50ms/100ms period  → can throttle if burst >50ms
limits.cpu: 200m  → 20ms/100ms period  → throttles aggressively
```

if your p99 latency is 200ms and your container processes requests in 30ms of CPU time, you're fine with `limits.cpu: 500m`. but if your p99 is 50ms and your container processes in 3ms, a single 50ms throttle window kills your latency.

the rule: CPU requests for scheduling, CPU limits only when you have measured and confirmed a noisy-neighbor problem. and always monitor `nr_throttled`.

## further reading

- [cgroups v2 documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [CFS bandwidth control](https://www.kernel.org/doc/html/latest/scheduler/sched-bwc.html)
- [kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
