---
title: the hidden complexity behind realtime collaborative systems
slug: realtime-collaborative-systems
date: March 15, 2026
description: a deep dive into OT, CRDT, and the infrastructure that powers realtime collaboration.
photo: /projects/example-project-1.jpg
---

the dream is simple: multiple people typing in the same document, seeing each other's cursors, changes syncing instantly. the reality is anything but.

## the foundational problem

at its core, realtime collaboration is a distributed systems problem dressed up as a UX challenge. when two users type simultaneously, their operations must converge to the same result regardless of network latency, ordering, or disconnection. this is known as the **consistency problem** in distributed systems.

the naive approach — a central server that locks the document — fails instantly under any real load. what you need is a way to merge concurrent edits *without* conflicts.

## OT vs CRDT: the two schools

two major approaches have emerged:

### operational transformation (OT)

ot was pioneered by google docs (2010). the idea: when an operation arrives at the server, it's *transformed* against concurrent operations to maintain consistency.

```
user A inserts "x" at position 5
user B inserts "y" at position 5  
server transforms B's op to position 6
result: both inserts preserved
```

key characteristics:
- requires a central server as the source of truth
- transformation functions must be proved correct for all operation pairs
- complexity grows with O(n²) in worst case

**reference**: [google wave operational transformation](https://en.wikipedia.org/wiki/Google_Wave) — the protocol that popularized OT

**reference**: [ot explained visually](https://operational-transformation.github.io/) — interactive visualizations of OT transforms

### conflict-free replicated data types (CRDT)

crdts take a different approach: design data structures that *always* converge, regardless of operation order.

the most popular for text editing is **RGA** (replicated growable array):
- each character gets a globally unique, ordered identifier
- insertions reference their neighbors
- no central server needed for consistency

**reference**: [CRDT.tech](https://crdt.tech/) — comprehensive resource on CRDT implementations

**reference**: [Yjs documentation](https://docs.yjs.dev/) — the most widely-used CRDT library

**reference**: [automerge](https://automerge.org/) — CRDT library with rich text support

## the hidden complexities

here is what most tutorials don't cover:

### 1. cursor synchronization

showing other users' cursors in realtime is a separate, non-trivial problem. cursors must:
- track user identity and color
- update at high frequency without overwhelming the network
- position correctly even as the text around them changes
- handle edge cases like selections spanning deleted text

### 2. undo/redo

undo in a collaborative context is *fundamentally different* from single-user undo:

```
user A: types "hello"
user B: types " world"
user A hits undo
```

does user A's undo remove "hello"? " world"? everything? the answer depends on whether undo is local (removes own operations), global (removes most recent), or scope-based.

**reference**: [undo in collaborative editing](https://cpsc.yale.edu/sites/default/files/files/tr1500.pdf) — yale research on undo models

### 3. network partitions

crdts handle offline edits beautifully — but merging after hours of disconnected work can produce surprising results. consider two users who each restructure the same paragraph differently while offline. the merge is deterministic but may look nonsensical.

### 4. rich text and media

collaboration isn't just plaintext. images, tables, comments, formatting — each adds a layer of complexity:
- embeds must be position-tracked
- formatting spans can overlap in impossible ways
- comments anchor to positions that may get deleted

**reference**: [prosemirror collaborative editing guide](https://prosemirror.net/docs/guide/#collab) — how prosemirror handles rich text collaboration

### 5. performance at scale

a document with 100 collaborators typing simultaneously generates ~500 ops/second. each op must be:
1. received and ordered
2. transformed (OT) or merged (CRDT)
3. applied to the local document
4. broadcast to all other users

at 1000 users, this becomes ~5000 ops/second — enough to saturate a single-threaded node.js server.

solutions:
- sharding by document
- websocket multiplexing with backpressure
- selective broadcasting (don't send ops to the user who generated them)
- binary protocols over JSON for efficiency

**reference**: [how discord handles millions of concurrent connections](https://discord.com/blog/how-discord-handles-millions-of-concurrent-connections)

## real-world architectures

### google docs (OT-based)
- operations pass through a central server
- server transforms and sequences all ops
- client optimistically applies, server corrects if needed
- benefits: simple mental model, proven at scale
- drawbacks: requires always-on server, latency-dependent

### figma (CRDT-based)
- uses a custom CRDT built on RGA
- document is a tree of objects, not a string
- supports branching and offline editing
- **reference**: [figma's multiplayer technology](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

### linear (sync engine)
- uses a custom sync engine built on CRDT principles
- focuses on structured data (issues, projects) rather than freeform text
- treats the entire workspace as a collaborative document
- **reference**: [linear's sync engine](https://linear.app/blog/the-tech-behind-linear)

## libraries worth exploring

| library | type | language | notes |
|---------|------|----------|-------|
| [yjs](https://docs.yjs.dev/) | CRDT | js | most popular, excellent docs |
| [automerge](https://automerge.org/) | CRDT | js/rust | rich document model |
| [liveblocks](https://liveblocks.io/) | hosted | js | turnkey collaboration api |
| [partykit](https://partykit.io/) | hosted | js | realtime by default |
| [sharejs](https://github.com/josephg/sharejs) | OT | js | the original JS OT library |
| [replicache](https://replicache.dev/) | sync | js | offline-first sync engine |
| [instantdb](https://www.instantdb.com/) | sync | js | graph-based realtime db |
| [convex](https://convex.dev/) | platform | js | realtime backend with react support |

## further reading

- [martin kleppmann's talk on CRDTs](https://www.youtube.com/watch?v=yCcWpzY8dIA) — excellent overview from one of the automerge authors
- [joseph gentle's "5000x faster CRDTs"](https://josephg.com/blog/crdts-go-brrr/) — deep optimization techniques
- [ink & switch's "local-first software"](https://www.inkandswitch.com/local-first/) — manifesto on offline-first collaboration
- [marijn haverbeke's "prosemirror"](https://marijnhaverbeke.nl/blog/collaborative-editing.html) — building a collaborative editor from scratch
- [aphyr's "jepsen" series](https://aphyr.com/tags/jepsen) — testing distributed systems for correctness
- [designing data-intensive applications](https://dataintensive.net/) — book covering distributed consistency (chapters 5, 9)

the bottom line: realtime collaboration is deceptively complex. what appears as a simple text sync is actually a carefully choreographed dance of conflict resolution, network optimization, and user experience design. every library and platform mentioned here is the product of years of research and engineering, and the field is still actively evolving.
