---
title: the backend engineering behind chat applications at scale
slug: backend-engineering-chat-applications-scale
date: March 12, 2026
description: message fanout, presence, read receipts, message ordering, and the infrastructure decisions behind WhatsApp and Discord.
---

chat applications look simple: send a message, it appears. but at scale, every step of that flow requires careful engineering.

## message fanout: the core problem

a user sends a message to a group with 1000 members. the message must reach all 1000 online members quickly. options:

### naive: write to DB, clients poll
```sql
SELECT * FROM messages WHERE chat_id = $1 ORDER BY id DESC LIMIT 50
```
works for <100 users. falls apart at scale: N users polling every 2 seconds = N/2 QPS minimum, even when there are no messages.

### better: websocket push
server maintains persistent connections. writes message to all recipients' websockets directly. problem: for a 1000-person group, server does 1000 `conn.Write()` calls. serial execution is slow.

### best: pub/sub fanout
```go
// message arrives at server
server.Publish(chatID, message)

// each server instance subscribes to its users' chats
for _, user := range usersInChat {
    conn := connections[user.ID]
    conn.Write(message)
}
```

this distributes fanout work across servers. a message to 1000 users across 10 servers means each server handles ~100 writes.

**reference**: [discord's message fanout](https://discord.com/blog/how-discord-stores-billions-of-messages) — how they handle trillions of messages

## message ordering: the hidden nightmare

in a distributed system, messages from a user may arrive at different servers in different orders. causal consistency is hard:

```
user: "his name is bob" (msg 1)
user: "actually, his name is rob" (msg 2)
```

if msg 2 arrives before msg 1 at a recipient, they see the correction before the original. solutions:
- lamport timestamps (logical clocks)
- server-assigned sequence numbers per chat
- hybrid logical clocks

**reference**: [lamport timestamps explained](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)

## presence: the expensive problem

"'user is online' costs more than expected." each user:
1. connects (presence = online)
2. disconnects (presence = offline)
3. reconnects (network flapping = presence thrashing)

at 10M users, reconnection storms generate millions of presence updates per second.

discord's approach: presence updates are best-effort, not guaranteed. friends list presence is immediate. server member lists update every few seconds. presence isn't a database — it's a cache.

**reference**: [how discord handles presence](https://discord.com/blog/how-discord-handles-millions-of-concurrent-connections)

## read receipts at scale

every read receipt is a write. in a group with 1000 members, one message generates 1000 read receipt writes. at 10M messages/day: 10B read receipt writes. naive approach (one write per receipt) kills any database.

optimizations:
- batch receipts in memory, flush periodically
- don't persist receipts — treat them as ephemeral state
- use gossip protocols instead of server-authoritative receipts

## the message delivery guarantee problem

| guarantee | cost | implementation |
|-----------|------|---------------|
| at-most-once | free | send and forget |
| at-least-once | cheap | ack + retry |
| exactly-once | expensive | dedup + idempotency |

most chat apps use at-least-once with client-side deduplication. each message has a unique ID; clients ignore duplicates.

**reference**: [whatsapp engineering blog](https://engineering.fb.com/category/security/) — message delivery at scale

## the storage architecture

messages are write-heavy, read-heavy, and immutable once written. ideal storage:
- hot messages (last 30 days): in-memory or SSD
- warm messages (30-365 days): fast object storage
- cold messages (>1 year): compressed archive

discord migrated from cassandra to scylladb for hot storage. whatsapp built a custom LSM-tree database.

## the infrastructure footprint

| metric | small chat | discord scale |
|--------|-----------|---------------|
| DAU | 10k | 150M |
| messages/day | 100k | 1B+ |
| concurrent websockets | 1k | 12M+ |
| servers | 3 | 1000+ |
| datacenters | 1 | multi-region |

## further reading

- [discord — how discord stores billions of messages](https://discord.com/blog/how-discord-stores-billions-of-messages)
- [how discord handles millions of concurrent connections](https://discord.com/blog/how-discord-handles-millions-of-concurrent-connections)
- [lamport — time, clocks, and the ordering of events](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
