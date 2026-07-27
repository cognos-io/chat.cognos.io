# Deployment interface

This document is the application repository's authoritative contract with production deployment.
It describes what Cognos builds and requires; it does not prescribe the production platform.

The **private Cognos deployment repository** is authoritative for deployed image digests, DNS,
CDN/WAF, firewall rules, reverse proxies, TLS, secret storage, volumes, backup scheduling,
monitoring and rollback automation. Its location is intentionally not embedded in this public
application repository. Operators must record its canonical URL in the private runbook and grant
access through the normal production-access process. If this document and that repository disagree
about application inputs, reconcile the difference before deployment; do not silently compensate
in platform configuration.

## Ownership boundary

| Concern                                                                       | Owner                 |
| ----------------------------------------------------------------------------- | --------------------- |
| Backend source, migrations, runtime configuration schema and container recipe | This repository       |
| Angular and marketing source, production builds and frontend header policy    | This repository       |
| Image registry, signatures/attestations, deployed digests and environments    | Deployment repository |
| DNS, CDN/WAF, origin firewall, trusted proxies, TLS and header delivery       | Deployment repository |
| Secret values, rotation, persistent volumes, backups, restores and monitoring | Deployment repository |

The supported topology is a static Angular application at `app.cognos.io`, the API at
`api.cognos.io`, and the marketing site at `cognos.io`. Only the edge may reach the API origin.
PocketBase is currently a **single-writer, single-instance** service backed by its `pb_data` volume.
In-memory IP rate limits are per process, so horizontal replicas are unsupported until rate-limit
state and the SQLite/PocketBase data model are deliberately redesigned.

## Build, promotion and rollback

The canonical backend recipe is
[`../container/backend/Containerfile`](../container/backend/Containerfile) and its build context is
the repository root:

```sh
podman build --file container/backend/Containerfile --tag cognos-backend:verify .
```

There is deliberately no production Compose file in this repository. Production images must be
built off-host from a reviewed commit in CI, scanned, assigned an SBOM and provenance, signed, and
pushed to the private registry. Base images and build tools must be pinned by digest in the release
pipeline. Promote the exact `image@sha256:<digest>` between environments; never rebuild a tag or
deploy a floating tag. The deployment repository records the application commit, image digest,
schema/migration state and configuration revision for every release.

Rollback means redeploying the previously recorded digest and configuration revision. PocketBase
migrations run on API startup and are forward-only in operational terms: do not roll an application
back across an incompatible migration. Use expand/contract changes, or restore the pre-deploy
volume snapshot only under the restore runbook after stopping the writer.

Pushes to `main` publish the backend to `ghcr.io/<owner>/cognos-backend` with immutable
`sha-<commit>` and convenience `main` tags. Deploy and roll back by digest; the `main` tag is not a
promotion reference. The workflow attaches BuildKit SBOM/provenance and a GitHub artefact
attestation to the published digest. After publishing, it updates the private deployment
repository's Cognos image tag and digest on a bot-owned branch and opens or refreshes a promotion
pull request. Forgejo is the default infrastructure host. The deployment job joins the tailnet as
an ephemeral `tag:cognos-deploy` device before cloning the repository or calling the Forgejo API.
Configure these values on the GitHub `production` environment:

| Kind   | Name                                    | Meaning                                                          |
| ------ | --------------------------------------- | ---------------------------------------------------------------- |
| Secret | `FORGEJO_INFRASTRUCTURE_TOKEN`          | Repository contents and pull-request write access only           |
| Secret | `TS_OAUTH_CLIENT_ID`                    | Tailscale federated identity client ID                           |
| Secret | `TS_AUDIENCE`                           | Tailscale federated identity audience                            |
| Var    | `FORGEJO_INFRASTRUCTURE_REPOSITORY_URL` | Tailnet-reachable HTTPS clone URL for the deployment repo        |
| Var    | `FORGEJO_INFRASTRUCTURE_REPOSITORY`     | Forgejo repository in `owner/repository` form                    |
| Var    | `FORGEJO_INFRASTRUCTURE_API_URL`        | Tailnet-reachable Forgejo API base URL ending in `/api/v1`       |
| Var    | `FORGEJO_TAILSCALE_HOST`                | Forgejo MagicDNS name or Tailscale IP, used as a readiness probe |
| Var    | `INFRASTRUCTURE_PROVIDER`               | Optional provider; defaults to `forgejo`                         |

