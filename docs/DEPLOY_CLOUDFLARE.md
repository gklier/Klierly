# Putting Klierly on a Cloudflare Tunnel

A tunnel lets people reach Klierly at an https address without opening any port on the machine (your Oracle VM
or anything else). `cloudflared` runs next to the app and dials out to Cloudflare. **This makes the app reachable
from the internet**, so read "Before you switch it on".

I have not run this against a real Cloudflare account (I cannot from the build environment). The compose overlay
parses and the app change is tested; the Cloudflare dashboard steps below follow Cloudflare's documented flow and
may have moved, so check them against Cloudflare's current docs.

## Two ways

| | Quick tunnel (to try it) | Named tunnel (to use it) |
|---|---|---|
| Address | random `*.trycloudflare.com`, **changes on every restart** | your own hostname, stable |
| Needs | nothing: no account, no domain | a Cloudflare account and a domain **on Cloudflare** |
| Cost | free | domain price (you said not to buy one yet; a domain you already own works) |
| Fits Klierly? | testing only: the extension's server address and `APP_URL` would need changing each time | yes |

### Quick tunnel (testing only)
Run it on the machine that runs Klierly (web on port 3000):
```bash
docker run --rm --network host cloudflare/cloudflared:2025.11.1 tunnel --no-autoupdate --url http://localhost:3000
```
It prints an `https://….trycloudflare.com` address. Set `APP_URL` to it (so session cookies are marked secure) and restart
the web container. Stop it with Ctrl+C. Do not leave this running unattended.

### Named tunnel (recommended)
1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → type **Cloudflared**.
   Name it `klierly`. Copy the **token** it shows (a long string). Treat it like a password.
2. In the same wizard, add a **Public hostname**: subdomain `klierly` (or what you like), your domain, service type
   **HTTP**, URL `web:3000` (the container name on the compose network).
3. On the server, in `.env` (never commit it):
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   APP_URL=https://klierly.yourdomain.com
   INVITE_CODE=<long random string>
   ADMIN_EMAILS=you@example.com
   ```
4. Start it:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
   ```
5. Open `APP_URL`. Register with the invite code. Check **Operator** works for your admin email.
6. In the extension's settings, set the server address to the same https address and paste a new pairing token.

## Before you switch it on
- **Invite-only registration** is enforced by the overlay (it refuses to start without `INVITE_CODE`). Share the code
  only with classmates you trust.
- **Cost cap**: set `MANAGED_AI_GLOBAL_DAILY_REQUESTS` and `MANAGED_AI_GLOBAL_MONTHLY_USD` (see `docs/MANAGED_AI.md`).
  Anyone with the invite code can spend your AI budget up to those limits.
- **Cloudflare sees the traffic** (it terminates https). That includes students' course text and summaries. Say so in
  whatever you tell classmates; it is also a data flow to add to the privacy page before sharing widely.
- **Class library**: only the claim-based membership check protects it (`docs/DECISIONS.md`). With a public address,
  more people can try to claim a class, so review the operator page's reports regularly.
- **Backups**: `deploy/backup.sh` still applies; the tunnel adds none.
- **Do not publish a port** as well. The overlay removes the published port on purpose.
- Optional hardening: Cloudflare **Access** can require a login before anyone reaches the site, but it also blocks the
  extension's calls to `/api/ext/*` unless you add a bypass rule for that path, so start without it.
- The app uses `CF-Connecting-IP` for its login and registration rate limits when present (it is set by Cloudflare and
  cannot be chosen by the visitor). That is only trustworthy because the web container is reachable **only** through
  the tunnel.

## Turning it off
```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop cloudflared
```
or delete the tunnel in the Cloudflare dashboard; the address stops working immediately.
