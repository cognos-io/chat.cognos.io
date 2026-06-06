1. Critical findings (must fix before any general-availability launch)

C-1 — user_key_pairs allows silent public-key swap → server-side encryption
to attacker

- Where: backend/db/migrations/1710600202_collections_snapshot.go:229-285;
  backend/internal/auth/repo.go:64-94;
  backend/internal/chat/messaging.go:62-90.
- Why it's critical: createRule is repeatable, there is no uniqueness index
  on (user), updateRule/deleteRule are null. UserPublicKey() resolves by ORDER
  BY updated DESC LIMIT 1. Any authenticated principal (XSS-stolen JWT,
  hostile co-resident, malicious admin) can POST a new user_key_pairs row with
  an attacker-controlled public key. From that moment, every assistant reply
  persisted via EncryptAndPersistMessage is sealed to the attacker's key. The
  victim's UI may render gibberish; the attacker decrypts everything.
- Fix: unique index on user; tighten createRule to reject if a record
  already exists; require an explicit, signed rotation envelope for legitimate
  key rotation.

C-2 — Password reset destroys the vault and enables partial account takeover

- Where: frontend/src/app/services/auth.service.ts:187-218; no
  OnRecord\*PasswordReset hook anywhere in backend/.
- Why it's critical: The vault wrapping key is derived from
  Argon2id(password || \0 || AccountKey, password_salt). Resetting the
  PocketBase password leaves password_salt and the wrapped secret_key blob
  bound to the old password. Any device without a cached IndexedDB wrapping
  key loses access permanently. Conversely, an attacker who hijacks the reset
  email gets a fully working session — they can post messages, call billed
  completions, change email (see C-6), but cannot read history. Account Key is
  never required at reset. Both halves of the documented model fail
  simultaneously.
- Fix: reset confirmation must (a) require Account Key entry, (b) re-derive
  the unlock key client-side, (c) atomically re-wrap secret_key + change
  password in one operation, (d) abort if any step fails. Until then, the
  reset link must show "you will lose all encrypted history" and force
  key-pair regeneration.

C-3 — Caddy admin API published on 0.0.0.0:2019

- Where: docker-compose.yaml:8 CADDY_ADMIN: "0.0.0.0:2019";
  docker-compose.yaml:19 "2019:2019"; README.md ufw 2019 ALLOW Anywhere.
- Why it's critical: Caddy admin is unauthenticated by design. Whoever
  reaches it can rewrite live config — redirect api.cognos.io to an attacker
  origin, serve malicious JS over a now-trusted hostname, read the
  CF_API_TOKEN from /config/. This is pre-auth full edge compromise. The
  Hetzner LB is the only thing standing in front of it; "documented to allow
  only 80/443" is a runbook assertion, not a control with a test.
- Fix: CADDY_ADMIN=unix//run/caddy/admin.sock, delete the 2019:2019 port
  publish, drop the ufw rule. Defence in depth — fix both the LB and the host.

C-4 — PocketBase published on 0.0.0.0:8090, bypassing Caddy and TLS

- Where: docker-compose.yaml:32-33; ufw 8090 ALLOW Anywhere.
- Why it's critical: Direct exposure of PocketBase publishes the entire API
  and (worse) the admin UI at /\_/ without going through Caddy. Caddy's
  /metrics block, the 2 MB body cap, TLS termination, and any future WAF are
  all bypassed. Critically:
  http://<host>:8090/api/collections/users/auth-with-password is reachable in
  cleartext over the public IP. Combined with PocketBase's local admin store,
  a superuser-credential phish becomes total DB takeover, including all
  encrypted blobs, salts, and tokens.
- Fix: remove the port publish; let Caddy reach PB via the Docker network.
  Add a Caddy matcher that 404s /\_/\* for api.cognos.io. Move admin UI to a
  Tailscale-only listener.

C-5 — Plaintext completion bodies will be persisted the moment idempotency
middleware is wired

- Where: backend/internal/middleware/idempotency.go:24-69;
  backend/internal/idempotency/repo.go:31-54;
  backend/db/migrations/1711182455_created_idempotency.go.
- Status today: The middleware is defined but not bound in
  cmd/api/routes.go. It is also functionally broken: writes go to field body,
  reads look up response_body_json — so the cache never hits. This is the only
  reason plaintext is not already in the database. A "fix the idempotency
  bug" PR will turn this into a live data-at-rest violation.
