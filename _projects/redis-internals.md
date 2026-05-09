---
title: why redis is not just a simple key-value store
slug: redis-internals
date: May 10, 2026
description: the data structures, persistence models, replication topologies, and scaling strategies that make redis one of the most versatile databases in production.
---

redis is sold as "a fast key-value store." that's like calling postgres "a thing that stores rows." redis ships with 10 data types, 3 persistence strategies, 3 replication topologies, a pub/sub engine, a stream processor, a lua runtime, and a cluster mode that shards across 1000 nodes. here is what's actually inside.

## the single-threaded lie

redis is single-threaded for command execution. one thread processes all client commands sequentially. this is why `KEYS *` blocks the entire server — while it runs, no other command executes.

but redis is NOT single-threaded everywhere:

- **I/O threading (since 6.0)**: network read/write can use multiple threads. command execution stays single-threaded, but the expensive `read()`/`write()` syscalls are offloaded.
- **background saves**: `BGSAVE` forks the process. the child writes the RDB file while the parent continues serving requests.
- **AOF rewrite**: same fork model. the child writes a compacted AOF, the parent buffers new writes.
- **lazy free (since 4.0)**: `UNLINK`, `FLUSHDB ASYNC`, and key expiry can free memory in a background thread instead of blocking the main thread.

**reference**: [redis I/O threading](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)

## the event loop

redis uses epoll (linux), kqueue (bsd/macos), or select (fallback) for I/O multiplexing:

```c
// simplified: redis event loop
while (running) {
    // 1. process timers (expiry, replication)
    aeProcessTimeEvents();
    
    // 2. wait for I/O events with epoll_wait
    int numevents = aeApiPoll(timeout);
    
    // 3. process network events (read commands)
    for (int i = 0; i < numevents; i++) {
        readQueryFromClient(events[i]);
    }
    
    // 4. execute commands (single-threaded, sequential)
    processPendingCommands();
    
    // 5. send responses
    sendReplyToClients();
}
```

every command — `GET`, `SET`, `ZADD`, `PUBLISH` — goes through this loop. the genius is simplicity. no locks. no context switches. no cache line bouncing. one CPU cache, hot.

**reference**: [redis event loop](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)

## the data types you didn't know about

### strings (the obvious one)

```bash
SET key "value"
GET key
INCR counter       # atomic increment
APPEND key "more"  # append to string
GETRANGE key 0 3   # substring
```

strings are binary safe. you can store integers, serialized JSON, protobuf, small images. there's a special integer encoding for values that fit in a `long long` — no heap allocation, just the pointer itself.

### lists (linked lists + quicklists)

```bash
LPUSH queue "job1"
RPOP queue          # pop from right — FIFO
BRPOP queue 5       # blocking pop with timeout
```

internally, redis uses a quicklist — a linked list of ziplists. this avoids the pointer overhead of a pure linked list (two pointers per node) while maintaining O(1) push/pop at both ends.

### sets (hash tables)

```bash
SADD tags:post:1 "redis" "databases" "distributed"
SINTER tags:post:1 tags:post:2   # intersection
SUNION tags:post:1 tags:post:2   # union
SDIFF tags:post:1 tags:post:2    # difference
SCARD tags:post:1                # cardinality
```

sets use hash tables. notable: `SINTER`, `SUNION`, `SDIFF` are O(n) where n is the total number of elements across all sets. don't run these on million-element sets in production.

### sorted sets (hash table + skip list)

```bash
ZADD leaderboard 1500 "player42"
ZADD leaderboard 1200 "player17"
ZRANK leaderboard "player42"    # rank (0-indexed)
ZREVRANGE leaderboard 0 9       # top 10
ZRANGEBYSCORE leaderboard 1000 2000
```

sorted sets combine a hash table (O(1) score lookup) and a skip list (O(log n) range queries). this is the data structure behind leaderboards, rate limiters, and priority queues.

the skip list is layered linked lists with probabilistic level assignment. each higher level skips elements:

```
level 3:  5 ───────────────────────── 80
level 2:  5 ──────── 30 ───────────── 80
level 1:  5 ── 15 ── 30 ── 55 ─────── 80
level 0:  5 → 10 → 15 → 20 → 30 → 40 → 55 → 65 → 80
```

