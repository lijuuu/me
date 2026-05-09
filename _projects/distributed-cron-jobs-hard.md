---
title: why distributed cron jobs are surprisingly hard
slug: distributed-cron-jobs-hard
date: February 25, 2026
description: leader election, clock drift, exactly-once semantics at scale, and why a simple cron scheduler becomes a distributed systems nightmare.
---

a cron job runs `cleanup.sh` every hour. simple. now run it in a cluster of 10 machines. suddenly you need leader election, clock synchronization, failure detection, and at-least-once semantics. here is why distributed cron is harder than it looks.

## the duplicate execution problem

10 machines, each with the same crontab:
```
0 * * * * /usr/local/bin/cleanup.sh
```

at midnight, all 10 machines fire simultaneously. you just ran `cleanup.sh` 10 times. if it sends emails, users get 10 copies. if it processes payments, users are charged 10 times.

## leader election: the standard fix

only one machine should run the job. but leader election has its own problems:

### split brain
two machines think they're the leader. the cleanup runs twice.

### the pause problem
the leader pauses (GC, network blip). a new leader is elected. the old leader wakes up, thinks it's still the leader. two leaders, briefly.

```go
// fencing token pattern
func runIfLeader(fencingToken int64) {
    if !amILeader(fencingToken) {
        return
    }
    // fencing token: leader check + execute
    executeJob()
}
```

**reference**: [leader election with etcd](https://etcd.io/docs/v3.5/tutorials/how-to-create-lease/)

## the clock drift death trap

machine A's clock: 00:00:00. machine B's clock: 00:00:05. machine A becomes leader at 00:00:00. at 00:00:01, A processes the hourly job. at 00:00:05, A's leader lease expires (assumed dead). B becomes leader. B sees it hasn't run the hourly job yet. B processes it. duplicated.

the fix: use logical clocks (etcd revisions, zookeeper zxid) for scheduling decisions, not wall clock.

## the missed execution problem

leader holds the job schedule in memory. leader crashes before running the job. new leader doesn't know the job was supposed to run. the job is skipped.

solutions:
- **persist schedule state**: store last execution time in a DB or etcd
- **reconciliation**: new leader checks: "should this job have run since the last recorded execution?"
- **two-phase**: record intent before execution, mark complete after

```go
// pseudo-code for safe execution
func executeSafely(job Job) {
    // phase 1: claim the execution
    claimed := etcd.CompareAndSwap("/jobs/"+job.Name+"/last_run", expected, now)
    if !claimed { return } // someone else already claimed it
    
    // phase 2: execute
    run(job)
    
    // phase 3: mark complete
    etcd.Put("/jobs/"+job.Name+"/last_success", now)
}
```

## the long-running job problem

a job takes 3 hours. leader lease is 30 seconds. while the job runs, the lease expires. a new leader is elected. the new leader runs the same job. now you have two instances running.

fixes:
- lease renewal: the job executor continually renews the leader lease
- fencing: jobs check their fencing token before making side effects
- split jobs: break long-running jobs into smaller tasks

**reference**: [designing distributed cron at airbnb](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb)

## the monitoring paradox

single-machine cron: easy to monitor (check exit code). distributed cron: how do you know a job ran? on which machine? what was the exit code? you need:

- execution registry (central log of job runs)
- heartbeat (job should run every hour — did it?)
- alerting (job missed 2 consecutive runs)

## platforms that solve this

| platform | scheduling | durability | complexity |
|----------|-----------|------------|------------|
| kubernetes CronJob | basic | good | low |
| airflow | DAG-based | good | medium |
| temporal | workflow engine | excellent | medium |
| custom | you build it | depends | high |

**reference**: [kubernetes cronjob docs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)

## further reading

- [leader election with etcd](https://etcd.io/docs/v3.5/tutorials/how-to-create-lease/)
- [designing distributed cron at airbnb](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb)
- [kubernetes cronjob docs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
