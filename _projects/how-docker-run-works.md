---
title: how docker run actually works — layer by layer
slug: how-docker-run-works
date: May 9, 2026
description: the full 200ms breakdown of docker run — image manifests, layer extraction, cgroup creation, namespace setup, and the kernel primitives behind every container.
---

`docker run nginx` looks like a single command. behind it are 12 distinct steps spanning the container runtime, the kernel, and the registry.

## step 1: parse the image reference

docker parses `nginx` into a fully qualified reference: `docker.io/library/nginx:latest`. it checks the local image store (default: `/var/lib/docker/overlay2`) for a matching image ID. if not found, it proceeds to pull.

## step 2: fetch the manifest

docker calls the registry API:

```
GET /v2/library/nginx/manifests/latest
Host: registry-1.docker.io
Accept: application/vnd.docker.distribution.manifest.v2+json
```

the manifest is a JSON document listing the image's layers (blobs):

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
  "config": {
    "mediaType": "application/vnd.docker.container.image.v1+json",
    "digest": "sha256:a1b2c3d4...",
    "size": 2048
  },
  "layers": [
    {
      "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
      "digest": "sha256:e1f2g3h4...",
      "size": 29345678
    }
  ]
}
```

each layer is a compressed tar archive identified by its SHA256 digest.

**reference**: [OCI image spec](https://github.com/opencontainers/image-spec/blob/main/manifest.md)

## step 3: pull config blob

```
GET /v2/library/nginx/blobs/sha256:a1b2c3d4...
```

the config blob contains the image metadata: environment variables, entrypoint, exposed ports, volumes, working directory, and the command to run.

## step 4: pull layer blobs

for each layer in the manifest:

```
GET /v2/library/nginx/blobs/sha256:e1f2g3h4...
```

docker downloads the compressed tar.gz, verifies the SHA256 checksum, and decompresses it. the decompressed layer is stored in the local content store. layers are shared across images — if another image uses the same base layer, it's not downloaded again.

## step 5: create the overlay2 filesystem

docker uses overlay2 to combine layers into a single root filesystem:

```
/var/lib/docker/overlay2/
  ├── layer1/  (base OS layer)
  ├── layer2/  (apt-get update layer)
  ├── layer3/  (COPY nginx.conf layer)
  ├── merged/  ← the container sees this
  └── upper/   ← container writes go here
```

the `merged` directory is the union of all layers. reads check upper first, then each lower layer. writes go to upper (copy-on-write). this is why containers start fast — they share read-only layers and only write to a thin upper layer.

```bash
# see the overlay mounts
mount | grep overlay
```

**reference**: [overlay filesystem](https://www.kernel.org/doc/html/latest/filesystems/overlayfs.html)

## step 6: generate the OCI spec

containerd generates an OCI runtime specification (`config.json`):

```json
{
  "ociVersion": "1.0.2",
  "process": {
    "terminal": false,
    "user": { "uid": 0, "gid": 0 },
    "args": ["nginx", "-g", "daemon off;"],
    "env": ["PATH=/usr/local/sbin:/usr/local/bin:..."]
  },
  "root": {
    "path": "/var/lib/docker/overlay2/abc123/merged",
    "readonly": false
  },
  "linux": {
    "namespaces": [
      {"type": "pid"},
      {"type": "network"},
      {"type": "mount"},
      {"type": "uts"},
      {"type": "ipc"}
    ],
    "resources": {
      "memory": {"limit": 268435456},
      "cpu": {"shares": 1024}
    }
  }
}
```

this is the complete definition of the container: what to run, what filesystem to use, what namespaces to create, what resource limits to apply.

**reference**: [OCI runtime spec](https://github.com/opencontainers/runtime-spec)

## step 7: runc creates namespaces

containerd calls `runc create`. runc calls `clone(2)` with namespace flags:

```c
int flags = CLONE_NEWNS    // mount namespace
          | CLONE_NEWUTS   // hostname namespace
          | CLONE_NEWIPC   // IPC namespace
          | CLONE_NEWPID   // PID namespace
          | CLONE_NEWNET;  // network namespace
pid_t child = clone(child_fn, child_stack, flags, NULL);
```

each flag creates a new namespace. the child process wakes up in a completely isolated environment — it sees its own PID 1, its own filesystem, its own network interfaces.

**reference**: [linux namespaces man page](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## step 8: runc applies cgroups

runc writes to the cgroup filesystem to apply resource limits:

```bash
# CPU shares
echo 1024 > /sys/fs/cgroup/system.slice/docker-abc123.scope/cpu.weight

# memory limit (256 MiB)
echo 268435456 > /sys/fs/cgroup/system.slice/docker-abc123.scope/memory.max

# PID limit
echo 100 > /sys/fs/cgroup/system.slice/docker-abc123.scope/pids.max
```

**reference**: [cgroups v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

## step 9: set up networking

docker creates a veth pair: one end in the container's network namespace (becomes `eth0`), one end attached to the `docker0` bridge on the host. iptables rules are added for NAT (SNAT for outbound, DNAT for port publishing).

```bash
# see the veth pair
ip link show | grep veth

# see the bridge
brctl show docker0
```

## step 10: apply seccomp and capabilities

docker applies a default seccomp profile that blocks ~44 system calls (like `reboot`, `kexec_load`, `mount`). it also drops all linux capabilities except a small set:

```
cap_chown, cap_dac_override, cap_fowner, cap_fsetid,
cap_kill, cap_setgid, cap_setuid, cap_setpcap,
cap_net_bind_service, cap_net_raw, cap_sys_chroot,
cap_mknod, cap_audit_write, cap_setfcap
```

## step 11: runc starts the container

`runc start` sends SIGCONT to the container process. the entrypoint (`nginx -g "daemon off;"`) begins executing. stdout and stderr are connected to docker's logging driver.

## step 12: docker monitors

docker monitors the container process. when it exits, docker records the exit code, cleans up the overlay2 upper directory (unless `--rm` was used), and removes the container from its internal state.

## the 200ms breakdown

| step | time (cached) | time (cold pull) |
|------|--------------|-----------------|
| parse reference | <1ms | <1ms |
| manifest fetch | 5ms | 50-200ms |
| config fetch | 5ms | 50-100ms |
| layer pull (per layer) | 0ms | 1-30s per layer |
| overlay2 mount | 5ms | 5ms |
| OCI spec generation | 1ms | 1ms |
| namespace creation | 2ms | 2ms |
| cgroup setup | 3ms | 3ms |
| networking setup | 10ms | 10ms |
| seccomp + capabilities | 2ms | 2ms |
| container start | 5ms | 5ms |
| **total** | **~40ms** | **2s-5min** |

## further reading

- [OCI runtime spec](https://github.com/opencontainers/runtime-spec)
- [OCI image spec](https://github.com/opencontainers/image-spec)
- [linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [overlay filesystem](https://www.kernel.org/doc/html/latest/filesystems/overlayfs.html)
