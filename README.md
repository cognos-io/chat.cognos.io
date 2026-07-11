# Cognos

Cognos is an encrypted AI chat application.

**Domain language:** see [`CONTEXT.md`](./CONTEXT.md) for canonical terms (Account, Conversation,
Redaction, etc.). Specs and business-process docs follow that glossary.

Target security model for this rework:

- Message content is stored server-side as ciphertext only
- private keys are encrypted client-side before backup
- new devices require the **Account Key** to unlock encrypted key material (the **Account password**
  is sign-in only)
- persistent unlock across refreshes and tabs uses a server-revocable split-key session: half the
  wrap key lives in local storage and half is held server-side, so neither half alone recovers the
  unlock key (see `docs/security-model.md`)

See:

- [`CONTEXT.md`](./CONTEXT.md)
- `docs/security-model.md`
- `docs/specs/backend-model-selector.md`

## Local development

### Local auth setup

Cognos now uses PocketBase's built-in `users` auth collection locally. No Ory setup is required.

1. Install dependencies:
   - `just install-dev`
1. Start the app locally:
   - `just dev`
   - or run `just backend` and `just frontend` separately
1. Open the PocketBase admin UI:
   - `http://127.0.0.1:8090/_/`
1. Sign in with an existing PocketBase admin account, or create the first superuser if PocketBase
   prompts you to
1. Create a user in the `users` auth collection with:
   - an email address
   - a password
   - **`verified` ticked** — AI endpoints (completions, image generation) are gated on a verified
     email (see `docs/business_processes/email-verification-gate.md`), and local dev has no SMTP to
     send a real verification link, so set it manually here
1. Open the frontend and log in with that email and password

Notes:

- the frontend development environment already points at `http://localhost:8090`
- local backend data is served from `backend/pb_data`
- unverified users can sign in and read, but sending a message returns `403 EMAIL_NOT_VERIFIED`
  until the account is verified
- Account Key and local unlock behavior are documented in `docs/security-model.md`

## Deployment

Production deployment is owned by the private Cognos deployment repository. This application
repository defines its build, configuration, secret, edge-security, data, health, backup, smoke-test
and rollback contract in [`docs/deployment-interface.md`](./docs/deployment-interface.md). Operators
must maintain the canonical private-repository URL in the restricted production runbook.

Do not deploy by pulling this repository onto a host or by rebuilding images there. The canonical
backend container is built from the repository root with
`container/backend/Containerfile`; production promotes reviewed immutable image digests.

Repository-side operator controls:

- [restore drill and evidence record](./docs/operations/restore-drill.md)
- [incident response and rollback](./docs/operations/incident-response.md)
- [release evidence bundle](./docs/operations/release-evidence.md)
- [analytics dashboard verification](./docs/operations/analytics-dashboard.md)

### Historical infrastructure notes

The notes below record early planning only. They are not deployment instructions or an inventory of
the current production system; the private deployment repository and the interface above supersede
them.

