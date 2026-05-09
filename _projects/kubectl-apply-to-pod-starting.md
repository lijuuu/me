---
title: what actually happens between kubectl apply and your pod starting
slug: kubectl-apply-to-pod-starting
date: May 9, 2026
description: tracing the full lifecycle from kubectl to running pod — API server, etcd, scheduler, kubelet, CRI, CNI, and every step in between.
---

`kubectl apply -f pod.yaml` looks instant. it is not. between your terminal and a running pod, there are 11 distinct steps spanning 4 components, 2 gRPC calls, and at least one kernel namespace creation. here is the full trace.

## 1. kubectl → API server

kubectl reads your kubeconfig, finds the current context, and sends an HTTP POST to the API server:

```
POST /api/v1/namespaces/default/pods
{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": { "name": "nginx" },
  "spec": { "containers": [{ "name": "nginx", "image": "nginx:1.27" }] }
}
```

the API server does NOT create anything yet. it validates the request: schema validation, admission webhooks (mutating then validating), resource quota checks, RBAC authorization. if any fail, the request is rejected with a 4xx.

## 2. API server → etcd

after validation passes, the API server serializes the pod object and writes it to etcd:

```
etcdctl put /registry/pods/default/nginx <protobuf bytes>
```

etcd uses raft to replicate this write to a majority of nodes. only after the write is committed does the API server return `201 Created` to kubectl. this is why `kubectl apply` can take 100-300ms — you're waiting for a distributed consensus write.

**reference**: [etcd raft consensus](https://etcd.io/docs/v3.5/learning/design-client/)

## 3. scheduler watches

the scheduler doesn't get "told" about new pods. it watches. it maintains a long-polling watch on `/registry/pods` with `spec.nodeName == ""`. when the new pod appears in etcd, the scheduler receives the event.

filtering (which nodes CAN run this pod):
- node selectors / affinity / anti-affinity
- taints and tolerations
- resource requests (does the node have enough CPU/memory?)
- node conditions (Ready, not MemoryPressure)

scoring (which node is BEST):
- `LeastRequestedPriority`: prefer nodes with more free resources
- `BalancedResourceAllocation`: prefer nodes where CPU/memory ratio is balanced
- `ImageLocality`: prefer nodes that already have the image pulled

the scheduler picks the highest-scoring node and creates a Binding object:

```
POST /api/v1/namespaces/default/bindings
{
  "target": { "kind": "Node", "name": "worker-3" },
  "metadata": { "name": "nginx" }
}
```

**reference**: [kubernetes scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)

## 4. kubelet sync loop

the kubelet on worker-3 runs a sync loop. it watches for pods assigned to its node. it doesn't run a single loop — it runs multiple reconcilers: pod worker loop (handles pod spec changes), volume manager (attaches volumes), and the actual container runtime manager.

the kubelet checks:
- is the pod already running? (reconcile case)
- is this a new pod? (create case)
- has the pod spec changed? (update case)

for a new pod, it proceeds to creation.

**reference**: [kubelet sync loop](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)

## 5. CRI: create the sandbox

the kubelet calls containerd via CRI gRPC:

```
service RuntimeService {
  rpc RunPodSandbox(RunPodSandboxRequest) returns (RunPodSandboxResponse);
}
```

containerd creates the **pause container**. this container does literally nothing — it calls `pause()` in an infinite loop. but behind the scenes, the kernel creates:
- a network namespace (for the pod's IP)
- an IPC namespace (for shared memory)
- optionally a PID namespace

containerd writes the sandbox ID back to the kubelet.

**reference**: [CRI specification](https://github.com/kubernetes/cri-api)

## 6. CNI: configure the network

the kubelet calls the CNI plugin. the CNI plugin:
1. allocates an IP from the pod CIDR (via IPAM)
2. creates a veth pair — one end in the pod's network namespace, one end on the host bridge (`cni0`)
3. adds routes and iptables rules
4. returns the IP to the kubelet

the pod now has `eth0` with a real IP.

**reference**: [CNI specification](https://github.com/containernetworking/cni/blob/master/SPEC.md)

## 7. pull images

for each container in the pod spec, the kubelet calls:
```
rpc PullImage(PullImageRequest) returns (PullImageResponse);
```

containerd checks if the image is cached. if not, it pulls layer by layer from the registry. each layer is a compressed tar blob. containerd decompresses, verifies checksums, and stores in its content store.

## 8. create containers

for each container, the kubelet calls:
```
rpc CreateContainer(CreateContainerRequest) returns (CreateContainerResponse);
```

containerd generates an OCI bundle (rootfs + config.json) and calls `runc create`. runc:
- sets up cgroups (cpu, memory, pids limits from the pod spec)
- applies seccomp profiles
- sets up namespaces (mount, UTS — the ones NOT shared via the pause container)
- starts the container process

init containers run serially before app containers. all app containers start in parallel.

## 9. start containers

```
rpc StartContainer(StartContainerRequest) returns (StartContainerResponse);
```

`runc start` sends SIGCONT to the container process. the container's entrypoint begins executing.

## 10. readiness probe

the kubelet starts the readiness probe (if configured). until the probe succeeds, the pod is NOT added to service endpoints. other pods cannot reach it. this is the real "the pod is running" from a service perspective.

## 11. pod status → Running

the kubelet updates the pod status in the API server:
```
PATCH /api/v1/namespaces/default/pods/nginx/status
{
  "status": {
    "phase": "Running",
    "conditions": [{ "type": "Ready", "status": "True" }],
    "podIP": "10.244.2.15"
  }
}
```

the API server writes this to etcd. controllers watching the pod (endpoints controller, replicaSet controller) receive the update and reconcile.

## the timeline

| step | typical latency |
|------|----------------|
| kubectl → API validation | 1-5ms |
| API → etcd write | 10-50ms |
| scheduler watch + score | 1-100ms |
| kubelet sync loop detect | 1-500ms |
| CRI: create sandbox | 5-20ms |
| CNI: configure network | 10-100ms |
| pull image (cached) | 1-10ms |
| pull image (new) | 500ms-5s |
| create + start containers | 10-50ms |
| readiness probe pass | 1-30s |
| status update | 10-50ms |

the biggest variable is image pull time. an uncached 200MB image on a slow registry can add 30 seconds. the kubelet watches the API server for new pods, so detection is typically sub-second — but the kubelet's internal sync loop runs on its own cadence for reconciliation, not initial detection.

## the single point of truth

at every step, the API server + etcd is the source of truth. kubectl doesn't talk to the scheduler. the scheduler doesn't talk to the kubelet. everything communicates through etcd via the API server. this is the fundamental design pattern of kubernetes: level-triggered reconciliation through a shared state store.

## further reading

- [kubernetes scheduler deep dive](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [CRI specification](https://github.com/kubernetes/cri-api)
- [CNI specification](https://github.com/containernetworking/cni/blob/master/SPEC.md)
- [etcd design](https://etcd.io/docs/v3.5/learning/design-client/)