- Fix: either delete the middleware/repo/migration, or before any re-wiring:
  forbid binding to /api/v1/completions\*, encrypt cached bodies under the
  conversation public key, add a TTL cron, and add a contract test that any
  new route registering Idempotency must list itself as "non-sensitive".

C-6 — Email change is an unauthenticated-action with an authenticated
session (no re-auth, no Account Key)

- Where: PocketBase users collection updateRule: id = @request.auth.id
  (1710600202_collections_snapshot.go:335); no custom hook gating email
  mutations.
- Why it's critical: Any session token (XSS, leaked, or otherwise) can PATCH
  the victim's email to attacker-controlled, then trigger password reset →
  full takeover (see C-2 interaction). PocketBase does not require current
  password for arbitrary field updates by default.
- Fix: add OnRecordUpdateRequest("users") hook that rejects email mutations
  unless the request supplies oldPassword + a fresh Account-Key challenge, and
  routes the change through a verification email to the old address.

C-7 — Production deploys are git pull && docker compose pull against
unsigned :latest images built from an inconsistent toolchain

- Where: README.md:45-60; docker-compose.yaml:26
  (cognosio/api.cognos.io:latest); backend/Dockerfile:3 (golang:1.22) vs
  backend/go.mod:3 (go 1.26.4); no .github/workflows/.
- Why it's critical: Because the Dockerfile cannot build the current module,
  the actual production binary is hand-built somewhere else and pushed to
  Docker Hub by a human — no SBOM, no signature, no provenance, no scan. A
  Docker Hub credential compromise on the cognosio namespace rolls out a
  backdoored image on next deploy with no detection. The deployer is also
  using a long-lived GitHub PAT for git pull on the host.
- Fix: pin every image by digest; minimal GitHub Actions pipeline that
  builds → trivy → cosign → push by digest; verify signature in the deploy
  script; replace prod PAT with a read-only deploy key, or drop git pull from
  the host entirely.

---

2. High findings (close before public launch / billing live)

H-1 — No client-side verification of the server's returned public keys
(TOFU/pinning absent)

backend/internal/auth/repo.go:30-94;
backend/internal/chat/conversation.go:46-81. There is no signature over
public_key, no certificate chain, no client-side pin. Even after C-1 is
fixed, a hostile or compromised server can serve a substituted key on first
contact for any new device. Fix: sign the user's long-lived public key with
a key material derived from the Account Key, persist a TOFU fingerprint in
the trusted-device IndexedDB record, and verify on every fetch.

H-2 — KDF salt/scheme/ciphertext are not authenticated together → downgrade
and substitution attacks

backend/db/migrations/176000000{2,3}\_\*.go;
frontend/src/app/services/vault.service.ts:331-352. password_salt and
unlock_scheme are plain text fields a server can hand the client; the client
validates unlock_scheme != "" but the regex ^(password_account_key_v1)?$
allows empty, falling back to a legacy email-coupled scheme that the docs
explicitly reject. Fix: reject empty scheme at server and client; add a
server-enforced minimum for any future server-supplied Argon2 params; bind
(scheme, salt, ciphertext) under a MAC keyed by Account Key.

H-3 — Argon2id parameters at the OWASP floor for a server-stored KEK

vault.service.ts:58-60 uses m=19456 KiB, t=2, p=1 — the lowest tier in the
OWASP cheat sheet, intended for interactive logins where the hash is not the
only barrier. For a vault KEK whose ciphertext sits on a server,
recommended is closer to m=64–256 MiB, t=3. Fix: raise to at least m=64 MiB,
t=3, version it under a new unlock_scheme = password_account_key_v2.

H-4 — No CSP, HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy on
the SPA

No \_headers file, no Caddy header block for the SPA host, no <meta
  http-equiv> in frontend/src/index.html. For an app where the entire E2EE
story collapses on one XSS, this is the single largest unforced error.
Iframing the unlock dialog (clickjacking the lock action) is trivial;
sanitizer regressions or third-party-dependency XSS go straight to plaintext
exfiltration. Fix: ship a strict Cloudflare Pages \_headers file (CSP with
'self' + wasm-unsafe-eval for Argon2id, frame-ancestors 'none',
require-trusted-types-for 'script', HSTS preload, Referrer-Policy
no-referrer). Treat the headers file as a first-class repo artefact and gate
it in CI.

