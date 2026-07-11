# Security Findings — Open Items

Updated 2026-06-06. Re-verified against HEAD on `feat/security-fixes`.
Closed items have been removed; this doc only tracks what still needs work.
Status: 🟡 Partially fixed · ❌ Not fixed · 🆕 New.

> **Historical review:** deployment references in this document describe the retired in-repository
> Compose/Caddy prototype. [`deployment-interface.md`](./deployment-interface.md) is authoritative
> for the current application/deployment boundary; deployment-repository controls still require
> verification there.

## 0. Summary

Open items cluster into four themes:

1. **Below the 1Password bar for paid GA**: no MFA, no signed
   key-rotation envelope, no password-change UI, no account
   recovery, JWT still in `localStorage`.
2. **Operational hardening**: container `read_only` / `cap_drop`,
   Cloudflare trust boundary (`trusted_proxies` + origin-IP
   lockdown).
3. **Cryptographic protocol gaps**: Argon2 params raised
   without an `unlock_scheme` bump.
4. **Supply chain & secrets**: CI lints/tests/scans but doesn't
   push/sign/cosign; Cloudflare API token in Caddyfile env;
   BorgBase repo URL co-located with credentials; xcaddy
   Cloudflare plugin unversioned; provider keys still on the host
   filesystem (Compose secrets, not KMS).

Plus the non-technical billing/compliance package in §5.

## 1. Critical findings

### C-7 — Production deploy lacks signed/verified artefacts

Status: 🟡 Partially fixed.

- CI exists (`.github/workflows/ci.yml`) and runs `govulncheck`,
  `trivy fs`, SBOM, `pnpm build`, `go test`, e2e — but does
  **not** push, sign with cosign, or publish provenance.
  `docker build` runs in the runner and is discarded.
- Production still resolves to `docker compose up --build` on
  the prod host. Same threat as the original "trust Docker Hub";
  shifted to "trust prod host toolchain".
- Base images pinned by tag, not digest.
- `xcaddy --with github.com/caddy-dns/cloudflare` is unversioned
  (`web/Dockerfile:3`).

Fix: build in CI, sign with cosign, push by digest to a registry,
have prod pull by digest only. Pin base images by digest. Pin the
Caddy DNS plugin to a release tag.

## 2. High findings

### H-5 — No MFA, weak password floor, no per-account lockout

Status: 🟡 Partially fixed.

- Per-identity rate limit on `/api/v1/*` (60/hr, burst 30) is in
  place (`backend/cmd/api/routes.go:36-77`).
- PocketBase native limiter is still wildcard `*:` (per-IP) and
  collapses to the Cloudflare edge IP — see N-9.
- `minPasswordLength: 8` not raised
  (`1710600202_collections_snapshot.go:343`).
- **No MFA / TOTP / passkey / WebAuthn anywhere.** Most visible
  gap vs the 1Password bar. Blocks paid GA.
- No per-account lockout.
- No CAPTCHA.

Fix: TOTP first, WebAuthn passkey second; raise `minPasswordLength`
to ≥12; per-account lockout with exponential backoff after N
failures.

### H-8 — Trusted-device record co-locates wrapped blob and wrapping CryptoKey

Status: ✅ Fixed (split-key session).

The earlier design wrote `{iv, userId, wrappedUnlockKey, wrappingKey}`
to a single IndexedDB record, so a single "read-one" yielded a plaintext
key. `trusted-unlock.service.ts` no longer co-locates the two halves: the
unlock key is wrapped client-side and only the ciphertext is kept in
`localStorage`, while the wrapping ("wrap") key half is held server-side
and fetched per session via `/api/v1/vault-session`, where it is
revocable. Neither half alone recovers the unlock key, so a single read
no longer leaks it. See the split-key persistent session in
`security-model.md`.

### H-10 — PocketBase auth-store in localStorage

Status: 🟡 Partially fixed.

- Token rotation on logout is real (`/v1/auth/logout` calls
  `RefreshTokenKey()`).
- JWT still lives in `localStorage` (default `LocalAuthStore`).
  CSP + Trusted Types make the XSS prerequisite materially
  harder; cookie-store / non-extractable memory-only store
  deferred.

Fix (post-launch is acceptable): migrate to a memory-only store
with refresh-on-focus, or an HttpOnly cookie via a new endpoint.

### H-22 — BorgBase credentials and repo URL co-located on prod host

Status: 🟡 Partially fixed.

- SSH key + passphrase now use the Compose secrets API (file
  mounts, not bind-mounted `~/.ssh`).
- The repo URL is still hard-coded in
  `backup/borgmatic.d/cognos.yaml`. Host compromise still equals
  backup-account compromise.

Fix: move the repo URL into the same secrets store; rotate the
BorgBase account if the prod host was ever shared.

## 3. Medium findings

