# API endpoint permissions

How access control works on the custom `/api/v1/*` HTTP API, and where it is
enforced by tests. Read this before adding or reviewing an endpoint.

The chat data collections (`conversations`, `messages`, `participants`, keys,
redaction, memory, attachments) are **locked** at the PocketBase collection
level — the built-in `/api/collections/*` CRUD is denied for everyone. All access
goes through the custom routes below, which apply their own checks.

## Three layers, three guardrails

1. **Authentication** — is the caller logged in? Every `/api/v1` route binds
   `apis.RequireAuth(...)` and rejects anonymous callers with a 401, _except_ a
   small allowlist of intentionally public routes.
   - **Guardrail:** `TestAPIv1RoutesEnforceAuth` in
     `backend/cmd/api/api_auth_surface_test.go` **enumerates the registered
     surface automatically**: it parses the `cmd/api` package source with
     `go/parser`, collects every `e.Router.GET/POST/…("/api/v1/…", …)`
     registration, cross-checks each against the live router with `HasRoute`,
     and probes it anonymously. A new route is picked up without any manual
     registration — it can only become public by adding it to the explicit
     `publicAPIv1Routes` allowlist in that test. A minimum-route-count guard
     (`minExpectedAPIv1Routes`) fails the test loudly if the enumerator ever
     finds suspiciously few routes.

2. **Email verification** — AI-consuming endpoints (anything that triggers a
   paid provider call) additionally bind `handler.RequireVerifiedEmail()` and
   reject users without a verified email with **403
   `{"error":"EMAIL_NOT_VERIFIED","next_step":"verify_email"}`** (same shape as
   the billing restriction codes). Verifying mid-session unblocks the same
   token immediately. Production must have SMTP configured so verification
   emails actually send.
   - **Guardrail:** `TestAPIv1RoutesEnforceAuth` asserts the gate on every
     route listed in `emailVerificationGatedRoutes` (and that GET routes are
     NOT gated); `email_verification_test.go` covers the behaviour
     (unverified 403 / verified passes / mid-session verification / non-AI
     endpoints stay open); `e2e/tests/email-verification-api.spec.ts` proves it
     end-to-end.

3. **Authorization (scope)** — may _this_ caller touch _this_ record? Each
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

