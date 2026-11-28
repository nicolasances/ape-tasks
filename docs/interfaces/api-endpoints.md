# API Endpoints

All paths are relative to the service's base path `/apetasks`.

- [Tasks](#tasks)
  - [POST /tasks](#post-tasks)

## Tasks
| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/tasks` | Starts an agent task: writes the Task File and publishes the Task Message on the agent's queue. |

### POST /tasks
**Used for:** starting an agent task with one HTTP call, instead of writing `task.json` to GCS and publishing on Pub/Sub by hand. The request's `type` selects the agent (v1: `coding` → `agent-coder`) and `payload` carries the task-specific data. Full behaviour, validation rules and errors: [docs/features/post-tasks.md](../features/post-tasks.md).

**Request & Response:** `PostTaskRequest` and `PostTaskResponse` in [`src/dlg/PostTask.ts`](../../src/dlg/PostTask.ts). Payload rules per task type in [`src/util/TaskTypes.ts`](../../src/util/TaskTypes.ts).

```json
// Request
{ "type": "coding", "payload": { "repoURL": "https://github.com/org/repo.git", "issueURL": "https://github.com/org/repo/issues/3", "baseBranch": "main" } }

// Response
{ "taskId": "7b1e…", "taskFile": "gs://<pid>-agents-data/coder/7b1e…/task.json" }
```

The response status is **200**, not the 201 in the feature spec: totoms 2.5.0 always answers 200 on success and a delegate can't change that.

Invalid requests get a 400 with every problem listed in one message. A failed Task File write gives a 500, and nothing is published.
