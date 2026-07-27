# Deployment promotion

`promote-deployment` hands a newly published Cognos backend image to the infrastructure repository
without deploying it directly. It updates the Cognos `release_image.reference` in
`applications.yml` with the image tag and immutable digest, pushes the bot-owned
`deploy/cognos-backend` branch, and creates or refreshes a promotion pull request. Merging that
pull request is the deployment authorisation boundary.

The command is run by [the deployment workflow](../../../.github/workflows/deploy.yml), but is not
coupled to GitHub Actions.

## Providers

The promotion workflow depends on a small repository-provider interface:

- clone the infrastructure repository;
- push the promotion branch; and
- create or update its pull request.

GitHub and Forgejo implement this interface separately. The deployment workflow defaults to Forgejo
and reaches it through Tailscale; GitHub remains a tested fallback provider.

Set `INFRASTRUCTURE_PROVIDER` to `github` or `forgejo`. The command itself defaults to `github` when
run independently; the deployment workflow defaults it to `forgejo`.

### GitHub

| Variable                               | Required | Purpose                                       |
| -------------------------------------- | -------- | --------------------------------------------- |
| `GITHUB_INFRASTRUCTURE_REPOSITORY_URL` | Yes      | HTTPS clone URL                               |
| `GITHUB_INFRASTRUCTURE_REPOSITORY`     | Yes      | Repository in `owner/repository` form         |
| `GITHUB_INFRASTRUCTURE_TOKEN`          | Yes      | Contents and pull-request write access        |
| `GITHUB_INFRASTRUCTURE_USERNAME`       | Yes      | GitHub account that owns the token            |
| `GITHUB_INFRASTRUCTURE_API_URL`        | No       | API URL; defaults to `https://api.github.com` |

Use a fine-grained token or GitHub App installation token scoped only to the infrastructure
repository. GitHub promotion pull requests are assigned to `kisamoto`; GitHub requires the assignee
to have push access to the infrastructure repository.

### Forgejo

| Variable                                | Required | Purpose                                |
| --------------------------------------- | -------- | -------------------------------------- |
| `FORGEJO_INFRASTRUCTURE_REPOSITORY_URL` | Yes      | HTTPS clone URL                        |
| `FORGEJO_INFRASTRUCTURE_REPOSITORY`     | Yes      | Repository in `owner/repository` form  |
| `FORGEJO_INFRASTRUCTURE_TOKEN`          | Yes      | Contents and pull-request write access |
| `FORGEJO_INFRASTRUCTURE_API_URL`        | Yes      | API base URL ending in `/api/v1`       |

## Image and workflow inputs

The command also requires:

| Variable                | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `IMAGE_TAG`             | Readable `sha-<40-character-git-sha>` image tag       |
| `IMAGE_DIGEST`          | Immutable `sha256:<64-character-digest>` image digest |
| `INFRASTRUCTURE_BRANCH` | Bot-owned promotion branch                            |
| `GITHUB_REPOSITORY`     | Source application repository                         |
| `GITHUB_SERVER_URL`     | Source host URL used in the pull-request body         |
| `GITHUB_SHA`            | Source commit                                         |
| `GITHUB_RUN_ID`         | Source workflow run used in the pull-request body     |

The `GITHUB_*` source metadata names follow GitHub Actions because that is currently where Cognos
builds images; they are independent of the selected infrastructure repository provider.

## Run

From `backend/`, with the required variables already exported:

```sh
mise exec -- go run ./cmd/promote-deployment
```

Run its focused tests with:

```sh
mise exec -- go test ./cmd/promote-deployment
```

Re-running the command for an image already present in the application manifest is a no-op. A
newer promotion force-updates only the dedicated bot branch; it does not modify the infrastructure
repository's default branch or merge the pull request.
