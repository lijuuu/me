---
title: the hidden cost of JSON in your database
slug: hidden-cost-of-json-in-database
date: May 9, 2026
description: JSON columns seem convenient until they kill your query performance, blow up storage, and make indexing a nightmare. here is the real cost.
---

`JSONB` in postgres. it's flexible, schemaless, and lets you store anything. developers love it. the database does not. here is what JSONB actually costs you in storage, indexing, and query performance.

## storage: JSONB is not cheap

a simple integer column:

```sql
CREATE TABLE events (
  id SERIAL,
  user_id INTEGER,  -- 4 bytes
  payload JSONB      -- ?
);
```

store 10,000 rows with `payload = '{"type":"click","page":"/home"}'`:

```
user_id:  4 bytes × 10,000 = 40 KB
payload:  ~80 bytes × 10,000 = 800 KB (20× more)
```

JSONB is a binary format with structure overhead. each key is stored as a string. each value has type tags. the structural overhead is significant — a `{"a": 1}` might be 24 bytes in JSONB vs 4 bytes as a native integer column.

but the real storage cost isn't the data. it's the index.

## the GIN index tax

to query inside JSONB, you need a GIN index:

```sql
CREATE INDEX events_payload_idx ON events USING GIN (payload);
```

a GIN index on 10,000 small JSONB documents:
- the table itself: ~8 MB
- the GIN index: ~4 MB (50% of the table)

add 100,000 rows:
- table: ~80 MB
- GIN index: ~45 MB

now add 1M rows with varied keys (`type`, `page`, `user_agent`, `ip`, `referrer`, `timestamp`):
- table: ~800 MB
- GIN index: ~600 MB

the index is almost as large as the data. and every INSERT/UPDATE must update the GIN index. that's a write amplification of 2× or more.

**reference**: [postgres GIN indexes](https://www.postgresql.org/docs/current/gin-intro.html)

## query performance: the false promise

you put everything in JSONB so you can query by any field:

```sql
SELECT * FROM events
WHERE payload @> '{"type": "click"}'
  AND payload @> '{"page": "/home"}';
```

the GIN index handles this. but compare to native columns:

```sql
SELECT * FROM events
WHERE event_type = 'click'
  AND page = '/home';
```

with a B-tree index on `(event_type, page)`: the query planner knows the exact number of rows, uses index-only scans, and the index is 10× smaller.

with a GIN index on JSONB: the planner doesn't have per-key statistics. it estimates row counts poorly. the GIN index must be decompressed for each lookup. and you're paying for every key in the index, whether you query it or not.

the performance gap is 3-10× for lookups, and there is no covering index for JSONB so every query must access the heap.

## the missing constraints

native columns give you:

```sql
event_type TEXT NOT NULL CHECK (event_type IN ('click', 'view', 'purchase')),
page TEXT NOT NULL,
user_id INTEGER REFERENCES users(id)
```

JSONB gives you: nothing. any key can be missing, misspelled, or have the wrong type. the database won't complain until the query fails at runtime.

```sql
-- this works, but page is now a number for some rows
INSERT INTO events (payload) VALUES ('{"type": "click", "page": 123}');

-- this query silently returns no matches for those rows
SELECT * FROM events WHERE payload ->> 'page' = '/home';
```

you can add CHECK constraints on JSONB fields, but they're slow, verbose, and most teams don't bother.

## the index explosion

a single JSONB column with 20 possible keys used in queries:

```sql
-- you need separate indexes for different query patterns
CREATE INDEX idx_type ON events ((payload ->> 'type'));
CREATE INDEX idx_page ON events ((payload ->> 'page'));
CREATE INDEX idx_user ON events ((payload ->> 'user_id'));
CREATE INDEX idx_type_page ON events ((payload ->> 'type'), (payload ->> 'page'));
```

each expression index is a B-tree on the extracted value. they're smaller than GIN and faster for single-field queries. but you now have 4 indexes instead of 1. writes get slower. autovacuum has more work. the table bloat accelerates.

## when JSONB is actually fine

JSONB makes sense in specific scenarios:

1. **the whole blob is read, never queried internally.** think: API response cache, rendered HTML, or a log payload that you archive as-is.

2. **the schema is truly unknown.** user-defined fields in a SaaS product, where each customer has different metadata. you can't create columns for every customer's custom fields.

3. **write-once, read-rarely.** audit logs, event sourcing storage, or dead-letter queues. you write the JSON and almost never query inside it.

4. **small volume.** a few thousand rows with JSONB is irrelevant. the costs only show up at scale.

## the migration path

if your JSONB column is causing pain:

```sql
-- step 1: add typed columns (nullable, no default)
ALTER TABLE events ADD COLUMN event_type TEXT;
ALTER TABLE events ADD COLUMN page TEXT;
ALTER TABLE events ADD COLUMN user_id INTEGER;

-- step 2: backfill in batches
UPDATE events SET
  event_type = payload ->> 'type',
  page = payload ->> 'page',
  user_id = (payload ->> 'user_id')::INTEGER
WHERE id BETWEEN 1 AND 10000;

-- step 3: add NOT NULL constraints (after verifying no NULLs)
-- step 4: drop the JSONB column when confident
ALTER TABLE events DROP COLUMN payload;
```

yes, it's work. but your database will thank you.

**reference**: [postgres JSON types](https://www.postgresql.org/docs/current/datatype-json.html)

## the rule of thumb

| use case | native columns | JSONB |
|----------|---------------|-------|
| known schema, fixed fields | yes | no |
| frequently queried fields | yes | no |
| needs constraints | yes | no |
| needs foreign keys | yes | no |
| true schemaless data | no | yes |
| write-once, read-whole | no | yes |
| small-scale (<10K rows) | either | either |

JSONB is a tool, not a default. use it for data you don't query. use columns for data you do. the database is optimized for columns. it tolerates JSONB.

## further reading

- [postgres GIN indexes](https://www.postgresql.org/docs/current/gin-intro.html)
- [postgres JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [postgres indexing best practices](https://www.postgresql.org/docs/current/indexes.html)
