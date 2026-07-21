# Cognos

Cognos is an AI chat application that stores Message content as ciphertext. Decryption happens in
the browser, and an Account holder's password is used only for sign-in. The
[security model](./docs/security-model.md) defines the exact trust boundary.

## Repository map

| Path                                             | Purpose                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| [`backend/`](./backend/)                         | Go API and PocketBase data layer                |
| [`frontend/`](./frontend/)                       | Angular chat application                        |
| [`packages/ui-angular/`](./packages/ui-angular/) | Shared Angular components                       |
| [`packages/ui/`](./packages/ui/)                 | Design tokens and base styles                   |
| [`web/`](./web/)                                 | Astro marketing site                            |
| [`e2e/`](./e2e/)                                 | Playwright browser and API tests                |
| [`docs/`](./docs/)                               | Product, security and operational documentation |

Use [CONTEXT.md](./CONTEXT.md) for canonical domain language. Start documentation work at the
[documentation map](./docs/README.md); business processes are the source of truth for product
behaviour.

## Run locally

Requirements are installed through `mise`; project commands use `just`, `pnpm`, `go`, `podman` and
`uv`.

1. Install toolchains and dependencies:

   ```sh
   just install-dev
   ```

2. Start the API, app, marketing site and mock AI Provider:

   ```sh
   just dev
   ```

3. Open the PocketBase admin UI at <http://127.0.0.1:8090/_/>. Create the first superuser if
   prompted.

4. Create a record in the `users` auth collection with an email address, password and `verified`
   enabled. Local development has no SMTP, and AI-consuming endpoints reject unverified Accounts.

5. Open the Angular app at <https://cognos.local:4200> and sign in.

`just backend`, `just frontend` and `just web` run individual services. Local PocketBase data lives
in `backend/pb_data`.

## Check changes

```sh
just go-test
pnpm test
pnpm lint
just e2e-api
just e2e
just fmt
```

`just e2e-api` and `just e2e` start an isolated stack on non-standard ports and do not require
`just dev`. See the [e2e guide](./e2e/README.md) for targeted runs.

## Deployment

Production is promoted from reviewed immutable image digests through the private deployment
repository. Do not build on, or pull this repository directly onto, a production host.

The [deployment interface](./docs/deployment-interface.md) defines the contract between this
repository and production operations. Command-specific setup lives beside the
[promotion command](./backend/cmd/promote-deployment/README.md) and
[Bunny uploader](./backend/cmd/bunny-deploy/README.md).