- **M-1. No password-change UI.** ❌ With password reset, email
  change, and key rotation all forbidden server-side there is no
  in-app rotation path. Pair with N-5. Blocks paid GA.
- **M-5. Container hardening.** 🟡 Backend non-root + Compose
  `user: "1001:0"` + base versions pinned. Missing on every
  service: `read_only: true`, `cap_drop: [ALL]`,
  `security_opt: [no-new-privileges:true]`, `HEALTHCHECK`,
  `deploy.resources.limits`. One PR.
- **M-11 / N-14. Mermaid still bundled transitively.** ❌
  `frontend/package.json` no longer declares it, but
  `pnpm-lock.yaml` resolves `mermaid@11.15.0` via
  `ngx-markdown@21.3.0`. Verify markdown service doesn't register
  mermaid as an extension; if not, drop via `pnpm overrides` or
  switch to a slimmer renderer.
- **M-15. AI provider keys on host filesystem.** 🟡 Keys now via
  Compose secrets API rather than a bind-mounted YAML; still on
  disk on the host, not in a KMS. Acceptable interim for a
  one-host deploy.
- **M-16. xcaddy Cloudflare plugin unpinned.** 🟡 Caddy itself
  pinned (`caddy:2.11.4`); `--with github.com/caddy-dns/cloudflare`
  (`web/Dockerfile:3`) has no version. Pin to a release tag.

## 4. Low / Informational findings

- **L-2. `document.execCommand('copy')` fallback.** ❌
  (`vault-password-dialog.component.ts:404-420`). Account Key is
  application-generated so the DOM-leak risk is bounded; still
  worth removing and surfacing a "browser doesn't support
  clipboard" message.
- **L-8. Anthropic Temperature=0 / TopP=0 pointer bug.** ❌
  (`backend/pkg/proxy/anthropic.go:59-64`). `Temperature=0` is
  silently dropped and the Anthropic default applies.
- **L-14. No analytics / Sentry / posthog.** Still true (intended;
  noted for completeness).
- **L-15. No service worker.** Still true (intended; keeps attack
  surface small).

## 5. Newly surfaced or unaddressed items

### N-4 — Argon2id parameter change without `unlock_scheme` bump

Status: ✅ Fixed.
The scheme was cut over to **`account_key_v2`** (the secret key is now
wrapped under `Argon2id(Account Key)` alone — the password is
authentication-only). The legacy `password_account_key_v1` value is no
longer accepted: the `user_key_pairs` create rule pins
`unlock_scheme = "account_key_v2"`. Launch is greenfield, so v1 was
dropped outright rather than migrated.

### N-5 — No signed key-rotation envelope

Status: ❌ Not fixed (by design).
Combined with C-2/C-6 and M-1, an account-key loss = vault loss
with no recovery path. Acceptable for private beta; before paid
GA, design a signed rotation envelope that proves knowledge of
the prior Account Key.

Pair with M-1 (password-change UI) and a broader recovery flow:
recovery codes generated at onboarding, signed by the Account
Key, stored client-side; user prints them; recovery flow accepts
a recovery code + new password and re-wraps the secret key.

### N-9 — Caddy `trusted_proxies` not configured

Status: 🟡 Partially fixed.
Per-identity rate limits on `/api/v1/*` close the application
half. PocketBase native limiter (`hooks/rate_limits.go`) is still
wildcard `*:` per-IP and collapses to the Cloudflare edge IP when
no `trusted_proxies` is set on Caddy (`web/Caddyfile`).

Fix: configure Caddy `trusted_proxies` with Cloudflare's
published CIDR list so `CF-Connecting-IP` / `X-Forwarded-For` is
recovered; revisit native limits with per-identity scoping where
feasible.

### N-11 — Production builds happen on the prod host

See C-7.

### N-17 — Cloudflare API token in Caddyfile env (NEW)

`web/Caddyfile` reads `{env.CF_API_TOKEN}` for the ACME-DNS
challenge. The token sits in `web/.env` on the prod host and may
appear in Caddy startup logs / process env dumps. Move to a
Compose secret (mounted file) and use Caddy's
`{file./run/secrets/cf-token}` placeholder. Confirm the token is
scoped to DNS-edit on the single zone.

### N-20 — Cloudflare → Caddy trust boundary not configured (NEW)

There is no Cloudflare-only ingress lock at the Hetzner LB / ufw
/ Caddy layer, so a direct hit to the origin IP bypasses
Cloudflare entirely (rate limits, WAF, bot management). Lock the
origin IP behind Cloudflare-only ingress, then configure Caddy
`trusted_proxies` (N-9).

## 6. Billing & compliance readiness

Before charging 70 CHF/month, these are regulator-visible
must-haves, not optional polish:

1. **`SECURITY.txt` + `security@` contact** (`/.well-known/security.txt`,
   RFC 9116) and a written disclosure policy. Trivial to land.
