# Bunny deployment uploader

`bunny-deploy` uploads a completed static build to Bunny Storage and then purges the associated
Pull Zone cache. It is used by [the deployment workflow](../../../.github/workflows/deploy.yml) for
both the Angular application and the marketing site.

## Behaviour

The command requires the build directory to contain an `index.html`. It uploads files in a safe
release order:

1. hash-named assets such as JavaScript, CSS and fonts;
1. other static files; and
1. HTML entry points last.

Each upload includes a SHA-256 checksum. The Pull Zone is purged only after every file has uploaded
successfully. Requests are retried for temporary network failures, rate limits and server errors.
Existing hash-named assets are not deleted, allowing an older HTML release to continue referencing
its original assets during rollback.

## Configuration

Set these environment variables:

| Variable                   | Required | Purpose                                                   |
| -------------------------- | -------- | --------------------------------------------------------- |
| `BUNNY_STORAGE_ZONE`       | Yes      | Storage zone receiving the build                          |
| `BUNNY_STORAGE_KEY`        | Yes      | Password for that Storage zone                            |
| `BUNNY_PULL_ZONE_ID`       | Yes      | Numeric Pull Zone identifier to purge                     |
| `BUNNY_API_KEY`            | Yes      | Account API key used only for the cache purge             |
| `BUNNY_STORAGE_ENDPOINT`   | No       | Regional Storage API URL; defaults to Frankfurt           |

Storage credentials and the Bunny account API key are different secrets. Do not commit either one
or print them in deployment logs.

## Run locally

From `backend/`, supply the build directory as the only argument:

```sh
mise exec -- go run ./cmd/bunny-deploy ../web/dist
```

Normally the variables should come from the deployment environment rather than a repository file.
For the Angular application, use `../frontend/dist/browser` as the build directory.

Run the focused tests with:

```sh
mise exec -- go test ./cmd/bunny-deploy
```
