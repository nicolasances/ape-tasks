# Feature: `POST /tasks` — start an agent task

![Status](https://img.shields.io/badge/status-implemented-brightgreen?style=flat-square)

> Status: implemented (issue #3), with one deviation: success is 200, not 201 (see §6). Written 2026-11-28.
> Builds on [concept §3.1](../concept.md#31-post-tasks--queue-a-task). Where this file and the
> concept differ on the request shape, this file wins.

## 1. Summary

A consumer starts an agent task with one HTTP call. The request says **which kind of task** it
is (`type`) and carries the **task-specific data** (`payload`). `ape-tasks` uses `type` to pick
the destination agent (its Task File location and its Pub/Sub topic), validates `payload`
against what that agent expects, writes the Task File, and publishes the Task Message.

v1 supports one type: `coding`, handled by `agent-coder`. Any other type is a 400.

Full path, with the service's `basePath`: `POST /apetasks/tasks`.

## 2. Request

```json
{
  "type": "coding",
  "payload": {
    "repoURL": "https://github.com/nicolasances/agent-coder.git",
    "issueURL": "https://github.com/nicolasances/agent-coder/issues/3",
    "baseBranch": "main"
  }
}
```

### 2.1 Envelope

| Field | Required | Rule |
|---|---|---|
| `type` | yes | String. Must be a supported task type. v1: `coding`. |
| `payload` | yes | JSON object. Its schema depends on `type`. |

Any other top-level field is rejected with 400.

### 2.2 `coding` payload

Exactly the fields of `agent-coder`'s `TaskSpec`, minus `taskId` (which `ape-tasks` mints).

| Field | Required | Rule |
|---|---|---|
| `repoURL` | yes | Non-blank string. Not parsed. |
| `issueURL` | yes | Non-blank string. Not parsed. |
| `baseBranch` | no | If present, non-blank string. If absent, it isn't written and `agent-coder` defaults to `main`. |

Any other payload field is rejected with 400. URLs are not parsed or checked: `agent-coder`
owns their meaning.

## 3. Behaviour

1. **Validate the envelope.** `type` and `payload` present, no extra fields.
2. **Resolve the task type.** Look `type` up in the task-type registry. Unknown → 400, and stop
   here (no schema to validate the payload against).
3. **Validate the payload** with the type's validator. All problems from steps 1 and 3 are
   reported together in one 400.
4. **Mint `taskId`** with `randomUUID()`.
5. **Write the Task File** to `gs://{GCP_PID}-agents-data/{bucketPrefix}/{taskId}/task.json`.
   For `coding`: `gs://{GCP_PID}-agents-data/coder/{taskId}/task.json`, body
   `{ taskId, repoURL, issueURL, baseBranch? }`. Nothing added, nothing renamed: no `type`, no
   envelope. Always before step 6 (write-before-publish).
6. **Publish the Task Message** through the totoms `TotoMessageBus` on the type's logical topic.
   For `coding`: logical topic `agentCoderTasks` → Pub/Sub topic `agentcodertasks` in `GCP_PID`.
   Toto envelope `type: "taskRequested"`, `id: taskId`, `data: { taskId }`.
7. **Respond** `201 { taskId, taskFile }` (actually 200 with totoms 2.5.0, see §6).

### 3.1 Task-type registry

One map in code from task `type` to how that task is routed and validated:

```ts
// e.g. src/util/TaskTypes.ts (name and location are a suggestion)
{
  coding: {
    bucketPrefix: "coder",
    topic: "agentCoderTasks",        // logical name, see §5
    validatePayload: (payload) => string[] /* list of problems, empty if valid */,
    toTaskFile: (taskId, payload) => ({ taskId, repoURL, issueURL, baseBranch? }),
  },
}
```

Adding an agent later means adding one entry, plus its topic in the message bus configuration.
No database, no Agent Registry (see [concept §8](../concept.md#8-not-doing-and-why)).

### 3.2 Code layout (per `AGENTS.md`)

| Piece | Where |
|---|---|
| Delegate `PostTask` | `src/dlg/PostTask.ts`. `parseRequest` does steps 1–3, `do` does steps 4–7. |
| Task-type registry | `src/util/TaskTypes.ts` (suggested). |
| GCS writer | `src/api/AgentsDataBucketAPI.ts`. The only place that talks to the bucket. |
| Topic wiring | `messageBusConfiguration.topics` in `src/index.ts`. |

## 4. Responses

### 4.1 Success — 201 (200 for now, see §6)

```json
{ "taskId": "7b1e…", "taskFile": "gs://<pid>-agents-data/coder/7b1e…/task.json" }
```

### 4.2 Errors

| Case | Status | Example message |
|---|---|---|
| `type` missing | 400 | `type is required` |
| `type` not supported | 400 | `Unsupported task type "review". Supported types: coding` |
| `payload` missing or not an object | 400 | `payload is required and must be an object` |
| Unknown top-level or payload field | 400 | `Unknown field: payload.repoUrl` |
| Payload field missing, blank or wrong type | 400 | `payload.repoURL is required`, `payload.baseBranch must be a non-blank string` |
| Several of the above | 400 | All problems in one response |
| Task File write fails | 500 | Nothing published. |
| Publish fails | **201** (known gap) | See §6. |

Example of several problems in one response:

```json
{ "code": 400, "message": "Invalid request: payload.repoURL is required; payload.issueURL is required; Unknown field: payload.branch" }
```

The exact error body follows whatever `ValidationError` in totoms produces. The point is that
every problem is listed in one round trip.

## 5. Configuration and infrastructure

| Item | Value | Owner |
|---|---|---|
| Pub/Sub topic | `agentcodertasks`, in `GCP_PID` (totoexperiments = dev, totolive = prod) | `toto-terra` `pubsub.tf` (exists) |
| Subscription | `agentcodertasks-sub`, pulled by the KEDA ScaledJob | `toto-terra` / `toto-terra-gke` (exists) |
| Topic-name secret for totoms (`topics[].secret`) | e.g. `agent_coder_tasks_topic_name` → `agentcodertasks` | `toto-terra` (**missing**) |
| Publisher on `agentcodertasks` | GKE principal `ns/<env>/sa/ape-tasks` | `toto-terra` `ape-tasks.tf` (exists) |
| Publisher on `agentcodertasks` | Cloud Run SA `ape-tasks@…` | `toto-terra` (**missing**) |
| `storage.objectCreator` on `{GCP_PID}-agents-data` | GKE principal and Cloud Run SA | `toto-terra` (**missing**) |
| `agent-coder` reads `data.taskId` from the Toto envelope | — | `agent-coder` #13 (merged) |

The three **missing** items are a prerequisite, tracked in a separate `toto-terra` issue. The
code can be written and unit-tested without them, but the end-to-end check in §7 needs them.

## 6. Known gaps

- **Silent publish failures.** totoms 2.5.0's `GCPPubSubImpl.publishMessage` logs publish errors
  and doesn't rethrow. If the publish fails, the response is still 201 and the task never runs;
  an orphan `task.json` is left in GCS. Accepted for now
  ([concept §3.3](../concept.md#33-publish-failures-must-surface), OQ-02). Fix later, preferably
  in totoms.
- **200 instead of 201.** totoms 2.5.0's `TotoAPIController.path` always answers 200 on success,
  and a delegate can't set the status code. `POST /tasks` returns 200 until totoms supports
  custom success codes. Consumers should treat any 2xx as success.
- **No duplicate protection.** Two POSTs for the same issue give two runs (concept A-04).
- **No dead-letter topic.** `agentcodertasks-sub` retries with backoff and keeps messages for
  1 day; there's no DLQ.

## 7. Acceptance criteria

- [ ] `POST /apetasks/tasks` with a valid `coding` request returns 201 `{ taskId, taskFile }`.
- [ ] `task.json` exists at `taskFile` and equals `{ taskId, repoURL, issueURL, baseBranch? }`
      exactly; `baseBranch` is absent when it wasn't sent.
- [ ] A Toto message `type: "taskRequested"`, `data: { taskId }` is published on `agentcodertasks`,
      and only after `task.json` was written.
- [ ] Unknown `type` → 400 naming the supported types.
- [ ] Missing/blank/wrong-type fields and unknown fields (top-level and payload) → one 400
      listing every problem.
- [ ] Task File write failure → 500 and nothing published.
- [ ] Unit tests cover the validation rules and the registry lookup.
- [ ] In dev (once the `toto-terra` prerequisite is applied): a POST produces `task.json` and a
      message that `agent-coder` picks up and runs.

## 8. Out of scope

- Task types other than `coding`.
- Surfacing publish failures as 500 (§6).
- Status, listing, cancellation (`GET /tasks/...`).
- Duplicate protection.
- The `toto-terra` infra changes (separate issue).
