# Klierly over Cloudflare Tunnel

The deployment uses https://klierly.klierapps.tech and a dedicated locally managed tunnel. The account certificate stays on the existing trusted management server. Only the Klierly tunnel credential is mounted into this VM.

Set APP_URL=https://klierly.klierapps.tech in the private .env. Place the tunnel's config.yml and credentials.json in /etc/klierly-tunnel, owned by root with group 65532, directory mode 750 and file mode 640.

The config.yml must name the dedicated tunnel UUID, point credentials-file to /etc/cloudflared/credentials.json, route the exact hostname to http://web:3000, and end with a http_status:404 catch-all.

Create the named tunnel and DNS record using an authorized Cloudflare management host:

    cloudflared tunnel create klierly
    cloudflared tunnel route dns <tunnel-uuid> klierly.klierapps.tech

Copy only that tunnel's credential to the Klierly VM over SSH. Never commit the credential or the account certificate.

Build and start the application first:

    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build db worker web

Apply the owner migration and bootstrap described in SECURITY_OPERATIONS.md, then start the connector:

    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d cloudflared

The tunnel overlay removes the web port from the host. PostgreSQL and the parser use an internal Docker network. The web service can reach approved AI providers through a separate network. The connector talks to web over that network and makes encrypted outbound connections to Cloudflare.

Public account creation is closed. Students request accounts by emailing gabriel.klier@ufl.edu. The administrator replies with an individual enrollment link. All sign-in uses passkeys. Keep ordinary Cloudflare protection enabled, bypass caching for authenticated pages and /api/*, and verify hostname, Origin headers, Secure cookies, HSTS, and passkey enrollment at the final address. Any additional Access policy must also accommodate extension requests, which omit cookies and use revocable Klierly bearer tokens.

To stop public access:

    docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop cloudflared

Keep database and uploaded-file backups encrypted and off the guest. Test restoration regularly. Access controls and dependency checks need ongoing maintenance.
