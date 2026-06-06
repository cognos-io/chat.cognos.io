# Security Findings

Updated 2026-06-06. Re-verified against current HEAD (`feat/backend-model-selector`).
Status legend: ✅ Fixed · 🟡 Partially fixed · ❌ Not fixed · 🆕 New (introduced by remediation).

## 0. Re-verification summary

All 7 Critical findings are now Fixed or substantially mitigated. 14 of 22 High
findings are Fixed; 5 are Partially fixed; 3 are Not fixed. The remediation
introduced one immediate operational risk (Trusted Types vs the icon
component's `[innerHTML]` — see N-1) that should be resolved before the SPA
`_headers` file goes to production, plus several smaller TOFU / key-rotation
gaps documented as N-2..N-16 below.

## 1. Critical findings

### C-1 — user_key_pairs allows silent public-key swap → server-side encryption to attacker

Status: ✅ Fixed.

- Unique index `idx_user_key_pairs_user_unique ON user_key_pairs(user)` in
  `backend/db/migrations/1760000004_updated_user_key_pairs.go:10`.
- Belt-and-braces hook
  `backend/internal/hooks/user_key_pairs.go:9-33` rejects a second insert at
  the request layer.
- Hardened createRule requires `password_salt`, `unlock_scheme =
  "password_account_key_v1"`, and `record_mac` in
  `backend/db/migrations/1760000009_hardened_user_key_pair_rules.go:16`;
  updateRule (`:17`) forbids changing `user`, `public_key`, `secret_key`,
  `password_salt`, or `unlock_scheme` — only `record_mac` is mutable.
- `UserPublicKey` now reads with `limit=2` and returns `ErrMultipleUserKeyPair`
  if more than one row appears (`backend/internal/auth/repo.go:71-86`).
- No signed rotation envelope — rotation is simply forbidden. See N-5 for the
  recovery-path trade-off.

### C-2 — Password reset destroys the vault and enables partial account takeover

Status: ✅ Fixed.

- Backend hook rejects both request and confirm flows:
  `backend/internal/hooks/password_reset.go:10-18` registers
  `OnRecordRequestPasswordResetRequest` and
  `OnRecordConfirmPasswordResetRequest` returning HTTP 400.
- Wired in `backend/cmd/api/main.go:130`.
- Rate-limit also applied to the reset endpoints
  (`backend/internal/hooks/rate_limits.go:12-13`).
- Frontend forgot/reset components are now static "unavailable" stubs
  (`frontend/src/app/pages/auth/forgot-password/forgot-password.component.ts:14-28`,
  `…/reset-password/reset-password.component.ts:14-29`).
- Tests: `backend/cmd/api/password_reset_test.go:12-68`.

### C-3 — Caddy admin API published on 0.0.0.0:2019

Status: ✅ Fixed.

- `docker-compose.yaml:8` `CADDY_ADMIN: "unix//run/caddy/admin.sock"`.
- `docker-compose.yaml:13-16` ports block contains only 80/443.
- `README.md:153-186` ufw table no longer lists 2019; Hetzner LB table only
  permits 80/443.

### C-4 — PocketBase published on 0.0.0.0:8090, bypassing Caddy and TLS

Status: ✅ Fixed.

- `docker-compose.yaml:28` backend `ports: []`. Caddy reaches it over the
  intra-container network via `reverse_proxy backend:8090`
  (`web/Caddyfile:37`).
- README firewall section no longer publishes 8090.
- `docker-compose.local.yaml:5-6` still republishes 8090 for local-dev only.

### C-5 — Plaintext completion bodies will be persisted the moment idempotency middleware is wired

Status: ✅ Fixed.

- Migration `backend/db/migrations/1760000006_deleted_idempotency.go:9-15`
  drops the collection.
- The `backend/internal/idempotency/` package is removed; the
  `internal/middleware/idempotency.go` is gone.
- Contract test `backend/cmd/api/idempotency_test.go:5-12` asserts the
  collection does not exist on boot.
- This also moots M-12 (field-name mismatch).

### C-6 — Email change is an unauthenticated-action with an authenticated session

Status: ✅ Fixed (three-layer block).

- `backend/internal/hooks/user_email.go:9-15` rejects any PATCH to `users`
  that mutates the `email` field (HTTP 400).
- `backend/internal/hooks/user_email_change.go:10-18` blocks both
  `OnRecordRequestEmailChangeRequest` and
  `OnRecordConfirmEmailChangeRequest`.
- Wired in `backend/cmd/api/main.go:131-132`.
- Tests: `backend/cmd/api/user_email_test.go:12-33`,
  `user_email_change_test.go:12-68`.
- Note: `users.updateRule` is unchanged at the collection layer
  (`1710600202_collections_snapshot.go:335`); defence is hook-only, not
  rule-narrowed.

### C-7 — Production deploys are git pull && docker compose pull against unsigned :latest images built from an inconsistent toolchain

Status: 🟡 Partially fixed.

- Fixed sub-items:
    - `backend/Dockerfile:3` `FROM golang:1.26.4` now matches `backend/go.mod:3`.
    - `docker-compose.yaml:22-23` removes the `image:` directive and builds
    from `./backend` on the host. The `:latest` pull from Docker Hub is gone
    entirely.
    - `README.md:50-51` switched to a read-only SSH deploy key.
- Still missing:
    - No `.github/workflows/` directory exists. There is no CI lint/test/scan
    gate, no SBOM, no cosign signature, no provenance.
    - All base images are pinned by version tag, not by digest (`golang:1.26.4`,
    `alpine:3.22.1`, `caddy:2.11.4`).
    - Production now builds on the production host (`docker compose up
    --build`). Threat shifted from "trust Docker Hub" to "trust prod host
    toolchain"; either way, no remote-builder + signed-artifact trail
    exists. Acceptable interim; document the trust assumption.

## 2. High findings

### H-1 / H-14 — TOFU / signed user & conversation public keys

Status: 🟡 Partially fixed.

- User key pair: keyed MAC over
  `(scheme, salt, public_key, secret_key, user)` written and verified
  (`frontend/src/app/services/vault.service.ts:482-501`,
  `vault.service.ts:263-270`). A per-browser TOFU context (fingerprint, salt,
  scheme) is persisted in `localStorage` under
  `cognos:trusted-user-key:<userId>` (`vault.service.ts:516-580`) and checked
  on every unlock.
- Conversation pubkey: keyed MAC `blake2b(JSON(['conversation_public_key_v1',
  conversationId, pubkey]), userSecretKey)`
  (`conversation.service.ts:618-632`), verified when present
  (`:496-500`), backfilled when absent (`:501-510`).
- Gaps:
  1. Verification is conditional on the field being non-empty. A record with
     empty `record_mac` / `public_key_signature` is silently accepted and
     the client backfills its own MAC. Backend `record_mac` is `required:
     false` at schema level (`1760000007_signed_user_and_conversation_keys.go:21`)
     and `conversation_public_keys.createRule`
     (`1710665536_updated_conversation_public_keys.go:18`) does not require
     `public_key_signature:isset = true`. Net: first-contact substitution
     window remains. See N-2.
  2. MAC keys mix purposes: user-key MAC uses the Argon2-derived unlock key
     (acceptable), but the conversation-key MAC uses the user's NaCl box
     secret key directly — a primitive cross-use. See N-3.
  3. No durable per-account anchor (e.g., derived from Account Key) for
     fresh devices.
- Server never verifies either field at rest — they are client-only checks.
  See N-6.

### H-2 — KDF salt/scheme/ciphertext are not authenticated together → downgrade and substitution attacks

Status: ✅ Fixed.

- Client MAC binds `(scheme, salt, public_key, secret_key, user)` together
  (`vault.service.ts:482-501`).
- Empty-scheme regex is closed:
  `vault.service.ts:373-378` literal compare to
  `password_account_key_v1`. Backend createRule requires
  `unlock_scheme = "password_account_key_v1"` and
  `record_mac:isset = true`
  (`1760000009_hardened_user_key_pair_rules.go:16`).

### H-3 — Argon2id parameters at the OWASP floor for a server-stored KEK

Status: ✅ Fixed.

- `vault.service.ts:56-58` now uses m=65536 KiB (64 MiB), t=3, p=1.
- Note: `unlock_scheme` was NOT bumped (still
  `password_account_key_v1`). Pre-existing vaults from earlier params cannot
  be decrypted with the new params — acceptable pre-launch but the version
  mechanism exists for exactly this and should be used the next time params
  move. See N-4.

### H-4 — No CSP, HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy on the SPA

Status: ✅ Fixed.

- `frontend/src/_headers:1-8` ships strict CSP (no `'unsafe-inline'` in
  `script-src`, `wasm-unsafe-eval` for Argon2id, `frame-ancestors 'none'`,
  `object-src 'none'`, `require-trusted-types-for 'script'`,
  `upgrade-insecure-requests`), HSTS preload + includeSubDomains 2y,
  Permissions-Policy lockdown, Referrer-Policy: no-referrer,
  X-Frame-Options: DENY, X-Content-Type-Options: nosniff.
- ⚠️ Trusted Types interaction with the icon component is a regression in
  waiting — see N-1.

### H-5 — No rate-limit, lockout, MFA, or CAPTCHA on auth endpoints

Status: 🟡 Partially fixed.

- PocketBase native rate limits enabled
  (`backend/internal/hooks/rate_limits.go:5-17`):
    - authWithPassword 10/300s
    - request/confirm passwordReset 3/300s (moot — endpoints are blocked)
    - requestVerification 5/300s
    - authRefresh 30/60s
- Limits are wildcard `*:` (per-IP), not per-identity. Behind Caddy without
  `trusted_proxies` configured, the IP may be the Cloudflare edge. See N-9.
- `minPasswordLength: 8` NOT raised
  (`backend/db/migrations/1710600202_collections_snapshot.go:343`).
- No CAPTCHA, no per-account lockout, no MFA / TOTP / passkey / WebAuthn
  anywhere.

### H-6 — users collection has allowOAuth2Auth=true, allowUsernameAuth=true, onlyVerified=false, requireEmail=false

Status: 🟡 Partially fixed.

- Password auth flow stabilised (`1760000008_restore_password_auth.go`,
  test `password_auth_test.go:11-31`).
- `allowOAuth2Auth=true`, `allowUsernameAuth=true`, `onlyVerified=false`,
  `requireEmail=false` are unchanged
  (`1710600202_collections_snapshot.go:339-346`).
- `backend/db/migrations/legacy.go:139` actively normalizes `OAuth2.Enabled
  = true`. No OAuth2 providers are wired, but the surface is open.

### H-7 — No CORS allowlist; PocketBase defaults to `*`

Status: ✅ Fixed at edge (acceptable given C-4).

- `web/Caddyfile:16-35` allowlists `https://app.cognos.io` and
  `https://chat.cognos.io`, handles preflight 204, emits `Vary: Origin`.
- PocketBase `Settings.Meta.AllowedOrigins` is still default `*` — defence
  in depth not in place. Acceptable while PB is unpublished; convert to a
  server-side allowlist as a settings migration.

### H-8 — Trusted-device record co-locates the wrapped blob and the wrapping CryptoKey

Status: ❌ Not fixed (structurally unchanged).

- `frontend/src/app/services/trusted-unlock.service.ts:107-113` still
  writes `{iv, userId, wrappedUnlockKey, wrappingKey}` to a single
  IndexedDB record. UI copy at
  `vault-password-dialog.component.ts:88-96` was tightened but does not
  state the "same-origin XSS can call `subtle.decrypt` directly" caveat.
- "Read-one-row → plaintext key" attack remains. CSP + Trusted Types
  partially mitigate the XSS prerequisite once N-1 is resolved.

### H-9 — Decrypted conversations & messages survive lock()

Status: ✅ Fixed.

- `lock$` clears `keyPair` in `vault.service.ts:187-199`.
- Downstream consumers subscribe to `keyPair$` and reset to `initialState`
  when undefined: `conversation.service.ts:136-148`,
  `message.service.ts:108-116`. Both also clear on `logout$`.

### H-10 — Plaintext PocketBase auth-store in localStorage + no CSP = total session takeover on any XSS

Status: 🟡 Partially fixed.

- Token rotation on logout is real: `backend/cmd/api/routes.go:179-188`
  exposes `POST /v1/auth/logout` calling `re.Auth.RefreshTokenKey()` +
  `app.Save(re.Auth)`, invalidating outstanding JWTs.
- Frontend calls it before clearing the local store
  (`auth.service.ts:249-258`).
- JWT still lives in `localStorage` (default `LocalAuthStore` at
  `pocketbase.service.provider.ts:6-8`). With CSP now in place, the XSS
  prerequisite is materially harder; cookie-store migration is deferred.

### H-11 — bypassSecurityTrustHtml in the shared icon component

Status: 🟡 Partially fixed — and in collision with H-4.

- No `bypassSecurityTrust*` calls anywhere in `frontend/` or `packages/`
  (verified by grep).
- Icon component
  (`packages/ui-angular/src/lib/icon/icon.component.ts:41,127-152`) still
  pipes a built SVG string into `[innerHTML]` via a typed node list with
  custom `escapeHtml`. Sanitiser runs again (safer than the previous
  bypass), but…
- 🚨 CSP enables `require-trusted-types-for 'script'`
  (`frontend/src/_headers:2`) and no `TrustedTypePolicy` is registered
  anywhere. Every `[innerHTML]` write will throw in Chromium browsers as
  soon as the headers ship. **Resolve before going live** — see N-1.

### H-12 — Tabnabbing on unauthenticated pages

Status: 🟡 Partially fixed.

- Login (`login.component.ts:100`) and contact-help-dialog
  (`contact-help-dialog.component.ts:31,47`) use `rel="noopener
noreferrer"`.
- **Register page missed** (`register.component.ts:126`) — still
  `rel="noreferrer"` only.

### H-13 — Message ciphertext has no AAD binding (conversation_id, parent, version)

Status: ✅ Fixed (in-plaintext binding).

- `MessageRecordData` carries `ConversationID`, `ParentMessageID`,
  `Version` inside the JSON plaintext
  (`backend/internal/chat/messaging.go:5-15`,
  `backend/internal/chat/repo.go:67-70`).
- Caveat: this is structural in-plaintext binding, not true AEAD AAD
  (`box.SealAnonymous` has no AAD parameter). Client-side verification on
  decrypt is required for the binding to be load-bearing.
- `,omitempty` on `ParentMessageID` means a root message must explicitly
  accept absence on decrypt-side compare — fragile contract.

### H-15 — Soft-delete writes full records (including ciphertext metadata) to a forever-collection

Status: ✅ Fixed.

- TTL cron `cleanUpDeletedRecordJob` (`backend/cmd/api/cron.go:49-68`),
  retention 30 days, scheduled every 1–2h via `DurationRandomJob`.
- Wired in `backend/cmd/api/main.go:145-153`.
- Exclusion list
  `backend/internal/hooks/deleted_records.go:12-17` excludes
  `conversation_public_keys`, `conversation_secret_keys`, `user_key_pairs`,
  and `deleted` itself.
- Cron does not paginate; capped at 500 records per tick over a single
  unfiltered scan — fine for current volumes, watch as the table grows.

### H-16 — no-retention is a description string, not enforced

Status: ❌ Not fixed.

- `backend/internal/catalogue/models.go:46-65` still encodes "no data
  retention" as free-text in `Description`.
- No `EnsureNoRetention()` method on the `Upstream` interface
  (`backend/pkg/proxy/upstream.go:9-18`), no per-request store=false flag,
  no header injection, no boot-time assertion.

### H-17 — Catalogue/provider mismatch will pressure a tier-violating band-aid

Status: ❌ Not fixed.

- `backend/internal/catalogue/models.go:50` still declares `infomaniak`
  as the sole approved ProviderID.
- `backend/pkg/proxy/repo.go:34-57` does not handle `infomaniak` → falls
  into `default` → returns `invalid model provider: infomaniak`. Every
  CH-tier completion 503s at `complete.go:155-158`.
- No boot-time assertion that every catalogue ProviderID resolves to a real
  Upstream.

### H-18 — Test fixture testdata/pb_data/data.db committed with bcrypt hashes

Status: ❌ Not fixed despite gitignore change.

- Root `.gitignore:140-141` adds `**/pb_data/` and `*.db`.
- However `git ls-files backend/testdata/pb_data/` still returns `data.db`
  and `logs.db` — gitignore does not untrack already-tracked files. A `git
  rm --cached` was never run.
- Bcrypt hashes still ship in HEAD and history.

### H-19 — Apparently-stale ufw rule for port 8001 (BricksLLM)

Status: ✅ Fixed.

- `README.md:153-186` firewall table no longer lists 8001. No compose
  service binds it; no Go code references it.

### H-20 — Stale PocketBase access rules reference a deleted participants collection

Status: ✅ Fixed.

- The four affected collections were rewritten in forward-migrations:
  `1710665648_updated_conversations.go:16-22`,
  `1710665536_updated_conversation_public_keys.go:16-18`,
  `1710665570_updated_conversation_secret_keys.go:16-18`,
  `1710665834_updated_messages.go:16-18`. Each now uses `creator =
@request.auth.id` / `conversation.creator = @request.auth.id`.
- Test guard at `backend/cmd/api/collection_rules_test.go:8-36` fails on
  any rule string containing `@collection.participants`.

### H-21 — Two access paths, two security models

Status: ❌ Not fixed.

- `backend/internal/chat/conversation.go:39-40` still uses
  `forms.NewRecordUpsert(...).GrantManagerAccess()` to bypass collection
  rules on conversation upsert.
- Custom `/api/v1/*` handlers and PocketBase native `/api/collections/...`
  rules still coexist. No consolidation. Defence-in-depth is fragile.

### H-22 — BorgBase SSH key + passphrase + repo URL all live on the same host

Status: ❌ Not fixed.

- `docker-compose.yaml:43` still bind-mounts `/home/cognos/.ssh:/root/.ssh:ro`.
- `backup/.env` still holds the passphrase; repo URL still hard-coded in
  `borgmatic.d/cognos.yaml`.
- Host compromise = backup compromise.

## 3. Medium findings

- M-1. No password-change UI. ❌ Not fixed. `grep -rn
  "changePassword\|updatePassword" frontend/src` returns nothing. With
  password reset, email change, and key rotation all forbidden server-side
  there is currently no in-app way for a user to rotate credentials.
- M-2. Argon2id wasm SRI / digest pin. ✅ Fixed. `vault.service.ts:70-104`
  fetches bytes, SHA-384 hashes via `crypto.subtle.digest`, compares to
  pinned base64 in `:61-64`, throws on mismatch, then calls
  `WebAssembly.instantiate`. Verified post-fetch + pre-instantiate.
- M-3. Dev vault password default. ✅ Fixed. `environment.development.ts:4`
  is now `localVaultPassword: ''`.
- M-4. Account-Key autocomplete leak to password managers. ❌ Not fixed.
  Still a single `<input type="text" autocomplete="off">` at
  `vault-password-dialog.component.ts:122-131`.
- M-5. Dockerfile/compose hardening. 🟡 Partially fixed.
    - Fixed: `cap_add: NET_ADMIN` removed from `web`; backend runs `USER
    appuser` non-root (`backend/Dockerfile:40`); compose enforces `user:
"1001:0"` (`docker-compose.yaml:25`); base versions pinned by tag.
    - Still missing on every service: `read_only`, `cap_drop: [ALL]`,
    `security_opt: [no-new-privileges:true]`, `HEALTHCHECK`, resource
    limits.
- M-6. Caddy security headers on the API edge. ✅ Fixed
  (`web/Caddyfile:22-28`: HSTS preload, COOP, CORP, Referrer-Policy,
  X-Content-Type-Options).
- M-7. Raw upstream provider errors. ❌ Not fixed where it matters. The
  sanitizer commit `8d77e2a` touched `backend/pkg/compat/openai/openai.go`
  which is dead code (no routes register it). The live handler at
  `backend/internal/handler/complete.go:134,151,157,182,198,214` still
  passes raw upstream `err` to `apis.NewApiError`.
- M-8. `/health` outbound HTTP. ✅ Fixed. `backend/cmd/api/routes.go:190-208`
  is now `app.CountRecords("users")` only.
- M-9. `/metrics` only behind Caddy rewrite. 🟡 Partially fixed.
  PocketBase is no longer publicly bound, so Caddy is the only ingress and
  it rewrites `/metrics → /404`. But the Go handler at
  `backend/cmd/api/routes.go:239-242` still serves it unauthenticated. Add
  server-side `RequireAuth()` / IP allowlist for defence in depth.
- M-10. Idle-logout listener uses `keypress`. ✅ Fixed
  (`app.component.ts:34-36` now `keydown`, `touchstart`,
  `visibilitychange`).
- M-11. Mermaid unused but installed. ❌ Not fixed. `frontend/package.json:21`
  still lists `"mermaid": "^11.15.0"`; `pnpm-lock.yaml` resolves it at
  11.15.0. The commit titled "remove unused mermaid dependency" did not
  modify package.json.
- M-12. Idempotency field-name mismatch. ✅ Moot — see C-5 (whole subsystem
  removed).
- M-13. Auth-refresh loop boots on transient 5xx/network failures. ✅ Fixed.
  `auth.service.ts:129-144` navigates to logout only on `status === 401`;
  refresh polling at `:117-125` retries 5x with backoff.
- M-14. `User: owner.ID` forwarded raw to providers. ❌ Not fixed.
  `complete.go:187` still passes the PB user ID unchanged.
- M-15. AI provider API keys plaintext. ❌ Not fixed.
  `docker-compose.yaml:31` still bind-mounts
  `./backend/configs/api.production.yaml:ro`. No Docker secrets / KMS.
- M-16. xcaddy unpinned. 🟡 Partially fixed. `web/Dockerfile:1,5` pinned to
  `caddy:2.11.4`; the cloudflare DNS plugin (`web/Dockerfile:3`) is still
  unversioned.

## 4. Low / Informational findings

- L-1. console.error of HttpErrorResponse. ✅ Fixed at the cited site
  (`message.service.ts:530` logs only the literal string).
- L-2. `document.execCommand('copy')` fallback DOM leak. ❌ Not fixed
  (`vault-password-dialog.component.ts:404-420`).
- L-3. Explicit `sourceMap: false` in prod. ✅ Fixed
  (`frontend/angular.json:84`).
- L-4. Empty manifest names. ✅ Fixed
  (`frontend/src/site.webmanifest:2-3`).
- L-5. `Authorization: <token>` without `Bearer` prefix. ❌ Not fixed in
  the active client. Commit `41c2320` patched a since-deleted file
  (`openai.service.provider.ts`); the live client
  `cognos-api.service.ts:276` still emits the bare token.
- L-6. `password_salt` 16 bytes. Unchanged
  (`vault.service.ts:59`). Acceptable.
- L-7. 128-bit Account Key. Unchanged
  (`vault.service.ts:60`).
- L-8. Anthropic `Temperature=0, TopP=0` pointer-to-zero. ❌ Not fixed
  (`backend/pkg/proxy/anthropic.go:53-54`).
- L-9. Pre-commit gitleaks only on staged content. Unchanged. No CI guard
  (see C-7 — no CI at all).
- L-10. PAT for `git pull` on prod replaced with deploy keys. ✅ Fixed
  (`README.md:50-51, 106-108`).
- L-11. generate-key-pair CLI password via flag. ✅ Fixed. Now read via
  `term.ReadPassword(int(os.Stdin.Fd()))`
  (`backend/cmd/generate-key-pair/main.go:21-34`).
- L-12. `GrantManagerAccess` in message-after-create hook. ❌ Not fixed
  (`backend/internal/chat/conversation.go:32-43`).
- L-13. Caddy floating major. ✅ Fixed (`web/Dockerfile` pins `2.11.4`).
- L-14. No analytics / Sentry / posthog / mixpanel / amplitude. Still true.
- L-15. No service worker registered. Still true.

## 5. New issues introduced by remediation

### N-1 — Trusted Types ↔ icon `[innerHTML]` collision (HIGH urgency)

`frontend/src/_headers:2` ships
`Content-Security-Policy: ... require-trusted-types-for 'script' ...`. The
icon component still writes raw markup into `[innerHTML]`
(`packages/ui-angular/src/lib/icon/icon.component.ts:41`). No
`TrustedTypePolicy` is registered anywhere (grep for
`createPolicy`/`trustedTypes` returns nothing). Chromium browsers will
throw `TrustedTypeViolation` on every icon render once the headers are
served — i.e., global UI regression on the first deploy that wires the
`_headers` file. Resolve by switching icons to `<svg><use href="#sprite">`
sprite (preferred) or by registering a narrow TrustedTypes policy keyed to
the icon renderer; alternatively, drop `require-trusted-types-for 'script'`
from the CSP until icons migrate.

### N-2 — TOFU backfill window for `record_mac` and `public_key_signature`

A record returned by the server with the field empty is silently accepted,
and the client backfills its own MAC (`vault.service.ts:395-399, 429-431,
503-514`; `conversation.service.ts:496-510`). Backend `record_mac` is
schema-`required: false` (`1760000007_…:21`) and
`conversation_public_keys.createRule` does not require
`public_key_signature:isset = true`
(`1710665536_updated_conversation_public_keys.go:18`). A hostile server can
substitute a record on first contact for any new device. Recommend: a
client-side toggle that flips to "refuse if missing" once the existing
production records have been migrated.

### N-3 — Conversation public-key MAC uses the user's NaCl secret key directly

`conversation.service.ts:618-632` passes `userSecretKey` (the long-term
X25519 scalar used by `nacl.box`) as the blake2b MAC key. The two
constructions are not known to interact insecurely, but using an encryption
secret key as a MAC key violates key separation. Derive a sub-key, e.g.
`blake2b("cognos:conv-key-mac", userSecretKey)`.

### N-4 — Argon2id parameter change without `unlock_scheme` version bump

H-3 raised the parameters but kept `unlock_scheme =
password_account_key_v1` (`vault.service.ts:54`, server literal at
`1760000009_…:16`). Any vault created with the old params cannot be
decrypted with the new params — pre-launch this is acceptable, but the
version-string mechanism exists precisely for this; use it next time.

### N-5 — Rotation prohibited entirely; no signed envelope

The C-1 fix forbids `public_key`, `secret_key`, `password_salt`, and
`unlock_scheme` mutations on `user_key_pairs`
(`1760000009_hardened_user_key_pair_rules.go:17`). Combined with C-2/C-6
blocking password reset and email change, a user who loses their Account
Key has no recovery path at all. This is the intended trade-off, but a
signed rotation envelope (proving knowledge of the prior Account Key)
should be on the roadmap before paying users sign up.

### N-6 — Server never verifies `record_mac` / `public_key_signature`

`grep -rn 'record_mac\|public_key_signature' backend/internal/
--exclude=*_test.go` returns nothing. The fields are write-only at the
server. Pure client-side verification means anyone who can write to the DB
out of band (admin UI, raw `app.Save`, future hook) can set arbitrary
signatures. Add at minimum a server-side length/format validator that
records do not have empty fields.

### N-7 — Same shape as C-1 still possible on `conversation_public_keys`

`backend/internal/auth/repo.go:39` resolves with `-updated DESC LIMIT 1`,
and the `conversation_public_keys.createRule`
(`1710665536_updated_conversation_public_keys.go:18`) has no
uniqueness-per-conversation guard. A user who legitimately created a
conversation can insert a second `conversation_public_keys` row pointing
at an attacker key; the most-recently-updated row wins. Mirror the C-1
fix: unique index on `(conversation)` + a hook rejecting duplicates.

### N-8 — `EnforceSingleUserKeyPair` fails open on missing user field

`backend/internal/hooks/user_key_pairs.go:12-14`: if `userID == ""` the
hook returns `e.Next()`. The collection createRule catches this today
(`@request.body.user = @request.auth.id`), but if anyone weakens that
rule later, defence in depth collapses silently.

### N-9 — Rate limits are wildcard-per-IP, not per-identity

`hooks/rate_limits.go:9-15` uses `*:authWithPassword` — PocketBase
interprets this as per-IP. Caddy has no `trusted_proxies` configured, and
the deployment runs behind Cloudflare. The source IP that PocketBase sees
may be the Cloudflare edge → all users sharing one bucket. Trivial bypass
via residential rotation; collateral lockout possible. Configure Caddy
`trusted_proxies` and switch to per-identity scoping where feasible.

### N-10 — Bcrypt test hashes still tracked

H-18 above. The gitignore landed but the files were never `git rm
--cached`'d. They remain in HEAD and in history.

### N-11 — Production builds happen on the prod host with no remote builder

C-7 above. Closes the Docker-Hub-compromise threat; opens the
"prod-host-toolchain-compromise" threat. No SBOM, no signed artefact, no
rollback to a known-good binary without re-checking out source. Acceptable
interim; the program-level recommendation is unchanged — establish a CI
pipeline.

### N-12 — Register page tabnabbing missed

H-12 above. `register.component.ts:126` still has `rel="noreferrer"`
without `noopener`.

### N-13 — Live client still missing Bearer prefix

L-5 above. The active client sends `Authorization: <token>` rather than
`Authorization: Bearer <token>`.

### N-14 — Mermaid still installed despite "remove" commit

M-11 above. The commit changed nothing in `package.json` or `pnpm-lock.yaml`.

### N-15 — OAuth2 actively enabled at runtime

`backend/db/migrations/legacy.go:139` sets `normalized.OAuth2.Enabled =
true` during `users` collection normalization. No providers are wired,
but the surface is open for any future mis-configuration.

### N-16 — Public key length not verified before `copy`

`backend/internal/auth/repo.go:60-61, 96-97` uses `copy(pubKey[:],
sliceFromDB)` with no length check. If a record's `public_key` decodes to
fewer than 32 bytes (corruption, future schema change), the remaining
bytes are zero and `box.SealAnonymous` encrypts to an attacker-trivial
key. Add an explicit `len(slice) == 32` assertion before `copy`.

## 6. Observed strengths (still correct)

- Crypto primitives unchanged and sound: NaCl `box.SealAnonymous`, NaCl
  `secretbox`, Argon2id, AES-GCM. No custom crypto.
- All randomness uses `crypto/rand` (Go) and `nacl.randomBytes` /
  `crypto.getRandomValues` (JS).
- KDF input is `password ||   || accountKey`; email not included.
- Per-user random 16-byte salt; AEAD-wrapped private key.
- Trusted-device wrapping uses non-extractable AES-GCM with fresh 96-bit
  IV per write.
- `unlock_scheme` versioning string in place (though not yet bumped — see N-4).
- Server never holds plaintext private keys; `EncryptAndPersistMessage`
  only sees the recipient public key.
- Completion flow still encrypts-before-persist and rolls back the
  persisted user message on upstream failure
  (`backend/internal/handler/complete.go:171-216`).
- Zero plaintext message bodies / prompts logged in the active completion
  path.
- Billing is strictly token-count + cost; no content snippets.
- All `/api/v1/*` routes wrap `apis.RequireAuth()` + per-identity rate
  limiter.
- TLS posture default-secure; no `InsecureSkipVerify`, no custom
  transport.
- Logout rotates server-side `tokenKey` and clears trusted-device
  IndexedDB store.
- Account Key onboarding requires explicit acknowledgement.
- Markdown rendering uses `ngx-markdown` in default-sanitised mode; KaTeX
  `trust: false`; no `bypassSecurityTrust*` anywhere in `frontend/` or
  `packages/`.
- No analytics, no Sentry, no third-party CDN scripts.
- Backend runs non-root; `.dockerignore` excludes pb_data/testdata from
  the image.
- `backend/configs/.gitignore` is allowlist-style.
- `docs/security-model.md` is honest about the limits of the model.
- Caddy now ships HSTS preload + COOP + CORP + Referrer-Policy +
  X-Content-Type-Options at the API edge.
- Caddy admin moved to unix socket; PocketBase not publicly published;
  `/_/*` and `/metrics` blocked at the edge.
- TTL cron purges soft-deleted records after 30 days; sensitive
  collections excluded from soft-delete entirely.
- Go toolchain reconciled (Dockerfile and go.mod both 1.26.4); builds
  reproducibly from this tree.

## 7. Recommended remediation order (next sprint)

P0 (this week):

1. N-1: resolve Trusted Types ↔ icon `[innerHTML]` collision before the
   `_headers` file ships to production.
2. H-17: implement the `infomaniak` upstream first-class; add a boot-time
   assertion that every catalogue ProviderID resolves to a real Upstream.
3. M-7: sanitize raw upstream errors in `backend/internal/handler/complete.go`.
4. H-18 / N-10: `git rm --cached backend/testdata/pb_data/*.db` and
   regenerate fixtures.

P1 (next 1–2 weeks):
5. H-16: `Upstream.EnsureNoRetention()` contract + per-provider enforcement.
6. N-2 / N-6 / N-7: tighten signature / MAC fields to required at server
   layer; mirror the C-1 fix on `conversation_public_keys`; add length
   check in `repo.go`.
7. H-11 follow-through: migrate icons to `<svg><use>` sprite to allow
   keeping Trusted Types strict.
8. H-12 / L-5 / M-11 / N-12 / N-13 / N-14: the "did not actually land"
   commits.
9. N-9: configure Caddy `trusted_proxies` and convert rate limits to
   per-identity where feasible.

P2 (next 4 weeks):
10. H-21: collapse the two access paths.
11. H-22 / M-15: separate BorgBase passphrase from host; move provider
    keys to a secret store.
12. C-7 closure: minimal CI/CD pipeline (build → trivy → cosign → push by
    digest); deploy from signed artefacts only.
13. H-5 / N-9: per-identity lockout; raise `minPasswordLength` to ≥12.
14. M-1 + signed key-rotation envelope (N-5): give users a way to rotate
    credentials they still know.
15. MFA (TOTP at minimum, passkeys preferred).
16. Audit log (`audit_events` collection): record auth, blocked email,
    blocked reset, key-rotation, admin actions.

## 8. Notes on what was not re-verified

- Live deployment configuration on Hetzner (`ss -ltnp`, Hetzner LB rules).
- Live Cloudflare Pages headers (`curl -I https://app.cognos.io/`) —
  confirms whether `_headers` is actually being served.
- Dependency CVE scan (`pnpm audit --prod`, `govulncheck ./...`).
- Marketing site (`web/`, Astro).
- Mobile/desktop clients — none in repo.
