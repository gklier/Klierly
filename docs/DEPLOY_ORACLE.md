# Running Klierly on an Oracle Cloud server

Goal: Klierly runs on a server you own, always on, so you stop building it on your MacBook.
You update it with one command. **Nothing in this repository creates, pays for, or opens anything
on your behalf: you do each step below in your own Oracle account.**

## What was and was not verified

| Verified (x86_64 sandbox, and CI) | Not verified |
| --- | --- |
| The repo's Dockerfiles and `docker-compose.yml` build and run: database, worker and web all healthy; sample course imported by the containerised worker; data survived a full stop and start; the web container runs as a non-root user; idle memory ≈ 260 MB total (web 143 MB, worker 82 MB, database 35 MB) | **Real Oracle hardware**; `deploy/setup-vm.sh` on a real Oracle machine; the public HTTPS overlay (`docker-compose.prod.yml`) |
| Building the images found a real bug (a TypeScript Next.js config made `next start` try to install TypeScript at startup). Fixed. | |

**Arm:** GitHub Actions builds and starts the same stack for `linux/arm64` under emulation (manual or on `main`; it passed on 2026-11-14), which is real evidence the images work on Arm, but emulation is not Oracle's machine, and it is much slower than native. Expect a snag or two on the first real run; copy the error text to me.

## Oracle's free limits (read from Oracle's page on 2026-11-14; check it again when you sign up)

- Arm A1 Always Free: **2 OCPUs and 12 GB of memory in total**, 200 GB of storage in total, 10 TB/month outbound traffic.
- **Idle Always Free instances may be reclaimed.** Idle means, over 7 days: CPU 95th percentile < 20%, network < 20%, *and* (for A1) memory < 20%. A lightly used Klierly will look idle. Back up (below), and check Oracle's current docs on whether upgrading the account to pay-as-you-go (which still costs nothing within the free allowance) changes this.
- "Out of host capacity" when creating the instance is common. Try another availability domain, or retry later.

Create a **budget alert** (Console → Billing → Budgets) at a few dollars so a mistake cannot surprise you.

## Choose how you will reach it

**Option A (recommended to start): private, through an SSH tunnel.** No domain, no certificate, nothing public
except SSH. Your MacBook sees Klierly at `http://localhost:3000`, which is also what the extension already expects.

**Option B: a public https address.** Needs a domain name. Required before other students can use it. Do this later,
after you have decided about the legal and safety items in `ROADMAP.md`.

## Steps (Option A)

### 1. Create the machine (Oracle Console)
1. Compute → Instances → **Create instance**.
2. Image: **Canonical Ubuntu 24.04** (the Arm/aarch64 build). Shape: **VM.Standard.A1.Flex**, **2 OCPUs, 12 GB**.
3. Networking: keep the default network, **assign a public IPv4 address**.
4. SSH keys: on your MacBook run `ssh-keygen -t ed25519` (press Enter for the defaults), then
   `cat ~/.ssh/id_ed25519.pub` and paste that line into "Paste public keys". Never share the file *without* `.pub`.
5. Boot volume: the default (about 50 GB) is plenty.
6. In the network's **Security List**, keep only SSH (port 22) open, and if you can, set its source to your own IP address followed by `/32`.

### 2. Log in and prepare it
```bash
ssh ubuntu@<the-public-ip>
sudo apt-get update && sudo apt-get install -y git
```

### 3. Get the code
If the repository is private, give the server a **read-only deploy key**:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/klierly_deploy -N ''
cat ~/.ssh/klierly_deploy.pub        # copy this line
```
On GitHub: repository **Settings → Deploy keys → Add deploy key**, paste it, leave "Allow write access" **off**. Then:
```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/klierly_deploy -o IdentitiesOnly=yes' git clone git@github.com:gklier/Klierly.git
cd Klierly
git config core.sshCommand 'ssh -i ~/.ssh/klierly_deploy -o IdentitiesOnly=yes'
```
Use the branch you want to run: `git checkout main` once the pull request is merged, or `git checkout courselab-initial` before that.

### 4. Install Docker and create the settings
```bash
./deploy/setup-vm.sh
```
This installs Docker from Ubuntu's packages, adds 4 GB of swap, and writes `.env` with fresh random secrets (mode 600).
Read it first if you like: it is short. Then **log out and back in once** so the `docker` group takes effect, and `cd Klierly` again.

### 5. Start it
```bash
docker compose up -d --build
docker compose ps                    # wait until db, worker and web say "healthy"
curl http://localhost:3000/api/health
```
Expect `{"status":"ok","database":true,"worker":true}`. The first build takes a while on two small cores.
Klierly is bound to the server's own address only; the database and the worker have no published ports at all.

### 6. Open it from your MacBook
In a Terminal on the MacBook (leave it running):
```bash
ssh -N -L 3000:127.0.0.1:3000 ubuntu@<the-public-ip>
```
Now open <http://localhost:3000>, create your account (the first account on a new server is open), and go to
**Settings → Browser extension** to make a token for the extension. The extension's default address already matches.
To make this permanent, add to `~/.ssh/config` on the MacBook:
```
Host klierly
  HostName <the-public-ip>
  User ubuntu
  LocalForward 3000 127.0.0.1:3000
  ServerAliveInterval 30
```
and then simply run `ssh -N klierly`.

### 7. Update later
```bash
ssh ubuntu@<the-public-ip>
cd Klierly && ./deploy/update.sh
```
That pulls the latest code, rebuilds, restarts, and applies database migrations automatically.

### 8. Back up
```bash
./deploy/backup.sh ~/backups          # database dump and uploaded files; keeps 14 days
```
Run it from cron if you want it daily (`crontab -e`, e.g. `30 3 * * * cd ~/Klierly && ./deploy/backup.sh ~/backups`).
Copy backups off the machine now and then (for example to your MacBook with `scp`): a reclaimed or broken instance takes local backups with it.
Backups contain private course material, so treat them like the server itself.

## Option B: a public https address (later)

1. Buy or use a domain; create an **A record** pointing at the server's public IP.
2. In the Oracle Security List also allow **80 and 443** from anywhere.
3. Oracle's Ubuntu images usually also block those ports in the machine's own firewall; if the site does not load after step 2, run
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
4. In `.env`: set `DOMAIN=your.domain`, `APP_URL=https://your.domain`, keep `INVITE_CODE` long and secret.
5. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Caddy obtains the certificate itself.
6. In the extension settings use `https://your.domain`.

Before inviting anyone: the privacy policy is a draft that needs a lawyer, quotas must be configured if you turn managed AI on,
and you should decide about student-to-student sharing first (`docs/DECISIONS.md`).

## Running a model on the server (not recommended)

With 12 GB shared by Klierly, its database and Docker, only a small quantised model fits, and on two Arm cores it will be slow and its
drafts will fail Klierly's checks more often. A large model (tens of billions of parameters or more) cannot run there at all.
If you try Ollama anyway, run it as another container on the same network and set
`MANAGED_AI_BASE_URL=http://ollama:11434/v1`, `MANAGED_AI_MODEL=<the small model>`, `MANAGED_AI_API_KEY=unused`. See `docs/MANAGED_AI.md` for better options.
