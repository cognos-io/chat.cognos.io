# Cognos backend

The backend is a Go API built on PocketBase. It authenticates Accounts, enforces access and billing
rules, sends transient plaintext prompts to approved AI Providers, and persists private content as
ciphertext.

The browser owns decryption keys. Read the [security model](../docs/security-model.md) before
changing Message, key, Attachment, memory, Redaction or Vault handling. Current product rules live
in [business processes](../docs/business_processes/README.md); endpoint scope lives in
[API permissions](../docs/api-permissions.md).

## Run and test

From the repository root:

```sh
just backend
just go-test
go -C backend vet ./...
just e2e-api
```

`just backend` serves PocketBase on <http://localhost:8090>. The admin UI is at
<http://localhost:8090/_/> and local data is stored in `backend/pb_data`.

`just e2e-api` is the preferred HTTP-boundary check. It starts an isolated backend and mock AI
Provider; a running development stack is not required.

## Configuration

[`configs/api.example.yaml`](./configs/api.example.yaml) documents every setting and environment
override. Configuration precedence is:

1. `configs/api.{development,production,local}.yaml`
2. `COGNOS_*` environment variables
3. `COGNOS_*_FILE` secret files for supported secrets

Keep local configuration in ignored files. Prefer secret-file settings for Provider, Paddle and MFA
keys. Never log configuration values, prompts, Message content, filenames, URLs returned by web
search, key material or Provider payloads.

## Main packages

| Path                            | Responsibility                                         |
| ------------------------------- | ------------------------------------------------------ |
| `cmd/api/`                      | API entry point, routes, middleware and scheduled jobs |
| `internal/handler/`             | HTTP boundary and product orchestration                |
| `internal/chat/`                | encrypted Message persistence                          |
| `internal/crypto/`              | server-side cryptographic helpers                      |
| `internal/billing/`             | access gates, cost calculation and ledgers             |
| `internal/gateway/`             | AI Provider transport and normalisation                |
| `internal/participants/`        | standalone Conversation access                         |
| `internal/projectparticipants/` | Project access and roles                               |

Database schema changes are forward-only migrations under `db/migrations/`. Add or change an API
route only with the permission-map update and cross-Account denial tests required by
[`docs/api-permissions.md`](../docs/api-permissions.md).

## Supporting commands

- [`cmd/bunny-deploy`](./cmd/bunny-deploy/README.md) uploads built frontend and marketing assets.
- `cmd/mock-ai-provider` provides deterministic local and e2e Completion responses.
- `cmd/generate-key-pair` generates development key material; never use its output as a production
  secret without the production runbook.
