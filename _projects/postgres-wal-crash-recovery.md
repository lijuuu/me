---
title: how postgres WAL actually survives a crash
slug: postgres-wal-crash-recovery
date: May 10, 2026
description: the fsync, the checksums, the torn pages, and the write-ahead log that guarantees your committed transactions survive a power failure.
---

you run `COMMIT`. the client gets back `COMMIT` as the response. then the power fails. the database restarts. your transaction is still there. how? the write-ahead log. here is exactly how it works, down to the disk blocks.

## the problem: what happens during a crash

your database has two things: data files (tables, indexes) and in-memory buffers (shared_buffers). when you update a row, postgres modifies the buffer in memory. the dirty page is written to disk later — minutes later, by the checkpointer.

if the power fails between the update and the checkpoint, the data file on disk is stale. the modified page was in memory, never written. without a recovery mechanism, your transaction is gone.

the solution: before modifying any data page, write the change to the WAL. the WAL is a sequential log. every change is recorded there first. on restart, postgres replays the WAL to reconstruct lost changes.

## the WAL rule

the fundamental rule of write-ahead logging:

> **a data page must never be written to disk before the WAL record describing that change is fsynced to disk.**

this is the only thing that guarantees crash recovery. if a data page hits disk but the WAL record for that change hasn't, and the server crashes, the page on disk is ahead of the WAL — and postgres can't recover. the WAL must always be ahead of the data files.

