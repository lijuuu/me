---
title: the networking bug that only happens at exactly 2am on tuesdays
slug: networking-bug-2am-tuesdays
date: May 9, 2026
description: a real debugging story about a production outage that only triggered during cron jobs, conntrack tables, and the kernel parameter nobody checks.
---

at 2:00 AM every tuesday, production went down. not 2:01. not 1:59. exactly 2:00. the database was fine. CPU was fine. the application couldn't connect to anything.

## the initial investigation

the symptom: every TCP connection from the application server returned `Connection refused` or hung. established connections continued working. new connections failed.

first check: `dmesg`

```
nf_conntrack: table full, dropping packet
```

there it is. the connection tracking table was full. but why only at 2am on tuesdays?

**reference**: [netfilter conntrack](https://www.kernel.org/doc/html/latest/networking/nf_conntrack.html)

## what conntrack does

linux connection tracking (conntrack) maintains a table of every network connection flowing through the machine. each entry tracks:

```
src=10.0.1.5 dst=10.0.2.3 sport=54321 dport=5432 proto=tcp state=ESTABLISHED
```

the table size is limited:

```bash
cat /proc/sys/net/netfilter/nf_conntrack_max
# 262144  (auto-scaled by kernel: ~ RAM in bytes / 16384)

cat /proc/sys/net/netfilter/nf_conntrack_count
# 262144  ← full!
```

when the table is full, the kernel drops new connections. established connections continue because they're already tracked.

**reference**: [netfilter conntrack](https://www.kernel.org/doc/html/latest/networking/nf_conntrack.html)

## the 2am connection

what runs at 2am on tuesdays? cron. specifically, a cleanup job that scans all user data. it opens a connection to the database, processes millions of rows, and closes the connection. over and over. but each closed connection leaves a conntrack entry in `TIME_WAIT` state.

`TIME_WAIT` entries stay in the table for 120 seconds (default `net.netfilter.nf_conntrack_tcp_timeout_time_wait`). the cleanup job opened 50,000 connections in under 2 minutes. that's 50,000 entries. with 200,000 existing entries from normal traffic, the table hit 262,144. full.

```bash
# check current conntrack count
cat /proc/sys/net/netfilter/nf_conntrack_count

# check TIME_WAIT entries
conntrack -L -p tcp --state TIME_WAIT | wc -l
```

## the fix

### immediate: increase the table size

```bash
echo 524288 > /proc/sys/net/netfilter/nf_conntrack_max
```

this doubles the table. but it doesn't fix the root cause.

### permanent: reduce TIME_WAIT timeout

```bash
echo 30 > /proc/sys/net/netfilter/nf_conntrack_tcp_timeout_time_wait
```

default is 120 seconds. reducing to 30 seconds means TIME_WAIT entries are cleaned up faster. but this is a tradeoff — too short and you risk port reuse issues.

### root cause: connection pooling

the cleanup job was opening a new connection for every query instead of reusing one:

```go
// bad: new connection per query
for _, user := range users {
    db, _ := sql.Open("postgres", dsn)
    db.Query("SELECT * FROM orders WHERE user_id = $1", user.ID)
    db.Close()
}

// good: reuse connection
db, _ := sql.Open("postgres", dsn)
db.SetMaxOpenConns(10)
db.SetMaxIdleConns(5)
for _, user := range users {
    db.Query("SELECT * FROM orders WHERE user_id = $1", user.ID)
}
```

**reference**: [go database/sql connection pool](https://pkg.go.dev/database/sql#DB)

## the checklist for every server

conntrack is one of those things nobody checks until it kills production. add these to your standard server setup:

```bash
# increase max entries (memory cost: ~300 bytes per entry)
echo 1048576 > /proc/sys/net/netfilter/nf_conntrack_max

# reduce TIME_WAIT timeout
echo 30 > /proc/sys/net/netfilter/nf_conntrack_tcp_timeout_time_wait

# monitor
watch -n 1 'cat /proc/sys/net/netfilter/nf_conntrack_count'
```

## the other 2am bugs

conntrack isn't the only thing that only breaks during cron windows:

- **log rotation**: `logrotate` runs, moves the application log file, the application keeps writing to the old file descriptor. disk fills up.
- **certificate expiry**: TLS certificates expire at midnight UTC. your cert-check cron runs at 2am. it finds the cert expired 2 hours ago.
- **DNS TTL expiry**: a DNS record expires. the next resolution takes 2 seconds because the upstream DNS server is slow. your application timeout is 1 second.
- **database autovacuum**: postgres autovacuum kicks in, locks tables, blocks your 2am batch job. the batch job times out, leaves a transaction open, blocks everything else.

## the lesson

if a bug only happens at a specific time, look for scheduled jobs. cron, systemd timers, kubernetes CronJobs, database maintenance windows — something is running at that time and colliding with normal traffic. the bug isn't in your application code. it's in the interaction between scheduled work and system limits.

## further reading

- [netfilter conntrack documentation](https://www.kernel.org/doc/html/latest/networking/nf_conntrack.html)
- [conntrack performance analysis](https://thermalcircle.de/doku.php?id=blog:linux:netfilter_conntrack_performance)
- [TCP tuning in linux](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)
