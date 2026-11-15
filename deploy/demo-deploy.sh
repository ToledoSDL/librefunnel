#!/bin/sh
# The public demo's deploy, run by the Release workflow over SSH right after it publishes the demo image.
# The workflow's key is pinned to this script in the server's authorized_keys (see README, Demo), so the only thing
# GitHub can do there is ask for a released version: the tag arrives in SSH_ORIGINAL_COMMAND.
set -eu

REPO=ToledoSDL/librefunnel
DIR=/opt/librefunnel
TAG=${SSH_ORIGINAL_COMMAND:-${1:-}}

if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "demo-deploy: expected a version like v1.2.3, got '$TAG'" >&2
  exit 64
fi

# The compose files and the Caddyfile of that exact release, so the demo never runs a new image with old wiring.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/deploy"
for f in compose.yaml compose.demo.yaml deploy/Caddyfile deploy/evolution.sql; do
  curl -fsSL --proto =https --retry 3 -o "$WORK/$f" "https://raw.githubusercontent.com/$REPO/$TAG/$f"
done
for f in compose.yaml compose.demo.yaml deploy/Caddyfile deploy/evolution.sql; do cp "$WORK/$f" "$DIR/$f"; done

cd "$DIR"
compose() { docker compose -f compose.yaml -f compose.demo.yaml "$@"; }
compose pull -q app
compose up -d app db caddy

# Done only when the new app answers its health check: the workflow fails otherwise, so a broken demo shows up there.
for _ in $(seq 1 90); do
  id=$(compose ps -q app)
  state=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || true)
  if [ "$state" = healthy ]; then
    echo "demo-deploy: $TAG is live"
    exit 0
  fi
  sleep 2
done
echo "demo-deploy: $TAG did not become healthy in 3 minutes" >&2
compose logs --tail 50 app >&2
exit 1