The Tailscale client ID and audience are not secret material, but storing them as environment
secrets follows the action's convention and keeps all trust-credential configuration together.
The job already has the `id-token: write` permission required to obtain its short-lived GitHub OIDC
token. No Tailscale auth key or OAuth client secret is stored in GitHub.

In the Tailscale admin console, create an OpenID Connect federated identity for GitHub Actions with
the `auth_keys` scope and only the `tag:cognos-deploy` tag. Restrict it to this repository and
workflow. With GitHub's default OIDC subject format, the `production` environment produces the
subject `repo:cognos-io/chat.cognos.io:environment:production`; also match the custom claims
`repository=cognos-io/chat.cognos.io` and
`job_workflow_ref=cognos-io/chat.cognos.io/.github/workflows/deploy.yml@refs/heads/main`. Check the
repository's GitHub OIDC settings before relying on the example subject if it uses a customised or
immutable subject template.

Tag the Forgejo node `tag:forgejo` and add the narrow network grant below to the tailnet policy.
Keep the existing tag owners, and make sure only tailnet administrators or a dedicated tag-owner
identity can assign either tag:

```json
{
  "tagOwners": {
    "tag:cognos-deploy": ["autogroup:admin"],
    "tag:forgejo": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:cognos-deploy"],
      "dst": ["tag:forgejo"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Merge these entries into the existing policy rather than replacing it. If the tailnet-reachable
Forgejo URL uses a port other than HTTPS `443`, grant only that TCP port and include it in both
Forgejo URLs. The Forgejo token must belong to a dedicated automation identity scoped only to the
deployment repository. Merging the generated pull request remains the deployment authorisation
boundary.

The GitHub provider remains available as a fallback. To use it, set `INFRASTRUCTURE_PROVIDER` to
`github` and configure `GH_INFRASTRUCTURE_TOKEN`, `GH_INFRASTRUCTURE_REPOSITORY_URL`,
`GH_INFRASTRUCTURE_REPOSITORY`, `GH_INFRASTRUCTURE_USERNAME` and, for GitHub Enterprise,
`GH_INFRASTRUCTURE_API_URL`. The username is the GitHub Account that owns the token; it is
non-secret and is used only for HTTPS Git authentication.

The frontend is built with `pnpm --dir frontend build`; production values are currently compiled
from `frontend/src/environments/environment.ts`. A release review must verify:

- `pocketbaseBaseUrl=https://api.cognos.io` and `marketingBaseUrl=https://cognos.io`;
- the Paddle client token is publishable (never a Paddle API key) and its environment is
  `production` when checkout is enabled;
- Plausible is enabled only for the approved production site; and
- feature flags match the features whose backend, billing and operational dependencies are ready.

The marketing site is built with `pnpm --filter @cognos/web build`. Its canonical application links
come from `web/src/config.ts`.

Pushes to `main` upload both static builds to separate Bunny Storage zones. Hash-named assets are
uploaded before other files and `index.html` entry points are uploaded last; each upload includes a
SHA-256 checksum. The associated pull zone is purged only after its complete upload succeeds.
Previous hash-named assets are retained so an older HTML release can be restored safely; apply a
deliberate age-based Storage lifecycle policy rather than deleting them during deployment.

Configure the GitHub `production` environment with these Actions values:

| Kind   | Name                           | Meaning                                      |
| ------ | ------------------------------ | -------------------------------------------- |
| Secret | `BUNNY_API_KEY`                | Bunny account API key used only for purging  |
| Secret | `BUNNY_APP_STORAGE_KEY`        | App Storage zone password                    |
| Secret | `BUNNY_WEB_STORAGE_KEY`        | Marketing Storage zone password              |
| Var    | `BUNNY_APP_STORAGE_ZONE`       | App Storage zone name                        |
| Var    | `BUNNY_WEB_STORAGE_ZONE`       | Marketing Storage zone name                  |
| Var    | `BUNNY_APP_PULL_ZONE_ID`       | App Pull Zone numeric ID                     |
| Var    | `BUNNY_WEB_PULL_ZONE_ID`       | Marketing Pull Zone numeric ID               |
| Var    | `BUNNY_APP_STORAGE_ENDPOINT`   | App regional Storage API endpoint (optional) |
| Var    | `BUNNY_WEB_STORAGE_ENDPOINT`   | Web regional Storage API endpoint (optional) |

If an endpoint variable is omitted, the Frankfurt endpoint
`https://storage.bunnycdn.com` is used. Storage zone passwords and the account API key are distinct
credentials and must not be interchanged.

