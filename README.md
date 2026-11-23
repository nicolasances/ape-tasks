# ape-tasks

`ape-tasks` is the entry point for tasks that are handed to the agents. It is a NodeJS microservice built on [totoms](https://github.com/nicolasances/totoms).

Right now it is a deployable skeleton: it only exposes the totoms default endpoints (`GET /`, `GET /health` and `GET /apetasks/`). `POST /tasks` is described in the concept and not implemented yet.

It runs on both Cloud Run and GKE. Every push to a `feature/**` branch deploys to dev, every merge to `main` deploys to prod.

## Table of Contents

- [Concept](./docs/concept.md): what `ape-tasks` is for, the features, the data models and the open questions.
- [Deploying on GKE and Cloud Run](./docs/gke/main.md): how the service is built, deployed and rolled back.
