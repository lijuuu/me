---
title: why "exactly once delivery" is mostly marketing
slug: exactly-once-delivery-marketing
date: February 20, 2026
description: the impossibility of true exactly-once delivery, idempotency as the real solution, and how systems like kafka and temporal handle it.
---

"exactly once delivery" is a phrase found in every messaging system's marketing. it is also, strictly speaking, impossible. here is why, and what systems actually do instead.

## the two-generals problem

two armies must coordinate an attack. they communicate via messenger through enemy territory. the messenger might be captured. the only way to confirm receipt is to send an acknowledgment. but the acknowledgment itself might be lost. you need an acknowledgment for the acknowledgment. which needs an acknowledgment. infinite regress.

this is the two-generals problem. it proves that over an unreliable channel, you cannot guarantee both parties agree on delivery. the messenger is your TCP packet, your kafka message, your gRPC call.

**reference**: [the two generals problem](https://en.wikipedia.org/wiki/Two_Generals%27_Problem)

## what "exactly once" actually means

### kafka

kafka's "exactly-once semantics" means: idempotent producers + transactional reads. a producer retries a message, but the broker deduplicates it. a consumer processes a message within a transaction, and if it fails, the offset isn't committed — the message is re-processed.

but if the consumer writes to an external system and crashes before committing the offset, the write still happened. when the consumer restarts, it re-processes the message. the write happens again.

**reference**: [kafka exactly-once semantics](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) — yes, the title says "possible" but read the implementation details

### temporal/cadence

temporal (uber's workflow engine) promises "exactly-once execution." what it actually does: deterministic replay. every workflow execution is logged. if a worker crashes, the workflow replays from the last recorded event. but the worker's side effects are NOT automatically rolled back — you must make them idempotent.

## the practical solution: idempotency

idempotency means: performing the same operation multiple times has the same effect as performing it once.

```go
// idempotent: always same result
DELETE FROM users WHERE id = 123;

// NOT idempotent
INSERT INTO users (name) VALUES ('alice');

// fix: use ON CONFLICT
INSERT INTO users (id, name) VALUES (123, 'alice')
ON CONFLICT (id) DO NOTHING;
```

## idempotency key pattern

```go
func ChargeCustomer(ctx context.Context, key string, amount int) error {
    // check if already processed
    existing, _ := db.GetCharge(key)
    if existing != nil { return nil }
    
    // process
    err := stripe.Charge(amount)
    if err != nil { return err }
    
    // record with idempotency key
    return db.InsertCharge(key, amount, time.Now())
}
```

even if `ChargeCustomer` is called 3 times with the same key, the customer is charged once.

**reference**: [stripe idempotency](https://stripe.com/docs/idempotency)

## how different systems handle it

| system | claim | reality |
|--------|-------|---------|
| kafka | exactly-once semantics | idempotent producer + transactional consumer |
| rabbitmq | at-least-once + acknowledgments | consumer must be idempotent |
| SQS | at-least-once (standard), exactly-once (FIFO) | FIFO uses deduplication IDs, limited to 300 TPS |
| temporal | exactly-once execution | deterministic replay, side effects must be idempotent |
| gRPC | at-most-once by default | can implement at-least-once with retries |

## the fundamental truth

you can have at-most-once delivery (don't retry). you can have at-least-once delivery (retry until acknowledged). you cannot have exactly-once delivery over an unreliable network. you can have exactly-once processing — but that's idempotency, not delivery.

design your systems assuming every message will be delivered at least once, possibly multiple times. make every operation idempotent. that's not marketing — that's engineering.

## further reading

- [the two generals problem](https://en.wikipedia.org/wiki/Two_Generals%27_Problem)
- [kafka exactly-once semantics](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [stripe idempotency](https://stripe.com/docs/idempotency)