## Runtime configuration

Secret values must come from the deployment platform's secret store as read-only files. Never put
them in an image, general environment file, command line, deployment diff or log. `_FILE` values
take precedence over direct values. Optional secret-file variables must be omitted when their file
is not mounted; pointing at a missing file intentionally fails startup.

| Setting                                          | Requirement                                          | Secret | Purpose                                                     |
| ------------------------------------------------ | ---------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `COGNOS_BIFROST_LOG_LEVEL`                       | Optional; production must be `error`                 | No     | Content-safe gateway logging                                |
| `COGNOS_INFOMANIAK_API_KEY_FILE`                 | Required if any Infomaniak model is enabled          | Yes    | Mounted provider credential                                 |
| `COGNOS_INFOMANIAK_PRODUCT_ID`                   | Required for Infomaniak unless URL is explicitly set | No     | Provider tenant                                             |
| `COGNOS_INFOMANIAK_URL`                          | Optional                                             | No     | Approved provider endpoint override                         |
| `COGNOS_REQUESTY_API_KEY_FILE`                   | Required if any Requesty model is enabled            | Yes    | Mounted provider credential                                 |
| `COGNOS_REQUESTY_URL`                            | Optional; defaults to the EU router                  | No     | Approved Requesty endpoint override                         |
| `COGNOS_REQUESTY_FORCE_DISABLE_ABSENT`           | Optional; normally `false`                           | No     | Catalogue-sync emergency override                           |
| `COGNOS_GATEWAY_GROUNDING_REDIRECT_PREFIX`       | Optional                                             | No     | Approved grounding redirect service                         |
| `COGNOS_BILLING_TRIAL_SEED_RAPPEN`               | Required commercial decision                         | No     | Trial credit                                                |
| `COGNOS_BILLING_PAYG_MIN_COMMIT_RAPPEN`          | Required when PAYG is sold                           | No     | Minimum PAYG commitment                                     |
| `COGNOS_BILLING_UNLIMITED_FAIR_USE_ALERT_RAPPEN` | Required when Unlimited is sold                      | No     | Fair-use alert threshold                                    |
| `COGNOS_BILLING_MARGIN_BPS`                      | Required when paid AI is enabled                     | No     | Provider-cost markup                                        |
| `COGNOS_BILLING_WEB_SEARCH_FLOOR_MICRO_RAPPEN`   | Required when web search is enabled                  | No     | Per-search floor                                            |
| `BILLING_FX_RATE_FALLBACK_USD_CHF`               | Required commercial decision                         | No     | Exchange-rate fallback                                      |
| `COGNOS_CUSTOM_STORAGE_QUOTA_BYTES`              | Optional; defaults to 100 MB                         | No     | Free-tier cap on sealed custom-provider Message ciphertext  |
| `COGNOS_PADDLE_API_BASE`                         | Required when billing is enabled                     | No     | Production Paddle API origin                                |
| `COGNOS_PADDLE_API_KEY_FILE`                     | Required when billing is enabled                     | Yes    | Mounted Paddle server credential                            |
| `COGNOS_PADDLE_WEBHOOK_SECRET_FILE`              | Required when billing is enabled                     | Yes    | Mounted webhook verifier secret                             |
| `COGNOS_PADDLE_PRICE_PAYG`                       | Required when PAYG is offered                        | No     | Canonical Paddle price ID                                   |
| `COGNOS_PADDLE_PRICE_PAYG_OVERAGE`               | Required when PAYG overage is offered                | No     | Canonical overage price ID                                  |
| `COGNOS_PADDLE_PRICE_UNLIMITED_MONTHLY`          | Required when monthly Unlimited is offered           | No     | Canonical price ID                                          |
| `COGNOS_PADDLE_PRICE_UNLIMITED_ANNUAL`           | Required when annual Unlimited is offered            | No     | Canonical price ID                                          |
| `COGNOS_PADDLE_PRICE_ORG_SEAT`                   | Required when Organisation billing is offered        | No     | Monthly per-Seat Paddle price ID (catalogue min quantity 3) |
| `COGNOS_MFA_TOTP_ENCRYPTION_KEY_FILE`            | Required when TOTP is enabled                        | Yes    | Base64-encoded 32-byte seed-encryption key                  |
| `COGNOS_BACKEND_HTTP_ADDR`                       | Optional; defaults to `0.0.0.0:8090`                 | No     | Container TCP listen address when no Unix socket is set     |
| `COGNOS_BACKEND_UNIX_SOCKET`                     | Optional                                             | No     | Direct API listener and shared reverse-proxy socket path    |
| `COGNOS_BACKEND_UNIX_SOCKET_MODE`                | Optional; defaults to `660`                          | No     | Socket permission mode                                      |

