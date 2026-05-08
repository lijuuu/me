---
title: implementing consistent hashing without breaking half the cluster
slug: consistent-hashing-without-breaking-cluster
date: February 28, 2026
description: consistent hashing for distributed caches, load balancing, and sharding. virtual nodes, hash ring implementation, and migration strategies.
---

consistent hashing solves the problem of distributing keys across servers that come and go. when a server joins or leaves, only a fraction of keys need to move. here is how to implement it correctly.

## why modulo hashing fails

```go
func getServer(key string) int {
    return hash(key) % numServers
}
```

when a server is added, `numServers` changes. every key maps to a different server. cache invalidated. massive thundering herd to the database.

## the hash ring

```
hash space: [0, 2^64-1]
servers placed on ring by hash(server_id)
key maps to: first server clockwise on the ring
```

when a server joins: keys between it and the next server move to it. other keys stay. when a server leaves: keys move to the next server clockwise.

**reference**: [consistent hashing paper](https://www.cs.princeton.edu/courses/archive/fall07/cos518/papers/chash.pdf) — karger et al.

## virtual nodes: the key improvement

without virtual nodes, one server might get 30% of keys while another gets 5%. virtual nodes fix this:

```go
const virtualNodesPerServer = 150

func addServer(ring *HashRing, serverID string) {
    for i := 0; i < virtualNodesPerServer; i++ {
        hash := hash(fmt.Sprintf("%s-%d", serverID, i))
        ring.Add(hash, serverID)
    }
}
```

each server gets 150 points on the ring. key distribution becomes uniform. when a server joins, keys from ~150 small ranges move (spread across all servers).

## implementation in go

```go
type HashRing struct {
    nodes  map[uint64]string
    hashes []uint64
    mu     sync.RWMutex
}

func (r *HashRing) Get(key string) string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    if len(r.nodes) == 0 { return "" }
    h := hash(key)
    idx := sort.Search(len(r.hashes), func(i int) bool {
        return r.hashes[i] >= h
    })
    if idx == len(r.hashes) { idx = 0 }
    return r.nodes[r.hashes[idx]]
}
```

## real-world uses

### discord's guild sharding
each discord guild (server) is assigned to a backend by consistent hashing. when backends are added, only some guilds migrate. migration is done lazily — guild moves when it's next accessed.

**reference**: [how discord shards guilds](https://discord.com/blog/how-discord-handles-millions-of-concurrent-connections)

### memcached/redis clusters
consistent hashing distributes cache keys. when a node fails, only 1/N keys need to be recomputed from the database.

### CDN request routing
akamai, cloudflare: consistent hashing routes requests to the nearest edge server with the cached content.

## the migration problem

when a server joins the ring:
1. new server gets some key range
2. those keys are now served by the new server (which has empty cache)
3. cache misses cascade to the database

solutions:
- **lazy migration**: old server continues serving until cache is warm on new server
- **copied migration**: new server copies cache from neighbor before taking traffic
- **gradual ring join**: add virtual nodes slowly over time to spread the cache miss load

**reference**: [consistent hashing with bounded loads](https://arxiv.org/abs/1608.01350) — google research

## bounded-load consistent hashing

standard consistent hashing: keys move to the next server. if that server was already heavily loaded, it gets more load. bounded-load variant: if next server is overloaded, skip to the next one.

```go
func BoundedLoad(key string, maxLoad float64) string {
    for i := 0; i < len(servers); i++ {
        server := ring.Get(key, i) // i-th server clockwise
        if server.Load() < maxLoad * avgLoad {
            return server
        }
    }
    return ring.Get(key, 0) // fallback
}
```

this prevents hot spots when servers join/leave.
