# API endpoint permissions

How access control works on the custom `/api/v1/*` HTTP API, and where it is
enforced by tests. Read this before adding or reviewing an endpoint.

The chat data collections (`conversations`, `messages`, `participants`, keys,
redaction, memory, attachments) are **locked** at the PocketBase collection
level — the built-in `/api/collections/*` CRUD is denied for everyone. All access
goes through the custom routes below, which apply their own checks.

## Two layers, two guardrails

1. **Authentication** — is the caller logged in? Every `/api/v1` route binds
   `apis.RequireAuth(...)` and rejects anonymous callers with a 401, _except_ a
   small allowlist of intentionally public routes.
   - **Guardrail:** `TestAPIv1RoutesEnforceAuth` in
     `backend/cmd/api/api_auth_surface_test.go` probes every registered route
     anonymously and fails if a non-public route does not return a RequireAuth
     401, or if a public route is unreachable. **A new route must be added to
     `apiV1Routes` there** (and to the `public: true` allowlist only if it is
     deliberately unauthenticated).

2. **Authorization (scope)** — may _this_ caller touch _this_ record? Each
   handler applies an ownership / membership / role check beyond mere auth, and
   returns a neutral **404** for a miss so record ids can't be probed.
   - **Guardrail:** each data-scoped endpoint has a test asserting a
     wrong-user / non-member / non-owner is denied. The 401-only coverage from
     the auth-surface test does **not** count as authorization coverage.

## Scope rules

| Scope            | Meaning                                              | Enforced by                                                                         |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `owner`          | The record's `user`/`owner` field equals the caller  | `auth.ExtractUser` + field compare (`ownedAttachment`, `ownedUserKeyPairRecord`, …) |
| `participant`    | An active row in `participants` for the conversation | `conversationAccessibleByID` / `ownedConversationRecord`                            |
| `admin`          | A participant whose role is admin                    | conversation/project admin check                                                    |
| `project member` | An active row in `project_participants`              | `projectMemberOr404` / `accessibleProjectRecord`                                    |
| `public token`   | A valid `conversation_public_shares` token (no auth) | `publicShareByToken`                                                                |
| `superuser`      | PocketBase superuser only                            | `RequireSuperuserAuth`                                                              |

## Public (unauthenticated) routes

These are the **only** routes reachable without a session. Each is gated by a
secret in the path or a signature, and IP rate-limited. Adding to this list is a
security decision — keep it short.

| Method | Path                                                                   | Gate                                     | Test                             |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| GET    | `/api/v1/public/conversations/{token}`                                 | share token                              | `public_shares_api_test.go`      |
| GET    | `/api/v1/public/conversations/{token}/messages`                        | share token                              | `public_shares_api_test.go`      |
| GET    | `/api/v1/public/conversations/{token}/messages/{messageID}/attachment` | share token + message∈conversation       | `public_shares_api_test.go`      |
| GET    | `/api/v1/public/conversations/{token}/redaction-entries`               | share token (include-sensitive only)     | `public_redaction_share_test.go` |
| GET    | `/api/v1/public/models`                                                | none (id→name catalogue)                 | `models_api_test.go`             |
| POST   | `/webhooks/paddle`                                                     | HMAC signature                           | `paddle_webhook_test.go`         |
| POST   | `/api/v1/auth/mfa/totp`, `/recovery`                                   | one-time `mfaSessionId` proof + cooldown | `mfa_complete_test.go`           |

## Authenticated routes by resource

Scope is in addition to "must be authenticated". The test column names the
authorization (cross-user) coverage.

