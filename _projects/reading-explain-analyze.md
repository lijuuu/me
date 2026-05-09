---
title: why most engineers can't read an EXPLAIN ANALYZE output
slug: reading-explain-analyze
date: May 9, 2026
description: decoding postgres EXPLAIN ANALYZE output — costs, row estimates, buffers, and why actual vs estimated is the number that matters most.
---

`EXPLAIN ANALYZE` is the most powerful postgres debugging tool. most engineers run it, glance at the output, and close the terminal. here is how to actually read it.

## the anatomy of a query plan

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id, u.name
ORDER BY order_count DESC
LIMIT 10;
```

output:

```
Limit  (cost=5234.12..5234.15 rows=10 width=48)
       (actual time=145.234..145.238 rows=10 loops=1)
  ->  Sort  (cost=5234.12..5284.12 rows=20000 width=48)
            (actual time=145.233..145.235 rows=10 loops=1)
        Sort Key: (count(o.id)) DESC
        Sort Method: top-N heapsort  Memory: 25kB
        ->  HashAggregate  (cost=4234.12..4734.12 rows=20000 width=48)
                           (actual time=132.456..142.123 rows=18923 loops=1)
              Group Key: u.id, u.name
              Batches: 1  Memory Usage: 4097kB
              ->  Hash Join  (cost=1234.12..3234.12 rows=50000 width=40)
                             (actual time=45.678..98.234 rows=52341 loops=1)
                    Hash Cond: (o.user_id = u.id)
                    ->  Seq Scan on orders o  (cost=0.00..1023.45 rows=52341 width=8)
                                              (actual time=0.012..12.345 rows=52341 loops=1)
                    ->  Hash  (cost=1000.00..1000.00 rows=20000 width=36)
                              (actual time=45.234..45.234 rows=18923 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 2048kB
                          ->  Seq Scan on users u  (cost=0.00..1000.00 rows=20000 width=36)
                                                   (actual time=0.008..22.345 rows=18923 loops=1)
                                Filter: (created_at > '2024-01-01'::date)
                                Rows Removed by Filter: 1077
```

## reading from the bottom up

postgres executes plans from the innermost node outward. each row is a node in the plan tree:

1. **Seq Scan on users**: reads every row from users, filters by `created_at`. 18,923 rows matched, 1,077 removed by filter. took 22ms.
2. **Hash**: builds a hash table from those 18,923 rows. used 2MB memory.
3. **Seq Scan on orders**: reads all 52,341 rows from orders. took 12ms.
4. **Hash Join**: probes the hash table for each order row. 52,341 probes, each matched a user. took 98ms total.
5. **HashAggregate**: groups by user and counts. 52,341 rows collapsed to 18,923 groups. used 4MB memory. took 142ms.
6. **Sort**: top-N heapsort, only kept 10 rows. took 0.002ms.
7. **Limit**: returns 10 rows. total query time: 145ms.

**reference**: [postgres EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)

## the numbers that matter

### cost (estimated)

```
Sort  (cost=5234.12..5284.12 rows=20000 width=48)
```

`5234.12`: startup cost (time before first row). `5284.12`: total cost. `rows=20000`: estimated row count. these are in planner units, NOT milliseconds. only useful for comparing plans, not for estimating real time.

### actual time

```
(actual time=45.678..98.234 rows=52341 loops=1)
```

`45.678`: milliseconds before first row. `98.234`: milliseconds for all rows. `loops=1`: how many times this node ran. if `loops > 1`, multiply times by loops for total time.

### actual rows vs estimated rows

```
Hash Join  (cost=1234.12..3234.12 rows=50000 width=40)
           (actual time=45.678..98.234 rows=52341 loops=1)
```

estimated: 50,000 rows. actual: 52,341 rows. the estimate is close (within 5%). this means statistics are fresh and the planner made good decisions.

if estimated is 100 and actual is 50,000, your statistics are stale. run `ANALYZE`.

### buffers

```
Seq Scan on orders o  (cost=0.00..1023.45 rows=52341 width=8)
                      (actual time=0.012..12.345 rows=52341 loops=1)
                      Buffers: shared hit=4156 read=0
```

`shared hit=4156`: pages read from the buffer cache (memory). `read=0`: pages read from disk. this query was fully cached. if `read` is high, your data doesn't fit in `shared_buffers`. increase it or add more RAM.

**reference**: [postgres buffer management](https://www.postgresql.org/docs/current/runtime-config-resource.html#GUC-SHARED-BUFFERS)

### rows removed by filter

```
Filter: (created_at > '2024-01-01'::date)
Rows Removed by Filter: 1077
```

1,077 rows were read and discarded. this is a sequential scan with a filter — every row is read. if `Rows Removed by Filter` is close to `actual rows`, your filter is very selective and an index would help. here, 18,923 matched out of 20,000 — the filter lets through 95% of rows. an index wouldn't help much.

## the killer pattern: nested loop at scale

```
Nested Loop  (cost=0.42..88345.12 rows=1000 width=120)
             (actual time=0.234..45231.567 rows=1000000 loops=1)
  ->  Seq Scan on users  (cost=0.00..1000.00 rows=20000 width=36)
                          (actual time=0.008..22.345 rows=20000 loops=1)
  ->  Index Scan on orders_user_id_idx  (cost=0.42..4.37 rows=50 width=84)
                                        (actual time=0.012..2.259 rows=50 loops=20000)
```

`loops=20000` on the inner Index Scan. the planner estimated 1,000 total rows but got 1,000,000. the nested loop ran 20,000 times, each time doing an index lookup. 45 seconds total.

the fix: a hash join would have been faster. force it by adjusting `enable_nestloop` or, better, fix the row estimates so the planner makes the right choice naturally.

## the fix toolkit

| symptom | what it means | fix |
|---------|--------------|-----|
| actual rows >> estimated rows | stale statistics | `ANALYZE table` |
| loops > 1 with high actual time | nested loop on large sets | check join estimates, add index |
| read >> hit in buffers | not enough cache | increase `shared_buffers` |
| Memory Usage > work_mem | sort/hash spilled to disk | increase `work_mem` for this query |
| Filter removes most rows | missing index | create index on filter column |
| Sort Method: external merge | sort spilled to disk | increase `work_mem` |

## the one query you should run right now

```sql
SELECT queryid, query,
       calls, mean_exec_time,
       shared_blks_read, shared_blks_hit
FROM pg_stat_statements
WHERE shared_blks_read > 100000
ORDER BY shared_blks_read DESC
LIMIT 10;
```

this finds queries that read from disk. they're your biggest optimization targets.

**reference**: [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)

## further reading

- [postgres EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)
- [postgres performance tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