Documenting the initial setup here and
[in issue #86](https://github.com/cognos-io/chat.cognos.io/issues/86) of the infrastructure and
steps to going live for posterity.

- Blog:
    - Using Ghost.io - currently paying $300/year
- Email (needed in a few places):
    - Mailgun, using the Climacrux account
    - Verify the `sendmail.cognos.io` domain for sending emails
- Analytics (Plausible, EU cloud — see `docs/specs/product-analytics.md`):
    - Create two sites in the Plausible dashboard: `cognos.io` and `app.cognos.io`
    - The site domains are the only "ID" Plausible needs; they are already wired in code and
      must match the dashboard exactly:
        - marketing: `data-domain` in `web/src/layouts/BaseLayout.astro`
        - app: `analytics.plausibleDomain` in `frontend/src/environments/environment.ts`
    - No API key or secret is required to send events; define the §7 goals/funnels in the
      dashboard after the first events arrive
- Backups:
    - Create a new backup repository and SSH key pair on BorgBase
    - Store the Borg passphrase, dedicated backup SSH key, and known_hosts entry as host secrets
      under `backup/secrets/` rather than mounting the full `/home/cognos/.ssh` directory into the
      container
    - A backup is not proven recoverable until the isolated
      [restore drill](./docs/operations/restore-drill.md) passes and its dated record is reviewed
- PocketBase authentication:
    - Create or migrate users in the `users` auth collection
    - Use built-in PocketBase email/password auth for app login
    - Password reset is enabled: the password only authenticates sign-in (the
      Account Key unlocks encrypted data), so resetting it never touches chats
- Backend:
    - Arm VPS on Hetzner:
        - Falkenstein region ([fastest ping](https://cloudpingtest.com/hetzner))
        - Ubuntu 24.04 LTS
        - Backups enabled
        - IPv4 address (needed to connect to things like GitHub)
    - Firewall rules
        - All outgoing traffic
        - HTTP & HTTPS incoming
        - Ping & SSH incoming
    - Load balancer in front of server - public facing IP address for DNS later
    - Software & config:
        - Install Ubuntu updates
        - Install Tailscale and start with SSH option
            - `tailscale up --ssh`
        - Create `cognos` user with `/home/cognos` directory and using bash shell with strong
      password (for `sudo`)
        - Follow down
      [How to secure a linux server](https://github.com/imthenachoman/How-To-Secure-A-Linux-Server)
            - `sudoers` group (add `cognos` user)
            - NTP client
            - Secure `/proc`
            - Automatic security updates
            - `ufw` enabled and configured
            - PSAD intrusion detection
        - Install the rootless container runtime selected in the private deployment repository
    - Monitoring:
        - Setup Grafana Alloy to monitor server and alert on high usage
    - Pocketbase application:
        - Git clone from GitHub using a read-only SSH deploy key for the
          `cognos/chat.cognos.io` repo:
            - `git clone git@github.com:cognos-io/chat.cognos.io.git`
        - Create `backend/.env` from `backend/.env.template`
        - Supply application configuration and mounted secrets according to the deployment
          interface
        - Promote the reviewed image digest through the private deployment repository
- Frontend:
    - Angular app (`frontend/`) built and served from the Hetzner host, fronted by Bunny CDN.
- DNS on Bunny.net:
    - Bunny.net is the DNS provider
    - `api.cognos.io` -> Backend LB IP on Hetzner
    - `cognos.io` -> CNAME to Ghost.io
    - `app.cognos.io` -> Frontend Angular app on Hetzner (via Bunny CDN)
    - `chat.cognos.io` -> (alias) Frontend Angular app on Hetzner (via Bunny CDN)

### External dependencies

- GitHub
    - $4/month
    - +$10/month copilot
- Hetzner
    - $15/month
- Bunny.net (CDN + DNS)
    - usage-based
- Ghost
    - $300/year
- Borgbase
    - $24/year

## Security

### Firewall rules - Hetzner

Our Hetzner server is behind a load balancer on a private network. The server firewall has the
following rules:

| Sources            | Protocol | Port | Note                        |
| ------------------ | -------- | ---- | --------------------------- |
| All IPv4; All IPv6 | TCP      | 80   | HTTP (to redirect to HTTPS) |
| All IPv4; All IPv6 | TCP      | 443  | HTTPS                       |
| Outgoing           | ALL      | ALL  | Allow all outgoing          |

### Firewall rules - ufw

On the server itself, we also utilize `ufw` to add an additional layer of security with the
following rules:

```text
$ sudo ufw status
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     LIMIT       Anywhere                   # allow SSH connections in
80/tcp                     ALLOW       Anywhere                   # allow HTTP traffic in
443                        ALLOW       Anywhere                   # allow HTTPS traffic in
22/tcp (v6)                LIMIT       Anywhere (v6)              # allow SSH connections in
80/tcp (v6)                ALLOW       Anywhere (v6)              # allow HTTP traffic in
443 (v6)                   ALLOW       Anywhere (v6)              # allow HTTPS traffic in

53                         ALLOW OUT   Anywhere                   # allow DNS calls out
123                        ALLOW OUT   Anywhere                   # allow NTP out
80/tcp                     ALLOW OUT   Anywhere                   # allow HTTP traffic out
443                        ALLOW OUT   Anywhere                   # allow HTTPS traffic out
43/tcp                     ALLOW OUT   Anywhere                   # allow whois
25                         ALLOW OUT   Anywhere                   # allow SMTP out
587                        ALLOW OUT   Anywhere                   # allow SMTP out
67                         ALLOW OUT   Anywhere                   # allow the DHCP client to update
68                         ALLOW OUT   Anywhere                   # allow the DHCP client to update
22/tcp                     ALLOW OUT   Anywhere                   # allow SSH traffic out
53 (v6)                    ALLOW OUT   Anywhere (v6)              # allow DNS calls out
123 (v6)                   ALLOW OUT   Anywhere (v6)              # allow NTP out
80/tcp (v6)                ALLOW OUT   Anywhere (v6)              # allow HTTP traffic out
443 (v6)                   ALLOW OUT   Anywhere (v6)              # allow HTTPS traffic out
43/tcp (v6)                ALLOW OUT   Anywhere (v6)              # allow whois
25 (v6)                    ALLOW OUT   Anywhere (v6)              # allow SMTP out
587 (v6)                   ALLOW OUT   Anywhere (v6)              # allow SMTP out
67 (v6)                    ALLOW OUT   Anywhere (v6)              # allow the DHCP client to update
68 (v6)                    ALLOW OUT   Anywhere (v6)              # allow the DHCP client to update
22/tcp (v6)                ALLOW OUT   Anywhere (v6)              # allow SSH traffic out
```