H-5 — No rate-limit, lockout, MFA, or CAPTCHA on auth endpoints

The custom Go limiter in backend/cmd/api/routes.go:38-79 covers /api/v1/\*
only. PocketBase's auth-with-password, auth-refresh, request-password-reset,
request-verification are unthrottled (no rateLimit in any migration).
minPasswordLength: 8. No TOTP/passkey/WebAuthn anywhere. Fix: enable
PocketBase rate-limit rules; bump minPasswordLength to 12; add TOTP at
minimum.

H-6 — users collection has allowOAuth2Auth=true, allowUsernameAuth=true,
onlyVerified=false, requireEmail=false

1710600202_collections_snapshot.go:338-347. Unintended attack surface for
username/OAuth2 auth; unverified accounts can register and consume billing.
Fix: lock all three down in a new migration.

H-7 — No CORS allowlist; PocketBase defaults to \*

No CORS config in Caddyfile or backend. With JWT-bearer (not cookie) auth
this is not direct CSRF, but combined with H-4 it widens XS-leak surface and
is a future foot-gun if cookies are ever introduced. Fix: explicit
AllowOrigins=["https://app.cognos.io", "https://chat.cognos.io"].

H-8 — Trusted-device record co-locates the wrapped blob and the wrapping
CryptoKey