| Resource                 | Routes                                                                                                                        | Scope                                                                  | Authorization test                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Conversations            | `GET/POST /conversations`, `PATCH/DELETE /conversations/{id}`, `DELETE /conversations`                                        | participant (creator→admin)                                            | `conversations_api_test.go`, `conversation_list_keys_test.go`, `collection_rules_participants_test.go` |
| Conversation retention   | `PATCH /conversations/{id}/retention`                                                                                         | participant                                                            | `conversation_retention_api_test.go`                                                                   |
| Conversation memory data | `PATCH /conversations/{id}/memory`                                                                                            | participant                                                            | `conversation_memory_data_api_test.go`                                                                 |
| Conversation copy        | `POST /conversations/{id}/copies`                                                                                             | participant (read)                                                     | `conversation_copy_api_test.go`                                                                        |
| Messages                 | `GET /conversations/{id}/messages`, `PATCH/DELETE /messages/{id}`                                                             | conversation participant                                               | `conversations_api_test.go`                                                                            |
| Message attachment       | `GET /conversations/{id}/messages/{mid}/attachment`                                                                           | conversation participant                                               | `complete_attachments_api_test.go`                                                                     |
| Participants             | `GET /conversations/{id}/participants` (participant), `POST` (admin)                                                          | participant / admin                                                    | `participants_api_test.go`                                                                             |
| Public share admin       | `GET` (participant), `POST`/`DELETE /conversations/{id}/public-share` (admin)                                                 | participant / admin                                                    | `public_shares_api_test.go`                                                                            |
| Key rotation             | `POST /conversations/{id}/rotate`                                                                                             | admin                                                                  | `rotation_api_test.go`                                                                                 |
| Conversation keys        | `GET/POST /conversations/{id}/public-key`, `PATCH …/{kid}`, `GET/POST …/secret-key`                                           | participant (+ key version)                                            | `public_keys_key_version_test.go`, `secret_keys_key_version_test.go`                                   |
| Redaction (conversation) | `GET/POST /conversations/{id}/redaction-key`, `…/redaction-entries`                                                           | participant                                                            | `redaction_api_test.go`                                                                                |
| Redaction (user)         | `GET/POST /user-redaction-entries`                                                                                            | owner                                                                  | `redaction_api_test.go`                                                                                |
| Completions              | `POST /completions`, `POST /conversations/{id}/complete`, `…/regenerate`                                                      | participant + **verified email**                                       | `complete_api_test.go`, `email_verification_test.go`                                                   |
| Completion stop          | `POST /completions/{rid}/stop`                                                                                                | owner (cancel key is `owner:rid`)                                      | `complete_api_test.go`                                                                                 |
| Image generation         | `POST /conversations/{id}/image`, `POST /images` (stateless/temporary)                                                        | participant + **verified email**; `/images` is authed self-scoped only | `image_api_test.go`, `email_verification_test.go`                                                      |
| Compactions              | `POST/GET /conversations/{id}/compactions`, `POST …/manual`, `PATCH/DELETE /conversation-compactions/{id}`                    | participant; model run also requires **verified email**                | `compaction_api_test.go`, `email_verification_test.go`                                                 |
| Attachment library       | `POST/GET /attachments`, `GET/PATCH/DELETE /attachments/{id}`, `…/files/{name}`, `…/usages`                                   | owner                                                                  | `attachments_api_test.go`                                                                              |
| Projects                 | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}`                                                                       | member (creator→admin)                                                 | `projects_api_test.go`                                                                                 |
| Project conversations    | `GET /projects/{id}/conversations`, `POST` (not viewer)                                                                       | member / role                                                          | `project_conversations_api_test.go`                                                                    |
| Project redaction        | `GET/POST /projects/{id}/redaction-key`, `…/redaction-entries`                                                                | member                                                                 | `redaction_api_test.go`                                                                                |
| User memory              | `POST/GET /user-memory`, `PATCH/DELETE /user-memory/{id}`                                                                     | owner                                                                  | `scoped_memory_api_test.go`                                                                            |
| Project memory           | `POST/GET /projects/{id}/memory`, `PATCH/DELETE /project-memory/{id}`                                                         | member                                                                 | `scoped_memory_api_test.go`                                                                            |
| Bookmarks                | `POST/GET /bookmarks`, `DELETE /bookmarks/{id}`                                                                               | owner (create also needs conversation access)                          | `bookmarks_api_test.go`                                                                                |
| Personas                 | `GET/POST /personas`, `PATCH/DELETE /personas/{id}`                                                                           | owner                                                                  | `personas_api_test.go`                                                                                 |
| Secure records           | `GET/POST /user-key-pair`, `PATCH …/{id}`, `GET/POST /user-preferences`, `PATCH …/{id}`                                       | owner                                                                  | `secure_records_api_test.go`                                                                           |
| Vault session            | `GET/PUT/DELETE /vault-session`                                                                                               | owner                                                                  | `vault_session_sweep_test.go`                                                                          |
| Billing                  | `GET /billing*`, `POST /billing/{checkout,portal,cancel,resume,change-plan,refund-request}`, `GET /billing/invoices/{id}/pdf` | owner                                                                  | `billing_*_test.go`                                                                                    |
| MFA management           | `GET /mfa`, `POST /mfa/totp/{enrol,confirm,disable}`, `…/recovery-codes`, `GET/DELETE /mfa/trusted-devices`                   | owner                                                                  | `mfa_manage_test.go`                                                                                   |
| Account                  | `DELETE /account`                                                                                                             | owner (blocked while on a paid plan)                                   | `account_delete_test.go`                                                                               |
| Models                   | `GET /models`                                                                                                                 | any authed user                                                        | `models_api_test.go`                                                                                   |

**Account-level default retention** (`users.default_retention_days`, plaintext:
`0`=never, `N`=days) has no custom endpoint. Like `preferred_language` /
`preferred_theme`, it is read from the auth record and written via the built-in
users collection update (`updateRule: id = @request.auth.id`, self-only). The
per-conversation override above (`retention_days`: `0`=inherit, `-1`=never,
`N`=days) is the only retention route on `/api/v1`. A background cron
(`cleanUpExpiredConversationsJob`) resolves the effective window against the
creator's account default and permanently deletes conversations whose window has
elapsed since last activity.

## Operational (non-`/api/v1`) routes

| Method | Path              | Scope                                                                          | Test                                 |
| ------ | ----------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| GET    | `/metrics`        | **superuser only** (`RequireSuperuserAuth`) — regular users 403, anonymous 401 | `migration_characterization_test.go` |
| GET    | `/health`         | public (DB connectivity boolean only)                                          | —                                    |
| POST   | `/v1/auth/logout` | any authed user (self)                                                         | `logout_test.go`                     |

## Adding a new endpoint — checklist

1. Authenticate: bind `apis.RequireAuth(...)` (or, for a deliberate public route,
   bind only the rate limiter and document why).
2. If the endpoint triggers a paid AI provider call, also bind
   `handler.RequireVerifiedEmail()` and add it to
   `emailVerificationGatedRoutes` in `api_auth_surface_test.go`.
3. Authorize: resolve the caller (`auth.ExtractUser`) and check ownership /
   membership / role _before_ revealing the record exists; return **404** (not
   403) for a miss so ids can't be probed.
4. `TestAPIv1RoutesEnforceAuth` picks the route up automatically from the
   source. It fails until the route rejects anonymous callers; if the route is
   deliberately public, add it to `publicAPIv1Routes` with a short
   justification (a security decision — keep that list short).
5. Add an authorization test: a wrong-user / non-member / non-owner is denied
   (mirror `scoped_memory_api_test.go` or `compaction_api_test.go`).
6. Leave the byte-level crypto round-trip to the Playwright API e2e
   (`e2e/tests/*-api.spec.ts`); the Go tests pin the access boundaries.
