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

## Security

### Firewall rules - Hetzner

Our Hetzner server is behind a load balancer on a private network. The server firewall has the following rules:

| Sources            | Protocol | Port | Note                        |
| ------------------ | -------- | ---- | --------------------------- |
| All IPv4; All IPv6 | TCP      | 80   | HTTP (to redirect to HTTPS) |
| All IPv4; All IPv6 | TCP      | 443  | HTTPS                       |
| Outgoing           | ALL      | ALL  | Allow all outgoing          |

### Firewall rules - ufw

On the server itself, we also utilize `ufw` to add an additional layer of security with the following rules:

```
$ sudo ufw status
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     LIMIT       Anywhere                   # allow SSH connections in
80/tcp                     ALLOW       Anywhere                   # allow HTTP traffic in
443                        ALLOW       Anywhere                   # allow HTTPS traffic in
8090                       ALLOW       Anywhere                   # allow Pocketbase in
2019                       ALLOW       Anywhere                   # allow Caddy admin API in
8001                       ALLOW       Anywhere                   # allow BricksLLM API in
22/tcp (v6)                LIMIT       Anywhere (v6)              # allow SSH connections in
80/tcp (v6)                ALLOW       Anywhere (v6)              # allow HTTP traffic in
443 (v6)                   ALLOW       Anywhere (v6)              # allow HTTPS traffic in
8090 (v6)                  ALLOW       Anywhere (v6)              # allow Pocketbase in
2019 (v6)                  ALLOW       Anywhere (v6)              # allow Caddy admin API in
8001 (v6)                  ALLOW       Anywhere (v6)              # allow BricksLLM API in

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
8090                       ALLOW OUT   Anywhere                   # allow Pocketbase out
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
8090 (v6)                  ALLOW OUT   Anywhere (v6)              # allow Pocketbase out
```
