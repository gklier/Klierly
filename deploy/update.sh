#!/usr/bin/env bash
# Update a running server to the latest code on the current branch, then restart.
# Database migrations run automatically when the web container starts.
# Run from the repository root:   ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
FILES=(-f docker-compose.yml)
if [ -f /etc/klierly-tunnel/config.yml ]; then
  FILES+=(-f docker-compose.tunnel.yml)
elif grep -q '^DOMAIN=.' .env 2>/dev/null; then
  FILES+=(-f docker-compose.prod.yml)
fi
docker compose "${FILES[@]}" up -d --build --wait --wait-timeout 300
docker compose "${FILES[@]}" ps
docker compose "${FILES[@]}" exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
