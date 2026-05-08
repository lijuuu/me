---
title: how kubernetes works internally — pods, containers, and the illusion
slug: kubernetes-internals-pods-containers
date: May 9, 2026
description: a deep dive into what a pod actually is, cgroups, namespaces, pause containers, CNI, and the kernel primitives behind kubernetes.
---

`kubectl apply -f pod.yaml` creates a pod. but what actually happens inside the linux kernel? a pod is not a container. it's not a VM. it's something stranger — a collection of linux namespaces sharing a network and IPC domain. here are the internals.

## what a pod actually is

a pod is a **group of containers that share:**
- network namespace (same IP, same ports)
- IPC namespace (shared memory, semaphores)
- optionally: PID namespace (see each other's processes)
- a shared volume (emptyDir, etc.)

they do NOT share:
- filesystem (each container has its own rootfs)
- UTS namespace (different hostnames, typically)
- user namespace (different UID mappings)

**reference**: [kubernetes pod overview](https://kubernetes.io/docs/concepts/workloads/pods/)

## the pause container

every pod has a hidden container called the **pause container** (or sandbox container). it was historically `k8s.gcr.io/pause`, now often `registry.k8s.io/pause`. it does almost nothing — it literally runs `pause()` in a loop.

its job: **hold the namespaces open.** when the pause container is created, it creates the network namespace, IPC namespace, and optionally the PID namespace. other containers in the pod join these namespaces. if the pause container dies, all namespaces are destroyed, killing every container in the pod.

```bash
# on a kubernetes node, find a pod's pause container
crictl ps | grep POD
# output: container_id  pause:3.9  Running  ...
```

**reference**: [the pause container explained](https://www.ianlewis.org/en/almighty-pause-container)

## linux namespaces: the building blocks

every container isolation primitive is a linux namespace. kubernetes uses these namespaces:

| namespace | isolates | shared in pod? |
|-----------|----------|----------------|
| mount (mnt) | filesystem mounts | no |
| UTS | hostname, domain name | no |
| IPC | semaphores, message queues, shared memory | yes |
| PID | process IDs | optional |
| network (net) | network interfaces, routing tables | yes |
| user | UID/GID mappings | configurable |
| cgroup | cgroup hierarchy | usually yes |

when you run `docker run` or `containerd run`, the runtime calls `unshare(2)` and `clone(2)` with specific flags to create these namespaces.

```c
// simplified: how containerd creates a container
int flags = CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWIPC | 
            CLONE_NEWPID | CLONE_NEWNET;
pid_t child = clone(child_fn, child_stack, flags, NULL);
```

**reference**: [linux namespaces man page](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## cgroups: the resource enforcer

namespaces provide isolation. cgroups provide resource limits. every container gets a cgroup that controls:
- CPU shares (`cpu.shares`)
- memory limit (`memory.limit_in_bytes`)
- block I/O (`blkio.throttle.read_bps_device`)
- PIDs limit (`pids.max`)

when you set `resources.limits.memory: 256Mi` in a pod spec, kubernetes writes that value to the cgroup:

```bash
# find the cgroup path
cat /proc/$PID/cgroup
# 0::/kubepods/besteffort/pod<uid>/<container-id>

# check the memory limit
cat /sys/fs/cgroup/kubepods/besteffort/pod<uid>/memory.limit_in_bytes
# 268435456 (256 MiB)
```

if a container exceeds this limit, the OOM killer terminates it. the pod status becomes `OOMKilled`.

**reference**: [linux cgroups v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

## CNI: how pods get IPs

when a pod is created, the kubelet calls the CNI plugin:

```
kubelet -> CRI (containerd) -> creates pause container
kubelet -> CNI plugin -> configures network namespace
  1. allocate IP from pod CIDR (via IPAM)
  2. create veth pair (one end in pod netns, one on host)
  3. add routes, iptables rules
  4. return IP to kubelet
```

the veth pair is the magic: one end appears as `eth0` inside the pod. the other end appears on the host bridge (`cni0` or similar). packets flow through the bridge, through iptables (for service routing), and out the host interface.

```bash
# see veth pairs on a node
ip link show | grep veth
# veth12345@if3: <BROADCAST,MULTICAST,UP> ...

# see the pod's network namespace
nsenter -t $PAUSE_PID -n ip addr
# eth0: 10.244.1.5/24
```

**reference**: [CNI specification](https://github.com/containernetworking/cni/blob/master/SPEC.md) | [calico architecture](https://docs.tigera.io/calico/latest/reference/architecture/overview)

## CRI: the container runtime interface

kubelet doesn't talk to docker directly (anymore). it speaks CRI to containerd or CRI-O:

```
kubelet -> CRI gRPC -> containerd -> runc (or kata, gvisor, firecracker)
```

CRI defines two services:
- **RuntimeService**: create/start/stop/remove containers
- **ImageService**: pull/list/remove images

this abstraction lets you swap runtimes without changing kubernetes:

```
runc:       standard OCI runtime (shared kernel)
kata:       lightweight VM per pod (stronger isolation)
gvisor:     userspace kernel (sandboxed syscalls)
firecracker: microVM (AWS Lambda/Fargate uses this)
```

**reference**: [CRI specification](https://github.com/kubernetes/cri-api)

## pod lifecycle: step by step

```
1. kubectl sends pod spec to API server
2. API server validates and stores in etcd
3. Scheduler watches for unscheduled pods
4. Scheduler picks a node (filter -> score -> bind)
5. Kubelet on the node watches for assigned pods
6. Kubelet calls CRI: create pause container
7. Kubelet calls CNI: set up network namespace
8. Kubelet calls CRI: create init containers (run serially)
9. Kubelet calls CRI: create app containers (run in parallel)
10. Kubelet starts liveness/readiness probes
11. Pod status -> Running
```

**reference**: [kubernetes scheduler deep dive](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)

## what "container" means in kubernetes

kubernetes uses the term "container" loosely. a kubernetes container is:

1. an OCI bundle (rootfs + config.json) stored on disk
2. a linux process (or group of processes) isolated by namespaces
3. a cgroup entry for resource accounting
4. a CRI container object tracked by containerd

it is NOT a docker container specifically. kubernetes deprecated dockershim in 1.24. today, containerd is the default runtime. the "container" abstraction is OCI, not docker.

## why pods and not bare containers

if containers are isolated, why group them in pods? three reasons:

1. **tight coupling**: a logging sidecar needs to see the main container's logs (shared filesystem). a service mesh proxy needs to intercept traffic (shared network).

2. **atomic scheduling**: the kubelet schedules a pod, not individual containers. all containers in a pod land on the same node. the scheduler doesn't have to coordinate container placement.

3. **shared lifecycle**: when a pod dies, all its containers die together. no orphaned sidecars.

## the kernel perspective

from the linux kernel's view, a pod is:
```
a set of processes bound to:
  - a shared network namespace (veth pair to host bridge)
  - a shared IPC namespace (for intra-pod communication)
  - a cgroup subtree (for resource accounting)
  - individual mount namespaces (per-container rootfs)
  - individual UTS namespaces (per-container hostname)
```

there is no "pod" kernel object. a pod is a convention, not a kernel primitive. kubernetes enforces the convention through the kubelet and CRI.

## further reading

- [container networking is simple](https://iximiuz.com/en/posts/container-networking-is-simple/) — ivan velichko's hands-on walkthrough
- [kubernetes the hard way](https://github.com/kelseyhightower/kubernetes-the-hard-way) — build a cluster from scratch
- [OCI runtime specification](https://github.com/opencontainers/runtime-spec) — the spec runc implements
- [linux kernel namespaces documentation](https://www.kernel.org/doc/html/latest/admin-guide/namespaces/index.html)
- [what happens when i type kubectl run](https://github.com/jamiehannaford/what-happens-when-k8s) — comprehensive trace
