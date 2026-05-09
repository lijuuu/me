---
title: why your TLS handshake takes 300ms even on a 10Gbps link
slug: tls-handshake-latency
date: May 9, 2026
description: the anatomy of a TLS 1.3 handshake, why bandwidth has nothing to do with it, and what session resumption and 0-RTT actually save you.
---

you upgraded to 10Gbps. your TLS handshake still takes 300ms. bandwidth is not the bottleneck. latency is. here is exactly what happens during those 300ms, broken into the packets that cross the wire.

## TLS 1.3: 1-RTT by default

TLS 1.3 reduced the handshake from 2-RTT (TLS 1.2) to 1-RTT. here is the full exchange:

### flight 1: client → server (client hello)

```
client → server:
  - supported TLS versions (1.3)
  - supported cipher suites (TLS_AES_256_GCM_SHA384, etc.)
  - key_share: X25519 public key
  - SNI: example.com
  - supported_groups: x25519, secp256r1
```

the client generates an ephemeral X25519 keypair and sends the public key immediately. this is the key difference from TLS 1.2 — in 1.2, the key exchange was negotiated in round 1, performed in round 2. in 1.3, the client guesses which key exchange the server supports and sends it upfront. if the server doesn't support it, the server responds with a `HelloRetryRequest` — adding another RTT.

time cost: 0ms (no network yet)

### flight 2: server → client (server hello + encrypted)

```
server → client:
  - server_hello: agreed cipher, key_share (server's X25519 public key)
  - encrypted_extensions
  - certificate: server's X.509 cert chain
  - certificate_verify: signature over the handshake transcript
  - finished: MAC over the handshake
```

the server receives the client's key share, generates its own, and derives the session keys. the server hello is NOT encrypted, but everything after it IS encrypted under the handshake keys.

time cost: 1 RTT (network latency). for a server 50ms away, this is 50ms.

**reference**: [TLS 1.3 RFC 8446](https://datatracker.ietf.org/doc/html/rfc8446)

### flight 3: client → server (finished)

```
client → server:
  - finished: MAC over the handshake transcript
```

the client derives session keys from the two key shares, verifies the certificate chain, and confirms the handshake with a final MAC.

time cost: 0.5 RTT from the client's perspective (overlaps with server's flight). after sending, the client can send application data immediately.

## where the 300ms comes from

```
50ms  — TCP 3-way handshake (SYN, SYN-ACK, ACK)
100ms — TLS flight 1 + flight 2 (1 RTT to the server and back)
50ms  — TLS flight 3 (client finished, overlaps with application data)
100ms — certificate validation (OCSP stapling, CRL check, cert chain verify)
-----
300ms total
```

the TCP handshake alone is 1 RTT. then the TLS handshake adds another 1 RTT. that's 2 RTTs before you can send an HTTP request. for a user in tokyo hitting a server in virginia (150ms RTT), that's 300ms just for TCP+TLS — before the server has even seen the request.

**reference**: [TCP RFC 793](https://datatracker.ietf.org/doc/html/rfc793)

## certificate chain: the hidden cost

the server sends its certificate chain during flight 2. a typical chain:
- leaf cert: ~2KB
- intermediate CA: ~2KB
- root CA: ~2KB (often omitted — client already has it)

6KB of certificates. at 50Mbps, that's ~1ms of transfer time. negligible. the real cost is validation:

1. the client must verify each certificate's signature
2. check OCSP status (is the cert revoked?)
3. validate the chain up to a trusted root

OCSP lookups add 50-200ms if the client contacts the CA's OCSP responder. this is why OCSP stapling exists: the server includes a pre-signed OCSP response in flight 2. no extra RTTs.

**reference**: [OCSP stapling](https://datatracker.ietf.org/doc/html/rfc6961)

## session resumption: the cheat code

TLS session resumption skips the key exchange entirely. the client sends a session ID or session ticket from a previous connection, and the server recovers the session keys. the handshake becomes:

```
client → server: client hello (with session_id or psk_identity)
server → client: server hello (confirms resumption) + finished
client → server: finished
```

this is still 1 RTT, but no certificate transfer and no key exchange computation. latency drops from 300ms to 150ms (TCP + 1 RTT for resumption).

```
# nginx session resumption config
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets on;
```

**reference**: [TLS session resumption RFC 5077](https://datatracker.ietf.org/doc/html/rfc5077)

## 0-RTT: the holy grail

TLS 1.3 0-RTT allows the client to send application data in the FIRST flight:

```
client → server: client hello + early application data
server → client: server hello + finished + application data response
```

the client caches a PSK (pre-shared key) from a previous connection. on reconnect, it encrypts data under that PSK and sends it immediately. the server can respond before the handshake completes.

the catch: 0-RTT data is replayable. an attacker can capture the first flight and replay it, causing the server to process the same request twice. only use 0-RTT for idempotent requests (GET). never for POST/PUT/DELETE.

**reference**: [TLS 1.3 0-RTT](https://datatracker.ietf.org/doc/html/rfc8446#section-2.3)

## what you can actually fix

| problem | fix | saves |
|---------|-----|-------|
| TCP handshake RTT | move server closer (CDN, edge) | 1 RTT |
| certificate validation | OCSP stapling | 50-200ms |
| repeated connections | session resumption | 1 RTT |
| cold connections | 0-RTT (for reads) | 1 RTT |
| DNS before TCP | DNS prefetch, `dns-prefetch` | 50-200ms |
| large cert chains | trim intermediates | 10-50ms |

none of these will help if your server is 150ms from the client. TLS latency is fundamentally bound by the speed of light, not the speed of your network card.

## TLS 1.2 vs 1.3 latency

| step | TLS 1.2 | TLS 1.3 |
|------|---------|---------|
| TCP handshake | 1 RTT | 1 RTT |
| key exchange | 1 RTT | 0 RTT (sent in hello) |
| certificate + verify | 1 RTT | 1 RTT (combined with key exchange) |
| total | 3 RTT | 2 RTT |
| with resumption | 2 RTT | 1 RTT |
| with 0-RTT | n/a | 0 RTT |

moving from 1.2 to 1.3 saves 1 RTT. that's 50ms to your nearest CDN edge, or 150ms cross-continent. it's the single most impactful TLS optimization.

## further reading

- [TLS 1.3 RFC 8446](https://datatracker.ietf.org/doc/html/rfc8446)
- [TLS session resumption](https://datatracker.ietf.org/doc/html/rfc5077)
- [OCSP stapling](https://datatracker.ietf.org/doc/html/rfc6961)
