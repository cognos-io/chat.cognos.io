# Cognos

## Deployment

1. SSH into Hetzner VPS via Tailscale with the `cognos` user:
   - `ssh cognos@api-cognos-io`
1. Go to the Cognos installation directory:
   - `cd /home/cognos/chat.cognos.io`
1. Pull down the latest changes using Git + personal access token:
   - `git pull`
1. Pull down the latest docker images:
   - `docker compose pull`
1. Force a backup to Borgbase:
   - `docker compose run backup borgmatic create --verbosity 1 --list --stats`
1. Verify the Caddyfile:
   - `docker compose run web caddy validate --config /etc/caddy/Caddyfile`
1. If valid, deploy the latest containers:
   - `docker compose up --build --detach`

### Initial setup

Documenting the initial setup here and [in issue #86](https://github.com/cognos-io/chat.cognos.io/issues/86) of the infrastructure and steps to going live for posterity.

- Blog:
  - Using Ghost.io - currently paying $300/year
- Email (needed in a few places):
  - Mailgun, using the Climacrux account
  - Verify the `sendmail.cognos.io` domain for sending emails
- Backups:
  - Create a new backup repository and SSH key pair on BorgBase
- Ory identity provider:
  - Production account
  - Verify cognos.io custom domain
  - Create new OAuth2 client for Pocketbase backend
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
    - Create `cognos` user with `/home/cognos` directory and using bash shell with strong password (for `sudo`)
    - Follow down [How to secure a linux server](https://github.com/imthenachoman/How-To-Secure-A-Linux-Server)
      - `sudoers` group (add `cognos` user)
      - NTP client
      - Secure `/proc`
      - Automatic security updates
      - `ufw` enabled and configured
      - PSAD intrusion detection
    - Install Docker and Docker compose plugin
      - Add `cognos` user to docker group to be able to run docker commands as non-root user
  - Monitoring:
    - Setup Grafana Alloy to monitor server and alert on high usage
  - Pocketbase application:
    - Git clone from GitHub using a [personal access token]() with read only access to `cognos/chat.cognos.io` repo:
      - `git clone https://kisamoto@github.com/cognos/chat.cognos.io.git` and enter access token as password
    - Pull the docker containers in the backend directory:
      - `docker compose pull`
    - Bring up the docker compose infrastructure (Caddy + Pocketbase + Backups)
      - `docker compose up --build --detach`
- Frontend:
  - Angular app deployed to Cloudflare Pages
  - Connect Cloudflare Pages to Github repo. Build from Angular template in `frontend` directory.
- DNS on Cloudflare:
  - Cloudflare is domain registrar and DNS
  - `api.cognos.io` -> Backend LB IP on Hetzner
  - `cognos.io` -> CNAME to Ghost.io
  - `app.cognos.io` -> Frontend Angular app on Cloudflare Pages
  - `chat.cognos.io` -> (alias) Frontend Angular app on Cloudflare Pages

### External dependencies

- GitHub
  - $4/month
  - +$10/month copilot
- Docker Hub
  - $5/month
- Hetzner
  - $15/month
- Cloudflare
  - $5/month + usage
- Ghost
  - $300/year
- Ory
  - $770/year
- Borgbase
  - $24/year
