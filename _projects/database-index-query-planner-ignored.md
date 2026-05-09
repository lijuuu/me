---
title: the database index the query planner ignored and why
slug: database-index-query-planner-ignored
date: May 9, 2026
description: why postgres sometimes walks right past your perfect index, and how statistics, row estimates, and query planning actually work.
---

you create an index. `EXPLAIN` shows it's not being used. the query planner chose a sequential scan instead. here is why, and what the planner is actually thinking.

## the planner's job

the query planner takes your SQL and generates execution plans. each plan has a cost. the planner picks the cheapest one. costs are abstract units (not milliseconds). a sequential scan of a single page costs ~1.0. a random index lookup costs ~4.0 because seeking to a random disk page is more expensive than reading sequentially.

the formula at the heart of every decision:

```
cost = seq_page_cost * pages_in_table
```

vs

```
cost = random_page_cost * estimated_rows + cpu_cost * rows_processed
```

if `seq_page_cost` = 1.0 and `random_page_cost` = 4.0 (the defaults), then scanning 200 pages costs ~200. using an index to fetch 50 rows costs ~200 too. the planner might choose either. fetch 51 rows and the sequential scan wins.

**reference**: [postgres query planning](https://www.postgresql.org/docs/current/planner-optimizer.html)

## statistics: the blind spot

the planner doesn't know how many rows your query returns. it estimates. postgres maintains statistics in `pg_statistic`:

```
pg_class.relpages  — number of pages in the table
pg_class.reltuples — estimated number of rows
pg_stats.n_distinct — number of distinct values per column
pg_stats.most_common_vals — most frequent values and their frequencies
```

these are updated by `ANALYZE` (or autovacuum). if they're stale, the planner makes wrong decisions.

the single most important number:

```sql
SELECT relname, relpages, reltuples
FROM pg_class WHERE relname = 'orders';
```

if `relpages` says 100 pages but the table actually has 10,000 pages, the planner thinks a sequential scan is cheap. it's wrong by a factor of 100.

**reference**: [postgres statistics](https://www.postgresql.org/docs/current/planner-stats.html)

## selectivity and row estimates

the planner estimates rows using column statistics:

```
estimated_rows = reltuples * selectivity
selectivity = frequency of value in pg_stats.most_common_vals
```

for `status = 'active'` where 'active' appears 80% of the time:
```
selectivity = 0.8
estimated_rows = 1,000,000 * 0.8 = 800,000
```

the planner sees 800,000 rows and thinks "sequential scan." it's faster to read the whole table sequentially than to chase 800,000 random index pointers.

for `status = 'failed'` where 'failed' appears 0.1% of the time:
```
selectivity = 0.001
estimated_rows = 1,000,000 * 0.001 = 1,000
```

1,000 rows. the planner uses the index. this is why the same index works for rare values and gets ignored for common ones.

## when the index should be used but isn't

### case 1: stale statistics

```sql
SELECT schemaname, relname, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'events';
```

if `last_analyze` is 3 days old and you inserted 10M rows since, the planner has no idea. run:

```sql
ANALYZE events;
```

### case 2: correlated columns fool the planner

postgres assumes columns are independent. if `country` and `city` are correlated (cities map to countries), the planner underestimates:

```sql
-- planner: 1M * 0.01 * 0.01 = 100 rows (wrong)
-- reality: london is always in UK, so 0 rows
SELECT * FROM users WHERE country = 'FR' AND city = 'London';
```

fix: create extended statistics:

```sql
CREATE STATISTICS users_country_city (dependencies)
ON country, city FROM users;
ANALYZE users;
```

**reference**: [postgres extended statistics](https://www.postgresql.org/docs/current/planner-stats.html#PLANNER-STATS-EXTENDED)

### case 3: the index is on the wrong column order

an index on `(status, created_at)` can answer `WHERE status = 'active' ORDER BY created_at`. but `WHERE created_at > '2024-01-01'` can't use it efficiently. the first column of a B-tree index must appear in the WHERE clause for the index to be useful.

### case 4: the LIMIT tricks you

```sql
SELECT * FROM orders WHERE status = 'active' LIMIT 10;
```

the planner estimates: 800,000 matching rows. but `LIMIT 10` means it only needs 10. postgres has an optimization: if an index matches the WHERE clause, it can scan the index and stop after 10 rows. this is a "partial scan" and can be much faster than a sequential scan that reads 800,000 rows just to return 10.

but only if the index covers the WHERE columns.

## bitmap scans: the middle ground

between sequential scan and index scan is the bitmap scan:

1. scan the index, collecting matching TIDs (tuple IDs) into a bitmap
2. sort the bitmap by physical page location
3. read pages sequentially

this converts random I/O into sequential I/O. it's used when the planner estimates more than a few rows but far fewer than the whole table. the plan shows:

```
Bitmap Heap Scan on orders
  Bitmap Index Scan on orders_status_idx
```

## forcing an index (and why you shouldn't)

```sql
SET enable_seqscan = off;
```

this disables sequential scans entirely. never do this in production. instead:

```sql
-- check if statistics are fresh
SELECT last_analyze FROM pg_stat_user_tables WHERE relname = 'orders';

-- adjust cost parameters for this session
SET random_page_cost = 1.1;  -- default 4.0, lower = planner prefers indexes
```

lowering `random_page_cost` tells the planner "random I/O is nearly as cheap as sequential." this is appropriate for SSDs. the default of 4.0 was designed for spinning disks.

## reading EXPLAIN output

```
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE status = 'active';

Seq Scan on orders  (cost=0.00..4623.00 rows=120000 width=120)
                    (actual time=0.012..45.231 rows=119834 loops=1)
  Filter: (status = 'active'::text)
  Rows Removed by Filter: 80166
  Buffers: shared hit=4156
```

the key numbers:
- `cost=0.00..4623.00`: estimated (startup..total). in planner units.
- `rows=120000`: estimated rows
- `actual rows=119834`: actual rows returned. close to estimate = good statistics
- `Buffers: shared hit=4156`: pages read from cache. `hit` = from memory, `read` = from disk

if actual rows is 10x the estimate, your statistics are stale. if buffers are all `read`, your data doesn't fit in `shared_buffers`.

**reference**: [postgres EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)

## the mental model

| situation | planner choice | why |
|-----------|---------------|-----|
| rare value (<5% of table) | index scan | random I/O for few rows beats sequential |
| common value (>20% of table) | sequential scan | reading whole table beats random I/O |
| moderate (5-20%) | bitmap scan | compromise: sorted random I/O |
| LIMIT with WHERE | index scan (partial) | stop early after finding N rows |
| stale statistics | wrong choice | planner doesn't know the data changed |

the planner isn't stupid. it's working with bad information. give it good statistics, and it almost always makes the right call.

## further reading

- [postgres query planning](https://www.postgresql.org/docs/current/planner-optimizer.html)
- [postgres statistics](https://www.postgresql.org/docs/current/planner-stats.html)
- [postgres EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