Direct `*_API_KEY`, `COGNOS_PADDLE_WEBHOOK_SECRET` and
`COGNOS_MFA_TOTP_ENCRYPTION_KEY` variables exist for local development only. Production uses their
`_FILE` forms. `E2E_AI_MOCK_PORT` is test-only and must not be set in production.

SMTP sender/domain, PocketBase public URL, Paddle webhook destination and allowed redirect URLs are
currently PocketBase/operator configuration rather than `APIConfig` fields. The deployment
repository must validate them through a PocketBase settings check before traffic is enabled.

Only models in the reviewed catalogue may be enabled. For each environment, record Provider,
endpoint, model region, zero-retention contractual status and allowed privacy tier. A Swiss/EU tier
must not include a global endpoint or model merely because the gateway itself is European. Changes
to these facts require a catalogue/privacy review and an update to the public subprocessor material.

## Edge security contract

The edge must serve every rule in `frontend/src/_headers`, including CSP, Trusted Types, HSTS,
Permissions Policy, referrer policy, MIME sniffing prevention and frame denial. Because `_headers`
is host-specific metadata rather than an HTTP server, deployment must translate it into the edge
configuration and smoke-test actual responses. Do not assume copying the file into static output
activates the headers.

The reverse proxy must replace, not append untrusted forwarding headers and trust only the known
CDN/load-balancer address ranges. The origin firewall must accept HTTP(S) only from that edge (plus
an authenticated private administration path). Direct public origin access is forbidden. Validate
the observed client IP through the application rate limiter after every proxy change. TLS must be
modern, HSTS-compatible and automatically renewed; DNS/API credentials stay in the deployment
secret store.

## Data, health and migrations

Mount `/app/pb_data` as the durable, exclusively owned PocketBase volume. With a read-only root
filesystem, `/tmp` and `/run/cognos` are the only other writable paths. Run as UID/GID `1001:1001`,
drop all capabilities and prohibit privilege escalation.

The liveness probe is `GET /health`. The response includes a `commit` field (and every API response
sets `X-Cognos-Commit`) with the git SHA baked into the binary at image build time via the
`GIT_COMMIT` build-arg. The Angular app bakes the same SHA at static-site build time
(`COGNOS_COMMIT_SHA`) so Account settings can show App vs API identity when deploys diverge. The
deployment repository must also implement readiness as a smoke transaction that confirms the API can
read its data store and that expected migrations have completed before routing traffic; `/health`
alone is not a database-readiness guarantee. Start one writer, wait for migration completion and
readiness, then enable traffic.

## Backup, restore and release checks

Back up the PocketBase volume on the schedule and retention policy in the private deployment
repository. Backups must be encrypted, off-host, monitored and periodically checked. A restore drill
uses an isolated host and empty volume, restores the complete `pb_data` tree, starts the exact
recorded image digest, verifies migration compatibility, and runs the smoke suite without sending
real customer content to a Provider. Record drill date, backup age, integrity result, RPO and RTO.

Before promotion, the deployment pipeline must fail unless all applicable checks pass:

1. Required variables and mounted secret files exist, are non-empty and have restrictive modes.
2. At least one reviewed Provider is usable; every enabled model satisfies its privacy tier.
3. Every enabled paid plan has a server price ID, matching Paddle product/currency/amount, frontend
   production token/environment and working signed webhook configuration.
4. TOTP has a valid base64 32-byte key when the feature is enabled.
5. PocketBase SMTP, public URL, redirect allowlist and sender domain pass an operator dry run.
6. The API starts against a disposable copy of production-shaped data, migrations complete, and
   health/readiness pass.
7. Static sites contain the expected production URLs; real responses contain every required
   security header.
8. Registration, verification, sign-in, vault creation/unlock, one mock-provider Completion,
   checkout sandbox/verification, billing webhook and Account deletion smoke paths pass.

The application repository does not yet expose a single production `config validate` command for
PocketBase-managed settings and feature-dependent requirements. Until it does, the above validation
is a mandatory deployment-repository gate, not a manual suggestion. Roll back on failed smoke tests
by removing traffic, redeploying the previous digest/config revision, and following the migration
compatibility rule above.