to find rank of 55: start at level 3, jump to 5, drop to level 2, jump to 30, drop to level 1, jump to 55. 4 hops. linear scan would be 7.

**reference**: [redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)

### hashes (hash tables with encoding tricks)

```bash
HSET user:42 name "alice" email "alice@example.com"
HGET user:42 name
HGETALL user:42
```

hashes use two encodings:
- **ziplist**: for small hashes (<512 entries, <64 bytes per field). contiguous memory, no pointers. compact but O(n) access.
- **hashtable**: for larger hashes. standard hash table with separate chaining. O(1) access.

redis switches from ziplist to hashtable automatically (`hash-max-ziplist-entries`, `hash-max-ziplist-value`).

### streams (append-only logs)

```bash
XADD mystream * sensor 42 temp 23.5
XREAD COUNT 2 STREAMS mystream 0
XREADGROUP GROUP mygroup consumer1 COUNT 1 STREAMS mystream >
```

streams are redis's answer to kafka. they're append-only logs with consumer groups, acknowledgments, and pending entry lists. not as feature-rich as kafka but built-in and zero-dependency.

### bitmaps and hyperloglog

```bash
SETBIT online:2024-01-01 42 1    # user 42 was online
BITCOUNT online:2024-01-01        # how many users online
BITOP AND result key1 key2        # bitwise AND

PFADD visitors:homepage user1 user2 user3
PFCOUNT visitors:homepage         # approximate unique count
```

hyperloglog uses 12KB of memory to count billions of unique elements with ~0.81% error. it's based on observing the longest run of leading zeros in hashed values — a probabilistic counter that is remarkably accurate.

### geospatial

```bash
GEOADD locations 13.361389 38.115556 "Palermo"
GEORADIUS locations 15 37 200 km   # cities within 200km
GEODIST locations "Palermo" "Catania" km
```

geo uses sorted sets internally. coordinates are encoded as 52-bit integers (geohash). `ZRANGEBYSCORE` becomes `GEORADIUS`.

