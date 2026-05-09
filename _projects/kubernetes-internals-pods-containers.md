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

<div class="my-4">
  <!-- light -->
  <svg width="440" height="240" viewBox="0 0 440 240" xmlns="http://www.w3.org/2000/svg" class="dark:hidden">
    <defs>
      <marker id="la" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ea580c"/></marker>
    </defs>
    <rect x="10" y="10" width="420" height="220" rx="12" fill="none" stroke="#ea580c" stroke-width="2" stroke-dasharray="6,3"/>
    <text x="30" y="34" font-family="monospace" font-size="10" fill="#9a3412" font-weight="600">POD — shared NET + IPC namespace</text>
    <rect x="30" y="48" width="150" height="88" rx="8" fill="#fff7ed" stroke="#ea580c" stroke-width="2"/>
    <text x="105" y="68" font-family="monospace" font-size="11" fill="#7c2d12" text-anchor="middle" font-weight="bold">pause container</text>
    <line x1="45" y1="78" x2="165" y2="78" stroke="#ea580c" stroke-width="0.5" opacity="0.6"/>
    <text x="48" y="92" font-family="monospace" font-size="9" fill="#c2410c" font-weight="500">shared NET namespace</text>
    <text x="48" y="106" font-family="monospace" font-size="9" fill="#c2410c" font-weight="500">shared IPC namespace</text>
    <text x="48" y="120" font-family="monospace" font-size="9" fill="#9a3412" opacity="0.6">shared PID namespace</text>
    <path d="M180 92 L200 92 L200 80 L218 80" stroke="#ea580c" stroke-width="1.2" fill="none" marker-end="url(#la)"/>
    <path d="M180 92 L200 92 L200 128 L218 128" stroke="#ea580c" stroke-width="1.2" fill="none" marker-end="url(#la)"/>
    <rect x="225" y="48" width="185" height="70" rx="7" fill="#fafafa" stroke="#d4d4d8" stroke-width="1.2"/>
    <text x="317" y="66" font-family="monospace" font-size="10" fill="#27272a" text-anchor="middle" font-weight="bold">app container</text>
    <line x1="240" y1="74" x2="395" y2="74" stroke="#d4d4d8" stroke-width="0.5" opacity="0.6"/>
    <text x="240" y="88" font-family="monospace" font-size="8" fill="#52525b">own MNT · own UTS namespace</text>
    <text x="240" y="103" font-family="monospace" font-size="8" fill="#c2410c" font-weight="500">joins NET + IPC from pause</text>
    <rect x="225" y="133" width="185" height="70" rx="7" fill="#fafafa" stroke="#d4d4d8" stroke-width="1.2"/>
    <text x="317" y="151" font-family="monospace" font-size="10" fill="#27272a" text-anchor="middle" font-weight="bold">sidecar container</text>
    <line x1="240" y1="159" x2="395" y2="159" stroke="#d4d4d8" stroke-width="0.5" opacity="0.6"/>
    <text x="240" y="173" font-family="monospace" font-size="8" fill="#52525b">own MNT · own UTS namespace</text>
    <text x="240" y="188" font-family="monospace" font-size="8" fill="#c2410c" font-weight="500">joins NET + IPC from pause</text>
  </svg>
  <!-- dark -->
  <svg width="440" height="240" viewBox="0 0 440 240" xmlns="http://www.w3.org/2000/svg" class="hidden dark:block">
    <defs>
      <marker id="da" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#f0853f"/></marker>
    </defs>
    <rect x="10" y="10" width="420" height="220" rx="12" fill="none" stroke="#f0853f" stroke-width="2" stroke-dasharray="6,3"/>
    <text x="30" y="34" font-family="monospace" font-size="10" fill="#fb923c" font-weight="600">POD — shared NET + IPC namespace</text>
    <rect x="30" y="48" width="150" height="88" rx="8" fill="#431407" stroke="#f0853f" stroke-width="2"/>
    <text x="105" y="68" font-family="monospace" font-size="11" fill="#fb923c" text-anchor="middle" font-weight="bold">pause container</text>
    <line x1="45" y1="78" x2="165" y2="78" stroke="#f0853f" stroke-width="0.5" opacity="0.6"/>
    <text x="48" y="92" font-family="monospace" font-size="9" fill="#f0853f" font-weight="500">shared NET namespace</text>
    <text x="48" y="106" font-family="monospace" font-size="9" fill="#f0853f" font-weight="500">shared IPC namespace</text>
    <text x="48" y="120" font-family="monospace" font-size="9" fill="#fb923c" opacity="0.6">shared PID namespace</text>
    <path d="M180 92 L200 92 L200 80 L218 80" stroke="#f0853f" stroke-width="1.2" fill="none" marker-end="url(#da)"/>
    <path d="M180 92 L200 92 L200 128 L218 128" stroke="#f0853f" stroke-width="1.2" fill="none" marker-end="url(#da)"/>
    <rect x="225" y="48" width="185" height="70" rx="7" fill="#18181b" stroke="#52525b" stroke-width="1.2"/>
    <text x="317" y="66" font-family="monospace" font-size="10" fill="#d4d4d8" text-anchor="middle" font-weight="bold">app container</text>
    <line x1="240" y1="74" x2="395" y2="74" stroke="#52525b" stroke-width="0.5" opacity="0.6"/>
    <text x="240" y="88" font-family="monospace" font-size="8" fill="#a1a1aa">own MNT · own UTS namespace</text>
    <text x="240" y="103" font-family="monospace" font-size="8" fill="#f0853f" font-weight="500">joins NET + IPC from pause</text>
    <rect x="225" y="133" width="185" height="70" rx="7" fill="#18181b" stroke="#52525b" stroke-width="1.2"/>
    <text x="317" y="151" font-family="monospace" font-size="10" fill="#d4d4d8" text-anchor="middle" font-weight="bold">sidecar container</text>
    <line x1="240" y1="159" x2="395" y2="159" stroke="#52525b" stroke-width="0.5" opacity="0.6"/>
    <text x="240" y="173" font-family="monospace" font-size="8" fill="#a1a1aa">own MNT · own UTS namespace</text>
    <text x="240" y="188" font-family="monospace" font-size="8" fill="#f0853f" font-weight="500">joins NET + IPC from pause</text>
  </svg>