2. **ToS + Privacy Policy** matching what the code actually does.
   The "no data retention" claim is enforced for completions
   (Infomaniak only; see strengths section in commit history),
   but plaintext IS in backend memory during the proxy call and
   message metadata (conversation_id, parent, version) is in
   plaintext alongside the ciphertext. Disclose both.
3. **revDSG (Swiss DPA, 2023) alignment**:
   - Purpose limitation: billing email separate consent from
     login email.
   - Documented deletion timeline for ciphertext on account
     close (separate from tax-law retention on invoices).
   - Records-of-processing log.
4. **Stripe integration design** (when it lands):
   - Webhook signature verification (HMAC-SHA256), 5-minute
     timestamp window, idempotency, replay protection.
   - Subscription state ↔ vault access: lock on payment lapse
     or keep read-only? Write the policy down before code.
   - DPA with Stripe (or document Swiss-law exemption).
5. **MFA / TOTP / WebAuthn** (H-5). Blocks paid GA.
6. **Account-recovery design** (N-5 + M-1). Blocks paid GA.
7. **Audit-log collection** (`audit_events`): auth, blocked
   email-change attempts, blocked reset attempts, key-rotation
   events, admin actions. For both incident response and
   customer-visible "recent activity".
8. **Third-party audit + bug bounty** (Trail of Bits / Cure53 /
   Intigriti / HackerOne). 6–8 week lead time — start the
   conversation now even if scope/timing is later.
9. **Marketing-site headers**: the public marketing site (if
   separate from the SPA) needs the same CSP/HSTS/COOP/CORP
   treatment as the app domain. Not in this audit's scope; flag
   for follow-up.

## 7. Where we stand vs the 1Password bar

The crypto primitives and data-flow are sound; the gaps are
operational and product:

- **MFA / WebAuthn**: none. 1Password ships TOTP + Recovery
  Codes + WebAuthn passkey + device-revoke UI.
- **Signed Secret Key / proof-of-knowledge**: 1Password uses SRP
  so the password never leaves the device. Cognos sends password
  and Account Key over TLS to the server; equal practical
  security assuming TLS, but worse story to tell. Not a launch
  blocker — note this is intentional.
- **Account recovery**: 1Password Emergency Kit / recovery codes
  / family-organiser unlock. Cognos: account-key loss = vault
  loss. See N-5.
- **Device revocation**: 1Password lists active devices and lets
  users revoke. Cognos: per-browser IndexedDB clear only.
- **Audited protocol**: 1Password has multiple Trail of Bits
  reports + an academic whitepaper. Cognos has
  `docs/security-model.md`, which is honest but not externally
  audited and not RFC-style spec'd.
- **Bug bounty + advisories**: 1Password has both; Cognos has
  neither yet. See §6 item 1.

## 8. Recommended remediation order

**P0 — Before paid GA (4–6 weeks):**

1. **MFA** (H-5).
2. **Account-recovery design** (N-5 + M-1).
3. **§6 items 1–3**: SECURITY.txt, ToS, Privacy, revDSG.
4. **Stripe integration design** before code lands (§6 item 4).

**P1 — Next 1–2 weeks of engineering:**

6. **N-9 / N-20** Cloudflare trust boundary: lock origin to
   Cloudflare CIDRs at the firewall; configure Caddy
   `trusted_proxies`; convert PocketBase native rate limits to
   per-identity where possible.
7. **M-5** container hardening: `read_only`, `cap_drop: [ALL]`,
   `no-new-privileges`, `HEALTHCHECK`, resource limits. One PR.
8. **N-17** Cloudflare API token via Compose secrets.
9. **L-8** Anthropic Temperature=0 pointer bug.
10. **M-11 / N-14** confirm + trim mermaid.
11. **H-22 / M-15 follow-through**: BorgBase repo URL into
    secrets; consider rotating the BorgBase account.

**P2 — Next 4 weeks of engineering:**

17. **C-7 closure**: CI signs (cosign) and pushes by digest;
    prod pulls by digest only. Pin base images by digest.
    Pin xcaddy Cloudflare plugin (M-16).
18. **H-8** trusted-device record split.
19. **H-10** PocketBase auth-store off `localStorage`.
20. **Audit-log collection** (`audit_events`).
21. **Marketing-site headers** sweep.
22. **Third-party audit** kicked off + bug bounty program.

## 9. Not re-verified in this pass

- Live deployment configuration on Hetzner (`ss -ltnp`, Hetzner
  LB rules, ufw active rules).
- Live Cloudflare Pages headers
  (`curl -I https://app.cognos.io/`) — confirm `_headers` is
  actually served.
- Live Cloudflare origin-IP exposure (does the LB have a public
  IP that bypasses Cloudflare?).
- Dependency CVE scan (`pnpm audit --prod`, `govulncheck ./...`)
  beyond what CI runs.
- BorgBase backup actually restores cleanly — last verified
  restore date should be in the runbook.
- Stripe integration — no code yet to audit.
