#!/usr/bin/env bash
# Update a running server to the latest code on the current branch, then restart.
# Database migrations run automatically when the web container starts.
# Run from the repository root:   ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
if grep -q '^DOMAIN=.' .env 2>/dev/null; then FILES="-f docker-compose.yml -f docker-compose.prod.yml"; else FILES="-f docker-compose.yml"; fi
docker compose $FILES up -d --build
docker compose $FILES ps
echo "Health: $(curl -s --max-time 10 http://localhost:3000/api/health || echo 'not reachable yet; wait a minute and retry')"
