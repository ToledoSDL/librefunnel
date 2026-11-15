#!/bin/sh
# The public demo's deploy, run by the Release workflow right after it publishes the demo image. It arrives through
# Oracle Cloud's Run Command, so the server opens no port: the instance agent fetches the command from Oracle's API.
# The agent's user may run only this script with sudo (see README, Demo), and the only input is a released version.
set -eu

REPO=ToledoSDL/librefunnel
DIR=/opt/librefunnel
TAG=${1:-}

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
HOST=$(sed -n 's/^DOMAIN=//p' .env)

healthy() {
  for _ in $(seq 1 90); do
    state=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || true)
    if [ "$state" = healthy ]; then return 0; fi
    sleep 2
  done
  return 1
}

# Through Caddy, as a visitor gets it: a healthy app Caddy cannot reach is still a demo that is down.
served() {
  for _ in $(seq 1 15); do
    if curl -fsSk -o /dev/null --max-time 5 --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health"; then return 0; fi
    sleep 2
  done
  return 1
}

compose pull -q app
compose up -d app db caddy

# A changed network in compose.yaml reattaches running containers without their service names, so Caddy loses the app.
if healthy && ! served; then compose up -d --force-recreate --no-deps app caddy; fi

if healthy && served; then
  echo "demo-deploy: $TAG is live"
  exit 0
fi
echo "demo-deploy: $TAG is not answering through Caddy" >&2
compose logs --tail 50 app caddy >&2
exit 1
