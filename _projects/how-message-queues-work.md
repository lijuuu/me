---
title: how message queues actually work and why you need one
slug: how-message-queues-work
date: May 10, 2026
description: the internals of message brokers, delivery guarantees, the producer-broker-consumer model, and when a message queue saves your system from itself.
---

your API handles a request in 50ms. then it sends an email, resizes an image, updates 3 search indexes, and posts to a webhook. suddenly your 50ms endpoint takes 800ms. a message queue fixes this. here is how.

## why you need a message queue

a message queue decouples the producer (who creates work) from the consumer (who does the work). instead of calling a function or making an HTTP request, the producer writes a message to a broker. the consumer reads it later.

```
without queue:
  client → API → email + resize + index + webhook → response (800ms)

with queue:
  client → API → enqueue → response (50ms)
                    ↓
              worker → email → resize → index → webhook
```

this is called **asynchronous processing**. the producer doesn't wait for the consumer. the consumer can be slower, faster, offline temporarily, or scaled independently.

## the fundamental model

every message queue has three actors:

| actor | role | example |
|-------|------|---------|
| producer | creates messages | API server, cron job, sensor |
| broker | stores and routes messages | RabbitMQ, Kafka, SQS |
| consumer | processes messages | worker process, lambda function |

the broker is the critical piece. it must:
- accept messages from producers reliably
- store them durably (or not, depending on configuration)
- deliver them to consumers in order (or not)
- track which messages have been processed
- handle consumer failures without losing messages

## the two families: queue-based vs log-based

### queue-based (RabbitMQ, SQS, Redis)

messages are pushed to consumers. once a consumer acknowledges a message, the broker deletes it. the broker tracks which consumer is processing which message.

```
producer → [msg3, msg2, msg1] → consumer pulls msg1
                                  consumer acks msg1
                                  broker deletes msg1
```

key characteristics:
- messages are deleted after acknowledgment
- consumers compete: only one consumer processes each message
- excellent for work distribution (one job, one worker)
- order is per-queue, not global
- replay is hard (message is gone after ack)

### log-based (Kafka, Redis Streams)

messages are appended to an immutable log. consumers track their own position (offset). the broker never deletes messages until retention expires.

```
producer → [msg1, msg2, msg3, msg4, msg5]
consumer A: offset=3 (processed msg1-3)
consumer B: offset=1 (processed msg1)
```

key characteristics:
- messages persist after consumption
- consumers are independent: multiple consumers can read the same message
- excellent for event sourcing, audit logs, replay
- order is per-partition, strictly guaranteed
- the consumer is responsible for tracking progress