frontend/src/app/services/trusted-unlock.service.ts:80-118 stores {iv,
userId, wrappedUnlockKey, wrappingKey} in one IndexedDB record. The
wrappingKey is non-extractable, but a same-origin XSS just calls
crypto.subtle.decrypt(...) against the handle — read-one-row gives full
plaintext key. The docs are honest about this; the UI copy is not ("locally
wrapped unlock blob so you are not prompted again"). Fix: split the records
to raise the bar from "read one row" to "read two rows"; update product
wording to match the docs.

H-9 — Decrypted conversations & messages survive lock()

vault.service.ts:168-180 clears keyPair but ConversationService
(conversation.service.ts:572-578) and MessageService
(message.service.ts:101-153) retain decrypted titles, bodies, and
per-conversation keypairs in long-lived signals — only logout$ clears them.
After "Lock", a same-origin script (or a paused debugger) still sees
plaintext. Fix: subscribe lock$ in both services and clear decrypted state;
switch sensitive Uint8Arrays to []byte end-to-end so they can at least be
overwritten (Go side) or replaced (JS side).

H-10 — Plaintext PocketBase auth-store in localStorage + no CSP = total
session takeover on any XSS

pocketbase.service.provider.ts:6 uses the default LocalAuthStore (writes JWT
to localStorage['pb_auth']). Logout only authStore.clear() — server-side
JWT is stateless and remains valid for up to a week (PocketBase default).
Fix: rotate tokenKey on logout (invalidates outstanding JWTs); reduce token
TTL; consider moving to a cookie auth-store with SameSite=Strict.

H-11 — bypassSecurityTrustHtml in the shared icon component

packages/ui-angular/src/lib/icon/icon.component.ts:115. Today's title inputs
are hand-escaped with a custom escapeHtml, but the component sits inside
[innerHTML]. One day someone passes user-controlled content and you have XSS
in a chrome component rendered on every screen. Fix: rewrite to <svg><use
  href="#icon-id"> sprite or Angular template \*ngFor; enable Trusted Types via
CSP to chokepoint future regressions.

H-12 — Tabnabbing on unauthenticated pages

login.component.ts:100, register.component.ts:127, contact-help-dialog:
target="\_blank" rel="noreferrer" without noopener. Modern browsers imply
noopener but pre-2021 Safari versions and embedded webviews don't. The login
page is the prime phishing pivot. Fix: rel="noopener noreferrer"
everywhere; add the eslint rule; force the same on AI-output anchors via a
marked renderer override.

H-13 — Message ciphertext has no AAD binding (conversation_id, parent,
version)

backend/internal/chat/messaging.go:20-42 box.SealAnonymous includes no
associated data. A server with write access can splice a ciphertext from one
row into another row; client decrypts cleanly because there is no binding.
Fix: include {conversation_id, parent_message_id, version} in the AAD or in
a verified header inside the plaintext.

H-14 — Conversation keypair construction lacks signed pubkey

frontend/src/app/services/conversation.service.ts:518-534. The conv_pub
stored server-side is unauthenticated; a malicious server can swap it (with
matching encrypted secret_key blob) to forge or replace conversations. Out
of the documented "at rest" threat model but enabled by the construction.
Fix: sign conv_pub with the user's long-term key on upload; verify on fetch.

H-15 — Soft-delete writes full records (including ciphertext metadata) to a
forever-collection

backend/internal/hooks/soft_delete.go:13-46;
1710600202_collections_snapshot.go:9-53. The deleted collection has no TTL
purge. GDPR right-to-be-forgotten is therefore unfulfilled even if a user
deletes content. Fix: TTL cron; exclude sensitive collections (idempotency,
user_key_pairs) from soft-delete entirely.

H-16 — no-retention is a description string, not enforced

backend/internal/catalogue/models.go:49. No per-provider header (store=false
for OpenAI, equivalents elsewhere), no startup assertion that the provider
implementation honours the privacy tier. A provider account-level toggle can
silently re-enable retention. Fix: Upstream interface gains
EnsureNoRetention() contract; fail boot if a no-retention model is wired to
an implementation that cannot enforce it.

H-17 — Catalogue/provider mismatch will pressure a tier-violating band-aid

catalogue/models.go:50 lists infomaniak as the sole approved provider;
backend/pkg/proxy/repo.go:34-57 does not recognize infomaniak → every
completion 503s. Pragmatic risk: someone will alias infomaniak → openai to
unblock, silently routing privacy-tier-CH traffic to a retaining global
provider. Fix: implement the infomaniak upstream first-class; add a
boot-time assertion that every ProviderID in the catalogue resolves to a
real Upstream.

H-18 — Test fixture testdata/pb_data/data.db committed with bcrypt hashes

backend/testdata/pb\*data/{data.db,logs.db}. Test admin and user hashes ship
in the repo; the backend/.gitignore excludes pb_data/ but not
testdata/pb_data/. This trains people to think committing PocketBase DBs is
OK, and the hashes themselves are offline-crackable. Fix: generate fixtures
at test time from a deterministic seed script; add \**/pb*data/ and \*.db\* to
the root .gitignore.

H-19 — Apparently-stale ufw rule for port 8001 (BricksLLM)

README lists 8001 ALLOW Anywhere, no compose service binds 8001, no Go code
references it. Either a vestigial firewall rule for a removed component, or
BricksLLM is running on the host out-of-band and the entire AI proxy is
publicly reachable with whatever auth it ships with. Fix: ss -ltnp | grep
8001 on the host; remove the rule if unused, gate it via Caddy + Tailscale
if used.

H-20 — Stale PocketBase access rules reference a deleted participants
collection

1711007247_deleted_participants.go removed the collection; multiple other
rules still reference @collection.participants.\*. PocketBase's parser will
probably short-circuit these but the result is unreviewed, and one of the
create rules in the snapshot has unmatched parens. The original
participants.createRule was @request.auth.id != "" — any authenticated user
could insert anyone as Admin of any conversation. Anyone who restores
participants later inherits an instant-takeover bug. Fix: rewrite every rule
to remove the dead references; add a startup test that loads each rule
string and asserts it parses.

H-21 — Two access paths, two security models

The app talks to PocketBase native /api/collections/... (governed by
collection rules) AND to /api/v1/... Go handlers (governed by hand-rolled
checks in internal/handler/conversations.go:270-302). They disagree on
filters and error shapes. Server-side writes via forms.NewRecordUpsert and
app.Save bypass collection rules entirely
(backend/internal/chat/conversation.go:39 uses GrantManagerAccess). The
collection rules are effectively dead weight; the Go handler is the only
enforcement. Fix: pick one and document it. Prefer collapsing to the custom
Go handlers for sensitive collections and remove the unused rule
expressions.

H-22 — BorgBase SSH key + passphrase + repo URL all live on the same host

docker-compose.yaml:48 bind-mounts /home/cognos/.ssh:/root/.ssh:ro into the
borgmatic container; Borg passphrase in backup/.env; repo URL hard-coded.
Host compromise = full backup compromise. Fix: narrow the SSH mount to a
single key file; verify BorgBase append-only is set; consider a second,
independent backup destination with different credentials; add restore-test
cadence.

---

3. Medium findings

- M-1. No password-change UI implementation at all — grep -rn
  "changePassword\|updatePassword" frontend/src returns nothing. Hidden behind
  C-2 above, but the change flow needs the same re-wrap.
- M-2. Argon2id wasm fetched without SRI/digest pin
  (vault.service.ts:67-78). An origin-server compromise serves a malicious
  wasm that returns constant "KDF outputs". Fix: post-fetch SHA-384 check
  against a pinned digest before instantiation.
- M-3. frontend/src/environments/environment.development.ts:4 hard-codes
  localVaultPassword: 'password', prefilled into the vault form when
  isDevelopment. One configuration slip = pre-filled password input that
  password managers will save. Fix: read from a build-time env, never commit a
  non-empty default, assert at build that production has it empty.
- M-4. Account Key field (vault-password-dialog.component.ts:124-131) marked
  autocomplete="off" but iOS Safari / 1Password / iCloud Keychain frequently
  ignore that and save the value to cloud-sync. The Account Key — which the
  model assumes lives only on paper / a password manager the user explicitly
  chose — can end up syncing to iCloud silently. Fix: render as a sequence of
  4-char inputs that no password manager recognises as a credential; explicit
  "do not save in your password manager" UI copy.
- M-5. Backend Dockerfile floats bases (golang:1.22, alpine:latest), no
  HEALTHCHECK, no read_only, no cap_drop: [ALL], no security_opt:
  [no-new-privileges:true]. web container has cap_add: NET_ADMIN rarely needed
  by Caddy. Fix: pin by digest, drop capabilities, set read-only FS.
- M-6. web/Caddyfile has zero security headers (HSTS,
  X-Content-Type-Options, Referrer-Policy, COOP, CORP). Only request_body size
  cap. Fix: add a header block with the standard set.
- M-7. apis.NewApiError(..., err) in complete.go passes raw upstream
  provider errors (which sometimes echo prompt fragments in param/message
  fields) into PocketBase's ApiError. In dev mode this serializes to the
  response; in prod it logs. Fix: sanitize wrapper: fmt.Errorf("upstream
  provider error: %s", providerName), log details separately with redaction.
- M-8. /health performs DNS + TCP + HTTPS GET to <https://www.example.com> on every
  probe, unauthenticated. SSRF/amplification primitive and exposes outbound
  network egress. Fix: cache or remove the external check.
- M-9. /metrics endpoint behind only a Caddy rewrite (rewrite /metrics /404)
  — bypassed by direct :8090 hits (see C-4). Fix: respond /metrics 404 or
  auth-gate; bind metrics to a separate internal-only listener.
- M-10. Idle-logout listener uses deprecated keypress
  (app.component.ts:27-43), missing non-printable key activity, touchstart,
  visibilitychange. Fix: keydown + touchstart + visibilitychange.
- M-11. Mermaid (~3 MB; uses Function(); historical XSS advisories) is in
  frontend/package.json but unused. Forces a future weak CSP (unsafe-eval) if
  enabled accidentally. Fix: remove until consciously enabled with a
  sanitizing wrapper.
- M-12. Idempotency repo field-name mismatch (body vs response_body_json)
  means idempotency is silently disabled (internal/idempotency/repo.go:50,78).
  Currently masking C-5; fixing this bug without fixing C-5 first lands
  plaintext in the DB.
- M-13. Auth-refresh loop's failure path triggers logout on transient
  5xx/network failures (auth.service.ts:114-139). Forces extra unlock prompts
  — UX, not security, but user-friction often pushes people to "trust device
  forever". Fix: distinguish 401 from 5xx.
- M-14. User: owner.ID forwarded as-is to upstream providers
  (complete.go:187). The PB user ID is a stable opaque identifier;
  pseudonymous correlation at provider over time. Fix: HMAC with a rotating
  per-environment pepper.
- M-15. AI provider API keys live as plaintext in
  configs/api.production.yaml mounted into the container
  (docker-compose.yaml:36). Host compromise = all provider keys. Fix: Docker
  secrets or KMS-backed loader.
- M-16. xcaddy builds Caddy + cloudflare plugin without version pinning
  (web/Dockerfile:1-2). Supply-chain drift on the TLS layer. Fix: pin Caddy +
  plugin to specific versions/SHAs.

---

4. Low / Informational findings

- L-1. console.error('Error sending message', err) (message.service.ts:506)
  — HttpErrorResponse often contains prompt/title text. Browser extensions
  with console.\* hooks see it.
- L-2. document.execCommand('copy') fallback
  (vault-password-dialog.component.ts:404-420) writes the Account Key briefly
  into the DOM; a MutationObserver could read it. Remove fallback or wipe
  textarea value before remove.
- L-3. No explicit sourceMap: false in angular.json production block —
  currently safe by default, but pin it.
- L-4. Empty name/short_name in site.webmanifest — PWA install prompts are
  easier to spoof.
- L-5. pocketbase.service sends Authorization: <token> (no Bearer prefix).
  PocketBase accepts both; some WAFs may strip the unprefixed form.
- L-6. password_salt is 16 bytes — meets RFC 9106 minimum but bumping to 32
  aligns with reference.
- L-7. Account Key is 128 bits (accountKeyBytes = 16) — industry-standard
  (matches 1Password) but documented as "high entropy" which over-claims.
- L-8. Anthropic provider hard-codes Temperature=0, TopP=0 via
  pointer-to-zero (pkg/proxy/anthropic.go:53-54), forcing deterministic output
  and providing a colluding-provider fingerprinting primitive. Minor.
- L-9. Pre-commit gitleaks (lefthook.yml:5-7) only catches staged content
  and only for devs who installed hooks. No history scan, no CI guard.
- L-10. README documents a long-lived GitHub PAT used for git pull on prod —
  replace with a read-only deploy key.
- L-11. Generate-key-pair CLI accepts --password as a flag (visible in ps,
  /proc/<pid>/cmdline). Read from stdin (no echo).
- L-12. cmd/api/main.go uses forms.GrantManagerAccess() in the
  message-after-create hook (backend/internal/chat/conversation.go:32-43) —
  works today, but bypasses validation; replace with a scoped UPDATE
  conversations SET updated = ? WHERE id = ?.
- L-13. web/Dockerfile caddy:2-builder / caddy:2 floating major.
- L-14. No Sentry/PostHog/Mixpanel/Amplitude anywhere — write this in as a
  CI grep guard so it stays that way.
- L-15. No service worker registered — keep it that way; PWA caches would
  defeat the "no plaintext at rest on client" assumption.

---

5. Observed strengths

These are the load-bearing things that are correct and should be preserved:

- Cryptographic primitives are well-chosen: NaCl box/secretbox, Argon2id,
  AES-GCM, all from vetted libraries (tweetnacl@1.0.3, argon2id@1.0.1,
  golang.org/x/crypto@v0.52.0). No custom crypto.
- All randomness uses crypto/rand (Go) and crypto.getRandomValues via
  tweetnacl (JS). No math/rand in production paths.
- KDF input is password || \0 || AccountKey with explicit separator; email
  is not included → matches the "email change must not break crypto"
  requirement.
- Per-user random 16-byte salt; AEAD-wrapped private key; wrong-key detected
  reliably.
- Trusted-device wrapping uses a non-extractable AES-GCM CryptoKey with a
  fresh 96-bit IV per write; IV reuse impossible.
- unlock_scheme = password_account_key_v1 versioning string already in place
  to enable future migrations.
- Server never holds plaintext private keys. EncryptAndPersistMessage only
  sees the recipient public key.
- Completion flow encrypts-before-persist and rolls back the persisted user
  message if the upstream call fails (complete.go:171-216) — correct ordering.
- Zero log lines emit message bodies or prompts anywhere in the active
  completion path. Billing is strictly token-count + cost.
- No web-search/RAG/file-upload tools today — fewer plaintext sinks.
- All custom /api/v1/\* routes wrap with apis.RequireAuth() and a
  per-identity rate limiter.
- TLS posture is default-secure: no InsecureSkipVerify, no custom transport.
- Logout and lock both call \_trustedUnlockService.clearAllUnlockKeys() and
  vault.lock$ correctly invalidates the in-memory key handle.
- Account Key onboarding requires explicit acknowledgement before initial
  backup creation (commit ca59a45).
- Markdown rendering uses ngx-markdown in default-sanitised mode, with KaTeX
  trust: false; no bypassSecurityTrust\* on rendered AI output.
- No analytics, no Sentry, no third-party CDN scripts — runtime third-party
  JS surface is exactly what's bundled.
- Backend container runs non-root (USER appuser, uid 1001);
  backend/.dockerignore excludes pb_data/ and testdata/ from the image.
- backend/configs/.gitignore is allowlist-style (_.yaml then
  !_.example.yaml).
- lefthook + Gitleaks pre-commit; make audit exists locally (govulncheck +
  go vet + staticcheck + race tests).
- docs/security-model.md is honest about the limits ("trusted-device
  wrapping does not protect against same-origin compromise", "server sees
  plaintext during completion") — a strong baseline for marketing-vs-reality
  alignment.

---

6. Recommended remediation roadmap

Sprint 1 — operational containment (1 week, mostly infra + migrations)

1. C-3, C-4, H-19, M-9: kill public exposure of Caddy admin (:2019),
   PocketBase (:8090), BricksLLM (:8001); update ufw to match.
2. H-4 + M-6: ship Cloudflare Pages \_headers and Caddy header block (CSP,
   HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy, COOP/CORP).
3. C-7 (partial): pin every image by digest; reconcile go.mod vs Dockerfile;
   add minimal trivy + cosign GitHub Actions pipeline.
4. C-5: delete or harden idempotency middleware before someone "fixes the
   bug" and lights up M-12.
5. H-5: turn on PocketBase rate-limit rules for auth-with-password,
   request-password-reset, request-verification; bump minPasswordLength to 12.
6. H-6: disable OAuth2/username auth, require email + verification.
7. H-18: stop tracking backend/testdata/pb_data/\*.db; regenerate at test
   time.
8. H-7: explicit CORS allowlist.

Sprint 2 — vault & key-record invariants (2 weeks, app code)

9. C-1: unique-per-user index on user_key_pairs; tighten createRule; design
   signed key-rotation envelope.
10. C-2: password-reset must collect Account Key, re-wrap atomically, refuse
    otherwise. Add explicit "you will lose history" UI for the fallback case.
11. C-6: email-change hook requires current password + AccountKey +
    verification to old address.
12. H-1, H-14: sign user/conversation public keys; verify on every fetch;
    persist TOFU fingerprint client-side.
13. H-2: reject empty unlock_scheme; bind (scheme, salt, ciphertext) under a
    MAC keyed by AccountKey.
14. H-3: bump Argon2id to m=64 MiB, t=3 under password_account_key_v2.
15. H-9: clear decrypted state on lock$ in ConversationService and
    MessageService.
16. H-10: rotate PocketBase tokenKey on logout to invalidate outstanding
    JWTs.
17. H-13: add AAD binding to message ciphertexts.
18. M-1: implement explicit password-change UI with re-wrap.

Sprint 3 — provider trust + frontend hardening (1–2 weeks)

19. H-16, H-17: implement infomaniak upstream first-class;
    EnsureNoRetention() contract with boot-time assertion.
20. H-11: rewrite icon component to drop bypassSecurityTrustHtml; register
    Trusted Types policy.
21. H-12: rel="noopener noreferrer" everywhere; add marked anchor renderer
    override.
22. M-2: SRI/digest pin for Argon2id wasm.
23. M-3, M-4: kill the dev-default 'password' prefill; render Account Key
    field in a way password managers don't latch onto.
24. H-8: split trusted-device record into two stores; correct UI copy.

Sprint 4 — process & program (ongoing)

25. MFA: TOTP at minimum, passkeys preferred.
26. Audit log: audit_events collection capturing auth, password-change,
    email-change, key-rotation, admin actions.
27. Penetration test by an external firm focused on the E2EE invariants once
    Sprint 2 lands.
28. Threat model review — document this analysis as the baseline; track each
    finding to closure with a test.
29. Bug bounty program (security.txt is present — wire it to a real intake).
30. Backup: append-only confirmation on BorgBase; secondary independent
    destination; quarterly restore drill.

---

7. Notes on what I did not review

- Live deployment configuration on Hetzner — ufw status and Hetzner LB rules
  are documented in the README but not verified against the real host. Run ss
  -ltnp and hetzner-cli load-balancer describe to confirm.
- Cloudflare Pages live headers — verify with curl -I <https://app.cognos.io/>
  what is actually served vs what is in this repo (which is: nothing).
- Whether the cognosio/api.cognos.io :latest image in production actually
  matches this branch's source.
- Frontend dependency CVE audit beyond pattern review — run pnpm audit
  --prod and govulncheck ./... as part of CI.
- Marketing site (web/, Astro) was not reviewed; assumed lower-stakes.
- Mobile/desktop clients — none in repo at time of review.