| Resource                 | Routes                                                                                                                        | Scope                                | Authorization test                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Conversations            | `GET/POST /conversations`, `PATCH/DELETE /conversations/{id}`, `DELETE /conversations`                                        | participant (creator→admin)          | `conversations_api_test.go`, `conversation_list_keys_test.go`, `collection_rules_participants_test.go` |
| Conversation copy        | `POST /conversations/{id}/copies`                                                                                             | participant (read)                   | `conversation_copy_api_test.go`                                                                        |
| Messages                 | `GET /conversations/{id}/messages`, `PATCH/DELETE /messages/{id}`                                                             | conversation participant             | `conversations_api_test.go`                                                                            |
| Message attachment       | `GET /conversations/{id}/messages/{mid}/attachment`                                                                           | conversation participant             | `complete_attachments_api_test.go`                                                                     |
| Participants             | `GET /conversations/{id}/participants` (participant), `POST` (admin)                                                          | participant / admin                  | `participants_api_test.go`                                                                             |
| Public share admin       | `GET` (participant), `POST`/`DELETE /conversations/{id}/public-share` (admin)                                                 | participant / admin                  | `public_shares_api_test.go`                                                                            |
| Key rotation             | `POST /conversations/{id}/rotate`                                                                                             | admin                                | `rotation_api_test.go`                                                                                 |
| Conversation keys        | `GET/POST /conversations/{id}/public-key`, `PATCH …/{kid}`, `GET/POST …/secret-key`                                           | participant (+ key version)          | `public_keys_key_version_test.go`, `secret_keys_key_version_test.go`                                   |
| Redaction (conversation) | `GET/POST /conversations/{id}/redaction-key`, `…/redaction-entries`                                                           | participant                          | `redaction_api_test.go`                                                                                |
| Redaction (user)         | `GET/POST /user-redaction-entries`                                                                                            | owner                                | `redaction_api_test.go`                                                                                |
| Completions              | `POST /completions`, `…/{rid}/stop`, `POST /conversations/{id}/complete`, `…/regenerate`, `…/image`                           | participant (+ attachment ownership) | `complete_api_test.go`, `image_api_test.go`                                                            |
| Attachment library       | `POST/GET /attachments`, `GET/PATCH/DELETE /attachments/{id}`, `…/files/{name}`, `…/usages`                                   | owner                                | `attachments_api_test.go`                                                                              |
| Projects                 | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}`                                                                       | member (creator→admin)               | `projects_api_test.go`                                                                                 |
| Project conversations    | `GET /projects/{id}/conversations`, `POST` (not viewer)                                                                       | member / role                        | `project_conversations_api_test.go`                                                                    |
| Project redaction        | `GET/POST /projects/{id}/redaction-key`, `…/redaction-entries`                                                                | member                               | `redaction_api_test.go`                                                                                |
| User memory              | `POST/GET /user-memory`, `PATCH/DELETE /user-memory/{id}`                                                                     | owner                                | `scoped_memory_api_test.go`                                                                            |
| Project memory           | `POST/GET /projects/{id}/memory`, `PATCH/DELETE /project-memory/{id}`                                                         | member                               | `scoped_memory_api_test.go`                                                                            |
| Personas                 | `GET/POST /personas`, `PATCH/DELETE /personas/{id}`                                                                           | owner                                | `personas_api_test.go`                                                                                 |
| Secure records           | `GET/POST /user-key-pair`, `PATCH …/{id}`, `GET/POST /user-preferences`, `PATCH …/{id}`                                       | owner                                | `secure_records_api_test.go`                                                                           |
| Vault session            | `GET/PUT/DELETE /vault-session`                                                                                               | owner                                | `vault_session_sweep_test.go`                                                                          |
| Billing                  | `GET /billing*`, `POST /billing/{checkout,portal,cancel,resume,change-plan,refund-request}`, `GET /billing/invoices/{id}/pdf` | owner                                | `billing_*_test.go`                                                                                    |
| MFA management           | `GET /mfa`, `POST /mfa/totp/{enrol,confirm,disable}`, `…/recovery-codes`, `GET/DELETE /mfa/trusted-devices`                   | owner                                | `mfa_manage_test.go`                                                                                   |
| Account                  | `DELETE /account`                                                                                                             | owner (blocked while on a paid plan) | `account_delete_test.go`                                                                               |
| Models                   | `GET /models`                                                                                                                 | any authed user                      | `models_api_test.go`                                                                                   |

## Adding a new endpoint — checklist

1. Authenticate: bind `apis.RequireAuth(...)` (or, for a deliberate public route,
   bind only the rate limiter and document why).
2. Authorize: resolve the caller (`auth.ExtractUser`) and check ownership /
   membership / role _before_ revealing the record exists; return **404** (not
   403) for a miss so ids can't be probed.
3. Register in `api_auth_surface_test.go`'s `apiV1Routes` (with `public: true`
   only if intentionally unauthenticated) — `TestAPIv1RoutesEnforceAuth` fails
   otherwise.
4. Add an authorization test: a wrong-user / non-member / non-owner is denied
   (mirror `scoped_memory_api_test.go` or `attachments_api_test.go`).
5. Leave the byte-level crypto round-trip to the Playwright API e2e
   (`e2e/tests/*-api.spec.ts`); the Go tests pin the access boundaries.