**reference**: [redis data types](https://redis.io/docs/latest/develop/data-types/)

## persistence: three models, three tradeoffs

### RDB (snapshot)

redis forks the process and writes the entire dataset to disk:

```
redis process → fork() → child writes dump.rdb → child exits
                parent continues serving requests
```

RDB is a point-in-time snapshot. between snapshots, data can be lost. but the file is compact, fast to load, and great for backups.

```
save 900 1     # save if 1 key changed in 900 seconds
save 300 10    # save if 10 keys changed in 300 seconds
save 60 10000  # save if 10000 keys changed in 60 seconds
```

the fork can be expensive. if redis is using 20GB of memory, the fork copies page tables (not data, thanks to copy-on-write) but the kernel must have enough memory overhead available.

### AOF (append-only file)

every write command is appended to a log:

```
*3
$3
SET
$3
key
$5
value
```

AOF can be fsynced on every write (safest, slowest), every second (default, reasonable), or never (fastest, most data loss). AOF files grow unboundedly — use `BGREWRITEAOF` to compact.

### RDB + AOF (hybrid, since 5.0)

you can use both. restart loads the AOF (more durable). RDB is used for backups. best of both worlds.

**reference**: [redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)

## replication: how redis scales reads

redis replication is asynchronous by default:

```
master ──replication stream──→ replica 1
  │                            replica 2
  └───────────────────────────→ replica 3
```

the replication process:
1. replica connects to master, sends `PSYNC`
2. master forks, creates RDB snapshot
3. master sends RDB to replica, buffers new writes
4. replica loads RDB, then replays buffered writes
5. steady state: master streams every write to replicas

replication is asynchronous. if the master crashes before a write reaches replicas, that write is lost. redis calls this "eventual consistency." you can enable `WAIT` to block until N replicas acknowledge:

```bash
SET key value
WAIT 2 1000  # wait for 2 replicas, timeout 1000ms
```

this gives you synchronous replication on a per-command basis, but at a latency cost.

**reference**: [redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)

## sentinel: automatic failover

sentinel is a separate process that monitors redis instances:

```
sentinel 1 ──┐
sentinel 2 ──┼── monitor master
sentinel 3 ──┘
```

sentinels form a quorum. when a majority agree the master is down, they elect a new master from the replicas and reconfigure all clients. sentinels also discover each other via redis pub/sub — self-organizing, no static config.

minimum deployment: 3 sentinels (requires 2 to agree). sentinel doesn't proxy traffic — clients connect to redis directly but ask sentinel for the current master address.

## cluster: how redis scales writes

redis cluster shards data across multiple nodes using hash slots:

```
hash_slot = CRC16(key) % 16384
node = slot_to_node[hash_slot]
```

there are 16,384 hash slots. each node owns a range. when you add a node, slots are migrated. keys have hash tags — `{user:42}:name` and `{user:42}:email` hash to the same slot (the part inside `{}` is used for hashing).

cluster limitations:
- multi-key operations work only on keys in the same slot
- transactions (`MULTI/EXEC`) are per-node, not cross-node
- lua scripts can access only keys in a single slot
- no guarantee of strong consistency (replication is async)

but for sharding writes across nodes, it works. a 3-node cluster with 3 replicas handles 500K ops/s. add 7 more nodes: 10 nodes, ~1.5M ops/s.

**reference**: [redis cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)

## memory management

redis stores everything in memory. when memory runs out, it evicts:

```
maxmemory-policy:
  noeviction       — return error on writes
  allkeys-lru      — evict least recently used (approximated)
  allkeys-lfu      — evict least frequently used (since 4.0)
  volatile-lru     — evict LRU keys with TTL
  allkeys-random   — evict random keys
```

the LRU is sampled, not exact. redis samples 5 keys (configurable), evicts the least recently used among them. this avoids maintaining a precise LRU list (which would require locks and pointer updates on every access — expensive for a single-threaded server).

LFU in redis 4.0 uses the Morris counter — a probabilistic counter that uses 8 bits per key. it approximates access frequency without storing full timestamps.

**reference**: [redis LRU](https://redis.io/docs/latest/develop/reference/eviction/)

## transactions and lua

redis transactions are not ACID:

```bash
MULTI
SET key1 value1
SET key2 value2
EXEC
```

all commands between `MULTI` and `EXEC` are queued and executed atomically. but there's no rollback — if `SET key2` fails (wrong type), `SET key1` still succeeds. no isolation either — another client can read `key1` between the `SET` and `EXEC` on a replica.

lua scripts are the real atomic primitive:

```lua
-- atomic: no other command can interleave
local current = redis.call('GET', KEYS[1])
if tonumber(current) > 0 then
    redis.call('DECR', KEYS[1])
    return current - 1
end
return 0
```

lua scripts execute atomically. while a script runs, no other command executes. this is both powerful and dangerous — a long-running script blocks the entire server. redis kills scripts that run longer than 5 seconds by default (`lua-time-limit`).

**reference**: [redis transactions](https://redis.io/docs/latest/develop/interact/transactions/)

## pub/sub: fire and forget

```bash
PUBLISH channel "message"    # publisher
SUBSCRIBE channel             # subscriber — blocking
PSUBSCRIBE events:*           # pattern subscription
```

pub/sub is simple: messages are delivered to all subscribers. no history, no replay, no persistence. if no one is subscribed, the message is dropped. for durable messaging, use streams.

## what redis won't do for you

| redis does | redis doesn't do |
|-----------|-----------------|
| in-memory operations (<1ms) | disk-based queries (use postgres) |
| simple data structures | complex joins (use SQL) |
| eventual consistency | strong consistency (use etcd) |
| single-threaded correctness | parallel compute (use your app) |
| up to ~250GB per instance (realistic) | petabyte datasets (use S3/parquet) |
| pub/sub + streams | exactly-once delivery (use kafka) |

redis thrives when your working set fits in memory, your data model is simple, and you need sub-millisecond latency. it struggles when you need complex queries, strong consistency guarantees, or datasets larger than available RAM.

## further reading

- [redis data types](https://redis.io/docs/latest/develop/data-types/)
- [redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [redis cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [redis LRU eviction](https://redis.io/docs/latest/develop/reference/eviction/)
