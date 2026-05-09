---
title: building scalable leaderboards with redis sorted sets
slug: scalable-leaderboards-redis-sorted-sets
date: May 10, 2026
description: how RedisBoard uses redis sorted sets, skip lists, and atomic pipelines to build leaderboards that handle global and per-entity rankings at scale.
---

leaderboards look simple — a sorted list of scores. but at scale, you need random rank lookups, per-entity grouping, and atomic score updates. a binary heap falls apart. redis sorted sets don't. here is how RedisBoard does it.

## RedisBoard overview

[RedisBoard](https://github.com/lijuuu/RedisBoard) is a go library for redis-backed leaderboards. it handles global rankings, per-entity rankings (by country, by server, by team), and atomic score updates — all through a clean API backed by redis sorted sets.

**reference**: [RedisBoard](https://github.com/lijuuu/RedisBoard)

## why not a binary heap

a binary heap is O(log n) for insert and pop. but leaderboards need more:

```
operation          | heap        | redis sorted set
-------------------|-------------|--------------------
insert/update      | O(log n)    | O(log n)
get top-k          | O(k log n)  | O(log n + k)
get random rank    | O(n)        | O(log n)
get score by ID    | O(n)        | O(1)
persistence        | manual      | built-in
entity grouping    | N heaps     | N sorted sets
```

the killer is random rank lookup. a heap must scan every element to find a specific user's position. redis sorted sets do it in O(log n) because they're backed by a skip list.

## the skip list underneath

redis sorted sets use two data structures together:
- a **hash table**: maps member → score. O(1) lookups for `ZSCORE`.
- a **skip list**: ordered linked list with express lanes. O(log n) for `ZRANK`, `ZRANGE`, and inserts.

a skip list works by layering linked lists. the bottom layer has every element. each higher layer skips elements probabilistically:

```
level 2:  5 ──────────────── 25 ──────────────── 45
level 1:  5 ───── 15 ──────── 25 ───── 35 ─────── 45
level 0:  5 → 10 → 15 → 20 → 25 → 30 → 35 → 40 → 45
```

to find rank of 35: start at level 2, jump to 25, drop to level 1, jump to 35. three hops instead of six linear steps. this is why `ZRANK` is O(log n): the number of levels is log₂(n), and each level takes constant work.

**reference**: [redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)

## RedisBoard's key structure

RedisBoard organizes data in redis using namespaced keys:

```
{namespace}:global           → sorted set: all users by score
{namespace}:entity:{code}    → sorted set: users in entity by score
{namespace}:user:entities    → hash: user ID → entity code
```

for a game with namespace `game1`:

```
ZADD game1:global 1500 player42
ZADD game1:global 1200 player17
ZADD game1:entity:US 1500 player42
ZADD game1:entity:IN 1200 player17
HSET game1:user:entities player42 US
HSET game1:user:entities player17 IN
```

a user can belong to exactly one entity at a time. changing entities is atomic — the user is removed from the old entity set and added to the new one in a single pipeline.

## atomic operations via pipelining

without pipelining, updating a user's score requires:

```go
// race condition: score is read, then written separately
oldScore := ZSCORE("game1:global", "player42")
ZADD("game1:global", oldScore + 100, "player42")
```

between the read and write, another process could update the same user. RedisBoard uses redis pipelines to make this atomic:

```go
pipe := redis.Pipeline()
pipe.ZIncrBy(ctx, "game1:global", 100, "player42")
pipe.ZIncrBy(ctx, "game1:entity:US", 100, "player42")
_, err := pipe.Exec(ctx)
```

all commands in a pipeline execute atomically. no locks, no race conditions.

## the API

```go
cfg := redisboard.Config{
    Namespace: "game1",
    RedisAddr: "localhost:6379",
}
lb, _ := redisboard.New(cfg)

// add a user with score and entity
lb.AddUser("player42", 1500, "US")

// update score
lb.UpdateScore("player42", 100)

// change entity
lb.UpdateEntity("player42", "UK")

// get global rank
rank, _ := lb.GetRankGlobal("player42")

// get rank within entity
entityRank, _ := lb.GetRankEntity("player42", "UK")

// top 10 globally
top, _ := lb.GetTopKGlobal(10)

// top 10 in US
usTop, _ := lb.GetTopKEntity("US", 10)

// get user's score and entity
score, entity, _ := lb.GetUserData("player42")
```

## namespace isolation

each leaderboard instance uses a namespace prefix. this means you can run multiple leaderboards in the same redis instance without key collisions:

```go
daily := redisboard.Config{Namespace: "daily", RedisAddr: "localhost:6379"}
weekly := redisboard.Config{Namespace: "weekly", RedisAddr: "localhost:6379"}
allTime := redisboard.Config{Namespace: "alltime", RedisAddr: "localhost:6379"}
```

keys never clash: `daily:global`, `weekly:global`, `alltime:global`.

## performance characteristics

redis sorted set operations are O(log n) for member count n. RedisBoard adds no significant overhead — it's a thin wrapper:

| operation | redis commands | complexity |
|-----------|---------------|------------|
| AddUser | ZADD + HSET | O(log n) |
| UpdateScore | ZINCRBY × 2 | O(log n) |
| GetRankGlobal | ZREVRANK | O(log n) |
| GetTopKGlobal | ZREVRANGE | O(log n + k) |
| GetTopKEntity | ZREVRANGE | O(log m + k) where m = entity members |
| GetUserData | ZSCORE + HGET | O(1) |

designed to scale to 1 million users and 200 entities with sub-millisecond response times on modern redis.

## when to use redis vs in-memory

| factor | redis sorted set | in-memory heap |
|--------|-----------------|----------------|
| persistence | yes (RDB/AOF) | no |
| multi-process | yes (shared redis) | no (per-process) |
| replication | yes (sentinel/cluster) | no |
| memory limit | redis maxmemory | process heap |
| latency | ~0.1-1ms (network) | ~0.001ms |
| random rank lookup | O(log n) | O(n) |

for leaderboards that need persistence, scale across processes, or random rank lookups, redis wins. for a single-process, ephemeral top-k leaderboard with <1000 entries, a heap is simpler and faster.

## further reading

- [RedisBoard](https://github.com/lijuuu/RedisBoard)
- [redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/)
- [skip list data structure](https://en.wikipedia.org/wiki/Skip_list)
