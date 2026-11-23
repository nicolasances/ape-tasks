# ape-tasks — Concept

> Status: concept / decision document. Nothing is implemented yet; the repo will be created
> from [`nicolasances/toto-node-template`](https://github.com/nicolasances/toto-node-template).
> Written 2026-11-22.
>
> Vocabulary is borrowed from
> [`agent-coder/docs/concept.md`](https://github.com/nicolasances/agent-coder/blob/main/docs/concept.md) §2
> (Task, Task File, Run, Dispatcher). Where a term is defined there, it means the same thing here.
>
> Replaces [`gale-ms-dispatcher`](https://github.com/nicolasances/gale-ms-dispatcher), which was
> built for the Cloud Run Jobs runtime and is heavier than needed (Mongo task records, an
> Agent Registry, a status model). Since `agent-coder` issue #8 (branch
> `feature/gke-pubsub-queue-job`) the agent runs as a KEDA `ScaledJob` on GKE fed by Pub/Sub,
> so dispatching a task no longer means launching anything.

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Core Concepts](#2-core-concepts)
3. [Features](#3-features)
4. [Data Models](#4-data-models)
5. [Key User Stories](#5-key-user-stories)
6. [Constraints & Assumptions](#6-constraints--assumptions)
7. [Open Questions](#7-open-questions)
8. [Not Doing (and Why)](#8-not-doing-and-why)
9. [Ideas for Future Versions](#9-ideas-for-future-versions)

---

## 1. Purpose & Scope

### 1.1 What is this?

A Toto Node.js microservice with **one endpoint** that turns one HTTP request into one queued
`agent-coder` run.

```
POST /tasks  { repoURL, issueURL, baseBranch? }      →  201 { taskId }
     │
     ├─ 1. validate required fields                   → 400 if missing
     ├─ 2. mint taskId
     ├─ 3. write Task File  gs://{GCP_PID}-agents-data/coder/{taskId}/task.json
     │                                                 ← always before step 4
     └─ 4. publish Toto message  type=taskRequested, data={ taskId }
                       on topic  agent-coder-tasks-<env>  (GKE project)
                                   │
                                   ▼
                     KEDA ScaledJob "agent-coder" pulls it, runs, acks/nacks
```

That's the whole service. It's a **front door**, not an orchestrator. It doesn't start
jobs, track status, retry, or know what a repository is. Pub/Sub and its dead-letter
policy handle delivery and retries. `agent-coder` handles everything after that.

### 1.2 Who is it for?

**Me, via curl**, at home and at DR. I want to start an `agent-coder` run without
hand-writing a `task.json`, without `gsutil` / `gcloud pubsub` permissions in my own shell,
and without remembering per-environment bucket, topic and project names.

### 1.3 What problems does it solve?

- **Manual, error-prone dispatch.** Today a run means writing `task.json` to the right GCS
  path by hand, then publishing `{"taskId"}` on the right topic in a *different* GCP project.
  Two steps, two projects, and nothing stops you publishing an id whose Task File doesn't exist.
- **Credentials in the wrong place.** The caller needs storage write and Pub/Sub publish
  rights. With the service in between, only its workload identity has them, and the caller
  only needs a Toto token.
- **Environment knowledge scattered.** Bucket, topic and project names per environment live
  in one service's config, not in people's shell history.

### 1.4 Out of scope (v1)

- Task status, listing, or cancellation.
- Multiple agent types. `coder` is the only one.
- Duplicate protection for the same issue.
- Launching or scaling the agent. That's KEDA's job.

---

## 2. Core Concepts

| Term | Definition |
|---|---|
| **Task** | A unit of work for `agent-coder`: implement one GitHub issue in one repo. |
| **taskId** | Id minted by `ape-tasks`. Names the Task File's folder and is the only thing sent on the queue. |
| **Task File** | `task.json` at `gs://{GCP_PID}-agents-data/coder/{taskId}/task.json`. Written once by `ape-tasks`, read by `agent-coder`. The audit record of what was asked. |
| **Task Message** | The Toto message published to request a run: envelope `type: "taskRequested"`, `data: { taskId }`. |
| **Task Topic** | `agent-coder-tasks-<env>`, in the GKE project. Exactly-once delivery, DLQ after 5 attempts (`toto-terra-gke`). |
| **Toto envelope** | The `TotoMessage` shape totoms publishes: `{ timestamp, cid, id, type, msg, data }`. |
| **ScaledJob** | The KEDA resource that starts one `agent-coder` pod per message in the subscription backlog. |
| **Write-before-publish** | The ordering rule: the Task File must exist before its taskId is on the queue, or a pod can pull an id it can't resolve. |

---

## 3. Features

### 3.1 `POST /tasks` — queue a task

Delegate `PostTask` (`src/dlg/PostTask.ts`), following the template's delegate conventions.

1. **Validate.** `parseRequest` requires `repoURL` and `issueURL` to be present and non-blank.
   It checks presence only and doesn't parse the values, because `agent-coder` owns the
   meaning of the fields. `baseBranch` is optional; if missing, it isn't written, and
   `agent-coder` defaults it to `main`. Every missing field is reported in one 400.
2. **Mint `taskId`.** `randomUUID()`.
3. **Write the Task File** through `AgentsDataBucketAPI` (`src/api/`). The body is
   `{ taskId, repoURL, issueURL, baseBranch? }`, which is exactly `agent-coder`'s
   `TaskSpec` wire format.
4. **Publish the Task Message** through the totoms `TotoMessageBus`, with logical topic
   `agentCoderTasks`.
5. **Respond** `201 { taskId, taskFile }`.

**Failure behaviour**

| Fails at | Result | Response |
|---|---|---|
| 1 | Nothing written | 400 |
| 3 | Nothing written | 500 |
| 4 | Orphan `task.json`, never run. Harmless, and it records what was asked. | **Must be 500**. See 3.3. |

### 3.2 Toto-native publishing (requires a change in `agent-coder`)

`ape-tasks` publishes through the standard totoms message bus, so the message on the queue
is a full Toto envelope with the id in `data.taskId`.

**This breaks `agent-coder` today.** `parse_task_id` (`runner/main.py`, branch
`feature/gke-pubsub-queue-job`) reads a top-level `taskId`, and acks and drops any message
without one. If nothing else changes, every task from `ape-tasks` is silently discarded.

**Required companion change in `agent-coder`:** `parse_task_id` accepts either shape:
top-level `taskId` (keeps `gcloud pubsub topics publish '{"taskId":"…"}'` working, as
documented in its README) or `data.taskId` (Toto envelope). This must be merged and deployed
**before** `ape-tasks` goes live in any environment.

Why Toto-native rather than a raw publish: it matches how every other Toto service
publishes, it gives a `cid` that traces a run back to the request that started it, and
`type` leaves room for other message kinds on Toto topics later.

### 3.3 Publish failures must surface

totoms 2.5.0's `GCPPubSubImpl.publishMessage` catches publish errors, logs them, and
**doesn't rethrow**. If `PostTask` relies on it as-is, a failed publish returns `201` with a
taskId that will never run. That's the worst outcome for a fire-and-forget endpoint.

v1 needs one of these (see OQ-02):
- a totoms change so `publishMessage` rethrows (preferred, since it fixes every Toto service), or
- `ape-tasks` supplying a `messageBusOverride` that rethrows.

### 3.4 Two environments, one codebase

Home and DR use the same mechanism (GKE + KEDA + Pub/Sub). Only configuration differs:
`GCP_PID` (bucket project), the Task Topic's full resource name (GKE project), and the
hyperscaler config. No code paths branch on environment.

### 3.5 Toto auth

Standard Toto JWT validation, provided by totoms and issued by `toto-ms-auth`. Callers need
a valid Toto token.

---

## 4. Data Models

### 4.1 Request — `POST /tasks`

```json
{
  "repoURL": "https://github.com/nicolasances/agent-coder.git",
  "issueURL": "https://github.com/nicolasances/agent-coder/issues/3",
  "baseBranch": "main"
}
```

| Field | Required | Notes |
|---|---|---|
| `repoURL` | yes | HTTPS clone URL. Not parsed. |
| `issueURL` | yes | The issue `agent-coder` will implement. Not parsed. |
| `baseBranch` | no | Omitted → `agent-coder` defaults to `main`. |

Unknown fields are rejected with 400, so typos don't silently disappear. (Unlike
`gale-ms-dispatcher`, which passed them through.)

### 4.2 Response

```json
{ "taskId": "7b1e…", "taskFile": "gs://<pid>-agents-data/coder/7b1e…/task.json" }
```

### 4.3 Task File — `task.json`

Exactly `agent-coder`'s `TaskSpec` wire format. Nothing added, nothing renamed:

```json
{ "taskId": "7b1e…", "repoURL": "…", "issueURL": "…", "baseBranch": "main" }
```

### 4.4 Task Message — on `agent-coder-tasks-<env>`

```json
{
  "timestamp": "20261122T101500",
  "cid": "<correlation id of the POST>",
  "id": "7b1e…",
  "type": "taskRequested",
  "msg": "Task 7b1e… requested for agent coder",
  "data": { "taskId": "7b1e…" }
}
```

`id` = `taskId`, so totoms' publish logs name the task.

### 4.5 Configuration

| Item | Where | Notes |
|---|---|---|
| `GCP_PID` | env | Toto project. Derives the bucket `{GCP_PID}-agents-data`. |
| `HYPERSCALER` | env | `gcp`. |
| Task Topic resource name | Secret Manager secret, per totoms `MessageBusConfiguration.topics[].secret` | Full `projects/<gke-project>/topics/agent-coder-tasks-<env>`. See OQ-03. |
| Mongo | none | `getMongoSecretNames()` returns `null`. |

### 4.6 IAM (service's workload identity)

| Permission | Resource | Project |
|---|---|---|
| `roles/storage.objectCreator` | `{GCP_PID}-agents-data`, prefix `coder/` if possible | Toto |
| `roles/pubsub.publisher` | topic `agent-coder-tasks-<env>` | GKE (set manually, per `toto-terra-gke/docs/operations.md`) |
| `roles/secretmanager.secretAccessor` | topic secret, auth secrets | Toto |

---

## 5. Key User Stories

| # | As a user, I want to… | So that… |
|---|---|---|
| US-01 | `curl -X POST /tasks` with a repo and an issue and get a taskId back | I can start an agent run in one command |
| US-02 | get a 400 naming every missing field | I fix my request in one round trip |
| US-03 | get a 500 when the task couldn't be queued | I never wait for a PR that will never come |
| US-04 | use the same request at home and at DR | I don't need to know which bucket or topic each environment uses |
| US-05 | find the Task File for a taskId in GCS | I can see what was asked, and next to it `trace.json` / `task-output.json` for what happened |
| US-06 | trace a run's logs back to the request that started it | debugging goes from POST → message → pod via one `cid` |

---

## 6. Constraints & Assumptions

### 6.1 Constraints

- **Toto conventions.** Built from `toto-node-template` and follows its `AGENTS.md`: one
  delegate per operation, external calls in `src/api/`, object-argument constructors.
- **`agent-coder` owns the task contract.** `ape-tasks` writes its `TaskSpec` exactly and
  doesn't interpret any field.
- **Write-before-publish.** Non-negotiable. A taskId must never be on the queue before its
  Task File exists.
- **Cross-project.** Bucket in the Toto project, topic in the GKE project.
- **Pub/Sub IAM is manual.** The Terraform VM can't set it (`toto-terra-gke/docs/operations.md`).

### 6.2 Assumptions (bets)

| # | Bet | What breaks it |
|---|---|---|
| A-01 | DR has the same layout: an `agents-data` bucket, an `agent-coder-tasks-<env>` topic, a KEDA ScaledJob | DR differs in naming or project split → config grows, or code branches |
| A-02 | `agent-coder` can be changed to accept `data.taskId` before go-live | Change blocked or deprioritised → `ape-tasks` is useless until it lands (every message dropped) |
| A-03 | totoms boots fine with no Mongo and with a message bus used only for publishing | `TotoMicroservice.init` requires DB config or a handler → workaround needed |
| A-04 | Duplicate POSTs are rare with one curl user | Concurrent POSTs for one issue → two paid runs. `agent-coder` only skips once a PR is **already open** |
| A-05 | Toto auth works for curl at DR | DR access to `toto-ms-auth` blocked → DR needs a different auth path (see OQ-04) |

---

## 7. Open Questions

| # | Question | Options / Notes |
|---|---|---|
| OQ-01 | Order and owner of the `agent-coder` `data.taskId` change | Separate issue in `agent-coder`, merged on `feature/gke-pubsub-queue-job` or after it lands on `main`. Blocks go-live. |
| OQ-02 | How to surface publish failures (3.3)? | Fix totoms to rethrow (benefits all services, needs a totoms release), or a rethrowing `messageBusOverride` in `ape-tasks`. Check that no existing service depends on the swallow. |
| OQ-03 | Does the totoms GCP bus publish to a topic in another project? | Its `PubSub` client is built with `projectId: GCP_PID`. Probably works if the topic secret holds the full `projects/<gke>/topics/…` name. **Verify against `@google-cloud/pubsub` docs and test**, don't assume. |
| OQ-04 | Toto auth at DR | Same `toto-ms-auth` reachable from DR, or a DR-specific path. Answer before the DR deployment. |
| OQ-05 | Deploy target for `ape-tasks` itself | Cloud Run (template's `gcp/`) or GKE (`gke-external/`). The template supports both. GKE keeps the service next to the topic. |
| OQ-06 | `type` value: `taskRequested` vs something agent-specific | Matters only once a topic carries more than one kind of message. |
| OQ-07 | Retire `gale-ms-dispatcher` and `gale-dr-dispatcher` when? | After `ape-tasks` runs in both envs. Archive rather than delete; their concept docs record useful reasoning (write-before-trigger, failure windows). |

---

## 8. Not Doing (and Why)

- **`GET /tasks/{taskId}` / status tracking.** The goal is fire-and-forget. GCS already holds
  `task-output.json` and `trace.json` per task. A status endpoint brings back a database and
  every failure-window question `gale-ms-dispatcher` had to document.
- **Mongo.** Nothing to index without a status endpoint. The Task File is the record.
- **Agent Registry / `/agents/{id}/tasks`.** There's one agent. A registry for one row is
  ceremony. When a second agent shows up, add an `agent` body field (see §9).
- **Launching jobs.** KEDA scales from the subscription backlog. Calling the Kubernetes API
  would duplicate it and require RBAC.
- **Duplicate protection.** A deterministic taskId plus a 409 needs a force flag and changes
  re-run semantics. One curl user makes it rare. Accepted as a known gap (A-04).
- **Retries.** Pub/Sub redelivery on nack plus the DLQ already do this with the right
  semantics (`agent-coder` nacks only on infra failure).
- **Raw (non-Toto) publish.** Simpler, and it needs no `agent-coder` change, but it steps
  outside the Toto bus convention and loses `cid` tracing. Rejected in favour of 3.2.
- **Deriving `repoURL` from `issueURL`.** Saves one field, but means parsing GitHub URLs
  (forks, `.git`, Enterprise hosts). Not worth it for v1.

---

## 9. Ideas for Future Versions

- **Issue-only input** — `POST /tasks { issueURL }`, with `repoURL` derived. One field per curl.
- **Multiple agents** — optional `agent` body field (default `coder`) mapping to a bucket prefix and topic. No URL change.
- **Status** — `GET /tasks/{taskId}` reading `task-output.json` straight from GCS. No database needed.
- **GitHub trigger** — a label on an issue calls `POST /tasks` via an Action or webhook.
- **Duplicate guard** — deterministic taskId per issue, 409 if `task.json` exists, `force: true` to re-run.
- **Skills ref per task** — once `agent-coder` supports pinned skills (its §3.5), pass the ref through the Task File.
