#!/bin/sh
set -eu

# Hosted disks can arrive owned by root. Prepare only the app's data directory,
# then replace this process with the application running as the node user.
if [ "$(id -u)" = "0" ]; then
  database_path="${DATABASE_PATH:-/app/data/glitch-hunter.sqlite}"
  case "$database_path" in
    /app/data/*) ;;
    *) echo 'Docker DATABASE_PATH must be inside /app/data.' >&2; exit 1 ;;
  esac
  case "$database_path" in
    */../*|*/..) echo 'Database parent traversal is not allowed.' >&2; exit 1 ;;
  esac
  mkdir -p "$(dirname "$database_path")"
  chown -h node:node /app/data "$(dirname "$database_path")"
  for file in "$database_path" "$database_path-wal" "$database_path-shm"; do
    if [ -e "$file" ]; then chown -h node:node "$file"; fi
  done
  exec setpriv --reuid=node --regid=node --init-groups --no-new-privs "$@"
fi
exec "$@"