**reference**: [postgres WAL](https://www.postgresql.org/docs/current/wal-intro.html)

## the WAL file structure

WAL is stored in 16MB segment files under `pg_wal/`:

```
pg_wal/
  000000010000000000000001     ← 16MB WAL segment
  000000010000000000000002
  000000010000000000000003
```

each segment is a sequence of WAL records. a WAL record contains:

```
WAL record:
  - LSN (log sequence number): byte position in the WAL stream
  - transaction ID
  - resource manager ID (heap, btree, gin, etc.)
  - operation (insert, update, delete, page split, etc.)
  - before-image (for undo, if needed)
  - after-image (the actual change)
  - checksum (CRC-32C)
```

the LSN is a 64-bit value that's a byte offset from the start of the WAL. `0/16B3748` means 23,779,144 bytes into the WAL stream.

```sql
SELECT pg_current_wal_lsn();
-- 0/2C8B8300

SELECT pg_walfile_name('0/2C8B8300');
-- 00000001000000000000002C
```

**reference**: [postgres WAL internals](https://www.postgresql.org/docs/current/wal-internals.html)

## the write path: from UPDATE to disk

```
1. UPDATE users SET name = 'bob' WHERE id = 1;
2. postgres reads the page from disk into shared_buffers (if not cached)
3. postgres writes the WAL record to the WAL buffer (in memory)
4. postgres modifies the data page in shared_buffers (in memory)
5. postgres marks the page as dirty
6. COMMIT arrives
7. postgres writes the WAL commit record to the WAL buffer
8. postgres calls fsync() on the WAL file (forces WAL buffer to disk)
9. postgres returns 'COMMIT' to the client
10. later (seconds to minutes): checkpointer writes dirty pages to data files
```

the critical sequence: WAL is fsynced BEFORE the client gets `COMMIT`. the data file write happens much later — it can be lost in a crash; postgres will replay the WAL to recover it.

## fsync: the syscall that actually matters

`fsync()` tells the kernel: "flush all buffered writes for this file to the physical disk and don't return until the disk confirms." without `fsync()`, writes sit in the kernel's page cache. if the power fails, the page cache is lost.

```c
write(fd, wal_buffer, wal_size);  // goes to kernel page cache
fsync(fd);                         // flush to disk, block until done
```

postgres calls `fsync()` on the WAL file at every commit (unless `synchronous_commit = off`). this is the latency cost of durability. each commit must wait for a physical disk write — typically 0.1-1ms on SSD, 2-10ms on HDD.

you can trade durability for speed:

```sql
-- default: fsync every commit, safest
SET synchronous_commit = on;

-- fsync every wal_writer_delay (200ms default), lose up to 600ms of transactions
SET synchronous_commit = off;

-- wait for WAL to reach at least the local disk (default)
SET synchronous_commit = local;

-- wait for WAL to reach at least one remote replica
SET synchronous_commit = remote_write;
```

**reference**: [postgres synchronous_commit](https://www.postgresql.org/docs/current/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT)

## the checkpointer: keeping WAL from growing forever

WAL files are needed for crash recovery. but they can't grow forever — disk space is finite. the checkpointer solves this:

1. periodically (every `checkpoint_timeout`, default 300s), postgres writes all dirty pages to data files
2. after all dirty pages for a given LSN are written, WAL before that LSN is no longer needed
3. postgres can remove or recycle old WAL segments

```
WAL:  [old segments] [segments needed for recovery] [new segments]
                         ↑ checkpoint LSN
```

if the checkpointer falls behind (heavy write load), WAL accumulates. `pg_wal/` fills up. the database panics and shuts down. you need enough disk space for WAL during peak write load:

```sql
SELECT pg_size_pretty(pg_wal_size()) AS current_wal_size;

-- estimate peak WAL based on write rate
-- 100MB/s writes × 300s checkpoint = 30GB WAL
```

**reference**: [postgres checkpoint](https://www.postgresql.org/docs/current/sql-checkpoint.html)

## torn pages: when a single page write is not atomic

a postgres data page is 8KB. but a disk sector might be 512 bytes or 4KB. if the power fails while writing a page, the page might be partially written — half old data, half new data. this is a **torn page**.

postgres prevents this with **full page writes**. the first time a page is modified after a checkpoint, the entire 8KB page is written to the WAL (not just the changed bytes). on recovery, the full page image replaces the potentially torn page on disk.

this doubles WAL volume for heavy update workloads. the tradeoff is disk space and WAL throughput vs crash safety:

```sql
-- disable full page writes (faster, less safe)
ALTER SYSTEM SET full_page_writes = off;

-- enable WAL compression (reduces WAL volume by 2-4×)
ALTER SYSTEM SET wal_compression = on;
```

**reference**: [postgres full_page_writes](https://www.postgresql.org/docs/current/runtime-config-wal.html#GUC-FULL-PAGE-WRITES)

## WAL checksums: detecting corruption

every WAL record has a CRC-32C checksum. if a bit flips on disk, the checksum fails. postgres detects this during recovery and stops — refusing to apply corrupted WAL. this is safer than silently applying bad data.

data page checksums are separate:

```sql
-- enable data page checksums (requires initdb, not changeable after)
-- initdb --data-checksums

-- check current setting
SHOW data_checksums;
```

WAL checksums are always on. data page checksums are opt-in at `initdb` time. without them, postgres can't detect corruption in data files — it only detects corruption in WAL.

## the recovery process

when postgres starts after a crash:

```
1. reads the last checkpoint record from pg_control
2. reads the checkpoint's LSN (the starting point for recovery)
3. reads WAL from the checkpoint LSN forward
4. for each WAL record:
   a. verifies the CRC-32C checksum
   b. if it modifies a page that was fully written (full page image), uses that
   c. otherwise, reads the page from the data file and applies the change
5. when all WAL is replayed, opens for normal operations
```

recovery time is proportional to the amount of WAL since the last checkpoint. a checkpoint every 5 minutes means at most 5 minutes of WAL replay. a checkpoint every hour means potentially 1 hour of replay.

## `pg_control`: the bootstrap file

`pg_control` is a small file that survives crashes. it contains:

- the last checkpoint LSN
- the WAL segment where the checkpoint was written
- the database state (shutdown, in production, in recovery)
- the timeline ID (for PITR)

without `pg_control`, postgres doesn't know where recovery starts. the file is written atomically — toggling between two copies — so a crash during the write doesn't corrupt the only copy.

## WAL and replication

WAL is also the foundation of streaming replication. a replica connects to the primary and requests WAL starting from a specific LSN:

```
replica → PRIMARY: START_REPLICATION SLOT slot1 0/2C8B8300
primary → replica: [stream of WAL records from 0/2C8B8300 onward]
```

the primary streams WAL in near-real-time. the replica applies it, staying synchronized. the same WAL that saves you from crashes also enables read replicas, failover, and point-in-time recovery.

## the tradeoff table

| setting | safer | faster |
|---------|-------|--------|
| `synchronous_commit = on` | every commit fsynced | adds fsync latency per commit |
| `full_page_writes = on` | no torn pages | 2x WAL volume |
| `wal_compression = on` | same safety, less space | CPU overhead for compression |
| `data_checksums = on` | detects page corruption | slight CPU overhead |
| short `checkpoint_timeout` | faster recovery | more checkpoint I/O |
| `fsync = on` | durable writes | every write hits disk |

defaults are set for safety, not speed. tune with caution and backups.

## further reading

- [postgres write-ahead log](https://www.postgresql.org/docs/current/wal-intro.html)
- [postgres WAL configuration](https://www.postgresql.org/docs/current/runtime-config-wal.html)
- [postgres checkpoint](https://www.postgresql.org/docs/current/sql-checkpoint.html)
- [postgres reliability](https://www.postgresql.org/docs/current/wal-reliability.html)
