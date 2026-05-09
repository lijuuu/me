---
title: debugging a production outage using only tcp packets
slug: debugging-production-outage-tcp-packets
date: March 25, 2026
description: how tcpdump, Wireshark, and raw packet analysis can find outages that monitoring dashboards miss.
---

a production outage where every metric was green but users saw 100% errors. monitoring dashboards showed nothing wrong. raw tcpdump analysis found what 20 dashboards missed.

## the symptoms

- health checks: green (200 OK)
- CPU: 15%
- memory: stable
- error rate: 100% for external users
- internal monitoring: 0% errors

the discrepancy is the first clue. internal monitoring ran from inside the VPC. users connected from the internet. something was wrong in between.

## the tcpdump command

```bash
tcpdump -i eth0 -nn -s0 -w /tmp/capture.pcap \
  'tcp port 443 and (tcp[tcpflags] & (tcp-syn) != 0)'
```

this captures SYN packets (new connections) on port 443. 30 seconds of capture from a failing instance.

**reference**: [tcpdump advanced usage](https://danielmiessler.com/study/tcpdump/)

## reading the pcap

```
15:14:02.123456 IP 203.0.113.5.54321 > 10.0.1.42.443: Flags [S], seq 1234
15:14:02.123789 IP 10.0.1.42.443 > 203.0.113.5.54321: Flags [S.], seq 5678, ack 1235
15:14:03.123456 IP 203.0.113.5.54321 > 10.0.1.42.443: Flags [S], seq 1234
15:14:03.123789 IP 10.0.1.42.443 > 203.0.113.5.54321: Flags [S.], seq 5678, ack 1235
```

retransmission. the server sends SYN-ACK but the client doesn't receive it, so it retransmits SYN. the server sends SYN-ACK again. classic asymmetric routing.

## the diagnosis: asymmetric routing + broken conntrack

the full path:
```
client -> NAT gateway -> instance (via eth0)
instance response -> eth0 -> ??? 
```

the instance had two network interfaces (eth0 and eth1). the default route went through eth0 correctly, but conntrack (connection tracking) had the return path going through eth1 because of a stale route. packets left on eth1, never reached the client.

```bash
# fix: drop conntrack entries or add proper routing
conntrack -D -s 203.0.113.5
ip route add 203.0.113.5/32 dev eth0
```

**reference**: [conntrack — the hidden killer](https://thermalcircle.de/doku.php?id=blog:linux:netfilter_conntrack_performance)

## the monitoring gap

20 dashboards showed green because:
- health checks tested `/health` from inside VPC (same subnet, no routing issue)
- CPU/memory/disc were fine (it's a network problem)
- error rate dashboard aggregated after health check filter (excluded probes)

## the tcpdump toolkit every engineer should know

### capture only SYNs (new connection attempts)
```bash
tcpdump 'tcp[tcpflags] & (tcp-syn) != 0 and tcp[tcpflags] & (tcp-ack) == 0'
```

### capture with timestamps for a specific host
```bash
tcpdump -tttt -nn host 10.0.1.42
```

### watch for RSTs (connection resets)
```bash
tcpdump 'tcp[tcpflags] & (tcp-rst) != 0'
```

### check for retransmissions (sign of packet loss)
```bash
tcpdump 'tcp[tcpflags] & (tcp-syn) != 0' -c 100 | wc -l
# if many duplicate SYNs in a short window, packets are being dropped
```

### inspect HTTP headers in transit
```bash
tcpdump -A -s0 'tcp port 80 and (((ip[2:2] - ((ip[0]&0xf)<<2)) - ((tcp[12]&0xf0)>>2)) != 0)'
```

**reference**: [wireshark display filters](https://wiki.wireshark.org/DisplayFilters)

## the postmortem lesson

the outage was visible in tcpdump in 30 seconds. it took 8 minutes because nobody thought to look at packet captures. the metrics said everything was fine because the metrics measured the wrong things.

add these to monitoring:
- **SYN retransmission rate**: rising retransmits = network problem
- **TCP RST rate**: unexpected RSTs = routing or firewalling issue  
- **connection establishment time** (SYN to SYN-ACK delta)
- **packet loss ratio** from instance perspective

and always test from outside the VPC. monitoring needs the same view as external users.

## further reading

- [tcpdump advanced usage](https://danielmiessler.com/study/tcpdump/)
- [conntrack — the hidden killer](https://thermalcircle.de/doku.php?id=blog:linux:netfilter_conntrack_performance)
- [wireshark display filters](https://wiki.wireshark.org/DisplayFilters)
