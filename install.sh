#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null || { echo 'Install Docker Engine and Docker Compose first.' >&2; exit 1; }
docker compose version >/dev/null
command -v git >/dev/null || { echo 'Install git first.' >&2; exit 1; }
cd "$(dirname "$(realpath "$0")")"
mkdir -p data
if [ ! -f .env ]; then
  cp .env.example .env
  address="${LAN_IP:-$(hostname -I | awk '{print $1}')}"
  [ -n "$address" ] || { echo 'Set LAN_IP in .env.' >&2; exit 1; }
  sed -i "s/^LAN_IP=.*/LAN_IP=$address/;s/^PUID=.*/PUID=$(id -u)/;s/^PGID=.*/PGID=$(id -g)/" .env
fi
docker compose up -d --build
echo 'Dash is starting. Address configuration:'
awk -F= '/^(LAN_IP|DASH_PORT)=/{print "  " $0}' .env
echo 'Open http://<LAN_IP>:<DASH_PORT>. Updates are in Settings → Updates.'
