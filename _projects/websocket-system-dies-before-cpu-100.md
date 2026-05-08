---
title: why your websocket system dies long before CPU hits 100%
slug: websocket-system-dies-before-cpu-100
date: March 22, 2026
description: file descriptor limits, TCP buffer bloat, goroutine leaks, and the hidden bottlenecks in websocket infrastructure.
---

a monitoring dashboard shows CPU at 40%. the websocket server can't accept new connections. after restart, connections flood back, and 5 minutes later it's dead again. here is what's actually happening.

## file descriptors: the silent killer

every TCP connection consumes a file descriptor. linux defaults to 1024 per process. a websocket server with 1000 connections hits this immediately.

```bash
# check current limit
ulimit -n

# set for current session
ulimit -n 65536

# persist in /etc/security/limits.conf
* soft nofile 65536
* hard nofile 65536
```

but the kernel also has limits:
```bash
# system-wide max
cat /proc/sys/fs/file-max

# current usage
cat /proc/sys/fs/file-nr
```

**reference**: [linux file descriptors and ulimit](https://www.kernel.org/doc/html/latest/admin-guide/sysctl/fs.html)

## TCP buffer pressure

each connection has a send and receive buffer. linux default: ~128KB send, ~128KB receive. at 10k connections: 2.5 GB just for TCP buffers.

when a client reads slowly (mobile, bad network), the server's send buffer fills up. `write()` returns EAGAIN. your application blocks or buffers in memory. memory climbs. GC pauses stretch. throughput tanks.

```go
// set per-connection buffer sizes
conn.SetWriteBuffer(4096)  // 4KB per connection
conn.SetReadBuffer(4096)
```

**reference**: [TCP tuning in linux](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)

## the goroutine-per-connection trap

```go
for {
    conn, _ := listener.Accept()
    go handleConn(conn)  // 1 goroutine per connection
}
```

10k connections = 10k goroutines. each goroutine = 2-8KB minimum stack. 10k * 4KB = 40MB minimum. but the real cost is scheduling overhead: the go runtime must check each goroutine for readiness, causing scheduler latency at scale.

fix: use epoll/kqueue directly or use a library like `gnet` or `evio`.

**reference**: [million websockets with go](https://www.freecodecamp.org/news/million-websockets-and-go/)

## the close_wait time bomb

```bash
ss -tan state time-wait | wc -l  # should be small
ss -tan state close-wait | wc -l  # if large, you have a bug
```

CLOSE_WAIT means the remote side sent FIN, but your application never called `close()`. this is always a bug — you're leaking connections. check your connection handling code.

**reference**: [TCP state diagram explained](https://www.ibm.com/docs/en/zos-basic-skills?topic=2-tcpip-state-transition-diagram)

## the sync flood

if the websocket server authenticates on connect, a restart causes all clients to reconnect simultaneously. that's a thundering herd:

```
5 seconds after restart:
- 10k TCP SYNs arrive
- 10k TLS handshakes complete
- 10k websocket upgrades
- 10k authentication requests
```

fix: stagger reconnects on the client side:
```js
const delay = Math.random() * 5000;
setTimeout(() => connect(), delay);
```

## epoll: the kernel's perspective

linux epoll uses a red-black tree for O(log n) event management. at 10k fds, epoll_wait is efficient. at 100k, you should start benchmarking. at 500k, consider sharding across processes.

```bash
# check epoll usage
cat /proc/sys/fs/epoll/max_user_watches  # default: ~800k on modern kernels
```

**reference**: [epoll man page](https://man7.org/linux/man-pages/man7/epoll.7.html)

## the mental model

| bottleneck | threshold | symptom |
|-----------|-----------|---------|
| file descriptors | ~1024 default | can't accept() |
| TCP buffers | ~10k conn * buffer | memory exhaustion |
| goroutines | ~100k | scheduler latency |
| epoll | ~500k fds | epoll_wait() slows |
| bandwidth | varies | send buffer fills |
