---
title: how your database replicates without corrupting itself
slug: database-replication-internals
date: May 10, 2026
description: the internals of postgres streaming replication — WAL shipping, logical decoding, synchronous vs asynchronous, replication slots, and why lag matters.
---

you run a primary database. you add a replica. data appears on it. but between the `INSERT` and the replica seeing it, a chain of events unfolds involving WAL records, network streaming, fsync coordination, and a careful dance around consistency. here is the full picture.

## why replicate at all

replication serves three purposes:

| purpose | what it gives you | example |
|---------|-------------------|---------|
| read scaling | spread read queries across replicas | reporting queries, search |
| high availability | failover to a replica if primary dies | automatic failover with patroni |
| disaster recovery | offsite copy survives region failure | cross-region replica |

each purpose has different consistency requirements. a reporting replica can lag 30 seconds behind. a failover replica must be nearly synchronous.

**reference**: [postgres replication](https://www.postgresql.org/docs/current/high-availability.html)

## physical replication: the default

postgres physical (streaming) replication ships WAL records from primary to replica:

```
primary:  [WAL write] → [WAL stream] → replica: [WAL receive] → [WAL apply]
```

the primary generates WAL (write-ahead log) for every change. the replica connects to the primary using a replication protocol, receives WAL records as a continuous stream, and applies them to its own data files. the replica is a byte-for-byte copy of the primary at some point in the past.

this is called physical replication because it replicates physical page changes — not SQL statements.

### setting up streaming replication

on the primary:

```sql
-- create a replication user
CREATE ROLE replicator WITH LOGIN REPLICATION PASSWORD 'secret';

-- allow replication in pg_hba.conf
-- host replication replicator 10.0.1.0/24 md5

-- create a replication slot (prevents WAL cleanup)
SELECT pg_create_physical_replication_slot('replica1');
```

on the replica:

```bash
# take a base backup
pg_basebackup -h primary -U replicator -D /var/lib/postgresql/data -R

# the -R flag creates:
#  /var/lib/postgresql/data/standby.signal  (tells postgres this is a replica)
#  /var/lib/postgresql/data/postgresql.auto.conf:
#    primary_conninfo = 'host=primary user=replicator password=secret'
#    primary_slot_name = 'replica1'
```

start the replica. it connects to the primary, requests WAL from the last LSN it received, and begins streaming.

**reference**: [postgres streaming replication](https://www.postgresql.org/docs/current/warm-standby.html)

## replication slots: the safety net

a replication slot tells the primary: "don't delete WAL that this replica hasn't received yet."

without a slot, if the replica disconnects for a while, the primary could remove WAL that the replica needs. when the replica reconnects, it asks for a WAL segment that no longer exists. recovery is impossible — the replica must be rebuilt from a new base backup.

with a slot:

```
primary WAL:
  [slot pins this WAL]  [new WAL]
  └── replica1 needs this
```

the slot prevents WAL cleanup until the replica confirms it has received and applied the WAL. the tradeoff: if the replica is down for days, WAL accumulates on the primary. disk fills up. the primary panics.

```sql
-- check replication lag (in bytes)
SELECT slot_name,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS lag_bytes
FROM pg_replication_slots;

-- if lag_bytes grows unchecked, disk fills up
-- drop the slot if replica is permanently gone
SELECT pg_drop_replication_slot('replica1');
```

**reference**: [postgres replication slots](https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION-SLOTS)

## synchronous vs asynchronous

### asynchronous (default)

the primary writes WAL, streams it to the replica, and returns `COMMIT` to the client immediately. the replica applies it later — milliseconds to seconds later. if the primary crashes, committed transactions that haven't reached the replica are lost.

```
client:   INSERT ──→ primary: WAL write, COMMIT ✓ (replica lag: 50ms)
                     primary: stream WAL → replica
```

### synchronous

the primary waits for the replica to confirm WAL receipt before returning `COMMIT`. the replica doesn't need to apply the WAL — just receive it and fsync it.

```
client:   INSERT → primary: WAL write
                  primary: stream WAL → replica
                  replica: WAL receive + fsync ✓
                  primary: COMMIT → client ✓
```

this guarantees zero data loss on failover. the cost: every commit waits for a network round trip to the replica plus a disk fsync on the replica. latency increases by 1-5ms on same-region, 50-150ms on cross-region.

```sql
-- configure synchronous replication
-- primary: postgresql.conf
synchronous_commit = on
synchronous_standby_names = 'replica1'

-- commit will wait until replica1 confirms WAL receipt
```

**reference**: [postgres synchronous replication](https://www.postgresql.org/docs/current/runtime-config-replication.html#GUC-SYNCHRONOUS-STANDBY-NAMES)

## replication lag: the metric that matters

replication lag is the delay between the primary writing a transaction and the replica applying it:

```sql
-- on primary: current WAL position
SELECT pg_current_wal_lsn();

-- on replica: last WAL position applied
SELECT pg_last_wal_replay_lsn();

-- lag in bytes
SELECT pg_wal_lsn_diff(
    pg_current_wal_lsn(),       -- from primary
    pg_last_wal_replay_lsn()    -- from replica
);
```

sources of lag:

| cause | fix |
|-------|-----|
| network latency | move replica closer physically |
| slow replica disk I/O | faster disk, increase `wal_receiver_status_interval` |
| heavy write load on primary | more checkpoints, faster WAL streaming |
| replica busy with long queries | reduce `max_standby_streaming_delay` |
| recovery conflict (query holds lock) | set `hot_standby_feedback = on` |

`hot_standby_feedback` tells the primary that a replica has a long-running query. the primary delays vacuuming rows the replica still needs. the tradeoff: primary table bloat vs replica query cancellation.

**reference**: [postgres hot standby](https://www.postgresql.org/docs/current/hot-standby.html)

## logical replication: replicating specific tables

physical replication copies everything. every table. every index. every write. logical replication copies specific tables — or specific rows — using a publish/subscribe model:

```sql
-- on primary: create a publication
CREATE PUBLICATION orders_pub FOR TABLE orders;

-- on replica: create a subscription
CREATE SUBSCRIPTION orders_sub
CONNECTION 'host=primary dbname=mydb'
PUBLICATION orders_pub;
```

logical replication uses **logical decoding** — postgres converts WAL records back into SQL changes (`INSERT`, `UPDATE`, `DELETE`) and sends them to the subscriber. the subscriber applies them as regular SQL statements.

use cases:
- replicating a subset of tables (not the whole database)
- replicating between different postgres versions (physical replication requires same major version)
- replicating into a different schema (transform column names)
- feeding changes to an external system (CDC)

**reference**: [postgres logical replication](https://www.postgresql.org/docs/current/logical-replication.html)

## logical decoding and change data capture

logical decoding extracts transactional changes from WAL:

```
WAL:  [heap_insert: table=orders, tuple=(42,'bob',100)]
       ↓ logical decoding
output: {"op":"INSERT","table":"orders","id":42,"name":"bob","amount":100}
```

this is the foundation of CDC (change data capture). tools like debezium use logical decoding to stream postgres changes to kafka.

```sql
-- create a logical replication slot
SELECT pg_create_logical_replication_slot('cdc_slot', 'pgoutput');

-- peek at changes
SELECT * FROM pg_logical_slot_peek_changes('cdc_slot', NULL, NULL);
```

logical slots, like physical slots, prevent WAL cleanup. if the consumer stops reading, WAL piles up. monitor slot lag:

```sql
SELECT slot_name,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag
FROM pg_replication_slots;
```

## failover: when the primary dies

with streaming replication, failover is a manual or automated process:

1. **detect**: monitoring system determines primary is down
2. **promote**: a replica is promoted to primary:

```bash
# on the chosen replica
pg_ctl promote
# or touch the trigger file:
touch /tmp/promote_trigger
```

3. **reconfigure**: other replicas are pointed at the new primary:

```sql
-- on remaining replicas, update primary_conninfo
ALTER SYSTEM SET primary_conninfo = 'host=new-primary user=replicator';
SELECT pg_reload_conf();
```

4. **rebuild**: the old primary (if it recovers) must be rebuilt as a replica

this is where tools like patroni, repmgr, or pg_auto_failover handle the coordination. they manage leader election, promotion, and reconfiguration so you don't have to script it manually.

**reference**: [postgres failover](https://www.postgresql.org/docs/current/failover.html)

## multi-primary replication: don't

postgres does not support multi-primary replication natively. you get one primary, N replicas. tools like bucardo, pglogical, or BDR exist for multi-primary (or multi-master) setups, but they add significant complexity:

- conflict resolution: two primaries update the same row. who wins?
- sequences: `SERIAL` generates the same ID on both primaries. collision.
- commit ordering: which transaction happened first? wall clocks disagree.

for most applications, single-primary with fast failover is sufficient. if you truly need multi-primary, consider whether a different database (crdb, spanner, foundationdb) is a better fit.

## further reading

- [postgres high availability](https://www.postgresql.org/docs/current/high-availability.html)
- [postgres streaming replication](https://www.postgresql.org/docs/current/warm-standby.html)
- [postgres logical replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [postgres failover](https://www.postgresql.org/docs/current/failover.html)