**reference**: [rabbitmq documentation](https://www.rabbitmq.com/documentation.html) | [kafka documentation](https://kafka.apache.org/documentation/)

## delivery guarantees

every messaging system makes tradeoffs:

### at-most-once

```
producer → broker → consumer
                  ✗ (consumer crashes before ack)
```

the message is sent once and never retried. if the consumer crashes, the message is lost. fastest, least reliable. use for metrics, logs, non-critical notifications.

### at-least-once (most common)

```
producer → broker → consumer → ack
              ↑         ↓
              └── retry ─┘ (consumer crashed)
```

the broker retries until the consumer acknowledges. the message may be processed multiple times. the consumer must be idempotent. this is RabbitMQ's default, SQS standard queues, and Kafka's default.

### exactly-once (the marketing term)

systems claiming "exactly-once" actually provide "effectively-once" — at-least-once delivery with idempotent processing:

```go
// idempotent consumer: processing the same message twice = same result
func ProcessOrder(msg Message) error {
    if db.OrderExists(msg.OrderID) {
        return nil // already processed, skip
    }
    return db.CreateOrder(msg.OrderID, msg.Amount)
}
```

kafka achieves this with idempotent producers + transactional consumers. it's not "exactly-once delivery" — it's "exactly-once effect."

**reference**: [kafka exactly-once semantics](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)

## inside the broker: how messages are stored

### RabbitMQ

messages are written to disk using a custom persistence layer. each queue is a file (or set of files). messages are appended sequentially. the queue index maps message IDs to file positions. on restart, RabbitMQ replays the persistence log.

memory is used as a cache. when memory pressure hits, messages are paged to disk. this is why RabbitMQ throughput drops under memory pressure — the broker is doing disk I/O.

acknowledgments are also persisted. if a consumer crashes, unacknowledged messages are requeued. this requires the broker to maintain state about every in-flight message.

### Kafka

messages are written to segment files (`.log` files). each partition is a directory:

```
/tmp/kafka-logs/
  orders-0/
    00000000000000000000.log     ← messages
    00000000000000000000.index   ← offset → position map
    00000000000000000000.timeindex
```

kafka uses `sendfile()` to write messages from disk directly to network sockets — zero-copy. the broker doesn't modify messages. it doesn't track consumer progress (consumers track their own offsets in a special `__consumer_offsets` topic). the broker is a dumb pipe with smart clients.

this is why kafka can handle millions of messages per second — the broker does almost no work per message.

**reference**: [kafka storage internals](https://kafka.apache.org/documentation/#impl)

## consumer groups and parallelism

a consumer group is a set of consumers that cooperate to process a topic:

```
topic: orders (4 partitions)
  partition 0 → consumer A (group: workers)
  partition 1 → consumer B (group: workers)
  partition 2 → consumer C (group: workers)
  partition 3 → consumer D (group: workers)
```

each partition is assigned to exactly one consumer in the group. if consumer B crashes, partition 1 is reassigned to another consumer. this is called **rebalancing**. during rebalancing, the consumer group pauses — no messages are consumed.

maximum parallelism = number of partitions. a topic with 4 partitions can have at most 4 active consumers in a group. adding a 5th consumer does nothing — it sits idle.

RabbitMQ doesn't have partitions. instead, messages are distributed round-robin to consumers on the same queue. add 10 consumers, all 10 get messages. but message order is lost — round-robin doesn't preserve ordering.

## dead letter queues

when a consumer can't process a message, what happens? three options:

1. **retry forever** — the message loops until the consumer succeeds. if it's a permanent failure (malformed message), it loops forever and blocks the queue.
2. **discard** — the message is dropped. data loss.
3. **dead letter queue (DLQ)** — after N retries, the message is moved to a separate queue for manual inspection.

```
main queue → consumer (fails 3 times) → dead letter queue
                                            ↓
                                       admin inspects
                                       fixes + replays
```

this is the right answer. every production message queue should have a DLQ. RabbitMQ supports DLQs via policy. Kafka requires you to build your own (write failed messages to a separate topic). SQS has built-in DLQ support.

**reference**: [rabbitmq dead letter exchanges](https://www.rabbitmq.com/docs/dlx)

## the common patterns

### work queue

```
producer → queue → worker 1
                → worker 2
                → worker 3
```

one producer, many workers. each message is processed by exactly one worker. used for: image resizing, email sending, report generation.

### pub/sub (fanout)

```
producer → exchange ─┬→ queue A → consumer A
                     ├→ queue B → consumer B
                     └→ queue C → consumer C
```

one message, many consumers. each gets a copy. used for: cache invalidation, search index updates, notifications.

### request-reply

```
client → request_queue → server
client ← reply_queue   ← server
```

the client sends a request, includes a reply-to queue name. the server processes and sends the response to that queue. used for: RPC over messaging.

### event sourcing

```
service A → topic:events → service B (builds materialized view)
                          → service C (updates search index)
                          → service D (sends notification)
```

every state change is an event. services replay the event log to build state. used for: audit trails, CQRS, rebuilding projections.

## when not to use a message queue

| problem | better solution |
|---------|----------------|
| need response immediately | HTTP call or gRPC |
| simple cron job (1 server) | cron or systemd timer |
| <100 messages/day | just call the function |
| need strong consistency | database transaction |
| need complex routing logic | API gateway or orchestration engine |

message queues add operational complexity: you now have a broker to monitor, consumers to scale, DLQs to manage, and eventual consistency to reason about. use one when the decoupling, buffering, or reliability benefits outweigh that cost.

## the broker comparison

| | RabbitMQ | Kafka | Redis Streams | SQS |
|---|---------|-------|--------------|-----|
| model | queue-based | log-based | log-based | queue-based |
| throughput | ~50K msg/s | ~1M msg/s | ~100K msg/s | unlimited (AWS) |
| persistence | yes | yes | optional | yes |
| message replay | no | yes (by offset) | yes (by ID) | no |
| ordering | per-queue | per-partition | per-stream | best-effort (FIFO) |
| consumer groups | no (compete) | yes | yes | no (compete) |
| max message size | 128MB | 1MB (default) | 512MB | 256KB |
| operational complexity | medium | high | low | none (managed) |

## further reading

- [rabbitmq documentation](https://www.rabbitmq.com/documentation.html)
- [kafka documentation](https://kafka.apache.org/documentation/)
- [redis streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [AWS SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
