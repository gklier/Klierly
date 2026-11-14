#!/bin/sh
# Example nightly backup for a Docker Compose deployment: database dump + uploaded files.
# Usage: ./deploy/backup.sh /path/to/backups      (run from the repository root; add to cron)
# Backups contain private course material: keep them encrypted and access-controlled, and
# remember that deleted user data lives on in backups until they expire (default: 14 days).
set -eu
DEST="${1:?backup directory}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
docker compose exec -T db pg_dump -U klierly -d klierly --format=custom > "$DEST/db-$STAMP.dump"
docker compose run --rm --no-deps -T -v "$DEST:/backup" --entrypoint sh web -c "tar czf /backup/uploads-$STAMP.tar.gz -C /data uploads"
find "$DEST" -name 'db-*.dump' -mtime +14 -delete
find "$DEST" -name 'uploads-*.tar.gz' -mtime +14 -delete
echo "Backup written to $DEST ($STAMP)"
# Restore: pg_restore --clean -U klierly -d klierly < db-<stamp>.dump ; untar uploads into the uploads volume.
