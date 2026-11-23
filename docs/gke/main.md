# Deploying ape-tasks on GKE and Cloud Run

This guide describes how `ape-tasks` runs on the GKE cluster managed by [toto-terra-gke](https://github.com/nicolasances/toto-terra-gke), which lives in a **separate GCP project** from the toto projects.

How it works:
- **Terraform** creates everything the microservice needs. `toto-terra` handles the Artifact Registry, GitHub environment, secrets and IAM. `toto-terra-gke` handles the Deployment, Service, route, probes and env.
- **The CI/CD pipeline** (GitHub Actions in this repo) builds the image, pushes it, and deploys it with `kubectl set image`. After the Deployment has been created, Terraform no longer changes the image.
- The pipeline also deploys to **Cloud Run**.

## Prerequisites
- A **compliant GKE cluster**. Read the [Guide to Toto Terraforming for GKE](https://github.com/nicolasances/toto-terra-gke).
- **CI access to the cluster**, set up once for all microservices (see `docs/operations.md` in `toto-terra-gke`):
    - the manual `roles/container.clusterViewer` grant on the GKE project for the `toto-cicd` service accounts of both toto projects;
    - the `ci-deployer` Role (`workloads/ci-deployer.tf`) applied. It covers every Deployment in the `dev` and `prod` namespaces, so there is nothing to add per microservice.
- The `toto-terra` variables `gke_project_id`, `gke_project_number`, `gke_cluster_name` and `gke_cluster_location` set.

## Setup

### 1. Name and base path
- The `name` in `package.json` **must be the microservice name** (`ape-tasks`). The pipeline uses it to name the Docker image, its Artifact Registry repository, and the Kubernetes Deployment and container it updates. The Terraform files use the same name.
- The `basePath` in `src/index.ts` is `/apetasks`. The base path is **mandatory** on GKE. All microservices share the same hostname and the Kubernetes Gateway routes on the path, so it must be **unique** across microservices.

### 2. CI/CD pipeline
The workflows are in `.github/workflows` (`release-dev.yml`, `release-prod.yml`). If the service needs more env vars, add them to the `--set-env-vars` of the `Deploy to Cloud Run` step. Today they are `HYPERSCALER`, `GCP_PID`, `SERVICE_BASE_URL` and `GALE_BROKER_URL`.

### 3. Terraform files
The Terraform files are not kept in this repo. They live in the infrastructure repos:
- `toto-terra`: `ape-tasks.tf` ([issue #53](https://github.com/nicolasances/toto-terra/issues/53)). It creates the Artifact Registry repository (readable by the GKE nodes), the GitHub environment with the secrets and variables the pipeline uses (`CICD_SERVICE_ACCOUNT`, `GCP_PID`, `GKE_PROJECT_ID`, `GKE_CLUSTER_NAME`, `GKE_CLUSTER_LOCATION`, `GKE_NAMESPACE`), and the service accounts.
- `toto-terra-gke`: `workloads/ape-tasks.tf` ([issue #16](https://github.com/nicolasances/toto-terra-gke/issues/16)). It creates the Deployment, Service, route and probes.

### 4. toto-terra (the toto GCP projects)
Apply `ape-tasks.tf` in `toto-terra` on **both** environments **before** the first push.

### 5. Push the code (first image)
Push a `feature/**` branch to deploy to dev, and merge to `main` to deploy to prod.

The pipeline pushes the image and deploys it to Cloud Run. The Deployment doesn't exist on GKE yet, so the `Deploy to GKE` step logs a warning (*"Deployment not found … create it with toto-terra-gke using image tag X"*) and **passes**. Note the image tag of each environment from that warning:
- dev: `<version>-<short sha>`, e.g. `1.0.0-a1b2c3d`
- prod: `<version>`, e.g. `1.0.0`

**The image must exist before step 6.** Otherwise the Deployment never becomes ready and the `terraform apply` times out.

### 6. toto-terra-gke (the GKE cluster)
- Apply `workloads/ape-tasks.tf` in `toto-terra-gke`.
- Add the image tags from step 5 to `scripts/tf-env.template.sh` and to your own env file: <br>
`export TF_VAR_ape_tasks_image_tag='{"dev":"1.0.0-a1b2c3d","prod":"1.0.0"}'` (`ape_tasks`).
- On the Terraform VM, `source` your env file, then run `terraform apply` in `workloads/`. That creates the microservice in the `dev` and `prod` namespaces and exposes it on `https://<environment hostname>/apetasks/`.

From now on the pipeline deploys every push. `TF_VAR_ape_tasks_image_tag` is only used if Terraform recreates the Deployment. Changing it has no effect otherwise.

## Deploying a new version

| Push on | Workflow | GitHub environment | GKE namespace | Image tag |
|---------|----------|--------------------|---------------|-----------|
| `feature/**`, `issue/**` | `release-dev.yml` | `totoexperiments` | `dev` | `<package.json version>-<short sha>` |
| `main` | `release-prod.yml` | `totolive` | `prod` | `<package.json version>` |

- `main` does **not** deploy to dev. Pushes that only touch `docs/` or `*.md` files don't trigger a deploy.
- **Feature branches:** no version bump needed, because the short sha makes every tag unique. If a job is re-run for the same commit, build and push are skipped and the existing image is redeployed.
- **`main`:** every merge needs a **version bump** in `package.json`. The prod workflow fails with *"Bump the version in package.json"* if the tag already exists.
- The GKE deploy runs `kubectl set image` and then `kubectl rollout status`. The job fails if the rollout doesn't complete within 5 minutes.

Check which image is running:
```bash
kubectl -n <dev|prod> get deploy ape-tasks -o jsonpath='{..image}'
```

## Rolling back
There is no automatic rollback. Either:
- push a fix (feature branch for dev, version bump + merge to `main` for prod);
- roll back to the previous ReplicaSet: `kubectl -n <dev|prod> rollout undo deploy/ape-tasks` (list revisions with `kubectl rollout history`);
- or, on dev only, re-run the CI job of an older commit. On prod a re-run fails the version check, because the tag already exists.

A rollback is overwritten by the next CI deploy of that environment. The Artifact Registry cleanup policy (in `toto-terra`) deletes old images, so rolling back to an old image fails if that image has been deleted.