</div>

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

<div class="flex flex-wrap items-center gap-x-1 gap-y-1 my-4 text-[11px] leading-tight">
  <span class="border border-[#c2410c] dark:border-[#f0853f] rounded-full px-2 py-0.5 bg-[#e06b20]/[0.1] dark:bg-[#f0853f]/[0.12] text-[#9a3412] dark:text-[#fb923c] font-semibold">kubectl</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border border-red-500 dark:border-red-400 rounded-full px-2 py-0.5 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold">API Server</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border border-amber-500 dark:border-amber-400 rounded-full px-2 py-0.5 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 font-semibold">etcd</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">⇢</span>
  <span class="border border-emerald-500 dark:border-emerald-400 rounded-full px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-semibold">Scheduler</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border border-blue-500 dark:border-blue-400 rounded-full px-2 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-semibold">Kubelet</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border border-violet-500 dark:border-violet-400 rounded-full px-2 py-0.5 bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400 font-semibold">CRI</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border border-fuchsia-500 dark:border-fuchsia-400 rounded-full px-2 py-0.5 bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-600 dark:text-fuchsia-400 font-semibold">CNI</span>
  <span class="text-black/55 dark:text-white/45 mx-0.5 font-medium">→</span>
  <span class="border-2 border-[#e06b20] dark:border-[#f0853f] rounded-full px-2 py-0.5 bg-[#e06b20]/[0.15] dark:bg-[#f0853f]/[0.15] text-[#9a3412] dark:text-[#fb923c] font-bold">Pod Running</span>
</div>
<div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-black/50 dark:text-white/40 mb-4">
  <span>1. POST pod spec</span>
  <span>2. validate & store</span>
  <span>3. watch unscheduled</span>
  <span>4. bind to node</span>
  <span>5. watch assigned</span>
  <span>6. create pause</span>
  <span>7. set up network</span>
  <span>8-9. start containers</span>
  <span>10. probes → Running</span>
</div>

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
