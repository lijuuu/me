---
title: how modern proxies handle 100k concurrent connections
slug: modern-proxies-100k-concurrent-connections
date: February 18, 2026
description: nginx vs envoy vs haproxy architecture, the C10K to C10M evolution, epoll, thread-per-core, and zero-copy networking.
---

proxies sit between users and services. at 100k concurrent connections, they're the first place infrastructure shows stress. modern proxies handle it.

## the thread-per-connection disaster

```c
// classic apache prefork model
while (1) {
    int fd = accept(listen_fd, ...);
    if (fork() == 0) {
        handle_connection(fd);  // each connection = one process
    }
}
```

at 100k connections: 100k processes. each process: ~2MB memory = 200 GB. context switching between 100k processes = thrashing. this is why the C10K problem existed.

**reference**: [the C10K problem](http://www.kegel.com/c10k.html) — dan kegel's classic paper

## the epoll revolution

```c
// event-driven: one thread, many connections
int epfd = epoll_create(1);
struct epoll_event events[MAX_EVENTS];

while (1) {
    int n = epoll_wait(epfd, events, MAX_EVENTS, -1);
    for (int i = 0; i < n; i++) {
        handle_event(events[i].data.fd);
    }
}
```

one thread handles all connections. epoll_wait only returns when there's data. no polling, no wasted CPU. nginx popularized this model.

**reference**: [epoll man page](https://man7.org/linux/man-pages/man7/epoll.7.html)

## nginx architecture

```
master process (configuration, signal handling)
  ├── worker process 1 (event loop, handles connections)
  ├── worker process 2
  ├── worker process 3
  └── worker process 4
```

each worker is single-threaded, event-driven. one worker per CPU core. workers don't share state (no locks). this scales linearly with cores.

key nginx features at scale:
- **shared listen socket**: `SO_REUSEPORT` distributes connections across workers
- **connection pooling**: backend connections reused, not created per request
- **sendfile**: `sendfile()` syscall for static files, zero-copy from disk to socket

**reference**: [nginx architecture](https://www.nginx.com/blog/inside-nginx-how-we-designed-for-performance-scale/)

## envoy architecture

```
main thread (xDS config, stats)
  ├── worker thread 1 (event loop, connections)
  ├── worker thread 2
  └── worker thread N
```

thread-per-core model. each worker thread is independent. no shared data, no contention. envoy adds:

- **lock-free data structures**: no mutexes in the data path
- **connection pooling with circuit breakers**
- **adaptive concurrency**: automatically limit concurrent requests based on latency

**reference**: [envoy threading model](https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310)

## haproxy architecture

haproxy takes it further: process-per-core with CPU pinning. each process is pinned to a specific CPU core, eliminating cross-core cache invalidation.

```bash
# haproxy binds each process to a CPU core
haproxy -f haproxy.cfg
# internally: cpu-map 1 0, cpu-map 2 1, ...
```

**reference**: [haproxy runtime API](https://www.haproxy.com/documentation/haproxy-runtime-api/)

## the zero-copy chain

```
user -> NIC -> kernel buffer -> user space -> kernel buffer -> NIC -> backend
```

traditional proxy: data copied 4 times (kernel -> user, user -> kernel for each direction). with sendfile/splice:

```
user -> NIC -> kernel buffer -> NIC -> backend
```

zero copies. this is how nginx serves static files at line rate.

```c
// zero-copy with splice()
splice(client_fd, NULL, pipe_fd, NULL, len, SPLICE_F_MOVE);
splice(pipe_fd, NULL, backend_fd, NULL, len, SPLICE_F_MOVE);
```

**reference**: [zero copy in linux](https://www.linuxjournal.com/article/6345)

## the modern stack

| proxy | connections | best for |
|-------|------------|----------|
| nginx | 100k+ | HTTP, static files, reverse proxy |
| envoy | 100k+ | service mesh, gRPC, L7 routing |
| haproxy | 500k+ | TCP/HTTP, extreme performance |
| caddy | 10k+ | simple setup, auto HTTPS |
| traefik | 10k+ | docker/k8s, auto discovery |

## tuning for 100k connections

```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535          # listen backlog
net.ipv4.tcp_max_syn_backlog = 65535 # SYN backlog
net.ipv4.ip_local_port_range = 1024 65535
fs.file-max = 2000000
fs.nr_open = 2000000

# per-process limits
* soft nofile 1000000
* hard nofile 1000000
```

## further reading

- [nginx architecture — how we designed for performance & scale](https://www.nginx.com/blog/inside-nginx-how-we-designed-for-performance-scale/)
- [envoy threading model](https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310)
- [zero copy in linux](https://www.linuxjournal.com/article/6345)
