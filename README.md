# ape-tasks

`ape-tasks` is the entry point for tasks that are handed to the agents. It is a NodeJS microservice built on [totoms](https://github.com/nicolasances/totoms).

It exposes `POST /apetasks/tasks`, which starts an agent task: it writes the Task File to the agents-data bucket and publishes the Task Message on the agent's Pub/Sub topic. Only `coding` tasks (handled by `agent-coder`) are supported for now. It also exposes the totoms default endpoints (`GET /`, `GET /health` and `GET /apetasks/`).

It runs on both Cloud Run and GKE. Every push to a `feature/**` branch deploys to dev, every merge to `main` deploys to prod.

## Table of Contents

- [Concept](./docs/concept.md): what `ape-tasks` is for, the features, the data models and the open questions.
- [Features](./docs/features/README.md): index of all features.
- [Feature: `POST /tasks`](./docs/features/post-tasks.md): start an agent task with a `{ type, payload }` request. Only `coding` tasks for now.
- [API endpoints](./docs/interfaces/api-endpoints.md): the REST endpoints the service exposes.
- [Deploying on GKE and Cloud Run](./docs/gke/main.md): how the service is built, deployed and rolled back.

## Development

- `npm test` runs the unit tests (Mocha, in `test/`).
- `npm run dev` runs the service locally with nodemon.
