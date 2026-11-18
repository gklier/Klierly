# Run your own Klierly

This guide is for a trusted operator running a single instance. The source is publicly viewable, but no open-source license is selected; review [source terms](../SOURCE_TERMS.md) before reuse or redistribution.

## 1. Configure and start

Install Git and Docker Engine with Docker Compose. Clone the repository, then prepare its environment:

```bash
git clone https://github.com/gklier/Klierly.git
cd Klierly
cp .env.example .env
```

Edit `.env` locally. Set unique `POSTGRES_PASSWORD`, `APP_SECRET` and `WORKER_TOKEN` values. Generate secrets with a password manager or `openssl rand -hex 32`. Preserve `APP_SECRET` in backups: changing it makes stored provider keys unreadable.

Set `APP_URL` to your final HTTPS origin before enrolling passkeys. Passkeys are tied to the hostname; changing hosts requires new enrollment. Configure an HTTPS reverse proxy or follow [the Cloudflare Tunnel guide](DEPLOY_CLOUDFLARE.md). Only enable `TRUST_CLOUDFLARE` when all app traffic reaches it through the trusted tunnel. On a public instance, keep `ALLOW_PRIVATE_AI_ENDPOINTS=false`.

```bash
docker compose up -d --build --wait
```

The base Compose configuration binds the web port to localhost. Database and worker ports stay unpublished. Use the same Compose overlays consistently for subsequent commands if deploying with an overlay.

## 2. Provision the first owner

Public registration is deliberately disabled. On a fresh database, create one owner record from the trusted server console:

```bash
docker compose exec db psql -U klierly -d klierly
```

At the database prompt, replace the example name and email with the owner's details. Use SQL escaping if they contain an apostrophe.

```sql
INSERT INTO users (email, name, password_hash)
VALUES ('owner@example.com', 'Your name', 'disabled')
RETURNING id;
\q
```

Copy the returned UUID, then issue a private enrollment link:

```bash
docker compose exec web npx tsx scripts/bootstrap-owner.ts <owner-uuid> /tmp/owner-enrollment.txt
docker compose exec web cat /tmp/owner-enrollment.txt
```

Open that link in a compatible browser on your final HTTPS hostname and create your own passkey. The link is private, single-use and valid for 24 hours. Keep it out of logs, issues and screenshots. The bootstrap refuses to run after the owner has a passkey.

After successful enrollment, remove the link file and add a second passkey from Settings:

```bash
docker compose exec web rm /tmp/owner-enrollment.txt
```

Use **Admin** to approve student requests and privately deliver each enrollment link. The hosted project's request address is `gabriel.klier@ufl.edu`; independent installations need to adapt the contact information in the login, registration, security and privacy text to their own operator before inviting users.

For an existing database, preserve the owner record and use [the migration procedure](SECURITY_OPERATIONS.md). Do not create a duplicate owner.

## 3. Try the study workflow

Choose **Load the sample course**. The synthetic material and 35 checked questions work without AI. Upload only material you are permitted to use.

For new question generation, configure a supported provider in Settings or set up [managed AI](MANAGED_AI.md) on the server. Managed AI needs provider credentials, model pricing and positive budgets; it does not turn on automatically. Provider billing is separate from ChatGPT or other consumer subscriptions.

## 4. Operate it

Back up PostgreSQL, the uploads volume and the private environment configuration. Keep backups encrypted and perform a restore drill before relying on them. Apply OS and dependency updates, check available disk space and review provider spending.

Read [security operations](SECURITY_OPERATIONS.md), [known issues](KNOWN_ISSUES.md) and [architecture](../ARCHITECTURE.md) before broader access. Passkey/browser compatibility, real-course question quality and operational restore testing remain pilot priorities.

## Development and validation

Use Node 22, Python 3.11+ and PostgreSQL 16 for a non-Docker development environment. Detailed commands and the course workflow are in [development](DEVELOPMENT.md). Run automated tests only against isolated test databases. Never aim the reset scripts at production.
